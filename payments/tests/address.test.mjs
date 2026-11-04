import test from 'node:test';
import assert from 'node:assert/strict';
import {validateReceivingAddress} from '../src/address.js';

test('validated Trust Wallet ETH address is mainnet syntax',async()=>{
 assert.equal(await validateReceivingAddress('ethereum','0x'+'a'.repeat(40)),true);
 assert.equal(await validateReceivingAddress('ethereum','0x'+'x'.repeat(40)),false);
 assert.equal(await validateReceivingAddress('ethereum','eth:0x'+'a'.repeat(40)),false);
});
test('Trust Wallet TRON addresses must have correct checksum',async()=>{
 const original='TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
 assert.equal(await validateReceivingAddress('tron',original),true);
 assert.equal(await validateReceivingAddress('tron',original.slice(0,-1)+'1'),false);
});
test('legacy Bitcoin address uses checksum and mainnet version',async()=>{
 assert.equal(await validateReceivingAddress('bitcoin','1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'),true);
 assert.equal(await validateReceivingAddress('bitcoin','3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy'),true);
 assert.equal(await validateReceivingAddress('bitcoin','1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb'),false);
});
test('Bitcoin segwit checksum and network validation',async()=>{
 assert.equal(await validateReceivingAddress('bitcoin','bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'),true);
 assert.equal(await validateReceivingAddress('bitcoin','tb1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'),false);
 assert.equal(await validateReceivingAddress('bitcoin','bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wla'),false);
});
