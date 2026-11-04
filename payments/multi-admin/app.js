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
 const selected=select.value;
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
 if(data.projects.some(p=>p.id===selected))select.value=selected;
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
 if(!Array.isArray(accounts)||accounts.length<1||accounts.length>25)
  throw Error('Wallet hat keine oder zu viele freigegebene Adressen.');
 const addresses=[];
 for(const candidate of accounts){
  if(!await validateReceivingAddress('ethereum',candidate))
   throw Error('Ungültige öffentliche Ethereum-Adresse aus Wallet.');
  const address=candidate.toLowerCase();
  if(!addresses.some(x=>x.address===address))
   addresses.push({chain:'ethereum',address});
 }
 $('receiverChain').value='ethereum';$('receiver').value=addresses[0].address;
 output('Trust Wallet hat '+addresses.length+' öffentliche Ethereum-Adresse(n) freigegeben. Noch keine aktiviert.');
 // The wallet never sends seed phrases, private keys or spending permissions.
 // Explicit operator consent before importing watch-only addresses.
 if(window.confirm('Sollen '+addresses.length+' öffentliche Ethereum-Adresse(n) aus der Wallet beim Provider gesperrt hinterlegt werden? Keine Private Keys werden benötigt.')){
  const added=await call('/v2/admin/wallet-import','POST',{
   walletLabel:'Trust Wallet',addresses,
   confirmation:'CONFIRM_PUBLIC_ADDRESS_IMPORT'});
  output(added.count+' öffentliche Ethereum-Adresse(n) importiert. Zunächst deaktiviert; erst nach Empfangstest freigeben.');
  await loadReceivers();
 }
 if(p.on)p.on('accountsChanged',()=>{
  $('receiver').value='';
  output('Wallet-Konto geändert. Bitte erneut verbinden.',true);
 });
}
$('walletConnect').addEventListener('click',()=>connectWallet().catch(e=>output(e.message,true)));
$('status').addEventListener('click',async()=>{
 try{
  const r=await call('/v2/admin/status');
  const capacity=r.availableReceivers||{};
  const missing=(r.missingPrerequisites||[]).join(', ')||'keine';
  output('Projekte: '+r.projects+' · offene Rechnungen: '+r.pending+
    ' · ausstehende Webhooks: '+r.deliveryBacklog+
    ' · Webhooks mit vielen Fehlversuchen: '+(r.deliveryRetryFailures||0)+
    ' · manuelle Zahlungsprüfungen: '+(r.manualReviews||0)+
    ' · abgelaufene aktive Wechselkurse: '+(r.expiredEnabledRates||0)+
    ' · freie Empfangsadressen BTC/ETH/TRON/TON: '+(capacity.bitcoin||0)+'/'+
     (capacity.ethereum||0)+'/'+(capacity.tron||0)+'/'+(capacity.ton||0)+
    ' · Checkout aktiv: '+(r.checkoutEnabled?'ja':'nein')+
    (r.checkoutEnabled?'':' · fehlende Voraussetzungen: '+missing));
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

async function loadReviews(){
 const data=await call('/v2/admin/reviews');
 const holder=$('reviews');holder.replaceChildren();
 for(const item of data.reviews){
  const asset=item.asset||item.chain;
  const reason=item.reason==='underpaid'?'Unterzahlung':
   item.reason==='late'?'Verspätete Einzahlung':
   item.reason==='chain_reorg'?'Ketten-Neuorganisation':'Manuelle Prüfung';
  row(holder,reason+' · '+asset+' · '+item.tx_hash,
   'Projekt '+item.project_id+' · Rechnung '+item.invoice_id+
   ' · festgestellt '+new Date(item.created_at_ms).toLocaleString()+
   ' · Eingegangen (atomar): '+(item.actual_amount_atomic||'nicht erfasst'),[
   action('Als manuell geprüft schließen',async()=>{
    if(!window.confirm('Prüfung wirklich abschließen? Dies erzeugt weder Guthaben noch eine Rückzahlung.'))return;
    await call('/v2/admin/reviews/'+encodeURIComponent(item.id)+'/close',
     'POST',{confirmation:'I_HAVE_REVIEWED_PAYMENT',resolutionCode:'operator_reviewed'});
    await loadReviews();
   })
  ]);
 }
 if(!data.reviews.length){
  const p=document.createElement('p');p.textContent='Keine offenen Zahlungsprüfungen.';holder.appendChild(p);
 }
}
$('loadReviews').addEventListener('click',()=>loadReviews().catch(e=>output(e.message,true)));

let activePaymentProfile=null;
let paymentPage=null;
function selectedProject(){
 const id=$('projectSelect').value;
 if(!/^[0-9a-f-]{36}$/i.test(id))throw Error('Bitte erst ein Projekt erstellen oder auswählen.');
 return id;
}
const profileRoute=()=>'/v2/admin/projects/'+encodeURIComponent(selectedProject());
function setMethodSelectors(){
 if(!activePaymentProfile)return;
 const fiat=activePaymentProfile.fiatMethods.find(x=>x.currency===$('profileFiat').value);
 if(fiat){
  $('profileFiatEnabled').value=String(fiat.enabled);
  $('profileFiatMin').value=String(fiat.minMinor);
  $('profileFiatMax').value=String(fiat.maxMinor);
 }
 const crypto=activePaymentProfile.cryptoMethods.find(x=>x.asset===$('profileCrypto').value);
 if(crypto)$('profileCryptoEnabled').value=String(crypto.enabled);
}
function renderProjectPaymentProfile(config){
 activePaymentProfile=config;
 $('profileName').value=config.displayName;
 $('profileInvoices').value=String(config.invoicesEnabled);
 $('profileDeposits').value=String(config.depositsEnabled);
 $('profileProducts').value=String(config.productsEnabled);
 $('profileLifetime').value=String(config.invoiceLifetimeMinutes);
 $('projectWebhook').value=config.webhookUrl;
 setMethodSelectors();
 const box=$('profileSummary');box.replaceChildren();
 for(const f of config.fiatMethods){
  row(box,f.currency+' – '+(f.enabled?'freigegeben':'gesperrt'),
   'Minimum: '+f.minMinor+' · Maximum: '+f.maxMinor+' (jeweils Cent/Kopeken)');
 }
 for(const a of config.cryptoMethods)
  row(box,a.asset+' / '+a.chain,a.enabled?'Für dieses Projekt erlaubt':'Für dieses Projekt gesperrt');
}
async function loadProfile(){
 const p=await call(profileRoute()+'/payment-config');
 renderProjectPaymentProfile(p.config);
 output('Projekt-Zahlungsregeln geladen. Andere Projekte bleiben unverändert.');
}
$('loadProfile').addEventListener('click',()=>loadProfile().catch(e=>output(e.message,true)));
$('profileFiat').addEventListener('change',setMethodSelectors);
$('profileCrypto').addEventListener('change',setMethodSelectors);
$('projectSelect').addEventListener('change',()=>{
 activePaymentProfile=null;paymentPage=null;
 $('profileSummary').replaceChildren();
 $('projectSummary').replaceChildren();
 $('projectKeys').replaceChildren();
 $('projectPayments').replaceChildren();
 $('projectWebhook').value='';
 $('olderProjectPayments').disabled=true;
});
$('saveProfile').addEventListener('click',async()=>{
 try{
  const displayName=$('profileName').value.trim(),
   invoiceLifetimeMinutes=Number($('profileLifetime').value);
  if(!requireConfirm('Zahlungsintegration für dieses Projekt ändern?'))return;
  const result=await call(profileRoute()+'/payment-config','POST',{
   displayName,
   invoicesEnabled:$('profileInvoices').value==='true',
   depositsEnabled:$('profileDeposits').value==='true',
   productsEnabled:$('profileProducts').value==='true',
   invoiceLifetimeMinutes,confirmation:'CONFIRM_PROJECT_PAYMENT_SETTINGS'
  });
  renderProjectPaymentProfile(result.config);
  output('Zahlungsintegration gespeichert. Die Auswahl gilt nur für dieses Projekt.');
 }catch(e){output(e.message,true)}
});
$('saveProfileFiat').addEventListener('click',async()=>{
 try{
  if(!requireConfirm('Fiat-Währung für dieses Projekt ändern?'))return;
  const result=await call(profileRoute()+'/fiat-method','POST',{
   currency:$('profileFiat').value,
   enabled:$('profileFiatEnabled').value==='true',
   minMinor:Number($('profileFiatMin').value),
   maxMinor:Number($('profileFiatMax').value),
   confirmation:'CONFIRM_PROJECT_PAYMENT_SETTINGS'
  });
  renderProjectPaymentProfile(result.config);
  output('Fiat-Zahlungsregeln für dieses Projekt gespeichert.');
 }catch(e){output(e.message,true)}
});
$('saveProfileCrypto').addEventListener('click',async()=>{
 try{
  if(!requireConfirm('Kryptowährung für dieses Projekt ändern?'))return;
  const result=await call(profileRoute()+'/crypto-method','POST',{
   asset:$('profileCrypto').value,
   enabled:$('profileCryptoEnabled').value==='true',
   confirmation:'CONFIRM_PROJECT_PAYMENT_SETTINGS'
  });
  renderProjectPaymentProfile(result.config);
  output('Kryptowährung für dieses Projekt gespeichert.');
 }catch(e){output(e.message,true)}
});
$('loadProjectSummary').addEventListener('click',async()=>{
 try{
  const data=await call(profileRoute()+'/summary');
  const target=$('projectSummary');target.replaceChildren();
  row(target,'Projektübersicht','Ausstehende Webhook-Benachrichtigungen: '+data.undeliveredEvents);
  for(const item of data.invoiceCounts)
   row(target,item.fiat+' / '+item.status,'Rechnungen: '+item.invoice_count);
  output('Zahlungsstatistik für gewähltes Projekt geladen.');
 }catch(e){output(e.message,true)}
});
$('loadProjectKeys').addEventListener('click',async()=>{
 try{
  const data=await call(profileRoute()+'/keys');
  const target=$('projectKeys');target.replaceChildren();
  for(const key of data.keys){
   const buttons=[];
   if(key.status==='active')buttons.push(action('Zugangsschlüssel sperren',async()=>{
    if(!requireConfirm('API-Schlüssel '+key.id+' dauerhaft sperren? Andere Projekte bleiben unverändert.'))return;
    await call('/v2/admin/keys/revoke','POST',{
     projectId:selectedProject(),keyId:key.id,
     confirmation:'CONFIRM_KEY_REVOCATION'});
    $('loadProjectKeys').click();
   }));
   row(target,'API-Key '+key.id,
    key.status+' · erstellt '+new Date(key.created_at_ms).toLocaleString(),
    buttons);
  }
  if(!data.keys.length)row(target,'Keine Zugangsschlüssel','Projekt noch nicht eingerichtet.');
  output('Projekt-Zugangsschlüssel geladen; geheime Werte werden nicht angezeigt.');
 }catch(e){output(e.message,true)}
});
$('saveProjectWebhook').addEventListener('click',async()=>{
 try{
  const webhookUrl=$('projectWebhook').value.trim();
  if(!requireConfirm('Webhook-Adresse für dieses Projekt ändern?'))return;
  await call('/v2/admin/projects/webhook','POST',{
   projectId:selectedProject(),webhookUrl,
   confirmation:'CONFIRM_WEBHOOK_UPDATE'});
  output('Projekt-Webhook aktualisiert.');
 }catch(e){output(e.message,true)}
});
async function loadProjectPayments(older=false){
 const pid=selectedProject(),filter=$('paymentFilter').value;
 if(!older||!paymentPage||paymentPage.pid!==pid||paymentPage.filter!==filter)
  paymentPage={pid,filter,before:null,beforeId:null};
 const url=new URLSearchParams({status:filter,limit:'50'});
 if(older&&paymentPage.before!=null){
  url.set('before',String(paymentPage.before));
  url.set('beforeId',paymentPage.beforeId);
 }
 const result=await call(profileRoute()+'/payments?'+url.toString());
 const holder=$('projectPayments');
 if(!older)holder.replaceChildren();
 for(const payment of result.payments){
  const amount=(Math.floor(payment.amountMinor/100)).toLocaleString('de-DE')+
   ','+String(payment.amountMinor%100).padStart(2,'0');
  row(holder,payment.invoiceId+' · '+payment.status,
   amount+' '+payment.fiat+' · '+payment.asset+' ('+payment.chain+')'+
   ' · Transaktion: '+(payment.transactionHash||'noch nicht bestätigt')+
   ' · Projekt-Webhook: '+(payment.webhookDelivered?'zugestellt':'ausstehend'));
 }
 paymentPage.before=result.nextBefore;
 paymentPage.beforeId=result.nextBeforeId;
 $('olderProjectPayments').disabled=result.payments.length<50||!result.nextBeforeId;
 if(!result.payments.length&&!older)
  row(holder,'Keine Rechnungen','Für diese Auswahl sind keine Zahlungen vorhanden.');
 output('Zahlungsübersicht nur für dieses Projekt geladen.');
}
$('loadProjectPayments').addEventListener('click',
 ()=>loadProjectPayments(false).catch(e=>output(e.message,true)));
$('olderProjectPayments').addEventListener('click',
 ()=>loadProjectPayments(true).catch(e=>output(e.message,true)));
