// RUST UP – READ ONLY preflight for installing the additive game receipt journal.
// This does not create tables, charge Telegram Stars, or edit balances.
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ACCOUNT='af72e32cb9f1ba99dba07df30fe540fe';
const GAME='9b0b533f-540a-4a25-a429-70ca8bd4e23d';
const PAYMENTS='06079270-a227-466a-9991-abd4201ec5f6';
const FLAGS=['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
 'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
 'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
 'PAYMENT_WALLET_STRICT_MODE'];
const REQUIRED_ACCOUNTS=['id','state','v','updated'];
const REQUIRED_USERS=['id','balance','blocked','banned'];
const paymentControls=['master','stars','crypto'];
const EXPECTED_JOURNAL=Object.freeze({
 rustup_game_paid_release_control:'table',
 rustup_game_paid_receipts:'table',
 rustup_game_paid_receipts_by_user:'index',
 rustup_game_paid_receipts_preflight:'trigger',
 rustup_game_paid_receipts_apply:'trigger',
 rustup_game_paid_refunds:'table',
 rustup_game_paid_refunds_by_user:'index',
 rustup_game_paid_refunds_verify:'trigger',
 rustup_game_paid_refunds_preflight:'trigger',
 rustup_game_paid_refunds_apply:'trigger'
});

