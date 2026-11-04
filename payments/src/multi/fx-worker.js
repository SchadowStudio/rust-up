import {refreshMarketRates} from './market.js';
// Separate Worker/cron: market requests never block customer invoices.
// No public rates override endpoint and no customer inputs.
export default {
 async fetch(request){
  if(new URL(request.url).pathname!=='/health')return new Response(null,{status:404});
  return new Response(JSON.stringify({ok:true,service:'rate-sync'}),{
   headers:{'content-type':'application/json','cache-control':'no-store'}});
 },
 async scheduled(_event,env,ctx){
  ctx.waitUntil(refreshMarketRates(env).then(result=>{
   if(result.errors?.length)console.error('Market quality warnings',result.errors);
  }).catch(()=>console.error('Independent market price synchronization failed')));
 }
};
