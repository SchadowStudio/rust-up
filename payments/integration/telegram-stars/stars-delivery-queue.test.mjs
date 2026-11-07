// All fake Stars receipts and in-memory SQLite; no real payment or Worker deploy.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {
 runVariableStarsDeliveryQueue,settlementWorkerAllowed,settlementRetryAt
} from './stars-delivery-queue.mjs';

const ID='123e4567-e89b-42d3-a456-426614174000';
const USER=123456789, CHARGE='fake-telegram-stars-transaction-0001';
const TODAY=1793999000000, PAID=TODAY+60000;
const INVOICE_PRICE=55,AMOUNT_MINOR=10000,CREDIT_CENTS=150;
const BOT='123456789:'+('a'.repeat(35));
function api(database){
 return {prepare(sql){
  const statement=database.prepare(sql);
  const forArgs=args=>({
   async first(){return statement.get(...args)||null;},
   async all(){return {results:statement.all(...args)};},
   async run(){return {meta:{changes:statement.run(...args).changes}};}
  });
  return {...forArgs([]),bind(...args){return forArgs(args);}};
 }};
}
function makeFixture({paid=true,release=true,settlement=true}={}){
 const pay=new DatabaseSync(':memory:'),game=new DatabaseSync(':memory:');
 pay.exec(readFileSync(new URL('./variable-migration.sql',import.meta.url),'utf8'));
 pay.exec(readFileSync(new URL('../account-credit-ledger/variable-stars-credit-quote.sql',import.meta.url),'utf8'));
 pay.exec(readFileSync(new URL('./variable-stars-delivery-queue.sql',import.meta.url),'utf8'));
 game.exec('CREATE TABLE accounts(id INTEGER PRIMARY KEY,state TEXT NOT NULL,'+
  'v INTEGER NOT NULL,updated INTEGER NOT NULL);'+
  'CREATE TABLE users(id INTEGER PRIMARY KEY,balance REAL,'+
  'blocked INTEGER NOT NULL DEFAULT 0,banned INTEGER NOT NULL DEFAULT 0);');
 game.exec(readFileSync(new URL('../account-credit-ledger/atomic-game-credit.sql',
  import.meta.url),'utf8'));
 game.prepare('INSERT INTO accounts(id,state,v,updated) VALUES(?,?,?,?)')
  .run(USER,JSON.stringify({balance:10,inventory:['test']},null,0),1,TODAY);
 game.prepare('INSERT INTO users(id,balance) VALUES(?,?)').run(USER,10);
 if(release)game.prepare('UPDATE rustup_game_paid_release_control '+
  'SET enabled=1,approval_reference=?,reviewed_at_ms=? WHERE id=1')
  .run('OFFLINE-QUEUE-ONLY',TODAY);
 pay.prepare('INSERT INTO rustup_stars_variable_orders ('+
  'id,telegram_user_id,client_request_id,requested_amount_minor,price_stars,'+
  'rate_num,rate_den,status,checkout_query_id,invoice_url,created_at_ms,expires_at_ms) '+
  'VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
  .run(ID,USER,'fake-request',AMOUNT_MINOR,INVOICE_PRICE,
   183000,1000,'checkout_approved','fake-query','https://t.me/$offline',
   TODAY,TODAY+900000);
 pay.prepare('INSERT INTO rustup_stars_variable_credit_quotes '+
  '(order_id,telegram_user_id,amount_minor,coin_cents,rub_per_usd_minor,quoted_at_ms) '+
  'VALUES(?,?,?,?,?,?)')
  .run(ID,USER,AMOUNT_MINOR,CREDIT_CENTS,9500,TODAY+1000);
 if(paid)pay.prepare(
  "UPDATE rustup_stars_variable_orders SET status='paid',"+
  'telegram_charge_id=?,paid_at_ms=? WHERE id=?'
 ).run(CHARGE,PAID,ID);
 const env={DB:api(game),PAYMENTS_DB:api(pay),BOT_TOKEN:BOT,
  STARS_GAME_CREDIT_SETTLEMENT_ENABLED:settlement?'true':'false',
  PAYMENT_PRODUCTION_ENABLED:'true',
  PAYMENT_WALLET_STRICT_MODE:'true',
  STARS_VARIABLE_CREDIT_LEDGER_READY:'true'};
 const money=()=>{
  const account=game.prepare('SELECT state,v FROM accounts WHERE id=?').get(USER);
  const balance=game.prepare('SELECT balance FROM users WHERE id=?').get(USER);
  return {canonical:JSON.parse(account.state).balance,
   mirror:balance.balance,v:account.v};
 };
 const jobs=()=>pay.prepare('SELECT * FROM rustup_stars_variable_delivery_jobs').all();
 const totals=()=>({
  credits:game.prepare('SELECT count(*) AS n FROM rustup_game_paid_receipts').get().n,
  refunds:game.prepare('SELECT count(*) AS n FROM rustup_game_paid_refunds').get().n
 });
 const telegram=async(url,opts)=>{
  assert.ok(url.endsWith('/getStarTransactions'));
  const request=JSON.parse(opts.body);
  assert.equal(request.limit,100);
  return {ok:true,json:async()=>({ok:true,result:{
   transactions:request.offset===0?[{
    id:CHARGE,amount:INVOICE_PRICE,
    source:{type:'user',transaction_type:'invoice_payment',
     user:{id:USER},invoice_payload:'v:'+ID}
   }]:[]
  }})};
 };
 return {env,pay,game,jobs,money,totals,telegram,
  close(){pay.close();game.close();}};
}
const run=(f,opts={})=>runVariableStarsDeliveryQueue(f.env,{
 now:PAID+1000,fetchImpl:f.telegram,
 newLeaseToken:()=>randomUUID(),...opts
});

test('PAID update enqueues once, then one verified fake Telegram transaction credits the original account once',async()=>{
 const f=makeFixture();
 try{
  assert.equal(f.jobs().length,1);
  assert.equal(f.jobs()[0].state,'pending');
  assert.deepEqual(f.money(),{canonical:10,mirror:10,v:1});
  const first=await run(f);
  assert.equal(first.claimed,1);
  assert.equal(first.delivered,1);
  assert.equal(f.jobs()[0].state,'delivered');
  assert.deepEqual(f.money(),{canonical:11.5,mirror:11.5,v:2});
  assert.deepEqual(f.totals(),{credits:1,refunds:0});
  const again=await run(f);
  assert.equal(again.claimed,0);
  assert.deepEqual(f.totals(),{credits:1,refunds:0});
 }finally{f.close();}
});
test('all payment production gates or game ledger approval must be explicitly enabled',async()=>{
 for(const kind of ['env-off','game-gate-off']){
  const f=makeFixture({settlement:kind!=='env-off',
   release:kind!=='game-gate-off'});
  try{
   assert.equal(settlementWorkerAllowed(f.env),kind==='game-gate-off');
   const out=await run(f);
   assert.equal(out.enabled,false);
   assert.equal(f.jobs()[0].state,'pending');
   assert.deepEqual(f.money(),{canonical:10,mirror:10,v:1});
   assert.equal(f.totals().credits,0);
  }finally{f.close();}
 }
});
test('precheckout alone never enqueues; a refund before settlement cancels pending credit',async()=>{
 const f=makeFixture({paid:false});
 try{
  assert.equal(f.jobs().length,0);
  f.pay.prepare(
   "UPDATE rustup_stars_variable_orders SET status='paid',"+
   'telegram_charge_id=?,paid_at_ms=? WHERE id=?'
  ).run(CHARGE,PAID,ID);
  assert.equal(f.jobs().length,1);
  f.pay.prepare("UPDATE rustup_stars_variable_orders SET status='refunded' WHERE id=?")
   .run(ID);
  assert.equal(f.jobs()[0].state,'refunded');
  const out=await run(f);
  assert.equal(out.selected,0);
  assert.equal(f.totals().credits,0);
 }finally{f.close();}
});
test('Telegram outage causes bounded backoff and no balance change until later verified retry',async()=>{
 const f=makeFixture();
 try{
  let first=await run(f,{fetchImpl:async()=>{throw Error('simulated-offline');}});
  assert.equal(first.retries,1);
  assert.equal(f.jobs()[0].state,'retry');
  assert.deepEqual(f.money(),{canonical:10,mirror:10,v:1});
  const tooEarly=await run(f,{now:PAID+1001});
  assert.equal(tooEarly.selected,0);
  const later=await run(f,{now:PAID+60000});
  assert.equal(later.delivered,1);
  assert.equal(f.jobs()[0].state,'delivered');
  assert.equal(f.totals().credits,1);
 }finally{f.close();}
});
test('concurrent cron invocations cannot claim one delivery twice',async()=>{
 const f=makeFixture();
 try{
  const [a,b]=await Promise.all([run(f),run(f)]);
  assert.equal(a.delivered+b.delivered,1);
  assert.equal(f.totals().credits,1);
  assert.deepEqual(f.money(),{canonical:11.5,mirror:11.5,v:2});
 }finally{f.close();}
});
test('crash after game credit but before delivery ACK replays safely without second game credit',async()=>{
 const f=makeFixture();
 try{
  const originalDb=f.env.PAYMENTS_DB;
  let interrupted=true;
  f.env.PAYMENTS_DB={prepare(sql){
   if(interrupted&&sql.includes("SET state='delivered'"))
    return {bind(){return {async run(){
     interrupted=false;
     throw Error('simulated_worker_crash_after_credit_before_ack');
    }}}};
   return originalDb.prepare(sql);
  }};
  await assert.rejects(()=>run(f),/simulated_worker_crash_after_credit_before_ack/);
  assert.equal(f.totals().credits,1);
  assert.equal(f.jobs()[0].state,'leased');
  assert.deepEqual(f.money(),{canonical:11.5,mirror:11.5,v:2});
  f.env.PAYMENTS_DB=originalDb;
  const replay=await run(f,{now:PAID+180000});
  assert.equal(replay.delivered,1);
  assert.equal(f.jobs()[0].state,'delivered');
  assert.equal(f.totals().credits,1);
  assert.deepEqual(f.money(),{canonical:11.5,mirror:11.5,v:2});
 }finally{f.close();}
});
test('bounded retry schedule and invalid args never approve delivery',()=>{
 assert.equal(settlementRetryAt(1,PAID),PAID+30000);
 assert.equal(settlementRetryAt(2,PAID),PAID+60000);
 assert.throws(()=>settlementRetryAt(0,PAID),/retry_invalid/);
});
