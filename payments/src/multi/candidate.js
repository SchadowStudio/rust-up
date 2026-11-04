// Cloudflare Queue messages are UNTRUSTED HINTS. Chain verification is mandatory.
import {verifyChainPayment} from '../chains.js';
import {txId} from '../assets.js';
import {validateReceivingAddress} from '../address.js';
import {settleV2} from './settlement.js';
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
 const proof=await verifyChainPayment(invoice,hash,env);
 return settleV2(db,invoice,proof);
}
export async function consumePaymentEvents(batch,env){
 if(!env.DB||env.MULTI_AUTO_QUEUE_ENABLED!=='true'){
  for(const message of batch.messages)message.retry({delaySeconds:60});
  return;
 }
 for(const message of batch.messages){
  try{
   const result=await reconcileCandidate(env.DB,message.body,env);
   message.ack();
   if(result.status==='manual_review')
    console.warn('Crypto payment was sent for manual review');
  }catch(error){
   // Temporary network failures and insufficient confirmations are retried.
   // Queue must be configured with a DLQ so no message is silently discarded.
   message.retry({delaySeconds:60});
  }
 }
}
