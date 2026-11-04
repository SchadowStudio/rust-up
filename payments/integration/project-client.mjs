// Merchant server integration example for RUB / EUR / USD multi-project payments.
// Never ship the project API key to browser JavaScript or a Telegram Mini App.
import {randomUUID} from 'node:crypto';
export class ProjectPaymentsClient {
 constructor({baseUrl,projectId,apiKey}){
  const url=new URL(baseUrl);
  if(url.protocol!=='https:'||url.username||url.password||url.hash)
   throw Error('payment_gateway_must_use_https');
  if(typeof apiKey!=='string'||!/^rup2_[a-f0-9]{64}$/.test(apiKey))
   throw Error('invalid_project_key');
  this.baseUrl=url.origin;
  this.projectId=projectId;
  this.apiKey=apiKey;
 }
 async request(path,method='GET',body,idempotencyKey){
  const request=await fetch(this.baseUrl+path,{
   method,redirect:'error',
   headers:{
    authorization:'Bearer '+this.apiKey,
    'x-project-id':this.projectId,
    ...(body?{'content-type':'application/json'}:{}),
    ...(idempotencyKey?{'idempotency-key':idempotencyKey}:{})
   },
   ...(body?{body:JSON.stringify(body)}:{}),
   signal:AbortSignal.timeout(12000)
  });
  const result=await request.json();
  if(!request.ok||result.ok!==true)
   throw Error('gateway_rejected_'+(result.error||request.status));
  return result;
 }
 // Call from a trusted project backend after recording local expected order.
 // projectOrderRef is a RANDOM opaque UUID, not the player ID or Steam ID.
 createInvoice({sku,asset,projectOrderRef=randomUUID(),idempotencyKey=randomUUID()}){
  return this.request('/v2/invoices','POST',{sku,asset,projectOrderRef},idempotencyKey);
 }
 // Payment-provider-only deposit invoice. RUB/EUR/USD indicate the amount
 // requested by the merchant; the customer transfers the chosen cryptocurrency.
 // How the project accounts for this payment is up to the project, later.
 createDeposit({currency,amountMinor,asset,
  projectOrderRef=randomUUID(),idempotencyKey=randomUUID()}){
  if(!['RUB','EUR','USD'].includes(currency)||
     !Number.isSafeInteger(amountMinor)||amountMinor<100)
   throw Error('invalid_deposit_request');
  return this.request('/v2/deposits','POST',
   {currency,amountMinor,asset,projectOrderRef},idempotencyKey);
 }
 status(invoiceId){
  return this.request('/v2/invoices/'+encodeURIComponent(invoiceId));
 }
 // Manual fallback. Confirmation and actual payment verification stay server-side.
 submitHash(invoiceId,transactionHash){
  return this.request('/v2/invoices/'+encodeURIComponent(invoiceId)+'/verify',
   'POST',{transactionHash});
 }
 events({after=0,afterEventId='',limit=50}={}){
  const qs=new URLSearchParams({after:String(after),afterEventId,limit:String(limit)});
  return this.request('/v2/events?'+qs);
 }
 // Fetch disputed receipts, including cases discovered after an earlier credit.
 // The merchant must investigate and hold fulfillment, never blindly debit.
 incidents(){
  return this.request('/v2/incidents');
 }
}
