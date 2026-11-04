import test from 'node:test';
import assert from 'node:assert/strict';
import {handleMulti} from '../src/multi/api.js';
import {digestHex} from '../src/multi/keys.js';
import {randomUUID} from 'node:crypto';

const PROJECT='a34af3a9-8c4a-44ec-9e4f-df14bb1d3dea';
const API_KEY='rup2_'+'a'.repeat(64);
const NOW=Date.now();

class FakeD1 {
 constructor(keyHash,currency){
  this.keyHash=keyHash;
  this.orders=[];
  this.currency=currency;
  this.assigned=false;
  this.invoicesEnabled=true;this.depositsEnabled=true;this.productsEnabled=true;
  this.allowedFiats=['RUB','EUR','USD'];
  this.allowedAssets=['BTC','ETH','TRX','USDT_ERC20','USDT_TRC20'];
  this.minMinor=100;this.maxMinor=100000000;this.lifetimeMinutes=20;
 }
 prepare(sql){
  const db=this;
  return {bind(...args){
   return {
    sql,args,
    async all(){
     if(sql.includes('JOIN v2_api_keys'))
      return {results:[{id:PROJECT,status:'active',webhook_url:'https://shop.example.com/payments',secret_sha256:db.keyHash}]};
     if(sql.includes('FROM v2_project_fiat_methods WHERE project_id=?'))
      return {results:['RUB','EUR','USD'].map(currency=>({
       currency,enabled:db.allowedFiats.includes(currency)?1:0,
       min_minor:db.minMinor,max_minor:db.maxMinor
      }))};
     if(sql.includes('FROM v2_project_crypto_methods'))
      return {results:['BTC','ETH','TRX','USDT_ERC20','USDT_TRC20']
       .map(asset=>({asset,enabled:db.allowedAssets.includes(asset)?1:0}))};
     throw Error('unexpected list query: '+sql);
    },
    async first(){
     if(sql.includes('FROM v2_project_payment_profiles p')&&
        sql.includes('JOIN v2_project_fiat_methods'))
      return {invoices_enabled:db.invoicesEnabled?1:0,
       deposits_enabled:db.depositsEnabled?1:0,
       products_enabled:db.productsEnabled?1:0,
       invoice_lifetime_minutes:db.lifetimeMinutes,
       fiat_enabled:db.allowedFiats.includes(args[0])?1:0,
       crypto_enabled:db.allowedAssets.includes(args[1])?1:0,
       min_minor:db.minMinor,max_minor:db.maxMinor};
     if(sql.includes('FROM v2_project_payment_profiles p')&&
        sql.includes('JOIN v2_projects pr'))
      return {project_id:PROJECT,display_name:'Test project',
       invoices_enabled:db.invoicesEnabled?1:0,
       deposits_enabled:db.depositsEnabled?1:0,
       products_enabled:db.productsEnabled?1:0,
       invoice_lifetime_minutes:db.lifetimeMinutes,updated_at_ms:NOW,
       project_status:'active',webhook_url:'https://shop.example.com/payments'};
     if(sql.includes('FROM v2_invoices')&&sql.includes('idempotency_key'))
      return db.orders.find(x=>x.project_id===args[0]&&x.idempotency_key===args[1])||null;
     if(sql.includes('FROM v2_invoices')&&sql.includes('LEFT JOIN v2_delivery_outbox'))
      return db.orders.find(x=>x.project_id===args[0]&&x.id===args[1])||null;
     if(sql.includes('FROM v2_exchange_rates'))
      return {fiat:args[0],asset:args[1],numerator_atomic:'10000',
       denominator_minor:'100',enabled:1,
       valid_from_ms:NOW-1000,expires_at_ms:NOW+1800000};
     if(sql.includes('FROM deposit_addresses'))
      return db.assigned?null:{address:'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'};
     if(sql.includes('FROM v2_products'))
      throw Error('deposit must NOT read merchant products');
     throw Error('unexpected query: '+sql);
    }
   };
  }};
 }
 async batch(stmts){
  if(stmts.length!==3)throw Error('expected quota, address and invoice transaction');
  const sql=stmts.map(x=>x.sql);
  if(!sql[0].includes('v2_invoice_quota')||!sql[1].includes('deposit_addresses')||
     !sql[2].includes('INSERT INTO v2_invoices'))
   throw Error('missing atomic invoice safeguards');
  const p=stmts[2].args.slice(6); // first six bind values enforce the atomic reservation guard
  this.orders.push({
   id:p[0],project_id:p[1],project_order_ref:p[2],idempotency_key:p[3],
   request_hash:p[4],sku:p[5],fiat:p[6],amount_minor:p[7],asset:p[8],
   chain:p[9],receive_address:p[10],amount_atomic:p[11],
   rate_numerator:p[12],rate_denominator:p[13],created_at_ms:p[14],
   expires_at_ms:p[15],status:'awaiting_payment',delivered:null
  });
  this.assigned=true;
  return Array.from({length:3},()=>({meta:{changes:1}}));
 }
}
function environment(db){
 return {DB:db,MULTI_OPERATOR_APPROVED:'true',MULTI_LIVE_ENABLED:'true',
  MULTI_AUTO_SCAN_ENABLED:'true',MULTI_DELIVERY_ENABLED:'true',
  MULTI_RECONCILE_ENABLED:'true',
  MULTI_WEBHOOK_MASTER_KEY:'m'.repeat(48),
  MULTI_STRICT_QUORUM:'true',
  MULTI_ADMIN_KEY:'k'.repeat(64),
  ETHEREUM_RPC_URL:'https://rpc-eth-1.example.com',
  ETHEREUM_RPC_URL_SECONDARY:'https://rpc-eth-2.example.net',
  ETHEREUM_RPC_URL_TERTIARY:'https://rpc-eth-3.example.org',
  TRON_RPC_URL:'https://rpc-tron-1.example.com',
  TRON_RPC_URL_SECONDARY:'https://rpc-tron-2.example.net',
  TRON_RPC_URL_TERTIARY:'https://rpc-tron-3.example.org',
  TRON_INDEXER_URL:'https://tron.example.com',
  BITCOIN_RPC_URL:'https://rpc-btc-1.example.com',
  BITCOIN_RPC_URL_SECONDARY:'https://rpc-btc-2.example.net',
  BITCOIN_RPC_URL_TERTIARY:'https://rpc-btc-3.example.org',
  BITCOIN_RPC_BASIC_B64:'b'.repeat(64),
  BITCOIN_RPC_BASIC_B64_SECONDARY:'b'.repeat(64),
  BITCOIN_RPC_BASIC_B64_TERTIARY:'b'.repeat(64),
  BITCOIN_START_BLOCKHASH:'a'.repeat(64),
  ETHEREUM_START_BLOCK:'2345678',
  USDT_ERC20_CONTRACT:'0xdAC17F958D2ee523a2206206994597C13D831ec7',
  USDT_TRC20_CONTRACT:'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  MULTI_WEBHOOK_HOST_ALLOWLIST:'shop.example.com'
 };
}
function request(path,{body,token=API_KEY,idempotencyKey=randomUUID()}={}){
 return new Request('https://gateway.example.com'+path,{
  method:body?'POST':'GET',
  headers:{'authorization':'Bearer '+token,'x-project-id':PROJECT,
   ...(body?{'content-type':'application/json','idempotency-key':idempotencyKey}:{})},
  ...(body?{body:JSON.stringify(body)}:{})
 });
}
test('provider accepts RUB EUR USD deposits paid in USDT without game wallet logic',async()=>{
 const hash=await digestHex(API_KEY);
 for(const fiat of ['RUB','EUR','USD']){
  const db=new FakeD1(hash,fiat),env=environment(db);
  const ref=randomUUID(),key=randomUUID();
  const body={currency:fiat,amountMinor:5000,asset:'USDT_TRC20',projectOrderRef:ref};
  const first=await handleMulti(request('/v2/deposits',{body,idempotencyKey:key}),env);
  assert.equal(first.status,201,fiat);
  const data=await first.json();
  assert.equal(data.ok,true);
  assert.equal(data.invoice.fiat,fiat);
  assert.equal(data.invoice.amountMinor,5000);
  assert.equal(data.invoice.asset,'USDT_TRC20');
  assert.equal(data.invoice.chain,'tron');
  assert.equal(data.invoice.amountAtomic,'500000'); // test-only mock rate, not a live FX rate
  assert.equal(data.invoice.status,'awaiting_payment');
  assert.equal(data.invoice.creditCurrency,undefined);
  assert.equal(data.invoice.walletBalance,undefined);
  assert.equal(db.orders[0].sku,'__crypto_deposit__');
  const repeat=await handleMulti(request('/v2/deposits',{body,idempotencyKey:key}),env);
  assert.equal(repeat.status,200);
  assert.equal((await repeat.json()).replayed,true);
  assert.equal(db.orders.length,1,'must not reserve two receiving addresses');
  const changed={...body,amountMinor:5500};
  const conflict=await handleMulti(request('/v2/deposits',{body:changed,idempotencyKey:key}),env);
  assert.equal(conflict.status,409);
 }
});
test('merchant without valid project token may not create a deposit',async()=>{
 const db=new FakeD1(await digestHex(API_KEY),'RUB');
 const body={currency:'RUB',amountMinor:1000,asset:'BTC',projectOrderRef:randomUUID()};
 const response=await handleMulti(request('/v2/deposits',{body,token:'Bearer invalid'}),environment(db));
 assert.equal(response.status,401);
 assert.equal(db.orders.length,0);
});
test('deposit rejects unsupported fiat, malformed amounts and unsupported assets',async()=>{
 const hash=await digestHex(API_KEY);
 for(const patch of [{currency:'GBP'},{amountMinor:0},{amountMinor:12.5},
  {amountMinor:100000001},{asset:'DOGE'}]){
  const db=new FakeD1(hash,'RUB');
  const env=environment(db);
  const body={currency:'RUB',amountMinor:1000,asset:'USDT_TRC20',
   projectOrderRef:randomUUID(),...patch};
  const response=await handleMulti(request('/v2/deposits',{body}),env);
  assert.equal(response.status,400,JSON.stringify(patch));
  assert.equal(db.orders.length,0);
 }
});
test('payment provider methods are RUB EUR USD and the five supported crypto networks',async()=>{
 const db=new FakeD1(await digestHex(API_KEY),'RUB');
 const r=await handleMulti(request('/v2/methods'),environment(db));
 assert.equal(r.status,200);
 const data=await r.json();
 assert.deepEqual(data.fiatCurrencies.map(x=>x.currency),['RUB','EUR','USD']);
 assert.equal(data.supportedAssets.length,5);
 assert.match(data.note,/Fiat is invoice value/);
});
test('provider stays disabled without real merchant approval and infrastructure',async()=>{
 const db=new FakeD1(await digestHex(API_KEY),'RUB');
 const r=await handleMulti(request('/v2/deposits',{
  body:{currency:'RUB',amountMinor:1000,asset:'BTC',projectOrderRef:randomUUID()}
 }),{DB:db});
 assert.equal(r.status,503);
 assert.equal(db.orders.length,0);
});

