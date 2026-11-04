import test from 'node:test';
import assert from 'node:assert/strict';
import {tonAddressInfo,tonCanonicalAddress,tonRawAddress,tonHashHex} from '../src/ton.js';
import {validateReceivingAddress} from '../src/address.js';
import {verifyChainPaymentQuorum} from '../src/multi/quorum.js';
import {txId,decimalToAtomic} from '../src/assets.js';

const EQ='EQDKbjIcfM6ezt8KjKJJLshZJJSqX7XOA4ff-W72r5gqPrHF';
const UQ='UQDKbjIcfM6ezt8KjKJJLshZJJSqX7XOA4ff-W72r5gqPuwA';
const TESTNET='kQDKbjIcfM6ezt8KjKJJLshZJJSqX7XOA4ff-W72r5gqPgpP';
const HASH='a'.repeat(64),ROOT='b'.repeat(64),BADROOT='c'.repeat(64);
const TIME=1762300000;
const ADDRESS_RAW=tonRawAddress(EQ);
const env={
 MULTI_TON_ENABLED:'true',
 TON_INDEXER_URL:'https://one.ton-mainnet.example/api/v3',
 TON_INDEXER_URL_SECONDARY:'https://two.ton-provider.net/api/v3',
 TON_INDEXER_URL_TERTIARY:'https://three.ton-independent.org/api/v3'
};
const invoice={
 asset:'TON',chain:'ton',receive_address:UQ,amount_atomic:'1000000000'
};
function responses(blockHash=ROOT,amount='1500000000'){
 return {
  transactions:{transactions:[{
   hash:HASH,account:ADDRESS_RAW,now:TIME,mc_block_seqno:200,
   emulated:false,description:{aborted:false},
   block_ref:{workchain:0,shard:'8000000000000000',seqno:500},
   in_msg:{destination:ADDRESS_RAW,value:amount,bounced:false}
  }]},
  blocks:{blocks:[{
   workchain:0,shard:'8000000000000000',seqno:500,
   root_hash:blockHash,global_id:-239,master_ref_seqno:200
  }]},
  masterchainInfo:{last:{seqno:202,global_id:-239}}
 };
}
async function fakeTonRpc(nodes,fn){
 const old=globalThis.fetch;
 globalThis.fetch=async (u)=>{
  const url=new URL(u);
  const host=url.hostname,which=host.startsWith('one.')?'a':
   host.startsWith('two.')?'b':'c';
  const data=nodes[which];
  if(!data)throw Error('provider_unavailable');
  const path=url.pathname.split('/').at(-1);
  const value=typeof data==='function'?data(path):data[path];
  return {ok:true,json:async()=>value};
 };
 try{return await fn()}finally{globalThis.fetch=old}
}
test('TON mainnet user-friendly address CRC16 and nonbounceable normalization',async()=>{
 assert.equal(tonCanonicalAddress(EQ),UQ);
 assert.equal(tonCanonicalAddress(UQ),UQ);
 assert.equal(tonRawAddress(UQ),ADDRESS_RAW);
 assert.equal(tonAddressInfo(EQ).raw,ADDRESS_RAW);
 assert.equal(await validateReceivingAddress('ton',EQ),true);
 assert.equal(await validateReceivingAddress('ton',UQ),true);
 assert.equal(await validateReceivingAddress('ton',TESTNET),false);
 assert.equal(await validateReceivingAddress('ton','0:'+ADDRESS_RAW.slice(2)),false);
 assert.equal(await validateReceivingAddress('tron',UQ),false);
 assert.equal(decimalToAtomic('1.000000001',9),'1000000001');
});
test('TON invalid checksum or testnet mainnet mixup never gets imported',async()=>{
 const corrupt=UQ.slice(0,-1)+'B';
 for(const bad of [corrupt,TESTNET,'EQbad',ADDRESS_RAW,
   'UQ'+'A'.repeat(46),'0Q'+UQ.slice(2)])
  assert.equal(await validateReceivingAddress('ton',bad),false,bad);
});
test('TON transaction hash normalization keeps chain-global replay protection',()=>{
 assert.equal(tonHashHex(HASH),HASH);
 const b64=btoa(String.fromCharCode(...Uint8Array.from(Array(32).fill(0xaa))));
 assert.equal(tonHashHex(b64),'aa'.repeat(32));
 assert.equal(txId('TON',b64),'aa'.repeat(32));
 assert.throws(()=>tonHashHex('not-a-ton-transaction'));
});
test('confirmed TON mainnet inbound transfer is accepted by independent 2/3 providers',async()=>{
 await fakeTonRpc({a:responses(),b:responses(),c:null},async()=>{
  const proof=await verifyChainPaymentQuorum(invoice,HASH,env);
  assert.equal(proof.actualAtomic,'1500000000');
  assert.equal(proof.blockHash,ROOT);
  assert.equal(proof.confirmations,1);
  assert.equal(proof.paymentTimeMs,TIME*1000);
 });
});
test('TON cannot credit from conflicting shard blocks, failed transfer or testnet',async()=>{
 await fakeTonRpc({a:responses(ROOT),b:responses(BADROOT),c:null},async()=>{
  await assert.rejects(()=>verifyChainPaymentQuorum(invoice,HASH,env),
   /blockchain_quorum_not_reached/);
 });
 await fakeTonRpc({a:responses(ROOT),b:responses(ROOT),c:responses(ROOT)},async()=>{
  await assert.rejects(()=>verifyChainPaymentQuorum({...invoice,amount_atomic:'2000000000'},HASH,env),
   /blockchain_quorum_not_reached/);
 });
 const faulty=responses();
 faulty.masterchainInfo.last.global_id=-3;
 await fakeTonRpc({a:faulty,b:faulty,c:faulty},async()=>{
  await assert.rejects(()=>verifyChainPaymentQuorum(invoice,HASH,env),
   /blockchain_quorum_not_reached/);
 });
});
test('TON remains off without explicit global opt-in',async()=>{
 await assert.rejects(()=>verifyChainPaymentQuorum(invoice,HASH,{
  ...env,MULTI_TON_ENABLED:'false'
 }),/blockchain_quorum_not_reached/);
});
