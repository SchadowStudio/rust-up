// A deterministic, immutable game coin quote for the existing RUST UP game.
// The game displays coins as USD $0.02 per coin; RUB is converted via an
// independently validated RUB-per-USD rate. No floating point amount is used.
// Never fall back to money.js's silent default 81 RUB/USD for paid transactions.
// This module is NOT imported by live checkout; release remains blocked.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isSafe=n=>Number.isSafeInteger(n)&&n>0;
export function quoteGameCoinCents(amountMinor,rubPerUsdMinor){
 if(!Number.isSafeInteger(amountMinor)||amountMinor<100||amountMinor>100000000||
    !Number.isSafeInteger(rubPerUsdMinor)||rubPerUsdMinor<100||
    rubPerUsdMinor>100000)
  throw Error('paid_game_rate_or_amount_invalid');
 // One coin is USD $0.02: coin cents = RUB kopecks * 5000 /
 // kopecks per USD. Round DOWN so the charged sum cannot underpay.
 const value=BigInt(amountMinor)*5000n/BigInt(rubPerUsdMinor);
 if(value<1n||value>100000000n)
  throw Error('paid_game_coin_quote_out_of_bounds');
 return Number(value);
}
export async function freezePaidGameQuote(db,{
 orderId,verifiedTelegramUserId,amountMinor,rubPerUsdMinor,
 now=Date.now()
}={}){
 if(!db?.prepare||!UUID.test(orderId||'')||
    !isSafe(verifiedTelegramUserId)||!isSafe(now))
  throw Error('paid_game_quote_invalid_identity');
 const coinCents=quoteGameCoinCents(amountMinor,rubPerUsdMinor);
 const row=await db.prepare(
  'SELECT id,telegram_user_id,requested_amount_minor,status,created_at_ms,expires_at_ms '+
  'FROM rustup_stars_variable_orders WHERE id=?'
 ).bind(orderId).first();
 if(!row||row.id!==orderId||row.telegram_user_id!==verifiedTelegramUserId||
    row.requested_amount_minor!==amountMinor||row.status!=='pending'||
    row.created_at_ms>now||row.expires_at_ms<=now)
  throw Error('paid_game_order_unavailable_for_quote');
 const inserted=await db.prepare(
  'INSERT OR IGNORE INTO rustup_stars_variable_credit_quotes '+
  '(order_id,telegram_user_id,amount_minor,coin_cents,rub_per_usd_minor,quoted_at_ms) '+
  'SELECT id,telegram_user_id,requested_amount_minor,?,?,? '+
  'FROM rustup_stars_variable_orders WHERE id=? AND telegram_user_id=? '+
  "AND requested_amount_minor=? AND status='pending' AND expires_at_ms>?"
 ).bind(coinCents,rubPerUsdMinor,now,orderId,verifiedTelegramUserId,
  amountMinor,now).run();
 if(inserted?.meta?.changes!==0&&inserted?.meta?.changes!==1)
  throw Error('paid_game_quote_persist_unconfirmed');
 const saved=await db.prepare(
  'SELECT order_id,telegram_user_id,amount_minor,coin_cents,rub_per_usd_minor,quoted_at_ms '+
  'FROM rustup_stars_variable_credit_quotes WHERE order_id=?'
 ).bind(orderId).first();
 if(!saved||saved.order_id!==orderId||
    saved.telegram_user_id!==verifiedTelegramUserId||
    saved.amount_minor!==amountMinor||
    saved.coin_cents!==coinCents||
    saved.rub_per_usd_minor!==rubPerUsdMinor||
    !isSafe(saved.quoted_at_ms))
  throw Error('paid_game_frozen_quote_conflict_or_missing');
 return Object.freeze({orderId,coinCents,
  amountMinor,rubPerUsdMinor,replayed:inserted.meta.changes===0,
  quotedAtMs:saved.quoted_at_ms});
}
