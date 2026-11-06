import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
const canonical=readFileSync(new URL('./canonical-game-balance-sync.sql',import.meta.url),'utf8');
const guard=readFileSync(new URL('./guard-game-balance-mirror.sql',import.meta.url),'utf8');
function database(){
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE accounts(id INTEGER PRIMARY KEY,state TEXT NOT NULL,v INTEGER DEFAULT 1,updated INTEGER DEFAULT 1);
 CREATE TABLE users(id INTEGER PRIMARY KEY,balance REAL);
 INSERT INTO accounts(id,state) VALUES(123,'{"balance":100,"inventory":[]}');
 INSERT INTO users(id,balance) VALUES(123,100);`);
 db.exec(canonical);
 db.exec(guard);
 return db;
}
test('atomic new canonical balance sync is allowed by guard',()=>{
 const db=database();
 try{
  db.exec("UPDATE accounts SET state=json_set(state,'$.balance',105),v=v+1 WHERE id=123");
  assert.equal(db.prepare('SELECT balance FROM users WHERE id=123').get().balance,105);
 }finally{db.close();}
});
test('stale standalone mirror update is refused, leaving canonical and mirror unchanged',()=>{
 const db=database();
 try{
  db.exec("UPDATE accounts SET state=json_set(state,'$.balance',105) WHERE id=123");
  assert.throws(()=>db.exec('UPDATE users SET balance=100 WHERE id=123'),/rustup_user_balance_must_match_canonical_account/);
  assert.equal(db.prepare('SELECT balance FROM users').get().balance,105);
 }finally{db.close();}
});
test('guard does not reconcile or change any historical mismatch during installation',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec(`CREATE TABLE accounts(id INTEGER PRIMARY KEY,state TEXT NOT NULL);
  CREATE TABLE users(id INTEGER PRIMARY KEY,balance REAL);
  INSERT INTO accounts VALUES(123,'{"balance":129.09}');
  INSERT INTO users VALUES(123,124.09);`);
  db.exec(guard);
  const result=db.prepare("SELECT json_extract(a.state,'$.balance') canonical,u.balance mirror FROM accounts a JOIN users u ON u.id=a.id").get();
  assert.equal(result.canonical,129.09);
  assert.equal(result.mirror,124.09);
 }finally{db.close();}
});
test('refund-like canonical subtraction safely updates mirrored balance',()=>{
 const db=database();
 try{
  db.exec("UPDATE accounts SET state=json_set(state,'$.balance',93.17),v=v+1 WHERE id=123");
  assert.equal(db.prepare('SELECT balance FROM users').get().balance,93.17);
 }finally{db.close();}
});
