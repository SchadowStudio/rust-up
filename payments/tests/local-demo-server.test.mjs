import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createLocalDemo} from '../scripts/local-demo-server.mjs';

async function run(fn){
 const app=createLocalDemo(),info=await app.listen();
 const post=async(route,body,{authorized=true,operator=false,idempotencyKey=randomUUID(),
  origin,overrideKey}={})=>{
  const headers={'content-type':'application/json','idempotency-key':idempotencyKey};
  if(authorized){
   headers.authorization='Bearer '+(overrideKey||info.projectApiKey);
   headers['x-project-id']=info.projectId;
  }
  if(operator)headers['x-local-operator']=info.operatorKey;
  if(origin)headers.origin=origin;
  const res=await fetch(info.url+route,{
   method:'POST',headers,body:JSON.stringify(body||{}),
   signal:AbortSignal.timeout(5000)
  });
  return {status:res.status,body:await res.json()};
 };
 const get=async(route,{authorized=true,operator=false}={})=>{
  const headers={};
  if(authorized){headers.authorization='Bearer '+info.projectApiKey;
   headers['x-project-id']=info.projectId;}
  if(operator)headers['x-local-operator']=info.operatorKey;
  const res=await fetch(info.url+route,{headers,signal:AbortSignal.timeout(5000)});
  return {status:res.status,body:await res.json()};
 };
 try{return await fn({post,get,info,app});}
 finally{await app.close();}
}
test('localhost demo accepts simulated invoice and real HMAC project callback only once',async()=>{
 await run(async({post,get})=>{
  const key=randomUUID(),data={currency:'EUR',amountMinor:2500,
   asset:'ETH',projectOrderRef:randomUUID()};
  const created=await post('/v2/deposits',data,{idempotencyKey:key});
  assert.equal(created.status,201);
  assert.equal(created.body.invoice.receiveAddress,null);
  assert.equal(created.body.invoice.confirmedOnChain,false);
  const invoiceId=created.body.invoice.invoiceId;
  const replay=await post('/v2/deposits',data,{idempotencyKey:key});
  assert.equal(replay.body.replayed,true);
  assert.equal(replay.body.invoice.invoiceId,invoiceId);
  const badBody=await post('/v2/deposits',{...data,amountMinor:9999},{
   idempotencyKey:key});
  assert.equal(badBody.status,409);
  const before=await get('/demo/merchant/balance',{authorized:false,operator:true});
  assert.equal(before.body.creditCount,0);
  const first=await post('/demo/invoices/'+invoiceId+'/simulate-confirmation',{},{
   authorized:false,operator:true});
  assert.equal(first.body.merchantAck,true,JSON.stringify(first.body));
  assert.equal(first.body.replayed,false);
  const again=await post('/demo/invoices/'+invoiceId+'/simulate-confirmation',{},{
   authorized:false,operator:true});
  assert.equal(again.body.replayed,true);
  const after=await get('/demo/merchant/balance',{authorized:false,operator:true});
  assert.equal(after.body.creditCount,1);
  assert.deepEqual(after.body.wallets,[{
   account_id:'LOCAL_TEST_ACCOUNT',currency:'EUR',balance_minor:2500
  }]);
  const invoice=await get('/v2/invoices/'+invoiceId);
  assert.equal(invoice.body.invoice.status,'verified');
  assert.equal(invoice.body.invoice.confirmedOnChain,false);
  assert.equal(invoice.body.invoice.deliveredToProject,true);
  const events=await get('/v2/events');
  assert.equal(events.body.events.length,1);
  assert.equal(events.body.events[0].delivered,true);
  assert.equal(events.body.events[0].body.amountMinor,2500);
 });
});
test('localhost demo rejects missing/mistaken API keys, remote origins, operator spoofing',async()=>{
 await run(async({post,get})=>{
  const data={currency:'USD',amountMinor:100,asset:'TRX',
   projectOrderRef:randomUUID()};
  assert.equal((await get('/v2/me',{authorized:false})).status,401);
  assert.equal((await post('/v2/deposits',data,{overrideKey:'not-the-key'})).status,401);
  assert.equal((await post('/v2/deposits',data,{origin:'https://evil.example'})).status,403);
  assert.equal((await post('/demo/invoices/'+randomUUID()+'/simulate-confirmation',{})).status,401);
  assert.equal((await get('/demo/merchant/balance',{authorized:false})).status,401);
  assert.equal((await get('/health',{authorized:false})).body.realPaymentsEnabled,false);
  const wrong=await post('/v2/deposits',{...data,asset:'UNSUPPORTED'});
  assert.equal(wrong.status,400);
 });
});
test('localhost demo uses separate SQLite test DB and never switches production on',async()=>{
 const old=process.env.MULTI_LIVE_ENABLED;
 try{
  process.env.MULTI_LIVE_ENABLED='true';
  assert.throws(()=>createLocalDemo(),/LOCAL_DEMO_FORBIDDEN_IN_PRODUCTION/);
 }finally{
  if(old===undefined)delete process.env.MULTI_LIVE_ENABLED;
  else process.env.MULTI_LIVE_ENABLED=old;
 }
 await run(async({info})=>{
  assert.equal(info.mode,'LOCAL_SIMULATION_ONLY');
  assert.match(info.url,/^http:\/\/127\.0\.0\.1:[0-9]+$/);
 });
});