test('a project cannot use currencies or cryptocurrencies disabled in its own profile',async()=>{
 const hash=await digestHex(API_KEY);
 for(const changes of [
  {allowedFiats:['EUR','USD']},
  {allowedAssets:['BTC','ETH']},
  {depositsEnabled:false},
  {invoicesEnabled:false},
  {minMinor:2000},
  {maxMinor:500}
 ]){
  const db=new FakeD1(hash,'RUB');
  Object.assign(db,changes);
  const body={currency:'RUB',amountMinor:1000,asset:'USDT_TRC20',
   projectOrderRef:randomUUID()};
  const r=await handleMulti(request('/v2/deposits',{body}),environment(db));
  assert.ok([400,403].includes(r.status),JSON.stringify(changes));
  assert.equal(db.orders.length,0,'disabled method never reserves an address');
 }
});
test('project methods only expose methods enabled for that project',async()=>{
 const db=new FakeD1(await digestHex(API_KEY),'RUB');
 db.allowedFiats=['EUR'];
 db.allowedAssets=['ETH'];
 const r=await handleMulti(request('/v2/methods'),environment(db));
 const methods=await r.json();
 assert.equal(r.status,200);
 assert.deepEqual(methods.fiatCurrencies.map(x=>x.currency),['EUR']);
 assert.deepEqual(methods.supportedAssets.map(x=>x.asset),['ETH']);
});
test('project can configure shorter invoice lifetime independently',async()=>{
 const db=new FakeD1(await digestHex(API_KEY),'RUB');
 db.lifetimeMinutes=5;
 const start=Date.now();
 const r=await handleMulti(request('/v2/deposits',{body:{
  currency:'RUB',amountMinor:1000,asset:'USDT_TRC20',
  projectOrderRef:randomUUID()
 }}),environment(db));
 assert.equal(r.status,201);
 const invoice=(await r.json()).invoice;
 assert.ok(invoice.expiresAt<=start+5*60000+2000);
});
