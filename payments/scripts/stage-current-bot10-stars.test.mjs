import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readCurrentWorker10Map,currentWorker10Config,stableWorkerDigest,verifySnapshotFingerprint}
 from './stage-current-bot10-stars.mjs';

const GAME='9b0b533f-540a-4a25-a429-70ca8bd4e23d';
const PAY='06079270-a227-466a-9991-abd4201ec5f6';
const SOURCES=['money.js','broadcast.js','creator.js','gamedata.js',
 'progress.js','modes.js','game.js','support.js','admin.js','worker.js'];
const game="export async function withAccount(env, id, fn) {return fn();} "+
 "export async function creditAccount(env, id, coins, mutate) {return coins;}";
const worker="import './progress.js'; import './game.js'; "+
 "async function onUpdate(upd, env) {return upd;} export default {fetch() {}}";
function mockMap(sources=SOURCES,source=sources.map(n=>n==='worker.js'?worker:
 n==='game.js'?game:'// '+n+'\nconst value=12345678901234567890;')){
 const data={version:3,sources,sourcesContent:source};
 const boundary='--rustupboundary1234567890';
 return boundary+'\r\nContent-Disposition: form-data; name="map"; filename="worker.js.map"'+
  '\r\nContent-Type: application/json\r\n\r\n'+JSON.stringify(data)+
  '\r\n'+boundary+'--';
}
function liveSettings(){
 return {compatibility_date:'2025-06-01',compatibility_flags:[],bindings:[
   ...['BOT_TOKEN','WEBHOOK_SECRET','ADMIN_BOT_TOKEN','CLIPS_BOT_TOKEN']
    .map(name=>({name,type:'secret_text'})),
   {name:'APP_URL',type:'plain_text',text:'https://ttzoomrust-hub.github.io/rust-up/'},
   {name:'DB',type:'d1',id:GAME},
   {name:'CHANNEL',type:'plain_text',text:'@bot'}
 ]};
}
const cron={schedules:[{cron:'* * * * *'}]};
test('exact current 10-module bot source is recoverable, with games untouched',()=>{
 const source=readCurrentWorker10Map(mockMap());
 assert.deepEqual([...source.keys()],SOURCES);
 assert.equal(source.get('game.js'),game);
 assert.equal(source.get('worker.js'),worker);
 assert.throws(()=>readCurrentWorker10Map(mockMap(SOURCES.slice(1))),/ten_modules/);
 assert.throws(()=>readCurrentWorker10Map(mockMap([...SOURCES.slice(0,4),
  'mystery.js',...SOURCES.slice(5)])),/ten_modules/);
 assert.throws(()=>readCurrentWorker10Map('html is not a worker map'),/untrusted_worker_content/);
});
test('new isolated payment binding can be added without enabling any payments',()=>{
 const c=currentWorker10Config(liveSettings(),cron);
 assert.match(c,/binding = "DB"/);
 assert.match(c,/binding = "PAYMENTS_DB"/);
 assert.match(c,/keep_vars = true/);
 assert.match(c,/upload_source_maps = true/);
 assert.match(c,/worker\.stars-commerce\.bundle\.js/);
 for(const flag of ['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
  'STARS_REFUNDS_ENABLED','STARS_FIXED_PRODUCTS_ENABLED',
  'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
  'PAYMENT_WALLET_STRICT_MODE'])
  assert.ok(c.includes(flag+' = "false"'),flag);
 assert.match(c,/crons = \["\* \* \* \* \*"\]/);
});
test('drift in crons, secrets, wallet DB or active payment flags aborts staging',()=>{
 const a=liveSettings();
 a.bindings.find(b=>b.name==='DB').id='wrong';
 assert.throws(()=>currentWorker10Config(a,cron),/game_db_mismatch/);
 const b=liveSettings();b.bindings.push({name:'PAYMENTS_DB',type:'d1',id:'wrong'});
 assert.throws(()=>currentWorker10Config(b,cron),/payments_db_conflict/);
 const c=liveSettings();c.bindings.push({name:'STARS_PAYMENT_ENABLED',type:'plain_text',text:'true'});
 assert.throws(()=>currentWorker10Config(c,cron),/real_money_gate_must_be_off/);
 const d=liveSettings();d.bindings=d.bindings.filter(x=>x.name!=='BOT_TOKEN');
 assert.throws(()=>currentWorker10Config(d,cron),/missing_original_bot_secret/);
 assert.throws(()=>currentWorker10Config(liveSettings(),{schedules:[]}),/existing_cron_changed/);
});
test('staged fixed-commerce adapter includes consent, Telegram receipts, refunds and badges',()=>{
 const c=readFileSync(new URL('./stage-current-bot10-stars.mjs',import.meta.url),'utf8');
 for(const file of ['stars-existing-worker-wrapper.mjs','stars-live-bridge.mjs',
  'stars-terms.mjs','refunds.mjs','stars.mjs','supporter-badge.mjs'])
  assert.ok(c.includes("'"+file+"'"),file);
 assert.match(c,/live_worker_changed_since_private_snapshot/);
});

