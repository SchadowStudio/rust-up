// Independent post-settlement reconciliation. A delivered webhook is not
// irreversible blockchain finality. This is an operator-alerting safety net;
// it NEVER spends wallet funds, revokes credit, or falsely marks a refund.
import {verifyChainPaymentQuorum} from './quorum.js';

const MAX_AGE_DAYS=30;
const clamp=(n,lo,hi,def)=>(Number.isSafeInteger(Number(n))&&Number(n)>=lo&&Number(n)<=hi)?
 Number(n):def;
export function nextAuditDelay(failures){
 if(failures<=0)return 6*60*60*1000;
 return Math.min(60*60*1000,60*1000*(2**Math.min(failures,6)));
}
export async function consumeManualVerifyQuota(db,projectId,env,now=Date.now()){
 const limit=clamp(env.MULTI_VERIFY_PER_MINUTE,1,1000,30);
 const minute=Math.floor(now/60000)*60000;
 const result=await db.prepare(`INSERT INTO v2_verify_quota
  (project_id,bucket_minute_ms,attempts) VALUES(?,?,1)
  ON CONFLICT(project_id,bucket_minute_ms)
  DO UPDATE SET attempts=attempts+1 WHERE attempts<?`)
  .bind(projectId,minute,limit).run();
 return !!result.meta?.changes;
}
export async function auditVerifiedInvoices(env,now=Date.now()){
 if(!env.DB||env.MULTI_RECONCILE_ENABLED!=='true')
  return {skipped:'disabled'};
 const db=env.DB;
 const batch=clamp(env.MULTI_RECONCILE_BATCH,1,50,10);
 const since=now-MAX_AGE_DAYS*86400000;
 const rows=await db.prepare(`SELECT i.*,a.failed_checks,a.last_block_hash,
   a.state AS audit_state FROM v2_invoices i
  LEFT JOIN v2_chain_audit_state a ON a.invoice_id=i.id
  WHERE i.status='verified' AND i.verified_at_ms>=?
   AND (a.invoice_id IS NULL OR a.next_check_ms<=?)
  ORDER BY COALESCE(a.next_check_ms,0),i.verified_at_ms DESC
  LIMIT ?`).bind(since,now,batch).all();
 const report={checked:0,confirmed:0,uncertain:0,manualReview:0,errors:[]};
 for(const invoice of rows.results||[]){
  report.checked++;
  try{
   if(!invoice.tx_hash)throw Error('missing_verified_transaction');
   const proof=await verifyChainPaymentQuorum(invoice,invoice.tx_hash,env);
   if(proof.txHash!==invoice.tx_hash||
      BigInt(proof.actualAtomic)<BigInt(invoice.amount_atomic)||
      proof.paymentTimeMs<invoice.created_at_ms-300000||
      proof.paymentTimeMs>invoice.expires_at_ms)
    throw Error('canonical_payment_proof_changed');
   // If a canonical block changes after the first audited proof, it must be
   // handled by an operator, even if its replacement now appears confirmed.
   const block=String(proof.blockHash||'').toLowerCase();
   if(invoice.last_block_hash&&invoice.last_block_hash!==block)
    throw Error('canonical_block_changed');
   await db.prepare(`INSERT INTO v2_chain_audit_state
     (invoice_id,last_checked_ms,next_check_ms,failed_checks,state,last_error,last_block_hash)
     VALUES(?,?,?,0,'confirmed',NULL,?)
     ON CONFLICT(invoice_id) DO UPDATE SET last_checked_ms=excluded.last_checked_ms,
     next_check_ms=excluded.next_check_ms,failed_checks=0,
     state='confirmed',last_error=NULL,last_block_hash=excluded.last_block_hash`)
    .bind(invoice.id,now,now+nextAuditDelay(0),block).run();
   report.confirmed++;
  }catch(error){
   const failures=Number(invoice.failed_checks||0)+1;
   const state=failures>=3?'manual_review':'uncertain';
   const detail=String(error?.message||'chain_audit_failed').slice(0,100);
   await db.prepare(`INSERT INTO v2_chain_audit_state
    (invoice_id,last_checked_ms,next_check_ms,failed_checks,state,last_error)
    VALUES(?,?,?,?,?,?)
    ON CONFLICT(invoice_id) DO UPDATE SET last_checked_ms=excluded.last_checked_ms,
      next_check_ms=excluded.next_check_ms,failed_checks=excluded.failed_checks,
      state=excluded.state,last_error=excluded.last_error`)
    .bind(invoice.id,now,now+nextAuditDelay(failures),failures,state,detail).run();
   if(state==='manual_review'){
    await db.prepare(`INSERT OR IGNORE INTO v2_payment_reviews
      (id,invoice_id,tx_hash,reason,created_at_ms)
      VALUES(?,?,?,'manual',?)`)
     .bind(crypto.randomUUID(),invoice.id,invoice.tx_hash,now).run();
    report.manualReview++;
   }else report.uncertain++;
   report.errors.push(detail);
  }
 }
 // Old verify-rate buckets are safe to prune; the security/audit record
 // retention policy is independent and must be documented by the operator.
 await db.prepare('DELETE FROM v2_verify_quota WHERE bucket_minute_ms<?')
  .bind(now-2*86400000).run();
 return report;
}
