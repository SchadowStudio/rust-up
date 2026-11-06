// Offline contract test for targeted Cloudflare Worker patch staging.
// Uses synthetic modules and NEVER authenticates or deploys to Cloudflare.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseWorker16} from './stage-targeted-stars-wrapper.mjs';

const modules=[
 'worker.live-compiled-original.mjs','telegram-initdata.mjs',
 'deposit-history-readonly.mjs','stars-owner-price-preview.mjs',
 'stars-history-only-wrapper.mjs','stars.mjs','variable-stars.mjs',
 'payment-controls.mjs','stars-variable-bridge.mjs',
 'stars-payment-support.mjs','freeze-verified-stars-game-quote.mjs',
 'verified-stars-game-credit.mjs','stars-delivery-queue.mjs',
 'verified-stars-game-refund.mjs','stars-variable-webhook-wrapper.mjs',
 'worker.stars-webhook-only-entry.mjs'
];
function sample(){
 const sourcesContent=modules.map(name=>{
  let code='// '+name+'\n'+'const stable = true;\n'.repeat(7);
  if(name==='worker.live-compiled-original.mjs')code+='refDeposit\n';
  if(name==='stars-variable-webhook-wrapper.mjs')code+='settlementWorkerAllowed\n';
  if(name==='worker.stars-webhook-only-entry.mjs')
   code+='wrapCurrentStarsWebhook(wrapHistoryOnlyWorker(original))\n';
  return code;
 });
 const map={version:3,sources:modules,sourcesContent};
 const boundary='----rustup-test-boundary-123456789';
 return '--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="worker.stars-webhook-only.bundle.js"\r\n\r\n'+
  '/* compiled Worker */'.padEnd(100200,'*')+
  '\r\n--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="worker.stars-webhook-only.bundle.js.map"\r\n\r\n'+
  JSON.stringify(map)+'\r\n--'+boundary+'--\r\n';
}
test('only expected current 16-module layout is accepted',()=>{
 const parsed=parseWorker16(sample());
 assert.deepEqual([...parsed.keys()],modules);
 assert.ok(parsed.get('worker.live-compiled-original.mjs').includes('refDeposit'));
 assert.ok(parsed.get('stars-variable-webhook-wrapper.mjs').includes('settlementWorkerAllowed'));
});
test('unexpected, missing or duplicated module is always rejected',()=>{
 const raw=sample();
 assert.throws(()=>parseWorker16(raw.replace('stars-payment-support.mjs','unapproved-support.mjs')),
  /live_module_layout_changed/);
 assert.throws(()=>parseWorker16(raw.replace('"version":3','"version":2')),
  /live_module_layout_changed/);
 assert.throws(()=>parseWorker16(raw.replace(
  'wrapCurrentStarsWebhook(wrapHistoryOnlyWorker(original))','unreviewedEntryCall')),
  /live_worker_contract_changed/);
});
