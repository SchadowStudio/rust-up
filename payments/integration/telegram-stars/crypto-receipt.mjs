// Independent external-store integration for the pre-existing crypto provider.
// NOT for Telegram Mini App digital goods or any chance-based / cash-out product.
// Handles only project-signed fixed-good payment events; NEVER credits game coins.
import {verifyProjectCallback} from '../project-ledger/worker.js';

const ACCEPTED_ASSETS = new Set([
  'BTC','ETH','TRX','USDT_ERC20','USDT_TRC20','TON'
]);

export async function recordExternalFixedReceipt(request, env, now=Date.now()) {
  if (env.EXTERNAL_FIXED_RECEIPTS_ENABLED !== 'true')
    return {accepted:false,disabled:true};
  if (!env.EXTERNAL_DB)
    return {accepted:false,error:'external_staging_db_unavailable'};

  // Existing provider helper authenticates exact raw bytes, project ID,
  // event ID, signing timestamp and HMAC before a database lookup.
  let event;
  try {
    ({event}=await verifyProjectCallback(request,env,now));
  } catch {
    return {accepted:false,error:'invalid_project_callback'};
  }
  if (!ACCEPTED_ASSETS.has(event.asset))
    return {accepted:false,error:'unsupported_asset'};

  const db=env.EXTERNAL_DB;
  const row=await db.prepare(
    'SELECT project_order_ref,product_kind,currency,amount_minor,asset,' +
    'provider_invoice_id,status,provider_event_id FROM rustup_external_fixed_orders ' +
    'WHERE project_order_ref=?'
  ).bind(event.projectOrderRef).first();

  if (!row || row.product_kind!=='fixed_nontransferable' ||
      row.currency!==event.currency || row.amount_minor!==event.amountMinor ||
      row.asset!==event.asset || row.provider_invoice_id!==event.invoiceId)
    return {accepted:false,error:'unexpected_external_order'};

  if (row.status==='paid_confirmed')
    return row.provider_event_id===event.eventId
      ? {accepted:true,duplicate:true,fulfillment:'MANUAL_FIXED_GOOD_ONLY'}
      : {accepted:false,error:'conflicting_replay'};

  if (row.status!=='pending')
    return {accepted:false,error:'order_closed'};

  try {
    const result=await db.prepare(
      "UPDATE rustup_external_fixed_orders SET status='paid_confirmed', " +
      "provider_event_id=?,confirmed_at_ms=? WHERE project_order_ref=? " +
      "AND status='pending' AND provider_invoice_id=? AND currency=? " +
      "AND amount_minor=? AND asset=? AND product_kind='fixed_nontransferable'"
    ).bind(event.eventId,now,event.projectOrderRef,event.invoiceId,
      event.currency,event.amountMinor,event.asset).run();

    if (result.meta?.changes===1)
      return {accepted:true,duplicate:false,fulfillment:'MANUAL_FIXED_GOOD_ONLY'};

    const existing=await db.prepare(
      'SELECT status,provider_event_id FROM rustup_external_fixed_orders WHERE project_order_ref=?'
    ).bind(event.projectOrderRef).first();
    if (existing?.status==='paid_confirmed' &&
        existing.provider_event_id===event.eventId)
      return {accepted:true,duplicate:true,fulfillment:'MANUAL_FIXED_GOOD_ONLY'};
    return {accepted:false,error:'conflicting_replay'};
  } catch {
    return {accepted:false,error:'storage_error_or_duplicate_payment'};
  }
}
