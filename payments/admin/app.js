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
 return [...walletProviders.values()][0]||null;
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
