import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

const schema=readFileSync(new URL('./atomic-game-credit.sql',import.meta.url),'utf8');
const orderId='123e4567-e89b-42d3-a456-426614174000';

function fixture(balance=10,mirror=true,enableLedger=true){
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE accounts(id INTEGER PRIMARY KEY,state TEXT NOT NULL,v INTEGER NOT NULL,updated INTEGER NOT NULL);');
 db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY,balance REAL,blocked INTEGER NOT NULL DEFAULT 0,banned INTEGER NOT NULL DEFAULT 0);');
 db.exec(schema);
 if(enableLedger)db.prepare(
  'UPDATE rustup_game_paid_release_control '+
  'SET enabled=1,approval_reference=?,reviewed_at_ms=? WHERE id=1'
 ).run('offline-unit-test-approval-only',1794000000000);
 db.prepare('INSERT INTO accounts VALUES(?,?,?,?)').run(123456789,JSON.stringify({
  balance,inventory:['old-item'],history:[{kind:'existing'}]
 }),3,1);
 if(mirror)db.prepare('INSERT INTO users(id,balance) VALUES(?,?)').run(123456789,balance);
 return db;
}
function credit(db,{order=orderId,charge='tg-charge-12345678',user=123456789,coinCents=150,amount=1000}={}){
 return db.prepare('INSERT INTO rustup_game_paid_receipts '+
 '(source,order_id,receipt_id,telegram_user_id,amount_minor,coin_cents,created_at_ms) VALUES(?,?,?,?,?,?,?)')
  .run('stars_variable',order,charge,user,amount,coinCents,1794000000000);
}
test('the migration is locked OFF by default and no receipt can create money',()=>{
 const db=fixture(10,true,false);
 try {
  assert.equal(db.prepare('SELECT enabled FROM rustup_game_paid_release_control').get().enabled,0);
  assert.throws(()=>credit(db),/rustup_paid_credit_release_disabled/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM rustup_game_paid_receipts').get().n,0);
  assert.equal(JSON.parse(db.prepare('SELECT state FROM accounts').get().state).balance,10);
  db.prepare('UPDATE rustup_game_paid_release_control SET enabled=1').run();
  assert.throws(()=>credit(db),/rustup_paid_credit_release_disabled/);
 }finally{db.close();}
});

test('one receipt atomically credits canonical account and users.balance mirror',()=>{
 const db=fixture();
 try{
  assert.equal(credit(db).changes,1);
  const row=db.prepare('SELECT state,v FROM accounts WHERE id=?').get(123456789);
  const state=JSON.parse(row.state);
  assert.equal(state.balance,11.5);
  assert.equal(row.v,4);
  assert.deepEqual(state.inventory,['old-item']);
  assert.deepEqual(state.history,[{kind:'existing'}]);
  assert.equal(db.prepare('SELECT balance FROM users WHERE id=?').get(123456789).balance,11.5);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM rustup_game_paid_receipts').get().n,1);
 }finally{db.close();}
});
test('same order or charge cannot pay twice and does not alter balances',()=>{
 const db=fixture();
 try{
  credit(db);
  assert.throws(()=>credit(db),/UNIQUE/);
  assert.throws(()=>credit(db,{order:'another-order-0001'}),/UNIQUE/);
  assert.throws(()=>credit(db,{charge:'different-charge-001'}),/UNIQUE/);
  assert.equal(JSON.parse(db.prepare('SELECT state FROM accounts').get().state).balance,11.5);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM rustup_game_paid_receipts').get().n,1);
 }finally{db.close();}
});
test('missing canonical account or users mirror aborts entire transaction',()=>{
 for(const missing of ['game','users']){
  const db=fixture(10,missing!=='users');
  try{
   if(missing==='game')db.prepare('DELETE FROM accounts').run();
   assert.throws(()=>credit(db),/paid_credit_/);
   assert.equal(db.prepare('SELECT COUNT(*) n FROM rustup_game_paid_receipts').get().n,0);
   const game=db.prepare('SELECT state,v FROM accounts').get();
   if(game)assert.equal(JSON.parse(game.state).balance,10);
  }finally{db.close();}
 }
});
test('invalid, negative and overflowing canonical balances abort without journal entry',()=>{
 for(const value of [-3,'invalid',1000000]){
  const db=fixture();
  try{
   db.prepare('UPDATE accounts SET state=?').run(value==='invalid'?'not-json':
    JSON.stringify({balance:value}));
   assert.throws(()=>credit(db));
   assert.equal(db.prepare('SELECT COUNT(*) n FROM rustup_game_paid_receipts').get().n,0);
  }finally{db.close();}
 }
});

function refund(db,{order=orderId,charge='tg-charge-12345678',
 user=123456789,coinCents=150}={}){
 return db.prepare('INSERT INTO rustup_game_paid_refunds '+
  '(source,order_id,receipt_id,telegram_user_id,coin_cents,refunded_at_ms) '+
  'VALUES (?,?,?,?,?,?)')
  .run('stars_variable',order,charge,user,coinCents,1794000100000);
}

test('blocked and banned accounts are never credited, journal remains empty',()=>{
 for(const field of ['blocked','banned']){
  const db=fixture();
  try{
   db.prepare('UPDATE users SET '+field+'=1 WHERE id=?').run(123456789);
   assert.throws(()=>credit(db),/restricted_or_unsynced/);
   assert.equal(db.prepare('SELECT COUNT(*) n FROM rustup_game_paid_receipts').get().n,0);
   assert.equal(JSON.parse(db.prepare('SELECT state FROM accounts').get().state).balance,10);
  }finally{db.close();}
 }
});
test('mirror disagreement, missing user balance and fractional cents block paid credit',()=>{
 for(const problem of ['mirror','null','fractional']){
  const db=fixture();
  try{
   if(problem==='mirror')db.prepare('UPDATE users SET balance=balance+1').run();
   if(problem==='null')db.prepare('UPDATE users SET balance=NULL').run();
   if(problem==='fractional'){
    db.prepare('UPDATE accounts SET state=?').run(JSON.stringify({balance:1.001}));
    db.prepare('UPDATE users SET balance=1.001').run();
   }
   assert.throws(()=>credit(db),/restricted_or_unsynced/);
   assert.equal(db.prepare('SELECT COUNT(*) n FROM rustup_game_paid_receipts').get().n,0);
   assert.equal(db.prepare('SELECT v FROM accounts').get().v,3);
  }finally{db.close();}
 }
});
test('a refunded, subsequently blocked player still gets an exact matching reversal',()=>{
 const db=fixture();
 try{
  credit(db);
  db.prepare('UPDATE users SET blocked=1,banned=1').run();
  assert.equal(refund(db).changes,1);
  assert.equal(JSON.parse(db.prepare('SELECT state FROM accounts').get().state).balance,10);
  assert.equal(db.prepare('SELECT balance FROM users').get().balance,10);
 }finally{db.close();}
});
test('refund refuses inconsistent mirror and never creates a reversal row',()=>{
 const db=fixture();
 try{
  credit(db);
  db.prepare('UPDATE users SET balance=99').run();
  assert.throws(()=>refund(db),/unsynced_manual_review/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM rustup_game_paid_refunds').get().n,0);
  assert.equal(JSON.parse(db.prepare('SELECT state FROM accounts').get().state).balance,11.5);
 }finally{db.close();}
});

test('provider-verified refund event reverses exact credit and mirrored balance once',()=>{
 const db=fixture();
 try{
  credit(db);
  assert.equal(refund(db).changes,1);
  const row=db.prepare('SELECT state,v FROM accounts').get();
  assert.equal(JSON.parse(row.state).balance,10);
  assert.equal(row.v,5);
  assert.equal(db.prepare('SELECT balance FROM users').get().balance,10);
  assert.throws(()=>refund(db),/UNIQUE/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM rustup_game_paid_refunds').get().n,1);
  assert.equal(JSON.parse(db.prepare('SELECT state FROM accounts').get().state).balance,10);
 }finally{db.close();}
});
test('wrong refunded charge, user or amount fails without balance movement',()=>{
 const db=fixture();
 try{
  credit(db);
  for(const bad of [
   {charge:'wrong-charge-1234'}, {user:123456790}, {coinCents:151},
   {order:'wrong-order-123456789'}
  ]){
   assert.throws(()=>refund(db,bad),/mismatch|FOREIGN KEY|unsynced_manual_review/);
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM rustup_game_paid_refunds').get().n,0);
  assert.equal(JSON.parse(db.prepare('SELECT state FROM accounts').get().state).balance,11.5);
 }finally{db.close();}
});
test('already-spent credit requires manual review, not an unrecorded reversal',()=>{
 const db=fixture();
 try{
  credit(db);
  const state={balance:0.25,inventory:['used']};
  db.prepare('UPDATE accounts SET state=?').run(JSON.stringify(state));
  db.prepare('UPDATE users SET balance=?').run(0.25);
  assert.throws(()=>refund(db),/spent_manual_review/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM rustup_game_paid_refunds').get().n,0);
  assert.equal(JSON.parse(db.prepare('SELECT state FROM accounts').get().state).balance,0.25);
  assert.equal(db.prepare('SELECT balance FROM users').get().balance,0.25);
 }finally{db.close();}
});
