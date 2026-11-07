// RUST UP deposit status: READ ONLY, Telegram-authenticated customer view.
// Combines isolated Stars order evidence with an existing game receipt journal.
// NEVER assumes "paid" means credited. No payment or balance write exists here.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATES=new Set(['pending','checkout_approved','paid','refunded','manual_review']);
const USER=n=>Number.isSafeInteger(n)&&n>0;
const MONEY=n=>Number.isSafeInteger(n)&&n>=100&&n<=100000000;
const COINS=n=>Number.isSafeInteger(n)&&n>0&&n<=100000000;
const STARS=n=>Number.isSafeInteger(n)&&n>0&&n<=1000000;
const TIME=n=>Number.isSafeInteger(n)&&n>0;

function requiredRows(value){
 if(!Array.isArray(value))throw Error('deposit_history_incomplete_database_response');
 return value;
}
function evidenceMap(rows,orderIds){
 const map=new Map();
 for(const row of rows){
  if(!orderIds.has(row?.order_id)||map.has(row.order_id))
   throw Error('deposit_history_unexpected_or_duplicate_journal');
  map.set(row.order_id,row);
 }
 return map;
}
function validCredit(order,receipt){
 return receipt?.source==='stars_variable' &&
  receipt.order_id===order.id &&
  receipt.receipt_id===order.telegram_charge_id &&
  receipt.telegram_user_id===order.telegram_user_id &&
  receipt.amount_minor===order.requested_amount_minor &&
  COINS(receipt.coin_cents);
}
function validReversal(order,credit,reversal){
 return validCredit(order,credit) &&
  reversal?.source==='stars_variable' &&
  reversal.order_id===credit.order_id &&
  reversal.receipt_id===credit.receipt_id &&
  reversal.telegram_user_id===credit.telegram_user_id &&
  reversal.coin_cents===credit.coin_cents;
}

export function determineStarsDepositState(order,credit=null,reversal=null){
 if(!order||!UUID.test(order.id||'')||
    !USER(order.telegram_user_id)||
    !MONEY(order.requested_amount_minor)||
    !STARS(order.price_stars)||
    !STATES.has(order.status)||
    !TIME(order.created_at_ms))
  return 'manual_review';
 if(order.status==='manual_review')return 'manual_review';
 if(credit && !validCredit(order,credit))return 'manual_review';
 if(reversal && !validReversal(order,credit,reversal))
  return 'manual_review';
 if(order.status==='pending')
  return credit||reversal?'manual_review':'awaiting_payment';
 if(order.status==='checkout_approved')
  return credit||reversal?'manual_review':'awaiting_telegram_receipt';
 if(!TIME(order.paid_at_ms)||order.paid_at_ms<order.created_at_ms||
    typeof order.telegram_charge_id!=='string'||
    order.telegram_charge_id.length<8||order.telegram_charge_id.length>256)
  return 'manual_review';
 if(order.status==='paid'){
  if(reversal)return 'manual_review';
  return credit?'credited_to_game':'payment_confirmed_credit_pending';
 }
 if(order.status==='refunded'){
  if(!credit)return reversal?'manual_review':'refunded_no_game_credit';
  return reversal?'refund_reversed':'refund_reversal_pending';
 }
 return 'manual_review';
}
function publicOrder(order,credit,reversal){
 const creditState=determineStarsDepositState(order,credit,reversal);
 const credited=creditState==='credited_to_game';
 const reversed=creditState==='refund_reversed';
 return {
  id:order.id,
  requested_amount_minor:order.requested_amount_minor,
  price_stars:order.price_stars,
  status:order.status,
  created_at_ms:order.created_at_ms,
  paid_at_ms:order.paid_at_ms??null,
  creditState,
  creditedToGame:credited,
  gameCreditReversed:reversed,
  ...(credited?{creditedCoinCents:credit.coin_cents}:{})
 };
}
export async function readStarsDepositHistory(env,verifiedTelegramUserId){
 if(!USER(verifiedTelegramUserId)||!env?.PAYMENTS_DB?.prepare||!env?.DB?.prepare)
  throw Error('deposit_history_d1_binding_missing');
 const data=await env.PAYMENTS_DB.prepare(
  'SELECT id,telegram_user_id,requested_amount_minor,price_stars,status,'+
  'created_at_ms,paid_at_ms,telegram_charge_id '+
  'FROM rustup_stars_variable_orders WHERE telegram_user_id=? '+
  'ORDER BY created_at_ms DESC LIMIT 50'
 ).bind(verifiedTelegramUserId).all();
 const orders=requiredRows(data?.results);
 if(orders.length>50)throw Error('deposit_history_invalid_order_batch');
 if(!orders.length)return {orders:[],statusComplete:true};
 const ids=new Set();
 for(const order of orders){
  if(!UUID.test(order?.id||'')||order.telegram_user_id!==verifiedTelegramUserId||
     ids.has(order.id))
   throw Error('deposit_history_identity_or_order_conflict');
  ids.add(order.id);
 }
 const placeholders=orders.map(()=>'?').join(',');
 const args=orders.map(o=>o.id);
 // Search by the customer's authenticated order IDs, not by receipt owner.
 // A receipt fraudulently bound to another player must be detected as a
 // mismatch, never silently hidden as an uncredited payment.
 // All order IDs are parameter-bound; no balance is touched.
 const [creditsResult,refundsResult]=await Promise.all([
  env.DB.prepare(
   'SELECT source,order_id,receipt_id,telegram_user_id,amount_minor,coin_cents '+
   'FROM rustup_game_paid_receipts '+
   "WHERE source='stars_variable' AND order_id IN ("+
   placeholders+')'
  ).bind(...args).all(),
  env.DB.prepare(
   'SELECT source,order_id,receipt_id,telegram_user_id,coin_cents '+
   'FROM rustup_game_paid_refunds '+
   "WHERE source='stars_variable' AND order_id IN ("+
   placeholders+')'
  ).bind(...args).all()
 ]);
 const credits=evidenceMap(requiredRows(creditsResult?.results),ids);
 const refunds=evidenceMap(requiredRows(refundsResult?.results),ids);
 return {
  orders:orders.map(order=>
   publicOrder(order,credits.get(order.id),refunds.get(order.id))),
  statusComplete:true
 };
}
