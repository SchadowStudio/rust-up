import test from 'node:test';
import assert from 'node:assert/strict';
import {handleMulti} from '../src/multi/api.js';
import {digestHex} from '../src/multi/keys.js';
const projectId='a14cb820-76f0-44f9-850d-30b5d2c314ac';
const invoiceId='b14cb820-76f0-44f9-850d-30b5d2c314ac';
const key='rup2_'+'b'.repeat(64);
function req(path,method='GET',body){
 return new Request('https://gateway.example'+path,{
  method,
  headers:{authorization:'Bearer '+key,'x-project-id':projectId,
   ...(body?{'content-type':'application/json','idempotency-key':invoiceId}:{})},
  ...(body?{body:JSON.stringify(body)}:{})
 });
}
async function mock(){
 const expected=await digestHex(key);
 let queried=0,written=0;
 const record={id:invoiceId,project_id:projectId,
  project_order_ref:invoiceId,fiat:'RUB',amount_minor:200,
  asset:'ETH',chain:'ethereum',receive_address:'0x'+'a'.repeat(40),
  amount_atomic:'1000',created_at_ms:1000,expires_at_ms:2000000,
  status:'expired',delivered:null};
 const db={prepare(sql){queried++;return {bind(...args){
  return {
   async all(){
    if(sql.includes('JOIN v2_api_keys'))
     return {results:[{id:projectId,status:'active',secret_sha256:expected}]};
    if(sql.includes('FROM v2_delivery_outbox'))
     return {results:[]};
    throw Error('unexpected_list_query:'+sql);
   },
   async first(){
    if(sql.includes('FROM v2_invoices i')&&sql.includes('LEFT JOIN'))
     return args[1]===invoiceId?record:null;
    throw Error('unexpected_invoice_query:'+sql);
   },
   async run(){written++;throw Error('write_should_not_happen')}
  };
 }}}};
 return {db,getQueries:()=>queried,getWrites:()=>written};
}
test('paused provider retains all project status and event APIs',async()=>{
 const fake=await mock(),env={DB:fake.db,MULTI_LIVE_ENABLED:'false'};
 const me=await handleMulti(req('/v2/me'),env);
 assert.equal(me.status,200);
 const inv=await handleMulti(req('/v2/invoices/'+invoiceId),env);
 assert.equal(inv.status,200);
 assert.equal((await inv.json()).invoice.status,'expired');
 const events=await handleMulti(req('/v2/events'),env);
 assert.equal(events.status,200);
 assert.deepEqual((await events.json()).events,[]);
 const pause=await handleMulti(req('/v2/deposits','POST',{
  currency:'EUR',amountMinor:1000,asset:'BTC',projectOrderRef:invoiceId
 }),env);
 assert.equal(pause.status,503);
 assert.equal(fake.getWrites(),0);
});
test('status API does not leak records without valid merchant key even during pause',async()=>{
 const fake=await mock();
 const response=await handleMulti(new Request('https://gateway.example/v2/invoices/'+invoiceId,{
  headers:{authorization:'Bearer wrong','x-project-id':projectId}
 }),{DB:fake.db,MULTI_LIVE_ENABLED:'false'});
 assert.equal(response.status,401);
});
