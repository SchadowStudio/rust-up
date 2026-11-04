// RUST UP GAME SANDBOX: DEMO POINTS ONLY. Not a real-money settlement adapter.
// Deliberately no HTTP handler, no Telegram invoice, no blockchain address and
// no access to the actual RUST UP game/skin balance. Never import into live Worker.
const SOURCES=new Set(['demo_stars','demo_crypto','demo_game_spend','demo_refund']);
const SOURCE_REF=/^[A-Za-z0-9:_-]{8,128}$/;
const MAX_UNITS=1000000,MAX_BALANCE=100000000;
function positiveId(n){return Number.isSafeInteger(n)&&n>0;}
function units(n){return Number.isSafeInteger(n)&&n>=1&&n<=MAX_UNITS;}
function valid(db,userId,source,reference,delta){
 if(!db||typeof db.prepare!=='function'||typeof db.batch!=='function')
  throw Error('sandbox_database_missing');
 if(!positiveId(userId)||!SOURCES.has(source)||!SOURCE_REF.test(reference||'')||
    !Number.isSafeInteger(delta)||Math.abs(delta)<1||Math.abs(delta)>MAX_UNITS)
  throw Error('invalid_sandbox_event');
 if((source==='demo_stars'||source==='demo_crypto')&&delta<0)
  throw Error('sandbox_credit_must_be_positive');
 if((source==='demo_game_spend'||source==='demo_refund')&&delta>0)
  throw Error('sandbox_debit_must_be_negative');
}
export async function getDemoWallet(db,userId){
 if(!positiveId(userId)||!db)throw Error('sandbox_identity_required');
 const account=await db.prepare(
  'SELECT balance_units,updated_at_ms FROM rustup_demo_wallet_accounts WHERE telegram_user_id=?'
 ).bind(userId).first();
 const history=await db.prepare(
  'SELECT source,source_ref,delta_units,status,created_at_ms,settled_at_ms '+
  'FROM rustup_demo_wallet_events WHERE telegram_user_id=? '+
  'ORDER BY created_at_ms DESC,id DESC LIMIT 30'
 ).bind(userId).all();
 return {userId,balanceUnits:account?.balance_units||0,history:history?.results||[],
  simulated:true,redeemable:false,withdrawable:false,gameStakesAllowed:false};
}
export async function applyDemoWalletEvent(db,{
 userId,source,reference,delta,now=Date.now()
}){
 valid(db,userId,source,reference,delta);
 if(!Number.isSafeInteger(now)||now<=0)throw Error('invalid_sandbox_time');
 const original=await db.prepare(
  'SELECT telegram_user_id,delta_units,status FROM rustup_demo_wallet_events '+
  'WHERE source=? AND source_ref=?'
 ).bind(source,reference).first();
 if(original&&(original.telegram_user_id!==userId||original.delta_units!==delta))
  throw Error('sandbox_event_reference_conflict');
 if(original?.status==='applied')
  return {applied:false,duplicate:true,...await getDemoWallet(db,userId)};
 if(original?.status==='manual_review')throw Error('sandbox_event_requires_review');
 const eventId=crypto.randomUUID();
 // D1 batch is a single transaction. Only a pending, matching event allows an
 // account mutation; after that, the event becomes applied in the SAME batch.
 // A concurrent replay is serialized by the unique (source,source_ref) key.
 const results=await db.batch([
  db.prepare(
   'INSERT OR IGNORE INTO rustup_demo_wallet_accounts '+
   '(telegram_user_id,balance_units,updated_at_ms) VALUES(?,0,?)'
  ).bind(userId,now),
  db.prepare(
   'INSERT OR IGNORE INTO rustup_demo_wallet_events '+
   '(id,telegram_user_id,source,source_ref,delta_units,status,created_at_ms) '+
   "VALUES(?,?,?,?,?,'pending',?)"
  ).bind(eventId,userId,source,reference,delta,now),
  db.prepare(
   'UPDATE rustup_demo_wallet_accounts SET balance_units=balance_units+?, '+
   'last_applied_event=(SELECT id FROM rustup_demo_wallet_events '+
   "WHERE source=? AND source_ref=? AND status='pending'),updated_at_ms=? "+
   'WHERE telegram_user_id=? AND balance_units+? BETWEEN 0 AND ? '+
   'AND EXISTS (SELECT 1 FROM rustup_demo_wallet_events WHERE source=? '+
   "AND source_ref=? AND status='pending' AND telegram_user_id=? AND delta_units=?)"
  ).bind(delta,source,reference,now,userId,delta,MAX_BALANCE,
    source,reference,userId,delta),
  db.prepare(
   "UPDATE rustup_demo_wallet_events SET status='applied',settled_at_ms=? "+
   "WHERE source=? AND source_ref=? AND status='pending' "+
   'AND telegram_user_id=? AND delta_units=? '+
   'AND EXISTS (SELECT 1 FROM rustup_demo_wallet_accounts WHERE telegram_user_id=? '+
   'AND last_applied_event=rustup_demo_wallet_events.id)'
  ).bind(now,source,reference,userId,delta,userId)
 ]);
 const accountChanges=results[2]?.meta?.changes;
 const eventChanges=results[3]?.meta?.changes;
 const latest=await db.prepare(
  'SELECT telegram_user_id,delta_units,status FROM rustup_demo_wallet_events '+
  'WHERE source=? AND source_ref=?'
 ).bind(source,reference).first();
 if(!latest||latest.telegram_user_id!==userId||latest.delta_units!==delta)
  throw Error('sandbox_event_conflict');
 if(accountChanges===1&&eventChanges===1&&latest.status==='applied')
  return {applied:true,duplicate:false,...await getDemoWallet(db,userId)};
 if(accountChanges===0&&latest.status==='applied')
  return {applied:false,duplicate:true,...await getDemoWallet(db,userId)};
 // A rejected debit is quarantined rather than silently going negative or
 // remaining as a delayed charge that could unexpectedly settle later.
 if(latest.status==='pending'){
  await db.prepare(
   "UPDATE rustup_demo_wallet_events SET status='manual_review' "+
   "WHERE source=? AND source_ref=? AND status='pending'"
  ).bind(source,reference).run();
 }
 throw Error('sandbox_insufficient_funds_or_limit');
}
export async function simulateDeposit(db,{userId,channel,reference,units:amount}){
 if(!new Set(['stars','crypto']).has(channel)||!units(amount))
  throw Error('invalid_demo_deposit');
 return applyDemoWalletEvent(db,{userId,source:'demo_'+channel,
  reference,delta:amount});
}
export async function simulateGameSpend(db,{userId,reference,units:amount}){
 if(!units(amount))throw Error('invalid_demo_spend');
 return applyDemoWalletEvent(db,{userId,source:'demo_game_spend',
  reference,delta:-amount});
}
export async function simulateRefund(db,{source,reference}){
 if(!new Set(['demo_stars','demo_crypto']).has(source))
  throw Error('invalid_demo_refund_source');
 const original=await db.prepare(
  'SELECT telegram_user_id,delta_units,status FROM rustup_demo_wallet_events '+
  'WHERE source=? AND source_ref=?'
 ).bind(source,reference).first();
 if(!original||original.status!=='applied'||original.delta_units<=0)
  throw Error('original_demo_credit_missing');
 // Preserve original reference, unique within demo_refund source; do not
 // issue a second reversal on replay.
 return applyDemoWalletEvent(db,{
  userId:original.telegram_user_id,source:'demo_refund',
  reference:source+':'+reference,delta:-original.delta_units
 });
}
