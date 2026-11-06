import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {wrapHistoryOnlyWorker} from './stars-history-only-wrapper.mjs';

const host='https://rustup-bot.ttzoomrust.workers.dev';
const origin='https://ttzoomrust-hub.github.io';
const BOT='123456789:abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN';
const ID=123456;
function initData(user=ID){
 const params=new URLSearchParams({
  auth_date:String(Math.floor(Date.now()/1000)-10),
  user:JSON.stringify({id:user,first_name:'Offline'})
 });
 const data=[...params].sort(([a],[b])=>a.localeCompare(b))
  .map(([k,v])=>k+'='+v).join('\n');
 const key=createHmac('sha256','WebAppData').update(BOT).digest();
 params.set('hash',createHmac('sha256',key).update(data).digest('hex'));
 return params.toString();
}
function req(route='/api/stars/variable/history',options={}){
 const method=options.method||'POST';
 return new Request(host+route,{
  method,headers:{
   origin:options.origin||origin,
   'content-type':options.contentType||'application/json'
  },
  ...(method==='OPTIONS'||method==='GET'?{}:{
   body:typeof options.body==='string'?options.body:
    JSON.stringify({initData:options.initData??initData()})
  })
 });
}
function db(){
 const pay=new DatabaseSync(':memory:');
 pay.exec('CREATE TABLE rustup_stars_variable_orders ('+
  'id TEXT PRIMARY KEY,telegram_user_id INTEGER,requested_amount_minor INTEGER,'+
  'price_stars INTEGER,status TEXT,created_at_ms INTEGER,'+
  'paid_at_ms INTEGER,telegram_charge_id TEXT);');
 const game=new DatabaseSync(':memory:');
 game.exec('CREATE TABLE rustup_game_paid_receipts ('+
  'source TEXT,order_id TEXT,receipt_id TEXT,telegram_user_id INTEGER,'+
  'amount_minor INTEGER,coin_cents INTEGER);'+
  'CREATE TABLE rustup_game_paid_refunds ('+
  'source TEXT,order_id TEXT,receipt_id TEXT,telegram_user_id INTEGER,'+
  'coin_cents INTEGER);');
 const api=database=>({prepare(sql){
  const statement=database.prepare(sql);
  return {bind(...params){return {async all(){return {results:statement.all(...params)};}};}};
 }});
 return {pay,game,env:{
  APP_URL:origin+'/rust-up/',BOT_TOKEN:BOT,
  DB:api(game),PAYMENTS_DB:api(pay),
  PAYMENT_PRODUCTION_ENABLED:'false',
  STARS_PAYMENT_ENABLED:'false'
 },close(){pay.close();game.close();}};
}
function original(){
 const calls=[];
 const worker={
  fetch(request){calls.push({method:request.method,path:new URL(request.url).pathname});
   return new Response('original-handler');},
  scheduled(){calls.push({scheduled:true});},
  custom:'original-metadata'
 };
 return {worker,calls};
}
test('empty owner-only D1 history is authenticated and does not change either DB',async()=>{
 const f=db(),o=original();
 try {
  const wrapped=wrapHistoryOnlyWorker(o.worker);
  const result=await wrapped.fetch(req(),f.env,{});
  assert.equal(result.status,200);
  assert.equal(result.headers.get('cache-control'),'no-store');
  assert.equal(result.headers.get('access-control-allow-origin'),origin);
  assert.deepEqual(await result.json(),{ok:true,orders:[],statusComplete:true});
  assert.equal(f.pay.prepare('SELECT COUNT(*) AS n FROM rustup_stars_variable_orders').get().n,0);
  assert.deepEqual(o.calls,[]);
  assert.equal(wrapped.scheduled,o.worker.scheduled);
  assert.equal(wrapped.custom,'original-metadata');
 }finally{f.close();}
});
test('forged user data, wrong origin and absent DBs are denied',async()=>{
 const f=db();
 try {
  const wrapped=wrapHistoryOnlyWorker(original().worker);
  const a=await wrapped.fetch(req(undefined,{initData:'forged'}),f.env,{});
  assert.equal(a.status,401);
  const b=await wrapped.fetch(req(undefined,{origin:'https://evil.example'}),f.env,{});
  assert.equal(b.status,403);
  const c=await wrapped.fetch(req(),{...f.env,PAYMENTS_DB:null},{});
  assert.equal(c.status,503);
  assert.equal((await c.json()).error,'deposit_history_unavailable');
 }finally{f.close();}
});
test('nonexistent quote/checkout cannot reach original game or payment logic',async()=>{
 const f=db(),o=original();
 try{
  const wrapped=wrapHistoryOnlyWorker(o.worker);
  for(const p of ['/api/stars/variable/checkout','/api/stars/variable/quote',
   '/api/stars/variable/other']){
   const result=await wrapped.fetch(req(p),{
    ...f.env,STARS_PAYMENT_ENABLED:'true',
    PAYMENT_PRODUCTION_ENABLED:'true'
   },{});
   assert.equal(result.status,404);
  }
  assert.deepEqual(o.calls,[]);
 }finally{f.close();}
});
test('original HTTP, webhook, scheduled handler and metadata unchanged',async()=>{
 const o=original();
 const wrapped=wrapHistoryOnlyWorker(o.worker);
 for(const p of ['/tg','/api/ping','/api/admin/status',
  '/api/stars/catalog']){
  const response=await wrapped.fetch(req(p),{},{});
  assert.equal(await response.text(),'original-handler');
 }
 wrapped.scheduled();
 assert.equal(o.calls.length,5);
 assert.equal(o.calls[4].scheduled,true);
});
test('valid origin preflight works but GET, oversize and invalid JSON fail closed',async()=>{
 const f=db();
 try{
  const wrapped=wrapHistoryOnlyWorker(original().worker);
  const opt=await wrapped.fetch(req(undefined,{method:'OPTIONS'}),f.env,{});
  assert.equal(opt.status,204);
  assert.equal(opt.headers.get('access-control-allow-origin'),origin);
  assert.equal((await wrapped.fetch(req(undefined,{method:'GET'}),f.env,{})).status,405);
  assert.equal((await wrapped.fetch(req(undefined,{body:'x'.repeat(5000)}),f.env,{})).status,413);
  assert.equal((await wrapped.fetch(req(undefined,{body:'{oops'}),f.env,{})).status,400);
 }finally{f.close();}
});
test('D1 read error becomes generic 503 with no player or SQL disclosure',async()=>{
 const f=db();
 try {
  const bad={...f.env,PAYMENTS_DB:{prepare(){throw Error('private sql and user 123456');}}};
  const response=await wrapHistoryOnlyWorker(original().worker).fetch(req(),bad,{});
  assert.equal(response.status,503);
  const body=await response.text();
  assert.doesNotMatch(body,/private sql|123456/);
  assert.equal(body.includes('deposit_history_unavailable'),true);
 }finally{f.close();}
});
