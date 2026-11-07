// Private staging and verification of the EXACT running compiled Worker
// plus a history-only Stars API. Does NOT deploy, enable payments or edit D1.
// The source-map-free worker is preserved byte-for-byte with every named export.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {extractReviewedCompiledWorker} from './stage-current-compiled-worker.mjs';
import {liveMetadataFingerprint,safeWorkerConfig}
 from './stage-current-verified-worker.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const PRIVATE=path.join(ROOT,'.private','rustup-bot-recovered');
const SRC=path.join(ROOT,'payments','integration','telegram-stars');
const API='https://api.cloudflare.com/client/v4/accounts/'+
 'af72e32cb9f1ba99dba07df30fe540fe/workers/scripts/rustup-bot';
const ORIGINAL='worker.live-compiled-original.mjs';
const ENTRY='worker.history-only-compiled-entry.mjs';
const BUNDLE='worker.stars-history-only.bundle.js';
const CONFIG='wrangler.stars-history-only.toml';
const MANIFEST='RUSTUP-HISTORY-ONLY-MANIFEST.json';
const ADDONS=['stars-history-only-wrapper.mjs','telegram-initdata.mjs',
 'deposit-history-readonly.mjs'];
const hash=v=>createHash('sha256').update(v).digest('hex');

export function historyOnlyCompiledEntry(){
 return [
  '// Recover the existing compiled game, bot, cron and named DO exports.',
  "import original from './"+ORIGINAL+"';",
  "export * from './"+ORIGINAL+"';",
  "import {wrapHistoryOnlyWorker} from './stars-history-only-wrapper.mjs';",
  'export default wrapHistoryOnlyWorker(original);',
  ''
 ].join('\n');
}

export function historyOnlyConfig(existing){
 const old='main = "./worker.stars-commerce.bundle.js"';
 if(typeof existing!=='string'||existing.split(old).length!==2||
    !existing.includes('keep_vars = true')||
    !existing.includes('binding = "PAYMENTS_DB"')||
    !existing.includes('binding = "DB"')||
    !existing.includes('crons = ["* * * * *"]')||
    !existing.includes('upload_source_maps = true'))
  throw Error('history_only_unsafe_original_worker_config');
 for(const name of [
  'PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
  'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
  'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
  'PAYMENT_WALLET_STRICT_MODE'
 ])if(!existing.includes(name+' = "false"'))
   throw Error('history_only_money_gate_not_off_'+name);
 return existing.replace(old,'main = "./'+BUNDLE+'"');
}

async function get(token,endpoint,raw=false){
 const response=await fetch(API+endpoint,{
  method:'GET',headers:{authorization:'Bearer '+token},
  signal:AbortSignal.timeout(25000),redirect:'error'
 });
 if(!response.ok)throw Error('history_only_cloudflare_read_http_'+response.status);
 if(raw)return response.text();
 const data=await response.json();
 if(data?.success!==true)throw Error('history_only_cloudflare_read_failed');
 return data.result;
}

async function liveSnapshot(token){
 if(typeof token!=='string'||token.length<15)
  throw Error('history_only_cloudflare_login_required');
 const [raw,settings,schedules,deployments]=await Promise.all([
  get(token,'/content/v2',true),
  get(token,'/settings'),
  get(token,'/schedules'),
  get(token,'/deployments')
 ]);
 const original=extractReviewedCompiledWorker(raw);
 const version=deployments?.deployments?.[0]?.versions?.[0]?.version_id;
 if(typeof version!=='string'||version.length<8)
  throw Error('history_only_worker_version_missing');
 const detail=await get(token,'/versions/'+version);
 const script=detail?.resources?.script;
 if(typeof script?.etag!=='string'||script.etag.length<24||
    !script.handlers?.includes('fetch')||
    !script.handlers?.includes('scheduled')||
    !script.named_handlers?.some(x=>
     x.name==='refDeposit'&&x.handlers?.includes('class')))
  throw Error('history_only_original_handlers_not_verified');
 const config=historyOnlyConfig(safeWorkerConfig(settings,schedules));
 return {original,version,etag:script.etag,config,
  metadata:liveMetadataFingerprint(settings,schedules,version)};
}

