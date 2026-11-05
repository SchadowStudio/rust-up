// Exact-source, fail-closed 24h read-only Telegram session hotfix.
// Stages source ONLY; it does not deploy, modify money, or publish bot secrets.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {recoverReadonlySource,verifyReadonlySnapshot}
 from './recover-current-stars-readonly.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const PRIVATE=path.join(ROOT,'.private','rustup-bot-recovered')+path.sep;
const SRC=path.join(ROOT,'payments','integration','telegram-stars');
const STATS='9b0b533f-540a-4a25-a429-70ca8bd4e23d';
const STARS='06079270-a227-466a-9991-abd4201ec5f6';

const OLD_HEAD='export async function verifiedTelegramInitData(raw,botToken,now=Date.now()) {';
const NEW_HEAD=[
 'export async function verifiedTelegramInitData(raw,botToken,now=Date.now(),maxAgeSeconds=600) {',
 '  // Short-lived by default for payment-sensitive callers. Explicit 24h maximum',
 '  // is allowed ONLY for a separate read-only endpoint with checkout disabled.',
 '  if(!Number.isSafeInteger(maxAgeSeconds)||maxAgeSeconds<60||',
 '     maxAgeSeconds>86400)',
 "    throw Error('invalid_telegram_auth_max_age');"
].join('\n');
const OLD_EXP="    authDate<current-600) throw Error('expired_telegram_auth');";
const NEW_EXP="    authDate<current-maxAgeSeconds) throw Error('expired_telegram_auth');";
const OLD_CALL='  try {user=await verifiedTelegramInitData(body?.initData,env?.BOT_TOKEN);}';
const NEW_CALL=[
 '  // Read-only catalogue/history permits a signed Telegram session up to 24h.',
 "  // Payment-sensitive callers still use the validator's 10-minute default.",
 '  try {user=await verifiedTelegramInitData(body?.initData,env?.BOT_TOKEN,Date.now(),86400);}'
].join('\n');

