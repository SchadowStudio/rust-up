// RUST UP — privacy-preserving READ-ONLY game account integrity report.
// Queries ONLY aggregate counts; never fetches/prints Telegram user IDs,
// player names, actual balances, secrets or individual account records.
// No D1 writes, no automatic repair, no payment activation.
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ACCOUNT='af72e32cb9f1ba99dba07df30fe540fe';
const DB='9b0b533f-540a-4a25-a429-70ca8bd4e23d';
const WORKER='rustup-bot';
const FLAGS=['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
 'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
 'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
 'PAYMENT_WALLET_STRICT_MODE'];
const API='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT;
const COLUMNS=['accounts','missing_user','invalid_json','non_numeric_canonical',
 'null_mirror','non_numeric_mirror','negative_balance','over_credit_limit',
 'fractional_cent','mirror_drift','drift_one_cent_plus','drift_subcent',
 'distinct_account_review','overlimit_with_mirror_issue','restricted_accounts'];

// Exactly ONE row, WITHOUT id, name, email, actual balance or state values.
// The two balances remain exclusively inside D1's aggregate calculation.
export const AGGREGATE_SQL=`
WITH observed AS (
 SELECT
  json_valid(a.state) AS json_ok,
  CASE WHEN json_valid(a.state)=1
   THEN json_type(a.state,'$.balance') END AS balance_type,
  CASE WHEN json_valid(a.state)=1
   THEN json_extract(a.state,'$.balance') END AS canonical,
  u.id AS mirror_id,u.balance AS mirror,
  typeof(u.balance) AS mirror_type,u.blocked,u.banned
 FROM accounts a LEFT JOIN users u ON u.id=a.id
), classified AS (
 SELECT *,
  CASE WHEN balance_type IN ('integer','real')
   AND mirror_type IN ('integer','real')
   AND ABS(canonical-mirror)>=0.000001 THEN 1 ELSE 0 END AS differs,
  CASE WHEN mirror_id IS NULL OR mirror_type='null'
   OR mirror_type NOT IN ('integer','real') THEN 1 ELSE 0 END AS mirror_issue,
  CASE WHEN balance_type IN ('integer','real') AND canonical>=1000000
   THEN 1 ELSE 0 END AS overlimit
 FROM observed
)
SELECT COUNT(*) AS accounts,
 SUM(CASE WHEN mirror_id IS NULL THEN 1 ELSE 0 END) AS missing_user,
 SUM(CASE WHEN json_ok=0 THEN 1 ELSE 0 END) AS invalid_json,
 SUM(CASE WHEN balance_type IS NULL OR balance_type NOT IN ('integer','real')
  THEN 1 ELSE 0 END) AS non_numeric_canonical,
 SUM(CASE WHEN mirror_id IS NOT NULL AND mirror_type='null'
  THEN 1 ELSE 0 END) AS null_mirror,
 SUM(CASE WHEN mirror_id IS NOT NULL AND mirror_type NOT IN ('integer','real','null')
  THEN 1 ELSE 0 END) AS non_numeric_mirror,
 SUM(CASE WHEN balance_type IN ('integer','real') AND canonical<0
  THEN 1 ELSE 0 END) AS negative_balance,
 SUM(overlimit) AS over_credit_limit,
 SUM(CASE WHEN balance_type IN ('integer','real') AND
  ABS(canonical*100-ROUND(canonical*100))>0.00001
  THEN 1 ELSE 0 END) AS fractional_cent,
 SUM(differs) AS mirror_drift,
 SUM(CASE WHEN differs=1 AND ABS(canonical-mirror)>=0.01
  THEN 1 ELSE 0 END) AS drift_one_cent_plus,
 SUM(CASE WHEN differs=1 AND ABS(canonical-mirror)<0.01
  THEN 1 ELSE 0 END) AS drift_subcent,
 SUM(CASE WHEN mirror_issue=1 OR differs=1 OR json_ok=0 OR
   balance_type IS NULL OR balance_type NOT IN ('integer','real') OR
   (balance_type IN ('integer','real') AND
    (canonical<0 OR overlimit=1 OR ABS(canonical*100-ROUND(canonical*100))>0.00001))
  THEN 1 ELSE 0 END) AS distinct_account_review,
 SUM(CASE WHEN overlimit=1 AND (mirror_issue=1 OR differs=1)
  THEN 1 ELSE 0 END) AS overlimit_with_mirror_issue,
 SUM(CASE WHEN blocked=1 OR banned=1 THEN 1 ELSE 0 END) AS restricted_accounts
FROM classified`.trim();

