/* TEMPORARY read-only Stars diagnostic; remove after operator confirms result.
   Does not persist Telegram initData, create invoices or change balances. */
(function () {
  'use strict';
  if (window.__rustupTempStarsDiag) return;
  window.__rustupTempStarsDiag = true;
  function mount() {
    var tg=window.Telegram&&window.Telegram.WebApp;
    var button=document.createElement('button');
    button.type='button';
    button.textContent='Stars-Test';
    button.setAttribute('aria-label','Stars-Verbindung testen');
    button.style.cssText='position:fixed;right:12px;bottom:84px;z-index:2147483600;border:1px solid #f8b942;border-radius:13px;background:#1a1a1f;color:#ffe4a5;padding:12px 16px;font:700 14px Rubik,sans-serif;box-shadow:0 8px 25px #0009';
    var panel=document.createElement('div');
    panel.style.cssText='display:none;position:fixed;inset:12px 12px auto;top:12%;z-index:2147483601;max-width:410px;margin:auto;background:#17181d;border:1px solid #f5b641;border-radius:16px;color:#f8f8f8;padding:20px;font:14px/1.6 Rubik,sans-serif;box-shadow:0 18px 60px #000c';
    var title=document.createElement('strong');title.textContent='RUST UP · Stars-Diagnose';title.style.cssText='display:block;font-size:17px;color:#ffc75b;margin-bottom:10px';
    var output=document.createElement('pre');output.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.7 monospace;color:#e9e9e9';
    var close=document.createElement('button');close.type='button';close.textContent='Schließen';close.style.cssText='background:#eab446;color:#151515;border:0;border-radius:8px;padding:9px 15px;font-weight:700';
    panel.append(title,output,close);
    document.body.append(button,panel);
    var done=false;
    function cleanup(){button.remove();panel.remove();}
    close.onclick=cleanup;
    button.onclick=async function(){
      if(done)return;
      done=true;panel.style.display='block';button.style.display='none';
      var lines=['1. Telegram SDK: '+(tg?'OK':'NICHT ERKANNT')];
      var initData=tg&&tg.initData;
      lines.push('2. Telegram initData: '+(initData?'VORHANDEN':'FEHLT'));
      output.textContent=lines.join('\n')+'\n3. Serverprüfung läuft …';
      if(!initData){output.textContent=lines.join('\n')+'\n3. Serverprüfung: NICHT MÖGLICH\nBitte die Mini-App im Telegram-Bot starten.';return;}
      try{
        var response=await fetch('https://rustup-bot.ttzoomrust.workers.dev/api/stars/variable/quote',{
          method:'POST',headers:{'content-type':'application/json'},cache:'no-store',
          body:JSON.stringify({initData:initData,amountMinor:183}),signal:AbortSignal.timeout(15000)
        });
        var data=await response.json();
        lines.push('3. HTTP: '+response.status);
        lines.push('4. Telegram Auth: '+(response.status===200&&data.ok===true?'OK':'FEHLER'));
        lines.push('5. 1 Star = 1,83 RUB: '+(data.priceStars===1&&data.requestedAmountMinor===183?'OK':'NICHT BESTÄTIGT'));
        lines.push('6. Checkout: '+(data.checkoutEnabled===true?'AKTIV':'DEAKTIVIERT'));
        if(data.error)lines.push('Fehlercode: '+String(data.error).slice(0,70));
        output.textContent=lines.join('\n')+'\n\nKeine Zahlung ausgelöst. Ergebnis bitte als Screenshot senden.';
      }catch(e){
        lines.push('3. Netzwerkfehler: '+String(e&&e.name||'Fehler'));
        output.textContent=lines.join('\n')+'\nKeine Zahlung ausgelöst.';
      }
      // One-time visual tool; after closing it is gone for this page visit.
    };
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
