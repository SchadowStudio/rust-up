import test from 'node:test';
import assert from 'node:assert/strict';
import {extractCurrentLiveModule,unwrapOnlyReviewedStarsLayer,darkConfig}
 from './stage-current-rustup-dark-release.mjs';

const baseline=[
 '/* '+'.'.repeat(120000)+' */',
 'var worker_default = {fetch(){},scheduled(){}};',
 'function wrapHistoryOnlyWorker(v){return v}',
 'function wrapCurrentStarsWebhook(v){return v}',
 'const stars_game_credit = true;',
 'const refDeposit = class {};',
 'var worker_stars_webhook_only_entry_default = wrapCurrentStarsWebhook(wrapHistoryOnlyWorker(worker_default));',
 'export {',
 '  worker_stars_webhook_only_entry_default as default,',
 '  refDeposit',
 '};',
 '//# sourceMappingURL=worker.stars-auth-reason.bundle.js.map'
].join('\n');
function multipart(body=baseline) {
 return '--abcd1234abcd1234abcd1234abcd1234\r\n'+
  'Content-Disposition: form-data; name="worker.telegram-gateway-live-hotfix.mjs"; filename="worker.telegram-gateway-live-hotfix.mjs"\r\n'+
  'Content-Type: application/javascript+module\r\n\r\n'+body+'\r\n'+
  '--abcd1234abcd1234abcd1234abcd1234--\r\n';
}
function fixture(){
 const secrets=['BOT_TOKEN','WEBHOOK_SECRET','ADMIN_BOT_TOKEN','CLIPS_BOT_TOKEN',
  'STARS_GAME_CREDIT_SETTLEMENT_ENABLED',
  'STARS_GAME_CREDIT_REFUND_RECONCILIATION_ENABLED',
  'STARS_VARIABLE_CHECKOUT_RELEASE_APPROVED'];
 return {
  settings:{compatibility_date:'2025-06-01',compatibility_flags:[],
   bindings:[...secrets.map(name=>({name,type:'secret_text'})),
    {name:'STARS_PAYMENT_ENABLED',type:'plain_text',text:'false'},
    {name:'STARS_VARIABLE_TOPUP_ENABLED',type:'plain_text',text:'false'},
    {name:'PAYMENT_PRODUCTION_ENABLED',type:'plain_text',text:'true'},
    {name:'BOT_USERNAME',type:'plain_text',text:'rustuper_bot'},
    {name:'DB',type:'d1',id:'9b0b533f-540a-4a25-a429-70ca8bd4e23d'},
    {name:'PAYMENTS_DB',type:'d1',id:'06079270-a227-466a-9991-abd4201ec5f6'}
   ]},
  schedules:{schedules:[{cron:'* * * * *'}]}
 };
}
test('only exact live module is extracted; original source remains intact',()=>{
 assert.equal(extractCurrentLiveModule(multipart()),baseline);
 assert.throws(()=>extractCurrentLiveModule(multipart().replace(
  'worker.telegram-gateway-live-hotfix.mjs','unreviewed.mjs')),/filename_changed/);
 assert.throws(()=>extractCurrentLiveModule(multipart().replace(
  'stars_game_credit','missing_game_credit')),/live_worker_contract/);
});
test('strip only reviewed old default wrapper; preserve original game and refDeposit',()=>{
 const changed=unwrapOnlyReviewedStarsLayer(baseline);
 assert.match(changed,/rustup_readonly_live_worker as default, refDeposit/);
 assert.match(changed,/wrapHistoryOnlyWorker\(worker_default\)/);
 assert.doesNotMatch(changed,/sourceMappingURL=/);
 assert.match(changed,/worker_stars_webhook_only_entry_default = wrapCurrentStarsWebhook/);
 assert.throws(()=>unwrapOnlyReviewedStarsLayer('export {default as default}'),
  /reviewed_worker_export_changed/);
});
test('live config keeps existing payment production state, secrets, D1 and cron but Stars OFF',()=>{
 const {settings,schedules}=fixture();
 const config=darkConfig(settings,schedules);
 assert.match(config,/PAYMENT_PRODUCTION_ENABLED = "true"/);
 assert.match(config,/STARS_PAYMENT_ENABLED = "false"/);
 assert.match(config,/STARS_VARIABLE_TOPUP_ENABLED = "false"/);
 assert.match(config,/keep_vars = true/);
 assert.match(config,/binding = "DB"/);
 assert.match(config,/binding = "PAYMENTS_DB"/);
 assert.match(config,/crons = \["\* \* \* \* \*"\]/);
 assert.doesNotMatch(config,/STARS_GAME_CREDIT_SETTLEMENT_ENABLED =/);
});
test('reject changes to Stars charging, D1, original cron or security secrets',()=>{
 const x=fixture();
 for(const change of [
  a=>a.settings.bindings.find(b=>b.name==='STARS_PAYMENT_ENABLED').text='true',
  a=>a.settings.bindings.find(b=>b.name==='PAYMENTS_DB').id='wrong',
  a=>a.settings.bindings.find(b=>b.name==='WEBHOOK_SECRET').type='plain_text',
  a=>a.schedules.schedules[0].cron='*/5 * * * *'
 ]){
  const f=structuredClone(x);
  change(f);
  assert.throws(()=>darkConfig(f.settings,f.schedules),/rustup_dark_release_/);
 }
});
