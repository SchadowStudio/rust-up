// RUST UP Stars-to-RUB prelaunch gate. READ ONLY; owner rate selected, live sync checked.
// Does not create invoices, change Cloudflare settings, add funds, or allow wagers.
// Public output: aggregate counts and booleans, NEVER player IDs or secrets.
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {readFileSync} from 'node:fs';
const OWNER_RATE=Object.freeze(JSON.parse(readFileSync(
 new URL('../stars-owner-rate.json',import.meta.url),'utf8')));
const PRICE_VARS=['STARS_MIN_RUB_MINOR','STARS_MAX_RUB_MINOR',
 'STARS_RUB_MINOR_PER_STAR_NUM','STARS_RUB_MINOR_PER_STAR_DEN'];

const ACCOUNT='af72e32cb9f1ba99dba07df30fe540fe';
const WORKER='rustup-bot';
const PAYMENTS='06079270-a227-466a-9991-abd4201ec5f6';
const GAME='9b0b533f-540a-4a25-a429-70ca8bd4e23d';
const BASE='https://api.cloudflare.com/client/v4';
const SITE='https://ttzoomrust-hub.github.io/rust-up/';
const HARD_FLAGS=[
 'PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
 'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
 'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
 'PAYMENT_WALLET_STRICT_MODE'
];
const SETTINGS=['master','stars','crypto'];
// D1 may enforce a small compound-SELECT limit. Use one SELECT instead.
const ROWS_SQL=[
 "SELECT",
 "(SELECT COUNT(*) FROM rustup_stars_variable_orders) AS variable_orders,",
 "(SELECT COUNT(*) FROM rustup_stars_variable_orders WHERE status='paid') AS paid_orders,",
 "(SELECT COUNT(*) FROM rustup_stars_variable_orders WHERE status='manual_review') AS manual_review_orders,",
 "(SELECT COUNT(*) FROM rustup_stars_refund_intents WHERE state<>'completed') AS unresolved_refunds,",
 "(SELECT COUNT(*) FROM rustup_stars_variable_refund_intents WHERE state<>'completed') AS unresolved_variable_refunds," ,
 "(SELECT COUNT(*) FROM rustup_stars_receipt_incidents) AS receipt_incidents,",
 "(SELECT COUNT(*) FROM rustup_stars_variable_orders WHERE status='checkout_approved'",
 "AND expires_at_ms<(CAST(strftime('%s','now') AS INTEGER)*1000-3600000)) AS approved_over_1h"
].join(' ');
const PAYMENTS_SCHEMA_SQL=[
 "SELECT name FROM sqlite_master WHERE type='table'",
 "AND name IN ('rustup_stars_variable_orders','rustup_payment_settings',",
 "'rustup_stars_refund_intents','rustup_stars_receipt_incidents',",
 "'rustup_stars_variable_refund_intents')"
].join(' ');
const GAME_SCHEMA_SQL=[
 "SELECT name FROM sqlite_master WHERE type='table'",
 "AND name IN ('accounts','grants','rustup_verified_deposit_credits')"
].join(' ');
const GAME_COUNTS_SQL="SELECT 'account_rows' AS name,COUNT(*) AS n FROM accounts";
const SETTINGS_SQL="SELECT channel,enabled FROM rustup_payment_settings WHERE channel IN ('master','stars','crypto')";

