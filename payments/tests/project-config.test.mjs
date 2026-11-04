import test from 'node:test';
import assert from 'node:assert/strict';
import {
 getProjectMethodPolicy,getProjectPaymentConfig,
 initializeProjectPayments,paymentProfileAdmin
} from '../src/multi/project-config.js';

const P1='34301b80-18f9-4a69-a5a5-58df9a617817';
const P2='93fa597d-1766-419b-9b5c-e704ad907157';
class ProjectStub{
 constructor(){
  this.data=new Map([
   [P1,{enabled:0,deposit:0,products:0,fiats:['RUB'],cryptos:['TRX']}],
   [P2,{enabled:0,deposit:0,products:0,fiats:[],cryptos:[]}]
  ]);
  this.writes=[];
 }
 prepare(sql){
  return {bind:(...args)=>({
   sql,args,
   first:async()=>{
    if(sql.includes('SELECT p.invoices_enabled')&&sql.includes('JOIN v2_project_fiat_methods')){
     const [currency,asset,id]=args,p=this.data.get(id);
     if(!p)return null;
     return {invoices_enabled:p.enabled,deposits_enabled:p.deposit,
      products_enabled:p.products,invoice_lifetime_minutes:20,
      fiat_enabled:p.fiats.includes(currency)?1:0,
      crypto_enabled:p.cryptos.includes(asset)?1:0,min_minor:100,max_minor:1000000};
    }
    if(sql.includes('JOIN v2_projects pr')){
     const id=args[0],p=this.data.get(id);
     return p?{project_id:id,display_name:'Project',invoices_enabled:p.enabled,
      deposits_enabled:p.deposit,products_enabled:p.products,
      invoice_lifetime_minutes:20,updated_at_ms:1,
      project_status:'active',webhook_url:'https://example.com/payments'}:null;
    }
    throw Error('unexpected first '+sql);
   },
   all:async()=>{
    const p=this.data.get(args[0]);
    if(sql.includes('FROM v2_project_fiat_methods'))
     return {results:['RUB','EUR','USD'].map(currency=>({
      currency,enabled:p.fiats.includes(currency)?1:0,
      min_minor:100,max_minor:1000000}))};
    if(sql.includes('FROM v2_project_crypto_methods'))
     return {results:['BTC','ETH','TRX','USDT_ERC20','USDT_TRC20'].map(asset=>({
      asset,enabled:p.cryptos.includes(asset)?1:0}))};
    throw Error('unexpected all '+sql);
   },
   run:async()=>{
    this.writes.push({sql,args});
    if(sql.includes('UPDATE v2_project_payment_profiles')){
     const p=this.data.get(args.at(-1));
     p.enabled=args[1];p.deposit=args[2];p.products=args[3];
    }
    return {meta:{changes:1}};
   }
  })}
 }
}
function request(path,payload){
 return new Request('https://gateway.example.com'+path,{
  method:payload?'POST':'GET',
  ...(payload?{headers:{'content-type':'application/json'},body:JSON.stringify(payload)}:{})
 });
}
test('every project is separate, including approved fiat and crypto methods',async()=>{
 const db=new ProjectStub();
 const a=await getProjectMethodPolicy(db,P1,'RUB','TRX');
 const b=await getProjectMethodPolicy(db,P2,'RUB','TRX');
 assert.equal(a.fiatEnabled,true);
 assert.equal(a.cryptoEnabled,true);
 assert.equal(b.fiatEnabled,false);
 assert.equal(b.cryptoEnabled,false);
 const config=await getProjectPaymentConfig(db,P1);
 assert.equal(config.projectId,P1);
 assert.equal(config.fiatMethods.filter(x=>x.enabled).length,1);
 assert.equal(config.cryptoMethods.filter(x=>x.enabled).length,1);
});
test('new project initializes its own disabled profile, all fiat and chain options',async()=>{
 const db=new ProjectStub();
 const statements=await initializeProjectPayments(db,P1,'My new project',100);
 assert.equal(statements.length,9);
 assert.match(statements[0].sql,/INSERT INTO v2_project_payment_profiles/);
 assert.equal(statements.filter(x=>x.sql.includes('v2_project_fiat_methods')).length,3);
 assert.equal(statements.filter(x=>x.sql.includes('v2_project_crypto_methods')).length,5);
});
test('owner can configure only chosen project, and no other projects are toggled',async()=>{
 const db=new ProjectStub();
 const payload={displayName:'Project A',invoicesEnabled:true,
  depositsEnabled:true,productsEnabled:false,invoiceLifetimeMinutes:15,
  confirmation:'CONFIRM_PROJECT_PAYMENT_SETTINGS'};
 const url='/v2/admin/projects/'+P1+'/payment-config';
 const r=await paymentProfileAdmin(request(url,payload),{DB:db},
  new URL('https://gateway.example.com'+url));
 assert.equal(r.status,200);
 assert.equal((await r.json()).config.invoicesEnabled,true);
 assert.equal(db.data.get(P1).enabled,1);
 assert.equal(db.data.get(P2).enabled,0);
 assert.ok(db.writes.some(x=>x.sql.includes('v2_operator_audit')));
});
test('operator cannot accidentally enable unapproved assets or fiat limits',async()=>{
 const db=new ProjectStub();
 const url='/v2/admin/projects/'+P1;
 const bad=[
  ['/payment-config',{displayName:'A',invoicesEnabled:true,
   depositsEnabled:true,productsEnabled:false,invoiceLifetimeMinutes:15,
   confirmation:'CONFIRM_PROJECT_PAYMENT_SETTINGS'}],
  ['/fiat-method',{currency:'GBP',enabled:true,minMinor:1,maxMinor:100,
   confirmation:'CONFIRM_PROJECT_PAYMENT_SETTINGS'}],
  ['/fiat-method',{currency:'EUR',enabled:true,minMinor:500,maxMinor:100,
   confirmation:'CONFIRM_PROJECT_PAYMENT_SETTINGS'}],
  ['/crypto-method',{asset:'DOGE',enabled:true,
   confirmation:'CONFIRM_PROJECT_PAYMENT_SETTINGS'}],
  ['/crypto-method',{asset:'BTC',enabled:true,confirmation:'wrong'}]
 ];
 for(const [route,payload] of bad){
  const response=await paymentProfileAdmin(request(url+route,payload),{DB:db},
   new URL('https://gateway.example.com'+url+route));
  assert.equal(response.status,400,route);
 }
 assert.equal(db.writes.length,0);
});
