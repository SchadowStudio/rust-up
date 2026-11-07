// Improve the already-published Stars wallet's post-invoice reconciliation.
// Runs locally on a checkout of ttzoomrust-hub/rust-up. No payment or balance writes.
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const root=process.argv[2];
if(!root)throw Error('Usage: node payments/scripts/patch-stars-multi-purchase-refresh.mjs <site-repo-path>');
const file=join(resolve(root),'js','stars-deposit-v5.js');
const htmlFile=join(resolve(root),'index.html');
const original=await readFile(file,'utf8');
let source=original.replace(/\r\n/g,'\n');
const start=source.indexOf('  let polling=false;\n  async function pollCredit(orderId){');
const end=source.indexOf('  let historyBusy=false;',start);
if(start<0||end<start)throw Error('Expected previous Stars polling implementation not found; no files changed');
const replacement=`  // Keep every paid invoice in the reconciliation queue. A single boolean
  // previously discarded payments made before the first one was credited.
  // No client-side balance changes: only the authenticated game server does that.
  const pendingCredits=new Set();
  let pollingPromise=null;
  function pollCredit(orderId){
   if(typeof orderId!=='string'||!/^[-a-f0-9]{36}$/i.test(orderId))return;
   pendingCredits.add(orderId);
   if(!pollingPromise){
    pollingPromise=reconcileCredits().finally(()=>{pollingPromise=null;});
   }
  }
  async function reconcileCredits(){
   for(let attempt=0;attempt<30&&pendingCredits.size>0;attempt++){
    try{
     const result=await request('history',{},AbortSignal.timeout(12000));
     const orders=Array.isArray(result.orders)?result.orders:[];
     let anyCredited=false;
     for(const id of [...pendingCredits]){
      const order=orders.find(o=>o.id===id);
      if(order?.creditState==='credited_to_game'&&order.creditedToGame===true){
       pendingCredits.delete(id);
       anyCredited=true;
      }else if(order?.creditState==='manual_review'||
        order?.creditState==='refund_reversed'||
        order?.creditState==='refunded_no_game_credit'){
       pendingCredits.delete(id);
       if(panel.isConnected)summary.textContent=
        'Платёж требует проверки или был возвращён. Откройте «Мои пополнения».';
      }
     }
     if(anyCredited){
      const game=await window.RUSTUP_APP?.api?.('load');
      if(!game?.ok||!game?.state)throw {status:503};
      // app.api('load') applies the authoritative state and renders the
      // header, including the current currency's formatted balance.
      if(panel.isConnected){
       summary.textContent='✅ Зачисление подтверждено. Баланс обновлён.';
       if(!historyButton.disabled)historyButton.click();
      }
     }else if(panel.isConnected&&pendingCredits.size){
      summary.textContent='Проверяем оплату и зачисление на игровой счёт…';
     }
    }catch(e){
     if(e?.status===401||e?.status===403){
      // Never bypass expired/invalid Telegram authentication.
      if(panel.isConnected)summary.textContent=errorLabel(e);
      return;
     }
     if(attempt===29&&panel.isConnected)summary.textContent=
      'Проверка временно недоступна. Откройте «Мои пополнения».';
    }
    if(pendingCredits.size>0)await new Promise(r=>setTimeout(r,2500));
   }
   if(pendingCredits.size&&panel.isConnected)
    summary.textContent='Зачисление ещё проверяется. Посмотрите «Мои пополнения».';
  }
  // When returning from the Telegram invoice, refresh even if the payment
  // callback or individual history polling was delayed by the mobile client.
  async function refreshVisibleBalance(){
   if(document.hidden)return;
   if(pendingCredits.size){if(!pollingPromise)pollCredit([...pendingCredits][0]);return;}
   // An already confirmed receipt was handled; re-read the backend balance.
   await window.RUSTUP_APP?.api?.('load');
  }
  document.addEventListener('visibilitychange',()=>{
   if(!document.hidden)void refreshVisibleBalance();
  });
`;
source=source.slice(0,start)+replacement+source.slice(end);
if(source===original.replace(/\r\n/g,'\n'))throw Error('No change');
const html=await readFile(htmlFile,'utf8');
const oldTag='js/stars-deposit-v5.js?v=20261107autorefresh1';
const newTag='js/stars-deposit-v5.js?v=20261107multipurchase2';
if(html.split(oldTag).length!==2)throw Error('Unexpected Stars script tag; no files changed');
await writeFile(file,source.replace(/\n/g,original.includes('\r\n')?'\r\n':'\n'));
await writeFile(htmlFile,html.replace(oldTag,newTag));
console.log('Stars multi-purchase auto-refresh patch applied; no balance writes');
