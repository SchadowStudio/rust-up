// Dormant, operator-gated Stars paid-order settlement worker.
// Requires installed PAYMENTS_DB delivery queue and GAME DB atomic trigger.
// No invoices are created here. Telegram charge is independently verified by
// deliverVerifiedVariableStarsCredit before exactly-once game balance credit.
import {deliverVerifiedVariableStarsCredit}
 from '../account-credit-ledger/verified-stars-game-credit.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEASE_MS=2*60*1000;
const MAX_ATTEMPTS=8;
const MAX_BATCH=10;

export function settlementWorkerAllowed(env){
 return env?.PAYMENT_PRODUCTION_ENABLED==='true'&&
  env?.STARS_GAME_CREDIT_SETTLEMENT_ENABLED==='true'&&
  env?.STARS_VARIABLE_CREDIT_LEDGER_READY==='true'&&
  env?.PAYMENT_WALLET_STRICT_MODE==='true'&&
  typeof env?.PAYMENTS_DB?.prepare==='function'&&
  typeof env?.DB?.prepare==='function'&&
  typeof env?.BOT_TOKEN==='string';
}
export function settlementRetryAt(attemptCount,now){
 if(!Number.isSafeInteger(attemptCount)||attemptCount<1||
    attemptCount>MAX_ATTEMPTS||!Number.isSafeInteger(now)||now<1)
  throw Error('stars_settlement_retry_invalid');
 const delay=Math.min(6*60*60*1000,30000*2**Math.min(attemptCount-1,9));
 return now+delay;
}
async function releaseAllowed(env){
 const control=await env.DB.prepare(
  'SELECT enabled,approval_reference,reviewed_at_ms '+
  'FROM rustup_game_paid_release_control WHERE id=1'
 ).first();
 return control?.enabled===1&&
  typeof control.approval_reference==='string'&&
  control.approval_reference.length>=8&&
  Number.isSafeInteger(control.reviewed_at_ms)&&
  control.reviewed_at_ms>0;
}
function result(ok,fields={}){
 return {enabled:ok,selected:0,claimed:0,delivered:0,
  retries:0,manualReview:0,skipped:0,...fields};
}
export async function runVariableStarsDeliveryQueue(env,{
 now=Date.now(),maxBatch=MAX_BATCH,fetchImpl=fetch,
 deliver=deliverVerifiedVariableStarsCredit,
 newLeaseToken=()=>crypto.randomUUID()
}={}){
 if(!settlementWorkerAllowed(env))return result(false);
 if(!Number.isSafeInteger(now)||now<=0||
    !Number.isSafeInteger(maxBatch)||maxBatch<1||maxBatch>MAX_BATCH||
    typeof deliver!=='function'||typeof newLeaseToken!=='function')
  throw Error('stars_settlement_scheduler_invalid');
 if(!await releaseAllowed(env))return result(false);
 // Never process anything that does not currently have a PAID order.
 const selected=await env.PAYMENTS_DB.prepare(
  'SELECT j.order_id,j.attempt_count FROM rustup_stars_variable_delivery_jobs j '+
  'JOIN rustup_stars_variable_orders o ON o.id=j.order_id '+
  "WHERE o.status='paid' AND ("+
  "(j.state IN ('pending','retry') AND j.next_attempt_at_ms<=?) OR "+
  "(j.state='leased' AND j.lease_until_ms<=?)) "+
  'ORDER BY j.next_attempt_at_ms ASC,j.order_id ASC LIMIT ?'
 ).bind(now,now,maxBatch).all();
 if(!Array.isArray(selected?.results))throw Error('stars_settlement_jobs_unavailable');
 const out=result(true,{selected:selected.results.length});
 for(const row of selected.results){
  if(!UUID.test(row?.order_id)||
     !Number.isSafeInteger(row.attempt_count)||row.attempt_count<0){
   out.manualReview++;continue;
  }
  const token=newLeaseToken();
  if(typeof token!=='string'||!UUID.test(token))
   throw Error('stars_settlement_lease_token_invalid');
  const claimed=await env.PAYMENTS_DB.prepare(
   'UPDATE rustup_stars_variable_delivery_jobs '+
   "SET state='leased',lease_token=?,lease_until_ms=?,"+
   'attempt_count=attempt_count+1,updated_at_ms=? '+
   'WHERE order_id=? AND attempt_count=? AND '+
   "((state IN ('pending','retry') AND next_attempt_at_ms<=?) OR "+
   "(state='leased' AND lease_until_ms<=?)) AND EXISTS ("+
   'SELECT 1 FROM rustup_stars_variable_orders o '+
   "WHERE o.id=rustup_stars_variable_delivery_jobs.order_id AND o.status='paid')"
  ).bind(token,now+LEASE_MS,now,row.order_id,row.attempt_count,now,now).run();
  if(claimed?.meta?.changes!==1){out.skipped++;continue;}
  out.claimed++;
  let ok=false;
  try{
   const delivery=await deliver(env,row.order_id,fetchImpl);
   if(delivery?.orderId!==row.order_id||
      !((delivery.applied===true&&delivery.replayed===false)||
        (delivery.applied===false&&delivery.replayed===true)))
    throw Error('stars_settlement_unconfirmed');
   ok=true;
  }catch{
   // Never store raw Telegram/provider errors or user identifiers.
  }
  if(ok){
   const marked=await env.PAYMENTS_DB.prepare(
    'UPDATE rustup_stars_variable_delivery_jobs '+
    "SET state='delivered',lease_token=NULL,lease_until_ms=NULL,"+
    'completed_at_ms=?,updated_at_ms=?,last_error_code=NULL '+
    "WHERE order_id=? AND state='leased' AND lease_token=?"
   ).bind(now,now,row.order_id,token).run();
   if(marked?.meta?.changes!==1)
    throw Error('stars_settlement_delivery_marker_conflict_manual_review');
   out.delivered++;
  }else{
   const attempt=row.attempt_count+1;
   const needsReview=attempt>=MAX_ATTEMPTS;
   const marked=await env.PAYMENTS_DB.prepare(
    'UPDATE rustup_stars_variable_delivery_jobs '+
    'SET state=?,lease_token=NULL,lease_until_ms=NULL,'+
    'next_attempt_at_ms=?,updated_at_ms=?,last_error_code=? '+
    "WHERE order_id=? AND state='leased' AND lease_token=?"
   ).bind(needsReview?'manual_review':'retry',
    needsReview?now:settlementRetryAt(attempt,now),now,
    'settlement_attempt_unconfirmed',row.order_id,token).run();
   if(marked?.meta?.changes!==1)
    throw Error('stars_settlement_retry_marker_conflict_manual_review');
   if(needsReview)out.manualReview++;else out.retries++;
  }
 }
 return out;
}
