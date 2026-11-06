// RUST UP — fail-closed live Stars activation preparation report.
// READ ONLY. Never creates invoices, changes Worker settings, credits players,
// or switches financial release controls. Do not paste Cloudflare tokens anywhere.
const BASE='https://api.cloudflare.com/client/v4';
const ACCOUNT='af72e32cb9f1ba99dba07df30fe540fe';
const WORKER='rustup-bot';
const GAME_DB='9b0b533f-540a-4a25-a429-70ca8bd4e23d';
const PAY_DB='06079270-a227-466a-9991-abd4201ec5f6';
const gates=[
 'PAYMENT_PRODUCTION_ENABLED','PAYMENT_WALLET_STRICT_MODE',
 'STARS_PAYMENT_ENABLED','STARS_VARIABLE_TOPUP_ENABLED',
 'STARS_VARIABLE_CREDIT_LEDGER_READY',
 'STARS_GAME_CREDIT_SETTLEMENT_ENABLED',
 'STARS_GAME_CREDIT_REFUND_RECONCILIATION_ENABLED',
 'STARS_VARIABLE_CHECKOUT_RELEASE_APPROVED',
 'STARS_REFUNDS_ENABLED'
];
async function request(token,path,sql=null){
 const r=await fetch(BASE+path,{
  method:sql===null?'GET':'POST',
  redirect:'manual',signal:AbortSignal.timeout(30000),
  headers:{authorization:'Bearer '+token,...(sql===null?{}:{'content-type':'application/json'})},
  ...(sql===null?{}:{body:JSON.stringify({sql})})
 });
 if(!r.ok)throw Error('cloudflare_http_'+r.status);
 const v=await r.json();
 if(v.success!==true)throw Error('cloudflare_api_failed');
 return v.result;
}
const q=(id,sql)=>'/accounts/'+ACCOUNT+'/d1/database/'+id+'/query';
async function rows(token,id,sql){
 const r=await request(token,q(id,sql),sql);
 if(!Array.isArray(r)||!Array.isArray(r[0]?.results))throw Error('d1_results_unavailable');
 return r[0].results;
}
function check(name,pass,reason){return {name,pass:pass===true,reason};}
export async function inspectStarsActivation(token){
 if(typeof token!=='string'||token.length<20)throw Error('cloudflare_token_required');
 const base='/accounts/'+ACCOUNT+'/workers/scripts/'+WORKER;
 const [settings,deploy,gameTables,paymentTables,release,controls,counts]=await Promise.all([
  request(token,base+'/settings'),
  request(token,base+'/deployments'),
  rows(token,GAME_DB,"SELECT name,type FROM sqlite_master WHERE type IN ('table','trigger') AND name LIKE 'rustup_game_paid_%'"),
  rows(token,PAY_DB,"SELECT name,type FROM sqlite_master WHERE type IN ('table','trigger') AND (name LIKE 'rustup_stars_variable_%' OR name='rustup_payment_settings')"),
  rows(token,GAME_DB,'SELECT enabled,approval_reference,reviewed_at_ms FROM rustup_game_paid_release_control WHERE id=1'),
  rows(token,PAY_DB,'SELECT channel,enabled FROM rustup_payment_settings ORDER BY channel'),
  rows(token,PAY_DB,"SELECT (SELECT count(*) FROM rustup_stars_variable_orders WHERE status IN ('paid','checkout_approved','manual_review')) AS review_orders,(SELECT count(*) FROM rustup_stars_receipt_incidents) AS incidents,(SELECT count(*) FROM rustup_stars_variable_delivery_jobs WHERE state IN ('retry','manual_review')) AS delivery_problems")
 ]);
 const b=new Map(settings.bindings.map(x=>[x.name,x]));
 const names=a=>new Set(a.map(x=>x.name));
 const gt=names(gameTables),pt=names(paymentTables);
 const neededGame=['rustup_game_paid_receipts','rustup_game_paid_refunds',
  'rustup_game_paid_release_control','rustup_game_paid_receipts_apply',
  'rustup_game_paid_receipts_preflight','rustup_game_paid_refunds_apply',
  'rustup_game_paid_refunds_preflight','rustup_game_paid_refunds_verify'];
 const neededPay=['rustup_stars_variable_orders',
  'rustup_stars_variable_credit_quotes','rustup_stars_variable_delivery_jobs',
  'rustup_stars_variable_refund_intents','rustup_payment_settings'];
 const allDb=release.length===1&&controls.length===3&&counts.length===1;
 const readiness=[
  check('trusted_secrets',b.get('BOT_TOKEN')?.type==='secret_text'&&b.get('WEBHOOK_SECRET')?.type==='secret_text','Bot and secret webhook bindings must be present'),
  check('correct_database_bindings',b.get('DB')?.id===GAME_DB&&b.get('PAYMENTS_DB')?.id===PAY_DB,'Game and payment D1 must be separate and correctly bound'),
  check('game_paid_schema',neededGame.every(n=>gt.has(n)),'All paid-credit and refund trigger/table objects must exist'),
  check('stars_payment_schema',neededPay.every(n=>pt.has(n)),'Orders, frozen quotes, refund evidence and delivery jobs must exist'),
  check('runtime_switches',allDb&&controls.every(x=>['master','stars','crypto'].includes(x.channel)&&[0,1].includes(x.enabled)),'Three payment settings rows required'),
  check('no_payment_incidents',allDb&&Object.values(counts[0]).every(v=>v===0),'Paid/approved/manual review orders, incidents and retries require reconciliation'),
  check('game_release_record',allDb&&release[0].enabled===1&&typeof release[0].approval_reference==='string'&&release[0].approval_reference.length>=8&&Number.isSafeInteger(release[0].reviewed_at_ms)&&release[0].reviewed_at_ms>0,'Reviewed release control must be explicitly approved'),
  ...gates.map(n=>check(n,b.get(n)?.type==='plain_text'&&b.get(n)?.text==='true',b.has(n)?'Currently not enabled':'Missing Worker setting'))
 ];
 return {
  mode:'READ_ONLY_ACTIVATION_PREPARATION',
  version:deploy?.deployments?.[0]?.versions?.[0]?.version_id??null,
  checks:readiness,
  passing:readiness.filter(x=>x.pass).length,total:readiness.length,
  missing:readiness.filter(x=>!x.pass).map(x=>x.name),
  realPaymentActivationPerformed:false,
  note:'Passing configuration checks alone does not prove an end-to-end live charge, settlement and refund. Do not switch public checkout on without independent review.'
 };
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1].replace(/\\/g,'/')).href){
 try{
  const report=await inspectStarsActivation(process.env.CLOUDFLARE_API_TOKEN);
  console.log(JSON.stringify(report,null,2));
 }catch(error){
  console.error('STARS ACTIVATION CHECK BLOCKED:',String(error?.message||'unavailable'));
  process.exitCode=1;
 }
}
