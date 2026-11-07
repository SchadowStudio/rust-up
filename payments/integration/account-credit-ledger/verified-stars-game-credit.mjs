// RUST UP: operator-gated settlement of a fully verified Telegram Stars
// invoice to the existing accounts.state.balance, never an invented wallet.
// Not imported by the deployed Worker. An independently verified transaction
// and a server-frozen coin quote are REQUIRED before any game DB write.
// Keep disabled while wager/refund/age-control checks remain unverified.
import {telegramApi} from '../telegram-stars/stars.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID=/^[A-Za-z0-9_-]{8,256}$/;
const validUser=n=>Number.isSafeInteger(n)&&n>0;
const money=n=>Number.isSafeInteger(n)&&n>=100&&n<=100000000;
const cents=n=>Number.isSafeInteger(n)&&n>=1&&n<=100000000;
const stars=n=>Number.isSafeInteger(n)&&n>=1&&n<=1000000;
const same=(a,b)=>a.source===b.source&&a.order_id===b.order_id&&
 a.receipt_id===b.receipt_id&&a.telegram_user_id===b.telegram_user_id&&
 a.amount_minor===b.amount_minor&&a.coin_cents===b.coin_cents;

export function validatePaidStarsSettlementOrder(order,quote,orderId){
 if(!UUID.test(orderId||'')||!order||order.id!==orderId||
    order.status!=='paid'||!validUser(order.telegram_user_id)||
    !money(order.requested_amount_minor)||!stars(order.price_stars)||
    !ID.test(order.telegram_charge_id||'')||
    !Number.isSafeInteger(order.paid_at_ms)||order.paid_at_ms<1)
   throw Error('stars_settlement_paid_order_invalid');
 if(!quote||quote.order_id!==orderId||
    quote.telegram_user_id!==order.telegram_user_id||
    quote.amount_minor!==order.requested_amount_minor||
    !cents(quote.coin_cents)||!Number.isSafeInteger(quote.quoted_at_ms)||
    quote.quoted_at_ms<1||quote.quoted_at_ms>order.paid_at_ms)
   throw Error('stars_settlement_frozen_quote_missing');
 return Object.freeze({
  source:'stars_variable',order_id:orderId,
  receipt_id:order.telegram_charge_id,
  telegram_user_id:order.telegram_user_id,
  amount_minor:order.requested_amount_minor,
  coin_cents:quote.coin_cents
 });
}

// Bot API getStarTransactions has stable IDs matching SuccessfulPayment's
// telegram_payment_charge_id. Never rely solely on a browser-supplied ID.
// A history invoice_payload is OPTIONAL in Telegram's Bot API. The
// authenticated successful_payment webhook already durably binds the unique
// Telegram charge ID to this order; independent history must match charge ID,
// user, positive amount and invoice type, and must not contradict a payload.
export async function independentlyVerifyStarsCharge(env,credit,priceStars,
 fetchImpl=fetch){
 if(!env?.BOT_TOKEN||!stars(priceStars))throw Error('stars_verifier_unconfigured');
 const match='v:'+credit.order_id;
 let found=false,complete=false;
 for(let offset=0;offset<2000;offset+=100){
  const data=await telegramApi({TG_STARS_BOT_TOKEN:env.BOT_TOKEN},
   'getStarTransactions',{offset,limit:100},fetchImpl);
  if(!Array.isArray(data?.transactions))throw Error('stars_transaction_scan_invalid');
  for(const tx of data.transactions){
   if(tx.id!==credit.receipt_id)continue;
   if(tx.receiver||tx.amount<=0)throw Error('stars_charge_refunded_manual_review');
   const src=tx.source;
   if(tx.amount!==priceStars||src?.type!=='user'||
      src.transaction_type!=='invoice_payment'||
      src.user?.id!==credit.telegram_user_id||
      (src.invoice_payload!=null&&src.invoice_payload!==match))
    throw Error('stars_transaction_amount_owner_or_invoice_mismatch');
   found=true;
  }
  if(data.transactions.length<100){complete=true;break;}
 }
 // A truncated history can hide a later refund of the same charge ID.
 if(!complete)throw Error('stars_transaction_history_incomplete_manual_review');
 if(!found)throw Error('stars_charge_unconfirmed_manual_reconciliation');
 return true;
}

export async function deliverVerifiedVariableStarsCredit(env,orderId,fetchImpl=fetch){
 if(env?.STARS_GAME_CREDIT_SETTLEMENT_ENABLED!=='true'||
    env?.PAYMENT_WALLET_STRICT_MODE!=='true'||
    env?.STARS_VARIABLE_CREDIT_LEDGER_READY!=='true'||
    env?.PAYMENT_PRODUCTION_ENABLED!=='true')
   throw Error('stars_game_credit_settlement_disabled');
 if(!UUID.test(orderId||'')||!env?.DB?.prepare||!env?.PAYMENTS_DB?.prepare)
   throw Error('stars_settlement_database_unavailable');
 const order=await env.PAYMENTS_DB.prepare(
  'SELECT id,telegram_user_id,requested_amount_minor,price_stars,status,'+
  'telegram_charge_id,paid_at_ms FROM rustup_stars_variable_orders WHERE id=?'
 ).bind(orderId).first();
 const quote=await env.PAYMENTS_DB.prepare(
  'SELECT order_id,telegram_user_id,amount_minor,coin_cents,quoted_at_ms '+
  'FROM rustup_stars_variable_credit_quotes WHERE order_id=?'
 ).bind(orderId).first();
 const credit=validatePaidStarsSettlementOrder(order,quote,orderId);
 await independentlyVerifyStarsCharge(env,credit,order.price_stars,fetchImpl);
 // Atomic trigger in game DB moves balance and journals receipt together.
 // A duplicate insertion never repeats the trigger.
 try{
  const result=await env.DB.prepare(
   'INSERT INTO rustup_game_paid_receipts '+
   '(source,order_id,receipt_id,telegram_user_id,amount_minor,coin_cents,created_at_ms) '+
   'VALUES (?,?,?,?,?,?,?)'
  ).bind(credit.source,credit.order_id,credit.receipt_id,credit.telegram_user_id,
   credit.amount_minor,credit.coin_cents,Date.now()).run();
  if(result?.meta?.changes!==1)throw Error('stars_game_credit_write_unconfirmed');
  return {applied:true,replayed:false,orderId,creditedCoinCents:credit.coin_cents};
 }catch(error){
  const prior=await env.DB.prepare(
   'SELECT source,order_id,receipt_id,telegram_user_id,amount_minor,coin_cents '+
   'FROM rustup_game_paid_receipts WHERE source=? AND order_id=?'
  ).bind(credit.source,orderId).first();
  if(prior&&same(prior,credit))
   return {applied:false,replayed:true,orderId,creditedCoinCents:credit.coin_cents};
  throw Error('stars_game_credit_failed_requires_operator_review');
 }
}