function once(source,find,replacement){
 const at=source.indexOf(find);
 if(at<0||source.indexOf(find,at+find.length)!==-1)throw Error('unexpected_readonly_source_anchor');
 return source.slice(0,at)+replacement+source.slice(at+find.length);
}
export function verifyAndPatchSources(originalValidator,originalApi,updatedValidator,updatedApi){
 if(originalValidator!==once(once(updatedValidator,NEW_HEAD,OLD_HEAD),NEW_EXP,OLD_EXP))
   throw Error('deployed_validator_drift');
 if(originalApi!==once(updatedApi,NEW_CALL,OLD_CALL))
   throw Error('deployed_stars_api_drift');
 if(updatedValidator===originalValidator||updatedApi===originalApi)
   throw Error('missing_required_ttl_fix');
 return {validator:updatedValidator,api:updatedApi};
}
export function buildReadonlyHotfixConfig(settings,schedules){
 const b=settings?.bindings;
 if(!Array.isArray(b)||settings.compatibility_date!=='2025-06-01'||
    (settings.compatibility_flags||[]).length)
   throw Error('unexpected_live_worker_configuration');
 const byName=new Map(b.map(x=>[x.name,x]));
 for(const name of ['BOT_TOKEN','WEBHOOK_SECRET','ADMIN_BOT_TOKEN','CLIPS_BOT_TOKEN'])
   if(byName.get(name)?.type!=='secret_text')throw Error('bot_secret_missing_'+name);
 if(byName.get('DB')?.type!=='d1'||(byName.get('DB').id||byName.get('DB').database_id)!==STATS)
   throw Error('existing_game_db_mismatch');
 if(byName.get('PAYMENTS_DB')?.type!=='d1'||
    (byName.get('PAYMENTS_DB').id||byName.get('PAYMENTS_DB').database_id)!==STARS)
   throw Error('existing_stars_db_mismatch');
 for(const flag of ['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
   'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED'])
   if(byName.get(flag)?.type!=='plain_text'||byName.get(flag)?.text!=='false')
     throw Error('payment_gate_must_remain_disabled_'+flag);
 const origin=byName.get('APP_URL')?.text;
 if(origin!=='https://ttzoomrust-hub.github.io/rust-up/')
   throw Error('miniapp_origin_drift');
 const crons=(schedules?.schedules||[]).map(x=>x.cron);
 if(crons.length!==1||crons[0]!=='* * * * *')throw Error('live_cron_changed');
 return [
  '# PRIVATE RUST UP 24h read-only Stars auth hotfix, never commit this file.',
  'name = "rustup-bot"',
  'main = "./worker.stars-readonly.bundle.js"',
  'compatibility_date = "2025-06-01"',
  'workers_dev = true',
  'keep_vars = true',
  'upload_source_maps = true',
  '',
  '[triggers]',
  'crons = ["* * * * *"]',
  '',
  '[vars]',
  'PAYMENT_PRODUCTION_ENABLED = "false"',
  'STARS_PAYMENT_ENABLED = "false"',
  'STARS_FIXED_PRODUCTS_ENABLED = "false"',
  'STARS_REFUNDS_ENABLED = "false"',
  '',
  '[secrets]',
  'required = ["BOT_TOKEN", "WEBHOOK_SECRET", "ADMIN_BOT_TOKEN", "CLIPS_BOT_TOKEN"]',
  '',
  '[[d1_databases]]',
  'binding = "DB"',
  'database_name = "rustup-stats"',
  'database_id = "'+STATS+'"',
  '',
  '[[d1_databases]]',
  'binding = "PAYMENTS_DB"',
  'database_name = "rustup-stars-staging"',
  'database_id = "'+STARS+'"',
  ''
 ].join('\n');
}
async function api(pathname,token){
 const response=await fetch('https://api.cloudflare.com/client/v4'+pathname,{
  headers:{authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(25000)
 });
 if(!response.ok)throw Error('cloudflare_config_fetch_'+response.status);
 const data=await response.json();
 if(data.success!==true)throw Error('cloudflare_config_query_failed');
 return data.result;
}
async function inspect(dir,token){
 const manifest=JSON.parse(await fs.readFile(path.join(dir,'RECOVERY-MANIFEST.json'),'utf8'));
 const current=await recoverReadonlySource(token);
 verifyReadonlySnapshot(current.source,manifest);
 const base='/accounts/af72e32cb9f1ba99dba07df30fe540fe/workers/scripts/rustup-bot';
 const [settings,schedules]=await Promise.all([
  api(base+'/settings',token),api(base+'/schedules',token)
 ]);
 return buildReadonlyHotfixConfig(settings,schedules);
}
async function main(){
 const dirArg=process.argv[2],check=process.argv[3]==='--check-live';
 if(!dirArg||process.argv.length>4||(process.argv[3]&&!check))
   throw Error('Usage: node payments/scripts/prepare-stars-readonly-ttl.mjs "<current recovered worker folder>" [--check-live]');
 const dir=await fs.realpath(path.resolve(dirArg));
 if(!dir.startsWith(PRIVATE))throw Error('not_private_recovery_folder');
 const token=process.env.CLOUDFLARE_API_TOKEN;
 if(typeof token!=='string'||token.length<15)throw Error('cloudflare_login_missing');
 const config=await inspect(dir,token);
 const localValidator=await fs.readFile(path.join(dir,'telegram-initdata.mjs'),'utf8');
 const localApi=await fs.readFile(path.join(dir,'stars-readonly-live.mjs'),'utf8');
 const expectedValidator=await fs.readFile(path.join(SRC,'telegram-initdata.mjs'),'utf8');
 const expectedApi=await fs.readFile(path.join(SRC,'stars-readonly-live.mjs'),'utf8');
 const configFile=path.join(dir,'wrangler.stars-readonly-ttl.toml');
 const validated=verifyAndPatchSources(
   check?once(once(localValidator,NEW_HEAD,OLD_HEAD),NEW_EXP,OLD_EXP):localValidator,
   check?once(localApi,NEW_CALL,OLD_CALL):localApi,
   expectedValidator,expectedApi
 );
 if(check){
   if(localValidator!==validated.validator||localApi!==validated.api)
     throw Error('staged_source_mismatch');
   if(await fs.readFile(configFile,'utf8')!==config)throw Error('staged_wrangler_config_changed');
   const bundle=await fs.readFile(path.join(dir,'worker.stars-readonly.bundle.js'),'utf8');
   if(!bundle.includes('rustup-stars-readonly')||
      !bundle.includes('stars_checkout_disabled')||
      !bundle.includes('/api/game')||!bundle.includes('86400'))
     throw Error('compiled_bundle_incorrect');
   console.log('PASS: Current live Worker unchanged since snapshot.');
   console.log('PASS: Read-only TTL 24h, payment TTL default 10m, games/cron preserved.');
   return;
 }
 await fs.writeFile(path.join(dir,'telegram-initdata.mjs'),validated.validator);
 await fs.writeFile(path.join(dir,'stars-readonly-live.mjs'),validated.api);
 await fs.writeFile(configFile,config,{flag:'wx',mode:0o600});
 console.log('PASS: Current 12-module live Worker matches exact private snapshot.');
 console.log('PASS: Only two Stars authentication modules patched for read-only 24h TTL.');
 console.log('PASS: Existing bot, games, admin, D1, cron unchanged; payment gates OFF.');
 console.log('NOT DEPLOYED.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{console.error('STARS TTL HOTFIX BLOCKED:',e.message);process.exitCode=1;});
