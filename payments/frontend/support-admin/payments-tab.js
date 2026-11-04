// Additional tab for the EXISTING @rustuperhelp_bot Admin Mini App.
// Authentication is inherited from the app's signed Telegram initData API client.
// It never handles wallet secrets, sends payments or changes production hard gates.
(() => {
  'use strict';
  const names={master:'Главный переключатель',stars:'Telegram Stars',crypto:'Криптовалюты'};
  const icons={master:'⏻',stars:'⭐',crypto:'◈'};
  const html=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const formatTime=n=>Number(n)>0?new Date(Number(n)).toLocaleString('ru-RU',{
    day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'
  }):'—';

  function render({page,api,toast,denied}){
    page.innerHTML = '<section class="glass pay-panel" data-pay-panel>'+
      '<div class="pay-head"><div><span class="pay-eyebrow">RUST UP / ADMIN</span>'+
      '<h2>Управление платежами</h2><p>Состояние системы и аварийная остановка</p></div>'+
      '<button type="button" class="pay-refresh" data-pay-refresh aria-label="Обновить">↻</button></div>'+
      '<div class="pay-body"><div class="loading"><i></i><i></i><i></i></div></div></section>';
    const root=page.querySelector('[data-pay-panel]');
    const body=root.querySelector('.pay-body');
    let state=null,busy=false;
    const mounted=()=>root.isConnected&&page.contains(root);
    const showError=(text)=>{ if(mounted())body.innerHTML='<div class="pay-unavailable">'+
      '<strong>Не удалось загрузить настройки</strong><p>'+html(text)+'</p>'+
      '<button class="btn ghost" type="button" data-pay-refresh>Повторить</button></div>'; };

    function draw(){
      if(!mounted()||!state?.controls)return;
      const p=state,prod=!!p.productionEnabled;
      const controls=p.controls,activity=Array.isArray(p.history)?p.history:[];
      const choice=(channel)=>{
        const enabled=controls[channel]===true;
        const receiving=channel==='stars'?p.effective?.stars:channel==='crypto'?p.effective?.crypto:false;
        return '<div class="pay-switch"><div class="pay-title">'+
          '<span class="pay-icon">'+icons[channel]+'</span><span class="pay-copy">'+
          '<strong>'+names[channel]+'</strong><small>'+
          (channel==='master'?'Останавливает все способы пополнения':
           channel==='stars'?'Оплата в Telegram Stars':'Внешний криптопровайдер')+
          '</small></span></div><div class="pay-switch-foot">'+
          '<span class="pay-pill '+(enabled?'prepared':'stopped')+'">'+
          (enabled?'Разрешено':'Выключено')+'</span>'+
          '<button type="button" class="pay-toggle '+(enabled?'enabled':'')+'" '+
          'data-pay-channel="'+channel+'" data-pay-next="'+(!enabled)+'" '+
          (busy?'disabled ':'')+
          'aria-label="'+(enabled?'Выключить ':'Включить ')+names[channel]+'" '+
          'aria-pressed="'+enabled+'"><span></span></button></div>'+
          (channel==='master'?'':('<p class="pay-effective">Приём платежей: <strong>'+
           (receiving?'ДА':'НЕТ')+'</strong></p>'))+'</div>';
      };
      const recent=activity.length?activity.map(a=>{
        const n=names[a.channel]||a.channel;
        return '<div class="pay-history-item"><span class="pay-history-dot '+(a.to?'on':'off')+'"></span>'+
          '<span>'+html(n)+'<small>ID '+html(a.adminId)+' · '+html(formatTime(a.at))+'</small></span>'+
          '<b>'+(a.to?'ВКЛ':'ВЫКЛ')+'</b></div>';
      }).join(''):'<p class="muted">Изменений пока нет.</p>';
      body.innerHTML='<div class="pay-prod '+(prod?'pay-prod-warn':'')+'">'+
        '<strong>'+(prod?'● Production gate: ON':'● Production gate: OFF')+'</strong>'+
        '<p>'+(prod?'Проверяйте юридические и платёжные разрешения отдельно.':
          'Реальные платежи заблокированы на сервере. Переключатели ниже не снимают эту блокировку.')+'</p>'+
        '</div><div class="pay-grid">'+
        choice('master')+choice('stars')+choice('crypto')+
        '</div><button class="btn danger pay-stop" type="button" data-pay-stop '+
        (busy||!controls.master?'disabled':'')+'>⛔ Аварийно отключить все платежи</button>'+
        '<p class="pay-hint">Кнопка немедленно выключает главный переключатель. Журнал изменений сохраняется.</p>'+
        '<section class="pay-history"><h3>Последние изменения</h3>'+recent+'</section>';
    }
    async function load(){
      if(busy)return;
      const result=await api('payments');
      if(!mounted())return;
      if(!result?.ok){
        if(result?.error==='forbidden'||result?.error==='auth')return denied(result);
        return showError(result?.error==='payment_controls_unavailable'?
          'База управления платежами недоступна. Настройки не изменены.':
          'Сервер недоступен или модуль ещё не опубликован.');
      }
      if(!result.controls||!result.effective)return showError('API платежей ещё не обновлено.');
      state=result;draw();
    }
    async function change(channel,enabled,emergency=false){
      if(busy||!state?.controls||typeof state.controls[channel]!=='boolean')return;
      const expected=state.controls[channel];
      if(expected===enabled)return;
      if(!emergency && enabled&&!confirm(
        'Изменить настройку «'+names[channel]+'»?\n'+
        'Это изменяет только переключатель. Серверная блокировка реальных платежей не снимается.'
      ))return;
      busy=true;draw();
      try{
        const result=await api('payments-set',{
          channel,enabled,expected,confirmation:'CONFIRM_PAYMENT_SWITCH'
        });
        if(!mounted())return;
        if(!result?.ok){
          toast(result?.error==='stale_payment_control_state'?
            'Настройка изменена другим администратором. Данные обновляются.':
            'Не удалось сохранить настройку','error');
        }else{
          state=result;
          toast(emergency?'Все платежи аварийно остановлены':'Настройка сохранена','success');
        }
      }finally{
        busy=false; if(mounted())await load();
      }
    }
    root.addEventListener('click',(e)=>{
      const b=e.target.closest('button');
      if(!b||busy)return;
      if(b.hasAttribute('data-pay-refresh'))return load();
      if(b.hasAttribute('data-pay-stop'))return change('master',false,true);
      const channel=b.dataset.payChannel;
      if(Object.prototype.hasOwnProperty.call(names,channel))
        return change(channel,b.dataset.payNext==='true');
    });
    load();
  }
  window.RustUpPaymentsTab=Object.freeze({render});
})();
