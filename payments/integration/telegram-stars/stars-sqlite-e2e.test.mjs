// Uses real SQLite to exercise the whole (simulated, NO MONEY) D1 state machine:
// signed Mini App identity, catalog, unique invoice, Telegram precheckout,
// successful receipt, entitlement display, replay, /pay emergency-off and refund.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHmac,randomUUID} from 'node:crypto';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {existingBotStarsApi,receiveExistingBotStarsUpdate,createFixedStarsOrder} from './stars-live-bridge.mjs';
import {issueFixedStarsRefund} from './refunds.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const token='123456789:'+ 'a'.repeat(35);
const origin='https://ttzoomrust-hub.github.io';
const userId=87654321,adminId=12345678;
function initData(user=userId){
 const obj={auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id:user})};
 const check=Object.entries(obj).sort(([a],[b])=>a.localeCompare(b))
  .map(([k,v])=>k+'='+v).join('\n');
 const secret=createHmac('sha256','WebAppData').update(token).digest();
 const hash=createHmac('sha256',secret).update(check).digest('hex');
 const params=new URLSearchParams({...obj,hash});
 return params.toString();
}
function database(){
 const sql=new DatabaseSync(':memory:');
 for(const name of ['migration.sql','payment-controls-migration.sql','stars-ready-migration.sql','stars-terms-migration.sql'])
  sql.exec(fs.readFileSync(path.join(here,name),'utf8'));
 sql.prepare('UPDATE rustup_payment_settings SET enabled=1,updated_by=?,updated_at_ms=? WHERE channel IN (?,?)')
  .run(adminId,Date.now(),'master','stars');
 sql.prepare('INSERT INTO rustup_stars_products(sku,title,description,kind,price_stars,enabled) VALUES(?,?,?,?,?,?)')
  .run('fixed_badge','Support Badge','Permanent nontransferable badge','fixed_nontransferable',30,1);
 sql.prepare('INSERT INTO rustup_stars_fixed_content(sku,delivery_text) VALUES (?,?)')
  .run('fixed_badge','Your example supporter badge is active');
 function make(sqlText,args=[]){
  const statement=sql.prepare(sqlText);
  return {
   async first(){return statement.get(...args)||null;},
   async all(){return {results:statement.all(...args)};},
   async run(){return {meta:{changes:statement.run(...args).changes}};}
  };
 }
 const db={
  prepare(query){return {bind(...args){return make(query,args)},
   first(){return make(query).first()},
   all(){return make(query).all()},
   run(){return make(query).run()}}},
  async batch(statements){
   sql.exec('BEGIN IMMEDIATE');
   try{
    const result=[];
    for(const s of statements)result.push(await s.run());
    sql.exec('COMMIT');
    return result;
   }catch(e){sql.exec('ROLLBACK');throw e;}
  }
 };
 return {sql,db};
}
function telegramStub(){
 const calls=[];
 const api=async(url,opts)=>{
  const method=url.slice(url.lastIndexOf('/')+1);
  const body=JSON.parse(opts.body);
  calls.push({method,body});
  const value=method==='createInvoiceLink'?'https://t.me/$stars_test_invoice':
   method==='answerPreCheckoutQuery'||method==='refundStarPayment'?true:{message_id:1};
  return {ok:true,async json(){return {ok:true,result:value}}};
 };
 return {api,calls};
}
function fixture(){
 const {sql,db}=database();
 sql.prepare('INSERT INTO rustup_stars_terms_acceptances ' +
  '(telegram_user_id,terms_version,accepted_at_ms) VALUES(?,?,?)')
  .run(userId,'2026-11-v1',Date.now());
 const env={PAYMENTS_DB:db,BOT_TOKEN:token,
  APP_URL:origin+'/rust-up/',STARS_FIXED_PRODUCTS_ENABLED:'true',
  STARS_PAYMENT_ENABLED:'true',PAYMENT_PRODUCTION_ENABLED:'true',
  STARS_REFUNDS_ENABLED:'true',PAYMENT_ADMIN_IDS:String(adminId),
  STARS_TERMS_VERSION:'2026-11-v1',
  STARS_TERMS_URL:'https://example.org/rustup/terms'};
 const telegram=telegramStub();
 const request=async(path,payload={},who=userId)=>{
  const req=new Request('https://rustup-bot.example.test/api/stars/'+path,{
   method:'POST',
   headers:{origin,'content-type':'application/json'},
   body:JSON.stringify({initData:initData(who),...payload})
  });
  const response=await existingBotStarsApi(req,env,telegram.api);
  return {status:response.status,json:await response.json()};
 };
 return {sql,db,env,telegram,request};
}
test('Telegram-only integration: pay, unlock, replay, owner-bound purchases, refund',async()=>{
 const {sql,db,env,telegram,request}=fixture();
 try{
  const cat=await request('catalog');
  assert.equal(cat.status,200);
  assert.equal(cat.json.checkoutEnabled,true);
  assert.equal(cat.json.products.length,1);
  const invoice=await request('checkout',{sku:'fixed_badge'});
  assert.equal(invoice.status,200);
  assert.equal(invoice.json.stars,30);
  assert.equal(invoice.json.creditToGame,false);
  assert.equal(telegram.calls.filter(x=>x.method==='createInvoiceLink').length,1);
  const dup=await request('checkout',{sku:'fixed_badge'});
  assert.equal(dup.status,200);
  assert.equal(dup.json.replayed,true);
  assert.equal(dup.json.orderId,invoice.json.orderId);
  assert.equal(dup.json.invoiceUrl,invoice.json.invoiceUrl);
  assert.equal(telegram.calls.filter(x=>x.method==='createInvoiceLink').length,1);
  const id=invoice.json.orderId;
  assert.match(id,/^[a-f0-9-]{36}$/);
  const q={pre_checkout_query:{
   id:'checkout-q1',from:{id:userId},currency:'XTR',
   total_amount:30,invoice_payload:id
  }};
  const pre=await receiveExistingBotStarsUpdate(q,env,telegram.api);
  assert.equal(pre,true);
  assert.equal(telegram.calls.at(-1).method,'answerPreCheckoutQuery');
  assert.equal(telegram.calls.at(-1).body.ok,true);
  const msg={message:{
   from:{id:userId},
   successful_payment:{currency:'XTR',total_amount:30,invoice_payload:id,
    telegram_payment_charge_id:'charge-example-1'}
  }};
  assert.equal(await receiveExistingBotStarsUpdate(msg,env,telegram.api),true);
  assert.equal(sql.prepare('SELECT status FROM rustup_stars_orders WHERE id=?').get(id).status,'paid');
  const bought=await request('purchases');
  assert.equal(bought.json.purchases.length,1);
  assert.match(bought.json.purchases[0].delivery_text,/supporter badge/);
  assert.equal((await request('purchases',{},userId+1)).json.purchases.length,0);
  assert.equal(await receiveExistingBotStarsUpdate(msg,env,telegram.api),true);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM rustup_stars_orders WHERE status=?').get('paid').n,1);
  sql.prepare("UPDATE rustup_payment_settings SET enabled=0,updated_by=?,updated_at_ms=? WHERE channel='master'").run(adminId,Date.now());
  assert.equal((await request('catalog')).json.checkoutEnabled,false);
  assert.equal((await request('checkout',{sku:'fixed_badge'})).status,503);
  // A paid receipt still gets idempotently replayed after the admin kill-switch.
  assert.equal(await receiveExistingBotStarsUpdate(msg,env,telegram.api),true);
  const refund=await issueFixedStarsRefund(env,{
   adminId,orderId:id,confirmation:'REFUND '+id,fetchImpl:telegram.api
  });
  assert.equal(refund.status,'refunded');
  assert.equal((await request('purchases')).json.purchases.length,0);
  const refundCalls=telegram.calls.filter(x=>x.method==='refundStarPayment');
  assert.equal(refundCalls.length,1);
  await assert.rejects(()=>issueFixedStarsRefund(env,{
   adminId,orderId:id,confirmation:'REFUND '+id,fetchImpl:telegram.api
  }),/order_not_refundable/);
  assert.equal(telegram.calls.filter(x=>x.method==='refundStarPayment').length,1);
 }finally{sql.close();}
});

