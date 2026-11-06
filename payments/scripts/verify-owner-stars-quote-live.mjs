// READ-ONLY independent postdeploy audit: 1.83 RUB/Star quote-only Worker.
// No Telegram Bot API, no D1 writes and no deploy action.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {checkHistoryReleaseMetadata}
 from './verify-history-only-worker-release.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const PRIVATE=path.join(ROOT,'.private','rustup-bot-recovered')+path.sep;
const API='https://api.cloudflare.com/client/v4/accounts/'+
 'af72e32cb9f1ba99dba07df30fe540fe/workers/scripts/rustup-bot';
const ORIGINAL_HASH='dc181bc6f29e8256342fa216d80c73ff9850d1443c055a9002469f8685e193dc';
const EXPECTED_VERSION='b2b449e1-b824-4af6-8048-c9ab32b134d2';
const PRICE_KEYS=['STARS_MIN_RUB_MINOR','STARS_MAX_RUB_MINOR',
 'STARS_RUB_MINOR_PER_STAR_NUM','STARS_RUB_MINOR_PER_STAR_DEN'];
const REQUIRED=[
 'worker.live-compiled-original.mjs',
 'telegram-initdata.mjs',
 'deposit-history-readonly.mjs',
 'stars-owner-price-preview.mjs',
 'stars-history-only-wrapper.mjs',
 'worker.history-only-compiled-entry.mjs'
];
const hash=s=>createHash('sha256').update(s).digest('hex');
const fail=code=>{throw Error('owner_quote_release_'+code);};

export function checkOwnerQuoteSource(raw,originalHash=ORIGINAL_HASH,stageHashes=null){
 if(typeof raw!=='string'||raw.length<100000||raw.length>25000000)
  fail('compiled_source_missing');
 const boundary=raw.split(/\r?\n/,1)[0].trim();
 if(!/^--[A-Za-z0-9_=-]{8,200}$/.test(boundary))
  fail('multipart_invalid');
 const sections=raw.split(boundary).filter(s=>s.includes('Content-Disposition:'));
 if(sections.length!==2)fail('compiled_parts_unexpected');
 const files=sections.map(section=>{
  const sep=section.includes('\r\n\r\n')?'\r\n\r\n':'\n\n';
  const at=section.indexOf(sep);
  if(at<0)fail('multipart_header_invalid');
  const head=section.slice(0,at);
  const filename=/filename="([^"]+)"/.exec(head)?.[1];
  if(!filename)fail('missing_filename');
  return {filename,body:section.slice(at+sep.length).trim()};
 });
 const js=files.find(x=>x.filename==='worker.stars-owner-quote.bundle.js');
 const mapfile=files.find(x=>x.filename==='worker.stars-owner-quote.bundle.js.map');
 if(!js||!mapfile||js.body.length<100000)
  fail('compiled_bundle_or_map_missing');
 for(const marker of ['/api/stars/variable/history',
  '/api/stars/variable/quote','quoteOwnerStarsReadOnly','refDeposit']){
  if(!js.body.includes(marker))fail('missing_history_quote_or_original_handler');
 }
 let sm;
 try{sm=JSON.parse(mapfile.body);}
 catch{fail('invalid_source_map_json');}
 if(sm?.version!==3||!Array.isArray(sm.sources)||
    !Array.isArray(sm.sourcesContent)||
    sm.sources.length!==REQUIRED.length||
    sm.sourcesContent.length!==REQUIRED.length||
    REQUIRED.some(name=>sm.sources.filter(x=>
     typeof x==='string'&&x.split('/').pop()===name).length!==1))
  fail('source_map_missing_expected_exact_modules');
 const originals=REQUIRED.map(name=>{
  const index=sm.sources.findIndex(x=>x.split('/').pop()===name);
  return {name,source:sm.sourcesContent[index]};
 });
 if(originals.some(x=>typeof x.source!=='string'))fail('invalid_module_source');
 if(hash(originals[0].source)!==originalHash)
  fail('original_bot_hash_changed');
 if(stageHashes!==null){
  for(const source of originals)
   if(hash(source.source)!==stageHashes[source.name])
    fail('deployed_source_different_from_reviewed_stage_'+source.name);
 }
 if(!originals.find(x=>x.name==='stars-owner-price-preview.mjs').source
   .includes('rubMinorPerStar:183'))
  fail('compiled_operator_rate_wrong');
 if(!originals.find(x=>x.name==='stars-history-only-wrapper.mjs').source
   .includes('if(path===QUOTE)'))
  fail('quote_not_authenticated_by_wrapper');
 return {valid:true,originalBotExact:true,readOnlyPriceModule:true,
  sourceMapPresent:true,moduleCount:REQUIRED.length};
}

