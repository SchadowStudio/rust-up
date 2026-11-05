// Stages the CURRENT 10-module RUST UP bot into a private, noncharging
// fixed-stars build. Refuses stale, changed, or differently shaped bot code.
// Never deploys and never enables invoices by itself.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const PRIVATE=path.join(ROOT,'.private','rustup-bot-recovered');
const SRC=path.join(ROOT,'payments','integration','telegram-stars');
const ACCOUNT='af72e32cb9f1ba99dba07df30fe540fe';
const WORKER='rustup-bot';
const GAME_DB='9b0b533f-540a-4a25-a429-70ca8bd4e23d';
const PAYMENT_DB='06079270-a227-466a-9991-abd4201ec5f6';
const BASE='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+
  '/workers/scripts/'+WORKER;
const ORIGINAL=[
 'money.js','broadcast.js','creator.js','gamedata.js','progress.js',
 'modes.js','game.js','support.js','admin.js','worker.js'
];
const ADDON=[
 'worker.stars-commerce-entry.mjs','stars-existing-worker-wrapper.mjs',
 'stars-live-bridge.mjs','stars-terms.mjs','payment-controls.mjs',
 'refunds.mjs','stars.mjs','telegram-initdata.mjs','supporter-badge.mjs'
];
const FLAGS=[
 'PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
 'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
 'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
 'PAYMENT_WALLET_STRICT_MODE'
];
const digest=s=>createHash('sha256').update(s).digest('hex');
const fail=s=>{throw Error(s);};

export function readCurrentWorker10Map(body,contentType=''){
 if(typeof body!=='string'||body.length<500||body.length>20000000)
  fail('untrusted_worker_content');
 const explicit=/boundary="?([^";\s]+)"?/i.exec(contentType)?.[1];
 const first=body.split(/\r?\n/,1)[0].trim();
 const boundary=explicit?'--'+explicit:first;
 if(!/^--[a-zA-Z0-9_=-]{8,200}$/.test(boundary))
  fail('untrusted_worker_multipart_boundary');
 const parts=body.split(boundary).filter(x=>/filename="[^"]*\.js\.map"/.test(x));
 if(parts.length!==1)fail('worker_source_map_missing_or_ambiguous');
 const separator=parts[0].includes('\r\n\r\n')?'\r\n\r\n':'\n\n';
 const offset=parts[0].indexOf(separator);
 if(offset===-1)fail('worker_source_map_headers_invalid');
 let map;
 try{map=JSON.parse(parts[0].slice(offset+separator.length).trim());}
 catch{fail('worker_source_map_json_invalid');}
 if(map.version!==3||!Array.isArray(map.sources)||!Array.isArray(map.sourcesContent)||
    map.sources.length!==ORIGINAL.length||map.sourcesContent.length!==ORIGINAL.length||
    map.sources.some((x,i)=>x!==ORIGINAL[i]))
  fail('live_bot_not_expected_ten_modules');
 const source=new Map();
 for(let i=0;i<ORIGINAL.length;i++){
  const text=map.sourcesContent[i];
  if(typeof text!=='string'||text.length<40||text.length>2000000)
   fail('invalid_private_bot_source_'+ORIGINAL[i]);
  source.set(ORIGINAL[i],text);
 }
 const worker=source.get('worker.js');
 const game=source.get('game.js');
 if(!worker.includes('export default {')||
    !worker.includes('async function onUpdate(upd, env)')||
    !worker.includes('./progress.js')||
    !worker.includes('./game.js')||
    !game.includes('export async function withAccount(env, id, fn)')||
    !game.includes('export async function creditAccount(env, id, coins, mutate)'))
  fail('original_bot_game_or_webhook_changed');
 return source;
}

