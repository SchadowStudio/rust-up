// Additional Stars routes for the existing @rustuper_bot Worker. No wallet credits,
// random cases, upgrades, payouts or third-party crypto checkout are allowed here.
// DO NOT enable hard gates until migrations, real product fulfillment and release checks.
import {permittedProduct,invoiceBody,telegramApi,handleStarsUpdate} from './stars.mjs';
import {verifiedTelegramInitData} from './telegram-initdata.mjs';
import {isPaymentEnabled} from './payment-controls.mjs';
import {grantSupporterBadge,readSupporterBadge} from './supporter-badge.mjs';
import {publishedStarsTerms,starsTermsAccepted,recordStarsTermsAcceptance} from './stars-terms.mjs';

const SKU=/^[a-z][a-z0-9_-]{2,39}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY=6000,TTL=15*60*1000;
const data=(x,status=200,origin)=>new Response(JSON.stringify(x),{
 status,headers:{'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','x-content-type-options':'nosniff',
  ...(origin?{'access-control-allow-origin':origin,'vary':'Origin'}:{})}
});
function asPaymentsEnv(env,enabled){
 return {...env,DB:env.PAYMENTS_DB,TG_STARS_BOT_TOKEN:env.BOT_TOKEN,
  STARS_PAYMENT_ENABLED:enabled?'true':'false'};
}
function allowedOrigin(request,env){
 let allowed;
 try {allowed=new URL(env.APP_URL).origin;} catch{return null;}
 const origin=request.headers.get('origin');
 return origin===allowed&&origin.startsWith('https://')?allowed:null;
}
async function userIdFromBody(body,env,maxAgeSeconds=600){
 if(typeof body?.initData!=='string')throw Error('invalid_auth');
 // Only the read-only API may accept older signed Telegram sessions.
 const user=await verifiedTelegramInitData(body.initData,env.BOT_TOKEN,Date.now(),maxAgeSeconds);
 return user.userId;
}
async function available(env){
 // All three layers fail closed. A /pay stars on by itself never permits money.
 // No Stars charge without a viable support/refund operator path.
 const authorizedRefundOperator=typeof env.PAYMENT_ADMIN_IDS==='string'&&
  env.PAYMENT_ADMIN_IDS.split(',').some(id=>/^[1-9][0-9]{0,15}$/.test(id.trim()));
 const terms=publishedStarsTerms(env);
 if(!terms||!env?.PAYMENTS_DB)return false;
 try{
  await env.PAYMENTS_DB.prepare('SELECT 1 FROM rustup_stars_terms_acceptances LIMIT 1').first();
 }catch{return false;}
 return env.STARS_FIXED_PRODUCTS_ENABLED==='true'&&
  env.STARS_REFUNDS_ENABLED==='true'&&
  authorizedRefundOperator&&
  !!env.PAYMENTS_DB&&
  await isPaymentEnabled(env,'stars');
}
async function recordUnexpectedReceipt(db,msg,reason){
 const pay=msg?.successful_payment;
 const charge=pay?.telegram_payment_charge_id;
 const userId=msg?.from?.id;
 const amount=pay?.total_amount;
 const invoicePayload=pay?.invoice_payload;
 if(!db?.prepare||typeof charge!=='string'||charge.length<1||charge.length>256||
    !Number.isSafeInteger(userId)||userId<1||
    pay?.currency!=='XTR'||!Number.isSafeInteger(amount)||amount<1||
    typeof invoicePayload!=='string'||invoicePayload.length<1||
    invoicePayload.length>256||
    typeof reason!=='string'||reason.length<1||reason.length>100)
   throw Error('unverifiable_stars_receipt_requires_manual_investigation');
 const saved=await db.prepare(
  'INSERT OR IGNORE INTO rustup_stars_receipt_incidents '+
  '(telegram_charge_id,telegram_user_id,invoice_payload,price_stars,reason,occurred_at_ms) '+
  'VALUES(?,?,?,?,?,?)'
 ).bind(charge,userId,invoicePayload,amount,reason,Date.now()).run();
 if(saved?.meta?.changes===1)return;
 // A previous incident is only an idempotent replay when its evidence
 // matches byte-for-byte. Never silently discard conflicting charge data.
 const existing=await db.prepare(
  'SELECT telegram_charge_id,telegram_user_id,invoice_payload,price_stars,reason '+
  'FROM rustup_stars_receipt_incidents WHERE telegram_charge_id=?'
 ).bind(charge).first();
 if(!existing||existing.telegram_user_id!==userId||
    existing.invoice_payload!==invoicePayload||existing.price_stars!==amount||
    existing.reason!==reason)
   throw Error('stars_receipt_incident_conflict_requires_review');
}

