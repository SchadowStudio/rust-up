// RUST UP - ALL-PROJECT OFFLINE SAFETY TESTS.
// Stars / wallet / crypto provider / Multi-Project / Bot / Mini App / migrations.
// No deployments, real payments, blockchain RPCs, or Cloudflare API calls.
// Use --quick for a shorter local crypto test run; --plan to inspect the plan.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const OUTPUT=path.join(ROOT,'.local-test-results','system-last-run.json');
const SECRET_NAMES=[
 'BOT_TOKEN','TELEGRAM_TEST_BOT_TOKEN','CLOUDFLARE_API_TOKEN',
 'GITHUB_TOKEN','GH_TOKEN','ADMIN_BOT_TOKEN','CLIPS_BOT_TOKEN',
 'WEBHOOK_SECRET','MERCHANT_SECRET','STRIPE_SECRET_KEY',
 'PLATEGA_SECRET_KEY','RPC_API_KEY'
];

export function sandboxEnvironment(env=process.env){
 const output={...env,LOCAL_PAYMENTS_TEST_ONLY:'1',
  RUSTUP_REAL_PAYMENTS_DISABLED:'true'};
 for(const name of SECRET_NAMES)delete output[name];
 // Never let tests discover a developer's real Cloudflare or wallet credentials.
 for(const name of Object.keys(output)){
  if(/(?:^|_)(?:SECRET|PRIVATE_KEY|MNEMONIC|SEED_PHRASE|API_TOKEN)$/i.test(name))
   delete output[name];
 }
 return output;
}
function relativePaths(root,dir){
 if(!fs.existsSync(dir))throw Error('missing_required_test_directory_'+dir);
 const out=fs.readdirSync(dir).filter(name=>name.endsWith('.test.mjs'))
  .sort().map(name=>path.relative(root,path.join(dir,name)).split(path.sep).join('/'));
 if(!out.length)throw Error('no_tests_found_'+dir);
 return out;
}
export function buildPlan(root=ROOT,{quick=false}={}){
 const from=(folder)=>relativePaths(root,path.join(root,folder));
 const scripts=from('scripts');
 const stars=from('integration/telegram-stars');
 const game=from('integration/existing-game-state-sandbox');
 const demo=from('integration/demo-game-wallet');
 for(const needed of [
  'scripts/telegram-stars-test-env.test.mjs',
  'scripts/check-stars-activation.test.mjs',
  'scripts/prepare-stars-quote-preview.test.mjs',
  'scripts/stars-variable-wallet-ui.test.mjs'
 ]){
  if(!scripts.includes(needed))throw Error('missing_critical_test_'+needed);
 }
 if(!stars.includes('integration/telegram-stars/variable-payments.test.mjs'))
  throw Error('missing_variable_stars_receipt_tests');
 const steps=[
  {name:'crypto_provider_and_multi_project',command:process.execPath,
   args:['scripts/local-test.mjs',...(quick?['--quick']:[])],cwd:root},
  {name:'telegram_stars_invoice_receipt_refund',command:process.execPath,
   args:['--test',...stars],cwd:root},
  {name:'game_state_integrity_without_real_money',command:process.execPath,
   args:['--test',...game],cwd:root},
  {name:'isolated_nonredeemable_demo_wallet',command:process.execPath,
   args:['--test',...demo],cwd:root},
  {name:'miniapp_worker_recovery_release_and_test_bot',command:process.execPath,
   args:['--test',...scripts],cwd:root}
 ];
 return steps;
}
export function compactResult(step,proc,started){
 const exit=proc?.status;
 return {
  name:step.name,
  passed:exit===0&&!proc?.error,
  exitCode:Number.isInteger(exit)?exit:null,
  elapsedMs:Date.now()-started,
  // Redact stdout in the JSON evidence: test logs can contain local identities.
  errorType:proc?.error?.code||null
 };
}
export function assessFullSystem(results){
 const names=['crypto_provider_and_multi_project',
  'telegram_stars_invoice_receipt_refund',
  'game_state_integrity_without_real_money',
  'isolated_nonredeemable_demo_wallet',
  'miniapp_worker_recovery_release_and_test_bot'];
 if(!Array.isArray(results)||results.length!==names.length||
    results.some((x,i)=>x?.name!==names[i]))
  throw Error('incomplete_system_test_plan');
 const failed=results.filter(x=>x.passed!==true).map(x=>x.name);
 return {
  schemaVersion:1,offlineOnly:true,simulationOnly:true,
  liveStarsPaymentTested:false,liveCryptoPaymentTested:false,
  realMoneyAccepted:false,gameWalletCreditEnabled:false,
  deploymentPerformed:false,productionActivationApproved:false,
  passed:failed.length===0,failedSteps:failed,steps:results
 };
}
async function main(){
 const args=process.argv.slice(2);
 if(args.some(x=>!['--quick','--plan'].includes(x)))
  throw Error('Usage: node payments/scripts/full-system-selftest.mjs [--quick] [--plan]');
 const plan=buildPlan(ROOT,{quick:args.includes('--quick')});
 if(args.includes('--plan')){
  console.log(JSON.stringify({offline:true,steps:plan.map(x=>({
   name:x.name,testFiles:x.args.filter(a=>a.endsWith('.test.mjs')).length
  }))},null,2));
  return;
 }
 const results=[],environment=sandboxEnvironment();
 console.log('RUST UP full offline system check - no live funds or deployment');
 for(const step of plan){
  console.log('\n=== '+step.name+' ===');
  const at=Date.now();
  const proc=spawnSync(step.command,step.args,{
   cwd:step.cwd,env:environment,shell:false,
   encoding:'utf8',timeout:240000,maxBuffer:16*1024*1024
  });
  const report=compactResult(step,proc,at);
  results.push(report);
  if(report.passed)console.log('PASS '+step.name+' ('+report.elapsedMs+' ms)');
  else{
   // Only the failed test's last few lines are shown. No credentials passed.
   const output=String(proc.stderr||'')+'\n'+String(proc.stdout||'');
   console.error('FAILED '+step.name);
   console.error(output.slice(-6000));
   break;
  }
 }
 // Fixed five-step report. A partial run is NEVER considered passed.
 const complete=plan.map((step,i)=>results[i]||
  {name:step.name,passed:false,exitCode:null,elapsedMs:0,
   errorType:'NOT_RUN'});
 const report={...assessFullSystem(complete),
  completedAt:new Date().toISOString(),mode:args.includes('--quick')?'quick':'full',
  testsAreNotProductionApproval:true};
 fs.mkdirSync(path.dirname(OUTPUT),{recursive:true});
 fs.writeFileSync(OUTPUT,JSON.stringify(report,null,2)+'\n',{
  encoding:'utf8',mode:0o600
 });
 console.log('\n'+(report.passed?'PASS':'FAIL')+
  ': Complete offline RUST UP system result saved to payments/.local-test-results/system-last-run.json');
 console.log('NO real payment activation or game balance modification.');
 if(!report.passed)process.exitCode=1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{
  console.error('RUST UP FULL SYSTEM CHECK FAILED: '+String(e?.message||e));
  process.exitCode=1;
 });
