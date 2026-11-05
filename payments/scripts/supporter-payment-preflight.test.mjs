import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateSupporterReadiness} from './supporter-payment-preflight.mjs';

const names=['rustup_stars_terms_acceptances','rustup_stars_order_terms',
 'rustup_stars_orders','rustup_stars_products',
 'rustup_stars_fixed_content','rustup_stars_order_content',
 'rustup_stars_supporter_badges','rustup_stars_refund_intents',
 'rustup_stars_receipt_incidents','rustup_payment_settings'];
const flags=['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
 'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
 'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
 'PAYMENT_WALLET_STRICT_MODE'];
function evidence(){
 return {
  bindings:[
   ...flags.map(name=>({name,text:'false',type:'plain_text'})),
   {name:'APP_URL',type:'plain_text',
    text:'https://ttzoomrust-hub.github.io/rust-up/'},
   {name:'BOT_TOKEN',type:'secret_text'},
   {name:'WEBHOOK_SECRET',type:'secret_text'},
   {name:'PAYMENT_ADMIN_IDS',type:'plain_text',text:'123456789'},
   {name:'PAYMENTS_DB',type:'d1',id:'06079270-a227-466a-9991-abd4201ec5f6'},
   {name:'STARS_TERMS_VERSION',type:'plain_text',text:'2026-11-v1'},
   {name:'STARS_TERMS_URL',type:'plain_text',text:'https://example.org/payments/terms'}
  ],
  tables:names,
  products:[{sku:'supporter_badge_v1',kind:'fixed_nontransferable',
   price_stars:29,enabled:1,hasDelivery:1}],
  controls:['master','stars','crypto'].map(channel=>({channel,enabled:0})),
  incidents:[{value:0},{value:0}],
  termsRouteAuthenticated:true,
  siteHtml:'<script src="https://telegram.org/js/telegram-web-app.js?64"></script>'+
   '<script src="js/stars-variable-wallet-v4.js?v=20261105telegramauth2"></script>'+ 
   '<script src="js/stars-fixed-market-v3.js?v=20261105market3"></script>'
 };
}
test('safe provisioned supporter is still never considered money activated',()=>{
 const report=evaluateSupporterReadiness(evidence());
 assert.equal(report.checks.every(x=>x.ok),true);
 assert.equal(report.readyToAcceptPayments,false);
 assert.equal(report.paymentActivated,false);
 assert.equal(report.gameWalletChanged,false);
 assert.ok(report.blockers.includes('real_telegram_e2e_payment_and_refund_not_proven'));
 assert.ok(report.blockers.includes('operator_and_legal_release_approval_not_proven'));
});
test('missing admin, price, official Telegram SDK and incomplete incident evidence block',()=>{
 const sample=evidence();
 delete sample.bindings.find(x=>x.name==='PAYMENT_ADMIN_IDS').text;
 sample.products=[];
 sample.siteHtml='<script>window.rustup_tg=true</script>';
 sample.incidents=[];
 const r=evaluateSupporterReadiness(sample);
 for(const id of [
  'refund_operator_allowlist','supporter_product_has_price_delivery',
  'miniapp_telegram_auth_bootstrap','no_unresolved_payment_incidents'
 ])assert.ok(r.blockers.includes(id),id);
});
test('unsafe game topups and unrelated paid products never pass supporter checks',()=>{
 const s=evidence();
 s.bindings.find(x=>x.name==='STARS_VARIABLE_TOPUP_ENABLED').text='true';
 s.products.push({sku:'case_balance',enabled:1,price_stars:10,
  kind:'fixed_nontransferable',hasDelivery:1});
 const result=evaluateSupporterReadiness(s);
 assert.ok(result.blockers.includes('hard_payment_flags_safely_off'));
 assert.ok(result.blockers.includes('no_other_enabled_paid_products'));
 assert.equal(result.readyToAcceptPayments,false);
});
test('missing evidence and malformed settings fail closed',()=>{
 assert.throws(()=>evaluateSupporterReadiness({}),/incomplete_live_readiness_evidence/);
 const sample=evidence();
 sample.controls.pop();
 assert.ok(evaluateSupporterReadiness(sample).blockers.includes(
  'database_switches_safely_off'));
 sample.controls=evidence().controls;
 sample.incidents=[{value:0}];
 assert.ok(evaluateSupporterReadiness(sample).blockers.includes(
  'no_unresolved_payment_incidents'));
});

test('new fixed-goods release blocks missing D1, missing terms, and missing signed route',()=>{
 const x=evidence();
 x.bindings=x.bindings.filter(b=>b.name!=='PAYMENTS_DB');
 x.bindings.find(b=>b.name==='STARS_TERMS_URL').text='http://untrusted.example';
 x.termsRouteAuthenticated=false;
 x.tables=x.tables.filter(n=>n!=='rustup_stars_order_terms');
 const result=evaluateSupporterReadiness(x);
 for(const id of [
  'correct_live_payment_database_binding',
  'operator_terms_version_and_https_url',
  'authenticated_stars_terms_route_present',
  'payment_schema_ready'
 ])assert.ok(result.blockers.includes(id),id);
 assert.equal(result.readyToAcceptPayments,false);
});
test('only the exact isolated payment D1 binding and bounded owner terms version pass',()=>{
 const x=evidence();
 x.bindings.find(b=>b.name==='PAYMENTS_DB').id='wrong-database';
 x.bindings.find(b=>b.name==='STARS_TERMS_VERSION').text='';
 let r=evaluateSupporterReadiness(x);
 assert.ok(r.blockers.includes('correct_live_payment_database_binding'));
 assert.ok(r.blockers.includes('operator_terms_version_and_https_url'));
 x.bindings.find(b=>b.name==='PAYMENTS_DB').id='06079270-a227-466a-9991-abd4201ec5f6';
 x.bindings.find(b=>b.name==='STARS_TERMS_VERSION').text='2026-11-v1';
 r=evaluateSupporterReadiness(x);
 assert.equal(r.checks.every(c=>c.ok),true);
 assert.equal(r.paymentActivated,false);
});
