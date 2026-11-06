import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
 inspectWebhookOnlySource,checkWebhookOnlyMetadata
} from './verify-stars-webhook-only-live.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const ORIGINAL='original-unchanged-for-test';
const originalSha=sha(ORIGINAL);
const old='d618b572-ae34-4ec5-9e0e-471df5cbcfe2';
const required=['worker.live-compiled-original.mjs',
 'stars-history-only-wrapper.mjs','stars-owner-price-preview.mjs',
 'stars-variable-webhook-wrapper.mjs','stars-variable-bridge.mjs',
 'variable-stars.mjs','stars-delivery-queue.mjs',
 'verified-stars-game-credit.mjs',
 'worker.stars-webhook-only-entry.mjs'];
const source=Object.fromEntries(required.map(name=>[name,
 name==='worker.live-compiled-original.mjs'?ORIGINAL:'source:'+name]));
function multipart({tamper=null,missing=null,badMap=false}={}){
 const files=required.filter(x=>x!==missing);
 const map=JSON.stringify({version:3,
  sources:files.map(x=>'../'+x),
  sourcesContent:files.map(x=>x===tamper?'changed-content':source[x])
 });
 const b='--releaseWebhookCheck987';
 const js='/* wrapHistoryOnlyWorker wrapCurrentStarsWebhook '+
  'runVariableStarsDeliveryQueue deliverVerifiedVariableStarsCredit '+
  '/api/stars/variable/history /api/stars/variable/quote refDeposit */'+
  'x'.repeat(145000);
 return b+'\r\nContent-Disposition: form-data; name="code"; filename="worker.stars-webhook-only.bundle.js"'+
  '\r\nContent-Type: application/javascript+module\r\n\r\n'+js+'\r\n'+
  b+'\r\nContent-Disposition: form-data; name="map"; filename="worker.stars-webhook-only.bundle.js.map"'+
  '\r\nContent-Type: application/source-map\r\n\r\n'+
  (badMap?'no-json':map)+'\r\n'+b+'--';
}
test('deployed bundle/map must exactly match verified staged code, even if Worker imports 13 modules',()=>{
 const expected=Object.fromEntries(required.map(name=>[name,sha(source[name])]));
 const ok=inspectWebhookOnlySource(multipart(),expected,originalSha);
 assert.equal(ok.sourceMapVerified,true);
 assert.equal(ok.originalBotExact,true);
 assert.equal(ok.paidDeliveryConsumerPresent,true);
 const real={...expected,
  'worker.live-compiled-original.mjs':'dc181bc6f29e8256342fa216d80c73ff9850d1443c055a9002469f8685e193dc'};
 assert.throws(()=>inspectWebhookOnlySource(multipart(),real),/untrusted_or_altered/);
});
test('missing module, tampered module and malformed map fail before claiming rollout success',()=>{
 const expected=Object.fromEntries(required.map(name=>[name,sha(source[name])]));
 assert.throws(()=>inspectWebhookOnlySource(multipart({missing:'stars-delivery-queue.mjs'}),expected),/invalid_sourcemap_sources|missing_required/);
 assert.throws(()=>inspectWebhookOnlySource(multipart({tamper:'variable-stars.mjs'}),expected),/untrusted_or_altered/);
 assert.throws(()=>inspectWebhookOnlySource(multipart({badMap:true}),expected),/invalid_sourcemap_json/);
});
const flags=['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
 'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
 'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
 'PAYMENT_WALLET_STRICT_MODE'];
function metadata(){
 const rate=[
  ['STARS_MIN_RUB_MINOR','100'],
  ['STARS_MAX_RUB_MINOR','100000000'],
  ['STARS_RUB_MINOR_PER_STAR_NUM','183000'],
  ['STARS_RUB_MINOR_PER_STAR_DEN','1000']
 ];
 return {
  settings:{bindings:[
   {name:'APP_URL',type:'plain_text',text:'https://ttzoomrust-hub.github.io/rust-up/'},
   {name:'DB',type:'d1',id:'9b0b533f-540a-4a25-a429-70ca8bd4e23d'},
   {name:'PAYMENTS_DB',type:'d1',id:'06079270-a227-466a-9991-abd4201ec5f6'},
   ...flags.map(name=>({name,type:'plain_text',text:'false'})),
   ...rate.map(([name,text])=>({name,type:'plain_text',text})),
   ...['BOT_TOKEN','WEBHOOK_SECRET','ADMIN_BOT_TOKEN','CLIPS_BOT_TOKEN']
    .map(name=>({name,type:'secret_text'}))
  ]},
  schedules:{schedules:[{cron:'* * * * *'}]},
  versionInfo:{resources:{script:{
   etag:'b'.repeat(64),handlers:['fetch','scheduled'],
   named_handlers:[{name:'refDeposit',handlers:['class']}]}}},
  activeVersion:'new-safe-webhook-version',
  stage:{activeVersion:old,originalSha:
   'dc181bc6f29e8256342fa216d80c73ff9850d1443c055a9002469f8685e193dc',
   etag:'a'.repeat(64),paymentsEnabled:false}
 };
}
test('verified release retains 1.83 RUB, both D1, named class and all money OFF',()=>{
 const report=checkWebhookOnlyMetadata(metadata());
 assert.equal(report.starsRateRubPerStar,'1.83');
 assert.equal(report.allPaymentGatesOff,true);
 assert.equal(report.gameCreditSettlementEnabled,false);
});
test('any unexpected real-money release switch or changed rate is rejected',()=>{
 for(const type of ['paid','credit','rate']){
  const e=metadata();
  if(type==='paid')
   e.settings.bindings.find(x=>x.name==='STARS_PAYMENT_ENABLED').text='true';
  if(type==='credit')
   e.settings.bindings.push({name:'STARS_GAME_CREDIT_SETTLEMENT_ENABLED',
    type:'plain_text',text:'true'});
  if(type==='rate')
   e.settings.bindings.find(x=>x.name==='STARS_RUB_MINOR_PER_STAR_NUM').text='187159';
  assert.throws(()=>checkWebhookOnlyMetadata(e));
 }
});
