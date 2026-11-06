// RUST UP: safe staging for the exact supported currently deployed Worker.
// Supports reviewed 10-, 12- and current verified 13-module game bot layouts,
// with or without the 9-module fixed-goods Stars wrapper (10/12/13/19/21/22).
// Source-maps recovered from Cloudflare; NO payment enabling or deployment.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {currentWorker10Config} from './stage-current-bot10-stars.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const PRIVATE=path.join(ROOT,'.private','rustup-bot-recovered');
const SRC=path.join(ROOT,'payments','integration','telegram-stars');
const ACCOUNT='af72e32cb9f1ba99dba07df30fe540fe';
const BASE='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+
 '/workers/scripts/rustup-bot';
const BASE10=['money.js','broadcast.js','creator.js','gamedata.js',
 'progress.js','modes.js','game.js','support.js','admin.js','worker.js'];
const BASE12=['money.js','broadcast.js','creator.js','gamedata.js',
 'progress.js','fairlib.js','modes.js','social.js','game.js','support.js',
 'admin.js','worker.js'];
// Observed in the actual 2026-11-06 live Cloudflare source map, in this order.
// Preserve brand.js rather than replacing the running 13-module game.
const BASE13=['money.js','broadcast.js','creator.js','gamedata.js',
 'progress.js','fairlib.js','modes.js','social.js','game.js','brand.js',
 'support.js','admin.js','worker.js'];
const STARS=['stars.mjs','telegram-initdata.mjs','payment-controls.mjs',
 'supporter-badge.mjs','stars-terms.mjs','stars-live-bridge.mjs',
 'refunds.mjs','stars-existing-worker-wrapper.mjs',
 'worker.stars-commerce-entry.mjs'];
