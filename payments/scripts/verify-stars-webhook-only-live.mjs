// Strict READ-ONLY post-deployment check for the current Stars webhook
// extension. Validates original bot's exact bytes, clock, bindings, modules,
// and disabled payment + game-credit gates. Does not deploy or charge.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {checkHistoryReleaseMetadata}
 from './verify-history-only-worker-release.mjs';
import {verifyLiveStarsOwnerRate}
 from './stage-current-stars-webhook-only.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const PRIVATE=path.join(ROOT,'.private','rustup-bot-recovered')+path.sep;
const API='https://api.cloudflare.com/client/v4/accounts/'+
 'af72e32cb9f1ba99dba07df30fe540fe/workers/scripts/rustup-bot';
const OLD_VERSION='d618b572-ae34-4ec5-9e0e-471df5cbcfe2';
const ORIGINAL_SHA='dc181bc6f29e8256342fa216d80c73ff9850d1443c055a9002469f8685e193dc';
const REQUIRED=['worker.live-compiled-original.mjs',
 'stars-history-only-wrapper.mjs','stars-owner-price-preview.mjs',
 'stars-variable-webhook-wrapper.mjs','stars-variable-bridge.mjs',
 'variable-stars.mjs','stars-delivery-queue.mjs',
 'verified-stars-game-credit.mjs',
 'worker.stars-webhook-only-entry.mjs'];
const SHA=v=>createHash('sha256').update(v).digest('hex');
const fail=v=>{throw Error('stars_webhook_release_'+v);};

