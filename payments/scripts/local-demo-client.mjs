// Run while "npm run demo:local" is active in a separate PowerShell.
// All requests go exclusively to 127.0.0.1:3029. No real money.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../',import.meta.url));
const info=JSON.parse(readFileSync(
 path.join(root,'.local-test-results','local-demo-credentials.json'),'utf8'));
const url=new URL(info.url);
if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.port!=='3029'||
   url.pathname!=='/'||url.username||url.password)
 throw Error('refusing_non_local_test_server');
async function query(endpoint,{method='GET',body,admin=false,authorized=true,
 idempotencyKey}={}){
 const headers={'content-type':'application/json'};
 if(admin)headers['x-local-operator']=info.operatorKey;
 if(authorized){
  headers.authorization='Bearer '+info.projectApiKey;
  headers['x-project-id']=info.projectId;
 }
 if(idempotencyKey)headers['idempotency-key']=idempotencyKey;
 const result=await fetch(info.url+endpoint,{
  method,headers,...(body?{body:JSON.stringify(body)}:{}),
  signal:AbortSignal.timeout(5000)
 });
 return {status:result.status,data:await result.json()};
}
try{
 const health=await query('/health',{authorized:false});
 assert.equal(health.data.simulationOnly,true);
 assert.equal(health.data.realPaymentsEnabled,false);
 const denied=await query('/v2/me',{authorized:false});
 assert.equal(denied.status,401);
 const orderRef=randomUUID(),key=randomUUID();
 const payload={currency:'EUR',amountMinor:2500,asset:'ETH',projectOrderRef:orderRef};
 const created=await query('/v2/deposits',{
  method:'POST',body:payload,idempotencyKey:key
 });
 assert.equal(created.status,201,JSON.stringify(created.data));
 assert.equal(created.data.invoice.simulationOnly,true);
 assert.equal(created.data.invoice.receiveAddress,null);
 const id=created.data.invoice.invoiceId;
 const replay=await query('/v2/deposits',{
  method:'POST',body:payload,idempotencyKey:key
 });
 assert.equal(replay.data.replayed,true);
 assert.equal(replay.data.invoice.invoiceId,id);
 const before=await query('/v2/invoices/'+id);
 assert.equal(before.data.invoice.status,'awaiting_payment');
 const confirmed=await query('/demo/invoices/'+id+'/simulate-confirmation',{
  method:'POST',admin:true,authorized:false
 });
 assert.equal(confirmed.data.merchantAck,true,JSON.stringify(confirmed.data));
 const again=await query('/demo/invoices/'+id+'/simulate-confirmation',{
  method:'POST',admin:true,authorized:false
 });
 assert.equal(again.data.replayed,true);
 const paid=await query('/v2/invoices/'+id);
 assert.equal(paid.data.invoice.status,'verified');
 assert.equal(paid.data.invoice.confirmedOnChain,false);
 assert.equal(paid.data.invoice.deliveredToProject,true);
 const events=await query('/v2/events');
 assert.equal(events.data.events.filter(e=>e.eventId==='v2:'+id).length,1);
 const balance=await query('/demo/merchant/balance',{
  admin:true,authorized:false
 });
 const money=balance.data.wallets.find(w=>w.currency==='EUR');
 assert.ok(money);
 assert.ok(money.balance_minor>=2500);
 const duplicate=await query('/v2/deposits',{
  method:'POST',idempotencyKey:key,
  body:{...payload,amountMinor:9999}
 });
 assert.equal(duplicate.status,409);
 console.log('LOCAL DEMO PASS — no blockchain funds, no hosting');
 console.log('Project scoped authentication: PASS');
 console.log('Fake EUR 25.00 invoice and idempotent replay: PASS');
 console.log('Signed simulated callback -> real merchant ledger: PASS');
 console.log('Replay cannot credit the same invoice twice: PASS');
 console.log('Merchant balance (test money only): '+(money.balance_minor/100).toFixed(2)+' EUR');
 console.log('Simulated invoice id: '+id);
 console.log('NOTE: Payment status is NOT real blockchain evidence.');
}catch(error){
 console.error('LOCAL DEMO FAIL:',error.message);
 console.error('Is "npm run demo:local" running in another PowerShell window?');
 process.exitCode=1;
}