export async function receiveExistingBotStarsUpdate(update,env,fetchImpl=fetch){
 const q=update?.pre_checkout_query;
 const msg=update?.message;
 const receipt=msg?.successful_payment;
 // Existing non-XTR handlers remain wholly untouched.
 if(!q&&!receipt)return false;
 if(q&&q.currency!=='XTR')return false;
 if(receipt&&receipt.currency!=='XTR')return false;

 const db=env?.PAYMENTS_DB;
 let enabled=false;
 try{enabled=await available(env);}
 catch{
  if(!q)throw Error('payment_db_unavailable_retry_receipt');
  // Never leave a precheckout unanswered because of a database read failure.
  enabled=false;
 }
 // Even with gates OFF, legitimate already-approved receipts MUST be stored.
 if(receipt&&!db)throw Error('payment_db_unavailable_retry_receipt');
 if(q&&!db){
  await telegramApi(asPaymentsEnv(env,false),'answerPreCheckoutQuery',{
   pre_checkout_query_id:q.id,ok:false,error_message:'Payments temporarily unavailable.'
  },fetchImpl);
  return true;
 }
 const guarded=asPaymentsEnv(env,enabled);
 if(q){
  // Never approve payment unless the deterministic delivery snapshot exists.
  // This protects users from being charged for an order with nothing to deliver.
  try{
   if(enabled&&UUID.test(String(q.invoice_payload))){
    const snapshot=await db.prepare(
     'SELECT 1 FROM rustup_stars_order_content WHERE order_id=?'
    ).bind(q.invoice_payload).first();
    if(!snapshot)throw Error('stars_missing_delivery_snapshot');
    const savedInvoice=await db.prepare(
     'SELECT 1 FROM rustup_stars_invoice_links WHERE order_id=?'
    ).bind(q.invoice_payload).first();
    if(!savedInvoice)throw Error('stars_missing_persisted_invoice');
    const terms=publishedStarsTerms(env);
    if(!terms||!await starsTermsAccepted(db,q.from?.id,terms))
      throw Error('stars_terms_acceptance_not_confirmed');
   }else if(enabled){
    throw Error('stars_invalid_order_payload');
   }
   await handleStarsUpdate(update,guarded,fetchImpl);
  }catch{
   await telegramApi(guarded,'answerPreCheckoutQuery',{
    pre_checkout_query_id:q.id,ok:false,error_message:'Checkout temporarily unavailable.'
   },fetchImpl);
  }
  return true;
 }
 // A receipt may be delayed until after the /pay emergency stop.
 let result;
 try {result=await handleStarsUpdate(update,guarded,fetchImpl);}
 catch(e){throw Error('payment_receipt_db_failure_retry');}
 if(!result?.accepted){
  await recordUnexpectedReceipt(db,msg,'unmatched_or_mismatched_receipt');
  return true;
 }
 // Payment and entitlement activation can be retried independently.
 // The checkout snapshot is created before the Telegram invoice.
 const updated=await db.prepare(
  'UPDATE rustup_stars_order_content SET unlocked_at_ms=COALESCE(unlocked_at_ms,?) '+
  'WHERE order_id=? AND EXISTS (SELECT 1 FROM rustup_stars_orders '+
  "WHERE id=? AND status='paid' AND telegram_user_id=?)"
 ).bind(Date.now(),String(receipt.invoice_payload),String(receipt.invoice_payload),msg.from.id).run();
 if(updated?.meta?.changes!==1){
  // A repeated callback might find an already-unlocked good. Confirm
  // both the paid receipt and entitlement before acknowledging it.
  const existing=await db.prepare(
    'SELECT c.unlocked_at_ms,o.telegram_charge_id FROM rustup_stars_order_content c '+
    'JOIN rustup_stars_orders o ON o.id=c.order_id '+
    "WHERE c.order_id=? AND o.telegram_user_id=? AND o.status='paid'"
  ).bind(String(receipt.invoice_payload),msg.from.id).first();
  if(existing?.unlocked_at_ms&&
     existing.telegram_charge_id===receipt.telegram_payment_charge_id){
    await grantSupporterBadge(db,{
      orderId:String(receipt.invoice_payload),userId:msg.from.id,
      chargeId:receipt.telegram_payment_charge_id
    });
    return true;
  }
  await recordUnexpectedReceipt(db,msg,'paid_but_content_not_unlocked');
  throw Error('payment_content_unlock_failed_retry');
 }
 await grantSupporterBadge(db,{
  orderId:String(receipt.invoice_payload),userId:msg.from.id,
  chargeId:receipt.telegram_payment_charge_id
 });
 return true;
}
export async function createFixedStarsOrder(env,userId,sku,fetchImpl=fetch){
 const db=env.PAYMENTS_DB;
 if(!db||!await available(env))throw Error('stars_checkout_disabled');
 if(!Number.isSafeInteger(userId)||userId<=0||!SKU.test(sku||''))
  throw Error('bad_checkout_request');
 const terms=publishedStarsTerms(env);
 if(!terms||!await starsTermsAccepted(db,userId,terms))
  throw Error('stars_terms_acceptance_required');
 const product=await db.prepare(
  'SELECT p.sku,p.title,p.description,p.kind,p.price_stars,p.enabled,c.delivery_text '+
  'FROM rustup_stars_products p JOIN rustup_stars_fixed_content c ON c.sku=p.sku '+
  'WHERE p.sku=?'
 ).bind(sku).first();
 if(!permittedProduct(product)||typeof product.delivery_text!=='string'||
    product.delivery_text.length<1||product.delivery_text.length>2000)
   throw Error('product_not_fulfillable');
 // Prevent a second purchase of the same perpetual, non-transferable good.
 const owned=await db.prepare(
  'SELECT 1 FROM rustup_stars_orders WHERE telegram_user_id=? AND sku=? '+
  "AND status='paid' LIMIT 1"
 ).bind(userId,sku).first();
 if(owned)throw Error('product_already_owned');
 // Never issue another invoice after Telegram already approved an earlier
 // checkout; a delayed Telegram receipt must first be reconciled.
 const awaitingReceipt=await db.prepare(
  'SELECT 1 FROM rustup_stars_orders WHERE telegram_user_id=? AND sku=? '+
  "AND status='checkout_approved' LIMIT 1"
 ).bind(userId,sku).first();
 if(awaitingReceipt)throw Error('prior_stars_payment_requires_reconciliation');
 const now=Date.now();
 const active=await db.prepare(
  'SELECT o.id,o.price_stars,o.expires_at_ms,o.status,l.invoice_url '+
  'FROM rustup_stars_purchase_locks k '+
  'JOIN rustup_stars_orders o ON o.id=k.order_id '+
  'LEFT JOIN rustup_stars_invoice_links l ON l.order_id=o.id '+
  'WHERE k.telegram_user_id=? AND k.sku=? AND k.expires_at_ms>?'
 ).bind(userId,sku,now).first();
 if(active){
  if(active.status==='pending'&&typeof active.invoice_url==='string'&&
     active.expires_at_ms>now&&active.price_stars===product.price_stars)
    return {orderId:active.id,invoiceUrl:active.invoice_url,
      stars:active.price_stars,expiresAtMs:active.expires_at_ms,
      creditToGame:false,replayed:true};
  throw Error('stars_invoice_already_active');
 }
 const id=crypto.randomUUID();
 await db.prepare(
  'INSERT INTO rustup_stars_orders '+
  '(id,telegram_user_id,sku,price_stars,status,created_at_ms,expires_at_ms) '+
  "VALUES (?,?,?,?,'pending',?,?)"
 ).bind(id,userId,sku,product.price_stars,now,now+TTL).run();
 // Atomic upsert prevents concurrent button presses from issuing multiple invoices.
 // The losing request never reaches Telegram's createInvoiceLink.
 const lock=await db.prepare(
  'INSERT INTO rustup_stars_purchase_locks '+
  '(telegram_user_id,sku,order_id,expires_at_ms) VALUES(?,?,?,?) '+
  'ON CONFLICT(telegram_user_id,sku) DO UPDATE SET '+
  'order_id=excluded.order_id,expires_at_ms=excluded.expires_at_ms '+
  'WHERE rustup_stars_purchase_locks.expires_at_ms<=?'
 ).bind(userId,sku,id,now+TTL,now).run();
 if(lock?.meta?.changes!==1)throw Error('stars_invoice_already_active');
 // Save and verify the exact content before issuing a payable Telegram invoice.
 await db.prepare(
  'INSERT INTO rustup_stars_order_content(order_id,delivery_text) VALUES (?,?)'
 ).bind(id,product.delivery_text).run();
 // No charge occurs before Telegram approves the actual precheckout query.
 const invoice=await telegramApi(asPaymentsEnv(env,true),
  'createInvoiceLink',invoiceBody(product,id),fetchImpl);
 if(typeof invoice!=='string'||!/^https:\/\/\S+$/.test(invoice)||invoice.length>1024)
  throw Error('invalid_stars_invoice_link');
 const saved=await db.prepare(
  'INSERT OR IGNORE INTO rustup_stars_invoice_links(order_id,invoice_url,created_at_ms) '+
  'VALUES(?,?,?)'
 ).bind(id,invoice,now).run();
 if(saved?.meta?.changes!==1)
  throw Error('stars_invoice_link_not_persisted');
 return {orderId:id,invoiceUrl:invoice,stars:product.price_stars,
  expiresAtMs:now+TTL,creditToGame:false,replayed:false};
}
export async function existingBotStarsApi(request,env,fetchImpl=fetch){
 const url=new URL(request.url),path=url.pathname;
 if(!['/api/stars/catalog','/api/stars/checkout','/api/stars/purchases',
      '/api/stars/supporter-badge','/api/stars/health',
      '/api/stars/terms','/api/stars/terms/accept'].includes(path))
  return null;
 if(path==='/api/stars/health'&&request.method==='GET')
  return data({ok:true,service:'rustup-fixed-stars',
   productionEnabled:env?.PAYMENT_PRODUCTION_ENABLED==='true',
   gameBalanceCredit:false});
 const origin=allowedOrigin(request,env);
 if(!origin)return data({ok:false,error:'origin_rejected'},403);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{
  'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS',
  'access-control-allow-headers':'content-type','access-control-max-age':'600',
  'vary':'Origin','cache-control':'no-store'
 }});
 if(request.method!=='POST')return data({ok:false,error:'method'},405,origin);
 if(request.headers.get('content-type')?.split(';')[0]!=='application/json')
  return data({ok:false,error:'content_type'},415,origin);
 const raw=await request.text();
 if(raw.length>MAX_BODY)return data({ok:false,error:'too_large'},413,origin);
 let body;
 try{body=JSON.parse(raw);}catch{return data({ok:false,error:'invalid_json'},400,origin);}
 let userId;
 // Payment checkout keeps the strict 10-minute Telegram authentication TTL.
 const readOnly=path==='/api/stars/catalog'||path==='/api/stars/purchases'||
   path==='/api/stars/supporter-badge'||path==='/api/stars/terms';
 try{userId=await userIdFromBody(body,env,readOnly?86400:600);}
 catch{return data({ok:false,error:'telegram_auth_required'},401,origin);}
 if(!env.PAYMENTS_DB)return data({ok:false,error:'payment_database_missing'},503,origin);
 const db=env.PAYMENTS_DB;
 try{
  if(path==='/api/stars/terms'){
   const terms=publishedStarsTerms(env);
   return data({ok:true,terms,
    accepted:terms?await starsTermsAccepted(db,userId,terms):false},200,origin);
  }
  if(path==='/api/stars/terms/accept'){
   const terms=publishedStarsTerms(env);
   if(!terms)return data({ok:false,error:'stars_terms_unconfigured'},503,origin);
   if(body?.accepted!==true||body?.version!==terms.version)
    return data({ok:false,error:'stars_terms_explicit_acceptance_required'},409,origin);
   const receipt=await recordStarsTermsAcceptance(db,userId,terms);
   return data({ok:true,...receipt},200,origin);
  }
  if(path==='/api/stars/catalog'){
   const catalog=await db.prepare(
    'SELECT p.sku,p.title,p.description,p.price_stars FROM rustup_stars_products p '+
    'JOIN rustup_stars_fixed_content c ON c.sku=p.sku '+
    "WHERE p.enabled=1 AND p.kind='fixed_nontransferable' ORDER BY p.sku LIMIT 50"
   ).all();
   return data({ok:true,checkoutEnabled:await available(env),
    products:catalog.results||[]},200,origin);
  }
  if(path==='/api/stars/supporter-badge'){
   const badge=await readSupporterBadge(db,userId);
   return data({ok:true,badge},200,origin);
  }
  if(path==='/api/stars/purchases'){
   const result=await db.prepare(
    'SELECT o.id,o.sku,o.price_stars,o.paid_at_ms,c.delivery_text '+
    'FROM rustup_stars_orders o JOIN rustup_stars_order_content c ON c.order_id=o.id '+
    'WHERE o.telegram_user_id=? AND o.status=? AND c.unlocked_at_ms IS NOT NULL '+
    'ORDER BY o.paid_at_ms DESC LIMIT 100'
   ).bind(userId,'paid').all();
   return data({ok:true,purchases:result.results||[],gameBalanceCredit:false},200,origin);
  }
  if(path==='/api/stars/checkout'){
   if(typeof body?.sku!=='string'||!SKU.test(body.sku))
    return data({ok:false,error:'invalid_product'},400,origin);
   if(!await available(env))
    return data({ok:false,error:'stars_checkout_disabled'},503,origin);
   const purchase=await createFixedStarsOrder(env,userId,body.sku,fetchImpl);
   return data({ok:true,...purchase},200,origin);
  }
  return data({ok:false,error:'not_found'},404,origin);
 }catch(e){
  console.error('Stars API failed',e?.message?.replace(/[\r\n]/g,'').slice(0,100));
  return data({ok:false,error:'payment_temporarily_unavailable'},503,origin);
 }
}
// Required by Telegram for payment disputes. Existing support bot remains in place.
export async function existingBotPaySupport(update,env,telegramCall){
 const msg=update?.message;
 if(msg?.chat?.type!=='private'||msg.chat.id!==msg.from?.id||
   typeof msg.text!=='string'||!/^\/paysupport(?:@\w+)?(?:\s|$)/i.test(msg.text.trim()))
   return false;
 await telegramCall(env,'sendMessage',{
  chat_id:msg.chat.id,
  text:'RUST UP — помощь с оплатой Stars.\nНапишите в @rustuperhelp_bot и укажите дату, товар и номер заказа из чека Telegram. Не присылайте коды или пароли.'
 });
 return true;
}
