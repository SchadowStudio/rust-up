// Offline-only check of the existing bot webhook handoff.
// No real Telegram API calls, Cloudflare writes or player balance changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {wrapExistingWorker} from './stars-existing-worker-wrapper.mjs';

const HOST='https://rustup-bot.ttzoomrust.workers.dev';
const SECRET='locally-fabricated-test-secret';
const VALID_ID='123e4567-e89b-42d3-a456-426614174000';
const payload='v:'+VALID_ID;
function variablePrecheckout(){
 return {update_id:2,pre_checkout_query:{
  id:'offline-query-2',from:{id:1234567},currency:'XTR',
  total_amount:55,invoice_payload:payload
 }};
}
function variableReceipt(){
 return {update_id:3,message:{
  from:{id:1234567},
  successful_payment:{
   currency:'XTR',invoice_payload:payload,total_amount:55,
   telegram_payment_charge_id:'offline-charge-receipt-not-real'
  }
 }};
}
function fixedReceipt(){
 return {update_id:4,message:{
  from:{id:1234567},
  successful_payment:{
   currency:'XTR',invoice_payload:VALID_ID,total_amount:5,
   telegram_payment_charge_id:'offline-fixed-charge-not-real'
  }
 }};
}
function setup(){
 const calls=[];
 const original={
  async fetch(){calls.push('game');return new Response('original',{status:200});},
  scheduled(){calls.push('scheduled')}
 };
 const worker=wrapExistingWorker(original,{
  receiveVariableStars:async update=>{
   calls.push('variable');
   return (update?.pre_checkout_query?.invoice_payload||
    update?.message?.successful_payment?.invoice_payload)?.startsWith('v:')===true;
  },
  receiveStars:async()=>{calls.push('fixed');return true;},
  refundStars:async()=>{calls.push('refund');return false;},
  handleStarsApi:async()=>{calls.push('api');return new Response('fixed-api');},
  handleVariableStarsHistory:async()=>{calls.push('history');return Response.json({ok:true,orders:[]});}
 });
 const env={
  WEBHOOK_SECRET:SECRET,
  BOT_TOKEN:'123456789:abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN',
  PAYMENT_PRODUCTION_ENABLED:'false',
  STARS_PAYMENT_ENABLED:'false'
 };
 return {worker,calls,env};
}
function makeRequest(body,secret=SECRET,url='/tg'){
 return new Request(HOST+url,{
  method:'POST',headers:{
   'content-type':'application/json',
   'X-Telegram-Bot-Api-Secret-Token':secret
  },
  body:JSON.stringify(body)
 });
}

test('authenticated v: precheckout is routed only to variable handler',async()=>{
 const x=setup();
 const r=await x.worker.fetch(makeRequest(variablePrecheckout()),x.env,{});
 assert.equal(r.status,200);
 assert.equal(await r.text(),'ok');
 assert.deepEqual(x.calls,['variable']);
});
test('delayed authenticated v: receipt is routed first, even with money flags OFF',async()=>{
 const x=setup();
 const r=await x.worker.fetch(makeRequest(variableReceipt()),x.env,{});
 assert.equal(r.status,200);
 assert.deepEqual(x.calls,['variable']);
});
test('fixed Stars receipt still flows to existing fixed goods handler',async()=>{
 const x=setup();
 const r=await x.worker.fetch(makeRequest(fixedReceipt()),x.env,{});
 assert.equal(r.status,200);
 assert.deepEqual(x.calls,['variable','fixed']);
});
test('wrong webhook secret cannot call either Stars handler',async()=>{
 const x=setup();
 const r=await x.worker.fetch(makeRequest(variableReceipt(),'wrong-secret'),x.env,{});
 assert.equal(await r.text(),'original');
 assert.deepEqual(x.calls,['game']);
});
test('malformed payload and unrelated bot requests stay with original Worker',async()=>{
 const x=setup();
 const r=await x.worker.fetch(makeRequest({update_id:6,message:{text:'hello'}}),x.env,{});
 assert.equal(await r.text(),'original');
 assert.deepEqual(x.calls,['game']);
 x.worker.scheduled();
 assert.deepEqual(x.calls,['game','scheduled']);
});
test('failed variable receipt journal returns 503 so Telegram can retry; fixed handler cannot swallow it',async()=>{
 const x=setup();
 const worker=wrapExistingWorker({fetch:()=>new Response('game')},{
  receiveVariableStars:async()=>{x.calls.push('variable');throw Error('offline-write-failed');},
  receiveStars:async()=>{x.calls.push('fixed');return true;}
 });
 const r=await worker.fetch(makeRequest(variableReceipt()),x.env,{});
 assert.equal(r.status,503);
 assert.deepEqual(x.calls,['variable']);
 assert.equal(r.headers.get('cache-control'),'no-store');
});
test('variable non-match can fall through to original fixed handler, without enabling checkout',async()=>{
 const x=setup();
 const r=await x.worker.fetch(makeRequest(fixedReceipt()),{
  ...x.env,STARS_PAYMENT_ENABLED:'true'
 },{});
 assert.equal(r.status,200);
 assert.deepEqual(x.calls,['variable','fixed']);
});
