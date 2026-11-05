// Current RUST UP bot + existing Stars commerce + USER-ENTERED amount top-ups.
// Every precheckout stays disabled until the credit ledger, strict game account
// import and owner-controlled payment configuration are all enabled.
import current from './worker.js';
import {wrapExistingWorker} from './stars-existing-worker-wrapper.mjs';
import {variableStarsApi,variableStarsWebhook} from './stars-variable-bridge.mjs';

const existing=wrapExistingWorker(current);
function variablePayload(update){
 const payload=update?.pre_checkout_query?.invoice_payload||
   update?.message?.successful_payment?.invoice_payload;
 return typeof payload==='string'&&payload.startsWith('v:');
}
export default {
 ...existing,
 async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(url.pathname.startsWith('/api/stars/variable/')){
   const result=await variableStarsApi(request,env);
   return result||new Response('Not Found',{status:404});
  }
  if(url.pathname==='/tg'&&request.method==='POST'&&
     typeof env.WEBHOOK_SECRET==='string'&&env.WEBHOOK_SECRET.length>0&&
     request.headers.get('X-Telegram-Bot-Api-Secret-Token')===env.WEBHOOK_SECRET){
   let update;
   try{update=await request.clone().json();}
   catch{return existing.fetch(request,env,ctx);}
   if(variablePayload(update)){
    try{
     if(await variableStarsWebhook(update,env))
      return new Response('ok',{status:200});
    }catch(error){
     console.error('Variable Stars webhook requires retry',
      String(error?.message||'error').slice(0,90));
     return new Response('payment event requires retry',{
      status:503,headers:{'cache-control':'no-store'}
     });
    }
   }
  }
  return existing.fetch(request,env,ctx);
 }
};
