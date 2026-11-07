// Targeted, fail-closed patch of the deployed 16-module RUST UP Worker.
// Only stars-history-only-wrapper.mjs may differ from live sources.
// Privately backs up all live source modules; NO payment flags or D1 writes.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {safeWorkerConfig} from './stage-current-verified-worker.mjs';
import {flattenVerifiedSettlementImport} from './stage-current-stars-webhook-only.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const PRIVATE=path.join(ROOT,'.private','rustup-bot-recovered');
const TARGET='stars-history-only-wrapper.mjs';
const ENTRY='worker.stars-webhook-only-entry.mjs';
const BUNDLE='worker.stars-auth-reason.bundle.js';
const CONFIG='wrangler.stars-auth-reason.toml';
const MANIFEST='TARGETED-STARS-AUTH-REASON.json';
const BASELINE='cdbd75f8d1b9885f49daa12dcb33e54bf1231ea8';
const VERSION='6b8b2704-0d20-4db3-9646-672db2ae65b1';
const API='https://api.cloudflare.com/client/v4/accounts/af72e32cb9f1ba99dba07df30fe540fe/workers/scripts/rustup-bot';
const NAMES=[
 'worker.live-compiled-original.mjs','telegram-initdata.mjs',
 'deposit-history-readonly.mjs','stars-owner-price-preview.mjs',
 TARGET,'stars.mjs','variable-stars.mjs',
 'payment-controls.mjs','stars-variable-bridge.mjs',
 'stars-payment-support.mjs','freeze-verified-stars-game-quote.mjs',
 'verified-stars-game-credit.mjs','stars-delivery-queue.mjs',
 'verified-stars-game-refund.mjs','stars-variable-webhook-wrapper.mjs',ENTRY
];
const sha=s=>createHash('sha256').update(s).digest('hex');
const normal=s=>s.replace(/\r\n/g,'\n').trimEnd();
function fail(message){throw Error('targeted_wrapper_patch_'+message);}
export function parseWorker16(body){
 if(typeof body!=='string'||body.length<100000||body.length>25000000)
  fail('content_unexpected');
 const boundary=body.split(/\r?\n/,1)[0];
 if(!/^--[a-zA-Z0-9_=-]{8,200}$/.test(boundary))
  fail('multipart_boundary_unexpected');
 const parts=body.split(boundary).filter(s=>/filename="[^"]*\.js\.map"/.test(s));
 if(parts.length!==1)fail('sourcemap_missing_or_ambiguous');
 const at=parts[0].indexOf('\r\n\r\n');
 if(at<0)fail('multipart_invalid');
 let map;
 try{map=JSON.parse(parts[0].slice(at+4).trim());}
 catch{fail('sourcemap_invalid');}
 if(map?.version!==3||!Array.isArray(map.sources)||
    !Array.isArray(map.sourcesContent)||map.sources.length!==NAMES.length||
    map.sourcesContent.length!==NAMES.length||
    map.sources.some((name,i)=>name!==NAMES[i]))
  fail('live_module_layout_changed');
 const files=new Map();
 for(let i=0;i<NAMES.length;i++){
  const value=map.sourcesContent[i];
  if(typeof value!=='string'||value.length<100||value.length>2000000)
   fail('invalid_module_source_'+NAMES[i]);
  files.set(NAMES[i],value);
 }
 if(!files.get(ENTRY).includes('wrapCurrentStarsWebhook(wrapHistoryOnlyWorker(original))')||
    !files.get(TARGET).includes('wrapHistoryOnlyWorker')||
    !files.get('worker.live-compiled-original.mjs').includes('refDeposit'))
  fail('live_worker_contract_changed');
 return files;
}
function fingerprint(files){return sha(JSON.stringify([...files]));}
function sourceHashes(files){
 return Object.fromEntries([...files].map(([name,value])=>[name,sha(value)]));
}
function changedAuthLoggingOnly(baseline,modified){
 const before="    return json({ok:false,error:'telegram_auth_required'},401,permitted);";
 const after="    return json({ok:false,error:'telegram_auth_required',authReason:reason},401,permitted);";
 const old=normal(baseline),changed=normal(modified);
 if(old.split(before).length!==2||old.replace(before,after)!==changed||
    !changed.includes("console.warn('rustup_stars_auth_denied'"))
  fail('patch_changes_more_than_bounded_401_reason');
 return true;
}
async function read(token,suffix,plain=false){
 const response=await fetch(API+suffix,{
  headers:{authorization:'Bearer '+token},redirect:'error',
  signal:AbortSignal.timeout(25000)
 });
 if(!response.ok)fail('cloudflare_read_http_'+response.status);
 if(plain)return response.text();
 const data=await response.json();
 if(data?.success!==true)fail('cloudflare_api_failure');
 return data.result;
}
async function snapshot(token){
 const [raw,settings,schedules,deployment]=await Promise.all([
  read(token,'/content/v2',true),read(token,'/settings'),
  read(token,'/schedules'),read(token,'/deployments')
 ]);
 const version=deployment?.deployments?.[0]?.versions?.[0]?.version_id;
 if(typeof version!=='string')fail('deployment_unknown');
 const sources=parseWorker16(raw);
 const safe=Object.fromEntries((settings?.bindings||[]).map(b=>[
  b.name,{type:b.type,text:b.type==='plain_text'?b.text:null,
  database:b.type==='d1'?(b.id||b.database_id):null}
 ]));
 const metadataHash=sha(JSON.stringify({
  bindings:safe,compatibilityDate:settings.compatibility_date,
  compatibilityFlags:settings.compatibility_flags||[],
  schedules:(schedules?.schedules||[]).map(x=>x.cron)
 }));
 return {sources,version,metadataHash,settings,schedules};
}
async function expectedPatch(live){
 const filename='payments/integration/telegram-stars/'+TARGET;
 const historic=execFileSync('git',['show',BASELINE+':'+filename],{
  cwd:ROOT,encoding:'utf8',maxBuffer:1000000
 });
 const base=flattenVerifiedSettlementImport(TARGET,historic);
 const modified=flattenVerifiedSettlementImport(TARGET,
  await fs.readFile(path.join(ROOT,filename),'utf8'));
 if(normal(base)!==normal(live))fail('deployed_wrapper_not_exact_reviewed_baseline');
 changedAuthLoggingOnly(base,modified);
 return modified;
}
async function manifest(dir){
 const location=await fs.realpath(path.resolve(dir));
 if(!location.startsWith(PRIVATE+path.sep))fail('stage_folder_invalid');
 return {dir:location,data:JSON.parse(await fs.readFile(
  path.join(location,MANIFEST),'utf8'))};
}
async function prepare(token){
 const live=await snapshot(token);
 if(live.version!==VERSION)fail('new_worker_deployment_detected');
 const off=['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
  'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY'];
 for(const name of off){
  const b=live.settings?.bindings?.find(x=>x.name===name);
  if(b?.type!=='plain_text'||b.text!=='false')fail('payments_not_off_'+name);
 }
 const replacement=await expectedPatch(live.sources.get(TARGET));
 const newSources=new Map(live.sources);
 newSources.set(TARGET,replacement);
 const unchanged=NAMES.filter(n=>n!==TARGET);
 if(unchanged.some(n=>newSources.get(n)!==live.sources.get(n)))
  fail('unexpected_non_target_change');
 const config=safeWorkerConfig(live.settings,live.schedules)
  .replace('main = "./worker.stars-commerce.bundle.js"',
   'main = "./'+BUNDLE+'"');
 if(!config.includes('main = "./'+BUNDLE+'"')||
    !config.includes('keep_vars = true')||
    !config.includes('upload_source_maps = true'))
  fail('unsafe_generated_config');
 const dir=path.join(PRIVATE,'targeted-'+VERSION.slice(0,8)+'-'+sha(replacement).slice(0,10));
 await fs.mkdir(dir,{recursive:true,mode:0o700});
 for(const [name,contents] of newSources)
  await fs.writeFile(path.join(dir,name),contents,{flag:'wx',mode:0o600});
 await fs.writeFile(path.join(dir,CONFIG),config,{flag:'wx',mode:0o600});
 await fs.writeFile(path.join(dir,MANIFEST),JSON.stringify({
  version:1,baselineVersion:VERSION,
  liveFingerprint:fingerprint(live.sources),
  metadataHash:live.metadataHash,
  configHash:sha(config),
  originalSourceHashes:sourceHashes(live.sources),
  targetSourceHashes:sourceHashes(newSources),
  changedFiles:[TARGET],
  paymentsEnabled:false
 },null,2)+'\n',{flag:'wx',mode:0o600});
 console.log('PASS: staged exact 16-module Worker. Only '+TARGET+' differs; payments OFF.');
 console.log('NOT DEPLOYED. Private stage: '+dir);
}
async function verify(token,dir,post=false){
 const {dir:folder,data}=await manifest(dir);
 if(data?.version!==1||data.baselineVersion!==VERSION||
    data.paymentsEnabled!==false||
    JSON.stringify(data.changedFiles)!==JSON.stringify([TARGET]))
  fail('stage_manifest_invalid');
 const live=await snapshot(token);
 if(!post&&live.version!==VERSION)fail('worker_version_changed_before_release');
 if(live.metadataHash!==data.metadataHash)
  fail('cloudflare_bindings_or_cron_changed');
 if(!post&&fingerprint(live.sources)!==data.liveFingerprint)
  fail('live_source_changed_before_release');
 const hashes=post?data.targetSourceHashes:data.originalSourceHashes;
 for(const name of NAMES){
  const expected=data.targetSourceHashes[name];
  const staged=await fs.readFile(path.join(folder,name),'utf8');
  if(sha(staged)!==expected)fail('staged_module_modified_'+name);
  if(sha(live.sources.get(name))!==hashes[name])
   fail('live_module_mismatch_'+name);
 }
 const compiled=await fs.readFile(path.join(folder,BUNDLE),'utf8');
 if(compiled.length<100000||!compiled.includes('original_game_cron_requires_retry')||
    !compiled.includes('rustup_stars_auth_denied')||
    !compiled.includes('authReason')||
    !compiled.includes('runVariableStarsDeliveryQueue')||
    !compiled.includes('wrapCurrentStarsWebhook')||
    !compiled.includes('refDeposit'))
  fail('compiled_worker_contract_invalid');
 const config=await fs.readFile(path.join(folder,CONFIG),'utf8');
 if(!config||sha(config)!==data.configHash||
    !config.includes('keep_vars = true')||
    !config.includes('main = "./'+BUNDLE+'"'))
  fail('staged_config_modified');
 console.log(post?'PASS: deployed targeted wrapper matched all 16 sources and preserved settings.':
  'PASS: source, payment flags, bindings and current deployment unchanged.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const mode=process.argv[2],dir=process.argv[3];
 const token=process.env.CLOUDFLARE_API_TOKEN;
 if(!token||token.length<15)fail('cloudflare_token_required');
 if(mode==='--stage')await prepare(token);
 else if(mode==='--verify'&&dir)await verify(token,dir);
 else if(mode==='--postverify'&&dir)await verify(token,dir,true);
 else fail('usage: --stage | --verify <folder> | --postverify <folder>');
}
