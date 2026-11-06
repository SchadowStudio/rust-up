import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webhookEntry,webhookOffConfig,extractCurrentModules}
 from './stage-current-stars-webhook-only.mjs';

const gates=['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
 'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
 'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
 'PAYMENT_WALLET_STRICT_MODE'];
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
 const next=webhookOffConfig(base);
 assert.equal(next.replace('main = "./worker.stars-webhook-only.bundle.js"',
  'main = "./worker.stars-commerce.bundle.js"'),base);
 for(const gate of gates)assert.ok(next.includes(gate+' = "false"'));
 assert.ok(next.includes('STARS_RUB_MINOR_PER_STAR_NUM = "183000"'));
 assert.ok(next.includes('STARS_RUB_MINOR_PER_STAR_DEN = "1000"'));
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
 ])assert.throws(()=>webhookOffConfig(mutated),/stars_webhook_stage_/);
});
test('garbled or missing live Worker source map fails, no source is invented',()=>{
 assert.throws(()=>extractCurrentModules(''),/stars_|owner_quote_/);
});
test('staging script has no deploy, no money writes or automatic checkout',()=>{
 const source=readFileSync(new URL('./stage-current-stars-webhook-only.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/wrangler deploy|UPDATE accounts|INSERT INTO rustup_game_paid_receipts/i);
 assert.match(source,/VERSION='d618b572/);
 assert.match(source,/ORIGINAL_SHA='dc181bc6/);
 assert.match(source,/checkOwnerQuoteSource\(raw,ORIGINAL_SHA\)/);
});
