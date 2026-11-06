// Safe payment operator controls: status and emergency stop.
// Does not start a charge. Explicitly refuses unsafe activation.
const ACCOUNT='af72e32cb9f1ba99dba07df30fe540fe';
const PD='06079270-a227-466a-9991-abd4201ec5f6';
const GD='9b0b533f-540a-4a25-a429-70ca8bd4e23d';
const BASE='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT;
const SCRIPT=BASE+'/workers/scripts/rustup-bot';
const flags=['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
'PAYMENT_WALLET_STRICT_MODE','STARS_REFUNDS_ENABLED',
'STARS_GAME_CREDIT_SETTLEMENT_ENABLED',
'STARS_GAME_CREDIT_REFUND_RECONCILIATION_ENABLED',
'STARS_VARIABLE_CHECKOUT_RELEASE_APPROVED'];
async function api(path,method='GET',body){
 const token=process.env.CLOUDFLARE_API_TOKEN;
 if(typeof token!=='string'||token.length<20)throw Error('Cloudflare auth missing');
 const res=await fetch(path,{method,redirect:'manual',signal:AbortSignal.timeout(25000),
 headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},
 ...(body?{body:JSON.stringify(body)}:{})});
 if(!res.ok)throw Error('cloudflare_http_'+res.status);
 if(path.endsWith('/content/v2'))return await res.text();
 const obj=await res.json();
 if(obj.success!==true)throw Error('cloudflare_api_error');
 return obj.result;
}
async function sql(db,statement){
 const r=await api(BASE+'/d1/database/'+db+'/query','POST',{sql:statement});
 if(!Array.isArray(r)||!Array.isArray(r[0]?.results))throw Error('D1 query failed');
 return r[0].results;
}
async function report(){
 const [rows,release,settings]=await Promise.all([
  sql(PD,'SELECT channel,enabled FROM rustup_payment_settings ORDER BY channel'),
  sql(GD,'SELECT enabled FROM rustup_game_paid_release_control WHERE id=1'),
  api(SCRIPT+'/settings')]);
 const b=new Map(settings.bindings.map(x=>[x.name,x]));
 return {databaseSwitches:rows,gameReleaseEnabled:release[0]?.enabled===1,
  workerFlags:flags.map(name=>({name,explicitlyOff:b.get(name)?.text==='false',
   configured:b.has(name)})),
  checkoutDisabled:rows.some(x=>x.channel==='master'&&x.enabled===0)||
   rows.some(x=>x.channel==='stars'&&x.enabled===0),
  warning:'No guarantee of exactly two paid invoices or automatic refund.'};
}
async function stop(){
 // Disable the shared DB switch first: checkout refuses to proceed.
 await sql(PD,"UPDATE rustup_payment_settings SET enabled=0 WHERE channel IN ('master','stars','crypto')");
 const failed=[];
 for(const name of flags){
  try{await api(SCRIPT+'/secrets','PUT',{name,type:'secret_text',text:'false'});}
  catch(e){failed.push(name);}
 }
 const result=await report();
 console.log(JSON.stringify({action:'stop',...result,failedFlagWrites:failed},null,2));
 if(!result.checkoutDisabled||failed.length)process.exitCode=2;
}

