import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {patchApp,patchIndex} from './publish-telegram-stars-readonly-v2.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const bridge=fs.readFileSync(path.join(root,'frontend','telegram-miniapp','stars-readonly-v2.js'),'utf8');
const sampleApp=[
  '/* RUSTUP_TELEGRAM_ONLY_WALLET_NOTICE_V1 */',
  'function renderWallet() {',
  "    box.innerHTML = WF.tab === 'withdraw' ? walletWithdraw() : WF.tab === 'history' ? walletHistory() : walletDeposit();",
  '}',
].join('\n');
const sampleIndex=[
  '<script src="https://telegram.org/js/telegram-web-app.js"></script>',
  '<link rel="stylesheet" href="css/style.css?v=20261105v">',
  '<script src="js/app.js?v=20261105v-tgonly1"></script>',
].join('\n');

test('integrates read-only Telegram Stars panel with original wallet, preserving CRLF',()=>{
  const patched=patchApp(sampleApp.replace(/\n/g,'\r\n'));
  assert.match(patched,/RUSTUP_STARS_READONLY_V2_MOUNT/);
  assert.match(patched,/window\.RUSTUP_STARS_READONLY_V2\?\.render\(box\)/);
  assert.match(patched,/\r\n/);
  assert.doesNotThrow(()=>new Function(patched));
  assert.equal(patchApp(patched),patched);
});

test('cache-busts app and includes only new catalogue assets',()=>{
  const patched=patchIndex(sampleIndex);
  assert.match(patched,/stars-readonly-v2\.css\?v=20261105s2/);
  assert.match(patched,/stars-readonly-v2\.js\?v=20261105s2/);
  assert.match(patched,/app\.js\?v=20261105v-tgonly1-starsv2/);
  assert.equal(patchIndex(patched),patched);
});

test('fails closed for unrelated game websites',()=>{
  assert.throws(()=>patchApp('some unrelated code'),/stars_wallet_tile_missing/);
  assert.throws(()=>patchIndex('<html>not telegram</html>'),/not_telegram_miniapp/);
});

test('read-only client has no invoice, game credit or unsafe innerHTML injection',()=>{
  assert.doesNotThrow(()=>new Function(bridge));
  assert.match(bridge,/\/api\/stars\//);
  assert.match(bridge,/Telegram\?\.WebApp\?\.initData/);
  assert.doesNotMatch(bridge,/\/api\/stars\/checkout|createInvoiceLink\(|openInvoice\(|state\.balance\s*=|innerHTML\s*=/i);
  assert.match(bridge,/AbortController/);
  assert.match(bridge,/Покупки пока отключены/);
});
