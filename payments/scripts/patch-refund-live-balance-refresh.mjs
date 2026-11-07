// Poll the authoritative RUST UP game balance in the background so refunds
// made outside the Mini App update the header automatically. No local mutation.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=process.argv[2];
if(!root)throw Error('Usage: node payments/scripts/patch-refund-live-balance-refresh.mjs <site-repo>');
const file=join(resolve(root),'js','app.js');
const htmlFile=join(resolve(root),'index.html');
const original=await readFile(file,'utf8');
let source=original.replace(/\r\n/g,'\n');
const anchor=`  cloudLoad(() => startGame());
  setInterval(() => { renderHeader(); scheduleTgPromo(0); }, 60e3);
})();`;
const replacement=`  cloudLoad(() => startGame());

  // Provider refunds and moderation adjustments happen outside the browser.
  // Never invent balance deltas: reload the canonical account state from /api/game.
  // Faster when the wallet is displayed, less frequent elsewhere.
  let accountBalanceRefreshBusy=false;
  let nextAccountBalanceRefreshAt=0;
  async function refreshAccountBalance(force=false){
    if(!gameReady||document.hidden||accountBalanceRefreshBusy)return;
    const now=Date.now();
    if(!force&&now<nextAccountBalanceRefreshAt)return;
    accountBalanceRefreshBusy=true;
    nextAccountBalanceRefreshAt=now+
      (location.hash.startsWith('#/wallet')?2000:6000);
    try{
      const data=await api('load');
      // api('load') already updates S.balance and the header on success.
      if(!data?.ok)nextAccountBalanceRefreshAt=Date.now()+6000;
    }finally{accountBalanceRefreshBusy=false;}
  }
  setInterval(()=>{void refreshAccountBalance();},1000);
  window.addEventListener('focus',()=>{void refreshAccountBalance(true);});
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden)void refreshAccountBalance(true);
  });
  setInterval(() => { renderHeader(); scheduleTgPromo(0); }, 60e3);
})();`;
if(source.split(anchor).length!==2)throw Error('Unexpected app.js footer, no files changed');
source=source.replace(anchor,replacement);
const html=await readFile(htmlFile,'utf8');
const oldTag='js/app.js?v=20261106sbp1';
const newTag='js/app.js?v=20261107refundbalance1';
if(html.split(oldTag).length!==2)throw Error('Unexpected app.js cache tag, no files changed');
await writeFile(file,original.includes('\r\n')?source.replace(/\n/g,'\r\n'):source);
await writeFile(htmlFile,html.replace(oldTag,newTag));
console.log('RUST UP refund-aware server balance refresh installed. No local balance changes.');
