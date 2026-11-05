import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const js=readFileSync(new URL('./stars-variable-wallet-v4.js',import.meta.url),'utf8');
const css=readFileSync(new URL('./stars-variable-wallet-v4.css',import.meta.url),'utf8');
test('supporter badge adds only an authenticated read-only API check',()=>{
 assert.doesNotThrow(()=>new Function(js));
 assert.match(js,/\/api\/stars\/supporter-badge/);
 assert.match(js,/initData:auth|JSON\.stringify\(\{initData\}\)/);
 assert.match(js,/method:'POST'/);
 assert.match(js,/credentials:'omit'/);
 assert.match(js,/Проверить мой значок/);
 assert.match(js,/result\.active/);
 assert.match(css,/rustup-supporter-status/);
});
test('supporter badge client cannot transfer credits, wager or make a badge purchase',()=>{
 const part=js.slice(js.indexOf('async function supporterStatus'),js.indexOf(' function render(wallet)'));
 assert.ok(part.length>300);
 assert.equal(/\/api\/game|\/api\/wallet|\/api\/stars\/checkout/.test(part),false);
 assert.equal(/innerHTML|insertAdjacentHTML|eval\(/.test(part),false);
 assert.ok(part.includes('transferable!==false'));
 assert.ok(part.includes('redeemable!==false'));
 assert.ok(part.includes('usableForWagers!==false'));
});
