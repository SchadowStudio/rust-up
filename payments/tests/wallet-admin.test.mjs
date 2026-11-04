import test from 'node:test';
import assert from 'node:assert/strict';
import {multiAdmin} from '../src/multi/admin.js';
const ADMIN='operator-secret-'+ 'z'.repeat(48);
const ETH='0x'+'c'.repeat(40);
const TRON='TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
function backend(){
 const commits=[];
 const db={prepare(sql){return {bind(...args){
  return {sql,args,first:async()=>null};
 }}},async batch(stmts){
  commits.push(stmts);
  return stmts.map(()=>({meta:{changes:1}}));
 }};
 return {db,commits,env:{DB:db,MULTI_ADMIN_KEY:ADMIN,MULTI_ADMIN_ENABLED:'true'}};
}
function req(path,body,token=ADMIN){
 const request=new Request('https://private.example.com'+path,{
  method:body?'POST':'GET',
  headers:{authorization:'Bearer '+token,
   ...(body?{'content-type':'application/json'}:{})},
  ...(body?{body:JSON.stringify(body)}:{})
 });
 return request;
}
async function route(request,env){
 return multiAdmin(request,env,new URL(request.url));
}
test('authorized owner can query supported chains without connecting browser wallet',async()=>{
 const {env}=backend();
 const result=await route(req('/v2/admin/wallet-plan'),env);
 assert.equal(result.status,200);
 const info=await result.json();
 assert.equal(info.neverRequestSecrets,true);
 assert.equal(info.networks.length,3);
 assert.equal(info.coins.length,5);
});
test('unauthenticated callers cannot view or import wallet addresses',async()=>{
 const {env}=backend();
 const r=await route(req('/v2/admin/wallet-plan',undefined,'bad'),env);
 assert.equal(r.status,401);
 const b=await route(req('/v2/admin/wallet-import',
  {walletLabel:'Trust Wallet',addresses:[{chain:'ethereum',address:ETH}],
   confirmation:'CONFIRM_PUBLIC_ADDRESS_IMPORT'},'bad'),env);
 assert.equal(b.status,401);
});
test('owner imports public receiver pool atomically with all addresses disabled',async()=>{
 const {env,commits}=backend();
 const body={walletLabel:'Trust Wallet',confirmation:'CONFIRM_PUBLIC_ADDRESS_IMPORT',
  addresses:[{chain:'ethereum',address:ETH},{chain:'tron',address:TRON}]};
 const r=await route(req('/v2/admin/wallet-import',body),env);
 assert.equal(r.status,201);
 const data=await r.json();
 assert.equal(data.activated,false);
 assert.equal(data.count,2);
 assert.equal(commits.length,1);
 assert.equal(commits[0].length,3);
 assert.ok(commits[0].slice(0,2).every(s=>s.sql.includes("'multi_project_pool',0")));
});
test('import fails closed on secret-bearing payloads and missing operator confirmation',async()=>{
 const {env,commits}=backend();
 const base={walletLabel:'Trust Wallet',
  addresses:[{chain:'ethereum',address:ETH}],
  confirmation:'CONFIRM_PUBLIC_ADDRESS_IMPORT'};
 for(const body of [
  {...base,seed:'twelve words'},
  {...base,addresses:[{chain:'ethereum',address:ETH,privateKey:'secret'}]},
  {...base,confirmation:'wrong'},
  {...base,addresses:[{chain:'tron',address:'invalid'}]}
 ]){
  const r=await route(req('/v2/admin/wallet-import',body),env);
  assert.ok([400,503].includes(r.status));
 }
 assert.equal(commits.length,0);
});
