import test from 'node:test';
import assert from 'node:assert/strict';
import {extractReviewedCompiledWorker,compiledAdapterEntry,
 checkCompiledWorkerLineage} from './stage-current-compiled-worker.mjs';

const boundary='--rustupCompiledBoundary12345';
function source(){
 return 'const stuff = "safe";\n'+'x'.repeat(150000)+
  '\nasync function onUpdate(upd, env) {}\n'+
  'var worker_default = { fetch(){}, scheduled(){} };\n'+
  'class refDeposit {}\n'+
  'export {\n  worker_default as default,\n  refDeposit\n};\n'+
  '//# sourceMappingURL=worker.js.map';
}
function multipart(code=source(),withMap=false){
 return boundary+'\r\nContent-Disposition: form-data; name="worker.js"; '+
  'filename="worker.js"\r\nContent-Type: application/javascript+module'+
  '\r\n\r\n'+code+'\r\n'+
  (withMap?boundary+'\r\nContent-Disposition: form-data; name="map"; '+
    'filename="worker.js.map"\r\nContent-Type: application/json\r\n\r\n{}\r\n':'')+
  boundary+'--';
}
test('single compiled module can be captured without uploading private code',()=>{
 const snapshot=extractReviewedCompiledWorker(multipart());
 assert.equal(snapshot.source,source());
 assert.match(snapshot.hash,/^[a-f0-9]{64}$/);
 assert.equal(snapshot.source.includes('refDeposit'),true);
});
test('source-map present, missing exported class, or additional modules refuse compiled fallback',()=>{
 assert.throws(()=>extractReviewedCompiledWorker(multipart(source(),true)),
  /source_map_available_use_verified_source_recovery/);
 assert.throws(()=>extractReviewedCompiledWorker(multipart(
  source().replace('refDeposit\n};','otherBinding\n};'))),
  /compiled_worker_original_contract_changed/);
 assert.throws(()=>extractReviewedCompiledWorker('bad'),
  /invalid_compiled_worker_content/);
 const extra=multipart().replace(boundary+'--',
  boundary+'\r\nContent-Disposition: form-data; name="unexpected"; '+
   'filename="unreviewed.js"\r\n\r\nconst x=1;\r\n'+boundary+'--');
 assert.throws(()=>extractReviewedCompiledWorker(extra),
  /unexpected_compiled_worker_files/);
});
test('compiled adapter reexports original named classes but wraps only default',()=>{
 const entry=compiledAdapterEntry();
 assert.match(entry,/export \* from '.\/worker.live-compiled-original.mjs'/);
 assert.match(entry,/export default wrapExistingWorker\(original\)/);
 assert.doesNotMatch(entry,/STARS_PAYMENT_ENABLED.*true/);
});
test('exact live code and version etag must match private snapshot before release',()=>{
 const x={version:'version-0123456789',liveVersion:'version-0123456789',
  scriptEtag:'a'.repeat(64),originalEtag:'a'.repeat(64),
  workerCodeHash:'b'.repeat(64),oldWorkerCodeHash:'b'.repeat(64)};
 assert.equal(checkCompiledWorkerLineage(x),true);
 for(const change of [
  {...x,liveVersion:'new-version-9876'},
  {...x,scriptEtag:'c'.repeat(64)},
  {...x,workerCodeHash:'d'.repeat(64)}
 ])assert.throws(()=>checkCompiledWorkerLineage(change),
  /compiled_worker_changed_since_local_snapshot/);
});
