// RUST UP Telegram Stars END-TO-END TEST ENVIRONMENT ONLY.
// NEVER calls production Bot API (always /test/), the live RUST UP Worker,
// game accounts, real-money balances, or crypto gateways.
// This tool checks a variable Stars invoice, paid receipt, delivery acknowledgement,
// then operator-confirmed refund through Telegram's separate test environment.
// A separate TEST bot and TEST Telegram account are required.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const TEST_DIR=path.join(ROOT,'.private','telegram-stars-e2e-test');
const STATE_FILE=path.join(TEST_DIR,'test-state.json');
const TOKEN=/^[0-9]{4,15}:[A-Za-z0-9_-]{20,}$/;
const ID=/^[1-9]\d{0,15}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validTestReceipt(order,update){
 const msg=update?.message,paid=msg?.successful_payment;
 return !!order&&order.testOnly===true&&!!paid&&
  (['precheckout_approved','paid','delivered'].includes(order.status))&&
  order.orderId===String(paid.invoice_payload||'').replace(/^test_rustup_/,'')&&
  paid.currency==='XTR'&&paid.total_amount===order.priceStars&&
  msg.from?.id===order.telegramUserId&&
  typeof paid.telegram_payment_charge_id==='string'&&
  paid.telegram_payment_charge_id.length>=8&&
  paid.telegram_payment_charge_id.length<=256&&
  (!order.chargeId||order.chargeId===paid.telegram_payment_charge_id);
}
export function validTestPrecheckout(order,update){
 const q=update?.pre_checkout_query;
 return !!q&&!!order&&order.testOnly===true&&
  (order.status==='invoice_created'||order.status==='precheckout_approved')&&
  (order.status!=='precheckout_approved'||order.checkoutQueryId===q.id)&&
  q.invoice_payload==='test_rustup_'+order.orderId&&
  q.currency==='XTR'&&q.total_amount===order.priceStars&&
  q.from?.id===order.telegramUserId;
}
export function safeTestStateTransition(order,event){
 if(!order||order.testOnly!==true||!UUID.test(order.orderId))throw Error('invalid_test_order');
 if(event==='precheckout'){
  if(order.status==='invoice_created')return {...order,status:'precheckout_approved'};
  if(order.status==='precheckout_approved')return order;
 }else if(event==='paid'){
  if(order.status==='precheckout_approved')return {...order,status:'paid'};
  if(order.status==='paid'||order.status==='delivered')return order;
 }else if(event==='delivery'){
  if(order.status==='paid')return {...order,status:'delivered'};
  if(order.status==='delivered')return order;
 }else if(event==='refund_intent'){
  if(order.status==='delivered')return {...order,status:'refund_pending'};
 }else if(event==='refund_complete'){
  if(order.status==='refund_pending')return {...order,status:'refunded'};
  if(order.status==='refunded')return order;
 }else if(event==='manual_review'){
  if(order.status==='refund_pending')return {...order,status:'manual_review'};
 }
 throw Error('invalid_test_state_transition_'+event);
}
export async function telegramTestApi(token,method,body={},fetchImpl=fetch){
 if(!TOKEN.test(token||''))throw Error('TELEGRAM_TEST_BOT_TOKEN_invalid');
 if(!/^(getMe|getWebhookInfo|createInvoiceLink|getUpdates|answerPreCheckoutQuery|sendMessage|refundStarPayment)$/.test(method))
  throw Error('unapproved_test_bot_method');
 const url='https://api.telegram.org/bot'+token+'/test/'+method;
 const response=await fetchImpl(url,{
  method:'POST',redirect:'error',
  headers:{'content-type':'application/json'},
  body:JSON.stringify(body),signal:AbortSignal.timeout(20000)
 });
 if(!response.ok)throw Error('test_bot_api_http_'+response.status);
 const obj=await response.json();
 if(obj?.ok!==true)throw Error('test_bot_api_'+method+'_failed');
 return obj.result;
}
export async function verifyTelegramTestBot(token,fetchImpl=fetch){
 const bot=await telegramTestApi(token,'getMe',{},fetchImpl);
 if(bot?.is_bot!==true||!Number.isSafeInteger(bot.id))
  throw Error('test_bot_identity_invalid');
 const info=await telegramTestApi(token,'getWebhookInfo',{},fetchImpl);
 if(typeof info?.url!=='string'||info.url.length)
  throw Error('test_bot_must_not_have_webhook');
 return {ok:true,testEnvironment:true,username:bot.username};
}
async function readState(){
 try{return JSON.parse(await fs.readFile(STATE_FILE,'utf8'));}
 catch(e){
  if(e?.code==='ENOENT')return null;
  throw Error('private_test_state_corrupt_or_unreadable');
 }
}
async function writeState(value){
 await fs.mkdir(TEST_DIR,{recursive:true,mode:0o700});
 const tmp=STATE_FILE+'.'+randomUUID();
 await fs.writeFile(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
 await fs.rename(tmp,STATE_FILE);
}
function fresh(userId,stars){
 if(!ID.test(userId)||!Number.isSafeInteger(Number(userId))||
    !Number.isSafeInteger(stars)||stars<1||stars>1000000)
  throw Error('invalid_test_user_or_variable_amount');
 return {
  testOnly:true,orderId:randomUUID(),telegramUserId:Number(userId),
  priceStars:stars,status:'invoice_created',chargeId:null,
  deliveryMessageId:null,refundIntentAt:null,lastUpdateId:0
 };
}
async function identifyTestUser(token,fetchImpl=fetch){
 await verifyTelegramTestBot(token,fetchImpl);
 const updates=await telegramTestApi(token,'getUpdates',{
  timeout:0,limit:100,allowed_updates:['message']
 },fetchImpl);
 if(!Array.isArray(updates))throw Error('invalid_test_updates');
 const ids=[...new Set(updates
  .filter(x=>x?.message?.chat?.type==='private'&&
   Number.isSafeInteger(x.message.from?.id)&&
   x.message.from.id>0)
  .map(x=>x.message.from.id))];
 return {ok:true,testOnly:true,testUserIds:ids};
}
async function invoice(token,userId,stars,fetchImpl=fetch){
 await verifyTelegramTestBot(token,fetchImpl);
 const existing=await readState();
 if(existing&&existing.status!=='refunded')
  throw Error('finish_existing_test_order_before_creating_another');
 const order=fresh(userId,stars);
 const link=await telegramTestApi(token,'createInvoiceLink',{
  title:'RUST UP — тестовая квитанция',
  description:'Только тестовая квитанция. Не игровая валюта, не кейсы, без вывода.',
  payload:'test_rustup_'+order.orderId,
  currency:'XTR',
  prices:[{label:'Тестовый цифровой чек',amount:stars}]
 },fetchImpl);
 if(typeof link!=='string'||!/^https:\/\/t\.me\/\$[A-Za-z0-9_-]{8,256}$/.test(link))
  throw Error('unexpected_test_invoice_link');
 // Save a TEST ONLY invoice after Telegram created it. No production orders.
 await writeState({...order,invoiceUrl:link});
 return {ok:true,testOnly:true,invoiceUrl:link,orderId:order.orderId};
}
export function validTestDeliveryAck(order,answer){
 return !!order&&order.testOnly===true&&order.status==='paid'&&
  Number.isSafeInteger(answer?.message_id)&&answer.message_id>0&&
  answer.chat?.id===order.telegramUserId;
}
export function testRefundPayload(order,confirmation){
 if(!order||order.testOnly!==true||
    order.status!=='delivered'||typeof order.chargeId!=='string'||
    order.chargeId.length<8)
  throw Error('no_verified_delivered_test_order');
 if(confirmation!==('REFUND TEST '+order.orderId))
  throw Error('explicit_refund_confirmation_required');
 return {user_id:order.telegramUserId,
  telegram_payment_charge_id:order.chargeId};
}
async function confirmDelivery(token,order,fetchImpl=fetch){
 if(order.status==='delivered')return order;
 if(order.status!=='paid')throw Error('delivery_requires_verified_test_receipt');
 // Write a one-use delivery intent BEFORE sending. An API timeout must not
 // silently send a second delivery or claim an unconfirmed delivery.
 if(order.deliveryIntentAt)
  throw Error('test_delivery_outcome_uncertain_manual_review');
 order={...order,deliveryIntentAt:Date.now()};
 await writeState(order);
 try{
  const message=await telegramTestApi(token,'sendMessage',{
   chat_id:order.telegramUserId,
   text:'✅ RUST UP TEST: подтверждена оплата '+order.priceStars+
     ' ⭐. Доставлен тестовый цифровой чек. Игровой баланс не изменён.'
  },fetchImpl);
  if(!validTestDeliveryAck(order,message))
   throw Error('unverified_delivery_ack');
  order=safeTestStateTransition({...order,deliveryMessageId:message.message_id},'delivery');
  await writeState(order);
  return order;
 }catch(e){
  await writeState({...order,status:'manual_review',failure:'delivery_outcome_uncertain'});
  throw Error('test_delivery_requires_manual_review');
 }
}
async function listen(token,fetchImpl=fetch,pollSeconds=0){
 await verifyTelegramTestBot(token,fetchImpl);
 let order=await readState();
 if(!order||!order.testOnly||!UUID.test(order.orderId))
  throw Error('no_test_invoice_created');
 if(['refunded','refund_pending','manual_review'].includes(order.status))
  throw Error('test_order_not_listenable');
 const updates=await telegramTestApi(token,'getUpdates',{
  offset:order.lastUpdateId+1,timeout:pollSeconds,allowed_updates:['message','pre_checkout_query'],
  limit:100
 },fetchImpl);
 if(!Array.isArray(updates))throw Error('invalid_test_updates');
 let processed=0;
 for(const update of updates){
  if(!Number.isSafeInteger(update.update_id))continue;
  if(validTestPrecheckout(order,update)){
   await telegramTestApi(token,'answerPreCheckoutQuery',{
    pre_checkout_query_id:update.pre_checkout_query.id,ok:true
   },fetchImpl);
   order=safeTestStateTransition({...order,checkoutQueryId:update.pre_checkout_query.id},'precheckout');
   processed++;
  }else if(update.pre_checkout_query){
   // Refuse ANY unrecognized or altered test invoice.
   await telegramTestApi(token,'answerPreCheckoutQuery',{
    pre_checkout_query_id:update.pre_checkout_query.id,ok:false,
    error_message:'Unknown or changed test payment.'
   },fetchImpl);
  }else if(validTestReceipt(order,update)){
   const chargeId=update.message.successful_payment.telegram_payment_charge_id;
   if(order.chargeId&&order.chargeId!==chargeId)
    throw Error('test_charge_conflict');
   order=safeTestStateTransition({...order,chargeId},'paid');
   processed++;
  }
  order.lastUpdateId=Math.max(order.lastUpdateId,update.update_id);
  await writeState(order);
 }
 if(order.status==='paid')order=await confirmDelivery(token,order,fetchImpl);
 return {
  ok:true,testOnly:true,status:order.status,processed,
  testReceiptDelivered:order.status==='delivered',gameBalanceChanged:false
 };
}
async function refund(token,confirmation,fetchImpl=fetch){
 await verifyTelegramTestBot(token,fetchImpl);
 let order=await readState();
 const refundArgs=testRefundPayload(order,confirmation);
 // Reservation must survive a crash or timeout. Never automatically resend.
 order=safeTestStateTransition(
  {...order,refundIntentAt:Date.now()},'refund_intent');
 await writeState(order);
 try{
  const result=await telegramTestApi(token,'refundStarPayment',refundArgs,fetchImpl);
  if(result!==true)throw Error('test_refund_not_confirmed');
 }catch(e){
  await writeState(safeTestStateTransition(order,'manual_review'));
  throw Error('test_refund_outcome_uncertain_manual_review');
 }
 order=safeTestStateTransition(order,'refund_complete');
 await writeState(order);
 return {ok:true,testOnly:true,status:'refunded',gameBalanceChanged:false};
}
async function main(){
 const action=process.argv[2],token=process.env.TELEGRAM_TEST_BOT_TOKEN;
 if(!['probe','identify','invoice','listen','watch','refund','status'].includes(action))
  throw Error('Usage: node payments/scripts/telegram-stars-test-env.mjs probe|identify|invoice <TEST_USER_ID> <STARS>|listen|watch|refund "REFUND TEST <ORDER_UUID>"|status');
 if(action==='status'){
  const s=await readState();
  console.log(JSON.stringify({testOnly:true,status:s?.status||'not_started',
   orderId:s?.orderId||null,priceStars:s?.priceStars||null,
   delivered:s?.status==='delivered',gameBalanceChanged:false},null,2));
  return;
 }
 if(!token)throw Error('TELEGRAM_TEST_BOT_TOKEN_missing');
 let outcome;
 if(action==='probe')outcome=await verifyTelegramTestBot(token);
 else if(action==='identify')outcome=await identifyTestUser(token);
 else if(action==='invoice')outcome=await invoice(token,process.argv[3],Number(process.argv[4]));
 else if(action==='listen')outcome=await listen(token);
 else if(action==='watch'){
  // Keep handling precheckout updates promptly while the test user opens
  // the invoice. This runs ONLY in the caller's local shell; no production bot.
  for(let i=0;i<36;i++){
   outcome=await listen(token,fetch,4);
   if(outcome.testReceiptDelivered||outcome.status==='manual_review')break;
  }
  if(!outcome.testReceiptDelivered)
   throw Error('test_payment_not_confirmed_run_watch_again');
 }else outcome=await refund(token,process.argv.slice(3).join(' '));
 console.log(JSON.stringify(outcome,null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{
  console.error('TELEGRAM STARS TEST FAILED:',String(e?.message||e));
  process.exitCode=1;
 });
