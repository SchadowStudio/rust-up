// Standalone operator console. Never persist operator secrets or wallet keys.
import {validateReceivingAddress} from '../src/address.js';
const $=id=>document.getElementById(id);
const note=(message,bad=false)=>{
 $('message').textContent=message;$('message').className=bad?'bad':'good';
};
const walletProviders=new Map();
window.addEventListener('eip6963:announceProvider',event=>{
 const detail=event.detail;
 if(detail?.info?.rdns==='com.trustwallet.app'&&detail.provider?.request)
  walletProviders.set(detail.info.uuid,detail.provider);
});
window.dispatchEvent(new Event('eip6963:requestProvider'));
function provider(){
 const announced=[...walletProviders.values()][0];
 if(announced)return announced;
 const mobile=window.trustwallet?.ethereum || window.trustwallet;
 if(mobile?.request)return mobile;
 if(window.ethereum?.isTrust && window.ethereum?.request)return window.ethereum;
 return null;
}
async function walletConnect(){
 const p=provider();
 if(!p)throw Error('Trust Wallet Extension nicht gefunden. Offizielle Erweiterung: https://trustwallet.com/browser-extension');
 const network=await p.request({method:'eth_chainId'});
 if(network!=='0x1')throw Error('Bitte im Trust Wallet zunächst Ethereum Mainnet auswählen.');
 const accounts=await p.request({method:'eth_requestAccounts'});
 if(!Array.isArray(accounts)||!accounts[0])throw Error('Keine Adresse freigegeben.');
 const value=String(accounts[0]);
 if(!await validateReceivingAddress('ethereum',value))throw Error('Ungültige Ethereum-Adresse.');
 $('chain').value='ethereum';$('address').value=value;
 note('Trust Wallet Extension verbunden. Öffentliche ETH-Adresse übernommen; noch nicht zum Server hinzugefügt.');
 if(p.on)p.on('accountsChanged',()=>{
  $('address').value='';
  note('Trust Wallet Konto gewechselt. Bitte erneut verbinden.',true);
 });
}
function getAccess(){
 const endpoint=$('endpoint').value.trim(),token=$('token').value.trim();
 if(!/^https:\/\/[a-z0-9.-]+(?::443)?\/?$/i.test(endpoint))
  throw Error('Bitte eine gültige HTTPS-Worker-URL ohne Pfad eintragen.');
 if(token.length<40)throw Error('Operator-Schlüssel fehlt oder ist zu kurz.');
 return {endpoint:endpoint.replace(/\/$/,''),token};
}
async function api(path,method='GET',body){
 const {endpoint,token}=getAccess();
 const response=await fetch(endpoint+path,{
  method,mode:'cors',cache:'no-store',
  headers:{'authorization':'Bearer '+token,...(body?{'content-type':'application/json'}:{})},
  ...(body?{body:JSON.stringify(body)}:{})
 });
 const parsed=await response.json().catch(()=>({error:'invalid_server_response'}));
 if(!response.ok||parsed.ok!==true)throw Error(parsed.error||('HTTP '+response.status));
 return parsed;
}
function renderReceiver(r){
 const card=document.createElement('div');card.className='address';
 const title=document.createElement('strong');
 title.textContent=r.chain.toUpperCase()+' — '+r.address;card.appendChild(title);
 const meta=document.createElement('p');meta.className='muted';
 meta.textContent=(r.label||'Trust Wallet')+' · '+(r.enabled?'AKTIV':'DEAKTIVIERT')+
  (r.assigned?' · VERGEBEN':' · frei');card.appendChild(meta);
 const btn=document.createElement('button');
 btn.className='secondary';btn.type='button';
 btn.disabled=!!r.assigned;btn.textContent=r.enabled?'Deaktivieren':'Nach Prüfung aktivieren';
 btn.addEventListener('click',async()=>{
  const word=r.enabled?'deaktivieren':'aktivieren';
  if(!window.confirm('Empfangsadresse '+word+'?\n'+r.chain+': '+r.address+
    '\nNur bestätigen, wenn du die Adresse in Trust Wallet kontrollierst und getestet hast.'))return;
  try{
   await api('/v1/operator/receivers/'+encodeURIComponent(r.chain)+'/'+encodeURIComponent(r.address)+'/'+
    (r.enabled?'disable':'enable'),'POST',{confirmation:'I_CONTROL_THIS_ADDRESS'});
   note('Empfangsadresse erfolgreich '+word+'.');await listReceivers();
  }catch(e){note(e.message,true)}
 });
 card.appendChild(btn);
 return card;
}
async function listReceivers(){
 const data=await api('/v1/operator/receivers');
 const target=$('receivers');target.replaceChildren();
 for(const item of data.receivers)target.appendChild(renderReceiver(item));
 if(!data.receivers.length){
  const p=document.createElement('p');p.textContent='Keine Empfangsadressen hinterlegt.';
  target.appendChild(p);
 }
}
$('connect').addEventListener('click',()=>walletConnect().catch(e=>note(e.message,true)));
$('mobileConnect').addEventListener('click',()=>{
 if(location.protocol!=='https:')return note('Mobile Trust Wallet benötigt eine sichere HTTPS-Seite.',true);
 const url=new URL('https://link.trustwallet.com/open_url');
 url.searchParams.set('coin_id','60');
 url.searchParams.set('url',location.href);
 window.open(url.toString(),'_blank','noopener,noreferrer');
});
$('list').addEventListener('click',()=>listReceivers().then(()=>note('Operator-Verbindung erfolgreich.')).catch(e=>note(e.message,true)));
$('add').addEventListener('click',async()=>{
 const chain=$('chain').value,address=$('address').value.trim(),label=$('label').value.trim();
 try{
  if(!await validateReceivingAddress(chain,address))throw Error('Netzwerk oder Adressprüfsumme ungültig.');
  await api('/v1/operator/receivers','POST',{chain,address,label,source:'trust_wallet'});
  note('Adresse deaktiviert hinzugefügt. Vor Aktivierung Adresse testen.');
  await listReceivers();
 }catch(e){note(e.message,true)}
});

