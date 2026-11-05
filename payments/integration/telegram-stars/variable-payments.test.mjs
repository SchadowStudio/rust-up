import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {
  quoteVariableStars,createVariableStarsCheckout,
  validVariableStarsPrecheckout,validVariableStarsReceipt,
  handleVariableStarsUpdate,recordUnexpectedVariableStarsReceipt
} from './variable-stars.mjs';
import {createExternalVariableCryptoCheckout,recordExternalVariableReceipt}
  from './variable-crypto.mjs';

const token='12345678:'+'a'.repeat(35);
const now=1793800000000;
const rate={STARS_MIN_RUB_MINOR:'100',STARS_MAX_RUB_MINOR:'10000000',
  STARS_RUB_MINOR_PER_STAR_NUM:'300',STARS_RUB_MINOR_PER_STAR_DEN:'1'};

test('arbitrary RUB minor amount is quoted in whole Stars from owner rate, not fixed package',()=>{
  const quote=quoteVariableStars(15000,rate);
  assert.equal(quote.currency,'RUB');
  assert.equal(quote.requestedAmountMinor,15000);
  assert.equal(quote.priceStars,50);
  assert.equal(quote.creditedToGame,false);
  assert.equal(quoteVariableStars(15001,rate).priceStars,51);
  assert.throws(()=>quoteVariableStars(15000,{}),/unconfigured/);
  assert.throws(()=>quoteVariableStars(15000.5,rate),/out_of_bounds/);
  assert.throws(()=>quoteVariableStars(50,rate),/out_of_bounds/);
  assert.throws(()=>quoteVariableStars(10000001,rate),/out_of_bounds/);
});

function makeStarsDb(){
  let row=null,updates=0;
  const incidents=new Map();
  return {
    get row(){return row;},get updates(){return updates;},
    get incidents(){return incidents;},
    prepare(sql){
      return {bind(...args){return {
        async first(){
          if(sql.includes('FROM rustup_stars_variable_orders')) return row&&
            ((sql.includes('telegram_user_id=?')&&(row.telegram_user_id!==args[0]||
              row.client_request_id!==args[1]))|| 
             (sql.includes('WHERE id=?')&&row.id!==args[0])?null:{...row});
          if(sql.includes('FROM rustup_stars_receipt_incidents WHERE telegram_charge_id=?'))
            return incidents.get(args[0])||null;
          return null;
        },
        async run(){
          if(sql.includes('INSERT OR IGNORE INTO rustup_stars_receipt_incidents')){
            const charge=args[0];
            if(incidents.has(charge))return {meta:{changes:0}};
            incidents.set(charge,{telegram_charge_id:charge,telegram_user_id:args[1],
              invoice_payload:args[2],price_stars:args[3],reason:args[4],occurred_at_ms:args[5]});
            return {meta:{changes:1}};
          }
          if(sql.includes('INSERT INTO rustup_stars_variable_orders')){
            row={id:args[0],telegram_user_id:args[1],client_request_id:args[2],
              requested_amount_minor:args[3],price_stars:args[4],
              rate_num:args[5],rate_den:args[6],created_at_ms:args[7],
              expires_at_ms:args[8],status:'pending',invoice_url:null,
              checkout_query_id:null,telegram_charge_id:null};
            return {meta:{changes:1}};
          }
          if(sql.includes('UPDATE rustup_stars_variable_orders SET invoice_url')){
            if(row.status!=='pending'||row.invoice_url)return {meta:{changes:0}};
            row.invoice_url=args[0];return {meta:{changes:1}};
          }
          if(sql.includes("SET status='checkout_approved'")){
            if(row.status!=='pending')return {meta:{changes:0}};
            row.status='checkout_approved';row.checkout_query_id=args[0];
            updates++;return {meta:{changes:1}};
          }
          if(sql.includes("SET status='paid'")){
            if(row.status!=='checkout_approved')return {meta:{changes:0}};
            row.status='paid';row.telegram_charge_id=args[0];
            updates++;return {meta:{changes:1}};
          }
          throw Error('unexpected_stars_sql');
        }
      };
    }};
    }
  };
}

