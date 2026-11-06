// Stage the exact CURRENT d618b572 Stars read-only Worker with an ADDITIVE
// v: webhook receipt/precheckout router. No deploy, no D1 writes, all payment OFF.
// Source map and every original published module must match the repository.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {checkOwnerQuoteSource}
 from './verify-owner-stars-quote-live.mjs';
import {safeWorkerConfig,liveMetadataFingerprint}
 from './stage-current-verified-worker.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const PRIVATE=path.join(ROOT,'.private','rustup-bot-recovered');
const SRC=path.join(ROOT,'payments','integration','telegram-stars');
const ACCOUNT='af72e32cb9f1ba99dba07df30fe540fe';
const API='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+
 '/workers/scripts/rustup-bot';
const VERSION='d618b572-ae34-4ec5-9e0e-471df5cbcfe2';
const ORIGINAL_SHA='dc181bc6f29e8256342fa216d80c73ff9850d1443c055a9002469f8685e193dc';
const CURRENT=['worker.live-compiled-original.mjs','telegram-initdata.mjs',
 'deposit-history-readonly.mjs','stars-owner-price-preview.mjs',
 'stars-history-only-wrapper.mjs','worker.history-only-compiled-entry.mjs'];
const ADDONS=['stars-variable-webhook-wrapper.mjs','stars-variable-bridge.mjs',
 'variable-stars.mjs','stars.mjs','payment-controls.mjs',
 'stars-delivery-queue.mjs','verified-stars-game-credit.mjs',
 'verified-stars-game-refund.mjs',
 'freeze-verified-stars-game-quote.mjs',
 'trusted-rub-usd.mjs','frozen-game-coin-quote.mjs'];
const ENTRY='worker.stars-webhook-only-entry.mjs';
const BUNDLE='worker.stars-webhook-only.bundle.js';
const CONFIG='wrangler.stars-webhook-only.toml';
const MANIFEST='RUSTUP-STARS-WEBHOOK-ONLY-STAGE.json';
const sha=x=>createHash('sha256').update(x).digest('hex');

const RELOCATIONS=Object.freeze({
 'stars-variable-webhook-wrapper.mjs':[
  ["from '../account-credit-ledger/freeze-verified-stars-game-quote.mjs'",
   "from './freeze-verified-stars-game-quote.mjs'"],
  ["from '../account-credit-ledger/verified-stars-game-refund.mjs'",
   "from './verified-stars-game-refund.mjs'"],
  ["from '../account-credit-ledger/trusted-rub-usd.mjs'",
   "from './trusted-rub-usd.mjs'"]
 ],
 'stars-delivery-queue.mjs':[
  "from '../account-credit-ledger/verified-stars-game-credit.mjs'",
  "from './verified-stars-game-credit.mjs'"
 ],
 'verified-stars-game-credit.mjs':[
  "from '../telegram-stars/stars.mjs'",
  "from './stars.mjs'"
 ],
 'verified-stars-game-refund.mjs':[
  "from '../telegram-stars/stars.mjs'",
  "from './stars.mjs'"
 ]
});
// Keep original security-sensitive source unchanged in GitHub; only flatten
// the two exact relative imports inside the private staging directory.
export function flattenVerifiedSettlementImport(name,source){
 if(typeof source!=='string')reject('invalid_addon_source');
 const replacement=RELOCATIONS[name];
 if(!replacement)return source;
 const pairs=Array.isArray(replacement[0])?replacement:[replacement];
 let output=source;
 for(const [from,to] of pairs){
  if(output.split(from).length!==2)
   reject('unexpected_paid_credit_import_layout_'+name);
  if(output.includes(to))
   reject('duplicate_flattened_paid_credit_import_'+name);
  output=output.replace(from,to);
 }
 return output;
}
async function addonSource(name){
 const root=['verified-stars-game-credit.mjs','verified-stars-game-refund.mjs',
  'freeze-verified-stars-game-quote.mjs',
  'trusted-rub-usd.mjs','frozen-game-coin-quote.mjs'].includes(name)?
  path.join(ROOT,'payments','integration','account-credit-ledger'):SRC;
 let value=await fs.readFile(path.join(root,name),'utf8');
 value=flattenVerifiedSettlementImport(name,value);
 if(name==='verified-stars-game-refund.mjs'){
  const from="from './verified-stars-game-credit.mjs'";
  // This relative import is valid after the private flattening step.
  if(value.split(from).length!==2)reject('unexpected_refund_credit_import');
 }
 return value;
}

