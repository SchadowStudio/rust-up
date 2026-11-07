// Operator-controlled refund for FIXED non-transferable Telegram Stars goods.
// No game-wallet credits or random games. Requires private /tg webhook, explicit
// separate refund flag and an allowlisted finance admin; OFF by default.
import {isPaymentAdmin} from './payment-controls.mjs';
import {telegramApi} from './stars.mjs';
import {SUPPORTER_BADGE_SKU,supporterRefundStatement} from './supporter-badge.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CMD=/^\/pay(?:@rustuper_bot)?\s+refundstars\s+([a-f0-9-]{36})\s+(CONFIRM)$/i;
function isPrivate(m){return m?.chat?.type==='private'&&m.chat.id===m?.from?.id;}
export async function issueFixedStarsRefund(env,params){
 const {adminId,orderId,confirmation,fetchImpl=fetch}=params;
 if(!env||env.STARS_REFUNDS_ENABLED!=='true')throw Error('refunds_not_enabled');
 if(!isPaymentAdmin(adminId,env))throw Error('finance_admin_required');
 if(!UUID.test(orderId||'')||confirmation!==('REFUND '+orderId))
  throw Error('confirmation_required');
 const db=env.PAYMENTS_DB;
 if(!db)throw Error('refund_database_unavailable');
 const order=await db.prepare(
  'SELECT id,telegram_user_id,sku,status,telegram_charge_id FROM rustup_stars_orders WHERE id=?'
 ).bind(orderId).first();
 if(!order||order.status!=='paid'||!Number.isSafeInteger(order.telegram_user_id)||
   typeof order.telegram_charge_id!=='string'||!order.telegram_charge_id)
  throw Error('order_not_refundable');
 // Reserve exactly once. Never repeat a Telegram refund call whose outcome
 // could be uncertain because a previous external request timed out.
 const placed=await db.prepare(
  'INSERT OR IGNORE INTO rustup_stars_refund_intents '+
  '(order_id,telegram_charge_id,requested_by,reason,state,requested_at_ms) '+
  "VALUES (?,?,?,'operator_requested_refund','pending',?)"
 ).bind(orderId,order.telegram_charge_id,adminId,Date.now()).run();
 if(placed?.meta?.changes!==1)
  throw Error('refund_intent_already_exists_manual_review');
 let refunded=false;
 try{
  const result=await telegramApi({TG_STARS_BOT_TOKEN:env.BOT_TOKEN},
   'refundStarPayment',{
    user_id:order.telegram_user_id,
    telegram_payment_charge_id:order.telegram_charge_id
   },fetchImpl);
  refunded=result===true;
 }catch(error){
  // The payment may have been refunded even if the network response was lost.
  // Flag it for manual reconciliation, not an automatic second refund.
  await db.prepare(
   "UPDATE rustup_stars_refund_intents SET state='manual_review' WHERE order_id=? AND state='pending'"
  ).bind(orderId).run();
  throw Error('refund_gateway_outcome_uncertain');
 }
 if(!refunded){
  await db.prepare(
   "UPDATE rustup_stars_refund_intents SET state='manual_review' WHERE order_id=? AND state='pending'"
  ).bind(orderId).run();
  throw Error('refund_not_accepted_review');
 }
 // D1 batch is an atomic transaction: all three rows are updated or none.
 // In case of an error, the pending record prevents repeating the refund.
 const at=Date.now();
 const statements=[
  db.prepare("UPDATE rustup_stars_orders SET status='refunded' WHERE id=? AND status='paid'").bind(orderId),
  db.prepare('UPDATE rustup_stars_order_content SET unlocked_at_ms=NULL WHERE order_id=?').bind(orderId)
 ];
 // This changes NO game balances: only the specific profile badge is revoked.
 // Include revocation in the SAME transaction as the Telegram refund record.
 if(order.sku===SUPPORTER_BADGE_SKU)
  statements.push(supporterRefundStatement(db,orderId,at));
 statements.push(
  db.prepare("UPDATE rustup_stars_refund_intents SET state='completed',completed_at_ms=? WHERE order_id=? AND state='pending'")
    .bind(at,orderId)
 );
 await db.batch(statements);
 return {ok:true,orderId,status:'refunded',gameBalanceChanged:false};
}
export async function handleRefundCommand(update,env,fetchImpl=fetch){
 const m=update?.message;
 if(!isPrivate(m)||typeof m.text!=='string')return false;
 const command=CMD.exec(m.text.trim());
 if(!command)return false;
 const adminId=m.from.id;
 if(!isPaymentAdmin(adminId,env))return false; // existing /pay access handling
 let reply;
 try{
  const outcome=await issueFixedStarsRefund(env,{
   adminId,orderId:command[1],
   confirmation:'REFUND '+command[1],fetchImpl
  });
  reply='✅ Stars возврат подтверждён. Заказ: '+outcome.orderId;
 }catch(e){
  reply='Возврат не завершён: '+String(e.message||'unknown').slice(0,100)+
   '\nПовторять платежи вручную без проверки квитанции нельзя.';
 }
 await telegramApi({TG_STARS_BOT_TOKEN:env.BOT_TOKEN},'sendMessage',
  {chat_id:adminId,text:reply},fetchImpl);
 return true;
}
