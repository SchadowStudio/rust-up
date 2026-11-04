import test from 'node:test';
import assert from 'node:assert/strict';
import {consumeManualVerifyQuota,auditVerifiedInvoices,nextAuditDelay}
 from '../src/multi/reconciliation.js';

const UUID='a38a9f64-a610-4a46-8292-4e8a96b7d901';
const NOW=1762300000000;
const TX='0x'+'c'.repeat(64);
const HASH='0x'+'e'.repeat(64);
const RECV='0x'+'b'.repeat(40);
const base={
 id:UUID,project_id:UUID,chain:'ethereum',asset:'ETH',
 receive_address:RECV,amount_atomic:'100',tx_hash:TX,
 created_at_ms:NOW-120000,expires_at_ms:NOW+600000,
 verified_at_ms:NOW-30000,status:'verified',failed_checks:0,
 last_block_hash:null
};
function fakeDb(invoice){
 const writes=[],db={
  writes,
  prepare(sql){
   return {bind(...args){
    return {
     async all(){if(sql.includes('FROM v2_invoices i'))return {results:invoice?[{...invoice}]:[]};
      throw Error('unexpected_query')},
     async first(){
      if(sql.includes('FROM v2_delivery_outbox'))
       return {event_body:JSON.stringify({invoiceId:UUID,projectId:UUID,
        transactionHash:TX,amountAtomic:'123'})};
      throw Error('unexpected_single_query');
     },
     async run(){writes.push({sql,args});return {meta:{changes:1}}}
    };
   }};
  }
 };
 return db;
}
test('on-demand verification quota is D1-atomic, capped by project and minute',async()=>{
 const db={prepare(sql){
  assert.match(sql,/ON CONFLICT\(project_id,bucket_minute_ms\)/);
  return {bind(...args){assert.equal(args[0],UUID);
   assert.equal(args[1],Math.floor(NOW/60000)*60000);
   assert.equal(args[2],7);
   return {run:async()=>({meta:{changes:1}})};
  }};
 }};
 assert.equal(await consumeManualVerifyQuota(db,UUID,{MULTI_VERIFY_PER_MINUTE:'7'},NOW),true);
 const denied={prepare(){return {bind(){return {run:async()=>({meta:{changes:0}})}}}}};
 assert.equal(await consumeManualVerifyQuota(denied,UUID,{},NOW),false);
});
test('chain audits record uncertainty without automatically reversing a payment',async()=>{
 const db=fakeDb({...base,tx_hash:null});
 const result=await auditVerifiedInvoices({DB:db,MULTI_RECONCILE_ENABLED:'true'},NOW);
 assert.equal(result.checked,1);
 assert.equal(result.uncertain,1);
 assert.equal(result.manualReview,0);
 assert.equal(db.writes.some(x=>x.sql.includes("v2_chain_audit_state")),true);
 assert.equal(db.writes.some(x=>x.sql.includes('UPDATE v2_invoices')),false);
 assert.equal(db.writes.some(x=>x.sql.includes('v2_delivery_outbox')),false);
});
test('three repeated failures create a durable manual-review alert, not a refund',async()=>{
 const db=fakeDb({...base,tx_hash:null,failed_checks:2});
 const result=await auditVerifiedInvoices({DB:db,MULTI_RECONCILE_ENABLED:'true'},NOW);
 assert.equal(result.manualReview,1);
 assert.equal(db.writes.some(x=>x.sql.includes('v2_payment_reviews')),true);
 assert.equal(db.writes.some(x=>x.sql.includes('UPDATE v2_invoices')),false);
});
test('audit failures use bounded retry and successful audits use slower polling',()=>{
 assert.equal(nextAuditDelay(0),6*60*60*1000);
 assert.equal(nextAuditDelay(1),2*60*1000);
 assert.equal(nextAuditDelay(3),8*60*1000);
 assert.ok(nextAuditDelay(100)<=60*60*1000);
});
test('successful 2-of-3 native ETH audit stores canonical block hash',async()=>{
 const old=globalThis.fetch;
 globalThis.fetch=async(_url,opts)=>{
  const {method}=JSON.parse(opts.body);
  const result={
   eth_chainId:'0x1',eth_blockNumber:'0x80',
   eth_getTransactionByHash:{hash:TX,to:RECV,blockNumber:'0x65',
    blockHash:HASH,value:'0x7b'},
   eth_getTransactionReceipt:{transactionHash:TX,status:'0x1',
    blockNumber:'0x65',blockHash:HASH,logs:[]},
   eth_getBlockByNumber:{number:'0x65',hash:HASH,
    timestamp:'0x'+Math.floor(NOW/1000).toString(16)}
  };
  return {ok:true,json:async()=>({result:result[method]})};
 };
 try{
  const db=fakeDb(base);
  const env={DB:db,MULTI_RECONCILE_ENABLED:'true',
   ETHEREUM_RPC_URL:'https://eth-node-one.example.com',
   ETHEREUM_RPC_URL_SECONDARY:'https://eth-node-two.example.net',
   ETHEREUM_RPC_URL_TERTIARY:'https://eth-node-three.example.org'};
  const r=await auditVerifiedInvoices(env,NOW);
  assert.equal(r.confirmed,1);
  const audit=db.writes.find(x=>x.sql.includes('v2_chain_audit_state'));
  assert.equal(audit.args.at(-1),HASH);
 }finally{globalThis.fetch=old}
});
