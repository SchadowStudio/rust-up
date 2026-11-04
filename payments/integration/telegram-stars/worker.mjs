import {verifiedTelegramInitData} from './telegram-initdata.mjs';
import {createStarsCheckout,receiveStarsWebhook} from './stars.mjs';

const json=(data,status=200,origin=null)=>new Response(JSON.stringify(data),{
  status,headers:{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store','x-content-type-options':'nosniff',
    'referrer-policy':'no-referrer',
    ...(origin?{'access-control-allow-origin':origin,'vary':'origin'}:{})
  }
});
const allowedOrigin=(origin,env)=>typeof origin==='string'&&
  origin.startsWith('https://')&&origin===env.STARS_ALLOWED_ORIGIN;

export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(url.pathname==='/health'&&request.method==='GET')
      return json({ok:true,service:'rustup-stars-staging',
        liveEnabled:env.STARS_PAYMENT_ENABLED==='true',
        realGameCredits:false});
    if(url.pathname==='/telegram/stars/webhook')
      return receiveStarsWebhook(request,env);
    if(url.pathname!=='/api/stars/checkout')
      return json({ok:false,error:'not_found'},404);
    if(env.STARS_PAYMENT_ENABLED!=='true')
      return json({ok:false,error:'stars_checkout_disabled'},503);
    const origin=request.headers.get('origin');
    if(!allowedOrigin(origin,env))
      return json({ok:false,error:'origin_rejected'},403);
    if(request.method==='OPTIONS')
      return new Response(null,{status:204,headers:{
        'access-control-allow-origin':origin,'access-control-allow-methods':'POST',
        'access-control-allow-headers':'content-type',
        'access-control-max-age':'60','vary':'origin'
      }});
    if(request.method!=='POST')
      return json({ok:false,error:'method_not_allowed'},405,origin);
    if(request.headers.get('content-type')?.split(';')[0]!=='application/json')
      return json({ok:false,error:'content_type'},415,origin);
    const raw=await request.text();
    if(raw.length>6000)return json({ok:false,error:'too_large'},413,origin);
    let body;
    try {body=JSON.parse(raw);}
    catch {return json({ok:false,error:'bad_json'},400,origin);}
    if(!body||typeof body!=='object'||Array.isArray(body)||
      !env.TG_STARS_BOT_TOKEN||!env.DB)
      return json({ok:false,error:'unavailable'},503,origin);
    let user;
    try {
      user=await verifiedTelegramInitData(body.initData,env.TG_STARS_BOT_TOKEN);
    } catch {
      return json({ok:false,error:'telegram_auth_invalid'},401,origin);
    }
    if(typeof body.sku!=='string'||!(/^[a-z][a-z0-9_-]{2,39}$/).test(body.sku))
      return json({ok:false,error:'invalid_product'},400,origin);
    try {
      const invoice=await createStarsCheckout(env,{
        verifiedTelegramUserId:user.userId,sku:body.sku
      });
      return json({ok:true,...invoice},200,origin);
    } catch {
      // Do not expose Telegram errors or database details publicly.
      return json({ok:false,error:'payment_temporarily_unavailable'},503,origin);
    }
  }
};
