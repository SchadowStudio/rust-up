// FULL synthetic Telegram Stars integration: signed Mini App identity -> quote
// -> fake Telegram invoice -> fake approved checkout -> fake receipt -> cron
// -> exactly-once existing game balance -> authenticated history -> refund.
// ALL funds/accounts/provider responses are local SQLite fixtures. NO NETWORK.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {variableStarsApi} from './stars-variable-bridge.mjs';
import {wrapCurrentStarsWebhook} from './stars-variable-webhook-wrapper.mjs';
import {calculateRubGameCredit} from '../account-credit-ledger/freeze-verified-stars-game-quote.mjs';
import {runVariableStarsDeliveryQueue} from './stars-delivery-queue.mjs';
import {discoverVerifiedStarsRefunds,reconcileRecordedStarsRefundBatch}
 from '../account-credit-ledger/verified-stars-game-refund.mjs';

const USER=7390606911,OTHER=987654321;
const TOKEN='123456789:'+('a'.repeat(35));
const SECRET='synthetic-local-webhook-only';
const BASE='https://rustup-bot.ttzoomrust.workers.dev';
const ORIGIN='https://ttzoomrust-hub.github.io';
const AMOUNT=183,STARS=1,FX=9500;
const readSql=(p)=>readFileSync(new URL(p,import.meta.url),'utf8');
function binding(db){
 return {prepare(sql){
  const statement=db.prepare(sql);
  const make=args=>({
   async first(){return statement.get(...args)??null;},
   async all(){return {results:statement.all(...args)};},
   async run(){return {meta:{changes:statement.run(...args).changes}};}
  });
  return {...make([]),bind(...args){return make(args);}};
 }};
}
function initData(id=USER){
 const form=new URLSearchParams({
  auth_date:String(Math.floor(Date.now()/1000)),
  user:JSON.stringify({id,first_name:'Synthetic'})
 });
 const data=[...form].sort(([a],[b])=>a.localeCompare(b))
  .map(([k,v])=>k+'='+v).join('\n');
 const secret=createHmac('sha256','WebAppData').update(TOKEN).digest();
 form.set('hash',createHmac('sha256',secret).update(data).digest('hex'));
 return form.toString();
}
function apiRequest(action,body={},id=USER){
 return new Request(BASE+'/api/stars/variable/'+action,{
  method:'POST',headers:{origin:ORIGIN,'content-type':'application/json'},
  body:JSON.stringify({initData:initData(id),...body})
 });
}
function telegramRequest(payload){
 return new Request(BASE+'/tg',{method:'POST',
  headers:{'X-Telegram-Bot-Api-Secret-Token':SECRET,
   'content-type':'application/json'},
  body:JSON.stringify(payload)});
}
function fixture(){
 const pay=new DatabaseSync(':memory:'),game=new DatabaseSync(':memory:');
 pay.exec(readSql('./variable-migration.sql'));
 pay.exec(readSql('../account-credit-ledger/variable-stars-credit-quote.sql'));
 pay.exec(readSql('./variable-stars-delivery-queue.sql'));
 pay.exec(readSql('./variable-stars-refund-reconciliation.sql'));
 pay.exec('CREATE TABLE rustup_payment_settings ('+
  'channel TEXT PRIMARY KEY,enabled INTEGER NOT NULL);'+
  "INSERT INTO rustup_payment_settings VALUES ('master',1),('stars',1),('crypto',0);");
 game.exec('CREATE TABLE accounts(id INTEGER PRIMARY KEY,state TEXT NOT NULL,'+
  'v INTEGER NOT NULL,updated INTEGER NOT NULL);'+
  'CREATE TABLE users(id INTEGER PRIMARY KEY,balance REAL,'+
  'blocked INTEGER NOT NULL DEFAULT 0,banned INTEGER NOT NULL DEFAULT 0);');
 game.exec(readSql('../account-credit-ledger/atomic-game-credit.sql'));
 game.prepare('UPDATE rustup_game_paid_release_control SET enabled=1,'+
  'approval_reference=?,reviewed_at_ms=? WHERE id=1')
  .run('SYNTHETIC-LOCAL-RELEASE',Date.now());
 for(const id of [USER,OTHER]){
  game.prepare('INSERT INTO accounts VALUES (?,?,?,?)')
   .run(id,JSON.stringify({balance:10,inventory:[]}),1,Date.now());
  game.prepare('INSERT INTO users(id,balance) VALUES (?,?)').run(id,10);
 }
 const env={
  DB:binding(game),PAYMENTS_DB:binding(pay),BOT_TOKEN:TOKEN,
  WEBHOOK_SECRET:SECRET,APP_URL:ORIGIN+'/rust-up/',
  PAYMENT_PRODUCTION_ENABLED:'true',
  PAYMENT_WALLET_STRICT_MODE:'true',
  STARS_PAYMENT_ENABLED:'true',STARS_VARIABLE_TOPUP_ENABLED:'true',
  STARS_VARIABLE_CREDIT_LEDGER_READY:'true',
  STARS_GAME_CREDIT_SETTLEMENT_ENABLED:'true',
  STARS_GAME_CREDIT_REFUND_RECONCILIATION_ENABLED:'true',
  STARS_VARIABLE_CHECKOUT_RELEASE_APPROVED:'true',
  STARS_VARIABLE_PILOT_USER_IDS:String(USER),
  STARS_VARIABLE_PILOT_MAX_STARS:'1',
  STARS_VARIABLE_PILOT_EXPIRES_AT_MS:String(Date.now()+3600000),
  STARS_VARIABLE_PILOT_PHASE:'fixed',
  STARS_MIN_RUB_MINOR:'100',
  STARS_MAX_RUB_MINOR:'100000000',
  STARS_RUB_MINOR_PER_STAR_NUM:'183000',
  STARS_RUB_MINOR_PER_STAR_DEN:'1000'
 };
 const history=[];
 const calls={invoice:0,precheckout:0,history:0,refund:0,unexpected:0};
 const fakeTelegram=async(url,opts)=>{
  assert.match(url,/^https:\/\/api\.telegram\.org\/bot/);
  assert.equal(opts.redirect,'manual');
  const method=url.split('/').at(-1),data=JSON.parse(opts.body);
  if(method==='createInvoiceLink'){
   calls.invoice++;
   assert.equal(data.currency,'XTR');
   assert.equal(data.prices?.[0]?.amount,1);
   assert.match(data.payload,/^v:/);
   return {ok:true,json:async()=>({ok:true,result:'https://t.me/$synthetic_invoice_1234'})};
  }
  if(method==='answerPreCheckoutQuery'){
   calls.precheckout++;
   assert.equal(data.ok,true);
   return {ok:true,json:async()=>({ok:true,result:true})};
  }
  if(method==='getStarTransactions'){
   calls.history++;
   assert.equal(data.limit,100);
   return {ok:true,json:async()=>({ok:true,result:{
    transactions:history.slice(data.offset,data.offset+data.limit)
   }})};
  }
  if(method==='refundStarPayment')calls.refund++;
  else calls.unexpected++;
  throw Error('synthetic_provider_unexpected_method_'+method);
 };
 const worker=wrapCurrentStarsWebhook({
  async fetch(){return new Response('original-route');},
  async scheduled(){}
 },{
  fetchImpl:fakeTelegram,
  calculateEntitlement:async({amountMinor})=>
   calculateRubGameCredit({amountMinor,rubPerUsdMinor:FX})
 });
 const balance=id=>{
  const account=game.prepare('SELECT state,v FROM accounts WHERE id=?').get(id);
  const mirror=game.prepare('SELECT balance FROM users WHERE id=?').get(id);
  return {canonical:JSON.parse(account.state).balance,mirror:mirror.balance,
   v:account.v};
 };
 const counts=()=>({
  receipts:game.prepare('SELECT COUNT(*) n FROM rustup_game_paid_receipts').get().n,
  refunds:game.prepare('SELECT COUNT(*) n FROM rustup_game_paid_refunds').get().n
 });
 return {env,pay,game,worker,history,calls,fakeTelegram,balance,counts,
  close(){pay.close();game.close();}};
}

