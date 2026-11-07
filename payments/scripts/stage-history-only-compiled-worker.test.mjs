import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 historyOnlyCompiledEntry,historyOnlyConfig
} from './stage-history-only-compiled-worker.mjs';

const flags=['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
 'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
 'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
 'PAYMENT_WALLET_STRICT_MODE'];
function originalConfig(){
 return [
  'name = "rustup-bot"',
  'main = "./worker.stars-commerce.bundle.js"',
  'compatibility_date = "2025-06-01"',
  'keep_vars = true',
  'upload_source_maps = true',
  '[triggers]',
  'crons = ["* * * * *"]',
  '[vars]',
  ...flags.map(name=>name+' = "false"'),
  '[secrets]',
  'required = ["BOT_TOKEN", "WEBHOOK_SECRET", "ADMIN_BOT_TOKEN", "CLIPS_BOT_TOKEN"]',
  '[[d1_databases]]',
  'binding = "DB"',
  'database_id = "9b0b533f-540a-4a25-a429-70ca8bd4e23d"',
  '[[d1_databases]]',
  'binding = "PAYMENTS_DB"',
  'database_id = "06079270-a227-466a-9991-abd4201ec5f6"'
 ].join('\n');
}

test('history-only entry preserves every named original Worker export and only wraps default',()=>{
 const entry=historyOnlyCompiledEntry();
 assert.match(entry,/export \* from '.\/worker.live-compiled-original.mjs'/);
 assert.match(entry,/wrapHistoryOnlyWorker\(original\)/);
 assert.doesNotMatch(entry,/wrapExistingWorker|variableStarsApi|createInvoice/);
});

test('config changes only main file; all original DBs, cron, secrets and OFF gates remain unchanged',()=>{
 const current=originalConfig();
 const out=historyOnlyConfig(current);
 assert.equal(out.replace(
  'main = "./worker.stars-history-only.bundle.js"',
  'main = "./worker.stars-commerce.bundle.js"'),current);
 for(const name of flags)assert.match(out,new RegExp(name+' = "false"'));
});

test('any live money switch, missing DB, incorrect cron or disabled keep_vars fails closed',()=>{
 const current=originalConfig();
 for(const changed of [
  current.replace('PAYMENT_PRODUCTION_ENABLED = "false"','PAYMENT_PRODUCTION_ENABLED = "true"'),
  current.replace('STARS_PAYMENT_ENABLED = "false"','STARS_PAYMENT_ENABLED = "true"'),
  current.replace('binding = "PAYMENTS_DB"','binding = "ANOTHER_DB"'),
  current.replace('keep_vars = true','keep_vars = false'),
  current.replace('crons = ["* * * * *"]','crons = []'),
  current.replace('main = "./worker.stars-commerce.bundle.js"','main = "./another-bundle.js"')
 ]){
  assert.throws(()=>historyOnlyConfig(changed),/unsafe|not_off/);
 }
});

test('stager never contains a production Wrangler publish command or writes game balances',()=>{
 const code=readFileSync(new URL('./stage-history-only-compiled-worker.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(code,/wrangler\s+deploy(?!\s+--dry-run)|UPDATE\s+accounts|INSERT INTO\s+rustup_game_paid_receipts/i);
 assert.match(code,/extractReviewedCompiledWorker/);
 assert.match(code,/liveMetadataFingerprint/);
 assert.match(code,/scriptEtag/);
});
