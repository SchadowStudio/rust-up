// RUST UP: read-only aggregate audit of variable Telegram Stars orders.
// NEVER writes DB, creates invoices, processes charges, or credits game balances.
// Does not print Telegram IDs, payment charge IDs, orders or credentials.
const ACCOUNT='af72e32cb9f1ba99dba07df30fe540fe';
const DB='06079270-a227-466a-9991-abd4201ec5f6';
const BASE='https://api.cloudflare.com/client/v4';
const EXPECTED_STATES=new Set([
 'pending','checkout_approved','paid','refunded','manual_review'
]);
const FLAGS=[
 'PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
 'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
 'PAYMENT_WALLET_STRICT_MODE'
];

const COUNT_SQL=[
 'SELECT status,COUNT(*) AS total FROM rustup_stars_variable_orders',
 'GROUP BY status ORDER BY status'
].join(' ');

const ANOMALY_SQL=[
 'SELECT',
 "SUM(CASE WHEN status='paid' AND (telegram_charge_id IS NULL OR length(telegram_charge_id)=0) THEN 1 ELSE 0 END) AS paid_missing_charge,",
 "SUM(CASE WHEN status IN ('pending','checkout_approved') AND telegram_charge_id IS NOT NULL THEN 1 ELSE 0 END) AS unpaid_with_charge,",
 "SUM(CASE WHEN status='paid' AND (paid_at_ms IS NULL OR paid_at_ms=0) THEN 1 ELSE 0 END) AS paid_missing_timestamp,",
 "SUM(CASE WHEN status='checkout_approved' AND expires_at_ms < (CAST(strftime('%s','now') AS INTEGER)*1000-3600000) THEN 1 ELSE 0 END) AS approved_over_hour_old",
 'FROM rustup_stars_variable_orders'
].join(' ');

const REPLAY_SQL=[
 'SELECT COUNT(*) AS duplicated_charge_groups FROM (',
 'SELECT telegram_charge_id FROM rustup_stars_variable_orders',
 'WHERE telegram_charge_id IS NOT NULL',
 'GROUP BY telegram_charge_id HAVING COUNT(*)>1)'
].join(' ');

function safeCount(value){
 if(value===null||value===undefined)return 0;
 if(!Number.isSafeInteger(value)||value<0)
  throw Error('audit_invalid_aggregate');
 return value;
}
export function buildVariableStarsAudit(counts,anomaly,duplicates,bindings){
 if(!Array.isArray(counts)||typeof anomaly!=='object'||!anomaly||
    typeof duplicates!=='object'||!duplicates||!Array.isArray(bindings))
  throw Error('audit_invalid_response');
 const summary=Object.create(null);
 for(const name of EXPECTED_STATES)summary[name]=0;
 for(const row of counts){
  if(!EXPECTED_STATES.has(row?.status)||summary[row.status]!==0)
   throw Error('audit_unknown_or_duplicate_status');
  summary[row.status]=safeCount(row.total);
 }
 const issues={
  paidMissingCharge:safeCount(anomaly.paid_missing_charge),
  unpaidWithCharge:safeCount(anomaly.unpaid_with_charge),
  paidMissingTimestamp:safeCount(anomaly.paid_missing_timestamp),
  checkoutOverHourOld:safeCount(anomaly.approved_over_hour_old),
  duplicateChargeGroups:safeCount(duplicates.duplicated_charge_groups)
 };
 const flags=Object.create(null),byName=new Map(bindings.map(x=>[x.name,x]));
 for(const name of FLAGS){
  const b=byName.get(name);
  const value=b?.text??b?.value;
  if(b?.type!=='plain_text'||!['true','false'].includes(value))
   throw Error('audit_unknown_payment_gate_'+name);
  flags[name]=value==='true';
 }
 const total=Object.values(summary).reduce((a,b)=>a+b,0);
 const anomalyCount=Object.values(issues).reduce((a,b)=>a+b,0);
 const paymentsEnabled=flags.PAYMENT_PRODUCTION_ENABLED&&
  flags.STARS_PAYMENT_ENABLED&&flags.STARS_VARIABLE_TOPUP_ENABLED;
 const safe=anomalyCount===0&&!paymentsEnabled;
 return {
  ok:true,readOnly:true,
  summary:{...summary,total},
  anomalies:issues,
  flags:{...flags},
  acceptingPayments:paymentsEnabled,
  gameCreditAvailable:false,
  status:safe?'NO_ANOMALIES_PAYMENT_DISABLED':
    anomalyCount?'MANUAL_REVIEW_REQUIRED':'PAYMENT_GATE_REQUIRES_REVIEW'
 };
}
async function cloudflare(method,path,token,body){
 const response=await fetch(BASE+path,{
  method,redirect:'error',signal:AbortSignal.timeout(25000),
  headers:{authorization:'Bearer '+token,
   ...(body?{'content-type':'application/json'}:{})},
  ...(body?{body:JSON.stringify(body)}:{})
 });
 if(!response.ok)throw Error('cloudflare_read_http_'+response.status);
 const result=await response.json();
 if(result?.success!==true)throw Error('cloudflare_read_failed');
 return result.result;
}
async function readAggregate(sql,token){
 // Never accept an untrusted SQL argument: caller uses only fixed literals.
 if(![COUNT_SQL,ANOMALY_SQL,REPLAY_SQL].includes(sql))
  throw Error('audit_query_not_whitelisted');
 const results=await cloudflare('POST',
  '/accounts/'+ACCOUNT+'/d1/database/'+DB+'/query',token,{sql});
 if(!Array.isArray(results)||!Array.isArray(results[0]?.results))
  throw Error('audit_unexpected_d1_result');
 return results[0].results;
}
export async function auditVariableStars(token){
 if(typeof token!=='string'||token.length<15)
  throw Error('private_cloudflare_login_required');
 const [countRows,anomalyRows,replayRows,settings]=await Promise.all([
  readAggregate(COUNT_SQL,token),readAggregate(ANOMALY_SQL,token),
  readAggregate(REPLAY_SQL,token),
  cloudflare('GET','/accounts/'+ACCOUNT+'/workers/scripts/rustup-bot/settings',token)
 ]);
 return buildVariableStarsAudit(countRows,anomalyRows[0],replayRows[0],
  settings?.bindings);
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1].replace(/\\/g,'/')).href)
 auditVariableStars(process.env.CLOUDFLARE_API_TOKEN)
  .then(report=>{
   console.log(JSON.stringify(report,null,2));
   if(report.status!=='NO_ANOMALIES_PAYMENT_DISABLED')
    process.exitCode=2;
  })
  .catch(e=>{
   console.error('RUST UP STARS AUDIT FAILED:',String(e?.message||'unknown'));
   process.exitCode=1;
  });
