import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProof,settleVerified} from '../src/settlement.js';
import {signWebhook,drainOutbox} from '../src/outbox.js';
import {authenticatedOperator} from '../src/operator.js';

const order=()=>({
 id:'00000000-0000-4000-8000-000000000001',
 telegram_id:'1001',package_id:'pkg',asset:'ETH',chain:'ethereum',
 amount_atomic:'1000000000000000',credit_kopecks:10000,
 created_at_ms:1000000,expires_at_ms:2800000,status:'awaiting_payment'
});
const proof=()=>({
 actualAtomic:'1000000000000000',confirmations:12,
 paymentTimeMs:1500000,txHash:'0x'+'a'.repeat(64)
});
test('proof requires mined timestamp and exact chain amounts',()=>{
 assert.equal(validateProof(order(),proof()),true);
 assert.throws(()=>validateProof(order(),{...proof(),paymentTimeMs:0}));
 assert.throws(()=>validateProof(order(),{...proof(),paymentTimeMs:100}));
 assert.throws(()=>validateProof(order(),{...proof(),confirmations:11}));
 assert.throws(()=>validateProof(order(),{...proof(),actualAtomic:'999'}));
 assert.throws(()=>validateProof({...order(),asset:'BTC'},proof()));
});
function fakeDb(){
 const writes=[];
 return {
  writes,
  prepare(sql){return {bind(...args){return {
   run:async()=>{writes.push({sql,args});return {meta:{changes:1}}}
  }}}},
  async batch(stmts){return stmts.map(()=>({meta:{changes:1}}))}
 };
}
test('confirmed payment before expiry can settle after expiry',async()=>{
 const db=fakeDb(),expired={...order(),status:'expired'};
 const result=await settleVerified(db,expired,proof(),86400000);
 assert.equal(result.status,'verified');
 assert.equal(result.eventId,'crypto:'+expired.id);
});
test('late block timestamp creates review entry but never credits',async()=>{
 const db=fakeDb(),late={...proof(),paymentTimeMs:3000000};
 const result=await settleVerified(db,order(),late,5000000);
 assert.equal(result.status,'manual_review');
 assert.equal(result.reason,'late_payment');
 assert.equal(db.writes.length,1);
 assert.match(db.writes[0].sql,/payment_review_queue/);
});
test('already-settled transaction must not settle twice',async()=>{
 const db=fakeDb();
 const result=await settleVerified(db,{...order(),status:'verified'},proof());
 assert.equal(result.status,'already_verified');
 assert.equal(db.writes.length,0);
});
test('signed event authentication covers timestamp, event and payload',async()=>{
 const key='X'.repeat(64),ts=1720000000000;
 const a=await signWebhook(key,ts,'crypto:1','{"amount":100}');
 const b=await signWebhook(key,ts,'crypto:1','{"amount":101}');
 assert.match(a,/^[0-9a-f]{64}$/);
 assert.notEqual(a,b);
 await assert.rejects(()=>signWebhook('too-short',ts,'crypto:1','{}'));
});
test('outbox stays offline unless explicitly enabled',async()=>{
 assert.equal((await drainOutbox({DB:{}})).skipped,true);
});
test('operator requires high-entropy configured token',async()=>{
 const key='a'.repeat(48),env={OPERATOR_API_KEY:key};
 const yes=new Request('https://example.invalid/v1/operator/receivers',{
  headers:{authorization:'Bearer '+key}});
 assert.equal(await authenticatedOperator(yes,env),true);
 const no=new Request('https://example.invalid/v1/operator/receivers',{
  headers:{authorization:'Bearer '+key.replace('a','b')}});
 assert.equal(await authenticatedOperator(no,env),false);
 assert.equal(await authenticatedOperator(yes,{OPERATOR_API_KEY:'tiny'}),false);
});
