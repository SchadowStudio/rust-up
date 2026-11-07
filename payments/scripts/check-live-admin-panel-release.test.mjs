import test from 'node:test';
import assert from 'node:assert/strict';
import {checkLivePaymentPanelDeployment} from './check-live-admin-panel-release.mjs';
const originalVersion='5bb816ee-965b-49a5-9493-f05bea973e67';
const deployment=()=>({deployments:[{versions:[{version_id:originalVersion}]}]});
const settings=()=>({compatibility_date:'2025-06-01',bindings:[
 ...['BOT_TOKEN','WEBHOOK_SECRET','ADMIN_BOT_TOKEN','CLIPS_BOT_TOKEN'].map(name=>({name,type:'secret_text'})),
 {name:'DB',type:'d1',id:'9b0b533f-540a-4a25-a429-70ca8bd4e23d'},
 {name:'PAYMENTS_DB',type:'d1',id:'06079270-a227-466a-9991-abd4201ec5f6'},
 {name:'PAYMENT_PRODUCTION_ENABLED',type:'plain_text',text:'false'}
]});
const cron=()=>({schedules:[{cron:'* * * * *'}]});
test('unchanged live worker and safe bindings pass',()=>assert.equal(checkLivePaymentPanelDeployment(deployment(),settings(),cron()),true));
test('concurrent deployment blocks release',()=>{
 const d=deployment();d.deployments[0].versions[0].version_id='some-new-release';
 assert.throws(()=>checkLivePaymentPanelDeployment(d,settings(),cron()),/live_worker_version_changed/);
});
test('missing secret, changed DB or enabled production gate block release',()=>{
 const s=settings();s.bindings=s.bindings.filter(b=>b.name!=='ADMIN_BOT_TOKEN');
 assert.throws(()=>checkLivePaymentPanelDeployment(deployment(),s,cron()),/missing_bot_secret/);
 const q=settings();q.bindings.find(b=>b.name==='PAYMENTS_DB').id='wrong';
 assert.throws(()=>checkLivePaymentPanelDeployment(deployment(),q,cron()),/database_binding_changed/);
 const k=settings();k.bindings.find(b=>b.name==='PAYMENT_PRODUCTION_ENABLED').text='true';
 assert.throws(()=>checkLivePaymentPanelDeployment(deployment(),k,cron()),/production_payment_gate/);
});
test('Cron change blocks release',()=>{
 assert.throws(()=>checkLivePaymentPanelDeployment(deployment(),settings(),{schedules:[{cron:'*/5 * * * *'}]}),/cron_changed/);
});
