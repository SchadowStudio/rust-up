// Variable-amount Telegram Stars invoices for an isolated test worker.
// NEVER credits RUST UP games, cases, upgrades, skins or withdrawable funds.
// Do not enable without a lawful, non-redeemable digital entitlement.
import {telegramApi} from './stars.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TTL_MS=15*60*1000;
const isPositiveSafe=n=>Number.isSafeInteger(n)&&n>0;
const asInt=value=>typeof value==='string'&&/^[1-9]\d{0,14}$/.test(value)?Number(value):NaN;
const payload=id=>'v:'+id;
const fromPayload=x=>typeof x==='string'&&x.startsWith('v:')&&UUID.test(x.slice(2))?x.slice(2):null;

export function quoteVariableStars(amountMinor,env){
  // Merchant-defined integer quote: RUB minor units per Star = num / den.
  // Example: num=300, den=1 means one Star represents 3.00 RUB.
  // No invented Telegram exchange rate is used. All rates must be set by owner.
  const min=asInt(env.STARS_MIN_RUB_MINOR),max=asInt(env.STARS_MAX_RUB_MINOR);
  const num=asInt(env.STARS_RUB_MINOR_PER_STAR_NUM);
  const den=asInt(env.STARS_RUB_MINOR_PER_STAR_DEN);
  if(!isPositiveSafe(min)||!isPositiveSafe(max)||max<min||max>100000000||
     !isPositiveSafe(num)||!isPositiveSafe(den))
    throw Error('variable_stars_quote_unconfigured');
  if(!Number.isSafeInteger(amountMinor)||amountMinor<min||amountMinor>max)
    throw Error('variable_stars_amount_out_of_bounds');
  const stars=(BigInt(amountMinor)*BigInt(den)+BigInt(num)-1n)/BigInt(num);
  if(stars<1n||stars>1000000n)
    throw Error('variable_stars_price_out_of_bounds');
  return {
    currency:'RUB',requestedAmountMinor:amountMinor,priceStars:Number(stars),
    rateNumerator:num,rateDenominator:den,
    creditedToGame:false
  };
}

// verifiedTelegramUserId is produced only by server-authenticated initData.
export async function createVariableStarsCheckout(env,{
  verifiedTelegramUserId,amountMinor,requestId,now=Date.now(),fetchImpl=fetch
}){
  if(env.STARS_PAYMENT_ENABLED!=='true'||
     env.STARS_VARIABLE_TOPUP_ENABLED!=='true')
    throw Error('variable_stars_checkout_disabled');
  if(!env.DB||!isPositiveSafe(verifiedTelegramUserId)||!UUID.test(requestId||''))
    throw Error('invalid_variable_stars_identity_or_request');
  const quote=quoteVariableStars(amountMinor,env);
  let row=await env.DB.prepare(
    'SELECT * FROM rustup_stars_variable_orders WHERE telegram_user_id=? AND client_request_id=?'
  ).bind(verifiedTelegramUserId,requestId).first();
  if(row){
    if(row.requested_amount_minor!==amountMinor||row.status!=='pending')
      throw Error('variable_stars_request_conflict');
    if(now>=row.expires_at_ms)throw Error('variable_stars_order_expired');
    if(row.invoice_url)
      return {orderId:row.id,invoiceUrl:row.invoice_url,
        requestedAmountMinor:row.requested_amount_minor,priceStars:row.price_stars,
        currency:'RUB',expiresAtMs:row.expires_at_ms,creditedToGame:false};
  }else{
    const id=crypto.randomUUID();
    try{
      await env.DB.prepare(
        'INSERT INTO rustup_stars_variable_orders ('+
        'id,telegram_user_id,client_request_id,requested_amount_minor,price_stars,'+
        'rate_num,rate_den,status,created_at_ms,expires_at_ms) '+
        "VALUES (?,?,?,?,?,?,?,'pending',?,?)"
      ).bind(id,verifiedTelegramUserId,requestId,amountMinor,quote.priceStars,
        quote.rateNumerator,quote.rateDenominator,now,now+TTL_MS).run();
    }catch{
      // A simultaneous identical request may have won: reload using UNIQUE key.
    }
    row=await env.DB.prepare(
      'SELECT * FROM rustup_stars_variable_orders WHERE telegram_user_id=? AND client_request_id=?'
    ).bind(verifiedTelegramUserId,requestId).first();
    if(!row||row.status!=='pending'||row.requested_amount_minor!==amountMinor||
       now>=row.expires_at_ms)throw Error('variable_stars_concurrent_conflict');
  }
  // Persisted quote, not browser-controlled value, is the invoice authority.
  const link=await telegramApi(env,'createInvoiceLink',{
    title:'Цифровое пополнение',
    description:'Сумма и назначение указаны в заказе. Не подлежит выводу.',
    payload:payload(row.id),currency:'XTR',
    prices:[{label:'Цифровые единицы',amount:row.price_stars}]
  },fetchImpl);
  if(typeof link!=='string'||!/^https:\/\/\S+$/.test(link))
    throw Error('invalid_stars_invoice_link');
  const result=await env.DB.prepare(
    'UPDATE rustup_stars_variable_orders SET invoice_url=? '+
    "WHERE id=? AND status='pending' AND invoice_url IS NULL"
  ).bind(link,row.id).run();
  if(result.meta?.changes!==1){
    const last=await env.DB.prepare(
      'SELECT invoice_url FROM rustup_stars_variable_orders WHERE id=?'
    ).bind(row.id).first();
    if(!last?.invoice_url)throw Error('invoice_link_not_saved');
    return {orderId:row.id,invoiceUrl:last.invoice_url,
      requestedAmountMinor:row.requested_amount_minor,priceStars:row.price_stars,
      currency:'RUB',expiresAtMs:row.expires_at_ms,creditedToGame:false};
  }
  return {orderId:row.id,invoiceUrl:link,
    requestedAmountMinor:row.requested_amount_minor,priceStars:row.price_stars,
    currency:'RUB',expiresAtMs:row.expires_at_ms,creditedToGame:false};
}