test('Cloudflare changing multipart boundaries never triggers false source drift',()=>{
 const a=readCurrentWorker10Map(mockMap());
 const b=readCurrentWorker10Map(mockMap().replaceAll(
  '--rustupboundary1234567890','--otherboundary1234567890'));
 assert.equal(stableWorkerDigest(a),stableWorkerDigest(b));
 const modified=new Map(b);
 modified.set('game.js',modified.get('game.js')+'\n// changed');
 assert.notEqual(stableWorkerDigest(a),stableWorkerDigest(modified));
 const reordered=new Map([...a].reverse());
 assert.throws(()=>stableWorkerDigest(reordered),/untrusted_worker_source_set/);
});
test('new snapshot requires stable source fingerprint and metadata match',()=>{
 const source=readCurrentWorker10Map(mockMap());
 const digest=stableWorkerDigest(source);
 const added=['worker.stars-commerce-entry.mjs','stars-existing-worker-wrapper.mjs',
 'stars-live-bridge.mjs','stars-terms.mjs','payment-controls.mjs',
 'refunds.mjs','stars.mjs','telegram-initdata.mjs','supporter-badge.mjs'];
 const valid={version:2,workerDigest:digest,metadataDigest:'metadata',
   sourceFiles:SOURCES,addedFiles:added};
 assert.equal(verifySnapshotFingerprint(valid,{workerDigest:digest,metadataDigest:'metadata'}),true);
 assert.throws(()=>verifySnapshotFingerprint({...valid,workerDigest:'wrong'},
  {workerDigest:digest,metadataDigest:'metadata'}),/live_worker_changed/);
 assert.throws(()=>verifySnapshotFingerprint(valid,{workerDigest:digest,metadataDigest:'changed'}),/live_worker_changed/);
 assert.throws(()=>verifySnapshotFingerprint({...valid,sourceFiles:SOURCES.slice(1)},
  {workerDigest:digest,metadataDigest:'metadata'}),/live_worker_changed/);
});
test('existing version 1 backups remain comparable with exact byte-by-byte file checks',()=>{
 const source=readCurrentWorker10Map(mockMap());
 const digest=stableWorkerDigest(source);
 const added=['worker.stars-commerce-entry.mjs','stars-existing-worker-wrapper.mjs',
 'stars-live-bridge.mjs','stars-terms.mjs','payment-controls.mjs',
 'refunds.mjs','stars.mjs','telegram-initdata.mjs','supporter-badge.mjs'];
 // Version 1 stored the hash of a random Cloudflare response envelope.
 const legacy={version:1,workerDigest:'old-envelope-hash',metadataDigest:'metadata',
  sourceFiles:SOURCES,addedFiles:added};
 assert.equal(verifySnapshotFingerprint(legacy,{workerDigest:digest,metadataDigest:'metadata'}),true);
 assert.throws(()=>verifySnapshotFingerprint({...legacy,addedFiles:[]},
  {workerDigest:digest,metadataDigest:'metadata'}),/live_worker_changed/);
 assert.throws(()=>verifySnapshotFingerprint(legacy,{workerDigest:digest,metadataDigest:'new-metadata'}),/live_worker_changed/);
});
