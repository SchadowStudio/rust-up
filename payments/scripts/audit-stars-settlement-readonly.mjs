// RUST UP: cross-database payment/ledger reconciliation, READ ONLY.
// Run locally with CLOUDFLARE_API_TOKEN. No payment, bot, or game DB changes.
// This tool never prints player IDs, order IDs, invoices or charge IDs.
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ACCOUNT='af72e32cb9f1ba99dba07df30fe540fe';
const GAME='9b0b533f-540a-4a25-a429-70ca8bd4e23d';
const PAYMENTS='06079270-a227-466a-9991-abd4201ec5f6';
const WORKER='rustup-bot';
const MAX=2000;
const FLAG_NAMES=['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
 'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
 'PAYMENT_WALLET_STRICT_MODE','STARS_GAME_CREDIT_SETTLEMENT_ENABLED',
 'STARS_GAME_CREDIT_REFUND_RECONCILIATION_ENABLED'];

const SQL=Object.freeze({
 tables:"SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'rustup_%' ORDER BY name",
 orders:"SELECT id,telegram_user_id,requested_amount_minor,price_stars,status,telegram_charge_id,paid_at_ms FROM rustup_stars_variable_orders ORDER BY created_at_ms DESC LIMIT 2001",
 quotes:"SELECT order_id,telegram_user_id,amount_minor,coin_cents,quoted_at_ms FROM rustup_stars_variable_credit_quotes ORDER BY quoted_at_ms DESC LIMIT 2001",
 credits:"SELECT source,order_id,receipt_id,telegram_user_id,amount_minor,coin_cents FROM rustup_game_paid_receipts ORDER BY created_at_ms DESC LIMIT 2001",
 refunds:"SELECT source,order_id,receipt_id,telegram_user_id,coin_cents FROM rustup_game_paid_refunds ORDER BY refunded_at_ms DESC LIMIT 2001",
 incidents:"SELECT COUNT(*) AS value FROM rustup_stars_receipt_incidents",
 refundIntents:"SELECT state,COUNT(*) AS total FROM rustup_stars_variable_refund_intents GROUP BY state",
 controls:"SELECT channel,enabled FROM rustup_payment_settings ORDER BY channel"
});
const positive=n=>Number.isSafeInteger(n)&&n>0;
const count=n=>Number.isSafeInteger(n)&&n>=0;
const safeRows=x=>{
 if(!Array.isArray(x))throw Error('reconciliation_invalid_rows');
 return x;
};
function valuesByKey(rows,key){
 const map=new Map();
 for(const row of rows){
  const id=row?.[key];
  if(typeof id!=='string'||!id||map.has(id))
   throw Error('reconciliation_missing_or_duplicate_identifier');
  map.set(id,row);
 }
 return map;
}
function okCount(value){
 if(!count(value))throw Error('reconciliation_invalid_count');
 return value;
}
export function evaluateStarsSettlementSnapshot(snapshot){
 const {paymentTables,gameTables,orders,quotes,credits,refunds,
  incidents,refundIntents,controls,bindings}=snapshot||{};
 if(!Array.isArray(paymentTables)||!Array.isArray(gameTables)||
    !Array.isArray(orders)||!Array.isArray(quotes)||
    !Array.isArray(credits)||!Array.isArray(refunds)||
    !Array.isArray(incidents)||!Array.isArray(refundIntents)||
    !Array.isArray(controls)||!Array.isArray(bindings))
  throw Error('reconciliation_incomplete_read_only_evidence');
 const ledgerReady=['rustup_game_paid_receipts','rustup_game_paid_refunds']
  .every(table=>gameTables.includes(table));
 const paymentsReady=['rustup_stars_variable_orders',
  'rustup_stars_variable_credit_quotes','rustup_stars_variable_refund_intents',
  'rustup_stars_receipt_incidents','rustup_payment_settings']
  .every(table=>paymentTables.includes(table));
 const complete=[orders,quotes,credits,refunds].every(rows=>rows.length<=MAX);
 const pay=valuesByKey(orders.slice(0,MAX),'id');
 const frozen=valuesByKey(quotes.slice(0,MAX),'order_id');
 const booked=valuesByKey(credits.slice(0,MAX),'order_id');
 const returned=valuesByKey(refunds.slice(0,MAX),'order_id');
 const problems={
  paidWithoutCharge:0,paidMissingFrozenQuote:0,paidNotCredited:0,
  creditedWithoutPaidOrder:0,creditedIdentityOrAmountMismatch:0,
  refundedButStillCredited:0,refundedReversalConflict:0,
  reversedWithoutRecordedRefund:0,orphanQuotes:0
 };
 const statuses=['pending','checkout_approved','paid','refunded','manual_review'];
 const counts=Object.fromEntries(statuses.map(s=>[s,0]));
 for(const row of pay.values()){
  if(!statuses.includes(row.status))throw Error('reconciliation_unknown_payment_state');
  counts[row.status]++;
  if(row.status==='paid'){
   if(!positive(row.telegram_user_id)||!positive(row.price_stars)||
      !positive(row.paid_at_ms)||typeof row.telegram_charge_id!=='string'||
      !row.telegram_charge_id)problems.paidWithoutCharge++;
   const quote=frozen.get(row.id);
   if(!quote||quote.telegram_user_id!==row.telegram_user_id||
      quote.amount_minor!==row.requested_amount_minor||
      !positive(quote.coin_cents))problems.paidMissingFrozenQuote++;
   if(!booked.has(row.id))problems.paidNotCredited++;
  }
  if(row.status==='refunded'&&booked.has(row.id)&&!returned.has(row.id))
   problems.refundedButStillCredited++;
 }
 for(const c of booked.values()){
  if(c.source!=='stars_variable')continue;
  const order=pay.get(c.order_id);
  if(!order||!['paid','refunded'].includes(order.status))
   problems.creditedWithoutPaidOrder++;
  if(!order||c.telegram_user_id!==order.telegram_user_id||
     c.amount_minor!==order.requested_amount_minor||
     c.receipt_id!==order.telegram_charge_id||
     c.coin_cents!==frozen.get(c.order_id)?.coin_cents)
   problems.creditedIdentityOrAmountMismatch++;
 }
 for(const r of returned.values()){
  if(r.source!=='stars_variable')continue;
  const order=pay.get(r.order_id),prior=booked.get(r.order_id);
  if(!order||order.status!=='refunded')problems.reversedWithoutRecordedRefund++;
  if(!prior||r.receipt_id!==prior.receipt_id||
     r.telegram_user_id!==prior.telegram_user_id||
     r.coin_cents!==prior.coin_cents)
   problems.refundedReversalConflict++;
 }
 for(const quote of frozen.values())
  if(!pay.has(quote.order_id))problems.orphanQuotes++;

 const incidentCount=okCount(incidents[0]?.value);
 const unresolvedRefundIntents=refundIntents.reduce((sum,row)=>{
  if(!['pending','completed','manual_review'].includes(row.state))
   throw Error('reconciliation_unknown_refund_state');
  return sum+(row.state==='completed'?0:okCount(row.total));
 },0);
 const flags=Object.fromEntries(FLAG_NAMES.map(name=>{
  const b=bindings.find(item=>item.name===name);
  return [name,b?.type==='plain_text'&&['true','false'].includes(b.text)?
   b.text:'unknown'];
 }));
 const chargingFlags=FLAG_NAMES.slice(0,5);
 const chargingOff=chargingFlags.every(name=>flags[name]==='false');
 const controlsDisabled=['master','stars','crypto'].every(channel=>
  controls.some(c=>c.channel===channel&&c.enabled===0));
 const issueTotal=Object.values(problems).reduce((a,b)=>a+b,0)+
  incidentCount+unresolvedRefundIntents;
 const blockers=[
  ...(!ledgerReady?['game_journal_schema_not_installed']:[]),
  ...(!paymentsReady?['payment_quote_or_refund_schema_missing']:[]),
  ...(!complete?['read_only_scan_incomplete_more_than_2000_rows']:[]),
  ...(!chargingOff||!controlsDisabled?['payments_not_safely_disabled']:[]),
  ...(issueTotal?['payment_ledger_or_refund_requires_review']:[])
 ];
 return {
  mode:'READ_ONLY_SETTLEMENT_RECONCILIATION',
  readOnly:true,chargesCreated:false,balancesChanged:false,
  livePaymentApproval:false,gameCreditReleaseApproved:false,
  schema:{paymentReady:paymentsReady,gameLedgerReady:ledgerReady},
  coverageComplete:complete,
  paymentOrderCounts:counts,
  scanned:{orders:pay.size,frozenQuotes:frozen.size,
   credits:booked.size,reversals:returned.size},
  anomalies:problems,receiptIncidents:incidentCount,
  unresolvedRefundIntents,flags,controlsDisabled,
  blockers,allChecksPass:blockers.length===0
 };
}
async function cf(token,route,sql,fetchImpl){
 const response=await fetchImpl('https://api.cloudflare.com/client/v4'+route,{
  method:sql?'POST':'GET',redirect:'error',
  signal:AbortSignal.timeout(25000),
  headers:{authorization:'Bearer '+token,
   ...(sql?{'content-type':'application/json'}:{})},
  ...(sql?{body:JSON.stringify({sql})}:{})
 });
 if(!response?.ok)throw Error('cloudflare_read_failed_http_'+response?.status);
 const body=await response.json();
 if(body?.success!==true)throw Error('cloudflare_read_failed');
 return body.result;
}
async function query(token,db,name,fetchImpl){
 if(!Object.hasOwn(SQL,name))throw Error('read_only_sql_not_whitelisted');
 const rows=await cf(token,
  '/accounts/'+ACCOUNT+'/d1/database/'+db+'/query',SQL[name],fetchImpl);
 return safeRows(rows?.[0]?.results);
}
export async function inspectLiveStarsSettlement(token,fetchImpl=fetch){
 if(typeof token!=='string'||token.length<15)
  throw Error('cloudflare_token_required_locally');
 const [paymentObjects,gameObjects,bindings]=await Promise.all([
  query(token,PAYMENTS,'tables',fetchImpl),
  query(token,GAME,'tables',fetchImpl),
  cf(token,'/accounts/'+ACCOUNT+'/workers/scripts/'+WORKER+'/settings',
   null,fetchImpl)
 ]);
 const paymentTables=paymentObjects.map(x=>x.name);
 const gameTables=gameObjects.map(x=>x.name);
 const paymentRequired=['orders','incidents','controls'];
 const paymentOptional=['quotes','refundIntents'];
 const gameOptional=['credits','refunds'];
 async function maybeQuery(db,name,table){
  const present=(db===PAYMENTS?paymentTables:gameTables).includes(table);
  return present?query(token,db,name,fetchImpl):[];
 }
 const [orders,incidents,controls,quotes,refundIntents,credits,refunds]=
  await Promise.all([
   ...paymentRequired.map(name=>query(token,PAYMENTS,name,fetchImpl)),
   ...paymentOptional.map((name,i)=>maybeQuery(token,PAYMENTS,name,
    ['rustup_stars_variable_credit_quotes','rustup_stars_variable_refund_intents'][i])),
   ...gameOptional.map((name,i)=>maybeQuery(token,GAME,name,
    ['rustup_game_paid_receipts','rustup_game_paid_refunds'][i]))
  ]);
 return evaluateStarsSettlementSnapshot({
  paymentTables,gameTables,orders,quotes,credits,refunds,
  incidents,refundIntents,controls,bindings:bindings?.bindings||[]
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 inspectLiveStarsSettlement(process.env.CLOUDFLARE_API_TOKEN)
  .then(report=>{
   console.log(JSON.stringify(report,null,2));
   // This tool confirms only bookkeeping consistency, NEVER lawful readiness.
   if(!report.allChecksPass)process.exitCode=2;
  })
  .catch(error=>{
   console.error('READ ONLY STARS RECONCILIATION FAILED:',
    String(error?.message||'unknown').slice(0,120));
   process.exitCode=1;
  });
}
