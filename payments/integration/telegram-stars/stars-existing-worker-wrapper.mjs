// Telegram-only integration for the EXISTING Cloudflare RUST UP bot Worker.
// Existing game HTTP APIs, support bots, /pay controls and cron are preserved.
// All user-facing Stars shopping happens in the bot's private Telegram chat.
import {handleTelegramOnlyStarsUpdate,isTelegramStarsInteraction} from './stars-telegram-shop.mjs';

export function wrapExistingWorker(original,{
 handleStarsUpdate=handleTelegramOnlyStarsUpdate
}={}){
 if(!original||typeof original.fetch!=='function')
  throw Error('existing_worker_default_export_missing');
 return {
  ...original,
  async fetch(request,env,ctx){
   const url=new URL(request.url);
   // Intentionally no public shop, Mini App or HTTP payment routes.
   if(url.pathname==='/api/stars'||url.pathname.startsWith('/api/stars/'))
    return new Response('Not Found',{status:404,headers:{
     'cache-control':'no-store','x-content-type-options':'nosniff'
    }});
   if(url.pathname==='/tg'&&request.method==='POST'&&
      typeof env?.WEBHOOK_SECRET==='string'&&env.WEBHOOK_SECRET.length>0&&
      request.headers.get('X-Telegram-Bot-Api-Secret-Token')===env.WEBHOOK_SECRET){
     let update;
     try{update=await request.clone().json();}
     catch{return original.fetch(request,env,ctx);}
     if(isTelegramStarsInteraction(update)){
       try{
        if(await handleStarsUpdate(update,env))
          return new Response('ok');
       }catch(error){
        // Important: 503 requests another Telegram webhook delivery.
        // Never swallow a failed paid receipt and acknowledge success.
        console.error('Stars handler retryable failure',
          String(error?.message||'unknown').slice(0,100));
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
