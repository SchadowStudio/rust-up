// V2 project-to-project gateway: no Telegram IDs, emails, IPs or wallet keys.
// Merchant backend calls this API with project-scoped credentials.
import {ASSETS} from '../assets.js';
import {validateReceivingAddress} from '../address.js';
import {verifyChainPayment} from '../chains.js';
import {quoteFromRate,allowedFiat} from './fiat.js';
import {digestHex,authenticateProject} from './keys.js';
import {isUuid,requireIdempotency,requireOrderRef,compactError} from './identity.js';
import {settleV2,expireV2,reviewUnderpayment} from './settlement.js';
import {deliverV2,notifyDeliveryQueue} from './delivery.js';
import {scanMultiPayments} from './monitor.js';
import {consumePaymentEvents} from './candidate.js';
import {multiAdmin} from './admin.js';
import {readinessV2} from './readiness.js';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{
 'content-type':'application/json; charset=utf-8','cache-control':'no-store',
 'x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
const fail=(message,status=400)=>json({ok:false,error:message},status);
const cleanSku=s=>typeof s==='string'&&/^[a-z][a-z0-9_-]{2,39}$/.test(s);
const isHash=s=>/^(0x)?[0-9a-f]{64}$/i.test(String(s||''));
async function body(req){
 if(req.headers.get('content-type')?.split(';')[0]!=='application/json')
  throw Error('invalid_content_type');
 const raw=await req.text();
 if(raw.length>3072)throw Error('payload_too_large');
 const obj=JSON.parse(raw);
 if(!obj||Array.isArray(obj)||typeof obj!=='object')throw Error('invalid_body');
 return obj;
}
export function checkoutReady(env){return readinessV2(env).ready;}
function responseInvoice(row,delivered=false){
 const conf=ASSETS[row.asset];
 return {invoiceId:row.id,projectOrderRef:row.project_order_ref,
  status:row.status,fiat:row.fiat,amountMinor:row.amount_minor,
  asset:row.asset,chain:row.chain,receiveAddress:row.receive_address,
  amountAtomic:row.amount_atomic,cryptoDecimals:conf.decimals,
  createdAt:row.created_at_ms,expiresAt:row.expires_at_ms,
  txHash:row.status==='verified'?row.tx_hash:null,
  confirmedOnChain:row.status==='verified',
  deliveredToProject:!!delivered};
}
async function getInvoice(db,projectId,id){
 if(!isUuid(id))return null;
 return db.prepare(`SELECT i.*,o.delivered_at_ms AS delivered
   FROM v2_invoices i LEFT JOIN v2_delivery_outbox o ON o.invoice_id=i.id
   WHERE i.project_id=? AND i.id=?`).bind(projectId,id).first();
}
async function createInvoice(db,project,b,req,env,{deposit=false}={},now=Date.now()){
 const orderRef=requireOrderRef(b.projectOrderRef),key=requireIdempotency(req.headers.get('idempotency-key'));
 if(!ASSETS[b.asset]||(!deposit&&!cleanSku(b.sku)))
  return fail('invalid_product_or_asset');
 // Only the project backend (authenticated by its API key) may set a deposit's
 // fiat amount; the checkout browser never has access to project API credentials.
 const minMinor=Number(env.MULTI_DEPOSIT_MIN_MINOR||100);
 const maxMinor=Number(env.MULTI_DEPOSIT_MAX_MINOR||100000000);
 if(deposit&&(!allowedFiat(b.currency)||!Number.isSafeInteger(b.amountMinor)||
    b.amountMinor<minMinor||b.amountMinor>maxMinor))
  return fail('invalid_deposit_amount',400);
 const invoiceSku=deposit?'__crypto_deposit__':b.sku;
 const requestHash=await digestHex(JSON.stringify({
  kind:deposit?'deposit':'product',sku:invoiceSku,asset:b.asset,ref:orderRef,
  ...(deposit?{currency:b.currency,amountMinor:b.amountMinor}:{})
 }));
 const existing=await db.prepare(`SELECT * FROM v2_invoices
  WHERE project_id=? AND idempotency_key=?`).bind(project.id,key).first();
 if(existing){
  if(existing.request_hash!==requestHash)return fail('idempotency_conflict',409);
  return json({ok:true,replayed:true,invoice:responseInvoice(existing)});
 }
 // Coarse minute bucket is enforced atomically in the SAME D1 transaction as
 // the address reservation and invoice creation; no check-then-write race.
 const quota=Math.max(1,Math.min(10000,Number(env.MULTI_MAX_INVOICES_PER_MINUTE)||1000));
 const bucketMinute=Math.floor(now/60000)*60000;
 const product=deposit?{currency:b.currency,amount_minor:b.amountMinor,title:'Crypto deposit'}:
  await db.prepare(`SELECT currency,amount_minor,title FROM v2_products
   WHERE project_id=? AND sku=? AND status='active'`).bind(project.id,b.sku).first();
 if(!product)return fail('product_unavailable',404);
 const rate=await db.prepare(`SELECT fiat,asset,numerator_atomic,denominator_minor,
  valid_from_ms,expires_at_ms,enabled FROM v2_exchange_rates
  WHERE fiat=? AND asset=?`).bind(product.currency,b.asset).first();
 if(!rate)return fail('rate_unavailable',503);
 const quoted=quoteFromRate(product,rate,b.asset,now);
 const pool=await db.prepare(`SELECT address FROM deposit_addresses
   WHERE chain=? AND enabled=1 AND assigned_intent IS NULL ORDER BY added_at_ms LIMIT 1`)
  .bind(quoted.chain).first();
 if(!pool)return fail('no_unused_address',503);
 if(!await validateReceivingAddress(quoted.chain,pool.address))
  return fail('invalid_receiver_configuration',503);
 const id=crypto.randomUUID();
 const changes=[
  db.prepare(`INSERT INTO v2_invoice_quota
   (project_id,bucket_minute_ms,invoice_count,last_invoice_id)
   VALUES(?,?,1,?) ON CONFLICT(project_id,bucket_minute_ms)
   DO UPDATE SET invoice_count=invoice_count+1,last_invoice_id=excluded.last_invoice_id
   WHERE invoice_count<?`)
   .bind(project.id,bucketMinute,id,quota),
  db.prepare(`UPDATE deposit_addresses SET assigned_intent=?
   WHERE chain=? AND address=? AND enabled=1 AND assigned_intent IS NULL
   AND EXISTS(SELECT 1 FROM v2_invoice_quota
     WHERE project_id=? AND bucket_minute_ms=? AND last_invoice_id=?)`)
   .bind(id,quoted.chain,pool.address,project.id,bucketMinute,id),
  db.prepare(`INSERT INTO v2_invoices
   (id,project_id,project_order_ref,idempotency_key,request_hash,sku,
    fiat,amount_minor,asset,chain,receive_address,amount_atomic,
    rate_numerator,rate_denominator,created_at_ms,expires_at_ms)
   SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
   WHERE EXISTS(SELECT 1 FROM deposit_addresses
     WHERE chain=? AND address=? AND assigned_intent=?)
     AND EXISTS(SELECT 1 FROM v2_invoice_quota
     WHERE project_id=? AND bucket_minute_ms=? AND last_invoice_id=?)`)
  .bind(id,project.id,orderRef,key,requestHash,invoiceSku,product.currency,
   product.amount_minor,b.asset,quoted.chain,pool.address,quoted.amountAtomic,
   quoted.rateNumerator,quoted.rateDenominator,now,quoted.expiry,
   quoted.chain,pool.address,id,project.id,bucketMinute,id)
 ];
 try{
  const [debited,reserved,insert]=await db.batch(changes);
  if(!debited.meta?.changes)return fail('project_capacity_exceeded',429);
  if(!reserved.meta?.changes||!insert.meta?.changes)return fail('address_claim_conflict',409);
 }catch{
  // Concurrent retries are idempotent by project + key.
  const retry=await db.prepare(`SELECT * FROM v2_invoices WHERE project_id=? AND idempotency_key=?`)
   .bind(project.id,key).first();
  if(retry&&retry.request_hash===requestHash)
   return json({ok:true,replayed:true,invoice:responseInvoice(retry)});
  return fail('invoice_creation_conflict',409);
 }
 const invoice=await getInvoice(db,project.id,id);
 return json({ok:true,invoice:responseInvoice(invoice)},201);
}
async function verifyInvoice(db,project,invoice,b,env){
 if(invoice.status==='verified')
  return json({ok:true,invoice:responseInvoice(invoice,invoice.delivered!=null)});
 if(!['awaiting_payment','expired'].includes(invoice.status))
  return fail('invoice_not_claimable',409);
 if(!isHash(b.transactionHash))return fail('invalid_transaction_id');
 let proof;
 try{proof=await verifyChainPayment(invoice,b.transactionHash,env);}
 catch(error){
  if(error.message==='recipient_or_amount_mismatch'||
     error.message==='underpaid_or_wrong_recipient'){
   const partial=await reviewUnderpayment(db,invoice,b.transactionHash,env);
   if(partial.status==='manual_review')
    return fail('payment_requires_manual_review',409);
  }
  throw error;
 }
 const result=await settleV2(db,invoice,proof);
 await notifyDeliveryQueue(env,result);
 if(result.status==='manual_review')return fail('payment_requires_manual_review',409);
 const latest=await getInvoice(db,project.id,invoice.id);
 return json({ok:true,invoice:responseInvoice(latest,latest.delivered!=null)});
}
async function listEvents(db,projectId,url){
 const after=Number(url.searchParams.get('after')||0);
 const afterEventId=url.searchParams.get('afterEventId')||'';
 const limit=Number(url.searchParams.get('limit')||50);
 if(!Number.isSafeInteger(after)||after<0||
    (afterEventId!==''&&!/^v2:[0-9a-f-]{36}$/i.test(afterEventId))||
    !Number.isSafeInteger(limit)||limit<1||limit>100)return fail('invalid_cursor');
 const rows=await db.prepare(`SELECT event_id,event_body,created_at_ms,delivered_at_ms
  FROM v2_delivery_outbox
  WHERE project_id=? AND
   (created_at_ms>? OR (created_at_ms=? AND event_id>?))
  ORDER BY created_at_ms,event_id LIMIT ?`)
  .bind(projectId,after,after,afterEventId,limit).all();
 const items=(rows.results||[]).map(x=>({
  eventId:x.event_id,body:JSON.parse(x.event_body),
  delivered:x.delivered_at_ms!=null,createdAt:x.created_at_ms
 }));
 const last=items.at(-1);
 return json({ok:true,events:items,nextAfter:last?.createdAt??after,
  nextAfterEventId:last?.eventId??afterEventId});
}
async function projectRoute(req,env,url){
 if(!checkoutReady(env))return fail('checkout_disabled',503);
 let project;
 try{project=await authenticateProject(env.DB,req)}
 catch{return fail('unauthorized_project',401);}
 if(url.pathname==='/v2/me'&&req.method==='GET')
  return json({ok:true,projectId:project.id});
 if(url.pathname==='/v2/invoices'&&req.method==='POST')
  return createInvoice(env.DB,project,await body(req),req,env);
 if(url.pathname==='/v2/deposits'&&req.method==='POST')
  return createInvoice(env.DB,project,await body(req),req,env,{deposit:true});
 if(url.pathname==='/v2/events'&&req.method==='GET')
  return listEvents(env.DB,project.id,url);
 const found=/^\/v2\/invoices\/([a-zA-Z0-9-]+)(\/verify)?$/.exec(url.pathname);
 if(!found)return fail('not_found',404);
 const invoice=await getInvoice(env.DB,project.id,found[1]);
 if(!invoice)return fail('invoice_not_found',404);
 if(req.method==='GET'&&!found[2])
  return json({ok:true,invoice:responseInvoice(invoice,invoice.delivered!=null)});
 if(req.method==='POST'&&found[2])
  return verifyInvoice(env.DB,project,invoice,await body(req),env);
 return fail('method_not_allowed',405);
}
export async function handleMulti(req,env){
 const url=new URL(req.url);
 const origin=req.headers.get('origin');
 const operatorPath=url.pathname.startsWith('/v2/admin/');
 const allowed=operatorPath&&origin===env.MULTI_ADMIN_ORIGIN &&
  /^https:\/\//.test(String(origin||''));
 if(origin&&!allowed)return fail('server_to_server_only',403);
 const cors=allowed?{
  'access-control-allow-origin':origin,'vary':'Origin',
  'access-control-allow-methods':'GET,POST,OPTIONS',
  'access-control-allow-headers':'authorization,content-type',
  'access-control-max-age':'600'}:{};
 if(req.method==='OPTIONS')
  return allowed?new Response(null,{status:204,headers:cors}):fail('method_not_allowed',405);
 let answer;
 try{
  if(url.pathname==='/health')
   answer=json({ok:true,service:'multi-project-payments',checkout:checkoutReady(env)});
  else if(operatorPath)answer=await multiAdmin(req,env,url);
  else if(url.pathname.startsWith('/v2/'))answer=await projectRoute(req,env,url);
  else answer=fail('not_found',404);
 }catch(e){
  answer=fail(compactError(e),
   ['invalid_opaque_order_reference','invalid_idempotency_key'].includes(e?.message)?400:503);
 }
 if(!allowed)return answer;
 const headers=new Headers(answer.headers);
 for(const [k,v] of Object.entries(cors))headers.set(k,v);
 return new Response(answer.body,{status:answer.status,headers});
}
export default {
 fetch:handleMulti,
 async scheduled(_event,env,ctx){
  ctx.waitUntil(Promise.allSettled([
   expireV2(env.DB),deliverV2(env),scanMultiPayments(env)
  ]).then(results=>{
   for(const r of results)if(r.status==='rejected')console.error('multi-payments background job failed');
  }));
 },
 async queue(batch,env){
  await consumePaymentEvents(batch,env);
 }
};
