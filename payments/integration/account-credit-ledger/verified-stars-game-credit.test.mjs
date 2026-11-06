import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePaidStarsSettlementOrder,
  independentlyVerifyStarsCharge,
  deliverVerifiedVariableStarsCredit
} from './verified-stars-game-credit.mjs';
const ID='123e4567-e89b-42d3-a456-426614174000';
const paid={
 id:ID,telegram_user_id:12345678,requested_amount_minor:100000,
 price_stars:535,status:'paid',telegram_charge_id:'telegram-charge-12345678',
 paid_at_ms:1794000000000
};
const quote={
 order_id:ID,telegram_user_id:12345678,amount_minor:100000,
 coin_cents:52631,quoted_at_ms:1793999999999
};
const matching={id:paid.telegram_charge_id,amount:535,date:1794000000,
 source:{type:'user',transaction_type:'invoice_payment',
 user:{id:12345678},invoice_payload:'v:'+ID}};
function gateway(transactions){
 let requests=0;
 return {fetchImpl:async (url,options)=>{
  assert.match(url,/getStarTransactions$/);
  assert.equal(options.method,'POST');
  const {offset,limit}=JSON.parse(options.body);
  assert.equal(limit,100);
  requests++;
  const batch=typeof transactions==='function'?transactions(offset):transactions.slice(offset,offset+limit);
  return {ok:true,async json(){return {ok:true,result:{transactions:batch}};}};
 },get calls(){return requests;}};
}
test('valid paid immutable quote binds receipt, account and exact amount',()=>{
 const credit=validatePaidStarsSettlementOrder(paid,quote,ID);
 assert.equal(credit.receipt_id,paid.telegram_charge_id);
 assert.equal(credit.coin_cents,quote.coin_cents);
 assert.equal(credit.telegram_user_id,paid.telegram_user_id);
 assert.equal(Object.isFrozen(credit),true);
 for(const bad of [
  {...paid,status:'pending'}, {...paid,telegram_user_id:2},
  {...paid,telegram_charge_id:null},{...paid,price_stars:0}
 ])assert.throws(()=>validatePaidStarsSettlementOrder(bad,quote,ID));
 for(const bad of [
  null,{...quote,coin_cents:0},{...quote,amount_minor:999},
  {...quote,telegram_user_id:2},{...quote,quoted_at_ms:paid.paid_at_ms+1}
 ])assert.throws(()=>validatePaidStarsSettlementOrder(paid,bad,ID));
});
test('independent Telegram transaction matches charge id, user, invoice and XTR amount',async()=>{
 const g=gateway([matching]);
 const credit=validatePaidStarsSettlementOrder(paid,quote,ID);
 assert.equal(await independentlyVerifyStarsCharge({BOT_TOKEN:'123456789:'+('a'.repeat(25))},
  credit,535,g.fetchImpl),true);
 assert.equal(g.calls,1);
});
test('refund and any mismatched charge evidence block settlement',async()=>{
 const credit=validatePaidStarsSettlementOrder(paid,quote,ID);
 for(const bad of [
  {...matching,amount:534},
  {...matching,receiver:{type:'user'}},
  {...matching,amount:-535},
  {...matching,source:{...matching.source,user:{id:2}}},
  {...matching,source:{...matching.source,invoice_payload:'v:incorrect'}},
  {...matching,source:{...matching.source,transaction_type:'paid_media_payment'}}
 ]){
  const g=gateway([bad]);
  await assert.rejects(()=>independentlyVerifyStarsCharge({BOT_TOKEN:'123456789:'+('a'.repeat(25))},
   credit,535,g.fetchImpl));
 }
});
test('missing or truncated Telegram history never confirms a payment',async()=>{
 const credit=validatePaidStarsSettlementOrder(paid,quote,ID);
 const bot={BOT_TOKEN:'123456789:'+('a'.repeat(25))};
 const absent=gateway([]);
 await assert.rejects(()=>independentlyVerifyStarsCharge(bot,credit,535,absent.fetchImpl),
  /charge_unconfirmed/);
 const unverified=gateway((offset)=>Array.from({length:100},(_,n)=>(
  offset===0&&n===0?matching:{
   id:'other-charge-'+offset+'-'+n,amount:1,
   source:{type:'user',user:{id:999},transaction_type:'invoice_payment',
   invoice_payload:'other'}
  })));
 await assert.rejects(()=>independentlyVerifyStarsCharge(bot,credit,535,unverified.fetchImpl),
  /transaction_history_incomplete/);
 assert.equal(unverified.calls,20);
});
test('game balance settlement remains fail-closed even with a valid order ID',async()=>{
 await assert.rejects(
  ()=>deliverVerifiedVariableStarsCredit({STARS_GAME_CREDIT_SETTLEMENT_ENABLED:'false'},ID),
  /settlement_disabled/
 );
});


test('same Telegram charge ID appears as both payment and refund: never settle',async()=>{
 const credit=validatePaidStarsSettlementOrder(paid,quote,ID);
 const refund={id:paid.telegram_charge_id,amount:-535,
  receiver:{type:'user',user:{id:paid.telegram_user_id}},date:1794000500};
 const token={BOT_TOKEN:'123456789:'+('a'.repeat(25))};
 for(const history of [
  [matching,refund],
  [refund,matching],
  [...Array.from({length:100},(_,i)=>i===0?matching:{
   id:'other-charge-'+i,amount:1,source:{type:'user',
    transaction_type:'invoice_payment',user:{id:999},
    invoice_payload:'unrelated'}}),refund]
 ]){
  await assert.rejects(
   ()=>independentlyVerifyStarsCharge(
    token,credit,535,gateway(history).fetchImpl),
   /stars_charge_refunded_manual_review/
  );
 }
});

test('Telegram may omit optional invoice payload in history when the authenticated webhook already bound charge to order',async()=>{
 const credit=validatePaidStarsSettlementOrder(paid,quote,ID);
 const withoutPayload={...matching,source:{...matching.source}};
 delete withoutPayload.source.invoice_payload;
 assert.equal(await independentlyVerifyStarsCharge(
  {BOT_TOKEN:'123456789:'+('a'.repeat(25))},credit,535,
  gateway([withoutPayload]).fetchImpl),true);
 for(const altered of [
  {...withoutPayload,amount:534},
  {...withoutPayload,id:'other-charge'},
  {...withoutPayload,source:{...withoutPayload.source,user:{id:123}}},
  {...withoutPayload,source:{...withoutPayload.source,invoice_payload:'v:wrong'}}
 ])await assert.rejects(()=>independentlyVerifyStarsCharge(
  {BOT_TOKEN:'123456789:'+('a'.repeat(25))},credit,535,
  gateway([altered]).fetchImpl));
});
