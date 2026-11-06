import test from 'node:test';
import assert from 'node:assert/strict';
import {patchCurrentWalletApp,patchCurrentWalletHtml}
 from './prepare-current-deposit-wallet.mjs';

const oldMethod="['gifts', 'Telegram и CS2', 10, 7, ['star', 'gift'], 'Звёзды, подарки, скины', ['Звёзды Telegram', 'Подарки и NFT', 'Скины CS2']]";
const oldRender="    box.innerHTML = WF.tab === 'withdraw' ? walletWithdraw() : WF.tab === 'history' ? walletHistory() : walletDeposit();";
const app=()=>['function renderWallet() {',oldRender,'}',
 'function walletDeposit() {}',
 "if ('wpay' in d || 'wsend' in d) {}",
 oldMethod,' '.repeat(31000)].join('\r\n');
const html=()=>['<html><head>',
 '<link rel="stylesheet" href="css/style.css?v=20261106i">',
 '</head><body>Демо-режим · виртуальный баланс',
 '<script src="js/app.js?v=20261106i"></script>',
 '</body></html>',' '.repeat(4100)].join('\n');

test('current wallet gains one Telegram Stars-only readout without changing withdrawals',()=>{
 const patched=patchCurrentWalletApp(app());
 assert.match(patched,/RUSTUP_STARS_VARIABLE_V4\.render\(box\)/);
 assert.match(patched,/WF\.tab === 'deposit' && WF\.dep === 'gifts'/);
 assert.match(patched,/const demoForm = box\.querySelector/);
 assert.match(patched,/Telegram Stars/);
 assert.doesNotMatch(patched,/Telegram и CS2/);
 assert.match(patched,/if \('wpay' in d \|\| 'wsend' in d\)/);
 assert.equal(patched.split('function walletDeposit()').length,2);
 assert.equal(patched.includes('\r\n'),true);
 assert.throws(()=>patchCurrentWalletApp(patched),/already_applied|changed/);
});

test('version-guarded site patch loads deposit CSS and JS before current app',()=>{
 const patched=patchCurrentWalletHtml(html());
 const script='js/stars-deposit-v5.js?v=20261106depositstatus1';
 const css='css/stars-deposit-v5.css?v=20261106depositstatus1';
 assert.ok(patched.includes(script));
 assert.ok(patched.includes(css));
 assert.ok(patched.indexOf(script)<patched.indexOf('js/app.js?v=20261106i'));
 assert.throws(()=>patchCurrentWalletHtml(patched),/already_applied|changed/);
});

test('site version or wallet design drift fails closed',()=>{
 assert.throws(()=>patchCurrentWalletApp(app().replace(oldMethod,'unknown method')),
  /changed|unrecognized/);
 assert.throws(()=>patchCurrentWalletHtml(html().replace('20261106i','later')),
  /changed|unrecognized/);
 assert.throws(()=>patchCurrentWalletApp(app().replace('function walletDeposit()','function replacedWallet()')),
  /unrecognized/);
});
