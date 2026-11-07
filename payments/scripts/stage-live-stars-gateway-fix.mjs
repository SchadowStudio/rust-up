// Patch precisely one current LIVE compiled Worker call. No source-map assumption.
// Fail-closed: exact version, metadata, source bytes, and payment gates are checked.
// Only the PAYMENT SUPPORT sendMessage redirect mode is adjusted.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {safeWorkerConfig} from './stage-current-verified-worker.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const PRIVATE=path.join(ROOT,'.private','rustup-bot-recovered');
const PREFIX='https://api.cloudflare.com/client/v4/accounts/af72e32cb9f1ba99dba07df30fe540fe/workers/scripts/rustup-bot';
const VERSION='24ca912d-76fc-4695-a2a4-bbe2020164da';
const BUNDLE='worker.telegram-gateway-live-hotfix.mjs';
const CONFIG='wrangler.telegram-gateway-live-hotfix.toml';
const MANIFEST='TELEGRAM-GATEWAY-LIVE-HOTFIX.json';
const MARKER='async function telegramApi(env, method, body, fetchImpl) {';
const BEFORE='redirect: "error"';
const AFTER='redirect: "manual"';
const hash=t=>createHash('sha256').update(t).digest('hex');
const fail=s=>{throw Error('telegram_gateway_hotfix_'+s)};
function codeFromMultipart(raw){
 if(typeof raw!=='string'||raw.length<300000||raw.length>2000000)fail('raw_size');
 const boundary=raw.split(/\r?\n/,1)[0];
 if(!/^--[a-zA-Z0-9_=-]{8,200}$/.test(boundary))fail('boundary');
 const at=raw.indexOf('\r\n\r\n');
 const end=raw.indexOf('\r\n'+boundary,at+4);
 if(at<0||end<0||!raw.slice(0,at).includes('application/javascript+module'))
  fail('multipart_layout');
 const code=raw.slice(at+4,end);
 if(!code.includes(MARKER)||!code.includes('wrapCurrentStarsWebhook(wrapHistoryOnlyWorker(worker_default))')||
    !code.includes('rustup_stars_auth_denied')||code.length<350000)
  fail('current_worker_contract');
 return code;
}
function targetedPatch(code){
 const head=code.indexOf(MARKER),next=code.indexOf('\n__name(telegramApi',head);
 if(head<0||next<head||code.indexOf(MARKER,head+MARKER.length)!==-1)
  fail('telegram_gateway_ambiguous');
 const segment=code.slice(head,next);
 if(segment.split(BEFORE).length!==2)fail('compiled_gateway_changed');
 if(code.split(BEFORE).length!==2)fail('other_unexpected_gateway_call');
 const patched=code.slice(0,head)+segment.replace(BEFORE,AFTER)+code.slice(next);
 // Another handler already uses redirect: "manual". Verify ONLY this
 // provider function; replacing the first global match would be incorrect.
 const patchedSegment=patched.slice(head,head+segment.length-BEFORE.length+AFTER.length);
 if(patchedSegment.split(AFTER).length!==2||
    code.slice(0,head)+patchedSegment.replace(AFTER,BEFORE)+code.slice(next)!==code)
  fail('patch_not_strictly_one_condition');
 return patched;
}
async function get(token,endpoint,raw=false){
 const resp=await fetch(PREFIX+endpoint,{
  headers:{authorization:'Bearer '+token},redirect:'manual',
  signal:AbortSignal.timeout(30000)});
 if(!resp.ok)fail('api_http_'+resp.status);
 if(raw)return resp.text();
 const o=await resp.json();
 if(o.success!==true)fail('cloudflare_result');
 return o.result;
}
const bindingRecord=settings=>(settings?.bindings||[]).map(b=>({
 name:b.name,type:b.type,
 text:b.type==='plain_text'?b.text:null,
 id:b.type==='d1'?(b.id||b.database_id):null
})).sort((a,b)=>a.name.localeCompare(b.name));
function checkSettings(settings,schedules){
 const flags=['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED','STARS_VARIABLE_TOPUP_ENABLED',
  'STARS_VARIABLE_CREDIT_LEDGER_READY','PAYMENT_WALLET_STRICT_MODE','STARS_REFUNDS_ENABLED'];
 for(const name of flags){
  const b=settings.bindings.find(v=>v.name===name);
  if(!b||b.type!=='plain_text'||b.text!=='false')
   fail('payment_gate_must_remain_off_'+name);
 }
 if(!settings.bindings.some(x=>x.name==='BOT_TOKEN'&&x.type==='secret_text'))
  fail('telegram_secret_missing');
 if((schedules.schedules||[]).map(x=>x.cron).join(',')!=='* * * * *')
  fail('unexpected_cron');
 const config=safeWorkerConfig(settings,schedules)
  .replace('main = "./worker.stars-commerce.bundle.js"','main = "./'+BUNDLE+'"')
  .replace('upload_source_maps = true','upload_source_maps = false');
 if(!config.includes('main = "./'+BUNDLE+'"')||
    !config.includes('keep_vars = true')||
    !config.includes('upload_source_maps = false'))
  fail('unsafe_config');
 // Already-compiled source: never let Wrangler bundle or transform it again.
 return config.replace('keep_vars = true','keep_vars = true\nno_bundle = true');
}
async function snapshot(token){
 const [content,settings,schedules,deploy]=await Promise.all([
  get(token,'/content/v2',true),get(token,'/settings'),
  get(token,'/schedules'),get(token,'/deployments')
 ]);
 const version=deploy?.deployments?.[0]?.versions?.[0]?.version_id;
 if(typeof version!=='string')fail('version_missing');
 const config=checkSettings(settings,schedules);
 const metadata=hash(JSON.stringify({
  bindings:bindingRecord(settings),compatibilityDate:settings.compatibility_date,
  flags:settings.compatibility_flags||[],
  schedules:(schedules.schedules||[]).map(x=>x.cron)
 }));
 return {version,code:codeFromMultipart(content),metadata,config};
}
async function stage(token){
 const live=await snapshot(token);
 if(live.version!==VERSION)fail('live_version_changed');
 const patched=targetedPatch(live.code);
 const dir=path.join(PRIVATE,'telegram-gateway-live-'+VERSION.slice(0,8)+'-'+hash(live.code).slice(0,12));
 await fs.mkdir(dir,{recursive:true,mode:0o700});
 const manifest={
  version:1,originalVersion:VERSION,liveHash:hash(live.code),
  targetHash:hash(patched),metadataHash:live.metadata,
  configHash:hash(live.config),paymentsEnabled:false
 };
 // Existing stage with the same trusted hashes may be reused after an interrupted dry-run.
 const files=[[BUNDLE,patched],[CONFIG,live.config],[MANIFEST,JSON.stringify(manifest,null,2)+'\n']];
 for(const [name,value] of files){
  const filename=path.join(dir,name);
  try{await fs.writeFile(filename,value,{flag:'wx',mode:0o600});}
  catch(e){
   if(e.code!=='EEXIST'||await fs.readFile(filename,'utf8')!==value)
    fail('existing_stage_mismatch_'+name);
  }
 }
 console.log('PASS: exact current Worker captured; one Telegram API redirect option patched; payments OFF.');
 console.log('NOT DEPLOYED. Private stage: '+dir);
}
async function verify(token,input,post){
 const dir=await fs.realpath(path.resolve(input));
 if(!dir.startsWith(PRIVATE+path.sep))fail('stage_location');
 const manifest=JSON.parse(await fs.readFile(path.join(dir,MANIFEST),'utf8'));
 if(manifest.version!==1||manifest.originalVersion!==VERSION||
    manifest.paymentsEnabled!==false)fail('manifest_invalid');
 const patched=await fs.readFile(path.join(dir,BUNDLE),'utf8');
 const config=await fs.readFile(path.join(dir,CONFIG),'utf8');
 if(hash(patched)!==manifest.targetHash||hash(config)!==manifest.configHash)
  fail('stage_tampering');
 const live=await snapshot(token);
 if(live.metadata!==manifest.metadataHash)fail('cloudflare_settings_changed');
 if(post){
  if(hash(live.code)!==manifest.targetHash)fail('deployed_script_not_exact_target');
  console.log('PASS: live Worker matches exact single-option patch, payments/metadata preserved.');
 }else{
  if(live.version!==VERSION||hash(live.code)!==manifest.liveHash)
   fail('live_worker_drift_before_release');
  // Reverse the change inside telegramApi only, preserving the pre-existing
  // redirect: "manual" in the independent payment-support handler.
  const begin=patched.indexOf(MARKER);
  const end=patched.indexOf('\n__name(telegramApi',begin);
  if(begin<0||end<begin)fail('staged_provider_function_missing');
  const segment=patched.slice(begin,end);
  if(segment.split(AFTER).length!==2)fail('staged_provider_redirect_ambiguous');
  const original=patched.slice(0,begin)+segment.replace(AFTER,BEFORE)+patched.slice(end);
  if(hash(original)!==manifest.liveHash)fail('not_exact_single_condition_patch');
  console.log('PASS: current Worker unchanged; single-option patch ready; all gates OFF.');
 }
}
const token=process.env.CLOUDFLARE_API_TOKEN;
try{
 if(typeof token!=='string'||token.length<15)fail('cloudflare_token_missing');
 const [mode,folder]=process.argv.slice(2);
 if(mode==='--stage')await stage(token);
 else if(mode==='--verify'&&folder)await verify(token,folder,false);
 else if(mode==='--postverify'&&folder)await verify(token,folder,true);
 else fail('usage');
}catch(e){
 const v=String(e?.message||'');
 console.log('RUST UP LIVE HOTFIX BLOCKED: '+(v.startsWith('telegram_gateway_hotfix_')?v:'unverified_error'));
 process.exitCode=1;
}
