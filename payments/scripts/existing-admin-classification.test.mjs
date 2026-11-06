import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {EXISTING_ADMIN_SQL,evaluateExistingAdminCounts}
 from './existing-admin-classification.mjs';

function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE accounts (id INTEGER PRIMARY KEY,state TEXT NOT NULL);"+
  "CREATE TABLE users (id INTEGER PRIMARY KEY,username TEXT,balance REAL);"+
  "CREATE TABLE admins (who TEXT PRIMARY KEY);");
 const account=(id,username,balance,mirror=balance)=>{
  db.prepare('INSERT INTO accounts VALUES(?,?)')
   .run(id,JSON.stringify({balance}));
  db.prepare('INSERT INTO users VALUES(?,?,?)').run(id,username,mirror);
 };
 account(111,'chief',1100000,1090000); // FIRST_ADMIN, two issues
 account(222,'mod_alpha',30,30);        // legacy @username
 account(333,'mod_beta',40,40);         // legacy numeric ID
 account(444,'player',20,null);         // not admin, review
 account(555,'regular',3,3);            // not admin, clean
 db.prepare('INSERT INTO admins(who) VALUES(?)').run('@MOD_ALPHA');
 db.prepare('INSERT INTO admins(who) VALUES(?)').run('333');
 return {db,run(owner='@chief'){
  return db.prepare(EXISTING_ADMIN_SQL).get(owner);
 }};
}

test('reads existing numeric admins and @usernames plus FIRST_ADMIN without a second registry',()=>{
 const f=fixture();
 try{
  const raw=f.run();
  assert.deepEqual(raw,{
   account_count:5,known_admin_accounts:3,legacy_admin_accounts:2,
   first_admin_accounts:1,review_accounts:2,
   admin_review_accounts:1,regular_review_accounts:1
  });
  const safe=evaluateExistingAdminCounts(raw);
  assert.equal(safe.adminAccounts,3);
  assert.equal(safe.adminAccountsWithBalanceReview,1);
  assert.equal(safe.otherAccountsWithBalanceReview,1);
  assert.equal(safe.paymentRulesUnchanged,true);
  assert.equal(safe.identityVerifiedForPayments,false);
  assert.equal(JSON.stringify(safe).includes('chief'),false);
  assert.equal(JSON.stringify(safe).includes('111'),false);
 }finally{f.db.close();}
});

test('owner alias does not grant permission and an unknown alias cannot invent an admin',()=>{
 const f=fixture();
 try{
  const raw=f.run('unknown-owner');
  assert.equal(raw.known_admin_accounts,2);
  assert.equal(raw.admin_review_accounts,0);
  assert.equal(raw.regular_review_accounts,2);
  const safe=evaluateExistingAdminCounts(raw);
  assert.equal(safe.adminClassificationOnly,true);
  assert.equal(safe.paymentRulesUnchanged,true);
 }finally{f.db.close();}
});

test('same account in both existing admin sources is counted once',()=>{
 const f=fixture();
 try{
  const raw=f.run('@mod_alpha');
  assert.equal(raw.legacy_admin_accounts,2);
  assert.equal(raw.first_admin_accounts,1);
  assert.equal(raw.known_admin_accounts,2);
 }finally{f.db.close();}
});

test('invalid or contradictory aggregate data is not accepted',()=>{
 const example={account_count:3,known_admin_accounts:1,
  legacy_admin_accounts:1,first_admin_accounts:0,
  review_accounts:2,admin_review_accounts:1,
  regular_review_accounts:1};
 assert.ok(evaluateExistingAdminCounts(example));
 assert.throws(()=>evaluateExistingAdminCounts({...example,
  admin_review_accounts:2}),/inconsistent/);
 assert.throws(()=>evaluateExistingAdminCounts({...example,
  known_admin_accounts:-1}),/invalid/);
 assert.throws(()=>evaluateExistingAdminCounts(null),/invalid/);
});

test('existing admin SQL contains no account mutations or new admin registry',()=>{
 assert.match(EXISTING_ADMIN_SQL,/FROM admins ad/);
 assert.match(EXISTING_ADMIN_SQL,/WITH first_admin\(alias\)/);
 assert.doesNotMatch(EXISTING_ADMIN_SQL,
  /\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/i);
 assert.doesNotMatch(EXISTING_ADMIN_SQL,/rustup_admin_id_registry/);
});
