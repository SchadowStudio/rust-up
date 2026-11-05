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
    q.invoice_payload===payload(row.id)&&row.expires_at_ms>now&&
    // A payment must never be approved without a durable invoice record.
    typeof row.invoice_url==='string'&&
    /^https:\/\/\S+$/.test(row.invoice_url)&&row.invoice_url.length<=1024;
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

// Persist unmatched or inconsistent XTR receipts for operator investigation.
// An acknowledged incident must be durable, never a silently lost payment.
export async function recordUnexpectedVariableStarsReceipt(db,msg,now=Date.now()){
  const pay=msg?.successful_payment;
  const charge=pay?.telegram_payment_charge_id;
  if(!db?.prepare||!Number.isSafeInteger(now)||now<=0||
     !Number.isSafeInteger(msg?.from?.id)||msg.from.id<=0||
     typeof charge!=='string'||charge.length<1||charge.length>256||
     pay.currency!=='XTR'||!Number.isSafeInteger(pay.total_amount)||
     pay.total_amount<1||
     typeof pay.invoice_payload!=='string'||!pay.invoice_payload.startsWith('v:'))
    throw Error('variable_receipt_evidence_incomplete_retry');
  const result=await db.prepare(
    'INSERT OR IGNORE INTO rustup_stars_receipt_incidents '+
    '(telegram_charge_id,telegram_user_id,invoice_payload,price_stars,reason,occurred_at_ms) '+
    'VALUES(?,?,?,?,?,?)'
  ).bind(charge,msg.from.id,pay.invoice_payload.slice(0,256),
     pay.total_amount,'variable_receipt_mismatch',now).run();
  // An ignored duplicate is safe: the prior incident must still be present.
  if(result?.meta?.changes===1)return {stored:true,duplicate:false};
  const existing=await db.prepare(
    'SELECT telegram_charge_id,telegram_user_id,invoice_payload,price_stars,reason '+
    'FROM rustup_stars_receipt_incidents WHERE telegram_charge_id=?'
  ).bind(charge).first();
  if(!existing||existing.telegram_user_id!==msg.from.id||
     existing.invoice_payload!==pay.invoice_payload.slice(0,256)||
     existing.price_stars!==pay.total_amount||
     existing.reason!=='variable_receipt_mismatch')
    throw Error('variable_receipt_incident_conflict_retry');
  return {stored:true,duplicate:true};
}

// A second charge for an already paid invoice is not a harmless replay.
// Preserve the evidence before acknowledging Telegram; never give it credit.
async function quarantineVariableReceipt(db,msg,now){
  const incident=await recordUnexpectedVariableStarsReceipt(db,msg,now);
  return {handled:true,type:'variable_receipt',accepted:false,
    incidentRecorded:incident.stored,creditedToGame:false};
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
    if(!env.DB){
      console.error('Variable Stars receipt cannot be recorded without D1');
      throw Error('variable_stars_receipt_unavailable');
    }
    if(!id){
      // Telegram may have charged for an invalid/stale payload. Quarantine
      // complete evidence rather than forever returning 503 for that charge.
      return quarantineVariableReceipt(env.DB,msg,now);
    }
    const row=await env.DB.prepare(
      'SELECT * FROM rustup_stars_variable_orders WHERE id=?'
    ).bind(id).first();
    if(!validVariableStarsReceipt(row,msg)){
      // Do not lose an unexpected payment or loop on Telegram webhook retries.
      // Only acknowledge after an incident was saved in the isolated D1.
      console.error('Unmatched Stars variable receipt recorded for operator review');
      return quarantineVariableReceipt(env.DB,msg,now);
    }
    const charge=pay.telegram_payment_charge_id;
    if(row.status==='paid'){
      if(row.telegram_charge_id===charge)
        return {handled:true,type:'variable_receipt',accepted:true,
          duplicate:true,creditedToGame:false};
      // Telegram can send an additional actual charge against the same invoice.
      // It requires human refund/reconciliation, not an endless HTTP 503 loop.
      return quarantineVariableReceipt(env.DB,msg,now);
    }
    try{
      const result=await env.DB.prepare(
        "UPDATE rustup_stars_variable_orders SET status='paid',telegram_charge_id=?,paid_at_ms=? "+
        "WHERE id=? AND status='checkout_approved' AND telegram_user_id=? AND price_stars=?"
      ).bind(charge,now,row.id,row.telegram_user_id,row.price_stars).run();
      if(result.meta?.changes===1)
        return {handled:true,type:'variable_receipt',accepted:true,
          duplicate:false,creditedToGame:false,
          requestedAmountMinor:row.requested_amount_minor,currency:'RUB'};
    }catch(error){
      // Only a proven uniqueness collision may be quarantined. Transient D1
      // errors MUST propagate so Telegram retries rather than losing a charge.
      const existing=await env.DB.prepare(
        'SELECT status,telegram_charge_id FROM rustup_stars_variable_orders WHERE id=?'
      ).bind(row.id).first();
      if(existing?.status==='paid'){
        if(existing.telegram_charge_id===charge)
          return {handled:true,type:'variable_receipt',accepted:true,
            duplicate:true,creditedToGame:false};
        return quarantineVariableReceipt(env.DB,msg,now);
      }
      if(/UNIQUE constraint failed[^\n]*telegram_charge_id/i.test(String(error?.message||'')))
        return quarantineVariableReceipt(env.DB,msg,now);
      throw Error('variable_stars_receipt_database_retry');
    }
    const old=await env.DB.prepare(
      'SELECT status,telegram_charge_id FROM rustup_stars_variable_orders WHERE id=?'
    ).bind(row.id).first();
    if(old?.status==='paid'){
      if(old.telegram_charge_id===charge)
        return {handled:true,type:'variable_receipt',accepted:true,
          duplicate:true,creditedToGame:false};
      return quarantineVariableReceipt(env.DB,msg,now);
    }
    throw Error('variable_stars_receipt_state_conflict');
  }
  return {handled:false};
}
