// RUST UP: freeze a server-calculated game entitlement BEFORE Telegram creates
// an XTR invoice. This module does NOT expose checkout or enable payments.
// The operator must supply a reviewed server-side pricing function; never
// accept coinCents or a conversion rate from Telegram Mini App input.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validInt=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
// Direct owner-defined exchange: 1 RUB = 1 RUST-UP Coin.
// amountMinor is kopecks; coinCents is hundredths of a Coin.
export function calculateRubCoinOneToOne({amountMinor}){
 if(!validInt(amountMinor,100,100000000))
  throw Error('stars_rub_coin_amount_invalid');
 return {coinCents:amountMinor,rubPerUsdMinor:null};
}

export async function freezeVerifiedStarsGameQuote(env,{
 orderId,verifiedTelegramUserId,amountMinor,now=Date.now()
},calculateEntitlement=calculateRubCoinOneToOne){
 if(!env?.PAYMENTS_DB?.prepare||!env?.DB?.prepare||
    typeof calculateEntitlement!=='function'||
    !UUID.test(orderId||'')||
    !validInt(verifiedTelegramUserId,1,Number.MAX_SAFE_INTEGER)||
    !validInt(amountMinor,100,100000000)||
    !validInt(now,1,Number.MAX_SAFE_INTEGER))
  throw Error('stars_quote_freezer_unconfigured');
 // This release lock is separate from the Worker flags. Never freeze a quote
 // before audited consent for settlement has been recorded in the GAME D1.
 if(env?.PAYMENT_PRODUCTION_ENABLED!=='true'||
    env?.STARS_VARIABLE_CREDIT_LEDGER_READY!=='true'||
    env?.PAYMENT_WALLET_STRICT_MODE!=='true')
  throw Error('stars_quote_freezer_release_disabled');
 const release=await env.DB.prepare(
  'SELECT enabled,approval_reference,reviewed_at_ms '+
  'FROM rustup_game_paid_release_control WHERE id=1'
 ).first();
 if(release?.enabled!==1||
    typeof release.approval_reference!=='string'||
    release.approval_reference.length<8||
    !validInt(release.reviewed_at_ms,1,Number.MAX_SAFE_INTEGER))
  throw Error('stars_quote_freezer_game_release_disabled');
 const order=await env.PAYMENTS_DB.prepare(
  'SELECT id,telegram_user_id,requested_amount_minor,status,created_at_ms,'+
  'expires_at_ms FROM rustup_stars_variable_orders WHERE id=?'
 ).bind(orderId).first();
 if(!order||order.id!==orderId||
    order.telegram_user_id!==verifiedTelegramUserId||
    order.requested_amount_minor!==amountMinor||
    order.status!=='pending'||
    !validInt(order.created_at_ms,1,now)||
    !validInt(order.expires_at_ms,now+1,Number.MAX_SAFE_INTEGER))
  throw Error('stars_quote_freezer_order_conflict');
 const player=await env.DB.prepare(
  'SELECT a.state AS state,u.balance AS balance,u.blocked AS blocked,'+
  'u.banned AS banned FROM accounts a JOIN users u ON u.id=a.id '+
  'WHERE a.id=?'
 ).bind(verifiedTelegramUserId).first();
 if(!player||player.blocked!==0||player.banned!==0||
    typeof player.state!=='string'||
    !Number.isFinite(player.balance)||player.balance<0)
  throw Error('stars_quote_freezer_player_unavailable');
 let account;
 try{account=JSON.parse(player.state);}catch{
  throw Error('stars_quote_freezer_player_state_invalid');
 }
 if(!account||typeof account.balance!=='number'||
    !Number.isFinite(account.balance)||account.balance<0||
    Math.abs(account.balance-player.balance)>0.000001||
    Math.abs(account.balance*100-Math.round(account.balance*100))>0.00001)
  throw Error('stars_quote_freezer_player_balance_unavailable');
 // The calculation is a trusted server-owned component, never a client quote.
 const entitlement=await calculateEntitlement({
  orderId,telegramUserId:verifiedTelegramUserId,amountMinor
 });
 if(!validInt(entitlement?.coinCents,1,100000000)||
    !(entitlement?.rubPerUsdMinor===null&&
      entitlement.coinCents===amountMinor)&&
    !validInt(entitlement?.rubPerUsdMinor,100,100000))
  throw Error('stars_quote_freezer_pricing_unavailable');
 const values=[orderId,verifiedTelegramUserId,amountMinor,
  entitlement.coinCents,entitlement.rubPerUsdMinor,now];
 await env.PAYMENTS_DB.prepare(
  'INSERT OR IGNORE INTO rustup_stars_variable_credit_quotes '+
  '(order_id,telegram_user_id,amount_minor,coin_cents,'+
  'rub_per_usd_minor,quoted_at_ms) VALUES(?,?,?,?,?,?)'
 ).bind(...values).run();
 const frozen=await env.PAYMENTS_DB.prepare(
  'SELECT order_id,telegram_user_id,amount_minor,coin_cents,'+
  'rub_per_usd_minor,quoted_at_ms FROM '+
  'rustup_stars_variable_credit_quotes WHERE order_id=?'
 ).bind(orderId).first();
 if(!frozen||frozen.order_id!==orderId||
    frozen.telegram_user_id!==verifiedTelegramUserId||
    frozen.amount_minor!==amountMinor||
    frozen.coin_cents!==entitlement.coinCents||
    frozen.rub_per_usd_minor!==entitlement.rubPerUsdMinor||
    !validInt(frozen.quoted_at_ms,order.created_at_ms,now))
  throw Error('stars_quote_freezer_durable_conflict');
 return {orderId,amountMinor,coinCents:frozen.coin_cents};
}
