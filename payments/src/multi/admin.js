// Self-hosted operator API. No PII, wallet private keys or user credentials stored.
import {ASSETS} from '../assets.js';
import {validateReceivingAddress} from '../address.js';
import {FIATS,positiveAtomic} from './fiat.js';
import {digestHex,newSecret,projectWebhookKey,safeEqual} from './keys.js';
import {requireProjectId,isUuid,safeWebhookUrl} from './identity.js';
import {readinessV2} from './readiness.js';
import {paymentProfileAdmin,initializeProjectPayments} from './project-config.js';
import {projectReport} from './project-reports.js';
import {importPublicWalletReceivers,canonicalPublicAddress} from './public-wallet-import.js';
import {ASSET_CATALOG,walletSetupPlan} from '../asset-registry.js';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{
 'content-type':'application/json','cache-control':'no-store'}});
const fail=(code,status=400)=>json({ok:false,error:code},status);
const skuPattern=/^[a-z][a-z0-9_-]{2,39}$/;
async function readBody(req){
 const text=await req.text();
 if(text.length>4096)throw Error('body_too_large');
 const data=JSON.parse(text);
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('invalid_body');
 return data;
}
export function operatorAllowed(request,env) {
 const actual=request.headers.get('authorization')||'';
 return typeof env.MULTI_ADMIN_KEY==='string'&&env.MULTI_ADMIN_KEY.length>=48 &&
  safeEqual(actual,'Bearer '+env.MULTI_ADMIN_KEY);
}
async function audit(db,action,projectId,detail={}){
 await db.prepare(`INSERT INTO v2_operator_audit(id,action,project_id,details,created_at_ms)
  VALUES(?,?,?,?,?)`).bind(crypto.randomUUID(),action,projectId,
   JSON.stringify(detail),Date.now()).run();
}
async function createProject(db,b,env){
 const label=String(b.label||'').trim();
 if(label.length<3||label.length>60) return fail('invalid_project_label');
 const callback=safeWebhookUrl(b.webhookUrl);
 // Operator must explicitly allow each project's callback host.
 const hostname=new URL(callback).hostname;
 const approved=String(env.MULTI_WEBHOOK_HOST_ALLOWLIST||'').split(',')
  .map(x=>x.trim().toLowerCase()).filter(Boolean);
 if(!approved.includes(hostname))return fail('callback_host_not_approved',403);
 if(typeof env.MULTI_WEBHOOK_MASTER_KEY!=='string'||
    env.MULTI_WEBHOOK_MASTER_KEY.length<40)
  return fail('webhook_signing_not_configured',503);
 const projectId=crypto.randomUUID(),keyId=crypto.randomUUID();
 const secret=newSecret(),hash=await digestHex(secret);
 const webhookSigningSecret=await projectWebhookKey(env.MULTI_WEBHOOK_MASTER_KEY,projectId);
 const now=Date.now();
 await db.batch([
  db.prepare(`INSERT INTO v2_projects(id,label,webhook_url,status,created_at_ms,updated_at_ms)
   VALUES(?,?,?,'disabled',?,?)`).bind(projectId,label,callback,now,now),
  db.prepare(`INSERT INTO v2_api_keys(id,project_id,secret_sha256,created_at_ms)
   VALUES(?,?,?,?)`).bind(keyId,projectId,hash,now),
  db.prepare(`INSERT INTO v2_operator_audit(id,action,project_id,details,created_at_ms)
   VALUES(?,'create_project',?,'{}',?)`).bind(crypto.randomUUID(),projectId,now),
  ...await initializeProjectPayments(db,projectId,label,now)
 ]);
 return json({ok:true,projectId,keyId,apiKey:secret,webhookSigningSecret,
   status:'disabled',notice:'Store both secrets in your project server secrets; shown once.'},201);
}
async function createProduct(db,b){
 const projectId=requireProjectId(b.projectId);
 const sku=String(b.sku||'');
 if(!skuPattern.test(sku)||!FIATS.includes(b.currency)||
    !Number.isSafeInteger(b.amountMinor)||b.amountMinor<1||b.amountMinor>100000000000||
    typeof b.title!=='string'||b.title.trim().length<3||b.title.length>80)
  return fail('invalid_product');
 const now=Date.now();
 await db.batch([
  db.prepare(`INSERT INTO v2_products
   (project_id,sku,title,currency,amount_minor,status,updated_at_ms)
   VALUES(?,?,?,?,?,'disabled',?) ON CONFLICT(project_id,sku)
   DO UPDATE SET title=excluded.title,currency=excluded.currency,
     amount_minor=excluded.amount_minor,status='disabled',
     updated_at_ms=excluded.updated_at_ms`)
   .bind(projectId,sku,b.title.trim(),b.currency,b.amountMinor,now),
  db.prepare(`INSERT INTO v2_operator_audit(id,action,project_id,details,created_at_ms)
   VALUES(?,'upsert_product',?,?,?)`).bind(crypto.randomUUID(),projectId,
     JSON.stringify({sku,currency:b.currency,amountMinor:b.amountMinor}),now)
 ]);
 return json({ok:true,projectId,sku,status:'disabled'});
}
async function setRate(db,b){
 if(!FIATS.includes(b.fiat)||!ASSETS[b.asset]||
    !positiveAtomic(b.numeratorAtomic)||!positiveAtomic(b.denominatorMinor)||
    !Number.isSafeInteger(b.validSeconds)||b.validSeconds<180||
    b.validSeconds>3600) return fail('invalid_exchange_rate');
 const now=Date.now(),until=now+b.validSeconds*1000;
 await db.batch([
  db.prepare(`INSERT INTO v2_exchange_rates
   (fiat,asset,numerator_atomic,denominator_minor,valid_from_ms,
    expires_at_ms,source,enabled)
   VALUES(?,?,?,?,?,?,'operator_manual',0)
   ON CONFLICT(fiat,asset) DO UPDATE SET
   numerator_atomic=excluded.numerator_atomic,
   denominator_minor=excluded.denominator_minor,
   valid_from_ms=excluded.valid_from_ms,
   expires_at_ms=excluded.expires_at_ms,
   source=excluded.source,enabled=0`)
  .bind(b.fiat,b.asset,b.numeratorAtomic,b.denominatorMinor,now,until),
  db.prepare(`INSERT INTO v2_operator_audit(id,action,project_id,details,created_at_ms)
   VALUES(?,'replace_fx_rate',NULL,?,?)`)
  .bind(crypto.randomUUID(),JSON.stringify({fiat:b.fiat,asset:b.asset,until}),now)
 ]);
 return json({ok:true,fiat:b.fiat,asset:b.asset,status:'disabled',expiresAt:until});
}
async function addReceiver(db,b){
 if(!['bitcoin','ethereum','tron','ton'].includes(b.chain)||
    !await validateReceivingAddress(b.chain,b.address))return fail('invalid_receiver');
 const address=canonicalPublicAddress(b.chain,b.address);
 const existing=await db.prepare(b.chain==='ethereum'
  ?'SELECT address FROM deposit_addresses WHERE chain=? AND address=? COLLATE NOCASE LIMIT 1'
  :'SELECT address FROM deposit_addresses WHERE chain=? AND address=? LIMIT 1')
  .bind(b.chain,address).first();
 if(existing)return fail('receiver_already_registered',409);
 const now=Date.now();
 const [insert]=await db.batch([
  db.prepare(`INSERT OR IGNORE INTO deposit_addresses
   (chain,address,assigned_intent,source,added_at_ms,label,enabled)
   VALUES(?,?,NULL,'trust_wallet',?,'v2_multi',0)`).bind(b.chain,address,now),
  db.prepare(`INSERT INTO v2_operator_audit(id,action,project_id,details,created_at_ms)
   VALUES(?,'add_receiver',NULL,?,?)`)
   .bind(crypto.randomUUID(),JSON.stringify({chain:b.chain}),now)
 ]);
 if(!insert.meta?.changes)return fail('receiver_already_registered',409);
 return json({ok:true,chain:b.chain,address,status:'disabled'},201);
}
async function toggle(db,resource,b,enabled){
 const now=Date.now();
 if(b.confirmation!=='CONFIRM_OPERATOR_CHANGE')return fail('confirmation_required');
 let stmt,target;
 if(resource==='projects'){
  const projectId=requireProjectId(b.projectId);
  stmt=db.prepare('UPDATE v2_projects SET status=?,updated_at_ms=? WHERE id=?')
   .bind(enabled?'active':'disabled',now,projectId);
  target=projectId;
 }else if(resource==='products'){
  const projectId=requireProjectId(b.projectId);
  if(!skuPattern.test(b.sku||''))return fail('invalid_product');
  stmt=db.prepare('UPDATE v2_products SET status=? WHERE project_id=? AND sku=?')
   .bind(enabled?'active':'disabled',projectId,b.sku);
  target=projectId+':'+b.sku;
 }else if(resource==='rates'){
  if(!FIATS.includes(b.fiat)||!ASSETS[b.asset])return fail('invalid_rate_pair');
  stmt=db.prepare(`UPDATE v2_exchange_rates SET enabled=?
   WHERE fiat=? AND asset=? AND expires_at_ms>?`)
   .bind(enabled?1:0,b.fiat,b.asset,now+120000);
  target=b.fiat+':'+b.asset;
 }else if(resource==='receivers'){
  if(!['bitcoin','ethereum','tron','ton'].includes(b.chain)||
     !await validateReceivingAddress(b.chain,b.address))return fail('invalid_receiver');
  stmt=db.prepare(`UPDATE deposit_addresses SET enabled=?
   WHERE chain=? AND address=? AND assigned_intent IS NULL`)
   .bind(enabled?1:0,b.chain,canonicalPublicAddress(b.chain,b.address));
  target=b.chain+':'+b.address;
 }else return fail('invalid_resource');
 const result=await stmt.run();
 if(!result.meta?.changes)return fail('resource_not_changed',404);
 await audit(db,enabled?'enable_'+resource:'disable_'+resource,null,{target});
 return json({ok:true,resource,enabled});
}
async function keys(db,b){
 const projectId=requireProjectId(b.projectId);
 const project=await db.prepare('SELECT id FROM v2_projects WHERE id=?').bind(projectId).first();
 if(!project)return fail('project_not_found',404);
 const secret=newSecret(),id=crypto.randomUUID(),sha=await digestHex(secret);
 await db.prepare(`INSERT INTO v2_api_keys(id,project_id,secret_sha256,created_at_ms)
  VALUES(?,?,?,?)`).bind(id,projectId,sha,Date.now()).run();
 await audit(db,'create_project_key',projectId,{keyId:id});
 return json({ok:true,projectId,keyId:id,apiKey:secret},201);
}
export async function multiAdmin(request,env,url){
 if(!env.DB||!operatorAllowed(request,env))return fail('unauthorized',401);
 if(env.MULTI_ADMIN_ENABLED!=='true')return fail('admin_disabled',503);
 const db=env.DB,path=url.pathname;
 try{
  if(path==='/v2/admin/status'&&request.method==='GET'){
   const [projects,open,undelivered,pool,reviews,staleFx,failed,chainProblems,partialQueue,oldestOutbox]=await Promise.all([
    db.prepare('SELECT COUNT(*) AS n FROM v2_projects').first(),
    db.prepare("SELECT COUNT(*) AS n FROM v2_invoices WHERE status='awaiting_payment'").first(),
    db.prepare('SELECT COUNT(*) AS n FROM v2_delivery_outbox WHERE delivered_at_ms IS NULL').first(),
    db.prepare(`SELECT chain,COUNT(*) AS n FROM deposit_addresses
     WHERE enabled=1 AND assigned_intent IS NULL GROUP BY chain`).all(),
    db.prepare(`SELECT COUNT(*) AS n FROM v2_payment_reviews
     WHERE resolved_at_ms IS NULL`).first(),
    db.prepare(`SELECT COUNT(*) AS n FROM v2_exchange_rates
     WHERE enabled=1 AND expires_at_ms<?`).bind(Date.now()).first(),
    db.prepare(`SELECT COUNT(*) AS n FROM v2_delivery_outbox
     WHERE delivered_at_ms IS NULL AND attempts>=5`).first(),
    db.prepare(`SELECT state,COUNT(*) AS n FROM v2_chain_audit_state
      WHERE state IN ('uncertain','manual_review') GROUP BY state`).all(),
    db.prepare('SELECT COUNT(*) AS n FROM v2_partial_reconcile_queue').first(),
    db.prepare(`SELECT MIN(created_at_ms) AS oldest FROM v2_delivery_outbox
      WHERE delivered_at_ms IS NULL`).first()
   ]);
   const capacity={bitcoin:0,ethereum:0,tron:0,ton:0};
   for(const row of pool.results||[])if(row.chain in capacity)capacity[row.chain]=row.n;
   const readiness=readinessV2(env);
   return json({ok:true,projects:projects?.n||0,pending:open?.n||0,
    deliveryBacklog:undelivered?.n||0,deliveryRetryFailures:failed?.n||0,
    oldestUndeliveredMs:oldestOutbox?.oldest??null,
    manualReviews:reviews?.n||0,expiredEnabledRates:staleFx?.n||0,
    postSettlementAudits:Object.fromEntries((chainProblems?.results||[]).map(x=>[x.state,x.n])),
    pendingPartialReconciliations:partialQueue?.n||0,
    availableReceivers:capacity,
    tonNetworkEnabled:env.MULTI_TON_ENABLED==='true',
    checkoutEnabled:readiness.ready,
    missingPrerequisites:readiness.missing});
  }
  if(path==='/v2/admin/reviews'&&request.method==='GET'){
   const includeClosed=url.searchParams.get('closed')==='true';
   const limit=Math.min(100,Math.max(1,Number(url.searchParams.get('limit')||50)));
   if(!Number.isSafeInteger(limit))return fail('invalid_limit');
   const projectId=url.searchParams.get('projectId');
   if(projectId&&!isUuid(projectId))return fail('invalid_project_id');
   const filters=projectId?' AND i.project_id=?':'';
   const query=`SELECT r.id,r.invoice_id,i.project_id,i.fiat,i.amount_minor,
     i.asset,i.chain,r.tx_hash,r.reason,r.actual_amount_atomic,
     r.created_at_ms,r.resolved_at_ms,r.resolution_code
     FROM v2_payment_reviews r JOIN v2_invoices i ON i.id=r.invoice_id
     WHERE (r.resolved_at_ms IS NULL OR ?=1)`+filters+
     ' ORDER BY r.created_at_ms DESC LIMIT ?';
   const args=projectId?[includeClosed?1:0,projectId,limit]:[includeClosed?1:0,limit];
   const rows=await db.prepare(query).bind(...args).all();
   return json({ok:true,reviews:rows.results||[]});
  }
  const reviewClose=/^\/v2\/admin\/reviews\/([0-9a-f-]{36})\/close$/i.exec(path);
  if(reviewClose&&request.method==='POST'){
   const b=await readBody(request);
   if(b.confirmation!=='I_HAVE_REVIEWED_PAYMENT'||
      !['operator_reviewed','external_refund_unverified','invalid_transfer'].includes(b.resolutionCode))
    return fail('manual_review_confirmation_required');
   const id=reviewClose[1].toLowerCase();
   const changed=await db.prepare(`UPDATE v2_payment_reviews
     SET resolved_at_ms=?,resolution_code=?,resolved_by='operator'
     WHERE id=? AND resolved_at_ms IS NULL`)
    .bind(Date.now(),b.resolutionCode,id).run();
   if(!changed.meta?.changes)return fail('review_not_open',409);
   await audit(db,'close_manual_review',null,{reviewId:id,resolutionCode:b.resolutionCode});
   return json({ok:true,reviewId:id,resolutionCode:b.resolutionCode,
    note:'This action never credits a wallet or submits a refund transaction.'});
  }
  if(/^\/v2\/admin\/projects\/[0-9a-f-]{36}\/(?:payment-config|fiat-method|crypto-method)$/i.test(path))
   return paymentProfileAdmin(request,env,url);
  if(/^\/v2\/admin\/projects\/[0-9a-f-]{36}\/(?:payments|summary|keys)$/i.test(path))
   return projectReport(request,env,url);
  if(path==='/v2/admin/projects'&&request.method==='POST')return createProject(db,await readBody(request),env);
  if(path==='/v2/admin/products'&&request.method==='POST')return createProduct(db,await readBody(request));
  if(path==='/v2/admin/rates'&&request.method==='POST')return setRate(db,await readBody(request));
  if(path==='/v2/admin/wallet-plan'&&request.method==='GET')
   return json({ok:true,coins:Object.values(ASSET_CATALOG),networks:walletSetupPlan(),
    neverRequestSecrets:true});
  if(path==='/v2/admin/wallet-import'&&request.method==='POST'){
   const requestBody=await readBody(request);
   if(requestBody.confirmation!=='CONFIRM_PUBLIC_ADDRESS_IMPORT')
    return fail('confirmation_required');
   const {confirmation,...manifest}=requestBody;
   try{
    const result=await importPublicWalletReceivers(db,manifest);
    return json({ok:true,...result},201);
   }catch(error){
    if(['invalid_public_wallet_manifest','invalid_public_receiver','public_addresses_only',
      'duplicate_public_receiver','receiver_already_registered'].includes(error.message))
     return fail(error.message,error.message==='receiver_already_registered'?409:400);
    return fail('receiver_import_failed',503);
   }
  }
  if(path==='/v2/admin/receivers'&&request.method==='POST')return addReceiver(db,await readBody(request));
  if(path==='/v2/admin/keys'&&request.method==='POST')return keys(db,await readBody(request));
  if(path==='/v2/admin/keys/revoke'&&request.method==='POST'){
   const b=await readBody(request),pid=requireProjectId(b.projectId);
   if(!isUuid(b.keyId)||b.confirmation!=='CONFIRM_KEY_REVOCATION')
    return fail('key_revoke_confirmation_required');
   const changed=await db.prepare(`UPDATE v2_api_keys SET status='revoked',revoked_at_ms=?
     WHERE id=? AND project_id=? AND status='active'
     AND (SELECT COUNT(*) FROM v2_api_keys
       WHERE project_id=? AND status='active')>1`)
    .bind(Date.now(),b.keyId,pid,pid).run();
   if(!changed.meta?.changes)return fail('cannot_revoke_last_active_key',409);
   await audit(db,'revoke_project_key',pid,{keyId:b.keyId});
   return json({ok:true,revokedKeyId:b.keyId});
  }
  if(path==='/v2/admin/projects/webhook'&&request.method==='POST'){
   const b=await readBody(request),pid=requireProjectId(b.projectId);
   if(b.confirmation!=='CONFIRM_WEBHOOK_UPDATE')return fail('confirmation_required');
   const webhook=safeWebhookUrl(b.webhookUrl);
   const allowed=String(env.MULTI_WEBHOOK_HOST_ALLOWLIST||'').split(',')
    .map(x=>x.trim().toLowerCase()).filter(Boolean);
   if(!allowed.includes(new URL(webhook).hostname))
    return fail('callback_host_not_approved',403);
   const changed=await db.prepare(`UPDATE v2_projects SET webhook_url=?,updated_at_ms=?
     WHERE id=?`).bind(webhook,Date.now(),pid).run();
   if(!changed.meta?.changes)return fail('project_not_found',404);
   await audit(db,'update_project_webhook',pid,{host:new URL(webhook).hostname});
   return json({ok:true,projectId:pid,webhookUrl:webhook});
  }
  if(path==='/v2/admin/products'&&request.method==='GET'){
   const pid=requireProjectId(url.searchParams.get('projectId'));
   const rows=await db.prepare(`SELECT sku,title,currency,amount_minor,status,updated_at_ms
     FROM v2_products WHERE project_id=? ORDER BY sku LIMIT 500`).bind(pid).all();
   return json({ok:true,projectId:pid,products:rows.results||[]});
  }
  if(path==='/v2/admin/receivers'&&request.method==='GET'){
   const rows=await db.prepare(`SELECT chain,address,enabled,source,assigned_intent
     FROM deposit_addresses ORDER BY chain,address LIMIT 500`).all();
   return json({ok:true,receivers:(rows.results||[]).map(x=>({
     chain:x.chain,address:x.address,enabled:x.enabled===1,assigned:x.assigned_intent!=null,
     source:x.source
   }))});
  }
  const activation=/^\/v2\/admin\/(projects|products|rates|receivers)\/(enable|disable)$/.exec(path);
  if(activation&&request.method==='POST')
   return toggle(db,activation[1],await readBody(request),activation[2]==='enable');
  if(path==='/v2/admin/projects'&&request.method==='GET'){
   const rows=await db.prepare('SELECT id,label,webhook_url,status,created_at_ms FROM v2_projects ORDER BY created_at_ms DESC LIMIT 100').all();
   return json({ok:true,projects:rows.results||[]});
  }
  if(path==='/v2/admin/rates'&&request.method==='GET'){
   const rows=await db.prepare('SELECT fiat,asset,numerator_atomic,denominator_minor,expires_at_ms,source,enabled FROM v2_exchange_rates ORDER BY fiat,asset').all();
   return json({ok:true,rates:rows.results||[]});
  }
  return fail('not_found',404);
 }catch(error){
  if(['invalid_project_id','invalid_webhook_url'].includes(error.message))
   return fail(error.message);
  return fail('operator_request_failed',503);
 }
}
