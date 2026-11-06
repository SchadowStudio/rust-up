// READ ONLY RUST UP Supporter payment preflight. No live payment can be enabled
// by this script, and a unit test does not count as Telegram payment evidence.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {publishedStarsTerms} from '../integration/telegram-stars/stars-terms.mjs';

const ACCOUNT='af72e32cb9f1ba99dba07df30fe540fe';
const DATABASE='06079270-a227-466a-9991-abd4201ec5f6';
const SCRIPT='rustup-bot';
const SKU='supporter_badge_v1';
const SITE='https://ttzoomrust-hub.github.io/rust-up/';
const FLAGS=['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
 'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
 'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
 'PAYMENT_WALLET_STRICT_MODE'];
const validIds=s=>typeof s==='string'&&s.split(',').some(id=>
 /^[1-9]\d{0,15}$/.test(id.trim())&&Number.isSafeInteger(Number(id.trim())));

export function evaluateSupporterReadiness(x){
 if(!x||!Array.isArray(x.bindings)||!Array.isArray(x.tables)||
   !Array.isArray(x.products)||!Array.isArray(x.controls)||
   !Array.isArray(x.incidents)||typeof x.siteHtml!=='string'||
   typeof x.siteAppJs!=='string')
  throw Error('incomplete_live_readiness_evidence');
 const bindings=new Map(x.bindings.map(v=>[v.name,v]));
 const flags=FLAGS.map(name=>bindings.get(name)?.text);
 const disabled=flags.every(v=>v==='false');
 const unknown=flags.some(v=>v!=='false'&&v!=='true');
 const supported=['rustup_stars_terms_acceptances','rustup_stars_order_terms',
  'rustup_stars_orders','rustup_stars_products',
  'rustup_stars_fixed_content','rustup_stars_order_content',
  'rustup_stars_supporter_badges','rustup_stars_refund_intents',
  'rustup_stars_receipt_incidents','rustup_payment_settings']
  .every(name=>x.tables.includes(name));
 const products=x.products.filter(v=>v.sku===SKU);
 const approvedProduct=products.length===1&&products[0].enabled===1&&
  products[0].kind==='fixed_nontransferable'&&
  Number.isSafeInteger(products[0].price_stars)&&
  products[0].price_stars>=1&&products[0].price_stars<=1000000&&
  products[0].hasDelivery===1;
 const noOtherSale=x.products.every(p=>p.enabled!==1||p.sku===SKU);
 const payDb=bindings.get('PAYMENTS_DB');
 const payDbReady=payDb?.type==='d1'&&
  [payDb.id,payDb.database_id].includes(DATABASE);
 const terms=publishedStarsTerms({
  STARS_TERMS_VERSION:bindings.get('STARS_TERMS_VERSION')?.text,
  STARS_TERMS_URL:bindings.get('STARS_TERMS_URL')?.text
 });
 const admin=bindings.get('PAYMENT_ADMIN_IDS');
 const refundAdminReady=admin?.type==='plain_text'&&validIds(admin.text);
 const origin=bindings.get('APP_URL')?.text===
  'https://ttzoomrust-hub.github.io/rust-up/';
 const botReady=['BOT_TOKEN','WEBHOOK_SECRET'].every(name=>
  bindings.get(name)?.type==='secret_text');
 // Current website (2026-11-06) conditionally loads the OFFICIAL Telegram
 // SDK inside the native Mini App and uses signed initData against /api/game.
 // The old 2026-11-05 frontend loaded it statically. Both are acceptable
 // ONLY with the reviewed fixed-goods asset and corresponding safe mount.
 const sdk=x.siteHtml.includes('telegram.org/js/telegram-web-app.js');
 const moduleLinked=x.siteHtml.includes('js/stars-fixed-market-v3.js');
 const legacyMount=x.siteHtml.includes('20261105telegramauth2')&&
  !x.siteHtml.includes("sessionStorage.setItem('rustup_tg'");
 const newWalletMount=/js\\/app\\.js\\?v=[^"]+/.test(x.siteHtml)&&
  x.siteHtml.includes('Демо-режим · виртуальный баланс')&&
  x.siteAppJs.includes('RUSTUP_STARS_FIXED_MARKET_V3.render(box)')&&
  x.siteAppJs.includes("api('load', { local })")&&
  x.siteAppJs.includes('gameReady = true;')&&
  x.siteAppJs.includes("if ('wpay' in d || 'wsend' in d) { haptic('warning'); return toast(NOT_YET, 'error'); }");
 const siteReady=sdk&&moduleLinked&&(legacyMount||newWalletMount);
 const controlsOff=['master','stars','crypto'].every(c=>
  x.controls.some(row=>row.channel===c&&row.enabled===0))&&
  x.controls.length===3;
 const noIncidents=x.incidents.length===2&&x.incidents.every(r=>
  Number.isSafeInteger(r.value)&&r.value===0);
 const checks=[
  ['payment_schema_ready',supported],
  ['correct_live_payment_database_binding',payDbReady],
  ['operator_terms_version_and_https_url',!!terms],
  ['authenticated_stars_terms_route_present',x.termsRouteAuthenticated===true],
  ['telegram_bot_secrets_and_origin',origin&&botReady],
  ['refund_operator_allowlist',refundAdminReady],
  ['supporter_product_has_price_delivery',approvedProduct],
  ['no_other_enabled_paid_products',noOtherSale],
  ['no_unresolved_payment_incidents',noIncidents],
  ['miniapp_telegram_auth_bootstrap',siteReady],
  ['hard_payment_flags_safely_off',disabled&&!unknown],
  ['database_switches_safely_off',controlsOff]
 ].map(([id,ok])=>({id,ok:ok===true}));
 return {
  mode:'READ_ONLY_SUPPORTER_PAYMENT_PREFLIGHT',
  checks,
  blockers:[
   ...checks.filter(v=>!v.ok).map(v=>v.id),
   'real_telegram_e2e_payment_and_refund_not_proven',
   'operator_and_legal_release_approval_not_proven'
  ],
  readyToAcceptPayments:false,
  paymentActivated:false,
  gameWalletChanged:false
 };
}
async function api(token,route,sql,fetchImpl){
 const res=await fetchImpl('https://api.cloudflare.com/client/v4'+route,{
  method:sql?'POST':'GET',redirect:'error',
  signal:AbortSignal.timeout(25000),
  headers:{authorization:'Bearer '+token,
   ...(sql?{'content-type':'application/json'}:{})},
  ...(sql?{body:JSON.stringify({sql})}:{})
 });
 if(!res.ok)throw Error('cloudflare_read_http_'+res.status);
 const data=await res.json();
 if(data?.success!==true)throw Error('cloudflare_read_failed');
 return data.result;
}
export async function inspectSupporterReadiness(token,fetchImpl=fetch){
 if(typeof token!=='string'||token.length<15)
  throw Error('private_cloudflare_login_required');
 const worker='/accounts/'+ACCOUNT+'/workers/scripts/'+SCRIPT;
 const d1='/accounts/'+ACCOUNT+'/d1/database/'+DATABASE+'/query';
 const requests=[
  api(token,worker+'/settings',null,fetchImpl),
  api(token,d1,"SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'rustup_%'",fetchImpl),
  api(token,d1,"SELECT p.sku,p.kind,p.price_stars,p.enabled,CASE WHEN EXISTS(SELECT 1 FROM rustup_stars_fixed_content c WHERE c.sku=p.sku AND length(c.delivery_text)>0) THEN 1 ELSE 0 END AS hasDelivery FROM rustup_stars_products p LIMIT 100",fetchImpl),
  api(token,d1,'SELECT channel,enabled FROM rustup_payment_settings',fetchImpl),
  api(token,d1,"SELECT COUNT(*) AS value FROM rustup_stars_receipt_incidents UNION ALL SELECT COUNT(*) AS value FROM rustup_stars_refund_intents WHERE state<>'completed'",fetchImpl),
  fetchImpl(SITE,{
   method:'GET',redirect:'error',signal:AbortSignal.timeout(25000)}),
  fetchImpl(SITE+'js/app.js',{
   method:'GET',redirect:'error',signal:AbortSignal.timeout(25000)})
 ];
 const [settings,tables,products,controls,incidents,site,siteApp]=await Promise.all(requests);
 const termsRoute=await fetchImpl('https://rustup-bot.ttzoomrust.workers.dev/api/stars/terms',{
  method:'POST',redirect:'error',cache:'no-store',
  headers:{origin:new URL(SITE).origin,'content-type':'application/json'},
  body:JSON.stringify({initData:'invalid'}),
  signal:AbortSignal.timeout(10000)
 });
 let termsRouteAuthenticated=false;
 try{const body=await termsRoute.json();
  termsRouteAuthenticated=termsRoute.status===401&&
   body?.error==='telegram_auth_required';}catch{}
 if(!site.ok||!siteApp.ok)throw Error('public_miniapp_unavailable');
 const rows=q=>{
  if(!Array.isArray(q)||!Array.isArray(q[0]?.results))
   throw Error('unknown_cloudflare_d1_response');
  return q[0].results;
 };
 return evaluateSupporterReadiness({
  bindings:settings?.bindings,tables:rows(tables).map(x=>x.name),
  products:rows(products),controls:rows(controls),incidents:rows(incidents),
  termsRouteAuthenticated,siteHtml:await site.text(),
  siteAppJs:await siteApp.text()
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 inspectSupporterReadiness(process.env.CLOUDFLARE_API_TOKEN).then(report=>{
  console.log(JSON.stringify(report,null,2));
  console.log('READ ONLY; no Stars charge, no deployment, no game credit.');
 }).catch(e=>{
  console.error('SUPPORTER PAYMENT PREFLIGHT BLOCKED:',String(e?.message||e));
  process.exitCode=1;
 });
