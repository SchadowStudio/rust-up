import test from 'node:test';
import assert from 'node:assert/strict';
import {deliverV2} from '../src/multi/delivery.js';

// No real wallet, webhook, or chain is contacted in these regression tests.
const ID='7435b887-6a78-4221-8570-19be032f7867';
const eventId='v2:'+ID;
const NOW=1762300000000;
function scenario({audit_hold=0,review_hold=0}={}){
 const writes=[];
 const db={
  prepare(sql){
   return {bind(...args){return {
    async all(){
     if(sql.includes('FROM v2_delivery_outbox o'))return {results:[{
      event_id:eventId,project_id:ID,invoice_id:ID,
      event_body:'{}',attempts:0,next_attempt_ms:NOW-1000,
      webhook_url:'https://merchant.example.com/internal/crypto/credit',status:'active'
     }]};
     throw Error('unexpected_list_query');
    },
    async first(){
     if(sql.includes('FROM v2_invoices'))return {
      id:ID,project_id:ID,status:'verified',tx_hash:'0x'+'a'.repeat(64)
     };
     if(sql.includes('AS audit_hold'))return {audit_hold,review_hold};
     if(sql.includes('FROM v2_delivery_outbox'))return null;
     throw Error('unexpected_single_query');
    },
    async run(){
     writes.push({sql,args});
     return {meta:{changes:1}};
    }
   }}};
  }
 };
 return {db,writes};
}
async function runCase(hold){
 const {db,writes}=scenario(hold);
 const oldFetch=globalThis.fetch;
 let sent=0;
 globalThis.fetch=async()=>{sent++;throw Error('webhook_must_not_be_sent')};
 try {
  const report=await deliverV2({
   DB:db,MULTI_DELIVERY_ENABLED:'true',
   MULTI_WEBHOOK_MASTER_KEY:'m'.repeat(64)
  },NOW);
  assert.equal(report.attempted,1);
  assert.equal(report.delivered,0);
  assert.equal(report.failed,1);
  assert.equal(sent,0);
  const error=writes.find(x=>x.sql.includes('last_error=?'));
  assert.ok(error,'delivery must remain in the durable retry outbox');
  assert.equal(error.args[1],'invoice_under_payment_review');
 }finally{globalThis.fetch=oldFetch}
}
test('manual review in chain audit blocks merchant credit',async()=>{
 await runCase({audit_hold:1});
});
test('open payment review blocks merchant credit even with a valid audit',async()=>{
 await runCase({review_hold:1});
});
test('a healthy audit cannot override a separate open payment review',async()=>{
 await runCase({audit_hold:0,review_hold:1});
});
