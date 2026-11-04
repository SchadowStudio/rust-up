import {ASSETS,txId} from '../assets.js';
import {verifyChainPaymentQuorum as verifyChainPayment} from './quorum.js';
function validProof(invoice,proof){
 const rules=ASSETS[invoice.asset];
 if(!rules||rules.chain!==invoice.chain)throw Error('unsupported_asset');
 if(!proof||!Number.isSafeInteger(proof.paymentTimeMs)||
    proof.paymentTimeMs<=0)throw Error('invalid_proof_time');
 if(!Number.isSafeInteger(proof.confirmations)||
    proof.confirmations<rules.confirmations)throw Error('insufficient_confirmations');
 if(!/^[1-9][0-9]{0,59}$/.test(String(proof.actualAtomic||''))||
    BigInt(proof.actualAtomic)<BigInt(invoice.amount_atomic))
  throw Error('underpaid_or_wrong_recipient');
 if(proof.txHash!==txId(invoice.asset,proof.txHash))throw Error('invalid_transaction_id');
 return true;
}
export async function settleV2(db,invoice,proof,now=Date.now()){
 validProof(invoice,proof);
 if(invoice.status==='verified')return {status:'verified',idempotent:true};
 if(!['awaiting_payment','expired'].includes(invoice.status))return {status:invoice.status};
 if(proof.paymentTimeMs<invoice.created_at_ms-300000)throw Error('payment_predates_invoice');
 if(proof.paymentTimeMs>invoice.expires_at_ms){
  await db.prepare(`INSERT OR IGNORE INTO v2_payment_reviews
    (id,invoice_id,tx_hash,reason,created_at_ms) VALUES(?,?,?,'late',?)`)
   .bind(crypto.randomUUID(),invoice.id,proof.txHash,now).run();
  return {status:'manual_review',reason:'late'};
 }
 const eventId='v2:'+invoice.id;
 const body=JSON.stringify({
  eventVersion:2,eventId,projectId:invoice.project_id,
  invoiceId:invoice.id,projectOrderRef:invoice.project_order_ref,
  amountMinor:invoice.amount_minor,currency:invoice.fiat,
  asset:invoice.asset,chain:invoice.chain,amountAtomic:proof.actualAtomic,
  transactionHash:proof.txHash,confirmedAt:now,
  ...(Array.isArray(proof.paymentParts)?{
   transactionHashes:proof.paymentParts,paymentMode:'combined_chain_transfers'
  }:{})
 });
 try {
  const [updated]=await db.batch([
   db.prepare(`UPDATE v2_invoices SET status='verified',tx_hash=?,verified_at_ms=?
     WHERE id=? AND status IN ('awaiting_payment','expired')`)
    .bind(proof.txHash,now,invoice.id),
   db.prepare(`INSERT INTO v2_chain_claims(chain,tx_hash,invoice_id,project_id,claimed_at_ms)
     SELECT chain,tx_hash,id,project_id,? FROM v2_invoices
     WHERE id=? AND status='verified' AND tx_hash=?`)
    .bind(now,invoice.id,proof.txHash),
   db.prepare(`INSERT INTO v2_delivery_outbox(event_id,project_id,invoice_id,event_body,created_at_ms)
     SELECT ?,project_id,id,?,? FROM v2_invoices
     WHERE id=? AND status='verified' AND tx_hash=?`)
    .bind(eventId,body,now,invoice.id,proof.txHash)
  ]);
  if(!updated.meta?.changes)throw Error('settlement_not_committed');
 }catch(error){
  // A duplicate or race is safe only when the database confirms THIS invoice
  // was already paid using the SAME transaction.
  const latest=await db.prepare('SELECT status,tx_hash FROM v2_invoices WHERE id=?')
   .bind(invoice.id).first();
  if(latest?.status==='verified'&&latest.tx_hash===proof.txHash)
   return {status:'verified',idempotent:true};
  throw Error('settlement_conflict');
 }
 return {status:'verified',eventId};
}
export async function expireV2(db,now=Date.now()){
 return db.prepare(`UPDATE v2_invoices SET status='expired'
   WHERE status='awaiting_payment' AND expires_at_ms<?`)
  .bind(now).run();
}

/**
 * Independently verify underpayments addressed to an invoice.
 * Never issue a credit for a partial transfer. Preserve a manual review ticket
 * so actual funds are not silently lost after a customer mistakes the amount.
 */
export async function reviewUnderpayment(db,invoice,hash,env,now=Date.now()){
 const probe={...invoice,amount_atomic:'1'};
 const proof=await verifyChainPayment(probe,hash,env);
 if(BigInt(proof.actualAtomic)>=BigInt(invoice.amount_atomic))
  return {status:'full_amount_needs_retry'};
 if(proof.paymentTimeMs<invoice.created_at_ms-300000)
  return {status:'not_an_invoice_payment'};
 const reason=proof.paymentTimeMs>invoice.expires_at_ms?'late':'underpaid';
 await db.prepare(`INSERT OR IGNORE INTO v2_payment_reviews
  (id,invoice_id,tx_hash,reason,created_at_ms,actual_amount_atomic)
  VALUES(?,?,?,?,?,?)`)
  .bind(crypto.randomUUID(),invoice.id,proof.txHash,reason,now,proof.actualAtomic).run();
 return {status:'manual_review',reason,receivedAtomic:proof.actualAtomic};
}
