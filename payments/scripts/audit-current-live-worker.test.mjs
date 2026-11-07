import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectWorkerMultipart,evaluateLiveWorkerSafety,inspectLiveWorker}
 from './audit-current-live-worker.mjs';

const FLAGS=['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
 'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
 'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
 'PAYMENT_WALLET_STRICT_MODE'];
const DEPLOY=[{versions:[{version_id:'verified-worker-version-001'}]}];
function bindings(){
 return [
  ...['BOT_TOKEN','WEBHOOK_SECRET','ADMIN_BOT_TOKEN','CLIPS_BOT_TOKEN']
   .map(name=>({name,type:'secret_text'})),
  {name:'DB',type:'d1',id:'9b0b533f-540a-4a25-a429-70ca8bd4e23d'},
  {name:'PAYMENTS_DB',type:'d1',id:'06079270-a227-466a-9991-abd4201ec5f6'},
  ...FLAGS.map(name=>({name,type:'plain_text',text:'false'}))
 ];
}
function raw({adapter=false,map=false}={}){
 const b='--rustupContentBoundary56789';
 const code='export default {fetch(){return new Response("ok")}};'+
  'x'.repeat(200)+(adapter?
  'wrapExistingWorker stars_terms_acceptance_required /api/stars/health':'');
 return b+'\r\nContent-Disposition: form-data; name="worker.js"; '+
  'filename="worker.js"\r\nContent-Type: application/javascript+module'+
  '\r\n\r\n'+code+'\r\n'+
  (map?b+'\r\nContent-Disposition: form-data; name="map"; '+
    'filename="worker.js.map"\r\nContent-Type: application/json'+
    '\r\n\r\n{"sources":[]}\r\n':'')+b+'--';
}
test('live Worker can retain DB and secrets while Stars adapter is absent',()=>{
 const report=evaluateLiveWorkerSafety({
  settings:{bindings:bindings()},deployments:DEPLOY,
  multipart:inspectWorkerMultipart(raw())
 });
 assert.equal(report.bothDatabasesBound,true);
 assert.equal(report.botSecretsIntact,true);
 assert.equal(report.allPaymentFlagsOff,true);
 assert.equal(report.fixedStarsAdapterPresent,false);
 assert.equal(report.sourceMapAvailable,false);
 assert.deepEqual(report.blockers,[
  'live_stars_adapter_not_deployed',
  'live_worker_sourcemap_unavailable_for_safe_recovery'
 ]);
 assert.equal(report.realPaymentActivationApproved,false);
 assert.equal(report.changesApplied,false);
});
test('even adapter present with all bindings is never approval to charge',()=>{
 const report=evaluateLiveWorkerSafety({
  settings:{bindings:bindings()},deployments:DEPLOY,
  multipart:inspectWorkerMultipart(raw({adapter:true,map:true}))
 });
 assert.deepEqual(report.blockers,[]);
 assert.equal(report.fixedStarsAdapterPresent,true);
 assert.equal(report.realPaymentActivationApproved,false);
});
test('incorrect payment database, dangerous flags or secrets fail closed',()=>{
 const b=bindings();
 b.find(x=>x.name==='PAYMENTS_DB').id='wrong';
 b.find(x=>x.name==='STARS_PAYMENT_ENABLED').text='true';
 b.find(x=>x.name==='BOT_TOKEN').type='plain_text';
 const report=evaluateLiveWorkerSafety({
  settings:{bindings:b},deployments:DEPLOY,
  multipart:inspectWorkerMultipart(raw({adapter:true,map:true}))
 });
 assert.deepEqual(report.blockers,[
  'existing_bot_secrets_missing',
  'two_correct_databases_not_bound',
  'payment_release_flags_not_explicitly_off'
 ]);
 assert.equal(report.flagValues.STARS_PAYMENT_ENABLED,'ON');
});
test('malformed multipart or source map ambiguity never counts as reviewed source',()=>{
 assert.throws(()=>inspectWorkerMultipart('broken'),/unavailable/);
 assert.throws(()=>inspectWorkerMultipart(raw({map:true}).replace(
  'filename="worker.js.map"','filename="worker.js"')),/ambiguous/);
 const noBindings={bindings:[]};
 assert.throws(()=>evaluateLiveWorkerSafety({settings:noBindings,
  deployments:[],multipart:inspectWorkerMultipart(raw())}),
  /worker_live_version_unknown/);
});
test('read only fetch uses expected Cloudflare endpoints without leaking secrets',async()=>{
 const observed=[];
 const fakeFetch=async(url,options)=>{
  observed.push({url:String(url),method:options.method});
  if(String(url).endsWith('/content/v2'))
   return {ok:true,text:async()=>raw({adapter:false})};
  if(String(url).endsWith('/settings'))
   return {ok:true,json:async()=>({success:true,result:{bindings:bindings()}})};
  if(String(url).endsWith('/deployments'))
   return {ok:true,json:async()=>({success:true,
    result:{deployments:DEPLOY}})};
  throw Error('unexpected request');
 };
 const report=await inspectLiveWorker('local-read-only-token-123456',fakeFetch);
 assert.equal(observed.length,3);
 assert.ok(observed.every(x=>x.method==='GET'&&
  x.url.startsWith('https://api.cloudflare.com/client/v4/')));
 const output=JSON.stringify(report);
 assert.equal(output.includes('local-read-only-token-123456'),false);
 assert.equal(report.blockers.includes('live_stars_adapter_not_deployed'),true);
});
