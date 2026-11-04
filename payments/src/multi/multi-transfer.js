// Optional automatic, chain-verified split payments for one invoice.
// Never treat an unconfirmed transaction, another merchant's TX, or a float
// as money. Historical single-transaction flow remains available.
import {ASSETS,txId} from '../assets.js';
import {verifyChainPaymentQuorum} from './quorum.js';
import {settleV2} from './settlement.js';

export const MAX_PARTS_PER_INVOICE=8;
const positive=s=>/^[1-9][0-9]{0,59}$/.test(String(s||''));
const canonicalHash=(order,hash)=>txId(order.asset,hash);
export async function storedParts(db,invoiceId){
 const result=await db.prepare(`SELECT chain,tx_hash,invoice_id,project_id,
  asset,actual_atomic,payment_time_ms,block_hash,confirmed_at_ms
  FROM v2_payment_parts WHERE invoice_id=?
  ORDER BY payment_time_ms,tx_hash`).bind(invoiceId).all();
 return result.results||[];
}
function verifyPart(order,proof){
 const cfg=ASSETS[order.asset];
 if(!cfg||cfg.chain!==order.chain||!positive(proof?.actualAtomic)||
    !Number.isSafeInteger(proof?.confirmations)||proof.confirmations<cfg.confirmations||
    !Number.isSafeInteger(proof?.paymentTimeMs)||
    proof.paymentTimeMs<order.created_at_ms-300000||
    proof.paymentTimeMs>order.expires_at_ms||
    typeof proof?.blockHash!=='string'||proof.blockHash.length<64||
    proof.txHash!==canonicalHash(order,proof.txHash))
  throw Error('invalid_or_late_payment_part');
}
async function recordPart(db,invoice,proof,now){
 const existing=await db.prepare(`SELECT invoice_id,asset,actual_atomic,
  block_hash,payment_time_ms FROM v2_payment_parts
  WHERE chain=? AND tx_hash=?`).bind(invoice.chain,proof.txHash).first();
 if(existing){
  if(existing.invoice_id!==invoice.id||existing.asset!==invoice.asset||
     existing.actual_atomic!==proof.actualAtomic||
     existing.block_hash!==proof.blockHash||
     existing.payment_time_ms!==proof.paymentTimeMs)
   throw Error('part_conflict_or_reorg');
  return;
 }
 const params=[invoice.chain,proof.txHash,invoice.id,invoice.project_id,
  invoice.asset,proof.actualAtomic,proof.paymentTimeMs,proof.blockHash,now,
  invoice.id,invoice.project_id];
 try{
  const result=await db.prepare(`INSERT INTO v2_payment_parts
   (chain,tx_hash,invoice_id,project_id,asset,actual_atomic,
    payment_time_ms,block_hash,confirmed_at_ms)
   SELECT ?,?,?,?,?,?,?,?,?
   WHERE EXISTS(SELECT 1 FROM v2_invoices
    WHERE id=? AND project_id=? AND status IN ('awaiting_payment','expired'))`)
   .bind(...params).run();
  if(!result.meta?.changes)throw Error('invoice_no_longer_open');
 }catch(error){
  const found=await db.prepare(`SELECT invoice_id,asset,actual_atomic,
   block_hash,payment_time_ms FROM v2_payment_parts
   WHERE chain=? AND tx_hash=?`).bind(invoice.chain,proof.txHash).first();
  if(found&&found.invoice_id===invoice.id&&found.asset===invoice.asset&&
     found.actual_atomic===proof.actualAtomic&&
     found.block_hash===proof.blockHash&&
     found.payment_time_ms===proof.paymentTimeMs)return;
  throw Error('payment_part_conflict');
 }
}
export async function acceptVerifiedPaymentPart(db,invoice,proof,env,now=Date.now()){
 verifyPart(invoice,proof);
 if(invoice.status==='verified')return {status:'verified',idempotent:true};
 if(!['awaiting_payment','expired'].includes(invoice.status))
  return {status:invoice.status};
 await recordPart(db,invoice,proof,now);
 const parts=await storedParts(db,invoice.id);
 if(parts.length>MAX_PARTS_PER_INVOICE){
  await db.prepare(`INSERT OR IGNORE INTO v2_payment_reviews
   (id,invoice_id,tx_hash,reason,created_at_ms,actual_amount_atomic)
   VALUES(?,?,?,'manual',?,?)`)
   .bind(crypto.randomUUID(),invoice.id,proof.txHash,now,proof.actualAtomic).run();
  return {status:'manual_review',reason:'too_many_payment_parts'};
 }
 const provisional=parts.reduce((v,p)=>v+BigInt(p.actual_atomic),0n);
 const target=BigInt(invoice.amount_atomic);
 if(provisional<target)
  return {status:'partial',receivedAtomic:provisional.toString(),
   remainingAtomic:(target-provisional).toString(),parts:parts.length};
 // The original chain confirmations may have changed while partial payments
 // arrived. Revalidate EVERY part against independent RPC quorum before
 // creating exactly one outbox event for the whole invoice.
 const current=await Promise.all(parts.map(p=>verifyChainPaymentQuorum(
  {...invoice,amount_atomic:'1'},p.tx_hash,env)));
 let total=0n,latestPaymentTime=0,minConfirmations=Infinity;
 for(let i=0;i<parts.length;i++){
  const stored=parts[i],checked=current[i];
  if(checked.txHash!==stored.tx_hash||
     checked.actualAtomic!==stored.actual_atomic||
     checked.blockHash!==stored.block_hash||
     checked.paymentTimeMs!==stored.payment_time_ms)
   throw Error('payment_part_reorganized');
  total+=BigInt(checked.actualAtomic);
  latestPaymentTime=Math.max(latestPaymentTime,checked.paymentTimeMs);
  minConfirmations=Math.min(minConfirmations,checked.confirmations);
 }
 if(total<target)throw Error('payment_parts_no_longer_sufficient');
 const last=parts.at(-1);
 // Keep old one-invoice-one-event compatibility, but include all TX hashes.
 return settleV2(db,invoice,{
  txHash:last.tx_hash,actualAtomic:total.toString(),
  paymentTimeMs:latestPaymentTime,confirmations:minConfirmations,
  paymentParts:parts.map(p=>p.tx_hash)
 },now);
}
export async function processPaymentPart(db,invoice,hash,env,now=Date.now()){
 const proof=await verifyChainPaymentQuorum({...invoice,amount_atomic:'1'},hash,env);
 return acceptVerifiedPaymentPart(db,invoice,proof,env,now);
}