export function inspectWebhookOnlySource(raw,expectedHashes,originalSha=ORIGINAL_SHA){
 if(typeof raw!=='string'||raw.length<100000||raw.length>25000000||
    typeof expectedHashes!=='object'||!expectedHashes)
  fail('missing_compiled_or_stage_evidence');
 const b=raw.split(/\r?\n/,1)[0].trim();
 if(!/^--[A-Za-z0-9_=-]{8,200}$/.test(b))
  fail('multipart_invalid');
 const p=raw.split(b).filter(x=>x.includes('Content-Disposition:'));
 if(p.length!==2)fail('unexpected_compiled_parts');
 const files=p.map(part=>{
  const sep=part.includes('\r\n\r\n')?'\r\n\r\n':'\n\n';
  const at=part.indexOf(sep);
  if(at<0)fail('multipart_separator_missing');
  const name=/filename="([^"]+)"/.exec(part.slice(0,at))?.[1];
  if(!name)fail('multipart_name_missing');
  return {name,data:part.slice(at+sep.length).trim()};
 });
 const js=files.find(f=>f.name==='worker.stars-webhook-only.bundle.js');
 const map=files.find(f=>f.name==='worker.stars-webhook-only.bundle.js.map');
 if(!js||!map||js.data.length<100000)
  fail('missing_reviewed_worker_bundle_or_map');
 for(const marker of ['wrapHistoryOnlyWorker','wrapCurrentStarsWebhook',
  'runVariableStarsDeliveryQueue','deliverVerifiedVariableStarsCredit',
  '/api/stars/variable/history','/api/stars/variable/quote','refDeposit']){
  if(!js.data.includes(marker))fail('missing_worker_contract_'+marker.slice(0,40));
 }
 let m;
 try{m=JSON.parse(map.data);}catch{fail('invalid_sourcemap_json');}
 if(m?.version!==3||!Array.isArray(m.sources)||
    !Array.isArray(m.sourcesContent)||
    m.sources.length!==m.sourcesContent.length||
    m.sources.length<REQUIRED.length)
  fail('invalid_sourcemap_sources');
 const seen=new Set();
 for(let i=0;i<m.sources.length;i++){
  const name=String(m.sources[i]).split('/').pop();
  if(seen.has(name)||!Object.hasOwn(expectedHashes,name)||
     typeof m.sourcesContent[i]!=='string'||
     SHA(m.sourcesContent[i])!==expectedHashes[name])
   fail('untrusted_or_altered_compiled_source_'+name);
  seen.add(name);
 }
 if(REQUIRED.some(name=>!seen.has(name)))
  fail('missing_required_verified_source');
 if(expectedHashes['worker.live-compiled-original.mjs']!==originalSha)
  fail('original_bot_sha_changed');
 return {sourceMapVerified:true,originalBotExact:true,
  variableReceiptCapturePresent:true,paidDeliveryConsumerPresent:true,
  sourceModulesVerified:seen.size};
}
export function checkWebhookOnlyMetadata({settings,schedules,versionInfo,
 activeVersion,stage}){
 if(stage?.activeVersion!==OLD_VERSION||
    stage?.originalSha!==ORIGINAL_SHA||stage?.paymentsEnabled!==false)
  fail('unreviewed_private_stage');
 const report=checkHistoryReleaseMetadata({
  bindings:settings?.bindings,schedules,versionInfo,
  versionId:activeVersion,phase:'after',
  manifest:{format:1,source:'compiled_history_only',
   activeVersion:OLD_VERSION,sourceHash:ORIGINAL_SHA,
   scriptEtag:stage.etag}
 });
 verifyLiveStarsOwnerRate(settings.bindings);
 const b=new Map(settings.bindings.map(x=>[x.name,x]));
 for(const name of [
  'STARS_GAME_CREDIT_SETTLEMENT_ENABLED',
  'STARS_GAME_CREDIT_REFUND_RECONCILIATION_ENABLED'
 ])if(b.get(name)&&b.get(name)?.text!=='false')
  fail('paid_game_release_flag_unexpected_'+name);
 return {...report,starsRateRubPerStar:'1.83',
  gameCreditSettlementEnabled:false};
}
async function get(token,route,raw=false){
 const r=await fetch(API+route,{
  method:'GET',headers:{authorization:'Bearer '+token},
  signal:AbortSignal.timeout(25000),redirect:'error'
 });
 if(!r.ok)fail('cloudflare_http_'+r.status);
 if(raw)return r.text();
 const v=await r.json();
 if(v?.success!==true)fail('cloudflare_read_failed');
 return v.result;
}
export async function verifyLiveWebhookOnly(token,stageDir){
 if(typeof token!=='string'||token.length<15)
  fail('cloudflare_session_required');
 const dir=await fs.realpath(path.resolve(stageDir||''));
 if(!dir.startsWith(PRIVATE))fail('private_stage_directory_invalid');
 const stage=JSON.parse(await fs.readFile(path.join(dir,
  'RUSTUP-STARS-WEBHOOK-ONLY-STAGE.json'),'utf8'));
 const [settings,schedules,deployed,raw]=await Promise.all([
  get(token,'/settings'),get(token,'/schedules'),
  get(token,'/deployments'),get(token,'/content/v2',true)
 ]);
 const version=deployed?.deployments?.[0]?.versions?.[0]?.version_id;
 if(typeof version!=='string')fail('live_worker_version_unknown');
 const details=await get(token,'/versions/'+version);
 const metadata=checkWebhookOnlyMetadata({
  settings,schedules,versionInfo:details,
  activeVersion:version,stage
 });
 const hashes={};
 for(const name of [
  'worker.live-compiled-original.mjs','telegram-initdata.mjs',
  'deposit-history-readonly.mjs','stars-owner-price-preview.mjs',
  'stars-history-only-wrapper.mjs','stars-variable-webhook-wrapper.mjs',
  'stars-variable-bridge.mjs','variable-stars.mjs','stars.mjs',
  'payment-controls.mjs','stars-delivery-queue.mjs',
  'verified-stars-game-credit.mjs','worker.stars-webhook-only-entry.mjs'
 ]){
  hashes[name]=SHA(await fs.readFile(path.join(dir,name),'utf8'));
 }
 const source=inspectWebhookOnlySource(raw,hashes);
 return {...metadata,...source,
  invoicesCreatedByCheck:0,playerBalancesChangedByCheck:false,
  allRealPaymentsDisabled:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==3){
  console.error('Usage: node verify-stars-webhook-only-live.mjs <private-stage>');
  process.exitCode=2;
 }else verifyLiveWebhookOnly(process.env.CLOUDFLARE_API_TOKEN,process.argv[2])
  .then(x=>console.log('PASS: '+JSON.stringify(x)))
  .catch(e=>{console.error('WEBHOOK POST-RELEASE STOP:',
   String(e?.message||e).slice(0,160));process.exitCode=1;});
}
