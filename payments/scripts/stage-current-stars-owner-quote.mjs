// Recover the exact active compiled game bot from the Wrangler source map,
// then stage a READ-ONLY 1.83 RUB/Star quote + authenticated history.
// NEVER deploys, calls Telegram Payments, mutates D1, or enables checkout.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {inspectDeployedHistorySource}
 from './verify-history-only-worker-release.mjs';
import {safeWorkerConfig,liveMetadataFingerprint}
 from './stage-current-verified-worker.mjs';
import {historyOnlyCompiledEntry}
 from './stage-history-only-compiled-worker.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const PRIVATE=path.join(ROOT,'.private','rustup-bot-recovered');
const SOURCE=path.join(ROOT,'payments','integration','telegram-stars');
const MANIFEST='RUSTUP-STARS-QUOTE-STAGE.json';
const CONFIG='wrangler.stars-owner-quote.toml';
const BUNDLE='worker.stars-owner-quote.bundle.js';
const ORIGINAL='worker.live-compiled-original.mjs';
const ENTRY='worker.history-only-compiled-entry.mjs';
const EXPECTED_VERSION='b2b449e1-b824-4af6-8048-c9ab32b134d2';
const ORIGINAL_SHA='dc181bc6f29e8256342fa216d80c73ff9850d1443c055a9002469f8685e193dc';
const API='https://api.cloudflare.com/client/v4/accounts/'+
 'af72e32cb9f1ba99dba07df30fe540fe/workers/scripts/rustup-bot';
const ADDONS=['stars-history-only-wrapper.mjs','telegram-initdata.mjs',
 'deposit-history-readonly.mjs','stars-owner-price-preview.mjs'];
const RATE=['STARS_MIN_RUB_MINOR','STARS_MAX_RUB_MINOR',
 'STARS_RUB_MINOR_PER_STAR_NUM','STARS_RUB_MINOR_PER_STAR_DEN'];
const hash=x=>createHash('sha256').update(x).digest('hex');
const error=s=>{throw Error('stars_owner_quote_'+s);};

