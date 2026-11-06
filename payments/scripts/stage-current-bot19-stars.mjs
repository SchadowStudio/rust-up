// Recover the exact CURRENT 19-source Cloudflare RUST UP Worker privately.
// Preserve the original ten game/bot modules byte-for-byte, stage reviewed
// fixed-goods Stars modules, and refuse any changed live source or settings.
// NO deployment, charges, wallet credits, or financial gate changes here.
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
const ORIGINAL=[
 'money.js','broadcast.js','creator.js','gamedata.js','progress.js',
 'modes.js','game.js','support.js','admin.js','worker.js'
];
const ADDON=[
 'stars.mjs','telegram-initdata.mjs','payment-controls.mjs',
 'supporter-badge.mjs','stars-terms.mjs','stars-live-bridge.mjs',
 'refunds.mjs','stars-existing-worker-wrapper.mjs',
 'worker.stars-commerce-entry.mjs'
];
const ALL=[...ORIGINAL,...ADDON];
const CONFIG='wrangler.stars-current19.toml';
const MANIFEST='RUSTUP-WORKER19-MANIFEST.json';
const BUNDLE='worker.stars-commerce.bundle.js';
const hash=s=>createHash('sha256').update(s).digest('hex');
const fail=m=>{throw Error(m);};
export function parseCurrent19Map(body,contentType=''){
 if(typeof body!=='string'||body.length<1000||body.length>25000000)
  fail('untrusted_current_worker_response');
 const boundary=body.split(/\r?\n/,1)[0].trim();
 const explicit=/boundary="?([^";\s]+)"?/i.exec(contentType)?.[1];
 if(explicit&&boundary!=='--'+explicit)
  fail('worker_multipart_boundary_mismatch');
 if(!/^--[A-Za-z0-9_=-]{8,200}$/.test(boundary))
  fail('untrusted_multipart_boundary');
 const segments=body.split(boundary);
 const mapParts=segments.filter(part=>/filename="[^"]*\.js\.map"/.test(part));
 if(mapParts.length!==1)fail('worker_source_map_missing_or_ambiguous');
 const part=mapParts[0];
 const separator=part.includes('\r\n\r\n')?'\r\n\r\n':'\n\n';
 const cut=part.indexOf(separator);
 if(cut<0)fail('worker_sourcemap_headers_invalid');
 let map;
 try{map=JSON.parse(part.slice(cut+separator.length).trim());}
 catch{fail('worker_sourcemap_json_invalid');}
 if(map.version!==3||!Array.isArray(map.sources)||
    !Array.isArray(map.sourcesContent)||map.sources.length!==ALL.length||
    map.sourcesContent.length!==ALL.length||
    map.sources.some((n,i)=>n!==ALL[i]))
  fail('live_worker_not_reviewed_nineteen_modules');
 const out=new Map();
 for(let i=0;i<ALL.length;i++){
  const src=map.sourcesContent[i];
  if(typeof src!=='string'||src.length<80||src.length>2000000)
   fail('invalid_live_module_'+ALL[i]);
  out.set(ALL[i],src);
 }
 if(!out.get('worker.js').includes('async function onUpdate(upd, env)')||
    !out.get('game.js').includes('export async function withAccount(env, id, fn)')||
    !out.get('game.js').includes('export async function creditAccount(env, id, coins, mutate)')||
    !out.get('worker.stars-commerce-entry.mjs').includes('wrapExistingWorker')||
    !out.get('stars-existing-worker-wrapper.mjs').includes('X-Telegram-Bot-Api-Secret-Token'))
  fail('original_game_or_stars_webhook_source_changed');
 return out;
}
export function sourceFingerprint(source){
 if(!(source instanceof Map)||source.size!==ALL.length||
   [...source.keys()].some((name,i)=>name!==ALL[i]))
  fail('invalid_19_module_source_set');
 return hash(JSON.stringify([...source]));
}
export function metadataFingerprint(settings,schedules,versionId){
 if(typeof versionId!=='string'||!versionId||
    !Array.isArray(settings?.bindings)||!Array.isArray(schedules?.schedules))
  fail('live_worker_metadata_incomplete');
 const bindings=settings.bindings.map(b=>({
  name:b.name,type:b.type,
  text:b.type==='plain_text'?b.text:null,
  id:b.type==='d1'?b.id||b.database_id:null
 })).sort((a,b)=>a.name.localeCompare(b.name));
 return hash(JSON.stringify({
  compatibility_date:settings.compatibility_date,
  compatibility_flags:settings.compatibility_flags||[],
  bindings,crons:schedules.schedules.map(x=>x.cron),
  versionId
 }));
}
export function buildCurrent19SafeConfig(settings,schedules){
 // Shared reviewed config protects the exact game and isolated payment D1,
 // four bot secrets, expected minute cron, and all seven financial OFF gates.
 const config=currentWorker10Config(settings,schedules);
 if(!config.includes('PAYMENT_PRODUCTION_ENABLED = "false"')||
    !config.includes('STARS_PAYMENT_ENABLED = "false"')||
    !config.includes('PAYMENT_WALLET_STRICT_MODE = "false"')||
    !config.includes('keep_vars = true')||
    !config.includes('upload_source_maps = true'))
  fail('current19_payment_gate_or_source_recovery_missing');
 return config.replace('10-module','19-module');
}
async function cloudflare(token,p,raw=false){
 const r=await fetch(BASE+p,{
  method:'GET',headers:{authorization:'Bearer '+token},
  signal:AbortSignal.timeout(25000),redirect:'error'
 });
 if(!r.ok)fail('cloudflare_read_http_'+r.status);
 if(raw)return {body:await r.text(),type:r.headers.get('content-type')||''};
 const json=await r.json();
 if(json?.success!==true)fail('cloudflare_metadata_read_failed');
 return json.result;
}
export async function liveCurrent19Snapshot(token){
 const [response,settings,schedules,deploy]=await Promise.all([
  cloudflare(token,'/content/v2',true),
  cloudflare(token,'/settings'),
  cloudflare(token,'/schedules'),
  cloudflare(token,'/deployments')
 ]);
 const source=parseCurrent19Map(response.body,response.type);
 const versionId=deploy?.deployments?.[0]?.versions?.[0]?.version_id;
 const config=buildCurrent19SafeConfig(settings,schedules);
 return {source,config,sourceDigest:sourceFingerprint(source),
  metadataDigest:metadataFingerprint(settings,schedules,versionId),
  versionId};
}
export async function stageCurrent19(token,verifyPath=null){
 if(typeof token!=='string'||token.length<15)
  fail('local_cloudflare_session_required');
 const live=await liveCurrent19Snapshot(token);
 if(verifyPath){
  const dir=await fs.realpath(path.resolve(verifyPath));
  if(!dir.startsWith(PRIVATE+path.sep))fail('unsafe_private_stage_path');
  const m=JSON.parse(await fs.readFile(path.join(dir,MANIFEST),'utf8'));
  if(m.version!==1||m.sourceDigest!==live.sourceDigest||
     m.metadataDigest!==live.metadataDigest||m.liveVersionId!==live.versionId||
     JSON.stringify(m.original)!==JSON.stringify(ORIGINAL)||
     JSON.stringify(m.addons)!==JSON.stringify(ADDON))
   fail('current19_live_worker_changed_since_stage');
  if(await fs.readFile(path.join(dir,CONFIG),'utf8')!==live.config)
   fail('current19_safe_wrangler_config_changed');
  for(const name of ORIGINAL){
   const current=await fs.readFile(path.join(dir,name),'utf8');
   if(current!==live.source.get(name))
    fail('original_game_or_bot_changed_'+name);
  }
  for(const name of ADDON){
   const reviewed=await fs.readFile(path.join(SRC,name),'utf8');
   const staged=await fs.readFile(path.join(dir,name),'utf8');
   if(staged!==reviewed)fail('reviewed_stars_adapter_changed_'+name);
  }
  const bundle=await fs.readFile(path.join(dir,BUNDLE),'utf8');
  if(bundle.length<100000||!bundle.includes('wrapExistingWorker')||
     !bundle.includes('stars_terms_acceptance_required'))
   fail('current19_compiled_adapter_or_terms_missing');
  console.log('PASS: exact deployed 19-module bot, 10 original game/bot files,');
  console.log('PASS: Stars adapter, deployment ID, D1 bindings and cron unchanged.');
  console.log('PASS: all financial charging switches remain OFF.');
  return dir;
 }
 const name=new Date().toISOString().replace(/[^0-9TZ]/g,'-')+
  '-stars19-'+live.sourceDigest.slice(0,10);
 const dir=path.join(PRIVATE,name);
 await fs.mkdir(dir,{recursive:true,mode:0o700});
 for(const file of ORIGINAL)
  await fs.writeFile(path.join(dir,file),live.source.get(file),
   {flag:'wx',mode:0o600});
 for(const file of ADDON)
  await fs.copyFile(path.join(SRC,file),path.join(dir,file),
   fs.constants.COPYFILE_EXCL);
 await fs.writeFile(path.join(dir,CONFIG),live.config,
  {flag:'wx',mode:0o600});
 await fs.writeFile(path.join(dir,MANIFEST),
  JSON.stringify({version:1,liveVersionId:live.versionId,
   sourceDigest:live.sourceDigest,metadataDigest:live.metadataDigest,
   original:ORIGINAL,addons:ADDON},null,2)+'\n',
  {flag:'wx',mode:0o600});
 console.log('PASS: 19-module RUST UP bot staged privately. NOTHING DEPLOYED.');
 console.log('PASS: original game and webhook code preserved. Money flags OFF.');
 console.log('Location: '+dir);
 return dir;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const mode=process.argv[2];
 if(!['--stage','--verify'].includes(mode)||
    (mode==='--verify'&&!process.argv[3])||process.argv.length>4)
  fail('Usage: node stage-current-bot19-stars.mjs --stage | --verify "<private dir>"');
 stageCurrent19(process.env.CLOUDFLARE_API_TOKEN,
  mode==='--verify'?process.argv[3]:null)
  .catch(e=>{console.error('RUST UP CURRENT19 STAGE BLOCKED:',
    String(e?.message||e));process.exitCode=1;});
}
