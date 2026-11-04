// Two-source market consensus. Prices are decimal text parsed into BigInt e8.
// NO real money charged if a provider is stale, unavailable or inconsistent.
import {ASSETS} from '../assets.js';
import {FIATS} from './fiat.js';
const COINS=[['BTC','bitcoin'],['ETH','ethereum'],['TRX','tron'],['USDT','tether']];
const scale=100000000n;
export function priceE8(raw){
 const s=String(raw);
 if(!/^[0-9]{1,15}(\.[0-9]{1,8})?$/.test(s))throw Error('invalid_market_price');
 const [whole,fraction='']=s.split('.');
 const n=BigInt(whole)*scale+BigInt(fraction.padEnd(8,'0')||'0');
 if(n<=0n)throw Error('invalid_market_price');
 return n;
}
export function consensusPrice(first,second){
 const a=priceE8(first),b=priceE8(second);
 const higher=a>b?a:b,difference=a>b?a-b:b-a;
 // >2.5% disagreement is never auto-accepted.
 if(difference*10000n>higher*250n)throw Error('market_disagreement');
 return ((a+b)/2n).toString();
}
export function fiatRateFromPrice(priceScaled,asset,bufferBps=100){
 const decimals=ASSETS[asset]?.decimals;
 if(decimals===undefined||!Number.isSafeInteger(bufferBps)||
    bufferBps<0||bufferBps>300)throw Error('invalid_rate_configuration');
 const price=BigInt(priceScaled);
 if(price<=0n)throw Error('invalid_rate_configuration');
 // crypto smallest units per fiat minor (1/100 currency unit).
 // Buffer 100 bps = 1% nominal, applied using integer rational arithmetic.
 const numerator=(10n**BigInt(decimals))*scale*BigInt(10000+bufferBps);
 const denominator=price*100n*10000n;
 return {numeratorAtomic:numerator.toString(),denominatorMinor:denominator.toString()};
}
async function fetchJson(url,headers={}){
 const res=await fetch(url,{headers,redirect:'error',cache:'no-store',
  signal:AbortSignal.timeout(12000)});
 if(!res.ok)throw Error('market_feed_unavailable');
 const parsed=await res.json();
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('invalid_market_feed');
 return parsed;
}
export async function loadConsensus(env,now=Date.now()){
 if(!env.COINGECKO_DEMO_KEY||!env.CRYPTOCOMPARE_API_KEY)
  throw Error('two_market_feeds_not_configured');
 const [gecko,compare]=await Promise.all([
  fetchJson('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,tron,tether&vs_currencies=rub,eur,usd&include_last_updated_at=true',
   {'x-cg-demo-api-key':env.COINGECKO_DEMO_KEY}),
  fetchJson('https://min-api.cryptocompare.com/data/pricemulti?fsyms=BTC,ETH,TRX,USDT&tsyms=RUB,EUR,USD',
   {'authorization':'Apikey '+env.CRYPTOCOMPARE_API_KEY})
 ]);
 const rows=[],errors=[];
 for(const [symbol,id] of COINS){
  for(const fiat of FIATS){
   const a=gecko[id]?.[fiat.toLowerCase()],b=compare[symbol]?.[fiat];
   const last=gecko[id]?.last_updated_at;
   try{
    if(!Number.isSafeInteger(last)||now-last*1000>15*60*1000||
       last*1000>now+60000)throw Error('stale_feed');
    const value=consensusPrice(a,b);
    const assets=symbol==='USDT'?['USDT_ERC20','USDT_TRC20']:[symbol];
    for(const asset of assets)rows.push({fiat,asset,priceE8:value});
   }catch(error){errors.push(fiat+':'+symbol+':'+error.message)}
  }
 }
 return {rows,errors};
}
export async function refreshMarketRates(env,now=Date.now()){
 if(env.MULTI_AUTO_FX_ENABLED!=='true'||!env.DB)return {skipped:'disabled'};
 const db=env.DB;
 await db.prepare(`INSERT OR IGNORE INTO v2_fx_jobs(name) VALUES('market')`).run();
 const claimed=await db.prepare(`UPDATE v2_fx_jobs SET lease_until_ms=?
  WHERE name='market' AND lease_until_ms<? AND last_ok_at_ms<?`)
  .bind(now+120000,now,now-9*60000).run();
 if(!claimed.meta?.changes)return {skipped:'lease_or_frequency'};
 let result={updated:0,skipped:0,errors:[]};
 try{
  const consensus=await loadConsensus(env,now);
  result.errors.push(...consensus.errors);
  const buffer=Math.max(0,Math.min(300,Number(env.MULTI_RATE_BUFFER_BPS)||100));
  for(const row of consensus.rows){
   const previous=await db.prepare(`SELECT price_e8 FROM v2_market_prices WHERE fiat=? AND asset=?`)
    .bind(row.fiat,row.asset).first();
   if(previous?.price_e8){
    const old=BigInt(previous.price_e8),fresh=BigInt(row.priceE8);
    const gap=old>fresh?old-fresh:fresh-old;
    if(gap*10000n>old*3000n){
     result.errors.push(row.fiat+':'+row.asset+':large_market_jump');
     result.skipped++;continue;
    }
   }
   const rate=fiatRateFromPrice(row.priceE8,row.asset,buffer);
   const source='coingecko+cryptocompare';
   await db.batch([
    db.prepare(`INSERT INTO v2_market_prices(fiat,asset,price_e8,observed_at_ms,source)
     VALUES(?,?,?,?,?) ON CONFLICT(fiat,asset) DO UPDATE SET
     price_e8=excluded.price_e8,observed_at_ms=excluded.observed_at_ms,
     source=excluded.source`)
     .bind(row.fiat,row.asset,row.priceE8,now,source),
    db.prepare(`INSERT INTO v2_exchange_rates(fiat,asset,numerator_atomic,
     denominator_minor,valid_from_ms,expires_at_ms,source,enabled)
     VALUES(?,?,?,?,?,?,?,1) ON CONFLICT(fiat,asset) DO UPDATE SET
     numerator_atomic=excluded.numerator_atomic,
     denominator_minor=excluded.denominator_minor,
     valid_from_ms=excluded.valid_from_ms,
     expires_at_ms=excluded.expires_at_ms,
     source=excluded.source,enabled=1`)
     .bind(row.fiat,row.asset,rate.numeratorAtomic,rate.denominatorMinor,
      now,now+30*60000,source)
   ]);
   result.updated++;
  }
  if(result.updated===0)throw Error('no_consistent_market_rates');
  await db.prepare(`UPDATE v2_fx_jobs SET last_ok_at_ms=?,lease_until_ms=0 WHERE name='market'`)
   .bind(now).run();
  return result;
 }catch(error){
  await db.prepare(`UPDATE v2_fx_jobs SET lease_until_ms=0 WHERE name='market'`).run();
  throw error;
 }
}
