// Existing RUST UP Telegram Mini App: variable amount Stars API.
// User selects ANY amount within operator-defined bounds, not fixed products.
// Reuses the isolated variable Stars order and receipt implementation.
// Checkout is fail-closed until a verified, idempotent game credit bridge exists.
import {quoteVariableStars,createVariableStarsCheckout,handleVariableStarsUpdate}
 from './variable-stars.mjs';
import {verifiedTelegramInitData} from './telegram-initdata.mjs';
import {isPaymentEnabled} from './payment-controls.mjs';

const ROOT='/api/stars/variable/';
const ROUTES=new Set(['quote','checkout','history']);
const MAX_BODY=4096;
// Build-time safety lock: no production game-credit consumer exists in this
// repository. Payment flags alone must NEVER authorize an XTR charge.
const VERIFIED_GAME_CREDIT_CONSUMER_PRESENT=false;
function json(payload,status=200,origin=null){
 return new Response(JSON.stringify(payload),{
  status,headers:{'content-type':'application/json; charset=utf-8',
   'cache-control':'no-store','x-content-type-options':'nosniff',
   ...(origin?{'access-control-allow-origin':origin,'vary':'Origin'}:{})}
 });
}
function trustedOrigin(env){
 try{
  const uri=new URL(env.APP_URL);
  return uri.protocol==='https:'&&!uri.username&&!uri.password?uri.origin:null;
 }catch{return null;}
}
function paymentEnv(env,enableCheckout=false){
 return {...env,
  DB:env?.PAYMENTS_DB,
  TG_STARS_BOT_TOKEN:env?.BOT_TOKEN,
  STARS_PAYMENT_ENABLED:enableCheckout?'true':'false',
  STARS_VARIABLE_TOPUP_ENABLED:enableCheckout?'true':'false'
 };
}
async function mayAcceptVariable(env){
 // The current code records receipts but cannot deliver a balance credit.
 // An operator setting all environment/D1 switches to ON cannot fix that.
 if(!VERIFIED_GAME_CREDIT_CONSUMER_PRESENT)return false;
 // No paid invoice may be created before the existing game is protected and
 // the authenticated, idempotent credit consumer is explicitly wired.
 if(env?.STARS_VARIABLE_TOPUP_ENABLED!=='true'||
    env?.STARS_VARIABLE_CREDIT_LEDGER_READY!=='true'||
    env?.PAYMENT_WALLET_STRICT_MODE!=='true')
  return false;
 return isPaymentEnabled(env,'stars');
}
export async function variableStarsApi(request,env,fetchImpl=fetch){
 const url=new URL(request.url);
 if(!url.pathname.startsWith(ROOT))return null;
 const action=url.pathname.slice(ROOT.length);
 if(!ROUTES.has(action))return json({ok:false,error:'not_found'},404);
 const allowed=trustedOrigin(env);
 const origin=request.headers.get('origin');
 if(!allowed||origin!==allowed)
  return json({ok:false,error:'origin_rejected'},403);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{
  'access-control-allow-origin':allowed,'access-control-allow-methods':'POST, OPTIONS',
  'access-control-allow-headers':'content-type','access-control-max-age':'600','vary':'Origin'
 }});
 if(request.method!=='POST')return json({ok:false,error:'method'},405,allowed);
 if(request.headers.get('content-type')?.split(';')[0]!=='application/json')
  return json({ok:false,error:'content_type'},415,allowed);
 let body;
 try{
  const raw=await request.text();
  if(raw.length<1||raw.length>MAX_BODY)
   return json({ok:false,error:'body_size'},413,allowed);
  body=JSON.parse(raw);
 }catch{return json({ok:false,error:'invalid_json'},400,allowed);}
 let identity;
 try{
  const age=action==='checkout'?600:86400;
  identity=await verifiedTelegramInitData(body?.initData,env.BOT_TOKEN,Date.now(),age);
 }catch{return json({ok:false,error:'telegram_auth_required'},401,allowed);}
 if(!env?.PAYMENTS_DB)
  return json({ok:false,error:'payment_database_missing'},503,allowed);
 const enabled=await mayAcceptVariable(env);
 if(action==='quote'){
  try{
   const quote=quoteVariableStars(body?.amountMinor,env);
   return json({ok:true,checkoutEnabled:enabled,...quote},200,allowed);
  }catch(e){
   return json({ok:false,error:e?.message==='variable_stars_amount_out_of_bounds'
    ?'invalid_amount_or_range':'conversion_not_configured'},422,allowed);
  }
 }
 if(action==='checkout'){
  if(!enabled)return json({ok:false,error:'topup_checkout_disabled'},503,allowed);
  if(!Number.isSafeInteger(body?.amountMinor)||typeof body?.requestId!=='string')
   return json({ok:false,error:'invalid_checkout'},400,allowed);
  try{
   const invoice=await createVariableStarsCheckout(
    paymentEnv(env,true),{
     verifiedTelegramUserId:identity.userId,
     amountMinor:body.amountMinor,requestId:body.requestId,fetchImpl
    });
   return json({ok:true,...invoice},200,allowed);
  }catch(e){
   console.error('Variable Stars invoice unavailable',String(e?.message||'error').slice(0,65));
   return json({ok:false,error:'topup_unavailable'},503,allowed);
  }
 }
 if(action==='history'){
  try{
   const data=await env.PAYMENTS_DB.prepare(
    'SELECT id,requested_amount_minor,price_stars,status,created_at_ms,paid_at_ms '+
    'FROM rustup_stars_variable_orders WHERE telegram_user_id=? '+
    'ORDER BY created_at_ms DESC LIMIT 50'
   ).bind(identity.userId).all();
   return json({ok:true,orders:data?.results||[]},200,allowed);
  }catch{return json({ok:false,error:'history_unavailable'},503,allowed);}
 }
 return json({ok:false,error:'not_found'},404,allowed);
}

// Existing webhook wrapper must route variable payloads before fixed-item
// handlers. Even with gates OFF, previously received valid receipts must
// be persisted, so a temporary outage never loses the payment evidence.
export async function variableStarsWebhook(update,env,fetchImpl=fetch){
 const payload=update?.pre_checkout_query?.invoice_payload||
   update?.message?.successful_payment?.invoice_payload;
 if(typeof payload!=='string'||!payload.startsWith('v:'))return false;
 if(!env?.PAYMENTS_DB)throw Error('payment_database_missing');
 const enabled=await mayAcceptVariable(env);
 const outcome=await handleVariableStarsUpdate(
  update,paymentEnv(env,enabled),fetchImpl
 );
 if(!outcome.handled)throw Error('variable_stars_event_not_handled');
 // Incident must be durably recorded before we stop Telegram redelivery.
 if(outcome.type==='variable_receipt'&&!outcome.accepted&&
    outcome.incidentRecorded!==true)
  throw Error('variable_stars_receipt_requires_review');
 return true;
}
