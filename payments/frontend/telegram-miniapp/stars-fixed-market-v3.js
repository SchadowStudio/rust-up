// RUST UP existing Telegram Mini App: fixed digital goods via native Telegram Stars invoice.
// Checkouts are visible ONLY when the server explicitly returns checkoutEnabled=true.
// No case/wager balance credit, crypto checkout, direct user-id trust or client-side fulfillment.
(() => {
  'use strict';
  const el=(tag,cls,txt)=>{
    const node=document.createElement(tag);
    if(cls)node.className=cls;
    if(txt!==undefined)node.textContent=String(txt);
    return node;
  };
  function errorText(error) {
    if(error?.code==='no_telegram')return 'Откройте приложение через @rustuper_bot в Telegram.';
    if(error?.code==='expired'||error?.status===401)
      return 'Сессия Telegram устарела. Закройте Mini App и откройте заново.';
    if(error?.status===403)return 'Доступ к Stars API отклонён. Обратитесь в поддержку.';
    if(error?.status===404)return 'Stars API ещё не подключён к этой версии бота.';
    if(error?.status===503)return 'Stars API временно недоступен. Попробуйте позже.';
    if(error?.code==='timeout')return 'Превышено время ожидания ответа сервера.';
    return 'Нет связи с Stars API. Проверьте подключение и повторите попытку.';
  }
  async function api(view,signal,sku) {
    if(view!=='catalog'&&view!=='purchases'&&view!=='checkout'&&
       view!=='terms'&&view!=='terms/accept')
      throw Error('unsupported_stars_route');
    if(view==='checkout'&&(typeof sku!=='string'||!/^[a-z][a-z0-9_-]{2,39}$/.test(sku)))
      throw Error('invalid_product');
    const initData=window.Telegram?.WebApp?.initData;
    if(typeof initData!=='string'||initData.length<20)throw {code:'no_telegram'};
    // Let the server validate auth_date and the Telegram HMAC signature.
    // Browser clocks may be wrong and this Mini App can stay open for hours.
    // Read-only server endpoints enforce a bounded TTL; payment gates stay OFF.
    const base=window.RUSTUP_API;
    if(typeof base!=='string'||!/^https:\/\/[a-z0-9.-]+\/?$/i.test(base))
      throw {code:'invalid_api'};
    const response=await fetch(base.replace(/\/$/,'')+'/api/stars/'+view,{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify(view==='checkout'?{initData,sku}:
        view==='terms/accept'?{initData,accepted:true,version:sku}:{initData}),
      credentials:'omit',cache:'no-store',signal
    });
    let data;
    try{data=await response.json();}
    catch{throw {status:response.status,code:'invalid_json'};}
    if(!response.ok||data?.ok!==true)
      throw {status:response.status,code:data?.error||'stars_api_rejected'};
    return data;
  }
  function render(wallet) {
    const panel=wallet?.querySelector('.w-glass.w-panel[role="status"]');
    if(!panel||panel.dataset.starsReadOnlyV2)return;
    panel.dataset.starsReadOnlyV2='1';
    panel.classList.add('rustup-stars-readonly');
    panel.replaceChildren(
      el('h3','w-h3','⭐ Telegram Stars'),
      el('p','w-note','Цифровые товары внутри Telegram. Игровой баланс не пополняется.')
    );
    const tabs=el('div','rustup-stars-tabs');
    const shop=el('button','rustup-stars-tab','Магазин');
    const mine=el('button','rustup-stars-tab','Мои покупки');
    for(const button of [shop,mine]) {
      button.type='button';
      tabs.append(button);
    }
    panel.append(tabs);
    const status=el('p','w-note rustup-stars-status');
    status.setAttribute('role','status');
    panel.append(status);
    const termsPanel=el('div','w-note rustup-stars-terms');
    termsPanel.setAttribute('role','group');
    panel.append(termsPanel);
    const results=el('div','rustup-stars-results');
    panel.append(results);
    const retry=el('button','rustup-stars-retry','Повторить');
    retry.type='button';
    retry.hidden=true;
    panel.append(retry);
    panel.append(el('p','w-note',
      'Только фиксированные цифровые товары. Stars не пополняют баланс для кейсов, ставок, апгрейдов или вывода.'));
    const help=el('a','rustup-stars-help','Поддержка: @rustuperhelp_bot');
    help.href='https://t.me/rustuperhelp_bot';
    help.dataset.tgLink='';
    panel.append(help);
    let seq=0,active='catalog',controller,checkoutRunning=false;
    let termsAccepted=false;
    const trustedInvoiceUrl=(value)=>{
      try{
        const url=new URL(value);
        return url.protocol==='https:' && url.hostname==='t.me' &&
          !url.username && !url.password && !url.port &&
          /^\/\$[a-zA-Z0-9_-]{8,256}$/.test(url.pathname) && !url.hash;
      }catch{return false;}
    };
    async function buy(sku,button){
      if(!termsAccepted){
        status.textContent='Сначала прочитайте и примите условия оплаты.';
        return;
      }
      if(checkoutRunning||!panel.isConnected||!window.Telegram?.WebApp?.initData)return;
      checkoutRunning=true;
      button.disabled=true;
      status.textContent='Создание счёта Telegram…';
      try{
        const data=await api('checkout',AbortSignal.timeout(12000),sku);
        if(!panel.isConnected)return;
        if(data.creditToGame!==false||!trustedInvoiceUrl(data.invoiceUrl)||
           typeof window.Telegram?.WebApp?.openInvoice!=='function')
          throw Error('invalid_invoice');
        window.Telegram.WebApp.openInvoice(data.invoiceUrl,async result=>{
          if(!panel.isConnected)return;
          if(result==='paid'){
            status.textContent='Оплата подтверждается. Проверьте «Мои покупки».';
            await load('purchases');
          }else if(result==='cancelled')status.textContent='Платёж отменён.';
          else status.textContent='Платёж не подтверждён. Проверьте покупки и поддержку.';
        });
      }catch(error){
        if(panel.isConnected)status.textContent=
          error?.code==='expired'||error?.status===401
          ?'Откройте Mini App заново для покупки.'
          :'Не удалось создать счёт. Повторите позже или обратитесь в поддержку.';
      }finally{
        checkoutRunning=false;
        if(panel.isConnected)button.disabled=false;
      }
    }
    async function load(view) {
      active=view;
      const id=++seq;
      controller?.abort();
      controller=new AbortController();
      const signal=controller.signal;
      shop.classList.toggle('on',view==='catalog');
      mine.classList.toggle('on',view==='purchases');
      shop.setAttribute('aria-pressed',String(view==='catalog'));
      mine.setAttribute('aria-pressed',String(view==='purchases'));
      status.textContent='Проверка доступности…';
      results.replaceChildren();
      retry.hidden=true;
      const timeout=setTimeout(()=>controller.abort(),10000);
      try {
        const data=await api(view,signal);
        if(!panel.isConnected||id!==seq)return;
        const canBuy=view==='catalog'&&data.checkoutEnabled===true&&
          data.termsAccepted===true&&termsAccepted&&
          typeof window.Telegram?.WebApp?.openInvoice==='function';
        status.textContent=canBuy?'Оплата Stars доступна':'Покупки пока отключены';
        const items=view==='catalog'?data.products:data.purchases;
        if(!Array.isArray(items)||items.length===0) {
          results.append(el('p','w-note',
            view==='catalog'?'Товары пока не добавлены.':'Покупок пока нет.'));
          return;
        }
        for(const item of items.slice(0,100)) {
          const card=el('div','rustup-stars-item');
          card.append(el('strong','',view==='catalog'
            ?item.title||item.sku||'Товар':item.sku||'Цифровой товар'));
          if(view==='catalog') {
            card.append(el('p','w-note',item.description||''));
            card.append(el('p','w-note',String(item.price_stars||0)+' ⭐'));
            if(canBuy && typeof item.sku==='string' &&
               /^[a-z][a-z0-9_-]{2,39}$/.test(item.sku) &&
               Number.isSafeInteger(item.price_stars) && item.price_stars>0){
              const button=el('button','rustup-stars-buy','Купить за '+item.price_stars+' ⭐');
              button.type='button';
              button.addEventListener('click',()=>buy(item.sku,button));
              card.append(button);
            }
          } else {
            const time=Number(item.paid_at_ms);
            if(Number.isFinite(time)&&time>0)
              card.append(el('p','w-note',new Date(time).toLocaleString('ru-RU')));
            card.append(el('pre','rustup-stars-delivery',item.delivery_text||''));
          }
          results.append(card);
        }
      } catch(error) {
        if(!panel.isConnected||id!==seq)return;
        status.textContent=signal.aborted?'Превышено время ожидания ответа сервера.':errorText(error);
        retry.hidden=false;
      } finally {
        clearTimeout(timeout);
      }
    }
    shop.addEventListener('click',()=>{if(active!=='catalog')load('catalog');});
    mine.addEventListener('click',()=>{if(active!=='purchases')load('purchases');});
    retry.addEventListener('click',()=>load(active));
    load('catalog');
  }
  window.RUSTUP_STARS_FIXED_MARKET_V3=Object.freeze({render});
})();