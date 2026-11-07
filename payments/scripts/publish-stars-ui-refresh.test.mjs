import test from 'node:test';
import assert from 'node:assert/strict';
import {patchStarsHtml,validateNewStarsUi} from './publish-stars-ui-refresh.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../frontend/telegram-miniapp');
const content=fs.readFileSync(path.join(root,'stars-variable-wallet-v4.js'),'utf8');

test('the new Stars UI syntax is valid and payment history is localized',()=>{
 assert.equal(validateNewStarsUi(content),true);
 assert.match(content,/request\('history'/);
 assert.match(content,/historyBusy/);
 assert.match(content,/rate|conversion_not_configured/);
});
test('cache bust only updates Stars source and preserves other site tags',()=>{
 const old=[
  '<script src="js/stars-variable-wallet-v4.js?v=20261105variable4"></script>',
  '<script src="js/app.js?v=20261105v-tgonly1-starsv2-market3-variable4"></script>'
 ].join('\n');
 const newer=patchStarsHtml(old);
 assert.match(newer,/stars-variable-wallet-v4\.js\?v=20261105variable4h/);
 assert.match(newer,/app\.js\?v=20261105v-tgonly1-starsv2-market3-variable4/);
 assert.equal(patchStarsHtml(newer),newer);
});
test('do not silently replace changed websites or other JavaScript',()=>{
 assert.throws(()=>patchStarsHtml('stale content'),/unexpected_live_stars_script_version/);
 assert.throws(()=>validateNewStarsUi('unrelated'),/invalid_stars_ui_source/);
});
