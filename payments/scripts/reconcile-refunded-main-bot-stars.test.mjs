import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateRefundTransactions} from './reconcile-refunded-main-bot-stars.mjs';

const chargeId='some_actual-looking_charge_1234';
const userId=7390606911;
const settings={chargeId,stars:1,userId};
const original={
 id:chargeId,amount:1,
 source:{type:'user',user:{id:userId},transaction_type:'invoice_payment'}
};
const refunded={id:chargeId,amount:-1,
 receiver:{type:'user',user:{id:userId}}};
test('only matching refunded ID, amount and recipient confirms refund',()=>{
 const result=evaluateRefundTransactions([original,refunded],settings);
 assert.equal(result.refundVerified,true);
 assert.equal(result.originalChargeVisible,true);
 assert.equal(result.conflictingRefundEvidence,false);
});
test('original positive payment is NOT sufficient refund evidence',()=>{
 assert.equal(evaluateRefundTransactions([original],settings).refundVerified,false);
});
test('other users refunds cannot reverse account coins',()=>{
 const result=evaluateRefundTransactions([{...refunded,
  receiver:{type:'user',user:{id:12345}}}],settings);
 assert.equal(result.refundVerified,false);
 assert.equal(result.conflictingRefundEvidence,true);
});
test('wrong amount must not count as verified',()=>{
 const result=evaluateRefundTransactions([{...refunded,amount:-3}],settings);
 assert.equal(result.refundVerified,false);
 assert.equal(result.conflictingRefundEvidence,true);
});
test('other charge does not match',()=>{
 const result=evaluateRefundTransactions([{...refunded,id:'other_charge'}],settings);
 assert.equal(result.refundVerified,false);
});
test('duplicate negative transactions require manual review',()=>{
 const result=evaluateRefundTransactions([refunded,refunded],settings);
 assert.equal(result.refundVerified,false);
 assert.equal(result.conflictingRefundEvidence,true);
});
test('refund must be outgoing, not incoming',()=>{
 const result=evaluateRefundTransactions([{...refunded,
  source:{type:'user',user:{id:userId}},receiver:undefined}],settings);
 assert.equal(result.refundVerified,false);
 assert.equal(result.conflictingRefundEvidence,true);
});
