import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAdminPaymentPanelApi} from './admin-panel-api.mjs';
const who={id:7390606911};
function db(){
 const table={master:{enabled:0,updated_at_ms:0,updated_by:0},stars:{enabled:0,updated_at_ms:0,updated_by:0},crypto:{enabled:0,updated_at_ms:0,updated_by:0}};
 const audits=[];
 return {
  table,audits,
  prepare(sql){
   let args=[];
   return {
    bind(...v){args=v;return this;},
    async run(){
      assert.match(sql,/^UPDATE rustup_payment_settings/);
      const [enabled,updated_at_ms,updated_by,channel,expected]=args;
      if(table[channel].enabled!==expected)return {meta:{changes:0}};
      audits.push({channel,old_enabled:expected,new_enabled:enabled,telegram_admin_id:updated_by,occurred_at_ms:updated_at_ms});
      Object.assign(table[channel],{enabled,updated_at_ms,updated_by});
      return {meta:{changes:1}};
    },
    async all(){
      if(sql.startsWith('SELECT channel,enabled FROM'))return {results:Object.entries(table).map(([channel,v])=>({channel,enabled:v.enabled}))};
      if(sql.startsWith('SELECT channel,enabled,updated_at_ms'))return {results:Object.entries(table).map(([channel,v])=>({channel,...v}))};
      if(sql.startsWith('SELECT channel,old_enabled'))return {results:audits.slice().reverse()};
      throw Error('unexpected_mock_sql');
    }
   };
  }
 };
}
const env=()=>({PAYMENTS_DB:db(),PAYMENT_PRODUCTION_ENABLED:'false'});
test('status shows three disabled switches, hard production gate and no payment acceptance',async()=>{
 const e=env();
 const s=await handleAdminPaymentPanelApi('payments',{},e,who);
 assert.deepEqual(s.controls,{master:false,stars:false,crypto:false});
 assert.equal(s.effective.stars,false);
 assert.equal(s.effective.crypto,false);
 assert.equal(s.productionEnabled,false);
});
test('admin can stage switches, every change audited, without enabling real payments',async()=>{
 const e=env(),payload=channel=>({channel,enabled:true,expected:false,confirmation:'CONFIRM_PAYMENT_SWITCH'});
 for(const channel of ['stars','master','crypto']){
  const s=await handleAdminPaymentPanelApi('payments-set',payload(channel),e,who);
  assert.equal(s.ok,true);assert.equal(s.controls[channel],true);
  assert.equal(s.effective.stars,false);assert.equal(s.effective.crypto,false);
 }
 assert.equal(e.PAYMENTS_DB.audits.length,3);
 assert.equal(e.PAYMENTS_DB.audits[0].telegram_admin_id,who.id);
 const off=await handleAdminPaymentPanelApi('payments-set',{
  channel:'master',enabled:false,expected:true,confirmation:'CONFIRM_PAYMENT_SWITCH'
 },e,who);
 assert.equal(off.controls.master,false);
 assert.equal(e.PAYMENTS_DB.audits.length,4);
});
test('invalid identity, stale state and mutation without exact confirmation are rejected',async()=>{
 const e=env(),req={channel:'crypto',enabled:true,expected:false,confirmation:'CONFIRM_PAYMENT_SWITCH'};
 assert.equal((await handleAdminPaymentPanelApi('payments-set',req,e,{id:'not-a-user'})).ok,false);
 assert.equal((await handleAdminPaymentPanelApi('payments-set',{...req,confirmation:''},e,who)).ok,false);
 assert.equal((await handleAdminPaymentPanelApi('payments-set',req,e,who)).ok,true);
 assert.equal((await handleAdminPaymentPanelApi('payments-set',req,e,who)).error,'stale_payment_control_state');
 assert.equal(e.PAYMENTS_DB.audits.length,1);
});
test('missing payment DB fails closed',async()=>{
 assert.equal((await handleAdminPaymentPanelApi('payments',{}, {},who)).error,'payment_controls_unavailable');
});
