import test from 'node:test';
import assert from 'node:assert/strict';
import {patchDepositAppCache} from './refresh-current-deposit-app-cache.mjs';

const old='<script src="js/app.js?v=20261106i"></script>';
const next='<script src="js/app.js?v=20261106depositstatus2"></script>';
const stars='<script src="js/stars-deposit-v5.js?v=20261106depositstatus1"></script>';
const style='<link rel="stylesheet" href="css/stars-deposit-v5.css?v=20261106depositstatus1">';
const html=()=>['<html>',style,stars,old,'</html>','x'.repeat(4500)].join('\r\n');

test('one cache-busting change makes the updated wallet script load',()=>{
 const before=html();
 const after=patchDepositAppCache(before);
 assert.ok(after.includes(next));
 assert.ok(!after.includes(old));
 assert.ok(after.includes(stars));
 assert.ok(after.includes(style));
 assert.equal(after.replace(next,old),before);
 assert.ok(after.indexOf(stars)<after.indexOf(next));
});

test('refuses a second version bump or unexpected script orders',()=>{
 const source=html();
 assert.throws(()=>patchDepositAppCache(source.replace(old,next)),/already_refreshed/);
 assert.throws(()=>patchDepositAppCache(source.replace(stars,'')),/html_changed/);
 assert.throws(()=>patchDepositAppCache(source.replace(style,'')),/html_changed/);
 assert.throws(()=>patchDepositAppCache(source.replace(old,'')),/html_changed/);
 assert.throws(()=>patchDepositAppCache(source.replace(stars,old).replace(old,stars)),/html_changed|already_refreshed/);
});

test('cache refresh cannot modify payment flags or game coin balances',()=>{
 const before=html();
 const after=patchDepositAppCache(before);
 assert.equal(after.length-before.length,next.length-old.length);
 assert.equal(after.replace(next,old),before);
 assert.doesNotMatch(after,/PAYMENT_PRODUCTION_ENABLED|STARS_PAYMENT_ENABLED|UPDATE accounts/i);
});
