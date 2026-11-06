import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {STARS_OWNER_PRICE,quoteOwnerStarsReadOnly}
 from './stars-owner-price-preview.mjs';
import {quoteVariableStars}
 from './variable-stars.mjs';

const owner=JSON.parse(readFileSync(
 new URL('../../stars-owner-rate.json',import.meta.url),'utf8'));

test('server preview always exactly matches the approved owner manifest',()=>{
 assert.equal(owner.operatorApproved,true);
 assert.equal(owner.rubPerStarDecimal,'1.83');
 assert.equal(owner.STARS_RUB_MINOR_PER_STAR_NUM,'183000');
 assert.equal(owner.STARS_RUB_MINOR_PER_STAR_DEN,'1000');
 assert.equal(owner.rubMinorPerReferenceLot,183000);
 assert.equal(STARS_OWNER_PRICE.rubMinorPerStar,183);
 assert.equal(STARS_OWNER_PRICE.enabledForCheckout,false);
 assert.equal(STARS_OWNER_PRICE.minRubMinor,Number(owner.STARS_MIN_RUB_MINOR));
 assert.equal(STARS_OWNER_PRICE.maxRubMinor,Number(owner.STARS_MAX_RUB_MINOR));
 assert.equal(STARS_OWNER_PRICE.rubMinorPerStar*1000,
  Number(owner.STARS_RUB_MINOR_PER_STAR_NUM));
});

test('read-only quote matches the production pricing algorithm at every rounding boundary',()=>{
 for(const amountMinor of [100,183,184,365,366,549,550,1000,
  10000,25050,100000,150000,183000,183001,100000000]){
  const r=quoteOwnerStarsReadOnly(amountMinor);
  const expected=quoteVariableStars(amountMinor,owner);
  assert.equal(r.priceStars,expected.priceStars);
  assert.equal(r.rateNumerator,expected.rateNumerator);
  assert.equal(r.rateDenominator,expected.rateDenominator);
  assert.equal(r.checkoutEnabled,false);
  assert.equal(r.creditedToGame,false);
 }
});

test('forged, NaN, untrusted, decimal and out-of-range input never gets quoted',()=>{
 for(const value of [null,undefined,NaN,Infinity,0,1,-1,1.1,'10000',
  100000001,{},true]){
  assert.throws(()=>quoteOwnerStarsReadOnly(value),/invalid_amount_or_range/);
 }
});
