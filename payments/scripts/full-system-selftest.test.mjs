import test from 'node:test';
import assert from 'node:assert/strict';
import {
 sandboxEnvironment,buildPlan,compactResult,assessFullSystem
} from './full-system-selftest.mjs';

const EXPECTED=[
 'crypto_provider_and_multi_project',
 'telegram_stars_invoice_receipt_refund',
 'game_state_integrity_without_real_money',
 'isolated_nonredeemable_demo_wallet',
 'miniapp_worker_recovery_release_and_test_bot'
];
test('system tests cannot accidentally access operator payments, webhooks or wallet secrets',()=>{
 const env=sandboxEnvironment({
  PATH:'/bin',BOT_TOKEN:'prod',
  TELEGRAM_TEST_BOT_TOKEN:'test-token',
  CLOUDFLARE_API_TOKEN:'api',GITHUB_TOKEN:'gh',
  WEBHOOK_SECRET:'secret',RPC_API_KEY:'rpc',
  PRIVATE_KEY:'danger',WALLET_MNEMONIC:'danger',
  HOME:'/tmp/user',LOCAL_PAYMENTS_TEST_ONLY:'0'
 });
 assert.equal(env.PATH,'/bin');
 assert.equal(env.HOME,'/tmp/user');
 assert.equal(env.LOCAL_PAYMENTS_TEST_ONLY,'1');
 assert.equal(env.RUSTUP_REAL_PAYMENTS_DISABLED,'true');
 for(const key of ['BOT_TOKEN','TELEGRAM_TEST_BOT_TOKEN','CLOUDFLARE_API_TOKEN',
  'GITHUB_TOKEN','WEBHOOK_SECRET','RPC_API_KEY','PRIVATE_KEY','WALLET_MNEMONIC'])
  assert.equal(Object.hasOwn(env,key),false);
});
test('full suite covers crypto, Stars, game protection, isolated wallet and release scripts',()=>{
 const plan=buildPlan();
 assert.deepEqual(plan.map(x=>x.name),EXPECTED);
 for(const step of plan){
  assert.equal(step.command,process.execPath);
  assert.equal(step.cwd.endsWith('payments'),true);
  assert.ok(step.args.length>=1);
  if(step.name==='crypto_provider_and_multi_project'){
   // The local crypto runner correctly needs only one positional script.
   assert.deepEqual(step.args,['scripts/local-test.mjs']);
  }else{
   assert.equal(step.args[0],'--test');
   assert.ok(step.args.length>=2);
  }
  // Test filenames may contain words like "deployment", but are not commands.
  assert.equal(step.args.some(x=>['--deploy','--live','--production'].includes(x)),false);
  assert.equal(step.args.some(x=>/^https?:\/\//.test(x)),false);
 }
 const stars=plan.find(x=>x.name==='telegram_stars_invoice_receipt_refund');
 assert.ok(stars.args.includes('integration/telegram-stars/variable-payments.test.mjs'));
 const scripts=plan.at(-1);
 assert.ok(scripts.args.includes('scripts/telegram-stars-test-env.test.mjs'));
 assert.ok(scripts.args.includes('scripts/check-stars-activation.test.mjs'));
});
test('quick mode still includes all five safety areas but skips slow crypto build',()=>{
 const plan=buildPlan(undefined,{quick:true});
 assert.deepEqual(plan.map(x=>x.name),EXPECTED);
 assert.ok(plan[0].args.includes('--quick'));
 assert.equal(plan.some(x=>x.args.includes('deploy')),false);
});
test('incomplete, altered, or failed test result is never production approval',()=>{
 const results=EXPECTED.map(name=>({name,passed:true,elapsedMs:1}));
 const ok=assessFullSystem(results);
 assert.equal(ok.passed,true);
 assert.equal(ok.productionActivationApproved,false);
 assert.equal(ok.liveStarsPaymentTested,false);
 assert.equal(ok.liveCryptoPaymentTested,false);
 assert.equal(ok.gameWalletCreditEnabled,false);
 assert.equal(ok.realMoneyAccepted,false);
 assert.equal(ok.deploymentPerformed,false);
 assert.throws(()=>assessFullSystem(results.slice(1)),/incomplete_system_test_plan/);
 assert.throws(()=>assessFullSystem([...results].reverse()),/incomplete_system_test_plan/);
 const failed=assessFullSystem(results.map((r,i)=>({...r,passed:i!==3})));
 assert.equal(failed.passed,false);
 assert.deepEqual(failed.failedSteps,['isolated_nonredeemable_demo_wallet']);
});
test('run result stores no stdout, identity, receipt, token or secret',()=>{
 const x=compactResult({name:'fake'},{
  status:1,stdout:'bot: secret',stderr:'charge: abc',
  error:{code:'EXIT'}},Date.now()-1);
 assert.equal(x.passed,false);
 assert.equal(x.exitCode,1);
 assert.equal(x.errorType,'EXIT');
 assert.equal(JSON.stringify(x).includes('secret'),false);
 assert.equal(JSON.stringify(x).includes('charge'),false);
});
