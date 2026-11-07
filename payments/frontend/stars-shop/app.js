(() => {
 'use strict';
 const TG=window.Telegram?.WebApp;
 const base=String(window.RUSTUP_STARS_API||'').replace(/\/$/,'');
 const $=id=>document.getElementById(id);
 function node(tag,cls,text){
  const n=document.createElement(tag);
  if(cls)n.className=cls;
  if(text!==undefined)n.textContent=String(text);
  return n;
 }
 function notice(text){let e=$('notice');if(!e){e=node('div','',text);e.id='notice';$('gate').after(e);}else e.textContent=text;}
 if(!TG?.initData||!base.startsWith('https://')){
  $('catalog').textContent='Откройте каталог через кнопку /stars в @rustuper_bot.';
  $('owned').textContent='Для просмотра покупок откройте приложение в Telegram.';
  $('gate').textContent='Ожидание Telegram';
  $('refresh').disabled=true;
  return;
 }
 TG.ready();TG.expand();
 async function api(path,extra={}){
  const response=await fetch(base+'/api/stars/'+path,{
   method:'POST',cache:'no-store',headers:{'content-type':'application/json'},
   body:JSON.stringify({initData:TG.initData,...extra})
  });
  const result=await response.json().catch(()=>({ok:false}));
  if(!response.ok||result.ok!==true)throw Error(result.error||'Ошибка '+response.status);
  return result;
 }
 let loading=false;
 async function catalog(){
  try{
   const r=await api('catalog');
   $('gate').textContent=r.checkoutEnabled?'⭐ Telegram Stars включён':'Покупки временно отключены';
   const dest=$('catalog');dest.replaceChildren();
   if(!r.products?.length)dest.append(node('p','empty','Пока нет доступных цифровых товаров.'));
   for(const product of r.products||[]){
    const card=node('section','product');
    const info=node('div');info.append(node('strong','',product.title),node('p','description',product.description));
    const action=node('div');
    action.append(node('p','price',product.price_stars+' ⭐'));
    const button=node('button','','Купить');
    button.disabled=!r.checkoutEnabled;
    button.addEventListener('click',()=>purchase(product.sku,button));
    action.append(button);card.append(info,action);dest.append(card);
   }
  }catch{notice('Не удалось загрузить каталог. Попробуйте позже.');}
 }
 async function purchases(){
  try{
   const r=await api('purchases'),root=$('owned');root.replaceChildren();
   if(!r.purchases?.length){root.append(node('p','empty','Оплаченных цифровых товаров пока нет.'));return;}
   for(const p of r.purchases){
    const entry=node('section','purchase');
    entry.append(node('strong','',p.sku),node('p','detail',
     'Заказ '+p.id+' · '+p.price_stars+' ⭐ · '+
     new Date(p.paid_at_ms).toLocaleString('ru-RU')));
    entry.append(node('div','owned-text',p.delivery_text));
    root.append(entry);
   }
  }catch{notice('Не удалось получить историю покупок.');}
 }
 async function purchase(sku,button){
  if(loading)return;
  loading=true;button.disabled=true;
  try{
   const order=await api('checkout',{sku});
   if(!/^https:\/\//.test(order.invoiceUrl))throw Error('bad_link');
   TG.openInvoice(order.invoiceUrl,status=>{
    if(status==='paid')notice('Telegram подтвердил оплату. Обновите покупки после обработки квитанции.');
    if(status==='cancelled')notice('Оплата отменена.');
    if(status==='failed')notice('Оплата не прошла. Проверьте чек и обратитесь в поддержку.');
    purchases();
   });
  }catch{notice('Сейчас не удалось создать счёт. Проверьте состояние магазина.');}
  finally{loading=false;button.disabled=false;}
 }
 $('refresh').addEventListener('click',purchases);
 catalog();purchases();
})();