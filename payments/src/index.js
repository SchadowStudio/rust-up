import {ASSETS, formatAtomic, validAddress} from './assets.js';
import {verifiedTelegramId} from './auth.js';
import {verifyChainPayment} from './chains.js';
import {validateReceivingAddress} from './address.js';
import {settleVerified} from './settlement.js';
import {operatorRoute} from './operator.js';
import {scanPendingPayments} from './monitor.js';
import {drainOutbox} from './outbox.js';
import {readiness} from './readiness.js';

// Isolated API: it never writes to the original game Worker or its balance.
const json=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const error=(name,status=400)=>json({ok:false,error:name},status);
async function bodyOf(req){
 const raw=await req.text();
 if(raw.length>4096)throw new Error('body_too_large');
 const b=JSON.parse(raw);
 if(!b||typeof b!=='object'||Array.isArray(b))throw new Error('invalid_body');
 return b;
}
const owned=(db,id,user)=>db.prepare('SELECT * FROM payment_intents WHERE id=? AND telegram_id=?').bind(id,user).first();
function publicOrder(row){
 return {id:row.id,asset:row.asset,chain:row.chain,address:row.receive_address,
  amount:formatAtomic(row.amount_atomic,ASSETS[row.asset].decimals),status:row.status,
  creditKopecks:row.credit_kopecks,expiresAt:row.expires_at_ms,
  transactionId:row.status==='verified'?row.tx_hash:null,creditedToGame:false};
}
async function createOrder(db,uid,b){
 if(!ASSETS[b.asset]||typeof b.packageId!=='string'||b.packageId.length>80)return error('invalid_quote');
 const now=Date.now(),chain=ASSETS[b.asset].chain;
 const count=await db.prepare('SELECT COUNT(*) AS n FROM payment_intents WHERE telegram_id=? AND created_at_ms>?')
  .bind(uid,now-3600000).first();
 if(count.n>=5)return error('too_many_orders',429);
 const quote=await db.prepare(`SELECT p.credit_kopecks,q.amount_atomic
  FROM payment_packages p JOIN payment_quotes q ON q.package_id=p.id
  WHERE p.id=? AND q.asset=? AND p.enabled=1 AND q.enabled=1`)
  .bind(b.packageId,b.asset).first();
 if(!quote||!/^[1-9][0-9]*$/.test(quote.amount_atomic))return error('quote_unavailable',404);
 const address=await db.prepare('SELECT address FROM deposit_addresses WHERE chain=? AND enabled=1 AND assigned_intent IS NULL ORDER BY address LIMIT 1')
  .bind(chain).first();
 if(!address)return error('no_unused_address',503);
 if(!await validateReceivingAddress(chain,address.address))return error('bad_receiver_configuration',503);
 const id=crypto.randomUUID(),expires=now+1800000;
 const [reserved,created]=await db.batch([
  db.prepare('UPDATE deposit_addresses SET assigned_intent=? WHERE chain=? AND address=? AND assigned_intent IS NULL')
   .bind(id,chain,address.address),
  db.prepare(`INSERT INTO payment_intents
   (id,telegram_id,package_id,asset,chain,receive_address,amount_atomic,credit_kopecks,created_at_ms,expires_at_ms)
   SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS
   (SELECT 1 FROM deposit_addresses WHERE chain=? AND address=? AND assigned_intent=?)`)
   .bind(id,uid,b.packageId,b.asset,chain,address.address,quote.amount_atomic,
    quote.credit_kopecks,now,expires,chain,address.address,id)
 ]);
 if(!reserved.meta?.changes||!created.meta?.changes)return error('address_claim_conflict',409);
 return json({ok:true,payment:publicOrder(await owned(db,id,uid))},201);
}
async function verifyOrder(db,row,b,env){
 if(row.status==='verified')return json({ok:true,payment:publicOrder(row)});
 if(!['awaiting_payment','expired'].includes(row.status))return error('not_claimable',409);
 if(typeof b.transactionId!=='string'||b.transactionId.length>80)return error('bad_transaction_id');
 const now=Date.now();
 const attempt=await db.prepare(`UPDATE payment_intents
  SET last_verify_ms=?,verify_attempts=verify_attempts+1
  WHERE id=? AND status IN ('awaiting_payment','expired')
  AND verify_attempts<20 AND last_verify_ms<?`)
  .bind(now,row.id,now-20000).run();
 if(!attempt.meta?.changes)return error('verification_rate_limited',429);
 const proof=await verifyChainPayment(row,b.transactionId,env);
 const outcome=await settleVerified(db,row,proof);
 if(outcome.status==='manual_review')return error('late_payment_under_review',409);
 if(outcome.status==='already_claimed')return error('already_claimed',409);
 const updated=await owned(db,row.id,row.telegram_id);
 return json({ok:true,payment:publicOrder(updated),
  confirmations:proof.confirmations,creditedToGame:false});
}
async function route(request,env,url,uid){
 const db=env.DB,path=url.pathname;
 if(path==='/v1/crypto/options'&&request.method==='GET'){
  const rows=await db.prepare(`SELECT p.id AS package_id,p.title,p.credit_kopecks,q.asset,q.amount_atomic
   FROM payment_packages p JOIN payment_quotes q ON q.package_id=p.id
   WHERE p.enabled=1 AND q.enabled=1 ORDER BY p.credit_kopecks,q.asset`).all();
  return json({ok:true,options:(rows.results||[]).map(x=>({
   packageId:x.package_id,title:x.title,creditKopecks:x.credit_kopecks,
   asset:x.asset,chain:ASSETS[x.asset].chain,
   amount:formatAtomic(x.amount_atomic,ASSETS[x.asset].decimals)}))});
 }
 if(path==='/v1/crypto/intents'&&request.method==='POST')
  return createOrder(db,uid,await bodyOf(request));
 const m=/^\/v1\/crypto\/intents\/([a-f0-9-]{36})(\/verify)?$/.exec(path);
 if(!m)return error('not_found',404);
 const row=await owned(db,m[1],uid);
 if(!row)return error('order_not_found',404);
 if(request.method==='GET'&&!m[2])return json({ok:true,payment:publicOrder(row)});
 if(request.method==='POST'&&m[2])return verifyOrder(db,row,await bodyOf(request),env);
 return error('method_not_allowed',405);
}
export default {
 async fetch(request,env){
  const url=new URL(request.url),origin=request.headers.get('origin');
  const isOperator=url.pathname.startsWith('/v1/operator/');
  const allowedOrigin=isOperator?env.OPERATOR_ORIGIN:env.ALLOWED_ORIGIN;
  if(origin&&origin!==allowedOrigin)return error('origin_denied',403);
  const cors=origin?{'access-control-allow-origin':origin,'vary':'origin',
   'access-control-allow-headers':'content-type,x-telegram-init-data,authorization',
   'access-control-allow-methods':'GET,POST,OPTIONS'}:{};
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  let response;
  try{
   if(url.pathname==='/health')response=json({ok:true,enabled:env.CRYPTO_PAYMENTS_ENABLED==='true'});
   else if(isOperator)response=await operatorRoute(request,env,url);
   else if(!env.DB||!env.TG_BOT_TOKEN||env.CRYPTO_PAYMENTS_ENABLED!=='true')
    response=error('payment_service_disabled',503);
   else{
    let uid;
    try{uid=await verifiedTelegramId(request.headers.get('x-telegram-init-data'),env.TG_BOT_TOKEN);}
    catch{response=error('unauthorized',401);}
    if(uid)response=await route(request,env,url,uid);
   }
  }catch(e){
   const safe=['invalid_transaction_id','transaction_not_found','insufficient_confirmations',
    'recipient_or_amount_mismatch','unconfirmed_or_failed','wrong_ethereum_chain',
    'invalid_body','body_too_large','transaction_mismatch'];
   response=error(safe.includes(e.message)?e.message:'verification_or_database_error',
    safe.includes(e.message)?422:503);
  }
  const headers=new Headers(response.headers);
  for(const [key,value] of Object.entries(cors))headers.set(key,value);
  return new Response(response.body,{status:response.status,headers});
 },
 async scheduled(_event,env,ctx){
  ctx.waitUntil(Promise.allSettled([
   scanPendingPayments(env),drainOutbox(env)
  ]).then(results=>{
   for(const [i,r] of results.entries()){
    const name=i?'Ledger outbox':'Blockchain scanner';
    if(r.status==='rejected')console.error(name+' failed:',String(r.reason));
    else if(r.value.errors?.length)console.error(name+' warnings:',r.value.errors);
    else console.log(name+' result:',JSON.stringify(r.value));
   }
  }));
 }
};
