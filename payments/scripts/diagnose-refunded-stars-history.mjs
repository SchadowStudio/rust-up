// Read-only sanitized Telegram Stars refund evidence diagnostic.
// Does not modify D1 or call refundStarPayment. Never prints bot token,
// transaction IDs, user names, invoice payloads or other transaction parties.
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ACCOUNT='af72e32cb9f1ba99dba07df30fe540fe';
const PAY='06079270-a227-466a-9991-abd4201ec5f6';
const ID='5acaf9ba-f7c3-448c-a1f5-d7dd0c1190ff';
const USER=7390606911;
async function paymentOrder(){
 const token=process.env.CLOUDFLARE_API_TOKEN;
 if(!token||token.length<20)throw Error('cloudflare_token_missing');
 const response=await fetch('https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/d1/database/'+PAY+'/query',{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(25000),
  headers:{authorization:'Bearer '+token,'content-type':'application/json'},
  body:JSON.stringify({sql:"SELECT id,status,telegram_user_id,price_stars,telegram_charge_id FROM rustup_stars_variable_orders WHERE id=?",params:[ID]})
 });
 if(!response.ok)throw Error('cloudflare_read_failed_http_'+response.status);
 const result=await response.json();
 if(!result.success||!result.result?.[0]?.success)throw Error('cloudflare_read_failed');
 const rows=result.result[0].results;
 if(rows.length!==1||rows[0].telegram_user_id!==USER||rows[0].status!=='refunded')throw Error('order_not_refunded');
 return rows[0];
}
async function tg(method,body){
 const token=process.env.RUSTUP_MAIN_BOT_TOKEN;
 if(typeof token!=='string'||!/^[0-9]{5,15}:[A-Za-z0-9_-]{30,}$/.test(token))
  throw Error('main_bot_token_missing');
 const response=await fetch('https://api.telegram.org/bot'+token+'/'+method,{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(25000),
  headers:{'content-type':'application/json'},body:JSON.stringify(body)
 });
 if(!response.ok)throw Error('telegram_http_'+response.status+'_no_secret_output');
 const value=await response.json();
 if(!value.ok)throw Error('telegram_api_'+method+'_failed');
 return value.result;
}
export function diagnoseTransactions(transactions,order){
 if(!Array.isArray(transactions))throw Error('transactions_missing');
 const own=transactions.filter(tx=>tx?.id===order.telegram_charge_id);
 const negatives=transactions.filter(tx=>typeof tx?.amount==='number'&&tx.amount<0);
 return {
  scanned:transactions.length,
  outgoingTransactions:negatives.length,
  originalChargeMatches:own.length,
  matchedTransactionShapes:own.slice(0,5).map(tx=>({
   amount:tx.amount,
   sourcePresent:tx.source!==undefined&&tx.source!==null,
   receiverPresent:tx.receiver!==undefined&&tx.receiver!==null,
   sourceType:typeof tx.source?.type==='string'?tx.source.type:null,
   receiverType:typeof tx.receiver?.type==='string'?tx.receiver.type:null,
   receiverIsOwner:tx.receiver?.user?.id===USER,
   sourceIsOwner:tx.source?.user?.id===USER,
   date:typeof tx.date==='number'?new Date(tx.date*1000).toISOString():null
  })),
  matchingRefundCandidates:own.filter(tx=>tx.amount===-order.price_stars&&
   tx.receiver?.user?.id===USER).length,
  matchingChargeCandidates:own.filter(tx=>tx.amount===order.price_stars&&
   tx.source?.user?.id===USER).length,
  negativeTransactionShapes:negatives.slice(0,5).map(tx=>({
   amount:tx.amount,
   receiverType:tx.receiver?.type??null,
   receiverIsOwner:tx.receiver?.user?.id===USER,
   matchesRefundId:tx.id===order.telegram_charge_id
  }))
 };
}
async function main(){
 const order=await paymentOrder();
 const me=await tg('getMe',{});
 if(me?.username!=='rustuper_bot')throw Error('wrong_bot');
 let transactions=[],complete=false,pages=0;
 for(let offset=0;offset<2000;offset+=100){
  const v=await tg('getStarTransactions',{offset,limit:100});
  if(!Array.isArray(v?.transactions))throw Error('invalid_history');
  transactions.push(...v.transactions);pages++;
  if(v.transactions.length<100){complete=true;break;}
 }
 console.log(JSON.stringify({
  bot:'rustuper_bot',orderId:order.id,orderStatus:order.status,
  refundPriceStars:order.price_stars,complete,pages,
  ...diagnoseTransactions(transactions,order),
  note:'READ ONLY. No refund or game reversal was performed.'
 },null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{console.error('REFUND HISTORY DIAGNOSTIC:',String(e.message||e));process.exitCode=1});