function counts(rows){
 if(!Array.isArray(rows))throw Error('missing_payment_counts');
 const map=new Map();
 for(const x of rows){
  if(typeof x?.name!=='string'||!Number.isSafeInteger(x.n)||x.n<0||
    map.has(x.name))throw Error('invalid_payment_counts');
  map.set(x.name,x.n);
 }
 for(const name of ['variable_orders','paid_orders','manual_review_orders',
  'unresolved_refunds','unresolved_variable_refunds','receipt_incidents','approved_over_1h'])
  if(!map.has(name))throw Error('incomplete_payment_counts');
 return Object.fromEntries(map);
}
function check(id,ok){return {id,ok:ok===true};}
export function evaluateVariableStarsPrelaunch(x){
 if(!x||!Array.isArray(x.bindings)||!Array.isArray(x.paymentTables)||
  !Array.isArray(x.gameTables)||!Array.isArray(x.controls)||
  typeof x.siteHtml!=='string'||typeof x.workerText!=='string')
  throw Error('incomplete_prelaunch_evidence');
 const b=new Map();
 for(const x1 of x.bindings){
  if(typeof x1?.name!=='string'||b.has(x1.name))throw Error('invalid_worker_bindings');
  b.set(x1.name,x1);
 }
 const flags=HARD_FLAGS.map(name=>b.get(name)?.text);
 if(flags.some(v=>!['true','false'].includes(v)))throw Error('unknown_payment_hard_gate');
 const off=flags.every(v=>v==='false');
 // The saved owner rate does not prove that the deployed Worker uses it.
 const livePriceMatchesOwner=PRICE_VARS.every(name=>{
  const binding=b.get(name);
  return binding?.type==='plain_text'&&
   binding.text===OWNER_RATE[name];
 });
 const hasDb=(name,id)=>b.get(name)?.type==='d1'&&
  [b.get(name)?.id,b.get(name)?.database_id].includes(id);
 const secrets=['BOT_TOKEN','WEBHOOK_SECRET'].every(n=>b.get(n)?.type==='secret_text');
 const tables=(arr,needed)=>needed.every(n=>arr.includes(n));
 const ps=tables(x.paymentTables,[
  'rustup_stars_variable_orders','rustup_payment_settings',
  'rustup_stars_refund_intents','rustup_stars_receipt_incidents']);
 const gs=tables(x.gameTables,['accounts','grants']);
 const ledger=x.gameTables.includes('rustup_verified_deposit_credits');
 const variableRefundSchema=x.paymentTables.includes('rustup_stars_variable_refund_intents');
 const financeAdmin=b.get('PAYMENT_ADMIN_IDS');
 const refundAdminReady=financeAdmin?.type==='plain_text'&&
  String(financeAdmin.text||'').split(',').some(id=>
   /^[1-9][0-9]{0,15}$/.test(id.trim())&&
   Number.isSafeInteger(Number(id.trim())));
 const controls=new Map();
 for(const row of x.controls){
  if(!SETTINGS.includes(row?.channel)||![0,1].includes(row?.enabled)||
    controls.has(row.channel))throw Error('unknown_payment_database_switch');
  controls.set(row.channel,row.enabled);
 }
 if(controls.size!==3)throw Error('missing_payment_database_switch');
 const metric=counts(x.paymentCounts);
 const noUnresolved=metric.manual_review_orders===0&&
  metric.receipt_incidents===0&&metric.unresolved_refunds===0&&
  metric.unresolved_variable_refunds===0&&
  metric.approved_over_1h===0;
 const accountCount=x.gameCounts?.[0]?.n;
 if(!Number.isSafeInteger(accountCount)||accountCount<0)
  throw Error('unknown_game_account_count');
 const observed=typeof x.workerText==='string'?x.workerText:'';
 const checks=[
  check('bot_secrets_present',secrets),
  check('two_separate_correct_d1_bindings',
   hasDb('PAYMENTS_DB',PAYMENTS)&&hasDb('DB',GAME)),
  check('correct_existing_miniapp_origin',b.get('APP_URL')?.text===SITE),
  check('telegram_sdk_and_deposit_ui_published',
   x.siteHtml.includes('https://telegram.org/js/telegram-web-app.js?64')&&
   x.siteHtml.includes('js/stars-deposit-v5.js?v=20261105deposit1')),
  check('variable_payment_schema_present',ps),
  check('variable_refund_intent_schema',variableRefundSchema),
  check('verified_refund_operator_allowlist',refundAdminReady),
  check('legacy_game_accounts_present',gs),
  check('live_worker_has_selected_stars_rate',livePriceMatchesOwner),
  check('all_hard_payment_flags_off',off),
  check('all_database_payment_switches_off',
   SETTINGS.every(k=>controls.get(k)===0)),
  check('no_unresolved_payment_incidents',noUnresolved),
  check('worker_handles_stars_receipts',
   observed.includes('telegram_payment_charge_id')&&
   observed.includes('variable_stars_checkout_disabled')),
  check('worker_has_strict_import_patch',
   observed.includes('RUSTUP_STRICT_ACCOUNT_IMPORT_V1')),
  check('current_worker_has_saved_invoice_precheckout_guard',
   observed.includes('row.invoice_url.length<=1024')),
  check('game_has_payment_booking_journal_schema',ledger),
  // Critical independent evidence; cannot be asserted by a source-code test.
  check('independent_real_telegram_payment_and_refund_verified',false),
  check('operator_and_platform_review_of_specific_product_verified',false),
  check('production_settlement_adapter_verified',false)
 ];
 return {
  mode:'READ_ONLY_PRELAUNCH_DIAGNOSTIC',
  pricing:'SELECTED_BY_OPERATOR',
  rateRubPerStar:OWNER_RATE.rubPerStarDecimal,
  rateStoredInRepository:true,
  pricingConfigured:livePriceMatchesOwner,
  sourceWorkerVersion:x.workerVersion||null,
  checks,
  blockers:checks.filter(c=>!c.ok).map(c=>c.id),
  counts:{...metric,gameAccounts:accountCount},
  noPlayerDataExported:true,
  paymentOrGameCreditActivated:false,
  readyExceptPricing:false,
  readyToAcceptRealPayments:false
 };
}
async function api(fetchImpl,token,endpoint,sql){
 const res=await fetchImpl(BASE+endpoint,{
  method:sql?'POST':'GET',
  headers:{authorization:'Bearer '+token,...(sql?{'content-type':'application/json'}:{})},
  ...(sql?{body:JSON.stringify({sql})}:{}),
  redirect:'error',signal:AbortSignal.timeout(25000)
 });
 if(!res.ok)throw Error('cloudflare_read_http_'+res.status);
 const data=await res.json();
 if(data?.success!==true)throw Error('cloudflare_read_failed');
 return data.result;
}
async function rows(fetchImpl,token,db,sql){
 const data=await api(fetchImpl,token,
  '/accounts/'+ACCOUNT+'/d1/database/'+db+'/query',sql);
 if(!Array.isArray(data)||!Array.isArray(data[0]?.results))
  throw Error('d1_query_unavailable');
 return data[0].results;
}
export async function inspectVariableStarsPrelaunch(token,fetchImpl=fetch){
 if(typeof token!=='string'||token.length<15)
  throw Error('cloudflare_read_token_missing');
 const worker='/accounts/'+ACCOUNT+'/workers/scripts/'+WORKER;
 const [settings,payTables,gameTables,paymentCounts,gameCounts,controls,
  deploy,workerReq,siteReq]=await Promise.all([
  api(fetchImpl,token,worker+'/settings'),
  rows(fetchImpl,token,PAYMENTS,PAYMENTS_SCHEMA_SQL),
  rows(fetchImpl,token,GAME,GAME_SCHEMA_SQL),
  rows(fetchImpl,token,PAYMENTS,ROWS_SQL),
  rows(fetchImpl,token,GAME,GAME_COUNTS_SQL),
  rows(fetchImpl,token,PAYMENTS,SETTINGS_SQL),
  api(fetchImpl,token,worker+'/deployments'),
  fetchImpl(BASE+worker,{headers:{authorization:'Bearer '+token},
   method:'GET',redirect:'error',signal:AbortSignal.timeout(25000)}),
  fetchImpl(SITE,{method:'GET',redirect:'error',
   signal:AbortSignal.timeout(25000)})
 ]);
 if(!workerReq.ok||!siteReq.ok)
  throw Error('worker_or_miniapp_not_readable');
 const workerText=await workerReq.text();
 const siteHtml=await siteReq.text();
 return evaluateVariableStarsPrelaunch({
  bindings:settings?.bindings,
  paymentTables:payTables.map(x=>x.name),
  gameTables:gameTables.map(x=>x.name),
  paymentCounts:Object.entries(paymentCounts[0]||{}).map(([name,n])=>({name,n})),
  gameCounts,controls,workerText,siteHtml,
  workerVersion:deploy?.deployments?.[0]?.versions?.[0]?.version_id
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 inspectVariableStarsPrelaunch(process.env.CLOUDFLARE_API_TOKEN)
  .then(report=>{
   console.log(JSON.stringify(report,null,2));
   if(report.blockers.length)process.exitCode=2;
  })
  .catch(e=>{
   console.error('RUST UP PRELAUNCH FAILED: '+String(e?.message||e));
   process.exitCode=1;
  });
}
