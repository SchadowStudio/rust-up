import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {freezeVerifiedStarsGameQuote,calculateRubCoinOneToOne} from './freeze-verified-stars-game-quote.mjs';

const ORDER='123e4567-e89b-42d3-a456-426614174000';
const USER=123456789;
const NOW=1794000000000;
const calc=async()=>({coinCents:150,rubPerUsdMinor:9500});
function wrap(sqlite){
 return {prepare(query){
  const statement=sqlite.prepare(query);
  return {bind(...args){return {
   async first(){return statement.get(...args)||null;},
   async run(){return {meta:{changes:statement.run(...args).changes}};}
  };},async first(){return statement.get()||null;}};
 }};
}
function setup(){
 const game=new DatabaseSync(':memory:');
 const pay=new DatabaseSync(':memory:');
 game.exec('CREATE TABLE accounts(id INTEGER PRIMARY KEY,state TEXT NOT NULL);'+
  'CREATE TABLE users(id INTEGER PRIMARY KEY,balance REAL,'+
  'blocked INTEGER DEFAULT 0,banned INTEGER DEFAULT 0);'+
  'CREATE TABLE rustup_game_paid_release_control('+
  'id INTEGER PRIMARY KEY,enabled INTEGER,approval_reference TEXT,reviewed_at_ms INTEGER);');
 game.prepare('INSERT INTO accounts VALUES(?,?)').run(USER,'{"balance":10}');
 game.prepare('INSERT INTO users(id,balance) VALUES(?,?)').run(USER,10);
 game.prepare('INSERT INTO rustup_game_paid_release_control VALUES(1,1,?,?)')
  .run('test-only-reviewed',NOW);
 pay.exec(readFileSync(new URL('../telegram-stars/variable-migration.sql',import.meta.url),'utf8'));
 pay.exec(readFileSync(new URL('./variable-stars-credit-quote.sql',import.meta.url),'utf8'));
 pay.exec(readFileSync(new URL('../telegram-stars/variable-stars-credit-quote-immutable.sql',import.meta.url),'utf8'));
 pay.prepare('INSERT INTO rustup_stars_variable_orders '+
  '(id,telegram_user_id,client_request_id,requested_amount_minor,'+
  'price_stars,rate_num,rate_den,status,created_at_ms,expires_at_ms) '+
  "VALUES(?,?,?,?,?,?,?,'pending',?,?)")
  .run(ORDER,USER,'fake-request',10000,55,183000,1000,NOW-1000,NOW+900000);
 const env={DB:wrap(game),PAYMENTS_DB:wrap(pay),
  PAYMENT_PRODUCTION_ENABLED:'true',STARS_VARIABLE_CREDIT_LEDGER_READY:'true',
  PAYMENT_WALLET_STRICT_MODE:'true'};
 return {env,game,pay,close(){game.close();pay.close();}};
}
const quote=()=>({orderId:ORDER,verifiedTelegramUserId:USER,
 amountMinor:10000,now:NOW});
