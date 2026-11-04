// ZERO-MONEY INTEGRATION TEST.
// Exercises the real provider settlement, 2-of-3 verifier, signed delivery,
// and merchant ledger worker with in-memory D1-shaped adapters. No RPC calls
// or blockchain funds are sent; all fetch requests are intercepted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyChainPaymentQuorum} from '../src/multi/quorum.js';
import {settleV2} from '../src/multi/settlement.js';
import {deliverV2} from '../src/multi/delivery.js';
import {projectWebhookKey} from '../src/multi/keys.js';
import merchantWorker from '../integration/project-ledger/worker.js';

const PROJECT='52127a36-f177-4607-89ec-ceaa4a0cf013';
const INVOICE='7022bf32-aa2e-4a83-b569-4c055db37e24';
const ORDER='d3ab0959-951e-4650-986d-a4b30cc7d653';
const TX='0x'+'a'.repeat(64), BLOCK='0x'+'c'.repeat(64);
const RECEIVER='0x'+'b'.repeat(40);
const URL='https://shop.example.com/internal/crypto/credit';
const MASTER='T'.repeat(64);
const NOW=Math.floor(Date.now()/1000)*1000;
const rpcHosts=[
 'https://eth-one.provider-one.example',
 'https://eth-two.provider-two.example',
 'https://eth-three.provider-three.example'
];
const env=(db)=>({
 DB:db,MULTI_DELIVERY_ENABLED:'true',MULTI_WEBHOOK_MASTER_KEY:MASTER,
 MULTI_WEBHOOK_HOST_ALLOWLIST:'shop.example.com',
 ETHEREUM_RPC_URL:rpcHosts[0],
 ETHEREUM_RPC_URL_SECONDARY:rpcHosts[1],
 ETHEREUM_RPC_URL_TERTIARY:rpcHosts[2]
});
function invoice(){
 return {id:INVOICE,project_id:PROJECT,project_order_ref:ORDER,
  fiat:'EUR',amount_minor:2500,asset:'ETH',chain:'ethereum',
  receive_address:RECEIVER,amount_atomic:'100',
  created_at_ms:NOW-120000,expires_at_ms:NOW+1800000,
  status:'awaiting_payment',tx_hash:null};
}
// Minimal deterministic D1 simulator for the *real* code paths. No SQL
// shortcuts in production, and no real credentials / account data.
function providerDb(){
 const state={invoice:invoice(),outbox:null,claims:new Set(),
  auditHold:0,reviewHold:0,leases:0};
 const db={
  state,
  prepare(sql){
   return {bind(...args){
    return {sql,args,
     async all(){
      if(sql.includes('FROM v2_delivery_outbox o JOIN')){
       const current=state.outbox;
       if(!current||current.delivered_at_ms!=null||
          current.next_attempt_ms>args[0]||
          (args.length>1&&args[1]!==current.event_id))return {results:[]};
       return {results:[{...current,webhook_url:URL,status:'active'}]};
      }
      throw Error('unexpected_provider_list');
     },
     async first(){
      if(sql.includes('AS audit_hold'))
       return {audit_hold:state.auditHold,review_hold:state.reviewHold};
      if(sql.includes('FROM v2_delivery_outbox'))
       return state.outbox?{event_body:state.outbox.event_body}:null;
      if(sql.includes('FROM v2_invoices'))
       return state.invoice;
      throw Error('unexpected_provider_read');
     },
     async run(){
      if(sql.includes('SET next_attempt_ms=?')&&sql.includes('attempts=attempts+1')){
       if(!state.outbox||state.outbox.delivered_at_ms!=null||
          state.outbox.next_attempt_ms>args[2])return {meta:{changes:0}};
       state.leases++;
       state.outbox.next_attempt_ms=args[0];
       state.outbox.attempts++;
       return {meta:{changes:1}};
      }
      if(sql.includes('SET delivered_at_ms=?')){
       state.outbox.delivered_at_ms=args[0];
       return {meta:{changes:1}};
      }
      if(sql.includes('SET next_attempt_ms=?')&&sql.includes('last_error=?')){
       state.outbox.next_attempt_ms=args[0];
       state.outbox.last_error=args[1];
       return {meta:{changes:1}};
      }
      throw Error('unexpected_provider_write');
     }
    };
   }};
  },
  async batch(stmts){
   assert.equal(stmts.length,3);
   assert.equal(state.invoice.status,'awaiting_payment');
   const tx=stmts[0].args[0];
   assert.equal(tx,TX);
   if(state.claims.has(tx))throw Error('transaction_already_claimed');
   state.invoice.status='verified';
   state.invoice.tx_hash=tx;
   state.claims.add(tx);
   state.outbox={
    event_id:stmts[2].args[0],project_id:PROJECT,
    invoice_id:INVOICE,event_body:stmts[2].args[1],
    created_at_ms:stmts[2].args[2],next_attempt_ms:NOW-1000,
    delivered_at_ms:null,attempts:0
   };
   return Array.from({length:3},()=>({meta:{changes:1}}));
  }
 };
 return db;
}
function merchantDb(){
 const pending={account_id:'local_test_account',currency:'EUR',amount_minor:2500};
 const events=new Map(),balances=new Map();
 return {
  events,balances,
  prepare(sql){return {bind(...args){return {sql,args,
   async first(){
    if(sql.includes('FROM merchant_pending_orders'))
     return args[0]===ORDER?pending:null;
    if(sql.includes('FROM merchant_credit_events'))return events.get(args[0])||null;
    throw Error('unexpected_merchant_read');
   }
  }}}},
  async batch(stmts){
   assert.equal(stmts.length,2);
   const [eventId,invoiceId,orderRef,sha,amount]=stmts[0].args;
   const [account,currency,credit]=stmts[1].args;
   if(events.has(eventId)||[...events.values()].some(e=>
    e.invoice_id===invoiceId||e.project_order_ref===orderRef))
    throw Error('unique_event_violation');
   if(account!==pending.account_id||currency!=='EUR'||amount!==2500||
      credit!==2500)throw Error('wrong_account_or_amount');
   events.set(eventId,{invoice_id:invoiceId,project_order_ref:orderRef,
    body_sha256:sha});
   balances.set(account,(balances.get(account)||0)+credit);
   return [{meta:{changes:1}},{meta:{changes:1}}];
  }
 };
}
function fakeNetwork(merchantEnv,{outage=false,disagree=false}={}){
 const history={callbacks:[],rpcCalls:0,outage};
 const fetchFn=async(url,options={})=>{
  const target=new URL(url);
  if(target.hostname==='shop.example.com'){
   history.callbacks.push({url,options});
   if(history.outage)return new Response(JSON.stringify({ok:false}),{
    status:503,headers:{'content-type':'application/json'}
   });
   return merchantWorker.fetch(new Request(url,options),merchantEnv);
  }
  if(!rpcHosts.some(peer=>new URL(peer).hostname===target.hostname))
   throw Error('LOCAL_TEST_BLOCKED_EXTERNAL_NETWORK_REQUEST');
  history.rpcCalls++;
  const {method}=JSON.parse(options.body);
  const bad=disagree&&target.hostname==='eth-two.provider-two.example';
  const bh=bad?'0x'+'d'.repeat(64):BLOCK;
  const data={
   eth_chainId:'0x1',eth_blockNumber:'0x80',
   eth_getTransactionByHash:{hash:TX,to:RECEIVER,blockNumber:'0x65',
    blockHash:bh,value:'0x64'},
   eth_getTransactionReceipt:{transactionHash:TX,status:'0x1',
    blockNumber:'0x65',blockHash:bh,logs:[]},
   eth_getBlockByNumber:{number:'0x65',hash:bh,
    timestamp:'0x'+Math.floor(NOW/1000).toString(16)}
  };
  if(!(method in data))throw Error('unexpected_mock_rpc_method');
  return {ok:true,json:async()=>({result:data[method]})};
 };
 return {history,fetchFn};
}
async function setup(options={}){
 const provider=providerDb(),merchant=merchantDb();
 const secret=await projectWebhookKey(MASTER,PROJECT);
 const recipientEnv={PROJECT_ID:PROJECT,
  PROJECT_WEBHOOK_SECRET:secret,PROJECT_DB:merchant};
 return {provider,merchant,providerEnv:env(provider),
  ...fakeNetwork(recipientEnv,options),recipientEnv};
}
async function withNetwork(network,fn){
 const previous=globalThis.fetch;
 globalThis.fetch=network.fetchFn;
 try{return await fn()}finally{globalThis.fetch=previous;}
}
async function settle(state){
 const proof=await verifyChainPaymentQuorum(state.provider.state.invoice,
  TX,state.providerEnv);
 assert.equal(proof.actualAtomic,'100');
 const result=await settleV2(state.provider,state.provider.state.invoice,
  proof,NOW);
 assert.equal(result.status,'verified');
 return result;
}
test('local simulated chain -> outbox -> signed merchant webhook -> ONE credit',async()=>{
 const state=await setup();
 await withNetwork(state,async()=>{
  await settle(state);
  assert.equal(state.provider.state.claims.size,1);
  assert.equal(state.merchant.events.size,0);
  const delivery=await deliverV2(state.providerEnv,NOW);
  assert.equal(delivery.delivered,1);
  assert.equal(state.merchant.balances.get('local_test_account'),2500);
  assert.equal(state.merchant.events.size,1);
  assert.ok(state.history.rpcCalls>=10,'two-of-three proof checks ran');
  const callback=state.history.callbacks[0];
  const replay=await merchantWorker.fetch(
   new Request(callback.url,callback.options),state.recipientEnv);
  assert.equal((await replay.json()).replayed,true);
  assert.equal(state.merchant.balances.get('local_test_account'),2500);
  const after=await deliverV2(state.providerEnv,NOW+60000);
  assert.equal(after.attempted,0);
 });
});
test('local network outage: permanent outbox retries without premature credit',async()=>{
 const state=await setup({outage:true});
 await withNetwork(state,async()=>{
  await settle(state);
  assert.equal((await deliverV2(state.providerEnv,NOW)).failed,1);
  assert.equal(state.merchant.events.size,0);
  assert.equal(state.provider.state.outbox.delivered_at_ms,null);
  state.history.outage=false;
  const next=await deliverV2(state.providerEnv,NOW+4*3600000);
  assert.equal(next.delivered,1);
  assert.equal(state.merchant.balances.get('local_test_account'),2500);
  assert.equal(state.provider.state.claims.size,1);
 });
});
test('local incident review blocks callback until operator resolves',async()=>{
 const state=await setup();
 await withNetwork(state,async()=>{
  await settle(state);
  state.provider.state.auditHold=1;
  assert.equal((await deliverV2(state.providerEnv,NOW)).failed,1);
  assert.equal(state.merchant.events.size,0);
  state.provider.state.auditHold=0;
  state.provider.state.reviewHold=1;
  assert.equal((await deliverV2(state.providerEnv,NOW+4*3600000)).failed,1);
  assert.equal(state.merchant.events.size,0);
  state.provider.state.reviewHold=0;
  assert.equal((await deliverV2(state.providerEnv,NOW+8*3600000)).delivered,1);
  assert.equal(state.merchant.balances.get('local_test_account'),2500);
 });
});
test('local tampered signed payload is rejected; no project money moves',async()=>{
 const state=await setup();
 await withNetwork(state,async()=>{
  await settle(state);
  assert.equal((await deliverV2(state.providerEnv,NOW)).delivered,1);
  const original=state.history.callbacks[0];
  const falsified={...original.options,
   body:JSON.stringify({...JSON.parse(original.options.body),amountMinor:999999})};
  const res=await merchantWorker.fetch(
   new Request(original.url,falsified),state.recipientEnv);
  assert.equal(res.status,401);
  assert.equal(state.merchant.balances.get('local_test_account'),2500);
 });
});
test('local two disagreeing nodes without quorum NEVER create a payment',async()=>{
 const state=await setup({disagree:true});
 // Make third provider fail entirely, so the two available chain views differ.
 const original=state.fetchFn;
 state.fetchFn=async(url,options)=>{
  if(new URL(url).hostname==='eth-three.provider-three.example')
   return {ok:false,status:503};
  return original(url,options);
 };
 await withNetwork(state,async()=>{
  await assert.rejects(()=>verifyChainPaymentQuorum(
   state.provider.state.invoice,TX,state.providerEnv),
   /blockchain_quorum_not_reached/);
  assert.equal(state.provider.state.invoice.status,'awaiting_payment');
  assert.equal(state.provider.state.outbox,null);
  assert.equal(state.merchant.events.size,0);
 });
});
