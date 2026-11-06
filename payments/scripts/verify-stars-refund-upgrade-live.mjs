// Strict read-only Cloudflare source and security verification for the
// newer refund/quote Worker. NEVER enables invoices or deposits.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {checkWebhookOnlyMetadata,inspectWebhookOnlySource}
 from './verify-stars-webhook-only-live.mjs';
import {STAGE_SOURCES,verifyRefundStage}
 from './verify-stars-refund-upgrade-stage.mjs';
const API='https://api.cloudflare.com/client/v4/accounts/'+
 'af72e32cb9f1ba99dba07df30fe540fe/workers/scripts/rustup-bot';
const CURRENT_VERSION='285f2656-d696-4fe4-a078-b90efb987e6d';
const SHA=x=>createHash('sha256').update(x).digest('hex');
function stop(x){throw Error('stars_refund_live_'+x);}
async function cloud(token,route,raw=false){
 const response=await fetch(API+route,{method:'GET',
  headers:{authorization:'Bearer '+token},
  redirect:'error',signal:AbortSignal.timeout(25000)});
 if(!response.ok)stop('cloudflare_read_'+response.status);
 if(raw)return response.text();
 const data=await response.json();
 if(data?.success!==true)stop('cloudflare_invalid_response');
 return data.result;
}
export async function verifyRefundUpgradeLive(token,folder,phase='after'){
 if(typeof token!=='string'||token.length<15)stop('cloudflare_auth_missing');
 if(!['before','after','deployed'].includes(phase))stop('invalid_phase');
 const stage=await verifyRefundStage(folder);
 const dir=await fs.realpath(path.resolve(folder));
 const manifest=JSON.parse(await fs.readFile(path.join(dir,
  'RUSTUP-STARS-WEBHOOK-ONLY-STAGE.json'),'utf8'));
 const [settings,schedules,deploy,raw]=await Promise.all([
  cloud(token,'/settings'),cloud(token,'/schedules'),
  cloud(token,'/deployments'),cloud(token,'/content/v2',true)
 ]);
 const version=deploy?.deployments?.[0]?.versions?.[0]?.version_id;
 if(typeof version!=='string'||version.length<8)
  stop('live_version_missing');
 if((phase==='before'||phase==='deployed')&&version!==CURRENT_VERSION)
  stop('active_version_changed_before_release');
 if(phase==='after'&&version===CURRENT_VERSION)
  stop('no_new_worker_version');
 const details=await cloud(token,'/versions/'+version);
 const metadata=checkWebhookOnlyMetadata({
  settings,schedules,versionInfo:details,
  activeVersion:version,stage:manifest
 });
 const bindings=new Map(settings.bindings.map(x=>[x.name,x]));
 for(const name of ['STARS_GAME_CREDIT_SETTLEMENT_ENABLED',
  'STARS_GAME_CREDIT_REFUND_RECONCILIATION_ENABLED',
  'STARS_VARIABLE_CHECKOUT_RELEASE_APPROVED']){
  if(bindings.has(name)&&bindings.get(name).text!=='false')
   stop('unexpected_paid_activation_'+name);
 }
 if(phase==='before'){
  return {...metadata,phase,stageBundleSha256:stage.bundleSha256,
   expectedExistingVersion:CURRENT_VERSION,realPaymentsEnabled:false};
 }
 const expected={};
 for(const name of STAGE_SOURCES)
  expected[name]=SHA(await fs.readFile(path.join(dir,name),'utf8'));
 const source=inspectWebhookOnlySource(raw,expected);
 if(source.sourceModulesVerified!==STAGE_SOURCES.length)
  stop('source_count_mismatch');
 return {...metadata,...source,phase,stageBundleSha256:stage.bundleSha256,
  ...(phase==='deployed'?{verifiedExistingVersion:version}:{newWorkerVersion:version}),
  realPaymentsEnabled:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [phase,dir]=process.argv.slice(2);
 if(!dir||!['before','after','deployed'].includes(phase)||process.argv.length!==4){
  console.error('Usage: node verify-stars-refund-upgrade-live.mjs before|deployed|after <stage>');
  process.exitCode=2;
 }else verifyRefundUpgradeLive(process.env.CLOUDFLARE_API_TOKEN,dir,phase)
  .then(x=>console.log('PASS: '+JSON.stringify(x)))
  .catch(e=>{console.error('STARS RELEASE REFUSED:',
   String(e?.message||e).slice(0,200));process.exitCode=1;});
}
