// Server-only adapter for a SEPARATE external store using the existing
// RUST UP multi-project crypto provider. Never invoke from Telegram Mini Apps.
// STAGING ONLY: no money, no game coins and no fulfillment are enabled.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ASSETS=new Set(['BTC','ETH','TRX','USDT_ERC20','USDT_TRC20','TON']);
const FIATS=new Set(['EUR','RUB','USD']);

function gatewayOrigin(raw) {
  if(typeof raw!=='string')throw Error('provider_url_not_configured');
  const url=new URL(raw);
  if(url.protocol!=='https:'||url.username||url.password||url.hash||
      url.search||url.pathname!=='/'||raw.replace(/\/$/,'')!==url.origin)
    throw Error('invalid_crypto_provider_origin');
  return url.origin;
}

function goodProduct(p) {
  return !!p&&p.enabled===1&&p.kind==='fixed_nontransferable'&&
    typeof p.sku==='string'&&/^[a-z][a-z0-9_-]{2,39}$/.test(p.sku)&&
    FIATS.has(p.currency)&&Number.isSafeInteger(p.amount_minor)&&
    p.amount_minor>=100&&p.amount_minor<=100000000;
}

function safeInvoice(i,order) {
  if(!i||!UUID.test(i.invoiceId)||i.projectOrderRef!==order.project_order_ref||
    i.fiat!==order.currency||i.amountMinor!==order.amount_minor||
    i.asset!==order.asset||i.confirmedOnChain!==false||
    !['BTC','ETH','TRX','USDT_ERC20','USDT_TRC20','TON'].includes(i.asset)||
    typeof i.receiveAddress!=='string'||i.receiveAddress.length<15||
    typeof i.amountAtomic!=='string'||!/^[1-9][0-9]*$/.test(i.amountAtomic)||
    typeof i.expiresAt!=='number'||!Number.isSafeInteger(i.expiresAt))
    throw Error('provider_invoice_invalid');
  return {
    invoiceId:i.invoiceId,orderId:order.project_order_ref,
    asset:i.asset,fiat:i.fiat,amountMinor:i.amountMinor,
    amountAtomic:i.amountAtomic,receiveAddress:i.receiveAddress,
    chain:i.chain,expiresAtMs:i.expiresAt,
    paymentVerified:false,fulfilled:false
  };
}

export async function providerInvoice(env,order,fetchImpl) {
  const origin=gatewayOrigin(env.CRYPTO_PROVIDER_URL);
  if(!/^rup2_[0-9a-f]{64}$/.test(env.CRYPTO_PROJECT_API_KEY||'')||
    !UUID.test(env.CRYPTO_PROJECT_ID||''))
    throw Error('crypto_provider_credentials_missing');
  const res=await fetchImpl(origin+'/v2/deposits',{
    method:'POST',redirect:'error',headers:{
      'authorization':'Bearer '+env.CRYPTO_PROJECT_API_KEY,
      'x-project-id':env.CRYPTO_PROJECT_ID,
      'idempotency-key':order.merchant_request_id,
      'content-type':'application/json'
    },
    body:JSON.stringify({
      currency:order.currency,amountMinor:order.amount_minor,
      asset:order.asset,projectOrderRef:order.project_order_ref
    }),
    signal:AbortSignal.timeout(12000)
  });
  if(!res.ok)throw Error('provider_unavailable_or_rejected');
  const data=await res.json();
  if(data?.ok!==true)throw Error('provider_rejected');
  return safeInvoice(data.invoice,order);
}

// verifiedExternalCustomerRef is a SEPARATE storefront's authenticated ID.
// merchantRequestId is a durable UUID supplied by trusted merchant backend;
// retries with this ID reuse the same blockchain invoice.
export async function createExternalCryptoCheckout(env,{
  verifiedExternalCustomerRef,merchantRequestId,sku,asset,fetchImpl=fetch
}) {
  if(env.EXTERNAL_CRYPTO_CHECKOUT_ENABLED!=='true')
    throw Error('external_crypto_checkout_disabled');
  if(!env.EXTERNAL_DB||!UUID.test(verifiedExternalCustomerRef||'')||
    !UUID.test(merchantRequestId||'')||!ASSETS.has(asset))
    throw Error('external_store_request_invalid');

  const db=env.EXTERNAL_DB;
  const product=await db.prepare(
    "SELECT sku,kind,currency,amount_minor,enabled FROM rustup_external_fixed_products WHERE sku=?"
  ).bind(sku).first();
  if(!goodProduct(product))throw Error('fixed_product_unavailable');

  let order=await db.prepare(
    'SELECT * FROM rustup_external_fixed_orders WHERE merchant_request_id=?'
  ).bind(merchantRequestId).first();
  if(order){
    if(order.external_customer_ref!==verifiedExternalCustomerRef||
      order.sku!==sku||order.asset!==asset||
      order.currency!==product.currency||order.amount_minor!==product.amount_minor)
      throw Error('idempotency_conflict');
    if(order.status!=='pending')throw Error('external_order_closed');
  }else{
    const orderRef=crypto.randomUUID();
    try {
      await db.prepare(
        "INSERT INTO rustup_external_fixed_orders(" +
        "project_order_ref,merchant_request_id,external_customer_ref,sku," +
        "product_kind,currency,amount_minor,asset,status)" +
        " VALUES(?,?,?,?, 'fixed_nontransferable',?,?,?,'pending')"
      ).bind(orderRef,merchantRequestId,verifiedExternalCustomerRef,sku,
        product.currency,product.amount_minor,asset).run();
    }catch {
      // Unique idempotency conflict: reload and validate on next retry.
    }
    order=await db.prepare(
      'SELECT * FROM rustup_external_fixed_orders WHERE merchant_request_id=?'
    ).bind(merchantRequestId).first();
    if(!order||order.external_customer_ref!==verifiedExternalCustomerRef||
       order.sku!==sku||order.currency!==product.currency||
       order.amount_minor!==product.amount_minor||order.asset!==asset||
       order.status!=='pending')throw Error('external_order_conflict');
  }

  const invoice=await providerInvoice(env,order,fetchImpl);
  if(order.provider_invoice_id && order.provider_invoice_id!==invoice.invoiceId)
    throw Error('provider_invoice_changed');
  if(!order.provider_invoice_id){
    const res=await db.prepare(
      'UPDATE rustup_external_fixed_orders SET provider_invoice_id=? ' +
      'WHERE project_order_ref=? AND provider_invoice_id IS NULL AND status=?'
    ).bind(invoice.invoiceId,order.project_order_ref,'pending').run();
    if(res.meta?.changes!==1){
      const latest=await db.prepare(
        'SELECT provider_invoice_id FROM rustup_external_fixed_orders WHERE project_order_ref=?'
      ).bind(order.project_order_ref).first();
      if(latest?.provider_invoice_id!==invoice.invoiceId)
        throw Error('invoice_link_conflict');
    }
  }
  return invoice;
}