export function evaluateGameAccountIntegrity(aggregate,{bindings,releaseControl}={}){
 if(!aggregate||!Array.isArray(bindings)||!releaseControl)
  throw Error('game_account_integrity_evidence_missing');
 const counts={};
 for(const key of COLUMNS){
  if(!Number.isSafeInteger(aggregate[key])||aggregate[key]<0)
   throw Error('game_account_integrity_invalid_aggregate_'+key);
  counts[key]=aggregate[key];
 }
 if(Object.entries(counts).some(([key,value])=>key!=='accounts'&&
  value>counts.accounts)||counts.mirror_drift!==
  counts.drift_one_cent_plus+counts.drift_subcent||
  counts.overlimit_with_mirror_issue>counts.over_credit_limit||
  counts.distinct_account_review<
    Math.max(counts.over_credit_limit,counts.mirror_drift,
     counts.null_mirror,counts.missing_user)||
  counts.distinct_account_review>counts.accounts)
  throw Error('game_account_integrity_inconsistent_aggregate');
 const bindingMap=new Map();
 for(const item of bindings){
  if(typeof item?.name!=='string'||bindingMap.has(item.name))
   throw Error('game_account_integrity_duplicate_binding');
  bindingMap.set(item.name,item);
 }
 const workerPaymentsOff=FLAGS.every(n=>bindingMap.get(n)?.type==='plain_text'&&
  bindingMap.get(n)?.text==='false');
 const gameDBBound=bindingMap.get('DB')?.type==='d1'&&
  (bindingMap.get('DB').id||bindingMap.get('DB').database_id)===DB;
 const gameLedgerGateOff=releaseControl.enabled===0&&
  releaseControl.approval_reference==null&&
  releaseControl.reviewed_at_ms==null;
 const reviewRequired=counts.distinct_account_review>0;
 return {
  mode:'READ_ONLY_GAME_ACCOUNT_INTEGRITY_AUDIT',
  readOnly:true,changesApplied:false,balancesChanged:false,
  playerIdentitiesIncluded:false,individualBalancesIncluded:false,
  autoRepairPermitted:false,livePaymentsApproved:false,
  inspectedAccounts:counts.accounts,
  distinctAccountsRequiringManualReview:counts.distinct_account_review,
  reasons:{
   mismatchedBalanceMirrors:counts.mirror_drift,
   missingUserRows:counts.missing_user,
   nullUserBalances:counts.null_mirror,
   invalidUserBalances:counts.non_numeric_mirror,
   malformedAccountJSON:counts.invalid_json,
   missingOrNonNumericAccountBalances:counts.non_numeric_canonical,
   negativeAccountBalances:counts.negative_balance,
   accountBalancesAtOrAbovePaidCreditLimit:counts.over_credit_limit,
   fractionalCentAccountBalances:counts.fractional_cent,
   mismatchesAtLeastOneCent:counts.drift_one_cent_plus,
   mismatchesBelowOneCent:counts.drift_subcent,
   aboveLimitAlsoHavingMirrorIssue:counts.overlimit_with_mirror_issue,
   restrictedAccounts:counts.restricted_accounts
  },
  workerPaymentsOff,gameDBBound,gameLedgerGateOff,
  reviewRequired,
  // No payment release may be inferred from the absence of findings.
  releaseApproval:false
 };
}

async function readJson(token,route,{sql=null,fetchImpl=fetch}={}){
 const res=await fetchImpl(API+route,{
  method:sql?'POST':'GET',
  redirect:'error',
  headers:{authorization:'Bearer '+token,
   ...(sql?{'content-type':'application/json'}:{})},
  ...(sql?{body:JSON.stringify({sql})}:{}),
  signal:AbortSignal.timeout(25000)
 });
 if(!res?.ok)throw Error('account_integrity_cloudflare_read_http_'+res?.status);
 const data=await res.json();
 if(data?.success!==true)throw Error('account_integrity_cloudflare_query_failed');
 return data.result;
}
export async function inspectLiveGameAccountIntegrity(token,fetchImpl=fetch){
 if(typeof token!=='string'||token.length<15)
  throw Error('account_integrity_read_only_token_required');
 const base='/d1/database/'+DB+'/query';
 const [aggregateRows,releaseRows,settings]=await Promise.all([
  readJson(token,base,{sql:AGGREGATE_SQL,fetchImpl}),
  readJson(token,base,{sql:
   'SELECT enabled,approval_reference,reviewed_at_ms FROM rustup_game_paid_release_control WHERE id=1',
   fetchImpl}),
  readJson(token,'/workers/scripts/'+WORKER+'/settings',{fetchImpl})
 ]);
 const rows=aggregateRows?.[0]?.results;
 const gate=releaseRows?.[0]?.results;
 if(!Array.isArray(rows)||rows.length!==1||
    !Array.isArray(gate)||gate.length!==1)
  throw Error('account_integrity_incomplete_d1_results');
 return evaluateGameAccountIntegrity(rows[0],{
  bindings:settings?.bindings,releaseControl:gate[0]
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 inspectLiveGameAccountIntegrity(process.env.CLOUDFLARE_API_TOKEN)
  .then(report=>{
   console.log(JSON.stringify(report,null,2));
   console.log('READ ONLY: no player accounts, payments or Worker settings changed.');
  })
  .catch(err=>{
   console.error('GAME ACCOUNT INTEGRITY AUDIT FAILED:',
    String(err?.message||'unknown').slice(0,130));
   process.exitCode=1;
  });
}
