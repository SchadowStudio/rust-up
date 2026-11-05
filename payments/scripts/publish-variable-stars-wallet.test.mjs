import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {patchVariableWalletApp,patchVariableWalletHtml}
 from './publish-variable-stars-wallet.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','frontend','telegram-miniapp');
const script=fs.readFileSync(path.join(ROOT,'stars-variable-wallet-v4.js'),'utf8');
const app=[
  '/* RUSTUP_STARS_READONLY_V2_MOUNT */',
  'window.RUSTUP_STARS_FIXED_MARKET_V3?.render(box);'
].join('\n');
const html=[
  '<script src="https://telegram.org/js/telegram-web-app.js"></script>',
  '<link rel="stylesheet" href="css/stars-fixed-market-v3.css?v=20261105market3">',
  '<script src="js/stars-fixed-market-v3.js?v=20261105market3"></script>',
  '<script src="js/app.js?v=20261105v-tgonly1-starsv2-market3"></script>'
].join('\n');
test('replaces fixed products by custom amount in existing wallet only',()=>{
 const changed=patchVariableWalletApp(app);
 assert.match(changed,/RUSTUP_STARS_VARIABLE_V4/);
 assert.doesNotMatch(changed,/RUSTUP_STARS_FIXED_MARKET_V3\?/);
 assert.equal(patchVariableWalletApp(changed),changed);
});
test('updates current Mini App assets and cache without extra store',()=>{
 const changed=patchVariableWalletHtml(html);
 assert.match(changed,/stars-variable-wallet-v4\.js\?v=20261105variable4/);
 assert.match(changed,/stars-variable-wallet-v4\.css\?v=20261105variable4/);
 assert.doesNotMatch(changed,/src="js\/stars-fixed-market-v3\.js/);
 assert.equal(patchVariableWalletHtml(changed),changed);
});
test('rejects unrelated or unexpected wallet source',()=>{
 assert.throws(()=>patchVariableWalletApp('unrelated'),/existing_wallet_mount_missing/);
 assert.throws(()=>patchVariableWalletHtml('unrelated'),/existing_telegram_mini_app_missing/);
});
test('accepts arbitrary human-entered RUB amount, not selectable products',()=>{
 assert.doesNotThrow(()=>new Function(script));
 assert.match(script,/input\.addEventListener\('input',reset\)/);
 assert.match(script,/parseAmountMinor/);
 assert.match(script,/\/api\/stars\/variable\//);
 assert.doesNotMatch(script,/data\.products|sku|fixed_nontransferable/);
 assert.match(script,/request\('quote'/);
 assert.match(script,/request\('checkout'/);
});
