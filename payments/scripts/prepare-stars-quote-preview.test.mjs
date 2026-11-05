import test from 'node:test';
import assert from 'node:assert/strict';
import {buildStarsQuotePreviewConfig} from './prepare-stars-quote-preview.mjs';
import {variableStagingConfig} from './stage-current-variable-stars.mjs';
import {quoteVariableStars} from '../integration/telegram-stars/variable-stars.mjs';
const s='9b0b533f-540a-4a25-a429-70ca8bd4e23d';
const p='06079270-a227-466a-9991-abd4201ec5f6';
const flags=['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
 'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED'];
const bindings=[
 ...['BOT_TOKEN','WEBHOOK_SECRET','ADMIN_BOT_TOKEN','CLIPS_BOT_TOKEN']
  .map(name=>({name,type:'secret_text'})),
 {name:'APP_URL',type:'plain_text',text:'https://ttzoomrust-hub.github.io/rust-up/'},
 {name:'DB',type:'d1',id:s},{name:'PAYMENTS_DB',type:'d1',id:p},
 ...flags.map(name=>({name,type:'plain_text',text:'false'}))
];
const config=variableStagingConfig(
 {bindings,compatibility_date:'2025-06-01',compatibility_flags:[]},
 {schedules:[{cron:'* * * * *'}]}
);
const rate={
 STARS_MIN_RUB_MINOR:'100',
 STARS_MAX_RUB_MINOR:'100000000',
 STARS_RUB_MINOR_PER_STAR_NUM:'300',
 STARS_RUB_MINOR_PER_STAR_DEN:'1'
};
test('read-only price preview stays in current Worker and all payment gates remain OFF',()=>{
 const result=buildStarsQuotePreviewConfig(config,rate);
 for(const flag of [...flags,'STARS_VARIABLE_TOPUP_ENABLED',
  'STARS_VARIABLE_CREDIT_LEDGER_READY','PAYMENT_WALLET_STRICT_MODE']){
  assert.ok(result.includes(flag+' = "false"'));
 }
 assert.match(result,/STARS_RUB_MINOR_PER_STAR_NUM = "300"/);
 assert.match(result,/binding = "DB"/);
 assert.match(result,/binding = "PAYMENTS_DB"/);
 assert.match(result,/crons = \["\* \* \* \* \*"\]/);
 assert.match(result,/keep_vars = true/);
 assert.ok(result.includes('main = "./worker.stars-variable.bundle.js"'));
 assert.equal(quoteVariableStars(25050,rate).priceStars,84);
});
test('rejects unsafe or invented rates and amounts',()=>{
 assert.throws(()=>buildStarsQuotePreviewConfig(config,
  {...rate,STARS_RUB_MINOR_PER_STAR_NUM:'0'}),/invalid_owner_rate_integer/);
 assert.throws(()=>buildStarsQuotePreviewConfig(config,
  {...rate,STARS_MIN_RUB_MINOR:'100000001'}),/quote_amount_bounds_invalid/);
 assert.throws(()=>buildStarsQuotePreviewConfig(config,
  {...rate,STARS_MAX_RUB_MINOR:'9999999999'}),/quote_amount_bounds_invalid/);
 assert.throws(()=>buildStarsQuotePreviewConfig(config,
  {...rate,STARS_RUB_MINOR_PER_STAR_DEN:'10000000000000'}),/price_out_of_bounds/);
});
test('fails closed if anyone turns on payment flags, changes bot, removes DB',()=>{
 assert.throws(()=>buildStarsQuotePreviewConfig(config.replace(
  'PAYMENT_PRODUCTION_ENABLED = "false"','PAYMENT_PRODUCTION_ENABLED = "true"'),rate),
  /payment_gate_not_safely_off/);
 assert.throws(()=>buildStarsQuotePreviewConfig(config.replace(
  'name = "rustup-bot"','name = "other-bot"'),rate),
  /current_worker_baseline_changed/);
 assert.throws(()=>buildStarsQuotePreviewConfig(config.replace(
  'binding = "PAYMENTS_DB"','binding = "OTHER"'),rate),
  /current_worker_baseline_changed/);
});
test('never silently overwrites a rate already present',()=>{
 const first=buildStarsQuotePreviewConfig(config,rate);
 assert.throws(()=>buildStarsQuotePreviewConfig(first,rate),
  /quote_rate_already_present/);
});
