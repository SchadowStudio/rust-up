// Test only: no Telegram network access, no real Cloudflare D1, no payments.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {determineStarsDepositState,readStarsDepositHistory}
 from './deposit-history-readonly.mjs';

const USER=123456789;
const OTHER=123456790;
const IDS=[
 '123e4567-e89b-42d3-a456-426614174000',
 '123e4567-e89b-42d3-a456-426614174001',
 '123e4567-e89b-42d3-a456-426614174002',
 '123e4567-e89b-42d3-a456-426614174003',
 '123e4567-e89b-42d3-a456-426614174004',
 '123e4567-e89b-42d3-a456-426614174005',
 '123e4567-e89b-42d3-a456-426614174006',
 '123e4567-e89b-42d3-a456-426614174007'
];
function setup(){
 const pay=new DatabaseSync(':memory:');
 const game=new DatabaseSync(':memory:');
 pay.exec('CREATE TABLE rustup_stars_variable_orders('+
  'id TEXT PRIMARY KEY,telegram_user_id INTEGER,requested_amount_minor INTEGER,'+
  'price_stars INTEGER,status TEXT,created_at_ms INTEGER,paid_at_ms INTEGER,'+
  'telegram_charge_id TEXT)');
 game.exec('CREATE TABLE rustup_game_paid_receipts('+
  'source TEXT,order_id TEXT,receipt_id TEXT,telegram_user_id INTEGER,'+
  'amount_minor INTEGER,coin_cents INTEGER)');
 game.exec('CREATE TABLE rustup_game_paid_refunds('+
  'source TEXT,order_id TEXT,receipt_id TEXT,telegram_user_id INTEGER,'+
  'coin_cents INTEGER)');
 const wrapper=db=>({prepare(sql){
  const statement=db.prepare(sql);
  return {bind(...params){return{
   async all(){return {results:statement.all(...params)};}
  };}};
 }});
 const order=(n,status='paid',user=USER)=>{
  const value={id:IDS[n],telegram_user_id:user,requested_amount_minor:10000,
   price_stars:55,status,created_at_ms:1000+n,paid_at_ms:2000+n,
   telegram_charge_id:'tg-charge-2026-'+n};
  pay.prepare('INSERT INTO rustup_stars_variable_orders '+
   '(id,telegram_user_id,requested_amount_minor,price_stars,status,'+
   'created_at_ms,paid_at_ms,telegram_charge_id) '+
   'VALUES(?,?,?,?,?,?,?,?)').run(value.id,value.telegram_user_id,
   value.requested_amount_minor,value.price_stars,value.status,
   value.created_at_ms,value.paid_at_ms,value.telegram_charge_id);
  return value;
 };
 const receipt=(o,{owner=o.telegram_user_id,amount=o.requested_amount_minor,
  charge=o.telegram_charge_id}={})=>{
  game.prepare('INSERT INTO rustup_game_paid_receipts VALUES(?,?,?,?,?,?)')
   .run('stars_variable',o.id,charge,owner,amount,500);
 };
 const reversal=(o,{owner=o.telegram_user_id,cents=500}={})=>{
  game.prepare('INSERT INTO rustup_game_paid_refunds VALUES(?,?,?,?,?)')
   .run('stars_variable',o.id,o.telegram_charge_id,owner,cents);
 };
 return {pay,game,env:{PAYMENTS_DB:wrapper(pay),DB:wrapper(game)},
  order,receipt,reversal,close(){pay.close();game.close();}};
}

test('actual SQL shows paid without game journal as uncredited and never invents coins',async()=>{
 const f=setup();
 try{
  const item=f.order(0);
  const response=await readStarsDepositHistory(f.env,USER);
  assert.equal(response.statusComplete,true);
  assert.equal(response.orders.length,1);
  assert.equal(response.orders[0].creditState,'payment_confirmed_credit_pending');
  assert.equal(response.orders[0].creditedToGame,false);
  assert.equal(Object.hasOwn(response.orders[0],'creditedCoinCents'),false);
  assert.equal(JSON.stringify(response).includes(item.telegram_charge_id),false);
 }finally{f.close();}
});

test('owner-bound receipt is credited exactly once in read-only status response',async()=>{
 const f=setup();
 try{
  const item=f.order(1);
  f.receipt(item);
  const response=await readStarsDepositHistory(f.env,USER);
  assert.equal(response.orders[0].creditState,'credited_to_game');
  assert.equal(response.orders[0].creditedToGame,true);
  assert.equal(response.orders[0].creditedCoinCents,500);
  assert.equal(response.orders[0].gameCreditReversed,false);
  assert.equal(JSON.stringify(response).includes(item.telegram_charge_id),false);
 }finally{f.close();}
});

