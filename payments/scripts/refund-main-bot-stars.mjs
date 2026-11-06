import path from 'node:path';
import {fileURLToPath} from 'node:url';
// RUST UP MAIN BOT: verified local operator XTR refund with game-credit reversal.
// This file is not a webhook. Requires operator-owned Cloudflare and bot tokens.
// Never trusts client-supplied amount, owner or charge ID. No second refund on
// retry. Ambiguous provider outcomes require manual resolution.
const ACCOUNT='af72e32cb9f1ba99dba07df30fe540fe';
const PAY='06079270-a227-466a-9991-abd4201ec5f6';
const GAME='9b0b533f-540a-4a25-a429-70ca8bd4e23d';
const ID=/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i;
const CHARGE=/^[A-Za-z0-9_-]{8,256}$/;
const USER=7390606911;
const API='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/d1/database/';
function assert(flag,message){if(!flag)throw Error(message);}
async function d1(db,sql){
 const r=await fetch(API+db+'/query',{method:'POST',redirect:'manual',
  signal:AbortSignal.timeout(25000),headers:{
   authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN,
   'content-type':'application/json'},body:JSON.stringify({sql})});
 assert(r.ok,'cloudflare_db_http_'+r.status);
 const value=await r.json();
 assert(value.success===true&&Array.isArray(value.result)&&
   value.result[0]?.success===true,'cloudflare_database_unavailable');
 return {rows:value.result[0].results,meta:value.result[0].meta};
}
async function telegram(method,body){
 const bot=process.env.RUSTUP_MAIN_BOT_TOKEN;
 assert(typeof bot==='string'&&/^[0-9]{5,15}:[A-Za-z0-9_-]{30,}$/.test(bot),
  'main_bot_token_required');
 const r=await fetch('https://api.telegram.org/bot'+bot+'/'+method,{
  method:'POST',redirect:'manual',signal:AbortSignal.timeout(25000),
  headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 assert(r.ok,'telegram_http_'+r.status+'_'+method);
 const result=await r.json();
 assert(result.ok===true,'telegram_api_failed_'+method);
 return result.result;
}
async function verifyTelegram(order,refunded=false){
 let seen=false,complete=false;
 for(let offset=0;offset<2000;offset+=100){
  const r=await telegram('getStarTransactions',{offset,limit:100});
  assert(Array.isArray(r?.transactions),'stars_history_invalid');
  for(const tx of r.transactions){
   if(tx.id!==order.telegram_charge_id)continue;
   if(refunded){
    if(tx.amount===-order.price_stars&&tx.receiver?.type==='user'&&
     tx.receiver.user?.id===USER)seen=true;
   }else{
    assert(tx.amount===order.price_stars&&tx.source?.type==='user'&&
     tx.source.user?.id===USER&&
     tx.source.transaction_type==='invoice_payment'&&
     (tx.source.invoice_payload==null||
      tx.source.invoice_payload==='v:'+order.id),
     'stars_charge_evidence_mismatch');
    seen=true;
   }
  }
  if(r.transactions.length<100){complete=true;break;}
 }
 assert(complete,'stars_history_incomplete');
 assert(seen,refunded?'refund_evidence_not_yet_visible':'original_charge_unverified');
}
export async function refundPreflight(orderId,read=d1){
 assert(ID.test(orderId),'order_uuid_required');
 const {rows:orders}=await read(PAY,
  "SELECT id,telegram_user_id,requested_amount_minor,price_stars,status,"+
  "telegram_charge_id,paid_at_ms FROM rustup_stars_variable_orders "+
  "WHERE id='"+orderId+"'");
 assert(orders.length===1,'order_not_found');
 const order=orders[0];
 assert(order.telegram_user_id===USER,'refund_not_pilot_owner');
 const [quotes,credits,existing,previous,state]=await Promise.all([
  read(PAY,"SELECT coin_cents,amount_minor,telegram_user_id FROM rustup_stars_variable_credit_quotes WHERE order_id='"+orderId+"'"),
  read(GAME,"SELECT receipt_id,coin_cents FROM rustup_game_paid_receipts WHERE source='stars_variable' AND order_id='"+orderId+"'"),
  read(PAY,"SELECT state FROM rustup_stars_variable_refund_intents WHERE order_id='"+orderId+"'"),
  read(GAME,"SELECT order_id FROM rustup_game_paid_refunds WHERE source='stars_variable' AND order_id='"+orderId+"'"),
  read(GAME,"SELECT a.v,u.balance AS mirror,json_extract(a.state,'$.balance') AS canonical FROM accounts a JOIN users u ON a.id=u.id WHERE a.id="+USER)
 ]);
 const blockers=[];
 if(order.status!=='paid'||!CHARGE.test(order.telegram_charge_id))
  blockers.push('order_not_confirmed_paid');
 if(quotes.rows.length!==1||quotes.rows[0].telegram_user_id!==USER||
    quotes.rows[0].amount_minor!==order.requested_amount_minor)
  blockers.push('frozen_quote_mismatch');
 if(credits.rows.length!==1||quotes.rows.length!==1||
    credits.rows[0].coin_cents!==quotes.rows[0].coin_cents||
    credits.rows[0].receipt_id!==order.telegram_charge_id)
  blockers.push('game_credit_receipt_mismatch');
 if(existing.rows.length||previous.rows.length)
  blockers.push('refund_started_or_already_reversed');
 if(state.rows.length!==1||!Number.isFinite(state.rows[0].canonical)||
    !Number.isFinite(state.rows[0].mirror))
  blockers.push('game_account_unavailable');
 else{
  if(Math.abs(state.rows[0].canonical-state.rows[0].mirror)>=0.000001)
   blockers.push('game_account_balance_mirror_unsynced');
  if(quotes.rows.length===1&&state.rows[0].canonical<quotes.rows[0].coin_cents/100)
   blockers.push('game_credit_not_available_for_reversal');
 }
 return {action:'preflight',orderId,ok:blockers.length===0,
  paidStars:order.price_stars,creditedCoins:quotes.rows[0]?.coin_cents/100,
  accountVersion:state.rows[0]?.v,
  ...(state.rows.length===1?{canonicalCoins:state.rows[0].canonical,
    mirrorCoins:state.rows[0].mirror}:{}),
  blockers};
}
async function refund(orderId){
 assert(ID.test(orderId),'order_uuid_required');
 const {rows}=await d1(PAY,
  "SELECT id,telegram_user_id,requested_amount_minor,price_stars,status,"+
  "telegram_charge_id,paid_at_ms FROM rustup_stars_variable_orders "+
  "WHERE id='"+orderId+"'");
 assert(rows.length===1&&rows[0].id===orderId,'order_not_found');
 const o=rows[0];
 assert(o.telegram_user_id===USER&&o.status==='paid'&&
   CHARGE.test(o.telegram_charge_id)&&Number.isSafeInteger(o.price_stars)&&
   o.price_stars>=1&&o.price_stars<=10,'paid_pilot_order_required');
 const {rows:q}=await d1(PAY,
  "SELECT telegram_user_id,amount_minor,coin_cents FROM "+
  "rustup_stars_variable_credit_quotes WHERE order_id='"+orderId+"'");
 assert(q.length===1&&q[0].telegram_user_id===USER&&
  q[0].amount_minor===o.requested_amount_minor&&
  Number.isSafeInteger(q[0].coin_cents)&&q[0].coin_cents>0,
  'immutable_game_quote_missing');
 const {rows:prior}=await d1(GAME,
  "SELECT receipt_id,coin_cents FROM rustup_game_paid_receipts "+
  "WHERE source='stars_variable' AND order_id='"+orderId+"'");
 assert(prior.length<=1,'ambiguous_game_credit');
 if(prior.length===1){
  assert(prior[0].receipt_id===o.telegram_charge_id&&
    prior[0].coin_cents===q[0].coin_cents,'game_credit_mismatch');
  const {rows:player}=await d1(GAME,
   "SELECT u.balance AS balance,json_extract(a.state,'$.balance') AS state_balance "+
   "FROM users u JOIN accounts a ON a.id=u.id WHERE u.id="+USER);
  assert(player.length===1&&Number.isFinite(player[0].balance)&&
   Math.abs(player[0].balance-player[0].state_balance)<0.000001&&
   player[0].balance>=q[0].coin_cents/100,
   'game_coins_spent_or_account_unsynced_do_not_refund');
 }
 const {rows:existing}=await d1(PAY,
  "SELECT state FROM rustup_stars_variable_refund_intents WHERE order_id='"+orderId+"'");
 assert(existing.length===0,'refund_already_reserved_do_not_retry');
 const currentBot=await telegram('getMe',{});
 assert(currentBot?.username?.toLowerCase()==='rustuper_bot',
  'wrong_bot_token_must_be_rustuper_bot');
 await verifyTelegram(o,false);
 // Atomic unique insert: this one-time lock is written BEFORE the provider call.
 const now=Date.now();
 const hold=await d1(PAY,
  "INSERT OR IGNORE INTO rustup_stars_variable_refund_intents "+
  "(order_id,telegram_charge_id,requested_by,reason,state,requested_at_ms) "+
  "VALUES('"+orderId+"','"+o.telegram_charge_id+"',"+USER+
  ",'operator_requested_refund','pending',"+now+")");
 assert(hold.meta?.changes===1,'refund_lock_failed');
 let sent=false;
 try{
  const result=await telegram('refundStarPayment',{
   user_id:USER,telegram_payment_charge_id:o.telegram_charge_id});
  assert(result===true,'telegram_refund_unconfirmed');
  sent=true;
 }catch(e){
  await d1(PAY,"UPDATE rustup_stars_variable_refund_intents "+
   "SET state='manual_review' WHERE order_id='"+orderId+"' AND state='pending'");
  throw Error('PROVIDER_OUTCOME_UNCERTAIN_NO_RETRY: '+String(e.message||e));
 }
 assert(sent,'refund_not_confirmed');
 // Record provider success immediately, before game reversal; refund batch
 // can independently reconcile eventual game changes if this script crashes.
 const refundMark=await d1(PAY,"UPDATE rustup_stars_variable_orders SET status='refunded' "+
  "WHERE id='"+orderId+"' AND status='paid'");
 assert(refundMark.meta?.changes===1,'provider_refunded_but_order_db_unconfirmed_manual_review');
 const intentMark=await d1(PAY,"UPDATE rustup_stars_variable_refund_intents "+
  "SET state='completed',completed_at_ms="+Date.now()+
  " WHERE order_id='"+orderId+"' AND state='pending'");
 assert(intentMark.meta?.changes===1,'provider_refunded_but_intent_db_unconfirmed_manual_review');
 // Independent Telegram verification may lag after the provider has refunded.
 try{await verifyTelegram(o,true);}
 catch(e){
  console.log(JSON.stringify({providerRefundSent:true,orderId,
   gameCreditReversal:'pending_verified_history',
   action:'DO_NOT_RETRY_PROVIDER_REFUND',
   issue:String(e.message||e)},null,2));
  return;
 }
 if(prior.length===0){
  console.log(JSON.stringify({providerRefundSent:true,orderId,
   originalGameCredit:false,gameCreditReversal:'not_needed'},null,2));
  return;
 }
 try{
  const changed=await d1(GAME,
   "INSERT OR IGNORE INTO rustup_game_paid_refunds "+
   "(source,order_id,receipt_id,telegram_user_id,coin_cents,refunded_at_ms) "+
   "VALUES('stars_variable','"+orderId+"','"+o.telegram_charge_id+"',"+
    USER+","+q[0].coin_cents+","+Date.now()+")");
  const {rows:verified}=await d1(GAME,
   "SELECT receipt_id,coin_cents FROM rustup_game_paid_refunds "+
   "WHERE source='stars_variable' AND order_id='"+orderId+"'");
  assert(verified.length===1&&verified[0].receipt_id===o.telegram_charge_id&&
    verified[0].coin_cents===q[0].coin_cents,
    'game_reversal_unconfirmed');
  console.log(JSON.stringify({providerRefundSent:true,orderId,
    gameCreditReversal:'verified',wasExistingCredit:true},null,2));
 }catch(e){
  console.log(JSON.stringify({providerRefundSent:true,orderId,
   gameCreditReversal:'manual_review_required',
   action:'DO_NOT_RETRY_PROVIDER_REFUND',
   issue:String(e.message||e)},null,2));
  process.exitCode=2;
 }
}
async function main(){
 const mode=process.argv[2];
 const id=mode==='--preflight'?process.argv[3]:process.argv[2];
 assert(ID.test(id||''),'order_uuid_required');
 assert(typeof process.env.CLOUDFLARE_API_TOKEN==='string'&&
  process.env.CLOUDFLARE_API_TOKEN.length>20,'cloudflare_token_required');
 const preflight=await refundPreflight(id);
 if(mode==='--preflight'){
  console.log(JSON.stringify(preflight,null,2));
  if(!preflight.ok)process.exitCode=2;
  return;
 }
 assert(process.argv[3]==='REFUND '+id,
  'Usage: node refund-main-bot-stars.mjs UUID "REFUND UUID"');
 assert(preflight.ok,'refund_preflight_blocked_'+preflight.blockers.join('_'));
 await refund(id);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(e=>{console.error('MAIN BOT STARS REFUND:',String(e.message||e));
  process.exitCode=1;});
}
