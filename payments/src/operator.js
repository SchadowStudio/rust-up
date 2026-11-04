import {validateReceivingAddress} from './address.js';
import {offerRoute} from './offers.js';
const respond=(obj,status=200)=>new Response(JSON.stringify(obj),{
 status,headers:{'content-type':'application/json','cache-control':'no-store'}
});
const fail=(code,status=400)=>respond({ok:false,error:code},status);
const format=row=>({chain:row.chain,address:row.address,
 assigned:!!row.assigned_intent,enabled:row.enabled===1,
 source:row.source,label:row.label,confirmedAt:row.confirmed_at_ms});
export async function authenticatedOperator(request,env){
 if(typeof env.OPERATOR_API_KEY!=='string'||env.OPERATOR_API_KEY.length<40)return false;
 const h=request.headers.get('authorization')||'';
 if(!h.startsWith('Bearer ')||h.length>1024)return false;
 const actual=h.slice(7),expected=env.OPERATOR_API_KEY;
 if(actual.length!==expected.length)return false;
 // Constant-work comparison (keys should be uniformly random >= 256 bits).
 let diff=0;
 for(let i=0;i<expected.length;i++)diff|=actual.charCodeAt(i)^expected.charCodeAt(i);
 return diff===0;
}
async function input(req){
 const raw=await req.text();
 if(raw.length>2048)throw new Error('operator_request_too_large');
 return JSON.parse(raw);
}
export async function operatorRoute(request,env,url) {
 if(!await authenticatedOperator(request,env))return fail('operator_unauthorized',401);
 if(!env.DB)return fail('database_not_configured',503);
 const p=url.pathname,db=env.DB;
 if(p.includes('/offers')||p.includes('/quotes'))return offerRoute(request,db,p);
 if(p==='/v1/operator/receivers'&&request.method==='GET'){
  const rows=await db.prepare(
   'SELECT chain,address,assigned_intent,enabled,source,label,confirmed_at_ms FROM deposit_addresses ORDER BY chain,address'
  ).all();
  return respond({ok:true,receivers:(rows.results||[]).map(format)});
 }
 if(p==='/v1/operator/receivers'&&request.method==='POST'){
  const body=await input(request);
  if(!body||!['bitcoin','ethereum','tron'].includes(body.chain)||
      !await validateReceivingAddress(body.chain,body.address))
   return fail('invalid_mainnet_receiving_address');
  if(typeof body.label!=='string'||body.label.length>40||
      !/^[a-zA-Z0-9 _-]*$/.test(body.label))return fail('invalid_label');
  const now=Date.now(),source=body.source==='trust_wallet'?'trust_wallet':'operator_watch_only';
  const id=crypto.randomUUID();
  const [insert]=await db.batch([
   db.prepare(`INSERT OR IGNORE INTO deposit_addresses(chain,address,assigned_intent,
    source,added_at_ms,label,enabled) VALUES(?,?,NULL,?,?,?,0)`)
    .bind(body.chain,body.address,source,now,body.label),
   db.prepare(`INSERT INTO payment_operator_audit(id,action,target,metadata,occurred_at_ms)
    VALUES(?,'add_receiver',?,?,?)`)
    .bind(id,body.chain+':'+body.address,JSON.stringify({source,label:body.label}),now)
  ]);
  if(!insert.meta?.changes)return fail('receiver_already_exists',409);
  return respond({ok:true,receiver:{chain:body.chain,address:body.address,enabled:false,source}},201);
 }
 const match=/^\/v1\/operator\/receivers\/(bitcoin|ethereum|tron)\/([a-zA-Z0-9]+)\/(enable|disable)$/.exec(p);
 if(match&&request.method==='POST'){
  const [,chain,address,action]=match;
  const body=await input(request);
  if(body?.confirmation!=='I_CONTROL_THIS_ADDRESS')return fail('explicit_confirmation_required');
  const now=Date.now(),isEnable=action==='enable'?1:0;
  const [changed]=await db.batch([
   db.prepare(`UPDATE deposit_addresses SET enabled=?,confirmed_at_ms=?
    WHERE chain=? AND address=? AND assigned_intent IS NULL`)
    .bind(isEnable,isEnable?now:null,chain,address),
   db.prepare(`INSERT INTO payment_operator_audit(id,action,target,metadata,occurred_at_ms)
    VALUES(?,?,?,?,?)`)
    .bind(crypto.randomUUID(),action+'_receiver',chain+':'+address,'{}',now)
  ]);
  if(!changed.meta?.changes)return fail('receiver_not_available',404);
  return respond({ok:true,chain,address,enabled:!!isEnable});
 }
 if(p==='/v1/operator/health'&&request.method==='GET'){
  const rows=await db.prepare(`SELECT status,COUNT(*) AS count
    FROM payment_intents GROUP BY status`).all();
  const pending=await db.prepare(`SELECT COUNT(*) AS count FROM payment_outbox
    WHERE delivered_at_ms IS NULL`).first();
  const review=await db.prepare(`SELECT COUNT(*) AS count FROM payment_review_queue
    WHERE resolved_at_ms IS NULL`).first();
  return respond({ok:true,orders:rows.results||[],
   awaitingGameIntegration:pending?.count||0,manualReview:review?.count||0,
   livePayments:env.CRYPTO_PAYMENTS_ENABLED==='true'});
 }
 return fail('operator_not_found',404);
}
