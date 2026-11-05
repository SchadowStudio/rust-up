// Prepare the complete Telegram Stars fixed-goods adapter against the EXACT
// currently deployed 12-module RUST UP Worker. Never deploy from this file.
// Uses the original game/admin/webhook/cron unchanged, and keeps money flags OFF.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {recoverReadonlySource,verifyReadonlySnapshot}
 from './recover-current-stars-readonly.mjs';
import {buildReadonlyHotfixConfig}
 from './prepare-stars-readonly-ttl.mjs';
import {patchGameInitialImport}
 from '../integration/existing-game-state-sandbox/strict-first-login-guard.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const PRIVATE=path.join(ROOT,'.private','rustup-bot-recovered')+path.sep;
const SRC=path.join(ROOT,'payments','integration','telegram-stars');
const ACCOUNT='af72e32cb9f1ba99dba07df30fe540fe';
const FILES=[
 'worker.stars-commerce-entry.mjs',
 'stars-existing-worker-wrapper.mjs',
 'stars-live-bridge.mjs',
 'payment-controls.mjs',
 'refunds.mjs',
 'stars.mjs'
];
const PAY_FLAGS=[
 'PAYMENT_PRODUCTION_ENABLED',
 'STARS_PAYMENT_ENABLED',
 'STARS_FIXED_PRODUCTS_ENABLED',
 'STARS_REFUNDS_ENABLED'
];
const CONFIG='wrangler.stars-commerce.toml';
const BUNDLE='worker.stars-commerce.bundle.js';

