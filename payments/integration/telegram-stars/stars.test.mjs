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
  assert.equal(validSuccessfulPayment({...order,status:'checkout_approved'},message,now+180000),true);
  assert.equal(validSuccessfulPayment({...order,status:'checkout_approved'},{...message,from:{id:99}},now),false);
  assert.equal(validSuccessfulPayment({...order,status:'checkout_approved'},{...message,successful_payment:{...message.successful_payment,total_amount:500}},now),false);
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
  assert.deepEqual(await handleStarsUpdate({message:{text:'/start'}},{STARS_PAYMENT_ENABLED:'false'}),
    {handled:false,disabled:true});
});

test('admin emergency off rejects a new Stars precheckout explicitly',async()=>{
  let queried=false,answered=null;
  const env={STARS_PAYMENT_ENABLED:'false',TG_STARS_BOT_TOKEN:'123:'+'a'.repeat(30),
    DB:{prepare(){queried=true;throw Error('disabled_should_not_query_db');}}};
  const fakeTelegram=async(_url,opt)=>{
    answered=JSON.parse(opt.body);
    return {ok:true,async json(){return {ok:true,result:true}}};
  };
  const result=await handleStarsUpdate({pre_checkout_query:q},env,fakeTelegram);
  assert.equal(result.ok,false);
  assert.equal(queried,false);
  assert.deepEqual({ok:answered.ok,id:answered.pre_checkout_query_id},{ok:false,id:q.id});
});

function starsDb(){
  const row={...order,status:'checkout_approved',telegram_charge_id:null};
  return {row,prepare(sql){
    return {bind(...args){
      return {
        async first(){
          if(sql.includes('FROM rustup_stars_orders'))return {...row};
          return null;
        },
        async run(){
          if(!sql.includes("UPDATE rustup_stars_orders"))throw Error('unexpected_sql');
          if(row.status!=='checkout_approved')return {meta:{changes:0}};
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

// Separate offline external-store gateway simulation. No payment is transmitted.
import {createExternalCryptoCheckout} from './crypto-checkout.mjs';
import {randomUUID} from 'node:crypto';

function externalDb(){
  const p={sku:'fixed_badge',kind:'fixed_nontransferable',currency:'EUR',amount_minor:2500,enabled:1};
  let row;
  return {get row(){return row},prepare(query){
    return {bind(...args){
      return {
        async first(){
          if(query.includes('FROM rustup_external_fixed_products'))return p;
          if(query.includes('WHERE merchant_request_id='))return row||null;
          if(query.includes('SELECT provider_invoice_id'))return {provider_invoice_id:row?.provider_invoice_id};
          return null;
        },
        async run(){
          if(query.includes('INSERT INTO rustup_external_fixed_orders')){
            row={project_order_ref:args[0],merchant_request_id:args[1],
              external_customer_ref:args[2],sku:args[3],
              product_kind:'fixed_nontransferable',currency:args[4],
              amount_minor:args[5],asset:args[6],
              provider_invoice_id:null,status:'pending'};
            return {meta:{changes:1}};
          }
          if(query.includes('UPDATE rustup_external_fixed_orders')){
            row.provider_invoice_id=args[0];return {meta:{changes:1}};
          }
          throw Error('unexpected_sql');
        }
      };
    }};
  }};
}

test('external crypto checkout disabled by default',async()=>{
  await assert.rejects(()=>createExternalCryptoCheckout({},{}),/disabled/);
});

test('external crypto gateway uses fixed product prices and stable idempotency',async()=>{
  const db=externalDb(), customer=randomUUID(),requestId=randomUUID();
  let calls=0;const key='rup2_'+'a'.repeat(64);
  const env={EXTERNAL_CRYPTO_CHECKOUT_ENABLED:'true',EXTERNAL_DB:db,
    CRYPTO_PROVIDER_URL:'https://payments.example.test',
    CRYPTO_PROJECT_ID:randomUUID(),CRYPTO_PROJECT_API_KEY:key};
  const send=async (url,opts)=>{
    calls++;assert.equal(url,'https://payments.example.test/v2/deposits');
    assert.equal(opts.headers.authorization,'Bearer '+key);
    assert.equal(opts.headers['idempotency-key'],requestId);
    const body=JSON.parse(opts.body);
    assert.equal(body.currency,'EUR');
    assert.equal(body.amountMinor,2500);
    assert.equal(body.projectOrderRef,db.row.project_order_ref);
    return {ok:true,async json(){return {ok:true,invoice:{
      invoiceId:id,projectOrderRef:db.row.project_order_ref,
      fiat:'EUR',amountMinor:2500,asset:'TRX',
      chain:'tron',receiveAddress:'T123456789012345678901234567890',
      amountAtomic:'100000000',expiresAt:now+60000,
      confirmedOnChain:false
    }}}};
  };
  const params={verifiedExternalCustomerRef:customer,merchantRequestId:requestId,
    sku:'fixed_badge',asset:'TRX',fetchImpl:send};
  const first=await createExternalCryptoCheckout(env,params);
  const second=await createExternalCryptoCheckout(env,params);
  assert.equal(first.invoiceId,id);
  assert.equal(first.paymentVerified,false);
  assert.equal(first.fulfilled,false);
  assert.deepEqual(second,first);
  assert.equal(calls,2);
  await assert.rejects(()=>createExternalCryptoCheckout(env,{
    ...params,verifiedExternalCustomerRef:randomUUID()
  }),/idempotency_conflict/);
  assert.equal(db.row.provider_invoice_id,id);
});

test('only one Stars pre-checkout reservation, same query retries allowed',async()=>{
  const r={...order,expires_at_ms:Date.now()+60000,status:'pending',checkout_query_id:null};
  let n=0;
  const db={prepare(sql){return {bind(...args){return {
    async first(){if(sql.includes('SELECT id,telegram_user_id'))return {...r};return null;},
    async run(){
      n++;
      if(r.status!=='pending')return {meta:{changes:0}};
      r.status='checkout_approved';r.checkout_query_id=args[0];
      return {meta:{changes:1}};
    }
  }}}}};
  const replies=[];
  const telegram=async (_url,opt)=>{replies.push(JSON.parse(opt.body));return {ok:true,async json(){return {ok:true,result:true}}}};
  const env={STARS_PAYMENT_ENABLED:'true',DB:db,TG_STARS_BOT_TOKEN:'123:'+'a'.repeat(30)};
  assert.equal((await handleStarsUpdate({pre_checkout_query:q},env,telegram)).ok,true);
  assert.equal((await handleStarsUpdate({pre_checkout_query:q},env,telegram)).ok,true);
  assert.equal((await handleStarsUpdate({pre_checkout_query:{...q,id:'another'}},env,telegram)).ok,false);
  assert.equal(n,1);
  assert.deepEqual(replies.map(x=>x.ok),[true,true,false]);
});


test('external crypto refuses Telegram Mini App digital payment context',async()=>{
 await assert.rejects(
  ()=>createExternalCryptoCheckout({}, {sourceChannel:'telegram-miniapp'}),
  /telegram_digital_goods_require_stars/
 );
});
