// RUST UP: read-only administrator search across Stars orders and game-ledger refunds.
// Never issues refunds or modifies player balances. Requires a Cloudflare D1-capable token.
const ACCOUNT='af72e32cb9f1ba99dba07df30fe540fe';
const PAY='06079270-a227-466a-9991-abd4201ec5f6';
const GAME='9b0b533f-540a-4a25-a429-70ca8bd4e23d';
const BASE='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/d1/database/';
const args=process.argv.slice(2);
function arg(name){const i=args.indexOf(name);return i<0?null:args[i+1];}
function validDate(value,label,endOfDay=false){
 if(value==null)return null;
 if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(value))throw Error('invalid_'+label+'_use_YYYY-MM-DD');
 const time=Date.parse(value+'T00:00:00.000Z');
 if(!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==value)
  throw Error('invalid_'+label);
 return time+(endOfDay?86400000:0);
}
function strInt(value,name,{min=1,max=Number.MAX_SAFE_INTEGER}={}){
 if(value==null)return null;
 if(!/^[1-9]\\d*$/.test(value))throw Error('invalid_'+name);
 const n=Number(value);
 if(!Number.isSafeInteger(n)||n<min||n>max)throw Error('invalid_'+name);
 return n;
}
const player=strInt(arg('--player'),'player');
const stars=strInt(arg('--stars'),'stars',{max:1000000});
const rub=arg('--rub');
let rubMinor=null;
if(rub!==null){
 if(!/^(?:[1-9]\\d{0,6})(?:\\.\\d{1,2})?$/.test(rub))throw Error('invalid_rub_use_1.83');
 const [a,b='']=rub.split('.');
 rubMinor=Number(a)*100+Number(b.padEnd(2,'0'));
}
const from=validDate(arg('--from'),'from');
const to=validDate(arg('--to'),'to',true);
if(from!==null&&to!==null&&to<=from)throw Error('invalid_date_range');
const status=arg('--status');
const allowed=['all','paid','refunded','pending','checkout_approved','manual_review'];
if(status!==null&&!allowed.includes(status))throw Error('status_must_be_'+allowed.join('_'));
const limit=strInt(arg('--limit'),'limit',{max:100})??50;
if(!player&&stars===null&&rubMinor===null&&from===null&&to===null&&
  status===null)throw Error('Supply at least one filter: --player, --stars, --rub, --from, --to, --status');
const token=process.env.CLOUDFLARE_API_TOKEN;
if(typeof token!=='string'||token.length<20)throw Error('CLOUDFLARE_API_TOKEN_required');
async function d1(database,sql,params=[]){
 const response=await fetch(BASE+database+'/query',{
  method:'POST',redirect:'manual',signal:AbortSignal.timeout(25000),
  headers:{authorization:'Bearer '+token,'content-type':'application/json'},
  body:JSON.stringify({sql,params})
 });
 if(!response.ok)throw Error('cloudflare_d1_http_'+response.status);
 const data=await response.json();
 if(data.success!==true||data.result?.[0]?.success!==true||
    !Array.isArray(data.result[0].results))
  throw Error('cloudflare_d1_query_unavailable');
 return data.result[0].results;
}
const conditions=[],params=[];
if(player!==null){conditions.push('o.telegram_user_id=?');params.push(player);}
if(stars!==null){conditions.push('o.price_stars=?');params.push(stars);}
if(rubMinor!==null){conditions.push('o.requested_amount_minor=?');params.push(rubMinor);}
if(from!==null){conditions.push('o.created_at_ms>=?');params.push(from);}
if(to!==null){conditions.push('o.created_at_ms<?');params.push(to);}
if(status&&status!=='all'){conditions.push('o.status=?');params.push(status);}
const sql=`SELECT o.id,o.telegram_user_id,o.created_at_ms,o.paid_at_ms,
o.price_stars,o.requested_amount_minor,o.status,
q.coin_cents AS frozen_coin_cents,
i.state AS refund_request_state,i.requested_at_ms AS refund_requested_ms,
i.completed_at_ms AS refund_completed_ms,
d.outcome AS refund_reconciliation_outcome
FROM rustup_stars_variable_orders o
LEFT JOIN rustup_stars_variable_credit_quotes q ON q.order_id=o.id
LEFT JOIN rustup_stars_variable_refund_intents i ON i.order_id=o.id
LEFT JOIN rustup_stars_refund_reconciliation_done d ON d.order_id=o.id
WHERE ${conditions.length?conditions.join(' AND '):'1=1'} ORDER BY o.created_at_ms DESC LIMIT ?`;
params.push(limit);
const rows=await d1(PAY,sql,params);
if(!rows.length){console.log('No matching Stars orders.');process.exit(0);}
const ids=rows.map(o=>o.id);
const marks=ids.map(()=>'?').join(',');
const [credits,refunds]=await Promise.all([
 d1(GAME,`SELECT order_id,coin_cents,created_at_ms FROM rustup_game_paid_receipts WHERE source='stars_variable' AND order_id IN (${marks})`,ids),
 d1(GAME,`SELECT order_id,coin_cents,refunded_at_ms FROM rustup_game_paid_refunds WHERE source='stars_variable' AND order_id IN (${marks})`,ids)
]);
const creditMap=new Map(credits.map(o=>[o.order_id,o]));
const refundMap=new Map(refunds.map(o=>[o.order_id,o]));
const utc=ms=>Number.isSafeInteger(ms)&&ms>0?new Date(ms).toISOString():null;
const result=rows.map(o=>({
 orderId:o.id,
 telegramPlayerId:o.telegram_user_id,
 purchasedAtUtc:utc(o.created_at_ms),
 paidAtUtc:utc(o.paid_at_ms),
 starsPaid:o.price_stars,
 rubRequested:(o.requested_amount_minor/100).toFixed(2),
 paymentStatus:o.status,
 coinsCredited:creditMap.has(o.id)?(creditMap.get(o.id).coin_cents/100).toFixed(2):null,
 telegramRefundIntent:o.refund_request_state??null,
 telegramRefundRequestedAtUtc:utc(o.refund_requested_ms),
 telegramRefundCompletedAtUtc:utc(o.refund_completed_ms),
 gameCoinsReversed:refundMap.has(o.id)?(refundMap.get(o.id).coin_cents/100).toFixed(2):null,
 gameRefundAtUtc:utc(refundMap.get(o.id)?.refunded_at_ms),
 reconciliationOutcome:o.refund_reconciliation_outcome??null,
 needsReview:o.status==='manual_review'||(o.status==='refunded'&&
   creditMap.has(o.id)&&!refundMap.has(o.id))
}));
console.log(JSON.stringify({results:result,count:result.length,
 note:'Read only. Date filter applies to order creation (UTC); refund times are shown per result.'},null,2));
