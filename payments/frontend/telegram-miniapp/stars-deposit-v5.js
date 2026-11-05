// RUST UP wallet: user-selected RUB amount for Telegram Stars. No fixed products.
// Amount and XTR price are server validated; no browser-side exchange rate.
// Does not change the existing game account state or authorize cash withdrawals.
(() => {
 'use strict';
 const make=(tag,cls,text)=>{
  const n=document.createElement(tag);
  if(cls)n.className=cls;
  if(text!==undefined)n.textContent=String(text);
  return n;
 };
 const errorLabel=e=>{
  if(e?.code==='conversion_not_configured')return 'Курс Stars пока не настроен. Оплата недоступна.';
  if(e?.code==='invalid_amount_or_range')return 'Сумма за пределами допустимого диапазона.';
  if(e?.code==='history_unavailable')return 'История сейчас недоступна. Повторите попытку.';
  if(e?.name==='AbortError'||e?.name==='TimeoutError')
   return 'Превышено время ожидания сервера. Повторите попытку.';
  if(e?.status===401){
   const initData=window.Telegram?.WebApp?.initData;
   if(typeof initData!=='string'||initData.length<20)
    return 'Telegram не передал данные авторизации. Напишите /start боту @rustuper_bot и откройте приложение кнопкой 🎮 Играть.';
   return 'Сервер не подтвердил Telegram-сессию. Закройте мини-приложение и откройте снова кнопкой 🎮 Играть из /start у @rustuper_bot.';
  }
  if(e?.status===403)return 'Доступ отклонён. Откройте приложение через @rustuper_bot.';
  if(e?.status===422)return 'Проверьте сумму пополнения и установленные ограничения.';
  if(e?.status===503)return 'Оплата пока отключена. Попробуйте позже.';
  return 'Не удалось связаться с платёжным сервером. Повторите попытку.';
 };
 function parseAmountMinor(text){
  // Accept Russian decimal comma but never round user-controlled money.
  if(typeof text!=='string')return null;
  const value=text.trim().replace(/\u00a0/g,' ');
  if(!/^([1-9]\d{0,6})([.,]\d{1,2})?$/.test(value))return null;
  const [major,minor='']=value.replace(',','.').split('.');
  const result=Number(major)*100+Number(minor.padEnd(2,'0'));
  return Number.isSafeInteger(result)&&result>=100&&result<=100000000?result:null;
 }
 const orderStatus=Object.freeze({
  pending:'Ожидает оплаты',
  checkout_approved:'Ожидает подтверждения',
  paid:'Оплата подтверждена',
  refunded:'Возвращено',
  manual_review:'Проверяется поддержкой'
 });
 const formatRub=minor=>(minor/100).toLocaleString('ru-RU',{
  minimumFractionDigits:2,maximumFractionDigits:2
 });
 async function request(action,body={},signal){
  const initData=window.Telegram?.WebApp?.initData;
  const base=window.RUSTUP_API;
  if(typeof initData!=='string'||initData.length<20)
   throw {status:401};
  if(typeof base!=='string'||!/^https:\/\/[a-z0-9.-]+\/?$/i.test(base))
   throw {status:503};
  const resp=await fetch(base.replace(/\/$/,'')+'/api/stars/variable/'+action,{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({initData,...body}),cache:'no-store',credentials:'omit',signal
  });
  let data;
  try{data=await resp.json();}catch{throw {status:resp.status};}
  if(!resp.ok||data?.ok!==true)throw {status:resp.status,code:data?.error};
  return data;
 }
 function render(wallet){
  const panel=wallet?.querySelector('.w-glass.w-panel[role="status"]');
  if(!panel||panel.dataset.variableStarsV4)return;
  panel.dataset.variableStarsV4='1';
  panel.classList.add('rustup-stars-variable');
  panel.replaceChildren();
  panel.append(make('h3','w-h3','⭐ Пополнение через Telegram Stars'));
  panel.append(make('p','w-note','Введите сумму самостоятельно. Фиксированных пакетов нет.'));
  const label=make('label','rustup-amount-label','Сумма пополнения, ₽');
  const input=make('input','rustup-amount-input');
  input.type='text';input.inputMode='decimal';
  input.autocomplete='off';input.placeholder='Например: 1500 или 250,50';
  input.maxLength=12;label.append(input);panel.append(label);
  const quoteButton=make('button','rustup-stars-retry','Рассчитать сумму в Stars');
  quoteButton.type='button';panel.append(quoteButton);
  const summary=make('p','w-note rustup-stars-status','Стоимость будет рассчитана сервером.');
  summary.setAttribute('role','status');panel.append(summary);
  const payButton=make('button','rustup-stars-buy','Оплатить через Telegram ⭐');
  payButton.type='button';payButton.disabled=true;panel.append(payButton);
  const historyButton=make('button','rustup-stars-tab','Мои пополнения');
  historyButton.type='button';panel.append(historyButton);
  const history=make('div','rustup-stars-results');panel.append(history);

  panel.append(make('p','w-note',
   'Счёт создаёт Telegram. Зачисление возможно только после подтверждения платежа сервером.'));
  const help=make('a','rustup-stars-help','Поддержка: @rustuperhelp_bot');
  help.href='https://t.me/rustuperhelp_bot';panel.append(help);
  let confirmed=null,loading=false,seq=0;
  function reset(){
   // Invalidate any quote still in flight when the player changes the amount.
   seq++;
   confirmed=null;payButton.disabled=true;
   summary.textContent='Стоимость будет рассчитана сервером.';
  }
  input.addEventListener('input',reset);
  quoteButton.addEventListener('click',async()=>{
   if(loading)return;
   const minor=parseAmountMinor(input.value);
   if(minor===null){summary.textContent='Введите корректную сумму в рублях.';return;}
   const turn=++seq;loading=true;quoteButton.disabled=true;payButton.disabled=true;
   summary.textContent='Расчёт стоимости…';
   try{
    const data=await request('quote',{amountMinor:minor},AbortSignal.timeout(12000));
    if(!panel.isConnected||turn!==seq)return;
    if(data.requestedAmountMinor!==minor||!Number.isSafeInteger(data.priceStars))
     throw {status:503};
    const money=formatRub(minor);
    summary.textContent=money+' ₽ → '+data.priceStars+' ⭐'+
      (data.checkoutEnabled===true?'':' · Оплата пока недоступна');
    confirmed={minor,priceStars:data.priceStars};
    payButton.disabled=data.checkoutEnabled!==true;
   }catch(e){if(panel.isConnected)summary.textContent=errorLabel(e);}
   finally{loading=false;if(panel.isConnected)quoteButton.disabled=false;}
  });
  payButton.addEventListener('click',async()=>{
   if(loading||!confirmed||payButton.disabled)return;
   const minor=parseAmountMinor(input.value);
   if(minor!==confirmed.minor)return reset();
   if(typeof window.Telegram?.WebApp?.openInvoice!=='function')return;
   if(typeof crypto?.randomUUID!=='function')return;
   loading=true;payButton.disabled=true;
   summary.textContent='Создание счёта Telegram…';
   try{
    const data=await request('checkout',{amountMinor:minor,requestId:crypto.randomUUID()},
      AbortSignal.timeout(15000));
    if(!panel.isConnected)return;
    const link=new URL(data.invoiceUrl);
    if(data.creditedToGame!==false||link.protocol!=='https:'||
       link.hostname!=='t.me'||!/^\/\$[A-Za-z0-9_-]{8,256}$/.test(link.pathname))
      throw {status:503};
    window.Telegram.WebApp.openInvoice(data.invoiceUrl,result=>{
      if(!panel.isConnected)return;
      if(result==='paid')summary.textContent='Оплата выполнена. Ожидается подтверждение сервера.';
      else if(result==='cancelled')summary.textContent='Оплата отменена.';
      else summary.textContent='Платёж не подтверждён. Проверьте историю.';
    });
   }catch(e){if(panel.isConnected)summary.textContent=errorLabel(e);}
   finally{loading=false;payButton.disabled=true;}
  });
  let historyBusy=false;
  historyButton.addEventListener('click',async()=>{
   if(historyBusy)return;
   historyBusy=true;historyButton.disabled=true;
   history.replaceChildren(make('p','w-note','Загрузка…'));
   try{
    const data=await request('history',{},AbortSignal.timeout(12000));
    if(!panel.isConnected)return;
    history.replaceChildren();
    if(!Array.isArray(data.orders)||data.orders.length===0){
      history.append(make('p','w-note','Пополнений пока нет.'));return;
    }
    for(const order of data.orders.slice(0,50)){
     const item=make('div','rustup-stars-item');
     const minor=Number(order.requested_amount_minor);
     item.append(make('strong','',
      Number.isSafeInteger(minor)&&minor>=0?formatRub(minor)+' ₽':'Заказ'));
     const status=Object.hasOwn(orderStatus,order.status)
       ?orderStatus[order.status]:'Статус уточняется';
     const stars=Number.isSafeInteger(order.price_stars)&&order.price_stars>=0
       ?order.price_stars:'—';
     item.append(make('p','w-note',String(stars)+' ⭐ · '+status));
     history.append(item);
    }
   }catch(e){if(panel.isConnected)history.replaceChildren(make('p','w-note',errorLabel(e)));}
   finally{historyBusy=false;if(panel.isConnected)historyButton.disabled=false;}
  });
 }
 window.RUSTUP_STARS_VARIABLE_V4=Object.freeze({render,parseAmountMinor});
})();