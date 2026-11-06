import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseSupportedLiveWorker,liveSourceFingerprint,
 liveMetadataFingerprint,safeWorkerConfig}
 from './stage-current-verified-worker.mjs';

const DB='9b0b533f-540a-4a25-a429-70ca8bd4e23d';
const PAY='06079270-a227-466a-9991-abd4201ec5f6';
const a10=['money.js','broadcast.js','creator.js','gamedata.js',
 'progress.js','modes.js','game.js','support.js','admin.js','worker.js'];
const a12=['money.js','broadcast.js','creator.js','gamedata.js',
 'progress.js','fairlib.js','modes.js','social.js','game.js','support.js',
 'admin.js','worker.js'];
const a13=['money.js','broadcast.js','creator.js','gamedata.js',
 'progress.js','fairlib.js','modes.js','social.js','game.js','brand.js',
 'support.js','admin.js','worker.js'];
const a13w=['money.js','broadcast.js','gamedata.js','progress.js',
 'fairlib.js','modes.js','game.js','social.js','creator.js','brand.js',
 'support.js','admin.js','worker.js'];
const stars=['stars.mjs','telegram-initdata.mjs','payment-controls.mjs',
 'supporter-badge.mjs','stars-terms.mjs','stars-live-bridge.mjs',
 'refunds.mjs','stars-existing-worker-wrapper.mjs',
 'worker.stars-commerce-entry.mjs'];
function code(name){
 const start=name==='worker.js'?
  'import {brand} from "./brand.js"; export default {fetch(){}};async function onUpdate(upd, env) {}':
  name==='game.js'?
  'export async function withAccount(env, id, fn) {}\n'+
  'export async function creditAccount(env, id, coins, mutate) {}':
  name==='worker.stars-commerce-entry.mjs'?
  'import {wrapExistingWorker} from "./stars-existing-worker-wrapper.mjs";':
  name==='stars-existing-worker-wrapper.mjs'?
  "const webhook='X-Telegram-Bot-Api-Secret-Token';":
  '// '+name;
 return start+'\nconst filler="'+('x'.repeat(140))+'";';
}
function multi(names,mark='--rustupWorkerBoundaryTest',overrides={}){
 const map={version:3,sources:names,sourcesContent:names.map(n=>overrides[n]||code(n))};
 return mark+'\r\nContent-Disposition: form-data; name="map"; filename="worker.js.map"\r\n'+
  'Content-Type: application/json\r\n\r\n'+JSON.stringify(map)+'\r\n'+mark+'--';
}
function env(){
 return {compatibility_date:'2025-06-01',compatibility_flags:[],bindings:[
  ...['BOT_TOKEN','WEBHOOK_SECRET','ADMIN_BOT_TOKEN','CLIPS_BOT_TOKEN']
   .map(name=>({name,type:'secret_text'})),
  {name:'APP_URL',type:'plain_text',text:'https://ttzoomrust-hub.github.io/rust-up/'},
  {name:'DB',type:'d1',id:DB},{name:'PAYMENTS_DB',type:'d1',id:PAY},
  ...['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
  'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
  'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
  'PAYMENT_WALLET_STRICT_MODE'].map(name=>({name,type:'plain_text',text:'false'}))
 ]};
}
const schedule={schedules:[{cron:'* * * * *'}]};
test('exact 10/12/13/19/21/22-module Worker layouts are supported',()=>{
 for(const original of [a10,a12,a13,a13w]){
  for(const addon of [[],stars]){
   const names=[...original,...addon];
   const parsed=parseSupportedLiveWorker(multi(names));
   assert.deepEqual([...parsed.files.keys()],names);
   assert.deepEqual(parsed.layout.original,original);
   assert.equal(parsed.layout.activeStars,addon.length>0);
  }
 }
});
test('current 12-module Worker stages fairlib and social without rewriting game',()=>{
 const out=parseSupportedLiveWorker(multi(a12));
 assert.ok(out.files.has('fairlib.js'));
 assert.ok(out.files.has('social.js'));
 assert.equal(out.files.get('game.js'),code('game.js'));
 assert.equal(out.layout.original.length,12);
});
test('exact current live 13-module layout preserves brand and game bot without rewriting',()=>{
 const out=parseSupportedLiveWorker(multi(a13));
 assert.deepEqual(out.layout.original,a13);
 assert.equal(out.layout.activeStars,false);
 assert.equal(out.files.get('brand.js'),code('brand.js'));
 assert.equal(out.files.get('game.js'),code('game.js'));
 assert.equal(out.files.get('worker.js'),code('worker.js'));
 assert.equal(out.layout.original.length,13);
 const withStars=parseSupportedLiveWorker(multi([...a13,...stars]));
 assert.equal(withStars.layout.original.length,13);
 assert.equal(withStars.layout.activeStars,true);
});

