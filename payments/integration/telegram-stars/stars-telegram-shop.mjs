// Telegram-only fixed digital goods shop for the existing @rustuper_bot.
// No website, Mini App, public checkout API or game wallet balance.
// Always use the verified /tg webhook and existing independent PAYMENTS_DB.
import {permittedProduct,invoiceBody,telegramApi} from './stars.mjs';
import {isPaymentEnabled} from './payment-controls.mjs';
import {receiveExistingBotStarsUpdate} from './stars-live-bridge.mjs';

const SKU=/^[a-z][a-z0-9_-]{2,39}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PREFIX='rupstars:';
const TTL=15*60*1000;
const COMMAND=/^\/(stars|mypurchases|paysupport)(?:@rustuper_bot)?(?:\s|$)/i;
const safeText=x=>String(x??'').slice(0,1800);
const validUser=id=>Number.isSafeInteger(id)&&id>0;
const isPrivateMessage=m=>m?.chat?.type==='private'&&
 validUser(m?.from?.id)&&m.chat.id===m.from.id;

async function telegram(env,method,body,fetchImpl){
 return telegramApi({TG_STARS_BOT_TOKEN:env.BOT_TOKEN},method,body,fetchImpl);
}
async function send(env,chat,text,fetchImpl,markup){
 return telegram(env,'sendMessage',{
  chat_id:chat,text,
  ...(markup?{reply_markup:markup}:{})
 },fetchImpl);
}
async function canBuy(env){
 return env.STARS_FIXED_PRODUCTS_ENABLED==='true'&&
  !!env.PAYMENTS_DB&&await isPaymentEnabled(env,'stars');
}
async function catalogRows(env){
 if(!env.PAYMENTS_DB)throw Error('stars_database_unavailable');
 const r=await env.PAYMENTS_DB.prepare(
  'SELECT p.sku,p.title,p.description,p.price_stars FROM rustup_stars_products p '+
  'JOIN rustup_stars_fixed_content c ON c.sku=p.sku '+
  "WHERE p.enabled=1 AND p.kind='fixed_nontransferable' ORDER BY p.sku LIMIT 12"
 ).all();
 return (r?.results||[]).filter(p=>SKU.test(p.sku)&&
   Number.isSafeInteger(p.price_stars)&&p.price_stars>0);
}
export async function showTelegramStarsCatalog(env,chat,fetchImpl=fetch){
 const products=await catalogRows(env);
 const enabled=await canBuy(env);
 const text=[
  '⭐ RUST UP — цифровые товары',
  enabled?'Оплата через Telegram Stars.':'Продажи сейчас выключены.',
  'Только фиксированные, не передаваемые цифровые товары.',
  ...products.map(p=>safeText(p.title)+' — '+p.price_stars+' ⭐'),
  products.length?'':'Доступных товаров пока нет.'
 ].join('\n');
 const keys=enabled?products.map(p=>[{
  text:safeText(p.title).slice(0,28)+' · '+p.price_stars+' ⭐',
  callback_data:PREFIX+'buy:'+p.sku
 }]):[];
 keys.push([{text:'📦 Мои покупки',callback_data:PREFIX+'owned'}]);
 keys.push([{text:'🔄 Обновить',callback_data:PREFIX+'menu'}]);
 await send(env,chat,text,fetchImpl,{inline_keyboard:keys});
 return {enabled,products:products.length};
}
async function purchases(env,userId,fetchImpl){
 if(!env.PAYMENTS_DB)throw Error('stars_database_unavailable');
 const r=await env.PAYMENTS_DB.prepare(
  'SELECT o.id,o.sku,o.price_stars,o.paid_at_ms,c.delivery_text '+
  'FROM rustup_stars_orders o JOIN rustup_stars_order_content c ON c.order_id=o.id '+
  "WHERE o.telegram_user_id=? AND o.status='paid' AND c.unlocked_at_ms IS NOT NULL "+
  'ORDER BY o.paid_at_ms DESC LIMIT 10'
 ).bind(userId).all();
 const orders=r?.results||[];
 if(!orders.length){
  await send(env,userId,'📦 Оплаченных товаров пока нет. Наберите /stars для каталога.',fetchImpl);
  return;
 }
 await send(env,userId,'📦 Мои покупки ('+orders.length+' последних):',fetchImpl);
 for(const order of orders){
  await send(env,userId,
   '✅ '+safeText(order.sku)+' · '+order.price_stars+' ⭐'+
   '\nЗаказ: '+safeText(order.id)+
   '\n'+safeText(order.delivery_text),fetchImpl);
 }
}
// Atomic 15-minute reservation stops repeated button presses or concurrent
// callback deliveries from sending multiple independently payable invoices.
export async function sendTelegramStarsInvoice(env,userId,sku,fetchImpl=fetch){
 if(!validUser(userId)||!SKU.test(sku||''))throw Error('invalid_purchase_request');
 if(!await canBuy(env))throw Error('stars_checkout_disabled');
 const db=env.PAYMENTS_DB;
 const product=await db.prepare(
  'SELECT p.sku,p.title,p.description,p.kind,p.enabled,p.price_stars,c.delivery_text '+
  'FROM rustup_stars_products p JOIN rustup_stars_fixed_content c ON c.sku=p.sku '+
  'WHERE p.sku=?'
 ).bind(sku).first();
 if(!permittedProduct(product)||
    typeof product.delivery_text!=='string'||
    product.delivery_text.length<1||product.delivery_text.length>1800)
   throw Error('unavailable_fixed_product');

 const owned=await db.prepare(
  'SELECT id FROM rustup_stars_orders WHERE telegram_user_id=? AND sku=? '+
  "AND status='paid' LIMIT 1"
 ).bind(userId,sku).first();
 if(owned)throw Error('product_already_owned');

 const orderId=crypto.randomUUID(),now=Date.now();
 const lock=await db.prepare(
  'INSERT INTO rustup_stars_purchase_locks(telegram_user_id,sku,order_id,expires_at_ms) '+
  'VALUES(?,?,?,?) ON CONFLICT(telegram_user_id,sku) DO UPDATE SET '+
  'order_id=excluded.order_id,expires_at_ms=excluded.expires_at_ms '+
  'WHERE rustup_stars_purchase_locks.expires_at_ms<=?'
 ).bind(userId,sku,orderId,now+TTL,now).run();
 if(lock?.meta?.changes!==1)throw Error('invoice_already_open');

 await db.prepare(
  'INSERT INTO rustup_stars_orders '+
  '(id,telegram_user_id,sku,price_stars,status,created_at_ms,expires_at_ms) '+
  "VALUES (?,?,?,?,'pending',?,?)"
 ).bind(orderId,userId,sku,product.price_stars,now,now+TTL).run();
 await db.prepare(
  'INSERT INTO rustup_stars_order_content(order_id,delivery_text) VALUES(?,?)'
 ).bind(orderId,product.delivery_text).run();

 // sendInvoice creates a native Telegram payment message. provider_token
 // is omitted for XTR, and forwarding cannot pay this private-chat invoice.
 const message=await telegram(env,'sendInvoice',{
  chat_id:userId,...invoiceBody(product,orderId),
  start_parameter:'rupstars'
 },fetchImpl);
 if(!Number.isSafeInteger(message?.message_id))
  throw Error('telegram_invoice_delivery_unconfirmed');
 return {orderId,stars:product.price_stars};
}
async function answerCallback(env,callbackId,text,fetchImpl){
 return telegram(env,'answerCallbackQuery',{
  callback_query_id:callbackId,text:text.slice(0,180),show_alert:false
 },fetchImpl);
}
export function isTelegramStarsInteraction(update){
 const m=update?.message,q=update?.callback_query;
 return (isPrivateMessage(m)&&typeof m.text==='string'&&COMMAND.test(m.text.trim()))||
   (q?.data?.startsWith(PREFIX)===true)||
   update?.pre_checkout_query?.currency==='XTR'||
   m?.successful_payment?.currency==='XTR';
}
export async function handleTelegramOnlyStarsUpdate(update,env,fetchImpl=fetch){
 const m=update?.message,cb=update?.callback_query;
 // Payment updates are routed by the already secret-authenticated /tg handler.
 if(update?.pre_checkout_query?.currency==='XTR'||
    m?.successful_payment?.currency==='XTR'){
  const paid=m?.successful_payment;
  const done=await receiveExistingBotStarsUpdate(update,env,fetchImpl);
  if(done&&paid&&UUID.test(String(paid.invoice_payload||''))){
   // Native Telegram receipt is the authoritative payment confirmation;
   // users can always retrieve unlocked content with /mypurchases.
   try {
    await send(env,m.from.id,
     '✅ Квитанция Telegram получена. Товар: /mypurchases.\nПоддержка: /paysupport',
     fetchImpl);
   } catch(e){console.error('stars_receipt_notice_failed');}
  }
  return done;
 }
 if(isPrivateMessage(m)&&typeof m.text==='string'){
  const match=COMMAND.exec(m.text.trim());
  if(!match)return false;
  if(match[1].toLowerCase()==='paysupport'){
   await send(env,m.from.id,
    'Поддержка оплаты Stars: @rustuperhelp_bot. Сохраните чек Telegram и номер заказа. Не отправляйте пароли.',fetchImpl);
   return true;
  }
  if(match[1].toLowerCase()==='mypurchases'){
   await purchases(env,m.from.id,fetchImpl);return true;
  }
  await showTelegramStarsCatalog(env,m.from.id,fetchImpl);return true;
 }
 if(cb?.data?.startsWith(PREFIX)){
  if(!isPrivateMessage({chat:cb.message?.chat,from:cb.from})||
     typeof cb.id!=='string')return false;
  // Acknowledge inline button before any D1 or payment API operations.
  await answerCallback(env,cb.id,'Обрабатываю…',fetchImpl);
  const data=cb.data.slice(PREFIX.length);
  try {
   if(data==='menu')await showTelegramStarsCatalog(env,cb.from.id,fetchImpl);
   else if(data==='owned')await purchases(env,cb.from.id,fetchImpl);
   else if(data.startsWith('buy:')){
    const sku=data.slice(4);
    if(!SKU.test(sku))throw Error('invalid_product');
    await sendTelegramStarsInvoice(env,cb.from.id,sku,fetchImpl);
   } else return true;
  }catch(e){
   const known={
    stars_checkout_disabled:'Платежи временно выключены.',
    invoice_already_open:'У вас уже есть активный счёт. Подождите до 15 минут.',
    product_already_owned:'Товар уже куплен. Используйте /mypurchases.',
    unavailable_fixed_product:'Этот товар сейчас недоступен.'
   };
   const msg=known[e?.message]||'Не удалось выполнить запрос. Попробуйте позже или обратитесь в поддержку.';
   await send(env,cb.from.id,msg,fetchImpl);
  }
  return true;
 }
 return false;
}
