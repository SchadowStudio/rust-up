// Live extension for Stars quote, checkout, and webhook on the current Worker.
// The original game/Telegram bot remains the fallback for unrelated routes.
// The variable Stars handler records delayed/duplicate XTR evidence even
// even while payment switches are OFF. Game credit is independently gated.
import {variableStarsWebhook,variableStarsApi} from './stars-variable-bridge.mjs';
import {isStarsSupportCommand,handleStarsSupportCommand} from './stars-payment-support.mjs';
import {freezeVerifiedStarsGameQuote,calculateRubCoinOneToOne} from '../account-credit-ledger/freeze-verified-stars-game-quote.mjs';
import {runVariableStarsDeliveryQueue,settlementWorkerAllowed} from './stars-delivery-queue.mjs';
import {reconcileRecordedStarsRefundBatch} from '../account-credit-ledger/verified-stars-game-refund.mjs';

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
 settlePaidStars=runVariableStarsDeliveryQueue,
 reconcileRefundedStars=reconcileRecordedStarsRefundBatch,
 handleCheckout=variableStarsApi,
 handlePaymentSupport=handleStarsSupportCommand,
 calculateEntitlement=calculateRubCoinOneToOne,
 freezeQuote=freezeVerifiedStarsGameQuote,
 fetchImpl=fetch
}={}){
 if(!original||typeof original.fetch!=='function'||
    typeof receiveVariableStars!=='function'||
    typeof settlePaidStars!=='function'||
    typeof reconcileRefundedStars!=='function'||
    typeof handleCheckout!=='function'||typeof freezeQuote!=='function')
  throw Error('variable_stars_original_bot_missing');
 return {
  ...original,
  async scheduled(controller,env,ctx){
   // Independent jobs must not suppress one another: a failure in the
   // original game cron or refund reconciliation must never starve paid
   // orders waiting for verified, exactly-once balance delivery.
   const failures=[];
   if(typeof original.scheduled==='function'){
    try {await original.scheduled.call(original,controller,env,ctx);}
    catch {failures.push('original_game_cron_requires_retry');}
   }
   // Reversal and delivery are independently guarded, and are attempted
   // separately. A failure is still surfaced after the other job runs.
   if(env?.PAYMENT_PRODUCTION_ENABLED==='true'&&
      env?.STARS_GAME_CREDIT_REFUND_RECONCILIATION_ENABLED==='true'&&
      env?.PAYMENT_WALLET_STRICT_MODE==='true'){
    try{
     const summary=await reconcileRefundedStars(env,{fetchImpl});
     if(summary?.manualReview>0)
      console.error('RUST UP Stars refund reconciliation needs operator review',
       summary.manualReview);
    }catch{
     failures.push('stars_refund_reconciliation_scheduler_requires_review');
    }
   }
   if(settlementWorkerAllowed(env)){
    try {await settlePaidStars(env);}
    catch {failures.push('stars_delivery_scheduler_requires_retry');}
   }
   if(failures.length)throw Error(failures.join(';'));
  },
  async fetch(request,env,ctx){
   const url=new URL(request.url);
   // Both quote and checkout must go through the SAME guarded Stars API.
   // Old read-only /quote always returns checkoutEnabled:false.
   if(url.pathname==='/api/stars/variable/checkout'||
      url.pathname==='/api/stars/variable/quote'){
    // A trusted server-side pricing function must be wired at Worker build
    // time. Never derive coin price from browser input or environment flags.
    if(typeof calculateEntitlement!=='function')
     return Response.json({ok:false,error:'checkout_not_configured'},
      {status:503,headers:{'cache-control':'no-store'}});
    return handleCheckout(request,env,fetchImpl,
     data=>freezeQuote(env,data,calculateEntitlement));
   }
   if(url.pathname!==WEBHOOK||request.method!=='POST'||
      typeof env?.WEBHOOK_SECRET!=='string'||env.WEBHOOK_SECRET.length<1||
      request.headers.get('X-Telegram-Bot-Api-Secret-Token')!==env.WEBHOOK_SECRET)
    return original.fetch(request,env,ctx);

   let update;
   try{update=await request.clone().json();}
   catch{return original.fetch(request,env,ctx);}
   if(isStarsSupportCommand(update)){
    try{
     if(await handlePaymentSupport(update,env,fetchImpl))
      return new Response('ok',{status:200,headers:{'cache-control':'no-store'}});
    }catch(e){
     console.error('RUST UP payment support requires retry',
      String(e?.message||'error').slice(0,100));
     return new Response('payment support requires retry',{status:503});
    }
   }
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
