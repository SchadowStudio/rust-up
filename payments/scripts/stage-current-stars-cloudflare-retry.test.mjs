import test from 'node:test';
import assert from 'node:assert/strict';
import {readCloudflareWithRetry} from './stage-current-stars-webhook-only.mjs';

test('temporary 503 retries read-only and returns verified API payload',async()=>{
 let calls=0;const delays=[];
 const result=await readCloudflareWithRetry('https://example.invalid/workers','test-token',{
  fetchImpl:async(_url,options)=>{
   calls++;
   assert.equal(options.method,'GET');
   return calls<3?{ok:false,status:503}:{ok:true,json:async()=>({success:true,result:{version:'ok'}})};
  },sleep:async ms=>{delays.push(ms);}
 });
 assert.deepEqual(result,{version:'ok'});
 assert.equal(calls,3);
 assert.deepEqual(delays,[800,1600]);
});
test('persistent 503 remains fail-closed after finite retries',async()=>{
 let calls=0;
 await assert.rejects(
  readCloudflareWithRetry('https://example.invalid/workers','test-token',{
   fetchImpl:async()=>{calls++;return {ok:false,status:503};},
   sleep:async()=>{}
  }),/stars_webhook_stage_cloudflare_read_503/
 );
 assert.equal(calls,4);
});
test('authorization failure must not retry',async()=>{
 let calls=0;
 await assert.rejects(
  readCloudflareWithRetry('https://example.invalid/workers','test-token',{
   fetchImpl:async()=>{calls++;return {ok:false,status:403};},
   sleep:async()=>{throw Error('unexpected retry');}
  }),/stars_webhook_stage_cloudflare_read_403/
 );
 assert.equal(calls,1);
});
