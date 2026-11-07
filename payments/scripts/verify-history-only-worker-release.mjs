// READ-ONLY release evidence for the current compiled RUST UP bot.
// No payment, D1 mutation, external charge or Worker deploy in this module.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {extractReviewedCompiledWorker}
 from './stage-current-compiled-worker.mjs';

const ACCOUNT='af72e32cb9f1ba99dba07df30fe540fe';
const API='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+
 '/workers/scripts/rustup-bot';
const GAME_DB='9b0b533f-540a-4a25-a429-70ca8bd4e23d';
const PAYMENT_DB='06079270-a227-466a-9991-abd4201ec5f6';
const OFF=['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
 'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
 'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
 'PAYMENT_WALLET_STRICT_MODE'];
const SECRET=['BOT_TOKEN','WEBHOOK_SECRET','ADMIN_BOT_TOKEN','CLIPS_BOT_TOKEN'];
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const PRIVATE=path.join(ROOT,'.private','rustup-bot-recovered')+path.sep;

function fail(reason){throw Error('history_only_release_'+reason);}
export function checkHistoryReleaseMetadata({bindings,schedules,versionInfo,
 versionId,manifest,phase}={}){
 if(!manifest||manifest.format!==1||
    manifest.source!=='compiled_history_only'||
    typeof manifest.activeVersion!=='string'||
    typeof manifest.sourceHash!=='string'||
    typeof manifest.scriptEtag!=='string'||
    typeof versionId!=='string'||versionId.length<8||
    !Array.isArray(bindings)||!Array.isArray(schedules?.schedules))
  fail('missing_reviewed_release_evidence');
 const entries=new Map();
 for(const binding of bindings){
  if(typeof binding?.name!=='string'||entries.has(binding.name))
   fail('invalid_or_duplicate_binding');
  entries.set(binding.name,binding);
 }
 for(const name of OFF){
  const b=entries.get(name);
  if(b?.type!=='plain_text'||b.text!=='false')
   fail('payment_gate_not_off_'+name);
 }
 for(const name of SECRET){
  if(entries.get(name)?.type!=='secret_text')
   fail('original_bot_secret_missing_'+name);
 }
 for(const [name,id] of [['DB',GAME_DB],['PAYMENTS_DB',PAYMENT_DB]]){
  const b=entries.get(name);
  if(b?.type!=='d1'||(b.id||b.database_id)!==id)
   fail('d1_binding_changed_'+name);
 }
 if(entries.get('APP_URL')?.text!=='https://ttzoomrust-hub.github.io/rust-up/')
  fail('app_origin_changed');
 if(schedules.schedules.length!==1||
    schedules.schedules[0].cron!=='* * * * *')
  fail('original_cron_changed');
 const s=versionInfo?.resources?.script;
 if(typeof s?.etag!=='string'||s.etag.length<24||
    !s.handlers?.includes('fetch')||!s.handlers?.includes('scheduled')||
    !s.named_handlers?.some(x=>
     x.name==='refDeposit'&&x.handlers?.includes('class')))
  fail('original_worker_handler_contract_changed');
 if(phase==='before'){
  if(versionId!==manifest.activeVersion||
     s.etag!==manifest.scriptEtag)
   fail('active_worker_changed_since_private_stage');
 }else if(phase==='after'){
  if(versionId===manifest.activeVersion)
   fail('new_history_worker_not_deployed');
 }else fail('phase_invalid');
 return {
  phase,activeVersion:versionId,
  oldVersion:manifest.activeVersion,
  gameAndPaymentDatabasesPreserved:true,
  allPaymentGatesOff:true,
  originalSecretsPreserved:true,
  scheduledAndNamedClassPreserved:true,
  paymentActivationApproved:false
 };
}

