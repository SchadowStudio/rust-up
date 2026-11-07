import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateRefundTransactions} from './reconcile-refunded-main-bot-stars.mjs';

const chargeId='example_charge_1234';
const userId=7390606911;
const settings={chargeId,stars:1,userId};
const original={id:chargeId,amount:1,date:1793998829,
 source:{type:'user',user:{id:userId},transaction_type:'invoice_payment'}};
const refunded={id:chargeId,amount:1,date:1794002084,
 receiver:{type:'user',user:{id:userId}}};
test('real observed Bot API incoming payment and outgoing positive refund verify',()=>{
 const result=evaluateRefundTransactions([original,refunded],settings);
 assert.equal(result.refundVerified,true);
 assert.equal(result.originalChargeVisible,true);
 assert.equal(result.refundTransactionVisible,true);
 assert.equal(result.conflictingRefundEvidence,false);
});
test('original positive payment alone cannot verify refund',()=>{
 assert.equal(evaluateRefundTransactions([original],settings).refundVerified,false);
});
test('other user recipient cannot satisfy refund evidence',()=>{
 const result=evaluateRefundTransactions([original,{...refunded,
  receiver:{type:'user',user:{id:12345}}}],settings);
 assert.equal(result.refundVerified,false);
 assert.equal(result.conflictingRefundEvidence,true);
});
test('different Stars amount is contradictory',()=>{
 const result=evaluateRefundTransactions([original,{...refunded,amount:3}],settings);
 assert.equal(result.refundVerified,false);
 assert.equal(result.conflictingRefundEvidence,true);
});
test('different transaction ID does not verify refund',()=>{
 const result=evaluateRefundTransactions([original,{...refunded,id:'other_charge'}],settings);
 assert.equal(result.refundVerified,false);
});
test('duplicate outgoing entries cannot verify a single refund',()=>{
 const result=evaluateRefundTransactions([original,refunded,refunded],settings);
 assert.equal(result.refundVerified,false);
 assert.equal(result.conflictingRefundEvidence,true);
});
test('another incoming payment is NOT a refund',()=>{
 const result=evaluateRefundTransactions([original,{...original,date:1794002084}],settings);
 assert.equal(result.refundVerified,false);
 assert.equal(result.conflictingRefundEvidence,true);
});
test('refund before original payment invalidates evidence',()=>{
 const result=evaluateRefundTransactions([original,{...refunded,date:1793990000}],settings);
 assert.equal(result.refundVerified,false);
 assert.equal(result.conflictingRefundEvidence,true);
});
test('negative amount with receiver is NOT accepted as real Bot API refund evidence',()=>{
 const result=evaluateRefundTransactions([original,{...refunded,amount:-1}],settings);
 assert.equal(result.refundVerified,false);
 assert.equal(result.conflictingRefundEvidence,true);
});