function reject(message){throw Error('stars_webhook_stage_'+message);}

export function webhookEntry(){
 return [
  "import original from './worker.live-compiled-original.mjs';",
  "export * from './worker.live-compiled-original.mjs';",
  "import {wrapHistoryOnlyWorker} from './stars-history-only-wrapper.mjs';",
  "import {wrapCurrentStarsWebhook} from './stars-variable-webhook-wrapper.mjs';",
  'export default wrapCurrentStarsWebhook(wrapHistoryOnlyWorker(original));',
  ''
 ].join('\n');
}
const OWNER_STAR_RATE=Object.freeze({
 STARS_MIN_RUB_MINOR:'100',
 STARS_MAX_RUB_MINOR:'100000000',
 STARS_RUB_MINOR_PER_STAR_NUM:'183000',
 STARS_RUB_MINOR_PER_STAR_DEN:'1000'
});
// The generic worker recovery function deliberately omits price vars from
// its generated TOML. Never infer that means the *live* vars are missing.
// Compare against Cloudflare settings before restoring the exact price.
export function verifyLiveStarsOwnerRate(bindings){
 if(!Array.isArray(bindings))reject('live_rate_bindings_missing');
 for(const [name,value] of Object.entries(OWNER_STAR_RATE)){
  const found=bindings.filter(binding=>binding?.name===name);
  if(found.length!==1||found[0].type!=='plain_text'||
     found[0].text!==value)
   reject('live_owner_rate_mismatch_'+name);
 }
 return true;
}
export function webhookOffConfig(base,bindings){
 if(typeof base!=='string')reject('unreviewed_bot_config');
 verifyLiveStarsOwnerRate(bindings);
 const from='main = "./worker.stars-commerce.bundle.js"';
 if(base.split(from).length!==2||
    !base.includes('keep_vars = true')||
    !base.includes('upload_source_maps = true')||
    !base.includes('binding = "DB"')||
    !base.includes('binding = "PAYMENTS_DB"')||
    !base.includes('crons = ["* * * * *"]')||
    base.split('\n[vars]').length!==2||
    base.split('\n[secrets]').length!==2)
  reject('unreviewed_bot_config');
 const flags=['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
  'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
  'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
  'PAYMENT_WALLET_STRICT_MODE'];
 for(const name of flags){
  if(base.split(name+' = "false"').length!==2)
   reject('payment_gate_not_off_'+name);
 }
 const rateLines=[];
 for(const [name,value] of Object.entries(OWNER_STAR_RATE)){
  const matches=base.match(new RegExp('^'+name+'\\s*=.*$','gm'))||[];
  if(matches.length>1||(matches.length===1&&
     matches[0]!==name+' = "'+value+'"'))
   reject('price_config_override_mismatch_'+name);
  if(matches.length===0)rateLines.push(name+' = "'+value+'"');
 }
 return base.replace(from,'main = "./'+BUNDLE+'"')
  .replace('\n[secrets]',
   (rateLines.length?'\n'+rateLines.join('\n'):'')+'\n[secrets]');
}
export function extractCurrentModules(raw){
 checkOwnerQuoteSource(raw,ORIGINAL_SHA);
 const boundary=raw.split(/\r?\n/,1)[0].trim();
 const mapPart=raw.split(boundary).find(s=>
  /filename="worker\.stars-owner-quote\.bundle\.js\.map"/.test(s));
 if(!mapPart)reject('expected_live_module_map_missing');
 const sep=mapPart.includes('\r\n\r\n')?'\r\n\r\n':'\n\n';
 const at=mapPart.indexOf(sep);
 if(at<0)reject('multipart_separator_invalid');
 let map;
 try{map=JSON.parse(mapPart.slice(at+sep.length).trim());}
 catch{reject('source_map_json_invalid');}
 if(map.version!==3||map.sources?.length!==CURRENT.length||
    map.sourcesContent?.length!==CURRENT.length)
  reject('live_sources_changed');
 const sources=new Map();
 for(let i=0;i<CURRENT.length;i++){
  const name=map.sources[i]?.split('/').pop();
  const content=map.sourcesContent[i];
  if(!CURRENT.includes(name)||sources.has(name)||
     typeof content!=='string')
   reject('current_source_ambiguous');
  sources.set(name,content);
 }
 if(CURRENT.some(name=>!sources.has(name))||
    sha(sources.get(CURRENT[0]))!==ORIGINAL_SHA)
  reject('original_live_bot_hash_changed');
 return sources;
}
// Transient Cloudflare API 429/5xx responses must not force a deploy.
 // Retry read-only requests only; every source/version/security check still runs.
