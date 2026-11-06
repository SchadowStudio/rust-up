import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webhookEntry,webhookOffConfig,extractCurrentModules,verifyLiveStarsOwnerRate,flattenVerifiedSettlementImport}
 from './stage-current-stars-webhook-only.mjs';

const gates=['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
 'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
 'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
 'PAYMENT_WALLET_STRICT_MODE'];
const expectedRate=[
 ['STARS_MIN_RUB_MINOR','100'],
 ['STARS_MAX_RUB_MINOR','100000000'],
 ['STARS_RUB_MINOR_PER_STAR_NUM','183000'],
 ['STARS_RUB_MINOR_PER_STAR_DEN','1000']
];
const liveBindings=expectedRate.map(([name,text])=>({
 name,type:'plain_text',text
}));
const base=[
 'name = "rustup-bot"',
 'main = "./worker.stars-commerce.bundle.js"',
 'keep_vars = true',
 'upload_source_maps = true',
 '[triggers]',
 'crons = ["* * * * *"]',
 '[vars]',
 ...gates.map(x=>x+' = "false"'),
 'STARS_MIN_RUB_MINOR = "100"',
 'STARS_MAX_RUB_MINOR = "100000000"',
 'STARS_RUB_MINOR_PER_STAR_NUM = "183000"',
 'STARS_RUB_MINOR_PER_STAR_DEN = "1000"',
 '[secrets]',
 'required = ["BOT_TOKEN", "WEBHOOK_SECRET", "ADMIN_BOT_TOKEN", "CLIPS_BOT_TOKEN"]',
 '[[d1_databases]]',
 'binding = "DB"',
 '[[d1_databases]]',
 'binding = "PAYMENTS_DB"'
].join('\n');

