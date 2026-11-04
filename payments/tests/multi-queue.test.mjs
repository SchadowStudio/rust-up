import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileCandidate,consumePaymentEvents} from '../src/multi/candidate.js';
import {notifyDeliveryQueue} from '../src/multi/delivery.js';

test('invalid blockchain hints cannot be booked',async()=>{
 const env={};
 assert.deepEqual(await reconcileCandidate({},{
  chain:'wrong',address:'a',txHash:'b'},env),
  {status:'ignored',reason:'invalid_candidate'});
});
test('dead-letter retries are used while event handling is disabled',async()=>{
 const messages=[{body:{kind:'candidate'},ack(){throw Error('must not ack')},
  retry(options){assert.equal(options.delaySeconds,60);this.didRetry=true}}];
 await consumePaymentEvents({messages},{DB:{},MULTI_AUTO_QUEUE_ENABLED:'false'});
 assert.equal(messages[0].didRetry,true);
});
test('invalid signed event queue payload cannot credit a player',async()=>{
 let acknowledged=0;
 const batch={messages:[
  {body:{kind:'delivery',eventId:'bad'},ack(){acknowledged++},retry(){throw Error('unexpected retry')}},
  {body:{chain:'bad',address:'bad'},ack(){acknowledged++},retry(){throw Error('unexpected retry')}}
 ]};
 await consumePaymentEvents(batch,{DB:{},MULTI_AUTO_QUEUE_ENABLED:'true'});
 assert.equal(acknowledged,2);
});
test('only newly verified payments enqueue a delivery event',async()=>{
 const sent=[];
 const env={MULTI_EVENT_QUEUE:{send:async x=>sent.push(x)}};
 await notifyDeliveryQueue(env,{status:'verified',eventId:'v2:123'});
 await notifyDeliveryQueue(env,{status:'verified',eventId:'v2:123',idempotent:true});
 await notifyDeliveryQueue(env,{status:'manual_review'});
 assert.deepEqual(sent,[{kind:'delivery',eventId:'v2:123'}]);
});
