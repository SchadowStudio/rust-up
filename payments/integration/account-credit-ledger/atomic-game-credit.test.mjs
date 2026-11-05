import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

const schema=readFileSync(new URL('./atomic-game-credit.sql',import.meta.url),'utf8');
const orderId='123e4567-e89b-42d3-a456-426614174000';

function fixture(balance=10,mirror=true){
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE accounts(id INTEGER PRIMARY KEY,state TEXT NOT NULL,v INTEGER NOT NULL,updated INTEGER NOT NULL);');
 db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY,balance REAL);');
 db.exec(schema);
 db.prepare('INSERT INTO accounts VALUES(?,?,?,?)').run(123456789,JSON.stringify({
  balance,inventory:['old-item'],history:[{kind:'existing'}]
 }),3,1);
 if(mirror)db.prepare('INSERT INTO users VALUES(?,?)').run(123456789,balance);
 return db;
}
function credit(db,{order=orderId,charge='tg-charge-12345678',user=123456789,coinCents=150,amount=1000}={}){
 return db.prepare('INSERT INTO rustup_game_paid_receipts '+
 '(source,order_id,receipt_id,telegram_user_id,amount_minor,coin_cents,created_at_ms) VALUES(?,?,?,?,?,?,?)')
  .run('stars_variable',order,charge,user,amount,coinCents,1794000000000);
}
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
