// Patch the published RUST UP Telegram Mini App to reconcile Stars receipts
// and refresh the EXISTING game wallet after payment. Does not credit balances.
// Usage: node scripts/patch-stars-auto-refresh.mjs <path-to-site-repository>
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';

const siteRoot=process.argv[2];
if(!siteRoot)throw Error('Provide a checked-out ttzoomrust-hub/rust-up directory');
const file=join(resolve(siteRoot),'js','stars-deposit-v5.js');
const htmlFile=join(resolve(siteRoot),'index.html');
const before=await readFile(file,'utf8');
const lf=before.includes('\r\n')?'\r\n':'\n';
const normalize=s=>s.replace(/\r\n/g,'\n');
let source=normalize(before);
const original=source;
const oldPaid=`       // A client callback is NOT a receipt. Always load the signed,
       // cross-database history; no optimistic balance changes.
       if(!historyButton.disabled)historyButton.click();`;
const newPaid=`       // Only confirmed server-side receipt & game ledger can update the wallet.
       // Poll because the game settlement may arrive after Telegram closes invoice.
       void pollCredit(data.orderId);`;
if(source.split(oldPaid).length!==2)throw Error('Expected original Telegram paid callback was not found once');
source=source.replace(oldPaid,newPaid);
const anchor=`  let historyBusy=false;
  historyButton.addEventListener('click',async()=>{`;
const insert=`  // Server-authoritative post-payment reconciliation. Never infer a balance
  // change from Telegram's client-side 'paid' callback.
  let polling=false;
  async function pollCredit(orderId){
   if(polling||typeof orderId!=='string'||!/^[-a-f0-9]{36}$/i.test(orderId))return;
   polling=true;
   try{
    for(let i=0;i<20&&panel.isConnected;i++){
     try{
      const result=await request('history',{},AbortSignal.timeout(12000));
      const order=Array.isArray(result.orders)?
       result.orders.find(o=>o.id===orderId):null;
      if(order?.creditState==='credited_to_game'&&order.creditedToGame===true){
       const app=window.RUSTUP_APP;
       if(!app||typeof app.api!=='function')throw {status:503};
       const game=await app.api('load');
       if(!game?.ok||!game?.state)throw {status:503};
       // app.api('load') already applied the authoritative server state and
       // called renderHeader. No client-side money mutation.
       if(panel.isConnected){
        summary.textContent='✅ Оплата подтверждена. Баланс автоматически обновлён.';
        if(!historyButton.disabled)historyButton.click();
       }
       return;
      }
      if(order?.creditState==='manual_review'){
       summary.textContent='Платёж требует проверки поддержки. Баланс не изменён.';
       return;
      }
      if(order?.creditState==='refund_reversed'||order?.creditState==='refunded_no_game_credit'){
       summary.textContent='Платёж возвращён. Зачисления нет.';
       return;
      }
      if(panel.isConnected)summary.textContent=
       'Telegram подтвердил оплату. Ожидаем подтверждения зачисления…';
     }catch(e){
      if(e?.status===401||e?.status===403){
       // Telegram initData cannot be renewed inside an existing WebApp.
       // Do not bypass Telegram signature or claim a successful credit.
       summary.textContent=errorLabel(e);
       return;
      }
      if(i===19){summary.textContent=errorLabel(e);return;}
     }
     await new Promise(resolve=>setTimeout(resolve,3000));
    }
    if(panel.isConnected)
     summary.textContent='Оплата принята. Зачисление ещё проверяется — смотрите «Мои пополнения».';
   }finally{polling=false;}
  }
  let historyBusy=false;
  historyButton.addEventListener('click',async()=>{`;
if(source.split(anchor).length!==2)throw Error('Expected history handler anchor was not found once');
source=source.replace(anchor,insert);
if(source===original)throw Error('No changes');
await writeFile(file,source.replace(/\n/g,lf));
const html=await readFile(htmlFile,'utf8');
const oldTag='js/stars-deposit-v5.js?v=20261106authreason1';
const newTag='js/stars-deposit-v5.js?v=20261107autorefresh1';
if(html.split(oldTag).length!==2)throw Error('Expected cache-busting script tag not found once');
await writeFile(htmlFile,html.replace(oldTag,newTag));
console.log('Patched app auto-reconciliation (no balance writes): '+file);
