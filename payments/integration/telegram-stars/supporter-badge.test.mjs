import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHmac} from 'node:crypto';
import {
 SUPPORTER_BADGE_SKU,SUPPORTER_BADGE_DESCRIPTION,SUPPORTER_BADGE_TITLE,
 SUPPORTER_BADGE_CONTENT,grantSupporterBadge,readSupporterBadge
} from './supporter-badge.mjs';
import {createFixedStarsOrder,receiveExistingBotStarsUpdate,existingBotStarsApi}
 from './stars-live-bridge.mjs';
import {issueFixedStarsRefund} from './refunds.mjs';

const folder=path.dirname(fileURLToPath(import.meta.url));
const USER=27654321,ADMIN=12345678;
const BOT_TOKEN='123456789:'+'a'.repeat(35);
const ORIGIN='https://ttzoomrust-hub.github.io';
function database(){
 const sql=new DatabaseSync(':memory:');
 for(const name of [
  'migration.sql','payment-controls-migration.sql','stars-ready-migration.sql',
  'supporter-badge-migration.sql'
 ])sql.exec(readFileSync(path.join(folder,name),'utf8'));
 const make=(statement,args=[])=>{
  const stmt=sql.prepare(statement);
  return {
   first:async()=>stmt.get(...args)||null,
   all:async()=>({results:stmt.all(...args)}),
   run:async()=>({meta:{changes:stmt.run(...args).changes}})
  };
 };
 const db={
  prepare(statement){
   return {bind(...args){return make(statement,args)},
    first:()=>make(statement).first(),all:()=>make(statement).all(),
    run:()=>make(statement).run()};
  },
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
function fixture(){
 const {sql,db}=database();
 sql.prepare('UPDATE rustup_payment_settings '+
  'SET enabled=1,updated_by=?,updated_at_ms=? WHERE channel IN (?,?)')
  .run(ADMIN,Date.now(),'master','stars');
 // 17 Stars is an EXAMPLE INSIDE A TEST. Never seed a production price.
 sql.prepare('INSERT INTO rustup_stars_products '+
  '(sku,title,description,kind,price_stars,enabled) VALUES (?,?,?,?,?,?)')
  .run(SUPPORTER_BADGE_SKU,SUPPORTER_BADGE_TITLE,
   SUPPORTER_BADGE_DESCRIPTION,'fixed_nontransferable',17,1);
 sql.prepare('INSERT INTO rustup_stars_fixed_content(sku,delivery_text) VALUES(?,?)')
  .run(SUPPORTER_BADGE_SKU,SUPPORTER_BADGE_CONTENT);
 const env={BOT_TOKEN,PAYMENTS_DB:db,APP_URL:ORIGIN+'/rust-up/',
  STARS_FIXED_PRODUCTS_ENABLED:'true',STARS_PAYMENT_ENABLED:'true',
  STARS_REFUNDS_ENABLED:'true',PAYMENT_PRODUCTION_ENABLED:'true',
  PAYMENT_ADMIN_IDS:String(ADMIN)};
 const calls=[],fetchTelegram=async(url,options)=>{
  const method=url.slice(url.lastIndexOf('/')+1);
  const body=JSON.parse(options.body);
  calls.push({method,body});
  return {ok:true,async json(){return {ok:true,
   result:method==='createInvoiceLink'
    ?'https://t.me/$test_supporter_checkout_12345678':true};}};
 };
 return {sql,db,env,calls,fetchTelegram};
}
function update(userId,orderId,amount=17,charge='charge-test-supporter'){
 return {message:{from:{id:userId},successful_payment:{
  invoice_payload:orderId,currency:'XTR',total_amount:amount,
  telegram_payment_charge_id:charge
 }}};
}
function auth(userId){
 const values={auth_date:String(Math.floor(Date.now()/1000)),
  user:JSON.stringify({id:userId})};
 const check=Object.entries(values).sort(([a],[b])=>a.localeCompare(b))
  .map(([k,v])=>k+'='+v).join('\n');
 const secret=createHmac('sha256','WebAppData').update(BOT_TOKEN).digest();
 return new URLSearchParams({...values,hash:createHmac('sha256',secret)
  .update(check).digest('hex')}).toString();
}
async function requestBadge(env,userId){
 const response=await existingBotStarsApi(new Request(
  'https://rustup-bot.example.test/api/stars/supporter-badge',{
   method:'POST',headers:{origin:ORIGIN,'content-type':'application/json'},
   body:JSON.stringify({initData:auth(userId)})
  }),env);
 return {status:response.status,body:await response.json()};
}
test('supporter product is a fixed nonwagerable, nontransferable badge',()=>{
 assert.equal(SUPPORTER_BADGE_SKU,'supporter_badge_v1');
 for(const text of [SUPPORTER_BADGE_DESCRIPTION,SUPPORTER_BADGE_CONTENT])
  assert.equal(/cashout|deposit|case[- ]?battle|wager[- ]?balance|random_case/i.test(text),false);
});
test('separate D1 badge grant needs paid XTR charge AND unlocked immutable snapshot',async()=>{
 const {sql,db}=database();
 const id='22222222-3333-4333-8333-555555555555';
 sql.prepare('INSERT INTO rustup_stars_products '+
  '(sku,title,description,kind,price_stars,enabled) VALUES(?,?,?,?,?,?)')
  .run(SUPPORTER_BADGE_SKU,SUPPORTER_BADGE_TITLE,SUPPORTER_BADGE_DESCRIPTION,
   'fixed_nontransferable',17,0);
 sql.prepare('INSERT INTO rustup_stars_orders '+
  '(id,telegram_user_id,sku,price_stars,status,created_at_ms,expires_at_ms) '+
  "VALUES (?,?,?,?, 'checkout_approved',?,?)")
  .run(id,USER,SUPPORTER_BADGE_SKU,17,Date.now(),Date.now()+30000);
 sql.prepare('INSERT INTO rustup_stars_order_content(order_id,delivery_text) VALUES(?,?)')
  .run(id,SUPPORTER_BADGE_CONTENT);
 await assert.rejects(()=>grantSupporterBadge(db,{orderId:id,userId:USER,
  chargeId:'charge-1'}),/supporter_receipt_not_verified/);
 sql.prepare("UPDATE rustup_stars_orders SET status='paid',telegram_charge_id=? WHERE id=?")
  .run('charge-1',id);
 await assert.rejects(()=>grantSupporterBadge(db,{orderId:id,userId:USER,
  chargeId:'charge-1'}),/supporter_entitlement_not_confirmed/);
 assert.equal((await readSupporterBadge(db,USER)).active,false);
 sql.prepare('UPDATE rustup_stars_order_content SET unlocked_at_ms=? WHERE order_id=?')
  .run(Date.now(),id);
 await assert.rejects(()=>grantSupporterBadge(db,{orderId:id,userId:USER+1,
  chargeId:'charge-1'}),/supporter_order_missing/);
 await assert.rejects(()=>grantSupporterBadge(db,{orderId:id,userId:USER,
  chargeId:'forged'}),/supporter_receipt_not_verified/);
 assert.equal((await grantSupporterBadge(db,{orderId:id,userId:USER,
  chargeId:'charge-1'})).active,true);
 assert.equal((await grantSupporterBadge(db,{orderId:id,userId:USER,
  chargeId:'charge-1'})).active,true);
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM rustup_stars_supporter_badges').get().n,1);
 assert.equal((await readSupporterBadge(db,USER)).active,true);
 assert.equal((await readSupporterBadge(db,USER+1)).active,false);
 sql.close();
});
test('simulated exact XTR payment delivers supporter badge, replays once, and refund revokes',async()=>{
 const {sql,db,env,calls,fetchTelegram}=fixture();
 const order=await createFixedStarsOrder(env,USER,SUPPORTER_BADGE_SKU,fetchTelegram);
 assert.equal(order.creditToGame,false);
 let mine=await requestBadge(env,USER);
 assert.equal(mine.status,200);
 assert.equal(mine.body.badge.active,false);
 const id=order.orderId;
 const q={pre_checkout_query:{
  id:'query-supporter-1',invoice_payload:id,
  from:{id:USER},currency:'XTR',total_amount:17
 }};
 assert.equal(await receiveExistingBotStarsUpdate(q,env,fetchTelegram),true);
 assert.equal(calls.filter(x=>x.method==='answerPreCheckoutQuery').at(-1).body.ok,true);
 const paid=update(USER,id);
 assert.equal(await receiveExistingBotStarsUpdate(paid,env,fetchTelegram),true);
 assert.equal(await receiveExistingBotStarsUpdate(paid,env,fetchTelegram),true);
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM rustup_stars_supporter_badges').get().n,1);
 mine=await requestBadge(env,USER);
 assert.equal(mine.body.badge.active,true);
 assert.equal(mine.body.badge.transferable,false);
 assert.equal(mine.body.badge.usableForWagers,false);
 assert.equal((await requestBadge(env,USER+1)).body.badge.active,false);
 const result=await issueFixedStarsRefund(env,{
  adminId:ADMIN,orderId:id,confirmation:'REFUND '+id,
  fetchImpl:fetchTelegram
 });
 assert.equal(result.status,'refunded');
 assert.equal(result.gameBalanceChanged,false);
 const refunded=await readSupporterBadge(db,USER);
 assert.equal(refunded.active,false);
 const badge=sql.prepare('SELECT status,revoked_at_ms FROM rustup_stars_supporter_badges').get();
 assert.equal(badge.status,'revoked');
 assert.ok(badge.revoked_at_ms>0);
 await assert.rejects(()=>grantSupporterBadge(db,{
  orderId:id,userId:USER,chargeId:'charge-test-supporter'
 }),/supporter_receipt_not_verified/);
 assert.equal(calls.filter(x=>x.method==='refundStarPayment').length,1);
 sql.close();
});
test('no badge from mismatched charge, premature receipt, or anonymous Mini App call',async()=>{
 const {sql,db,env,calls,fetchTelegram}=fixture();
 const invoice=await createFixedStarsOrder(env,USER,SUPPORTER_BADGE_SKU,fetchTelegram);
 const bad=update(USER,invoice.orderId,17,'other-charge');
 await receiveExistingBotStarsUpdate(bad,env,fetchTelegram);
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM rustup_stars_supporter_badges').get().n,0);
 const response=await existingBotStarsApi(new Request(
  'https://rustup-bot.example.test/api/stars/supporter-badge',{
   method:'POST',headers:{origin:ORIGIN,'content-type':'application/json'},
   body:JSON.stringify({initData:'forged'})
  }),env,fetchTelegram);
 assert.equal(response.status,401);
 assert.equal(calls.filter(x=>x.method==='createInvoiceLink').length,1);
 sql.close();
});
