import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateSupporterReadiness} from './supporter-payment-preflight.mjs';

const names=['rustup_stars_orders','rustup_stars_products',
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
   {name:'PAYMENT_ADMIN_IDS',type:'plain_text',text:'123456789'}
  ],
  tables:names,
  products:[{sku:'supporter_badge_v1',kind:'fixed_nontransferable',
   price_stars:29,enabled:1,hasDelivery:1}],
  controls:['master','stars','crypto'].map(channel=>({channel,enabled:0})),
  incidents:[{value:0},{value:0}],
  siteHtml:'<script src="https://telegram.org/js/telegram-web-app.js?64"></script>'+
   '<script src="js/stars-variable-wallet-v4.js?v=20261105telegramauth2"></script>'
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
