import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 parseCurrent19Map,sourceFingerprint,metadataFingerprint,
 buildCurrent19SafeConfig
} from './stage-current-bot19-stars.mjs';

const GAME='9b0b533f-540a-4a25-a429-70ca8bd4e23d';
const PAYMENT='06079270-a227-466a-9991-abd4201ec5f6';
const ORIGINAL=['money.js','broadcast.js','creator.js','gamedata.js',
 'progress.js','modes.js','game.js','support.js','admin.js','worker.js'];
const ADDON=['stars.mjs','telegram-initdata.mjs','payment-controls.mjs',
 'supporter-badge.mjs','stars-terms.mjs','stars-live-bridge.mjs',
 'refunds.mjs','stars-existing-worker-wrapper.mjs','worker.stars-commerce-entry.mjs'];
const FILES=[...ORIGINAL,...ADDON];
function source(name){
 const prefix= name==='worker.js'?
  'async function onUpdate(upd, env) {return upd;}':
  name==='game.js'?
   'export async function withAccount(env, id, fn) {}\n'+
   'export async function creditAccount(env, id, coins, mutate) {}':
  name==='worker.stars-commerce-entry.mjs'?
   'import {wrapExistingWorker} from "./stars-existing-worker-wrapper.mjs";':
  name==='stars-existing-worker-wrapper.mjs'?
   "const key='X-Telegram-Bot-Api-Secret-Token';":
   '// '+name;
 return prefix+'\n'+'const filler = "'+'x'.repeat(160)+'";';
}
function mockMap(names=FILES,boundary='--rustupCurrent19BoundaryTest'){
 const map={version:3,sources:names,sourcesContent:names.map(source)};
 return boundary+'\r\nContent-Disposition: form-data; name="map"; filename="worker.js.map"\r\n'+
  'Content-Type: application/json\r\n\r\n'+JSON.stringify(map)+
  '\r\n'+boundary+'--';
}
function env(){
 return {compatibility_date:'2025-06-01',compatibility_flags:[],bindings:[
  ...['BOT_TOKEN','WEBHOOK_SECRET','ADMIN_BOT_TOKEN','CLIPS_BOT_TOKEN']
   .map(name=>({name,type:'secret_text'})),
  {name:'APP_URL',type:'plain_text',text:'https://ttzoomrust-hub.github.io/rust-up/'},
  {name:'DB',type:'d1',id:GAME},{name:'PAYMENTS_DB',type:'d1',id:PAYMENT},
  ...['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
   'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
   'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
   'PAYMENT_WALLET_STRICT_MODE']
   .map(name=>({name,type:'plain_text',text:'false'}))
 ]};
}
const cron={schedules:[{cron:'* * * * *'}]};
test('parses exactly the current 19-source bot and retains all 10 original modules',()=>{
 const sources=parseCurrent19Map(mockMap());
 assert.deepEqual([...sources.keys()],FILES);
 assert.deepEqual([...sources.keys()].slice(0,10),ORIGINAL);
 assert.ok(sources.get('game.js').includes('creditAccount'));
});
test('Cloudflare multipart boundaries do not change source fingerprints',()=>{
 const left=parseCurrent19Map(mockMap());
 const right=parseCurrent19Map(mockMap(FILES,'--differentBoundary12345'));
 assert.equal(sourceFingerprint(left),sourceFingerprint(right));
 const modified=new Map(right);
 modified.set('game.js',modified.get('game.js')+'\n// unexpected');
 assert.notEqual(sourceFingerprint(left),sourceFingerprint(modified));
});
test('unexpected module count, order or live bot source fails closed',()=>{
 assert.throws(()=>parseCurrent19Map(mockMap(FILES.slice(1))),/nineteen_modules/);
 assert.throws(()=>parseCurrent19Map(mockMap([...FILES.slice(0,10),
  'unknown-payment.mjs',...FILES.slice(11)])),/nineteen_modules/);
 const wrong=new Map([...parseCurrent19Map(mockMap())].reverse());
 assert.throws(()=>sourceFingerprint(wrong),/invalid_19_module_source_set/);
 assert.throws(()=>parseCurrent19Map(mockMap().replace(
  'async function onUpdate','async function hackedUpdate')),/source_changed/);
});
test('current nineteen-module config has both database bindings and payment OFF',()=>{
 const config=buildCurrent19SafeConfig(env(),cron);
 assert.match(config,/main = "\.\/worker\.stars-commerce\.bundle\.js"/);
 assert.match(config,/binding = "DB"/);
 assert.match(config,/binding = "PAYMENTS_DB"/);
 assert.match(config,/keep_vars = true/);
 assert.match(config,/upload_source_maps = true/);
 assert.match(config,/crons = \["\* \* \* \* \*"\]/);
 for(const name of ['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
  'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
  'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
  'PAYMENT_WALLET_STRICT_MODE'])
  assert.ok(config.includes(name+' = "false"'),name);
});
test('activating any payment switch or changing D1, secrets or cron blocks build',()=>{
 const changed=env();
 changed.bindings.find(b=>b.name==='PAYMENTS_DB').id='wrong';
 assert.throws(()=>buildCurrent19SafeConfig(changed,cron),/payments_db_conflict/);
 const pay=env();
 pay.bindings.find(b=>b.name==='STARS_PAYMENT_ENABLED').text='true';
 assert.throws(()=>buildCurrent19SafeConfig(pay,cron),/real_money_gate_must_be_off/);
 const secret=env();secret.bindings=secret.bindings.filter(b=>b.name!=='BOT_TOKEN');
 assert.throws(()=>buildCurrent19SafeConfig(secret,cron),/missing_original_bot_secret/);
 assert.throws(()=>buildCurrent19SafeConfig(env(),{schedules:[]}),/existing_cron_changed/);
});
test('metadata locks worker version and source/config settings',()=>{
 const a=metadataFingerprint(env(),cron,'version-one');
 const b=metadataFingerprint(env(),cron,'version-two');
 assert.notEqual(a,b);
 const changed=env();
 changed.bindings.push({name:'STARS_TERMS_URL',type:'plain_text',text:'https://example.test'});
 assert.notEqual(a,metadataFingerprint(changed,cron,'version-one'));
});
test('stage script is disconnected from all paid-game settlement adapters',()=>{
 const src=readFileSync(new URL('./stage-current-bot19-stars.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(src,/deliverVerifiedVariableStarsCredit|reconcileVerifiedStarsGameRefund/);
 assert.match(src,/current19_live_worker_changed_since_stage/);
 assert.match(src,/reviewed_stars_adapter_changed_/);
 assert.match(src,/original_game_or_bot_changed_/);
});
