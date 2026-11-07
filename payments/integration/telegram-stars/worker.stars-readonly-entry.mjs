// Add only read-only /api/stars/* routes to the EXACT recovered live bot.
// Keep original /tg, /tgc, /tga, game, admin, support, schedules unchanged.
import current from './worker.js';
import {handleStarsReadOnly} from './stars-readonly-live.mjs';

if(!current||typeof current.fetch!=='function')
 throw Error('recovered_live_worker_export_missing');

export default {
 ...current,
 async fetch(request,env,ctx){
   if(new URL(request.url).pathname.startsWith('/api/stars/')){
     const result=await handleStarsReadOnly(request,env);
     if(result)return result;
   }
   return current.fetch(request,env,ctx);
 }
};
