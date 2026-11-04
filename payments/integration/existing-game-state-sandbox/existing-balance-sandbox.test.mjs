import test from 'node:test';
import assert from 'node:assert/strict';
import { ExistingGameBalanceSandbox } from './existing-balance-sandbox.mjs';

test('uses the existing accounts.state.balance shape, preserving all other state', () => {
  const s = new ExistingGameBalanceSandbox();
  try {
    s.loadSyntheticAccount(901001, {balance:100, inventory:[{name:'demo'}],history:[{t:1}]});
    const a = s.applyDemoEvent({userId:901001,source:'demo_stars',reference:'demo:stars:invoice-1',delta:50});
    assert.equal(a.state.balance,150);
    assert.deepEqual(a.state.inventory,[{name:'demo'}]);
    assert.deepEqual(a.state.history,[{t:1}]);
    assert.equal(a.version,1);
    assert.equal(a.paidGameStakesAllowed,false);
    assert.equal(s.history(901001).length,1);
  } finally { s.close(); }
});

test('simulated channels share one balance, with replay protection and fixed-item spend', () => {
  const s = new ExistingGameBalanceSandbox();
  try {
    s.loadSyntheticAccount(901002);
    s.applyDemoEvent({userId:901002,source:'demo_stars',reference:'demo:stars:invoice-2',delta:100});
    s.applyDemoEvent({userId:901002,source:'demo_crypto',reference:'demo:crypto:invoice-2',delta:60});
    const repeat=s.applyDemoEvent({userId:901002,source:'demo_stars',reference:'demo:stars:invoice-2',delta:100});
    assert.equal(repeat.replayed,true);
    s.applyDemoEvent({userId:901002,source:'demo_fixed_purchase',reference:'demo:purchase:item-1',delta:-40});
    assert.equal(s.readAccount(901002).state.balance,120);
    assert.equal(s.history(901002).length,3);
    assert.throws(()=>s.applyDemoEvent({userId:901002,source:'demo_stars',reference:'demo:stars:invoice-2',delta:10}),/reference_conflict/);
  } finally { s.close(); }
});

test('rejects overdraw, real receipt references, and isolates synthetic users', () => {
  const s = new ExistingGameBalanceSandbox();
  try {
    s.loadSyntheticAccount(901003);
    s.loadSyntheticAccount(901004,{balance:20});
    assert.throws(()=>s.applyDemoEvent({userId:901003,source:'demo_fixed_purchase',reference:'demo:purchase:pricey',delta:-50}),/insufficient/);
    assert.throws(()=>s.applyDemoEvent({userId:901003,source:'real_stars',reference:'real:charge:abc123',delta:100}),/invalid_demo_event/);
    assert.equal(s.readAccount(901003).state.balance,0);
    assert.equal(s.readAccount(901004).state.balance,20);
  } finally { s.close(); }
});

test('refund simulation never creates spendable negative balances', () => {
  const s = new ExistingGameBalanceSandbox();
  try {
    s.loadSyntheticAccount(901005);
    s.applyDemoEvent({userId:901005,source:'demo_stars',reference:'demo:stars:invoice-5',delta:100});
    s.applyDemoEvent({userId:901005,source:'demo_fixed_purchase',reference:'demo:purchase:item-5',delta:-60});
    assert.throws(()=>s.applyDemoEvent({userId:901005,source:'demo_refund',reference:'demo:refund:invoice-5',delta:-100}),/insufficient/);
    assert.equal(s.readAccount(901005).state.balance,40);
    assert.equal(s.history(901005).length,2);
  } finally { s.close(); }
});
