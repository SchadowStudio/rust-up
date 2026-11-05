// Read-only Telegram Stars API for the EXISTING Rust Up Cloudflare Worker.
// NO invoices, checkout, charges, game balance, inventory, admin commands or transfers.
import {verifiedTelegramInitData} from './telegram-initdata.mjs';

const ROOT='/api/stars/';
const ROUTES=new Set(['health','catalog','purchases','checkout']);
const JSON_CONTENT='application/json';
function response(payload,status=200,origin=''){
  return new Response(JSON.stringify(payload),{
    status,headers:{
      'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store',
      'x-content-type-options':'nosniff',
      ...(origin?{'access-control-allow-origin':origin,'vary':'Origin'}:{})
    }
  });
}
function appOrigin(env){
  try {
    const url=new URL(env?.APP_URL);
    if(url.protocol!=='https:'||url.username||url.password)return null;
    return url.origin;
  }catch{return null;}
}
export async function handleStarsReadOnly(request,env){
  const url=new URL(request.url);
  if(!url.pathname.startsWith(ROOT))return null;
  const route=url.pathname.slice(ROOT.length);
  if(!ROUTES.has(route))return response({ok:false,error:'not_found'},404);
  if(route==='health'&&request.method==='GET')
    return response({
      ok:true,service:'rustup-stars-readonly',checkoutEnabled:false,
      productionEnabled:false,gameBalanceCredit:false
    });
  const trusted=appOrigin(env);
  const origin=request.headers.get('origin');
  if(!trusted||!origin||origin!==trusted)
    return response({ok:false,error:'origin_rejected'},403);
  if(request.method==='OPTIONS'){
    return new Response(null,{
      status:204,headers:{
        'access-control-allow-origin':trusted,
        'access-control-allow-methods':'POST, OPTIONS',
        'access-control-allow-headers':'content-type',
        'access-control-max-age':'600','vary':'Origin',
        'cache-control':'no-store'
      }
    });
  }
  if(request.method!=='POST')return response({ok:false,error:'method'},405,trusted);
  // Fail closed even if callers try the old or undocumented payment endpoint.
  if(route==='checkout')
    return response({ok:false,error:'stars_checkout_disabled'},503,trusted);
  if(request.headers.get('content-type')?.split(';')[0]!==JSON_CONTENT)
    return response({ok:false,error:'content_type'},415,trusted);
  let raw;
  try{raw=await request.text();}catch{return response({ok:false,error:'invalid_body'},400,trusted);}
  if(raw.length<1||raw.length>6000)
    return response({ok:false,error:'invalid_body_size'},413,trusted);
  let body;
  try{body=JSON.parse(raw);}catch{return response({ok:false,error:'invalid_json'},400,trusted);}
  let user;
  try {user=await verifiedTelegramInitData(body?.initData,env?.BOT_TOKEN);}
  catch {return response({ok:false,error:'telegram_auth_required'},401,trusted);}
  const db=env?.PAYMENTS_DB;
  if(!db||typeof db.prepare!=='function')
    return response({ok:false,error:'payment_database_missing'},503,trusted);
  try{
    if(route==='catalog'){
      const result=await db.prepare(
        'SELECT p.sku,p.title,p.description,p.price_stars FROM rustup_stars_products p '+
        'JOIN rustup_stars_fixed_content c ON c.sku=p.sku '+
        "WHERE p.enabled=1 AND p.kind='fixed_nontransferable' ORDER BY p.sku LIMIT 50"
      ).all();
      return response({
        ok:true,checkoutEnabled:false,products:result?.results||[]
      },200,trusted);
    }
    if(route==='purchases'){
      const result=await db.prepare(
        'SELECT o.id,o.sku,o.price_stars,o.paid_at_ms,c.delivery_text '+
        'FROM rustup_stars_orders o '+
        'JOIN rustup_stars_order_content c ON c.order_id=o.id '+
        'WHERE o.telegram_user_id=? AND o.status=? AND c.unlocked_at_ms IS NOT NULL '+
        'ORDER BY o.paid_at_ms DESC LIMIT 100'
      ).bind(user.userId,'paid').all();
      return response({
        ok:true,purchases:result?.results||[],gameBalanceCredit:false
      },200,trusted);
    }
  }catch(error){
    // Do not log initData, BOT_TOKEN, user profile or delivery text.
    console.error('Stars readonly DB failure',String(error?.name||'database_error').slice(0,60));
    return response({ok:false,error:'payment_temporarily_unavailable'},503,trusted);
  }
  return response({ok:false,error:'not_found'},404,trusted);
}
