import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {patchDepositHtml,verifyDepositAssets}
 from './publish-rustup-deposit-wallet.mjs';
const oldScript=[
 '  <script>',
 '    // Telegram Mini App: Telegram passes tgWebAppData in the URL; only then load its SDK (keeps offline/browser use fast)',
 '    (function () {',
 '      var tg = /tgWebApp/.test(location.hash + location.search);',
 "      try { if (tg) sessionStorage.setItem('rustup_tg', '1'); else tg = sessionStorage.getItem('rustup_tg') === '1'; } catch (e) {}",
 "      if (tg) document.write('<script src=\"https://telegram.org/js/telegram-web-app.js\"><\\/script>');",
 '    })();',
 '  </script>'
].join('\n');
const sample='<html><head>\n'+oldScript+'\n'+
 '<link rel="stylesheet" href="css/stars-variable-wallet-v4.css?v=20261105supporter1">\n'+
 '<script src="js/stars-variable-wallet-v4.js?v=20261105supporter1"></script>\n'+
 '<script src="js/app.js?v=test"></script>\n</head></html>';
const js=readFileSync(new URL('../frontend/telegram-miniapp/stars-deposit-v5.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../frontend/telegram-miniapp/stars-deposit-v5.css',import.meta.url),'utf8');
test('existing Mini App receives clean deposit assets and correct Telegram bootstrap',()=>{
 const next=patchDepositHtml(sample);
 assert.ok(next.includes('telegram-web-app.js?64'));
 assert.ok(next.includes('stars-deposit-v5.js?v=20261105deposit1'));
 assert.ok(next.includes('stars-deposit-v5.css?v=20261105deposit1'));
 assert.equal(next.includes('sessionStorage.setItem'),false);
 assert.equal(next.includes('stars-variable-wallet-v4.css'),false);
 assert.ok(next.indexOf('telegram-web-app.js?64')<next.indexOf('js/app.js?'));
 assert.equal(patchDepositHtml(next),next);
});
test('unexpected page versions or app scripts are never blindly overwritten',()=>{
 assert.throws(()=>patchDepositHtml(sample.replace('supporter1','other')),
  /unexpected_public_site_change/);
 assert.throws(()=>patchDepositHtml(sample.replace('var tg =','const tg =')),
  /unexpected_public_site_change/);
});
test('clean wallet keeps arbitrary RUB amount, real invoice gates, and does not display Supporter',()=>{
 assert.equal(verifyDepositAssets(js,css),true);
 assert.throws(()=>verifyDepositAssets(js,css+'\n'),/deposit_css_trailing_blank_line/);
 assert.doesNotMatch(js,/rustup-supporter-status|supporter-badge/);
 assert.doesNotMatch(css,/rustup-supporter-status/);
 assert.match(js,/payButton.disabled=data.checkoutEnabled!==true/);
 assert.match(js,/creditedToGame!==false/);
 assert.throws(()=>verifyDepositAssets(js.replace(
  'payButton.disabled=data.checkoutEnabled!==true','payButton.disabled=false'),css),
  /required_deposit_safety_marker_missing/);
});

test('deposit panel separates paid Telegram notice from proof of game credit',()=>{
 assert.match(js,/payment_confirmed_credit_pending/);
 assert.match(js,/credited_to_game/);
 assert.match(js,/refund_reversal_pending/);
 assert.match(js,/refund_reversed/);
 assert.match(js,/order\.creditState/);
 assert.match(js,/order\.creditedToGame===true/);
 assert.match(js,/if\(!historyButton\.disabled\)historyButton\.click\(\)/);
 assert.doesNotMatch(js,/balance\s*(?:\+\+|\+=|=\s*balance\s*\+)/);
 assert.doesNotMatch(js,/innerHTML\s*=/);
});
