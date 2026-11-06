import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnoseCompetingWorkerPublishers}
 from './audit-worker-publishers.mjs';

const NOW=Date.parse('2026-11-06T01:35:00Z');
const TAG='hidden-cloudflare-script-tag';
const FLAGS=['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
 'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
 'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
 'PAYMENT_WALLET_STRICT_MODE'];
function input(){
 return {
  now:NOW,
  deployments:[
   {created_on:'2026-11-06T01:31:10Z',versions:[{version_id:'new-no-payment-db'}]},
   {created_on:'2026-11-06T01:13:18Z',versions:[{version_id:'safe-stars'}]}
  ],
  auditLogs:[
   {when:'2026-11-06T01:31:09Z',
    action:{type:'script_update'},metadata:{script_tag:TAG},
    actor:{id:'private-user-actor-one',email:'never-display@invalid.test'}},
   {when:'2026-11-06T01:13:17Z',
    action:{type:'script_update'},metadata:{script_tag:TAG},
    actor:{id:'private-user-actor-two',email:'other-private@invalid.test'}},
   {when:'2026-11-06T01:12:50Z',
    action:{type:'script_update'},metadata:{script_tag:'other-worker-script'},
    actor:{id:'third-private-actor',email:'third@invalid.test'}}
  ],
  bindings:[
   {name:'DB',type:'d1',id:'9b0b533f-540a-4a25-a429-70ca8bd4e23d'},
   {name:'PAYMENTS_DB',type:'d1',id:'06079270-a227-466a-9991-abd4201ec5f6'},
   ...FLAGS.map(name=>({name,type:'plain_text',text:'false'}))
  ]
 };
}
test('separate Cloudflare publishers for same Worker are identified without actor IDs',()=>{
 const x=diagnoseCompetingWorkerPublishers(input());
 assert.equal(x.distinctRecentPublisherCount,2);
 assert.equal(x.hasConflictingDeployers,true);
 assert.equal(x.paymentDbBound,true);
 assert.equal(x.allPaymentFlagsOff,true);
 assert.deepEqual(x.blockers,['multiple_wrangler_publishers_on_same_worker']);
 const text=JSON.stringify(x);
 for(const secret of ['private-user-actor-one','private-user-actor-two',
  'never-display@invalid.test','other-private@invalid.test',TAG])
  assert.equal(text.includes(secret),false);
 assert.equal(x.changedPayments,false);
 assert.equal(x.readyForUnattendedPayments,false);
});
test('missing payments D1 and unset release flags report independent blockers',()=>{
 const x=input();
 x.bindings=x.bindings.filter(b=>b.name!=='PAYMENTS_DB');
 x.bindings=x.bindings.filter(b=>b.name!=='STARS_PAYMENT_ENABLED');
 const r=diagnoseCompetingWorkerPublishers(x);
 assert.ok(r.blockers.includes('payment_d1_binding_was_overwritten'));
 assert.ok(r.blockers.includes('payment_flags_are_missing_or_unsafe'));
 assert.equal(r.paymentDbBound,false);
 assert.equal(r.paymentFlags.STARS_PAYMENT_ENABLED,'MISSING');
});
test('one Wrangler actor and exact D1/flags creates no drift warnings',()=>{
 const x=input();
 x.auditLogs.splice(1,1);
 const result=diagnoseCompetingWorkerPublishers(x);
 assert.equal(result.distinctRecentPublisherCount,1);
 assert.equal(result.hasConflictingDeployers,false);
 assert.deepEqual(result.blockers,[]);
});
test('unmatched timestamps and missing audit evidence never invent publishers',()=>{
 const x=input();
 x.auditLogs=x.auditLogs.filter(a=>a.metadata.script_tag==='other-worker-script');
 assert.throws(()=>diagnoseCompetingWorkerPublishers(x),/identity_ambiguous/);
 assert.throws(()=>diagnoseCompetingWorkerPublishers({}),/evidence_missing/);
 const y=input();y.deployments=[];
 assert.throws(()=>diagnoseCompetingWorkerPublishers(y),/history_missing/);
});

test('ambiguous simultaneous updates for separate Workers abort instead of guessing ownership',()=>{
 const x=input();
 x.auditLogs.push({
  when:'2026-11-06T01:31:09Z',
  action:{type:'script_update'},
  metadata:{script_tag:'another-script-at-same-second'},
  actor:{id:'third-actor-never-display'}
 });
 assert.throws(()=>diagnoseCompetingWorkerPublishers(x),
  /worker_audit_script_identity_ambiguous/);
});
