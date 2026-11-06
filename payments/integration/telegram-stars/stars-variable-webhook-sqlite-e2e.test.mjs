// OFFLINE integration: actual variable Stars webhook -> isolated SQLite journal.
// Fake provider callbacks only; never connects to Telegram or Cloudflare.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {wrapExistingWorker} from './stars-existing-worker-wrapper.mjs';

const ORDER='123e4567-e89b-42d3-a456-426614174000';
const ID=123456789;
const CHARGE='fake-stars-charge-reference';
const AMOUNT=10000;
const PRICE=55;
const SECRET='test-webhook-secret-not-real';
const BOT='123456789:abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN';

function setup(status='checkout_approved'){
 const pay=new DatabaseSync(':memory:');
 pay.exec(readFileSync(new URL('./variable-migration.sql',import.meta.url),'utf8'));
 pay.exec(`CREATE TABLE rustup_stars_receipt_incidents (
  telegram_charge_id TEXT PRIMARY KEY,
  telegram_user_id INTEGER NOT NULL,
  invoice_payload TEXT NOT NULL,
  price_stars INTEGER NOT NULL,
  reason TEXT NOT NULL,
  occurred_at_ms INTEGER NOT NULL
 );`);
 const created=Date.now()-10000;
 pay.prepare('INSERT INTO rustup_stars_variable_orders ('+
  'id,telegram_user_id,client_request_id,requested_amount_minor,price_stars,'+
  'rate_num,rate_den,status,checkout_query_id,invoice_url,created_at_ms,expires_at_ms)'+
  ' VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
  .run(ORDER,ID,'offline-idempotency-key',AMOUNT,PRICE,
   183000,1000,status,status==='checkout_approved'?'fake-approved-query':null,
   'https://t.me/$local-test',created,created+900000);
 let gameCalled=0,gameDBCalled=0,fixedCalled=0,telegramCalled=0;
 const original={
  async fetch(){gameCalled++;return new Response('original');},
  async scheduled(){}
 };
 const worker=wrapExistingWorker(original,{
  receiveStars:async()=>{fixedCalled++;throw Error('variable_receipt_wrong_handler');}
 });
 const env={
  WEBHOOK_SECRET:SECRET,
  BOT_TOKEN:BOT,
  PAYMENT_PRODUCTION_ENABLED:'false',
  STARS_PAYMENT_ENABLED:'false',
  STARS_VARIABLE_TOPUP_ENABLED:'false',
  STARS_VARIABLE_CREDIT_LEDGER_READY:'false',
  PAYMENT_WALLET_STRICT_MODE:'false',
  PAYMENTS_DB:{
   prepare(sql){
    const statement=pay.prepare(sql);
    return {bind(...args){return {
     async first(){return statement.get(...args)??null;},
     async all(){return {results:statement.all(...args)};},
     async run(){return {meta:{changes:statement.run(...args).changes}};}
    }}};
   }
  },
  DB:{prepare(){gameDBCalled++;throw Error('forbidden_game_d1_write');}}
 };
 function tx(charge=CHARGE,overrides={}){
  return {update_id:2,message:{from:{id:ID},successful_payment:{
   currency:'XTR',total_amount:PRICE,invoice_payload:'v:'+ORDER,
   telegram_payment_charge_id:charge,...overrides
  }}};
 }
 function request(update,key=SECRET){
  return new Request('https://rustup-bot.ttzoomrust.workers.dev/tg',{
   method:'POST',headers:{
    'X-Telegram-Bot-Api-Secret-Token':key,
    'content-type':'application/json'
   },body:JSON.stringify(update)
  });
 }
 function rows(table){
  if(!['rustup_stars_variable_orders','rustup_stars_receipt_incidents'].includes(table))
   throw Error('invalid_fixture_table');
  return pay.prepare('SELECT * FROM '+table).all();
 }
 function close(){pay.close();}
 return {worker,env,tx,request,rows,close,
  get gameCalled(){return gameCalled;},
  get gameDBCalled(){return gameDBCalled;},
  get fixedCalled(){return fixedCalled;},
  get telegramCalled(){return telegramCalled;}
 };
}
test('authenticated synthetic successful_payment is journaled once and duplicate callback cannot change it',async()=>{
 const f=setup();
 try {
  let r=await f.worker.fetch(f.request(f.tx()),f.env,{});
  assert.equal(r.status,200);
  assert.equal(await r.text(),'ok');
  assert.equal(f.rows('rustup_stars_variable_orders')[0].status,'paid');
  assert.equal(f.rows('rustup_stars_variable_orders')[0].telegram_charge_id,CHARGE);
  r=await f.worker.fetch(f.request(f.tx()),f.env,{});
  assert.equal(r.status,200);
  assert.equal(f.rows('rustup_stars_variable_orders').length,1);
  assert.equal(f.rows('rustup_stars_receipt_incidents').length,0);
  assert.equal(f.gameDBCalled,0);
  assert.equal(f.fixedCalled,0);
  assert.equal(f.gameCalled,0);
 }finally{f.close();}
});
test('second synthetic charge against a paid invoice is quarantined without overwrite or game credit',async()=>{
 const f=setup();
 try{
  await f.worker.fetch(f.request(f.tx()),f.env,{});
  let r=await f.worker.fetch(f.request(f.tx('fake-second-charge')),f.env,{});
  assert.equal(r.status,200);
  const incidents=f.rows('rustup_stars_receipt_incidents');
  assert.equal(incidents.length,1);
  assert.equal(incidents[0].telegram_charge_id,'fake-second-charge');
  assert.equal(f.rows('rustup_stars_variable_orders')[0].telegram_charge_id,CHARGE);
  assert.equal(f.gameDBCalled,0);
  assert.equal(f.fixedCalled,0);
 }finally{f.close();}
});
test('mismatched synthetic receipt persists review evidence without marking order paid',async()=>{
 const f=setup();
 try {
  const response=await f.worker.fetch(f.request(f.tx(CHARGE,{
   total_amount:PRICE+10
  })),f.env,{});
  assert.equal(response.status,200);
  assert.equal(f.rows('rustup_stars_variable_orders')[0].status,'checkout_approved');
  assert.equal(f.rows('rustup_stars_receipt_incidents').length,1);
  assert.equal(f.gameDBCalled,0);
 }finally{f.close();}
});
test('when payment creation is OFF, synthetic precheckout is rejected using a fake Telegram transport',async()=>{
 const f=setup('pending');
 const calls=[];
 const stub=async(url,init)=>{
  assert.ok(url.endsWith('/answerPreCheckoutQuery'));
  calls.push(JSON.parse(init.body));
  return {ok:true,json:async()=>({ok:true,result:true})};
 };
 try{
  const worker=wrapExistingWorker({
   fetch:()=>new Response('original')
  },{
   receiveStars:async()=>{throw Error('must_not_run_fixed_handler');},
   // Use actual receipt route but inject a transport incapable of real charges.
   fetchImpl:stub
  });
  const update={pre_checkout_query:{
   id:'fake-q-id',from:{id:ID},currency:'XTR',
   total_amount:PRICE,invoice_payload:'v:'+ORDER
  }};
  const response=await worker.fetch(f.request(update),f.env,{});
  assert.equal(response.status,200);
  assert.equal(calls.length,1);
  assert.equal(calls[0].ok,false);
  assert.equal(f.rows('rustup_stars_variable_orders')[0].status,'pending');
  assert.equal(f.gameDBCalled,0);
 }finally{f.close();}
});
test('fake webhook secret cannot change the isolated orders database',async()=>{
 const f=setup();
 try{
  const r=await f.worker.fetch(f.request(f.tx(),'wrong-secret'),f.env,{});
  assert.equal(await r.text(),'original');
  assert.equal(f.rows('rustup_stars_variable_orders')[0].status,'checkout_approved');
  assert.equal(f.gameCalled,1);
  assert.equal(f.fixedCalled,0);
 }finally{f.close();}
});
