import test from 'node:test';
import assert from 'node:assert/strict';
import {
  permittedProduct,invoiceBody,validPreCheckout,validSuccessfulPayment,
  createStarsCheckout,saveReceipt,verifiedWebhook,handleStarsUpdate
} from './stars.mjs';
import {recordExternalFixedReceipt} from './crypto-receipt.mjs';

const id='2039c8d8-85ba-43a1-9e2e-05f20a1c79b2';
const now=1793800000000;
const product={sku:'fixed_badge',title:'Badge',description:'Permanent fixed badge',kind:'fixed_nontransferable',price_stars:50,enabled:1};
const order={id,telegram_user_id:123456,price_stars:50,status:'pending',expires_at_ms:now+60000};
const q={id:'check',from:{id:123456},currency:'XTR',total_amount:50,invoice_payload:id};
const message={from:{id:123456},successful_payment:{currency:'XTR',total_amount:50,invoice_payload:id,telegram_payment_charge_id:'charge-test-1'}};

test('only enabled fixed non-transferable products',()=>{
  assert.equal(permittedProduct(product),true);
  for(const kind of ['random_case','wager_balance','cashout','skin','nft']){
    assert.equal(permittedProduct({...product,kind}),false);
  }
  assert.equal(permittedProduct({...product,enabled:0}),false);
  assert.deepEqual(invoiceBody(product,id),{
    title:'Badge',description:'Permanent fixed badge',payload:id,currency:'XTR',
    prices:[{label:'Badge',amount:50}]
  });
});

test('pre-checkout binds exact price, user, currency and order',()=>{
  assert.equal(validPreCheckout(order,q,now),true);
  for(const bad of [{...q,currency:'EUR'},{...q,total_amount:1},{...q,from:{id:222}},
    {...q,invoice_payload:'other'}]){
    assert.equal(validPreCheckout(order,bad,now),false);
  }
  assert.equal(validPreCheckout(order,q,now+100000),false);
});

test('delayed Stars receipt remains verifiable, mismatched and forged receipts fail',()=>{
  assert.equal(validSuccessfulPayment(order,message,now+180000),true);
  assert.equal(validSuccessfulPayment(order,{...message,from:{id:99}},now),false);
  assert.equal(validSuccessfulPayment(order,{...message,successful_payment:{...message.successful_payment,total_amount:500}},now),false);
});

test('webhook secret is required',()=>{
  assert.equal(verifiedWebhook(new Request('https://test.invalid',{
    headers:{'x-telegram-bot-api-secret-token':'great-secret'}
  }),{TG_STARS_WEBHOOK_SECRET:'great-secret'}),true);
  assert.equal(verifiedWebhook(new Request('https://test.invalid'),{TG_STARS_WEBHOOK_SECRET:'great-secret'}),false);
});

test('Stars disabled by default without Telegram calls',async()=>{
  await assert.rejects(
    ()=>createStarsCheckout({STARS_PAYMENT_ENABLED:'false'},{verifiedTelegramUserId:123456,sku:'fixed_badge'}),
    /disabled/
  );
  assert.deepEqual(await handleStarsUpdate({pre_checkout_query:q},{STARS_PAYMENT_ENABLED:'false'}),
    {handled:false,disabled:true});
});

function starsDb(){
  const row={...order,telegram_charge_id:null};
  return {row,prepare(sql){
    return {bind(...args){
      return {
        async first(){
          if(sql.includes('FROM rustup_stars_orders'))return {...row};
          return null;
        },
        async run(){
          if(!sql.includes("UPDATE rustup_stars_orders"))throw Error('unexpected_sql');
          if(row.status!=='pending')return {meta:{changes:0}};
          row.status='paid';row.telegram_charge_id=args[0];return {meta:{changes:1}};
        }
      };
    }};
  }};
}

test('replayed payment confirmation cannot produce another credit',async()=>{
  const db=starsDb();
  const first=await saveReceipt(db,db.row,message,now);
  assert.equal(first.accepted,true);
  assert.equal(first.duplicate,false);
  const second=await saveReceipt(db,db.row,message,now);
  assert.equal(second.accepted,true);
  assert.equal(second.duplicate,true);
  assert.equal(second.fulfillment,'MANUAL_FIXED_GOOD_ONLY');
  const mismatched={...message,successful_payment:{...message.successful_payment,telegram_payment_charge_id:'different'}};
  assert.equal((await saveReceipt(db,db.row,mismatched,now)).accepted,false);
});

test('external crypto callback is disabled, never credits game balance',async()=>{
  assert.deepEqual(await recordExternalFixedReceipt(new Request('https://example.invalid'),{}),{
    accepted:false,disabled:true
  });
});
