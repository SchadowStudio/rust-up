import test from 'node:test';
import assert from 'node:assert/strict';
import {
 AGGREGATE_SQL,evaluateGameAccountIntegrity,inspectLiveGameAccountIntegrity
} from './audit-game-account-mirrors-readonly.mjs';

const GAME='9b0b533f-540a-4a25-a429-70ca8bd4e23d';
const flagNames=['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
 'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
 'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
 'PAYMENT_WALLET_STRICT_MODE'];
const aggregate=()=>({
 accounts:193,missing_user:0,invalid_json:0,non_numeric_canonical:0,
 null_mirror:1,non_numeric_mirror:0,negative_balance:0,
 over_credit_limit:2,fractional_cent:0,mirror_drift:3,
 drift_one_cent_plus:3,drift_subcent:0,
 distinct_account_review:5,overlimit_with_mirror_issue:1,
 restricted_accounts:8
});
const config=()=>({
 bindings:[
  {name:'DB',type:'d1',id:GAME},
  ...flagNames.map(name=>({name,type:'plain_text',text:'false'}))
 ],
 releaseControl:{enabled:0,approval_reference:null,reviewed_at_ms:null}
});

test('accurate aggregate counts do not double count a player with two issues',()=>{
 const report=evaluateGameAccountIntegrity(aggregate(),config());
 assert.equal(report.inspectedAccounts,193);
 assert.equal(report.distinctAccountsRequiringManualReview,5);
 assert.equal(report.reasons.mismatchedBalanceMirrors,3);
 assert.equal(report.reasons.nullUserBalances,1);
 assert.equal(report.reasons.accountBalancesAtOrAbovePaidCreditLimit,2);
 assert.equal(report.reasons.aboveLimitAlsoHavingMirrorIssue,1);
 assert.equal(report.reasons.restrictedAccounts,8);
 assert.equal(report.workerPaymentsOff,true);
 assert.equal(report.gameDBBound,true);
 assert.equal(report.gameLedgerGateOff,true);
 assert.equal(report.reviewRequired,true);
 assert.equal(report.autoRepairPermitted,false);
 assert.equal(report.livePaymentsApproved,false);
 assert.equal(report.balancesChanged,false);
});

test('no findings does not accidentally grant financial release approval',()=>{
 const row=Object.fromEntries(Object.keys(aggregate()).map(key=>
  [key,key==='accounts'?0:0]));
 const report=evaluateGameAccountIntegrity(row,config());
 assert.equal(report.reviewRequired,false);
 assert.equal(report.releaseApproval,false);
 assert.equal(report.autoRepairPermitted,false);
});

test('SQL only returns aggregates and never requests a specific identity',()=>{
 assert.match(AGGREGATE_SQL,/^WITH observed AS/);
 assert.match(AGGREGATE_SQL,/COUNT\(\*\) AS accounts/);
 assert.match(AGGREGATE_SQL,/distinct_account_review/);
 assert.doesNotMatch(AGGREGATE_SQL,/\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bDROP\b|\bALTER\b/i);
 assert.doesNotMatch(AGGREGATE_SQL,/telegram_user_id|username|email|phone/i);
});

test('inconsistent or missing D1 evidence fails closed',()=>{
 for(const issue of [
  {accounts:193,distinct_account_review:194},
  {mirror_drift:3,drift_one_cent_plus:2},
  {mirror_drift:-1},
  {overlimit_with_mirror_issue:5},
  {missing_user:null}
 ]){
  assert.throws(()=>evaluateGameAccountIntegrity({...aggregate(),...issue},config()),
   /invalid_aggregate|inconsistent_aggregate/);
 }
 assert.throws(()=>evaluateGameAccountIntegrity(null,config()),/evidence_missing/);
 const c=config();
 c.bindings.push({...c.bindings[0]});
 assert.throws(()=>evaluateGameAccountIntegrity(aggregate(),c),/duplicate_binding/);
});

test('ledger release enabled or missing Worker safety gate is reported without writing',()=>{
 const a=config();
 a.releaseControl.enabled=1;
 a.bindings.find(x=>x.name==='STARS_PAYMENT_ENABLED').text='true';
 const report=evaluateGameAccountIntegrity(aggregate(),a);
 assert.equal(report.gameLedgerGateOff,false);
 assert.equal(report.workerPaymentsOff,false);
 assert.equal(report.livePaymentsApproved,false);
});

test('live Cloudflare inspection runs only aggregate SELECT requests and no balance repair',async()=>{
 const calls=[];
 const fakeFetch=async (url,request)=>{
  const u=String(url);
  calls.push({url:u,method:request.method,
   query:request.body?JSON.parse(request.body).sql:null});
  if(u.endsWith('/settings')){
   assert.equal(request.method,'GET');
   return {ok:true,json:async()=>({
    success:true,result:{bindings:config().bindings}
   })};
  }
  assert.ok(u.endsWith('/query'));
  assert.equal(request.method,'POST');
  const query=JSON.parse(request.body).sql;
  assert.ok(query.startsWith('WITH observed AS')||
   query.startsWith('SELECT enabled,approval_reference'));
  return {ok:true,json:async()=>({
   success:true,result:[{results:[query.startsWith('WITH')
    ?aggregate():config().releaseControl]}]
  })};
 };
 const result=await inspectLiveGameAccountIntegrity(
  'not-a-production-token-only-for-offline-testing',fakeFetch);
 assert.equal(result.distinctAccountsRequiringManualReview,5);
 assert.ok(calls.every(x=>x.method==='GET'||x.method==='POST'));
 const encoded=JSON.stringify(result);
 assert.equal(encoded.includes('not-a-production-token'),false);
 assert.equal(encoded.includes('123456789'),false);
 assert.equal(encoded.includes('actualBalance'),false);
 assert.equal(result.playerIdentitiesIncluded,false);
});
