// RUST UP: READ-ONLY account/Stars-order identity reconciliation.
// Reads two independent D1 bindings. Never credits balance or authorizes bets.
// A recorded database payment is NOT independent evidence of Telegram settlement.
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function userId(x){return Number.isSafeInteger(x)&&x>0;}
function accountState(value){
 if(typeof value!=='string'||value.length>262144)
  throw Error('account_state_invalid');
 let state;
 try{state=JSON.parse(value);}catch{throw Error('account_state_invalid');}
 if(!state||typeof state!=='object'||Array.isArray(state)||
    !Number.isSafeInteger(state.balance)||state.balance<0)
  throw Error('account_balance_not_safe_for_credit');
 return state;
}
export async function inspectRecordedStarsAccountLink(paymentsDb,gameDb,orderId){
 if(!paymentsDb?.prepare||!gameDb?.prepare||!ID.test(orderId||''))
  throw Error('invalid_account_link_request');
 const payment=await paymentsDb.prepare(
  'SELECT id,telegram_user_id,requested_amount_minor,price_stars,'+
  'status,telegram_charge_id,paid_at_ms FROM rustup_stars_variable_orders WHERE id=?'
 ).bind(orderId).first();
 if(!payment||payment.id!==orderId)
  throw Error('payment_order_missing');
 if(!userId(payment.telegram_user_id)||!Number.isSafeInteger(payment.price_stars)||
    payment.price_stars<=0||!Number.isSafeInteger(payment.requested_amount_minor)||
    payment.requested_amount_minor<100||payment.status!=='paid'||
    typeof payment.telegram_charge_id!=='string'||!payment.telegram_charge_id||
    !Number.isSafeInteger(payment.paid_at_ms)||payment.paid_at_ms<=0)
  throw Error('payment_order_not_sufficiently_recorded');
 const account=await gameDb.prepare('SELECT id,state,v FROM accounts WHERE id=?')
  .bind(payment.telegram_user_id).first();
 if(!account)throw Error('game_account_not_found');
 if(!userId(account.id)||account.id!==payment.telegram_user_id)
  throw Error('telegram_user_and_game_account_mismatch');
 if(!Number.isSafeInteger(account.v)||account.v<0)
  throw Error('account_version_invalid');
 accountState(account.state);
 return Object.freeze({
  accountId:account.id,orderId:payment.id,
  accountVersion:account.v,
  requestedAmountMinor:payment.requested_amount_minor,
  priceStars:payment.price_stars,
  recordedPayment:true,independentlyVerifiedTelegramReceipt:false,
  accountMatched:true,creditedToGame:false,readOnly:true
 });
}
