// Isolated ONE STAR LIVE Telegram payment test: a fixed non-transferable
// digital test receipt, NOT RUST UP game coins, cases, upgrades or battles.
// Requires a dedicated production BotFather bot with NO webhook.
// All actions are initiated locally and charged by Telegram only after the
// owner voluntarily pays the invoice. Explicit refund supported.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const PRIVATE=path.join(ROOT,'.private','stars-one-star-live-proof');
const STATE=path.join(PRIVATE,'receipt.json');
const [action,rawId]=process.argv.slice(2);
const userId=Number(rawId);
const TOKEN=process.env.TELEGRAM_LIVE_TEST_BOT_TOKEN;
function assert(b,msg){if(!b)throw Error(msg);}
const validId=Number.isSafeInteger(userId)&&userId>0;
function validate(){
 assert(validId,'valid_telegram_user_id_required');
 assert(/^[0-9]+:[A-Za-z0-9_-]{20,}$/.test(TOKEN||''),'dedicated_telegram_bot_token_required');
}
async function api(method,data={}){
 const response=await fetch('https://api.telegram.org/bot'+TOKEN+'/'+method,{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify(data),redirect:'manual',
  signal:AbortSignal.timeout(30000)
 });
 if(!response.ok)throw Error('telegram_http_'+response.status);
 const parsed=await response.json();
 if(parsed.ok!==true)throw Error('telegram_rejected_'+method);
 return parsed.result;
}
async function read(){
 try{
  const state=JSON.parse(await fs.readFile(STATE,'utf8'));
  assert(state.userId===userId,'test_account_mismatch');
  return state;
 }catch(e){if(e.code==='ENOENT')return null;throw e;}
}
async function store(record){
 await fs.mkdir(PRIVATE,{recursive:true,mode:0o700});
 const temp=STATE+'.'+process.pid+'.tmp';
 await fs.writeFile(temp,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
 await fs.rename(temp,STATE);
}
async function preflight(){
 const me=await api('getMe');
 assert(me.is_bot===true,'bot_identity_unverified');
 const webhook=await api('getWebhookInfo');
 assert(!webhook.url,'test_bot_must_not_have_webhook');
 return me.username;
}
async function purchase(){
 const botName=await preflight();
 assert(botName!=='rustuper_bot','never_use_production_rustup_bot');
 assert(!await read(),'existing_live_proof_record_resolve_before_repeat');
 // No invoice before initial local evidence exists.
 const orderId=randomUUID();
 const expires=Date.now()+10*60*1000;
 const order={version:1,userId,bot:botName,orderId,expires,
  status:'created',chargeId:null,lastUpdateId:null,createdAt:Date.now()};
 await store(order);
 let link;
 try {
  link=await api('createInvoiceLink',{
   title:'Test digital receipt',
   description:'One non-transferable test receipt, no game funds or prizes.',
   payload:'proof:'+orderId,currency:'XTR',
   prices:[{label:'Test receipt',amount:1}]
  });
 }catch(e){
  order.status='invoice_failed';await store(order);throw e;
 }
 assert(typeof link==='string'&&/^https:\/\/t\.me\/\$[A-Za-z0-9_-]+$/.test(link),
  'telegram_invoice_url_invalid');
 order.status='invoice_created';await store(order);
 console.log('LIVE Telegram production test: 1 Star, fixed non-transferable receipt.');
 console.log('Bot: @'+botName);
 console.log('ONLY Telegram ID '+userId+' is allowed to pay.');
 console.log('Open and PAY this exact Telegram invoice, while this command is running:');
 console.log(link);
 console.log('Waiting for Telegram verified pre-checkout and successful_payment...');
 await watch(order);
}
async function watch(order,{resume=false}={}){
 let offset=Number.isSafeInteger(order.lastUpdateId)?order.lastUpdateId+1:0;
 const deadline=resume?Date.now()+5*60*1000:order.expires+120000;
 while(Date.now()<deadline){
  const updates=await api('getUpdates',{
   offset,timeout:15,limit:30,allowed_updates:['pre_checkout_query','message']
  });
  assert(Array.isArray(updates),'invalid_bot_updates');
  for(const event of updates){
   const uid=event.update_id;
   if(!Number.isSafeInteger(uid))continue;
   if(uid<offset)continue;
   const query=event.pre_checkout_query;
   if(query){
    const allowed=query.from?.id===userId&&
     query.invoice_payload==='proof:'+order.orderId&&query.currency==='XTR'&&
     query.total_amount===1&&Date.now()<order.expires&&
     ['invoice_created','checkout_approved'].includes(order.status);
    // Telegram requires answerPreCheckoutQuery in 10 seconds.
    await api('answerPreCheckoutQuery',{
     pre_checkout_query_id:query.id,ok:allowed,
     ...(allowed?{}:{error_message:'Test invoice unavailable or expired.'})
    });
    if(allowed){order.status='checkout_approved';order.checkoutAt=Date.now();}
   }
   const msg=event.message;
   const paid=msg?.successful_payment;
   if(paid&&paid.invoice_payload==='proof:'+order.orderId){
    const verified=msg.from?.id===userId&&
     paid.currency==='XTR'&&paid.total_amount===1&&
     typeof paid.telegram_payment_charge_id==='string'&&
     paid.telegram_payment_charge_id.length>=8&&
     paid.telegram_payment_charge_id.length<=256&&
     order.status==='checkout_approved';
    if(!verified){
     order.status='manual_review';order.chargeId=paid.telegram_payment_charge_id||null;
     order.lastUpdateId=uid;await store(order);
     throw Error('unexpected_paid_receipt_requires_manual_review');
    }
    if(order.chargeId&&order.chargeId!==paid.telegram_payment_charge_id){
     order.status='manual_review';order.lastUpdateId=uid;await store(order);
     throw Error('conflicting_charge_manual_review');
    }
    order.chargeId=paid.telegram_payment_charge_id;
    order.paidAt=Date.now();
    order.status='paid';
    console.log('SUCCESS: Telegram confirms a real 1-Star charge.');
    console.log('Test receipt issued to your dedicated test account; no RUST UP wallet affected.');
   }
   order.lastUpdateId=uid;await store(order);
   offset=uid+1;
   if(order.status==='paid')return;
  }
 }
 console.log('Invoice waiting period ended. Check status before retrying any payment.');
}
async function refund(){
 await preflight();
 const order=await read();
 assert(order&&order.bot!=='rustuper_bot','no_dedicated_test_record');
 assert(order.status==='paid'&&order.chargeId,'only_recorded_paid_invoice_refundable');
 // Record intent FIRST, preventing repeat of external refund if process crashes.
 order.status='refund_sent_unconfirmed';await store(order);
 try{
  const ok=await api('refundStarPayment',{
   user_id:userId,telegram_payment_charge_id:order.chargeId
  });
  if(ok!==true)throw Error('refund_rejected');
  order.status='refunded';order.refundedAt=Date.now();await store(order);
  console.log('SUCCESS: Telegram confirmed 1-Star refund.');
 }catch(e){
  console.error('REFUND NEEDS MANUAL VERIFICATION. Do not retry blindly.');
  throw Error('refund_result_uncertain');
 }
}
async function main(){
 assert(['purchase','listen','refund','status'].includes(action||''),'Action: purchase|listen|status|refund');
 assert(validId,'valid_telegram_user_id_required');
 if(action==='status'){
  const order=await read();
  console.log(JSON.stringify(order?{
   status:order.status,userId:order.userId,orderId:order.orderId,
   bot:order.bot,paidAt:order.paidAt||null,refundedAt:order.refundedAt||null
  }:{status:'not_started'},null,2));
  return;
 }
 validate();
 if(action==='purchase')await purchase();
 else if(action==='listen'){
  const order=await read();
  assert(order&&['invoice_created','checkout_approved'].includes(order.status),
   'no_unresolved_invoice_to_listen_for');
  assert(order.bot===await preflight(),'wrong_dedicated_test_bot');
  console.log('Resuming invoice listener. No new invoice will be created.');
  await watch(order,{resume:true});
 }else await refund();
}
main().catch(e=>{
 console.error('ONE-STAR TEST STOPPED:',String(e.message||'unknown').slice(0,110));
 process.exitCode=1;
});
