import test from 'node:test';
import assert from 'node:assert/strict';
import {assessGameLedgerMigration,inspectGameLedgerPreflight}
 from './preflight-game-ledger-migration.mjs';

const flags=['PAYMENT_PRODUCTION_ENABLED','STARS_PAYMENT_ENABLED',
 'STARS_FIXED_PRODUCTS_ENABLED','STARS_REFUNDS_ENABLED',
 'STARS_VARIABLE_TOPUP_ENABLED','STARS_VARIABLE_CREDIT_LEDGER_READY',
 'PAYMENT_WALLET_STRICT_MODE'];
function fixture(){
 return {
  accountColumns:['id','state','v','updated'].map(name=>({name})),
  userColumns:['id','balance','blocked','banned'].map(name=>({name})),
  oldJournalObjects:[],
  bindings:[
   {name:'DB',type:'d1',id:'9b0b533f-540a-4a25-a429-70ca8bd4e23d'},
   {name:'PAYMENTS_DB',type:'d1',id:'06079270-a227-466a-9991-abd4201ec5f6'},
   ...flags.map(name=>({name,type:'plain_text',text:'false'}))
  ],
  controls:['master','stars','crypto'].map(channel=>({channel,enabled:0})),
  paidOrderCount:0,
  accountConsistency:{accountCount:191,mismatchedMirrors:3,
   unsupportedBalances:2},
  backupAvailable:true
 };
}
test('additive migration planning may proceed despite preexisting isolated account drift',()=>{
 const r=assessGameLedgerMigration(fixture());
 assert.equal(r.safeToPrepareMigration,true);
 assert.equal(r.chargesEnabled,false);
 assert.equal(r.changesApplied,false);
 assert.equal(r.accountCount,191);
 assert.deepEqual(r.accountSettlementBlockers,[
  'existing_game_balance_mirror_mismatch',
  'existing_game_balance_out_of_supported_range'
 ]);
 assert.deepEqual(r.blockers,[]);
 assert.equal(JSON.stringify(r).includes('token'),false);
});
test('unknown journal objects and missing backup block automatic migration preparation',()=>{
 const v=fixture();v.oldJournalObjects=[{name:'rustup_game_paid_receipts'}];
 v.backupAvailable=false;
 const r=assessGameLedgerMigration(v);
 assert.deepEqual(r.blockers,[
  'partial_or_existing_paid_journal_requires_manual_review',
  'd1_time_travel_bookmark_unavailable'
 ]);
 assert.equal(r.safeToPrepareMigration,false);
});
test('any live payment gate or provider charge blocks new ledger schema',()=>{
 const v=fixture();v.bindings.find(x=>x.name==='STARS_PAYMENT_ENABLED').text='true';
 v.controls[0].enabled=1;v.paidOrderCount=2;
 const r=assessGameLedgerMigration(v);
 for(const e of ['live_worker_payment_flags_not_all_off',
  'database_payment_controls_not_all_off',
  'existing_real_charge_states_require_reconciliation'])
  assert.ok(r.blockers.includes(e));
 assert.equal(r.safeToPrepareMigration,false);
});
test('incorrect DB or missing banned column or duplicate binding fails closed',()=>{
 const v=fixture();
 v.userColumns=v.userColumns.filter(x=>x.name!=='banned');
 v.bindings.find(x=>x.name==='PAYMENTS_DB').id='incorrect';
 const r=assessGameLedgerMigration(v);
 assert.ok(r.blockers.includes('game_account_schema_drift'));
 assert.ok(r.blockers.includes('correct_two_d1_bindings_required'));
 v.bindings.push({...v.bindings[0]});
 assert.throws(()=>assessGameLedgerMigration(v),/duplicate_live_worker_binding/);
});
test('missing evidence never reports a safe schema migration',()=>{
 assert.throws(()=>assessGameLedgerMigration({}),
  /migration_read_only_evidence_incomplete/);
});
test('live inspector issues only read-only SQL/GET and never leaks restore bookmark',async()=>{
 const seen=[];
 const cols={accounts:fixture().accountColumns,users:fixture().userColumns};
 const getRows=(sql)=>{
  if(sql==='PRAGMA table_info(accounts)')return cols.accounts;
  if(sql==='PRAGMA table_info(users)')return cols.users;
  if(sql.includes('sqlite_master'))return [];
  if(sql.includes('SELECT channel,enabled'))return fixture().controls;
  if(sql.includes('COUNT(*) AS n FROM rustup_stars_variable_orders'))return [{n:0}];
  if(sql.includes('LEFT JOIN users u'))return [{
   account_count:191,drift:3,invalid_balance:2
  }];
  throw Error('unrecognized_sql');
 };
 const transport=async (url,request)=>{
  seen.push({url:String(url),method:request.method,sql:request.body?
   JSON.parse(request.body).sql:undefined});
  if(String(url).endsWith('/settings'))
   return {ok:true,json:async()=>({success:true,
    result:{bindings:fixture().bindings}})};
  if(String(url).endsWith('/time_travel/bookmark'))
   return {ok:true,json:async()=>({success:true,
    result:{bookmark:'secret-private-bookmark-12345'}})};
  if(request.method==='POST'&&String(url).endsWith('/query'))
   return {ok:true,json:async()=>({success:true,
    result:[{results:getRows(JSON.parse(request.body).sql)}]})};
  throw Error('unrecognized_request');
 };
 const r=await inspectGameLedgerPreflight('local-read-only-token-123456',transport);
 assert.equal(r.safeToPrepareMigration,true);
 assert.equal(r.accountSettlementBlockers.length,2);
 assert.ok(seen.every(x=>x.method==='GET'||x.method==='POST'&&
  /^(SELECT|PRAGMA) /i.test(x.sql)));
 assert.equal(JSON.stringify(r).includes('secret-private-bookmark'),false);
 assert.equal(JSON.stringify(r).includes('local-read-only-token'),false);
});
