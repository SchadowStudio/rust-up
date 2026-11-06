// Offline Stars invoice contract: frozen server quote must exist BEFORE
// Telegram's createInvoiceLink is called. All tokens and balances are fake.
// No Cloudflare deploy, no user charge or real provider network request.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createVariableStarsCheckout} from '../telegram-stars/variable-stars.mjs';
import {freezeVerifiedStarsGameQuote} from './freeze-verified-stars-game-quote.mjs';

const USER=123456789,NOW=1794000000000;
const REQUEST='123e4567-e89b-42d3-a456-426614174001';
function d1(db){
 return {prepare(sql){
  const s=db.prepare(sql);
  const bound=args=>({
   async first(){return s.get(...args)??null;},
   async run(){return {meta:{changes:s.run(...args).changes}};},
   async all(){return {results:s.all(...args)};}
  });
  return {...bound([]),bind(...args){return bound(args);}};
 }};
}
function fixture(){
 const game=new DatabaseSync(':memory:'),pay=new DatabaseSync(':memory:');
 game.exec('CREATE TABLE accounts(id INTEGER PRIMARY KEY,state TEXT NOT NULL);'+
  'CREATE TABLE users(id INTEGER PRIMARY KEY,balance REAL,blocked INTEGER DEFAULT 0,'+
  'banned INTEGER DEFAULT 0);'+
  'CREATE TABLE rustup_game_paid_release_control(id INTEGER PRIMARY KEY,'+
  'enabled INTEGER,approval_reference TEXT,reviewed_at_ms INTEGER);');
 game.prepare('INSERT INTO accounts VALUES(?,?)').run(USER,'{"balance":10}');
 game.prepare('INSERT INTO users(id,balance) VALUES(?,?)').run(USER,10);
 game.prepare('INSERT INTO rustup_game_paid_release_control VALUES(1,1,?,?)')
  .run('OFFLINE-INVOICE-TEST',NOW);
 pay.exec(readFileSync(new URL('../telegram-stars/variable-migration.sql',import.meta.url),'utf8'));
 pay.exec(readFileSync(new URL('./variable-stars-credit-quote.sql',import.meta.url),'utf8'));
 pay.exec(readFileSync(new URL('../telegram-stars/variable-stars-credit-quote-immutable.sql',import.meta.url),'utf8'));
 const env={DB:d1(game),PAYMENTS_DB:d1(pay),
  PAYMENT_PRODUCTION_ENABLED:'true',STARS_VARIABLE_CREDIT_LEDGER_READY:'true',
  PAYMENT_WALLET_STRICT_MODE:'true',
  STARS_PAYMENT_ENABLED:'true',STARS_VARIABLE_TOPUP_ENABLED:'true',
  STARS_MIN_RUB_MINOR:'100',STARS_MAX_RUB_MINOR:'100000000',
  STARS_RUB_MINOR_PER_STAR_NUM:'183000',STARS_RUB_MINOR_PER_STAR_DEN:'1000',
  TG_STARS_BOT_TOKEN:'123456789:'+('a'.repeat(30))};
 return {env,game,pay,close(){game.close();pay.close();}};
}
const price=async()=>({coinCents:10000,rubPerUsdMinor:null});
function makeFreeze(env,calculator=price){
 return args=>freezeVerifiedStarsGameQuote(
  {...env,DB:env.DB,PAYMENTS_DB:env.PAYMENTS_DB},args,calculator
 );
}
test('simulated invoice is created only after immutable credit quote, with exactly 1.83 RUB per Star',async()=>{
 const f=fixture();
 try{
  let called=0;
  const fakeTelegram=async(url,opts)=>{
   called++;
   assert.match(url,/createInvoiceLink$/);
   const request=JSON.parse(opts.body);
   assert.equal(request.currency,'XTR');
   assert.equal(request.prices[0].amount,55);
   assert.match(request.payload,/^v:/);
   const row=f.pay.prepare('SELECT coin_cents,telegram_user_id FROM rustup_stars_variable_credit_quotes').get();
   assert.equal(row.coin_cents,10000);
   assert.equal(row.telegram_user_id,USER);
   return {ok:true,json:async()=>({ok:true,result:'https://t.me/$fake-offline-invoice'})};
  };
  const args={verifiedTelegramUserId:USER,amountMinor:10000,requestId:REQUEST,
   now:NOW,fetchImpl:fakeTelegram,freezeQuote:makeFreeze(f.env)};
  const invoice=await createVariableStarsCheckout({...f.env,DB:f.env.PAYMENTS_DB},args);
  assert.equal(invoice.priceStars,55);
  assert.equal(called,1);
  const again=await createVariableStarsCheckout({...f.env,DB:f.env.PAYMENTS_DB},args);
  assert.equal(again.orderId,invoice.orderId);
  assert.equal(called,1);
  assert.equal(f.pay.prepare('SELECT COUNT(*) n FROM rustup_stars_variable_credit_quotes').get().n,1);
 }finally{f.close();}
});
test('without trusted server price no fake invoice can be created',async()=>{
 const f=fixture();
 try{
  let sent=0;
  await assert.rejects(()=>createVariableStarsCheckout({...f.env,DB:f.env.PAYMENTS_DB},{
   verifiedTelegramUserId:USER,amountMinor:10000,requestId:REQUEST,
   now:NOW,fetchImpl:async()=>{sent++;throw Error('network must not run');},
   freezeQuote:makeFreeze(f.env,async()=>({coinCents:0,rubPerUsdMinor:9500}))
  }),/pricing_unavailable/);
  assert.equal(sent,0);
  assert.equal(f.pay.prepare('SELECT COUNT(*) n FROM rustup_stars_variable_credit_quotes').get().n,0);
 }finally{f.close();}
});
test('game ledger release disabled prevents invoice even if all worker flags enabled',async()=>{
 const f=fixture();
 try{
  f.game.prepare('UPDATE rustup_game_paid_release_control SET enabled=0').run();
  let sent=0;
  await assert.rejects(()=>createVariableStarsCheckout({...f.env,DB:f.env.PAYMENTS_DB},{
   verifiedTelegramUserId:USER,amountMinor:10000,requestId:REQUEST,
   now:NOW,fetchImpl:async()=>{sent++;throw Error('not allowed');},
   freezeQuote:makeFreeze(f.env)
  }),/game_release_disabled/);
  assert.equal(sent,0);
 }finally{f.close();}
});

test('default 1 RUB = 1 Coin pricing freezes exactly 100 Coins for 100 RUB',async()=>{
 const f=fixture();
 try{
  const args={verifiedTelegramUserId:USER,amountMinor:10000,
   requestId:REQUEST,now:NOW,
   fetchImpl:async()=>({ok:true,json:async()=>({ok:true,
    result:'https://t.me/$fake-offline-invoice'})}),
   freezeQuote:makeFreeze(f.env,async({amountMinor})=>({
    coinCents:amountMinor,rubPerUsdMinor:null
   }))
  };
  await createVariableStarsCheckout({...f.env,DB:f.env.PAYMENTS_DB},args);
  const stored=f.pay.prepare('SELECT coin_cents,rub_per_usd_minor '+
   'FROM rustup_stars_variable_credit_quotes').get();
  assert.equal(stored.coin_cents,10000);
  assert.equal(stored.rub_per_usd_minor,null);
 }finally{f.close();}
});
