import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateQuote,quoteFromRate,FIATS} from '../src/multi/fiat.js';
import {requireOrderRef,requireIdempotency,safeWebhookUrl} from '../src/multi/identity.js';
import {newSecret,digestHex,authenticateProject,projectWebhookKey} from '../src/multi/keys.js';
import {signV2Webhook} from '../src/multi/delivery.js';
import {verifyProjectCallback} from '../integration/project-ledger/worker.js';
import {checkoutReady,handleMulti} from '../src/multi/api.js';
const projectId='d9f4a04c-4e81-4d9a-85dc-af9c9260c903';
const orderId='b5d5cd1a-673f-4948-b234-96f9046d7fbc';
const invoiceId='8f18c514-3f74-4a86-a0e4-13ebf905b4d1';
const now=1762300000000;
test('all three fiat currencies use exactly 100 minor units',()=>{
 assert.deepEqual(FIATS,['RUB','EUR','USD']);
 for(const fiat of FIATS){
  const rate={fiat,asset:'USDT_ERC20',enabled:1,
   numerator_atomic:'1000',denominator_minor:'1',
   valid_from_ms:now-1000,expires_at_ms:now+3600000};
  const product={currency:fiat,amount_minor:100};
  const q=quoteFromRate(product,rate,'USDT_ERC20',now);
  assert.equal(q.amountAtomic,'100000');
  assert.equal(q.currency,fiat);
 }
});
test('fractions always round up using BigInt',()=>{
 assert.equal(calculateQuote(101,'1','10'),'11');
 assert.equal(calculateQuote(100000000000,'100000000000000','3'),
  '3333333333333333333333334');
 assert.throws(()=>calculateQuote(123,'0','1'));
 assert.throws(()=>calculateQuote(123,'1','0'));
 assert.throws(()=>calculateQuote(0,'1','1'));
});
test('rate must be active, valid, server-controlled and unexpired',()=>{
 const sample={fiat:'RUB',asset:'BTC',enabled:1,numerator_atomic:'1',
  denominator_minor:'1',valid_from_ms:now,expires_at_ms:now+180000};
 assert.equal(quoteFromRate({currency:'RUB',amount_minor:100},sample,'BTC',now).amountAtomic,'100');
 assert.throws(()=>quoteFromRate({currency:'EUR',amount_minor:100},sample,'BTC',now));
 assert.throws(()=>quoteFromRate({currency:'RUB',amount_minor:100},{...sample,enabled:0},'BTC',now));
 assert.throws(()=>quoteFromRate({currency:'RUB',amount_minor:100},{...sample,expires_at_ms:now+120000},'BTC',now));
});
test('opaque refs reject email, Telegram and Steam IDs',()=>{
 assert.equal(requireOrderRef(orderId),orderId);
 assert.equal(requireIdempotency(invoiceId),invoiceId);
 for(const ref of ['76561199051587451','person@example.com','telegram:123','AA'.repeat(20),'bad']){
  assert.throws(()=>requireOrderRef(ref));
  assert.throws(()=>requireIdempotency(ref));
 }
});
test('webhooks block loopback, local names, HTTP, credentials and non-HTTPS ports',()=>{
 assert.equal(safeWebhookUrl('https://shop.example.com/internal/crypto/credit'),
  'https://shop.example.com/internal/crypto/credit');
 for(const s of ['http://example.com/a','https://127.0.0.1/x','https://localhost/x',
  'https://foo.internal/x','https://me:password@example.com/x',
  'https://example.com:8443/x','https://[::1]/x','https://example.com/x#fragment']){
  assert.throws(()=>safeWebhookUrl(s),s);
 }
});
test('API token is long random and stored hash only',async()=>{
 const token=newSecret();
 assert.match(token,/^rup2_[a-f0-9]{64}$/);
 assert.equal((await digestHex(token)).length,64);
 const second=newSecret();
 assert.notEqual(token,second);
});
test('project keys isolate tenant access',async()=>{
 const key=newSecret(),hash=await digestHex(key);
 const db={prepare(){return {bind(){return {all:async()=>({results:[
  {id:projectId,status:'active',secret_sha256:hash,webhook_url:'https://example.com/credit'}]})}}}}};
 const request=new Request('https://gateway.example/v2/me',{headers:{
  'x-project-id':projectId,authorization:'Bearer '+key}});
 assert.equal((await authenticateProject(db,request)).id,projectId);
 const bad=new Request('https://gateway.example/v2/me',{headers:{
  'x-project-id':projectId,authorization:'Bearer '+newSecret()}});
 await assert.rejects(()=>authenticateProject(db,bad));
});
test('outbound callback validates project-scoped signature, timestamp and content',async()=>{
 const master='m'.repeat(64);
 const projectSecret=await projectWebhookKey(master,projectId);
 const event={eventVersion:2,eventId:'v2:'+invoiceId,projectId,
  invoiceId,projectOrderRef:orderId,amountMinor:5000,currency:'RUB',
  asset:'USDT_TRC20',chain:'tron',amountAtomic:'5000000',
  transactionHash:'a'.repeat(64),confirmedAt:now};
 const raw=JSON.stringify(event);
 const mac=await signV2Webhook(master,projectId,event.eventId,now,raw);
 const make=(sig=mac,stamp=now,body=raw)=>new Request(
  'https://shop.example.com/internal/crypto/credit',{method:'POST',
   headers:{'content-type':'application/json','x-rup-project':projectId,
    'x-rup-event':event.eventId,'x-rup-timestamp':String(stamp),
    'x-rup-signature':sig},body});
 assert.deepEqual((await verifyProjectCallback(make(),
  {PROJECT_ID:projectId,PROJECT_WEBHOOK_SECRET:projectSecret},now)).event,event);
 await assert.rejects(()=>verifyProjectCallback(make(mac,now+360000),{
  PROJECT_ID:projectId,PROJECT_WEBHOOK_SECRET:projectSecret},now));
 await assert.rejects(()=>verifyProjectCallback(make(mac,now,raw+' '),{
  PROJECT_ID:projectId,PROJECT_WEBHOOK_SECRET:projectSecret},now));
 await assert.rejects(()=>verifyProjectCallback(make(),{
  PROJECT_ID:orderId,PROJECT_WEBHOOK_SECRET:projectSecret},now));
});
test('real checkout is disabled by default, no origin-based browser bypass',async()=>{
 assert.equal(checkoutReady({}),false);
 const disabled=await handleMulti(new Request('https://gate.example/v2/invoices'),{});
 assert.equal(disabled.status,503);
 const browser=await handleMulti(new Request('https://gate.example/v2/invoices',{
  headers:{origin:'https://random.example'}}),{});
 assert.equal(browser.status,403);
 const health=await handleMulti(new Request('https://gate.example/health'),{});
 assert.equal((await health.json()).checkout,false);
});
