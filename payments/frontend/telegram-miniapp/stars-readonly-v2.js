// Read-only Telegram Stars digital goods and receipts INSIDE the existing RUST UP Mini App.
// No createInvoiceLink, no payment checkout and no game balance credit.
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
  async function api(view,signal) {
    if(view!=='catalog'&&view!=='purchases')throw Error('unsupported_stars_route');
    const initData=window.Telegram?.WebApp?.initData;
    if(typeof initData!=='string'||initData.length<20)throw {code:'no_telegram'};
    const authDate=Number(new URLSearchParams(initData).get('auth_date'));
    const now=Math.floor(Date.now()/1000);
    // Server accepts at most 600 seconds and up to 60 seconds future skew.
    if(!Number.isSafeInteger(authDate)||authDate<now-600||authDate>now+60)
      throw {code:'expired'};
    const base=window.RUSTUP_API;
    if(typeof base!=='string'||!/^https:\/\/[a-z0-9.-]+\/?$/i.test(base))
      throw {code:'invalid_api'};
    const response=await fetch(base.replace(/\/$/,'')+'/api/stars/'+view,{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({initData}),credentials:'omit',cache:'no-store',signal
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
    const results=el('div','rustup-stars-results');
    panel.append(results);
    const retry=el('button','rustup-stars-retry','Повторить');
    retry.type='button';
    retry.hidden=true;
    panel.append(retry);
    panel.append(el('p','w-note',
      'Оплата отключена. Stars не используются для кейсов, ставок, апгрейдов или вывода.'));
    const help=el('a','rustup-stars-help','Поддержка: @rustuperhelp_bot');
    help.href='https://t.me/rustuperhelp_bot';
    help.dataset.tgLink='';
    panel.append(help);
    let seq=0,active='catalog',controller;
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
        status.textContent='Покупки пока отключены';
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
            card.append(el('p','w-note',String(item.price_stars||0)+' ⭐ · Продажи отключены'));
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
  window.RUSTUP_STARS_READONLY_V2=Object.freeze({render});
})();