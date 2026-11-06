import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateStarsActivation,parseLiveSourceNames} from './check-stars-activation.mjs';
const STATS='9b0b533f-540a-4a25-a429-70ca8bd4e23d';
const PAYMENTS='06079270-a227-466a-9991-abd4201ec5f6';
const flags=[
 'PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
 'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
 'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
 'PAYMENT_WALLET_STRICT_MODE'
];
const settlementFlags=['STARS_GAME_CREDIT_SETTLEMENT_ENABLED',
 'STARS_GAME_CREDIT_REFUND_RECONCILIATION_ENABLED'];
const gameTables=['rustup_game_paid_receipts','rustup_game_paid_refunds',
 'rustup_game_paid_release_control'];
const gameTriggers=['rustup_game_paid_receipts_preflight',
 'rustup_game_paid_receipts_apply','rustup_game_paid_refunds_preflight',
 'rustup_game_paid_refunds_verify','rustup_game_paid_refunds_apply'];
const gameGate={enabled:0,approval_reference:null,reviewed_at_ms:null};
const variables=[
 'STARS_MIN_RUB_MINOR','STARS_MAX_RUB_MINOR',
 'STARS_RUB_MINOR_PER_STAR_NUM','STARS_RUB_MINOR_PER_STAR_DEN'
];
const knownSources=[
 'stars-variable-bridge.mjs','variable-stars.mjs',
 'worker.stars-variable-entry.mjs'
];
const tables=['rustup_stars_variable_orders','rustup_payment_settings',
 'rustup_stars_variable_credit_quotes','rustup_stars_variable_delivery_jobs',
 'rustup_stars_refund_reconciliation_done'];
function settings(withQuote=false){
 const bindings=[
  {name:'DB',type:'d1',id:STATS},
  {name:'PAYMENTS_DB',type:'d1',id:PAYMENTS},
  {name:'APP_URL',type:'plain_text',
   text:'https://ttzoomrust-hub.github.io/rust-up/'},
  {name:'BOT_TOKEN',type:'secret_text'},
  {name:'WEBHOOK_SECRET',type:'secret_text'},
  ...flags.map(name=>({name,type:'plain_text',text:'false'})),
  ...settlementFlags.map(name=>({name,type:'plain_text',text:'false'}))
 ];
 if(withQuote){
  const nums=['100','100000000','300','1'];
  for(let i=0;i<4;i++)
   bindings.push({name:variables[i],type:'plain_text',text:nums[i]});
 }
 return {bindings};
}
function audit(override={}){
 return evaluateStarsActivation({
  settings:settings(),tables,sourceNames:knownSources,
  gameTables,gameTriggers,gameGate,
  liveVersion:'test-version',...override
 });
}
test('audit reports live payments disabled and missing operator pricing',()=>{
 const result=audit();
 assert.equal(result.safeCurrentMode,true);
 assert.equal(result.realPaymentActivationReady,false);
 assert.equal(result.pricePreviewReady,false);
 assert.equal(result.gameCreditConnected,false);
 assert.ok(result.blockers.includes('price_preview'));
 assert.ok(result.blockers.includes(
  'non_wagerable_digital_entitlement_delivery_not_verified'));
 assert.ok(!JSON.stringify(result).includes('BOT_TOKEN'));
 assert.equal(result.liveVersion,'test-version');
 assert.deepEqual(result.actionsPerformed,[
  'READ_CONFIGURATION','READ_SCHEMA','READ_SOURCE_MODULE_NAMES'
 ]);
});
test('price preview can be configured without enabling transactions',()=>{
 const result=audit({settings:settings(true)});
 assert.equal(result.pricePreviewReady,true);
 assert.equal(result.realPaymentActivationReady,false);
 assert.equal(result.safeCurrentMode,true);
});
test('untrusted payment toggles or missing databases force unsafe status',()=>{
 const enabled=settings(true);
 enabled.bindings.find(x=>x.name==='STARS_PAYMENT_ENABLED').text='true';
 const a=audit({settings:enabled});
 assert.equal(a.safeCurrentMode,false);
 assert.equal(a.realPaymentActivationReady,false);
 assert.ok(a.blockers.includes('payments_safely_disabled'));
 const noDb=settings();
 noDb.bindings=noDb.bindings.filter(x=>x.name!=='PAYMENTS_DB');
 assert.equal(audit({settings:noDb}).safeCurrentMode,false);
});
test('tampered pricing or missing source module never enables quotes',()=>{
 const wrong=settings(true);
 wrong.bindings.find(x=>x.name==='STARS_RUB_MINOR_PER_STAR_NUM').text='0';
 assert.equal(audit({settings:wrong}).pricePreviewReady,false);
 assert.equal(audit({sourceNames:knownSources.slice(0,2)}).pricePreviewReady,false);
 const missingSchema=audit({tables:['rustup_payment_settings']});
 assert.equal(missingSchema.pricePreviewReady,false);
});
test('missing or incorrectly shaped data always fails closed',()=>{
 assert.throws(()=>evaluateStarsActivation({}),/activation_unknown_live_state/);
 const bad=settings();
 bad.bindings.find(x=>x.name==='PAYMENT_PRODUCTION_ENABLED').text='maybe';
 const result=audit({settings:bad});
 assert.equal(result.safeCurrentMode,false);
 assert.ok(result.blockers.includes('payment_flags_known'));
});

