import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {isStarsSupportCommand,handleStarsSupportCommand} from './stars-payment-support.mjs';
function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec(readFileSync(new URL('./stars-payment-support.sql',import.meta.url),'utf8'));
 const env={BOT_TOKEN:'123456789:'+('a'.repeat(25)),PAYMENTS_DB:{
  prepare(sql){const stmt=db.prepare(sql);return {bind(...params){return {
   async run(){return {meta:{changes:stmt.run(...params).changes}};},
   async first(){return stmt.get(...params)||null;}
  };}};}
 }};
 const payload={update_id:987654321,message:{text:'/paysupport charge not delivered',
  date:1794000000,from:{id:12345678},
  chat:{id:12345678,type:'private'}}};
 let sent=0;
 const mock=async(url,options)=>{
  assert.match(url,/sendMessage$/);
  assert.equal(options.method,'POST');
  const body=JSON.parse(options.body);
  assert.equal(body.chat_id,12345678);
  assert.match(body.text,/Ticket #987654321/);
  sent++;
  return {ok:true,async json(){return {ok:true,result:{message_id:55}};}};
 };
 return {db,env,payload,mock,get sent(){return sent;}};
}
test('private /paysupport is recorded only once and gets a ticket reference',async()=>{
 const f=fixture();
 try{
  assert.equal(isStarsSupportCommand(f.payload),true);
  assert.equal(await handleStarsSupportCommand(f.payload,f.env,f.mock),true);
  assert.equal(await handleStarsSupportCommand(f.payload,f.env,f.mock),true);
  assert.equal(f.db.prepare('SELECT count(*) n FROM rustup_stars_support_requests').get().n,1);
  assert.equal(f.db.prepare('SELECT description FROM rustup_stars_support_requests').get().description,'charge not delivered');
  assert.equal(f.sent,2);
 }finally{f.db.close();}
});
test('support does not record if DB missing and does not process unrelated messages',async()=>{
 const f=fixture();
 try{
  assert.equal(isStarsSupportCommand({...f.payload,message:{...f.payload.message,text:'/start'}}),false);
  await assert.rejects(()=>handleStarsSupportCommand(f.payload,{BOT_TOKEN:f.env.BOT_TOKEN},f.mock),
   /stars_support_unavailable/);
  assert.equal(f.db.prepare('SELECT count(*) n FROM rustup_stars_support_requests').get().n,0);
 }finally{f.db.close();}
});
test('forged update ID collision refuses to acknowledge support as a different user',async()=>{
 const f=fixture();
 try{
  f.db.prepare('INSERT INTO rustup_stars_support_requests VALUES (?,?,?,?,?)')
   .run(987654321,5678,1794000000000,'','open');
  await assert.rejects(()=>handleStarsSupportCommand(f.payload,f.env,f.mock),
   /stars_support_ticket_conflict/);
  assert.equal(f.sent,0);
 }finally{f.db.close();}
});