export function assessGameLedgerMigration({
 accountColumns,userColumns,oldJournalObjects,bindings,controls,
 paidOrderCount,accountConsistency,backupAvailable,releaseControl=null
}={}){
 if(!Array.isArray(accountColumns)||!Array.isArray(userColumns)||
    !Array.isArray(oldJournalObjects)||!Array.isArray(bindings)||
    !Array.isArray(controls)||!Number.isSafeInteger(paidOrderCount)||
    paidOrderCount<0||!accountConsistency||
    !Number.isSafeInteger(accountConsistency.accountCount)||
    !Number.isSafeInteger(accountConsistency.mismatchedMirrors)||
    !Number.isSafeInteger(accountConsistency.unsupportedBalances)||
    typeof backupAvailable!=='boolean')
  throw Error('migration_read_only_evidence_incomplete');
 const names=x=>new Set(x.map(c=>c.name));
 const schemaValid=REQUIRED_ACCOUNTS.every(n=>names(accountColumns).has(n))&&
  REQUIRED_USERS.every(n=>names(userColumns).has(n));
 const emptyJournal=oldJournalObjects.length===0;
 const installed=oldJournalObjects.length===Object.keys(EXPECTED_JOURNAL).length&&
  oldJournalObjects.every(x=>EXPECTED_JOURNAL[x.name]===x.type);
 const locked=installed&&releaseControl?.enabled===0&&
  releaseControl.approval_reference==null&&
  releaseControl.reviewed_at_ms==null;
 const gateOn=installed&&releaseControl?.enabled===1;
 const bindingsMap=new Map(bindings.map(x=>[x.name,x]));
 if(bindingsMap.size!==bindings.length)throw Error('duplicate_live_worker_binding');
 const gameDb=bindingsMap.get('DB');
 const paymentDb=bindingsMap.get('PAYMENTS_DB');
 const bothDatabasesBound=gameDb?.type==='d1'&&
  (gameDb.id||gameDb.database_id)===GAME&&paymentDb?.type==='d1'&&
  (paymentDb.id||paymentDb.database_id)===PAYMENTS;
 const flagsOff=FLAGS.every(n=>bindingsMap.get(n)?.type==='plain_text'&&
  bindingsMap.get(n)?.text==='false');
 const controlsOff=paymentControls.every(n=>
  controls.some(c=>c.channel===n&&c.enabled===0));
 const blockers=[
  ...(!schemaValid?['game_account_schema_drift']:[]),
  ...(!emptyJournal&&!installed?['partial_or_unknown_paid_journal_requires_review']:[]),
  ...(installed&&!locked?['installed_paid_journal_gate_not_verified_off']:[]),
  ...(!bothDatabasesBound?['correct_two_d1_bindings_required']:[]),
  ...(!flagsOff?['live_worker_payment_flags_not_all_off']:[]),
  ...(!controlsOff?['database_payment_controls_not_all_off']:[]),
  ...(paidOrderCount>0?['existing_real_charge_states_require_reconciliation']:[]),
  ...(!backupAvailable?['d1_time_travel_bookmark_unavailable']:[])
 ];
 return {
  mode:'READ_ONLY_GAME_LEDGER_MIGRATION_PREFLIGHT',
  readOnly:true,changesApplied:false,chargesEnabled:false,
  safeToPrepareMigration:blockers.length===0&&emptyJournal,
  installedAndLocked:blockers.length===0&&locked,
  journalInstallationState:emptyJournal?'ABSENT':locked?'INSTALLED_LOCKED':
   gateOn?'INSTALLED_GATE_ON':'PARTIAL_OR_UNVERIFIED',
  sourceTablesPresent:schemaValid,journalAbsent:emptyJournal,
  bothDatabasesBound,flagsOff,controlsOff,backupAvailable,
  accountCount:accountConsistency.accountCount,
  accountsWithMirrorDrift:accountConsistency.mismatchedMirrors,
  accountsWithUnsupportedBalance:accountConsistency.unsupportedBalances,
  existingChargedOrRefundedOrders:paidOrderCount,
  // Any real balance discrepancy is an independent *release* blocker.
  accountSettlementBlockers:[
   ...(accountConsistency.mismatchedMirrors>0?
     ['existing_game_balance_mirror_mismatch']:[]),
   ...(accountConsistency.unsupportedBalances>0?
     ['existing_game_balance_out_of_supported_range']:[])
  ],
  blockers
 };
}
async function get(token,path,fetchImpl){
 const r=await fetchImpl('https://api.cloudflare.com/client/v4'+path,{
  method:'GET',headers:{authorization:'Bearer '+token},redirect:'error',
  signal:AbortSignal.timeout(25000)
 });
 if(!r.ok)throw Error('cloudflare_read_http_'+r.status);
 const d=await r.json();
 if(d?.success!==true)throw Error('cloudflare_read_failed');
 return d.result;
}
async function query(token,db,sql,fetchImpl){
 const r=await fetchImpl('https://api.cloudflare.com/client/v4/accounts/'+
  ACCOUNT+'/d1/database/'+db+'/query',{
  method:'POST',headers:{authorization:'Bearer '+token,
   'content-type':'application/json'},
  body:JSON.stringify({sql}),redirect:'error',
  signal:AbortSignal.timeout(25000)
 });
 if(!r.ok)throw Error('cloudflare_d1_read_http_'+r.status);
 const d=await r.json();
 if(d?.success!==true||!Array.isArray(d.result?.[0]?.results))
  throw Error('cloudflare_d1_read_invalid');
 return d.result[0].results;
}
export async function inspectGameLedgerPreflight(token,fetchImpl=fetch){
 if(typeof token!=='string'||token.length<15)
  throw Error('cloudflare_read_token_required_locally');
 const p='/accounts/'+ACCOUNT;
 const [accountColumns,userColumns,oldJournalObjects,settings,controls,
  paidOrders,consistency,bookmark]=await Promise.all([
  query(token,GAME,'PRAGMA table_info(accounts)',fetchImpl),
  query(token,GAME,'PRAGMA table_info(users)',fetchImpl),
  query(token,GAME,"SELECT name,type FROM sqlite_master WHERE name LIKE 'rustup_game_paid_%' ORDER BY name",fetchImpl),
  get(token,p+'/workers/scripts/rustup-bot/settings',fetchImpl),
  query(token,PAYMENTS,'SELECT channel,enabled FROM rustup_payment_settings ORDER BY channel',fetchImpl),
  query(token,PAYMENTS,"SELECT COUNT(*) AS n FROM rustup_stars_variable_orders WHERE status IN ('paid','refunded','checkout_approved','manual_review')",fetchImpl),
  query(token,GAME,"SELECT (SELECT COUNT(*) FROM accounts) AS account_count, "+
    "SUM(CASE WHEN u.id IS NULL OR u.balance IS NULL OR json_valid(a.state)=0 OR "+
    "CASE WHEN json_valid(a.state)=1 THEN "+
    "ABS(json_extract(a.state,'$.balance')-u.balance)>=0.000001 ELSE 1 END "+
    "THEN 1 ELSE 0 END) AS drift, "+
    "SUM(CASE WHEN json_valid(a.state)=1 THEN "+
    "(json_type(a.state,'$.balance') NOT IN ('integer','real') OR "+
    "json_extract(a.state,'$.balance') < 0 OR "+
    "json_extract(a.state,'$.balance') >= 1000000) "+
    "ELSE 1 END) AS invalid_balance "+
    "FROM accounts a LEFT JOIN users u ON u.id=a.id",fetchImpl),
  get(token,p+'/d1/database/'+GAME+'/time_travel/bookmark',fetchImpl)
 ]);
 const row=consistency[0];
 let releaseControl=null;
 if(oldJournalObjects.some(x=>x.name==='rustup_game_paid_release_control')){
  const rows=await query(token,GAME,
   'SELECT enabled,approval_reference,reviewed_at_ms FROM rustup_game_paid_release_control WHERE id=1',
   fetchImpl);
  releaseControl=rows.length===1?rows[0]:null;
 }
 return assessGameLedgerMigration({
  accountColumns,userColumns,oldJournalObjects,releaseControl,
  bindings:settings?.bindings||[],controls,
  paidOrderCount:paidOrders[0]?.n,
  accountConsistency:{
   accountCount:row?.account_count,
   mismatchedMirrors:row?.drift??0,
   unsupportedBalances:row?.invalid_balance??0
  },
  backupAvailable:typeof bookmark?.bookmark==='string'&&
   bookmark.bookmark.length>10
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 inspectGameLedgerPreflight(process.env.CLOUDFLARE_API_TOKEN)
 .then(report=>{
  console.log(JSON.stringify(report,null,2));
  console.log('READ ONLY: schema, balances, payment flags and D1 restore bookmark checked.');
  if(report.blockers.length)process.exitCode=2;
 })
 .catch(error=>{
  console.error('GAME LEDGER PREFLIGHT BLOCKED:',
   String(error?.message||'unknown').slice(0,150));
  process.exitCode=1;
 });
}
