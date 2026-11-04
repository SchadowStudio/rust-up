import test from 'node:test';
import assert from 'node:assert/strict';
import {coinScaffold,writeCoinScaffold} from '../scripts/scaffold-coin.mjs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('coin scaffolder prepares an auditable proposal, never a live asset',()=>{
 const {manifest,checklist}=coinScaffold('SOL','solana','native',9);
 assert.equal(manifest.status,'REVIEW_REQUIRED');
 assert.equal(manifest.paymentAcceptanceEnabled,false);
 assert.equal(manifest.verificationAdapter,null);
 assert.equal(manifest.operatorApproved,false);
 assert.ok(checklist.includes('Payment Integration Review'));
 assert.ok(checklist.includes('NO CUSTOMER FUNDS'));
 assert.ok(checklist.includes('mainnet'));
});
test('coin scaffold never overwrites existing security review',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'rup-coins-'));
 try{
  const first=await writeCoinScaffold('USDC_ERC20','ethereum','erc20',6,{root:dir});
  assert.match(first.folder,/USDC_ERC20$/);
  const data=JSON.parse(await readFile(join(first.folder,'manifest.json'),'utf8'));
  assert.equal(data.paymentAcceptanceEnabled,false);
  assert.equal(data.asset,'USDC_ERC20');
  await assert.rejects(()=>writeCoinScaffold('USDC_ERC20','ethereum','erc20',6,{root:dir}),
   /EEXIST/);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('coin scaffold rejects path injection and invalid chains',()=>{
 for(const [asset,chain,standard,decimals] of [
  ['../../secret','ethereum','erc20',6],
  ['USDC_ERC20','tron','erc20',6],
  ['USDT_ERC20','ethereum','erc20',6],
  ['BTC','bitcoin','native',8],
  ['SOL','solana','erc20',9]
 ])assert.throws(()=>coinScaffold(asset,chain,standard,decimals));
});
