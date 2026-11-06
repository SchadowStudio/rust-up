import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {
 checkOwnerQuoteSource,verifyOwnerQuoteSettings
} from './verify-owner-stars-quote-live.mjs';

const names=['worker.live-compiled-original.mjs',
 'telegram-initdata.mjs','deposit-history-readonly.mjs',
 'stars-owner-price-preview.mjs','stars-history-only-wrapper.mjs',
 'worker.history-only-compiled-entry.mjs'];
const modules=['original_exact_compiled_worker','initdata verifier',
 'history read only','rubMinorPerStar:183','if(path===QUOTE)',
 'export default wrapHistoryOnlyWorker(original)'];
const originalHash=createHash('sha256').update(modules[0]).digest('hex');
const known=Object.fromEntries(names.map((name,i)=>[name,
 createHash('sha256').update(modules[i]).digest('hex')]));
const boundary='--rustupPricePreviewBoundary987';
function raw({rateOk=true,extra=false,removeMap=false}={}){
 const compiled='/* /api/stars/variable/history /api/stars/variable/quote '+
  'quoteOwnerStarsReadOnly refDeposit */'+'.'.repeat(145000);
 const m=JSON.stringify({version:3,sources:names.map(x=>'../'+x),
  sourcesContent:modules.map((x,i)=>i===3&&!rateOk?'rubMinorPerStar:200':x)});
 const js=boundary+'\r\nContent-Disposition: form-data; name="x"; filename="worker.stars-owner-quote.bundle.js"'+
  '\r\nContent-Type: application/javascript+module\r\n\r\n'+compiled+'\r\n';
 const map=boundary+'\r\nContent-Disposition: form-data; name="map"; filename="worker.stars-owner-quote.bundle.js.map"'+
  '\r\nContent-Type: application/source-map\r\n\r\n'+m+'\r\n';
 return js+(removeMap?'':map)+(extra?js:'')+boundary+'--';
}
test('approved read-only quote Worker includes all reviewed modules byte-for-byte',()=>{
 const x=checkOwnerQuoteSource(raw(),originalHash,known);
 assert.equal(x.valid,true);
 assert.equal(x.originalBotExact,true);
 assert.equal(x.readOnlyPriceModule,true);
 assert.equal(x.moduleCount,6);
});
test('unsafe map, altered rate or altered stage source is refused',()=>{
 assert.throws(()=>checkOwnerQuoteSource(raw({removeMap:true}),originalHash,known),/parts_unexpected/);
 assert.throws(()=>checkOwnerQuoteSource(raw({extra:true}),originalHash,known),/parts_unexpected/);
 assert.throws(()=>checkOwnerQuoteSource(raw({rateOk:false}),originalHash,known),
  /different_from_reviewed_stage|compiled_operator_rate_wrong/);
 assert.throws(()=>checkOwnerQuoteSource(raw(),'0'.repeat(64),known),/original_bot_hash_changed/);
});
const owner=JSON.parse(readFileSync(new URL('../stars-owner-rate.json',import.meta.url),'utf8'));
const flags=['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED','STARS_FIXED_PRODUCTS_ENABLED',
 'STARS_REFUNDS_ENABLED','STARS_VARIABLE_TOPUP_ENABLED',
 'STARS_VARIABLE_CREDIT_LEDGER_READY','PAYMENT_WALLET_STRICT_MODE'];
const bindings=[
 {name:'APP_URL',type:'plain_text',text:'https://ttzoomrust-hub.github.io/rust-up/'},
 {name:'DB',type:'d1',id:'9b0b533f-540a-4a25-a429-70ca8bd4e23d'},
 {name:'PAYMENTS_DB',type:'d1',id:'06079270-a227-466a-9991-abd4201ec5f6'},
 ...flags.map(name=>({name,type:'plain_text',text:'false'})),
 ...['BOT_TOKEN','WEBHOOK_SECRET','ADMIN_BOT_TOKEN','CLIPS_BOT_TOKEN']
  .map(name=>({name,type:'secret_text'})),
 ...['STARS_MIN_RUB_MINOR','STARS_MAX_RUB_MINOR',
  'STARS_RUB_MINOR_PER_STAR_NUM','STARS_RUB_MINOR_PER_STAR_DEN']
  .map(name=>({name,type:'plain_text',text:owner[name]}))
];
function meta(){
 return {settings:{bindings:structuredClone(bindings)},
 schedules:{schedules:[{cron:'* * * * *'}]},
 version:{resources:{script:{
  etag:'b'.repeat(64),handlers:['scheduled','fetch'],
  named_handlers:[{name:'refDeposit',handlers:['class']}]}}},
 versionId:'new-quote-preview-worker-version',
 manifest:{workerVersion:'b2b449e1-b824-4af6-8048-c9ab32b134d2',
  originalHash:'dc181bc6f29e8256342fa216d80c73ff9850d1443c055a9002469f8685e193dc',
  etag:'a'.repeat(64),moneyEnabled:false},
 ownerRate:owner};
}
test('new rate config and all Cloudflare safety gates must match before declaring success',()=>{
 const v=verifyOwnerQuoteSettings(meta());
 assert.equal(v.operatorPriceConfigured,true);
 assert.equal(v.rateRubPerStar,'1.83');
 assert.equal(v.paymentActivationApproved,false);
 const f=meta();
 f.settings.bindings.find(x=>x.name==='STARS_RUB_MINOR_PER_STAR_NUM').text='187159';
 assert.throws(()=>verifyOwnerQuoteSettings(f),/live_operator_rate_mismatch/);
 const g=meta();
 g.settings.bindings.find(x=>x.name==='STARS_PAYMENT_ENABLED').text='true';
 assert.throws(()=>verifyOwnerQuoteSettings(g),/payment_gate_not_off/);
});
