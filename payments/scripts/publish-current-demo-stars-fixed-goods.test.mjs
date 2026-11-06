import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {patchCurrentWalletApp,patchCurrentWalletHtml,validateFixedGoodsModule}
 from './publish-current-demo-stars-fixed-goods.mjs';

const appAnchor="box.innerHTML = WF.tab === 'withdraw' ? walletWithdraw() : WF.tab === 'history' ? walletHistory() : walletDeposit();";
const originalGuard="if ('wpay' in d || 'wsend' in d) { haptic('warning'); return toast(NOT_YET, 'error'); }";
const app=()=>[
 "/* front-end demo */",
 "const STORE_KEY = 'rustup_demo_v1';",
 "const gameReady = false;",
 "const RUSTUP_API = window.RUSTUP_API;",
 "api('load', { local });",
 "gameReady = true;",
 "function renderWallet() {",
 "  "+appAnchor,
 "}",
 originalGuard,
 "x".repeat(51000)
].join('\r\n');
const html=()=>[
 '<!DOCTYPE html><html><head>',
 '<link rel="stylesheet" href="css/style.css?v=20261106d">',
 '<script src="https://telegram.org/js/telegram-web-app.js"></script>',
 '</head><body><div>Демо-режим · виртуальный баланс</div>',
 '<script src="js/app.js?v=20261106d"></script>',
 '</body></html>'
].join('\n');
test('current server-backed demo wallet gets one independent fixed-goods panel',()=>{
 const result=patchCurrentWalletApp(app());
 assert.match(result,/WF\.tab === 'deposit' && window\.RUSTUP_STARS_FIXED_MARKET_V3/);
 assert.match(result,/document\.createElement\('section'\)/);
 assert.match(result,/RUSTUP_STARS_FIXED_MARKET_V3\.render\(box\)/);
 assert.match(result,/api\('load', \{ local \}\)/);
 assert.match(result,/gameReady = true;/);
 assert.match(result,/rustup_demo_v1/);
 assert.match(result,/return toast\(NOT_YET, 'error'\)/);
 assert.equal(patchCurrentWalletApp(result),result);
});
test('existing offline/demo deposits cannot be converted into game paid coins',()=>{
 for(const unsafe of [
  app().replace(originalGuard,'// modified deposit guard'),
  app().replace("api('load', { local });",''),
  app().replace("const STORE_KEY = 'rustup_demo_v1';",''),
  app().replace('gameReady = true;','')
 ])assert.throws(()=>patchCurrentWalletApp(unsafe),/version_mismatch|missing|changed/);
 assert.throws(()=>patchCurrentWalletApp(app().replace(appAnchor,'deleted')),
  /version_mismatch/);
});
test('current 2026-11-06 website receives only fixed Stars assets, not game credits',()=>{
 const result=patchCurrentWalletHtml(html());
 assert.match(result,/stars-fixed-market-v3\.css\?v=20261106fixed1/);
 assert.match(result,/stars-fixed-market-v3\.js\?v=20261106fixed1/);
 assert.match(result,/Демо-режим · виртуальный баланс/);
 assert.equal(patchCurrentWalletHtml(result),result);
 for(const version of ['20261106d','20261106e','20261106f']){
  const changed=html().replaceAll('20261106d',version);
  const patched=patchCurrentWalletHtml(changed);
  assert.ok(patched.includes('js/stars-fixed-market-v3.js?v=20261106fixed1'));
  assert.ok(patched.includes('js/app.js?v='+version));
  assert.ok(patched.includes('css/style.css?v='+version));
 }
 assert.throws(()=>patchCurrentWalletHtml(html().replace(
  'js/app.js?v=20261106d','js/app.js?v=unknown')),/version_changed/);
 assert.throws(()=>patchCurrentWalletHtml(html().replace(
  'css/style.css?v=20261106d','css/style.css?v=unknown')),/version_changed/);
});
test('shop module still requires signed Telegram initData, terms and server checkout gate',()=>{
 const js=readFileSync(new URL('../frontend/telegram-miniapp/stars-fixed-market-v3.js',
  import.meta.url),'utf8');
 const css=readFileSync(new URL('../frontend/telegram-miniapp/stars-fixed-market-v3.css',
  import.meta.url),'utf8');
 assert.equal(validateFixedGoodsModule(js,css),true);
 assert.match(js,/data\.checkoutEnabled===true/);
 assert.match(js,/data\.termsAccepted===true&&termsAccepted/);
 assert.match(js,/data\.creditToGame!==false/);
 assert.doesNotMatch(js,/\/api\/game\/balance|\/api\/wallet\/credit/);
 assert.throws(()=>validateFixedGoodsModule(js.replace(
  'data.creditToGame!==false','true'),css),/hard_gates_missing/);
});