const LAYOUTS=[
 {original:BASE10,activeStars:false},{original:BASE12,activeStars:false},
 {original:BASE13,activeStars:false},
 {original:BASE10,activeStars:true},{original:BASE12,activeStars:true},
 {original:BASE13,activeStars:true}
].map(l=>({...l,names:[...l.original,...(l.activeStars?STARS:[])]}));
const NAME='RUSTUP-VERIFIED-WORKER-MANIFEST.json';
const CONFIG='wrangler.stars-verified.toml';
const BUNDLE='worker.stars-commerce.bundle.js';
const sha=v=>createHash('sha256').update(v).digest('hex');
const fail=s=>{throw Error(s);};
function selected(names){
 const layouts=LAYOUTS.filter(l=>l.names.length===names.length&&
  l.names.every((v,i)=>v===names[i]));
 if(layouts.length!==1)fail('unreviewed_worker_module_layout');
 return layouts[0];
}
export function parseSupportedLiveWorker(body,contentType=''){
 if(typeof body!=='string'||body.length<1000||body.length>25000000)
  fail('invalid_cloudflare_worker_response');
 const boundary=body.split(/\r?\n/,1)[0].trim();
 const explicit=/boundary="?([^";\s]+)"?/i.exec(contentType)?.[1];
 if(!/^--[A-Za-z0-9_=-]{8,200}$/.test(boundary)||
    (explicit&&boundary!=='--'+explicit))
  fail('unexpected_worker_multipart_boundary');
 const parts=body.split(boundary).filter(p=>/filename="[^"]*\.js\.map"/.test(p));
 if(parts.length!==1)fail('worker_sourcemap_missing_or_ambiguous');
 const sep=parts[0].includes('\r\n\r\n')?'\r\n\r\n':'\n\n';
 const at=parts[0].indexOf(sep);
 if(at<0)fail('worker_sourcemap_missing_separator');
 let m;
 try{m=JSON.parse(parts[0].slice(at+sep.length).trim());}
 catch{fail('worker_sourcemap_invalid_json');}
 if(m.version!==3||!Array.isArray(m.sources)||!Array.isArray(m.sourcesContent)||
    m.sources.length!==m.sourcesContent.length)fail('worker_sourcemap_invalid');
 const layout=selected(m.sources);
 const files=new Map();
 for(let i=0;i<layout.names.length;i++){
  const source=m.sourcesContent[i];
  if(typeof source!=='string'||source.length<80||source.length>2000000)
   fail('invalid_source_'+layout.names[i]);
  files.set(layout.names[i],source);
 }
 if(layout.original===BASE13&&
    !/from\\s*['\"]\\.\\/brand\\.js['\"]/.test(files.get('worker.js')))
  fail('current_brand_module_import_missing');
 if(!files.get('worker.js').includes('export default {')||
    !files.get('worker.js').includes('async function onUpdate(upd, env)')||
    !files.get('game.js').includes('export async function withAccount(env, id, fn)')||
    !files.get('game.js').includes('export async function creditAccount(env, id, coins, mutate)'))
  fail('original_game_or_bot_contract_changed');
 if(layout.activeStars&&
    (!files.get('worker.stars-commerce-entry.mjs').includes('wrapExistingWorker')||
     !files.get('stars-existing-worker-wrapper.mjs').includes('X-Telegram-Bot-Api-Secret-Token')))
  fail('existing_stars_webhook_contract_changed');
 return {files,layout};
}
export function liveSourceFingerprint(snapshot){
 if(!(snapshot?.files instanceof Map))fail('invalid_live_source_snapshot');
 const layout=selected([...snapshot.files.keys()]);
 if(snapshot.files.size!==layout.names.length||
    [...snapshot.files.values()].some(v=>typeof v!=='string'))
  fail('invalid_worker_source_fingerprint');
 return sha(JSON.stringify([...snapshot.files]));
}
export function liveMetadataFingerprint(settings,schedules,versionId){
 if(!Array.isArray(settings?.bindings)||!Array.isArray(schedules?.schedules)||
    typeof versionId!=='string'||versionId.length<8)
  fail('worker_live_metadata_incomplete');
 const bindings=settings.bindings.map(b=>({
  name:b.name,type:b.type,
  text:b.type==='plain_text'?b.text:null,
  database:b.type==='d1'?b.id||b.database_id:null
 })).sort((a,b)=>a.name.localeCompare(b.name));
 return sha(JSON.stringify({bindings,versionId,
  compatibility_date:settings.compatibility_date,
  compatibility_flags:settings.compatibility_flags||[],
  cron:schedules.schedules.map(c=>c.cron)}));
}
export function safeWorkerConfig(settings,schedules){
 const config=currentWorker10Config(settings,schedules);
 for(const flag of [
  'PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
  'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
  'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
  'PAYMENT_WALLET_STRICT_MODE'
 ])if(!config.includes(flag+' = "false"'))
  fail('worker_payment_gate_not_explicitly_off_'+flag);
 if(!config.includes('binding = "DB"')||
    !config.includes('binding = "PAYMENTS_DB"')||
    !config.includes('keep_vars = true')||
    !config.includes('upload_source_maps = true'))
  fail('worker_binding_or_recovery_not_verified');
 return config.replace('10-module','supported-module');
}
async function get(token,p,raw=false){
 const response=await fetch(BASE+p,{
  method:'GET',redirect:'error',signal:AbortSignal.timeout(25000),
  headers:{authorization:'Bearer '+token}
 });
 if(!response.ok)fail('worker_cloudflare_http_'+response.status);
 if(raw)return {body:await response.text(),
  type:response.headers.get('content-type')||''};
 const data=await response.json();
 if(data?.success!==true)fail('worker_cloudflare_result_invalid');
 return data.result;
}
async function snapshot(token){
 const [content,settings,schedules,deploy]=await Promise.all([
  get(token,'/content/v2',true),get(token,'/settings'),
  get(token,'/schedules'),get(token,'/deployments')
 ]);
 const source=parseSupportedLiveWorker(content.body,content.type);
 const versionId=deploy?.deployments?.[0]?.versions?.[0]?.version_id;
 return {source,versionId,sourceFingerprint:liveSourceFingerprint(source),
  metadataFingerprint:liveMetadataFingerprint(settings,schedules,versionId),
  config:safeWorkerConfig(settings,schedules)};
}
export async function prepareVerifiedWorker(token,verifyDir=null){
 if(typeof token!=='string'||token.length<15)fail('cloudflare_login_required');
 const live=await snapshot(token);
 if(verifyDir){
  const dir=await fs.realpath(path.resolve(verifyDir));
  if(!dir.startsWith(PRIVATE+path.sep))fail('invalid_private_worker_path');
  const m=JSON.parse(await fs.readFile(path.join(dir,NAME),'utf8'));
  if(m.version!==1||m.versionId!==live.versionId||
    m.sourceFingerprint!==live.sourceFingerprint||
    m.metadataFingerprint!==live.metadataFingerprint||
    JSON.stringify(m.original)!==JSON.stringify(live.source.layout.original)||
    JSON.stringify(m.addons)!==JSON.stringify(STARS))
   fail('live_worker_changed_since_private_recovery');
  if(await fs.readFile(path.join(dir,CONFIG),'utf8')!==live.config)
   fail('reviewed_wrangler_config_changed');
  for(const file of live.source.layout.original){
   if(await fs.readFile(path.join(dir,file),'utf8')!==live.source.files.get(file))
    fail('original_game_or_bot_file_changed_'+file);
  }
  for(const file of STARS){
   const expected=await fs.readFile(path.join(SRC,file),'utf8');
   if(await fs.readFile(path.join(dir,file),'utf8')!==expected)
    fail('reviewed_stars_adapter_file_changed_'+file);
  }
  const bundle=await fs.readFile(path.join(dir,BUNDLE),'utf8');
  if(bundle.length<100000||!bundle.includes('wrapExistingWorker')||
     !bundle.includes('stars_terms_acceptance_required'))
   fail('compiled_stars_terms_or_webhook_missing');
  console.log('PASS: original '+live.source.layout.original.length+
    '-module game bot and reviewed fixed Stars adapters unchanged.');
  console.log('PASS: same live Worker version, cron, D1 and financial gates OFF.');
  return dir;
 }
 const id=new Date().toISOString().replace(/[^0-9TZ]/g,'-')+
  '-verified-'+live.sourceFingerprint.slice(0,10);
 const dir=path.join(PRIVATE,id);
 await fs.mkdir(dir,{recursive:true,mode:0o700});
 for(const file of live.source.layout.original)
  await fs.writeFile(path.join(dir,file),live.source.files.get(file),
   {flag:'wx',mode:0o600});
 for(const file of STARS)
  await fs.copyFile(path.join(SRC,file),path.join(dir,file),
   fs.constants.COPYFILE_EXCL);
 await fs.writeFile(path.join(dir,CONFIG),live.config,
  {flag:'wx',mode:0o600});
 await fs.writeFile(path.join(dir,NAME),JSON.stringify({
  version:1,versionId:live.versionId,
  sourceFingerprint:live.sourceFingerprint,
  metadataFingerprint:live.metadataFingerprint,
  original:live.source.layout.original,addons:STARS
 },null,2)+'\n',{flag:'wx',mode:0o600});
 console.log('PASS: staged exact '+live.source.layout.original.length+
  '-module live bot into PRIVATE directory.');
 console.log('PASS: original games, webhook and both D1 bindings preserved.');
 console.log('NOT DEPLOYED. All charging switches OFF.');
 console.log('Location: '+dir);
 return dir;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const mode=process.argv[2];
 if(!['--stage','--verify'].includes(mode)||
    (mode==='--verify'&&!process.argv[3])||process.argv.length>4)
  fail('Usage: node stage-current-verified-worker.mjs --stage|--verify <private-dir>');
 prepareVerifiedWorker(process.env.CLOUDFLARE_API_TOKEN,
  mode==='--verify'?process.argv[3]:null)
  .catch(e=>{console.error('RUST UP VERIFIED WORKER RELEASE BLOCKED:',
   String(e?.message||e));process.exitCode=1;});
}