export function commerceConfig(settings,schedules){
 const old=buildReadonlyHotfixConfig(settings,schedules);
 const name='worker.stars-readonly.bundle.js';
 if(old.split(name).length!==2)throw Error('unexpected_readonly_config');
 const output=old.replace(name,BUNDLE)
  .replace('PRIVATE RUST UP 24h read-only Stars auth hotfix',
           'PRIVATE RUST UP fixed-goods checkout release STAGED IN OFF MODE')
  .replace('PAYMENT_PRODUCTION_ENABLED = "false"',
           'PAYMENT_PRODUCTION_ENABLED = "false"\nPAYMENT_WALLET_STRICT_MODE = "false"');
 if(PAY_FLAGS.some(flag=>!output.includes(flag+' = "false"')))
   throw Error('commerce_payment_gate_must_remain_off');
 if(!output.includes('keep_vars = true')||!output.includes('upload_source_maps = true'))
   throw Error('commerce_config_lacks_recovery');
 if(!output.includes('PAYMENT_WALLET_STRICT_MODE = "false"'))
   throw Error('commerce_strict_wallet_gate_must_start_off');
 return output;
}
function checkAdapter(name,source){
 if(typeof source!=='string'||source.length<100||source.length>150000)
   throw Error('invalid_commerce_adapter_'+name);
 if(name==='worker.stars-commerce-entry.mjs'&&!source.includes('wrapExistingWorker(base)'))
   throw Error('missing_original_bot_wrapper');
 if(name==='stars-existing-worker-wrapper.mjs' &&
    (!source.includes("url.pathname==='/tg'")||
     !source.includes('X-Telegram-Bot-Api-Secret-Token')||
     !source.includes('receiveStars')))
   throw Error('missing_webhook_protection');
 if(name==='stars-live-bridge.mjs'&&
    (!source.includes("'/api/stars/checkout'")||
     !source.includes('stars_invoice_link_not_persisted')||
     !source.includes('prior_stars_payment_requires_reconciliation')||
     !source.includes('Date.now(),maxAgeSeconds')))
   throw Error('missing_stars_replay_protection');
 if(name==='refunds.mjs'&&!source.includes('refundStarPayment'))
   throw Error('refund_handler_missing');
}
async function cloudflareJson(pathname,token){
 const r=await fetch('https://api.cloudflare.com/client/v4'+pathname,{
  headers:{authorization:'Bearer '+token},
  redirect:'error',signal:AbortSignal.timeout(25000)
 });
 if(!r.ok)throw Error('cloudflare_metadata_http_'+r.status);
 const data=await r.json();
 if(data?.success!==true)throw Error('cloudflare_metadata_invalid');
 return data.result;
}
async function inspect(dir,token){
 const manifest=JSON.parse(await fs.readFile(path.join(dir,'RECOVERY-MANIFEST.json'),'utf8'));
 const current=await recoverReadonlySource(token);
 verifyReadonlySnapshot(current.source,manifest);
 const base='/accounts/'+ACCOUNT+'/workers/scripts/rustup-bot';
 const [settings,schedules]=await Promise.all([
  cloudflareJson(base+'/settings',token),
  cloudflareJson(base+'/schedules',token)
 ]);
 return commerceConfig(settings,schedules);
}
async function main(){
 const arg=process.argv[2],check=process.argv[3]==='--check-live';
 if(!arg||process.argv.length>4||(process.argv[3]&&!check))
   throw Error('Usage: node payments/scripts/stage-current-stars-commerce.mjs "<private recovered bot>" [--check-live]');
 const dir=await fs.realpath(path.resolve(arg));
 if(!dir.startsWith(PRIVATE))throw Error('unsafe_recovery_path');
 const token=process.env.CLOUDFLARE_API_TOKEN;
 if(typeof token!=='string'||token.length<15)throw Error('cloudflare_login_missing');
 const config=await inspect(dir,token);
 // During final verification the local game.js is already guarded; always
 // recompute expected changes from the original snapshot, never patch twice.
 const liveGame=await fs.readFile(path.join(dir,check?
   'game.before-payment-guard.js':'game.js'),'utf8');
 const guardedGame=patchGameInitialImport(liveGame);
 if(guardedGame===liveGame)throw Error('game_source_already_modified');
 for(const name of FILES){
  const content=await fs.readFile(path.join(SRC,name),'utf8');
  checkAdapter(name,content);
  if(check){
   const staged=await fs.readFile(path.join(dir,name),'utf8');
   if(staged!==content)throw Error('commerce_source_changed_'+name);
  }
 }
 const configPath=path.join(dir,CONFIG);
 if(check){
  if(await fs.readFile(configPath,'utf8')!==config)throw Error('commerce_config_changed');
  const localGame=await fs.readFile(path.join(dir,'game.js'),'utf8');
  const originalGame=await fs.readFile(path.join(dir,'game.before-payment-guard.js'),'utf8');
  if(patchGameInitialImport(originalGame)!==localGame)
    throw Error('strict_wallet_game_guard_changed');
  const bundle=await fs.readFile(path.join(dir,BUNDLE),'utf8');
  for(const marker of ['wrapExistingWorker','stars_invoice_already_active','refundStarPayment',
    'stars_checkout_disabled','PAYMENT_WALLET_STRICT_MODE']){
   if(!bundle.includes(marker))throw Error('commerce_bundle_missing_'+marker);
  }
  console.log('PASS: Exact current 12-module live bot unchanged.');
  console.log('PASS: Full Stars fixed-goods checkout, webhook, refund wrapper staged with all payment flags OFF.');
  return;
 }
 for(const name of FILES)await fs.copyFile(path.join(SRC,name),path.join(dir,name),fs.constants.COPYFILE_EXCL);
 await fs.writeFile(path.join(dir,'game.before-payment-guard.js'),liveGame,{flag:'wx',mode:0o600});
 await fs.writeFile(path.join(dir,'game.js'),guardedGame);
 await fs.writeFile(configPath,config,{flag:'wx',mode:0o600});
 console.log('PASS: Original live game, admin and bot source verified without modifications.');
 console.log('PASS: Stars invoice/precheckout/receipt/refund adapter staged in private directory.');
 console.log('PASS: First-login paid-wallet integrity guard included but strict mode OFF by default.');
 console.log('PASS: All four payment gates remain OFF; NOTHING DEPLOYED.');
 console.log('Private entry: '+path.join(dir,'worker.stars-commerce-entry.mjs'));
 console.log('Private config: '+configPath);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{console.error('STARS COMMERCE STAGING BLOCKED:',e.message);process.exitCode=1;});
