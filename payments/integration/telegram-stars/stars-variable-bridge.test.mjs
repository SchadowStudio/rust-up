import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import {variableStarsApi,variableStarsWebhook,pilotStarsUserAllowed,pilotStarsAmountAllowed} from './stars-variable-bridge.mjs';
import {quoteVariableStars} from './variable-stars.mjs';

const bot='123456789:abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN';
const origin='https://ttzoomrust-hub.github.io';
const endpoint='https://rustup-bot.ttzoomrust.workers.dev/api/stars/variable/';
const env={APP_URL:origin+'/rust-up/',BOT_TOKEN:bot,
 STARS_MIN_RUB_MINOR:'100',STARS_MAX_RUB_MINOR:'10000000',
 STARS_RUB_MINOR_PER_STAR_NUM:'300',STARS_RUB_MINOR_PER_STAR_DEN:'1',
 STARS_PAYMENT_ENABLED:'false',STARS_VARIABLE_TOPUP_ENABLED:'false',
 PAYMENT_PRODUCTION_ENABLED:'false',
 DB:{prepare(){throw Error('empty owner history must not query game journals')}},
 PAYMENTS_DB:{prepare(sql){
  assert.match(sql,/rustup_stars_variable_orders/);
  return {bind(id){assert.equal(id,123456);return {async all(){return {results:[]};}}}};
 }}};
function signedAuth(secondsAgo=10){
 const p=new URLSearchParams({
  auth_date:String(Math.floor(Date.now()/1000)-secondsAgo),
  user:JSON.stringify({id:123456,first_name:'Demo'})
 });
 const data=[...p].sort(([a],[b])=>a.localeCompare(b))
  .map(([k,v])=>k+'='+v).join('\n');
 const secret=createHmac('sha256','WebAppData').update(bot).digest();
 p.set('hash',createHmac('sha256',secret).update(data).digest('hex'));
 return p.toString();
}
function req(route,body,opts={}){
 return new Request(endpoint+route,{
  method:opts.method||'POST',
  headers:{origin:opts.origin||origin,'content-type':'application/json'},
  ...(opts.method==='OPTIONS'?{}:{body:JSON.stringify({initData:signedAuth(),...body})})
 });
}
test('exact arbitrary amount, not fixed product SKU, is priced by merchant settings',async()=>{
 const response=await variableStarsApi(req('quote',{amountMinor:150000}),env);
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.ok,true);
 assert.equal(data.requestedAmountMinor,150000);
 assert.equal(data.priceStars,500); // test-only illustrative conversion
 assert.equal(data.checkoutEnabled,false);
 assert.equal(data.creditedToGame,false);
 assert.equal(data.currency,'RUB');
});
test('custom decimals are supported in RUB minor units, no invented rate',()=>{
 assert.equal(quoteVariableStars(25050,env).requestedAmountMinor,25050);
 assert.throws(()=>quoteVariableStars(25050,{}),/unconfigured/);
});
test('read-only quote accepts valid 11-minute signed session',async()=>{
 const original=req('quote',{amountMinor:12345});
 const actual=await variableStarsApi(new Request(original.url,{
  method:'POST',headers:original.headers,
  body:JSON.stringify({initData:signedAuth(11*60),amountMinor:12345})
 }),env);
 assert.equal(actual.status,200);
});
test('checkout refuses payment while credit ledger not connected, even if Stars flags are ON',async()=>{
 const x={...env,STARS_PAYMENT_ENABLED:'true',STARS_VARIABLE_TOPUP_ENABLED:'true',
  PAYMENT_PRODUCTION_ENABLED:'true'};
 const response=await variableStarsApi(req('checkout',{
  amountMinor:10000,requestId:'66c5e3f1-21ca-4331-9cf4-ea46f0f4e3f1'
 }),x,async()=>{throw Error('unexpected Telegram API call')});
 assert.equal(response.status,503);
 assert.equal((await response.json()).error,'topup_checkout_disabled');
});
test('webhook ignores fixed products, and denies untrusted browser origins',async()=>{
 assert.equal(await variableStarsWebhook({},env),false);
 const denied=await variableStarsApi(req('quote',{amountMinor:50000},{origin:'https://evil.example'}),env);
 assert.equal(denied.status,403);
});
test('origin preflight and owner-only history have no personally identifying output',async()=>{
 const preflight=await variableStarsApi(req('history',null,{method:'OPTIONS'}),env);
 assert.equal(preflight.status,204);
 assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
 const history=await variableStarsApi(req('history',{}),env);
 assert.equal(history.status,200);
 assert.deepEqual(await history.json(),{ok:true,orders:[],statusComplete:true});
});
test('forged or missing Telegram authentication fails closed',async()=>{
 const response=await variableStarsApi(new Request(endpoint+'quote',{
  method:'POST',headers:{origin,'content-type':'application/json'},
  body:JSON.stringify({initData:'invalid',amountMinor:10000})
 }),env);
 assert.equal(response.status,401);
});

