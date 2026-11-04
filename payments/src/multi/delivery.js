import {projectWebhookKey} from './keys.js';
import {safeWebhookUrl} from './identity.js';
import {verifyRecordedInvoice} from './receipt-proof.js';
const enc=new TextEncoder();
async function sign(secret,text){
 const key=await crypto.subtle.importKey('raw',enc.encode(secret),
  {name:'HMAC',hash:'SHA-256'},false,['sign']);
 const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(text)));
 return [...bytes].map(v=>v.toString(16).padStart(2,'0')).join('');
}
export async function signV2Webhook(master,projectId,eventId,time,body){
 const secret=await projectWebhookKey(master,projectId);
 return 'v2='+await sign(secret,[String(time),projectId,eventId,body].join('.'));
}
export async function deliverV2(env,now=Date.now(),onlyEventId=null){
 if(!env.DB||env.MULTI_DELIVERY_ENABLED!=='true')return {skipped:'disabled'};
 if(!env.MULTI_WEBHOOK_MASTER_KEY)throw Error('missing_master_key');
 const db=env.DB;
 const base=`SELECT o.event_id,o.project_id,o.invoice_id,
    o.event_body,o.attempts,o.next_attempt_ms,p.webhook_url,p.status
   FROM v2_delivery_outbox o JOIN v2_projects p ON p.id=o.project_id
   WHERE o.delivered_at_ms IS NULL AND o.next_attempt_ms<=?
   AND p.status='active'`;
 const rows=onlyEventId?
  await db.prepare(base+' AND o.event_id=? LIMIT 1').bind(now,onlyEventId).all():
  await db.prepare(base+' ORDER BY o.created_at_ms LIMIT 25').bind(now).all();
 const result={attempted:0,delivered:0,deferred:0,failed:0};
 for(const event of rows.results||[]){
  // Paused projects are excluded in SQL and cannot starve active projects.
  // Lease each event before any network access. Crashes eventually retry.
  const lease=await db.prepare(`UPDATE v2_delivery_outbox
   SET next_attempt_ms=?,attempts=attempts+1
   WHERE event_id=? AND delivered_at_ms IS NULL AND next_attempt_ms<=?`)
   .bind(Date.now()+60000,event.event_id,now).run();
  if(!lease.meta?.changes){result.deferred++;continue;}
  result.attempted++;
  try{
   // Webhooks are the final money-facing boundary. Re-check chain consensus
   // immediately before delivery; a stale/reorganized transaction is not proof.
   const invoice=await db.prepare(`SELECT * FROM v2_invoices
     WHERE id=? AND project_id=? AND status='verified' AND tx_hash IS NOT NULL`)
    .bind(event.invoice_id,event.project_id).first();
   if(!invoice)throw Error('invoice_not_verified');
   // A previously detected chain dispute or any unresolved payment review
   // must halt merchant credit, even if a later RPC read looks plausible.
   // Operators must resolve the issue; never silently overwrite evidence.
   const hold=await db.prepare(`SELECT
     EXISTS(SELECT 1 FROM v2_chain_audit_state
       WHERE invoice_id=? AND state IN ('uncertain','manual_review')) AS audit_hold,
     EXISTS(SELECT 1 FROM v2_payment_reviews
       WHERE invoice_id=? AND resolved_at_ms IS NULL) AS review_hold`)
    .bind(invoice.id,invoice.id).first();
   if(!hold||hold.audit_hold||hold.review_hold)
    throw Error('invoice_under_payment_review');
   const {proof:current,recorded}=await verifyRecordedInvoice(db,invoice,env);
   if(JSON.stringify(recorded)!==event.event_body)
    throw Error('outbox_payload_changed');
   if(recorded.invoiceId!==invoice.id||
      recorded.projectId!==invoice.project_id||
      recorded.transactionHash!==current.txHash||
      recorded.amountAtomic!==current.actualAtomic||
      current.paymentTimeMs<invoice.created_at_ms-300000||
      current.paymentTimeMs>invoice.expires_at_ms)
    throw Error('chain_proof_changed_since_settlement');
   const url=safeWebhookUrl(event.webhook_url);
   const host=new URL(url).hostname.toLowerCase();
   const allow=String(env.MULTI_WEBHOOK_HOST_ALLOWLIST||'').split(',')
    .map(x=>x.trim().toLowerCase()).filter(Boolean);
   if(!allow.includes(host))throw Error('callback_host_not_approved');
   const timestamp=Date.now();
   const signature=await signV2Webhook(env.MULTI_WEBHOOK_MASTER_KEY,
    event.project_id,event.event_id,timestamp,event.event_body);
   const response=await fetch(url,{method:'POST',redirect:'error',
    headers:{'content-type':'application/json','x-rup-project':event.project_id,
     'x-rup-event':event.event_id,'x-rup-timestamp':String(timestamp),
     'x-rup-signature':signature},
    body:event.event_body,signal:AbortSignal.timeout(12000)
   });
   if(!response.ok)throw Error('callback_http_'+response.status);
   const receipt=await response.json();
   if(receipt?.ok!==true||receipt?.eventId!==event.event_id)
    throw Error('callback_ack_missing');
   await db.prepare(`UPDATE v2_delivery_outbox
     SET delivered_at_ms=?,last_error=NULL WHERE event_id=? AND delivered_at_ms IS NULL`)
    .bind(Date.now(),event.event_id).run();
   result.delivered++;
  }catch(error){
   // Exponential backoff with jitter, capped at one hour.
   const power=Math.min(event.attempts+1,8);
   const jitter=crypto.getRandomValues(new Uint32Array(1))[0]%15000;
   const wait=Math.min(3600000,30000*2**power+jitter);
   const message=String(error?.message||'delivery_error').slice(0,100);
   await db.prepare(`UPDATE v2_delivery_outbox
     SET next_attempt_ms=?,last_error=?
     WHERE event_id=? AND delivered_at_ms IS NULL`)
    .bind(Date.now()+wait,message,event.event_id).run();
   result.failed++;
  }
 }
 return result;
}

export async function notifyDeliveryQueue(env,result){
 if(result?.status!=='verified'||result.idempotent||!result.eventId||
    !env.MULTI_EVENT_QUEUE)return;
 try{await env.MULTI_EVENT_QUEUE.send({kind:'delivery',eventId:result.eventId});}
 catch{
  // The outbox is durable. Cron reconciliation will retry on queue outage.
  console.warn('Event enqueue failed; persisted outbox will retry');
 }
}
