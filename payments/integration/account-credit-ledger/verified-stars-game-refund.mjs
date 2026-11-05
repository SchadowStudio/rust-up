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
   if(tx.amount>=0)continue; // original incoming payment, not a refund
   if(tx.amount!==-priceStars||tx.source||
      tx.receiver?.type!=='user'||
      tx.receiver.user?.id!==credit.telegram_user_id)
    throw Error('stars_refund_id_amount_or_user_mismatch');
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
  'SELECT source,order_id,receipt_id,telegram_user_id,coin_cents '+
  'FROM rustup_game_paid_receipts WHERE source=? AND order_id=?'
 ).bind(credit.source,credit.order_id).first();
 if(!credited)
  return {refunded:true,gameCreditHadBeenApplied:false,
   gameCreditReversed:false,manualReview:false};
 if(credited.source!==credit.source||credited.order_id!==credit.order_id||
    credited.receipt_id!==credit.receipt_id||
    credited.telegram_user_id!==credit.telegram_user_id||
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
