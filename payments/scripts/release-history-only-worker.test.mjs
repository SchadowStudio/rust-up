import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const script=readFileSync(new URL('./release-history-only-worker.ps1',import.meta.url),'utf8');

test('release script defaults to no deployment and requires explicit history-only opt-in',()=>{
 assert.match(script,/\[switch\]\$DeployHistoryOnly/);
 assert.match(script,/if\(!\$DeployHistoryOnly\)\s*\{/);
 assert.match(script,/NOTHING DEPLOYED/);
 assert.match(script,/npx --yes wrangler deploy --dry-run --config/);
 assert.match(script,/npx --yes wrangler deploy --config/);
 assert.ok(script.indexOf('if(!$DeployHistoryOnly)')<
  script.indexOf('npx --yes wrangler deploy --config'));
});
test('source is revalidated immediately before the only real deployment',()=>{
 const actual=script.indexOf('npx --yes wrangler deploy --config');
 const first=script.lastIndexOf(
  'node \'.\\payments\\scripts\\stage-history-only-compiled-worker.mjs\' --verify',actual);
 const second=script.lastIndexOf(
  'node \'.\\payments\\scripts\\verify-history-only-worker-release.mjs\' before',actual);
 assert.ok(first>0&&first<actual);
 assert.ok(second>first&&second<actual);
 assert.ok(script.includes('verify-history-only-worker-release.mjs\' after'));
 assert.ok(script.includes('probe-history-only-worker.mjs'));
});
test('no D1 write, real money flag enabling, or payment checkout in release script',()=>{
 assert.doesNotMatch(script,/\bUPDATE\s+accounts\b|\bINSERT\s+INTO\b/i);
 assert.doesNotMatch(script,/STARS_PAYMENT_ENABLED\s*=\s*["']?true|PAYMENT_PRODUCTION_ENABLED\s*=\s*["']?true/i);
 assert.doesNotMatch(script,/openInvoice|createInvoiceLink|payment_checkout/);
 assert.match(script,/StageFolder must be within the local private Worker recovery directory/);
});
