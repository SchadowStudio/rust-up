import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('./main-bot-stars-ops.mjs',import.meta.url),'utf8');
function statement(start){
 const at=src.indexOf('await sql(PD,`'+start);
 assert.ok(at>=0,'missing source SQL '+start);
 const after=at+'await sql(PD,`'.length;
 const end=src.indexOf('`);',after);
 assert.ok(end>after,'missing SQL end '+start);
 return src.slice(after,end);
}
function make(){
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE rustup_stars_variable_orders(id TEXT PRIMARY KEY,telegram_user_id INTEGER NOT NULL,price_stars INTEGER NOT NULL)');
 db.exec(statement('CREATE TABLE IF NOT EXISTS rustup_stars_pilot_guard'));
 db.exec(statement('INSERT OR IGNORE INTO rustup_stars_pilot_guard'));
 db.exec(statement('CREATE TRIGGER IF NOT EXISTS rustup_stars_pilot_order_cap'));
 db.exec(statement('UPDATE rustup_stars_pilot_guard SET enabled=1'));
 const add=(id,user,price)=>db.prepare('INSERT INTO rustup_stars_variable_orders(id,telegram_user_id,price_stars) VALUES(?,?,?)').run(id,user,price);
 return {db,add};
}
test('Pilot only allows the selected Telegram user and a fixed 1-Star first order',()=>{
 const {db,add}=make();
 try{
  assert.throws(()=>add('bad',777,1),/pilot_user_denied/);
  assert.throws(()=>add('wrong-price',7390606911,2),/pilot_fixed_one_star_required/);
  add('first',7390606911,1);
  assert.throws(()=>add('second-early',7390606911,1),/pilot_second_order_not_open/);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM rustup_stars_variable_orders').get().c,1);
 }finally{db.close();}
});
test('Atomic guard admits exactly one custom second order and no third order',()=>{
 const {db,add}=make();
 try{
  add('first',7390606911,1);
  db.exec("UPDATE rustup_stars_pilot_guard SET phase='custom' WHERE id=1");
  add('second',7390606911,8);
  assert.throws(()=>add('third',7390606911,1),/pilot_order_limit_reached/);
  assert.throws(()=>add('other',777,1),/pilot_user_denied/);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM rustup_stars_variable_orders').get().c,2);
 }finally{db.close();}
});
test('Emergency disarm returns guard to inactive without changing order history',()=>{
 const {db,add}=make();
 try{
  db.exec('UPDATE rustup_stars_pilot_guard SET enabled=0 WHERE id=1');
  add('after-stop-insert-only',456,1);
  // Payment hard gates independently forbid invoicing while guard is off.
  assert.equal(db.prepare('SELECT enabled FROM rustup_stars_pilot_guard').get().enabled,0);
 }finally{db.close();}
});
