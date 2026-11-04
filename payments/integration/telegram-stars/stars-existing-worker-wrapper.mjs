// Safe adapter for an EXISTING Cloudflare Worker default export.
// Existing scheduled(), game APIs, /pay commands, and bot webhooks are delegated
// unchanged, except specifically authenticated XTR receipts/precheckouts and
// explicit /stars or /paysupport private-chat messages.
import {receiveExistingBotStarsUpdate,existingBotStarsApi,existingBotPaySupport} from './stars-live-bridge.mjs';
import {telegramApi} from './stars.mjs';

function isPrivateCommand(update,command){
 const msg=update?.message;
 if(!msg||msg?.chat?.type!=='private'||msg.chat.id!==msg.from?.id)return false;
 return typeof msg.text==='string'&&
  new RegExp('^\\/'+command+'(?:@rustuper_bot)?(?:\\s|$)','i').test(msg.text.trim());
}
async function tgCall(env,method,body,fetchImpl=fetch){
 return telegramApi({TG_STARS_BOT_TOKEN:env.BOT_TOKEN},method,body,fetchImpl);
}
async function starsMenu(update,env,fetchImpl){
 const url=new URL('stars/',env.APP_URL);
 if(url.protocol!=='https:')throw Error('invalid_stars_app_url');
 await tgCall(env,'sendMessage',{
  chat_id:update.message.chat.id,
  text:'RUST UP — цифровые товары за Telegram Stars. Оплата доступна только после активации безопасного каталога.',
  reply_markup:{inline_keyboard:[[{text:'⭐ Открыть каталог',web_app:{url:url.href}}]]}
 },fetchImpl);
}
export function wrapExistingWorker(original,{
 receiveUpdate=receiveExistingBotStarsUpdate,
 handleStarsApi=existingBotStarsApi,
 paySupport=existingBotPaySupport,
 telegramCall=tgCall,
 fetchImpl=fetch
}={}){
 if(!original||typeof original.fetch!=='function')
  throw Error('existing_worker_default_export_missing');
 return {
  ...original,
  async fetch(request,env,ctx){
   const url=new URL(request.url);
   if(url.pathname.startsWith('/api/stars/')){
    const response=await handleStarsApi(request,env,fetchImpl);
    if(response)return response;
   }
   if(url.pathname==='/tg'&&request.method==='POST'&&
      typeof env?.WEBHOOK_SECRET==='string'&&env.WEBHOOK_SECRET.length>0&&
      request.headers.get('X-Telegram-Bot-Api-Secret-Token')===env.WEBHOOK_SECRET){
     let update;
     try{update=await request.clone().json();}
     catch{return original.fetch(request,env,ctx);}
     if(isPrivateCommand(update,'stars')||isPrivateCommand(update,'paysupport')||
        update?.pre_checkout_query?.currency==='XTR'||
        update?.message?.successful_payment?.currency==='XTR'){
      try{
       if(isPrivateCommand(update,'stars')){
        await starsMenu(update,env,fetchImpl);
        return new Response('ok');
       }
       if(await paySupport(update,env,(e,m,b)=>telegramCall(e,m,b,fetchImpl)))
        return new Response('ok');
       if(await receiveUpdate(update,env,fetchImpl))return new Response('ok');
      }catch(e){
       // Preserve retry for payments if storage/Telegram delivery failed.
       console.error('RUST UP Stars retryable webhook failure',String(e?.message||'error').slice(0,120));
       return new Response('payment not committed; retry',{status:503,
        headers:{'cache-control':'no-store'}});
      }
     }
   }
   return original.fetch(request,env,ctx);
  }
 };
}
