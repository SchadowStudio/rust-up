// Prepare next RUST UP refund-aware Worker from a previously verified live stage.
// Read-only local build preparation. Absolutely no Cloudflare deploy or D1 writes.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {flattenVerifiedSettlementImport} from './stage-current-stars-webhook-only.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const PRIVATE=path.join(ROOT,'.private','rustup-bot-recovered');
const ORIGINAL=['worker.live-compiled-original.mjs','telegram-initdata.mjs',
 'deposit-history-readonly.mjs','stars-owner-price-preview.mjs',
 'stars-history-only-wrapper.mjs','worker.history-only-compiled-entry.mjs'];
const MODULES=['stars-variable-webhook-wrapper.mjs','stars-variable-bridge.mjs',
 'variable-stars.mjs','stars.mjs','payment-controls.mjs',
 'stars-delivery-queue.mjs','verified-stars-game-credit.mjs',
 'verified-stars-game-refund.mjs',
 'freeze-verified-stars-game-quote.mjs'];
const FILES=['worker.stars-webhook-only-entry.mjs',
 'wrangler.stars-webhook-only.toml'];
function refuse(reason){throw Error('refund_upgrade_prepare_'+reason);}
export async function prepareRefundUpgrade(input){
 const base=await fs.realpath(path.resolve(input));
 if(!base.startsWith(PRIVATE+path.sep))refuse('untrusted_stage');
 const manifest=JSON.parse(await fs.readFile(path.join(base,
  'RUSTUP-STARS-WEBHOOK-ONLY-STAGE.json'),'utf8'));
 if(manifest.paymentsEnabled!==false||
    manifest.activeVersion!=='d618b572-ae34-4ec5-9e0e-471df5cbcfe2'||
    manifest.originalSha!=='dc181bc6f29e8256342fa216d80c73ff9850d1443c055a9002469f8685e193dc')
  refuse('unreviewed_base');
 const config=await fs.readFile(path.join(base,FILES[1]),'utf8');
 for(const gate of ['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
  'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
  'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
  'PAYMENT_WALLET_STRICT_MODE']){
  if(!config.includes(gate+' = "false"'))refuse('money_gate_mismatch');
 }
 if(!config.includes('STARS_RUB_MINOR_PER_STAR_NUM = "183000"')||
    !config.includes('STARS_RUB_MINOR_PER_STAR_DEN = "1000"'))
  refuse('rate_mismatch');
 const target=base+'-refund-preflight';
 await fs.mkdir(target,{recursive:true,mode:0o700});
 for(const name of [...ORIGINAL,...FILES])
  await fs.copyFile(path.join(base,name),path.join(target,name));
 for(const name of MODULES){
  const account=name.startsWith('verified-stars-game-')||
   name==='freeze-verified-stars-game-quote.mjs';
  const sourcePath=path.join(ROOT,'payments','integration',
   account?'account-credit-ledger':'telegram-stars',name);
  let contents=flattenVerifiedSettlementImport(name,
   await fs.readFile(sourcePath,'utf8'));
  // Account module references another account module already copied locally.
  if(name==='verified-stars-game-refund.mjs'&&
     !contents.includes("from './verified-stars-game-credit.mjs'"))
   refuse('refund_credit_dependency_unexpected');
  await fs.writeFile(path.join(target,name),contents);
 }
 const entry=await fs.readFile(path.join(target,FILES[0]),'utf8');
 if(!entry.includes('wrapCurrentStarsWebhook(wrapHistoryOnlyWorker(original))'))
  refuse('unexpected_entry');
 console.log('STARS REFUND UPGRADE PREPARED: '+target);
 console.log('BUILD ENTRY: '+path.join(target,FILES[0]));
 console.log('CONFIG: '+path.join(target,FILES[1]));
 console.log('NOT DEPLOYED. ALL PAYMENT FLAGS OFF.');
 return target;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==3){console.error('Usage: node prepare-stars-refund-upgrade.mjs <verified-stage>');process.exitCode=2;}
 else prepareRefundUpgrade(process.argv[2]).catch(e=>{
  console.error(String(e.message).slice(0,170));process.exitCode=1;
 });
}
