// RUST UP live Stars readiness: read-only Cloudflare and synthetic payment tests.
// No real invoices, production game balances, payment gates, or live D1 writes.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const ACCOUNT='af72e32cb9f1ba99dba07df30fe540fe';
const WORKER='rustup-bot';
const PAY='06079270-a227-466a-9991-abd4201ec5f6';
const GAME='9b0b533f-540a-4a25-a429-70ca8bd4e23d';
const BASE='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT;
const VERSION='755be20f-9735-4f19-8182-275e6361a46b';
const token=process.env.CLOUDFLARE_API_TOKEN;
if(typeof token!=='string'||token.length<15)
 throw Error('Cloudflare login required. Use wrangler auth token.');
async function req(uri,method='GET',body){
 const r=await fetch(BASE+uri,{method,redirect:'error',
  headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},
  body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('Cloudflare API unavailable: HTTP '+r.status);
 const result=await r.json();
 if(result?.success!==true)throw Error('Cloudflare API reported failure');
 return result.result;
}
async function query(db,sql){
 const rows=await req('/d1/database/'+db+'/query','POST',{sql});
 if(!Array.isArray(rows)||rows[0]?.success!==true||
    !Array.isArray(rows[0].results))throw Error('Incomplete D1 response');
 return rows[0].results;
}
const [deploy,settings,paymentControls,release,orders,orderLedger,gameReceipts,refundMarkers,accountMirrors]=await Promise.all([
 req('/workers/scripts/'+WORKER+'/deployments'),
 req('/workers/scripts/'+WORKER+'/settings'),
 query(PAY,'SELECT channel,enabled FROM rustup_payment_settings ORDER BY channel'),
 query(GAME,'SELECT enabled FROM rustup_game_paid_release_control WHERE id=1'),
 query(PAY,'SELECT status,COUNT(*) total FROM rustup_stars_variable_orders GROUP BY status'),
 query(PAY,"SELECT o.id,o.status,o.price_stars,q.coin_cents AS frozen_coin_cents,COALESCE(j.state,'none') delivery FROM rustup_stars_variable_orders o LEFT JOIN rustup_stars_variable_credit_quotes q ON q.order_id=o.id LEFT JOIN rustup_stars_variable_delivery_jobs j ON j.order_id=o.id ORDER BY o.created_at_ms LIMIT 100"),
 query(GAME,"SELECT r.order_id,r.coin_cents,f.coin_cents AS reversed_coin_cents FROM rustup_game_paid_receipts r LEFT JOIN rustup_game_paid_refunds f ON f.source=r.source AND f.order_id=r.order_id WHERE r.source='stars_variable' LIMIT 100"),
 query(PAY,"SELECT order_id,outcome FROM rustup_stars_refund_reconciliation_done LIMIT 100"),
 query(GAME,"SELECT a.id,CAST(json_extract(a.state,'$.balance') AS REAL) canonical,u.balance mirror FROM accounts a JOIN users u ON u.id=a.id WHERE EXISTS (SELECT 1 FROM rustup_game_paid_receipts r WHERE r.telegram_user_id=a.id AND r.source='stars_variable') LIMIT 100")
]);
const version=deploy?.deployments?.[0]?.versions?.[0]?.version_id;
const vars=Object.fromEntries((settings?.bindings||[]).filter(x=>x.type==='plain_text')
 .map(x=>[x.name,x.text]));
const secrets=new Set((settings?.bindings||[]).filter(x=>x.type==='secret_text')
 .map(x=>x.name));
const channel=Object.fromEntries(paymentControls.map(x=>[x.channel,x.enabled]));
const blockers=['Pilot secret values are masked; read-only API cannot prove pilot checkout readiness'];
const receiptMap=new Map(gameReceipts.map(x=>[x.order_id,x]));
const markerMap=new Map(refundMarkers.map(x=>[x.order_id,x.outcome]));
if(gameReceipts.length!==receiptMap.size)blockers.push('Duplicate Stars game receipts detected');
if(refundMarkers.length!==markerMap.size)blockers.push('Duplicate Stars refund markers detected');
for(const order of orderLedger){
 const receipt=receiptMap.get(order.id);
 const marker=markerMap.get(order.id);
 if(order.status==='paid'&&!(order.frozen_coin_cents>0))
  blockers.push('Paid order has no frozen quote');
 if(receipt&&receipt.coin_cents!==order.frozen_coin_cents)
  blockers.push('Game credit differs from immutable frozen quote');
 if(order.status==='paid'&&order.delivery==='delivered'&&!receipt)
  blockers.push('Delivery marked delivered without game receipt');
 if(order.status==='refunded'&&receipt&&receipt.reversed_coin_cents!==receipt.coin_cents)
  blockers.push('Refunded order has game credit but no reversal');
 if(order.status==='refunded'&&receipt&&marker!=='reversed')
  blockers.push('Refunded order reversal missing terminal marker');
 if(order.status==='refunded'&&!receipt&&marker&&marker!=='no_game_credit')
  blockers.push('Refunded no-credit order has inconsistent marker');
 if(order.status==='refunded'&&order.delivery==='pending')
  blockers.push('Refunded order is still pending delivery');
}
for(const receipt of gameReceipts){
 if(!orderLedger.some(x=>x.id===receipt.order_id))
  blockers.push('Game receipt missing matching Stars order');
}
for(const row of accountMirrors){
 if(!Number.isFinite(row.canonical)||!Number.isFinite(row.mirror)||
    Math.abs(row.canonical-row.mirror)>0.000001)
  blockers.push('Existing credited game account balance mirror mismatch');
}
if(orders.reduce((n,x)=>n+x.total,0)>orderLedger.length||
   gameReceipts.length>=100||refundMarkers.length>=100||accountMirrors.length>=100)
 blockers.push('Audit pagination incomplete: more than 100 records');
const accounting={ordersChecked:orderLedger.length,
 creditedAccountsChecked:accountMirrors.length,
 gameReceiptsChecked:gameReceipts.length,
 refundedReceipts:gameReceipts.filter(x=>x.reversed_coin_cents===x.coin_cents).length,
 refundedOrderCount:orderLedger.filter(x=>x.status==='refunded').length,
 refundMarkersChecked:refundMarkers.length,
 allHistoricalEntriesConsistent:!blockers.some(x=>
 /order|receipt|refund|delivery|marker|quote|account|audit|credit/i.test(x))
};
if(version!==VERSION)blockers.push('Worker version changed: re-review update');
for(const key of ['STARS_PAYMENT_ENABLED','STARS_VARIABLE_TOPUP_ENABLED']){
 if(vars[key]!=='true')blockers.push(key+' is OFF');
}
if(vars.PAYMENT_PRODUCTION_ENABLED!=='true')blockers.push('Payment production gate is OFF');
if(vars.PAYMENT_WALLET_STRICT_MODE!=='true')blockers.push('Strict wallet gate is OFF');
if(vars.STARS_VARIABLE_CREDIT_LEDGER_READY!=='true')blockers.push('Credit ledger gate is OFF');
if(channel.master!==1)blockers.push('Payment DB master channel is OFF');
if(channel.stars!==1)blockers.push('Payment DB stars channel is OFF');
if(release.length!==1||release[0].enabled!==1)
 blockers.push('Canonical game account release gate is OFF');
for(const secret of ['STARS_GAME_CREDIT_SETTLEMENT_ENABLED',
 'STARS_GAME_CREDIT_REFUND_RECONCILIATION_ENABLED',
 'STARS_VARIABLE_CHECKOUT_RELEASE_APPROVED',
 'STARS_VARIABLE_PILOT_USER_IDS','STARS_VARIABLE_PILOT_MAX_STARS',
 'STARS_VARIABLE_PILOT_EXPIRES_AT_MS','STARS_VARIABLE_PILOT_PHASE']){
 if(!secrets.has(secret))blockers.push('Required secret not configured: '+secret);
}
const tests=[
 'payments/integration/telegram-stars/stars-variable-webhook-sqlite-e2e.test.mjs',
 'payments/integration/telegram-stars/complete-synthetic-payment-to-game.test.mjs',
 'payments/integration/telegram-stars/stars-delivery-queue.test.mjs',
 'payments/integration/account-credit-ledger/verified-stars-game-credit.test.mjs',
 'payments/integration/account-credit-ledger/verified-stars-game-refund.test.mjs',
 'payments/integration/account-credit-ledger/freeze-verified-stars-game-quote.test.mjs',
 'payments/integration/telegram-stars/stars-variable-webhook-wrapper.test.mjs'
];
const result=spawnSync(process.execPath,['--test',...tests],{
 cwd:ROOT,stdio:'inherit',timeout:120000,env:process.env});
const offlinePassed=result.status===0&&!result.error;
const report={
 mode:'READ_ONLY_NO_REAL_CHARGE',worker:WORKER,version,
 starsRateRubPerStar:Number(vars.STARS_RUB_MINOR_PER_STAR_NUM)/
  Number(vars.STARS_RUB_MINOR_PER_STAR_DEN)/100,
 channels:channel,gameReleaseApproved:release[0]?.enabled===1,
 historicalAccounting:accounting,
 ordersByStatus:orders,offlineTestsPassed:offlinePassed,
 liveOneStarPilotReady:false,
 secretValuesVerified:false,
 blockers
};
console.log('\\nRUST UP LIVE STARS PAYMENT READINESS');
console.log(JSON.stringify(report,null,2));
console.log('No live charges, invoices, wallet credits, DB updates or flag changes performed.');
if(!offlinePassed)process.exitCode=2;
else if(blockers.length)process.exitCode=3;
