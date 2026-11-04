import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyRecordedInvoice} from '../src/multi/receipt-proof.js';

const INV='d14cb820-76f0-44f9-850d-30b5d2c314ac';
const PROJECT='c14cb820-76f0-44f9-850d-30b5d2c314ac';
const A='0x'+'1'.repeat(64),B='0x'+'2'.repeat(64);
const RECEIVER='0x'+'a'.repeat(40),BLOCK='0x'+'c'.repeat(64);
const NOW=1762300000000;
const invoice={
 id:INV,project_id:PROJECT,tx_hash:B,asset:'ETH',chain:'ethereum',
 receive_address:RECEIVER,amount_atomic:'100',
 created_at_ms:NOW-100000,expires_at_ms:NOW+100000
};
const parts=[
 {invoice_id:INV,asset:'ETH',chain:'ethereum',
  tx_hash:A,actual_atomic:'30',block_hash:BLOCK,payment_time_ms:NOW},
 {invoice_id:INV,asset:'ETH',chain:'ethereum',
  tx_hash:B,actual_atomic:'70',block_hash:BLOCK,payment_time_ms:NOW}
];
const record=(patch={})=>({eventVersion:2,
 eventId:'v2:'+INV,invoiceId:INV,projectId:PROJECT,
 projectOrderRef:INV,asset:'ETH',chain:'ethereum',currency:'EUR',
 amountMinor:1000,amountAtomic:'100',transactionHash:B,
 transactionHashes:[A,B],paymentMode:'combined_chain_transfers',
 confirmedAt:NOW,...patch});
const env={
 ETHEREUM_RPC_URL:'https://one.providerone.example',
 ETHEREUM_RPC_URL_SECONDARY:'https://two.providertwo.net',
 ETHEREUM_RPC_URL_TERTIARY:'https://three.providerthree.org'
};
function db(payload=record(),rows=parts){
 return {prepare(sql){return {bind(){
  return {
   first:async()=>{
    if(sql.includes('v2_delivery_outbox'))return {event_body:JSON.stringify(payload)};
    throw Error('unexpected_single_sql');
   },
   all:async()=>{
    if(sql.includes('v2_payment_parts'))return {results:rows};
    throw Error('unexpected_list_sql');
   }
  };
 }}}};
}
async function rpc(override,fn){
 const old=globalThis.fetch;
 globalThis.fetch=async (_url,opts)=>{
  const {method,params}=JSON.parse(opts.body);
  const tx=params?.[0],amount=tx===A?'0x1e':'0x46';
  const h=override?.blockHash||BLOCK;
  const table={
   eth_chainId:'0x1',eth_blockNumber:'0x80',
   eth_getTransactionByHash:{hash:tx,to:RECEIVER,blockNumber:'0x65',
    blockHash:h,value:amount},
   eth_getTransactionReceipt:{transactionHash:tx,status:'0x1',
    blockNumber:'0x65',blockHash:h,logs:[]},
   eth_getBlockByNumber:{number:'0x65',hash:h,
    timestamp:'0x'+Math.floor(NOW/1000).toString(16)}
  };
  return {ok:true,json:async()=>({result:table[method]})};
 };
 try{return await fn()}finally{globalThis.fetch=old}
}
test('merchant webhook only accepts matching aggregate of all independent chain proofs',async()=>{
 await rpc(null,async()=>{
  const result=await verifyRecordedInvoice(db(),invoice,env);
  assert.equal(result.proof.actualAtomic,'100');
  assert.equal(result.proof.txHash,B);
  assert.match(result.proof.blockHash,/^[0-9a-f]{64}$/);
  assert.deepEqual(result.recorded.transactionHashes,[A,B]);
 });
});
test('missing or extra payment part prevents release of merchant event',async()=>{
 await rpc(null,async()=>{
  await assert.rejects(()=>verifyRecordedInvoice(db(record(),parts.slice(0,1)),invoice,env),
   /receipt_part_set_changed/);
  await assert.rejects(()=>verifyRecordedInvoice(db(record({transactionHashes:[A,A]})),invoice,env),
   /invalid_partial_receipt/);
 });
});
test('fake total or changed blockhash prevents credit',async()=>{
 await rpc(null,async()=>{
  await assert.rejects(()=>verifyRecordedInvoice(db(record({amountAtomic:'999'})),invoice,env),
   /receipt_total_inconsistent/);
  await assert.rejects(()=>verifyRecordedInvoice(db(record(),[
   {...parts[0],block_hash:'0x'+'e'.repeat(64)},parts[1]]),invoice,env),
   /receipt_part_changed/);
 });
});
