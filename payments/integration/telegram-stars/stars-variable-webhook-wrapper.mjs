// Strict webhook-only extension for the CURRENT, quote/history-only Worker.
// The original game/Telegram bot remains the fallback. No checkout is exposed.
// The variable Stars handler records delayed/duplicate XTR evidence even
// while ALL payment switches stay OFF. Never credits a game balance.
import {variableStarsWebhook} from './stars-variable-bridge.mjs';

const WEBHOOK='/tg';
function hasVariableStarsPayload(update){
 const query=update?.pre_checkout_query;
 const receipt=update?.message?.successful_payment;
 const p=query?.invoice_payload||receipt?.invoice_payload;
 return typeof p==='string'&&p.startsWith('v:')&&
  ((query?.currency==='XTR')||(receipt?.currency==='XTR'));
}
export function wrapCurrentStarsWebhook(original,{
 receiveVariableStars=variableStarsWebhook,
 fetchImpl=fetch
}={}){
 if(!original||typeof original.fetch!=='function'||
    typeof receiveVariableStars!=='function')
  throw Error('variable_stars_original_bot_missing');
 return {
  ...original,
  async fetch(request,env,ctx){
   const url=new URL(request.url);
   if(url.pathname!==WEBHOOK||request.method!=='POST'||
      typeof env?.WEBHOOK_SECRET!=='string'||env.WEBHOOK_SECRET.length<1||
      request.headers.get('X-Telegram-Bot-Api-Secret-Token')!==env.WEBHOOK_SECRET)
    return original.fetch(request,env,ctx);

   let update;
   try{update=await request.clone().json();}
   catch{return original.fetch(request,env,ctx);}
   if(!hasVariableStarsPayload(update))
    return original.fetch(request,env,ctx);

   // This is a targeted handler for a v: order. A failed D1 journal write
   // returns 503 to trigger Telegram redelivery, never an implicit success.
   try{
    const handled=await receiveVariableStars(update,env,fetchImpl);
    if(handled===true)
     return new Response('ok',{
      status:200,headers:{'cache-control':'no-store'}
     });
    throw Error('variable_stars_webhook_not_handled');
   }catch(e){
    console.error('RUST UP variable Stars webhook requires retry',
     String(e?.message||'error').slice(0,100));
    return new Response('payment event requires retry',{
     status:503,headers:{'cache-control':'no-store'}
    });
   }
  }
 };
}
