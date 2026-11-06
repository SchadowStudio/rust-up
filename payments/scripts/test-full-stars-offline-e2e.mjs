// One-command offline E2E verification. Never contacts Telegram, Cloudflare
// or real payment providers. All user IDs, charge IDs and funds are synthetic.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const files=[
 'payments/integration/telegram-stars/telegram-initdata-official.test.mjs',
 'payments/integration/telegram-stars/stars-variable-bridge.test.mjs',
 'payments/integration/telegram-stars/stars-variable-webhook-wrapper.test.mjs',
 'payments/integration/telegram-stars/stars-variable-webhook-sqlite-e2e.test.mjs',
 'payments/integration/telegram-stars/stars-sqlite-e2e.test.mjs',
 'payments/integration/telegram-stars/variable-payments.test.mjs',
 'payments/integration/telegram-stars/variable-refunds.test.mjs',
 'payments/integration/telegram-stars/stars-delivery-queue.test.mjs',
 'payments/integration/account-credit-ledger/verified-stars-game-credit.test.mjs',
 'payments/integration/account-credit-ledger/verified-stars-game-refund.test.mjs',
 'payments/integration/account-credit-ledger/freeze-verified-stars-game-quote.test.mjs'
];
console.log('RUST UP: OFFLINE TELEGRAM STARS E2E SAFETY SUITE');
console.log('Only fake identity, fake XTR receipts and isolated SQLite databases.');
console.log('No network access, no payment charge, no production balance changes.');
const result=spawnSync(process.execPath,['--test',...files],{
 cwd:root,stdio:'inherit',env:process.env,timeout:120000
});
if(result.error){
 console.error('OFFLINE E2E FAILED:',result.error.code||'runner_error');
 process.exitCode=1;
}else if(result.status!==0){
 console.error('OFFLINE E2E FAILED; do not enable payments.');
 process.exitCode=1;
}else{
 console.log('PASS: Offline test suites completed; real-money activation NOT performed.');
 console.log('NOTE: Offline pass does not establish a live Stars charge/refund result.');
}