async function toggleOffer(resource,id,asset,enabled){
 const kind=resource==='quotes'?'Krypto-Kurs':'Angebot';
 if(!window.confirm(kind+' '+id+(asset?' / '+asset:'')+
 '\n'+(enabled?'deaktivieren':'aktivieren')+'? Bitte Preis und Netzwerk zuvor prüfen.'))return;
 const path='/v1/operator/'+resource+'/'+encodeURIComponent(id)+
  (asset?'/'+encodeURIComponent(asset):'')+'/'+(enabled?'disable':'enable');
 await api(path,'POST',{confirmation:'I_APPROVE_THIS_PRICE'});
 await listOffers();
}
function offerRow(title,description,action){
 const el=document.createElement('div');el.className='address';
 const h=document.createElement('strong');h.textContent=title;el.appendChild(h);
 const p=document.createElement('p');p.className='muted';p.textContent=description;el.appendChild(p);
 const btn=document.createElement('button');btn.className='secondary';
 btn.type='button';btn.textContent=action.label;btn.addEventListener('click',action.run);
 el.appendChild(btn);return el;
}
async function listOffers(){
 const data=await api('/v1/operator/offers');
 const root=$('offerList');root.replaceChildren();
 const groups=new Map(data.packages.map(pkg=>[pkg.id,pkg]));
 for(const pkg of data.packages){
  const enabled=pkg.enabled===1;
  const currency=(pkg.credit_kopecks/100).toLocaleString('de-DE',{maximumFractionDigits:2});
  root.appendChild(offerRow(
   pkg.title+' ('+pkg.id+')',
   currency+' ₽ Guthaben · '+(enabled?'ANGEBOT AKTIV':'Angebot deaktiviert'),
   {label:enabled?'Angebot deaktivieren':'Angebot freigeben',
    run:()=>toggleOffer('offers',pkg.id,null,enabled).catch(e=>note(e.message,true))}
  ));
 }
 for(const quote of data.quotes){
  const enabled=quote.enabled;
  root.appendChild(offerRow(
   quote.asset+' · '+quote.packageId,
   quote.amount+' '+quote.asset+' · '+(enabled?'KURS AKTIV':'Kurs deaktiviert'),
   {label:enabled?'Kurs deaktivieren':'Kurs freigeben',
    run:()=>toggleOffer('quotes',quote.packageId,quote.asset,enabled)
     .catch(e=>note(e.message,true))}
  ));
 }
 if(!groups.size){const p=document.createElement('p');p.textContent='Keine Angebote.';root.appendChild(p);}
}
$('newPackage').addEventListener('click',async()=>{
 try{
  await api('/v1/operator/offers','POST',{
   id:$('pkgId').value.trim(),title:$('pkgTitle').value.trim(),
   creditKopecks:Number($('pkgKopecks').value)
  });
  note('Neues Angebot deaktiviert gespeichert.');await listOffers();
 }catch(e){note(e.message,true)}
});
$('setQuote').addEventListener('click',async()=>{
 try{
  await api('/v1/operator/quotes','POST',{
   packageId:$('pkgId').value.trim(),asset:$('quoteAsset').value,
   amount:$('quoteAmount').value.trim()
  });
  note('Neue Kursangabe deaktiviert gespeichert.');await listOffers();
 }catch(e){note(e.message,true)}
});
$('listOffers').addEventListener('click',()=>listOffers()
 .then(()=>note('Zahlungsangebote geladen.')).catch(e=>note(e.message,true)));
