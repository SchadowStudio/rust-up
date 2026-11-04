// Telegram Stars adapter for fixed, non-transferable digital goods only.
// No gambling balance, random item, withdrawable coin or skin/NFT fulfillment.
// Not connected to the live rustup-bot Worker. Disabled unless configured.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_AGE_MS = 15 * 60 * 1000;

export function permittedProduct(p) {
  return !!p && p.enabled === 1 && p.kind === 'fixed_nontransferable' &&
    typeof p.sku === 'string' && p.sku.length >= 1 && p.sku.length <= 64 &&
    typeof p.title === 'string' && p.title.length >= 1 && p.title.length <= 32 &&
    typeof p.description === 'string' && p.description.length >= 1 &&
    p.description.length <= 255 && Number.isSafeInteger(p.price_stars) &&
    p.price_stars > 0 && p.price_stars <= 1000000;
}

function validUserId(id) {
  return Number.isSafeInteger(id) && id > 0;
}

export function validPreCheckout(order, query, now = Date.now()) {
  return !!order && !!query && UUID.test(String(order.id)) &&
    order.status === 'pending' && validUserId(query.from?.id) &&
    query.from.id === order.telegram_user_id &&
    Number.isSafeInteger(order.price_stars) && order.price_stars > 0 &&
    order.expires_at_ms > now && order.expires_at_ms <= now + MAX_AGE_MS &&
    query.currency === 'XTR' && query.total_amount === order.price_stars &&
    query.invoice_payload === order.id;
}

export function validSuccessfulPayment(order, message, now = Date.now()) {
  const pay = message?.successful_payment;
  // SuccessfulPayment is authoritative after Telegram sends it. A delayed
  // webhook must still be recorded even if the 15-minute checkout TTL passed.
  return !!pay && !!order && UUID.test(String(order.id)) &&
    (order.status === 'pending' || order.status === 'paid') &&
    validUserId(message?.from?.id) &&
    message.from.id === order.telegram_user_id &&
    pay.currency === 'XTR' && pay.total_amount === order.price_stars &&
    pay.invoice_payload === order.id &&
    typeof pay.telegram_payment_charge_id === 'string' &&
    pay.telegram_payment_charge_id.length >= 1 &&
    pay.telegram_payment_charge_id.length <= 256;
}

export function invoiceBody(product, orderId) {
  if (!permittedProduct(product) || !UUID.test(String(orderId)))
    throw Error('invalid_nonwager_product_or_order');
  // No provider_token for Telegram Stars; XTR is integer Stars, not minor fiat units.
  return {
    title: product.title, description: product.description,
    payload: orderId, currency: 'XTR',
    prices: [{label: product.title, amount: product.price_stars}]
  };
}

function equalSecret(a, b) {
  if (!a || !b || typeof a !== 'string' || typeof b !== 'string')
    return false;
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  let d = aa.length ^ bb.length;
  for (let i = 0; i < Math.max(aa.length, bb.length); i++)
    d |= (aa[i] || 0) ^ (bb[i] || 0);
  return d === 0;
}

export function verifiedWebhook(request, env) {
  return equalSecret(request.headers.get('x-telegram-bot-api-secret-token'),
    env.TG_STARS_WEBHOOK_SECRET);
}

async function telegramApi(env, method, body, fetchImpl) {
  if (!env.TG_STARS_BOT_TOKEN || !/^[0-9]+:[A-Za-z0-9_-]{20,}$/.test(env.TG_STARS_BOT_TOKEN))
    throw Error('telegram_bot_not_configured');
  const response = await fetchImpl('https://api.telegram.org/bot' +
    env.TG_STARS_BOT_TOKEN + '/' + method, {
      method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify(body), redirect: 'error'
    });
  if (!response.ok) throw Error('telegram_gateway_unavailable');
  const result = await response.json();
  if (!result.ok) throw Error('telegram_api_rejected');
  return result.result;
}

