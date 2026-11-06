// Read-only integrity preflight for the NEXT RUST UP webhook/refund Worker.
// Does not deploy, change D1 or authorize real invoices.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const PRIVATE=path.join(ROOT,'.private','rustup-bot-recovered')+path.sep;
const ORIGINAL_SHA='dc181bc6f29e8256342fa216d80c73ff9850d1443c055a9002469f8685e193dc';
export const STAGE_SOURCES=Object.freeze([
 'worker.live-compiled-original.mjs','telegram-initdata.mjs',
 'deposit-history-readonly.mjs','stars-owner-price-preview.mjs',
 'stars-history-only-wrapper.mjs','stars-variable-webhook-wrapper.mjs',
 'stars-variable-bridge.mjs','variable-stars.mjs','stars.mjs',
 'stars-payment-support.mjs',
 'payment-controls.mjs','stars-delivery-queue.mjs',
 'verified-stars-game-credit.mjs','verified-stars-game-refund.mjs',
 'freeze-verified-stars-game-quote.mjs',
 'worker.stars-webhook-only-entry.mjs'
]);
const OFF=['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
 'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
 'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
 'PAYMENT_WALLET_STRICT_MODE'];
const SHA=bytes=>createHash('sha256').update(bytes).digest('hex');
function fail(reason){throw Error('stars_refund_stage_'+reason);}
export function checkRefundSourceMap(map,sourceHashes){
 if(map?.version!==3||!Array.isArray(map.sources)||
    !Array.isArray(map.sourcesContent)||
    map.sources.length!==STAGE_SOURCES.length||
    map.sourcesContent.length!==STAGE_SOURCES.length)
  fail('source_map_count_or_format');
 const seen=new Set();
 for(let i=0;i<map.sources.length;i++){
  const name=String(map.sources[i]).split('/').pop();
  if(!STAGE_SOURCES.includes(name)||seen.has(name)||
     typeof map.sourcesContent[i]!=='string'||
     SHA(map.sourcesContent[i])!==sourceHashes[name])
   fail('altered_or_unexpected_source_'+name);
  seen.add(name);
 }
 if(STAGE_SOURCES.some(name=>!seen.has(name))||
    sourceHashes[STAGE_SOURCES[0]]!==ORIGINAL_SHA)
  fail('original_bot_or_required_module_missing');
 return {sources:seen.size,originalBotExact:true};
}
export async function verifyRefundStage(folder){
 const dir=await fs.realpath(path.resolve(folder||''));
 if(!dir.startsWith(PRIVATE))fail('untrusted_stage');
 const manifest=JSON.parse(await fs.readFile(path.join(dir,
  'RUSTUP-STARS-WEBHOOK-ONLY-STAGE.json'),'utf8'));
 if(manifest.activeVersion!=='d618b572-ae34-4ec5-9e0e-471df5cbcfe2'||
    manifest.originalSha!==ORIGINAL_SHA||manifest.paymentsEnabled!==false)
  fail('unreviewed_parent_manifest');
 const config=await fs.readFile(path.join(dir,
  'wrangler.stars-webhook-only.toml'),'utf8');
 for(const flag of OFF){
  const hits=config.split(flag+' = "false"').length-1;
  if(hits!==1)fail('paid_flag_drift_'+flag);
 }
 for(const [name,value] of [
  ['STARS_RUB_MINOR_PER_STAR_NUM','183000'],
  ['STARS_RUB_MINOR_PER_STAR_DEN','1000']
 ]){
  if(config.split(name+' = "'+value+'"').length!==2)
   fail('owner_stars_rate_changed_'+name);
 }
 if(!config.includes('binding = "DB"')||
    !config.includes('binding = "PAYMENTS_DB"')||
    !config.includes('keep_vars = true')||
    !config.includes('upload_source_maps = true'))
  fail('critical_worker_binding_missing');
 const hashes={};
 for(const name of STAGE_SOURCES)
  hashes[name]=SHA(await fs.readFile(path.join(dir,name)));
 const map=JSON.parse(await fs.readFile(path.join(dir,
  'worker.stars-webhook-only.bundle.js.map'),'utf8'));
 const review=checkRefundSourceMap(map,hashes);
 const bundle=await fs.readFile(path.join(dir,
  'worker.stars-webhook-only.bundle.js'),'utf8');
 for(const required of ['freezeVerifiedStarsGameQuote',
  'calculateRubCoinOneToOne','runVariableStarsDeliveryQueue',
  'reconcileRecordedStarsRefundBatch','handleStarsSupportCommand',
  'wrapCurrentStarsWebhook',
  'refDeposit']){
  if(!bundle.includes(required))fail('missing_compiled_behavior_'+required);
 }
 if(!bundle.includes('worker.stars-webhook-only.bundle.js.map'))
  fail('source_map_link_missing');
 return {...review,bundleSha256:SHA(bundle),
  sourceMapSha256:SHA(JSON.stringify(map)),
  paymentGatesOff:true,starsRubRate:'1.83',rubPerCoin:'1',
  deployPerformed:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==3){
  console.error('Usage: node verify-stars-refund-upgrade-stage.mjs <private-stage>');
  process.exitCode=2;
 }else verifyRefundStage(process.argv[2]).then(
  x=>console.log('PASS: '+JSON.stringify(x))
 ).catch(e=>{
  console.error('REFUND STAGE SAFETY STOP:',String(e?.message||e).slice(0,180));
  process.exitCode=1;
 });
}
