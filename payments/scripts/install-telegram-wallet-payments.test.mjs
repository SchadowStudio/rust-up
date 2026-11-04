import test from 'node:test';
import assert from 'node:assert/strict';
import {patchExistingWallet,patchExistingIndex} from './install-telegram-wallet-payments.mjs';

const original="['gifts', 'Telegram и CS2', 10, 7, ['star', 'gift'], 'Звёзды, подарки, скины', ['Звёзды Telegram', 'Подарки и NFT', 'Скины CS2']]";
const render="    box.innerHTML = WF.tab === 'withdraw' ? walletWithdraw() : WF.tab === 'history' ? walletHistory() : walletDeposit();";
const query="    if (+params.get('sum') > 0) WF.amount = Math.floor(+params.get('sum'));";
const app=[original,render,query].join('\r\n');
test('existing Mini App wallet displays embedded Telegram Stars and blocks in-app crypto',()=>{
 const patched=patchExistingWallet(app);
 assert.match(patched,/Telegram Stars/);
 assert.doesNotMatch(patched,/Telegram и CS2/);
 assert.match(patched,/rustupStarsBody/);
 assert.match(patched,/Криптоплатежи здесь отключены/);
 assert.match(patched,/method.*stars/);
 assert.match(patched,/RUSTUP_STARS_WALLET_EMBED_V1/);
 assert.throws(()=>patchExistingWallet(patched),/already_integrated/);
});
test('source changes and duplicate anchors are rejected',()=>{
 assert.throws(()=>patchExistingWallet(app.replace(render,'')),/unexpected_existing_app_layout/);
 assert.throws(()=>patchExistingWallet(app+original),/unexpected_existing_app_layout/);
});
test('assets are loaded before the original App without replacing it',()=>{
 const html=[
  '<link rel="stylesheet" href="css/style.css?v=20261105t">',
  '<script src="js/app.js?v=20261105t"></script>'
 ].join('\n');
 const result=patchExistingIndex(html);
 assert.ok(result.indexOf('wallet-stars-panel.js')<result.indexOf('js/app.js?v='));
 assert.match(result,/wallet-stars-panel.css/);
 assert.throws(()=>patchExistingIndex(result),/already_integrated/);
});
