import test from 'node:test';
import assert from 'node:assert/strict';
import {readiness} from '../src/readiness.js';

const configured=()=>({
 CRYPTO_PAYMENTS_ENABLED:'true',CRYPTO_AUTO_SCAN_ENABLED:'true',
 GAME_LEDGER_DELIVERY_ENABLED:'true',
 GAME_LEDGER_SIGNING_KEY:'x'.repeat(64),
 GAME_LEDGER_WEBHOOK_URL:'https://trusted-game-ledger.example/internal/credit',
 TG_BOT_TOKEN:'123:FAKE_TEST_TOKEN',DB:{},OPERATOR_API_KEY:'x'.repeat(64),
 ETHEREUM_RPC_URL:'https://ethereum.example/rpc',
 ETHEREUM_START_BLOCK:'23000000',
 BITCOIN_RPC_URL:'https://bitcoin.example/wallet/watchonly',
 BITCOIN_RPC_BASIC_B64:'x'.repeat(64),
 BITCOIN_START_BLOCKHASH:'a'.repeat(64),
 TRON_RPC_URL:'https://tron.example',
 TRON_INDEXER_URL:'https://trongrid.example',
 USDT_ERC20_CONTRACT:'0x'+'a'.repeat(40),
 USDT_TRC20_CONTRACT:'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
 ALLOWED_ORIGIN:'https://checkout.example',
 OPERATOR_ORIGIN:'https://admin.example',
 OWNER_APPROVED_PRODUCTION:'true'
});
test('no user deposit is accepted with blank deployment settings',()=>{
 const state=readiness({});
 assert.equal(state.ready,false);
 assert.ok(state.missing.length>=9);
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
