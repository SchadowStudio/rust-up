// Canonical proof reader shared by webhooks and post-settlement audits.
// Multi-transfer credit MUST re-verify every piece, not just the last hash.
import {verifyChainPaymentQuorum} from './quorum.js';
import {MAX_PARTS_PER_INVOICE} from './transfer-policy.js';

const minPositive=s=>/^[1-9][0-9]{0,59}$/.test(String(s||''));
function uniqueHashes(input){
 return Array.isArray(input)&&input.length>=1&&
  input.length<=MAX_PARTS_PER_INVOICE&&
  input.every(v=>typeof v==='string'&&/^(0x)?[0-9a-f]{64}$/i.test(v))&&
  new Set(input).size===input.length;
}
async function hashParts(parts){
 const bytes=new TextEncoder().encode(parts.map(p=>
  p.tx_hash+':'+p.block_hash+':'+p.actual_atomic).join('|'));
 const buffer=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
 return Array.from(buffer,x=>x.toString(16).padStart(2,'0')).join('');
}
export async function verifyRecordedInvoice(db,invoice,env){
 const event=await db.prepare(`SELECT event_body FROM v2_delivery_outbox
  WHERE invoice_id=? AND project_id=?`).bind(invoice.id,invoice.project_id).first();
 if(!event)throw Error('missing_invoice_event');
 let recorded;
 try{recorded=JSON.parse(event.event_body)}
 catch{throw Error('malformed_invoice_event')}
 if(recorded.invoiceId!==invoice.id||
    recorded.projectId!==invoice.project_id||
    recorded.transactionHash!==invoice.tx_hash||
    !minPositive(recorded.amountAtomic))
  throw Error('invalid_invoice_event');
 if(!Array.isArray(recorded.transactionHashes)){
  const proof=await verifyChainPaymentQuorum(invoice,invoice.tx_hash,env);
  if(proof.actualAtomic!==recorded.amountAtomic)
   throw Error('receipt_amount_changed');
  return {proof,recorded};
 }
 const hashes=recorded.transactionHashes;
 if(!uniqueHashes(hashes)||hashes.at(-1)!==invoice.tx_hash)
  throw Error('invalid_partial_receipt');
 const rows=await db.prepare(`SELECT chain,tx_hash,invoice_id,asset,
   actual_atomic,payment_time_ms,block_hash FROM v2_payment_parts
   WHERE invoice_id=? ORDER BY payment_time_ms,tx_hash`)
  .bind(invoice.id).all();
 const parts=rows.results||[];
 if(parts.length!==hashes.length||
    parts.some((p,i)=>p.tx_hash!==hashes[i]||
      p.invoice_id!==invoice.id||p.chain!==invoice.chain||p.asset!==invoice.asset))
  throw Error('receipt_part_set_changed');
 const proofs=await Promise.all(parts.map(p=>verifyChainPaymentQuorum(
  {...invoice,amount_atomic:'1'},p.tx_hash,env)));
 let total=0n,lastTime=0,minConf=Infinity;
 for(let i=0;i<parts.length;i++){
  const p=parts[i],proof=proofs[i];
  if(proof.txHash!==p.tx_hash||
     proof.actualAtomic!==p.actual_atomic||
     proof.paymentTimeMs!==p.payment_time_ms||
     proof.blockHash!==p.block_hash||
     proof.paymentTimeMs<invoice.created_at_ms-300000||
     proof.paymentTimeMs>invoice.expires_at_ms)
   throw Error('receipt_part_changed');
  total+=BigInt(proof.actualAtomic);
  lastTime=Math.max(lastTime,proof.paymentTimeMs);
  minConf=Math.min(minConf,proof.confirmations);
 }
 if(total<BigInt(invoice.amount_atomic)||total.toString()!==recorded.amountAtomic)
  throw Error('receipt_total_inconsistent');
 const digest=await hashParts(parts);
 return {recorded,proof:{
  txHash:invoice.tx_hash,actualAtomic:total.toString(),
  paymentTimeMs:lastTime,confirmations:minConf,
  blockHash:digest
 }};
}
