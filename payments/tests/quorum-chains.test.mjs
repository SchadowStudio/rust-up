import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyChainPaymentQuorum} from '../src/multi/quorum.js';

const BTC_TX='a'.repeat(64),TRON_TX='b'.repeat(64),HASH='c'.repeat(64);
const TIME=1762300000000;
const BTC_ADDR='bc1q0000000000000000000000000000000000000';
const TRON_ADDR='TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const BTC_ENV={
 BITCOIN_RPC_URL:'https://btc-one.chainone.example',
 BITCOIN_RPC_URL_SECONDARY:'https://btc-two.chaintwo.net',
 BITCOIN_RPC_URL_TERTIARY:'https://btc-three.chainthree.org',
 BITCOIN_RPC_BASIC_B64:'abc',
 BITCOIN_RPC_BASIC_B64_SECONDARY:'def',
 BITCOIN_RPC_BASIC_B64_TERTIARY:'ghi'
};
const TRON_ENV={
 TRON_RPC_URL:'https://tron-one.chainone.example',
 TRON_RPC_URL_SECONDARY:'https://tron-two.chaintwo.net',
 TRON_RPC_URL_TERTIARY:'https://tron-three.chainthree.org'
};
async function fakeResponses(action,fn){
 const old=globalThis.fetch;
 globalThis.fetch=action;
 try{return await fn()}finally{globalThis.fetch=old}
}
test('Bitcoin settlement requires two canonical headers and matching outputs',async()=>{
 const order={asset:'BTC',chain:'bitcoin',
  receive_address:BTC_ADDR,amount_atomic:'100000'};
 await fakeResponses(async(_url,opts)=>{
  const {method}=JSON.parse(opts.body);
  const results={
   getrawtransaction:{txid:BTC_TX,confirmations:6,
    blocktime:Math.floor(TIME/1000),blockhash:HASH,
    vout:[{value:0.00123456,scriptPubKey:{address:BTC_ADDR}}]},
   getblockheader:{hash:HASH,height:900000,confirmations:6},
   getblockhash:HASH
  };
  return {ok:true,json:async()=>({result:results[method]})};
 },async()=>{
  const proof=await verifyChainPaymentQuorum(order,BTC_TX,BTC_ENV);
  assert.equal(proof.actualAtomic,'123456');
  assert.equal(proof.blockHash,HASH);
  assert.equal(proof.confirmations,6);
 });
});
test('Bitcoin rejects inconsistent canonical headers across all three nodes',async()=>{
 const order={asset:'BTC',chain:'bitcoin',
  receive_address:BTC_ADDR,amount_atomic:'100000'};
 await fakeResponses(async(url,opts)=>{
  const {method}=JSON.parse(opts.body);
  const hash=new URL(url).hostname.includes('one')?'a'.repeat(64):
   new URL(url).hostname.includes('two')?'b'.repeat(64):'c'.repeat(64);
  const results={
   getrawtransaction:{txid:BTC_TX,confirmations:6,
    blocktime:Math.floor(TIME/1000),blockhash:hash,
    vout:[{value:0.00123456,scriptPubKey:{address:BTC_ADDR}}]},
   getblockheader:{hash,height:900000,confirmations:6},
   getblockhash:hash
  };
  return {ok:true,json:async()=>({result:results[method]})};
 },async()=>await assert.rejects(()=>verifyChainPaymentQuorum(order,BTC_TX,BTC_ENV),
  /blockchain_quorum_not_reached/));
});
test('TRON Solidity blocks must be solidified and match on independent nodes',async()=>{
 const order={asset:'TRX',chain:'tron',receive_address:TRON_ADDR,
  amount_atomic:'1000000'};
 const {tronHex}=await import('../src/assets.js');
 const destination=await tronHex(TRON_ADDR);
 await fakeResponses(async(_url,opts)=>{
  const {method}=JSON.parse(opts.body);
  const route=new URL(_url).pathname;
  const result=route.endsWith('/gettransactionbyid')?
   {txID:TRON_TX,raw_data:{contract:[{
    type:'TransferContract',parameter:{value:{
     to_address:destination,amount:1200000
    }}
   }]}}:
   route.endsWith('/gettransactioninfobyid')?
    {blockNumber:100,receipt:{result:'SUCCESS'},blockTimeStamp:TIME}:
   route.endsWith('/getnowblock')?{block_header:{raw_data:{number:120}}}:
   route.endsWith('/getblockbynum')?
    {blockID:HASH,block_header:{raw_data:{number:100,timestamp:TIME}}}:
    null;
  if(result===null)throw Error('unexpected_tron_route');
  return {ok:true,json:async()=>result};
 },async()=>{
  const proof=await verifyChainPaymentQuorum(order,TRON_TX,TRON_ENV);
  assert.equal(proof.actualAtomic,'1200000');
  assert.equal(proof.blockHash,HASH);
 });
});