export function currentWorker10Config(settings,schedules){
 if(settings?.compatibility_date!=='2025-06-01'||
    !Array.isArray(settings.bindings)||
    (settings.compatibility_flags||[]).length)
  fail('unexpected_worker_compatibility');
 const byName=new Map();
 for(const b of settings.bindings){
  if(byName.has(b.name))fail('duplicate_worker_binding');
  byName.set(b.name,b);
 }
 for(const name of ['BOT_TOKEN','WEBHOOK_SECRET','ADMIN_BOT_TOKEN','CLIPS_BOT_TOKEN'])
  if(byName.get(name)?.type!=='secret_text')
   fail('missing_original_bot_secret_'+name);
 if(byName.get('APP_URL')?.text!=='https://ttzoomrust-hub.github.io/rust-up/')
  fail('original_miniapp_origin_changed');
 const game=byName.get('DB');
 if(game?.type!=='d1'||(game.id||game.database_id)!==GAME_DB)
  fail('original_game_db_mismatch');
 const existingPayment=byName.get('PAYMENTS_DB');
 if(existingPayment&&
   (existingPayment.type!=='d1'||
    (existingPayment.id||existingPayment.database_id)!==PAYMENT_DB))
  fail('existing_payments_db_conflict');
 for(const flag of FLAGS){
  const b=byName.get(flag);
  if(b&&(b.type!=='plain_text'||b.text!=='false'))
   fail('real_money_gate_must_be_off_'+flag);
 }
 const crons=(schedules?.schedules||[]).map(x=>x.cron);
 if(crons.length!==1||crons[0]!=='* * * * *')
  fail('existing_cron_changed');
 return [
  '# Private verified 10-module RUST UP fixed-Stars dark release.',
  '# All charging gates OFF. Never commit the generated config or private code.',
  'name = "rustup-bot"',
  'main = "./worker.stars-commerce.bundle.js"',
  'compatibility_date = "2025-06-01"',
  'workers_dev = true',
  'keep_vars = true',
  'upload_source_maps = true',
  '',
  '[triggers]',
  'crons = ["* * * * *"]',
  '',
  '[vars]',
  ...FLAGS.map(name=>name+' = "false"'),
  '',
  '[secrets]',
  'required = ["BOT_TOKEN", "WEBHOOK_SECRET", "ADMIN_BOT_TOKEN", "CLIPS_BOT_TOKEN"]',
  '',
  '[[d1_databases]]',
  'binding = "DB"',
  'database_name = "rustup-stats"',
  'database_id = "'+GAME_DB+'"',
  '',
  '[[d1_databases]]',
  'binding = "PAYMENTS_DB"',
  'database_name = "rustup-stars-staging"',
  'database_id = "'+PAYMENT_DB+'"',
  ''
 ].join('\n');
}
function bindingSignature(settings,schedules){
 const bindings=settings.bindings.map(b=>({
  name:b.name,type:b.type,
  value:b.type==='plain_text'?b.text:undefined,
  id:b.type==='d1'?b.id||b.database_id:undefined
 })).sort((a,b)=>a.name.localeCompare(b.name));
 return digest(JSON.stringify({
  compatibility_date:settings.compatibility_date,
  compatibility_flags:settings.compatibility_flags||[],
  bindings,schedules:(schedules.schedules||[]).map(x=>x.cron)
 }));
}
async function cloudflare(url,token,plain=false){
 const response=await fetch(url,{
  method:'GET',headers:{authorization:'Bearer '+token},
  redirect:'error',signal:AbortSignal.timeout(25000)
 });
 if(!response.ok)fail('cloudflare_read_http_'+response.status);
 if(plain)return {body:await response.text(),type:response.headers.get('content-type')||''};
 const json=await response.json();
 if(json.success!==true)fail('cloudflare_metadata_error');
 return json.result;
}
async function snapshot(token){
 const [script,settings,schedules]=await Promise.all([
  cloudflare(BASE+'/content/v2',token,true),
  cloudflare(BASE+'/settings',token),
  cloudflare(BASE+'/schedules',token)
 ]);
 const source=readCurrentWorker10Map(script.body,script.type);
 const config=currentWorker10Config(settings,schedules);
 return {source,config,workerDigest:digest(script.body),
  metadataDigest:bindingSignature(settings,schedules)};
}
export async function stageCurrentWorker10(token,verifyDir=null){
 if(typeof token!=='string'||token.length<15)fail('local_cloudflare_login_required');
 const live=await snapshot(token);
 if(verifyDir){
  const dir=await fs.realpath(path.resolve(verifyDir));
  if(!dir.startsWith(PRIVATE+path.sep))fail('unsafe_private_snapshot_path');
  const manifest=JSON.parse(await fs.readFile(path.join(dir,'RUSTUP-WORKER10-MANIFEST.json'),'utf8'));
  if(manifest.version!==1||
     manifest.workerDigest!==live.workerDigest||
     manifest.metadataDigest!==live.metadataDigest)
    fail('live_worker_changed_since_private_snapshot');
  if(await fs.readFile(path.join(dir,'wrangler.stars-current10.toml'),'utf8')!==live.config)
    fail('private_wrangler_config_changed');
  for(const [name,source] of live.source){
   if(await fs.readFile(path.join(dir,name),'utf8')!==source)
    fail('private_original_changed_'+name);
  }
  for(const name of ADDON){
   const expected=await fs.readFile(path.join(SRC,name),'utf8');
   if(await fs.readFile(path.join(dir,name),'utf8')!==expected)
    fail('private_stars_addon_changed_'+name);
  }
  console.log('PASS: unchanged live 10-module Worker, cron, bindings and private adapter.');
  console.log('PASS: game source preserved; all real-money payment flags OFF.');
  return dir;
 }
 const name=new Date().toISOString().replace(/[^0-9TZ]/g,'-')+
   '-stars10-'+live.workerDigest.slice(0,10);
 const dir=path.join(PRIVATE,name);
 await fs.mkdir(dir,{recursive:true,mode:0o700});
 for(const [file,source] of live.source)
  await fs.writeFile(path.join(dir,file),source,{flag:'wx',mode:0o600});
 for(const file of ADDON)
  await fs.copyFile(path.join(SRC,file),path.join(dir,file),fs.constants.COPYFILE_EXCL);
 await fs.writeFile(path.join(dir,'wrangler.stars-current10.toml'),live.config,
  {flag:'wx',mode:0o600});
 await fs.writeFile(path.join(dir,'RUSTUP-WORKER10-MANIFEST.json'),
  JSON.stringify({version:1,workerDigest:live.workerDigest,
   metadataDigest:live.metadataDigest,sourceFiles:ORIGINAL,addedFiles:ADDON},null,2)+'\n',
  {flag:'wx',mode:0o600});
 console.log('PASS: Original current live RUST UP bot privately recovered without changes.');
 console.log('PASS: Native fixed Stars digital goods routes prepared (charging disabled).');
 console.log('Location: '+dir);
 return dir;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const mode=process.argv[2];
 stageCurrentWorker10(process.env.CLOUDFLARE_API_TOKEN,mode==='--verify'?process.argv[3]:null)
  .catch(e=>{console.error('RUST UP SAFE STAGING BLOCKED:',String(e.message||e));process.exitCode=1;});
}
