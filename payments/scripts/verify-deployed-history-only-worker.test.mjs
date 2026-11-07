import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('./verify-deployed-history-only-worker.ps1',import.meta.url),'utf8');
test('post-deploy verification is strictly read-only and never reruns release',()=>{
 assert.match(source,/verify-history-only-worker-release\.mjs' after/);
 assert.match(source,/probe-history-only-worker\.mjs/);
 const executable=source.split('\n').filter(line=>!line.trimStart().startsWith('#')).join('\n');
 assert.doesNotMatch(executable,/wrangler deploy|d1 execute|--publish|DeployHistoryOnly/i);
 assert.doesNotMatch(source,/UPDATE\s+accounts|INSERT\s+INTO|STARS_PAYMENT_ENABLED.*true/i);
});
test('local recovery stage path and offline validation are required',()=>{
 assert.match(source,/Parameter\(Mandatory=\$true\)/);
 assert.match(source,/Test-Path -LiteralPath \$StageFolder/);
 assert.match(source,/Untrusted recovery folder/);
 assert.match(source,/verify-history-only-worker-release\.test\.mjs/);
});
