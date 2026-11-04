import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyChainPaymentQuorum,validateIndependentRpcs} from '../src/multi/quorum.js';
const tx='0x'+'a'.repeat(64),receive='0x'+'b'.repeat(40);
const blockA='0x'+'d'.repeat(64),blockB='0x'+'e'.repeat(64),blockC='0x'+'f'.repeat(64);
const TIME=1762300000000;
const env={
 ETHEREUM_RPC_URL:'https://eth-a.providerone.example',
 ETHEREUM_RPC_URL_SECONDARY:'https://eth-b.providertwo.net',
 ETHEREUM_RPC_URL_TERTIARY:'https://eth-c.providerthree.org',
 MULTI_STRICT_QUORUM:'true'
};
const invoice={id:'9297f0ae-c643-419d-9bbb-65cf4b682cef',
 asset:'ETH',chain:'ethereum',receive_address:receive,amount_atomic:'100'};
async function mockedNodes(nodes,fn){
 const old=globalThis.fetch;
 globalThis.fetch=async (url,opts)=>{
  const host=new URL(url).hostname;
  const node=host.includes('providerone')?'a':
   host.includes('providertwo')?'b':'c';
  const item=nodes[node];
  if(!item||item.offline)throw Error('provider_unavailable');
  const hash=item.blockHash||blockA;
  const {method}=JSON.parse(opts.body);
  const table={
   eth_chainId:'0x1',eth_blockNumber:'0x80',
   eth_getTransactionByHash:{hash:tx,to:receive,blockNumber:'0x65',
    value:'0x7b',blockHash:hash},
   eth_getTransactionReceipt:{transactionHash:tx,blockNumber:'0x65',
    status:'0x1',blockHash:hash,logs:[]},
   eth_getBlockByNumber:{number:'0x65',hash,
    timestamp:'0x'+Math.floor(TIME/1000).toString(16)}
  };
  return {ok:true,json:async()=>({result:table[method]})};
 };
 try{return await fn();}
 finally{globalThis.fetch=old;}
}
test('two agreeing independent RPCs confirm while one provider is offline',async()=>{
 await mockedNodes({a:{},b:{},c:{offline:true}},async()=>{
  const proof=await verifyChainPaymentQuorum(invoice,tx,env);
  assert.equal(proof.actualAtomic,'123');
  assert.equal(proof.txHash,tx);
  assert.equal(proof.blockHash,blockA);
  assert.ok(proof.confirmations>=12);
 });
});
test('one faulty RPC cannot cause a false settlement when two agree',async()=>{
 await mockedNodes({a:{blockHash:blockA},b:{blockHash:blockA},
  c:{blockHash:blockB}},async()=>{
  const proof=await verifyChainPaymentQuorum(invoice,tx,env);
  assert.equal(proof.blockHash,blockA);
 });
});
test('three different blockchain answers are rejected without sending credit',async()=>{
 await mockedNodes({a:{blockHash:blockA},b:{blockHash:blockB},
  c:{blockHash:blockC}},async()=>{
  await assert.rejects(()=>verifyChainPaymentQuorum(invoice,tx,env),
   /blockchain_quorum_not_reached/);
 });
});
test('only a single healthy RPC is never sufficient to confirm customer funds',async()=>{
 await mockedNodes({a:{},b:{offline:true},c:{offline:true}},async()=>{
  await assert.rejects(()=>verifyChainPaymentQuorum(invoice,tx,env),
   /blockchain_quorum_not_reached/);
 });
});
test('duplicate DNS hostnames and insecure endpoints cannot count as independent',()=>{
 assert.throws(()=>validateIndependentRpcs({
  ...env,ETHEREUM_RPC_URL_SECONDARY:env.ETHEREUM_RPC_URL
 },'ethereum'),/three_independent_rpc_hosts/);
 assert.throws(()=>validateIndependentRpcs({
  ...env,ETHEREUM_RPC_URL_TERTIARY:'http://untrusted.example.org'
 },'ethereum'),/https/);
});
test('a noncanonical block cannot be approved by a node even if amount is correct',async()=>{
 const old=globalThis.fetch;
 globalThis.fetch=async (url,opts)=>{
  const {method}=JSON.parse(opts.body);
  const table={
   eth_chainId:'0x1',eth_blockNumber:'0x80',
   eth_getTransactionByHash:{hash:tx,to:receive,blockNumber:'0x65',
    value:'0x7b',blockHash:blockA},
   eth_getTransactionReceipt:{transactionHash:tx,blockNumber:'0x65',
    status:'0x1',blockHash:blockA,logs:[]},
   eth_getBlockByNumber:{number:'0x65',hash:blockB,
    timestamp:'0x'+Math.floor(TIME/1000).toString(16)}
  };
  return {ok:true,json:async()=>({result:table[method]})};
 };
 try{
  await assert.rejects(()=>verifyChainPaymentQuorum(invoice,tx,env),
   /blockchain_quorum_not_reached/);
 }finally{globalThis.fetch=old;}
});
