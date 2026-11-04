// Integer-only fiat prices (100 minor units per RUB/EUR/USD).
// Cryptocurrencies are quoted in their own atomic units, never JavaScript floats.
import {ASSETS,formatAtomic} from '../assets.js';
export const FIATS=Object.freeze(['RUB','EUR','USD']);
export function allowedFiat(x){return FIATS.includes(x);}
export function positiveAtomic(x){
 return typeof x==='string'&&/^[1-9][0-9]{0,59}$/.test(x);
}
export function calculateQuote(amountMinor,numerator,denominator){
 if(!Number.isSafeInteger(amountMinor)||amountMinor<=0||amountMinor>100000000000)
  throw new Error('invalid_fiat_minor');
 if(!positiveAtomic(numerator)||!positiveAtomic(denominator))
  throw new Error('invalid_exchange_rate');
 const a=BigInt(amountMinor)*BigInt(numerator),d=BigInt(denominator);
 const atomic=(a+d-1n)/d; // always round up (merchant won't be underpaid)
 if(atomic<=0n||atomic.toString().length>60)throw new Error('quote_out_of_bounds');
 return atomic.toString();
}
export function quoteFromRate(product,rate,asset,now=Date.now()){
 if(!allowedFiat(product.currency)||!ASSETS[asset]||rate.fiat!==product.currency||
    rate.asset!==asset||rate.enabled!==1)throw new Error('quote_unavailable');
 if(!Number.isSafeInteger(rate.valid_from_ms)||!Number.isSafeInteger(rate.expires_at_ms)||
    rate.valid_from_ms>now||rate.expires_at_ms<=now+120000||
    rate.expires_at_ms>now+86400000)throw new Error('stale_or_invalid_fx_rate');
 const amountAtomic=calculateQuote(product.amount_minor,rate.numerator_atomic,rate.denominator_minor);
 return {currency:product.currency,amountMinor:product.amount_minor,asset,
  chain:ASSETS[asset].chain,amountAtomic,
  cryptoAmount:formatAtomic(amountAtomic,ASSETS[asset].decimals),
  rateNumerator:rate.numerator_atomic,rateDenominator:rate.denominator_minor,
  expiry:Math.min(now+20*60*1000,rate.expires_at_ms)};
}
