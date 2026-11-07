import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {applySimulatedStarsOrder,inspectSimulatedStarsOrder}
 from './simulated-stars-settlement.mjs';
import {getDemoWallet} from './ledger.mjs';
const id='123e4567-e89b-42d3-a456-426614174000';
const USER=123456789;
const paid={
 id,telegram_user_id:USER,requested_amount_minor:15000,
 price_stars:50,status:'paid',
 invoice_url:'https://t.me/$demo-verified-invoice',
 telegram_charge_id:'demo-only:simulation-abc12345',
 paid_at_ms:1793800000000
};
function dbAdapter(sql){
 const query=(code,args=[])=>{
  const st=sql.prepare(code);
  return {
   async first(){return st.get(...args)||null;},
   async all(){return {results:st.all(...args)};},
   async run(){return {meta:{changes:st.run(...args).changes}};}
  };
 };
 return {
  prepare(code){return {
   bind(...args){return query(code,args)},
   first(){return query(code).first()},
   all(){return query(code).all()},
   run(){return query(code).run()}
  }},
  async batch(statements){
   sql.exec('BEGIN IMMEDIATE');
   try{
    const results=[];
    for(const st of statements)results.push(await st.run());
    sql.exec('COMMIT');
    return results;
   }catch(e){sql.exec('ROLLBACK');throw e;}
  }
 };
}
function fixture(){
 const stars=new DatabaseSync(':memory:');
 stars.exec('CREATE TABLE rustup_stars_variable_orders('+
  'id TEXT PRIMARY KEY,telegram_user_id INTEGER,requested_amount_minor INTEGER,'+
  'price_stars INTEGER,status TEXT,invoice_url TEXT,telegram_charge_id TEXT,paid_at_ms INTEGER)');
 const w=new DatabaseSync(':memory:');
 w.exec(fs.readFileSync(new URL('./migration.sql',import.meta.url),'utf8'));
 const insert=p=>{
  stars.prepare('INSERT OR REPLACE INTO rustup_stars_variable_orders '+
   '(id,telegram_user_id,requested_amount_minor,price_stars,status,'+
   'invoice_url,telegram_charge_id,paid_at_ms) VALUES(?,?,?,?,?,?,?,?)')
   .run(p.id,p.telegram_user_id,p.requested_amount_minor,p.price_stars,p.status,
    p.invoice_url,p.telegram_charge_id,p.paid_at_ms);
 };
 return {insert,starsDb:dbAdapter(stars),demoDb:dbAdapter(w),
  close(){stars.close();w.close()}};
}
async function sandbox(run){
 const a=process.env.LOCAL_PAYMENTS_TEST_ONLY;
 const b=process.env.RUSTUP_REAL_PAYMENTS_DISABLED;
 const c=process.env.NODE_ENV;
 process.env.LOCAL_PAYMENTS_TEST_ONLY='1';
 process.env.RUSTUP_REAL_PAYMENTS_DISABLED='true';
 process.env.NODE_ENV='test';
 try{return await run();}
 finally{
  for(const [key,value] of [
   ['LOCAL_PAYMENTS_TEST_ONLY',a],
   ['RUSTUP_REAL_PAYMENTS_DISABLED',b],
   ['NODE_ENV',c]
  ])if(value===undefined)delete process.env[key];else process.env[key]=value;
 }
}
test('paid simulated Stars receipt applies exactly one nonredeemable demo balance',()=>sandbox(async()=>{
 const f=fixture();
 try{
  f.insert(paid);
  const first=await applySimulatedStarsOrder(f.starsDb,f.demoDb,id);
  assert.equal(first.applied,true);
  assert.equal(first.balanceUnits,15000);
  assert.equal(first.gameStakesAllowed,false);
  assert.equal(first.withdrawable,false);
  const replay=await applySimulatedStarsOrder(f.starsDb,f.demoDb,id);
  assert.equal(replay.duplicate,true);
  assert.equal(replay.balanceUnits,15000);
  const history=await getDemoWallet(f.demoDb,USER);
  assert.equal(history.history.length,1);
  assert.equal(history.simulated,true);
 }finally{f.close();}
}));
test('pending, refunded, forged, or unauthenticated receipts never add demo points',()=>sandbox(async()=>{
 const f=fixture();
 try{
  for(const mutation of [
   {status:'pending'},
   {status:'refunded'},
   {telegram_charge_id:'real-charge-unknown'},
   {requested_amount_minor:1000001},
   {invoice_url:'https://evil.example'},
   {paid_at_ms:0}
  ]){
   f.insert({...paid,...mutation});
   await assert.rejects(
    ()=>applySimulatedStarsOrder(f.starsDb,f.demoDb,id),
    /paid_simulation_order_not_verified/);
  }
  assert.equal((await getDemoWallet(f.demoDb,USER)).balanceUnits,0);
 }finally{f.close();}
}));
test('simulated Stars settlement cannot run unless both local-only guard flags are set',async()=>{
 const s=process.env.LOCAL_PAYMENTS_TEST_ONLY;
 const d=process.env.RUSTUP_REAL_PAYMENTS_DISABLED;
 try{
  delete process.env.LOCAL_PAYMENTS_TEST_ONLY;
  delete process.env.RUSTUP_REAL_PAYMENTS_DISABLED;
  assert.throws(()=>inspectSimulatedStarsOrder(paid),
   /demo_settlement_must_never_run_with_live_payments/);
 }finally{
  if(s===undefined)delete process.env.LOCAL_PAYMENTS_TEST_ONLY;
  else process.env.LOCAL_PAYMENTS_TEST_ONLY=s;
  if(d===undefined)delete process.env.RUSTUP_REAL_PAYMENTS_DISABLED;
  else process.env.RUSTUP_REAL_PAYMENTS_DISABLED=d;
 }
});
