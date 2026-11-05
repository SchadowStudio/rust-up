import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyPublicState,updateSupporterHtml,verifySupporterAssets}
 from './publish-supporter-badge-ui.mjs';
const oldHtml='<html><head>'+
 '<link href="css/stars-variable-wallet-v4.css?v=20261105variable4">'+
 '<script src="js/stars-variable-wallet-v4.js?v=20261105variable4h"></script>'+
 '</head></html>';
const oldHashes={
 'js/stars-variable-wallet-v4.js':'9b239ca4ccf23df27d7dd1e05bc015c5ded6a924',
 'css/stars-variable-wallet-v4.css':'dccf3011db15115f9d5cbd0611b4a76669c0828e',
 'index.html':'4b89602080049342f4d21e7276ef660830f1c7fd'
};
const JS='js/stars-variable-wallet-v4.js',CSS='css/stars-variable-wallet-v4.css';
test('safe publisher updates only current Stars JS and CSS cache keys',()=>{
 const result=updateSupporterHtml(oldHtml);
 assert.match(result,/20261105supporter1/g);
 assert.equal(result.includes('20261105variable4'),false);
 assert.equal(updateSupporterHtml(result),result);
 assert.throws(()=>updateSupporterHtml(oldHtml.replace('variable4h','unknown')),
  /unexpected_live_miniapp_cache_tag/);
 assert.throws(()=>updateSupporterHtml(oldHtml+oldHtml),
  /unexpected_live_miniapp_cache_tag/);
});
test('fail closed if any unrelated public file changed since review',()=>{
 const old={[JS]:'oldJs',[CSS]:'oldCss','index.html':oldHtml};
 const newer={[JS]:'newJs',[CSS]:'newCss',
  'index.html':updateSupporterHtml(oldHtml)};
 assert.equal(verifyPublicState(old,oldHashes,newer),'publish');
 assert.equal(verifyPublicState(newer,oldHashes,newer),'already_published');
 for(const file of Object.keys(oldHashes)){
  assert.throws(()=>verifyPublicState(old,
   {...oldHashes,[file]:'0000000000000000000000000000000000000000'},newer),
   /public_website_source_changed/);
 }
});
test('reviewed badge JS validates, stays read-only, and never enables paid cases',()=>{
 const js=readFileSync(new URL('../frontend/telegram-miniapp/stars-variable-wallet-v4.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../frontend/telegram-miniapp/stars-variable-wallet-v4.css',import.meta.url),'utf8');
 assert.equal(verifySupporterAssets(js,css),true);
 assert.match(js,/if\(e\?\.status===401\).*Не удалось подтвердить вход/);
 assert.match(js,/payButton\.disabled=true/);
 assert.equal(js.includes('creditedToGame:true'),false);
 assert.equal(js.includes('enablePayments('),false);
 assert.throws(()=>verifySupporterAssets(js.replace(
  'payButton.disabled=data.checkoutEnabled!==true','payButton.disabled=false'),css),
  /supporter_asset_feature_missing/);
});