export async function readCloudflareWithRetry(url,token,{raw=false,
 fetchImpl=fetch,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 for(let attempt=0;attempt<4;attempt++){
  let r;
  try{
   r=await fetchImpl(url,{
    method:'GET',headers:{authorization:'Bearer '+token},
    redirect:'error',signal:AbortSignal.timeout(25000)
   });
  }catch(e){
   if(attempt===3)reject('cloudflare_read_network_unavailable');
   await sleep(800*2**attempt);
   continue;
  }
  if(!r.ok){
   if(![429,500,502,503,504].includes(r.status)||attempt===3)
    reject('cloudflare_read_'+r.status);
   await sleep(800*2**attempt);
   continue;
  }
  if(raw)return r.text();
  const data=await r.json();
  if(data?.success!==true)reject('cloudflare_result_invalid');
  return data.result;
 }
 reject('cloudflare_read_exhausted');
}
async function get(token,suffix,raw=false){
 return readCloudflareWithRetry(API+suffix,token,{raw});
}
async function live(token){
 if(typeof token!=='string'||token.length<15)
  reject('cloudflare_login_required');
 const [raw,settings,schedules,deploy]=await Promise.all([
  get(token,'/content/v2',true),
  get(token,'/settings'),
  get(token,'/schedules'),
  get(token,'/deployments')
 ]);
 const version=deploy?.deployments?.[0]?.versions?.[0]?.version_id;
 if(version!==VERSION)reject('active_bot_version_changed');
 const detail=await get(token,'/versions/'+version);
 const bot=detail?.resources?.script;
 if(typeof bot?.etag!=='string'||bot.etag.length<24||
    !bot.handlers?.includes('fetch')||
    !bot.handlers?.includes('scheduled')||
    !bot.named_handlers?.some(x=>x.name==='refDeposit'&&
     x.handlers?.includes('class')))
  reject('original_bot_handlers_changed');
 const modules=extractCurrentModules(raw);
 for(const name of CURRENT.slice(1,-1)){
  const current=await fs.readFile(path.join(SRC,name),'utf8');
  if(modules.get(name)!==current)
   reject('live_history_or_quote_differs_from_reviewed_repo_'+name);
 }
 const config=webhookOffConfig(safeWorkerConfig(settings,schedules),settings.bindings);
 const metadata=liveMetadataFingerprint(settings,schedules,version);
 return {modules,config,etag:bot.etag,metadata,version};
}
async function putOnce(file,value){
 try{await fs.writeFile(file,value,{flag:'wx',mode:0o600});}
 catch(e){
  if(e?.code!=='EEXIST'||await fs.readFile(file,'utf8')!==value)
   reject('local_source_drift_'+path.basename(file));
 }
}
async function check(dir,current,requireBundle=false){
 const manifest=JSON.parse(await fs.readFile(path.join(dir,MANIFEST),'utf8'));
 if(manifest.version!==1||manifest.activeVersion!==current.version||
    manifest.etag!==current.etag||
    manifest.metadata!==current.metadata||
    manifest.originalSha!==ORIGINAL_SHA)
  reject('original_worker_changed_or_manifest_drift');
 const sources=new Map(current.modules);
 sources.set(ENTRY,webhookEntry());
 sources.set(CONFIG,current.config);
 for(const name of ADDONS)
  sources.set(name,await addonSource(name));
 for(const [name,value] of sources)
  if(await fs.readFile(path.join(dir,name),'utf8')!==value)
   reject('staged_source_changed_'+name);
 if(requireBundle){
  const code=await fs.readFile(path.join(dir,BUNDLE),'utf8');
  if(code.length<100000||
     !code.includes('wrapHistoryOnlyWorker')||
     !code.includes('wrapCurrentStarsWebhook')||
     !code.includes('variableStarsWebhook')||
     !code.includes('runVariableStarsDeliveryQueue')||
     !code.includes('deliverVerifiedVariableStarsCredit')||
     !code.includes('reconcileRecordedStarsRefundBatch')||
     !code.includes('freezeVerifiedStarsGameQuote')||
     !code.includes('/api/stars/variable/quote')||
     !code.includes('/api/stars/variable/history')||
     !code.includes('refDeposit'))
   reject('webhook_bundle_contract_missing');
 }
 return true;
}
export async function stageStarsWebhookOnly(token,folder=null){
 const current=await live(token);
 const dir=folder?await fs.realpath(path.resolve(folder)):
  path.join(PRIVATE,'webhook-only-'+VERSION.slice(0,8)+'-'+ORIGINAL_SHA.slice(0,10));
 if(!dir.startsWith(PRIVATE+path.sep))reject('untrusted_stage_path');
 if(folder){
  await check(dir,current,true);
  console.log('PASS: exact live Worker version, all sources, 1.83 RUB rate, D1, cron, named class and OFF gates checked.');
  console.log('NOT DEPLOYED. Private stage: '+dir);
  return dir;
 }
 await fs.mkdir(dir,{recursive:true,mode:0o700});
 for(const [name,content] of current.modules)
  await putOnce(path.join(dir,name),content);
 for(const name of ADDONS)
  await putOnce(path.join(dir,name),await addonSource(name));
 await putOnce(path.join(dir,ENTRY),webhookEntry());
 await putOnce(path.join(dir,CONFIG),current.config);
 await putOnce(path.join(dir,MANIFEST),
  JSON.stringify({version:1,activeVersion:current.version,
   originalSha:ORIGINAL_SHA,etag:current.etag,
   metadata:current.metadata,paymentsEnabled:false},null,2)+'\n');
 await check(dir,current);
 console.log('PASS: live Worker recovered with additional Stars webhook evidence router.');
 console.log('NOT DEPLOYED. Private stage: '+dir);
 return dir;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const mode=process.argv[2],dir=process.argv[3];
 if(!['--stage','--verify'].includes(mode)||
    (mode==='--stage'&&process.argv.length!==3)||
    (mode==='--verify'&&(!dir||process.argv.length!==4))){
  console.error('Usage: node stage-current-stars-webhook-only.mjs --stage | --verify <private-dir>');
  process.exitCode=2;
 }else stageStarsWebhookOnly(process.env.CLOUDFLARE_API_TOKEN,
   mode==='--verify'?dir:null)
  .catch(e=>{
   console.error('STARS WEBHOOK STAGING STOP:',String(e?.message||e).slice(0,180));
   process.exitCode=1;
  });
}
