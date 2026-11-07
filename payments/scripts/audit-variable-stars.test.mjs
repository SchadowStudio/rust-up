import test from 'node:test';
import assert from 'node:assert/strict';
import {buildVariableStarsAudit} from './audit-variable-stars.mjs';

const offBindings=[
 'PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
 'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
 'PAYMENT_WALLET_STRICT_MODE'
].map(name=>({name,type:'plain_text',text:'false'}));
const clean={
 paid_missing_charge:0,unpaid_with_charge:0,paid_missing_timestamp:0,
 approved_over_hour_old:0
};
function rows(){return [
 {status:'pending',total:2},{status:'checkout_approved',total:1},
 {status:'paid',total:0}
];}
test('read-only audit aggregates orders without any customer or charge identifier',()=>{
 const report=buildVariableStarsAudit(rows(),clean,
  {duplicated_charge_groups:0},offBindings);
 assert.equal(report.readOnly,true);
 assert.equal(report.status,'NO_ANOMALIES_PAYMENT_DISABLED');
 assert.equal(report.summary.total,3);
 assert.equal(report.acceptingPayments,false);
 assert.equal(report.gameCreditAvailable,false);
 assert.equal(JSON.stringify(report).includes('telegram_user_id'),false);
 assert.equal(JSON.stringify(report).includes('telegram_charge_id'),false);
});
test('missing receipt charge ID and replay anomalies force review',()=>{
 const result=buildVariableStarsAudit([{status:'paid',total:2}],
  {...clean,paid_missing_charge:1},{duplicated_charge_groups:1},offBindings);
 assert.equal(result.status,'MANUAL_REVIEW_REQUIRED');
 assert.equal(result.anomalies.paidMissingCharge,1);
 assert.equal(result.anomalies.duplicateChargeGroups,1);
});
test('live money switches are never treated as an acceptable audit baseline',()=>{
 const flags=offBindings.map(x=>({...x,text:'true'}));
 const result=buildVariableStarsAudit([],clean,{duplicated_charge_groups:0},flags);
 assert.equal(result.status,'PAYMENT_GATE_REQUIRES_REVIEW');
 assert.equal(result.acceptingPayments,true);
});
test('missing unknown or malformed Cloudflare config is fail closed',()=>{
 assert.throws(()=>buildVariableStarsAudit([],clean,{duplicated_charge_groups:0},[]),
  /audit_unknown_payment_gate/);
 assert.throws(()=>buildVariableStarsAudit([{status:'other',total:1}],clean,
  {duplicated_charge_groups:0},offBindings),/audit_unknown_or_duplicate_status/);
 assert.throws(()=>buildVariableStarsAudit([{status:'paid',total:0},{status:'paid',total:0}],clean,
  {duplicated_charge_groups:0},offBindings),/audit_unknown_or_duplicate_status/);
 assert.throws(()=>buildVariableStarsAudit([{status:'pending',total:-1}],clean,
  {duplicated_charge_groups:0},offBindings),/audit_invalid_aggregate/);
});
test('empty D1 SUM fields are normalized to zero',()=>{
 const empty={paid_missing_charge:null,unpaid_with_charge:null,
  paid_missing_timestamp:null,approved_over_hour_old:null};
 const x=buildVariableStarsAudit([],empty,{duplicated_charge_groups:0},offBindings);
 assert.equal(x.status,'NO_ANOMALIES_PAYMENT_DISABLED');
});
