// RUST UP: recover the EXACT running single-module compiled bot when a
// Dashboard settings change has removed its source-map attachment.
// Does NOT reconstruct old modules, change the Worker, or enable payments.
// All source bytes stay under .private/ on the operator's own computer.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {liveMetadataFingerprint,safeWorkerConfig}
 from './stage-current-verified-worker.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const PRIVATE=path.join(ROOT,'.private','rustup-bot-recovered');
const SRC=path.join(ROOT,'payments','integration','telegram-stars');
const ACCOUNT='af72e32cb9f1ba99dba07df30fe540fe';
const API='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+
 '/workers/scripts/rustup-bot';
const ORIGINAL='worker.live-compiled-original.mjs';
const ENTRY='worker.stars-compiled-entry.mjs';
const OUTPUT='worker.stars-commerce.bundle.js';
const CONFIG='wrangler.stars-verified.toml';
const MANIFEST='RUSTUP-COMPILED-WORKER-MANIFEST.json';
const ADDONS=['stars.mjs','telegram-initdata.mjs','payment-controls.mjs',
 'supporter-badge.mjs','stars-terms.mjs','stars-live-bridge.mjs',
 'refunds.mjs','stars-existing-worker-wrapper.mjs'];
const sha=x=>createHash('sha256').update(x).digest('hex');

