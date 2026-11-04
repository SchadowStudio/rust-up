import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createLocalDemo} from '../scripts/local-demo-server.mjs';
import {RustUpLocalSandboxBridge} from '../integration/rust-up-local/bridge.mjs';

async function setup(task){
 const demo=createLocalDemo(),info=await demo.listen();
 const bridge=new RustUpLocalSandboxBridge({gatewayUrl:info.url,credentials:info});
 try{await task({bridge,demo,info})}
 finally{bridge.close();await demo.close();}
}
test('RUST UP sandbox order stays unpaid before LOCAL webhook, then credits once',async()=>{
 await setup(async({bridge})=>{
  const playerRef=randomUUID();
  const order=await bridge.createOrder({playerRef,fiat:'EUR',amountMinor:2500,asset:'ETH'});
  assert.equal(order.status,'pending');
  assert.equal(bridge.balance(playerRef,'EUR'),0);
  assert.equal((await bridge.synchronize()).credited,0);
  const paid=await bridge.simulate(order.order_id);
  assert.equal(paid.status,'credited');
  assert.equal(bridge.balance(playerRef,'EUR'),2500);
  const repeated=await bridge.simulate(order.order_id);
  assert.equal(repeated.status,'credited');
  assert.equal(bridge.balance(playerRef,'EUR'),2500);
  assert.equal((await bridge.synchronize()).credited,0);
  assert.equal(bridge.balance(playerRef,'RUB'),0);
 });
});
test('RUST UP sandbox keeps separate players, currencies and idempotent orders',async()=>{
 await setup(async({bridge})=>{
  const one=randomUUID(),two=randomUUID();
  const first=await bridge.createOrder({playerRef:one,fiat:'EUR',amountMinor:1000,asset:'ETH'});
  const second=await bridge.createOrder({playerRef:two,fiat:'USD',amountMinor:4500,asset:'TRX'});
  await bridge.simulate(first.order_id);
  assert.equal(bridge.balance(one,'EUR'),1000);
  assert.equal(bridge.balance(two,'USD'),0);
  await bridge.simulate(second.order_id);
  assert.equal(bridge.balance(two,'USD'),4500);
  assert.equal(bridge.balance(one,'USD'),0);
  assert.equal(bridge.balance(two,'EUR'),0);
  assert.equal(bridge.order(first.order_id).invoice_id,first.invoice_id);
 });
});
test('RUST UP sandbox rejects production hosts and invalid accounts',async()=>{
 const credentials={projectId:randomUUID(),projectApiKey:'a'.repeat(80),
  operatorKey:'b'.repeat(80),mode:'LOCAL_SIMULATION_ONLY'};
 for(const address of ['https://provider.example.org','http://localhost:3029',
   'http://127.0.0.1:3029@attacker.example.com',
   'http://127.0.0.1:3029/path','http://192.168.1.1:3029']){
  assert.throws(()=>new RustUpLocalSandboxBridge({
   gatewayUrl:address,credentials
  }),/sandbox_gateway_must_be_localhost/);
 }
 await setup(async({bridge})=>{
  await assert.rejects(()=>bridge.createOrder({playerRef:'12345'}),/invalid_sandbox_order/);
  await assert.rejects(()=>bridge.createOrder({amountMinor:0}),/invalid_sandbox_order/);
  await assert.rejects(()=>bridge.simulate(randomUUID()),/sandbox_invoice_missing/);
 });
});
