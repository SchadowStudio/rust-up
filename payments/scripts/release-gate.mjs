// Fail-closed operator release gate. No live flags are changed here.
// Self-reported evidence is a checklist, NOT independent certification.
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {runPreflight} from './preflight.mjs';

const MAX_AGE_MS=30*24*60*60*1000;
const MAX_FUTURE_SKEW_MS=5*60*1000;
export const RELEASE_REQUIREMENTS=Object.freeze([
 'operator_access_mfa',
 'trust_wallet_control_bitcoin',
 'trust_wallet_control_ethereum',
 'trust_wallet_control_tron',
 'rpc_quorum_independent',
 'bitcoin_mainnet_payment',
 'ethereum_mainnet_payment',
 'tron_mainnet_payment',
 'usdt_erc20_mainnet_payment',
 'usdt_trc20_mainnet_payment',
 'merchant_ledger_exactly_once',
 'merchant_webhook_end_to_end',
 'market_rate_failover',
 'restore_from_encrypted_backup',
 'rpc_and_queue_failover',
 'dispute_and_refund_runbook',
 'reorg_manual_containment',
 'throughput_and_load_test',
 'external_security_review',
 'legal_and_platform_review',
 'operational_monitoring'
]);
export const TON_RELEASE_REQUIREMENTS=Object.freeze([
 'trust_wallet_control_ton',
 'ton_mainnet_payment',
 'ton_independent_indexer_failover'
]);
const isHexSha=x=>typeof x==='string'&&/^[0-9a-f]{40}$/i.test(x);
export function assessReleaseEvidence(manifest,{
 now=Date.now(),commitSha,tonEnabled=false
}={}){
 const blockers=[];
 if(!manifest||typeof manifest!=='object'||Array.isArray(manifest)||
    manifest.schemaVersion!==1||manifest.environment!=='production')
  return {passed:false,blockers:['invalid_evidence_manifest'],checks:0,passedChecks:0};
 if(!isHexSha(commitSha)||!isHexSha(manifest.commitSha)||
    manifest.commitSha.toLowerCase()!==commitSha.toLowerCase())
  blockers.push('release_commit_does_not_match_evidence');
 const checks=tonEnabled?
  [...RELEASE_REQUIREMENTS,...TON_RELEASE_REQUIREMENTS]:[...RELEASE_REQUIREMENTS];
 let passedChecks=0;
 for(const name of checks){
  const item=manifest.checks?.[name];
  if(!item||item.result!=='pass'){
   blockers.push('missing_or_failed_evidence:'+name);continue;
  }
  if(typeof item.reviewer!=='string'||item.reviewer.trim().length<3||
     typeof item.reference!=='string'||item.reference.trim().length<8||
     item.reference.length>256){
   blockers.push('unverifiable_evidence:'+name);continue;
  }
  const when=Date.parse(item.testedAt);
  if(!Number.isFinite(when)||when>now+MAX_FUTURE_SKEW_MS||
     when<now-MAX_AGE_MS){
   blockers.push('stale_or_invalid_evidence:'+name);continue;
  }
  passedChecks++;
 }
 return {passed:blockers.length===0,blockers,checks:checks.length,passedChecks,
  notice:'Self-attested proof only; independent review and live safety checks remain mandatory.'};
}
export async function runReleaseGate({manifest,now=Date.now(),commitSha,
 preflightFn=runPreflight}={}){
 const preflight=await preflightFn();
 if(!preflight||typeof preflight!=='object'||
    !Array.isArray(preflight.blockers)||!Array.isArray(preflight.warnings))
  throw Error('invalid_preflight_result');
 const tonEnabled=Boolean(manifest?.tonEnabled);
 const evidence=assessReleaseEvidence(manifest,{now,commitSha,tonEnabled});
 const blockers=[...preflight.blockers,...evidence.blockers];
 if(!preflight.readyForFurtherManualReview)
  blockers.unshift('remote_preflight_not_ready');
 // A release checklist should never enable the gateway; it only reports
 // the remaining requirements. A human must verify and explicitly deploy.
 return {releaseApproved:false,eligibleForFinalHumanReview:blockers.length===0,
  blockers,warnings:preflight.warnings,
  evidenceChecks:evidence.checks,evidencePassed:evidence.passedChecks,
  disclaimer:'NO LIVE DEPLOYMENT OR AUTHORIZATION. Re-run after every change.'};
}
async function main(){
 try{
  const filename=process.argv[2];
  if(!filename)throw Error('release_evidence_json_path_required');
  const raw=await readFile(filename,'utf8');
  const manifest=JSON.parse(raw);
  const commitSha=execFileSync('git',['rev-parse','HEAD'],{
   encoding:'utf8',stdio:['ignore','pipe','ignore']
  }).trim();
  const report=await runReleaseGate({manifest,commitSha});
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  process.exitCode=report.eligibleForFinalHumanReview?0:2;
 }catch(error){
  process.stderr.write('Go-live remains blocked: '+
   String(error?.message||'unknown_error').slice(0,120)+'\n');
  process.exitCode=1;
 }
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)
 await main();
