import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePublicWalletImport,importPublicWalletReceivers}
 from '../src/multi/public-wallet-import.js';
import {parseOperatorCommand,executeOperator}
 from '../scripts/headless-operator.mjs';
const EVM='0x'+'A'.repeat(40);
const TRON='TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
function manifest(addresses=[{chain:'ethereum',address:EVM},
 {chain:'tron',address:TRON}]){
 return {walletLabel:'Trust Wallet',addresses};
}
test('watch-only wallet manifest verifies all public addresses and normalizes EVM casing',async()=>{
 const m=await validatePublicWalletImport(manifest());
 assert.equal(m.addresses.length,2);
 assert.equal(m.addresses[0].address,EVM.toLowerCase());
 assert.equal(m.addresses[1].address,TRON);
 assert.equal(Object.hasOwn(m,'privateKey'),false);
});
test('wallet imports never accept seed, private keys, arbitrary metadata or duplicates',async()=>{
 for(const bad of [
  {...manifest(),seed:'secret'},
  {...manifest(),mnemonic:'never'},
  {...manifest(),addresses:[{chain:'ethereum',address:EVM,privateKey:'secret'}]},
  manifest([{chain:'ethereum',address:EVM},
   {chain:'ethereum',address:EVM.toLowerCase()}]),
  manifest([{chain:'tron',address:'not-a-tron-address'}]),
  manifest([{chain:'bitcoin',address:'1badaddress'}]),
  manifest([]),
  {walletLabel:'Trust Wallet',addresses:Array(26).fill({chain:'ethereum',address:EVM})}
 ])await assert.rejects(()=>validatePublicWalletImport(bad));
});
test('atomic import writes only disabled, spendless, deduplicated public receivers',async()=>{
 const statements=[],calls=[];
 const db={prepare(sql){return {bind(...args){
  return {
   first:async()=>{calls.push({sql,args});return null},
   sql,args
  };
 }}},
 async batch(items){statements.push(...items);return items.map(()=>({meta:{changes:1}}))}};
 const result=await importPublicWalletReceivers(db,manifest());
 assert.equal(result.activated,false);
 assert.equal(result.requiresOnChainOwnershipChecks,true);
 assert.equal(result.count,2);
 assert.equal(statements.length,3);
 for(const stmt of statements.slice(0,2)){
  assert.match(stmt.sql,/INSERT INTO deposit_addresses/);
  assert.match(stmt.sql,/wallet_public_import/);
  assert.match(stmt.sql,/multi_project_pool',0/);
  assert.ok(!stmt.sql.includes('private_key'));
 }
 assert.match(calls[0].sql,/COLLATE NOCASE/);
 assert.match(statements[2].sql,/v2_operator_audit/);
});
test('already registered receiving address blocks the entire import before any mutation',async()=>{
 let batchCalls=0;
 const db={prepare(sql){return {bind(){return {first:async()=>({address:EVM})}}}},
  async batch(){batchCalls++}};
 await assert.rejects(()=>importPublicWalletReceivers(db,manifest()),
  /receiver_already_registered/);
 assert.equal(batchCalls,0);
});
test('headless coin plan requires no wallet secret or admin server',async()=>{
 const a=await executeOperator(['wallet-setup-plan']);
 assert.equal(a.ok,true);
 assert.equal(a.networks.length,4);
 const b=await executeOperator(['coin-plan','USDC_ERC20','ethereum','erc20','6']);
 assert.equal(b.active,false);
 assert.equal(b.kind,'coin-plan');
 assert.deepEqual(parseOperatorCommand(['coin-plan','NEW_TRX','tron','trc20','6'])[1],
  'coin-plan');
});
