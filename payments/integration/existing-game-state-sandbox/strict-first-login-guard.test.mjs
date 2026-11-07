import test from 'node:test';
import assert from 'node:assert/strict';
import {patchGameInitialImport,sanitizedNewAccountImport}
  from './strict-first-login-guard.mjs';

function sampleGame(){
  return [
    '// RUST UP game server source fixture (only the targeted section matters)',
    'async function importState(local, tgUser) {}',
    'async function handleLoad(env,body,user) {',
    '  if (!(await hasAccount(env,user.id))) {',
    '      const s = await importState(body.local, user);',
    '      await env.DB.prepare("INSERT OR IGNORE INTO accounts (id, state, v, created, updated) VALUES (?, ?, 0, ?, ?)").run();',
    '  }',
    '}',
    '/* '+ 'unrelated game logic '.repeat(300) +' */'
  ].join('\n');
}
test('strict mode drops forged first-login currency and noncosmetic rewards',()=>{
 const attacker={balance:999999999,inventory:[{name:'rare'}],rewards:{cashback:999},user:{name:'Alice'}};
 const protectedInput=sanitizedNewAccountImport(attacker,true);
 assert.equal(protectedInput.balance,undefined);
 assert.equal(protectedInput.inventory,undefined);
 assert.equal(protectedInput.rewards,undefined);
 assert.deepEqual(protectedInput.user,{name:'Alice'});
 assert.deepEqual(sanitizedNewAccountImport(attacker,false),attacker);
});
test('patch changes only exact first-load import and is idempotent',()=>{
 const original=sampleGame();
 const fixed=patchGameInitialImport(original);
 assert.match(fixed,/RUSTUP_STRICT_ACCOUNT_IMPORT_V1/);
 assert.match(fixed,/env\.PAYMENT_WALLET_STRICT_MODE === 'true'/);
 assert.match(fixed,/importState\(safeLocal, user\)/);
 assert.equal(patchGameInitialImport(fixed),fixed);
 assert.equal(
   fixed.replace(/      \/\/ RUSTUP_STRICT_ACCOUNT_IMPORT_V1:[\s\S]*?      const s = await importState\(safeLocal, user\);/,
      '      const s = await importState(body.local, user);'),
   original
 );
});
test('protects original Windows line endings',()=>{
 const old=sampleGame().replace(/\n/g,'\r\n');
 const updated=patchGameInitialImport(old);
 assert.match(updated,/\r\n/);
 assert.match(updated,/strictPaidAccount/);
});
test('fails closed on unknown or doubled source, no broad replace',()=>{
 assert.throws(()=>patchGameInitialImport('unrelated'),/unexpected_rustup_game_source/);
 const original=sampleGame();
 assert.throws(()=>patchGameInitialImport(original+
   '\n      const s = await importState(body.local, user);'),/unsafe_game_source_drift/);
});
