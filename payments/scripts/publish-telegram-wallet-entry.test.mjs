import test from 'node:test';
import assert from 'node:assert/strict';
import {patchApp,patchIndex} from './publish-telegram-wallet-entry.mjs';

const appFixture = [
  "const DEP_METHODS = [",
  "    ['gifts', 'Telegram и CS2', 10, 7, ['star', 'gift'], 'Звёзды, подарки, скины', ['Звёзды Telegram', 'Подарки и NFT', 'Скины CS2']]",
  "];",
  "  function walletDeposit() {",
  "    const m = DEP_METHODS.find(x => x[0] === WF.dep);",
  "    return '<div>legacy</div>';",
  "  }",
  "  if ('wpay' in d || 'wsend' in d) { }",
].join('\n');

test('patches the existing Telegram/CS2 wallet entry without enabling payment',()=>{
  const result=patchApp(appFixture);
  assert.match(result,/RUSTUP_TELEGRAM_ONLY_WALLET_NOTICE_V1/);
  assert.match(result,/Telegram Stars/);
  assert.match(result,/Платежи пока отключены/);
  assert.doesNotMatch(result,/Telegram и CS2', 10, 7/);
  assert.doesNotMatch(result,/createInvoiceLink|\/api\/stars\/checkout/);
  assert.equal(patchApp(result),result);
  assert.doesNotThrow(()=>new Function(result));
});

test('preserves CRLF and other website features',()=>{
  const crlf=appFixture.replace(/\n/g,'\r\n');
  const patched=patchApp(crlf);
  assert.match(patched,/\r\n/);
  assert.equal(patched.includes("return '<div>legacy</div>';"),true);
  assert.equal(patched.includes("if ('wpay' in d || 'wsend' in d)"),true);
});

test('refuses changed upstream structure rather than guessing',()=>{
  assert.throws(()=>patchApp('function walletDeposit() {}'),/version_drift/);
  assert.throws(()=>patchApp('unrelated source'),/not_expected/);
});

test('bumps only Mini App app.js cache version once',()=>{
  const html='<script src="https://telegram.org/js/telegram-web-app.js"></script>'+
    '<script src="js/app.js?v=20261105v"></script>';
  const updated=patchIndex(html);
  assert.match(updated,/app\.js\?v=20261105v-tgonly1/);
  assert.equal(patchIndex(updated),updated);
  assert.throws(()=>patchIndex('<html></html>'),/not_expected_telegram_webapp/);
});