test('signed Mini App quote uses the selected 1.83 RUB/Star rate, without charging',async()=>{
 const owner=JSON.parse(readFileSync(new URL('../../stars-owner-rate.json',import.meta.url),'utf8'));
 const response=await variableStarsApi(req('quote',{amountMinor:100000}),{
  ...env,...owner
 });
 assert.equal(response.status,200);
 const q=await response.json();
 assert.equal(q.requestedAmountMinor,100000);
 assert.equal(q.priceStars,547);
 assert.equal(q.rateNumerator,183000);
 assert.equal(q.rateDenominator,1000);
 assert.equal(q.checkoutEnabled,false);
 assert.equal(q.creditedToGame,false);
});

test('pilot Stars access is explicitly configured server-side, not inferred from player or browser input',()=>{
 const pilot={STARS_VARIABLE_PILOT_USER_IDS:'123456,7390606911'};
 assert.equal(pilotStarsUserAllowed(pilot,123456),true);
 assert.equal(pilotStarsUserAllowed(pilot,7390606911),true);
 assert.equal(pilotStarsUserAllowed(pilot,123457),false);
 for(const raw of [undefined,'','0','123456,123456',
  '123456,unknown','123456,,7390606911',
  '123456, 7390606911, 0',
  Array(11).fill('123456').join(',')]){
  assert.equal(pilotStarsUserAllowed({STARS_VARIABLE_PILOT_USER_IDS:raw},123456),false);
 }
 assert.equal(pilotStarsUserAllowed(pilot,NaN),false);
});
test('ordinary player cannot see payable quote or reach checkout without pilot allowlist',async()=>{
 const pay={
  ...env,
  STARS_PAYMENT_ENABLED:'true',
  STARS_VARIABLE_TOPUP_ENABLED:'true',
  PAYMENT_PRODUCTION_ENABLED:'true',
  STARS_VARIABLE_PILOT_USER_IDS:'7390606911'
 };
 const quote=await variableStarsApi(req('quote',{amountMinor:10000}),pay);
 assert.equal(quote.status,200);
 assert.equal((await quote.json()).checkoutEnabled,false);
 const buy=await variableStarsApi(req('checkout',{
  amountMinor:10000,
  requestId:'66c5e3f1-21ca-4331-9cf4-ea46f0f4e3f1'
 }),pay,async()=>{throw Error('unexpected_telegram_invoice');});
 assert.equal(buy.status,503);
 assert.equal((await buy.json()).error,'topup_checkout_disabled');
});

test('pilot payment amount is capped and expires within one day',()=>{
 const now=Date.now();
 const good={
  STARS_VARIABLE_PILOT_MAX_STARS:'2',
  STARS_VARIABLE_PILOT_EXPIRES_AT_MS:String(now+30*60*1000)
 };
 assert.equal(pilotStarsAmountAllowed(good,1,now),true);
 assert.equal(pilotStarsAmountAllowed(good,2,now),true);
 assert.equal(pilotStarsAmountAllowed(good,3,now),false);
 assert.equal(pilotStarsAmountAllowed(good,2,now+31*60*1000),false);
 for(const x of [
  {...good,STARS_VARIABLE_PILOT_MAX_STARS:'0'},
  {...good,STARS_VARIABLE_PILOT_MAX_STARS:'11'},
  {...good,STARS_VARIABLE_PILOT_EXPIRES_AT_MS:String(now+25*60*60*1000)},
  {...good,STARS_VARIABLE_PILOT_EXPIRES_AT_MS:String(now-1)},
  {...good,STARS_VARIABLE_PILOT_EXPIRES_AT_MS:'never'},
  {}
 ])assert.equal(pilotStarsAmountAllowed(x,1,now),false);
});