test('new current webhook-only entry preserves all original exports, history and quote',()=>{
 const entry=webhookEntry();
 assert.match(entry,/export \* from '.\/worker.live-compiled-original.mjs'/);
 assert.match(entry,/wrapCurrentStarsWebhook\(wrapHistoryOnlyWorker\(original\)\)/);
 assert.doesNotMatch(entry,/deliverVerifiedVariableStarsCredit|settlement_enabled/);
});
test('staged config keeps current 1.83 price, both D1 and all real-money flags OFF',()=>{
 const next=webhookOffConfig(base,liveBindings);
 assert.equal(next.replace('main = "./worker.stars-webhook-only.bundle.js"',
  'main = "./worker.stars-commerce.bundle.js"'),base);
 for(const gate of gates)assert.ok(next.includes(gate+' = "false"'));
 assert.ok(next.includes('STARS_RUB_MINOR_PER_STAR_NUM = "183000"'));
 assert.ok(next.includes('STARS_RUB_MINOR_PER_STAR_DEN = "1000"'));
});
test('generic recovery TOML omits rate vars; add only the exact four reviewed Cloudflare values',()=>{
 const generic=base.split('\n').filter(line=>
  !expectedRate.some(([name])=>line.startsWith(name+' = '))).join('\n');
 assert.ok(verifyLiveStarsOwnerRate(liveBindings));
 const staged=webhookOffConfig(generic,liveBindings);
 for(const [name,value] of expectedRate)
  assert.ok(staged.includes(name+' = "'+value+'"'));
 assert.equal(staged.split('STARS_RUB_MINOR_PER_STAR_NUM = "183000"').length,2);
 assert.equal(staged.split('[secrets]').length,2);
});
test('never reconstruct an unverified price or overwrite a changed rate',()=>{
 const generic=base.split('\n').filter(line=>
  !expectedRate.some(([name])=>line.startsWith(name+' = '))).join('\n');
 for(const missing of expectedRate){
  assert.throws(()=>webhookOffConfig(generic,liveBindings.filter(b=>b.name!==missing[0])),
   /live_owner_rate_mismatch/);
 }
 const changed=liveBindings.map(b=>({...b}));
 changed[0].text='101';
 assert.throws(()=>webhookOffConfig(generic,changed),/live_owner_rate_mismatch/);
 assert.throws(()=>webhookOffConfig(base.replace(
  'STARS_MIN_RUB_MINOR = "100"','STARS_MIN_RUB_MINOR = "101"'),liveBindings),
  /price_config_override_mismatch/);
 assert.throws(()=>webhookOffConfig(generic),/live_rate_bindings_missing/);
});
test('altered price, toggled gate, missing cron or wrong D1 refuses a build',()=>{
 for(const mutated of [
  base.replace('STARS_PAYMENT_ENABLED = "false"',
   'STARS_PAYMENT_ENABLED = "true"'),
  base.replace('STARS_RUB_MINOR_PER_STAR_NUM = "183000"',
   'STARS_RUB_MINOR_PER_STAR_NUM = "184000"'),
  base.replace('binding = "PAYMENTS_DB"','binding = "ALT"'),
  base.replace('crons = ["* * * * *"]','crons = []'),
  base.replace('keep_vars = true','keep_vars = false')
 ])assert.throws(()=>webhookOffConfig(mutated,liveBindings),/stars_webhook_stage_/);
});
test('garbled or missing live Worker source map fails, no source is invented',()=>{
 assert.throws(()=>extractCurrentModules(''),/stars_|owner_quote_/);
});
test('private Worker recovery safely flattens reviewed settlement and refund imports',()=>{
 const queue=readFileSync(new URL('../integration/telegram-stars/stars-delivery-queue.mjs',import.meta.url),'utf8');
 const credit=readFileSync(new URL('../integration/account-credit-ledger/verified-stars-game-credit.mjs',import.meta.url),'utf8');
 const stagedQueue=flattenVerifiedSettlementImport('stars-delivery-queue.mjs',queue);
 const stagedCredit=flattenVerifiedSettlementImport('verified-stars-game-credit.mjs',credit);
 assert.ok(stagedQueue.includes("from './verified-stars-game-credit.mjs'"));
 assert.ok(stagedCredit.includes("from './stars.mjs'"));
 const wrapper=readFileSync(new URL('../integration/telegram-stars/stars-variable-webhook-wrapper.mjs',import.meta.url),'utf8');
 const refund=readFileSync(new URL('../integration/account-credit-ledger/verified-stars-game-refund.mjs',import.meta.url),'utf8');
 assert.ok(flattenVerifiedSettlementImport('stars-variable-webhook-wrapper.mjs',wrapper)
  .includes("from './verified-stars-game-refund.mjs'"));
 assert.ok(flattenVerifiedSettlementImport('stars-variable-webhook-wrapper.mjs',wrapper)
  .includes("from './trusted-rub-usd.mjs'"));
 assert.ok(flattenVerifiedSettlementImport('stars-variable-webhook-wrapper.mjs',wrapper)
  .includes("from './freeze-verified-stars-game-quote.mjs'"));
 assert.ok(flattenVerifiedSettlementImport('verified-stars-game-refund.mjs',refund)
  .includes("from './stars.mjs'"));
 assert.doesNotMatch(stagedQueue,/from '\.\.\/account-credit-ledger\//);
 assert.doesNotMatch(stagedCredit,/from '\.\.\/telegram-stars\//);
 assert.equal(flattenVerifiedSettlementImport('payment-controls.mjs','original'),
  'original');
 assert.throws(()=>flattenVerifiedSettlementImport('stars-delivery-queue.mjs','unrelated'),
  /unexpected_paid_credit_import_layout/);
});
test('staging script has no deploy, no money writes or automatic checkout',()=>{
 const source=readFileSync(new URL('./stage-current-stars-webhook-only.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/wrangler deploy|UPDATE accounts|INSERT INTO rustup_game_paid_receipts/i);
 assert.match(source,/VERSION='d618b572/);
 assert.match(source,/ORIGINAL_SHA='dc181bc6/);
 assert.match(source,/checkOwnerQuoteSource\(raw,ORIGINAL_SHA\)/);
});

test('refund upgrade always copies the reviewed parent manifest for release verification',()=>{
 const source=readFileSync(new URL('./prepare-stars-refund-upgrade.mjs',import.meta.url),'utf8');
 assert.match(source,/const FILES=\[[\s\S]*?'RUSTUP-STARS-WEBHOOK-ONLY-STAGE\.json'/);
 assert.match(source,/for\(const name of \[\.\.\.ORIGINAL,\.\.\.FILES\]\)/);
 assert.match(source,/fs\.copyFile\(path\.join\(base,name\),path\.join\(target,name\)\)/);
});

test('deployed Worker verification uses old 15-module snapshot and next build uses 16',async()=>{
 const {STAGE_SOURCES,DEPLOYED_SOURCES}=await import('./verify-stars-refund-upgrade-stage.mjs');
 assert.equal(STAGE_SOURCES.length,16);
 assert.equal(DEPLOYED_SOURCES.length,15);
 assert.ok(STAGE_SOURCES.includes('stars-payment-support.mjs'));
 assert.ok(!DEPLOYED_SOURCES.includes('stars-payment-support.mjs'));
 const verifier=readFileSync(new URL('./verify-stars-refund-upgrade-live.mjs',import.meta.url),'utf8');
 assert.match(verifier,/deployedBaseline:phase==='deployed'/);
 assert.match(verifier,/phase==='deployed'\?DEPLOYED_SOURCES:STAGE_SOURCES/);
});
