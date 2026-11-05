import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {quoteGameCoinCents,freezePaidGameQuote} from './frozen-game-coin-quote.mjs';

const id='123e4567-e89b-42d3-a456-426614174000';
const user=123456789;
const now=1794000000000;
function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec('PRAGMA foreign_keys=ON;');
 sql.exec(readFileSync(new URL('../telegram-stars/variable-migration.sql',import.meta.url),'utf8'));
 sql.exec(readFileSync(new URL('./variable-stars-credit-quote.sql',import.meta.url),'utf8'));
 sql.prepare("INSERT INTO rustup_stars_variable_orders "+
 "(id,telegram_user_id,client_request_id,requested_amount_minor,price_stars,"+
 "rate_num,rate_den,status,created_at_ms,expires_at_ms) VALUES(?,?,?,?,?,?,?,'pending',?,?)")
 .run(id,user,'client-uuid-123',100000,535,187159,1000,now-5000,now+100000);
 const db={prepare(query){
  return {bind(...values){
   const statement=sql.prepare(query);
   return {
    async first(){return statement.get(...values)||null;},
    async run(){return {meta:{changes:statement.run(...values).changes}};}
   };
  }};
 }};
 return {sql,db};
}
test('integer RUB/USD conversion matches existing 0.02 USD per coin',()=>{
 assert.equal(quoteGameCoinCents(100000,9500),52631);
 assert.equal(quoteGameCoinCents(190,9500),100);
 for(const bad of [0,-1,1,0.1,100000001])assert.throws(()=>quoteGameCoinCents(bad,9500));
 for(const rate of [0,-1,1,NaN,Infinity,1000001])
  assert.throws(()=>quoteGameCoinCents(100000,rate));
});
test('stores one immutable coin conversion quote against matching pending order',async()=>{
 const {sql,db}=fixture();
 try{
  const args={orderId:id,verifiedTelegramUserId:user,
   amountMinor:100000,rubPerUsdMinor:9500,now};
  const first=await freezePaidGameQuote(db,args);
  assert.equal(first.coinCents,52631);
  assert.equal(first.replayed,false);
  const again=await freezePaidGameQuote(db,args);
  assert.equal(again.replayed,true);
  assert.equal(again.quotedAtMs,now);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM rustup_stars_variable_credit_quotes').get().n,1);
  await assert.rejects(()=>freezePaidGameQuote(db,{...args,rubPerUsdMinor:9600}),
   /frozen_quote_conflict/);
 }finally{sql.close();}
});
test('cannot quote another account, different amount, expired or paid order',async()=>{
 const {sql,db}=fixture();
 try{
  const params={orderId:id,verifiedTelegramUserId:user,
   amountMinor:100000,rubPerUsdMinor:9500,now};
  for(const candidate of [
   {...params,verifiedTelegramUserId:user+1},
   {...params,amountMinor:99999},
   {...params,now:now+100001},
   {...params,orderId:'123e4567-e89b-42d3-a456-426614174001'}
  ])await assert.rejects(()=>freezePaidGameQuote(db,candidate),/unavailable_for_quote/);
  sql.prepare("UPDATE rustup_stars_variable_orders SET status='checkout_approved' WHERE id=?").run(id);
  await assert.rejects(()=>freezePaidGameQuote(db,params),/unavailable_for_quote/);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM rustup_stars_variable_credit_quotes').get().n,0);
 }finally{sql.close();}
});
