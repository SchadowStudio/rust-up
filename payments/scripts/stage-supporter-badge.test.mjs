import test from 'node:test';
import assert from 'node:assert/strict';
import {verifySupporterReleaseConfig} from './stage-supporter-badge.mjs';

const flags=['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
 'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
 'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
 'PAYMENT_WALLET_STRICT_MODE'];
const config=[
 '# current RUST UP exact bot, private restored source',
 'name = "rustup-bot"',
 'main = "./worker.stars-variable.bundle.js"',
 'keep_vars = true',
 'upload_source_maps = true',
 '[triggers]',
 'crons = ["* * * * *"]',
 '[vars]',
 ...flags.map(x=>x+' = "false"'),
 '[secrets]',
 'required = ["BOT_TOKEN","WEBHOOK_SECRET"]',
 '[[d1_databases]]','binding = "DB"','database_name = "rustup-stats"',
 '[[d1_databases]]','binding = "PAYMENTS_DB"','database_name = "rustup-stars-staging"'
].join('\n');
test('badge dark-release preserves bot, two databases, cron and seven OFF gates',()=>{
 assert.equal(verifySupporterReleaseConfig(config),true);
 for(const flag of flags)
  assert.throws(()=>verifySupporterReleaseConfig(
   config.replace(flag+' = "false"',flag+' = "true"')),
   /unsafe_payment_gate/);
});
test('badge stage refuses changed source or wrong worker bindings',()=>{
 for(const [a,b] of [
  ['name = "rustup-bot"','name = "other"'],
  ['binding = "PAYMENTS_DB"','binding = "GAME_DB"'],
  ['main = "./worker.stars-variable.bundle.js"','main = "./other.js"'],
  ['crons = ["* * * * *"]','crons = ["0 * * * *"]']
 ])assert.throws(()=>verifySupporterReleaseConfig(config.replace(a,b)));
});