test('read-only live parser supports current webhook-only source map',()=>{
 const names=[
  'worker.live-compiled-original.mjs','telegram-initdata.mjs',
  'deposit-history-readonly.mjs','stars-owner-price-preview.mjs',
  'stars-history-only-wrapper.mjs','stars.mjs','variable-stars.mjs',
  'payment-controls.mjs','stars-variable-bridge.mjs',
  'stars-payment-support.mjs','freeze-verified-stars-game-quote.mjs',
  'verified-stars-game-credit.mjs','stars-delivery-queue.mjs',
  'verified-stars-game-refund.mjs','stars-variable-webhook-wrapper.mjs',
  'worker.stars-webhook-only-entry.mjs'
 ];
 const map={version:3,sources:names,sourcesContent:names.map(()=>'*'.repeat(90))};
 const boundary='test-boundary-123456789';
 const raw='--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="worker.js"\r\n\r\n'+
  '/* bundle */\r\n--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="worker.js.map"\r\n\r\n'+
  JSON.stringify(map)+'\r\n--'+boundary+'--\r\n';
 assert.deepEqual(parseLiveSourceNames(raw,'multipart/form-data; boundary='+boundary),names);
 assert.throws(()=>parseLiveSourceNames(raw.replace('worker.stars-webhook-only-entry.mjs','unexpected-entry.mjs')),
  /unexpected_live_stars_entry_modules/);
 assert.throws(()=>parseLiveSourceNames(raw.replace('"version":3','"version":2')),
  /invalid_live_worker_source_map_shape/);
});

test('wallet top-up readiness does not require unrelated supporter badge module',()=>{
 const report=audit({settings:settings(true)});
 assert.equal(report.optionalComponents.supporter_badge_worker_module,false);
 assert.equal(report.optionalComponents.supporter_badge_table,false);
 assert.ok(!report.blockers.includes('supporter_badge_worker_module'));
 assert.equal(report.pricePreviewReady,true);
 assert.equal(report.realPaymentActivationReady,false);
 assert.equal(report.gameCreditConnected,false);
});

test('missing credit/refund settlement flags fail readiness closed',()=>{
 const live=settings(true);
 live.bindings=live.bindings.filter(x=>!settlementFlags.includes(x.name));
 const report=audit({settings:live});
 assert.equal(report.safeCurrentMode,false);
 assert.ok(report.blockers.includes('settlement_flags_explicitly_off'));
 assert.equal(report.realPaymentActivationReady,false);
});
test('missing production triggers and release gate fail audit closed',()=>{
 const noTrigger=audit({gameTriggers:[]});
 assert.ok(noTrigger.blockers.includes('game_paid_credit_refund_triggers'));
 const noGate=audit({gameGate:null});
 assert.equal(noGate.safeCurrentMode,false);
 assert.ok(noGate.blockers.includes('game_paid_release_gate_off'));
});
