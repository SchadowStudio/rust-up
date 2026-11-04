import test from 'node:test';
import assert from 'node:assert/strict';
import {priceE8,consensusPrice,fiatRateFromPrice,loadConsensus} from '../src/multi/market.js';
import {calculateQuote} from '../src/multi/fiat.js';

test('provider price decimals are converted without floating-money arithmetic',()=>{
 assert.equal(priceE8('100000.12345678').toString(),'10000012345678');
 assert.equal(priceE8('0.00000001').toString(),'1');
 for(const val of ['0','-1','NaN','1e-6','1.000000001','9999999999999999999'])
  assert.throws(()=>priceE8(val),val);
});
test('dual market feed agreement is required',()=>{
 assert.equal(consensusPrice('1','1.02'),'101000000');
 assert.throws(()=>consensusPrice('1','1.10'));
 assert.throws(()=>consensusPrice('1000','0'));
 assert.throws(()=>consensusPrice('0','0'));
});
test('consensus FX conversion quotes 100 USD to BTC with 1 percent buffer',()=>{
 const rate=fiatRateFromPrice(priceE8('100000').toString(),'BTC',100);
 assert.equal(calculateQuote(10000,rate.numeratorAtomic,rate.denominatorMinor),'101000');
});
test('USDT ERC20 and TRC20 have equal economic quotes but different chains',()=>{
 const price=priceE8('1');
 const erc=fiatRateFromPrice(price.toString(),'USDT_ERC20',100);
 const trc=fiatRateFromPrice(price.toString(),'USDT_TRC20',100);
 assert.deepEqual(erc,trc);
 assert.equal(calculateQuote(10000,erc.numeratorAtomic,erc.denominatorMinor),'101000000');
});
test('coin and fiat feeds are checked per pair, without tenant information',async()=>{
 const now=1762300000000,updated=Math.floor(now/1000)-10;
 const g={bitcoin:{rub:10000000,eur:100000,usd:110000,last_updated_at:updated},
  ethereum:{rub:300000,eur:3000,usd:3300,last_updated_at:updated},
  tron:{rub:35,eur:0.35,usd:0.4,last_updated_at:updated},
  tether:{rub:90,eur:0.9,usd:1,last_updated_at:updated}};
 const c={BTC:{RUB:10010000,EUR:100100,USD:110100},
  ETH:{RUB:300100,EUR:3001,USD:3301},
  TRX:{RUB:35.1,EUR:0.351,USD:0.401},
  USDT:{RUB:90.1,EUR:0.901,USD:1.001}};
 const original=globalThis.fetch,urls=[];
 globalThis.fetch=async (url)=>{
  urls.push(url);
  return {ok:true,json:async()=>String(url).includes('coingecko')?g:c};
 };
 try{
  const response=await loadConsensus({COINGECKO_DEMO_KEY:'fake',CRYPTOCOMPARE_API_KEY:'fake'},now);
  assert.equal(response.rows.length,15);
  assert.equal(response.errors.length,0);
  assert.equal(urls.length,2);
  const btcEuro=response.rows.find(x=>x.fiat==='EUR'&&x.asset==='BTC');
  assert.equal(btcEuro.priceE8,'10005000000000');
 }finally{globalThis.fetch=original;}
});
test('stale CoinGecko data prevents any acceptance',async()=>{
 const now=1762300000000;
 const old={bitcoin:{usd:100000,last_updated_at:Math.floor(now/1000)-3600}};
 const original=globalThis.fetch;
 globalThis.fetch=async url=>({ok:true,json:async()=>String(url).includes('coingecko')?old:{BTC:{USD:100000}}});
 try{
  const res=await loadConsensus({COINGECKO_DEMO_KEY:'fake',CRYPTOCOMPARE_API_KEY:'fake'},now);
  assert.equal(res.rows.length,0);
 }finally{globalThis.fetch=original;}
});
