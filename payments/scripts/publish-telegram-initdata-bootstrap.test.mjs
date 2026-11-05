import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {patchTelegramHtml,verifyClient} from './publish-telegram-initdata-bootstrap.mjs';

const HTML=[
 '<html><head>',
 '  <script>',
 '    // Telegram Mini App: Telegram passes tgWebAppData in the URL; only then load its SDK (keeps offline/browser use fast)',
 '    (function () {',
 "      var tg = /tgWebApp/.test(location.hash + location.search);",
 "      try { if (tg) sessionStorage.setItem('rustup_tg', '1'); else tg = sessionStorage.getItem('rustup_tg') === '1'; } catch (e) {}",
 "      if (tg) document.write('<script src=\"https://telegram.org/js/telegram-web-app.js\"><\\/script>');",
 '    })();',
 '  </script>',
 '</head><body><script src="js/stars-variable-wallet-v4.js?v=20261105supporter1"></script>',
 '<script src="js/app.js?v=safe"></script></body></html>'
].join('\n');
test('official SDK is loaded before app even when launch data not in URL',()=>{
 const updated=patchTelegramHtml(HTML);
 assert.match(updated,/<script src="https:\/\/telegram\.org\/js\/telegram-web-app\.js\?64"><\/script>/);
 assert.equal(updated.includes('sessionStorage.setItem'),false);
 assert.equal(updated.includes('document.write'),false);
 assert.ok(updated.indexOf('telegram-web-app.js?64')<updated.indexOf('js/app.js?'));
 assert.ok(updated.includes('20261105telegramauth2'));
 assert.equal(patchTelegramHtml(updated),updated);
});
test('unexpected altered site is refused rather than silently patched',()=>{
 assert.throws(()=>patchTelegramHtml(HTML.replace('var tg =','const tg =')),
  /unreviewed_telegram_sdk_or_cache_version/);
 assert.throws(()=>patchTelegramHtml(HTML.replace('20261105supporter1','unknown')),
  /unreviewed_telegram_sdk_or_cache_version/);
 assert.throws(()=>patchTelegramHtml('bad input'),
  /unreviewed_telegram_sdk_or_cache_version/);
});
test('the patched Stars UI distinguishes absent initData from server rejection',()=>{
 const src=readFileSync(new URL('../frontend/telegram-miniapp/stars-variable-wallet-v4.js',import.meta.url),'utf8');
 assert.equal(verifyClient(src),true);
 assert.match(src,/Telegram не передал данные авторизации/);
 assert.match(src,/Сервер не подтвердил Telegram-сессию/);
 assert.doesNotMatch(src,/initDataUnsafe/);
});
