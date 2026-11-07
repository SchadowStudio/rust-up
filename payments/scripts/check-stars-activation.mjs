// RUST UP: non-mutating Stars activation readiness diagnostic.
// No invoices, paid game credits, config changes, or calls to Telegram.
// The report contains only booleans/counts; secrets and player data never leave Cloudflare.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
// Read only source-map names. Do not use the legacy 18-module recovery parser:
 // the current deployed webhook-only Worker has a different, verified layout.
export function parseLiveSourceNames(raw, contentType='') {
 if(typeof raw!=='string'||raw.length<1000||raw.length>18_000_000)
  throw Error('invalid_live_worker_content');
 const boundary=contentType.match(/boundary="?([^";\s]+)"?/i)?.[1]||
  raw.split(/\r?\n/,1)[0].replace(/^--/,'');
 if(!boundary||boundary.length>200)throw Error('invalid_live_worker_boundary');
 let found=null;
 for(const part of raw.split('--'+boundary)) {
  const sep=part.indexOf('\r\n\r\n');
  if(sep<0||!/(?:filename|name)="[^"]*\.js\.map"/.test(part.slice(0,sep)))
   continue;
  if(found!==null)throw Error('ambiguous_live_worker_source_map');
  let map;
  try { map=JSON.parse(part.slice(sep+4).trim()); }
  catch { throw Error('invalid_live_worker_source_map'); }
  if(map?.version!==3||!Array.isArray(map.sources)||
     !Array.isArray(map.sourcesContent)||map.sources.length!==map.sourcesContent.length||
     map.sources.length<10||map.sources.length>100)
   throw Error('invalid_live_worker_source_map_shape');
  if(map.sources.some(x=>typeof x!=='string'||! /^[a-zA-Z0-9_.-]+$/.test(x))||
     new Set(map.sources).size!==map.sources.length)
   throw Error('invalid_live_worker_source_names');
  found=map.sources;
 }
 if(!found)throw Error('live_worker_source_map_missing');
 if(!found.includes('variable-stars.mjs')||
    !found.includes('stars-variable-bridge.mjs')||
    !found.includes('payment-controls.mjs')||
    !found.includes('stars-variable-webhook-wrapper.mjs')||
    !found.includes('worker.stars-webhook-only-entry.mjs'))
  throw Error('unexpected_live_stars_entry_modules');
 return found;
}
async function readLiveSourceNames(token) {
 const response=await fetch('https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+
  '/workers/scripts/'+SCRIPT+'/content/v2',{
   headers:{authorization:'Bearer '+token},redirect:'error',
   signal:AbortSignal.timeout(25000)
  });
 if(!response.ok)throw Error('cloudflare_source_read_http_'+response.status);
 return parseLiveSourceNames(await response.text(),response.headers.get('content-type')||'');
}


