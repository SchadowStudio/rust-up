// RUST UP live Worker safety check. Read-only, sanitised output.
// Payment bindings alone do NOT mean the Stars adapter is deployed.
// No secret, player data, source code, or actor identifiers are printed.
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ACCOUNT='af72e32cb9f1ba99dba07df30fe540fe';
const WORKER='rustup-bot';
const GAME='9b0b533f-540a-4a25-a429-70ca8bd4e23d';
const PAYMENTS='06079270-a227-466a-9991-abd4201ec5f6';
const FLAGS=[
 'PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
 'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
 'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
 'PAYMENT_WALLET_STRICT_MODE'
];
const SECRETS=['BOT_TOKEN','WEBHOOK_SECRET','ADMIN_BOT_TOKEN','CLIPS_BOT_TOKEN'];
const BASE='https://api.cloudflare.com/client/v4';

export function inspectWorkerMultipart(raw){
 if(typeof raw!=='string'||raw.length<300||raw.length>25_000_000)
  throw Error('worker_content_unavailable');
 const boundary=raw.split(/\r?\n/,1)[0].trim();
 if(!/^--[a-zA-Z0-9_=-]{8,200}$/.test(boundary))
  throw Error('worker_multipart_invalid');
 const parts=raw.split(boundary).filter(x=>x.includes('Content-Disposition:'));
 const script=parts.filter(x=>/filename="[^"]*\.js"/.test(x));
 const maps=parts.filter(x=>/filename="[^"]*\.js\.map"/.test(x));
 if(script.length!==1||maps.length>1)
  throw Error('worker_module_content_ambiguous');
 const separator=script[0].includes('\r\n\r\n')?'\r\n\r\n':'\n\n';
 const at=script[0].indexOf(separator);
 if(at<0)throw Error('worker_module_invalid');
 const compiled=script[0].slice(at+separator.length);
 if(compiled.length<100||compiled.length>20_000_000)
  throw Error('worker_module_invalid');
 return {
  hasSourceMap:maps.length===1,
  fixedStarsAdapterPresent:compiled.includes('wrapExistingWorker')&&
   compiled.includes('stars_terms_acceptance_required')&&
   compiled.includes('/api/stars/health'),
  // Compiled code marker only; never equivalent to a paid Telegram receipt.
  scriptReadable:true
 };
}

export function evaluateLiveWorkerSafety({settings,deployments,multipart}={}){
 if(!Array.isArray(settings?.bindings)||!Array.isArray(deployments)||
    !multipart||typeof multipart!=='object')
  throw Error('worker_readiness_evidence_incomplete');
 const b=new Map();
 for(const x of settings.bindings){
  if(typeof x?.name!=='string'||b.has(x.name))
   throw Error('worker_duplicate_or_invalid_binding');
  b.set(x.name,x);
 }
 const d1=(name,id)=>{
  const x=b.get(name);
  return x?.type==='d1'&&(x.id===id||x.database_id===id);
 };
 const botSecretsIntact=SECRETS.every(name=>b.get(name)?.type==='secret_text');
 const bothDatabasesBound=d1('DB',GAME)&&d1('PAYMENTS_DB',PAYMENTS);
 const flagValues=Object.fromEntries(FLAGS.map(name=>{
  const x=b.get(name);
  return [name,x?.type==='plain_text'&&x.text==='false'?'OFF':
   x?.type==='plain_text'&&x.text==='true'?'ON':'MISSING'];
 }));
 const allPaymentFlagsOff=Object.values(flagValues).every(x=>x==='OFF');
 const active=deployments[0]?.versions?.[0]?.version_id;
 if(typeof active!=='string'||active.length<8)
  throw Error('worker_live_version_unknown');
 const blockers=[
  ...(!botSecretsIntact?['existing_bot_secrets_missing']:[]),
  ...(!bothDatabasesBound?['two_correct_databases_not_bound']:[]),
  ...(!allPaymentFlagsOff?['payment_release_flags_not_explicitly_off']:[]),
  ...(!multipart.scriptReadable?['live_worker_code_unreadable']:[]),
  ...(!multipart.fixedStarsAdapterPresent?['live_stars_adapter_not_deployed']:[]),
  ...(!multipart.hasSourceMap?['live_worker_sourcemap_unavailable_for_safe_recovery']:[])
 ];
 return {
  mode:'READ_ONLY_LIVE_WORKER_SAFETY',
  activeVersion:active,
  botSecretsIntact,bothDatabasesBound,allPaymentFlagsOff,flagValues,
  fixedStarsAdapterPresent:multipart.fixedStarsAdapterPresent===true,
  sourceMapAvailable:multipart.hasSourceMap===true,
  liveChargingNotAssessed:true, // flags OFF does not prove historical transactions
  changesApplied:false,
  blockers,
  realPaymentActivationApproved:false
 };
}
async function cf(token,route,raw=false,fetchImpl=fetch){
 const r=await fetchImpl(BASE+route,{method:'GET',
  headers:{authorization:'Bearer '+token},redirect:'error',
  signal:AbortSignal.timeout(25000)});
 if(!r?.ok)throw Error('cloudflare_worker_read_http_'+r?.status);
 if(raw)return r.text();
 const data=await r.json();
 if(data?.success!==true)throw Error('cloudflare_worker_read_failed');
 return data.result;
}
export async function inspectLiveWorker(token,fetchImpl=fetch){
 if(typeof token!=='string'||token.length<15)
  throw Error('local_cloudflare_login_required');
 const prefix='/accounts/'+ACCOUNT+'/workers/scripts/'+WORKER;
 const [settings,deployment,raw]=await Promise.all([
  cf(token,prefix+'/settings',false,fetchImpl),
  cf(token,prefix+'/deployments',false,fetchImpl),
  cf(token,prefix+'/content/v2',true,fetchImpl)
 ]);
 return evaluateLiveWorkerSafety({
  settings,deployments:deployment?.deployments,
  multipart:inspectWorkerMultipart(raw)
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 inspectLiveWorker(process.env.CLOUDFLARE_API_TOKEN)
  .then(report=>{
   console.log(JSON.stringify(report,null,2));
   console.log('READ ONLY: no Worker, payment settings or player balances changed.');
   if(report.blockers.length)process.exitCode=2;
  })
  .catch(error=>{
   console.error('LIVE WORKER SAFETY AUDIT FAILED:',
    String(error?.message||error).slice(0,130));
   process.exitCode=1;
  });
}
