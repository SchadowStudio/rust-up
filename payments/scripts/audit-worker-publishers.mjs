// RUST UP Cloudflare Workers read-only deployment ownership audit.
// Helps detect competing Wrangler deployments that overwrite Stars D1 bindings.
// Never prints user identity, actor ID, email, API key, or any game account.
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ACCOUNT='af72e32cb9f1ba99dba07df30fe540fe';
const WORKER='rustup-bot';
const WINDOW=120*60*1000;
const REQUIRED_DB='06079270-a227-466a-9991-abd4201ec5f6';
const EXPECTED_OFF=['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
 'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
 'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
 'PAYMENT_WALLET_STRICT_MODE'];
const ms=t=>Date.parse(t||'');
export function diagnoseCompetingWorkerPublishers({
 deployments,auditLogs,bindings,now=Date.now()
}={}){
 if(!Array.isArray(deployments)||!Array.isArray(auditLogs)||
    !Array.isArray(bindings)||!Number.isFinite(now))
  throw Error('worker_publisher_evidence_missing');
 const published=deployments.filter(x=>x&&Number.isFinite(ms(x.created_on)))
  .sort((a,b)=>ms(b.created_on)-ms(a.created_on));
 if(!published.length)throw Error('worker_deployment_history_missing');
 const updates=auditLogs.filter(x=>x?.action?.type==='script_update'&&
  typeof x.metadata?.script_tag==='string'&&x.metadata.script_tag&&
  typeof x.actor?.id==='string'&&Number.isFinite(ms(x.when)));
 // Find the script's unique tag from a precise neighboring version upload.
 const matched=updates.filter(x=>published.some(d=>
  Math.abs(ms(d.created_on)-ms(x.when))<=5000));
 const tags=[...new Set(matched.map(x=>x.metadata.script_tag))];
 if(tags.length!==1)throw Error('worker_audit_script_identity_ambiguous');
 const same=updates.filter(x=>x.metadata.script_tag===tags[0]);
 const recent=same.filter(x=>ms(x.when)>=now-WINDOW&&ms(x.when)<=now+60000)
  .sort((a,b)=>ms(b.when)-ms(a.when));
 const groupMap=new Map();
 const events=recent.map(x=>{
  if(!groupMap.has(x.actor.id))groupMap.set(x.actor.id,'publisher-'+(groupMap.size+1));
  return {when:x.when,publisher:groupMap.get(x.actor.id)};
 });
 const db=bindings.find(x=>x.name==='PAYMENTS_DB');
 const correctPaymentDb=db?.type==='d1'&&
  (db.id===REQUIRED_DB||db.database_id===REQUIRED_DB);
 const flags=Object.fromEntries(EXPECTED_OFF.map(name=>{
  const b=bindings.find(x=>x.name===name);
  return [name,b?.type==='plain_text'&&b.text==='false'?'OFF':
   b?.type==='plain_text'&&b.text==='true'?'ON':'MISSING'];
 }));
 const allPaymentFlagsOff=Object.values(flags).every(x=>x==='OFF');
 const conflictingPublishers=groupMap.size>1;
 const actionable=[
  ...(!correctPaymentDb?['payment_d1_binding_was_overwritten']:[]),
  ...(!allPaymentFlagsOff?['payment_flags_are_missing_or_unsafe']:[]),
  ...(conflictingPublishers?['multiple_wrangler_publishers_on_same_worker']:[]),
  ...(!recent.length?['no_recent_deployment_actor_evidence']:[])
 ];
 return {
  mode:'READ_ONLY_WORKER_PUBLISHER_AUDIT',
  readOnly:true,changedWorker:false,changedPayments:false,
  liveVersion:published[0]?.versions?.[0]?.version_id||null,
  lastDeployment:published[0]?.created_on||null,
  paymentDbBound:correctPaymentDb,
  allPaymentFlagsOff,
  paymentFlags:flags,
  distinctRecentPublisherCount:groupMap.size,
  recentDeployments:events.slice(0,10),
  blockers:actionable,
  hasConflictingDeployers:conflictingPublishers,
  readyForUnattendedPayments:false
 };
}
// If the local token cannot read account-wide Audit Logs, still examine the
// latest deployed Worker and finance bindings. Publisher ownership stays UNKNOWN
// and release must fail closed. No fabricated actor identities or all-clear.
export function diagnoseWorkerBindingsWithoutAudit({deployments,bindings}={}){
 if(!Array.isArray(deployments)||!Array.isArray(bindings))
  throw Error('worker_binding_evidence_missing');
 const published=deployments.filter(x=>x&&Number.isFinite(ms(x.created_on)))
  .sort((a,b)=>ms(b.created_on)-ms(a.created_on));
 if(!published.length)throw Error('worker_deployment_history_missing');
 const db=bindings.find(x=>x.name==='PAYMENTS_DB');
 const paymentDbBound=db?.type==='d1'&&
  (db.id===REQUIRED_DB||db.database_id===REQUIRED_DB);
 const paymentFlags=Object.fromEntries(EXPECTED_OFF.map(name=>{
  const b=bindings.find(x=>x.name===name);
  return [name,b?.type==='plain_text'&&b.text==='false'?'OFF':
   b?.type==='plain_text'&&b.text==='true'?'ON':'MISSING'];
 }));
 const allPaymentFlagsOff=Object.values(paymentFlags).every(x=>x==='OFF');
 return {
  mode:'READ_ONLY_WORKER_PUBLISHER_AUDIT',
  readOnly:true,changedWorker:false,changedPayments:false,
  liveVersion:published[0]?.versions?.[0]?.version_id||null,
  lastDeployment:published[0]?.created_on||null,
  paymentDbBound,allPaymentFlagsOff,paymentFlags,
  distinctRecentPublisherCount:null,recentDeployments:[],
  publisherAudit:'UNAVAILABLE_ACCOUNT_SETTINGS_READ_REQUIRED',
  blockers:[
   ...(!paymentDbBound?['payment_d1_binding_was_overwritten']:[]),
   ...(!allPaymentFlagsOff?['payment_flags_are_missing_or_unsafe']:[]),
   'publisher_actor_audit_unavailable'
  ],
  hasConflictingDeployers:null,
  readyForUnattendedPayments:false
 };
}
async function cloudflare(token,route,scope,fetchImpl=fetch){
 const resp=await fetchImpl('https://api.cloudflare.com/client/v4'+route,{
  headers:{authorization:'Bearer '+token},method:'GET',redirect:'error',
  signal:AbortSignal.timeout(25000)
 });
 if(!resp.ok)throw Error('cloudflare_'+scope+'_http_'+resp.status);
 const result=await resp.json();
 if(result.success!==true)throw Error('cloudflare_'+scope+'_read_failed');
 return result.result;
}
export async function inspectWorkerPublishers(token,fetchImpl=fetch){
 if(typeof token!=='string'||token.length<15)
  throw Error('local_cloudflare_login_required');
 const prefix='/accounts/'+ACCOUNT+'/workers/scripts/'+WORKER;
 const [deploy,settings]=await Promise.all([
  cloudflare(token,prefix+'/deployments','deployments',fetchImpl),
  cloudflare(token,prefix+'/settings','settings',fetchImpl)
 ]);
 let audit;
 try{
  audit=await cloudflare(token,'/accounts/'+ACCOUNT+
   '/audit_logs?per_page=100','audit_logs',fetchImpl);
 }catch(e){
  if(e?.message==='cloudflare_audit_logs_http_403')
   return diagnoseWorkerBindingsWithoutAudit({
    deployments:deploy?.deployments,bindings:settings?.bindings
   });
  throw e;
 }
 if(!Array.isArray(audit))throw Error('invalid_cloudflare_audit_history');
 return diagnoseCompetingWorkerPublishers({
  deployments:deploy?.deployments,auditLogs:audit,bindings:settings?.bindings
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 inspectWorkerPublishers(process.env.CLOUDFLARE_API_TOKEN)
  .then(report=>{
   console.log(JSON.stringify(report,null,2));
   console.log('READ ONLY. Publisher aliases are ephemeral, no emails or IDs exposed.');
   if(report.blockers.length)process.exitCode=2;
  })
  .catch(e=>{console.error('RUST UP WORKER PUBLISHER AUDIT FAILED:',
   String(e?.message||e).slice(0,120));process.exitCode=1;});
}
