import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const ps=readFileSync(new URL('./release-current-stars-webhook-only.ps1',import.meta.url),'utf8');
test('Stars webhook release defaults to preflight, never publishes without explicit opt-in',()=>{
 assert.match(ps,/\[switch\]\$PublishWebhookOnly/);
 assert.match(ps,/if\(!\$PublishWebhookOnly\)/);
 assert.match(ps,/NOTHING DEPLOYED/);
 const publish=ps.indexOf('npx --yes wrangler deploy --config');
 assert.ok(ps.indexOf('if(!$PublishWebhookOnly)')<publish);
 assert.ok(ps.indexOf('npx --yes wrangler deploy --dry-run --config')<publish);
});
test('release verifies the original game bot before and after publication',()=>{
 assert.match(ps,/stage-current-stars-webhook-only\.mjs' --verify/);
 assert.match(ps,/verify-stars-webhook-only-live\.mjs/);
 assert.match(ps,/probe-owner-stars-quote\.mjs/);
 assert.match(ps,/stars-delivery-queue\.test\.mjs/);
 assert.match(ps,/private Worker recovery directory/);
});
test('release does not activate money or modify either database',()=>{
 const executable=ps.split('\n')
  .filter(line=>!line.trimStart().startsWith('#')).join('\n');
 assert.doesNotMatch(executable,/PAYMENT_PRODUCTION_ENABLED.*true/);
 assert.doesNotMatch(executable,/STARS_PAYMENT_ENABLED.*true/);
 assert.doesNotMatch(executable,/INSERT INTO.*rustup_game_paid_receipts|UPDATE accounts/i);
 assert.doesNotMatch(executable,/refundStarPayment|createInvoiceLink/);
});
