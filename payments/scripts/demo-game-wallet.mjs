// Local-only RUST UP demo payment -> sandbox points -> spend -> refund.
// Runs entirely in-memory. No Telegram request, blockchain call, keys or money.
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {simulateDeposit,simulateGameSpend,simulateRefund,getDemoWallet} from '../integration/demo-game-wallet/ledger.mjs';
const basedir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../integration/demo-game-wallet');
const sql=new DatabaseSync(':memory:');
sql.exec(fs.readFileSync(path.join(basedir,'migration.sql'),'utf8'));
function stmt(query,args=[]){
 const s=sql.prepare(query);
 return {async first(){return s.get(...args)||null;},
  async all(){return {results:s.all(...args)};},
  async run(){return {meta:{changes:s.run(...args).changes}};}};
}
let pending=Promise.resolve();
const db={
 prepare(query){return {bind(...args){return stmt(query,args)}}},
 batch(statements){
  const job=async()=>{
   sql.exec('BEGIN IMMEDIATE');
   try{
    const results=[];
    for(const x of statements)results.push(await x.run());
    sql.exec('COMMIT');return results;
   }catch(e){sql.exec('ROLLBACK');throw e;}
  };
  const next=pending.then(job,job);
  pending=next.catch(()=>{});
  return next;
 }
};
const userId=910001;
try{
 const stars=await simulateDeposit(db,{userId,channel:'stars',
  reference:'stars:demo:invoice-0001',units:150});
 const crypto=await simulateDeposit(db,{userId,channel:'crypto',
  reference:'crypto:demo:invoice-0001',units:200});
 const replay=await simulateDeposit(db,{userId,channel:'stars',
  reference:'stars:demo:invoice-0001',units:150});
 const spent=await simulateGameSpend(db,{userId,
  reference:'demo:game:purchase-0001',units:75});
 const refund=await simulateRefund(db,{
  source:'demo_crypto',reference:'crypto:demo:invoice-0001'
 });
 const wallet=await getDemoWallet(db,userId);
 const success=stars.balanceUnits===150&&crypto.balanceUnits===350&&
  replay.duplicate===true&&spent.balanceUnits===275&&
  refund.balanceUnits===75&&wallet.balanceUnits===75&&
  wallet.withdrawable===false&&wallet.gameStakesAllowed===false;
 console.log(success?'LOCAL DEMO WALLET PASS':'LOCAL DEMO WALLET FAIL');
 console.log('Stars demo +150; crypto demo +200; replay +0; spend -75; refund -200.');
 console.log('Remaining DEMO points:',wallet.balanceUnits);
 console.log('Event count:',wallet.history.length);
 console.log('No funds moved, no external gateway or game balance touched.');
 if(!success)process.exitCode=1;
}catch(error){console.error('LOCAL DEMO WALLET FAIL:',error.message);process.exitCode=1;}
finally{sql.close();}
