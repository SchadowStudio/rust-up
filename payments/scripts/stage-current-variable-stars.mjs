// Stage variable amount Stars routes against the EXACT CURRENT 18-module RUST UP bot.
// No live changes, no incoming funds, no game balance credits, no secrets in GitHub.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {recoverVariableSource,verifyVariableSnapshot}
 from './recover-current-stars-variable.mjs';
import {cloudflareReadOnly} from './cloudflare-readonly-recovery.mjs';
import {buildReadonlyHotfixConfig}
 from './prepare-stars-readonly-ttl.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const PRIVATE=path.join(ROOT,'.private','rustup-bot-recovered')+path.sep;
const SRC=path.join(ROOT,'payments','integration','telegram-stars');
const ACCOUNT='af72e32cb9f1ba99dba07df30fe540fe';
const FILES=['worker.stars-variable-entry.mjs','stars-variable-bridge.mjs','variable-stars.mjs'];
const BUNDLE='worker.stars-variable.bundle.js';
const CONFIG='wrangler.stars-variable.toml';
const FLAGS=['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
 'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
 'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
 'PAYMENT_WALLET_STRICT_MODE'];

export function variableStagingConfig(settings,schedules){
 let config=buildReadonlyHotfixConfig(settings,schedules);
 config=config.replace('worker.stars-readonly.bundle.js',BUNDLE);
 config=config.replace('STARS_REFUNDS_ENABLED = "false"',
  'STARS_REFUNDS_ENABLED = "false"\n'+
  'STARS_VARIABLE_TOPUP_ENABLED = "false"\n'+
  'STARS_VARIABLE_CREDIT_LEDGER_READY = "false"\n'+
  'PAYMENT_WALLET_STRICT_MODE = "false"');
 for(const flag of FLAGS)if(!config.includes(flag+' = "false"'))
   throw Error('variable_stars_unsafe_gate_'+flag);
 if(!config.includes('keep_vars = true')||
    !config.includes('upload_source_maps = true'))
   throw Error('source_recovery_config_missing');
 return config;
}
async function cloudflareJson(route,token){
 const res=await cloudflareReadOnly(
  'https://api.cloudflare.com/client/v4'+route,token
 );
 if(!res.ok)throw Error('cloudflare_metadata_http_'+res.status);
 const body=await res.json();
 if(body?.success!==true)throw Error('cloudflare_metadata_invalid');
 return body.result;
}
async function inspect(dir,token){
 const manifest=JSON.parse(await fs.readFile(path.join(dir,'RECOVERY-MANIFEST.json'),'utf8'));
 const now=await recoverVariableSource(token);
 verifyVariableSnapshot(now.source,manifest);
 const base='/accounts/'+ACCOUNT+'/workers/scripts/rustup-bot';
 const [settings,schedules]=await Promise.all([
  cloudflareJson(base+'/settings',token),cloudflareJson(base+'/schedules',token)
 ]);
 return variableStagingConfig(settings,schedules);
}
async function main(){
 const arg=process.argv[2],verify=process.argv[3]==='--check-live';
 if(!arg||process.argv.length>4||(process.argv[3]&&!verify))
   throw Error('Usage: node payments/scripts/stage-current-variable-stars.mjs "<private snapshot>" [--check-live]');
 const dir=await fs.realpath(path.resolve(arg));
 if(!dir.startsWith(PRIVATE))throw Error('snapshot_path_not_private');
 const token=process.env.CLOUDFLARE_API_TOKEN;
 if(typeof token!=='string'||token.length<15)
   throw Error('private_cloudflare_auth_missing');
 const config=await inspect(dir,token);
 const game=await fs.readFile(path.join(dir,'game.js'),'utf8');
 if(!game.includes('PAYMENT_WALLET_STRICT_MODE'))
   throw Error('current_bot_wallet_guard_missing');
 for(const name of FILES){
  const source=await fs.readFile(path.join(SRC,name),'utf8');
  if(name==='stars-variable-bridge.mjs'&&
    (!source.includes('verifiedTelegramInitData')||!source.includes('STARS_VARIABLE_CREDIT_LEDGER_READY')))
   throw Error('variable_api_authorization_missing');
  if(name==='worker.stars-variable-entry.mjs'&&
    (!source.includes('WEBHOOK_SECRET')||!source.includes('variableStarsWebhook')))
   throw Error('variable_webhook_authorization_missing');
  if(verify){
   if(source!==await fs.readFile(path.join(dir,name),'utf8'))
    throw Error('variable_source_changed_'+name);
  }
 }
 if(verify){
  if(config!==await fs.readFile(path.join(dir,CONFIG),'utf8'))
   throw Error('variable_deploy_config_changed');
  const bundle=await fs.readFile(path.join(dir,BUNDLE),'utf8');
  for(const marker of ['/api/stars/variable/','variable_stars_checkout_disabled',
    'rustup_stars_variable_orders','STARS_VARIABLE_CREDIT_LEDGER_READY']){
   if(!bundle.includes(marker))throw Error('bundle_missing_'+marker);
  }
  console.log('PASS: Live 18-module bot unchanged and variable top-up bridge staged.');
  console.log('PASS: All payment flags remain FALSE. No game credits.');
  return;
 }
 // Current 18-module bot already has the variable routes. Keep the exact
 // recovered files; refuse modified sources instead of silently overwriting.
 for(const name of FILES){
  const src=await fs.readFile(path.join(SRC,name),'utf8');
  const existing=await fs.readFile(path.join(dir,name),'utf8');
  if(src.replace(/\r\n/g,'\n')!==existing.replace(/\r\n/g,'\n'))
    throw Error('current_live_module_differs_'+name);
 }
 await fs.writeFile(path.join(dir,CONFIG),config,{flag:'wx',mode:0o600});
 console.log('PASS: User-selected RUB amount, signed Telegram quote/receipt routes staged.');
 console.log('PASS: Exact game, admin, fixed Stars, cron and D1 source preserved.');
 console.log('PASS: All payment gates OFF. NOTHING DEPLOYED.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{console.error('VARIABLE STARS STAGING BLOCKED:',e.message);process.exitCode=1;});
