// Example receiving project callback. Integrate equivalent logic into
// each project's actual ledger rather than deploying it blindly.
const bytes=s=>new TextEncoder().encode(s);
async function digest(body){
 const d=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes(body)));
 return [...d].map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function signature(key,body){
 const cryptoKey=await crypto.subtle.importKey('raw',bytes(key),
  {name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signed=new Uint8Array(await crypto.subtle.sign('HMAC',cryptoKey,bytes(body)));
 return [...signed].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function equal(a,b){
 if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;
 let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
 return diff===0;
}
function reply(data,status=200){return new Response(JSON.stringify(data),{
 status,headers:{'content-type':'application/json','cache-control':'no-store'}})}
export async function verifyProjectCallback(request,env,now=Date.now()){
 if(!env.PROJECT_ID||!env.PROJECT_WEBHOOK_SECRET||
    env.PROJECT_WEBHOOK_SECRET.length<32)throw Error('unconfigured_project');
 const projectId=request.headers.get('x-rup-project')||'';
 const eventId=request.headers.get('x-rup-event')||'';
 const stamp=request.headers.get('x-rup-timestamp')||'';
 const mac=request.headers.get('x-rup-signature')||'';
 if(projectId!==env.PROJECT_ID||!/^v2:[0-9a-f-]{36}$/i.test(eventId)||
    !/^[0-9]{13}$/.test(stamp)||Math.abs(now-Number(stamp))>300000||
    !/^v2=[0-9a-f]{64}$/.test(mac))throw Error('invalid_request_signature');
 const raw=await request.text();
 if(raw.length>3072)throw Error('invalid_event_size');
 const data=stamp+'.'+projectId+'.'+eventId+'.'+raw;
 const expected=await signature(env.PROJECT_WEBHOOK_SECRET,data);
 if(!equal(expected,mac.slice(3)))throw Error('invalid_request_signature');
 let event;try{event=JSON.parse(raw)}catch{throw Error('invalid_event_body')}
 if(event.eventVersion!==2||event.eventId!==eventId||
    event.projectId!==projectId||!['RUB','EUR','USD'].includes(event.currency)||
    !Number.isSafeInteger(event.amountMinor)||event.amountMinor<=0||
    !/^[0-9a-f-]{36}$/i.test(String(event.projectOrderRef))||
    !/^[0-9a-f-]{36}$/i.test(String(event.invoiceId)))
  throw Error('invalid_event_body');
 return {event,sha256:await digest(raw)};
}
export default {
 async fetch(request,env){
  if(request.method!=='POST'||new URL(request.url).pathname!=='/internal/crypto/credit')
   return reply({ok:false,error:'not_found'},404);
  let validated;try{validated=await verifyProjectCallback(request,env)}
  catch{return reply({ok:false,error:'signature_rejected'},401)}
  const {event,sha256}=validated;
  if(!env.PROJECT_DB)return reply({ok:false,error:'database_unavailable'},503);
  const db=env.PROJECT_DB;
  const pending=await db.prepare(`SELECT account_id,currency,amount_minor
   FROM merchant_pending_orders WHERE project_order_ref=?`)
   .bind(event.projectOrderRef).first();
  if(!pending||pending.currency!==event.currency||
     pending.amount_minor!==event.amountMinor)
   return reply({ok:false,error:'invoice_not_expected'},409);
  try{
   await db.batch([
    db.prepare(`INSERT INTO merchant_credit_events
     (event_id,invoice_id,project_order_ref,body_sha256,amount_minor,credited_at_ms)
     VALUES(?,?,?,?,?,?)`)
     .bind(event.eventId,event.invoiceId,event.projectOrderRef,sha256,
      event.amountMinor,Date.now()),
    db.prepare(`INSERT INTO merchant_wallets(account_id,currency,balance_minor)
     VALUES(?,?,?) ON CONFLICT(account_id,currency) DO UPDATE SET
     balance_minor=merchant_wallets.balance_minor+excluded.balance_minor`)
     .bind(pending.account_id,event.currency,event.amountMinor)
   ]);
   return reply({ok:true,eventId:event.eventId});
  }catch{
   const old=await db.prepare(`SELECT invoice_id,project_order_ref,body_sha256
    FROM merchant_credit_events WHERE event_id=?`).bind(event.eventId).first();
   if(old&&old.body_sha256===sha256&&old.invoice_id===event.invoiceId&&
      old.project_order_ref===event.projectOrderRef)
    return reply({ok:true,eventId:event.eventId,replayed:true});
   return reply({ok:false,error:'ledger_conflict_or_unavailable'},503);
  }
 }
};
