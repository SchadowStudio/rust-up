// RUST UP: local-only integration of existing settlement modules.
// All Stars are fake responses, all player balances live in ephemeral
// in-memory SQLite databases, and no Cloudflare/Telegram request is sent.
// Never run this fixture against a real database or deploy this code.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {deliverVerifiedVariableStarsCredit} from './verified-stars-game-credit.mjs';
import {reconcileVerifiedStarsGameRefund} from './verified-stars-game-refund.mjs';
import {evaluateStarsSettlementSnapshot} from '../../scripts/audit-stars-settlement-readonly.mjs';

const ORDER='123e4567-e89b-42d3-a456-426614174000';
const ACCOUNT=123456789;
const CHARGE='offline-telegram-charge-123456';
const BOT_TOKEN='123456789:'+('x'.repeat(30));
const CREDIT_CENTS=150;
const STARS=535;
const AMOUNT=100000;
const CREATED=1793999000000;
const PAID=1794000000000;

function api(db){
 return {prepare(sql){
  const statement=db.prepare(sql);
  return {bind(...params){
   return {
    async first(){return statement.get(...params)||null;},
    async all(){return {results:statement.all(...params)};},
    async run(){return {meta:{changes:statement.run(...params).changes}};}
   };
  }};
 }};
}
function getBalance(db,id=ACCOUNT){
 const canonical=db.prepare('SELECT state,v FROM accounts WHERE id=?').get(id);
 const mirror=db.prepare('SELECT balance FROM users WHERE id=?').get(id);
 return {canonical:canonical?JSON.parse(canonical.state):null,
  mirror:mirror?.balance,v:canonical?.v};
}
function setup({release=false,consistency=true,quote=true,
 status='paid',userBlocked=false}={}){
 const game=new DatabaseSync(':memory:');
 const pay=new DatabaseSync(':memory:');
 game.exec('PRAGMA foreign_keys=ON;'+
  'CREATE TABLE accounts(id INTEGER PRIMARY KEY,state TEXT NOT NULL,'+
  'v INTEGER NOT NULL,updated INTEGER NOT NULL);'+
  'CREATE TABLE users(id INTEGER PRIMARY KEY,balance REAL,'+
  'blocked INTEGER NOT NULL DEFAULT 0,banned INTEGER NOT NULL DEFAULT 0);');
 game.exec(readFileSync(new URL('./atomic-game-credit.sql',import.meta.url),'utf8'));
 game.prepare('INSERT INTO accounts(id,state,v,updated) VALUES(?,?,?,?)')
  .run(ACCOUNT,JSON.stringify({balance:10,history:['preserved'],inventory:[1,2]}),7,CREATED);
 game.prepare('INSERT INTO users(id,balance,blocked) VALUES(?,?,?)')
  .run(ACCOUNT,consistency?10:9,userBlocked?1:0);
 pay.exec(readFileSync(new URL('../telegram-stars/variable-migration.sql',
  import.meta.url),'utf8'));
 pay.exec(readFileSync(new URL('./variable-stars-credit-quote.sql',
  import.meta.url),'utf8'));
 pay.prepare('INSERT INTO rustup_stars_variable_orders ('+
  'id,telegram_user_id,client_request_id,requested_amount_minor,price_stars,'+
  'rate_num,rate_den,status,telegram_charge_id,created_at_ms,expires_at_ms,paid_at_ms)'+
  ' VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
  .run(ORDER,ACCOUNT,'offline-request-1',AMOUNT,STARS,1,1,
   status,CHARGE,CREATED,PAID+100000,PAID);
 if(quote)pay.prepare('INSERT INTO rustup_stars_variable_credit_quotes ('+
  'order_id,telegram_user_id,amount_minor,coin_cents,rub_per_usd_minor,quoted_at_ms)'+
  ' VALUES (?,?,?,?,?,?)')
  .run(ORDER,ACCOUNT,AMOUNT,CREDIT_CENTS,8000,PAID-1000);
 if(release){
  game.prepare('UPDATE rustup_game_paid_release_control '+
   'SET enabled=1,approval_reference=?,reviewed_at_ms=? WHERE id=1')
   .run('OFFLINE-E2E-TEST-ONLY',PAID-2000);
 }
 const env={
  DB:api(game),PAYMENTS_DB:api(pay),BOT_TOKEN,
  STARS_GAME_CREDIT_SETTLEMENT_ENABLED:'true',
  STARS_GAME_CREDIT_REFUND_RECONCILIATION_ENABLED:'true',
  PAYMENT_WALLET_STRICT_MODE:'true',
  STARS_VARIABLE_CREDIT_LEDGER_READY:'true',
  PAYMENT_PRODUCTION_ENABLED:'true'
 };
 return {game,pay,env,close(){game.close();pay.close();}};
}
function transaction(incoming=true){
 return incoming?{
  id:CHARGE,amount:STARS,
  source:{type:'user',transaction_type:'invoice_payment',
   user:{id:ACCOUNT},invoice_payload:'v:'+ORDER}
 }:{
  id:CHARGE,amount:-STARS,
  receiver:{type:'user',user:{id:ACCOUNT}}
 };
}
function telegramStub(transactions){
 let requests=0;
 const fetchImpl=async(url,opts)=>{
  requests++;
  assert.equal(opts.method,'POST');
  assert.ok(url.endsWith('/getStarTransactions'));
  assert.ok(url.startsWith('https://api.telegram.org/bot'));
  const body=JSON.parse(opts.body);
  assert.equal(body.limit,100);
  const batch=transactions.slice(body.offset,body.offset+body.limit);
  return {ok:true,json:async()=>({ok:true,result:{transactions:batch}})};
 };
 return {fetchImpl,get requests(){return requests;}};
}
function totals(db){
 return {receipts:db.prepare('SELECT COUNT(*) AS n FROM rustup_game_paid_receipts').get().n,
  refunds:db.prepare('SELECT COUNT(*) AS n FROM rustup_game_paid_refunds').get().n};
}

test('default-OFF journal prevents an otherwise valid fake paid receipt from changing any balance',async()=>{
 const f=setup();
 try{
  const fake=telegramStub([transaction()]);
  await assert.rejects(()=>deliverVerifiedVariableStarsCredit(
   f.env,ORDER,fake.fetchImpl),/stars_game_credit_failed_requires_operator_review/);
  assert.deepEqual(totals(f.game),{receipts:0,refunds:0});
  assert.deepEqual(getBalance(f.game),{
   canonical:{balance:10,history:['preserved'],inventory:[1,2]},
   mirror:10,v:7
  });
  assert.ok(fake.requests>0);
 }finally{f.close();}
});

test('fake verified receipt credits exactly once, replay does not alter v, refund reverses exactly once',async()=>{
 const f=setup({release:true});
 try{
  const incoming=telegramStub([transaction()]);
  const first=await deliverVerifiedVariableStarsCredit(f.env,ORDER,incoming.fetchImpl);
  assert.equal(first.applied,true);
  assert.equal(first.creditedCoinCents,CREDIT_CENTS);
  assert.deepEqual(totals(f.game),{receipts:1,refunds:0});
  assert.deepEqual(getBalance(f.game),{
   canonical:{balance:11.5,history:['preserved'],inventory:[1,2]},
   mirror:11.5,v:8
  });
  const again=await deliverVerifiedVariableStarsCredit(f.env,ORDER,incoming.fetchImpl);
  assert.equal(again.applied,false);
  assert.equal(again.replayed,true);
  assert.deepEqual(getBalance(f.game),{
   canonical:{balance:11.5,history:['preserved'],inventory:[1,2]},
   mirror:11.5,v:8
  });
  f.pay.prepare("UPDATE rustup_stars_variable_orders SET status='refunded' WHERE id=?")
   .run(ORDER);
  const outgoing=telegramStub([transaction(false)]);
  const reversed=await reconcileVerifiedStarsGameRefund(
   f.env,ORDER,outgoing.fetchImpl);
  assert.equal(reversed.gameCreditReversed,true);
  assert.equal(reversed.replayed,false);
  assert.deepEqual(getBalance(f.game),{
   canonical:{balance:10,history:['preserved'],inventory:[1,2]},
   mirror:10,v:9
  });
  const againRefund=await reconcileVerifiedStarsGameRefund(
   f.env,ORDER,outgoing.fetchImpl);
  assert.equal(againRefund.replayed,true);
  assert.deepEqual(totals(f.game),{receipts:1,refunds:1});
  assert.equal(getBalance(f.game).v,9);
  await assert.rejects(()=>deliverVerifiedVariableStarsCredit(
   f.env,ORDER,incoming.fetchImpl),/stars_settlement_paid_order_invalid/);
 }finally{f.close();}
});

test('fake mismatched Telegram account or missing quote produces no receipt',async()=>{
 for(const bad of ['forged-user','missing-quote']){
  const f=setup({release:true,quote:bad!=='missing-quote'});
  try{
   const fake=transaction();
   if(bad==='forged-user')fake.source.user.id=ACCOUNT+1;
   await assert.rejects(()=>deliverVerifiedVariableStarsCredit(
    f.env,ORDER,telegramStub([fake]).fetchImpl));
   assert.deepEqual(totals(f.game),{receipts:0,refunds:0});
   assert.equal(getBalance(f.game).canonical.balance,10);
  }finally{f.close();}
 }
});

test('blocked or inconsistent game player can never get the fake credit despite valid Telegram proof',async()=>{
 for(const kind of ['blocked','mismatch']){
  const f=setup({release:true,userBlocked:kind==='blocked',
   consistency:kind!=='mismatch'});
  try{
   await assert.rejects(()=>deliverVerifiedVariableStarsCredit(
    f.env,ORDER,telegramStub([transaction()]).fetchImpl),
    /stars_game_credit_failed_requires_operator_review/);
   assert.deepEqual(totals(f.game),{receipts:0,refunds:0});
   assert.equal(getBalance(f.game).canonical.balance,10);
  }finally{f.close();}
 }
});

test('spent fake credit cannot be silently reversed or recorded as refunded',async()=>{
 const f=setup({release:true});
 try{
  await deliverVerifiedVariableStarsCredit(
   f.env,ORDER,telegramStub([transaction()]).fetchImpl);
  f.game.prepare('UPDATE accounts SET state=? WHERE id=?')
   .run(JSON.stringify({balance:0.25,history:['spent']}),ACCOUNT);
  f.game.prepare('UPDATE users SET balance=? WHERE id=?').run(0.25,ACCOUNT);
  f.pay.prepare("UPDATE rustup_stars_variable_orders SET status='refunded' WHERE id=?")
   .run(ORDER);
  await assert.rejects(()=>reconcileVerifiedStarsGameRefund(
   f.env,ORDER,telegramStub([transaction(false)]).fetchImpl),/manual_review/);
  assert.deepEqual(totals(f.game),{receipts:1,refunds:0});
  assert.equal(getBalance(f.game).canonical.balance,0.25);
 }finally{f.close();}
});

test('a fake Telegram refund with no original game credit never creates a negative game balance',async()=>{
 const f=setup({release:false,status:'refunded'});
 try{
  const result=await reconcileVerifiedStarsGameRefund(
   f.env,ORDER,telegramStub([transaction(false)]).fetchImpl);
  assert.equal(result.gameCreditHadBeenApplied,false);
  assert.equal(result.gameCreditReversed,false);
  assert.deepEqual(totals(f.game),{receipts:0,refunds:0});
  assert.equal(getBalance(f.game).canonical.balance,10);
 }finally{f.close();}
});

function liveAuditModelFromIsolatedDatabases(f){
 const rows=(db,sql)=>db.prepare(sql).all();
 const tables=db=>rows(db,
  "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'rustup_%'").map(x=>x.name);
 const flags=['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
  'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
  'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
  'PAYMENT_WALLET_STRICT_MODE',
  'STARS_GAME_CREDIT_SETTLEMENT_ENABLED',
  'STARS_GAME_CREDIT_REFUND_RECONCILIATION_ENABLED'];
 return evaluateStarsSettlementSnapshot({
  paymentTables:[
   ...tables(f.pay),'rustup_stars_variable_refund_intents',
   'rustup_stars_receipt_incidents','rustup_payment_settings'
  ],
  gameTables:tables(f.game),
  orders:rows(f.pay,'SELECT * FROM rustup_stars_variable_orders'),
  quotes:rows(f.pay,'SELECT * FROM rustup_stars_variable_credit_quotes'),
  credits:rows(f.game,'SELECT * FROM rustup_game_paid_receipts'),
  refunds:rows(f.game,'SELECT * FROM rustup_game_paid_refunds'),
  controls:['master','stars','crypto'].map(channel=>({channel,enabled:0})),
  incidents:[{value:0}],refundIntents:[],
  bindings:[
   {name:'DB',type:'d1',id:'9b0b533f-540a-4a25-a429-70ca8bd4e23d'},
   {name:'PAYMENTS_DB',type:'d1',id:'06079270-a227-466a-9991-abd4201ec5f6'},
   ...flags.map(name=>({name,type:'plain_text',text:'false'}))
  ],
  gameReleaseControl:f.game.prepare(
   'SELECT enabled,approval_reference,reviewed_at_ms FROM rustup_game_paid_release_control WHERE id=1'
  ).get()
 });
}

test('independent cross-D1 audit detects missing credit and reconciled refund in fake lifecycle',async()=>{
 const f=setup({release:true});
 try{
  // Paid order without corresponding game journal is NOT a consistent ledger.
  let r=liveAuditModelFromIsolatedDatabases(f);
  assert.equal(r.anomalies.paidNotCredited,1);
  assert.equal(r.allChecksPass,false);
  assert.ok(r.blockers.includes('payment_ledger_or_refund_requires_review'));
  await deliverVerifiedVariableStarsCredit(
   f.env,ORDER,telegramStub([transaction()]).fetchImpl);
  r=liveAuditModelFromIsolatedDatabases(f);
  assert.equal(r.anomalies.paidNotCredited,0);
  assert.equal(r.anomalies.creditedIdentityOrAmountMismatch,0);
  assert.equal(r.scanned.credits,1);
  // The test fixture temporarily opened its own ephemeral ledger for a
  // credit; a real production OFF-mode audit must never call this a release.
  assert.equal(r.gameLedgerGateOff,false);
  assert.equal(r.allChecksPass,false);
  f.pay.prepare("UPDATE rustup_stars_variable_orders SET status='refunded' WHERE id=?")
   .run(ORDER);
  r=liveAuditModelFromIsolatedDatabases(f);
  assert.equal(r.anomalies.refundedButStillCredited,1);
  await reconcileVerifiedStarsGameRefund(
   f.env,ORDER,telegramStub([transaction(false)]).fetchImpl);
  r=liveAuditModelFromIsolatedDatabases(f);
  assert.equal(r.anomalies.refundedButStillCredited,0);
  assert.equal(r.anomalies.refundedReversalConflict,0);
  assert.equal(r.scanned.reversals,1);
  assert.deepEqual(totals(f.game),{receipts:1,refunds:1});
  // No change to game balance during this READ-ONLY reconciliation.
  assert.equal(getBalance(f.game).canonical.balance,10);
 }finally{f.close();}
});

test('cross-D1 audit detects a tampered quote after fake receipt booking',async()=>{
 const f=setup({release:true});
 try{
  await deliverVerifiedVariableStarsCredit(
   f.env,ORDER,telegramStub([transaction()]).fetchImpl);
  f.pay.prepare('UPDATE rustup_stars_variable_credit_quotes SET coin_cents=? WHERE order_id=?')
   .run(CREDIT_CENTS+1,ORDER);
  const r=liveAuditModelFromIsolatedDatabases(f);
  assert.equal(r.anomalies.creditedIdentityOrAmountMismatch,1);
  assert.ok(r.blockers.includes('payment_ledger_or_refund_requires_review'));
  assert.equal(getBalance(f.game).canonical.balance,11.5);
 }finally{f.close();}
});

test('two simultaneous fake confirmations cannot credit one Telegram order twice',async()=>{
 const f=setup({release:true});
 try{
  const receipts=await Promise.allSettled(Array.from({length:2},()=>
   deliverVerifiedVariableStarsCredit(
    f.env,ORDER,telegramStub([transaction()]).fetchImpl)));
  assert.ok(receipts.every(x=>x.status==='fulfilled'));
  assert.equal(receipts.filter(x=>x.value.applied===true).length,1);
  assert.equal(receipts.filter(x=>x.value.replayed===true).length,1);
  assert.deepEqual(totals(f.game),{receipts:1,refunds:0});
  assert.equal(getBalance(f.game).canonical.balance,11.5);
  assert.equal(getBalance(f.game).v,8);
 }finally{f.close();}
});

test('two simultaneous fake refund reconciliations cannot subtract twice',async()=>{
 const f=setup({release:true});
 try{
  await deliverVerifiedVariableStarsCredit(
   f.env,ORDER,telegramStub([transaction()]).fetchImpl);
  f.pay.prepare("UPDATE rustup_stars_variable_orders SET status='refunded' WHERE id=?")
   .run(ORDER);
  const results=await Promise.allSettled(Array.from({length:2},()=>
   reconcileVerifiedStarsGameRefund(
    f.env,ORDER,telegramStub([transaction(false)]).fetchImpl)));
  assert.ok(results.every(x=>x.status==='fulfilled'));
  assert.equal(results.filter(x=>x.value.gameCreditReversed===true&&
   x.value.replayed===false).length,1);
  assert.equal(results.filter(x=>x.value.replayed===true).length,1);
  assert.deepEqual(totals(f.game),{receipts:1,refunds:1});
  assert.equal(getBalance(f.game).canonical.balance,10);
  assert.equal(getBalance(f.game).v,9);
 }finally{f.close();}
});

function loseAcknowledgementAfterCommittedInsert(originalDb,table){
 const db=api(originalDb);
 let injected=false;
 return {prepare(sql){
  const prepared=db.prepare(sql);
  if(!sql.startsWith('INSERT INTO '+table))return prepared;
  return {bind(...params){
   const statement=prepared.bind(...params);
   return {async run(){
    const result=await statement.run();
    if(!injected){
     injected=true;
     throw Error('simulated_d1_acknowledgement_lost_after_commit');
    }
    return result;
   }};
  }};
 }};
}

test('if game D1 commits fake credit but loses its ACK, it is classified as replay, never credited twice',async()=>{
 const f=setup({release:true});
 try{
  f.env.DB=loseAcknowledgementAfterCommittedInsert(f.game,
   'rustup_game_paid_receipts');
  const first=await deliverVerifiedVariableStarsCredit(
   f.env,ORDER,telegramStub([transaction()]).fetchImpl);
  assert.equal(first.applied,false);
  assert.equal(first.replayed,true);
  const second=await deliverVerifiedVariableStarsCredit(
   f.env,ORDER,telegramStub([transaction()]).fetchImpl);
  assert.equal(second.applied,false);
  assert.equal(second.replayed,true);
  assert.deepEqual(totals(f.game),{receipts:1,refunds:0});
  assert.equal(getBalance(f.game).canonical.balance,11.5);
  assert.equal(getBalance(f.game).v,8);
 }finally{f.close();}
});

test('if game D1 commits fake refund but loses its ACK, no second debit occurs',async()=>{
 const f=setup({release:true});
 try{
  await deliverVerifiedVariableStarsCredit(
   f.env,ORDER,telegramStub([transaction()]).fetchImpl);
  f.pay.prepare("UPDATE rustup_stars_variable_orders SET status='refunded' WHERE id=?")
   .run(ORDER);
  f.env.DB=loseAcknowledgementAfterCommittedInsert(f.game,
   'rustup_game_paid_refunds');
  const first=await reconcileVerifiedStarsGameRefund(
   f.env,ORDER,telegramStub([transaction(false)]).fetchImpl);
  assert.equal(first.replayed,true);
  const second=await reconcileVerifiedStarsGameRefund(
   f.env,ORDER,telegramStub([transaction(false)]).fetchImpl);
  assert.equal(second.replayed,true);
  assert.deepEqual(totals(f.game),{receipts:1,refunds:1});
  assert.equal(getBalance(f.game).canonical.balance,10);
  assert.equal(getBalance(f.game).v,9);
 }finally{f.close();}
});

test('Telegram proof missing after a valid paid order must not alter a game account',async()=>{
 const f=setup({release:true});
 try{
  const before=getBalance(f.game);
  await assert.rejects(()=>deliverVerifiedVariableStarsCredit(
   f.env,ORDER,telegramStub([]).fetchImpl),/charge_unconfirmed/);
  assert.deepEqual(getBalance(f.game),before);
  assert.deepEqual(totals(f.game),{receipts:0,refunds:0});
 }finally{f.close();}
});
