import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {issueVariableStarsRefund} from './variable-refunds.mjs';

function setup(){
 const raw=new DatabaseSync(':memory:');
 raw.exec(readFileSync(new URL('./variable-migration.sql',import.meta.url),'utf8'));
 raw.exec(readFileSync(new URL('./variable-refunds-migration.sql',import.meta.url),'utf8'));
 const id=randomUUID(),uid=123456789,admin=12345;
 const paidAt=Date.now()-1000;
 raw.prepare(
  'INSERT INTO rustup_stars_variable_orders '+
  '(id,telegram_user_id,client_request_id,requested_amount_minor,price_stars,'+
  'rate_num,rate_den,status,created_at_ms,expires_at_ms,paid_at_ms,telegram_charge_id) '+
  "VALUES (?,?,?,?,?,?,?,'paid',?,?,?,?)"
 ).run(id,uid,randomUUID(),5000,25,200,1,
   paidAt-120000,paidAt+780000,paidAt,'charge-test-1');
 const query=(sql,args=[])=>{
  const st=raw.prepare(sql);
  return {
   async first(){return st.get(...args)||null;},
   async run(){return {meta:{changes:st.run(...args).changes}};}
  };
 };
 const db={
  prepare(sql){return{bind(...args){return query(sql,args)}};},
  async batch(statements){
   raw.exec('BEGIN IMMEDIATE');
   try{
    const results=[];
    for(const stmt of statements)results.push(await stmt.run());
    raw.exec('COMMIT');
    return results;
   }catch(e){raw.exec('ROLLBACK');throw e;}
  }
 };
 return {
  id,uid,admin,raw,db,
  env:{STARS_REFUNDS_ENABLED:'true',PAYMENT_ADMIN_IDS:String(admin),
    BOT_TOKEN:'123456789:'+'a'.repeat(35),PAYMENTS_DB:db},
  args:{adminId:admin,orderId:id,confirmation:'REFUND '+id},
  close(){raw.close();}
 };
}
function mockTelegram({reject=false,throwError=false}={}){
 const calls=[];
 const fetchImpl=async(url,options)=>{
  const body=JSON.parse(options.body);
  calls.push({url,body});
  if(throwError)throw Error('network_closed_after_request');
  return {ok:true,async json(){return {ok:true,result:!reject}}};
 };
 return {calls,fetchImpl};
}
test('variable Stars refund is blocked without operator approval or explicit confirmation',async()=>{
 const f=setup();
 try{
  await assert.rejects(
   ()=>issueVariableStarsRefund({...f.env,STARS_REFUNDS_ENABLED:'false'},f.args),
   /variable_refunds_disabled/);
  await assert.rejects(
   ()=>issueVariableStarsRefund(f.env,{...f.args,adminId:999}),
   /finance_admin_required/);
  await assert.rejects(
   ()=>issueVariableStarsRefund(f.env,{...f.args,confirmation:'CONFIRM'}),
   /explicit_confirmation_required/);
  assert.equal(f.raw.prepare('SELECT COUNT(*) AS c FROM rustup_stars_variable_refund_intents').get().c,0);
 }finally{f.close();}
});
test('operator-approved refund calls Telegram once and updates only isolated payment tables',async()=>{
 const f=setup(),tg=mockTelegram();
 try{
  const answer=await issueVariableStarsRefund(f.env,{
   ...f.args,fetchImpl:tg.fetchImpl});
  assert.equal(answer.ok,true);
  assert.equal(answer.status,'refunded');
  assert.equal(answer.gameBalanceChanged,false);
  assert.equal(answer.gameCreditReversalNotImplemented,true);
  assert.equal(tg.calls.length,1);
  assert.ok(tg.calls[0].url.endsWith('/refundStarPayment'));
  assert.equal(tg.calls[0].body.user_id,f.uid);
  assert.equal(tg.calls[0].body.telegram_payment_charge_id,'charge-test-1');
  assert.equal(f.raw.prepare('SELECT status FROM rustup_stars_variable_orders WHERE id=?')
   .get(f.id).status,'refunded');
  assert.equal(f.raw.prepare('SELECT state FROM rustup_stars_variable_refund_intents WHERE order_id=?')
   .get(f.id).state,'completed');
  await assert.rejects(()=>issueVariableStarsRefund(f.env,{
   ...f.args,fetchImpl:tg.fetchImpl}),/order_not_paid_or_unverified/);
  assert.equal(tg.calls.length,1);
 }finally{f.close();}
});
test('gateway timeout is quarantined; retry never sends a second external refund',async()=>{
 const f=setup(),tg=mockTelegram({throwError:true});
 try{
  await assert.rejects(()=>issueVariableStarsRefund(f.env,{
   ...f.args,fetchImpl:tg.fetchImpl}),/gateway_uncertain_manual_review/);
  assert.equal(f.raw.prepare('SELECT state FROM rustup_stars_variable_refund_intents')
   .get().state,'manual_review');
  assert.equal(f.raw.prepare('SELECT status FROM rustup_stars_variable_orders')
   .get().status,'paid');
  await assert.rejects(()=>issueVariableStarsRefund(f.env,{
   ...f.args,fetchImpl:tg.fetchImpl}),/already_reserved_manual_review/);
  assert.equal(tg.calls.length,1);
 }finally{f.close();}
});
test('failed Telegram refund is quarantined without writing a game credit',async()=>{
 const f=setup(),tg=mockTelegram({reject:true});
 try{
  await assert.rejects(()=>issueVariableStarsRefund(f.env,{
   ...f.args,fetchImpl:tg.fetchImpl}),/rejected_manual_review/);
  assert.equal(f.raw.prepare('SELECT state FROM rustup_stars_variable_refund_intents')
   .get().state,'manual_review');
  assert.equal(f.raw.prepare('SELECT status FROM rustup_stars_variable_orders')
   .get().status,'paid');
  assert.equal(tg.calls.length,1);
 }finally{f.close();}
});
