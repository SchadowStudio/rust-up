import test from 'node:test';
import assert from 'node:assert/strict';
import {
 validTestReceipt,validTestPrecheckout,safeTestStateTransition,
 validTestDeliveryAck,testRefundPayload,telegramTestApi,completeTelegramStarsTest,
 verifyTelegramTestBot
} from './telegram-stars-test-env.mjs';
const ID='53e41abc-7696-4da9-8f1d-95b5409e3841';
const TOKEN='123456789:'+'X'.repeat(35);
const basic={
 testOnly:true,orderId:ID,telegramUserId:123456,priceStars:37,
 status:'invoice_created',chargeId:null
};
const pre={pre_checkout_query:{
 id:'q-test-001',invoice_payload:'test_rustup_'+ID,
 from:{id:123456},total_amount:37,currency:'XTR'
}};
const paid={message:{from:{id:123456},successful_payment:{
 invoice_payload:'test_rustup_'+ID,total_amount:37,currency:'XTR',
 telegram_payment_charge_id:'test-charge-abcdefghijklmnopqrstuvwxyz'
}}};
test('precheckout requires exact test user, XTR, amount and order id',()=>{
 assert.equal(validTestPrecheckout(basic,pre),true);
 assert.equal(validTestPrecheckout(basic,{pre_checkout_query:{
  ...pre.pre_checkout_query,total_amount:38}}),false);
 assert.equal(validTestPrecheckout(basic,{pre_checkout_query:{
  ...pre.pre_checkout_query,from:{id:654321}}}),false);
 assert.equal(validTestPrecheckout(basic,{pre_checkout_query:{
  ...pre.pre_checkout_query,currency:'RUB'}}),false);
 assert.equal(validTestPrecheckout(basic,{pre_checkout_query:{
  ...pre.pre_checkout_query,invoice_payload:'test_rustup_other'}}),false);
});
test('only one Telegram precheckout query may reserve a test invoice',()=>{
 const approved={...safeTestStateTransition(basic,'precheckout'),
  checkoutQueryId:pre.pre_checkout_query.id};
 assert.equal(validTestPrecheckout(approved,pre),true);
 assert.equal(validTestPrecheckout(approved,{pre_checkout_query:{
  ...pre.pre_checkout_query,id:'different-request'}}),false);
});
test('receipt and delivery verified once; no game wallet changes',()=>{
 let current=safeTestStateTransition(basic,'precheckout');
 assert.equal(validTestReceipt(current,paid),true);
 assert.equal(validTestReceipt(current,{message:{...paid.message,successful_payment:{
  ...paid.message.successful_payment,total_amount:370
 }}}),false);
 assert.equal(validTestReceipt(current,{message:{
  ...paid.message,from:{id:654321}}}),false);
 current=safeTestStateTransition(current,'paid');
 current={...current,chargeId:paid.message.successful_payment.telegram_payment_charge_id};
 assert.equal(validTestReceipt(current,paid),true);
 current=safeTestStateTransition(current,'delivery');
 assert.equal(current.status,'delivered');
 assert.equal(validTestReceipt(current,paid),true);
 assert.equal(validTestReceipt(current,{message:{...paid.message,successful_payment:{
  ...paid.message.successful_payment,telegram_payment_charge_id:'other-charge'
 }}}),false);
 assert.equal(safeTestStateTransition(current,'delivery').status,'delivered');
 assert.equal(Object.hasOwn(current,'gameBalance'),false);
});
test('refund requires confirmed delivery and cannot execute twice',()=>{
 assert.throws(()=>safeTestStateTransition(basic,'refund_intent'),
  /invalid_test_state_transition/);
 const order={...basic,status:'delivered'};
 const reserved=safeTestStateTransition(order,'refund_intent');
 assert.equal(reserved.status,'refund_pending');
 assert.throws(()=>safeTestStateTransition(reserved,'refund_intent'),
  /invalid_test_state_transition/);
 const refunded=safeTestStateTransition(reserved,'refund_complete');
 assert.equal(refunded.status,'refunded');
 assert.equal(safeTestStateTransition(refunded,'refund_complete'),refunded);
 assert.throws(()=>safeTestStateTransition(refunded,'refund_intent'),
  /invalid_test_state_transition/);
});
test('uncertain refund routes to manual review and prevents another request',()=>{
 const state=safeTestStateTransition({...basic,status:'refund_pending'},'manual_review');
 assert.equal(state.status,'manual_review');
 assert.throws(()=>safeTestStateTransition(state,'refund_complete'),
  /invalid_test_state_transition/);
});
test('only Telegram test Bot API methods are called, never production',async()=>{
 const calls=[];
 const fake=async(url,req)=>{
  calls.push(url);
  assert.match(url,/^https:\/\/api\.telegram\.org\/bot[0-9]+:[A-Za-z0-9_-]+\/test\//);
  const method=url.split('/').at(-1);
  return {ok:true,async json(){return {ok:true,result:method==='getMe'
   ?{is_bot:true,id:123456,username:'demo_test_bot'}:{url:''}};}};
 };
 const result=await verifyTelegramTestBot(TOKEN,fake);
 assert.equal(result.testEnvironment,true);
 assert.equal(calls.length,2);
 assert.equal(calls.every(x=>x.includes('/test/')),true);
});
test('test runner rejects webhook-bound bots and malformed identities',async()=>{
 const fake=async(url)=>({ok:true,async json(){return {ok:true,result:
  url.endsWith('/getMe')?{is_bot:true,id:1234}:{url:'https://other.invalid/hook'}
 };}});
 await assert.rejects(()=>verifyTelegramTestBot(TOKEN,fake),/must_not_have_webhook/);
 await assert.rejects(()=>verifyTelegramTestBot('production-secret',fake),
  /TELEGRAM_TEST_BOT_TOKEN_invalid/);
});

test('test delivery counts only with Telegram message ID for matching user',()=>{
 const order={...basic,status:'paid'};
 assert.equal(validTestDeliveryAck(order,{message_id:987,
  chat:{id:order.telegramUserId}}),true);
 assert.equal(validTestDeliveryAck(order,{message_id:987,
  chat:{id:999999}}),false);
 assert.equal(validTestDeliveryAck(order,{message_id:0,
  chat:{id:order.telegramUserId}}),false);
 assert.equal(validTestDeliveryAck({...order,status:'invoice_created'},{
  message_id:987,chat:{id:order.telegramUserId}}),false);
});
test('test refund payload is bound to delivered receipt and exact confirmation',()=>{
 const delivered={...basic,status:'delivered',
  chargeId:'test-charge-abcdefghijklmnopqrstuvwxyz'};
 const payload=testRefundPayload(delivered,'REFUND TEST '+ID);
 assert.deepEqual(payload,{
  user_id:123456,telegram_payment_charge_id:delivered.chargeId
 });
 assert.throws(()=>testRefundPayload({...delivered,status:'paid'},
  'REFUND TEST '+ID),/no_verified_delivered_test_order/);
 assert.throws(()=>testRefundPayload(delivered,'REFUND TEST incorrect'),
  /explicit_refund_confirmation_required/);
 assert.throws(()=>testRefundPayload({...delivered,testOnly:false},
  'REFUND TEST '+ID),/no_verified_delivered_test_order/);
});

test('mock test-network refund and delivery calls never reach production API',async()=>{
 const requests=[];
 const fake=async(url,options)=>{
  assert.match(url,/^https:\/\/api\.telegram\.org\/bot[0-9]+:[A-Za-z0-9_-]+\/test\/(?:sendMessage|refundStarPayment)$/);
  assert.equal(options.method,'POST');
  const body=JSON.parse(options.body);
  requests.push({url,body});
  return {ok:true,async json(){return {ok:true,result:url.endsWith('refundStarPayment')
   ?true:{message_id:1234,chat:{id:123456}}};}};
 };
 const msg=await telegramTestApi(TOKEN,'sendMessage',{
  chat_id:123456,text:'TEST ONLY RECEIPT'
 },fake);
 assert.equal(msg.message_id,1234);
 const result=await telegramTestApi(TOKEN,'refundStarPayment',{
  user_id:123456,telegram_payment_charge_id:'test-charge-abcdefghijklmnopqrstuvwxyz'
 },fake);
 assert.equal(result,true);
 assert.equal(requests.length,2);
 assert.equal(requests.every(x=>x.url.includes('/test/')),true);
 await assert.rejects(()=>telegramTestApi(TOKEN,'setWebhook',{},fake),
  /unapproved_test_bot_method/);
});

test('full TEST invoice-delivery-refund automation is one-use and strictly TEST-only',async()=>{
 const token=TOKEN,seen=[],invoice='https://t.me/$RUSTUPtest_invoicelink_123';
 const result=await completeTelegramStarsTest(token,'123456',7,{
  create:async(t,user,stars)=>{
   assert.equal(t,token);assert.equal(user,'123456');assert.equal(stars,7);
   seen.push('invoice');
   return {testOnly:true,orderId:ID,invoiceUrl:invoice};
  },
  poll:async(t,fetchImpl,seconds)=>{
   assert.equal(t,token);assert.equal(seconds,0);
   seen.push('poll');
   return {testOnly:true,status:seen.filter(x=>x==='poll').length===2
    ?'delivered':'precheckout_approved',
    testReceiptDelivered:seen.filter(x=>x==='poll').length===2};
  },
  refundConfirmed:async(t,phrase)=>{
   assert.equal(t,token);assert.equal(phrase,'REFUND TEST '+ID);
   seen.push('refund');
   return {testOnly:true,status:'refunded'};
  },
  announce:(message)=>{seen.push(message)},maxPolls:3,pollSeconds:0
 });
 assert.equal(result.testOnly,true);
 assert.equal(result.refundVerified,true);
 assert.equal(result.gameBalanceChanged,false);
 assert.equal(seen.filter(x=>x==='refund').length,1);
 assert.equal(seen.filter(x=>x==='poll').length,2);
});
test('no refund if test invoice is unverified or no payment arrived',async()=>{
 let refunded=0;
 const base={create:async()=>({testOnly:true,orderId:ID,
  invoiceUrl:'https://t.me/$Safe_TEST_AAAAAA'}),
  refundConfirmed:async()=>{refunded++;throw Error('should never refund');},
  announce:()=>{},maxPolls:2,pollSeconds:0};
 await assert.rejects(
  ()=>completeTelegramStarsTest(TOKEN,'123456',7,{
   ...base,poll:async()=>({testOnly:true,status:'pending',
    testReceiptDelivered:false})}),
  /test_payment_not_completed_no_refund_attempted/
 );
 await assert.rejects(
  ()=>completeTelegramStarsTest(TOKEN,'123456',7,{
   ...base,poll:async()=>({testOnly:true,status:'manual_review',
    testReceiptDelivered:false})}),
  /test_receipt_requires_manual_review/
 );
 await assert.rejects(
  ()=>completeTelegramStarsTest(TOKEN,'123456',7,{
   ...base,create:async()=>({testOnly:false,orderId:ID,
    invoiceUrl:'https://t.me/$Safe_TEST_AAAAAA'})}),
  /invalid_test_only_invoice/
 );
 assert.equal(refunded,0);
});
