// RUST UP: independently confirmed refund reversal against paid game balances.
// Never auto-issues a refund. It only reconciles a provider-refunded, durably
// recorded payment. Missing funds require operator review, not a negative balance.
// NOT imported or enabled in the production Worker.
import {telegramApi} from '../telegram-stars/stars.mjs';
import {validatePaidStarsSettlementOrder} from './verified-stars-game-credit.mjs';

export async function verifyStarsRefundHistory(env,credit,priceStars,
 fetchImpl=fetch){
 if(!env?.BOT_TOKEN||!Number.isSafeInteger(priceStars)||priceStars<1||
    priceStars>1000000)
  throw Error('stars_refund_verifier_unconfigured');
 let found=false,complete=false;
 for(let offset=0;offset<2000;offset+=100){
  const result=await telegramApi({TG_STARS_BOT_TOKEN:env.BOT_TOKEN},
   'getStarTransactions',{offset,limit:100},fetchImpl);
  const txs=result?.transactions;
  if(!Array.isArray(txs))throw Error('stars_refund_history_invalid');
  for(const tx of txs){
   if(tx.id!==credit.receipt_id)continue;
   // Bot API refunds are outgoing receiver=user transactions; the
   // StarTransaction.amount remains positive in the observed live history.
   // An incoming source=user payment is NOT evidence of a refund.
   if(tx.source?.type==='user'&&tx.source.user?.id===credit.telegram_user_id&&
      tx.receiver==null&&tx.amount===priceStars)continue;
   if(tx.amount!==priceStars||tx.source!=null||
      tx.receiver?.type!=='user'||
      tx.receiver.user?.id!==credit.telegram_user_id)
    throw Error('stars_refund_id_amount_or_user_mismatch');
   if(found)throw Error('stars_refund_duplicate_outgoing_history');
   found=true;
  }
  if(txs.length<100){complete=true;break;}
 }
 if(!complete)throw Error('stars_refund_history_incomplete_review');
 if(!found)throw Error('stars_refund_not_confirmed_review');
 return true;
}
export async function reconcileVerifiedStarsGameRefund(env,orderId,fetchImpl=fetch){
 if(env?.STARS_GAME_CREDIT_REFUND_RECONCILIATION_ENABLED!=='true'||
    env?.PAYMENT_WALLET_STRICT_MODE!=='true')
  throw Error('stars_game_refund_reconciliation_disabled');
 if(!env.DB?.prepare||!env.PAYMENTS_DB?.prepare)
  throw Error('stars_game_refund_databases_missing');
 const order=await env.PAYMENTS_DB.prepare(
  'SELECT id,telegram_user_id,requested_amount_minor,price_stars,status,'+
  'telegram_charge_id,paid_at_ms FROM rustup_stars_variable_orders WHERE id=?'
 ).bind(orderId).first();
 if(order?.status!=='refunded')throw Error('stars_game_refund_not_recorded');
 const quote=await env.PAYMENTS_DB.prepare(
  'SELECT order_id,telegram_user_id,amount_minor,coin_cents,quoted_at_ms '+
  'FROM rustup_stars_variable_credit_quotes WHERE order_id=?'
 ).bind(orderId).first();
 const credit=validatePaidStarsSettlementOrder({...order,status:'paid'},quote,orderId);
 await verifyStarsRefundHistory(env,credit,order.price_stars,fetchImpl);
 const credited=await env.DB.prepare(
  'SELECT source,order_id,receipt_id,telegram_user_id,amount_minor,coin_cents '+
  'FROM rustup_game_paid_receipts WHERE source=? AND order_id=?'
 ).bind(credit.source,credit.order_id).first();
 if(!credited)
  return {refunded:true,gameCreditHadBeenApplied:false,
   gameCreditReversed:false,manualReview:false};
 if(credited.source!==credit.source||credited.order_id!==credit.order_id||
    credited.receipt_id!==credit.receipt_id||
    credited.telegram_user_id!==credit.telegram_user_id||
    credited.amount_minor!==credit.amount_minor||
    credited.coin_cents!==credit.coin_cents)
  throw Error('stars_game_refund_original_credit_conflict');
 try{
  const result=await env.DB.prepare(
   'INSERT INTO rustup_game_paid_refunds '+
   '(source,order_id,receipt_id,telegram_user_id,coin_cents,refunded_at_ms) '+
   'VALUES(?,?,?,?,?,?)'
  ).bind(credit.source,credit.order_id,credit.receipt_id,
   credit.telegram_user_id,credit.coin_cents,Date.now()).run();
  if(result?.meta?.changes!==1)
   throw Error('stars_refund_reversal_write_unconfirmed');
  return {refunded:true,gameCreditHadBeenApplied:true,
   gameCreditReversed:true,replayed:false,manualReview:false};
 }catch{
  const existing=await env.DB.prepare(
   'SELECT receipt_id,telegram_user_id,coin_cents '+
   'FROM rustup_game_paid_refunds WHERE source=? AND order_id=?'
  ).bind(credit.source,credit.order_id).first();
  if(existing?.receipt_id===credit.receipt_id&&
     existing.telegram_user_id===credit.telegram_user_id&&
     existing.coin_cents===credit.coin_cents)
   return {refunded:true,gameCreditHadBeenApplied:true,
    gameCreditReversed:true,replayed:true,manualReview:false};
  throw Error('stars_refund_spent_credit_or_db_failure_manual_review');
 }
}