export function inspectDeployedHistorySource(raw,expectedOriginalHash=null){
 if(typeof raw!=='string'||raw.length<100000||raw.length>25000000)
  fail('missing_compiled_source');
 const boundary=raw.split(/\r?\n/,1)[0].trim();
 if(!/^--[a-zA-Z0-9_=-]{8,200}$/.test(boundary))
  fail('invalid_multipart');
 const sections=raw.split(boundary).filter(p=>p.includes('Content-Disposition:'));
 const parts=sections.map(section=>{
  const separator=section.includes('\r\n\r\n')?'\r\n\r\n':'\n\n';
  const at=section.indexOf(separator);
  if(at<0)fail('multipart_headers_invalid');
  const header=section.slice(0,at);
  const filename=/(?:^|\r?\n)Content-Disposition:[^\r\n]*filename="([^"]+)"/i.exec(header)?.[1];
  if(!filename)fail('multipart_filename_missing');
  return {filename,body:section.slice(at+separator.length).trim()};
 });
 // Cloudflare's script API can call the main entry "worker.js", while
 // Wrangler's module upload retains "worker.stars-history-only.bundle.js".
 // Accept only either complete, exact JS+source-map pair, never mixed names.
 const expected=[
  ['worker.js','worker.js.map'],
  ['worker.stars-history-only.bundle.js',
   'worker.stars-history-only.bundle.js.map']
 ];
 const pair=expected.find(([js,map])=>
  parts.length===2&&parts.filter(p=>p.filename===js).length===1&&
  parts.filter(p=>p.filename===map).length===1);
 if(!pair)fail('missing_or_ambiguous_source_map');
 const compiled=parts.find(p=>p.filename===pair[0]).body;
 if(compiled.length<100000||
    !compiled.includes('/api/stars/variable/history')||
    !compiled.includes('wrapHistoryOnlyWorker')||
    !compiled.includes('refDeposit'))
  fail('history_or_original_named_class_not_in_bundle');
 let map;
 try{map=JSON.parse(parts.find(p=>p.filename===pair[1]).body);}
 catch{fail('deployed_source_map_invalid_json');}
 const required=[
  'worker.live-compiled-original.mjs',
  'telegram-initdata.mjs',
  'deposit-history-readonly.mjs',
  'stars-history-only-wrapper.mjs',
  'worker.history-only-compiled-entry.mjs'
 ];
 if(map?.version!==3||!Array.isArray(map.sources)||
    !Array.isArray(map.sourcesContent)||
    map.sources.length!==required.length||
    map.sourcesContent.length!==required.length||
    required.some(name=>map.sources.filter(src=>
      typeof src==='string'&&src.split('/').pop()===name).length!==1))
  fail('deployed_source_map_not_history_only');
 if(expectedOriginalHash!==null){
  if(!/^[a-f0-9]{64}$/.test(expectedOriginalHash))
   fail('original_hash_invalid');
  const idx=map.sources.findIndex(src=>src.split('/').pop()===required[0]);
  const originalSource=map.sourcesContent[idx];
  if(typeof originalSource!=='string'||
     createHash('sha256').update(originalSource).digest('hex')!==expectedOriginalHash)
   fail('original_compiled_bot_not_byte_identical');
 }
 return {historyAdapterPresent:true,namedClassInBundle:true,
  sourceMapPresent:true,originalCodeHashVerified:expectedOriginalHash!==null};
}

async function get(token,suffix,raw=false,fetchImpl=fetch){
 const r=await fetchImpl(API+suffix,{
  method:'GET',headers:{authorization:'Bearer '+token},
  signal:AbortSignal.timeout(25000),redirect:'error'
 });
 if(!r?.ok)fail('cloudflare_read_http_'+r?.status);
 if(raw)return r.text();
 const data=await r.json();
 if(data?.success!==true)fail('cloudflare_incomplete_result');
 return data.result;
}
export async function verifyHistoryOnlyWorkerRelease(token,directory,phase,
 fetchImpl=fetch){
 if(typeof token!=='string'||token.length<15)
  fail('local_authenticated_session_required');
 const dir=await fs.realpath(path.resolve(directory||''));
 if(!dir.startsWith(PRIVATE))
  fail('untrusted_private_directory');
 const manifest=JSON.parse(await fs.readFile(
  path.join(dir,'RUSTUP-HISTORY-ONLY-MANIFEST.json'),'utf8'));
 const [settings,schedules,deployment,raw]=await Promise.all([
  get(token,'/settings',false,fetchImpl),
  get(token,'/schedules',false,fetchImpl),
  get(token,'/deployments',false,fetchImpl),
  get(token,'/content/v2',true,fetchImpl)
 ]);
 const versionId=deployment?.deployments?.[0]?.versions?.[0]?.version_id;
 if(typeof versionId!=='string')fail('active_deployment_unknown');
 const version=await get(token,'/versions/'+versionId,false,fetchImpl);
 const metadata=checkHistoryReleaseMetadata({
  bindings:settings?.bindings,schedules,versionInfo:version,
  versionId,manifest,phase
 });
 if(phase==='before'){
  const original=extractReviewedCompiledWorker(raw);
  if(original.hash!==manifest.sourceHash)
   fail('original_code_changed_since_stage');
 }else{
  Object.assign(metadata,inspectDeployedHistorySource(raw,manifest.sourceHash));
 }
 // Only sanitized booleans and version IDs may be printed to stdout.
 return metadata;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [phase,folder]=process.argv.slice(2);
 if(!['before','after'].includes(phase)||!folder||process.argv.length!==4){
  console.error('Usage: node verify-history-only-worker-release.mjs before|after "<private folder>"');
  process.exitCode=2;
 }else verifyHistoryOnlyWorkerRelease(process.env.CLOUDFLARE_API_TOKEN,folder,phase)
  .then(report=>console.log('PASS: Worker release '+JSON.stringify(report)))
  .catch(error=>{
   console.error('WORKER RELEASE SAFETY STOP:',
    String(error?.message||error).slice(0,170));
   process.exitCode=1;
  });
}
