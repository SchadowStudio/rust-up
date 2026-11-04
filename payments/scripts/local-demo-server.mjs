// ISOLATED LOCAL PAYMENT SIMULATOR. Never use for real funds or a live merchant.
// Uses SQLite and the *real* HMAC webhook/merchant-ledger code with NO chain RPC.
// Only localhost may connect. No paid services, wallet keys, or npm install.
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {ASSETS} from '../src/assets.js';
import {signV2Webhook} from '../src/multi/delivery.js';
import {projectWebhookKey} from '../src/multi/keys.js';
import merchantWorker from '../integration/project-ledger/worker.js';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const LOCAL_DIR=path.join(ROOT,'.local-test-results');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const requestLimit=4096;
const json=(body,status=200)=>({status,body:JSON.stringify(body)});
const compatible=(a,b)=>{
 if(typeof a!=='string'||typeof b!=='string')return false;
 const left=Buffer.from(a),right=Buffer.from(b);
 return left.length===right.length&&timingSafeEqual(left,right);
};
function openDatabase(file){
 const db=new DatabaseSync(file);
 db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS demo_invoices (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, project_order_ref TEXT UNIQUE NOT NULL,
  idempotency_key TEXT UNIQUE NOT NULL, request_body TEXT NOT NULL,
  fiat TEXT NOT NULL, amount_minor INTEGER NOT NULL, asset TEXT NOT NULL,
  chain TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'awaiting_payment',
  created_at_ms INTEGER NOT NULL, event_body TEXT, delivered_at_ms INTEGER
 );
 CREATE TABLE IF NOT EXISTS merchant_pending_orders (
  project_order_ref TEXT PRIMARY KEY,
  account_id TEXT NOT NULL, currency TEXT NOT NULL, amount_minor INTEGER NOT NULL
 );
 CREATE TABLE IF NOT EXISTS merchant_credit_events (
  event_id TEXT PRIMARY KEY, invoice_id TEXT UNIQUE NOT NULL,
  project_order_ref TEXT UNIQUE NOT NULL, body_sha256 TEXT NOT NULL,
  amount_minor INTEGER NOT NULL, credited_at_ms INTEGER NOT NULL
 );
 CREATE TABLE IF NOT EXISTS merchant_wallets (
  account_id TEXT NOT NULL,currency TEXT NOT NULL,balance_minor INTEGER NOT NULL,
  PRIMARY KEY(account_id,currency)
 );`);
 return db;
}
function d1Merchant(sqlite){
 const wrap=(sql)=>({bind(...args){
  const statement=sqlite.prepare(sql);
  return {args,statement,
   first:async()=>statement.get(...args)??null,
   run:async()=>({meta:{changes:statement.run(...args).changes}}),
   all:async()=>({results:statement.all(...args)})
  };
 }});
 return {
  prepare:wrap,
  async batch(statements){
   sqlite.exec('BEGIN IMMEDIATE');
   try{
    const results=statements.map(s=>({meta:{changes:s.statement.run(...s.args).changes}}));
    sqlite.exec('COMMIT');return results;
   }catch(error){sqlite.exec('ROLLBACK');throw error;}
  }
 };
}
function invoiceShape(i){
 return {invoiceId:i.id,projectOrderRef:i.project_order_ref,status:i.status,
  fiat:i.fiat,amountMinor:i.amount_minor,asset:i.asset,chain:i.chain,
  receiveAddress:null,amountAtomic:null,confirmedOnChain:false,
  deliveredToProject:i.delivered_at_ms!=null,simulationOnly:true,
  warning:'LOCAL_SIMULATION_ONLY: no blockchain transaction or receiving wallet'};
}
async function readBody(req){
 let total=0,parts=[];
 for await(const chunk of req){
  total+=chunk.length;
  if(total>requestLimit)throw Error('request_too_large');
  parts.push(chunk);
 }
 const obj=JSON.parse(Buffer.concat(parts).toString('utf8'));
 if(!obj||Array.isArray(obj)||typeof obj!=='object')throw Error('invalid_body');
 return obj;
}
function send(res,item){
 res.writeHead(item.status,{
  'content-type':'application/json; charset=utf-8','cache-control':'no-store',
  'x-content-type-options':'nosniff','access-control-allow-origin':'null'
 });
 res.end(item.body);
}
export function createLocalDemo({dbFile=':memory:',port=0}={}){
 if(process.env.MULTI_LIVE_ENABLED==='true'||process.env.NODE_ENV==='production')
  throw Error('LOCAL_DEMO_FORBIDDEN_IN_PRODUCTION');
 const sqlite=openDatabase(dbFile),merchantDb=d1Merchant(sqlite);
 const projectId=randomUUID(),projectApiKey=randomBytes(40).toString('hex');
 const operatorKey=randomBytes(40).toString('hex');
 const masterKey=randomBytes(48).toString('hex');
 const host='127.0.0.1';
 const credentials={projectId,projectApiKey,operatorKey,mode:'LOCAL_SIMULATION_ONLY'};
 const merchantEnvPromise=projectWebhookKey(masterKey,projectId).then(secret=>({
  PROJECT_ID:projectId,PROJECT_WEBHOOK_SECRET:secret,PROJECT_DB:merchantDb
 }));
 const server=createServer(async(req,res)=>{
  if(req.socket.remoteAddress!=='127.0.0.1'&&
     req.socket.remoteAddress!=='::ffff:127.0.0.1'){
   return send(res,json({ok:false,error:'loopback_only'},403));
  }
  if(req.headers.origin)return send(res,json({ok:false,error:'server_to_server_only'},403));
  const url=new URL(req.url,'http://127.0.0.1');
  const route=url.pathname,method=req.method;
  const apiAllowed=compatible(req.headers.authorization,'Bearer '+projectApiKey) &&
   req.headers['x-project-id']===projectId;
  const opAllowed=compatible(req.headers['x-local-operator'],operatorKey);
  try{
   if(route==='/health'&&method==='GET')
    return send(res,json({ok:true,simulationOnly:true,realPaymentsEnabled:false,
     blockchainConnected:false,service:'rustup-local-demo'}));
   if(route==='/v2/me'&&method==='GET'){
    if(!apiAllowed)return send(res,json({ok:false,error:'unauthorized'},401));
    return send(res,json({ok:true,projectId,simulationOnly:true}));
   }
   if(route==='/v2/deposits'&&method==='POST'){
    if(!apiAllowed)return send(res,json({ok:false,error:'unauthorized'},401));
    if(req.headers['content-type']?.split(';')[0]!=='application/json')
     return send(res,json({ok:false,error:'invalid_content_type'},415));
    const b=await readBody(req),key=req.headers['idempotency-key'];
    if(!UUID.test(b.projectOrderRef)||!UUID.test(key)||
       !['EUR','RUB','USD'].includes(b.currency)||
       !Number.isSafeInteger(b.amountMinor)||b.amountMinor<100||
       b.amountMinor>100000000||!ASSETS[b.asset])
     return send(res,json({ok:false,error:'invalid_invoice_request'},400));
    const requestBody=JSON.stringify({currency:b.currency,amountMinor:b.amountMinor,
     asset:b.asset,projectOrderRef:b.projectOrderRef});
    const old=sqlite.prepare('SELECT * FROM demo_invoices WHERE idempotency_key=?')
     .get(key);
    if(old){
     if(old.request_body!==requestBody)return send(res,json({
      ok:false,error:'idempotency_conflict'},409));
     return send(res,json({ok:true,replayed:true,invoice:invoiceShape(old)}));
    }
    const id=randomUUID();
    try{
     sqlite.exec('BEGIN IMMEDIATE');
     sqlite.prepare(`INSERT INTO demo_invoices
      (id,project_id,project_order_ref,idempotency_key,request_body,
      fiat,amount_minor,asset,chain,created_at_ms)
      VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(id,projectId,b.projectOrderRef,key,requestBody,b.currency,
       b.amountMinor,b.asset,ASSETS[b.asset].chain,Date.now());
     sqlite.prepare(`INSERT INTO merchant_pending_orders
      (project_order_ref,account_id,currency,amount_minor) VALUES(?,?,?,?)`)
      .run(b.projectOrderRef,'LOCAL_TEST_ACCOUNT',b.currency,b.amountMinor);
     sqlite.exec('COMMIT');
    }catch{
     sqlite.exec('ROLLBACK');
     return send(res,json({ok:false,error:'duplicate_order_reference'},409));
    }
    const created=sqlite.prepare('SELECT * FROM demo_invoices WHERE id=?').get(id);
    return send(res,json({ok:true,invoice:invoiceShape(created)},201));
   }
   const inv=/^\/v2\/invoices\/([0-9a-f-]{36})$/.exec(route);
   if(inv&&method==='GET'){
    if(!apiAllowed)return send(res,json({ok:false,error:'unauthorized'},401));
    const i=sqlite.prepare('SELECT * FROM demo_invoices WHERE id=? AND project_id=?')
     .get(inv[1],projectId);
    return send(res,i?json({ok:true,invoice:invoiceShape(i)}):
     json({ok:false,error:'invoice_not_found'},404));
   }
   if(route==='/v2/events'&&method==='GET'){
    if(!apiAllowed)return send(res,json({ok:false,error:'unauthorized'},401));
    const items=sqlite.prepare(`SELECT id,event_body,created_at_ms,delivered_at_ms
     FROM demo_invoices WHERE project_id=? AND event_body IS NOT NULL
     ORDER BY created_at_ms,id LIMIT 100`).all(projectId);
    return send(res,json({ok:true,events:items.map(x=>({
     eventId:'v2:'+x.id,body:JSON.parse(x.event_body),
     delivered:x.delivered_at_ms!=null,createdAt:x.created_at_ms
    })),simulationOnly:true}));
   }
   const sim=/^\/demo\/invoices\/([0-9a-f-]{36})\/simulate-confirmation$/.exec(route);
   if(sim&&method==='POST'){
    if(!opAllowed)return send(res,json({ok:false,error:'operator_only'},401));
    let i=sqlite.prepare('SELECT * FROM demo_invoices WHERE id=? AND project_id=?')
     .get(sim[1],projectId);
    if(!i)return send(res,json({ok:false,error:'invoice_not_found'},404));
    if(!i.event_body){
     const eventId='v2:'+i.id;
     const body=JSON.stringify({eventVersion:2,eventId,projectId,
      invoiceId:i.id,projectOrderRef:i.project_order_ref,
      amountMinor:i.amount_minor,currency:i.fiat,asset:i.asset,chain:i.chain,
      amountAtomic:'100',transactionHash:'0x'+randomBytes(32).toString('hex'),
      confirmedAt:Date.now()});
     sqlite.prepare(`UPDATE demo_invoices
      SET status='verified',event_body=? WHERE id=? AND event_body IS NULL`)
      .run(body,i.id);
     i=sqlite.prepare('SELECT * FROM demo_invoices WHERE id=?').get(i.id);
    }
    const stamp=Date.now(),eventId='v2:'+i.id;
    const signature=await signV2Webhook(masterKey,projectId,eventId,stamp,i.event_body);
    // In-process dispatch: No external HTTP call is permitted or even needed.
    const response=await merchantWorker.fetch(
     new Request('http://127.0.0.1/internal/crypto/credit',{
      method:'POST',headers:{
       'content-type':'application/json','x-rup-project':projectId,
       'x-rup-event':eventId,'x-rup-timestamp':String(stamp),
       'x-rup-signature':signature
      },body:i.event_body}),await merchantEnvPromise);
    const ack=await response.json();
    if(!response.ok||ack.ok!==true||ack.eventId!==eventId)
     return send(res,json({ok:false,error:'local_merchant_callback_failed',
      callbackStatus:response.status},503));
    sqlite.prepare('UPDATE demo_invoices SET delivered_at_ms=? WHERE id=?')
     .run(Date.now(),i.id);
    return send(res,json({ok:true,simulationOnly:true,
     replayed:ack.replayed===true,eventId,merchantAck:true,
     warning:'No coins were sent, verified, or received'}));
   }
   if(route==='/demo/merchant/balance'&&method==='GET'){
    if(!opAllowed)return send(res,json({ok:false,error:'operator_only'},401));
    const wallets=sqlite.prepare(`SELECT account_id,currency,balance_minor
     FROM merchant_wallets ORDER BY currency`).all();
    const creditCount=sqlite.prepare('SELECT COUNT(*) AS n FROM merchant_credit_events')
     .get().n;
    return send(res,json({ok:true,simulationOnly:true,wallets,creditCount}));
   }
   return send(res,json({ok:false,error:'not_found'},404));
  }catch(error){
   console.error('LOCAL DEMO FAILED:',String(error.message||error).slice(0,140));
   return send(res,json({ok:false,error:'local_demo_error'},503));
  }
 });
 return {
  server,credentials,
  async listen(){
   await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(port,host,resolve);
   });
   const address=server.address();
   return {url:'http://127.0.0.1:'+address.port,...credentials};
  },
  async close(){
   await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
   sqlite.close();
  }
 };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 mkdirSync(LOCAL_DIR,{recursive:true});
 const demo=createLocalDemo({dbFile:path.join(LOCAL_DIR,'local-demo.sqlite'),port:3029});
 try{
  const info=await demo.listen();
  const filepath=path.join(LOCAL_DIR,'local-demo-credentials.json');
  writeFileSync(filepath,JSON.stringify(info,null,2)+'\n',{mode:0o600});
  console.log('RUST UP: LOCAL SIMULATION ONLY, NO REAL FUNDS');
  console.log('Local server: '+info.url);
  console.log('Test-only credentials: .local-test-results/local-demo-credentials.json');
  console.log('Run in a NEW PowerShell window: npm run demo:local:check');
  console.log('Press Ctrl+C to stop; localhost only. Never expose port 3029.');
 }catch(error){
  console.error('Could not start local demo:',error.message);
  process.exitCode=1;
 }
}
