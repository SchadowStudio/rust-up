import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {handleStarsReadOnly} from './stars-readonly-live.mjs';
import {verifiedTelegramInitData} from './telegram-initdata.mjs';

const BOT_TOKEN='123456789:abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN';
const ORIGIN='https://ttzoomrust-hub.github.io';
const URL='https://rustup-bot.ttzoomrust.workers.dev/api/stars/';
const env={APP_URL:ORIGIN+'/rust-up/',BOT_TOKEN,PAYMENTS_DB:{
  prepare(sql){
    if(sql.includes('FROM rustup_stars_products'))return {
      async all(){return {results:[]};}
    };
    if(sql.includes('FROM rustup_stars_orders'))return {
      bind(...args){
        assert.deepEqual(args,[145675,'paid']);
        return {async all(){return {results:[]};}};
      }
    };
    throw Error('unexpected_sql');
  }
}};
function signData(userId=145675,authDateSeconds=Math.floor(Date.now()/1000)){
  const params=new URLSearchParams({
    auth_date:String(authDateSeconds),
    user:JSON.stringify({id:userId,first_name:'Demo'})
  });
  const string=[...params].sort(([a],[b])=>a.localeCompare(b))
    .map(([k,v])=>k+'='+v).join('\n');
  const secret=createHmac('sha256','WebAppData').update(BOT_TOKEN).digest();
  const hash=createHmac('sha256',secret).update(string).digest('hex');
  params.set('hash',hash);
  return params.toString();
}
function request(route,{origin=ORIGIN,method='POST',body={initData:signData()}}={}){
  return new Request(URL+route,{method,headers:{
    ...(origin?{origin}:{'origin':'https://invalid.example'}),
    'content-type':'application/json'
  },...(method==='POST'?{body:JSON.stringify(body)}:{})});
}
test('health is public but all real money operations explicitly disabled',async()=>{
  const r=await handleStarsReadOnly(new Request(URL+'health'),env);
  assert.equal(r.status,200);
  assert.deepEqual(await r.json(),{
    ok:true,service:'rustup-stars-readonly',checkoutEnabled:false,
    productionEnabled:false,gameBalanceCredit:false
  });
  const checkout=await handleStarsReadOnly(request('checkout'),env);
  assert.equal(checkout.status,503);
  assert.equal((await checkout.json()).error,'stars_checkout_disabled');
});
test('CORS preflight and forged auth are handled with allowed-origin header',async()=>{
  const p=await handleStarsReadOnly(request('catalog',{method:'OPTIONS'}),env);
  assert.equal(p.status,204);
  assert.equal(p.headers.get('access-control-allow-origin'),ORIGIN);
  const bad=await handleStarsReadOnly(request('catalog',{body:{initData:'invalid-test'}}),env);
  assert.equal(bad.status,401);
  assert.equal(bad.headers.get('access-control-allow-origin'),ORIGIN);
});
test('origin rejection occurs before data access',async()=>{
  const r=await handleStarsReadOnly(request('catalog',{origin:'https://evil.example'}),env);
  assert.equal(r.status,403);
  assert.equal((await r.json()).error,'origin_rejected');
});
test('valid signed Telegram auth returns read-only catalogue and owned purchases',async()=>{
  const cat=await handleStarsReadOnly(request('catalog'),env);
  assert.equal(cat.status,200);
  assert.deepEqual(await cat.json(),{ok:true,checkoutEnabled:false,products:[]});
  const mine=await handleStarsReadOnly(request('purchases'),env);
  assert.equal(mine.status,200);
  assert.deepEqual(await mine.json(),{ok:true,purchases:[],gameBalanceCredit:false});
});
test('missing D1 is a fail-closed server error with CORS',async()=>{
  const missing=await handleStarsReadOnly(request('catalog'),{APP_URL:env.APP_URL,BOT_TOKEN});
  assert.equal(missing.status,503);
  assert.equal(missing.headers.get('access-control-allow-origin'),ORIGIN);
  assert.equal((await missing.json()).error,'payment_database_missing');
});
test('unrecognized route never falls through into game or checkout',async()=>{
  const r=await handleStarsReadOnly(new Request(URL+'notreal'),env);
  assert.equal(r.status,404);
});


test('read-only signed initData works after 11 minutes and before 24h',async()=>{
  const elevenMinutesOld=Math.floor(Date.now()/1000)-11*60;
  const token=signData(145675,elevenMinutesOld);
  // Legacy payment-sensitive callers retain their short default 10m TTL.
  await assert.rejects(()=>verifiedTelegramInitData(token,BOT_TOKEN),/expired_telegram_auth/);
  const catalogue=await handleStarsReadOnly(request('catalog',{body:{initData:token}}),env);
  assert.equal(catalogue.status,200);
  assert.equal((await catalogue.json()).checkoutEnabled,false);

  const nearlyOneDayOld=signData(145675,Math.floor(Date.now()/1000)-23*3600);
  const purchases=await handleStarsReadOnly(request('purchases',{body:{initData:nearlyOneDayOld}}),env);
  assert.equal(purchases.status,200);
  assert.deepEqual((await purchases.json()).purchases,[]);
});

test('older than 24h, invalid signature and overly long TTL remain rejected',async()=>{
  const past=signData(145675,Math.floor(Date.now()/1000)-25*3600);
  const expired=await handleStarsReadOnly(request('catalog',{body:{initData:past}}),env);
  assert.equal(expired.status,401);
  const altered=signData(145675).replace('145675','145676');
  const forged=await handleStarsReadOnly(request('purchases',{body:{initData:altered}}),env);
  assert.equal(forged.status,401);
  await assert.rejects(
    ()=>verifiedTelegramInitData(signData(),BOT_TOKEN,Date.now(),86401),
    /invalid_telegram_auth_max_age/
  );
});