test('SIGNED TELEGRAM USER: invoice -> confirmed receipt -> one canonical game credit -> verified refund',async()=>{
 const f=fixture();
 try{
  const initial=f.balance(USER);
  assert.equal(initial.canonical,10);
  const unauthorized=await variableStarsApi(apiRequest('quote',{amountMinor:AMOUNT},OTHER),
   f.env,f.fakeTelegram);
  assert.equal((await unauthorized.json()).checkoutEnabled,false);
  const rejectedCheckout=await f.worker.fetch(apiRequest('checkout',{
   amountMinor:AMOUNT,requestId:randomUUID()
  },OTHER),f.env,{});
  assert.equal(rejectedCheckout.status,503);
  assert.equal(f.calls.invoice,0);
  const overLimit=await f.worker.fetch(apiRequest('quote',{
   amountMinor:AMOUNT*2
  }),f.env,{});
  assert.equal(overLimit.status,200);
  assert.equal((await overLimit.json()).checkoutEnabled,false);
  const quoted=await f.worker.fetch(apiRequest('quote',{amountMinor:AMOUNT}),f.env,{});
  assert.equal(quoted.status,200);
  const preview=await quoted.json();
  assert.equal(preview.ok,true);
  assert.equal(preview.priceStars,STARS);
  assert.equal(preview.checkoutEnabled,true);
  assert.deepEqual(f.balance(USER),initial);
  const checkout=await f.worker.fetch(apiRequest('checkout',{
   amountMinor:AMOUNT,requestId:randomUUID()
  }),f.env,{});
  assert.equal(checkout.status,200);
  const invoice=await checkout.json();
  assert.equal(invoice.ok,true);
  assert.equal(invoice.priceStars,STARS);
  assert.match(invoice.invoiceUrl,/^https:\/\/t\.me\/\$/);
  assert.equal(f.calls.invoice,1);
  assert.deepEqual(f.balance(USER),initial);
  const orderId=invoice.orderId;
  const frozen=f.pay.prepare(
   'SELECT * FROM rustup_stars_variable_credit_quotes WHERE order_id=?'
  ).get(orderId);
  const expected=calculateRubGameCredit({amountMinor:AMOUNT,rubPerUsdMinor:FX});
  assert.equal(frozen.coin_cents,expected.coinCents);
  assert.equal(frozen.rub_per_usd_minor,FX);
  const pre=await f.worker.fetch(telegramRequest({
   update_id:1,pre_checkout_query:{
    id:'fake-precheckout',from:{id:USER},currency:'XTR',
    total_amount:STARS,invoice_payload:'v:'+orderId
   }
  }),f.env,{});
  assert.equal(pre.status,200);
  assert.equal(f.calls.precheckout,1);
  const charge='synthetic-telegram-charge-'+randomUUID();
  const paid=await f.worker.fetch(telegramRequest({
   update_id:2,message:{from:{id:USER},successful_payment:{
    currency:'XTR',total_amount:STARS,
    invoice_payload:'v:'+orderId,telegram_payment_charge_id:charge
   }}
  }),f.env,{});
  assert.equal(paid.status,200);
  assert.deepEqual(f.balance(USER),initial);
  const pending=await variableStarsApi(apiRequest('history'),f.env,f.fakeTelegram);
  assert.equal(pending.status,200);
  assert.equal((await pending.json()).orders[0].creditState,'payment_confirmed_credit_pending');
  f.history.push({id:charge,amount:STARS,
   date:Math.floor(Date.now()/1000),
   source:{type:'user',transaction_type:'invoice_payment',
    user:{id:USER},invoice_payload:'v:'+orderId}
  });
  const settled=await runVariableStarsDeliveryQueue(f.env,{
   now:Date.now()+1000,fetchImpl:f.fakeTelegram,
   newLeaseToken:()=>randomUUID()
  });
  assert.equal(settled.delivered,1);
  assert.equal(f.balance(USER).canonical,Math.round((10+expected.coinCents/100)*100)/100);
  assert.equal(f.balance(USER).mirror,f.balance(USER).canonical);
  assert.deepEqual(f.counts(),{receipts:1,refunds:0});
  const credited=await variableStarsApi(apiRequest('history'),f.env,f.fakeTelegram);
  const creditedData=await credited.json();
  assert.equal(creditedData.orders[0].creditState,'credited_to_game');
  assert.equal(creditedData.orders[0].creditedCoinCents,expected.coinCents);
  const replay=await f.worker.fetch(telegramRequest({
   update_id:3,message:{from:{id:USER},successful_payment:{
    currency:'XTR',total_amount:STARS,invoice_payload:'v:'+orderId,
    telegram_payment_charge_id:charge
   }}
  }),f.env,{});
  assert.equal(replay.status,200);
  const again=await runVariableStarsDeliveryQueue(f.env,{
   now:Date.now()+2000,fetchImpl:f.fakeTelegram
  });
  assert.equal(again.delivered,0);
  assert.deepEqual(f.counts(),{receipts:1,refunds:0});
  assert.deepEqual(f.balance(OTHER),{canonical:10,mirror:10,v:1});
  // Provider refund is represented by another fake StarTransaction, never by
  // a fake client status or a direct game balance mutation.
  f.history.push({id:charge,amount:STARS,
   date:Math.floor(Date.now()/1000)+1,
   receiver:{type:'user',user:{id:USER}}
  });
  const found=await discoverVerifiedStarsRefunds(f.env,{fetchImpl:f.fakeTelegram});
  assert.equal(found.recorded,1);
  const reversed=await reconcileRecordedStarsRefundBatch(f.env,{
   fetchImpl:f.fakeTelegram
  });
  assert.equal(reversed.reversed,1);
  assert.equal(f.balance(USER).canonical,10);
  assert.equal(f.balance(USER).mirror,10);
  assert.deepEqual(f.counts(),{receipts:1,refunds:1});
  const after=await variableStarsApi(apiRequest('history'),f.env,f.fakeTelegram);
  assert.equal((await after.json()).orders[0].creditState,'refund_reversed');
  const duplicate=await reconcileRecordedStarsRefundBatch(f.env,{
   fetchImpl:f.fakeTelegram
  });
  assert.equal(duplicate.selected,0);
  assert.deepEqual(f.counts(),{receipts:1,refunds:1});
  assert.equal(f.calls.refund,0);
  assert.equal(f.calls.unexpected,0);
 }finally{f.close();}
});

test('FORGED INITDATA cannot create a fake Telegram invoice or game credit',async()=>{
 const f=fixture();
 try{
  const forged=new Request(BASE+'/api/stars/variable/checkout',{
   method:'POST',headers:{origin:ORIGIN,'content-type':'application/json'},
   body:JSON.stringify({initData:'forged',amountMinor:AMOUNT,
    requestId:randomUUID()})
  });
  const answer=await f.worker.fetch(forged,f.env,{});
  assert.equal(answer.status,401);
  assert.equal(f.calls.invoice,0);
  assert.deepEqual(f.counts(),{receipts:0,refunds:0});
  assert.equal(f.balance(USER).canonical,10);
 }finally{f.close();}
});
