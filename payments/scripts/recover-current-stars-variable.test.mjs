import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseVariableWorkerSourceMap,verifyVariableSnapshot}
 from './recover-current-stars-variable.mjs';

const sources=[
 'money.js','broadcast.js','creator.js','gamedata.js','modes.js',
 'game.js','support.js','admin.js','worker.js','stars.mjs',
 'telegram-initdata.mjs','payment-controls.mjs','stars-live-bridge.mjs',
 'refunds.mjs','stars-existing-worker-wrapper.mjs','variable-stars.mjs',
 'stars-variable-bridge.mjs','worker.stars-variable-entry.mjs'
];
function makeMap(){
 const contents=sources.map(name=>'// RUST UP source '+name+'\n'+'pad'.repeat(20));
 const set=(name,code)=>contents[sources.indexOf(name)]=code;
 set('worker.js','async function onUpdate(upd, env) { return upd; }\n'+ 'x'.repeat(40));
 set('game.js',"const guard = 'PAYMENT_WALLET_STRICT_MODE';\n"+'x'.repeat(40));
 set('worker.stars-variable-entry.mjs','variableStarsWebhook(update, env);\n'+ 'x'.repeat(40));
 set('stars-live-bridge.mjs','stars_invoice_link_not_persisted\n'+ 'x'.repeat(40));
 set('stars-existing-worker-wrapper.mjs','X-Telegram-Bot-Api-Secret-Token\n'+ 'x'.repeat(40));
 set('telegram-initdata.mjs','authDate<current-maxAgeSeconds\n'+ 'x'.repeat(40));
 set('stars-variable-bridge.mjs','STARS_VARIABLE_CREDIT_LEDGER_READY\n'+ 'x'.repeat(40));
 set('variable-stars.mjs','variable_stars_receipt_conflict\n'+ 'x'.repeat(40));
 return {version:3,sources,sourcesContent:contents};
}
function multipart(map){
 const bound='testboundaryx012345678901234567';
 return {
  contentType:'multipart/form-data; boundary='+bound,
  value:[
   '--'+bound,
   'Content-Disposition: form-data; name="source"; filename="worker.stars-variable.bundle.js.map"',
   'Content-Type: application/json',
   '',
   JSON.stringify(map),
   '--'+bound+'--',''
  ].join('\r\n')
 };
}
const sha=value=>createHash('sha256').update(value).digest('hex');
test('exact current 18 module source map recovers and verifies safely',()=>{
 const map=makeMap(),m=multipart(map);
 const recovered=parseVariableWorkerSourceMap(m.value,m.contentType);
 assert.equal(recovered.size,18);
 const manifest={worker:'rustup-bot',layout:'stars-variable-v4',
  files:sources.map((name,i)=>({name,sha256:sha(map.sourcesContent[i]),
    bytes:Buffer.byteLength(map.sourcesContent[i])}))};
 assert.equal(verifyVariableSnapshot(recovered,manifest),true);
 recovered.set('game.js',recovered.get('game.js')+'modified');
 assert.throws(()=>verifyVariableSnapshot(recovered,manifest),/live_variable_worker_changed/);
});
test('rejects truncated, reordered and unknown Worker source maps',()=>{
 const map=makeMap();
 const x=multipart(map);
 assert.throws(()=>parseVariableWorkerSourceMap('error'),/invalid_worker_source_response/);
 const reversed={...map,sources:[...map.sources].reverse()};
 const changed=multipart(reversed);
 assert.throws(()=>parseVariableWorkerSourceMap(changed.value,changed.contentType),
  /unexpected_latest_worker_source_map_layout/);
 const missing={...map,sources:map.sources.slice(1),sourcesContent:map.sourcesContent.slice(1)};
 const broken=multipart(missing);
 assert.throws(()=>parseVariableWorkerSourceMap(broken.value,broken.contentType),
  /unexpected_latest_worker_source_map_layout/);
 assert.ok(x.value.includes('worker.stars-variable.bundle.js.map'));
});
test('fails closed on unexpected game guard, commerce gate or source layout',()=>{
 const m=makeMap();m.sourcesContent[m.sources.indexOf('game.js')]='unprotected game '+ 'x'.repeat(40);
 const broken=multipart(m);
 assert.throws(()=>parseVariableWorkerSourceMap(broken.value,broken.contentType),
  /unexpected_current_variable_worker/);
});
