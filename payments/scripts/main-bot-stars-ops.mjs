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
async function main(){
 const action=process.argv[2];
 if(action==='status')console.log(JSON.stringify(await report(),null,2));
 else if(action==='stop')await stop();
 else if(action==='activate'){
  console.log('BLOCKED: Real-payment activation needs an atomic two-purchase limit and verified refund/reconciliation.');
  process.exitCode=2;
 }else throw Error('Usage: status | stop | activate');
}
main().catch(e=>{console.error('RUST UP PAYMENT OPS: '+String(e.message||e));process.exitCode=1;});
