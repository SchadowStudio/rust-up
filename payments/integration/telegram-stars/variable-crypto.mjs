// Variable-amount external cryptocurrency orders: separate from Telegram Mini Apps.
// Quote is server-issued by the multi-project provider. Never credit game balance.
import {providerInvoice} from './crypto-checkout.mjs';
import {verifyProjectCallback} from '../project-ledger/worker.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ASSETS=new Set(['BTC','ETH','TRX','USDT_ERC20','USDT_TRC20','TON']);
const FIATS=new Set(['EUR','RUB','USD']);

function bounds(env) {
  const parse=v=>typeof v==='string'&&/^[1-9][0-9]{0,12}$/.test(v)?Number(v):NaN;
  const min=parse(env.EXTERNAL_MIN_FIAT_MINOR);
  const max=parse(env.EXTERNAL_MAX_FIAT_MINOR);
  if(!Number.isSafeInteger(min)||!Number.isSafeInteger(max)||
    min<100||max<min||max>100000000)
    throw Error('external_variable_bounds_unconfigured');
  return {min,max};
}

// The amount is the merchant's fiat minor units (100 kopeks = 1 RUB);
// the actual blockchain amount comes from the provider's signed quote.
// No default real-world FX conversion is silently assumed.
export async function createExternalVariableCryptoCheckout(env,{
  verifiedExternalCustomerRef,merchantRequestId,amountMinor,currency,asset,sourceChannel='external_store',
  fetchImpl=fetch
}) {
  // Reject third-party cryptocurrency purchases in Telegram Mini Apps/Bots.
  if(sourceChannel==='telegram-miniapp'||sourceChannel==='telegram-bot')
   throw Error('telegram_digital_goods_require_stars');
  if(env.EXTERNAL_VARIABLE_CRYPTO_CHECKOUT_ENABLED!=='true')
    throw Error('external_variable_crypto_disabled');
  const {min,max}=bounds(env);
  if(!env.EXTERNAL_DB||!UUID.test(verifiedExternalCustomerRef||'')||
    !UUID.test(merchantRequestId||'')||!FIATS.has(currency)||
    !ASSETS.has(asset)||!Number.isSafeInteger(amountMinor)||
    amountMinor<min||amountMinor>max)
    throw Error('external_variable_amount_invalid');

  const db=env.EXTERNAL_DB;
  let row=await db.prepare(
    'SELECT * FROM rustup_external_variable_orders WHERE merchant_request_id=?'
  ).bind(merchantRequestId).first();
  if(row){
    if(row.external_customer_ref!==verifiedExternalCustomerRef||
       row.currency!==currency||row.amount_minor!==amountMinor||
       row.asset!==asset||row.status!=='pending')
      throw Error('external_variable_idempotency_conflict');
  }else{
    const id=crypto.randomUUID();
    try{
      await db.prepare(
        'INSERT INTO rustup_external_variable_orders '+
        '(project_order_ref,merchant_request_id,external_customer_ref,'+
        "currency,amount_minor,asset,status,created_at_ms) VALUES(?,?,?,?,?,?,'pending',?)"
      ).bind(id,merchantRequestId,verifiedExternalCustomerRef,currency,
        amountMinor,asset,Date.now()).run();
    }catch{
      // A concurrent identical request may have won.
    }
    row=await db.prepare(
      'SELECT * FROM rustup_external_variable_orders WHERE merchant_request_id=?'
    ).bind(merchantRequestId).first();
    if(!row||row.external_customer_ref!==verifiedExternalCustomerRef||
       row.currency!==currency||row.amount_minor!==amountMinor||
       row.asset!==asset||row.status!=='pending')
      throw Error('external_variable_order_conflict');
  }
  const invoice=await providerInvoice(env,row,fetchImpl);
  if(row.provider_invoice_id&&row.provider_invoice_id!==invoice.invoiceId)
    throw Error('external_variable_invoice_changed');

  if(!row.provider_invoice_id){
    const res=await db.prepare(
      'UPDATE rustup_external_variable_orders SET provider_invoice_id=? '+
      "WHERE project_order_ref=? AND status='pending' AND provider_invoice_id IS NULL"
    ).bind(invoice.invoiceId,row.project_order_ref).run();
    if(res.meta?.changes!==1){
      const updated=await db.prepare(
        'SELECT provider_invoice_id FROM rustup_external_variable_orders WHERE project_order_ref=?'
      ).bind(row.project_order_ref).first();
      if(updated?.provider_invoice_id!==invoice.invoiceId)
        throw Error('external_variable_invoice_link_conflict');
    }
  }
  return {
    ...invoice,requestedAmountMinor:row.amount_minor,
    creditedToGame:false,availableForWagers:false,withdrawable:false
  };
}

// This callback is for an independent external storefront only.
// The provider verifies actual chain transfers before signing the callback.
// It is deliberately NOT a real-money game credit consumer.
export async function recordExternalVariableReceipt(request,env,now=Date.now()){
  if(env.EXTERNAL_VARIABLE_CRYPTO_RECEIPTS_ENABLED!=='true')
    return {accepted:false,disabled:true};
  if(!env.EXTERNAL_DB)
    return {accepted:false,error:'database_unavailable'};
  let event;
  try{
    ({event}=await verifyProjectCallback(request,env,now));
  }catch{
    return {accepted:false,error:'invalid_callback_signature'};
  }
  if(!ASSETS.has(event.asset))
    return {accepted:false,error:'invalid_asset'};
  const db=env.EXTERNAL_DB;
  const row=await db.prepare(
    'SELECT * FROM rustup_external_variable_orders WHERE project_order_ref=?'
  ).bind(event.projectOrderRef).first();
  if(!row||row.provider_invoice_id!==event.invoiceId||
     row.currency!==event.currency||row.amount_minor!==event.amountMinor||
     row.asset!==event.asset)
    return {accepted:false,error:'invoice_or_amount_mismatch'};
  if(row.status==='paid_confirmed')
    return row.provider_event_id===event.eventId
      ? {accepted:true,duplicate:true,creditedToGame:false}
      : {accepted:false,error:'payment_replay_conflict'};
  if(row.status!=='pending')return {accepted:false,error:'order_closed'};

  try{
    const write=await db.prepare(
      "UPDATE rustup_external_variable_orders SET status='paid_confirmed',"+
      'provider_event_id=?,confirmed_at_ms=? WHERE project_order_ref=? '+
      "AND status='pending' AND provider_invoice_id=? AND currency=? "+
      'AND amount_minor=? AND asset=?'
    ).bind(event.eventId,now,row.project_order_ref,event.invoiceId,
      event.currency,event.amountMinor,event.asset).run();
    if(write.meta?.changes===1)
      return {accepted:true,duplicate:false,creditedToGame:false};
  }catch{
    const old=await db.prepare(
      'SELECT status,provider_event_id FROM rustup_external_variable_orders WHERE project_order_ref=?'
    ).bind(row.project_order_ref).first();
    if(old?.status==='paid_confirmed'&&old.provider_event_id===event.eventId)
      return {accepted:true,duplicate:true,creditedToGame:false};
    return {accepted:false,error:'db_conflict_or_unavailable'};
  }
  const old=await db.prepare(
    'SELECT status,provider_event_id FROM rustup_external_variable_orders WHERE project_order_ref=?'
  ).bind(row.project_order_ref).first();
  if(old?.status==='paid_confirmed'&&old.provider_event_id===event.eventId)
    return {accepted:true,duplicate:true,creditedToGame:false};
  return {accepted:false,error:'state_conflict'};
}
