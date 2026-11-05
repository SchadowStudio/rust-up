// Controlled return-of-funds workflow for a recorded variable XTR payment.
// NOT deployed and NOT wired to /tg. No game credits or wager payouts.
// The operator must independently reconcile the original Telegram charge.
// The command may be used only through a separately authenticated private admin path.
import {isPaymentAdmin} from './payment-controls.mjs';
import {telegramApi} from './stars.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function markReview(db,orderId){
 await db.prepare(
  "UPDATE rustup_stars_variable_refund_intents SET state='manual_review' "+
  "WHERE order_id=? AND state='pending'"
 ).bind(orderId).run();
}
export async function issueVariableStarsRefund(env,{
 adminId,orderId,confirmation,fetchImpl=fetch,now=Date.now()
}={}){
 if(env?.STARS_REFUNDS_ENABLED!=='true')throw Error('variable_refunds_disabled');
 if(!isPaymentAdmin(adminId,env))throw Error('variable_refund_finance_admin_required');
 if(!UUID.test(orderId||'')||confirmation!=='REFUND '+orderId)
  throw Error('variable_refund_explicit_confirmation_required');
 if(!Number.isSafeInteger(now)||now<=0)throw Error('variable_refund_invalid_timestamp');
 const db=env?.PAYMENTS_DB;
 if(!db?.prepare||typeof db.batch!=='function')
  throw Error('variable_refund_db_unavailable');
 const order=await db.prepare(
  'SELECT id,telegram_user_id,status,price_stars,telegram_charge_id,paid_at_ms '+
  'FROM rustup_stars_variable_orders WHERE id=?'
 ).bind(orderId).first();
 if(!order||order.status!=='paid'||!Number.isSafeInteger(order.telegram_user_id)||
  order.telegram_user_id<=0||!Number.isSafeInteger(order.price_stars)||
  order.price_stars<=0||!Number.isSafeInteger(order.paid_at_ms)||order.paid_at_ms<=0||
  typeof order.telegram_charge_id!=='string'||!order.telegram_charge_id)
  throw Error('variable_refund_order_not_paid_or_unverified');
 const reserved=await db.prepare(
  'INSERT OR IGNORE INTO rustup_stars_variable_refund_intents '+
  '(order_id,telegram_charge_id,requested_by,reason,state,requested_at_ms) '+
  "VALUES (?,?,?,'operator_requested_refund','pending',?)"
 ).bind(orderId,order.telegram_charge_id,adminId,now).run();
 if(reserved?.meta?.changes!==1)
  throw Error('variable_refund_already_reserved_manual_review');
 let gatewayResult;
 try{
  gatewayResult=await telegramApi({TG_STARS_BOT_TOKEN:env.BOT_TOKEN},
   'refundStarPayment',{
    user_id:order.telegram_user_id,
    telegram_payment_charge_id:order.telegram_charge_id
   },fetchImpl);
 }catch{
  // Telegram may have performed the refund before a timeout: never auto-retry.
  await markReview(db,orderId);
  throw Error('variable_refund_gateway_uncertain_manual_review');
 }
 if(gatewayResult!==true){
  await markReview(db,orderId);
  throw Error('variable_refund_rejected_manual_review');
 }
 try{
  const results=await db.batch([
   db.prepare("UPDATE rustup_stars_variable_orders SET status='refunded' "+
    "WHERE id=? AND status='paid' AND telegram_charge_id=?")
    .bind(orderId,order.telegram_charge_id),
   db.prepare("UPDATE rustup_stars_variable_refund_intents "+
    "SET state='completed',completed_at_ms=? "+
    "WHERE order_id=? AND state='pending' AND telegram_charge_id=? "+
    "AND EXISTS(SELECT 1 FROM rustup_stars_variable_orders "+
    "WHERE id=? AND status='refunded' AND telegram_charge_id=?)")
    .bind(now,orderId,order.telegram_charge_id,orderId,order.telegram_charge_id)
  ]);
  if(results?.length!==2||results.some(v=>v?.meta?.changes!==1))
   throw Error('variable_refund_db_inconsistent');
 }catch{
  await markReview(db,orderId);
  throw Error('variable_refund_db_manual_reconciliation_required');
 }
 return {
  ok:true,orderId,status:'refunded',
  gameBalanceChanged:false,
  // A refund does not reverse game-credit postings: none are supported here.
  settlementNotConnected:true,gameCreditReversalNotImplemented:true
 };
}