test('variable Stars checkout: one user-chosen sum, stable retries, no credits',async()=>{
  const db=makeStarsDb(),requestId=randomUUID();
  const env={...rate,STARS_PAYMENT_ENABLED:'true',
    STARS_VARIABLE_TOPUP_ENABLED:'true',TG_STARS_BOT_TOKEN:token,DB:db};
  let apiCalls=0;
  const telegram=async(url,opts)=>{
    assert.ok(url.endsWith('/createInvoiceLink'));
    const body=JSON.parse(opts.body);
    assert.equal(body.currency,'XTR');
    assert.equal(body.prices.length,1);
    assert.equal(body.prices[0].amount,50);
    assert.ok(body.payload.startsWith('v:'));
    apiCalls++;
    return {ok:true,async json(){return {ok:true,result:'https://t.me/$demo-invoice'}}};
  };
  const opts={verifiedTelegramUserId:12345,amountMinor:15000,requestId,
    now,fetchImpl:telegram};
  const a=await createVariableStarsCheckout(env,opts);
  assert.equal(a.creditedToGame,false);
  assert.equal(a.priceStars,50);
  assert.equal(a.requestedAmountMinor,15000);
  const b=await createVariableStarsCheckout(env,opts);
  assert.deepEqual(a,b);
  assert.equal(apiCalls,1);
  await assert.rejects(
    ()=>createVariableStarsCheckout(env,{...opts,amountMinor:16000}),
    /request_conflict/
  );
});

test('variable Stars one-use checkout, delayed verified receipt, duplicate safe',async()=>{
  const db=makeStarsDb(),requestId=randomUUID();
  const env={...rate,STARS_PAYMENT_ENABLED:'true',
    STARS_VARIABLE_TOPUP_ENABLED:'true',TG_STARS_BOT_TOKEN:token,DB:db};
  const bot=async(url,opt)=>{
    const m=url.endsWith('/answerPreCheckoutQuery')?'pre':'invoice';
    const body=JSON.parse(opt.body);
    return {ok:true,async json(){return {ok:true,result:m==='invoice'?
      'https://t.me/$demo-invoice':true}}};
  };
  const ord=await createVariableStarsCheckout(env,{
    verifiedTelegramUserId:12345,amountMinor:15000,requestId,
    now,fetchImpl:bot
  });
  const q={id:'q1',from:{id:12345},currency:'XTR',total_amount:50,
    invoice_payload:'v:'+ord.orderId};
  assert.equal(validVariableStarsPrecheckout(db.row,q,now),true);
  // An invoice URL must be stored BEFORE Telegram may charge for it.
  // A crash between createInvoiceLink and database save is fail-closed.
  assert.equal(validVariableStarsPrecheckout({...db.row,invoice_url:null},q,now),false);
  assert.equal(validVariableStarsPrecheckout({...db.row,invoice_url:'http://evil.test'},q,now),false);
  assert.equal(validVariableStarsPrecheckout({...db.row,invoice_url:'x'.repeat(1025)},q,now),false);
  assert.equal(validVariableStarsPrecheckout(db.row,{...q,total_amount:500},now),false);
  assert.equal((await handleVariableStarsUpdate({pre_checkout_query:q},env,bot,now)).ok,true);
  assert.equal(db.row.status,'checkout_approved');
  assert.equal((await handleVariableStarsUpdate(
    {pre_checkout_query:{...q,id:'q2'}},env,bot,now)).ok,false);
  const msg={from:{id:12345},successful_payment:{
    currency:'XTR',total_amount:50,invoice_payload:'v:'+ord.orderId,
    telegram_payment_charge_id:'unique-charge-1'
  }};
  assert.equal(validVariableStarsReceipt(db.row,msg),true);
  const first=await handleVariableStarsUpdate({message:msg},env,bot,now+900000);
  assert.equal(first.accepted,true);
  assert.equal(first.creditedToGame,false);
  const second=await handleVariableStarsUpdate({message:msg},env,bot,now+900001);
  assert.equal(second.duplicate,true);
  assert.equal(db.updates,2);
  const mismatch=await handleVariableStarsUpdate({message:{
    ...msg,successful_payment:{...msg.successful_payment,total_amount:51}
  }},env,bot,now);
  assert.equal(mismatch.accepted,false);
  assert.equal(mismatch.incidentRecorded,true);
  assert.equal(db.incidents.size,1);
  assert.equal(db.incidents.get('unique-charge-1').reason,'variable_receipt_mismatch');
});

