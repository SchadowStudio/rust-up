import test from 'node:test';
import assert from 'node:assert/strict';
import {variableStagingConfig} from './stage-current-variable-stars.mjs';

const STAT='9b0b533f-540a-4a25-a429-70ca8bd4e23d';
const STARS='06079270-a227-466a-9991-abd4201ec5f6';
const bindings=[
 ...['BOT_TOKEN','WEBHOOK_SECRET','ADMIN_BOT_TOKEN','CLIPS_BOT_TOKEN']
  .map(name=>({name,type:'secret_text'})),
 {name:'APP_URL',type:'plain_text',text:'https://ttzoomrust-hub.github.io/rust-up/'},
 {name:'DB',type:'d1',id:STAT},{name:'PAYMENTS_DB',type:'d1',id:STARS},
 ...['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
  'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED']
  .map(name=>({name,type:'plain_text',text:'false'}))
];
const settings={compatibility_date:'2025-06-01',compatibility_flags:[],bindings};
const cron={schedules:[{cron:'* * * * *'}]};
test('current Worker stages with variable amount routes and all money gates OFF',()=>{
 const config=variableStagingConfig(settings,cron);
 assert.match(config,/worker\.stars-variable\.bundle\.js/);
 assert.match(config,/binding = "DB"/);
 assert.match(config,/binding = "PAYMENTS_DB"/);
 for(const flag of ['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
  'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
  'PAYMENT_WALLET_STRICT_MODE']){
   assert.ok(config.includes(flag+' = "false"'));
 }
 assert.match(config,/keep_vars = true/);
 assert.match(config,/upload_source_maps = true/);
});
test('production gate cannot turn on when preparing noncharging release',()=>{
 const modified=structuredClone(settings);
 modified.bindings.find(x=>x.name==='STARS_PAYMENT_ENABLED').text='true';
 assert.throws(()=>variableStagingConfig(modified,cron),/payment_gate_must_remain_disabled/);
 assert.throws(()=>variableStagingConfig(settings,{schedules:[]}),/live_cron_changed/);
});
