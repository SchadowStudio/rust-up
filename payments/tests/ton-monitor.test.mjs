import test from 'node:test';
import assert from 'node:assert/strict';
import {scanTonPayments} from '../src/multi/ton-monitor.js';
import {tonRawAddress} from '../src/ton.js';
const TON_WALLET='UQDKbjIcfM6ezt8KjKJJLshZJJSqX7XOA4ff-W72r5gqPuwA';
const raw=tonRawAddress(TON_WALLET),HASH='a'.repeat(64);
const invoice={id:'ba35ba98-8bd6-4dc1-8b1c-7f06b91d3353',
 asset:'TON',chain:'ton',receive_address:TON_WALLET,
 created_at_ms:1762300000000,amount_atomic:'1000000000'};
const record=(override={})=>({
 hash:HASH,account:raw,emulated:false,mc_block_seqno:202,
 description:{aborted:false},
 in_msg:{destination:raw,value:'1500000000',bounced:false},...override
});
const env={MULTI_TON_ENABLED:'true',
 TON_INDEXER_URL:'https://independent-ton-node.example.com/api/v3'};
async function fakeFeed(transactions,fn){
 const old=globalThis.fetch;
 globalThis.fetch=async url=>{
  const u=new URL(url);
  assert.equal(u.pathname,'/api/v3/transactions');
  assert.equal(u.searchParams.get('account'),raw);
  return {ok:true,json:async()=>({transactions})};
 };
 try{return await fn()}finally{globalThis.fetch=old}
}
test('confirmed native TON transfer is only discovered as a hint for independent verification',async()=>{
 let settled=0,advance;
 await fakeFeed([record()],async()=>{
  const result={scannedTonTransactions:0},helpers={
   scanCursor:async()=>null,
   advance:async (...args)=>{advance=args},
   trySettle:async(_db,order,hash)=>{settled++;assert.equal(order.asset,'TON');assert.equal(hash,HASH)}
  };
  await scanTonPayments({},[invoice],env,result,helpers);
  assert.equal(settled,1);
  assert.equal(result.scannedTonTransactions,1);
  assert.equal(advance[1],'ton_order_offset');
 });
});
test('testnet/rejected/bounced/pending TON transfers are ignored',async()=>{
 const records=[
  record({emulated:true}),
  record({mc_block_seqno:0}),
  record({in_msg:{destination:raw,value:'2000000000',bounced:true}}),
  record({in_msg:{destination:'0:'+'b'.repeat(64),value:'5000000000',bounced:false}}),
  record({description:{aborted:true}})
 ];
 let settled=0;
 await fakeFeed(records,async()=>{
  await scanTonPayments({},[invoice],env,{scannedTonTransactions:0},{
   scanCursor:async()=>null,
   advance:async()=>{},
   trySettle:async()=>{settled++}
  });
 });
 assert.equal(settled,0);
});
test('TON scan cursor is not advanced when indexed transactions exceed safety cap',async()=>{
 const old=globalThis.fetch;let advanced=false;
 globalThis.fetch=async()=>({ok:true,json:async()=>({
  transactions:Array.from({length:100},()=>record())
 })});
 try{
  await assert.rejects(()=>scanTonPayments({},[invoice],env,{scannedTonTransactions:0},{
   scanCursor:async()=>null,advance:async()=>{advanced=true},
   trySettle:async()=>{}
  }),/ton_scan_pagination_limit/);
  assert.equal(advanced,false);
 }finally{globalThis.fetch=old}
});
test('TON scanner is disabled without explicit network enable flag',async()=>{
 await scanTonPayments({},[invoice],{...env,MULTI_TON_ENABLED:'false'},
  {scannedTonTransactions:0},{});
});