test('trusted frozen quote is durable and replay cannot overwrite',async()=>{
 const f=setup();
 try{
  const first=await freezeVerifiedStarsGameQuote(f.env,quote(),calc);
  assert.deepEqual(first,{orderId:ORDER,amountMinor:10000,coinCents:150});
  assert.deepEqual(await freezeVerifiedStarsGameQuote(f.env,quote(),calc),first);
  assert.equal(f.pay.prepare('SELECT COUNT(*) n FROM rustup_stars_variable_credit_quotes').get().n,1);
  await assert.rejects(()=>freezeVerifiedStarsGameQuote(f.env,quote(),
   async()=>({coinCents:999,rubPerUsdMinor:9500})),/durable_conflict/);
  assert.equal(f.pay.prepare('SELECT coin_cents FROM rustup_stars_variable_credit_quotes').get().coin_cents,150);
 }finally{f.close();}
});
test('different Telegram player and changed amount never freeze quote',async()=>{
 const f=setup();
 try{
  await assert.rejects(()=>freezeVerifiedStarsGameQuote(f.env,{
   ...quote(),verifiedTelegramUserId:USER+1},calc),/order_conflict/);
  await assert.rejects(()=>freezeVerifiedStarsGameQuote(f.env,{
   ...quote(),amountMinor:20000},calc),/order_conflict/);
  assert.equal(f.pay.prepare('SELECT COUNT(*) n FROM rustup_stars_variable_credit_quotes').get().n,0);
 }finally{f.close();}
});
test('release controls, blocked player and inconsistent mirrored balances block invoice quote',async()=>{
 const f=setup();
 try{
  await assert.rejects(()=>freezeVerifiedStarsGameQuote({
   ...f.env,PAYMENT_PRODUCTION_ENABLED:'false'},quote(),calc),/release_disabled/);
  f.game.prepare('UPDATE rustup_game_paid_release_control SET enabled=0').run();
  await assert.rejects(()=>freezeVerifiedStarsGameQuote(f.env,quote(),calc),/game_release_disabled/);
  f.game.prepare('UPDATE rustup_game_paid_release_control SET enabled=1').run();
  f.game.prepare('UPDATE users SET blocked=1').run();
  await assert.rejects(()=>freezeVerifiedStarsGameQuote(f.env,quote(),calc),/player_unavailable/);
  f.game.prepare('UPDATE users SET blocked=0,balance=9').run();
  await assert.rejects(()=>freezeVerifiedStarsGameQuote(f.env,quote(),calc),/player_balance_unavailable/);
  assert.equal(f.pay.prepare('SELECT COUNT(*) n FROM rustup_stars_variable_credit_quotes').get().n,0);
 }finally{f.close();}
});
test('invalid pricing refuses to freeze and cannot create an invoice',async()=>{
 const f=setup();
 try{
  for(const bad of [
   {coinCents:0,rubPerUsdMinor:9500},
   {coinCents:150,rubPerUsdMinor:0},
   {coinCents:1.4,rubPerUsdMinor:9500}
  ]){
   await assert.rejects(()=>freezeVerifiedStarsGameQuote(f.env,quote(),
    async()=>bad),/pricing_unavailable/);
  }
  // An omitted calculator now intentionally uses the trusted 1 RUB = 1 Coin
  // default. Explicitly invalid injection must still fail closed.
  await assert.rejects(()=>freezeVerifiedStarsGameQuote(f.env,quote(),null),
   /unconfigured/);
  assert.equal(f.pay.prepare('SELECT COUNT(*) n FROM rustup_stars_variable_credit_quotes').get().n,0);
 }finally{f.close();}
});

test('frozen quotes reject direct SQL UPDATE and DELETE',async()=>{
 const f=setup();
 try{
  await freezeVerifiedStarsGameQuote(f.env,quote(),calc);
  assert.throws(()=>f.pay.prepare(
   'UPDATE rustup_stars_variable_credit_quotes SET coin_cents=999 WHERE order_id=?'
  ).run(ORDER),/rustup_stars_frozen_quote_immutable/);
  assert.throws(()=>f.pay.prepare(
   'DELETE FROM rustup_stars_variable_credit_quotes WHERE order_id=?'
  ).run(ORDER),/rustup_stars_frozen_quote_immutable/);
  assert.equal(f.pay.prepare(
   'SELECT coin_cents FROM rustup_stars_variable_credit_quotes'
  ).get().coin_cents,150);
 }finally{f.close();}
});

test('1 RUB is exactly 1 Coin with no USD-rate dependency',async()=>{
 assert.deepEqual(calculateRubCoinOneToOne({amountMinor:183}),
  {coinCents:183,rubPerUsdMinor:null});
 assert.deepEqual(calculateRubCoinOneToOne({amountMinor:10000}),
  {coinCents:10000,rubPerUsdMinor:null});
 assert.throws(()=>calculateRubCoinOneToOne({amountMinor:0}),/amount_invalid/);
 const f=setup();
 try{
  const quoteResult=await freezeVerifiedStarsGameQuote(f.env,quote());
  assert.deepEqual(quoteResult,{orderId:ORDER,amountMinor:10000,coinCents:10000});
  const stored=f.pay.prepare(
   'SELECT coin_cents,rub_per_usd_minor FROM rustup_stars_variable_credit_quotes'
  ).get();
  assert.equal(stored.coin_cents,10000);
  assert.equal(stored.rub_per_usd_minor,null);
 }finally{f.close();}
});

test('reject an invoice before any quote write when the game balance would exceed cap',async()=>{
 const f=setup();
 try{
  f.game.prepare('UPDATE accounts SET state=? WHERE id=?')
   .run(JSON.stringify({balance:99999999.5}),USER);
  f.game.prepare('UPDATE users SET balance=? WHERE id=?')
   .run(99999999.5,USER);
  await assert.rejects(()=>freezeVerifiedStarsGameQuote(f.env,quote()),
   /game_balance_cap_exceeded/);
  assert.equal(f.pay.prepare('SELECT count(*) n FROM rustup_stars_variable_credit_quotes').get().n,0);
  f.game.prepare('UPDATE accounts SET state=? WHERE id=?')
   .run(JSON.stringify({balance:99999900}),USER);
  f.game.prepare('UPDATE users SET balance=? WHERE id=?')
   .run(99999900,USER);
  const accepted=await freezeVerifiedStarsGameQuote(f.env,quote());
  assert.equal(accepted.coinCents,10000);
 }finally{f.close();}
});
