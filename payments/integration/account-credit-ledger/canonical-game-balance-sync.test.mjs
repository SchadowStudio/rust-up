import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

const ddl=readFileSync(new URL('./canonical-game-balance-sync.sql',import.meta.url),'utf8');
function setup(){
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE accounts(id INTEGER PRIMARY KEY,state TEXT NOT NULL,v INTEGER NOT NULL DEFAULT 1,updated INTEGER NOT NULL);
 CREATE TABLE users(id INTEGER PRIMARY KEY,balance REAL);
 INSERT INTO accounts VALUES(7390606911,'{"balance":100,"inventory":[]}',1,100);
 INSERT INTO users VALUES(7390606911,100);`);
 db.exec(ddl);
 return db;
}
test('canonical account update mirrors 5 RUB exactly once and retains other state',()=>{
 const db=setup();
 try{
  db.prepare("UPDATE accounts SET state=json_set(state,'$.balance',json_extract(state,'$.balance')+5),v=v+1,updated=101 WHERE id=7390606911").run();
  const account=db.prepare('SELECT json_extract(state,\'$.balance\') AS balance,v,json_array_length(state,\'$.inventory\') AS inventory FROM accounts').get();
  const user=db.prepare('SELECT balance FROM users').get();
  assert.equal(account.balance,105);
  assert.equal(user.balance,105);
  assert.equal(account.v,2);
  assert.equal(account.inventory,0);
 }finally{db.close();}
});
test('receipt-like atomic update rolls back if user mirror is missing',()=>{
 const db=setup();
 try{
  db.exec('DELETE FROM users');
  assert.throws(()=>db.prepare("UPDATE accounts SET state=json_set(state,'$.balance',105),v=v+1 WHERE id=7390606911").run(),/rustup_canonical_balance_user_missing/);
  assert.equal(db.prepare("SELECT json_extract(state,'$.balance') balance FROM accounts").get().balance,100);
  assert.equal(db.prepare('SELECT v FROM accounts').get().v,1);
 }finally{db.close();}
});
test('non-balance account state update does not touch user mirror',()=>{
 const db=setup();
 try{
  db.exec('UPDATE users SET balance=99');
  db.exec("UPDATE accounts SET state=json_set(state,'$.inventory',json_array(1)) WHERE id=7390606911");
  assert.equal(db.prepare('SELECT balance FROM users').get().balance,99);
 }finally{db.close();}
});
test('migration cannot by itself alter the existing user balances',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec(`CREATE TABLE accounts(id INTEGER PRIMARY KEY,state TEXT,v INTEGER,updated INTEGER);
  CREATE TABLE users(id INTEGER PRIMARY KEY,balance REAL);
  INSERT INTO accounts VALUES(1,'{"balance":129.09}',12229,99);
  INSERT INTO users VALUES(1,124.09);`);
  db.exec(ddl);
  assert.deepEqual({...db.prepare("SELECT json_extract(a.state,'$.balance') canonical,u.balance mirror FROM accounts a JOIN users u ON u.id=a.id").get()},{canonical:129.09,mirror:124.09});
 }finally{db.close();}
});
