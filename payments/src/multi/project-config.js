// Payment integration options are owned by one project; defaults FAIL CLOSED.
// Separate fiat display currency, accepted cryptocurrency, deposit ceilings and
// product/deposit mode. No wallet keys or customer identity are stored.
import {ASSETS} from '../assets.js';
import {FIATS} from './fiat.js';
import {requireProjectId,isUuid} from './identity.js';
const makeJson=(data,status=200)=>new Response(JSON.stringify(data),{
 status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const fail=(reason,status=400)=>makeJson({ok:false,error:reason},status);
const toFlag=(v)=>v===true?1:v===false?0:null;
const SUPPORTED_ASSETS=Object.keys(ASSETS);
const configPath=/^\/v2\/admin\/projects\/([0-9a-f-]{36})\/payment-config$/i;
const fiatPath=/^\/v2\/admin\/projects\/([0-9a-f-]{36})\/fiat-method$/i;
const cryptoPath=/^\/v2\/admin\/projects\/([0-9a-f-]{36})\/crypto-method$/i;

async function input(request){
 const raw=await request.text();
 if(raw.length>4096)throw Error('request_too_large');
 const data=JSON.parse(raw);
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('invalid_input');
 return data;
}
async function audit(db,action,id,detail,now){
 await db.prepare(`INSERT INTO v2_operator_audit
  (id,action,project_id,details,created_at_ms) VALUES(?,?,?,?,?)`)
  .bind(crypto.randomUUID(),action,id,JSON.stringify(detail),now).run();
}
export async function getProjectPaymentConfig(db,projectId){
 requireProjectId(projectId);
 const [profile,fiat,crypto] = await Promise.all([
  db.prepare(`SELECT p.project_id,p.display_name,p.invoices_enabled,p.deposits_enabled,
    p.products_enabled,p.invoice_lifetime_minutes,p.updated_at_ms,
    pr.status AS project_status,pr.webhook_url
    FROM v2_project_payment_profiles p JOIN v2_projects pr ON pr.id=p.project_id
    WHERE p.project_id=?`).bind(projectId).first(),
  db.prepare(`SELECT currency,enabled,min_minor,max_minor
    FROM v2_project_fiat_methods WHERE project_id=? ORDER BY currency`).bind(projectId).all(),
  db.prepare(`SELECT asset,enabled FROM v2_project_crypto_methods
    WHERE project_id=? ORDER BY asset`).bind(projectId).all()
 ]);
 if(!profile)return null;
 return {
  projectId:profile.project_id,displayName:profile.display_name,
  projectStatus:profile.project_status,webhookUrl:profile.webhook_url,
  invoicesEnabled:profile.invoices_enabled===1,
  depositsEnabled:profile.deposits_enabled===1,
  productsEnabled:profile.products_enabled===1,
  invoiceLifetimeMinutes:profile.invoice_lifetime_minutes,
  updatedAt:profile.updated_at_ms,
  fiatMethods:(fiat.results||[]).map(x=>({
   currency:x.currency,enabled:x.enabled===1,
   minMinor:x.min_minor,maxMinor:x.max_minor})),
  cryptoMethods:(crypto.results||[]).map(x=>({
   asset:x.asset,chain:ASSETS[x.asset]?.chain,enabled:x.enabled===1}))
 };
}
export async function getProjectMethodPolicy(db,projectId,currency,asset){
 if(!FIATS.includes(currency)||!SUPPORTED_ASSETS.includes(asset))return null;
 const result=await db.prepare(`SELECT p.invoices_enabled,p.deposits_enabled,
   p.products_enabled,p.invoice_lifetime_minutes,
   f.enabled AS fiat_enabled,f.min_minor,f.max_minor,
   c.enabled AS crypto_enabled
   FROM v2_project_payment_profiles p
   JOIN v2_project_fiat_methods f ON f.project_id=p.project_id
    AND f.currency=?
   JOIN v2_project_crypto_methods c ON c.project_id=p.project_id
    AND c.asset=?
   WHERE p.project_id=?`).bind(currency,asset,projectId).first();
 if(!result)return null;
 return {invoicesEnabled:result.invoices_enabled===1,
  depositsEnabled:result.deposits_enabled===1,
  productsEnabled:result.products_enabled===1,
  fiatEnabled:result.fiat_enabled===1,
  cryptoEnabled:result.crypto_enabled===1,
  minMinor:result.min_minor,maxMinor:result.max_minor,
  lifetimeMinutes:result.invoice_lifetime_minutes};
}
export async function initializeProjectPayments(db,projectId,label,now=Date.now()){
 const statements=[
  db.prepare(`INSERT INTO v2_project_payment_profiles
   (project_id,display_name,updated_at_ms) VALUES(?,?,?)`)
    .bind(projectId,label,now)
 ];
 for(const currency of FIATS){
  statements.push(db.prepare(`INSERT INTO v2_project_fiat_methods
   (project_id,currency,enabled) VALUES(?,?,0)`).bind(projectId,currency));
 }
 for(const asset of SUPPORTED_ASSETS){
  statements.push(db.prepare(`INSERT INTO v2_project_crypto_methods
   (project_id,asset,enabled) VALUES(?,?,0)`).bind(projectId,asset));
 }
 return statements;
}
export async function paymentProfileAdmin(request,env,url){
 const path=url.pathname;
 const match=configPath.exec(path)||fiatPath.exec(path)||cryptoPath.exec(path);
 if(!match||!isUuid(match[1]))return fail('invalid_project_id');
 const projectId=requireProjectId(match[1]),db=env.DB,now=Date.now();
 if(configPath.test(path)&&request.method==='GET'){
  const config=await getProjectPaymentConfig(db,projectId);
  return config?makeJson({ok:true,config}):fail('payment_profile_not_found',404);
 }
 if(request.method!=='POST')return fail('method_not_allowed',405);
 const b=await input(request);
 if(b.confirmation!=='CONFIRM_PROJECT_PAYMENT_SETTINGS')
  return fail('confirmation_required');
 if(configPath.test(path)){
  const flags=[toFlag(b.invoicesEnabled),toFlag(b.depositsEnabled),toFlag(b.productsEnabled)];
  const duration=b.invoiceLifetimeMinutes;
  if(flags.some(x=>x===null)||!Number.isSafeInteger(duration)||duration<5||duration>20||
     typeof b.displayName!=='string'||b.displayName.trim().length<3||
     b.displayName.trim().length>60)
   return fail('invalid_payment_profile');
  const changed=await db.prepare(`UPDATE v2_project_payment_profiles SET
   display_name=?,invoices_enabled=?,deposits_enabled=?,products_enabled=?,
   invoice_lifetime_minutes=?,updated_at_ms=?
   WHERE project_id=?`).bind(b.displayName.trim(),...flags,duration,now,projectId).run();
  if(!changed.meta?.changes)return fail('payment_profile_not_found',404);
  await audit(db,'update_project_payment_profile',projectId,
   {invoicesEnabled:!!flags[0],depositsEnabled:!!flags[1],
    productsEnabled:!!flags[2],invoiceLifetimeMinutes:duration},now);
  return makeJson({ok:true,config:await getProjectPaymentConfig(db,projectId)});
 }
 if(fiatPath.test(path)){
  const enabled=toFlag(b.enabled);
  if(!FIATS.includes(b.currency)||enabled===null||
     !Number.isSafeInteger(b.minMinor)||!Number.isSafeInteger(b.maxMinor)||
     b.minMinor<1||b.maxMinor>100000000000)
   return fail('invalid_project_fiat');
  if(b.maxMinor>100000000000||b.maxMinor<b.minMinor)
   return fail('invalid_project_fiat');
  const updated=await db.prepare(`UPDATE v2_project_fiat_methods
    SET enabled=?,min_minor=?,max_minor=?
    WHERE project_id=? AND currency=?`)
    .bind(enabled,b.minMinor,b.maxMinor,projectId,b.currency).run();
  if(!updated.meta?.changes)return fail('payment_method_not_found',404);
  await audit(db,'update_project_fiat',projectId,
   {currency:b.currency,enabled:!!enabled,minMinor:b.minMinor,maxMinor:b.maxMinor},now);
  return makeJson({ok:true,config:await getProjectPaymentConfig(db,projectId)});
 }
 if(cryptoPath.test(path)){
  const enabled=toFlag(b.enabled);
  if(!SUPPORTED_ASSETS.includes(b.asset)||enabled===null)
   return fail('invalid_project_asset');
  if(b.asset==='TON'&&enabled===1&&env.MULTI_TON_ENABLED!=='true')
   return fail('ton_not_configured',403);
  const updated=await db.prepare(`UPDATE v2_project_crypto_methods
    SET enabled=? WHERE project_id=? AND asset=?`)
    .bind(enabled,projectId,b.asset).run();
  if(!updated.meta?.changes)return fail('payment_method_not_found',404);
  await audit(db,'update_project_asset',projectId,
   {asset:b.asset,enabled:!!enabled},now);
  return makeJson({ok:true,config:await getProjectPaymentConfig(db,projectId)});
 }
 return fail('not_found',404);
}