test('a second real Stars charge is quarantined instead of endlessly retried or double-credited',async()=>{
  const db=makeStarsDb(),requestId=randomUUID();
  const env={...rate,STARS_PAYMENT_ENABLED:'true',
    STARS_VARIABLE_TOPUP_ENABLED:'true',TG_STARS_BOT_TOKEN:token,DB:db};
  const bot=async(url)=>({ok:true,async json(){return {ok:true,
    result:url.endsWith('/createInvoiceLink')?'https://t.me/$receipt-test':true}}});
  const order=await createVariableStarsCheckout(env,{
    verifiedTelegramUserId:12345,amountMinor:15000,requestId,now,fetchImpl:bot
  });
  const invoice_payload='v:'+order.orderId;
  await handleVariableStarsUpdate({pre_checkout_query:{id:'query-1',from:{id:12345},
    currency:'XTR',total_amount:50,invoice_payload}},env,bot,now);
  const msg=charge=>({from:{id:12345},successful_payment:{
    currency:'XTR',total_amount:50,invoice_payload,
    telegram_payment_charge_id:charge}});
  const first=await handleVariableStarsUpdate({message:msg('charge-original')},env,bot,now+1);
  assert.equal(first.accepted,true);
  const second=await handleVariableStarsUpdate({message:msg('charge-second')},env,bot,now+2);
  assert.equal(second.accepted,false);
  assert.equal(second.incidentRecorded,true);
  assert.equal(second.creditedToGame,false);
  const again=await handleVariableStarsUpdate({message:msg('charge-second')},env,bot,now+3);
  assert.equal(again.incidentRecorded,true);
  assert.equal(db.incidents.size,1);
  assert.equal(db.row.telegram_charge_id,'charge-original');
  assert.equal(db.updates,2);
  assert.equal(db.incidents.get('charge-second').reason,'variable_receipt_mismatch');
});

test('transient database failure cannot be acknowledged as a paid receipt',async()=>{
  const base=makeStarsDb(),requestId=randomUUID();
  const env={...rate,STARS_PAYMENT_ENABLED:'true',
    STARS_VARIABLE_TOPUP_ENABLED:'true',TG_STARS_BOT_TOKEN:token,DB:base};
  const bot=async(url)=>({ok:true,async json(){return {ok:true,
    result:url.endsWith('/createInvoiceLink')?'https://t.me/$db-retry':true}}});
  const order=await createVariableStarsCheckout(env,{
    verifiedTelegramUserId:12345,amountMinor:15000,requestId,now,fetchImpl:bot
  });
  const invoice_payload='v:'+order.orderId;
  await handleVariableStarsUpdate({pre_checkout_query:{id:'query-retry',from:{id:12345},
    currency:'XTR',total_amount:50,invoice_payload}},env,bot,now);
  const broken={prepare(sql){
    if(sql.includes("SET status='paid'"))return {bind(){return {
      async run(){throw Error('D1 database timeout');}
    }}};
    return base.prepare(sql);
  }};
  await assert.rejects(()=>handleVariableStarsUpdate({message:{
    from:{id:12345},successful_payment:{currency:'XTR',total_amount:50,
      invoice_payload,telegram_payment_charge_id:'charge-retry'}
  }},{...env,DB:broken},bot,now+1),/receipt_database_retry/);
  assert.equal(base.row.status,'checkout_approved');
  assert.equal(base.incidents.size,0);
});

