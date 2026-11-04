import test from 'node:test';
import assert from 'node:assert/strict';
import {projectPaymentIncidents} from '../src/multi/incidents.js';
const OWN='134aa93c-b9ea-4340-b587-d7d8e4bff619';
const OTHER='4a3f92e4-06b5-4127-a01e-56d55c1c7670';
test('incident feed isolates independent project payment history',async()=>{
 const binds=[];
 const db={prepare(sql){
  assert.match(sql,/i\.project_id=\?/);
  return {bind(projectId){
   binds.push(projectId);
   assert.equal(projectId,OWN);
   return {all:async()=>({results:sql.includes('v2_chain_audit_state')?
    [{invoice_id:OWN,project_order_ref:OWN,state:'manual_review',
     failed_checks:3,last_checked_ms:100,last_error:'canonical_block_changed'}]:
    [{review_id:OWN,invoice_id:OWN,project_order_ref:OWN,
     reason:'manual',created_at_ms:100}]})};
  }};
 }};
 const response=await projectPaymentIncidents(db,OWN);
 assert.deepEqual(binds,[OWN,OWN]);
 assert.equal(response.auditDisputes.length,1);
 assert.equal(response.openPaymentReviews.length,1);
 assert.equal(response.ok,true);
 assert.equal(JSON.stringify(response).includes(OTHER),false);
});
test('empty incident stream remains safe and never authorizes refunds',async()=>{
 const db={prepare(){return{bind(){return{all:async()=>({results:[]})}}}}};
 const out=await projectPaymentIncidents(db,OWN);
 assert.equal(out.ok,true);
 assert.deepEqual(out.auditDisputes,[]);
 assert.deepEqual(out.openPaymentReviews,[]);
 assert.match(out.action,/Do not automatically reverse/);
});