// verifiedTelegramUserId MUST come from server-side validated Telegram initData.
// Never pass a browser-supplied Telegram ID to this function.
export async function createStarsCheckout(env, {
  verifiedTelegramUserId, sku, now = Date.now(), fetchImpl = fetch
}) {
  if (env.STARS_PAYMENT_ENABLED !== 'true')
    throw Error('stars_checkout_disabled');
  if (!validUserId(verifiedTelegramUserId) || !env.DB || typeof sku !== 'string')
    throw Error('unauthenticated_or_unconfigured');
  const product = await env.DB.prepare(
    'SELECT sku,title,description,kind,enabled,price_stars FROM rustup_stars_products WHERE sku=?'
  ).bind(sku).first();
  if (!permittedProduct(product)) throw Error('product_not_available');
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO rustup_stars_orders(id,telegram_user_id,sku,price_stars,status,created_at_ms,expires_at_ms) VALUES(?,?,?,?, 'pending',?,?)"
  ).bind(id,verifiedTelegramUserId,sku,product.price_stars,now,now+MAX_AGE_MS).run();
  const link = await telegramApi(env,'createInvoiceLink',invoiceBody(product,id),fetchImpl);
  if (typeof link !== 'string' || !/^https:\/\//.test(link))
    throw Error('invalid_invoice_link');
  return {orderId:id,invoiceUrl:link,expiresAtMs:now+MAX_AGE_MS};
}

export async function saveReceipt(db, order, message, now = Date.now()) {
  if (!validSuccessfulPayment(order, message, now))
    return {accepted:false,reason:'receipt_mismatch'};
  const charge = message.successful_payment.telegram_payment_charge_id;
  try {
    const res = await db.prepare(
      "UPDATE rustup_stars_orders SET status='paid',telegram_charge_id=?,paid_at_ms=? " +
      "WHERE id=? AND status='pending' AND telegram_user_id=? AND price_stars=?"
    ).bind(charge,now,order.id,message.from.id,order.price_stars).run();
    if (res.meta?.changes === 1)
      return {accepted:true,duplicate:false,fulfillment:'MANUAL_FIXED_GOOD_ONLY'};
  } catch {
    // Unique charge conflict or storage failure must never credit the user.
    return {accepted:false,reason:'database_conflict'};
  }
  const previous = await db.prepare(
    'SELECT status,telegram_charge_id FROM rustup_stars_orders WHERE id=?'
  ).bind(order.id).first();
  if (previous?.status === 'paid' && previous.telegram_charge_id === charge)
    return {accepted:true,duplicate:true,fulfillment:'MANUAL_FIXED_GOOD_ONLY'};
  return {accepted:false,reason:'already_paid_or_expired'};
}

export async function handleStarsUpdate(update, env, fetchImpl = fetch) {
  if (env.STARS_PAYMENT_ENABLED !== 'true')
    return {handled:false,disabled:true};
  const q = update?.pre_checkout_query;
  if (q) {
    const order = UUID.test(String(q.invoice_payload))
      ? await env.DB.prepare(
        'SELECT id,telegram_user_id,price_stars,status,expires_at_ms FROM rustup_stars_orders WHERE id=?'
      ).bind(q.invoice_payload).first() : null;
    const ok = validPreCheckout(order,q);
    await telegramApi(env,'answerPreCheckoutQuery',{
      pre_checkout_query_id:q.id,ok,
      ...(!ok?{error_message:'Order unavailable, expired or mismatched.'}:{})
    },fetchImpl);
    return {handled:true,type:'pre_checkout',ok};
  }
  const msg = update?.message;
  if (msg?.successful_payment) {
    const id = msg.successful_payment.invoice_payload;
    const order = UUID.test(String(id)) ? await env.DB.prepare(
      'SELECT id,telegram_user_id,price_stars,status,expires_at_ms FROM rustup_stars_orders WHERE id=?'
    ).bind(id).first() : null;
    if (!order) return {handled:true,type:'receipt',accepted:false};
    return {handled:true,type:'receipt',...await saveReceipt(env.DB,order,msg)};
  }
  return {handled:false};
}

// Optional endpoint helper. If an existing Telegram webhook exists, integrate
// handleStarsUpdate into its authenticated dispatcher; do NOT overwrite it.
export async function receiveStarsWebhook(request, env, fetchImpl = fetch) {
  if (request.method !== 'POST') return new Response('Not found',{status:404});
  if (!verifiedWebhook(request,env)) return new Response('Forbidden',{status:403});
  const text = await request.text();
  if (text.length > 65536) return new Response('Too large',{status:413});
  let update;
  try { update = JSON.parse(text); } catch {
    return new Response('Invalid JSON',{status:400});
  }
  await handleStarsUpdate(update,env,fetchImpl);
  return Response.json({ok:true});
}
