// Offline-only wrapper tests. No Telegram API, no real D1 and no live charges.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {wrapExistingWorker} from './stars-existing-worker-wrapper.mjs';

const api='https://rustup-bot.ttzoomrust.workers.dev';
const origin='https://ttzoomrust-hub.github.io';
const token='123456789:abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN';
function signedAuth(){
 const p=new URLSearchParams({
  auth_date:String(Math.floor(Date.now()/1000)-10),
  user:JSON.stringify({id:123456,first_name:'Fixture'})
 });
 const str=[...p].sort(([a],[b])=>a.localeCompare(b))
  .map(([k,v])=>k+'='+v).join('\n');
 const key=createHmac('sha256','WebAppData').update(token).digest();
 p.set('hash',createHmac('sha256',key).update(str).digest('hex'));
 return p.toString();
}
function request(route,{method='POST',valid=true,from=origin}={}){
 return new Request(api+route,{
  method,headers:{origin:from,'content-type':'application/json'},
  ...(method==='OPTIONS'?{}:{
   body:JSON.stringify({initData:valid?signedAuth():'forged'})
  })
 });
}
function gameWorker(){
 let calls=0;
 const base={async fetch(){calls++;return new Response('game_alive');}};
 return {base,get calls(){return calls;}};
}
function safeEnv(){
 return {
  BOT_TOKEN:token,APP_URL:origin+'/rust-up/',
  STARS_PAYMENT_ENABLED:'false',STARS_VARIABLE_TOPUP_ENABLED:'false',
  STARS_VARIABLE_CREDIT_LEDGER_READY:'false',
  PAYMENT_PRODUCTION_ENABLED:'false',
  PAYMENT_WALLET_STRICT_MODE:'false',
  PAYMENTS_DB:{prepare(sql){
   assert.match(sql,/rustup_stars_variable_orders/);
   return {bind(id){
    assert.equal(id,123456);
    return {async all(){return {results:[]};}};
   }};
  }},
  DB:{prepare(){throw Error('empty payment history cannot access game');}}
 };
}

test('original Worker wrapper authenticates and reads only the existing player history',async()=>{
 const game=gameWorker();
 const worker=wrapExistingWorker(game.base);
 const response=await worker.fetch(request('/api/stars/variable/history'),safeEnv(),{});
 assert.equal(response.status,200);
 assert.equal(response.headers.get('access-control-allow-origin'),origin);
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.deepEqual(await response.json(),{
  ok:true,orders:[],statusComplete:true
 });
 assert.equal(game.calls,0);
});

test('forged Telegram identity and malicious web origin cannot read another player history',async()=>{
 const worker=wrapExistingWorker(gameWorker().base);
 const invalid=await worker.fetch(request('/api/stars/variable/history',{valid:false}),safeEnv(),{});
 assert.equal(invalid.status,401);
 const foreign=await worker.fetch(request('/api/stars/variable/history',{from:'https://malicious.example'}),safeEnv(),{});
 assert.equal(foreign.status,403);
});

test('even if financial switches are ON, variable quote/checkout remain unreachable through this wrapper',async()=>{
 const game=gameWorker();
 const worker=wrapExistingWorker(game.base,{
  handleStarsApi(){throw Error('unexpected legacy checkout route');},
  handleVariableStarsHistory(){throw Error('unexpected payment action');}
 });
 const on={...safeEnv(),
  PAYMENT_PRODUCTION_ENABLED:'true',
  STARS_PAYMENT_ENABLED:'true',
  STARS_VARIABLE_TOPUP_ENABLED:'true',
  STARS_VARIABLE_CREDIT_LEDGER_READY:'true',
  PAYMENT_WALLET_STRICT_MODE:'true'
 };
 for(const endpoint of ['/api/stars/variable/checkout',
  '/api/stars/variable/quote','/api/stars/variable/unknown']){
  const response=await worker.fetch(request(endpoint),on,{});
  assert.equal(response.status,404);
 }
 assert.equal(game.calls,0);
});

test('original fixed Stars API and unrelated game requests retain their dispatch',async()=>{
 const game=gameWorker();
 const worker=wrapExistingWorker(game.base,{
  handleStarsApi:async()=>new Response('existing_fixed_stars',{status:202})
 });
 const old=await worker.fetch(request('/api/stars/catalog'),safeEnv(),{});
 assert.equal(old.status,202);
 assert.equal(await old.text(),'existing_fixed_stars');
 const gameRequest=await worker.fetch(request('/api/ping'),safeEnv(),{});
 assert.equal(await gameRequest.text(),'game_alive');
 assert.equal(game.calls,1);
});

test('history CORS preflight remains read-only without Telegram authentication',async()=>{
 const worker=wrapExistingWorker(gameWorker().base);
 const res=await worker.fetch(request('/api/stars/variable/history',{method:'OPTIONS'}),safeEnv(),{});
 assert.equal(res.status,204);
 assert.equal(res.headers.get('access-control-allow-origin'),origin);
 assert.equal(res.headers.get('access-control-allow-methods'),'POST, OPTIONS');
});
