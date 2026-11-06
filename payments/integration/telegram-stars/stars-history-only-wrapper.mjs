// Read-only Stars deposit history and operator-price quote for original compiled RUST UP Worker.
// No invoices, conversion, payment acceptance, webhook interception or balance writes.
// Preserve all original handlers (including scheduled) and named DO exports.
import {verifiedTelegramInitData} from './telegram-initdata.mjs';
import {readStarsDepositHistory} from './deposit-history-readonly.mjs';
import {quoteOwnerStarsReadOnly} from './stars-owner-price-preview.mjs';

const PATH='/api/stars/variable/history';
const QUOTE='/api/stars/variable/quote';
const DENY='/api/stars/variable/';
const MAX_BODY=4096;

function allowedOrigin(env) {
 try {
  const url=new URL(env?.APP_URL);
  if(url.protocol!=='https:'||url.username||url.password||url.search)
   return null;
  return url.origin;
 }catch{return null;}
}
function json(body,status=200,origin=null){
 return new Response(JSON.stringify(body),{
  status,headers:{
   'content-type':'application/json; charset=utf-8',
   'cache-control':'no-store',
   'x-content-type-options':'nosniff',
   ...(origin?{'access-control-allow-origin':origin,'vary':'Origin'}:{})
  }
 });
}

export function wrapHistoryOnlyWorker(original,{
 verify=verifiedTelegramInitData,
 history=readStarsDepositHistory
}={}){
 if(!original||typeof original.fetch!=='function'||
    typeof verify!=='function'||typeof history!=='function')
  throw Error('history_only_original_worker_or_verifier_missing');
 return {
  ...original,
  async fetch(request,env,ctx){
   const path=new URL(request.url).pathname;
   if(path!==PATH&&path!==QUOTE){
    if(path.startsWith(DENY))
     return json({ok:false,error:'not_found'},404);
    // Includes existing Telegram webhook, game, cron-related HTTP and admin.
    return original.fetch(request,env,ctx);
   }
   const permitted=allowedOrigin(env);
   const origin=request.headers.get('origin');
   if(!permitted||origin!==permitted)
    return json({ok:false,error:'origin_rejected'},403);
   if(request.method==='OPTIONS')
    return new Response(null,{status:204,headers:{
     'cache-control':'no-store',
     'access-control-allow-origin':permitted,
     'access-control-allow-methods':'POST, OPTIONS',
     'access-control-allow-headers':'content-type',
     'access-control-max-age':'600',
     'vary':'Origin'
    }});
   if(request.method!=='POST')
    return json({ok:false,error:'method_not_allowed'},405,permitted);
   if(request.headers.get('content-type')?.split(';')[0]!=='application/json')
    return json({ok:false,error:'content_type'},415,permitted);
   let body;
   try {
    const raw=await request.text();
    if(raw.length<1||raw.length>MAX_BODY)
     return json({ok:false,error:'body_size'},413,permitted);
    body=JSON.parse(raw);
   }catch {
    return json({ok:false,error:'invalid_json'},400,permitted);
   }
   let identity;
   try {
    identity=await verify(body?.initData,env?.BOT_TOKEN,Date.now(),86400);
   }catch (error) {
    // Diagnose only a fixed, non-sensitive reason category. Never log initData,
    // user IDs, hashes, token material or the incoming request body.
    const reason=error?.message==='expired_telegram_auth'?'expired':
      error?.message==='invalid_telegram_user'?'user':
      error?.message==='invalid_telegram_auth'?'signature_or_format':'other';
    console.warn('rustup_stars_auth_denied',path===QUOTE?'quote':'history',reason);
    return json({ok:false,error:'telegram_auth_required'},401,permitted);
   }
   if(path===QUOTE){
    try{
     return json({ok:true,...quoteOwnerStarsReadOnly(body?.amountMinor)},200,permitted);
    }catch{
     return json({ok:false,error:'invalid_amount_or_range'},422,permitted);
    }
   }
   if(!env?.DB?.prepare||!env?.PAYMENTS_DB?.prepare)
    return json({ok:false,error:'deposit_history_unavailable'},503,permitted);
   try {
    const value=await history(env,identity.userId);
    if(!Array.isArray(value?.orders)||value?.statusComplete!==true)
     throw Error('incomplete_history');
    return json({ok:true,...value},200,permitted);
   }catch {
    return json({ok:false,error:'deposit_history_unavailable'},503,permitted);
   }
  }
 };
}
