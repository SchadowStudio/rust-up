// RUST UP payment integration sandbox smoke check.
// Requires "npm run demo:local" running in another terminal.
// Does not alter the Telegram Mini App or any live balance.
import {readFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {RustUpLocalSandboxBridge} from '../integration/rust-up-local/bridge.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const directory=path.join(root,'.local-test-results');
const config=JSON.parse(readFileSync(
 path.join(directory,'local-demo-credentials.json'),'utf8'));
if(config.mode!=='LOCAL_SIMULATION_ONLY')
 throw Error('cannot_use_non_demo_payment_credentials');
const bridge=new RustUpLocalSandboxBridge({
 gatewayUrl:config.url,credentials:config,
 dbFile:path.join(directory,'rustup-sandbox.sqlite')
});
try{
 const order=await bridge.createOrder({fiat:'EUR',amountMinor:2500,asset:'ETH'});
 const before=bridge.balance(order.player_ref,'EUR');
 assert.equal(before,0);
 const nothing=await bridge.synchronize();
 assert.equal(bridge.balance(order.player_ref,'EUR'),0);
 const completed=await bridge.simulate(order.order_id);
 assert.equal(completed.status,'credited');
 assert.equal(bridge.balance(order.player_ref,'EUR'),2500);
 const repeated=await bridge.simulate(order.order_id);
 assert.equal(repeated.status,'credited');
 assert.equal(bridge.balance(order.player_ref,'EUR'),2500);
 const redundant=await bridge.synchronize();
 assert.equal(redundant.credited,0);
 console.log('RUST UP LOCAL BRIDGE PASS — no real money');
 console.log('Sandbox RUST UP order: '+order.order_id);
 console.log('Payment demo invoice: '+order.invoice_id);
 console.log('Before simulated confirmation: 0 EUR test balance');
 console.log('After simulated confirmation: 25.00 EUR test balance');
 console.log('Duplicate confirmation / replay: 0 extra credit');
 console.log('Independent local sandbox ledger: .local-test-results/rustup-sandbox.sqlite');
 console.log('No real Telegram account, game inventory or cryptocurrency was changed.');
}catch(error){
 console.error('RUST UP LOCAL BRIDGE FAILED:',error.message);
 console.error('Start npm run demo:local in another PowerShell terminal first.');
 process.exitCode=1;
}finally{bridge.close();}
