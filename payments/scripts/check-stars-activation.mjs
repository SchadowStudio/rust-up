// RUST UP: non-mutating Stars activation readiness diagnostic.
// No invoices, paid game credits, config changes, or calls to Telegram.
// The report contains only booleans/counts; secrets and player data never leave Cloudflare.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {recoverVariableSource} from './recover-current-stars-variable.mjs';

const ACCOUNT='af72e32cb9f1ba99dba07df30fe540fe';
const SCRIPT='rustup-bot';
const PAYMENTS_DB='06079270-a227-466a-9991-abd4201ec5f6';
const STATS_DB='9b0b533f-540a-4a25-a429-70ca8bd4e23d';
const EXPECTED_FLAGS=[
 'PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
 'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
 'PAYMENT_WALLET_STRICT_MODE'
];
const PRICE_VARS=[
 'STARS_MIN_RUB_MINOR','STARS_MAX_RUB_MINOR',
 'STARS_RUB_MINOR_PER_STAR_NUM','STARS_RUB_MINOR_PER_STAR_DEN'
];
const SAFE_DEC=/^[1-9]\d{0,14}$/;

const success=(name,ok,detail)=>({name,ok:ok===true,detail});
const has=b=>new Map((b||[]).map(x=>[x.name,x]));
function validPriceConfiguration(env){
 const vals=PRICE_VARS.map(n=>env.get(n)?.text);
 if(!vals.every(x=>typeof x==='string'&&SAFE_DEC.test(x)))return false;
 const [min,max,num,den]=vals.map(x=>BigInt(x));
 if(min>max||max>100000000n)return false;
 const high=(max*den+num-1n)/num;
 const low=(min*den+num-1n)/num;
 return low>=1n&&high<=1000000n;
}
export function evaluateStarsActivation({settings,tables,sourceNames,liveVersion}){
 if(!settings||!Array.isArray(settings.bindings)||!Array.isArray(tables)||
    !Array.isArray(sourceNames))
  throw Error('activation_unknown_live_state');
 const bindings=has(settings.bindings);
 const flags=EXPECTED_FLAGS.map(name=>{
  const b=bindings.get(name);
  return {name,value:b?.type==='plain_text'?(b.text||b.value):null};
 });
 const paymentsOff=flags.every(x=>x.value==='false');
 const paymentSwitchesKnown=flags.every(x=>x.value==='false'||x.value==='true');
 const secretReady=['BOT_TOKEN','WEBHOOK_SECRET']
  .every(name=>bindings.get(name)?.type==='secret_text');
 const databaseReady=bindings.get('DB')?.type==='d1'&&
  [bindings.get('DB').id,bindings.get('DB').database_id].includes(STATS_DB)&&
  bindings.get('PAYMENTS_DB')?.type==='d1'&&
  [bindings.get('PAYMENTS_DB').id,bindings.get('PAYMENTS_DB').database_id]
   .includes(PAYMENTS_DB);
 const originReady=bindings.get('APP_URL')?.text===
  'https://ttzoomrust-hub.github.io/rust-up/';
 const hasBridge=sourceNames.includes('stars-variable-bridge.mjs')&&
  sourceNames.includes('variable-stars.mjs')&&
  sourceNames.includes('worker.stars-variable-entry.mjs');
 const hasSchema=tables.includes('rustup_stars_variable_orders')&&
  tables.includes('rustup_payment_settings');
 const previewReady=secretReady&&databaseReady&&originReady&&hasBridge&&
  hasSchema&&validPriceConfiguration(bindings);
 // Even apparently ON flags do not demonstrate a trustworthy delivery to a
 // separate, non-wagerable digital entitlement. Require a distinct reviewed
 // delivery integration and end-to-end test before accepting real payments.
 const checks=[
  success('telegram_secret_bindings',secretReady,'Only binding presence checked'),
  success('both_databases_bound',databaseReady,'Expected game and Stars D1 bindings'),
  success('miniapp_origin',originReady,'Expected existing Telegram Mini App origin'),
  success('variable_invoice_modules',hasBridge,'Source map must list three modules'),
  success('payment_tables',hasSchema,'Variable orders and payment controls exist'),
  success('price_preview',validPriceConfiguration(bindings),
    'Owner-defined minimum, maximum and Stars ratio must be configured'),
  success('payment_flags_known',paymentSwitchesKnown,
    'Every payment-related flag must be an explicit string boolean'),
  success('payments_safely_disabled',paymentsOff,
    'All hard payment and game-wallet gates must remain OFF here')
 ];
 return {
  ok:true,
  mode:'READ_ONLY_DIAGNOSTIC',
  liveVersion:typeof liveVersion==='string'?liveVersion:null,
  checks,
  pricePreviewReady:previewReady,
  realPaymentActivationReady:false,
  gameCreditConnected:false,
  safeCurrentMode:paymentsOff&&secretReady&&databaseReady,
  blockers:[
   ...checks.filter(x=>!x.ok).map(x=>x.name),
   'non_wagerable_digital_entitlement_delivery_not_verified',
   'end_to_end_telegram_test_payment_and_refund_not_verified'
  ],
  actionsPerformed:['READ_CONFIGURATION','READ_SCHEMA','READ_SOURCE_MODULE_NAMES']
 };
}
async function cloudflare(path,token,body){
 const r=await fetch('https://api.cloudflare.com/client/v4'+path,{
  method:body?'POST':'GET',redirect:'error',
  signal:AbortSignal.timeout(25000),
  headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},
  ...(body?{body:JSON.stringify(body)}:{})
 });
 if(!r.ok)throw Error('cloudflare_read_http_'+r.status);
 const data=await r.json();
 if(data?.success!==true)throw Error('cloudflare_read_failed');
 return data.result;
}
export async function inspectLiveStars(token){
 if(typeof token!=='string'||token.length<15)
  throw Error('private_cloudflare_login_required');
 const base='/accounts/'+ACCOUNT+'/workers/scripts/'+SCRIPT;
 const [settings,schema,deploy,sourceSnapshot]=await Promise.all([
  cloudflare(base+'/settings',token),
  cloudflare('/accounts/'+ACCOUNT+'/d1/database/'+PAYMENTS_DB+'/query',token,{
   sql:"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('rustup_stars_variable_orders','rustup_payment_settings') ORDER BY name"
  }),
  cloudflare(base+'/deployments',token),
  recoverVariableSource(token)
 ]);
 // Recover the exact current source map privately, but report only names
 // and booleans, never the recovered code or Telegram credentials.
 const tables=schema?.[0]?.results?.map(x=>x.name);
 const sources=[...sourceSnapshot.source.keys()];
 return evaluateStarsActivation({
  settings,tables,sourceNames:sources,
  liveVersion:deploy?.deployments?.[0]?.versions?.[0]?.version_id
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 inspectLiveStars(process.env.CLOUDFLARE_API_TOKEN)
 .then(report=>{
  console.log(JSON.stringify(report,null,2));
  if(!report.safeCurrentMode)process.exitCode=2;
 })
 .catch(error=>{
  console.error('STARS READINESS CHECK FAILED:',String(error?.message||error));
  process.exitCode=1;
 });
