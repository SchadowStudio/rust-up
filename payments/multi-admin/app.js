import {validateReceivingAddress} from '../src/address.js';
const $=id=>document.getElementById(id);
const output=(s,isError=false)=>{$('output').textContent=s;$('output').className=isError?'bad':'ok';};
let trustProvider=null;
window.addEventListener('eip6963:announceProvider',event=>{
 if(event.detail?.info?.rdns==='com.trustwallet.app'&&event.detail?.provider?.request)
  trustProvider=event.detail.provider;
});
window.dispatchEvent(new Event('eip6963:requestProvider'));
function access(){
 const url=$('server').value.trim().replace(/\/$/,'');
 const apiKey=$('master').value.trim();
 if(!/^https:\/\/[a-z0-9.-]+(?::443)?$/i.test(url)||url.includes('@'))
  throw Error('Bitte eine gültige HTTPS-Gateway-Adresse ohne Pfad eingeben.');
 if(apiKey.length<48)throw Error('Betreiber-API-Schlüssel fehlt.');
 return {url,apiKey};
}
async function call(path,method='GET',body=null){
 const {url,apiKey}=access();
 const r=await fetch(url+path,{method,cache:'no-store',mode:'cors',
  headers:{authorization:'Bearer '+apiKey,...(body?{'content-type':'application/json'}:{})},
  ...(body?{body:JSON.stringify(body)}:{})
 });
 const json=await r.json().catch(()=>({error:'invalid_server_response'}));
 if(!r.ok||json.ok!==true)throw Error(json.error||('HTTP '+r.status));
 return json;
}
function action(text,fn){
 const button=document.createElement('button');
 button.textContent=text;button.className='subtle';button.type='button';
 button.addEventListener('click',()=>Promise.resolve().then(fn).catch(e=>output(e.message,true)));
 return button;
}
function row(parent,heading,detail,buttons=[]){
 const div=document.createElement('div');div.className='entry';
 const title=document.createElement('strong');title.textContent=heading;div.append(title);
 const body=document.createElement('p');body.textContent=detail;div.append(body);
 for(const b of buttons)div.append(b);
 parent.append(div);
}
function requireConfirm(text){
 return window.confirm(text+'\n\nBitte kontrolliere die Angaben. Diese Änderung wird protokolliert.');
}
async function toggle(resource,params,enabled){
 if(!requireConfirm((enabled?'Deaktivieren: ':'Aktivieren: ')+JSON.stringify(params)))return;
 await call('/v2/admin/'+resource+'/'+(enabled?'disable':'enable'),
  'POST',{...params,confirmation:'CONFIRM_OPERATOR_CHANGE'});
 output(resource+' wurde aktualisiert.');
}
async function loadProjects(){
 const data=await call('/v2/admin/projects');
 const holder=$('projects'),select=$('projectSelect');
 holder.replaceChildren();select.replaceChildren();
 for(const x of data.projects){
  const option=document.createElement('option');
  option.value=x.id;option.textContent=x.label+' ('+x.id.slice(0,8)+')';
  select.appendChild(option);
  const active=x.status==='active';
  row(holder,x.label,x.id+' · '+x.status+' · '+x.webhook_url,[
   action(active?'Deaktivieren':'Freigeben',async()=>{
    await toggle('projects',{projectId:x.id},active);await loadProjects();
   }),
   action('Neuen API-Schlüssel ausstellen',async()=>{
    if(!requireConfirm('Neuen Zugang für '+x.label+' erstellen?'))return;
    const result=await call('/v2/admin/keys','POST',{projectId:x.id});
    showSecret(result);
   })
  ]);
 }
 if(data.projects.length===0)output('Keine Projekte. Erstelle zuerst eines.');
}
function showSecret(data){
 const secrets={projectId:data.projectId,keyId:data.keyId,
  apiKey:data.apiKey,webhookSigningSecret:data.webhookSigningSecret};
 $('secretView').style.display='block';
 $('secrets').textContent=JSON.stringify(secrets,null,2);
 output('Neue Schlüssel wurden einmalig erzeugt. Bitte jetzt sicher verwahren.');
}
async function loadReceivers(){
 const data=await call('/v2/admin/receivers');
 const holder=$('receivers');holder.replaceChildren();
 for(const x of data.receivers){
  row(holder,x.chain+' · '+x.address,
   (x.enabled?'aktiv':'deaktiviert')+(x.assigned?' · bereits vergeben':' · frei'),[
   action(x.enabled?'Deaktivieren':'Aktivieren',async()=>{
    if(x.assigned)throw Error('Bereits verwendete Empfangsadressen dürfen nicht wieder freigegeben werden.');
    await toggle('receivers',{chain:x.chain,address:x.address},x.enabled);
    await loadReceivers();
   })
  ]);
 }
}
async function loadProducts(){
 const pid=$('projectSelect').value;
 if(!pid)throw Error('Bitte zuerst ein Projekt erstellen.');
 const data=await call('/v2/admin/products?projectId='+encodeURIComponent(pid));
 const holder=$('products');holder.replaceChildren();
 for(const x of data.products){
  const active=x.status==='active';
  row(holder,x.sku+' · '+x.title,
   (x.amount_minor/100).toFixed(2)+' '+x.currency+' · '+x.status,[
    action(active?'Deaktivieren':'Aktivieren',async()=>{
     await toggle('products',{projectId:pid,sku:x.sku},active);
     await loadProducts();
    })
   ]);
 }
}
async function loadRates(){
 const data=await call('/v2/admin/rates');
 const holder=$('rates');holder.replaceChildren();
 for(const x of data.rates){
  row(holder,x.fiat+' → '+x.asset,
   'Quelle: '+x.source+' · bis '+new Date(x.expires_at_ms).toLocaleString()+
   ' · '+(x.enabled?'aktiv':'deaktiviert'),[
    action(x.enabled?'Deaktivieren':'Aktivieren',async()=>{
     await toggle('rates',{fiat:x.fiat,asset:x.asset},x.enabled);
     await loadRates();
    })
   ]);
 }
}
async function connectWallet(){
 const p=trustProvider||window.trustwallet?.ethereum||
  (window.ethereum?.isTrust?window.ethereum:null);
 if(!p?.request)throw Error('Trust Wallet nicht erkannt. Bitte die offizielle Erweiterung oder den Trust-Wallet-Browser verwenden.');
 const chain=await p.request({method:'eth_chainId'});
 if(chain!=='0x1')throw Error('Bitte auf Ethereum Mainnet wechseln.');
 const accounts=await p.request({method:'eth_requestAccounts'});
 const address=accounts?.[0];
 if(!await validateReceivingAddress('ethereum',address))
  throw Error('Ungültige Ethereum-Adresse aus Wallet.');
 $('receiverChain').value='ethereum';$('receiver').value=address;
 output('Trust Wallet verbunden: ausschließlich öffentliche ETH-Adresse übertragen. Noch nicht für Zahlungen freigegeben.');
 if(p.on)p.on('accountsChanged',()=>{
  $('receiver').value='';
  output('Wallet-Konto geändert. Bitte erneut verbinden.',true);
 });
}
$('walletConnect').addEventListener('click',()=>connectWallet().catch(e=>output(e.message,true)));
$('status').addEventListener('click',async()=>{
 try{
  const r=await call('/v2/admin/status');
  output('Projekte: '+r.projects+' · offene Rechnungen: '+r.pending+
    ' · offene Webhooks: '+r.deliveryBacklog+
    ' · Checkout-Freigabe beantragt: '+(r.checkoutEnabled?'ja':'nein'));
 }catch(e){output(e.message,true)}
});
$('createProject').addEventListener('click',async()=>{
 try{
  if(!requireConfirm('Projekt '+$('projectName').value.trim()+' erstellen?'))return;
  const r=await call('/v2/admin/projects','POST',{
   label:$('projectName').value.trim(),webhookUrl:$('webhook').value.trim()});
  showSecret(r);await loadProjects();
 }catch(e){output(e.message,true)}
});
$('addReceiver').addEventListener('click',async()=>{
 try{
  const chain=$('receiverChain').value,address=$('receiver').value.trim();
  if(!await validateReceivingAddress(chain,address))
   throw Error('Empfangsadresse oder Netzwerk ungültig.');
  await call('/v2/admin/receivers','POST',{chain,address});
  output('Empfangsadresse deaktiviert gespeichert. Nach kontrolliertem Test freigeben.');
  await loadReceivers();
 }catch(e){output(e.message,true)}
});
$('saveProduct').addEventListener('click',async()=>{
 try{
  const amountMinor=Number($('minor').value);
  if(!Number.isSafeInteger(amountMinor)||amountMinor<1)throw Error('Ungültiger Preis.');
  await call('/v2/admin/products','POST',{
   projectId:$('projectSelect').value,sku:$('sku').value.trim(),
   title:$('title').value.trim(),currency:$('currency').value,amountMinor});
  output('Produkt deaktiviert hinterlegt.');await loadProducts();
 }catch(e){output(e.message,true)}
});
$('saveRate').addEventListener('click',async()=>{
 try{
  if(!requireConfirm('Manuellen Wechselkurs speichern?'))return;
  await call('/v2/admin/rates','POST',{
   fiat:$('rateCurrency').value,asset:$('rateAsset').value,
   numeratorAtomic:$('num').value.trim(),
   denominatorMinor:$('denom').value.trim(),validSeconds:600});
  output('Manueller Wechselkurs deaktiviert gespeichert.');await loadRates();
 }catch(e){output(e.message,true)}
});
$('loadProjects').addEventListener('click',()=>loadProjects().catch(e=>output(e.message,true)));
$('loadReceivers').addEventListener('click',()=>loadReceivers().catch(e=>output(e.message,true)));
$('loadProducts').addEventListener('click',()=>loadProducts().catch(e=>output(e.message,true)));
$('loadRates').addEventListener('click',()=>loadRates().catch(e=>output(e.message,true)));
$('clearSecrets').addEventListener('click',()=>{
 $('secrets').textContent='';$('secretView').style.display='none';
});
