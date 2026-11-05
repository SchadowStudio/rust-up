import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const ui=readFileSync(new URL('./stars-fixed-market-v3.js',import.meta.url),'utf8');

test('fixed Stars checkout UI exposes explicit buyer terms consent instead of implicit approval',()=>{
  assert.doesNotThrow(()=>new Function(ui));
  assert.match(ui,/view==='terms\/accept'/);
  assert.match(ui,/view!=='terms'/);
  assert.match(ui,/termsAccepted=false/);
  assert.match(ui,/data\.termsAccepted===true&&termsAccepted/);
  assert.match(ui,/input\.type='checkbox'/);
  assert.match(ui,/input\.addEventListener\('change'/);
  assert.match(ui,/confirm\.addEventListener\('click'/);
  assert.match(ui,/api\('terms\/accept'/);
  assert.match(ui,/await load\('catalog'\)/);
});

test('checkout UI cannot manufacture settlement and does not use untrusted HTML',()=>{
  assert.doesNotMatch(ui,/innerHTML|insertAdjacentHTML|eval\(/);
  assert.doesNotMatch(ui,/\/api\/game\/balance|\/api\/wallet\/credit/);
  assert.match(ui,/data\.creditToGame!==false/);
  assert.match(ui,/^\s*const initData=window\.Telegram\?\.WebApp\?\.initData;/m);
});
