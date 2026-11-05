// RUST UP supporter badge (fixed non-transferable digital good).
// Only the isolated Stars PAYMENTS_DB is accessed, NEVER the game wallet.
// A verified XTR receipt must already be persisted and its fixed delivery
// snapshot unlocked by the existing authenticated webhook before granting.
export const SUPPORTER_BADGE_SKU='supporter_badge_v1';
export const SUPPORTER_BADGE_TITLE='RUST UP Supporter';
export const SUPPORTER_BADGE_DESCRIPTION=
 'Permanent profile supporter badge. No game advantage, wagering, transfer or payout.';
export const SUPPORTER_BADGE_CONTENT=
 '⭐ RUST UP Supporter: Dein nicht übertragbares Profil-Abzeichen ist aktiv. '+
 'Keine Coins, Cases, Gewinne, Auszahlungen oder Spielvorteile. '+
 'Bei einer Rückerstattung wird es entzogen.';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function userIdOk(id){return Number.isSafeInteger(id)&&id>0;}
function chargeOk(s){return typeof s==='string'&&s.length>=1&&s.length<=256;}

export async function grantSupporterBadge(db,{orderId,userId,chargeId,at=Date.now()}){
 if(!db||typeof db.prepare!=='function'||!UUID.test(orderId||'')||
    !userIdOk(userId)||!chargeOk(chargeId)||
    !Number.isSafeInteger(at)||at<=0)
  throw Error('invalid_supporter_delivery_request');
 // Do not infer ownership from browser-supplied identities or invoice URLs.
 const order=await db.prepare(
  'SELECT sku,status,telegram_charge_id FROM rustup_stars_orders '+
  'WHERE id=? AND telegram_user_id=?'
 ).bind(orderId,userId).first();
 if(!order)throw Error('supporter_order_missing');
 if(order.sku!==SUPPORTER_BADGE_SKU)
  return {applicable:false,gameBalanceChanged:false};
 if(order.status!=='paid'||order.telegram_charge_id!==chargeId)
  throw Error('supporter_receipt_not_verified');
 // Conditional INSERT is based on CURRENT paid order state and an actually
 // unlocked delivery snapshot. It cannot revive a refunded purchase.
 await db.prepare(
  'INSERT INTO rustup_stars_supporter_badges '+
  '(order_id,telegram_user_id,sku,telegram_charge_id,status,granted_at_ms) '+
  "SELECT o.id,o.telegram_user_id,o.sku,o.telegram_charge_id,'active',? "+
  'FROM rustup_stars_orders o '+
  'JOIN rustup_stars_order_content c ON c.order_id=o.id '+
  "WHERE o.id=? AND o.telegram_user_id=? AND o.sku='supporter_badge_v1' "+
  "AND o.status='paid' AND o.telegram_charge_id=? "+
  'AND c.unlocked_at_ms IS NOT NULL '+
  'ON CONFLICT(order_id) DO NOTHING'
 ).bind(at,orderId,userId,chargeId).run();
 // Never treat a unique-conflict or ambiguous database outcome as delivered.
 const badge=await db.prepare(
  'SELECT telegram_user_id,telegram_charge_id,status,granted_at_ms '+
  'FROM rustup_stars_supporter_badges WHERE order_id=?'
 ).bind(orderId).first();
 if(!badge||badge.status!=='active'||
    badge.telegram_user_id!==userId||
    badge.telegram_charge_id!==chargeId||
    !Number.isSafeInteger(badge.granted_at_ms))
  throw Error('supporter_entitlement_not_confirmed');
 return {applicable:true,active:true,gameBalanceChanged:false};
}

export async function readSupporterBadge(db,telegramUserId){
 if(!db||!userIdOk(telegramUserId))
  throw Error('supporter_identity_required');
 const row=await db.prepare(
  'SELECT order_id,granted_at_ms FROM rustup_stars_supporter_badges '+
  "WHERE telegram_user_id=? AND sku='supporter_badge_v1' AND status='active' "+
  'ORDER BY granted_at_ms DESC LIMIT 1'
 ).bind(telegramUserId).first();
 return {
  active:!!row,
  sku:SUPPORTER_BADGE_SKU,
  label:SUPPORTER_BADGE_TITLE,
  grantedAtMs:row?.granted_at_ms||null,
  gameBalanceChanged:false,
  transferable:false,
  redeemable:false,
  usableForWagers:false
 };
}

export function supporterRefundStatement(db,orderId,at=Date.now()){
 if(!db||!UUID.test(orderId||'')||!Number.isSafeInteger(at)||at<=0)
  throw Error('invalid_supporter_refund_revoke');
 // Include in the SAME D1 batch transaction as order/content/refund intent.
 return db.prepare(
  "UPDATE rustup_stars_supporter_badges SET status='revoked',revoked_at_ms=? "+
  "WHERE order_id=? AND status='active'"
 ).bind(at,orderId);
}
