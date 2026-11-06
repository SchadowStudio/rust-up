import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const script=readFileSync(new URL('./release-current-fixed-goods-site.ps1',import.meta.url),'utf8');
test('default release is read-only; publishing requires explicit switch',()=>{
 assert.match(script,/param\(\[switch\]\$Publish\)/);
 assert.match(script,/if\(!\$Publish\)/);
 assert.match(script,/--check/);
 assert.match(script,/--publish/);
 assert.ok(script.indexOf('if(!$Publish)')<script.indexOf('--publish'));
});
test('one command stages only reviewed fixed-goods site and preserves virtual game',()=>{
 assert.match(script,/ttzoomrust-hub\/rust-up/);
 assert.match(script,/git pull --ff-only origin main/);
 assert.match(script,/publish-current-demo-stars-fixed-goods\.mjs/);
 assert.match(script,/supporter-payment-preflight\.test\.mjs/);
 assert.match(script,/stars-fixed-market-terms\.test\.mjs/);
 assert.match(script,/Private website checkout has local changes/);
 assert.doesNotMatch(script,/wrangler deploy|wrangler d1 execute|PAYMENT_PRODUCTION_ENABLED = "true"/);
 assert.doesNotMatch(script,/STARS_GAME_CREDIT_SETTLEMENT_ENABLED = "true"/);
});
