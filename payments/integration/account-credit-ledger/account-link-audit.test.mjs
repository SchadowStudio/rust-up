import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectRecordedStarsAccountLink} from './account-link-audit.mjs';
const id='123e4567-e89b-42d3-a456-426614174000';
const paid={
 id,telegram_user_id:123456789,requested_amount_minor:15000,
 price_stars:50,status:'paid',telegram_charge_id:'telegram-charge-1',
 paid_at_ms:1793800000000
};
function fixture(order=paid,account={id:123456789,v:3,state:'{"balance":500,"items":[]}'}) {
 let reads=0;
 const paymentDb={
  prepare(sql){
   assert.match(sql,/FROM rustup_stars_variable_orders WHERE id=\?/);
   return {bind(requested){
    assert.equal(requested,id);
    return {async first(){reads++;return order;}};
   }};
  }
 };
 const gameDb={
  prepare(sql){
   assert.equal(sql,'SELECT id,state,v FROM accounts WHERE id=?');
   return {bind(requested){
    assert.equal(requested,paid.telegram_user_id);
    return {async first(){reads++;return account;}};
   }};
  }
 };
 return {paymentDb,gameDb,get reads(){return reads;}};
}
test('a recorded Stars payment maps to the canonical account without changing balance',async()=>{
 const f=fixture();
 const x=await inspectRecordedStarsAccountLink(f.paymentDb,f.gameDb,id);
 assert.equal(x.accountMatched,true);
 assert.equal(x.accountId,paid.telegram_user_id);
 assert.equal(x.priceStars,50);
 assert.equal(x.requestedAmountMinor,15000);
 assert.equal(x.creditedToGame,false);
 assert.equal(x.independentlyVerifiedTelegramReceipt,false);
 assert.equal(x.readOnly,true);
 assert.equal(f.reads,2);
 assert.equal((await inspectRecordedStarsAccountLink(f.paymentDb,f.gameDb,id)).accountId,paid.telegram_user_id);
});
test('never infer a player account from an untrusted UI balance or mismatched identity',async()=>{
 for(const account of [
  null,
  {id:7654321,v:1,state:'{"balance":500}'},
  {id:123456789,v:-1,state:'{"balance":500}'},
  {id:123456789,v:1,state:'{"balance":-5}'},
  {id:123456789,v:1,state:'{"balance":"500"}'},
  {id:123456789,v:1,state:'bad json'}
 ]) {
  const f=fixture(paid,account);
  await assert.rejects(
   ()=>inspectRecordedStarsAccountLink(f.paymentDb,f.gameDb,id),
   /game_account_not_found|mismatch|account_version_invalid|account_balance_not_safe_for_credit|account_state_invalid/
  );
 }
});
test('reject incomplete or unpaid transaction records instead of crediting',async()=>{
 for(const patch of [
  {status:'pending'},{status:'refunded'},
  {telegram_charge_id:null},{paid_at_ms:0},
  {telegram_user_id:0},{requested_amount_minor:0},
  {price_stars:0}
 ]){
  const f=fixture({...paid,...patch});
  await assert.rejects(
   ()=>inspectRecordedStarsAccountLink(f.paymentDb,f.gameDb,id),
   /payment_order_not_sufficiently_recorded/
  );
 }
});
test('invalid order id rejected before any database read',async()=>{
 const f=fixture();
 await assert.rejects(
  ()=>inspectRecordedStarsAccountLink(f.paymentDb,f.gameDb,'../../untrusted'),
  /invalid_account_link_request/);
 assert.equal(f.reads,0);
});
