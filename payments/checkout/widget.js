// Framework-free, privacy-minimal checkout component for external merchant sites.
// Call only from the merchant site using its OWN server-rendered invoice payload.
// Do not put project API keys, Cloudflare secrets or wallet seeds in the browser.
import {validatePublicInvoice,formatCryptoAtomic,displayFiat,
 NETWORK_NAMES,ASSET_DIGITS} from './format.js';

export function mountCryptoPayment(container,initialInvoice,{refresh,onSubmitTransaction}={}){
 if(!(container instanceof Element))throw Error('invalid_checkout_container');
 let invoice=validatePublicInvoice(initialInvoice),destroyed=false,busy=false;
 const root=document.createElement('section');
 root.className='rup-crypto-checkout';
 const title=document.createElement('h2');title.textContent='Krypto-Zahlung';
 const fiat=document.createElement('p');
 const currency=document.createElement('p');
 const address=document.createElement('code');address.style.overflowWrap='anywhere';
 const instructions=document.createElement('p');
 const status=document.createElement('p');status.setAttribute('role','status');
 const pending=document.createElement('p');
 const copy=document.createElement('button');
 copy.type='button';copy.textContent='Empfangsadresse kopieren';
 const refreshBtn=document.createElement('button');
 refreshBtn.type='button';refreshBtn.textContent='Zahlungsstatus prüfen';
 const hashInput=document.createElement('input');
 hashInput.setAttribute('aria-label','Blockchain-Transaktions-ID');
 hashInput.placeholder='Transaktions-ID zur Prüfung (optional)';
 hashInput.autocomplete='off';
 const verifyBtn=document.createElement('button');
 verifyBtn.type='button';verifyBtn.textContent='Transaktion prüfen';
 const error=document.createElement('p');error.setAttribute('role','alert');
 root.append(title,fiat,currency,address,instructions,status,pending,
  copy,refreshBtn,hashInput,verifyBtn,error);
 container.replaceChildren(root);
 const readyToPay=()=>invoice.status==='awaiting_payment'&&Date.now()<invoice.expiresAt;
 function render(){
  fiat.textContent='Rechnungsbetrag: '+displayFiat(invoice.amountMinor,invoice.fiat);
  currency.textContent='Zu senden: '+
   formatCryptoAtomic(invoice.amountAtomic,ASSET_DIGITS[invoice.asset])+' '+invoice.asset+
   ' ('+NETWORK_NAMES[invoice.chain]+')';
  address.textContent=invoice.receiveAddress;
  const remain=Math.max(0,Math.floor((invoice.expiresAt-Date.now())/1000));
  instructions.textContent='Nur das angegebene Netzwerk verwenden. Auf anderen Netzwerken können Zahlungen verloren gehen.';
  status.textContent=invoice.status==='verified'?
   invoice.deliveredToProject?'Zahlung auf der Blockchain bestätigt; Bestätigung an Projekt zugestellt.':'Blockchain-Zahlung bestätigt – Benachrichtigung an Projekt ausstehend.':
   invoice.status==='manual_review'?'Manuelle Prüfung erforderlich.':
   readyToPay()?'Rechnung offen.':'Rechnung abgelaufen – bitte nicht mehr überweisen.';
  pending.textContent=readyToPay()?
   'Verbleibende Zeit: '+Math.floor(remain/60)+':'+String(remain%60).padStart(2,'0'):
   'Bei verspäteter Zahlung bitte den Support des empfangenden Projekts kontaktieren.';
  copy.disabled=!readyToPay();
  verifyBtn.disabled=typeof onSubmitTransaction!=='function'||typeof refresh!=='function'||busy;
  hashInput.disabled=typeof onSubmitTransaction!=='function'||typeof refresh!=='function'||busy;
  refreshBtn.disabled=typeof refresh!=='function'||busy;
 }
 async function refreshInvoice(){
  if(destroyed||busy||typeof refresh!=='function')return;
  busy=true;render();
  try{
   const next=await refresh(invoice.invoiceId);
   const checked=validatePublicInvoice(next);
   if(checked.invoiceId!==invoice.invoiceId)throw Error('invoice_changed');
   invoice=checked;
   error.textContent='';
  }catch{error.textContent='Statusprüfung derzeit nicht verfügbar.'}
  finally{busy=false;render();}
 }
 copy.addEventListener('click',async()=>{
  if(!readyToPay())return;
  try{await navigator.clipboard.writeText(invoice.receiveAddress);error.textContent='Adresse kopiert.'}
  catch{error.textContent='Kopieren nicht möglich. Adresse bitte manuell übernehmen.'}
 });
 refreshBtn.addEventListener('click',()=>refreshInvoice());
 verifyBtn.addEventListener('click',async()=>{
  if(busy||typeof onSubmitTransaction!=='function')return;
  const hash=hashInput.value.trim();
  if(!/^(0x)?[a-fA-F0-9]{64}$/.test(hash)){
   error.textContent='Bitte eine gültige Transaktions-ID eingeben.';return;
  }
  busy=true;render();
  try{await onSubmitTransaction(invoice.invoiceId,hash);await refresh(invoice.invoiceId).then(x=>{
   const checked=validatePublicInvoice(x);
   if(checked.invoiceId!==invoice.invoiceId)throw Error('invoice_changed');
   invoice=checked;error.textContent='';
  });}catch{error.textContent='Zahlung noch nicht bestätigt oder manuelle Prüfung notwendig.'}
  finally{busy=false;render();}
 });
 const timer=setInterval(()=>{
  if(destroyed)return;
  render();
 },1000);
 render();
 return {update(next){invoice=validatePublicInvoice(next);render();},
  destroy(){destroyed=true;clearInterval(timer);root.remove();}};
}
