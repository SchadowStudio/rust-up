import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {quoteOwnerConfig} from './stage-current-stars-owner-quote.mjs';
const rate=JSON.parse(readFileSync(
 new URL('../stars-owner-rate.json',import.meta.url),'utf8'));
const flagNames=['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
 'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
 'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
 'PAYMENT_WALLET_STRICT_MODE'];
const sample=[
 'name = "rustup-bot"',
 'main = "./worker.stars-commerce.bundle.js"',
 'keep_vars = true',
 'upload_source_maps = true',
 '[triggers]',
 'crons = ["* * * * *"]',
 '[vars]',
 ...flagNames.map(x=>x+' = "false"'),
 '[secrets]',
 'required = ["BOT_TOKEN","WEBHOOK_SECRET"]',
 '[[d1_databases]]',
 'binding = "DB"',
 '[[d1_databases]]',
 'binding = "PAYMENTS_DB"'
].join('\n');

test('staged rate must equal owner-selected 1.83 RUB exactly and all money gates remain OFF',()=>{
 const config=quoteOwnerConfig(sample,rate);
 assert.match(config,/STARS_RUB_MINOR_PER_STAR_NUM = "183000"/);
 assert.match(config,/STARS_RUB_MINOR_PER_STAR_DEN = "1000"/);
 assert.match(config,/STARS_MAX_RUB_MINOR = "100000000"/);
 assert.match(config,/main = "\.\/worker.stars-owner-quote.bundle.js"/);
 for(const flag of flagNames)
  assert.ok(config.includes(flag+' = "false"'));
 assert.ok(config.includes('keep_vars = true'));
 assert.ok(config.includes('binding = "DB"'));
 assert.ok(config.includes('binding = "PAYMENTS_DB"'));
});
test('refuse unexpected owner rate, missing money OFF gates and already present live price',()=>{
 for(const changed of [
  {...rate,operatorApproved:false},
  {...rate,rubPerStarDecimal:'1.87159'},
  {...rate,STARS_RUB_MINOR_PER_STAR_NUM:'183001'},
  {...rate,STARS_RUB_MINOR_PER_STAR_DEN:'1'}
 ])assert.throws(()=>quoteOwnerConfig(sample,changed),/operator_rate_not_exact/);
 for(const changed of [
  sample.replace('STARS_PAYMENT_ENABLED = "false"','STARS_PAYMENT_ENABLED = "true"'),
  sample.replace('binding = "DB"','binding = "BAD"'),
  sample.replace('main = "./worker.stars-commerce.bundle.js"','main = "wrong.js"'),
  sample.replace('crons = ["* * * * *"]','crons = []')
 ])assert.throws(()=>quoteOwnerConfig(changed,rate),/unsafe_live_baseline|money_gate_not_off/);
 assert.throws(()=>quoteOwnerConfig(sample.replace(
  '[secrets]','STARS_RUB_MINOR_PER_STAR_NUM = "183000"\n[secrets]'),rate),
  /live_price_already_present/);
});
test('stager never deploys, writes to game DB or enables real payments',()=>{
 const code=readFileSync(new URL('./stage-current-stars-owner-quote.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(code,/wrangler deploy|UPDATE accounts|INSERT INTO rustup_game_paid_receipts/);
 assert.match(code,/EXPECTED_VERSION='b2b449e1/);
 assert.match(code,/ORIGINAL_SHA='dc181bc6/);
 assert.match(code,/inspectDeployedHistorySource\(raw,ORIGINAL_SHA\)/);
});
