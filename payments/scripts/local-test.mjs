// Offline-first Windows/Linux/macOS test runner. Uses only Node.js, Python
// and the repository. Never reads wallet secrets, contacts a chain, or deploys.
// Individual regression suites replace network fetch with deterministic mocks.
import {spawnSync} from 'node:child_process';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const reportDir=path.join(root,'.local-test-results');
const quick=process.argv.includes('--quick');
const checkCommand=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).scripts.check;
const checks=checkCommand.split(' && ').map(value=>{
 const match=/^node --check ([a-zA-Z0-9_./-]+)$/.exec(value);
 if(!match)throw Error('unsupported_syntax_check_command');
 return match[1];
});
const cases=readdirSync(path.join(root,'tests'))
 .filter(name=>name.endsWith('.test.mjs'))
 .sort().map(name=>path.join(root,'tests',name));
if(!cases.length)throw Error('no_local_payment_tests_found');
const steps=[
 ...checks.map(file=>({label:'Syntax '+file,bin:process.execPath,args:['--check',file]})),
 {label:'Simulated payment and security tests',bin:process.execPath,args:['--test',...cases]}
];
if(!quick){
 steps.push(
  {label:'Build operator console (offline)',bin:process.execPath,
   args:['scripts/build-admin.mjs']},
  {label:'Build checkout (offline)',bin:process.execPath,
   args:['scripts/build-checkout.mjs']},
  {label:'SQLite schema and migration regression tests',bin:'python',
   args:['-m','unittest','discover','-s','tests','-p','schema*_test.py','-v'],
   python:true}
 );
}
const results=[];
let failed=false;
process.stdout.write('\nRUST UP LOCAL TEST MODE — 0 EUR, NO REAL FUNDS\n');
process.stdout.write('No Cloudflare login, real wallet, Telegram account or RPC credentials needed.\n');
process.stdout.write('Mode: '+(quick?'quick':'full')+' | '+cases.length+' Node.js test files\n\n');
for(const step of steps){
 const start=Date.now();
 process.stdout.write('>>> '+step.label+'\n');
 let runner=spawnSync(step.bin,step.args,{
  cwd:root,stdio:'inherit',env:{...process.env,LOCAL_PAYMENTS_TEST_ONLY:'1'},
  shell:false
 });
 if(step.python&&runner.error?.code==='ENOENT'&&process.platform==='win32'){
  runner=spawnSync('py',['-3',...step.args],{
   cwd:root,stdio:'inherit',env:{...process.env,LOCAL_PAYMENTS_TEST_ONLY:'1'},
   shell:false
  });
 }
 const ok=runner.status===0&&!runner.error;
 results.push({name:step.label,ok,elapsedMs:Date.now()-start});
 if(!ok){
  failed=true;
  process.stderr.write('FAILED '+step.label+(runner.error?' ('+runner.error.message+')':'')+'\n');
  break;
 }
}
mkdirSync(reportDir,{recursive:true});
const summary={schemaVersion:1,mode:quick?'quick':'full',simulatedOnly:true,
 networkPaymentsExecuted:false,realMoneySpent:false,
 result:failed?'FAILED':'PASSED',runAt:new Date().toISOString(),steps:results};
writeFileSync(path.join(reportDir,'last-run.json'),JSON.stringify(summary,null,2)+'\n');
process.stdout.write('\n'+summary.result+': simulated local checks, '+results.length+
 ' steps. Report: .local-test-results/last-run.json\n');
process.stdout.write('IMPORTANT: This is NOT a mainnet payment test or production approval.\n');
if(failed)process.exitCode=1;