// Real activation, not a dummy toggle. This requires a pre-existing,
// independently reviewed paid-game release record: never create approval
// references or silently waive the release review.
async function activate(){
 const live=await report();
 const approval=await sql(GD,
  'SELECT enabled,approval_reference,reviewed_at_ms FROM rustup_game_paid_release_control WHERE id=1');
 const approved=approval.length===1&&approval[0].enabled===1&&
  typeof approval[0].approval_reference==='string'&&
  approval[0].approval_reference.length>=8&&
  Number.isSafeInteger(approval[0].reviewed_at_ms)&&approval[0].reviewed_at_ms>0;
 const settings=await api(SCRIPT+'/settings');
 const bs=new Map(settings.bindings.map(x=>[x.name,x]));
 const blockers=[];
 if(!approved)blockers.push('reviewed_paid_game_release_record_required');
 if(!live.checkoutDisabled)blockers.push('existing_checkout_must_be_off');
 if(!live.databaseSwitches.some(x=>x.channel==='master'&&x.enabled===0)||
    !live.databaseSwitches.some(x=>x.channel==='stars'&&x.enabled===0))
  blockers.push('payment_switches_not_in_safe_initial_state');
 if(!live.databaseSwitches.some(x=>x.channel==='crypto'&&x.enabled===0))
  blockers.push('crypto_must_remain_off');
 for(const name of ['BOT_TOKEN','WEBHOOK_SECRET']){
  if(bs.get(name)?.type!=='secret_text')blockers.push('bot_binding_missing_'+name);
 }
 for(const name of ['DB','PAYMENTS_DB']){
  if(bs.get(name)?.type!=='d1')blockers.push('database_binding_missing_'+name);
 }
 if(bs.get('STARS_FIXED_PRODUCTS_ENABLED')?.text!=='false')
  blockers.push('fixed_products_must_remain_off');
 const [counts,source,deploy]=await Promise.all([
  sql(PD,"SELECT (SELECT count(*) FROM rustup_stars_variable_orders) AS orders,(SELECT count(*) FROM rustup_stars_receipt_incidents) AS incidents,(SELECT count(*) FROM rustup_stars_variable_delivery_jobs WHERE state IN ('retry','manual_review','leased')) AS failures"),
  api(SCRIPT+'/content/v2'),
  api(SCRIPT+'/deployments')
 ]);
 if(counts.length!==1||Object.values(counts[0]).some(n=>n!==0))
  blockers.push('unreconciled_or_existing_stars_orders');
 const code=typeof source==='string'?source:'';
 for(const marker of ['function pilotStarsUserAllowed(','function pilotStarsAmountAllowed(',
   'function pilotStarsPhaseAllowed(','async function variableStarsWebhook(',
   'async function variableStarsApi(','runVariableStarsDeliveryQueue',
   'reconcileRecordedStarsRefundBatch','freezeVerifiedStarsGameQuote']){
  if(!code.includes(marker))blockers.push('worker_missing_'+marker);
 }
 const version=deploy?.deployments?.[0]?.versions?.[0]?.version_id;
 if(typeof version!=='string')blockers.push('live_version_unknown');
 // A two-invoice limit is not installed yet. Do not claim exactly two charges.
 blockers.push('atomic_two_invoice_limit_not_installed');
 // The existing live code checks account binding and refund readiness before
 // invoicing, but a release requires an independently reviewed ledger and
 // reliable undo. A self-attested CLI flag is deliberately insufficient.
 if(blockers.length){
  console.log(JSON.stringify({action:'activate',activated:false,blockers},null,2));
  process.exitCode=2;return;
 }
 // This switch is deliberately not run until operator-approved settlement
 // and refund evidence is stored outside of this CLI. It cannot be invented.
 const confirmed=process.env.RUSTUP_GAME_CREDIT_REFUND_REVIEWED==='true';
 if(!confirmed){
  console.log(JSON.stringify({action:'activate',activated:false,
   blockers:['independent_live_credit_and_refund_review_required'],
   checkedWorkerVersion:version,
   note:'A review flag is an operator attestation, not a substitute for verification.'},null,2));
  process.exitCode=2;return;
 }
 const now=Date.now(),expires=String(now+15*60*1000);
 // Ensure fixed-phase and 1 XTR maximum, one Telegram user only.
 // D1 master+stars remain OFF until last; if any step fails, DB stays OFF.
 try{
  for(const [name,text] of [
   ['STARS_VARIABLE_PILOT_USER_IDS','7390606911'],
   ['STARS_VARIABLE_PILOT_MAX_STARS','1'],
   ['STARS_VARIABLE_PILOT_EXPIRES_AT_MS',expires],
   ['STARS_VARIABLE_PILOT_PHASE','fixed'],
   ['STARS_FIXED_PRODUCTS_ENABLED','false'],
   ...flags.map(name=>[name,'true'])
  ]){
   await api(SCRIPT+'/secrets','PUT',{name,type:'secret_text',text});
  }
  await sql(PD,"UPDATE rustup_payment_settings SET enabled=1,updated_at_ms="+now+
    ",updated_by=7390606911 WHERE channel IN ('master','stars')");
  const after=await report();
  if(after.checkoutDisabled)throw Error('stars_checkout_not_open');
  console.log(JSON.stringify({action:'activate',activated:true,phase:'fixed',
   maxStars:1,onlyUserId:'7390606911',expiresAtMs:expires,
   cryptoEnabled:false,refundable:'Requires transaction-by-transaction evidence and operator-approved refund',
   note:'Stop via -Action stop; any successful charge requires manual reconciliation and refund.'},null,2));
 }catch(e){
  try{await sql(PD,"UPDATE rustup_payment_settings SET enabled=0 WHERE channel IN ('master','stars')");}
  catch{console.error('CRITICAL: emergency DB checkout shutdown failed');}
  console.error('Activation failed; D1 checkout shut. '+String(e.message||e));
  process.exitCode=1;
 }
}
async function main(){
 const action=process.argv[2];
 if(action==='status')console.log(JSON.stringify(await report(),null,2));
 else if(action==='stop')await stop();
 else if(action==='activate')await activate();
 else throw Error('Usage: status | stop | activate');
}
main().catch(e=>{console.error('RUST UP PAYMENT OPS: '+String(e.message||e));process.exitCode=1;});
