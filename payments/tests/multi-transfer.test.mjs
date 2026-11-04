import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptVerifiedPaymentPart,storedParts,processPaymentPart}
 from '../src/multi/multi-transfer.js';
const ID='b4bd646a-ea7c-4c26-9fb1-5d8e7c85f6b3';
const PROJECT='6d736edb-e3ab-4cab-92f8-3bf9f56d9b31';
const RCV='0x'+'a'.repeat(40);
const TX1='0x'+'1'.repeat(64),TX2='0x'+'2'.repeat(64);
const BLOCK='0x'+'f'.repeat(64),TIME=1762300000000;
const invoice=()=>({id:ID,project_id:PROJECT,
 asset:'ETH',chain:'ethereum',amount_atomic:'100',
 receive_address:RCV,status:'awaiting_payment',
 project_order_ref:ID,amount_minor:1000,fiat:'RUB',
 created_at_ms:TIME-100000,expires_at_ms:TIME+1000000});
const proof=(txHash,actualAtomic)=>({
 txHash,actualAtomic,blockHash:BLOCK,
 paymentTimeMs:TIME,confirmations:20
});
function inMemory(){
 const parts=new Map(),events=[],claims=[],queue=new Map();
 let paid=false;
 const db={
  parts,events,claims,queue,
  prepare(sql){return {bind(...args){return {
   sql,args,
   async first(){
    if(sql.includes('FROM v2_payment_parts')&&sql.includes('WHERE chain=?'))
     return parts.get(args[0]+':'+args[1])||null;
    if(sql.includes('FROM v2_invoices WHERE id=?'))
     return {status:paid?'verified':'awaiting_payment',tx_hash:paid?TX2:null};
    throw Error('unexpected_first_query:'+sql);
   },
   async all(){
    if(sql.includes('FROM v2_payment_parts')){
     const items=[...parts.values()].filter(p=>p.invoice_id===args[0]);
     return {results:items.sort((a,b)=>a.payment_time_ms-b.payment_time_ms||
      a.tx_hash.localeCompare(b.tx_hash))};
    }
    throw Error('unexpected_all_query:'+sql);
   },
   async run(){
    if(sql.includes('INSERT INTO v2_payment_parts')){
     const [chain,tx_hash,invoice_id,project_id,asset,actual_atomic,
      payment_time_ms,block_hash,confirmed_at_ms]=args;
     const key=chain+':'+tx_hash;
     if(parts.has(key))throw Error('UNIQUE');
     parts.set(key,{chain,tx_hash,invoice_id,project_id,asset,
      actual_atomic,payment_time_ms,block_hash,confirmed_at_ms});
     return {meta:{changes:1}};
    }
    if(sql.includes('INSERT INTO v2_partial_reconcile_queue')){
     queue.set(args[0],{next_check_ms:args[1],attempts:0});
     return {meta:{changes:1}};
    }
    throw Error('unexpected_run_query:'+sql);
   }
  }}};},
  async batch(stmts){
   if(stmts.length!==3)throw Error('expected_settlement_batch');
   paid=true;
   claims.push(stmts[1].args);
   const payload=JSON.parse(stmts[2].args[1]);events.push(payload);
   return [{meta:{changes:1}},{meta:{changes:1}},{meta:{changes:1}}];
  }
 };
 return db;
}
async function fakeEthRpc(fn){
 const old=globalThis.fetch;
 globalThis.fetch=async(_url,opts)=>{
  const {method,params}=JSON.parse(opts.body);
  const hash=params?.[0],atomic=hash===TX1?'0x1e':'0x46';
  const table={
   eth_chainId:'0x1',eth_blockNumber:'0x80',
   eth_getTransactionByHash:{hash,to:RCV,blockNumber:'0x65',
    blockHash:BLOCK,value:atomic},
   eth_getTransactionReceipt:{transactionHash:hash,status:'0x1',
    blockNumber:'0x65',blockHash:BLOCK,logs:[]},
   eth_getBlockByNumber:{number:'0x65',hash:BLOCK,
    timestamp:'0x'+Math.floor(TIME/1000).toString(16)}
  };
  return {ok:true,json:async()=>({result:table[method]})};
 };
 try{return await fn()}finally{globalThis.fetch=old}
}
const env={
 ETHEREUM_RPC_URL:'https://eth-a.providerone.example',
 ETHEREUM_RPC_URL_SECONDARY:'https://eth-b.providertwo.net',
 ETHEREUM_RPC_URL_TERTIARY:'https://eth-c.providerthree.org'
};
test('two separate confirmed ETH payments generate one signed-deliverable event',async()=>{
 const db=inMemory(),order=invoice();
 await fakeEthRpc(async()=>{
  const a=await acceptVerifiedPaymentPart(db,order,proof(TX1,'30'),env,TIME+100000);
  assert.equal(a.status,'partial');
  assert.equal(a.receivedAtomic,'30');
  assert.equal(a.remainingAtomic,'70');
  const b=await acceptVerifiedPaymentPart(db,order,proof(TX2,'70'),env,TIME+120000);
  assert.equal(b.status,'verified');
  assert.equal(db.events.length,1);
  assert.equal(db.events[0].amountAtomic,'100');
  assert.deepEqual(db.events[0].transactionHashes,[TX1,TX2]);
  assert.equal(db.events[0].paymentMode,'combined_chain_transfers');
  const replay=await acceptVerifiedPaymentPart(db,{...order,status:'verified'},
   proof(TX2,'70'),env,TIME+150000);
  assert.equal(replay.idempotent,true);
  assert.equal(db.events.length,1);
 });
});
test('new part cannot be counted twice by repeat request',async()=>{
 const db=inMemory(),order=invoice();
 const a=await acceptVerifiedPaymentPart(db,order,proof(TX1,'30'),env,TIME);
 const b=await acceptVerifiedPaymentPart(db,order,proof(TX1,'30'),env,TIME+1000);
 assert.equal(a.status,'partial');
 assert.equal(b.status,'partial');
 assert.equal(b.receivedAtomic,'30');
 assert.equal(db.parts.size,1);
});
test('the same transaction cannot belong to a different project invoice',async()=>{
 const db=inMemory(),order=invoice();
 await acceptVerifiedPaymentPart(db,order,proof(TX1,'30'),env,TIME);
 const other={...order,id:'a14cb820-76f0-44f9-850d-30b5d2c314ac',
  project_id:'a14cb820-76f0-44f9-850d-30b5d2c314ac'};
 await assert.rejects(()=>acceptVerifiedPaymentPart(db,other,proof(TX1,'30'),env,TIME),
  /part_conflict_or_reorg/);
});
test('late or insufficiently confirmed parts never enter the payment ledger',async()=>{
 const db=inMemory(),order=invoice();
 for(const broken of [
  {...proof(TX1,'30'),paymentTimeMs:TIME+2000000},
  {...proof(TX1,'30'),confirmations:1},
  {...proof(TX1,'30'),actualAtomic:'0'}
 ]){
  await assert.rejects(()=>acceptVerifiedPaymentPart(db,order,broken,env,TIME),
   /invalid_or_late_payment_part/);
 }
 assert.equal(db.parts.size,0);
});