// Reconcile previously refunded orders in bounded batches. The caller must
// explicitly enable this separately from invoice and settlement controls.
// Successful provider refunds are NEVER issued here. Every individual refund
// is independently verified before the atomic game-ledger reversal.
export async function reconcileRecordedStarsRefundBatch(env,{
 maxBatch=10,fetchImpl=fetch,reconcile=reconcileVerifiedStarsGameRefund
}={}){
 if(env?.STARS_GAME_CREDIT_REFUND_RECONCILIATION_ENABLED!=='true'||
    env?.PAYMENT_WALLET_STRICT_MODE!=='true'||
    env?.PAYMENT_PRODUCTION_ENABLED!=='true')
  return {enabled:false,selected:0,reversed:0,alreadyReversed:0,
   noGameCredit:0,manualReview:0};
 if(!env?.DB?.prepare||!env?.PAYMENTS_DB?.prepare||
    !Number.isSafeInteger(maxBatch)||maxBatch<1||maxBatch>25||
    typeof reconcile!=='function')
  throw Error('stars_refund_batch_unconfigured');
 // Only payments with a documented provider refund are eligible. Never infer
 // a refund merely because an invoice was cancelled or a user requested one.
 const rows=await env.PAYMENTS_DB.prepare(
  'SELECT o.id FROM rustup_stars_variable_orders o '+
  "WHERE o.status='refunded' AND NOT EXISTS ("+
  'SELECT 1 FROM rustup_stars_refund_reconciliation_done d '+
  'WHERE d.order_id=o.id) '+
  'ORDER BY o.paid_at_ms ASC,o.id ASC LIMIT ?'
 ).bind(maxBatch).all();
 if(!Array.isArray(rows?.results))
  throw Error('stars_refund_batch_database_unavailable');
 const summary={enabled:true,selected:rows.results.length,reversed:0,
  alreadyReversed:0,noGameCredit:0,manualReview:0};
 for(const row of rows.results){
  try{
   const result=await reconcile(env,row.id,fetchImpl);
   if(result?.gameCreditReversed!==true&&
      !(result?.refunded===true&&
        result?.gameCreditHadBeenApplied===false)){
    summary.manualReview++;continue;
   }
   // Record terminal success durably. A write failure leaves the order
   // eligible for a retry; the game ledger itself remains idempotent.
   const terminal=result.gameCreditReversed===true?
    'reversed':'no_game_credit';
   const marked=await env.PAYMENTS_DB.prepare(
    'INSERT OR IGNORE INTO rustup_stars_refund_reconciliation_done '+
    '(order_id,outcome,completed_at_ms) VALUES(?,?,?)'
   ).bind(row.id,terminal,Date.now()).run();
   if(marked?.meta?.changes!==1){
    const existing=await env.PAYMENTS_DB.prepare(
     'SELECT outcome FROM rustup_stars_refund_reconciliation_done WHERE order_id=?'
    ).bind(row.id).first();
    if(existing?.outcome!==terminal)
     throw Error('stars_refund_terminal_marker_conflict');
   }
   if(terminal==='no_game_credit')summary.noGameCredit++;
   else if(result.replayed===true)summary.alreadyReversed++;
   else summary.reversed++;
  }catch{
   // Never skip uncertainty silently or mutate the game ledger as a fallback.
   summary.manualReview++;
  }
 }
 return summary;
}


 // Detect refunds made outside the admin refund command by scanning independent
 // Telegram bot transaction history. This never calls refundStarPayment.
 // Only a matching original incoming payment AND outgoing refund with the
 // same charge ID, Star count and Telegram account can mark an order refunded.
 export async function discoverVerifiedStarsRefunds(env,{
  fetchImpl=fetch,maxBatch=25
 }={}){
  if(env?.PAYMENT_PRODUCTION_ENABLED!=='true'||
     env?.STARS_GAME_CREDIT_REFUND_RECONCILIATION_ENABLED!=='true'||
     env?.PAYMENT_WALLET_STRICT_MODE!=='true')
   return {enabled:false,detected:0,recorded:0,review:0};
  if(!env.PAYMENTS_DB?.prepare||typeof env.BOT_TOKEN!=='string'||
     !Number.isSafeInteger(maxBatch)||maxBatch<1||maxBatch>25)
   throw Error('stars_refund_discovery_unavailable');
  const transactions=[];
  let complete=false;
  for(let offset=0;offset<2000;offset+=100){
   const data=await telegramApi({TG_STARS_BOT_TOKEN:env.BOT_TOKEN},
    'getStarTransactions',{offset,limit:100},fetchImpl);
   if(!Array.isArray(data?.transactions))
    throw Error('stars_refund_discovery_history_invalid');
   transactions.push(...data.transactions);
   if(data.transactions.length<100){complete=true;break;}
  }
  if(!complete)throw Error('stars_refund_discovery_history_incomplete_review');
  const originals=new Map(),refunded=new Map(),ambiguous=new Set();
  for(const tx of transactions){
   if(typeof tx?.id!=='string'||tx.id.length<8||tx.id.length>256)continue;
   const incoming=tx.source?.type==='user'&&
    tx.source.transaction_type==='invoice_payment'&&tx.receiver==null;
   const outgoing=tx.source==null&&tx.receiver?.type==='user';
   if(!incoming&&!outgoing)continue;
   if(!Number.isSafeInteger(tx.amount)||tx.amount<1||
      !Number.isSafeInteger(tx.date)||tx.date<1)continue;
   const user=(incoming?tx.source:tx.receiver)?.user?.id;
   if(!Number.isSafeInteger(user)||user<1)continue;
   const destination=incoming?originals:refunded;
   if(destination.has(tx.id))ambiguous.add(tx.id);
   destination.set(tx.id,{amount:tx.amount,user,date:tx.date,
    invoicePayload:incoming?tx.source.invoice_payload:null});
  }
  const result={enabled:true,detected:0,recorded:0,review:0};
  for(const [chargeId,refund] of refunded){
   if(result.detected>=maxBatch)break;
   const original=originals.get(chargeId);
   if(!original||ambiguous.has(chargeId)||
      original.user!==refund.user||
      original.amount!==refund.amount||refund.date<original.date){
    result.review++;continue;
   }
   const order=await env.PAYMENTS_DB.prepare(
    'SELECT id,telegram_user_id,price_stars,status FROM rustup_stars_variable_orders '+
    'WHERE telegram_charge_id=?'
   ).bind(chargeId).first();
   if(!order)continue; // Not a variable Stars deposit.
   if(original.invoicePayload!=null&&original.invoicePayload!=='v:'+order.id||
      order.telegram_user_id!==refund.user||
      order.price_stars!==refund.amount||
      !['paid','refunded'].includes(order.status)){
    result.review++;continue;
   }
   if(order.status==='refunded')continue;
   result.detected++;
   const applied=await env.PAYMENTS_DB.prepare(
    "UPDATE rustup_stars_variable_orders SET status='refunded' "+
    "WHERE id=? AND status='paid' AND telegram_charge_id=? "+
    'AND telegram_user_id=? AND price_stars=?'
   ).bind(order.id,chargeId,refund.user,refund.amount).run();
   if(applied?.meta?.changes===1)result.recorded++;
   else if(applied?.meta?.changes!==0)
    throw Error('stars_refund_discovery_write_unconfirmed');
  }
  return result;
 }
