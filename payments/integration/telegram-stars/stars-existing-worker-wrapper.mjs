// Embed Telegram Stars into the EXISTING RUST UP Main Mini App.
// Existing /pay commands, game APIs, other bots and cron stay unchanged.
// No separate public shop page or direct-chat product store.
import {receiveExistingBotStarsUpdate,existingBotStarsApi,existingBotPaySupport} from './stars-live-bridge.mjs';
import {telegramApi} from './stars.mjs';
import {handleRefundCommand} from './refunds.mjs';
import {variableStarsApi,variableStarsWebhook} from './stars-variable-bridge.mjs';

function privateCommand(update,name){
 const msg=update?.message;
 return msg?.chat?.type==='private'&&msg.chat.id===msg.from?.id&&
  typeof msg.text==='string'&&
  new RegExp('^\\/'+name+'(?:@rustuper_bot)?(?:\\s|$)','i').test(msg.text.trim());
}
async function callTelegram(env,method,body,fetchImpl){
 return telegramApi({TG_STARS_BOT_TOKEN:env.BOT_TOKEN},method,body,fetchImpl);
}
async function openExistingMiniApp(update,env,fetchImpl){
 let app;
 try{app=new URL(env.APP_URL);}
 catch{throw Error('existing_rustup_miniapp_url_unconfigured');}
 if(app.protocol!=='https:'||app.search||app.username||app.password)
  throw Error('existing_rustup_miniapp_url_invalid');
 // Same existing Main Mini App, just deep-link to its Stars route.
 app.hash='/wallet?tab=deposit&method=stars';
 await callTelegram(env,'sendMessage',{
  chat_id:update.message.from.id,
  text:'⭐ Telegram Stars теперь в RUST UP Mini App. Покупки только внутри Telegram.',
  reply_markup:{inline_keyboard:[[
   {text:'⭐ Открыть Stars в RUST UP',web_app:{url:app.href}}
  ]]}
 },fetchImpl);
}
export function wrapExistingWorker(original,{
 receiveStars=receiveExistingBotStarsUpdate,
 receiveVariableStars=variableStarsWebhook,
 refundStars=handleRefundCommand,
 handleStarsApi=existingBotStarsApi,
 handleVariableStarsHistory=variableStarsApi,
 paySupport=existingBotPaySupport,
 telegramCall=callTelegram,
 fetchImpl=fetch
}={}){
 if(!original||typeof original.fetch!=='function')
  throw Error('existing_worker_default_export_missing');
 return {
  ...original,
  async fetch(request,env,ctx){
   const url=new URL(request.url);
   // Only the read-only, Telegram-authenticated history may be exposed.
   // Variable quote and checkout MUST stay unavailable: the live game-credit
   // consumer is deliberately unconnected. Never forward these paths.
   if(url.pathname==='/api/stars/variable/history'){
    const result=await handleVariableStarsHistory(request,env,fetchImpl);
    return result || new Response('Not Found',{status:404});
   }
   if(url.pathname.startsWith('/api/stars/variable/'))
    return new Response('Not Found',{status:404,headers:{'cache-control':'no-store'}});
   // HTTPS API only, never a publicly browseable payment storefront.
   // All catalog/checkout/owned paths require signed Telegram initData.
   if(url.pathname.startsWith('/api/stars/')){
    const result=await handleStarsApi(request,env,fetchImpl);
    if(result)return result;
    return new Response('Not Found',{status:404});
   }
   if(url.pathname==='/tg'&&request.method==='POST'&&
      typeof env?.WEBHOOK_SECRET==='string'&&env.WEBHOOK_SECRET.length>0&&
      request.headers.get('X-Telegram-Bot-Api-Secret-Token')===env.WEBHOOK_SECRET){
     let update;
     try{update=await request.clone().json();}
     catch{return original.fetch(request,env,ctx);}
     const refundCandidate=privateCommand(update,'pay')&&
      /\srefundstars\s/i.test(update.message?.text||'');
     if(refundCandidate||privateCommand(update,'stars')||privateCommand(update,'paysupport')||
       update?.pre_checkout_query?.currency==='XTR'||
       update?.message?.successful_payment?.currency==='XTR'){
      try{
       if(refundCandidate&&await refundStars(update,env,fetchImpl))
        return new Response('ok');
       if(privateCommand(update,'stars')){
        await openExistingMiniApp(update,env,fetchImpl);
        return new Response('ok');
       }
       if(privateCommand(update,'paysupport')){
        if(await paySupport(update,env,(e,m,b)=>telegramCall(e,m,b,fetchImpl)))
          return new Response('ok');
       }
       // v:<order UUID> belongs to the variable Stars order journal, NOT
       // the fixed-goods handler. Dispatch first, even when all charging
       // gates are OFF, to preserve evidence of delayed paid receipts.
       if(await receiveVariableStars(update,env,fetchImpl))
         return new Response('ok');
       if(await receiveStars(update,env,fetchImpl))
         return new Response('ok');
      }catch(e){
       console.error('RUST UP Stars webhook requires retry',String(e?.message||'').slice(0,120));
       return new Response('payment event requires retry',{
        status:503,headers:{'cache-control':'no-store'}
       });
      }
     }
   }
   return original.fetch(request,env,ctx);
  }
 };
}
