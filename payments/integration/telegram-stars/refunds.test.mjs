import test from 'node:test';
import assert from 'node:assert/strict';
import {issueFixedStarsRefund,handleRefundCommand} from './refunds.mjs';

test('refund flow is disabled unless explicitly enabled and operator-approved',async()=>{
 await assert.rejects(
  ()=>issueFixedStarsRefund({},{adminId:1,orderId:'00000000-0000-4000-8000-000000000001'}),
  /refunds_not_enabled/
 );
 await assert.rejects(
  ()=>issueFixedStarsRefund({STARS_REFUNDS_ENABLED:'true'},{adminId:1,orderId:'00000000-0000-4000-8000-000000000001'}),
  /finance_admin_required/
 );
});
test('ordinary and group messages never trigger Stars refund command',async()=>{
 assert.equal(await handleRefundCommand({message:{text:'/start'}},{}),false);
 assert.equal(await handleRefundCommand({message:{text:'/pay refundstars 00000000-0000-4000-8000-000000000001 CONFIRM',from:{id:1},chat:{id:-1,type:'group'}}},{}),false);
});

test('confirmed refund calls Telegram once and revokes fixed content',async()=>{
 const id='00000000-0000-4000-8000-000000000001',adminId=12345;
 const row={id,telegram_user_id:667788,status:'paid',telegram_charge_id:'star-charge-1'};
 let intent=false,calls=0;
 const db={
  prepare(sql){
   return {
    bind(){
     return {
      async first(){return {...row};},
      async run(){
       if(sql.includes('INSERT OR IGNORE INTO rustup_stars_refund_intents')){
        if(intent)return {meta:{changes:0}};
        intent=true;
       }
       return {meta:{changes:1}};
      }
     };
    }
   };
  },
  async batch(statements){
   assert.equal(statements.length,3);
   row.status='refunded';
   return statements.map(()=>({meta:{changes:1}}));
  }
 };
 const env={PAYMENTS_DB:db,PAYMENT_ADMIN_IDS:String(adminId),
  STARS_REFUNDS_ENABLED:'true',BOT_TOKEN:'12345:'+'a'.repeat(28)};
 const telegram=async(url,options)=>{
  calls++;
  assert.ok(url.endsWith('/refundStarPayment'));
  const body=JSON.parse(options.body);
  assert.equal(body.telegram_payment_charge_id,row.telegram_charge_id);
  assert.equal(body.user_id,row.telegram_user_id);
  return {ok:true,json:async()=>({ok:true,result:true})};
 };
 const answer=await issueFixedStarsRefund(env,{
  adminId,orderId:id,confirmation:'REFUND '+id,fetchImpl:telegram
 });
 assert.equal(answer.status,'refunded');
 assert.equal(answer.gameBalanceChanged,false);
 assert.equal(calls,1);
 await assert.rejects(()=>issueFixedStarsRefund(env,{
  adminId,orderId:id,confirmation:'REFUND '+id,fetchImpl:telegram
 }),/order_not_refundable/);
 assert.equal(calls,1);
});