export function validVariableStarsPrecheckout(row,q,now=Date.now()){
  return !!row&&!!q&&UUID.test(row.id)&&
    (row.status==='pending'||
     (row.status==='checkout_approved'&&row.checkout_query_id===q.id))&&
    isPositiveSafe(q.from?.id)&&q.from.id===row.telegram_user_id&&
    q.currency==='XTR'&&q.total_amount===row.price_stars&&
    q.invoice_payload===payload(row.id)&&row.expires_at_ms>now;
}
export function validVariableStarsReceipt(row,msg){
  const pay=msg?.successful_payment;
  return !!row&&!!pay&&UUID.test(row.id)&&
    (row.status==='checkout_approved'||row.status==='paid')&&
    isPositiveSafe(msg.from?.id)&&msg.from.id===row.telegram_user_id&&
    pay.currency==='XTR'&&pay.total_amount===row.price_stars&&
    pay.invoice_payload===payload(row.id)&&
    typeof pay.telegram_payment_charge_id==='string'&&
    pay.telegram_payment_charge_id.length>0&&
    pay.telegram_payment_charge_id.length<=256;
}

export async function handleVariableStarsUpdate(update,env,fetchImpl=fetch,now=Date.now()){
  const q=update?.pre_checkout_query;
  if(q&&typeof q.invoice_payload==='string'&&q.invoice_payload.startsWith('v:')){
    const id=fromPayload(q.invoice_payload);
    const row=id&&env.DB?await env.DB.prepare(
      'SELECT * FROM rustup_stars_variable_orders WHERE id=?'
    ).bind(id).first():null;
    let ok=env.STARS_VARIABLE_TOPUP_ENABLED==='true'&&
      env.STARS_PAYMENT_ENABLED==='true'&&validVariableStarsPrecheckout(row,q,now);
    if(ok&&row.status==='pending'){
      try{
        const reservation=await env.DB.prepare(
          "UPDATE rustup_stars_variable_orders SET status='checkout_approved',checkout_query_id=? "+
          "WHERE id=? AND status='pending' AND telegram_user_id=? "+
          "AND price_stars=? AND expires_at_ms>?"
        ).bind(q.id,row.id,q.from.id,row.price_stars,now).run();
        ok=reservation.meta?.changes===1;
      }catch{ok=false;}
    }
    await telegramApi(env,'answerPreCheckoutQuery',{
      pre_checkout_query_id:q.id,ok,
      ...(!ok?{error_message:'Payment unavailable or quote expired.'}:{})
    },fetchImpl);
    return {handled:true,type:'variable_pre_checkout',ok};
  }
  const msg=update?.message;
  const pay=msg?.successful_payment;
  if(pay&&typeof pay.invoice_payload==='string'&&pay.invoice_payload.startsWith('v:')){
    const id=fromPayload(pay.invoice_payload);
    if(!id||!env.DB){
      console.error('Unmatched Stars variable payment: invalid payload or DB unavailable');
      throw Error('variable_stars_receipt_unavailable');
    }
    const row=await env.DB.prepare(
      'SELECT * FROM rustup_stars_variable_orders WHERE id=?'
    ).bind(id).first();
    if(!validVariableStarsReceipt(row,msg)){
      console.error('Unmatched Stars variable receipt; investigate payment manually');
      return {handled:true,type:'variable_receipt',accepted:false};
    }
    const charge=pay.telegram_payment_charge_id;
    try{
      const result=await env.DB.prepare(
        "UPDATE rustup_stars_variable_orders SET status='paid',telegram_charge_id=?,paid_at_ms=? "+
        "WHERE id=? AND status='checkout_approved' AND telegram_user_id=? AND price_stars=?"
      ).bind(charge,now,row.id,row.telegram_user_id,row.price_stars).run();
      if(result.meta?.changes===1)
        return {handled:true,type:'variable_receipt',accepted:true,
          duplicate:false,creditedToGame:false,
          requestedAmountMinor:row.requested_amount_minor,currency:'RUB'};
    }catch{
      // Duplicate charge ID is rejected by UNIQUE. Other DB errors get retried.
      const existing=await env.DB.prepare(
        'SELECT status,telegram_charge_id FROM rustup_stars_variable_orders WHERE id=?'
      ).bind(row.id).first();
      if(existing?.status==='paid'&&existing.telegram_charge_id===charge)
        return {handled:true,type:'variable_receipt',accepted:true,
          duplicate:true,creditedToGame:false};
      throw Error('variable_stars_receipt_conflict');
    }
    const old=await env.DB.prepare(
      'SELECT status,telegram_charge_id FROM rustup_stars_variable_orders WHERE id=?'
    ).bind(row.id).first();
    if(old?.status==='paid'&&old.telegram_charge_id===charge)
      return {handled:true,type:'variable_receipt',accepted:true,
        duplicate:true,creditedToGame:false};
    throw Error('variable_stars_receipt_state_conflict');
  }
  return {handled:false};
}
