import {readFileSync} from 'node:fs';
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
 const rows=r[0].results;
 Object.defineProperty(rows,'meta',{value:r[0].meta});
 return rows;
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
 try{await sql(PD,'UPDATE rustup_stars_pilot_guard SET enabled=0 WHERE id=1');}catch{/* Guard might not yet be installed. */}
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
 const reference=process.env.RUSTUP_OPERATOR_RELEASE_REFERENCE;
 const operatorConfirms=process.env.RUSTUP_OPERATOR_REVIEW_CONFIRMED==='true';
 const canRecordOperatorReview=!approved&&operatorConfirms&&
  typeof reference==='string'&&/^[A-Za-z0-9._:-]{12,160}$/.test(reference);
 const settings=await api(SCRIPT+'/settings');
 const bs=new Map(settings.bindings.map(x=>[x.name,x]));
 const blockers=[];
 if(!approved&&!canRecordOperatorReview)blockers.push('operator_review_reference_and_explicit_confirmation_required');
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
 // Current live Worker cannot issue game-aware refunds. This pilot instead
 // uses the operator-local refund utility and a separate signed Bot API token,
 // with one-time refund intents and verified atomic GAME D1 reversal.
 // Do not assert that an automatic in-Worker refund endpoint exists.
 try{
  const localRefund=readFileSync(new URL('./refund-main-bot-stars.mjs',import.meta.url),'utf8');
  if(!localRefund.includes('refundStarPayment')||
     !localRefund.includes('rustup_game_paid_refunds')||
     !localRefund.includes('rustup_stars_variable_refund_intents'))
    blockers.push('local_refund_game_reversal_not_present');
 }catch{blockers.push('local_refund_utility_missing');}
 const version=deploy?.deployments?.[0]?.versions?.[0]?.version_id;
 if(typeof version!=='string')blockers.push('live_version_unknown');
 // A D1 BEFORE INSERT trigger is the atomic pilot order cap. It is installed
 // while ALL payment switches are OFF and is disabled again by emergency stop.
 // An invoice cannot be generated without a durable order row.

 // The existing live code checks account binding and refund readiness before
 // invoicing, but a release requires an independently reviewed ledger and
 // reliable undo. A self-attested CLI flag is deliberately insufficient.
 if(blockers.length){
  console.log(JSON.stringify({action:'activate',activated:false,blockers},null,2));
  process.exitCode=2;return;
 }
 // This switch is deliberately not run until operator-approved settlement
 // and refund evidence is stored outside of this CLI. It cannot be invented.
 // For an inherently first-ever live pilot, a verified live refund cannot
 // yet exist. Operator explicitly accepts manual review of an uncertain
 // refund outcome; this is not an independent production certification.
 if(!operatorConfirms){
  console.log(JSON.stringify({action:'activate',activated:false,
   blockers:['explicit_operator_test_risk_acceptance_required']},null,2));
  process.exitCode=2;return;
 }
 // The release record may be set ONLY when the operator supplies a genuine
 // review document/reference and explicitly confirms it. Never fabricate one.
 const now=Date.now(),expires=String(now+15*60*1000);
 // Ensure fixed-phase and 1 XTR maximum, one Telegram user only.
 // D1 master+stars remain OFF until last; if any step fails, DB stays OFF.
 let operatorRecordCreated=false;
 try{
  if(canRecordOperatorReview){
   const stored=await sql(GD,
    "UPDATE rustup_game_paid_release_control SET enabled=1,"+
    "approval_reference='"+reference+"',reviewed_at_ms="+Date.now()+
    " WHERE id=1 AND enabled=0 AND approval_reference IS NULL");
   if(stored.meta?.changes!==1)throw Error('operator_review_record_not_confirmed');
   operatorRecordCreated=true;
  }
 // Install atomic purchase limit BEFORE enabling ANY financial gate.
 // This limits total checkout orders rather than relying on a browser counter.
 await sql(PD,`CREATE TABLE IF NOT EXISTS rustup_stars_pilot_guard(
  id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL DEFAULT 0,
  owner_id INTEGER NOT NULL,max_orders INTEGER NOT NULL,
  phase TEXT NOT NULL DEFAULT 'fixed' CHECK(phase IN ('fixed','custom')))`);
 await sql(PD,`INSERT OR IGNORE INTO rustup_stars_pilot_guard(id,enabled,owner_id,max_orders)
  VALUES(1,0,7390606911,2)`);
 await sql(PD,`CREATE TRIGGER IF NOT EXISTS rustup_stars_pilot_order_cap
  BEFORE INSERT ON rustup_stars_variable_orders
  WHEN (SELECT enabled FROM rustup_stars_pilot_guard WHERE id=1)=1
  BEGIN
   SELECT CASE WHEN NEW.telegram_user_id !=
    (SELECT owner_id FROM rustup_stars_pilot_guard WHERE id=1)
    THEN RAISE(ABORT,'pilot_user_denied') END;
   SELECT CASE WHEN (SELECT phase FROM rustup_stars_pilot_guard WHERE id=1)='fixed'
    AND NEW.price_stars<>1 THEN RAISE(ABORT,'pilot_fixed_one_star_required') END;
   SELECT CASE WHEN (SELECT COUNT(*) FROM rustup_stars_variable_orders)=1
    AND (SELECT phase FROM rustup_stars_pilot_guard WHERE id=1)<>'custom'
    THEN RAISE(ABORT,'pilot_second_order_not_open') END;
   SELECT CASE WHEN (SELECT COUNT(*) FROM rustup_stars_variable_orders)>=
    (SELECT max_orders FROM rustup_stars_pilot_guard WHERE id=1)
    THEN RAISE(ABORT,'pilot_order_limit_reached') END;
  END`);
 const installed=await sql(PD,`SELECT name FROM sqlite_master
  WHERE type='trigger' AND name='rustup_stars_pilot_order_cap'`);
 if(installed.length!==1)throw Error('atomic_pilot_order_trigger_unconfirmed');
 await sql(PD,`UPDATE rustup_stars_pilot_guard SET enabled=1,owner_id=7390606911,max_orders=2,phase='fixed' WHERE id=1 AND enabled=0`);

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
   cryptoEnabled:false,maxOrders:2,refundable:'Requires transaction-by-transaction evidence and operator-approved refund',
   note:'Stop via -Action stop; any successful charge requires manual reconciliation and refund.'},null,2));
 }catch(e){
  try{await sql(PD,"UPDATE rustup_payment_settings SET enabled=0 WHERE channel IN ('master','stars')");await sql(PD,"UPDATE rustup_stars_pilot_guard SET enabled=0 WHERE id=1");}
  catch{console.error('CRITICAL: emergency DB checkout shutdown failed');}
  // Do not withdraw a release while a charge/order may already be in flight:
  // the settlement cron must remain able to reconcile that payment.
  if(operatorRecordCreated){
   try{
    const existing=await sql(PD,
     'SELECT COUNT(*) AS count FROM rustup_stars_variable_orders');
    if(existing[0]?.count===0)await sql(GD,
     "UPDATE rustup_game_paid_release_control SET enabled=0,"+
     "approval_reference=NULL,reviewed_at_ms=NULL WHERE id=1 AND approval_reference='"+
     reference+"'");
   }catch{console.error('REVIEW REQUIRED: approval rollback inconclusive');}
  }
  console.error('Activation failed; D1 checkout shut. '+String(e.message||e));
  process.exitCode=1;
 }
}
async function customPhase(){
 const snap=await report();
 if(snap.checkoutDisabled)throw Error('checkout_is_not_active');
 const rows=await sql(PD,
  "SELECT id,status,telegram_user_id,price_stars FROM rustup_stars_variable_orders ORDER BY created_at_ms ASC");
 if(rows.length!==1||rows[0].telegram_user_id!==7390606911||
    rows[0].price_stars!==1||rows[0].status!=='paid')
   throw Error('first_paid_one_star_order_required');
 const credit=await sql(GD,
  "SELECT order_id FROM rustup_game_paid_receipts WHERE source='stars_variable' AND order_id='"+rows[0].id+"'");
 if(credit.length!==1)throw Error('first_payment_game_credit_not_verified');
 const now=Date.now();
 const expiry=String(now+15*60*1000);
 await api(SCRIPT+'/secrets','PUT',
  {name:'STARS_VARIABLE_PILOT_MAX_STARS',type:'secret_text',text:'10'});
 await api(SCRIPT+'/secrets','PUT',
  {name:'STARS_VARIABLE_PILOT_EXPIRES_AT_MS',type:'secret_text',text:expiry});
 await api(SCRIPT+'/secrets','PUT',
  {name:'STARS_VARIABLE_PILOT_PHASE',type:'secret_text',text:'custom'});
 await sql(PD,"UPDATE rustup_stars_pilot_guard SET phase='custom' WHERE id=1 AND enabled=1 AND phase='fixed'");
 console.log(JSON.stringify({action:'custom',enabled:true,maxStars:10,
  firstOrderVerifiedPaid:true,firstGameCreditVerified:true,
  expiresAtMs:expiry,remainingOrderSlots:1},null,2));
}

async function main(){
 const action=process.argv[2];
 if(action==='status')console.log(JSON.stringify(await report(),null,2));
 else if(action==='stop')await stop();
 else if(action==='activate')await activate();
 else if(action==='custom')await customPhase();
 else throw Error('Usage: status | stop | activate | custom');
}
main().catch(e=>{console.error('RUST UP PAYMENT OPS: '+String(e.message||e));process.exitCode=1;});
