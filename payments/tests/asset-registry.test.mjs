import test from 'node:test';
import assert from 'node:assert/strict';
import {ASSETS as ORIGINAL} from '../src/assets.js';
import {ASSETS,ASSET_CATALOG,RECEIVER_NETWORKS,walletSetupPlan,planCoinExtension}
 from '../src/asset-registry.js';
test('existing live assets stay identical and do not silently gain new tokens',()=>{
 assert.equal(ORIGINAL,ASSETS);
 assert.deepEqual(Object.keys(ASSETS),
  ['BTC','ETH','TRX','USDT_ERC20','USDT_TRC20','TON']);
 assert.equal(ASSET_CATALOG.USDT_ERC20.adapter,'evm-erc20');
 assert.equal(ASSET_CATALOG.USDT_TRC20.adapter,'tron-trc20');
 assert.equal(ASSET_CATALOG.BTC.confirmations,3);
 assert.equal(ASSETS.ETH.confirmations,12);
 assert.equal(ASSETS.USDT_TRC20.decimals,6);
});
test('setup plan groups coin networks instead of creating duplicate wallets for tokens',()=>{
 const plan=walletSetupPlan();
 assert.equal(plan.length,4);
 assert.deepEqual(RECEIVER_NETWORKS.ethereum.assets,['ETH','USDT_ERC20']);
 assert.deepEqual(RECEIVER_NETWORKS.tron.assets,['TRX','USDT_TRC20']);
 assert.deepEqual(RECEIVER_NETWORKS.bitcoin.assets,['BTC']);
 assert.deepEqual(RECEIVER_NETWORKS.ton.assets,['TON']);
 assert.ok(plan.every(x=>x.requiresUniqueUnusedAddressPerInvoice));
 assert.ok(plan.every(x=>!x.automaticallyDerivesNewAccounts));
});
test('new coin is planned but never accepted as money before verified code+schema',()=>{
 const plan=planCoinExtension({asset:'USDC_ERC20',chain:'ethereum',
  standard:'erc20',decimals:6});
 assert.equal(plan.active,false);
 assert.equal(ASSETS.USDC_ERC20,undefined);
 assert.ok(plan.mandatoryChecks.length>=8);
 assert.ok(plan.mandatoryChecks.some(x=>x.includes('database_schema_migration')));
});
test('new blockchain can be planned but is never activated by preview',()=>{
 const plan=planCoinExtension({asset:'SOL',chain:'solana',standard:'native',decimals:9});
 assert.equal(plan.newNetwork,true);
 assert.equal(plan.active,false);
 assert.equal(ASSET_CATALOG.SOL,undefined);
 const token=planCoinExtension({asset:'USDC_SPL',chain:'solana',standard:'spl',decimals:6});
 assert.equal(token.newNetwork,true);
 assert.ok(token.mandatoryChecks.some(x=>x.includes('chain_specific_indexer')));
});
test('extension rejects unsafe/mismatched or unsupported coin metadata',()=>{
 for(const value of [
  {asset:'../wallet',chain:'ethereum',standard:'erc20',decimals:6},
  {asset:'USDC_TRC20',chain:'ethereum',standard:'trc20',decimals:6},
  {asset:'USDC',chain:'wrong.chain',standard:'native',decimals:6},
  {asset:'BTC',chain:'bitcoin',standard:'native',decimals:8},
  {asset:'ERC20',chain:'ethereum',standard:'erc20',decimals:19}
 ])assert.throws(()=>planCoinExtension(value));
});