test('alternate live Wrangler 13-module order is preserved byte-for-byte',()=>{
 const parsed=parseSupportedLiveWorker(multi(a13w));
 assert.deepEqual(parsed.layout.original,a13w);
 assert.equal(parsed.files.get('worker.js'),code('worker.js'));
 assert.equal(parsed.files.get('game.js'),code('game.js'));
 const extended=parseSupportedLiveWorker(multi([...a13w,...stars]));
 assert.equal(extended.layout.original.length,13);
 assert.equal(extended.layout.activeStars,true);
});
test('brand.js can only be accepted in exact observed order and when the Worker imports it',()=>{
 const moved=[...a13];
 moved.splice(moved.indexOf('brand.js'),1);
 moved.splice(2,0,'brand.js');
 assert.throws(()=>parseSupportedLiveWorker(multi(moved)),
  /unreviewed_worker_module_layout/);
 assert.throws(()=>parseSupportedLiveWorker(
  multi(a13,undefined,{'worker.js':code('worker.js')
   .replace('./brand.js','./unrelated.js')})
 ),/current_brand_module_import_missing/);
});

test('an altered module count, source map or bot/game contract fails closed',()=>{
 assert.throws(()=>parseSupportedLiveWorker(multi(a12.slice(1))),
  /unreviewed_worker_module_layout/);
 assert.throws(()=>parseSupportedLiveWorker(multi([...a12.slice(0,5),
  'suspicious.js',...a12.slice(6)])),/unreviewed_worker_module_layout/);
 assert.throws(()=>parseSupportedLiveWorker(multi([...a12,...stars.slice(0,-1)])),
  /unreviewed_worker_module_layout/);
 assert.throws(()=>parseSupportedLiveWorker(multi(a12).replace(
  'async function onUpdate','async function onHack')),/original_game_or_bot_contract_changed/);
});
test('Cloudflare multipart boundaries cannot cause false source-drift warnings',()=>{
 const x=parseSupportedLiveWorker(multi(a12));
 const y=parseSupportedLiveWorker(multi(a12,'--differentBoundary123456'));
 assert.equal(liveSourceFingerprint(x),liveSourceFingerprint(y));
 const modified=parseSupportedLiveWorker(multi(a12));
 modified.files.set('game.js',modified.files.get('game.js')+'// changed');
 assert.notEqual(liveSourceFingerprint(x),liveSourceFingerprint(modified));
});
test('the single safe Worker config always disables all seven payment gates',()=>{
 const config=safeWorkerConfig(env(),schedule);
 assert.match(config,/binding = "DB"/);
 assert.match(config,/binding = "PAYMENTS_DB"/);
 assert.match(config,/keep_vars = true/);
 assert.match(config,/upload_source_maps = true/);
 for(const k of ['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
  'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
  'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
  'PAYMENT_WALLET_STRICT_MODE'])
  assert.ok(config.includes(k+' = "false"'),k);
 assert.match(config,/crons = \["\* \* \* \* \*"\]/);
});
test('configuration or version drift blocks the Worker release',()=>{
 const changed=env();changed.bindings.find(b=>b.name==='DB').id='wrong';
 assert.throws(()=>safeWorkerConfig(changed,schedule),/game_db_mismatch/);
 const enabled=env();
 enabled.bindings.find(b=>b.name==='STARS_PAYMENT_ENABLED').text='true';
 assert.throws(()=>safeWorkerConfig(enabled,schedule),/real_money_gate_must_be_off/);
 assert.throws(()=>safeWorkerConfig(env(),{schedules:[]}),/existing_cron_changed/);
 const hash=liveMetadataFingerprint(env(),schedule,'worker-version-123456');
 assert.notEqual(hash,liveMetadataFingerprint(env(),schedule,'other-version-23456'));
});
test('no paid-game delivery or external wallet integration is in this stage',()=>{
 const src=readFileSync(new URL('./stage-current-verified-worker.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(src,/deliverVerifiedVariableStarsCredit\(/);
 assert.doesNotMatch(src,/STARS_GAME_CREDIT_SETTLEMENT_ENABLED = "true"/);
 assert.match(src,/live_worker_changed_since_private_recovery/);
 assert.match(src,/reviewed_stars_adapter_file_changed_/);
});
