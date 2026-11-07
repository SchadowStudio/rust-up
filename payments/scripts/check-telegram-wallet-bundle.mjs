// Local, read-only safety gate before deploying Telegram Stars integration
// behind PAYMENT_PRODUCTION_ENABLED=false. Does not deploy or enable payments.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
async function main(){
 const arg=process.argv[2];
 if(!arg)throw Error('Pass recovered private RUST UP bot folder.');
 const dir=await fs.realpath(path.resolve(arg));
 if(!dir.startsWith(path.join(root,'.private','rustup-bot-recovered')+path.sep))
  throw Error('not_private_recovered_folder');
 const [compiled,config,bridge,wrapper,original,manifest]=await Promise.all([
  fs.readFile(path.join(dir,'worker.payment-admin.bundle.js'),'utf8'),
  fs.readFile(path.join(dir,'wrangler.rustup-bot.toml'),'utf8'),
  fs.readFile(path.join(dir,'stars-live-bridge.mjs'),'utf8'),
  fs.readFile(path.join(dir,'stars-existing-worker-wrapper.mjs'),'utf8'),
  fs.readFile(path.join(dir,'worker.js'),'utf8'),
  fs.readFile(path.join(dir,'RECOVERY-MANIFEST.json'),'utf8').then(JSON.parse)
 ]);
 if(compiled.length<320000||compiled.length>1200000)
  throw Error('unexpected_compiled_worker_size');
 const markers=[
  'rustup_stars_purchase_locks',
  'refundStarPayment',
  'rustup_stars_receipt_incidents',
  'handleAdminPaymentPanelApi',
  'answerPreCheckoutQuery',
  'successful_payment',
  'PAYMENT_PRODUCTION_ENABLED'
 ];
 for(const marker of markers)
  if(!compiled.includes(marker))throw Error('compiled_bundle_missing_'+marker);
 if(!bridge.includes('rustup_stars_purchase_locks')||
    !wrapper.includes('receiveExistingBotStarsUpdate'))
  throw Error('stars_adapter_missing_or_old');
 if(!original.includes('RUSTUP_PAYMENT_ADMIN_HOOK')||
    !Array.isArray(manifest.files)||manifest.files.length!==9)
  throw Error('original_bot_recovery_unverified');
 if(!['STARS_PAYMENT_ENABLED','STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED']
   .every(name=>config.includes(name+' = "false"')))
  throw Error('stars_staging_flags_must_all_be_off');
 if(!config.includes('PAYMENT_PRODUCTION_ENABLED = "false"')||
    !config.includes('binding = "PAYMENTS_DB"')||
    !config.includes('keep_vars = true')||
    !config.includes('main = "./worker.payment-admin.bundle.js"'))
  throw Error('wrangler_config_not_fail_closed');
 console.log('PASS: Bundle contains Stars receipt, invoice lock, refund and admin API modules.');
 console.log('PASS: Original bot recovery metadata and /pay hook present.');
 console.log('PASS: Wrangler still enforces PAYMENT_PRODUCTION_ENABLED=false.');
 console.log('NO REAL PAYMENTS, NO DEPLOYMENT performed by this verification.');
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)
 main().catch(e=>{console.error('Stars release verification BLOCKED:',e.message);process.exitCode=1;});
