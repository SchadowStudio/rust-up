// RUST UP local sandbox adapter: never touches the Telegram/game backend.
// Only the LOCAL simulator, local SQLite and artificial player UUIDs.
// This is NOT a production payment processor or gambling balance integration.
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {ASSETS} from '../../src/assets.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIATS=new Set(['EUR','RUB','USD']);
const safeInt=value=>Number.isSafeInteger(value)&&value>=100&&value<=100000000;
function localAddress(value){
 const url=new URL(value);
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||
    !/^\d{1,5}$/.test(url.port)||url.username||url.password||
    url.hash||url.search||url.pathname!=='/')
  throw Error('sandbox_gateway_must_be_localhost');
 return url.origin;
}
function init(db){
 db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS rustup_sandbox_orders(
  order_id TEXT PRIMARY KEY, player_ref TEXT NOT NULL,
  invoice_id TEXT UNIQUE, fiat TEXT NOT NULL,amount_minor INTEGER NOT NULL,
  asset TEXT NOT NULL, idempotency_key TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',created_at_ms INTEGER NOT NULL
 );
 CREATE TABLE IF NOT EXISTS rustup_sandbox_credits(
  event_id TEXT PRIMARY KEY,invoice_id TEXT UNIQUE NOT NULL,
  order_id TEXT UNIQUE NOT NULL,player_ref TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,currency TEXT NOT NULL,credited_at_ms INTEGER NOT NULL
 );
 CREATE TABLE IF NOT EXISTS rustup_sandbox_balances(
  player_ref TEXT NOT NULL,currency TEXT NOT NULL,
  balance_minor INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(player_ref,currency)
 );`);
}
export class RustUpLocalSandboxBridge{
 constructor({gatewayUrl,credentials,dbFile=':memory:'}){
  if(process.env.MULTI_LIVE_ENABLED==='true'||process.env.NODE_ENV==='production')
   throw Error('sandbox_forbidden_in_production');
  this.base=localAddress(gatewayUrl);
  if(!UUID.test(credentials?.projectId)||
     typeof credentials.projectApiKey!=='string'||
     credentials.projectApiKey.length<48||
     typeof credentials.operatorKey!=='string'||
     credentials.operatorKey.length<48||
     credentials.mode!=='LOCAL_SIMULATION_ONLY')
   throw Error('sandbox_credentials_required');
  this.credentials=credentials;
  this.db=new DatabaseSync(dbFile);
  init(this.db);
 }
 async request(route,{method='GET',data,operator=false,key}={}){
  if(!route.startsWith('/')||route.startsWith('//')||route.includes('?')||
     route.includes('..'))throw Error('invalid_local_route');
  const headers={
   ...(!operator?{
    authorization:'Bearer '+this.credentials.projectApiKey,
    'x-project-id':this.credentials.projectId
   }:{'x-local-operator':this.credentials.operatorKey}),
   ...(data?{'content-type':'application/json'}:{}),
   ...(key?{'idempotency-key':key}:{})
  };
  const response=await fetch(this.base+route,{
   method,redirect:'error',headers,
   ...(data?{body:JSON.stringify(data)}:{}),
   signal:AbortSignal.timeout(5000)
  });
  const result=await response.json();
  if(!response.ok||!result.ok)throw Error('sandbox_gateway_'+(result.error||response.status));
  return result;
 }
 async createOrder({playerRef=randomUUID(),fiat='EUR',amountMinor=2500,asset='ETH'}={}){
  if(!UUID.test(playerRef)||!FIATS.has(fiat)||!safeInt(amountMinor)||!ASSETS[asset])
   throw Error('invalid_sandbox_order');
  // An opaque LOCAL test player UUID, never an actual Telegram/Steam account.
  const orderId=randomUUID(),key=randomUUID();
  this.db.prepare(`INSERT INTO rustup_sandbox_orders(
   order_id,player_ref,fiat,amount_minor,asset,idempotency_key,created_at_ms)
   VALUES(?,?,?,?,?,?,?)`).run(orderId,playerRef,fiat,amountMinor,asset,key,Date.now());
  await this.retryInvoice(orderId);
  return this.order(orderId);
 }
 async retryInvoice(orderId){
  const row=this.order(orderId);
  if(!row)throw Error('sandbox_order_not_found');
  if(row.invoice_id)return row;
  const answer=await this.request('/v2/deposits',{method:'POST',key:row.idempotency_key,
   data:{currency:row.fiat,amountMinor:row.amount_minor,asset:row.asset,
    projectOrderRef:row.order_id}});
  const inv=answer.invoice;
  if(!inv||inv.simulationOnly!==true||inv.receiveAddress!==null||
     inv.confirmedOnChain!==false||inv.projectOrderRef!==row.order_id||
     inv.amountMinor!==row.amount_minor||inv.asset!==row.asset||
     inv.fiat!==row.fiat||!UUID.test(inv.invoiceId))
   throw Error('untrusted_sandbox_invoice');
  this.db.prepare('UPDATE rustup_sandbox_orders SET invoice_id=? WHERE order_id=? AND invoice_id IS NULL')
   .run(inv.invoiceId,orderId);
  return this.order(orderId);
 }
 async simulate(orderId){
  const row=this.order(orderId);
  if(!row?.invoice_id)throw Error('sandbox_invoice_missing');
  const answer=await this.request('/demo/invoices/'+row.invoice_id+'/simulate-confirmation',
   {method:'POST',operator:true});
  if(answer.simulationOnly!==true||answer.merchantAck!==true)
   throw Error('sandbox_confirmation_invalid');
  await this.synchronize();
  return this.order(orderId);
 }
 async synchronize(){
  const answer=await this.request('/v2/events');
  if(!answer.simulationOnly||!Array.isArray(answer.events)||
     answer.events.length>100)throw Error('untrusted_sandbox_events');
  let credited=0;
  for(const item of answer.events){
   if(item.delivered!==true)continue;
   const e=item.body;
   if(!e||e.eventVersion!==2||e.eventId!==item.eventId||
      e.projectId!==this.credentials.projectId||
      typeof e.invoiceId!=='string'||!UUID.test(e.invoiceId)||
      !UUID.test(e.projectOrderRef))continue;
   const row=this.order(e.projectOrderRef);
   if(!row||row.invoice_id!==e.invoiceId||row.fiat!==e.currency||
      row.amount_minor!==e.amountMinor||row.asset!==e.asset||
      row.status==='credited'||!safeInt(e.amountMinor))continue;
   this.db.exec('BEGIN IMMEDIATE');
   try{
    const previous=this.db.prepare(`SELECT event_id FROM rustup_sandbox_credits
      WHERE event_id=? OR invoice_id=? OR order_id=?`)
     .get(e.eventId,e.invoiceId,row.order_id);
    if(!previous){
     this.db.prepare(`INSERT INTO rustup_sandbox_credits
      (event_id,invoice_id,order_id,player_ref,amount_minor,currency,credited_at_ms)
      VALUES(?,?,?,?,?,?,?)`).run(e.eventId,e.invoiceId,row.order_id,
      row.player_ref,row.amount_minor,row.fiat,Date.now());
     this.db.prepare(`INSERT INTO rustup_sandbox_balances
       (player_ref,currency,balance_minor) VALUES(?,?,?)
       ON CONFLICT(player_ref,currency) DO UPDATE SET
       balance_minor=rustup_sandbox_balances.balance_minor+excluded.balance_minor`)
      .run(row.player_ref,row.fiat,row.amount_minor);
     this.db.prepare('UPDATE rustup_sandbox_orders SET status=? WHERE order_id=?')
      .run('credited',row.order_id);
     credited++;
    }
    this.db.exec('COMMIT');
   }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  return {credited,simulationOnly:true};
 }
 order(id){
  if(!UUID.test(id))return null;
  return this.db.prepare('SELECT * FROM rustup_sandbox_orders WHERE order_id=?').get(id)||null;
 }
 balance(playerRef,currency='EUR'){
  if(!UUID.test(playerRef)||!FIATS.has(currency))throw Error('invalid_sandbox_balance');
  const row=this.db.prepare(`SELECT balance_minor FROM rustup_sandbox_balances
   WHERE player_ref=? AND currency=?`).get(playerRef,currency);
  return row?.balance_minor??0;
 }
 close(){this.db.close();}
}