export function extractOriginalFromDeployedHistory(raw){
 inspectDeployedHistorySource(raw,ORIGINAL_SHA);
 const boundary=raw.split(/\r?\n/,1)[0].trim();
 const p=raw.split(boundary).find(s=>
  /filename="worker.stars-history-only.bundle.js.map"/.test(s));
 if(!p)error('source_map_not_in_expected_wrangle_format');
 const sep=p.includes('\r\n\r\n')?'\r\n\r\n':'\n\n';
 const at=p.indexOf(sep);
 if(at<0)error('source_map_separator_missing');
 let map;
 try{map=JSON.parse(p.slice(at+sep.length).trim());}
 catch{error('source_map_unreadable');}
 const i=map.sources?.findIndex(s=>
  typeof s==='string'&&s.split('/').pop()===ORIGINAL);
 const source=map.sourcesContent?.[i];
 if(i<0||typeof source!=='string'||hash(source)!==ORIGINAL_SHA)
  error('original_compiled_bot_source_hash_mismatch');
 return source;
}
export function quoteOwnerConfig(baseline,rate){
 if(typeof baseline!=='string'||
    baseline.split('main = "./worker.stars-commerce.bundle.js"').length!==2||
    baseline.split('\n[vars]').length!==2||
    baseline.split('\n[secrets]').length!==2||
    !baseline.includes('binding = "DB"')||
    !baseline.includes('binding = "PAYMENTS_DB"')||
    !baseline.includes('crons = ["* * * * *"]')||
    !baseline.includes('keep_vars = true'))
  error('unsafe_live_baseline');
 const selected=JSON.parse(JSON.stringify(rate));
 if(selected?.operatorApproved!==true||
    selected?.rubPerStarDecimal!=='1.83'||
    selected?.STARS_MIN_RUB_MINOR!=='100'||
    selected?.STARS_MAX_RUB_MINOR!=='100000000'||
    selected?.STARS_RUB_MINOR_PER_STAR_NUM!=='183000'||
    selected?.STARS_RUB_MINOR_PER_STAR_DEN!=='1000')
  error('operator_rate_not_exact_1_83');
 for(const name of RATE){
  if(new RegExp('^'+name+'\\s*=','m').test(baseline))
   error('live_price_already_present_manual_review');
 }
 for(const name of ['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
  'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
  'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
  'PAYMENT_WALLET_STRICT_MODE']){
  if(baseline.split(name+' = "false"').length!==2)
   error('money_gate_not_off_'+name);
 }
 const lines=RATE.map(k=>k+' = "'+rate[k]+'"').join('\n');
 return baseline.replace(
  'main = "./worker.stars-commerce.bundle.js"',
  'main = "./'+BUNDLE+'"'
 ).replace('\n[secrets]','\n'+lines+'\n[secrets]');
}
async function fetchCloudflare(token,suffix,raw=false){
 const r=await fetch(API+suffix,{headers:{authorization:'Bearer '+token},
  redirect:'error',signal:AbortSignal.timeout(25000)});
 if(!r.ok)error('cloudflare_read_failed_http_'+r.status);
 if(raw)return r.text();
 const x=await r.json();
 if(x?.success!==true)error('cloudflare_read_failed');
 return x.result;
}
async function current(token){
 if(typeof token!=='string'||token.length<15)
  error('cloudflare_login_required');
 const [source,settings,schedules,deployment]=await Promise.all([
  fetchCloudflare(token,'/content/v2',true),
  fetchCloudflare(token,'/settings'),
  fetchCloudflare(token,'/schedules'),
  fetchCloudflare(token,'/deployments')
 ]);
 const id=deployment?.deployments?.[0]?.versions?.[0]?.version_id;
 if(id!==EXPECTED_VERSION)error('active_worker_version_changed_manual_review');
 const v=await fetchCloudflare(token,'/versions/'+id);
 const info=v?.resources?.script;
 if(typeof info?.etag!=='string'||info.etag.length<24||
    !info.handlers?.includes('fetch')||!info.handlers?.includes('scheduled')||
    !info.named_handlers?.some(x=>x.name==='refDeposit'&&
     x.handlers?.includes('class')))
  error('original_bot_named_handlers_changed');
 const original=extractOriginalFromDeployedHistory(source);
 const config=safeWorkerConfig(settings,schedules);
 const rate=JSON.parse(await fs.readFile(
  path.join(ROOT,'payments','stars-owner-rate.json'),'utf8'));
 const quoteConfig=quoteOwnerConfig(config,rate);
 const metadata=liveMetadataFingerprint(settings,schedules,id);
 return {original,config:quoteConfig,rate,id,etag:info.etag,metadata};
}
async function ensureExact(filename,value){
 try{await fs.writeFile(filename,value,{flag:'wx',mode:0o600});}
 catch(e){
  if(e?.code!=='EEXIST'||await fs.readFile(filename,'utf8')!==value)
   error('private_stage_modified_'+path.basename(filename));
 }
}
async function verify(dir,live,bundleRequired){
 const m=JSON.parse(await fs.readFile(path.join(dir,MANIFEST),'utf8'));
 if(m.format!==1||m.workerVersion!==live.id||m.etag!==live.etag||
    m.originalHash!==ORIGINAL_SHA||m.metadata!==live.metadata||
    m.rateHash!==hash(JSON.stringify(live.rate)))
  error('staged_worker_rate_or_live_metadata_changed');
 const sources=[
  [ORIGINAL,live.original],[ENTRY,historyOnlyCompiledEntry()],
  [CONFIG,live.config]
 ];
 for(const name of ADDONS)sources.push(
  [name,await fs.readFile(path.join(SOURCE,name),'utf8')]
 );
 for(const [name,source] of sources)
  if(await fs.readFile(path.join(dir,name),'utf8')!==source)
   error('stage_source_drift_'+name);
 if(bundleRequired){
  const code=await fs.readFile(path.join(dir,BUNDLE),'utf8');
  if(code.length<100000||!code.includes('quoteOwnerStarsReadOnly')||
     !code.includes('/api/stars/variable/quote')||
     !code.includes('/api/stars/variable/history')||
     !code.includes('refDeposit'))
   error('quote_bundle_missing_original_handlers_or_route');
 }
}
export async function stageCurrentOwnerQuote(token,checkPath=null){
 const live=await current(token);
 const dir=checkPath?await fs.realpath(path.resolve(checkPath)):
  path.join(PRIVATE,'owner-quote-'+live.id.slice(0,8)+'-'+ORIGINAL_SHA.slice(0,10));
 if(!dir.startsWith(PRIVATE+path.sep))
  error('untrusted_private_stage_location');
 if(checkPath){
  await verify(dir,live,true);
  console.log('PASS: original Worker version, source map hash, rate, D1, cron, named class and gates match.');
  console.log('NOT DEPLOYED. Private stage: '+dir);
  return dir;
 }
 await fs.mkdir(dir,{recursive:true,mode:0o700});
 await ensureExact(path.join(dir,ORIGINAL),live.original);
 await ensureExact(path.join(dir,ENTRY),historyOnlyCompiledEntry());
 await ensureExact(path.join(dir,CONFIG),live.config);
 for(const name of ADDONS)
  await ensureExact(path.join(dir,name),
   await fs.readFile(path.join(SOURCE,name),'utf8'));
 await ensureExact(path.join(dir,MANIFEST),
  JSON.stringify({format:1,workerVersion:live.id,etag:live.etag,
   originalHash:ORIGINAL_SHA,metadata:live.metadata,
   rateHash:hash(JSON.stringify(live.rate)),moneyEnabled:false,
   addons:ADDONS},null,2)+'\n');
 await verify(dir,live,false);
 console.log('PASS: 1.83 RUB/Star quote-only Worker privately staged with all payments OFF.');
 console.log('NOT DEPLOYED. Location: '+dir);
 return dir;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const mode=process.argv[2],target=process.argv[3];
 if(!['--stage','--verify'].includes(mode)||
    (mode==='--verify'&&(!target||process.argv.length!==4))||
    (mode==='--stage'&&process.argv.length!==3)){
  console.error('Usage: node stage-current-stars-owner-quote.mjs --stage | --verify <private-dir>');
  process.exitCode=2;
 }else stageCurrentOwnerQuote(process.env.CLOUDFLARE_API_TOKEN,
  mode==='--verify'?target:null).catch(e=>{
   console.error('STARS OWNER QUOTE STAGING STOP:',String(e?.message||e).slice(0,175));
   process.exitCode=1;
  });
}
