import test from 'node:test';
import assert from 'node:assert/strict';
import {RELEASE_REQUIREMENTS,TON_RELEASE_REQUIREMENTS,
 assessReleaseEvidence,runReleaseGate} from '../scripts/release-gate.mjs';
const SHA='a'.repeat(40);
const NOW=1762300000000;
function evidence(){
 return {schemaVersion:1,environment:'production',commitSha:SHA,
  checks:Object.fromEntries([...RELEASE_REQUIREMENTS,...TON_RELEASE_REQUIREMENTS]
   .map(name=>[name,{result:'pass',reviewer:'Independent QA team',
    reference:'private-audit:'+name,testedAt:new Date(NOW-1000).toISOString()}]))};
}
const preflight=()=>({readyForFurtherManualReview:true,blockers:[],warnings:[]});
test('fails closed when there is no evidence',()=>{
 const out=assessReleaseEvidence(null,{now:NOW,commitSha:SHA});
 assert.equal(out.passed,false);
 assert.deepEqual(out.blockers,['invalid_evidence_manifest']);
});
test('complete fresh evidence only qualifies for final human review',async()=>{
 const manifest=evidence();
 const report=await runReleaseGate({manifest,commitSha:SHA,now:NOW,
  preflightFn:preflight});
 assert.equal(report.eligibleForFinalHumanReview,true);
 assert.equal(report.releaseApproved,false);
 assert.equal(report.evidencePassed,RELEASE_REQUIREMENTS.length);
});
test('unknown commit, forged future dates, stale entries, missing approvals block release',()=>{
 const manifest=evidence();
 assert.ok(assessReleaseEvidence(manifest,{now:NOW,commitSha:'b'.repeat(40)})
  .blockers.includes('release_commit_does_not_match_evidence'));
 manifest.checks.bitcoin_mainnet_payment.testedAt=new Date(NOW+24*3600000).toISOString();
 assert.ok(assessReleaseEvidence(manifest,{now:NOW,commitSha:SHA})
  .blockers.includes('stale_or_invalid_evidence:bitcoin_mainnet_payment'));
 manifest.checks.bitcoin_mainnet_payment.testedAt=new Date(NOW-35*86400000).toISOString();
 assert.equal(assessReleaseEvidence(manifest,{now:NOW,commitSha:SHA}).passed,false);
 delete manifest.checks.bitcoin_mainnet_payment;
 assert.ok(assessReleaseEvidence(manifest,{now:NOW,commitSha:SHA})
  .blockers.includes('missing_or_failed_evidence:bitcoin_mainnet_payment'));
});
test('TON tests are mandatory if the TON network is enabled',()=>{
 const manifest=evidence();
 for(const item of TON_RELEASE_REQUIREMENTS)delete manifest.checks[item];
 assert.equal(assessReleaseEvidence(manifest,{now:NOW,commitSha:SHA}).passed,true);
 const result=assessReleaseEvidence(manifest,{now:NOW,commitSha:SHA,tonEnabled:true});
 assert.equal(result.passed,false);
 assert.ok(result.blockers.includes('missing_or_failed_evidence:ton_mainnet_payment'));
});
test('clean attestations cannot override remote outages or configuration blockers',async()=>{
 const out=await runReleaseGate({manifest:evidence(),commitSha:SHA,now:NOW,
  preflightFn:()=>({readyForFurtherManualReview:false,
   blockers:['failed_merchant_webhook_deliveries'],warnings:[]})});
 assert.equal(out.eligibleForFinalHumanReview,false);
 assert.ok(out.blockers.includes('remote_preflight_not_ready'));
});
