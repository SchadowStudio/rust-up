import {ASSETS,txId} from './assets.js';

// Payment verified on its native chain. No signing keys, no custody,
// and no access to the live game's player balance.
export function validateProof(order,proof) {
 if(!ASSETS[order.asset]||ASSETS[order.asset].chain!==order.chain)
  throw new Error('invalid_order_asset');
 if(!proof||!Number.isInteger(proof.confirmations)||
    proof.confirmations<ASSETS[order.asset].confirmations)
  throw new Error('insufficient_confirmations');
 if(typeof proof.actualAtomic!=='string'||!/^[0-9]+$/.test(proof.actualAtomic)||
    BigInt(proof.actualAtomic)<BigInt(order.amount_atomic))
  throw new Error('recipient_or_amount_mismatch');
 if(!Number.isSafeInteger(proof.paymentTimeMs)||proof.paymentTimeMs<1)
  throw new Error('untrusted_payment_timestamp');
 if(proof.paymentTimeMs<order.created_at_ms-300000)throw new Error('payment_predates_order');
 if(typeof proof.txHash!=='string'||txId(order.asset,proof.txHash)!==proof.txHash)
  throw new Error('bad_chain_transaction');
 return true;
}
export async function settleVerified(db,order,proof,nowMs=Date.now()){
 validateProof(order,proof);
 if(order.status==='verified')return {status:'already_verified'};
 if(!['awaiting_payment','expired'].includes(order.status))
  throw new Error('invoice_not_claimable');
 if(proof.paymentTimeMs>order.expires_at_ms){
  await db.prepare(`INSERT OR IGNORE INTO payment_review_queue
    (chain,tx_hash,intent_id,reason,actual_amount_atomic,detected_at_ms)
    VALUES(?,?,?,'late_payment',?,?)`)
   .bind(order.chain,proof.txHash,order.id,proof.actualAtomic,nowMs).run();
  return {status:'manual_review',reason:'late_payment'};
 }
 const eventId='crypto:'+order.id;
 const payload=JSON.stringify({
  eventId,intentId:order.id,telegramId:order.telegram_id,
  creditKopecks:order.credit_kopecks,asset:order.asset,chain:order.chain,
  txHash:proof.txHash,amountAtomic:proof.actualAtomic,paymentTimeMs:proof.paymentTimeMs
 });
 // D1 batch is transactional. UNIQUE(chain,tx_hash) blocks replay to a
 // different order even under concurrent requests. Outbox is append-only.
 const [changed]=await db.batch([
  db.prepare(`UPDATE payment_intents
   SET status='verified',tx_hash=?,verified_at_ms=?
   WHERE id=? AND status IN ('awaiting_payment','expired')`)
   .bind(proof.txHash,nowMs,order.id),
  db.prepare(`INSERT INTO payment_verifications
   (chain,tx_hash,intent_id,confirmations,verified_at_ms)
   SELECT chain,tx_hash,id,?,? FROM payment_intents
   WHERE id=? AND status='verified' AND tx_hash=?`)
   .bind(proof.confirmations,nowMs,order.id,proof.txHash),
  db.prepare(`INSERT INTO payment_outbox(event_id,intent_id,event_type,payload,created_at_ms)
   SELECT ?,id,'crypto_payment_verified',?,? FROM payment_intents
   WHERE id=? AND status='verified' AND tx_hash=?`)
   .bind(eventId,payload,nowMs,order.id,proof.txHash)
 ]);
 if(!changed.meta?.changes)return {status:'already_claimed'};
 return {status:'verified',eventId};
}
export async function markExpired(db,nowMs=Date.now()) {
 return db.prepare(`UPDATE payment_intents SET status='expired'
  WHERE status='awaiting_payment' AND expires_at_ms<?`).bind(nowMs).run();
}
export function publicPaymentStatus(row){
 return {status:row.status,paidOnChain:row.status==='verified',
  creditedToGame:false};
}
