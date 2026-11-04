import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {applyDemoWalletEvent,simulateDeposit,simulateGameSpend,simulateRefund,getDemoWallet} from './ledger.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const USER=7656119;
function setup(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(fs.readFileSync(path.join(here,'migration.sql'),'utf8'));
 function prepared(query,args=[]){
  const s=sql.prepare(query);
  return {
   async first(){return s.get(...args)||null;},
   async all(){return {results:s.all(...args)};},
   async run(){return {meta:{changes:s.run(...args).changes}};}
  };
 }
 const db={
  prepare(query){return {
   bind(...args){return prepared(query,args)},
   first(){return prepared(query).first()},
   all(){return prepared(query).all()},
   run(){return prepared(query).run()}
  }},
  async batch(statements){
   sql.exec('BEGIN IMMEDIATE');
   try{
    const results=[];
    for(const statement of statements)results.push(await statement.run());
    sql.exec('COMMIT');
    return results;
   }catch(e){sql.exec('ROLLBACK');throw e;}
  }
 };
 return {db,sql,close(){sql.close()}};
}
test('Stars and crypto demo credits share one immutable, nonredeemable balance',async()=>{
 const {db,close}=setup();
 try{
  const first=await simulateDeposit(db,{userId:USER,channel:'stars',reference:'stars:invoice:000001',units:120});
  assert.equal(first.applied,true);
  assert.equal(first.balanceUnits,120);
  assert.equal(first.withdrawable,false);
  assert.equal(first.redeemable,false);
  assert.equal(first.gameStakesAllowed,false);
  const crypto=await simulateDeposit(db,{userId:USER,channel:'crypto',reference:'crypto:invoice:000001',units:80});
  assert.equal(crypto.balanceUnits,200);
  assert.equal(crypto.history.length,2);
  assert.equal(crypto.history.filter(x=>x.status==='applied').length,2);
  const replay=await simulateDeposit(db,{userId:USER,channel:'stars',reference:'stars:invoice:000001',units:120});
  assert.equal(replay.duplicate,true);
  assert.equal(replay.balanceUnits,200);
  await assert.rejects(()=>simulateDeposit(db,{userId:USER+1,channel:'stars',reference:'stars:invoice:000001',units:120}),/reference_conflict/);
  await assert.rejects(()=>simulateDeposit(db,{userId:USER,channel:'stars',reference:'stars:invoice:000001',units:200}),/reference_conflict/);
  assert.equal((await getDemoWallet(db,USER+1)).balanceUnits,0);
 }finally{close();}
});
test('demo game spend is idempotent and overdrafts never subtract funds later',async()=>{
 const {db,close}=setup();
 try{
  await simulateDeposit(db,{userId:USER,channel:'stars',reference:'stars:invoice:000002',units:70});
  const spent=await simulateGameSpend(db,{userId:USER,reference:'demo:game:000000001',units:60});
  assert.equal(spent.balanceUnits,10);
  assert.equal((await simulateGameSpend(db,{userId:USER,reference:'demo:game:000000001',units:60})).balanceUnits,10);
  await assert.rejects(()=>simulateGameSpend(db,{userId:USER,reference:'demo:game:000000002',units:20}),/insufficient/);
  await simulateDeposit(db,{userId:USER,channel:'crypto',reference:'crypto:invoice:000002',units:50});
  // A previously rejected overspend is not secretly executed later.
  await assert.rejects(()=>simulateGameSpend(db,{userId:USER,reference:'demo:game:000000002',units:20}),/requires_review/);
  assert.equal((await getDemoWallet(db,USER)).balanceUnits,60);
 }finally{close();}
});
test('refund is one-time and cannot push a demo balance negative',async()=>{
 const {db,close}=setup();
 try{
  await simulateDeposit(db,{userId:USER,channel:'crypto',reference:'crypto:invoice:000003',units:30});
  await simulateDeposit(db,{userId:USER,channel:'stars',reference:'stars:invoice:000003',units:40});
  const refunded=await simulateRefund(db,{source:'demo_crypto',reference:'crypto:invoice:000003'});
  assert.equal(refunded.balanceUnits,40);
  const repeated=await simulateRefund(db,{source:'demo_crypto',reference:'crypto:invoice:000003'});
  assert.equal(repeated.duplicate,true);
  assert.equal(repeated.balanceUnits,40);
  await simulateGameSpend(db,{userId:USER,reference:'demo:game:000000003',units:30});
  await assert.rejects(()=>simulateRefund(db,{source:'demo_stars',reference:'stars:invoice:000003'}),/insufficient/);
  assert.equal((await getDemoWallet(db,USER)).balanceUnits,10);
 }finally{close();}
});
test('sandbox source validation rejects unverified real payment formats',async()=>{
 const {db,close}=setup();
 try{
  await assert.rejects(()=>applyDemoWalletEvent(db,{
   userId:USER,source:'stars',reference:'live:payment:001',delta:100}),/invalid_sandbox_event/);
  await assert.rejects(()=>applyDemoWalletEvent(db,{
   userId:USER,source:'crypto',reference:'real:onchain:001',delta:100}),/invalid_sandbox_event/);
  await assert.rejects(()=>simulateDeposit(db,{userId:USER,channel:'unknown',reference:'demo:fake:001',units:100}),/invalid_demo_deposit/);
  await assert.rejects(()=>simulateGameSpend(db,{userId:USER,reference:'demo:fake:002',units:0}),/invalid_demo_spend/);
 }finally{close();}
});
test('simultaneous same-reference demo credits settle at most once',async()=>{
 const {db,sql,close}=setup();
 try{
  const args={userId:USER,channel:'stars',reference:'stars:invoice:parallel01',units:125};
  const [a,b]=await Promise.all([simulateDeposit(db,args),simulateDeposit(db,args)]);
  assert.equal(a.applied||b.applied,true);
  assert.equal((await getDemoWallet(db,USER)).balanceUnits,125);
  const total=sql.prepare("SELECT COUNT(*) AS n FROM rustup_demo_wallet_events WHERE source='demo_stars'").get().n;
  assert.equal(total,1);
 }finally{close();}
});
