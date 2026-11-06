// RUST UP: independently reconcile an ALREADY Telegram-refunded Stars order.
// NEVER calls refundStarPayment or creates an invoice. The only possible write
// is one uniquely constrained game-credit reversal after evidence verification.
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ACCOUNT='af72e32cb9f1ba99dba07df30fe540fe';
const PAY='06079270-a227-466a-9991-abd4201ec5f6';
const GAME='9b0b533f-540a-4a25-a429-70ca8bd4e23d';
const OWNER=7390606911;
const FIRST='5acaf9ba-f7c3-448c-a1f5-d7dd0c1190ff';
const SECOND='3ed2f58b-61b7-4e23-9981-21a011aa9492';
const API='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/d1/database/';
const fail=(why)=>{throw Error(why)};
function requireThat(value,reason){if(!value)fail(reason)}
async function d1(db,sql,params=[]){
 const token=process.env.CLOUDFLARE_API_TOKEN;
 requireThat(typeof token==='string'&&token.length>20,'cloudflare_auth_required');
 const response=await fetch(API+db+'/query',{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(25000),
  headers:{authorization:'Bearer '+token,'content-type':'application/json'},
  body:JSON.stringify({sql,params})
 });
 requireThat(response.ok,'cloudflare_http_'+response.status);
 const data=await response.json();
 requireThat(data.success===true&&data.result?.[0]?.success===true,
  'cloudflare_d1_query_failed');
 return data.result[0];
}
async function telegram(method,payload){
 const token=process.env.RUSTUP_MAIN_BOT_TOKEN;
 requireThat(typeof token==='string'&&/^[0-9]{5,15}:[a-zA-Z0-9_-]{30,}$/.test(token),
  'main_bot_token_required_locally');
 const response=await fetch('https://api.telegram.org/bot'+token+'/'+method,{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(25000),
  headers:{'content-type':'application/json'},body:JSON.stringify(payload)
 });
 // Do not include Telegram request URL in errors; it contains the bot token.
 requireThat(response.ok,'telegram_http_'+response.status+'_'+method);
 const data=await response.json();
 requireThat(data.ok===true,'telegram_api_failed_'+method);
 return data.result;
}
export function evaluateRefundTransactions(transactions,{chargeId,stars,userId}){
 requireThat(Array.isArray(transactions),'telegram_history_invalid');
 requireThat(typeof chargeId==='string'&&Number.isSafeInteger(stars)&&stars>0&&
  Number.isSafeInteger(userId)&&userId>0,'refund_identity_invalid');
 const matches=transactions.filter(tx=>tx?.id===chargeId);
 // Bot API StarTransaction.amount is the transaction magnitude, not
 // a signed debit indicator. Incoming payment has source=user;
 // outgoing refund has receiver=user, with the ORIGINAL charge id.
 const originals=matches.filter(tx=>tx.amount===stars&&
  tx.source?.type==='user'&&tx.source.user?.id===userId&&
  tx.receiver==null);
 const refunds=matches.filter(tx=>tx.amount===stars&&
  tx.receiver?.type==='user'&&tx.receiver.user?.id===userId&&
  tx.source==null);
 const conflicting=matches.filter(tx=>
  !originals.includes(tx)&&!refunds.includes(tx));
 const validPairs=originals.length===1&&refunds.length===1&&
  conflicting.length===0&&
  Number.isSafeInteger(originals[0].date)&&
  Number.isSafeInteger(refunds[0].date)&&
  refunds[0].date>=originals[0].date;
 return {refundVerified:validPairs,
  conflictingRefundEvidence:conflicting.length>0||
   originals.length>1||refunds.length>1||
   (originals.length===1&&refunds.length===1&&
    Number.isSafeInteger(originals[0].date)&&
    Number.isSafeInteger(refunds[0].date)&&
    refunds[0].date<originals[0].date),
  originalChargeVisible:originals.length===1,
  refundTransactionVisible:refunds.length===1};
}
async function independentlyVerifyRefund(order){
 const me=await telegram('getMe',{});
 requireThat(me?.username==='rustuper_bot','wrong_telegram_bot');
 const combined=[];
 let complete=false;
 for(let offset=0;offset<2000;offset+=100){
  const response=await telegram('getStarTransactions',{offset,limit:100});
  requireThat(Array.isArray(response?.transactions),'telegram_history_invalid');
  combined.push(...response.transactions);
  if(response.transactions.length<100){complete=true;break;}
 }
 requireThat(complete,'telegram_history_window_incomplete_manual_review');
 const evidence=evaluateRefundTransactions(combined,{
  chargeId:order.telegram_charge_id,stars:order.price_stars,
  userId:order.telegram_user_id
 });
 requireThat(!evidence.conflictingRefundEvidence,
  'telegram_refund_history_conflict_manual_review');
 return evidence;
}
async function snapshot(orderId){
 requireThat([FIRST,SECOND].includes(orderId),'only_two_owner_pilot_orders_allowed');
 const [orders,intents,quotes,receipts,reversals,players,controls]=await Promise.all([
  d1(PAY,'SELECT id,telegram_user_id,price_stars,requested_amount_minor,status,telegram_charge_id FROM rustup_stars_variable_orders WHERE id=?',[orderId]),
  d1(PAY,'SELECT order_id,telegram_charge_id,state FROM rustup_stars_variable_refund_intents WHERE order_id=?',[orderId]),
  d1(PAY,'SELECT telegram_user_id,amount_minor,coin_cents FROM rustup_stars_variable_credit_quotes WHERE order_id=?',[orderId]),
  d1(GAME,"SELECT source,order_id,receipt_id,telegram_user_id,amount_minor,coin_cents FROM rustup_game_paid_receipts WHERE source='stars_variable' AND order_id=?",[orderId]),
  d1(GAME,"SELECT source,order_id,receipt_id,telegram_user_id,coin_cents FROM rustup_game_paid_refunds WHERE source='stars_variable' AND order_id=?",[orderId]),
  d1(GAME,"SELECT a.v AS version,json_extract(a.state,'$.balance') AS canonical,u.balance AS mirror FROM accounts a JOIN users u ON a.id=u.id WHERE a.id=?",[OWNER]),
  d1(PAY,'SELECT channel,enabled FROM rustup_payment_settings')
 ]);
 const o=orders.results?.[0],i=intents.results?.[0],q=quotes.results?.[0],
  c=receipts.results?.[0],r=reversals.results?.[0],b=players.results?.[0];
 requireThat(orders.results.length===1&&o.id===orderId&&o.telegram_user_id===OWNER,
  'pilot_order_missing');
 requireThat(o.status==='refunded'&&
  /^[A-Za-z0-9_-]{8,256}$/.test(o.telegram_charge_id),
  'provider_refund_not_recorded');
 requireThat(intents.results.length===1&&i.state==='completed'&&
  i.telegram_charge_id===o.telegram_charge_id,
  'completed_provider_refund_intent_missing');
 requireThat(quotes.results.length===1&&q.telegram_user_id===OWNER&&
  q.amount_minor===o.requested_amount_minor&&
  Number.isSafeInteger(q.coin_cents)&&q.coin_cents>0,
  'immutable_quote_mismatch');
 requireThat(receipts.results.length===1&&c.receipt_id===o.telegram_charge_id&&
  c.source==='stars_variable'&&c.telegram_user_id===OWNER&&
  c.amount_minor===q.amount_minor&&c.coin_cents===q.coin_cents,
  'original_game_receipt_mismatch');
 requireThat([FIRST,SECOND].indexOf(orderId)=== (o.price_stars===1?0:1),
  'unexpected_stars_pilot_price');
 requireThat(controls.results.length===3&&
  controls.results.every(x=>x.enabled===0),'checkout_not_disabled');
 requireThat(players.results.length===1&&Number.isFinite(b.canonical)&&
  Number.isFinite(b.mirror)&&Math.abs(b.canonical-b.mirror)<0.000001,
  'game_account_unsynced');
 if(!r)requireThat(b.canonical>=c.coin_cents/100,
  'refunded_game_coins_no_longer_available');
 requireThat(reversals.results.length<=1,'reversal_conflict');
 if(r)requireThat(r.receipt_id===c.receipt_id&&
  r.coin_cents===c.coin_cents&&r.telegram_user_id===OWNER,
  'existing_reversal_does_not_match_original');
 return {order:o,receipt:c,balance:b,alreadyReversed:!!r};
}
export async function reconcile(orderId,{apply=false}={}){
 let state=await snapshot(orderId);
 if(state.alreadyReversed)return {orderId,alreadyReversed:true,
  refundedByTelegram:true,gameCreditReversal:'already_verified'};
 const evidence=await independentlyVerifyRefund(state.order);
 if(!evidence.refundVerified){
  return {orderId,providerRefundRecorded:true,
   telegramHistoryConfirmed:false,gameCreditReversal:'pending_verified_history',
   action:'NO_GAME_BALANCE_CHANGE_NO_PROVIDER_RETRY'};
 }
 if(!apply)return {orderId,providerRefundRecorded:true,
  telegramHistoryConfirmed:true,gameCreditReversal:'ready_for_operator_apply',
  coinsToReverse:state.receipt.coin_cents/100,
  confirmation:'RECONCILE '+orderId};
 // Check all invariants again immediately before the unique insert.
 state=await snapshot(orderId);
 requireThat(!state.alreadyReversed,'another_operator_already_reconciled');
 const sql="INSERT INTO rustup_game_paid_refunds "+
  "(source,order_id,receipt_id,telegram_user_id,coin_cents,refunded_at_ms) "+
  "SELECT 'stars_variable',r.order_id,r.receipt_id,r.telegram_user_id,"+
  "r.coin_cents,? FROM rustup_game_paid_receipts r "+
  "WHERE r.source='stars_variable' AND r.order_id=? "+
  "AND NOT EXISTS(SELECT 1 FROM rustup_game_paid_refunds x "+
  "WHERE x.source=r.source AND x.order_id=r.order_id)";
 const result=await d1(GAME,sql,[Date.now(),orderId]);
 // D1/SQLite changes metadata is not authoritative when AFTER INSERT triggers
 // update additional tables. Verify the durable receipt and both account
 // balances instead, including a possible concurrent idempotent insert.
 const verified=await d1(GAME,
  "SELECT receipt_id,coin_cents,telegram_user_id FROM rustup_game_paid_refunds WHERE source='stars_variable' AND order_id=?",[orderId]);
 requireThat(verified.results.length===1&&
  verified.results[0].receipt_id===state.receipt.receipt_id&&
  verified.results[0].telegram_user_id===OWNER&&
  verified.results[0].coin_cents===state.receipt.coin_cents,
  'game_reversal_postcondition_failed_manual_review');
 const after=await d1(GAME,
  "SELECT a.v AS version,json_extract(a.state,'$.balance') canonical,u.balance mirror FROM accounts a JOIN users u ON a.id=u.id WHERE a.id=?",[OWNER]);
 requireThat(after.results.length===1&&
  Math.abs(after.results[0].canonical-after.results[0].mirror)<0.000001,
  'game_reversal_account_postcondition_failed_manual_review');
 // Only call the operation successful when this exact reversal is durable.
 // A failed metadata check must never lead to a second provider refund.
 const ledgerApplied=result.meta?.changes===1||
  after.results[0].version>=state.balance.version+1;
 requireThat(ledgerApplied,
  'game_reversal_version_not_confirmed_manual_review');
 return {orderId,refundedByTelegram:true,telegramHistoryConfirmed:true,
  gameCreditReversal:'verified',coinsReversed:state.receipt.coin_cents/100,
  providerRefundCalls:0};
}
async function main(){
 const id=process.argv[2];
 const mode=process.argv[3]||'--check';
 requireThat(mode==='--check'||mode==='--apply','invalid_mode');
 if(mode==='--apply')
  requireThat(process.argv[4]==='RECONCILE '+id,
   'operator_confirmation_required');
 const result=await reconcile(id,{apply:mode==='--apply'});
 console.log(JSON.stringify(result,null,2));
 if(result.gameCreditReversal==='pending_verified_history')process.exitCode=2;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{
  console.error('STARS REFUND RECONCILIATION:',String(e.message||e));
  process.exitCode=1;
 });