export function extractReviewedCompiledWorker(raw){
 if(typeof raw!=='string'||raw.length<100000||raw.length>25000000)
  throw Error('invalid_compiled_worker_content');
 const boundary=raw.split(/\r?\n/,1)[0].trim();
 if(!/^--[a-zA-Z0-9_=-]{8,200}$/.test(boundary))
  throw Error('invalid_compiled_worker_boundary');
 const parts=raw.split(boundary).filter(p=>p.includes('Content-Disposition:'));
 if(parts.some(p=>/filename="[^"]*\.js\.map"/.test(p)))
  throw Error('source_map_available_use_verified_source_recovery');
 const scripts=parts.filter(p=>/filename="worker\.js"/.test(p));
 if(scripts.length!==1||parts.length!==1)
  throw Error('unexpected_compiled_worker_files');
 const part=scripts[0];
 const separator=part.includes('\r\n\r\n')?'\r\n\r\n':'\n\n';
 const at=part.indexOf(separator);
 if(at<0)throw Error('compiled_worker_module_headers_invalid');
 const source=part.slice(at+separator.length).replace(/\r\n$/,'');
 if(source.length<100000||source.length>20_000_000||
    !source.includes('worker_default as default')||
    !/export\s*\{[\s\S]*?refDeposit[\s\S]*?\}/.test(source)||
    !source.includes('onUpdate'))
  throw Error('compiled_worker_original_contract_changed');
 return {source,hash:sha(source)};
}
export function compiledAdapterEntry(){
 return [
  '// Reuse the exact Cloudflare original compiled Worker byte-for-byte.',
  '// Export original named bindings such as refDeposit; wrap only default.',
  "import original from './"+ORIGINAL+"';",
  "export * from './"+ORIGINAL+"';",
  "import {wrapExistingWorker} from './stars-existing-worker-wrapper.mjs';",
  'export default wrapExistingWorker(original);',
  ''
 ].join('\n');
}
export function checkCompiledWorkerLineage({version,liveVersion,scriptEtag,
  originalEtag,workerCodeHash,oldWorkerCodeHash}={}){
 if(typeof version!=='string'||version.length<8||
    version!==liveVersion||
    typeof scriptEtag!=='string'||scriptEtag.length<24||
    scriptEtag!==originalEtag||
    typeof workerCodeHash!=='string'||workerCodeHash!==oldWorkerCodeHash)
  throw Error('compiled_worker_changed_since_local_snapshot');
 return true;
}
async function get(token,route,raw=false){
 const response=await fetch(API+route,{
  method:'GET',headers:{authorization:'Bearer '+token},redirect:'error',
  signal:AbortSignal.timeout(25000)
 });
 if(!response.ok)throw Error('worker_recovery_read_http_'+response.status);
 if(raw)return response.text();
 const data=await response.json();
 if(data?.success!==true)throw Error('worker_recovery_metadata_failed');
 return data.result;
}
async function current(token){
 const [body,settings,schedules,deploy]=await Promise.all([
  get(token,'/content/v2',true),get(token,'/settings'),
  get(token,'/schedules'),get(token,'/deployments')
 ]);
 const script=extractReviewedCompiledWorker(body);
 const version=deploy?.deployments?.[0]?.versions?.[0]?.version_id;
 if(typeof version!=='string'||version.length<8)
  throw Error('worker_live_version_missing');
 const detail=await get(token,'/versions/'+version);
 const etag=detail?.resources?.script?.etag;
 if(typeof etag!=='string'||etag.length<24||
    !detail.resources?.script?.handlers?.includes('fetch')||
    !detail.resources?.script?.handlers?.includes('scheduled')||
    !detail.resources?.script?.named_handlers?.some(x=>
      x.name==='refDeposit'&&x.handlers?.includes('class')))
  throw Error('compiled_worker_export_contract_not_verified');
 const config=safeWorkerConfig(settings,schedules);
 return {script,version,etag,config,
  fingerprint:liveMetadataFingerprint(settings,schedules,version)};
}
export async function stageCompiledWorker(token,verifyDir=null){
 if(typeof token!=='string'||token.length<15)
  throw Error('local_cloudflare_login_required');
 const live=await current(token);
 if(verifyDir){
  const dir=await fs.realpath(path.resolve(verifyDir));
  if(!dir.startsWith(PRIVATE+path.sep))
   throw Error('unsafe_private_compiled_recovery_directory');
  const manifest=JSON.parse(await fs.readFile(path.join(dir,MANIFEST),'utf8'));
  if(manifest.format!==1||manifest.source!=='compiled_worker_only'||
     manifest.metadataFingerprint!==live.fingerprint||
     manifest.codeHash!==live.script.hash)
   throw Error('compiled_worker_metadata_or_code_changed');
  checkCompiledWorkerLineage({
   version:manifest.liveVersion,liveVersion:live.version,
   scriptEtag:manifest.scriptEtag,originalEtag:live.etag,
   workerCodeHash:manifest.codeHash,oldWorkerCodeHash:live.script.hash
  });
  if(await fs.readFile(path.join(dir,ORIGINAL),'utf8')!==live.script.source||
     await fs.readFile(path.join(dir,CONFIG),'utf8')!==live.config||
     await fs.readFile(path.join(dir,ENTRY),'utf8')!==compiledAdapterEntry())
   throw Error('compiled_worker_local_snapshot_changed');
  for(const file of ADDONS){
   if(await fs.readFile(path.join(dir,file),'utf8')!==
      await fs.readFile(path.join(SRC,file),'utf8'))
    throw Error('reviewed_stars_adapter_changed_'+file);
  }
  const bundle=await fs.readFile(path.join(dir,OUTPUT),'utf8');
  if(bundle.length<100000||!bundle.includes('wrapExistingWorker')||
     !bundle.includes('stars_terms_acceptance_required'))
   throw Error('verified_compiled_wrapper_bundle_missing');
  console.log('PASS: exact live compiled game and all named exports preserved.');
  console.log('PASS: same Cloudflare version, etag, bindings, cron and all gates OFF.');
  console.log('NOT DEPLOYED; no game balances or payments changed.');
  return dir;
 }
 const dir=path.join(PRIVATE,'compiled-'+live.version+'-'+live.script.hash.slice(0,10));
 await fs.mkdir(dir,{recursive:true,mode:0o700});
 const write=async(file,value)=>fs.writeFile(path.join(dir,file),value,
  {flag:'wx',mode:0o600});
 await write(ORIGINAL,live.script.source);
 await write(ENTRY,compiledAdapterEntry());
 await write(CONFIG,live.config);
 for(const f of ADDONS)
  await fs.copyFile(path.join(SRC,f),path.join(dir,f),
    (await import('node:fs')).constants.COPYFILE_EXCL);
 await write(MANIFEST,JSON.stringify({
  format:1,source:'compiled_worker_only',liveVersion:live.version,
  scriptEtag:live.etag,codeHash:live.script.hash,
  metadataFingerprint:live.fingerprint
 },null,2)+'\n');
 console.log('PASS: compiled current Worker privately captured without source map.');
 console.log('PASS: safe fixed-goods Stars wrapper staged with all payments OFF.');
 console.log('NOT DEPLOYED. Location: '+dir);
 return dir;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const mode=process.argv[2],dir=process.argv[3];
 if(!['--stage','--verify'].includes(mode)||
    (mode==='--verify'&&!dir)||process.argv.length>4){
  console.error('Usage: node stage-current-compiled-worker.mjs --stage|--verify <dir>');
  process.exitCode=2;
 }else{
  stageCompiledWorker(process.env.CLOUDFLARE_API_TOKEN,
   mode==='--verify'?dir:null).catch(e=>{
   console.error('COMPILED WORKER RECOVERY BLOCKED:',
    String(e?.message||e).slice(0,160));process.exitCode=1;
  });
 }
}
