import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewUnderpayment} from '../src/multi/settlement.js';

const HASH='0x'+'a'.repeat(64),RECEIVER='0x'+'b'.repeat(40);
const TIME=1762300000000;
function invoice(){return {
 id:'123e4567-e89b-42d3-a456-426614174000',project_id:'123e4567-e89b-42d3-a456-426614174001',
 asset:'ETH',chain:'ethereum',receive_address:RECEIVER,
 amount_atomic:'100',created_at_ms:TIME-1000,expires_at_ms:TIME+1800000
};}
function dbMock(){
 const writes=[];
 return {writes,prepare(sql){
  return {bind(...args){return {run:async()=>{writes.push({sql,args});return {meta:{changes:1}};}}}}
 }};
}
async function withEthPaidTo(address,received,callback){
 const previous=globalThis.fetch;
 globalThis.fetch=async(_url,options)=>{
  const {method}=JSON.parse(options.body);
  const entries={
   eth_chainId:'0x1',
   eth_getTransactionByHash:{hash:HASH,to:address,value:'0x'+received.toString(16),blockNumber:'0x65'},
   eth_getTransactionReceipt:{transactionHash:HASH,status:'0x1',blockNumber:'0x65',logs:[]},
   eth_blockNumber:'0x70',
   eth_getBlockByNumber:{number:'0x65',timestamp:'0x'+Math.floor(TIME/1000).toString(16)}
  };
  return {ok:true,json:async()=>({result:entries[method]})};
 };
 try{return await callback();}finally{globalThis.fetch=previous;}
}
test('confirmed underpayment produces a review ticket, not a wallet credit',async()=>{
 const db=dbMock(),order=invoice();
 await withEthPaidTo(RECEIVER,25n,async()=>{
  const result=await reviewUnderpayment(db,order,HASH,{ETHEREUM_RPC_URL:'https://eth.example'},TIME+180000);
  assert.deepEqual(result,{status:'manual_review',reason:'underpaid',receivedAtomic:'25'});
 });
 assert.equal(db.writes.length,1);
 assert.match(db.writes[0].sql,/v2_payment_reviews/);
 assert.doesNotMatch(db.writes[0].sql,/delivery_outbox|credit_events/);
 assert.equal(db.writes[0].args.at(-1),'25');
});
test('transaction paying wrong address cannot create partial invoice',async()=>{
 const db=dbMock();
 await withEthPaidTo('0x'+'c'.repeat(40),25n,async()=>{
  await assert.rejects(()=>reviewUnderpayment(db,invoice(),HASH,
    {ETHEREUM_RPC_URL:'https://eth.example'},TIME+180000));
 });
 assert.equal(db.writes.length,0);
});
test('payments after locked quote expiry need support review',async()=>{
 const db=dbMock(),order=invoice();
 order.expires_at_ms=TIME-1000;
 await withEthPaidTo(RECEIVER,25n,async()=>{
  const result=await reviewUnderpayment(db,order,HASH,
   {ETHEREUM_RPC_URL:'https://eth.example'},TIME+180000);
  assert.equal(result.reason,'late');
 });
 assert.equal(db.writes.length,1);
});
test('full amount never takes the underpayment path',async()=>{
 const db=dbMock();
 await withEthPaidTo(RECEIVER,100n,async()=>{
  const result=await reviewUnderpayment(db,invoice(),HASH,
   {ETHEREUM_RPC_URL:'https://eth.example'},TIME+180000);
  assert.equal(result.status,'full_amount_needs_retry');
 });
 assert.equal(db.writes.length,0);
});
