// RUST UP — creators Mini App (@rustuptiktok_bot): referral statistics, paid videos, USD balance and payouts.
// Server: bot/creator.js (/api/cr/*). Outside Telegram, ?demo=1 renders sample data for previews.
(() => {
  'use strict';
  const TG = window.Telegram && Telegram.WebApp && Telegram.WebApp.initData ? Telegram.WebApp : null;
  const DEMO = !TG && /[?&]demo=1/.test(location.search);
  const API = (window.CREATOR_API || '').replace(/\/$/, '');
  const BOT = window.CREATOR_BOT || 'rustuptiktok_bot';
  const CHANNEL = window.CREATOR_CHANNEL || '';

  // [id, title, min views for a request, USD for 1k / 100k / 1M views]; must match CLIP_CATS in bot/creator.js
  const CLIP_CATS = [
    ['gameplay', 'Геймплей в RUST UP', 3000, [3, 270, 2000]],
    ['gifts', 'Подарки Telegram', 3000, [1.5, 100, 700]],
    ['games', 'Игры (Rust, CS2)', 6000, [1, 100, 700]],
    ['creative', 'Креатив (мемы, нарезки, тренды)', 6000, [0.15, 15, 150]]];
  function clipEstimate(cat, views, platform) {
    const c = CLIP_CATS.find(x => x[0] === cat);
    if (!c) return 0;
    const [a, b, m] = c[3];
    let v = views <= 1e5 ? Math.min(a * views / 1000, b)
      : views <= 1e6 ? b + (m - b) * (views - 1e5) / 9e5 : m * views / 1e6;
    if (platform === 'shorts') v /= 2;
    return Math.round(v * 100) / 100;
  }

  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeVideoUrl = input => {
    try {
      const u = new URL(String(input));
      if (u.protocol !== 'https:' || !['tiktok.com','www.tiktok.com','youtube.com','www.youtube.com','youtu.be','m.youtube.com'].includes(u.hostname)) return '#';
      return u.href;
    } catch (e) { return '#'; }
  };
  const int = n => Math.round(n || 0).toLocaleString('ru-RU');
  const usd = n => {
    const v = Math.round((n || 0) * 100) / 100;
    return v.toLocaleString('ru-RU', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }) + ' $';
  };
  const rate = n => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' $';
  const date = t => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; };
  const ver = v => !!TG && TG.isVersionAtLeast && TG.isVersionAtLeast(v);
  const haptic = k => { try { if (ver('6.1')) k === 'success' || k === 'error' ? TG.HapticFeedback.notificationOccurred(k) : TG.HapticFeedback.impactOccurred('light'); } catch (e) { /* old client */ } };

  function toast(text, kind = '') {
    const li = document.createElement('li');
    li.className = 'toast ' + kind;
    li.textContent = text;
    $('#toasts').appendChild(li);
    setTimeout(() => li.classList.add('out'), 2600);
    setTimeout(() => li.remove(), 3000);
    if (kind) haptic(kind);
  }
  function modal(title, html, bind) {
    const root = $('#modal');
    root.innerHTML = `<div class="modal-back" data-close></div><div class="modal"><div class="modal-head"><h3>${title}</h3><button class="x" data-close aria-label="Закрыть">×</button></div>${html}</div>`;
    root.classList.add('open');
    root.querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal);
    if (bind) bind(root);
  }
  function closeModal() { $('#modal').classList.remove('open'); $('#modal').innerHTML = ''; }
  const openTg = url => { if (ver('6.1')) TG.openTelegramLink(url); else window.open(url, '_blank', 'noopener'); };
  function copy(text) {
    const done = () => toast('Скопировано', 'success');
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => toast('Скопируйте вручную', 'error'));
    else toast('Скопируйте вручную', 'error');
  }

  // ---------- data ----------
  let D = null, tab = 'stats', days = 7, busy = false;
  function demoData(n) {
    const now = Date.now(), day = 864e5, start = Math.floor(now / day) * day - (n - 1) * day;
    const series = Array.from({ length: n }, (_, i) => {
      const v = Math.max(0, Math.round(14 + 10 * Math.sin(i / 2.3) + i * 1.4 + (i % 3) * 3));
      return { day: start + i * day, n: v, active: Math.round(v * 0.62) };
    });
    return {
      refLink: 'https://t.me/rustuper_bot?start=ref_7342', inviteLink: 'https://t.me/rustuptiktok_bot?start=c_7342',
      stats: { total: 1284, active: 803, today: series[n - 1].n, week: series.slice(-7).reduce((s, d) => s + d.n, 0) },
      series, days: n, balance: 312.5, earnedClips: 594, earnedRef: 18.5, withdrawn: 300, invited: 3,
      payout: { xrocket: '@ivan_rust', card: '2200 7001 2345 6789' }, balanceMin: 1, cashMin: 50, usdRub: 81.2, coinUsd: 0.02,
      clips: [
        { id: 21, url: 'https://www.tiktok.com/@ivan_rust/video/7431002233', platform: 'tiktok', category: 'gameplay', views: 48200, created_at: now - day, status: 'wait' },
        { id: 14, url: 'https://www.tiktok.com/@ivan_rust/video/7429981122', platform: 'tiktok', category: 'gameplay', views: 131000, created_at: now - 5 * day, status: 'paid', amount: 304 },
        { id: 9, url: 'https://youtube.com/shorts/aB3dE9xYz', platform: 'shorts', category: 'gifts', views: 412000, created_at: now - 9 * day, status: 'paid', amount: 290 },
        { id: 5, url: 'https://www.tiktok.com/@ivan_rust/video/7421100991', platform: 'tiktok', category: 'creative', views: 6100, created_at: now - 12 * day, status: 'rejected', note: 'нет упоминания бота' }],
      withdraws: [
        { id: 4, amount: 12, method: 'balance', wallet: 'Баланс RUST UP', status: 'paid', created_at: now - day, done_at: now - day },
        { id: 3, amount: 300, method: 'card', wallet: 'Карта •••• 6789', status: 'paid', created_at: now - 4 * day, done_at: now - 3 * day }]
    };
  }
  function api(path, body = {}) {
    return fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: TG.initData, ...body }) })
      .then(r => r.json());
  }
  function load() {
    if (DEMO) { D = demoData(days); return render(); }
    if (!TG || !API || busy) return render();
    busy = true;
    api('/api/cr/me', { days }).then(d => { if (d.ok) D = d; else toast('Не удалось загрузить кабинет', 'error'); })
      .catch(() => toast('Нет связи с сервером', 'error'))
      .finally(() => { busy = false; render(); });
  }

  // ---------- chart: people who came by the link per day (bars), how many of them played (inner bars) ----------
  function chart(series) {
    const W = 340, H = 170, L = 26, B = 22, T = 10, w = W - L - 6, h = H - B - T;
    const max = Math.max(4, ...series.map(s => s.n));
    const step = Math.pow(10, Math.floor(Math.log10(max))) * (max / Math.pow(10, Math.floor(Math.log10(max))) > 5 ? 2 : 1);
    const top = Math.ceil(max / step) * step;
    const bw = w / series.length, gap = Math.max(1.5, bw * 0.22);
    const y = v => T + h - (v / top) * h;
    const grid = [];
    for (let v = 0; v <= top; v += step) grid.push(`<line x1="${L}" x2="${W - 4}" y1="${y(v)}" y2="${y(v)}" class="g"/><text x="${L - 6}" y="${y(v) + 3.5}" class="yl">${int(v)}</text>`);
    const every = series.length > 10 ? 5 : 1;
    const bars = series.map((s, i) => {
      const x = L + i * bw + gap / 2, bwi = bw - gap;
      const lab = (series.length - 1 - i) % every === 0
        ? `<text x="${x + bwi / 2}" y="${H - 6}" class="xl">${new Date(s.day).toLocaleDateString('ru-RU', { day: 'numeric', month: 'numeric' })}</text>` : '';
      return `<g class="bar" data-i="${i}"><rect x="${L + i * bw}" y="${T}" width="${bw}" height="${h}" class="hit"/>
        <rect x="${x}" y="${y(s.n)}" width="${bwi}" height="${Math.max(0, T + h - y(s.n))}" rx="${Math.min(4, bwi / 3)}" class="b1"/>
        <rect x="${x}" y="${y(s.active)}" width="${bwi}" height="${Math.max(0, T + h - y(s.active))}" rx="${Math.min(4, bwi / 3)}" class="b2"/>${lab}</g>`;
    }).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${grid.join('')}${bars}</svg>`;
  }
  function bindChart() {
    const tip = $('#chartTip');
    document.querySelectorAll('.chart .bar').forEach(g => g.onclick = () => {
      document.querySelectorAll('.chart .bar.on').forEach(x => x.classList.remove('on'));
      g.classList.add('on');
      const s = D.series[+g.dataset.i];
      tip.innerHTML = `<b>${new Date(s.day).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</b> · пришло <b>${int(s.n)}</b> · в игре <b>${int(s.active)}</b>`;
      haptic('light');
    });
  }

  // ---------- pages ----------
  function statsPage() {
    const s = D.stats, conv = s.total ? Math.round((s.active / s.total) * 100) : 0;
    const sum = D.series.reduce((a, d) => a + d.n, 0), best = D.series.reduce((a, d) => d.n > a.n ? d : a, D.series[0]);
    return `
      <section class="card link-card">
        <div class="card-head"><h2>Ваша ссылка на игру</h2><span class="hint">ставьте в описание и шапку профиля</span></div>
        <div class="link-row"><input class="input mono" readonly value="${esc(D.refLink)}"><button class="btn btn-ghost" data-copy="${esc(D.refLink)}">Копировать</button></div>
        <p class="muted">Каждый, кто откроет RUST UP по этой ссылке, засчитывается вам — здесь видно, сколько людей привели ваши ролики.</p>
      </section>
      <section class="tiles">
        <div class="tile big"><span>Всего пришло</span><b>${int(s.total)}</b></div>
        <div class="tile big ok"><span>Зашли в игру</span><b>${int(s.active)}</b><i>${conv}%</i></div>
        <div class="tile"><span>Сегодня</span><b>+${int(s.today)}</b></div>
        <div class="tile"><span>За 7 дней</span><b>+${int(s.week)}</b></div>
      </section>
      <section class="card">
        <div class="card-head"><h2>Приход по дням</h2>
          <div class="seg"><button class="${days === 7 ? 'on' : ''}" data-days="7">7 дней</button><button class="${days === 30 ? 'on' : ''}" data-days="30">30 дней</button></div></div>
        ${chart(D.series)}
        <div class="legend"><span><i class="l1"></i>пришли по ссылке</span><span><i class="l2"></i>зашли в игру</span></div>
        <p class="chart-tip" id="chartTip">За ${days} ${plural(days, 'день', 'дня', 'дней')}: <b>${int(sum)}</b> ${plural(sum, 'человек', 'человека', 'человек')}${best && best.n ? ` · лучший день ${date(best.day)} — ${int(best.n)}` : ''}. Нажмите на столбик, чтобы увидеть день.</p>
      </section>`;
  }

  const ST = { wait: ['На проверке', 'wait'], paid: ['Начислено', 'ok'], rejected: ['Отклонено', 'bad'] };
  function clipsPage() {
    const list = D.clips.length ? D.clips.map(c => {
      const [label, cls] = ST[c.status] || ST.wait;
      const cat = CLIP_CATS.find(x => x[0] === c.category);
      return `<div class="clip">
        <div class="clip-top"><span class="pf ${c.platform}">${c.platform === 'shorts' ? 'Shorts' : 'TikTok'}</span><a href="${esc(safeVideoUrl(c.url))}" target="_blank" rel="noopener">${esc(c.url.replace(/^https?:\/\/(www\.)?/, ''))}</a></div>
        <div class="clip-meta"><span>#${c.id} · ${esc(cat ? cat[1] : '')} · ${date(c.created_at)}</span><span>${int(c.views)} просм.</span></div>
        <div class="clip-foot"><span class="st ${cls}">${c.amount && c.status === 'wait' ? 'Перепроверка' : label}${c.amount ? ` · ${usd(c.amount)}` : ''}${c.note ? ` · ${esc(c.note)}` : ''}</span>
          ${c.status !== 'rejected' ? `<button class="btn btn-ghost sm" data-views="${c.id}">Обновить просмотры</button>` : ''}</div>
      </div>`;
    }).join('') : '<p class="muted empty">Роликов пока нет — добавьте первый.</p>';
    return `
      <section class="card hero">
        <div class="hero-ico">${TT}</div>
        <h2>Ролики в TikTok и Shorts</h2>
        <p><b>2 000 $</b> за 1 000 000 просмотров</p>
        <button class="btn btn-accent wide" data-add>+ Добавить ролик</button>
      </section>
      ${CHANNEL ? `<button class="channel" data-channel><span class="hero-ico sm">${TT}</span><span><b>Баннеры и примеры роликов</b><small>Начните с канала: там баннеры и все правила</small></span><span class="arr">›</span></button>` : ''}
      <section class="card"><div class="card-head"><h2>Мои ролики</h2><span class="hint">${D.clips.length}</span></div>${list}</section>
      <section class="card rates">
        <div class="card-head"><h2>Сколько платим</h2></div>
        <div class="rc head"><span></span><span>1 000</span><span>100 000</span><span>1 млн</span></div>
        ${CLIP_CATS.map(([, t, min, r]) => `<div class="rrow"><div class="rname"><b>${t}</b> · заявка от ${int(min)}</div>
          <div class="rc"><span></span>${r.map(v => `<b>${rate(v)}</b>`).join('')}</div></div>`).join('')}
        <p class="muted">YouTube Shorts — половина ставки. Деньги приходят на баланс кабинета, вывод — на баланс RUST UP от ${usd(D.balanceMin)}, на карту или USDT — от ${usd(D.cashMin)}. Ролик растёт — обновите просмотры, и мы доначислим разницу.</p>
      </section>
      <section class="card how">
        <h2>Правила</h2>
        <ol>
          <li>В описании ролика — ваша ссылка на игру со вкладки «Статистика» или @rustuper_bot.</li>
          <li>Накрутка просмотров, чужие и повторные ролики не оплачиваются.</li>
        </ol>
      </section>`;
  }

  const WAY_ICO = {
    balance: '<svg viewBox="0 0 24 24"><path d="M12 3L4 8.5v3.5L12 6.5l8 5.5V8.5zM12 10L4 15.5V19l8-5.5 8 5.5v-3.5z" fill="#e5383b"/></svg>',
    card: '<svg viewBox="0 0 24 24"><rect x="2.5" y="5" width="19" height="14" rx="3" fill="none" stroke="#ffd166" stroke-width="2"/><path d="M2.5 9.5h19" stroke="#ffd166" stroke-width="2.4"/><path d="M6 15h4" stroke="#ffd166" stroke-width="2" stroke-linecap="round"/></svg>',
    crypto: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5" fill="#26a17b"/><path d="M7 7.5h10v2.6h-3.6v1.2c2.6.2 4.4.7 4.4 1.3s-1.8 1.1-4.4 1.3V18h-2.8v-4.1C8 13.7 6.2 13.2 6.2 12.6s1.8-1.1 4.4-1.3v-1.2H7z" fill="#fff"/></svg>'
  };
  // payout methods: the game balance takes any amount, card and crypto start at D.cashMin
  const METHODS = [
    ['balance', 'Баланс RUST UP', 'мгновенно, от ' ],
    ['card', 'Карта', 'от '],
    ['crypto', 'Крипта USDT', 'от ']];
  const methodMin = m => m === 'balance' ? D.balanceMin : D.cashMin;
  const rubOf = n => Math.round(n * D.usdRub).toLocaleString('ru-RU') + ' ₽';
  function moneyPage() {
    const can = D.balance >= D.balanceMin;
    const WST = { wait: ['Ждёт перевода', 'wait'], paid: ['Отправлено', 'ok'], rejected: ['Отклонено', 'bad'] };
    return `
      <section class="card balance">
        <span class="muted">Доступно к выводу</span>
        <b class="big">${usd(D.balance)}</b>
        <button class="btn btn-accent wide" data-withdraw ${can ? '' : 'disabled'}>${can ? 'Вывести' : `Вывод от ${usd(D.balanceMin)}`}</button>
        <div class="split">
          <div><span>За ролики</span><b>${usd(D.earnedClips)}</b></div>
          <div><span>За авторов</span><b>${usd(D.earnedRef)}</b></div>
          <div><span>Выведено</span><b>${usd(D.withdrawn)}</b></div>
        </div>
      </section>
      <section class="card">
        <div class="card-head"><h2>Способы вывода</h2></div>
        <div class="ways">${METHODS.map(([id, t, s]) => `<div class="way ${D.balance >= methodMin(id) ? '' : 'off'}"><span class="way-ico">${WAY_ICO[id]}</span><b>${t}</b><small>${s}${usd(methodMin(id))}</small></div>`).join('')}</div>
        <p class="muted">До ${usd(D.cashMin)} вывод только на баланс RUST UP (1 $ = ${rubOf(1)}). От ${usd(D.cashMin)} — ещё на карту или USDT (@xRocket или TRC-20).</p>
      </section>
      <section class="card">
        <div class="card-head"><h2>Пригласи автора</h2><span class="hint">+5%</span></div>
        <div class="link-row"><input class="input mono" readonly value="${esc(D.inviteLink)}"><button class="btn btn-ghost" data-copy="${esc(D.inviteLink)}">Копировать</button></div>
        <p class="muted">Получайте 5% от всего, что заработают приглашённые вами авторы — сверху, не из их денег. Приглашено: <b>${int(D.invited)}</b>.</p>
      </section>
      <section class="card"><div class="card-head"><h2>История выводов</h2></div>
        ${D.withdraws.length ? D.withdraws.map(w => {
          const [l, c] = WST[w.status] || WST.wait;
          return `<div class="wrow"><div><b>${usd(w.amount)}</b><span class="muted">#${w.id} · ${date(w.created_at)} · ${esc(w.wallet)}</span></div><span class="st ${c}">${l}${w.note ? ` · ${esc(w.note)}` : ''}</span></div>`;
        }).join('') : '<p class="muted empty">Выводов пока не было.</p>'}
      </section>`;
  }

  const TT = '<svg viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="12" fill="#000"/><path id="ttn" d="M27.5 10h5.3c.4 3.6 2.6 6 6.2 6.3v5.4c-2.3.1-4.4-.6-6.2-1.8v10.6c0 6.3-4.6 10.2-10 10.2-5.7 0-9.8-4.2-9.8-9.7 0-6 4.9-10.3 11.3-9.6v5.6c-3-.7-5.6 1.2-5.6 4 0 2.4 1.9 4.2 4.2 4.2 2.6 0 4.6-1.8 4.6-5.1z" fill="#25f4ee" transform="translate(-1.2 -1)"/><path d="M27.5 10h5.3c.4 3.6 2.6 6 6.2 6.3v5.4c-2.3.1-4.4-.6-6.2-1.8v10.6c0 6.3-4.6 10.2-10 10.2-5.7 0-9.8-4.2-9.8-9.7 0-6 4.9-10.3 11.3-9.6v5.6c-3-.7-5.6 1.2-5.6 4 0 2.4 1.9 4.2 4.2 4.2 2.6 0 4.6-1.8 4.6-5.1z" fill="#fe2c55" transform="translate(1.2 1)"/><path d="M27.5 10h5.3c.4 3.6 2.6 6 6.2 6.3v5.4c-2.3.1-4.4-.6-6.2-1.8v10.6c0 6.3-4.6 10.2-10 10.2-5.7 0-9.8-4.2-9.8-9.7 0-6 4.9-10.3 11.3-9.6v5.6c-3-.7-5.6 1.2-5.6 4 0 2.4 1.9 4.2 4.2 4.2 2.6 0 4.6-1.8 4.6-5.1z" fill="#fff"/></svg>';

  function render() {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    const page = $('#page');
    if (!D) {
      page.innerHTML = TG || DEMO ? '<div class="loading"><i></i><i></i><i></i></div>'
        : `<section class="card hero"><div class="hero-ico">${TT}</div><h2>Кабинет автора RUST UP</h2><p class="muted">Кабинет открывается в Telegram-боте.</p>
           <a class="btn btn-accent wide" href="https://t.me/${esc(BOT)}">Открыть @${esc(BOT)}</a></section>`;
      return;
    }
    $('#topBalance').textContent = usd(D.balance);
    page.innerHTML = tab === 'clips' ? clipsPage() : tab === 'money' ? moneyPage() : statsPage();
    if (tab === 'stats') bindChart();
  }

  // ---------- actions ----------
  function addClip() {
    modal('Новый ролик', `
      <label class="lbl">Ссылка на ролик</label>
      <input class="input" id="cUrl" placeholder="https://www.tiktok.com/@…/video/…" inputmode="url" maxlength="300">
      <label class="lbl">Категория</label>
      <select class="input" id="cCat">${CLIP_CATS.map(([id, t, min]) => `<option value="${id}">${t} — от ${int(min)}</option>`).join('')}</select>
      <label class="lbl">Просмотров сейчас</label>
      <input class="input" id="cViews" placeholder="Например, 15000" inputmode="numeric" maxlength="11">
      <p class="muted est" id="cEst"></p>
      <button class="btn btn-accent wide" id="cSend">Отправить на проверку</button>`, m => {
      const views = () => Math.floor(Number(($('#cViews', m).value || '').replace(/\D/g, '')) || 0);
      const pf = () => /youtu/i.test($('#cUrl', m).value) ? 'shorts' : 'tiktok';
      const est = () => {
        const v = views(), cat = $('#cCat', m).value, min = CLIP_CATS.find(x => x[0] === cat)[2];
        $('#cEst', m).textContent = !v ? '' : v < min ? `Для этой категории нужно от ${int(min)} просмотров.` : `Примерно ${usd(clipEstimate(cat, v, pf()))} по таблице — точную сумму начислим после проверки.`;
      };
      ['#cUrl', '#cCat', '#cViews'].forEach(s => $(s, m).addEventListener('input', est));
      $('#cSend', m).onclick = () => {
        const url = $('#cUrl', m).value.trim(), cat = $('#cCat', m).value, v = views();
        if (!/^https?:\/\/([a-z0-9-]+\.)*(tiktok\.com|youtube\.com|youtu\.be)\//i.test(url)) return toast('Нужна ссылка на TikTok или YouTube Shorts', 'error');
        if (v < CLIP_CATS.find(x => x[0] === cat)[2]) return toast('Пока мало просмотров для заявки', 'error');
        if (DEMO) { closeModal(); return toast('Демо: заявка не отправляется', 'success'); }
        const b = $('#cSend', m); b.disabled = true; b.textContent = 'Отправляем…';
        api('/api/cr/clip', { url, category: cat, views: v }).then(d => {
          if (!d.ok) return toast({ dup: 'Этот ролик уже отправлен', limit: 'Уже 3 ролика на проверке — дождитесь ответа', wallet: 'Укажите @username для выплат во вкладке «Баланс»', min: 'Пока мало просмотров', url: 'Нужна ссылка на TikTok или YouTube Shorts' }[d.error] || 'Не удалось отправить', 'error');
          closeModal(); toast('Ролик отправлен на проверку', 'success'); load();
        }).catch(() => toast('Нет связи с сервером', 'error')).finally(() => { b.disabled = false; b.textContent = 'Отправить на проверку'; });
      };
    });
  }
  function updateViews(id) {
    const c = D.clips.find(x => x.id === id);
    modal('Обновить просмотры', `
      <p class="muted">#${c.id} · сейчас ${int(c.views)} просм.${c.amount ? ` · начислено ${usd(c.amount)}` : ''}</p>
      <input class="input" id="vNew" placeholder="Сколько просмотров сейчас" inputmode="numeric" maxlength="11">
      <p class="muted est" id="vEst"></p>
      <button class="btn btn-accent wide" id="vSend">Отправить на перепроверку</button>`, m => {
      const v = () => Math.floor(Number(($('#vNew', m).value || '').replace(/\D/g, '')) || 0);
      $('#vNew', m).addEventListener('input', () => {
        const more = clipEstimate(c.category, v(), c.platform) - (c.amount || 0);
        $('#vEst', m).textContent = v() > c.views && more > 0 ? `Доначислим примерно ${usd(more)} после проверки.` : '';
      });
      $('#vSend', m).onclick = () => {
        if (v() <= c.views) return toast('Просмотров должно стать больше', 'error');
        if (DEMO) { closeModal(); return toast('Демо: заявка не отправляется', 'success'); }
        api('/api/cr/views', { id, views: v() }).then(d => {
          if (!d.ok) return toast('Не удалось обновить', 'error');
          closeModal(); toast('Отправлено на перепроверку', 'success'); load();
        }).catch(() => toast('Нет связи с сервером', 'error'));
      };
    });
  }
  const luhn = num => { let s = 0; for (let i = 0; i < num.length; i++) { let d = +num[num.length - 1 - i]; if (i % 2) { d *= 2; if (d > 9) d -= 9; } s += d; } return s % 10 === 0; };
  function withdraw() {
    const P = D.payout || {};
    let method = D.balance >= D.cashMin && P.card ? 'card' : 'balance', net = P.net === 'trc20' ? 'trc20' : 'xrocket';
    modal('Вывод', `
      <label class="lbl">Сумма, $ (доступно ${usd(D.balance)})</label>
      <div class="link-row"><input class="input" id="wAmt" value="${Math.floor(D.balance * 100) / 100}" inputmode="decimal" maxlength="10"><button class="btn btn-ghost" id="wAll">Всё</button></div>
      <label class="lbl">Куда</label>
      <div class="ways pick" id="wWays">${METHODS.map(([id, t]) => `<button class="way" type="button" data-m="${id}"><span class="way-ico">${WAY_ICO[id]}</span><b>${t}</b><small>от ${usd(methodMin(id))}</small></button>`).join('')}</div>
      <div id="wDet"></div>
      <p class="muted est" id="wHint"></p>
      <button class="btn btn-accent wide" id="wSend">Вывести</button>`, m => {
      const amt = () => Number(($('#wAmt', m).value || '').replace(',', '.')) || 0;
      const details = () => {
        if (method === 'card') return `<label class="lbl">Номер карты</label><input class="input mono" id="wCard" inputmode="numeric" maxlength="23" placeholder="0000 0000 0000 0000" value="${esc(P.card || '')}">`;
        if (method === 'crypto') return `<label class="lbl">Сеть</label>
          <div class="seg wide-seg"><button type="button" class="${net === 'xrocket' ? 'on' : ''}" data-net="xrocket">@xRocket</button><button type="button" class="${net === 'trc20' ? 'on' : ''}" data-net="trc20">USDT TRC-20</button></div>
          ${net === 'trc20' ? `<input class="input mono" id="wAddr" maxlength="40" placeholder="Адрес T…" value="${esc(P.trc20 || '')}">`
            : `<input class="input" id="wX" maxlength="33" placeholder="@username в @xRocket" value="${esc(P.xrocket || '')}">`}`;
        return '';
      };
      const draw = () => {
        const a = amt(), cash = a >= D.cashMin;
        if (!cash && method !== 'balance') method = 'balance';
        m.querySelectorAll('[data-m]').forEach(b => { b.classList.toggle('on', b.dataset.m === method); b.classList.toggle('off', b.dataset.m !== 'balance' && !cash); });
        $('#wDet', m).innerHTML = details();
        m.querySelectorAll('[data-net]').forEach(b => b.onclick = () => { net = b.dataset.net; draw(); });
        $('#wHint', m).innerHTML = method === 'balance'
          ? (a > 0 ? `≈ <b>${rubOf(a)}</b> на баланс RUST UP — сразу, бот напишет в @${esc(window.RUSTUP_MAIN_BOT || 'rustuper_bot')}.` : '') + (cash ? '' : ` Карта и крипта — от ${usd(D.cashMin)}.`)
          : method === 'card' ? `≈ ${rubOf(a)} по курсу ЦБ. Переводим вручную, обычно за 1–2 дня.` : 'USDT, переводим вручную, обычно за 1–2 дня.';
      };
      m.querySelectorAll('[data-m]').forEach(b => b.onclick = () => {
        if (b.dataset.m !== 'balance' && amt() < D.cashMin) return toast(`На карту и крипту — от ${usd(D.cashMin)}`, 'error');
        method = b.dataset.m; draw();
      });
      $('#wAmt', m).addEventListener('input', draw);
      $('#wAll', m).onclick = () => { $('#wAmt', m).value = Math.floor(D.balance * 100) / 100; draw(); };
      draw();
      $('#wSend', m).onclick = () => {
        const amount = amt(), body = { amount, method };
        if (amount > D.balance) return toast('Больше, чем на балансе', 'error');
        if (amount < methodMin(method)) return toast(`Минимум ${usd(methodMin(method))}`, 'error');
        if (method === 'card') {
          const num = ($('#wCard', m).value || '').replace(/\D/g, '');
          if (num.length < 16 || num.length > 19 || !luhn(num)) return toast('Проверьте номер карты', 'error');
          body.details = { card: num };
        } else if (method === 'crypto') {
          body.details = net === 'trc20' ? { net, address: $('#wAddr', m).value.trim() } : { net, xrocket: $('#wX', m).value.trim() };
          if (net === 'trc20' && !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(body.details.address)) return toast('Проверьте адрес TRC-20', 'error');
          if (net === 'xrocket' && !/^@?[a-z0-9_]{4,32}$/i.test(body.details.xrocket)) return toast('Укажите @username', 'error');
        }
        if (DEMO) { closeModal(); return toast('Демо: вывод не создаётся', 'success'); }
        const b = $('#wSend', m); b.disabled = true; b.textContent = 'Отправляем…';
        api('/api/cr/withdraw', body).then(d => {
          if (!d.ok) return toast({ open: 'Предыдущий вывод на карту/крипту ещё в обработке', min: `Минимум ${usd(D.balanceMin)}`, cashmin: `На карту и крипту — от ${usd(D.cashMin)}`, balance: 'Не хватает баланса', card: 'Проверьте номер карты', trc20: 'Проверьте адрес TRC-20', xrocket: 'Укажите @username' }[d.error] || 'Не удалось', 'error');
          closeModal();
          toast(d.instant ? `${d.rub} уже на балансе RUST UP — откройте игру` : 'Вывод заказан — бот напишет, когда отправим', 'success');
          load();
        }).catch(() => toast('Нет связи с сервером', 'error')).finally(() => { b.disabled = false; b.textContent = 'Вывести'; });
      };
    });
  }

  document.addEventListener('click', e => {
    const t = e.target.closest('button, a');
    if (!t) return;
    if (t.dataset.tab) { tab = t.dataset.tab; haptic('light'); render(); window.scrollTo(0, 0); return; }
    if (t.dataset.days) { days = +t.dataset.days; return load(); }
    if (t.dataset.copy) return copy(t.dataset.copy);
    if ('add' in t.dataset) return addClip();
    if (t.dataset.views) return updateViews(+t.dataset.views);
    if ('withdraw' in t.dataset) return withdraw();
    if ('channel' in t.dataset) return openTg('https://t.me/' + CHANNEL);
  });

  if (TG) {
    TG.ready(); TG.expand();
    try { if (ver('6.1')) { TG.setHeaderColor('#141518'); TG.setBackgroundColor('#141518'); } } catch (e) { /* old client */ }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  }
  const start = new URLSearchParams(location.search).get('tab');
  if (['stats', 'clips', 'money'].includes(start)) tab = start;
  if (DEMO && /[?&]days=30/.test(location.search)) days = 30;
  render();
  load();
  // previews: ?demo=1&tab=money&open=withdraw[&amount=20]
  if (DEMO && /[?&]open=withdraw/.test(location.search)) {
    withdraw();
    const a = (location.search.match(/[?&]amount=([\d.]+)/) || [])[1];
    if (a) { $('#wAmt').value = a; $('#wAmt').dispatchEvent(new Event('input')); }
    const mth = (location.search.match(/[?&]method=(\w+)/) || [])[1];
    if (mth) $(`[data-m="${mth}"]`).click();
  }
})();
