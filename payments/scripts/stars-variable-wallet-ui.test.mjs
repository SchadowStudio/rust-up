import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../frontend/telegram-miniapp');
const source=fs.readFileSync(path.join(base,'stars-variable-wallet-v4.js'),'utf8');
function createModule(){
 const context={window:{}};
 vm.runInNewContext(source,context,{filename:'stars-variable-wallet-v4.js',timeout:500});
 return context.window.RUSTUP_STARS_VARIABLE_V4;
}
test('accepts user-entered rubles with decimal comma and precise kopecks',()=>{
 const parse=createModule().parseAmountMinor;
 for(const [input,expected] of [
  ['1',100],['1,01',101],['250,50',25050],
  ['1500',150000],['999999,99',99999999],['1000000',100000000],
  [' 35.07 ',3507]
 ]) assert.equal(parse(input),expected,input);
});
test('never rounds invalid or ambiguous money inputs',()=>{
 const parse=createModule().parseAmountMinor;
 for(const input of [
  '','0','0,99','-1','1e6','0x100','1.005','1,000.00',
  '1000001','9999999','∞','NaN','1;00','1 000','1,','1.',
  null,1
 ]) assert.equal(parse(input),null,String(input));
});
test('purchase history labels are localized; HTML is not interpolated',()=>{
 assert.match(source,/checkout_approved:'Ожидает подтверждения'/);
 assert.match(source,/manual_review:'Проверяется поддержкой'/);
 assert.match(source,/paid:'Оплата подтверждена'/);
 assert.match(source,/historyBusy=true/);
 assert.match(source,/finally\{historyBusy=false/);
 assert.doesNotMatch(source,/innerHTML\s*=/);
});
test('no game credits or invented fixed product SKUs in front-end',()=>{
 assert.match(source,/RUSTUP_STARS_VARIABLE_V4/);
 assert.match(source,/input\.addEventListener\('input',reset\)/);
 assert.match(source,/request\('quote'/);
 assert.doesNotMatch(source,/balance\s*[+]?=|fixed_nontransferable|sku|case_price/);
});
