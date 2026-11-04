// Cloudflare Queue messages are UNTRUSTED HINTS. Chain verification is mandatory.
import {verifyChainPaymentQuorum as verifyChainPayment} from './quorum.js';
import {txId} from '../assets.js';
import {validateReceivingAddress} from '../address.js';
import {settleV2,reviewUnderpayment} from './settlement.js';
import {deliverV2,notifyDeliveryQueue} from './delivery.js';
import {processPaymentPart} from './multi-transfer.js';
export async function reconcileCandidate(db,item,env){
 if(!item||!['ethereum','bitcoin','tron'].includes(item.chain)||
    !await validateReceivingAddress(item.chain,item.address))
   return {status:'ignored',reason:'invalid_candidate'};
 let hash;
 try{hash=txId(item.chain==='bitcoin'?'BTC':
  item.chain==='ethereum'?'ETH':'TRX',item.txHash);}
 catch{return {status:'ignored',reason:'invalid_transaction_hash'}}
 const query=item.chain==='ethereum'
  ?`SELECT * FROM v2_invoices WHERE chain=? AND
    receive_address=? COLLATE NOCASE AND status IN ('awaiting_payment','expired')
    ORDER BY created_at_ms DESC LIMIT 1`
  :`SELECT * FROM v2_invoices WHERE chain=? AND receive_address=?
    AND status IN ('awaiting_payment','expired')
    ORDER BY created_at_ms DESC LIMIT 1`;
 const invoice=await db.prepare(query).bind(item.chain,item.address).first();
 if(!invoice)return {status:'ignored',reason:'invoice_not_found'};
 if(env.MULTI_PARTIAL_AGGREGATION_ENABLED==='true'){
  let settled;
  try{settled=await processPaymentPart(db,invoice,hash,env);}
  catch(error){
   if(error.message==='invalid_or_late_payment_part')
    return reviewUnderpayment(db,invoice,hash,env);
   throw error;
  }
  await notifyDeliveryQueue(env,settled);
  return settled;
 }
 let proof;
 try{proof=await verifyChainPayment(invoice,hash,env);}
 catch(error){
  if(error.message==='recipient_or_amount_mismatch'||
     error.message==='underpaid_or_wrong_recipient')
   return reviewUnderpayment(db,invoice,hash,env);
  throw error;
 }
 const settled=await settleV2(db,invoice,proof);
 await notifyDeliveryQueue(env,settled);
 return settled;
}
export async function consumePaymentEvents(batch,env){
 if(!env.DB||env.MULTI_AUTO_QUEUE_ENABLED!=='true'){
  for(const message of batch.messages)message.retry({delaySeconds:60});
  return;
 }
 for(const message of batch.messages){
  try{
   const item=message.body;
   if(item?.kind==='delivery'){
    if(!/^v2:[0-9a-f-]{36}$/i.test(item.eventId||'')){
     message.ack();continue;
    }
    await deliverV2(env,Date.now(),item.eventId);
    message.ack();continue;
   }
   const result=await reconcileCandidate(env.DB,item,env);
   message.ack();
   if(result.status==='manual_review')
    console.warn('Crypto payment was sent for manual review');
  }catch(error){
   // Retry temporary RPC failure or early confirmations; DLQ catches exhaustion.
   message.retry({delaySeconds:60});
  }
 }
}
