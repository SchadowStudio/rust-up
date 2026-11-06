import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
 checkHistoryReleaseMetadata,inspectDeployedHistorySource
} from './verify-history-only-worker-release.mjs';
const OLD='d7ebc026-91d0-42f0-bd51-94202572dfc3';
const NEXT='different-verified-history-worker-version';
const ETAG='a'.repeat(64);
const manifest={format:1,source:'compiled_history_only',
 activeVersion:OLD,sourceHash:'b'.repeat(64),scriptEtag:ETAG};
const bindings=[
 ...['BOT_TOKEN','WEBHOOK_SECRET','ADMIN_BOT_TOKEN','CLIPS_BOT_TOKEN']
  .map(name=>({name,type:'secret_text'})),
 {name:'APP_URL',type:'plain_text',
  text:'https://ttzoomrust-hub.github.io/rust-up/'},
 {name:'DB',type:'d1',id:'9b0b533f-540a-4a25-a429-70ca8bd4e23d'},
 {name:'PAYMENTS_DB',type:'d1',id:'06079270-a227-466a-9991-abd4201ec5f6'},
 ...['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
 'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
 'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
 'PAYMENT_WALLET_STRICT_MODE'].map(name=>({
  name,type:'plain_text',text:'false'
 }))
];
function evidence(phase='before'){
 return {phase,manifest,bindings:structuredClone(bindings),
  schedules:{schedules:[{cron:'* * * * *'}]},
  versionId:phase==='before'?OLD:NEXT,
  versionInfo:{resources:{script:{etag:phase==='before'?ETAG:'c'.repeat(64),
   handlers:['scheduled','fetch'],
   named_handlers:[{name:'refDeposit',handlers:['class']}]}}}
 };
}
test('before-deployment must exactly match original Worker version/etag, code is not activated',()=>{
 const report=checkHistoryReleaseMetadata(evidence());
 assert.equal(report.allPaymentGatesOff,true);
 assert.equal(report.gameAndPaymentDatabasesPreserved,true);
 assert.equal(report.originalSecretsPreserved,true);
 assert.equal(report.paymentActivationApproved,false);
 const a=evidence();
 a.versionId=NEXT;
 assert.throws(()=>checkHistoryReleaseMetadata(a),/active_worker_changed/);
 const b=evidence();
 b.versionInfo.resources.script.etag='d'.repeat(64);
 assert.throws(()=>checkHistoryReleaseMetadata(b),/active_worker_changed/);
});
test('after-deployment must have a new version, all original exports and every safety gate OFF',()=>{
 const report=checkHistoryReleaseMetadata(evidence('after'));
 assert.equal(report.phase,'after');
 assert.equal(report.scheduledAndNamedClassPreserved,true);
 const same=evidence('after');
 same.versionId=OLD;
 assert.throws(()=>checkHistoryReleaseMetadata(same),/not_deployed/);
});
test('any changed payment flag, DB, secret, app origin, cron or named class aborts',()=>{
 const mutations=[
  x=>x.bindings.find(b=>b.name==='STARS_PAYMENT_ENABLED').text='true',
  x=>x.bindings.find(b=>b.name==='PAYMENT_PRODUCTION_ENABLED').text='true',
  x=>x.bindings.find(b=>b.name==='PAYMENTS_DB').id='wrong',
  x=>x.bindings.find(b=>b.name==='BOT_TOKEN').type='plain_text',
  x=>x.bindings.find(b=>b.name==='APP_URL').text='https://evil.example',
  x=>x.schedules.schedules=[],
  x=>x.versionInfo.resources.script.named_handlers=[],
  x=>x.versionInfo.resources.script.handlers=['fetch'],
  x=>x.bindings.push({...x.bindings[0]})
 ];
 for(const modify of mutations){
  const x=evidence('after');
  modify(x);
  assert.throws(()=>checkHistoryReleaseMetadata(x),/history_only_release_/);
 }
});
const original='the exact compiled original Worker source fixture';
const originalHash=createHash('sha256').update(original).digest('hex');
function multipart({withMap=true,withHistory=true,withClass=true,
 basename='worker.js',unrelated=false,badMap=false,badOriginal=false,
 extraPart=false,duplicatePart=false}={}){
 const b='--rustupHistoryReleaseBoundary345';
 const code=('export default {fetch(){}};'+
  (withHistory?'/api/stars/variable/history wrapHistoryOnlyWorker':'')+
  (withClass?' refDeposit':'')+'x'.repeat(140000));
 const sources=[
  '../worker.live-compiled-original.mjs',
  '../telegram-initdata.mjs',
  '../deposit-history-readonly.mjs',
  '../stars-history-only-wrapper.mjs',
  '../worker.history-only-compiled-entry.mjs'
 ];
 const map=JSON.stringify({version:3,
  sources:unrelated?sources.slice(1):sources,
  sourcesContent:unrelated?
   ['a','b','c','d']:
   [badOriginal?original+'-changed':original,'a','b','c','d']
 });
 const script=b+'\\r\\nContent-Disposition: form-data; name="'+basename+
  '"; filename="'+basename+'"'+
  '\\r\\nContent-Type: application/javascript+module\\r\\n\\r\\n'+code+'\\r\\n';
 const mapPart=b+'\\r\\nContent-Disposition: form-data; name="'+basename+'.map"; filename="'+basename+'.map"'+
  '\\r\\nContent-Type: application/source-map\\r\\n\\r\\n'+
  (badMap?'{broken':map)+'\\r\\n';
 return script+(duplicatePart?script:'')+
  (withMap?mapPart:'')+(extraPart?b+'\\r\\nContent-Disposition: form-data; name="intruder"; filename="extra.js"\\r\\n\\r\\nhack\\r\\n':'')+b+'--';
}

test('post-deploy compiled source accepts Cloudflare API and Wrangler module filenames with exact map',()=>{
 for(const basename of ['worker.js','worker.stars-history-only.bundle.js']){
  assert.deepEqual(inspectDeployedHistorySource(multipart({basename})),{
   historyAdapterPresent:true,namedClassInBundle:true,
   sourceMapPresent:true,originalCodeHashVerified:false
  });
  assert.deepEqual(inspectDeployedHistorySource(multipart({basename}),originalHash),{
   historyAdapterPresent:true,namedClassInBundle:true,
   sourceMapPresent:true,originalCodeHashVerified:true
  });
 }
});
test('missing, mismatched, duplicate or extra multipart files are rejected',()=>{
 assert.throws(()=>inspectDeployedHistorySource(multipart({withMap:false})),/source_map/);
 assert.throws(()=>inspectDeployedHistorySource(multipart({basename:'unexpected.js'})),/source_map/);
 assert.throws(()=>inspectDeployedHistorySource(multipart({extraPart:true})),/source_map/);
 assert.throws(()=>inspectDeployedHistorySource(multipart({duplicatePart:true})),/source_map/);
});
test('incorrect code, source map, altered original bytes or hash must fail closed',()=>{
 assert.throws(()=>inspectDeployedHistorySource(multipart({withHistory:false})),/not_in_bundle/);
 assert.throws(()=>inspectDeployedHistorySource(multipart({withClass:false})),/not_in_bundle/);
 assert.throws(()=>inspectDeployedHistorySource(multipart({badMap:true})),/invalid_json/);
 assert.throws(()=>inspectDeployedHistorySource(multipart({unrelated:true})),/not_history_only/);
 assert.throws(()=>inspectDeployedHistorySource(multipart({badOriginal:true}),originalHash),
  /not_byte_identical/);
 assert.throws(()=>inspectDeployedHistorySource(multipart(),'invalid-hash'),/hash_invalid/);
});