const ACCOUNT='af72e32cb9f1ba99dba07df30fe540fe';
const SCRIPT='rustup-bot';
const PAYMENTS_DB='06079270-a227-466a-9991-abd4201ec5f6';
const STATS_DB='9b0b533f-540a-4a25-a429-70ca8bd4e23d';
const EXPECTED_FLAGS=[
 'PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
 'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
 'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
 'PAYMENT_WALLET_STRICT_MODE'
];
const PRICE_VARS=[
 'STARS_MIN_RUB_MINOR','STARS_MAX_RUB_MINOR',
 'STARS_RUB_MINOR_PER_STAR_NUM','STARS_RUB_MINOR_PER_STAR_DEN'
];
const SAFE_DEC=/^[1-9]\d{0,14}$/;
const SETTLEMENT_FLAGS=[
 'STARS_GAME_CREDIT_SETTLEMENT_ENABLED',
 'STARS_GAME_CREDIT_REFUND_RECONCILIATION_ENABLED'
];
const REQUIRED_GAME_TRIGGERS=[
 'rustup_game_paid_receipts_preflight',
 'rustup_game_paid_receipts_apply',
 'rustup_game_paid_refunds_preflight',
 'rustup_game_paid_refunds_verify',
 'rustup_game_paid_refunds_apply'
];
const REQUIRED_PAYMENTS_TABLES=[
 'rustup_stars_variable_credit_quotes',
 'rustup_stars_variable_delivery_jobs',
 'rustup_stars_refund_reconciliation_done'
];

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
export function evaluateStarsActivation({settings,tables,sourceNames,liveVersion,
 gameTables=[],gameTriggers=[],gameGate=null}){

 if(!settings||!Array.isArray(settings.bindings)||!Array.isArray(tables)||
    !Array.isArray(sourceNames))
  throw Error('activation_unknown_live_state');
 const bindings=has(settings.bindings);
 const flags=EXPECTED_FLAGS.map(name=>{
  const b=bindings.get(name);
  return {name,value:b?.type==='plain_text'?(b.text||b.value):null};
 });
 const paymentsOff=flags.every(x=>x.value==='false');
 const settlementFlags=SETTLEMENT_FLAGS.map(name=>{
  const b=bindings.get(name);
  return {name,value:b?.type==='plain_text'?(b.text||b.value):null};
 });
 // Runtime gates are enabled only by the literal string "true".
 // Absent flags are therefore OFF, but we still report their absence.
 const settlementOff=settlementFlags.every(x=>x.value!== 'true');
 const settlementFlagsExplicit=settlementFlags.every(x=>x.value==='false');
 const settlementFlagsValid=settlementFlags.every(x=>
  x.value===null||x.value==='false'||x.value==='true');
 const gameJournalSchema=['rustup_game_paid_receipts',
  'rustup_game_paid_refunds','rustup_game_paid_release_control']
  .every(name=>gameTables.includes(name));
 const gameJournalTriggers=REQUIRED_GAME_TRIGGERS.every(name=>
  gameTriggers.includes(name));
 const settlementSchema=REQUIRED_PAYMENTS_TABLES.every(name=>
  tables.includes(name));
 const releaseGateOff=gameGate?.enabled===0&&
  gameGate.approval_reference==null&&gameGate.reviewed_at_ms==null;
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
  (sourceNames.includes('worker.stars-variable-entry.mjs')||
   (sourceNames.includes('worker.stars-webhook-only-entry.mjs')&&
    sourceNames.includes('stars-variable-webhook-wrapper.mjs')));
 const hasSchema=tables.includes('rustup_stars_variable_orders')&&
  tables.includes('rustup_payment_settings');
 const badgeSchemaReady=tables.includes('rustup_stars_supporter_badges');
 const badgeWorkerReady=sourceNames.includes('supporter-badge.mjs');
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
    'All hard payment and game-wallet gates must remain OFF here'),
  success('settlement_flags_safely_disabled',
    settlementOff&&settlementFlagsValid,
    'Credit and refund workers cannot execute with absent or false flags'),
  success('payment_settlement_tables',settlementSchema,
    'Delivery jobs, frozen credit quotes, refund markers installed'),
  success('game_paid_journal_schema',gameJournalSchema,
    'Separate game journal and release gate installed'),
  success('game_paid_credit_refund_triggers',gameJournalTriggers,
    'Game DB has credit and reversal preflight and apply triggers'),
  success('game_paid_release_gate_off',releaseGateOff,
    'Paid game receipts cannot be inserted without operator approval')
 ];
 return {
  ok:true,
  mode:'READ_ONLY_DIAGNOSTIC',
  liveVersion:typeof liveVersion==='string'?liveVersion:null,
  checks,
  optionalComponents:{
   supporter_badge_table:badgeSchemaReady,
   supporter_badge_worker_module:badgeWorkerReady
  },
  settlementFlagConfiguration:{
   explicitlyConfigured: settlementFlagsExplicit,
   unset: settlementFlags.filter(x=>x.value===null).map(x=>x.name)
  },
  pricePreviewReady:previewReady,
  realPaymentActivationReady:false,
  gameCreditConnected:false,
  safeCurrentMode:paymentsOff&&settlementOff&&settlementFlagsValid&&releaseGateOff&&
   secretReady&&databaseReady,
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
 const [settings,schema,gameSchema,gateRows,deploy,sourceSnapshot]=await Promise.all([
  cloudflare(base+'/settings',token),
  cloudflare('/accounts/'+ACCOUNT+'/d1/database/'+PAYMENTS_DB+'/query',token,{
   sql:"SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'rustup_%' ORDER BY name"
  }),
  cloudflare('/accounts/'+ACCOUNT+'/d1/database/'+STATS_DB+'/query',token,{
   sql:"SELECT type,name FROM sqlite_master WHERE (type='table' OR type='trigger') AND name LIKE 'rustup_game_paid_%' ORDER BY type,name"
  }),
  cloudflare('/accounts/'+ACCOUNT+'/d1/database/'+STATS_DB+'/query',token,{
   sql:"SELECT enabled,approval_reference,reviewed_at_ms FROM rustup_game_paid_release_control WHERE id=1"
  }),
  cloudflare(base+'/deployments',token),
  readLiveSourceNames(token)
 ]);
 // Recover the exact current source map privately, but report only names
 // and booleans, never the recovered code or Telegram credentials.
 const tables=schema?.[0]?.results?.map(x=>x.name);
 const sources=sourceSnapshot;
 const objects=gameSchema?.[0]?.results||[];
 const gates=gateRows?.[0]?.results||[];
 return evaluateStarsActivation({
  settings,tables,sourceNames:sources,
  gameTables:objects.filter(x=>x.type==='table').map(x=>x.name),
  gameTriggers:objects.filter(x=>x.type==='trigger').map(x=>x.name),
  gameGate:gates.length===1?gates[0]:null,
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
