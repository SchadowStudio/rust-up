import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudflareReadOnly} from './cloudflare-readonly-recovery.mjs';
const ACCOUNT='af72e32cb9f1ba99dba07df30fe540fe';
const BASE='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+
 '/workers/scripts/rustup-bot/';
const TOKEN='safe-test-token-not-a-real-key';
test('Cloudflare transient 401 retries exact same GET with identical auth once',async()=>{
 const calls=[];
 const reply=await cloudflareReadOnly(BASE+'content/v2',TOKEN,async(url,opts)=>{
  calls.push({url,method:opts.method,headers:opts.headers,redirect:opts.redirect});
  return calls.length===1?{status:401,ok:false}:{status:200,ok:true,text:async()=>'mock'};
 });
 assert.equal(reply.ok,true);
 assert.equal(calls.length,2);
 assert.equal(calls[0].url,calls[1].url);
 assert.equal(calls[0].method,'GET');
 assert.equal(calls[1].method,'GET');
 assert.equal(calls[0].redirect,'error');
 assert.deepEqual(calls[0].headers,calls[1].headers);
});
test('persistent Cloudflare unauthorized stays blocked after at most one retry',async()=>{
 let requests=0;
 const reply=await cloudflareReadOnly(BASE+'content/v2',TOKEN,async()=>{
  requests++;return {status:401,ok:false};
 });
 assert.equal(reply.status,401);
 assert.equal(requests,2);
});
test('non-401 forbidden, missing and changed resources are never retried',async()=>{
 for(const status of [403,404,429,500]){
  let requests=0;
  const response=await cloudflareReadOnly(BASE+'settings',TOKEN,async()=>{
   requests++;return {status,ok:false};
  });
  assert.equal(response.status,status);
  assert.equal(requests,1);
 }
});
test('only exact account, rustup-bot and recovery GETs are approved',async()=>{
 for(const url of [
  'https://other.invalid/api',
  'https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/workers/scripts/other/content/v2',
  'https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/workers/scripts/rustup-bot',
  BASE+'deployments/123',
  BASE+'content/v2?delete=true',
  BASE.replace(ACCOUNT,'ffffffffffffffffffffffffffffffff')+'secrets'
 ]){
  await assert.rejects(()=>cloudflareReadOnly(url,TOKEN,async()=>{
   throw Error('unapproved endpoint was contacted');
  }),/unapproved_recovery_endpoint/);
 }
 await assert.rejects(()=>cloudflareReadOnly(BASE+'content/v2','',async()=>{
  throw Error('missing credential should not call API');
 }),/recovery_auth_required/);
});
