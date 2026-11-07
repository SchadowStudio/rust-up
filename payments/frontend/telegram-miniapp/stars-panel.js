// RUST UP Telegram Mini App: Stars section in EXISTING Wallet > Deposit, not a new route or public shop.
// All catalog, invoice and ownership data is requested with signed Telegram initData.
(() => {
  'use strict';
  const $=(id)=>document.getElementById(id);
  const element=(tag,cls,value)=>{
    const n=document.createElement(tag);
    if(cls)n.className=cls;
    if(value!==undefined)n.textContent=String(value);
    return n;
  };
  const tg=()=>window.Telegram?.WebApp;
  function apiAvailable(){
    const t=tg();
    return !!(t?.initData&&typeof window.RUSTUP_API==='string'&&
      window.RUSTUP_API.startsWith('https://'));
  }
  async function api(action,payload={}){
    if(!apiAvailable())throw Error('not_in_telegram');
    const response=await fetch(window.RUSTUP_API.replace(/\/$/,'')+'/api/stars/'+action,{
      method:'POST',cache:'no-store',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({initData:tg().initData,...payload})
    });
    const data=await response.json().catch(()=>({ok:false,error:'network'}));
    if(!response.ok||data.ok!==true)throw Error(data.error||'service_unavailable');
    return data;
  }
  function render(target){
    if(!target)return;
    target.replaceChildren();
    const main=element('section','page rustup-stars-page');
    const h=element('h1','up-title','⭐ Telegram Stars');
    const note=element('p','rustup-stars-note',
      'Цифровые товары внутри RUST UP. Товары не пополняют игровой баланс и не участвуют в кейсах или ставках.');
    const status=element('p','rustup-stars-status','Проверка доступности…');
    const tab=element('div','rustup-stars-tabs');
    const catalogButton=element('button','rustup-stars-tab on','Магазин');
    const purchaseButton=element('button','rustup-stars-tab','Мои покупки');
    catalogButton.type=purchaseButton.type='button';
    const content=element('div','rustup-stars-content');
    const support=element('p','rustup-stars-help');
    support.append('Проблемы с оплатой? ');
    const link=element('a','','@rustuperhelp_bot');
    link.href='https://t.me/rustuperhelp_bot';
    link.rel='noopener noreferrer';
    support.append(link);
    tab.append(catalogButton,purchaseButton);
    main.append(h,note,status,tab,content,support);target.append(main);
    let busy=false,mode='catalog';
    const stillHere=()=>target.contains(main)&&target.isConnected&&target.id==='rustupStarsBody'&&location.hash.replace(/^#/,'').startsWith('/wallet');
    const loading=()=>content.replaceChildren(element('p','rustup-stars-empty','Загрузка…'));
    const error=(msg)=>content.replaceChildren(element('p','rustup-stars-empty',msg));
    async function showCatalog(){
      mode='catalog';catalogButton.classList.add('on');purchaseButton.classList.remove('on');
      loading();
      try{
        const d=await api('catalog');
        if(!stillHere())return;
        status.textContent=d.checkoutEnabled?'Оплата Stars доступна':'Покупки пока отключены';
        content.replaceChildren();
        if(!d.products?.length)content.append(element('p','rustup-stars-empty','Доступных товаров пока нет.'));
        for(const p of d.products||[]){
          const card=element('article','rustup-stars-product');
          const info=element('div');
          info.append(element('strong','',p.title),element('p','rustup-stars-note',p.description));
          const action=element('div','rustup-stars-action');
          action.append(element('b','',p.price_stars+' ⭐'));
          const button=element('button','rustup-stars-buy','Купить');
          button.type='button';button.disabled=!d.checkoutEnabled;
          button.addEventListener('click',()=>buy(p.sku,button));
          action.append(button);
          card.append(info,action);content.append(card);
        }
      }catch{if(stillHere())error('Нет связи с оплатой. Попробуйте позже.');}
    }
    async function showPurchases(){
      mode='purchases';catalogButton.classList.remove('on');purchaseButton.classList.add('on');
      loading();
      try{
        const d=await api('purchases');
        if(!stillHere())return;
        content.replaceChildren();
        if(!d.purchases?.length)content.append(element('p','rustup-stars-empty','Подтверждённых покупок пока нет.'));
        for(const p of d.purchases||[]){
          const card=element('article','rustup-stars-product rustup-stars-owned');
          card.append(element('strong','',p.sku),
            element('small','',p.price_stars+' ⭐ · '+new Date(p.paid_at_ms).toLocaleString('ru-RU')),
            element('pre','rustup-stars-delivery',p.delivery_text));
          content.append(card);
        }
      }catch{if(stillHere())error('Не удалось загрузить покупки.');}
    }
    async function buy(sku,button){
      if(busy||!stillHere())return;
      busy=true;button.disabled=true;
      try{
        const d=await api('checkout',{sku});
        if(!stillHere())return;
        if(!/^https:\/\//.test(d.invoiceUrl)||typeof tg()?.openInvoice!=='function')
          throw Error('invoice_unavailable');
        tg().openInvoice(d.invoiceUrl,(result)=>{
          if(!stillHere())return;
          if(result==='paid'){
            status.textContent='Чек Telegram получен. Подтверждение товара может занять некоторое время.';
            showPurchases();
          }else if(result==='cancelled'){
            status.textContent='Оплата отменена.';
          }else if(result==='failed'){
            status.textContent='Платёж не прошёл. Сохраните чек и обратитесь в поддержку.';
          }
        });
      }catch{
        if(stillHere())status.textContent='Создать счёт не удалось. Проверьте магазин позже.';
      }finally{busy=false;if(stillHere())button.disabled=false;}
    }
    catalogButton.addEventListener('click',showCatalog);
    purchaseButton.addEventListener('click',showPurchases);
    if(!apiAvailable()){
      status.textContent='Откройте RUST UP через Telegram.';
      error('Без подтверждённого Telegram-профиля покупки недоступны.');
      return;
    }
    tg().ready();showCatalog();
  }
  window.RUSTUP_STARS_PANEL=Object.freeze({render});
})();