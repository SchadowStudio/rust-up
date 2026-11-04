// Read-only production readiness assessment. Never changes remote settings,
// displays secrets, or marks a real-money deployment as "certified".
import {executeOperator} from './headless-operator.mjs';
import {fileURLToPath} from 'node:url';

export function assessOperationalStatus(status,{minFreePerChain=1,maxPendingPartials=100}={}){
 const blockers=[],warnings=[];
 if(!status||status.ok!==true)throw Error('invalid_operator_status');
 const missing=Array.isArray(status.missingPrerequisites)?
  status.missingPrerequisites:[];
 for(const name of missing)blockers.push('missing_configuration:'+name);
 const receivers=status.availableReceivers||{};
 for(const chain of ['bitcoin','ethereum','tron']){
  const available=Number(receivers[chain]||0);
  if(!Number.isSafeInteger(available)||available<minFreePerChain)
   blockers.push('insufficient_unique_wallet_addresses:'+chain);
 }
 if(Number(status.deliveryRetryFailures||0)>0)
  blockers.push('failed_merchant_webhook_deliveries');
 if(Number(status.manualReviews||0)>0)
  blockers.push('unresolved_manual_payment_reviews');
 if(Number(status.expiredEnabledRates||0)>0)
  blockers.push('expired_active_exchange_rates');
 const audits=status.postSettlementAudits||{};
 if(Number(audits.manual_review||0)>0)
  blockers.push('post_settlement_chain_disputes');
 if(Number(audits.uncertain||0)>0)
  warnings.push('pending_post_settlement_chain_checks');
 if(Number(status.pendingPartialReconciliations||0)>maxPendingPartials)
  blockers.push('too_many_pending_partial_reconciliations');
 if(Number(status.deliveryBacklog||0)>0)
  warnings.push('pending_merchant_webhooks');
 if(status.oldestUndeliveredMs!=null&&
    Number.isSafeInteger(Number(status.oldestUndeliveredMs))&&
    Date.now()-Number(status.oldestUndeliveredMs)>15*60000)
  blockers.push('webhook_backlog_older_than_15_minutes');
 // It is possible for the gateway to be intentionally off during staging.
 // This script is an OPERATOR CHECK, not a certification to turn it on.
 if(status.checkoutEnabled!==true)warnings.push('new_payment_acceptance_is_currently_disabled');
 return {
  readyForFurtherManualReview:blockers.length===0,
  blockers,warnings,
  projectCount:Number(status.projects||0),
  freeReceiversByChain:receivers,
  securityChecksAreNotLiveTransactionTests:true
 };
}
export async function runPreflight(options={}){
 const status=await executeOperator(['status'],options);
 return assessOperationalStatus(status,options);
}
async function main(){
 try{
  const report=await runPreflight();
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  if(report.blockers.length)process.exitCode=2;
 }catch(error){
  process.stderr.write('Read-only preflight failed: '+
   String(error?.message||'error').slice(0,120)+'\n');
  process.exitCode=1;
 }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===
 new URL('file://'+process.argv[1]).href)await main();