test('refund without game credit, refund awaiting reversal and reversed credit remain distinct',async()=>{
 const f=setup();
 try{
  const none=f.order(0,'refunded');
  const awaiting=f.order(1,'refunded');
  const done=f.order(2,'refunded');
  f.receipt(awaiting);
  f.receipt(done);
  f.reversal(done);
  const response=await readStarsDepositHistory(f.env,USER);
  const map=new Map(response.orders.map(x=>[x.id,x]));
  assert.equal(map.get(none.id).creditState,'refunded_no_game_credit');
  assert.equal(map.get(awaiting.id).creditState,'refund_reversal_pending');
  assert.equal(map.get(done.id).creditState,'refund_reversed');
  assert.equal(map.get(done.id).gameCreditReversed,true);
  assert.equal(map.get(awaiting.id).gameCreditReversed,false);
  assert.ok(response.orders.every(x=>x.creditedToGame===false));
 }finally{f.close();}
});

test('wrong-owner receipt, mismatched amount and corrupt reversal fail closed to review',async()=>{
 for(const problem of ['wrong-owner','wrong-amount','refund-mismatch']){
  const f=setup();
  try{
   const item=f.order(0,problem==='refund-mismatch'?'refunded':'paid');
   if(problem==='wrong-owner')f.receipt(item,{owner:OTHER});
   if(problem==='wrong-amount')f.receipt(item,{amount:20000});
   if(problem==='refund-mismatch'){
    f.receipt(item);
    f.reversal(item,{cents:501});
   }
   const result=await readStarsDepositHistory(f.env,USER);
   assert.equal(result.orders[0].creditState,'manual_review');
   assert.equal(result.orders[0].creditedToGame,false);
   assert.equal(JSON.stringify(result).includes(String(OTHER)),false);
  }finally{f.close();}
 }
});

test('pending, approved and operator-review states never imply game-credit success',async()=>{
 const f=setup();
 try{
  f.order(0,'pending');
  f.order(1,'checkout_approved');
  f.order(2,'manual_review');
  const states=new Set((await readStarsDepositHistory(f.env,USER)).orders
   .map(o=>o.creditState));
  assert.deepEqual(states,new Set(['awaiting_payment',
   'awaiting_telegram_receipt','manual_review']));
 }finally{f.close();}
});

test('only authenticated customer orders are returned, not another Telegram account',async()=>{
 const f=setup();
 try{
  const mine=f.order(0,'paid',USER);
  const theirs=f.order(1,'paid',OTHER);
  f.receipt(theirs);
  const response=await readStarsDepositHistory(f.env,USER);
  assert.equal(response.orders.length,1);
  assert.equal(response.orders[0].id,mine.id);
  assert.equal(JSON.stringify(response).includes(theirs.id),false);
 }finally{f.close();}
});

test('missing game database, invalid identity, and missing query evidence fail closed',async()=>{
 const f=setup();
 try{
  f.order(0);
  await assert.rejects(()=>readStarsDepositHistory({PAYMENTS_DB:f.env.PAYMENTS_DB},
   USER),/binding_missing/);
  await assert.rejects(()=>readStarsDepositHistory(f.env,0),/binding_missing/);
  const missing={PAYMENTS_DB:{
   prepare(){return{bind(){return{async all(){return{};}};}};}
  },DB:f.env.DB};
  await assert.rejects(()=>readStarsDepositHistory(missing,USER),
   /incomplete_database_response/);
 }finally{f.close();}
});

test('paid order with a reversal but without refunded payment state is never credited',()=>{
 const order={id:IDS[0],telegram_user_id:USER,
  requested_amount_minor:10000,price_stars:55,status:'paid',
  created_at_ms:1000,paid_at_ms:2000,telegram_charge_id:'charge-12345678'};
 const credit={source:'stars_variable',order_id:order.id,
  receipt_id:order.telegram_charge_id,telegram_user_id:USER,
  amount_minor:10000,coin_cents:500};
 const reversal={source:'stars_variable',order_id:order.id,
  receipt_id:order.telegram_charge_id,telegram_user_id:USER,coin_cents:500};
 assert.equal(determineStarsDepositState(order,credit,reversal),'manual_review');
});
