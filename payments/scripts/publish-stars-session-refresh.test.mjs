import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {patchSessionAsset,patchSessionIndex} from './publish-stars-session-refresh.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const current=fs.readFileSync(path.join(root,'frontend','telegram-miniapp','stars-readonly-v2.js'),'utf8');
const fresh=[
 '    // Let the server validate auth_date and the Telegram HMAC signature.',
 '    // Browser clocks may be wrong and this Mini App can stay open for hours.',
 '    // Read-only server endpoints enforce a bounded TTL; payment gates stay OFF.'
].join('\n')+'\n';
const previous=[
 "    const authDate=Number(new URLSearchParams(initData).get('auth_date'));",
 '    const now=Math.floor(Date.now()/1000);',
 '    // Server accepts at most 600 seconds and up to 60 seconds future skew.',
 '    if(!Number.isSafeInteger(authDate)||authDate<now-600||authDate>now+60)',
 "      throw {code:'expired'};"
].join('\n')+'\n';
test('old Stars JS updates without a new client-side time gate',()=>{
 const old=current.replace(fresh,previous);
 assert.notEqual(old,current);
 const patched=patchSessionAsset(old,current);
 assert.equal(patched,current);
 assert.doesNotThrow(()=>new Function(patched));
 assert.equal(patchSessionAsset(patched,current),patched);
 assert.doesNotMatch(patched,/authDate<now-600/);
});
test('preserves CRLF in user website clone',()=>{
 const old=current.replace(fresh,previous).replace(/\n/g,'\r\n');
 const patch=patchSessionAsset(old,current);
 assert.match(patch,/\r\n/);
 assert.equal(patch.replace(/\r\n/g,'\n'),current);
});
test('does not overwrite a different or unexpected website JS',()=>{
 assert.throws(()=>patchSessionAsset('unrelated',current),/website_stars_js_drift/);
});
test('changes only Stars script cache key and is idempotent',()=>{
 const old='<script src="js/stars-readonly-v2.js?v=20261105s2"></script>\n'+
 '<script src="js/app.js?v=20261105v-tgonly1-starsv2"></script>';
 const result=patchSessionIndex(old);
 assert.match(result,/stars-readonly-v2\.js\?v=20261105s3/);
 assert.match(result,/app\.js\?v=20261105v-tgonly1-starsv2/);
 assert.equal(patchSessionIndex(result),result);
});