export function verifyOwnerQuoteSettings({settings,schedules,version,versionId,
  manifest,ownerRate}){
 const synthetic={format:1,source:'compiled_history_only',
  activeVersion:manifest?.workerVersion,
  sourceHash:manifest?.originalHash,scriptEtag:manifest?.etag};
 const prior=checkHistoryReleaseMetadata({
  bindings:settings?.bindings,schedules,versionInfo:version,
  versionId,manifest:synthetic,phase:'after'
 });
 if(manifest?.workerVersion!==EXPECTED_VERSION||
    manifest?.originalHash!==ORIGINAL_HASH||
    manifest?.moneyEnabled!==false)
  fail('unreviewed_stage_manifest');
 const b=new Map((settings?.bindings||[]).map(x=>[x.name,x]));
 for(const k of PRICE_KEYS){
  const v=b.get(k);
  if(v?.type!=='plain_text'||v.text!==ownerRate?.[k])
   fail('live_operator_rate_mismatch_'+k);
 }
 if(ownerRate?.operatorApproved!==true||ownerRate.rubPerStarDecimal!=='1.83')
  fail('operator_rate_not_approved');
 return {...prior,operatorPriceConfigured:true,rateRubPerStar:'1.83'};
}
async function get(token,p,raw=false){
 const response=await fetch(API+p,{method:'GET',
  headers:{authorization:'Bearer '+token},redirect:'error',
  signal:AbortSignal.timeout(25000)});
 if(!response.ok)fail('cloudflare_http_'+response.status);
 if(raw)return response.text();
 const r=await response.json();
 if(r?.success!==true)fail('cloudflare_result_failed');
 return r.result;
}
export async function checkLiveOwnerQuote(token,stageFolder){
 if(typeof token!=='string'||token.length<15)fail('cloudflare_login_missing');
 const directory=await fs.realpath(path.resolve(stageFolder||''));
 if(!directory.startsWith(PRIVATE))fail('untrusted_stage_path');
 const m=JSON.parse(await fs.readFile(
  path.join(directory,'RUSTUP-STARS-QUOTE-STAGE.json'),'utf8'));
 const owner=JSON.parse(await fs.readFile(
  path.join(ROOT,'payments','stars-owner-rate.json'),'utf8'));
 if(m.rateHash!==hash(JSON.stringify(owner)))
  fail('operator_rate_changed_since_stage');
 const [settings,schedules,deploy,raw]=await Promise.all([
  get(token,'/settings'),get(token,'/schedules'),
  get(token,'/deployments'),get(token,'/content/v2',true)
 ]);
 const versionId=deploy?.deployments?.[0]?.versions?.[0]?.version_id;
 const version=await get(token,'/versions/'+versionId);
 const a=verifyOwnerQuoteSettings({
  settings,schedules,version,versionId,manifest:m,ownerRate:owner
 });
 const stageHashes=Object.fromEntries(await Promise.all(REQUIRED.map(async name=>
  [name,hash(await fs.readFile(path.join(directory,name),'utf8'))])));
 const b=checkOwnerQuoteSource(raw,ORIGINAL_HASH,stageHashes);
 return {...a,...b,realCheckoutEnabled:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const folder=process.argv[2];
 if(!folder||process.argv.length!==3){
  console.error('Usage: node verify-owner-stars-quote-live.mjs <private-folder>');
  process.exitCode=2;
 }else checkLiveOwnerQuote(process.env.CLOUDFLARE_API_TOKEN,folder)
  .then(x=>console.log('PASS: '+JSON.stringify(x)))
  .catch(e=>{console.error('STARS QUOTE AUDIT STOP:',
   String(e?.message||e).slice(0,180));process.exitCode=1;});
}
