import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {commerceConfig} from './stage-current-stars-commerce.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const T='9b0b533f-540a-4a25-a429-70ca8bd4e23d';
const S='06079270-a227-466a-9991-abd4201ec5f6';
const settings={compatibility_date:'2025-06-01',compatibility_flags:[],bindings:[
 ...['BOT_TOKEN','WEBHOOK_SECRET','ADMIN_BOT_TOKEN','CLIPS_BOT_TOKEN'].map(name=>({name,type:'secret_text'})),
 {name:'APP_URL',type:'plain_text',text:'https://ttzoomrust-hub.github.io/rust-up/'},
 {name:'DB',type:'d1',id:T},{name:'PAYMENTS_DB',type:'d1',id:S},
 ...['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED','STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED']
 .map(name=>({name,type:'plain_text',text:'false'}))
]};
const cron={schedules:[{cron:'* * * * *'}]};

test('stages exact current bot with full Stars fixed-goods adapter but hard gates OFF',()=>{
 const c=commerceConfig(settings,cron);
 assert.match(c,/worker\.stars-commerce\.bundle\.js/);
 assert.match(c,/keep_vars = true/);
 assert.match(c,/binding = "DB"/);
 assert.match(c,/binding = "PAYMENTS_DB"/);
 assert.match(c,/STARS_PAYMENT_ENABLED = "false"/);
 assert.match(c,/STARS_REFUNDS_ENABLED = "false"/);
 assert.match(c,/PAYMENT_PRODUCTION_ENABLED = "false"/);
 assert.match(c,/crons = \["\* \* \* \* \*"\]/);
});
test('hard fails if finance gate, D1 or cron has changed',()=>{
 const changed=structuredClone(settings);
 changed.bindings.find(x=>x.name==='PAYMENT_PRODUCTION_ENABLED').text='true';
 assert.throws(()=>commerceConfig(changed,cron),/payment_gate_must_remain_disabled/);
 assert.throws(()=>commerceConfig(settings,{schedules:[]}),/live_cron_changed/);
});
test('checkout source and exact webhook wrapper preserve payment safety guards',()=>{
 const base=path.join(root,'integration','telegram-stars');
 const entry=fs.readFileSync(path.join(base,'worker.stars-commerce-entry.mjs'),'utf8');
 const wrapper=fs.readFileSync(path.join(base,'stars-existing-worker-wrapper.mjs'),'utf8');
 const bridge=fs.readFileSync(path.join(base,'stars-live-bridge.mjs'),'utf8');
 assert.match(entry,/wrapExistingWorker\(base\)/);
 assert.match(wrapper,/X-Telegram-Bot-Api-Secret-Token/);
 assert.match(wrapper,/receiveStars\(update,env,fetchImpl\)/);
 assert.match(bridge,/stars_invoice_link_not_persisted/);
 assert.match(bridge,/prior_stars_payment_requires_reconciliation/);
 assert.match(bridge,/recordUnexpectedReceipt/);
 assert.match(bridge,/readOnly\?86400:600/);
});