async function writeExact(file,content){
 try{await fs.writeFile(file,content,{flag:'wx',mode:0o600});}
 catch(error){
  if(error?.code!=='EEXIST'||await fs.readFile(file,'utf8')!==content)
   throw Error('history_only_staged_file_drift_'+path.basename(file));
 }
}
async function compare(dir,live,{requireBundle=false}={}){
 const m=JSON.parse(await fs.readFile(path.join(dir,MANIFEST),'utf8'));
 if(m.format!==1||m.source!=='compiled_history_only'||
    m.activeVersion!==live.version||
    m.sourceHash!==live.original.hash||
    m.scriptEtag!==live.etag||m.metadataFingerprint!==live.metadata)
  throw Error('history_only_active_worker_changed_or_manifest_invalid');
 for(const [name,expected] of [
  [ORIGINAL,live.original.source],
  [ENTRY,historyOnlyCompiledEntry()],
  [CONFIG,live.config],
  ...await Promise.all(ADDONS.map(async file=>[
   file,await fs.readFile(path.join(SRC,file),'utf8')
  ]))
 ]){
  if(await fs.readFile(path.join(dir,name),'utf8')!==expected)
   throw Error('history_only_staged_file_changed_'+name);
 }
 if(requireBundle){
  const compiled=await fs.readFile(path.join(dir,BUNDLE),'utf8');
  if(compiled.length<100000||
     !compiled.includes('wrapHistoryOnlyWorker')||
     !compiled.includes('/api/stars/variable/history')||
     !compiled.includes('refDeposit')||
     compiled.includes('worker.stars-commerce.bundle.js'))
   throw Error('history_only_compiled_bundle_invalid');
 }
 return true;
}
export async function stageHistoryOnlyWorker(token,verifyPath=null){
 const live=await liveSnapshot(token);
 if(verifyPath){
  const dir=await fs.realpath(path.resolve(verifyPath));
  if(!dir.startsWith(PRIVATE+path.sep))
   throw Error('history_only_path_outside_private_recovery');
  await compare(dir,live,{requireBundle:true});
  console.log('PASS: active compiled Worker, source hash, etag, named class, cron and bindings unchanged.');
  console.log('PASS: history-only build and exact local source verified; money flags OFF.');
  console.log('NOT DEPLOYED. Private stage: '+dir);
  return dir;
 }
 const dir=path.join(PRIVATE,'history-only-'+live.version+'-'+
  live.original.hash.slice(0,10));
 await fs.mkdir(dir,{recursive:true,mode:0o700});
 const expected={
  [ORIGINAL]:live.original.source,
  [ENTRY]:historyOnlyCompiledEntry(),
  [CONFIG]:live.config,
  [MANIFEST]:JSON.stringify({
   format:1,source:'compiled_history_only',
   activeVersion:live.version,sourceHash:live.original.hash,
   scriptEtag:live.etag,metadataFingerprint:live.metadata,
   addons:ADDONS
  },null,2)+'\n'
 };
 for(const file of ADDONS)
  expected[file]=await fs.readFile(path.join(SRC,file),'utf8');
 for(const [name,content] of Object.entries(expected))
  await writeExact(path.join(dir,name),content);
 await compare(dir,live);
 console.log('PASS: exact current compiled Worker backed up privately with history-only code.');
 console.log('PASS: game, webhook, scheduled and named handlers preserved; money flags OFF.');
 console.log('NOT DEPLOYED. Location: '+dir);
 return dir;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const mode=process.argv[2];
 if(!['--stage','--verify'].includes(mode)||
    (mode==='--verify'&&(!process.argv[3]||process.argv.length!==4))||
    (mode==='--stage'&&process.argv.length!==3)){
  console.error('Usage: node stage-history-only-compiled-worker.mjs --stage | --verify "<private directory>"');
  process.exitCode=2;
 }else stageHistoryOnlyWorker(process.env.CLOUDFLARE_API_TOKEN,
   mode==='--verify'?process.argv[3]:null)
  .catch(e=>{
   console.error('HISTORY-ONLY WORKER STAGING STOP:',
    String(e?.message||e).slice(0,175));
   process.exitCode=1;
  });
}
