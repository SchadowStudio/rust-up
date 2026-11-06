// Live external exchange-rate preflight. No Worker writes, payment creation,
// Stars transaction, account balance update or Telegram token.
import {readIndependentlyConfirmedRubUsdRate}
 from '../integration/account-credit-ledger/trusted-rub-usd.mjs';
const result=await readIndependentlyConfirmedRubUsdRate();
if(result.sourcesVerified!==2||result.marketDataFallbackUsed!==false||
   !Number.isInteger(result.rubPerUsdMinor)||
   result.rubPerUsdMinor<1000||result.rubPerUsdMinor>50000)
 throw Error('stars_exchange_rate_readiness_invalid');
console.log('PASS: both independent live CBR exchange-rate sources were fresh and consistent');
console.log('Verified RUB/USD (rounded) = '+(result.rubPerUsdMinor/100).toFixed(2));
console.log('No invoice, token, Stars payment or game account was accessed.');
