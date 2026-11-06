import path from 'node:path';
import {fileURLToPath} from 'node:url';
// Read-only owner pilot refund readiness diagnostic.
// No payment or game balance writes, no Telegram token required.
// Reports evidence and controlled blockers for the two completed test orders.
const ACCOUNT='af72e32cb9f1ba99dba07df30fe540fe';
const GAME='9b0b533f-540a-4a25-a429-70ca8bd4e23d';
const PAY='06079270-a227-466a-9991-abd4201ec5f6';
const BASE='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/d1/database/';
async function query(db,sql){
 const r=await fetch(BASE+db+'/query',{method:'POST',redirect:'manual',
  signal:AbortSignal.timeout(25000),
  headers:{authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN,
   'content-type':'application/json'},
  body:JSON.stringify({sql})});
 if(!r.ok)throw Error('cloudflare_read_http_'+r.status);
 const j=await r.json();
 if(j.success!==true||j.result?.[0]?.success!==true||
   !Array.isArray(j.result[0].results))throw Error('cloudflare_query_failure');
 return j.result[0].results;
}
const first='5acaf9ba-f7c3-448c-a1f5-d7dd0c1190ff';
const second='3ed2f58b-61b7-4e23-9981-21a011aa9492';
export function evaluateSnapshot({balance,orders,credits,refunds,intents,channels,triggerNames}){
 const blockers=[];
 const account=balance[0];
 if(balance.length!==1||!Number.isFinite(account?.canonical)||
  !Number.isFinite(account?.mirror))blockers.push('game_account_unavailable');
 const difference=account?Math.round((account.canonical-account.mirror)*100)/100:null;
 if(account&&Math.abs(difference)>=0.01)blockers.push('game_mirror_must_be_reconciled_before_refund');
 if(orders.length!==2||!orders.some(x=>x.id===first&&x.price_stars===1&&x.requested_amount_minor===183)||
  !orders.some(x=>x.id===second&&x.price_stars===3&&x.requested_amount_minor===500)||
  orders.some(x=>x.status!=='paid'||!x.has_charge))
  blockers.push('paid_orders_or_telegram_charges_not_complete');
 if(credits.length!==2||credits.reduce((n,x)=>n+x.coin_cents,0)!==683||
   !credits.some(x=>x.order_id===first&&x.coin_cents===183)||
   !credits.some(x=>x.order_id===second&&x.coin_cents===500))
  blockers.push('verified_game_credit_receipts_incomplete');
 if(refunds.length!==0||intents.length!==0)
  blockers.push('refund_already_started_review_before_retry');
 if(!['master','stars','crypto'].every(name=>
  channels.some(x=>x.channel===name&&x.enabled===0)))
  blockers.push('disable_new_checkout_before_refund');
 if(!['rustup_canonical_balance_after_account_update',
  'rustup_users_balance_canonical_guard'].every(name=>triggerNames.includes(name)))
  blockers.push('atomic_mirror_protection_missing');
 return {mode:'READ_ONLY',newPaymentsDisabled:channels.every(x=>x.enabled===0),
  accountVersion:account?.v,canonicalInternalCoins:account?.canonical,
  mirroredInternalCoins:account?.mirror,mirrorGapCoins:difference,
  paidOrders:orders.map(x=>({orderId:x.id,stars:x.price_stars,
   paidRub:x.requested_amount_minor/100,paid:x.status==='paid'})),
  creditedInternalCoins:credits.reduce((n,x)=>n+x.coin_cents,0)/100,
  refundOrders:refunds.length,refundIntentCount:intents.length,
  allRefundPreconditionsPass:blockers.length===0,
  blockers};
}
export async function readSnapshot(){
 const id=7390606911;
 const [balance,orders,credits,refunds,intents,channels,triggers]=await Promise.all([
  query(GAME,"SELECT a.v,json_extract(a.state,'$.balance') canonical,u.balance mirror "+
   "FROM accounts a JOIN users u ON u.id=a.id WHERE a.id="+id),
  query(PAY,"SELECT id,price_stars,requested_amount_minor,status,"+
   "CASE WHEN telegram_charge_id IS NULL THEN 0 ELSE 1 END has_charge "+
   "FROM rustup_stars_variable_orders WHERE telegram_user_id="+id+
   " ORDER BY created_at_ms"),
  query(GAME,"SELECT order_id,coin_cents FROM rustup_game_paid_receipts "+
   "WHERE source='stars_variable' AND telegram_user_id="+id),
  query(GAME,"SELECT order_id FROM rustup_game_paid_refunds "+
   "WHERE source='stars_variable' AND telegram_user_id="+id),
  query(PAY,"SELECT order_id,state FROM rustup_stars_variable_refund_intents"),
  query(PAY,'SELECT channel,enabled FROM rustup_payment_settings'),
  query(GAME,"SELECT name FROM sqlite_master WHERE type='trigger' AND "+
   "name IN ('rustup_canonical_balance_after_account_update',"+
   "'rustup_users_balance_canonical_guard')")
 ]);
 return {balance,orders,credits,refunds,intents,channels,
  triggerNames:triggers.map(x=>x.name)};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const token=process.env.CLOUDFLARE_API_TOKEN;
 if(!token||token.length<20)throw Error('cloudflare_token_required');
 const report=evaluateSnapshot(await readSnapshot());
 console.log(JSON.stringify(report,null,2));
 if(!report.allRefundPreconditionsPass)process.exitCode=2;
}
