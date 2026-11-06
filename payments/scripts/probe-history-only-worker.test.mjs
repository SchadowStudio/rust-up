import test from 'node:test';
import assert from 'node:assert/strict';
import {probeHistoryOnlyWorker} from './probe-history-only-worker.mjs';

test('public smoke test never sends paid invoice or real Telegram credentials',async()=>{
 const calls=[];
 const response=async(url,init)=>{
  calls.push({url:String(url),init});
  let status=404;
  if(String(url).endsWith('/history')){
   if(init.method==='OPTIONS')status=204;
   else if(init.headers.origin==='https://evil.example')status=403;
   else status=401;
  }
  return {
   status,headers:new Headers({
    'cache-control':'no-store',
    'access-control-allow-origin':init.headers.origin===
     'https://ttzoomrust-hub.github.io'?init.headers.origin:''
   })
  };
 };
 const report=await probeHistoryOnlyWorker(response);
 assert.equal(report.probes.length,5);
 assert.equal(report.anyPaymentCreated,false);
 assert.equal(report.anyBalanceWrite,false);
 assert.equal(report.realTelegramCredentialsUsed,false);
 assert.ok(calls.every(call=>
  call.init.method==='OPTIONS'||call.init.method==='POST'));
 assert.ok(calls.every(call=>
  !call.init.body||!call.init.body.includes('telegram_payment_charge_id')));
 assert.ok(calls.every(call=>!call.init.body||
  !call.init.body.includes('openInvoice')));
});

test('unexpected HTTP or cache header fails closed, not marked as healthy',async()=>{
 const badFetch=async()=>({status:200,headers:new Headers()});
 await assert.rejects(()=>probeHistoryOnlyWorker(badFetch),/unexpected_/);
 const noCache=async()=>({status:204,headers:new Headers()});
 await assert.rejects(()=>probeHistoryOnlyWorker(noCache),/not_private/);
});
