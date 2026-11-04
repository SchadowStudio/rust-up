// Sender-side at-least-once delivery. Exactly-once credit MUST be guaranteed
// by the receiving game's ledger using UNIQUE(event_id).
const encoder=new TextEncoder();
function toHex(buffer){return [...new Uint8Array(buffer)]
 .map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function signWebhook(key,time,eventId,payload){
 if(typeof key!=='string'||key.length<32)throw Error('signing_key_not_configured');
 const imported=await crypto.subtle.importKey('raw',encoder.encode(key),
  {name:'HMAC',hash:'SHA-256'},false,['sign']);
 const message=String(time)+'.'+eventId+'.'+payload;
 return toHex(await crypto.subtle.sign('HMAC',imported,encoder.encode(message)));
}
function endpoint(value){
 if(typeof value!=='string'||!/^https:\/\//i.test(value))
  throw Error('game_ledger_https_required');
 const u=new URL(value);
 if(u.username||u.password||u.hash)throw Error('invalid_game_ledger_url');
 return value;
}
function delayMs(attempts){
 return Math.min(86400000,60000*2**Math.min(10,attempts));
}
export async function drainOutbox(env,now=Date.now()){
 if(!env.DB||env.GAME_LEDGER_DELIVERY_ENABLED!=='true')
  return {skipped:true,reason:'disabled'};
 const url=endpoint(env.GAME_LEDGER_WEBHOOK_URL);
 if(!env.GAME_LEDGER_SIGNING_KEY)throw Error('missing_signing_key');
 const batch=await env.DB.prepare(`SELECT * FROM payment_outbox
  WHERE delivered_at_ms IS NULL AND next_attempt_ms<=?
  ORDER BY created_at_ms LIMIT 20`).bind(now).all();
 const result={attempted:0,delivered:0,retry:0};
 for(const row of batch.results||[]){
  result.attempted++;
  const ts=Date.now();
  try{
   const signature=await signWebhook(env.GAME_LEDGER_SIGNING_KEY,ts,row.event_id,row.payload);
   const answer=await fetch(url,{
    method:'POST',headers:{
     'content-type':'application/json',
     'x-rustup-event-id':row.event_id,
     'x-rustup-timestamp':String(ts),
     'x-rustup-signature':'v1='+signature
    },
    body:row.payload,
    signal:AbortSignal.timeout(12000)
   });
   if(!answer.ok)throw Error('delivery_http_'+answer.status);
   const accepted=await answer.json();
   if(accepted?.ok!==true||accepted?.eventId!==row.event_id)
    throw Error('ledger_acknowledgment_missing');
   const done=await env.DB.prepare(`UPDATE payment_outbox
    SET delivered_at_ms=?,last_error=NULL WHERE event_id=? AND delivered_at_ms IS NULL`)
    .bind(Date.now(),row.event_id).run();
   if(done.meta?.changes)result.delivered++;
  }catch(err){
   const message=String(err.message||'delivery_error').slice(0,120);
   await env.DB.prepare(`UPDATE payment_outbox
    SET attempts=attempts+1,next_attempt_ms=?,last_error=?
    WHERE event_id=? AND delivered_at_ms IS NULL`)
    .bind(Date.now()+delayMs(row.attempts+1),message,row.event_id).run();
   result.retry++;
  }
 }
 return result;
}