function makeCryptoDb(){
  let row=null;
  return {get row(){return row},prepare(query){
    return {bind(...args){return {
      async first(){
        if(query.includes('SELECT * FROM rustup_external_variable_orders')){
          if(query.includes('merchant_request_id=?'))
            return row&&row.merchant_request_id===args[0]?{...row}:null;
          return row&&row.project_order_ref===args[0]?{...row}:null;
        }
        if(query.includes('SELECT provider_invoice_id'))
          return {provider_invoice_id:row?.provider_invoice_id};
        return null;
      },
      async run(){
        if(query.includes('INSERT INTO rustup_external_variable_orders')){
          row={project_order_ref:args[0],merchant_request_id:args[1],
            external_customer_ref:args[2],currency:args[3],
            amount_minor:args[4],asset:args[5],status:'pending',
            provider_invoice_id:null};
          return {meta:{changes:1}};
        }
        if(query.includes('UPDATE rustup_external_variable_orders')){
          row.provider_invoice_id=args[0];return {meta:{changes:1}};
        }
        throw Error('unexpected_crypto_sql');
      }
    };
  }};
  }};
}
test('variable crypto fiat input goes to server-scoped project, not browser key',async()=>{
  const db=makeCryptoDb(),merchantRequestId=randomUUID(),customer=randomUUID();
  const key='rup2_'+'b'.repeat(64);
  const env={EXTERNAL_DB:db,EXTERNAL_VARIABLE_CRYPTO_CHECKOUT_ENABLED:'true',
    EXTERNAL_MIN_FIAT_MINOR:'100',EXTERNAL_MAX_FIAT_MINOR:'999999',
    CRYPTO_PROVIDER_URL:'https://payments.example.test',
    CRYPTO_PROJECT_ID:randomUUID(),CRYPTO_PROJECT_API_KEY:key};
  const pay=async(url,opt)=>{
    assert.equal(url,'https://payments.example.test/v2/deposits');
    assert.equal(opt.headers.authorization,'Bearer '+key);
    assert.equal(opt.headers['idempotency-key'],merchantRequestId);
    const b=JSON.parse(opt.body);
    assert.equal(b.amountMinor,15000);
    assert.equal(b.currency,'RUB');
    return {ok:true,async json(){return {ok:true,invoice:{
      invoiceId:randomUUID(),projectOrderRef:b.projectOrderRef,
      fiat:'RUB',amountMinor:15000,asset:'USDT_TRC20',
      chain:'tron',receiveAddress:'T123456789012345678901234567890',
      amountAtomic:'1700000',expiresAt:now+60000,confirmedOnChain:false
    }}}};
  };
  const input={verifiedExternalCustomerRef:customer,
    merchantRequestId,amountMinor:15000,currency:'RUB',asset:'USDT_TRC20',
    fetchImpl:pay};
  const result=await createExternalVariableCryptoCheckout(env,input);
  assert.equal(result.requestedAmountMinor,15000);
  assert.equal(result.creditedToGame,false);
  assert.equal(result.withdrawable,false);
  await assert.rejects(()=>createExternalVariableCryptoCheckout(env,{
    ...input,amountMinor:14000
  }),/idempotency_conflict/);
  assert.deepEqual(await recordExternalVariableReceipt(
    new Request('https://test.invalid'),env),{accepted:false,disabled:true});
});


test('variable crypto refuses Telegram bot digital payment context',async()=>{
 await assert.rejects(
  ()=>createExternalVariableCryptoCheckout({}, {sourceChannel:'telegram-bot'}),
  /telegram_digital_goods_require_stars/
 );
});

test('incomplete variable Stars incident evidence fails closed and never credits',async()=>{
  const db=makeStarsDb();
  const msg={from:{id:12345},successful_payment:{
    currency:'XTR',total_amount:20,invoice_payload:'v:not-an-order',
    telegram_payment_charge_id:'bad-charge-test'
  }};
  const first=await recordUnexpectedVariableStarsReceipt(db,msg,now);
  const replay=await recordUnexpectedVariableStarsReceipt(db,msg,now+1);
  assert.equal(first.stored,true);
  assert.equal(replay.duplicate,true);
  assert.equal(db.incidents.size,1);
  assert.equal(db.updates,0);
  await assert.rejects(()=>recordUnexpectedVariableStarsReceipt(db,{
    ...msg,successful_payment:{...msg.successful_payment,total_amount:21}
  },now+2),/incident_conflict_retry/);
  await assert.rejects(()=>recordUnexpectedVariableStarsReceipt(db,{
    ...msg,successful_payment:{...msg.successful_payment,invoice_payload:'v:another-order'}
  },now+2),/incident_conflict_retry/);
  await assert.rejects(()=>recordUnexpectedVariableStarsReceipt(db,{
    ...msg,successful_payment:{...msg.successful_payment,
      telegram_payment_charge_id:''}
  },now+3),/evidence_incomplete_retry/);
  assert.equal(db.incidents.size,1);
});
