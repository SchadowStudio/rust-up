// Owner-controlled package pricing; every amount is fixed before an invoice
// is created. No client-selected amount or exchange rate is trusted.
import {ASSETS,decimalToAtomic,formatAtomic} from './assets.js';
const json=(data,status=200)=>new Response(JSON.stringify(data),{
 status,headers:{'content-type':'application/json','cache-control':'no-store'}
});
const error=(code,status=400)=>json({ok:false,error:code},status);
async function body(request){
 const raw=await request.text();
 if(raw.length>4096)throw Error('body_too_large');
 const value=JSON.parse(raw);
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('bad_body');
 return value;
}
async function audit(db,action,target,details){
 await db.prepare(`INSERT INTO payment_operator_audit
  (id,action,target,metadata,occurred_at_ms) VALUES(?,?,?,?,?)`)
  .bind(crypto.randomUUID(),action,target,JSON.stringify(details),Date.now()).run();
}
export async function offerRoute(req,db,path){
 if(path==='/v1/operator/offers'&&req.method==='GET'){
  const [packages,quotes]=await Promise.all([
   db.prepare('SELECT id,title,credit_kopecks,enabled FROM payment_packages ORDER BY credit_kopecks').all(),
   db.prepare('SELECT package_id,asset,amount_atomic,enabled FROM payment_quotes ORDER BY package_id,asset').all()
  ]);
  return json({ok:true,packages:packages.results||[],quotes:(quotes.results||[]).map(q=>({
   packageId:q.package_id,asset:q.asset,chain:ASSETS[q.asset]?.chain,
   amount:ASSETS[q.asset]?formatAtomic(q.amount_atomic,ASSETS[q.asset].decimals):null,
   amountAtomic:q.amount_atomic,enabled:q.enabled===1
  }))});
 }
 if(path==='/v1/operator/offers'&&req.method==='POST'){
  const value=await body(req);
  if(!/^[a-z0-9][a-z0-9_-]{2,35}$/.test(value.id||'')||
     typeof value.title!=='string'||value.title.length<3||value.title.length>80||
     !Number.isSafeInteger(value.creditKopecks)||value.creditKopecks<100||
     value.creditKopecks>1000000000)return error('invalid_offer');
  await db.batch([
   db.prepare(`INSERT INTO payment_packages
    (id,title,credit_kopecks,enabled) VALUES(?,?,?,0)`)
    .bind(value.id,value.title,value.creditKopecks),
   db.prepare(`INSERT INTO payment_operator_audit
    (id,action,target,metadata,occurred_at_ms) VALUES(?,'create_offer',?,?,?)`)
    .bind(crypto.randomUUID(),value.id,JSON.stringify({creditKopecks:value.creditKopecks}),Date.now())
  ]);
  return json({ok:true,id:value.id,enabled:false},201);
 }
 if(path==='/v1/operator/quotes'&&req.method==='POST'){
  const value=await body(req),asset=ASSETS[value.asset];
  if(!asset||!value.packageId||typeof value.packageId!=='string'||
     value.packageId.length>80)return error('invalid_quote');
  let atomic;
  try{atomic=decimalToAtomic(value.amount,asset.decimals);}
  catch{return error('invalid_amount_or_decimals');}
  await db.batch([
   db.prepare(`INSERT INTO payment_quotes(package_id,asset,amount_atomic,enabled)
    VALUES(?,?,?,0) ON CONFLICT(package_id,asset)
    DO UPDATE SET amount_atomic=excluded.amount_atomic,enabled=0`)
    .bind(value.packageId,value.asset,atomic),
   db.prepare(`INSERT INTO payment_operator_audit
    (id,action,target,metadata,occurred_at_ms)
    VALUES(?,'set_quote',?,?,?)`)
    .bind(crypto.randomUUID(),value.packageId+':'+value.asset,
     JSON.stringify({amountAtomic:atomic}),Date.now())
  ]);
  return json({ok:true,amountAtomic:atomic,enabled:false});
 }
 const match=/^\/v1\/operator\/(offers|quotes)\/([a-zA-Z0-9_-]+)(?:\/(BTC|ETH|TRX|USDT_ERC20|USDT_TRC20))?\/(enable|disable)$/.exec(path);
 if(match&&req.method==='POST'){
  const [,resource,id,asset,action]=match;
  const value=await body(req);
  if(value.confirmation!=='I_APPROVE_THIS_PRICE')return error('explicit_price_confirmation_required');
  const enabled=action==='enable'?1:0;
  const result=resource==='offers'
   ?await db.prepare('UPDATE payment_packages SET enabled=? WHERE id=?').bind(enabled,id).run()
   :asset?await db.prepare('UPDATE payment_quotes SET enabled=? WHERE package_id=? AND asset=?')
     .bind(enabled,id,asset).run():null;
  if(!result?.meta?.changes)return error('offer_or_quote_not_found',404);
  await audit(db,action+'_'+resource,id+(asset?':'+asset:''),{enabled:!!enabled});
  return json({ok:true,id,asset:asset||null,enabled:!!enabled});
 }
 return error('offer_route_not_found',404);
}
