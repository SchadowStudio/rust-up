import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {
 verifyStarsRefundHistory,reconcileVerifiedStarsGameRefund
} from './verified-stars-game-refund.mjs';
const id='123e4567-e89b-42d3-a456-426614174000';
const user=123456789;
const token='123456789:'+('a'.repeat(30));
const tx={id:'tg-charge-12345678',amount:-535,
 receiver:{type:'user',user:{id:user}}};
function bot(items=[tx]){
 return async (url,opts)=>({
  ok:true,async json(){
   assert.match(url,/getStarTransactions$/);
   const data=JSON.parse(opts.body);
   assert.equal(data.limit,100);
   return {ok:true,result:{transactions:items.slice(data.offset,data.offset+100)}};
  }
 });
}
test('independent refund evidence must match negative Stars charge and Telegram user',async()=>{
 const data={receipt_id:tx.id,telegram_user_id:user};
 assert.equal(await verifyStarsRefundHistory({BOT_TOKEN:token},data,535,bot()),true);
 for(const bad of [
  {...tx,amount:-534},
  {...tx,receiver:{type:'user',user:{id:user+1}}},
  {...tx,source:{type:'user',user:{id:user}}},
  {...tx,amount:535}
 ]){
  await assert.rejects(
   ()=>verifyStarsRefundHistory({BOT_TOKEN:token},data,535,bot([bad])),
   /mismatch|not_confirmed/
  );
 }
});
function wrapper(sqlite){
 return {prepare(query){
  return {bind(...args){
   const stmt=sqlite.prepare(query);
   return {
    async first(){return stmt.get(...args)||null;},
    async run(){return {meta:{changes:stmt.run(...args).changes}};}
   };
  }};
 }};
}
function fixture(){
 const game=new DatabaseSync(':memory:'),pay=new DatabaseSync(':memory:');
 game.exec('PRAGMA foreign_keys=ON;CREATE TABLE accounts(id INTEGER PRIMARY KEY,state TEXT NOT NULL,v INTEGER NOT NULL,updated INTEGER NOT NULL);'+
  'CREATE TABLE users(id INTEGER PRIMARY KEY,balance REAL,blocked INTEGER NOT NULL DEFAULT 0,banned INTEGER NOT NULL DEFAULT 0);');
 game.exec(readFileSync(new URL('./atomic-game-credit.sql',import.meta.url),'utf8'));
 game.prepare('INSERT INTO accounts VALUES(?,?,0,?)').run(user,'{"balance":10,"inventory":[]}',1);
 game.prepare('INSERT INTO users(id,balance) VALUES(?,?)').run(user,10);
 game.prepare('INSERT INTO rustup_game_paid_receipts '+
 '(source,order_id,receipt_id,telegram_user_id,amount_minor,coin_cents,created_at_ms) '+
 'VALUES (?,?,?,?,?,?,?)')
 .run('stars_variable',id,tx.id,user,100000,150,1794000000000);
 pay.exec('PRAGMA foreign_keys=ON;');
 pay.exec(readFileSync(new URL('../telegram-stars/variable-migration.sql',import.meta.url),'utf8'));
 pay.exec(readFileSync(new URL('./variable-stars-credit-quote.sql',import.meta.url),'utf8'));
 pay.prepare('INSERT INTO rustup_stars_variable_orders '+
 '(id,telegram_user_id,client_request_id,requested_amount_minor,price_stars,'+
 'rate_num,rate_den,status,telegram_charge_id,created_at_ms,expires_at_ms,paid_at_ms) '+
 "VALUES(?,?,?,?,?,?,?,'refunded',?,?,?,?)")
 .run(id,user,'client-refund-123',100000,535,187159,1000,tx.id,
  1793999000000,1794001000000,1794000000000);
 pay.prepare('INSERT INTO rustup_stars_variable_credit_quotes '+
 '(order_id,telegram_user_id,amount_minor,coin_cents,rub_per_usd_minor,quoted_at_ms) '+
 'VALUES (?,?,?,?,?,?)').run(id,user,100000,150,8000,1793999999000);
 return {game,pay,env:{
  BOT_TOKEN:token,STARS_GAME_CREDIT_REFUND_RECONCILIATION_ENABLED:'true',
  PAYMENT_WALLET_STRICT_MODE:'true',DB:wrapper(game),PAYMENTS_DB:wrapper(pay)
 }};
}
test('verified Telegram refund reverses paid balance atomically and only once',async()=>{
 const f=fixture();
 try{
  assert.equal(JSON.parse(f.game.prepare('SELECT state FROM accounts').get().state).balance,11.5);
  const first=await reconcileVerifiedStarsGameRefund(f.env,id,bot());
  assert.equal(first.gameCreditReversed,true);
  assert.equal(first.replayed,false);
  assert.equal(JSON.parse(f.game.prepare('SELECT state FROM accounts').get().state).balance,10);
  assert.equal(f.game.prepare('SELECT balance FROM users').get().balance,10);
  const second=await reconcileVerifiedStarsGameRefund(f.env,id,bot());
  assert.equal(second.replayed,true);
  assert.equal(f.game.prepare('SELECT COUNT(*) n FROM rustup_game_paid_refunds').get().n,1);
 }finally{f.game.close();f.pay.close();}
});
test('spent original credit forces refund reconciliation into manual review',async()=>{
 const f=fixture();
 try{
  f.game.prepare('UPDATE accounts SET state=?').run('{"balance":0.25}');
  f.game.prepare('UPDATE users SET balance=?').run(0.25);
  await assert.rejects(
   ()=>reconcileVerifiedStarsGameRefund(f.env,id,bot()),
   /manual_review/
  );
  assert.equal(f.game.prepare('SELECT COUNT(*) n FROM rustup_game_paid_refunds').get().n,0);
  assert.equal(JSON.parse(f.game.prepare('SELECT state FROM accounts').get().state).balance,0.25);
 }finally{f.game.close();f.pay.close();}
});
test('refund reconciliation remains hard-disabled without explicit finance configuration',async()=>{
 await assert.rejects(
  ()=>reconcileVerifiedStarsGameRefund({
   STARS_GAME_CREDIT_REFUND_RECONCILIATION_ENABLED:'false'
  },id,bot()),
  /reconciliation_disabled/
 );
});
