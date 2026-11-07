import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {patchFrontendApp,patchFrontendHtml} from './publish-stars-fixed-market-v3.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','frontend','telegram-miniapp');
const js=fs.readFileSync(path.join(root,'stars-fixed-market-v3.js'),'utf8');
const oldMount='window.RUSTUP_STARS_READONLY_V2?.render(box)';
const newMount='window.RUSTUP_STARS_FIXED_MARKET_V3?.render(box)';
const app=[
 '/* RUSTUP_STARS_READONLY_V2_MOUNT */',
 "    if (WF.tab === 'deposit' && WF.dep === 'gifts')",
 '      '+oldMount+';'
].join('\n');
const html=[
 '<script src="https://telegram.org/js/telegram-web-app.js"></script>',
 '<link rel="stylesheet" href="css/stars-readonly-v2.css?v=20261105s2">',
 '<script src="js/stars-readonly-v2.js?v=20261105s3"></script>',
 '<script src="js/app.js?v=20261105v-tgonly1-starsv2"></script>'
].join('\n');

test('updates only existing Stars mount, leaving game wallet rendering intact',()=>{
 const updated=patchFrontendApp(app);
 assert.match(updated,/RUSTUP_STARS_FIXED_MARKET_V3/);
 assert.doesNotMatch(updated,/window.RUSTUP_STARS_READONLY_V2\?/);
 assert.equal(patchFrontendApp(updated),updated);
});
test('loads new asset, removes old UI JS and updates CSS and app cache key',()=>{
 const fixed=patchFrontendHtml(html);
 assert.match(fixed,/stars-fixed-market-v3\.js\?v=20261105market3/);
 assert.match(fixed,/stars-fixed-market-v3\.css\?v=20261105market3/);
 assert.doesNotMatch(fixed,/src="js\/stars-readonly-v2\.js\?/);
 assert.match(fixed,/app\.js\?v=20261105v-tgonly1-starsv2-market3/);
 assert.equal(patchFrontendHtml(fixed),fixed);
});
test('refuses unexpected frontend versions instead of overwriting newer features',()=>{
 assert.throws(()=>patchFrontendApp('unrelated app'),/current_wallet_mount_missing/);
 assert.throws(()=>patchFrontendHtml('unrelated html'),/current_telegram_miniapp_html_missing/);
});
test('buy action requires confirmed backend enablement and Telegram native invoice',()=>{
 assert.doesNotThrow(()=>new Function(js));
 assert.match(js,/data\.checkoutEnabled===true/);
 assert.match(js,/data\.creditToGame!==false/);
 assert.match(js,/WebApp\?\.openInvoice/);
 assert.match(js,/window\.Telegram\.WebApp\.openInvoice/);
 assert.match(js,/^ *const trustedInvoiceUrl/m);
 assert.match(js,/^ *if\(view==='checkout'/m);
 assert.doesNotMatch(js,/createInvoiceLink|state\.balance\s*=/);
});
