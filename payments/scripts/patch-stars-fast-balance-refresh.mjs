// Speed up post-payment balance refresh in the published Telegram Mini App.
// Server remains the ONLY authority for credits and game balances.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';

const root=process.argv[2];
if(!root)throw Error('Usage: node payments/scripts/patch-stars-fast-balance-refresh.mjs <site-repo>');
const jsPath=join(resolve(root),'js','stars-deposit-v5.js');
const htmlPath=join(resolve(root),'index.html');
const jsOriginal=await readFile(jsPath,'utf8');
let js=jsOriginal.replace(/\r\n/g,'\n');
const html=await readFile(htmlPath,'utf8');
const oldWait='    if(pendingCredits.size>0)await new Promise(r=>setTimeout(r,2500));';
const newWait=`    // Fast retries for the first seconds; ease off to avoid excess requests.
    // Never show unconfirmed credit in the header.
    if(pendingCredits.size>0)
     await new Promise(r=>setTimeout(r,attempt<12?450:1200));`;
const oldLoad=`       pendingCredits.delete(id);
       anyCredited=true;`;
const newLoad=`       anyCredited=true;`;
const oldGame=`      const game=await window.RUSTUP_APP?.api?.('load');
      if(!game?.ok||!game?.state)throw {status:503};
      // app.api('load') applies the authoritative state and renders the
      // header, including the current currency's formatted balance.
      if(panel.isConnected){`;
const newGame=`      const game=await window.RUSTUP_APP?.api?.('load');
      if(!game?.ok||!game?.state)throw {status:503};
      // Only after the live game API confirms the balance may this order
      // leave the refresh queue. Otherwise retry instead of losing the event.
      for(const id of [...pendingCredits]){
       const order=orders.find(o=>o.id===id);
       if(order?.creditState==='credited_to_game'&&order.creditedToGame===true)
        pendingCredits.delete(id);
      }
      if(panel.isConnected){`;
const oldStart=`       void pollCredit(data.orderId);`;
const newStart=`       // Refresh the header immediately, then keep checking the receipt
       // and ledger until crediting really finishes.
       void window.RUSTUP_APP?.api?.('load');
       void pollCredit(data.orderId);`;
const oldVisible=`   if(pendingCredits.size){if(!pollingPromise)pollCredit([...pendingCredits][0]);return;}`;
const newVisible=`   if(pendingCredits.size){
    void window.RUSTUP_APP?.api?.('load');
    if(!pollingPromise)pollCredit([...pendingCredits][0]);
    return;
   }`;
for(const [needle,replacement] of [[oldWait,newWait],[oldLoad,newLoad],[oldGame,newGame],[oldStart,newStart],[oldVisible,newVisible]]){
 if(js.split(needle).length!==2)throw Error('Unexpected current site code, no files changed: '+needle.slice(0,60));
 js=js.replace(needle,replacement);
}
const oldTag='js/stars-deposit-v5.js?v=20261107multipurchase2';
const newTag='js/stars-deposit-v5.js?v=20261107fastrefresh3';
if(html.split(oldTag).length!==2)throw Error('Unexpected published Stars script tag, no files changed');
await writeFile(jsPath,jsOriginal.includes('\r\n')?js.replace(/\n/g,'\r\n'):js);
await writeFile(htmlPath,html.replace(oldTag,newTag));
console.log('Fast server-authoritative Stars refresh ready; no client credit operations');
