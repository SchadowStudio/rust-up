// Exact operator-selected RUST UP quote, shared by the history-only Worker.
// Merchant rate: 1 Telegram Star == 1.83 RUB (183 kopecks).
// Server-only preview: never creates invoices, writes to D1, or credits games.
export const STARS_OWNER_PRICE=Object.freeze({
 rubMinorPerStar:183,
 minRubMinor:100,
 maxRubMinor:100000000,
 date:'2026-11-06',
 enabledForCheckout:false
});

export function quoteOwnerStarsReadOnly(amountMinor){
 if(!Number.isSafeInteger(amountMinor)||
    amountMinor<STARS_OWNER_PRICE.minRubMinor||
    amountMinor>STARS_OWNER_PRICE.maxRubMinor)
  throw Error('invalid_amount_or_range');
 const wholeStars=(BigInt(amountMinor)+
   BigInt(STARS_OWNER_PRICE.rubMinorPerStar)-1n)/
  BigInt(STARS_OWNER_PRICE.rubMinorPerStar);
 if(wholeStars<1n||wholeStars>1000000n)
  throw Error('invalid_amount_or_range');
 return {
  requestedAmountMinor:amountMinor,
  priceStars:Number(wholeStars),
  rateNumerator:183000,
  rateDenominator:1000,
  currency:'RUB',
  checkoutEnabled:false,
  creditedToGame:false
 };
}
