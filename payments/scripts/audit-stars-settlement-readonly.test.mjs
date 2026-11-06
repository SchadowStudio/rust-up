import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateStarsSettlementSnapshot} from './audit-stars-settlement-readonly.mjs';
const ORDER='123e4567-e89b-42d3-a456-426614174000';
const CHARGE='secret-charge-private-01';
const USER=123456789;
const flags=['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
 'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
 'PAYMENT_WALLET_STRICT_MODE','STARS_GAME_CREDIT_SETTLEMENT_ENABLED',
 'STARS_GAME_CREDIT_REFUND_RECONCILIATION_ENABLED'];
function fixture(){
 return {
  paymentTables:['rustup_stars_variable_orders','rustup_stars_variable_credit_quotes',
   'rustup_stars_variable_refund_intents','rustup_stars_receipt_incidents',
   'rustup_payment_settings'],
  gameTables:['rustup_game_paid_receipts','rustup_game_paid_refunds',
   'rustup_game_paid_release_control'],
  orders:[{id:ORDER,telegram_user_id:USER,requested_amount_minor:100000,
   price_stars:535,status:'paid',telegram_charge_id:CHARGE,
   paid_at_ms:1794000000000}],
  quotes:[{order_id:ORDER,telegram_user_id:USER,amount_minor:100000,
   coin_cents:62500,quoted_at_ms:1793999999000}],
  credits:[{source:'stars_variable',order_id:ORDER,receipt_id:CHARGE,
   telegram_user_id:USER,amount_minor:100000,coin_cents:62500}],
  refunds:[],incidents:[{value:0}],refundIntents:[],
  controls:['master','stars','crypto'].map(channel=>({channel,enabled:0})),
  bindings:flags.map(name=>({name,type:'plain_text',text:'false'})),
  gameReleaseControl:{enabled:0,approval_reference:null,reviewed_at_ms:null}
 };
}
test('matching records show consistency without claiming authorization to charge',()=>{
 const s=evaluateStarsSettlementSnapshot(fixture());
 assert.equal(s.allChecksPass,true);
 assert.deepEqual(s.blockers,[]);
 assert.equal(s.paymentOrderCounts.paid,1);
 assert.equal(s.scanned.credits,1);
 assert.equal(s.livePaymentApproval,false);
 assert.equal(s.gameCreditReleaseApproved,false);
 assert.equal(s.chargesCreated,false);
 assert.equal(s.balancesChanged,false);
 const serialized=JSON.stringify(s);
 for(const secret of [ORDER,CHARGE,String(USER)])
  assert.equal(serialized.includes(secret),false);
});
test('records paid without credit, without immutable quote, or missing receipt',()=>{
 const x=fixture();x.credits=[];x.quotes=[];x.orders[0].telegram_charge_id=null;
 const s=evaluateStarsSettlementSnapshot(x);
 assert.equal(s.anomalies.paidWithoutCharge,1);
 assert.equal(s.anomalies.paidMissingFrozenQuote,1);
 assert.equal(s.anomalies.paidNotCredited,1);
 assert.equal(s.allChecksPass,false);
});
test('bad ledger identity, receipt, or coin conversion triggers manual review',()=>{
 const x=fixture();x.credits[0].receipt_id='different-charge';
 x.credits[0].telegram_user_id=USER+1;
 const s=evaluateStarsSettlementSnapshot(x);
 assert.equal(s.anomalies.creditedIdentityOrAmountMismatch,1);
 assert.equal(s.allChecksPass,false);
});
test('confirmed refunded payment requires matching reversal when credit existed',()=>{
 const x=fixture();x.orders[0].status='refunded';
 let s=evaluateStarsSettlementSnapshot(x);
 assert.equal(s.anomalies.refundedButStillCredited,1);
 x.refunds=[{source:'stars_variable',order_id:ORDER,receipt_id:CHARGE,
  telegram_user_id:USER,coin_cents:62500}];
 s=evaluateStarsSettlementSnapshot(x);
 assert.equal(s.allChecksPass,true);
 assert.equal(s.anomalies.refundedButStillCredited,0);
 x.refunds[0].coin_cents=62501;
 s=evaluateStarsSettlementSnapshot(x);
 assert.equal(s.anomalies.refundedReversalConflict,1);
});
test('reversal against an unrefunded order is never accepted as reconciled',()=>{
 const x=fixture();x.refunds=[{source:'stars_variable',order_id:ORDER,
  receipt_id:CHARGE,telegram_user_id:USER,coin_cents:62500}];
 const s=evaluateStarsSettlementSnapshot(x);
 assert.equal(s.anomalies.reversedWithoutRecordedRefund,1);
 assert.equal(s.allChecksPass,false);
});
test('ledger release enabled or missing prevents calling read-only reconciliation safe',()=>{
 const x=fixture();
 x.gameReleaseControl.enabled=1;
 let s=evaluateStarsSettlementSnapshot(x);
 assert.equal(s.gameLedgerGateOff,false);
 assert.ok(s.blockers.includes('game_ledger_release_gate_not_verifiably_off'));
 x.gameReleaseControl=null;
 s=evaluateStarsSettlementSnapshot(x);
 assert.equal(s.gameLedgerGateOff,false);
 assert.equal(s.allChecksPass,false);
});

test('missing game journal schema is not misreported as zero payments',()=>{
 const x=fixture();x.gameTables=[];x.credits=[];x.refunds=[];
 const s=evaluateStarsSettlementSnapshot(x);
 assert.equal(s.schema.gameLedgerReady,false);
 assert.ok(s.blockers.includes('game_journal_schema_not_installed'));
 assert.ok(s.blockers.includes('payment_ledger_or_refund_requires_review'));
});
test('unresolved operator refunds, quarantined charges and enabled payment gates block',()=>{
 const x=fixture();x.incidents=[{value:2}];
 x.refundIntents=[{state:'pending',total:1},{state:'manual_review',total:3}];
 x.bindings[0].text='true';
 x.controls[0].enabled=1;
 const s=evaluateStarsSettlementSnapshot(x);
 assert.equal(s.receiptIncidents,2);
 assert.equal(s.unresolvedRefundIntents,4);
 assert.ok(s.blockers.includes('payments_not_safely_disabled'));
 assert.ok(s.blockers.includes('payment_ledger_or_refund_requires_review'));
});
test('scans over 2,000 rows are explicitly incomplete, and duplicate ids reject',()=>{
 const x=fixture();
 x.orders=Array.from({length:2001},(_,i)=>({
  ...x.orders[0],id:'order-'+i,status:'pending'
 }));
 const s=evaluateStarsSettlementSnapshot(x);
 assert.equal(s.coverageComplete,false);
 assert.ok(s.blockers.includes('read_only_scan_incomplete_more_than_2000_rows'));
 const y=fixture();y.orders.push({...y.orders[0]});
 assert.throws(()=>evaluateStarsSettlementSnapshot(y),
  /duplicate_identifier/);
});
test('unknown schemas, counts or payment states fail closed',()=>{
 const x=fixture();x.incidents=[{value:-1}];
 assert.throws(()=>evaluateStarsSettlementSnapshot(x),/invalid_count/);
 x.incidents=[{value:0}];x.orders[0].status='hijacked';
 assert.throws(()=>evaluateStarsSettlementSnapshot(x),/unknown_payment_state/);
 assert.throws(()=>evaluateStarsSettlementSnapshot({}),/incomplete_read_only_evidence/);
});
