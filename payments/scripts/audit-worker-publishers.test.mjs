import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {diagnoseCompetingWorkerPublishers,diagnoseWorkerBindingsWithoutAudit,
 inspectWorkerPublishers}
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

test('the safe Worker release fails closed on competing publishers before upload',()=>{
 const source=readFileSync(new URL('./prepare-current-verified-worker.ps1',
  import.meta.url),'utf8');
 assert.match(source,/audit-worker-publishers\.mjs/);
 assert.match(source,/if\(\$auditExit -eq 2\)/);
 assert.match(source,/if\(\$DeployWithPaymentsOff\)/);
 assert.match(source,/no Worker upload until publishers are coordinated/);
 assert.match(source,/Cannot verify deployment ownership: live Worker upload blocked/);
 assert.ok(source.indexOf('audit-worker-publishers.mjs')<
  source.indexOf('npx --yes wrangler deploy --config'));
});

test('account audit 403 shows real live binding drift but never claims a single publisher',async()=>{
 const evidence=input();
 evidence.bindings=evidence.bindings.filter(b=>b.name!=='PAYMENTS_DB');
 const fetchMock=async url=>{
  if(url.includes('/audit_logs'))return {ok:false,status:403};
  return {
   ok:true,status:200,
   json:async()=>({success:true,result:
    url.endsWith('/deployments')?{deployments:evidence.deployments}:
     {bindings:evidence.bindings}})
  };
 };
 const report=await inspectWorkerPublishers('fake-local-token-without-audit-scope',fetchMock);
 assert.equal(report.paymentDbBound,false);
 assert.equal(report.allPaymentFlagsOff,true);
 assert.equal(report.distinctRecentPublisherCount,null);
 assert.equal(report.hasConflictingDeployers,null);
 assert.equal(report.readyForUnattendedPayments,false);
 assert.deepEqual(report.blockers,[
  'payment_d1_binding_was_overwritten','publisher_actor_audit_unavailable'
 ]);
 assert.equal(JSON.stringify(report).includes('fake-local-token'),false);
});

test('binding-only fallback flags missing switches and never grants release',()=>{
 const x=input();
 x.bindings=x.bindings.filter(b=>b.name!=='STARS_PAYMENT_ENABLED');
 const report=diagnoseWorkerBindingsWithoutAudit(x);
 assert.equal(report.paymentDbBound,true);
 assert.equal(report.allPaymentFlagsOff,false);
 assert.equal(report.paymentFlags.STARS_PAYMENT_ENABLED,'MISSING');
 assert.ok(report.blockers.includes('payment_flags_are_missing_or_unsafe'));
 assert.ok(report.blockers.includes('publisher_actor_audit_unavailable'));
});

test('worker settings 403 is an explicit hard error, not an audit-only fallback',async()=>{
 const fetchMock=async url=>url.endsWith('/settings')?
  {ok:false,status:403}:{ok:true,status:200,json:async()=>({
   success:true,result:{deployments:input().deployments}})};
 await assert.rejects(
  ()=>inspectWorkerPublishers('fake-local-token-without-settings-read',fetchMock),
  /cloudflare_settings_http_403/
 );
});

test('safe Worker preparation checks live source-map presence before source recovery',()=>{
 const source=readFileSync(new URL('./prepare-current-verified-worker.ps1',
  import.meta.url),'utf8');
 assert.ok(source.includes("audit-current-live-worker.mjs' --source-preflight"));
 assert.ok(source.indexOf('audit-current-live-worker.mjs')<
  source.indexOf('stage-current-verified-worker.mjs'));
 assert.match(source,/worker publisher\/finance configuration audit unresolved/);
});
