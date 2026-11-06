// Offline tests for the live read-only Worker + optional variable Stars
// webhook layer. No Telegram API, no Cloudflare writes, no real payments.
import test from 'node:test';
import assert from 'node:assert/strict';
import {wrapHistoryOnlyWorker} from './stars-history-only-wrapper.mjs';
import {wrapCurrentStarsWebhook}
 from './stars-variable-webhook-wrapper.mjs';

const HOST='https://rustup-bot.ttzoomrust.workers.dev';
const SECRET='fake-private-webhook-secret';
const ID='123e4567-e89b-42d3-a456-426614174000';
function req(update,secret=SECRET){
 return new Request(HOST+'/tg',{
  method:'POST',
  headers:{'content-type':'application/json',
   'X-Telegram-Bot-Api-Secret-Token':secret},
  body:JSON.stringify(update)
 });
}
function payUpdate(kind='receipt'){
 if(kind==='precheckout')return {pre_checkout_query:{
  currency:'XTR',invoice_payload:'v:'+ID,
  id:'fake-query',from:{id:12345},total_amount:55
 }};
 return {message:{from:{id:12345},successful_payment:{
  invoice_payload:'v:'+ID,currency:'XTR',total_amount:55,
  telegram_payment_charge_id:'fictional-charge'
 }}};
}
function fixture(){
 const calls=[];
 const original={
  fetch:async request=>{
   calls.push('game');
   return new Response(new URL(request.url).pathname,{status:200});
  },
  scheduled(){calls.push('cron');}
 };
 const readonly=wrapHistoryOnlyWorker(original);
 const wrapper=wrapCurrentStarsWebhook(readonly,{
  receiveVariableStars:async()=>{calls.push('variable');return true;}
 });
 const env={WEBHOOK_SECRET:SECRET,
  STARS_PAYMENT_ENABLED:'false',PAYMENT_PRODUCTION_ENABLED:'false'};
 return {wrapper,env,calls};
}
test('target v: receipt is received once and does not run original bot, regardless of all flags OFF',async()=>{
 const f=fixture();
 const r=await f.wrapper.fetch(req(payUpdate()),f.env,{});
 assert.equal(r.status,200);
 assert.equal(r.headers.get('cache-control'),'no-store');
 assert.deepEqual(f.calls,['variable']);
});
test('target v: precheckout is routed to variable handler (which refuses when OFF)',async()=>{
 const f=fixture();
 const r=await f.wrapper.fetch(req(payUpdate('precheckout')),f.env,{});
 assert.equal(r.status,200);
 assert.deepEqual(f.calls,['variable']);
});
test('bad webhook secret, non-variable payment and unrelated messages retain original bot routing',async()=>{
 const f=fixture();
 await f.wrapper.fetch(req(payUpdate(),'invalid'),f.env,{});
 await f.wrapper.fetch(req({message:{successful_payment:{
  invoice_payload:ID,currency:'XTR'
 }}}),f.env,{});
 await f.wrapper.fetch(req({message:{text:'ordinary'}}),f.env,{});
 assert.deepEqual(f.calls,['game','game','game']);
 await f.wrapper.scheduled();
 assert.equal(f.calls.at(-1),'cron');
});
test('invalid JSON retains the old bot handling, never forges a payment event',async()=>{
 const f=fixture();
 const r=await f.wrapper.fetch(new Request(HOST+'/tg',{
  method:'POST',headers:{
   'content-type':'application/json',
   'X-Telegram-Bot-Api-Secret-Token':SECRET
  },body:'{'
 }),f.env,{});
 assert.equal(r.status,200);
 assert.deepEqual(f.calls,['game']);
});
test('journal write failure produces Telegram retry, never tells Telegram it was saved',async()=>{
 const f=fixture();
 const r=await wrapCurrentStarsWebhook(f.wrapper,{
  receiveVariableStars:async()=>{throw Error('unavailable DB');}
 }).fetch(req(payUpdate()),f.env,{});
 assert.equal(r.status,503);
 assert.equal(r.headers.get('cache-control'),'no-store');
 assert.deepEqual(f.calls,[]);
});
test('non-acknowledged variable event also fails closed with 503',async()=>{
 const f=fixture();
 const r=await wrapCurrentStarsWebhook(f.wrapper,{
  receiveVariableStars:async()=>false
 }).fetch(req(payUpdate()),f.env,{});
 assert.equal(r.status,503);
 assert.deepEqual(f.calls,[]);
});
test('the read-only quote and history routes remain delegated, never replaced by webhook layer',async()=>{
 const f=fixture();
 const input=new Request(HOST+'/api/stars/variable/checkout',{
  method:'POST',headers:{'content-type':'application/json'},
  body:'{}'
 });
 const denied=await f.wrapper.fetch(input,f.env,{});
 assert.equal(denied.status,404);
 assert.deepEqual(f.calls,[]);
});

test('scheduled Worker runs original cron; paid delivery only with all separate gates ON',async()=>{
 const calls=[];
 const original={
  fetch:async()=>new Response('original'),
  scheduled:async()=>{calls.push('original-cron');}
 };
 const wrapped=wrapCurrentStarsWebhook(original,{
  settlePaidStars:async()=>{calls.push('durable-delivery');}
 });
 const off={PAYMENT_PRODUCTION_ENABLED:'false',
  STARS_GAME_CREDIT_SETTLEMENT_ENABLED:'false',
  STARS_VARIABLE_CREDIT_LEDGER_READY:'false',
  PAYMENT_WALLET_STRICT_MODE:'false'};
 await wrapped.scheduled({},off,{});
 assert.deepEqual(calls,['original-cron']);
 const configured={
  PAYMENT_PRODUCTION_ENABLED:'true',
  STARS_GAME_CREDIT_SETTLEMENT_ENABLED:'true',
  STARS_VARIABLE_CREDIT_LEDGER_READY:'true',
  PAYMENT_WALLET_STRICT_MODE:'true',
  BOT_TOKEN:'offline-string',
  DB:{prepare(){}},PAYMENTS_DB:{prepare(){}}
 };
 await wrapped.scheduled({},configured,{});
 assert.deepEqual(calls,['original-cron','original-cron','durable-delivery']);
 await assert.rejects(()=>wrapCurrentStarsWebhook(original,{
  settlePaidStars:async()=>{throw Error('provider offline');}
 }).scheduled({},configured,{}),/stars_delivery_scheduler_requires_retry/);
 assert.deepEqual(calls.slice(-1),['original-cron']);
});
