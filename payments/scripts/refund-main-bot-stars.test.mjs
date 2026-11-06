import test from 'node:test';
import assert from 'node:assert/strict';
import {refundPreflight} from './refund-main-bot-stars.mjs';

const ID='5acaf9ba-f7c3-448c-a1f5-d7dd0c1190ff';
const defaults={
 order:{id:ID,telegram_user_id:7390606911,
  requested_amount_minor:183,price_stars:1,status:'paid',
  telegram_charge_id:'EXAMPLE_CHARGE_TOKEN_123',paid_at_ms:1793998829143},
 quote:{coin_cents:183,amount_minor:183,telegram_user_id:7390606911},
 receipt:{coin_cents:183,receipt_id:'EXAMPLE_CHARGE_TOKEN_123'},
 game:{v:12229,canonical:129.09,mirror:124.09}
};
function reader(overrides={}){
 const o={...defaults,...overrides};
 return async (_db,sql)=>{
  if(sql.includes('FROM rustup_stars_variable_orders'))return {rows:[o.order]};
  if(sql.includes('FROM rustup_stars_variable_credit_quotes'))return {rows:[o.quote]};
  if(sql.includes('FROM rustup_game_paid_receipts'))return {rows:[o.receipt]};
  if(sql.includes('FROM rustup_stars_variable_refund_intents'))return {rows:overrides.intents??[]};
  if(sql.includes('FROM rustup_game_paid_refunds'))return {rows:overrides.refunds??[]};
  if(sql.includes('FROM accounts a JOIN users u'))return {rows:[o.game]};
  throw Error('Unexpected read-only SQL');
 };
}
test('current real pilot mirror mismatch must block provider refund',async()=>{
 const result=await refundPreflight(ID,reader());
 assert.equal(result.ok,false);
 assert.ok(result.blockers.includes('game_account_balance_mirror_unsynced'));
 assert.equal(result.canonicalCoins,129.09);
 assert.equal(result.mirrorCoins,124.09);
});
test('matching canonical/mirror and verified receipts pass preflight',async()=>{
 const result=await refundPreflight(ID,reader({game:{v:12229,canonical:129.09,mirror:129.09}}));
 assert.equal(result.ok,true);
 assert.deepEqual(result.blockers,[]);
});
test('already recorded refund intent blocks a second provider call',async()=>{
 const result=await refundPreflight(ID,reader({game:{v:12230,canonical:129.09,mirror:129.09},
  intents:[{state:'manual_review'}]}));
 assert.equal(result.ok,false);
 assert.ok(result.blockers.includes('refund_started_or_already_reversed'));
});
test('mismatched credit amount blocks a refund',async()=>{
 const result=await refundPreflight(ID,reader({receipt:{coin_cents:500,receipt_id:'EXAMPLE_CHARGE_TOKEN_123'},
  game:{v:12230,canonical:129.09,mirror:129.09}}));
 assert.equal(result.ok,false);
 assert.ok(result.blockers.includes('game_credit_receipt_mismatch'));
});
test('insufficient canonical balance blocks provider refund',async()=>{
 const result=await refundPreflight(ID,reader({game:{v:12230,canonical:1,mirror:1}}));
 assert.equal(result.ok,false);
 assert.ok(result.blockers.includes('game_credit_not_available_for_reversal'));
});
