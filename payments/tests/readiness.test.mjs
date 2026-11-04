import test from 'node:test';
import assert from 'node:assert/strict';
import {readiness} from '../src/readiness.js';

const configured=()=>({
 CRYPTO_PAYMENTS_ENABLED:'true',CRYPTO_AUTO_SCAN_ENABLED:'true',
 GAME_LEDGER_DELIVERY_ENABLED:'true',
 GAME_LEDGER_SIGNING_KEY:'x'.repeat(64),
 GAME_LEDGER_WEBHOOK_URL:'https://trusted-game-ledger.example/internal/credit',
 TG_BOT_TOKEN:'123:FAKE_TEST_TOKEN',DB:{},OPERATOR_API_KEY:'x'.repeat(64),
 OWNER_APPROVED_PRODUCTION:'true'
});
test('no user deposit is accepted with blank deployment settings',()=>{
 const state=readiness({});
 assert.equal(state.ready,false);
 assert.equal(state.missing.length,9);
});
test('all independent dependencies are required before checkout',()=>{
 assert.equal(readiness(configured()).ready,true);
 for(const key of Object.keys(configured())){
  const env=configured();delete env[key];
  assert.equal(readiness(env).ready,false,'Must reject missing '+key);
 }
});
test('owner explicitly controls production launch',()=>{
 const env=configured();env.OWNER_APPROVED_PRODUCTION='false';
 assert.equal(readiness(env).ready,false);
 assert.ok(readiness(env).missing.includes('ownerProductionApproval'));
});
