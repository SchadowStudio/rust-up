import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateVariableStarsPrelaunch,inspectVariableStarsPrelaunch}
 from './variable-stars-prelaunch.mjs';

const flags=[
 'PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
 'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
 'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
 'PAYMENT_WALLET_STRICT_MODE'
];
function fixture(){
 return {
  bindings:[
   ...flags.map(name=>({name,type:'plain_text',text:'false'})),
   {name:'BOT_TOKEN',type:'secret_text'},
   {name:'WEBHOOK_SECRET',type:'secret_text'},
   {name:'DB',type:'d1',id:'9b0b533f-540a-4a25-a429-70ca8bd4e23d'},
   {name:'PAYMENTS_DB',type:'d1',id:'06079270-a227-466a-9991-abd4201ec5f6'},
   {name:'APP_URL',type:'plain_text',text:'https://ttzoomrust-hub.github.io/rust-up/'}
  ],
  paymentTables:['rustup_stars_variable_orders','rustup_payment_settings',
   'rustup_stars_refund_intents','rustup_stars_receipt_incidents'],
  gameTables:['accounts','grants'],
  controls:[{channel:'master',enabled:0},{channel:'stars',enabled:0},
   {channel:'crypto',enabled:0}],
  paymentCounts:[
   {name:'variable_orders',n:0},{name:'paid_orders',n:0},
   {name:'manual_review_orders',n:0},{name:'unresolved_refunds',n:0},
   {name:'receipt_incidents',n:0},{name:'approved_over_1h',n:0}
  ],
  gameCounts:[{name:'account_rows',n:4}],
  workerText:'telegram_payment_charge_id variable_stars_checkout_disabled RUSTUP_STRICT_ACCOUNT_IMPORT_V1',
  siteHtml:'<script src="https://telegram.org/js/telegram-web-app.js?64"></script>'+
   '<script src="js/stars-deposit-v5.js?v=20261105deposit1"></script>',
  workerVersion:'example-read-only'
 };
}
test('accepts price intentionally deferred; never converts a passing offline check to live money readiness',()=>{
 const result=evaluateVariableStarsPrelaunch(fixture());
 assert.equal(result.pricing,'DEFERRED_BY_OPERATOR');
 assert.equal(result.pricingConfigured,null);
 assert.equal(result.paymentOrGameCreditActivated,false);
 assert.equal(result.readyToAcceptRealPayments,false);
 assert.equal(result.readyExceptPricing,false);
 assert.equal(result.counts.gameAccounts,4);
 assert.ok(result.blockers.includes('game_has_payment_booking_journal_schema'));
 assert.ok(result.blockers.includes('current_worker_has_saved_invoice_precheckout_guard'));
 assert.ok(result.blockers.includes('independent_real_telegram_payment_and_refund_verified'));
 assert.ok(result.blockers.includes('production_settlement_adapter_verified'));
 assert.ok(result.checks.find(x=>x.id==='all_hard_payment_flags_off').ok);
 assert.equal(JSON.stringify(result).includes('BOT_TOKEN'),false);
});
test('state drift and unresolved refunds block safe readiness',()=>{
 const x=fixture();
 x.bindings.find(b=>b.name==='STARS_PAYMENT_ENABLED').text='true';
 x.controls.find(c=>c.channel==='master').enabled=1;
 x.paymentCounts.find(r=>r.name==='unresolved_refunds').n=2;
 const result=evaluateVariableStarsPrelaunch(x);
 for(const name of ['all_hard_payment_flags_off','all_database_payment_switches_off',
  'no_unresolved_payment_incidents'])assert.ok(result.blockers.includes(name));
 assert.equal(result.readyToAcceptRealPayments,false);
});
test('fail closed when any flag missing, counts missing, schema unknown, or D1 switch duplicated',()=>{
 const x=fixture();
 x.bindings=x.bindings.filter(b=>b.name!=='STARS_VARIABLE_TOPUP_ENABLED');
 assert.throws(()=>evaluateVariableStarsPrelaunch(x),/unknown_payment_hard_gate/);
 const y=fixture();
 y.paymentCounts.pop();
 assert.throws(()=>evaluateVariableStarsPrelaunch(y),/incomplete_payment_counts/);
 const z=fixture();
 z.controls.push({channel:'master',enabled:0});
 assert.throws(()=>evaluateVariableStarsPrelaunch(z),/unknown_payment_database_switch/);
 const w=fixture();
 w.gameCounts=[{name:'account_rows',n:'4'}];
 assert.throws(()=>evaluateVariableStarsPrelaunch(w),/unknown_game_account_count/);
});
test('a real read is impossible without private read credentials; no inference from missing token',async()=>{
 await assert.rejects(()=>inspectVariableStarsPrelaunch(''),
  /cloudflare_read_token_missing/);
});
