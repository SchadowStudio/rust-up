import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const scripts=path.dirname(fileURLToPath(import.meta.url));
const script=fs.readFileSync(path.join(scripts,'run-entire-rustup-check.ps1'),'utf8');

test('full-system PowerShell resolves RUST-UP-Local from payments/scripts once',()=>{
 const checkout=path.resolve(scripts,'../..');
 assert.equal(path.join(checkout,'payments','scripts'),scripts);
 assert.match(script,/\$root=Split-Path -Parent \(Split-Path -Parent \$PSScriptRoot\)/);
 assert.doesNotMatch(script,/\$root\s*=\s*Split-Path -Parent \$root/);
 assert.match(script,/Test-Path -LiteralPath \(Join-Path \$root '\.git'\)/);
 assert.match(script,/Set-Location -LiteralPath \$root/);
 assert.match(script,/\[string\]::IsNullOrWhiteSpace\(\$currentBranch\)/);
});
test('the full-system runner cannot deploy or turn on payments',()=>{
 assert.doesNotMatch(script,/wrangler\s+deploy|STARS_PAYMENT_ENABLED\s*=\s*["']true|PAYMENT_PRODUCTION_ENABLED\s*=\s*["']true/i);
 assert.match(script,/full-system-selftest\.mjs/);
 assert.match(script,/check-stars-activation\.ps1/);
 assert.match(script,/audit-variable-stars\.ps1/);
});
