import test from 'node:test';
import assert from 'node:assert/strict';
import {assessOperationalStatus,runPreflight} from '../scripts/preflight.mjs';
const good=()=>({ok:true,projects:2,checkoutEnabled:true,
 missingPrerequisites:[],deliveryRetryFailures:0,manualReviews:0,
 expiredEnabledRates:0,postSettlementAudits:{uncertain:0,manual_review:0},
 pendingPartialReconciliations:0,deliveryBacklog:0,oldestUndeliveredMs:null,
 availableReceivers:{bitcoin:10,ethereum:20,tron:20}});
test('headless release checklist reports a clean but not certified configuration',()=>{
 const report=assessOperationalStatus(good());
 assert.equal(report.readyForFurtherManualReview,true);
 assert.equal(report.securityChecksAreNotLiveTransactionTests,true);
 assert.equal(report.projectCount,2);
});
test('preflight blocks absent Trust Wallet capacity or missing signed delivery setup',()=>{
 const report=assessOperationalStatus({
  ...good(),availableReceivers:{bitcoin:1,ethereum:0,tron:0},
  missingPrerequisites:['postSettlementAudit','bitcoinQuorum'],
  deliveryRetryFailures:1,manualReviews:1,expiredEnabledRates:1});
 assert.equal(report.readyForFurtherManualReview,false);
 assert.ok(report.blockers.includes('insufficient_unique_wallet_addresses:ethereum'));
 assert.ok(report.blockers.includes('missing_configuration:postSettlementAudit'));
 assert.ok(report.blockers.includes('failed_merchant_webhook_deliveries'));
});
test('chain disputes and partial queue overload prevent release approval',()=>{
 const report=assessOperationalStatus({
  ...good(),postSettlementAudits:{manual_review:4,uncertain:3},
  pendingPartialReconciliations:110
 });
 assert.equal(report.readyForFurtherManualReview,false);
 assert.ok(report.blockers.includes('post_settlement_chain_disputes'));
 assert.ok(report.blockers.includes('too_many_pending_partial_reconciliations'));
 assert.ok(report.warnings.includes('pending_post_settlement_chain_checks'));
});
test('read-only preflight can query operator status without any POST',async()=>{
 const token='z'.repeat(64);
 let request;
 const report=await runPreflight({
  adminUrl:'https://gateway.example',adminKey:token,
  fetchFn:async (url,options)=>{
   request={url,options};
   return {ok:true,json:async()=>good()};
  }
 });
 assert.equal(report.readyForFurtherManualReview,true);
 assert.equal(request.options.method,'GET');
 assert.equal(request.url,'https://gateway.example/v2/admin/status');
});
