import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const script=readFileSync(new URL('./prepare-supporter-badge-release.ps1',import.meta.url),'utf8');
test('existing RUST UP badge deployment requires explicit -DeployReadOnly switch',()=>{
 assert.match(script,/param\(\[switch\]\$DeployReadOnly\)/);
 assert.match(script,/if\(!\$DeployReadOnly\)\{/);
 assert.match(script,/NOT DEPLOYED/);
 assert.match(script,/exit 0/);
});
test('read-only deployment requires tested bundle, integrity and all flags off',()=>{
 assert.match(script,/stage-current-variable-stars\.mjs/);
 assert.match(script,/stage-supporter-badge\.mjs/);
 assert.match(script,/--check/);
 assert.match(script,/node --check/);
 assert.match(script,/--dry-run --config/);
 assert.match(script,/wrangler deploy --config/);
 assert.match(script,/productionEnabled/);
 assert.match(script,/gameBalanceCredit/);
 assert.doesNotMatch(script,/STARS_PAYMENT_ENABLED\s*=\s*["']true["']/);
 assert.doesNotMatch(script,/PAYMENT_PRODUCTION_ENABLED\s*=\s*["']true["']/);
});