test('precheckout denies manipulated Stars amount and missing fixed-content snapshot',async()=>{
 const {sql,env,telegram,request}=fixture();
 try{
  const inv=(await request('checkout',{sku:'fixed_badge'})).json;
  const bad={pre_checkout_query:{
   id:'q-tampered',from:{id:userId},currency:'XTR',
   total_amount:999,invoice_payload:inv.orderId
  }};
  await receiveExistingBotStarsUpdate(bad,env,telegram.api);
  assert.equal(telegram.calls.at(-1).body.ok,false);
  sql.prepare('DELETE FROM rustup_stars_order_content WHERE order_id=?').run(inv.orderId);
  const missing={pre_checkout_query:{...bad.pre_checkout_query,id:'q-no-fulfillment',total_amount:30}};
  await receiveExistingBotStarsUpdate(missing,env,telegram.api);
  assert.equal(telegram.calls.at(-1).body.ok,false);
 }finally{sql.close();}
});


test('Stars checkout never approves an invoice without a persisted invoice URL',async()=>{
 const {sql,env,telegram,request}=fixture();
 try {
  const response=(await request('checkout',{sku:'fixed_badge'})).json;
  const existing=sql.prepare('SELECT invoice_url FROM rustup_stars_invoice_links WHERE order_id=?').get(response.orderId);
  assert.match(existing.invoice_url,/^https:\/\//);
  sql.prepare('DELETE FROM rustup_stars_invoice_links WHERE order_id=?').run(response.orderId);
  await receiveExistingBotStarsUpdate({pre_checkout_query:{
   id:'q-missing-link',from:{id:userId},currency:'XTR',
   total_amount:30,invoice_payload:response.orderId
  }},env,telegram.api);
  assert.equal(telegram.calls.at(-1).method,'answerPreCheckoutQuery');
  assert.equal(telegram.calls.at(-1).body.ok,false);
 }finally{sql.close();}
});

test('Stars second invoice is blocked after Telegram approved an earlier checkout',async()=>{
 const {sql,env,telegram,request}=fixture();
 try{
  const invoice=(await request('checkout',{sku:'fixed_badge'})).json;
  await receiveExistingBotStarsUpdate({pre_checkout_query:{
   id:'q-approved',from:{id:userId},currency:'XTR',
   total_amount:30,invoice_payload:invoice.orderId
  }},env,telegram.api);
  assert.equal(telegram.calls.at(-1).body.ok,true);
  // Even if an operator has to reconcile a delayed receipt and a lock has
  // expired, there must not be a second payable invoice for that good.
  sql.prepare('UPDATE rustup_stars_purchase_locks SET expires_at_ms=0 WHERE order_id=?').run(invoice.orderId);
  const second=await request('checkout',{sku:'fixed_badge'});
  assert.equal(second.status,503);
  assert.equal(telegram.calls.filter(x=>x.method==='createInvoiceLink').length,1);
 }finally{sql.close();}
});

test('invalid or forged Mini App initData cannot create an invoice',async()=>{
 const {sql,env,telegram}=fixture();
 try{
  const req=new Request('https://rustup-bot.example.test/api/stars/checkout',{
   method:'POST',headers:{origin,'content-type':'application/json'},
   body:JSON.stringify({initData:'user=attacker&hash=fake',sku:'fixed_badge'})
  });
  const reply=await existingBotStarsApi(req,env,telegram.api);
  assert.equal(reply.status,401);
  assert.equal(telegram.calls.length,0);
 }finally{sql.close();}
});


test('production checkout is blocked until authorized refund handling is enabled',async()=>{
 const {sql,env,request,telegram}=fixture();
 try{
  env.STARS_REFUNDS_ENABLED='false';
  assert.equal((await request('catalog')).json.checkoutEnabled,false);
  assert.equal((await request('checkout',{sku:'fixed_badge'})).status,503);
  assert.equal(telegram.calls.length,0);
  env.STARS_REFUNDS_ENABLED='true';
  delete env.PAYMENT_ADMIN_IDS;
  assert.equal((await request('catalog')).json.checkoutEnabled,false);
  assert.equal((await request('checkout',{sku:'fixed_badge'})).status,503);
  assert.equal(telegram.calls.length,0);
 }finally{sql.close();}
});

test('fixed Stars incident replay is verified, and conflicting evidence requires investigation',async()=>{
 const {sql,env,telegram}=fixture();
 try{
  const payload=randomUUID();
  const msg=amount=>({message:{from:{id:userId},successful_payment:{
   currency:'XTR',total_amount:amount,invoice_payload:payload,
   telegram_payment_charge_id:'unexpected-charge-fixed-1'
  }}});
  assert.equal(await receiveExistingBotStarsUpdate(msg(30),env,telegram.api),true);
  assert.equal(await receiveExistingBotStarsUpdate(msg(30),env,telegram.api),true);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM rustup_stars_receipt_incidents').get().n,1);
  const evidence=sql.prepare(
   'SELECT invoice_payload,price_stars,reason FROM rustup_stars_receipt_incidents'
  ).get();
  assert.equal(evidence.invoice_payload,payload);
  assert.equal(evidence.price_stars,30);
  assert.equal(evidence.reason,'unmatched_or_mismatched_receipt');
  await assert.rejects(
   ()=>receiveExistingBotStarsUpdate(msg(31),env,telegram.api),
   /stars_receipt_incident_conflict_requires_review/
  );
  assert.equal(sql.prepare('SELECT price_stars FROM rustup_stars_receipt_incidents').get().price_stars,30);
 }finally{sql.close();}
});
