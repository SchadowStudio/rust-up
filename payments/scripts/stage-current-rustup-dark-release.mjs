// RUST UP dark release: adopt CURRENT compiled Worker without replacing the game.
// Local-only Cloudflare recovery; strict live SHA/version and bindings preflight.
// NO real-money activation. Run via prepare-current-rustup-dark-release.ps1.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const API='https://api.cloudflare.com/client/v4/accounts/af72e32cb9f1ba99dba07df30fe540fe/workers/scripts/rustup-bot';
const PRIVATE=path.join(ROOT,'.private','rustup-bot-recovered');
const VERSION='661caf39-5fe0-4dcd-8092-bb9ad236f2c0';
const sha=v=>createHash('sha256').update(v).digest('hex');
const fail=why=>{throw Error('rustup_dark_release_'+why)};
async function cf(token,pathName,{raw=false}={}){
 const r=await fetch(API+pathName,{headers:{authorization:'Bearer '+token},
  redirect:'error',signal:AbortSignal.timeout(25000)});
 if(!r.ok)fail('cloudflare_http_'+r.status);
 if(raw)return r.text();
 const d=await r.json();
 if(d?.success!==true)fail('cloudflare_result_invalid');
 return d.result;
}
export function extractCurrentLiveModule(raw){
 if(typeof raw!=='string'||raw.length<100000||raw.length>2000000)
  fail('worker_content_invalid');
 const boundary=raw.split(/\r?\n/,1)[0];
 if(!/^--[a-f0-9]{24,}$/.test(boundary))fail('multipart_boundary_invalid');
 const parts=raw.split(boundary).filter(v=>v.includes('Content-Type: application/javascript+module'));
 if(parts.length!==1)fail('worker_module_layout_changed');
 const part=parts[0],sep=part.includes('\r\n\r\n')?'\r\n\r\n':'\n\n';
 const cut=part.indexOf(sep);
 if(cut<0||!part.includes('name="worker.telegram-gateway-live-hotfix.mjs"; filename="worker.telegram-gateway-live-hotfix.mjs"'))
  fail('live_worker_filename_changed');
 const source=part.slice(cut+sep.length).trimEnd();
 if(!source.includes('wrapCurrentStarsWebhook(wrapHistoryOnlyWorker(worker_default))')||
    !source.includes('refDeposit')||
    !source.includes('stars_game_credit')||
    !source.includes('worker_stars_webhook_only_entry_default'))
  fail('unreviewed_live_worker_contract');
 return source;
}
export function unwrapOnlyReviewedStarsLayer(source){
 const expression=/var worker_stars_webhook_only_entry_default = wrapCurrentStarsWebhook\(wrapHistoryOnlyWorker\(worker_default\)\);/g;
 const ending=/export\s*\{\s*worker_stars_webhook_only_entry_default as default,\s*refDeposit\s*\};?/g;
 if([...source.matchAll(expression)].length!==1||[...source.matchAll(ending)].length!==1)
  fail('reviewed_worker_export_changed');
 // Retain the complete compiled bot and every existing function. Replace
 // ONLY its final wrapper export so the new audited wrapper is not doubled.
 return source.replace(ending,
  'var rustup_readonly_live_worker = wrapHistoryOnlyWorker(worker_default);\n'+
  'export {rustup_readonly_live_worker as default, refDeposit};')
  .replace(/^\/\/# sourceMappingURL=.*$/gm,'');
}
export function darkConfig(settings,schedules){
 const b=settings?.bindings;
 if(!Array.isArray(b)||!Array.isArray(schedules?.schedules)||
    settings.compatibility_date!=='2025-06-01'||
    (settings.compatibility_flags||[]).length!==0||
    schedules.schedules.length!==1||
    schedules.schedules[0].cron!=='* * * * *')
  fail('unreviewed_live_runtime_or_cron');
 const lookup=new Map(b.map(x=>[x.name,x]));
 for(const name of ['BOT_TOKEN','WEBHOOK_SECRET','ADMIN_BOT_TOKEN','CLIPS_BOT_TOKEN']){
  if(lookup.get(name)?.type!=='secret_text')fail('bot_secret_missing_'+name);
 }
 for(const name of ['STARS_GAME_CREDIT_SETTLEMENT_ENABLED',
  'STARS_GAME_CREDIT_REFUND_RECONCILIATION_ENABLED',
  'STARS_VARIABLE_CHECKOUT_RELEASE_APPROVED']){
  if(lookup.get(name)?.type!=='secret_text')fail('settlement_secret_missing_'+name);
 }
 for(const n of ['STARS_PAYMENT_ENABLED','STARS_VARIABLE_TOPUP_ENABLED']){
  if(lookup.get(n)?.type!=='plain_text'||lookup.get(n).text!=='false')
   fail('real_payment_gate_not_off_'+n);
 }
 if(lookup.get('DB')?.type!=='d1'||
    (lookup.get('DB').id||lookup.get('DB').database_id)!=='9b0b533f-540a-4a25-a429-70ca8bd4e23d'||
    lookup.get('PAYMENTS_DB')?.type!=='d1'||
    (lookup.get('PAYMENTS_DB').id||lookup.get('PAYMENTS_DB').database_id)!=='06079270-a227-466a-9991-abd4201ec5f6')
  fail('game_or_payment_database_changed');
 const supported=new Set(['secret_text','plain_text','d1']);
 if(b.some(x=>!supported.has(x.type)))fail('unsupported_live_binding_type');
 const quote=x=>JSON.stringify(x);
 const plain=b.filter(x=>x.type==='plain_text');
 const lines=[
  'name = "rustup-bot"',
  'main = "./worker.current-stars-dark.bundle.js"',
  'compatibility_date = '+quote(settings.compatibility_date),
  'workers_dev = true','keep_vars = true','upload_source_maps = true',
  '[triggers]','crons = ["* * * * *"]','[vars]',
  ...plain.map(x=>x.name+' = '+quote(x.text)),
  '[secrets]','required = '+quote(b.filter(x=>x.type==='secret_text').map(x=>x.name)),
  '[[d1_databases]]','binding = "DB"','database_name = "rustup-stats"',
  'database_id = "9b0b533f-540a-4a25-a429-70ca8bd4e23d"',
  '[[d1_databases]]','binding = "PAYMENTS_DB"',
  'database_name = "rustup-stars-staging"',
  'database_id = "06079270-a227-466a-9991-abd4201ec5f6"',''
 ];
 return lines.join('\n');
}
async function current(token){
 const [raw,settings,schedules,deploy]=await Promise.all([
  cf(token,'/content/v2',{raw:true}),cf(token,'/settings'),
  cf(token,'/schedules'),cf(token,'/deployments')
 ]);
 const version=deploy?.deployments?.[0]?.versions?.[0]?.version_id;
 if(version!==VERSION)fail('live_version_changed');
 const source=extractCurrentLiveModule(raw);
 const config=darkConfig(settings,schedules);
 return {version,source,config,
  fingerprint:sha(source+'\n'+config+'\n'+version)};
}
export async function prepareDarkRelease(token,{verifyDir=null}={}){
 if(typeof token!=='string'||token.length<15)fail('cloudflare_auth_required');
 const snap=await current(token);
 if(verifyDir){
  const dir=await fs.realpath(path.resolve(verifyDir));
  if(!dir.startsWith(PRIVATE+path.sep))fail('untrusted_stage_folder');
  const manifest=JSON.parse(await fs.readFile(path.join(dir,'DARK-RELEASE-MANIFEST.json'),'utf8'));
  if(manifest.version!==snap.version||
     manifest.fingerprint!==snap.fingerprint||
     manifest.paymentGates==='on')
   fail('live_worker_changed_since_stage');
  const files=['worker.live-current-readonly.mjs','worker.current-stars-dark-entry.mjs',
   'wrangler.current-stars-dark.toml'];
  for(const name of files){
   const value=await fs.readFile(path.join(dir,name),'utf8');
   if(sha(value)!==manifest.files[name])fail('staged_file_changed_'+name);
  }
  const bundle=await fs.readFile(path.join(dir,'worker.current-stars-dark.bundle.js'),'utf8');
  if(bundle.length<150000||!bundle.includes('discoverVerifiedStarsRefunds')||
     !bundle.includes('trustedRubleEntitlement')||
     !bundle.includes('refDeposit')||
     !bundle.includes('runVariableStarsDeliveryQueue'))
   fail('dark_bundle_missing_new_ledger_logic');
  return {stage:dir,verified:true,liveVersion:snap.version};
 }
 const dir=path.join(PRIVATE,'dark-'+VERSION.slice(0,8)+'-'+snap.fingerprint.slice(0,10));
 await fs.mkdir(dir,{recursive:true,mode:0o700});
 const entry=[
  "import original from './worker.live-current-readonly.mjs';",
  "export {refDeposit} from './worker.live-current-readonly.mjs';",
  "import {wrapCurrentStarsWebhook} from '../../../payments/integration/telegram-stars/stars-variable-webhook-wrapper.mjs';",
  'export default wrapCurrentStarsWebhook(original);',''
 ].join('\n');
 const files={
  'worker.live-current-readonly.mjs':unwrapOnlyReviewedStarsLayer(snap.source),
  'worker.current-stars-dark-entry.mjs':entry,
  'wrangler.current-stars-dark.toml':snap.config
 };
 for(const [name,value] of Object.entries(files))
  await fs.writeFile(path.join(dir,name),value,{flag:'wx',mode:0o600});
 await fs.writeFile(path.join(dir,'DARK-RELEASE-MANIFEST.json'),JSON.stringify({
  version:snap.version,fingerprint:snap.fingerprint,paymentGates:'off',
  files:Object.fromEntries(Object.entries(files).map(([name,value])=>[name,sha(value)]))
 },null,2)+'\n',{flag:'wx',mode:0o600});
 return {stage:dir,verified:false,liveVersion:snap.version};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const mode=process.argv[2];
 prepareDarkRelease(process.env.CLOUDFLARE_API_TOKEN,{
  verifyDir:mode==='--verify'?process.argv[3]:null
 }).then(result=>console.log('RUSTUP_DARK_STAGE='+JSON.stringify(result)))
  .catch(e=>{console.error('DARK RELEASE BLOCKED:',String(e?.message||e));process.exitCode=1;});
}
