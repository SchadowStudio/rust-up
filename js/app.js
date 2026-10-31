/* RUST UP — front-end demo. All money/skins are virtual and stored in localStorage. */
(function () {
  'use strict';

  // ---------- constants ----------
  const RTP = 0.95;            // payout ratio built into the chance formula
  const MAX_CHANCE = 75;
  const MIN_CHANCE = 1;
  const MAX_SLOTS = 6;
  const MIN_TOPUP = 10;           // below this balance the upgrader suggests getting coins
  const TG_CHANNEL = 'up_rust';
  const TG_BONUS = 10000;         // one-time reward for subscribing to the Telegram channel
  const BONUS_TXT = TG_BONUS.toLocaleString('ru-RU');
  const STORE_KEY = 'rustup_demo_v1';
  const PROMOS = { RUSTUP: 50, WIPE: 25, DEMO: 100 };
  const DAILY_MS = 24 * 60 * 60 * 1000;

  const SKINS = window.SKINS.map((s, i) => ({ ...s, id: i }));
  const byName = Object.fromEntries(SKINS.map(s => [s.name, s]));

  // ---------- utils ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const fmt = n => (Math.round(n * 100) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const fmtInt = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const randHex = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('');
  const sum = arr => arr.reduce((a, b) => a + b, 0);

  const ICON = {
    coin: '<svg viewBox="0 0 20 20" aria-hidden="true"><polygon points="10,1 18,5.5 18,14.5 10,19 2,14.5 2,5.5" fill="#e0a83a"/><polygon points="10,3.5 15.8,6.8 15.8,13.2 10,16.5 4.2,13.2 4.2,6.8" fill="#b97a1c"/><path d="M10 5.5l3.6 2.1v4.8L10 14.5l-3.6-2.1V7.6z" fill="#f6cf6a"/><path d="M8.3 8.2h2.4a1.3 1.3 0 010 2.6H9.4l2 2" fill="none" stroke="#8a5510" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#cd412b"/><path d="M12 7v10M7 12h10" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>',
    cart: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#7c954d"/><path d="M6.5 8h1.6l1.4 6.2h6.3l1.2-4.6H9" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="10.3" cy="16.6" r="1" fill="#fff"/><circle cx="15.2" cy="16.6" r="1" fill="#fff"/></svg>',
    check: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="currentColor"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    x: '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    wallet: '<svg viewBox="0 0 20 20" width="20" height="20"><rect x="2" y="5" width="16" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M13.5 11h2.5M4 5l9-3 1.2 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    bell: '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M5 8a5 5 0 0110 0v4l1.5 2.5h-13L5 12zM8 16.5a2 2 0 004 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    sort: '<svg viewBox="0 0 20 20"><path d="M6 4v12M6 16l-3-3M6 16l3-3M14 16V4M14 4l-3 3M14 4l3 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    left: '<svg viewBox="0 0 20 20"><path d="M12.5 4l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    right: '<svg viewBox="0 0 20 20"><path d="M7.5 4l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    soundOn: '<svg viewBox="0 0 20 20"><path d="M3 8h3l4-3.5v11L6 12H3z" fill="currentColor"/><path d="M13 7.5a3.5 3.5 0 010 5M15 5.5a6.5 6.5 0 010 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    soundOff: '<svg viewBox="0 0 20 20"><path d="M3 8h3l4-3.5v11L6 12H3z" fill="currentColor"/><path d="M13 8l4 4M17 8l-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    bolt: '<svg viewBox="0 0 20 20"><path d="M11 2L4 11.5h5L8 18l7-9.5h-5z" fill="currentColor"/></svg>',
    history: '<svg viewBox="0 0 20 20"><path d="M3.5 10a6.5 6.5 0 106.5-6.5A6.6 6.6 0 004.6 6.5M4 3v3.7h3.7M10 6.5V10l2.5 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    shield: '<svg viewBox="0 0 20 20"><path d="M10 2l6.5 2.5v5c0 4-2.8 7-6.5 8.5C6.3 16.5 3.5 13.5 3.5 9.5v-5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M7 10l2 2 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    bag: '<svg viewBox="0 0 20 20"><path d="M4 7h12l-1 10H5zM7.5 7V5.5a2.5 2.5 0 015 0V7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    shop: '<svg viewBox="0 0 20 20"><path d="M3 8l1.5-4.5h11L17 8M3 8h14M3 8a2.3 2.3 0 004.7 0 2.3 2.3 0 004.6 0A2.3 2.3 0 0017 8M4.5 10.5V17h11v-6.5M8.5 17v-3.5h3V17" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    vk: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12.8 17.5C6.9 17.5 3.5 13.4 3.4 6.6h3c.1 5 2.3 7.1 4 7.5V6.6h2.8v4.3c1.7-.2 3.5-2.1 4.1-4.3h2.8a8.3 8.3 0 01-3.8 5.4 8.6 8.6 0 014.4 5.5h-3.1a5.4 5.4 0 00-4.4-3.9v3.9z"/></svg>',
    tg: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M20.7 4.3L2.9 11.2c-1.2.5-1.2 1.2-.2 1.5l4.6 1.4 1.8 5.4c.2.6.4.8.9.8.4 0 .6-.2.9-.5l2.2-2.1 4.6 3.4c.8.5 1.4.2 1.6-.8l3-14.2c.3-1.2-.5-1.8-1.6-1.3zM8.5 13.8l9.4-5.9c.5-.3.8-.1.4.2l-7.8 7.1-.3 3.3z"/></svg>',
    ds: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19.3 5.4A16.6 16.6 0 0015.2 4l-.5 1a15.4 15.4 0 00-5.4 0L8.8 4a16.5 16.5 0 00-4.1 1.4C2.1 9.3 1.4 13.1 1.8 16.8a16.7 16.7 0 005 2.6l1.1-1.7a10.8 10.8 0 01-1.7-.8l.4-.3a11.9 11.9 0 0010.2 0l.4.3-1.7.8 1.1 1.7a16.6 16.6 0 005-2.6c.5-4.3-.8-8-3.3-11.4zM8.7 14.5c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2zm6.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2z"/></svg>',
    steam: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 2a10 10 0 00-10 9.2l5.4 2.2a2.8 2.8 0 011.6-.5h.2l2.4-3.5v-.1a3.8 3.8 0 113.8 3.8h-.1l-3.4 2.4v.1a2.8 2.8 0 01-5.6.3L2.4 14.4A10 10 0 1012 2zM8.3 17.2l-1.2-.5a2.1 2.1 0 103.9-1.6 2.1 2.1 0 00-2.7-1.1l1.3.5a1.5 1.5 0 01-1.3 2.7zm9.9-7.9a2.5 2.5 0 10-2.5 2.5 2.5 2.5 0 002.5-2.5zm-4.4 0a1.9 1.9 0 111.9 1.9 1.9 1.9 0 01-1.9-1.9z"/></svg>',
    gift: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 7v13M12 7H8.5a2 2 0 010-4C11 3 12 7 12 7zm0 0h3.5a2 2 0 000-4C13 3 12 7 12 7zM20 11v7.5c0 1-.8 1.5-1.8 1.5H5.8c-1 0-1.8-.5-1.8-1.5V11M3 7h18v4H3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>'
  };
  const WEAPON_SVG = '<svg class="placeholder-weapon" viewBox="0 0 160 70"><path fill="#f2f3f2" d="M4 26h70l6-8h18l3 5h36l6-4h11v12h-6l-2 6h-38l-6 6h-12l-4 20H76l4-18-8-1-6 10H50l4-14H34l-8 7H14l-2-9H4z"/></svg>';

  // whole amounts without .00, for promo texts
  const coinInt = (v, size) => coin(v, size).replace(fmt(v), Math.round(v).toLocaleString('ru-RU'));
  const coin = (v, size) => `<span class="coin"${size ? ` style="--coin-size:${size}px"` : ''}>${ICON.coin}<span>${fmt(v)}</span></span>`;

  // ---------- persistence ----------
  function freshState() {
    const server = randHex(32);
    return {
      user: null,
      balance: 0,
      inventory: [],
      withdrawals: [],
      history: [],
      stats: { upgrades: 0, wins: 0, wagered: 0, won: 0, best: 0 },
      seeds: { server, serverHash: sha256(server), client: randHex(8), nonce: 0, prev: null },
      rewards: { lastDaily: 0, promos: [], claimedLevel: 0 },
      settings: { sound: true, fast: false }
    };
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return Object.assign(freshState(), JSON.parse(raw));
    } catch (e) { /* private mode / blocked storage: run in-memory */ }
    return freshState();
  }
  let S = load();
  // catalog can change between versions: drop owned items that no longer exist
  function sanitize() {
    S.inventory = S.inventory.filter(i => byName[i.name]);
    S.withdrawals = S.withdrawals || [];
  }
  sanitize();
  const addItem = name => S.inventory.push({ uid: uid(), name, t: Date.now() });
  function save() {
    S.savedAt = Date.now();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* ignore */ }
    cloudSave();
  }

  // ---------- Telegram Mini App ----------
  // Only active when opened from a Telegram bot (initData present); otherwise TG is null and the site works as usual.
  const TG = window.Telegram && Telegram.WebApp && Telegram.WebApp.initData ? Telegram.WebApp : null;
  const tgVer = v => TG && TG.isVersionAtLeast && TG.isVersionAtLeast(v);
  // CloudStorage keeps progress per Telegram account across devices; values are limited to 4096 chars, so the state is chunked
  const CLOUD_CHUNK = 4000;
  let cloudTimer = null;
  function cloudSave() {
    if (!TG || !tgVer('6.9')) return;
    clearTimeout(cloudTimer);
    cloudTimer = setTimeout(() => {
      const json = JSON.stringify(S);
      const n = Math.ceil(json.length / CLOUD_CHUNK);
      for (let i = 0; i < n; i++) TG.CloudStorage.setItem('s_' + i, json.slice(i * CLOUD_CHUNK, (i + 1) * CLOUD_CHUNK));
      // meta last, so a reader never sees a count pointing at chunks that are not written yet
      TG.CloudStorage.setItem('s_meta', JSON.stringify({ n, t: S.savedAt }));
    }, 1500);
  }
  // done(changed) is always called once: after the cloud copy is applied, skipped, or after a 4s timeout
  function cloudLoad(done) {
    let called = false;
    const finish = changed => { if (!called) { called = true; done(changed); } };
    if (!TG || !tgVer('6.9')) return finish(false);
    setTimeout(() => finish(false), 4000);
    TG.CloudStorage.getItem('s_meta', (err, meta) => {
      if (err || !meta) return finish(false);
      let m; try { m = JSON.parse(meta); } catch (e) { return finish(false); }
      if (!(m.t > (S.savedAt || 0))) return finish(false);   // local copy is newer or equal
      const keys = Array.from({ length: m.n }, (_, i) => 's_' + i);
      TG.CloudStorage.getItems(keys, (err2, vals) => {
        if (err2 || !vals || called) return finish(false);
        try {
          S = Object.assign(freshState(), JSON.parse(keys.map(k => vals[k] || '').join('')));
          sanitize();
          try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* ignore */ }
          finish(true);
        } catch (e) { finish(false); /* partial/corrupt cloud copy: keep local */ }
      });
    });
  }
  const tgUser = () => TG && TG.initDataUnsafe && TG.initDataUnsafe.user;
  const tgName = u => ((u.first_name || '') + ' ' + (u.last_name || '')).trim().slice(0, 20) || u.username || 'Survivor';
  const haptic = kind => {
    try {
      if (!TG || !tgVer('6.1')) return false;
      if (kind === 'success' || kind === 'error' || kind === 'warning') TG.HapticFeedback.notificationOccurred(kind);
      else TG.HapticFeedback.impactOccurred(kind || 'light');
      return true;
    } catch (e) { return false; }
  };
  function tgInit() {
    if (!TG) return;
    document.documentElement.classList.add('tg');
    TG.ready();
    TG.expand();
    try {
      if (tgVer('6.1')) { TG.setHeaderColor('#161616'); TG.setBackgroundColor('#020202'); }
      if (tgVer('7.10')) TG.setBottomBarColor('#161616');
      if (tgVer('7.7')) TG.disableVerticalSwipes();   // scrolling the page must not collapse the app
    } catch (e) { /* older client */ }
    if (tgVer('6.1')) TG.BackButton.onClick(() => { if (history.length > 1) history.back(); else location.hash = '#/'; });
    // Telegram puts launch data into the hash; replace it with the home route
    if (/tgWebApp/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search + '#/');
  }
  tgInit();

  // ephemeral UI state
  const U = {
    inputs: new Set(),     // inventory uids
    balanceAdd: 0,
    targets: [],           // skin names
    invTab: 'inventory',
    invPage: 0, invSort: 'desc',
    upPage: 0, upSort: 'desc',
    filter: { min: '', max: '', q: '' },
    spinning: false,
    result: null,          // 'win' | 'lose'
    angle: 0,
    // inventory page
    inv: { sel: new Set(), q: '', rarity: 'all', cat: 'all', sort: 'price-desc', page: 0, view: 'items' }
  };

  // ---------- sound ----------
  let actx = null;
  function beep(freq, dur = 0.05, type = 'square', vol = 0.04) {
    if (!S.settings.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(vol, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
      o.connect(g).connect(actx.destination);
      o.start(); o.stop(actx.currentTime + dur);
    } catch (e) { /* audio unavailable */ }
  }
  // kind: Telegram haptic type ('success' | 'error' | 'light' | ...), p: navigator.vibrate pattern fallback
  const vibrate = (p, kind) => {
    if (!S.settings.sound) return;
    if (haptic(kind || (Array.isArray(p) ? 'success' : 'error'))) return;
    try { navigator.vibrate && navigator.vibrate(p); } catch (e) { /* unsupported */ }
  };
  const sfxWin = () => { vibrate([40, 60, 40, 60, 160]); [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.18, 'triangle', 0.07), i * 110)); };
  const sfxLose = () => { vibrate(250); [300, 220].forEach((f, i) => setTimeout(() => beep(f, 0.25, 'sawtooth', 0.04), i * 160)); };

  // ---------- toasts / modals ----------
  function toast(msg, type = '') {
    const li = document.createElement('li');
    li.className = 'toast ' + type;
    li.innerHTML = msg;
    $('#toasts').appendChild(li);
    setTimeout(() => { li.classList.add('out'); setTimeout(() => li.remove(), 260); }, 3200);
  }
  function modal(title, body, onMount) {
    const root = $('#modalRoot');
    root.innerHTML = `<div class="modal-backdrop" data-close><div class="modal" role="dialog" aria-label="${esc(title)}">
      <div class="modal-head"><h3>${title}</h3><button class="btn btn-icon small" data-close aria-label="Закрыть">${ICON.x}</button></div>
      <div class="modal-body">${body}</div></div></div>`;
    const bd = root.firstElementChild;
    bd.addEventListener('click', e => {
      if (e.target === bd || e.target.closest('.modal-head [data-close]')) closeModal();
    });
    onMount && onMount(bd.querySelector('.modal'));
  }
  const closeModal = () => { $('#modalRoot').innerHTML = ''; };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  // ---------- auth (demo) ----------
  const AVA_COLORS = ['#cd412b', '#467edf', '#7c954d', '#ae6eee', '#d68a1f', '#2c9c8f'];
  const avatarHtml = (name, color, cls = 'avatar') => `<span class="${cls}" style="background:linear-gradient(135deg,${color},#111)">${esc((name || '?').trim()[0] || '?').toUpperCase()}</span>`;

  // inside Telegram the account is already known: sign in silently with the Telegram name
  function tgLogin() {
    const u = tgUser();
    if (!u || S.user) return false;
    S.user = { name: tgName(u), id: u.id, color: AVA_COLORS[u.id % AVA_COLORS.length], tg: true };
    save(); renderHeader();
    toast(`Добро пожаловать, <b>${esc(S.user.name)}</b>!`, 'success');
    if (!S.rewards.starter) giveStarterPack();
    return true;
  }

  function requireLogin(then) {
    if (S.user) return then && then();
    if (tgLogin()) return;
    modal('Вход', `
      <p class="note" style="font-size:13px;color:var(--text-subtitle)">Это демо-версия: вход через Steam имитируется. Введите ник — он будет виден в ленте дропов.</p>
      <div class="field"><label for="nick">Никнейм</label><input id="nick" class="text-input" maxlength="20" placeholder="Например, Bandit" autocomplete="off"></div>
      <button class="btn btn-steam" id="doLogin" style="height:48px">${ICON.steam}<span>Войти через Steam (демо)</span></button>`,
    m => {
      const inp = $('#nick', m);
      inp.focus();
      const go = () => {
        const name = inp.value.trim() || 'Survivor' + Math.floor(rand(100, 999));
        S.user = { name, id: Math.floor(rand(100000, 999999)), color: pick(AVA_COLORS) };
        save(); closeModal(); renderHeader(); route();
        toast(`Добро пожаловать, <b>${esc(name)}</b>!`, 'success');
        if (!S.rewards.starter) return giveStarterPack();
        then && then();
      };
      $('#doLogin', m).onclick = go;
      inp.addEventListener('keydown', e => e.key === 'Enter' && go());
    });
  }

  // ---------- starter pack (once per demo profile) ----------
  const STARTER_TIERS = [[0, 10], [0, 10], [10, 30], [30, 80], [80, 200]];
  function giveStarterPack() {
    const taken = new Set();
    const names = STARTER_TIERS.map(([lo, hi]) => {
      const pool = SKINS.filter(s => s.price >= lo && s.price < hi && !taken.has(s.name));
      const s = pick(pool.length ? pool : SKINS);
      taken.add(s.name);
      return s.name;
    });
    names.forEach(addItem);
    S.rewards.starter = Date.now();
    save();
    refreshUpgrade();
    const total = sum(names.map(n => byName[n].price));
    modal('Стартовый набор', `
      <p class="note" style="font-size:13px;color:var(--text-subtitle)">Подарок за первый вход — ${names.length} скинов на ${coin(total)}. Они уже в вашем инвентаре: продайте их или поставьте в апгрейд.</p>
      <div class="starter-grid">${names.map((n, i) => `<div class="starter-cell" style="animation-delay:${i * 0.12}s">${card(byName[n], { static: true })}</div>`).join('')}</div>
      <div class="row">
        <a class="btn btn-ghost" href="#/inventory" data-close-go style="flex:1">В инвентарь</a>
        <a class="btn btn-accent" href="#/" data-close-go style="flex:1">Играть</a>
      </div>`,
    m => { m.querySelectorAll('[data-close-go]').forEach(a => a.addEventListener('click', closeModal)); });
    sfxWin();
  }

  // ---------- wallet ----------
  function addBalance(v) {
    S.balance = Math.round((S.balance + v) * 100) / 100;
    save(); renderHeader();
    const b = $('.balance'); if (b) { b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
  }
  // ---------- Telegram channel bonus (replaces top-up) ----------
  // A static site cannot ask Telegram whether the user really joined (that needs the bot token on a server),
  // so the claim unlocks after the channel link was opened.
  const tgBonusDone = () => !!S.rewards.tgSub;
  function openChannel() {
    const url = 'https://t.me/' + TG_CHANNEL;
    if (TG && tgVer('6.1')) TG.openTelegramLink(url); else window.open(url, '_blank', 'noopener');
  }
  // auto pop-up advertising the channel bonus; waits for open modals (login, starter pack) to close
  const PROMO_SNOOZE = 6 * 60 * 60 * 1000;
  function scheduleTgPromo(delay) {
    setTimeout(() => {
      if (tgBonusDone() || Date.now() - (S.rewards.promoHidden || 0) < PROMO_SNOOZE || $('.tg-promo')) return;
      if ($('#modalRoot').children.length || U.spinning) return scheduleTgPromo(3000);
      showTgPromo();
    }, delay);
  }
  function showTgPromo() {
    const el = document.createElement('div');
    el.className = 'tg-promo';
    el.setAttribute('role', 'dialog');
    el.innerHTML = `
      <button class="tg-promo-x" aria-label="Закрыть">${ICON.x}</button>
      <div class="tg-promo-icon">${ICON.tg}</div>
      <div class="tg-promo-body">
        <span class="tg-promo-kicker">Бонус за подписку</span>
        <b class="tg-promo-title">Забирай ${coinInt(TG_BONUS, 22)} на аккаунт</b>
        <span class="tg-promo-text">за подписку на <b>@${TG_CHANNEL}</b></span>
      </div>
      <button class="btn btn-tg tg-promo-go">Забрать</button>`;
    const hide = snooze => {
      if (snooze) { S.rewards.promoHidden = Date.now(); save(); }
      el.classList.add('out');
      setTimeout(() => el.remove(), 300);
    };
    el.querySelector('.tg-promo-x').onclick = () => hide(true);
    el.querySelector('.tg-promo-go').onclick = () => { hide(false); openTgBonus(); };
    document.body.appendChild(el);
    haptic('light');
    beep(880, 0.08, 'triangle', 0.04); setTimeout(() => beep(1320, 0.12, 'triangle', 0.04), 90);
  }
  function openTgBonus() {
    requireLogin(() => {
      if (tgBonusDone()) return modal('Бонус за подписку', `<p class="note" style="font-size:14px">Бонус ${coinInt(TG_BONUS)} уже получен. Спасибо, что с нами в <b>@${TG_CHANNEL}</b>! Больше монет — в разделе <a href="#/rewards" data-close-go>Rewards</a>.</p>`,
        m => $('[data-close-go]', m).addEventListener('click', closeModal));
      let opened = !!S.rewards.tgOpened;
      modal('Бонус за подписку', `
        <div class="tg-bonus"><span class="big">${coinInt(TG_BONUS, 30)}</span><p>Подпишитесь на наш Telegram-канал <b>@${TG_CHANNEL}</b> и получите монеты на баланс. Один раз на аккаунт.</p></div>
        <button class="btn btn-tg" id="tgSub" style="height:48px">${ICON.tg}<span>1. Подписаться на @${TG_CHANNEL}</span></button>
        <button class="btn btn-accent" id="tgClaim" style="height:48px" ${opened ? '' : 'disabled'}><span>2. Получить ${BONUS_TXT}</span></button>
        <p class="note">Монеты виртуальные и не выводятся.</p>`,
      m => {
        $('#tgSub', m).onclick = () => {
          openChannel();
          opened = S.rewards.tgOpened = true; save();
          $('#tgClaim', m).disabled = false;
        };
        $('#tgClaim', m).onclick = () => {
          if (!opened || tgBonusDone()) return;
          S.rewards.tgSub = Date.now();
          $('.tg-promo')?.remove();
          addBalance(TG_BONUS);
          closeModal(); sfxWin();
          toast(`Бонус за подписку: ${coinInt(TG_BONUS)}`, 'success');
          refreshUpgrade();
          if (location.hash === '#/rewards') rewardsPage();
        };
      });
    });
  }

  // ---------- header ----------
  const socials = () => `
    <a href="#" aria-label="VK">${ICON.vk}</a>
    <a href="https://t.me/${TG_CHANNEL}" target="_blank" rel="noopener" aria-label="Telegram">${ICON.tg}</a>
    <a href="#" aria-label="Discord">${ICON.ds}</a>`;

  function renderHeader() {
    $('#headerSocials').innerHTML = socials();
    $('#footerSocials').innerHTML = socials();
    const us = $('#userSection');
    if (!S.user) {
      us.innerHTML = `<button class="btn btn-steam" data-login>${ICON.steam}<span>Войти через Steam</span></button>`;
    } else {
      us.innerHTML = `
        <div class="wallet-group${tgBonusDone() ? ' solo' : ''}">
          <div class="balance">${coin(S.balance)}</div>
          ${tgBonusDone() ? '' : `<button class="btn btn-tg" data-tg-bonus aria-label="Бонус за подписку">${ICON.tg}<span>+${BONUS_TXT}</span></button>`}
        </div>
        <button class="btn btn-icon bell" data-bell aria-label="Уведомления">${ICON.bell}${dailyReady() ? '<span class="dot"></span>' : ''}</button>
        <a href="#/profile" aria-label="Профиль">${avatarHtml(S.user.name, S.user.color)}</a>`;
    }
    document.querySelectorAll('.nav-item[data-route="/rewards"]').forEach(a => {
      a.querySelector('.nav-dot')?.remove();
      if (S.user && dailyReady()) a.insertAdjacentHTML('beforeend', '<span class="nav-dot"></span>');
    });
  }

  // ---------- skin card ----------
  function card(skin, o = {}) {
    const cls = ['skin-card', 'rarity-' + skin.rarity];
    if (o.selected) cls.push('selected');
    if (o.static) cls.push('static');
    if (o.disabled) cls.push('disabled');
    if (o.cls) cls.push(o.cls);
    return `<div class="${cls.join(' ')}" ${o.attrs || ''} title="${esc(skin.name)}">
      <div class="card-img"><img src="${skin.img}" alt="${esc(skin.name)}" loading="lazy" draggable="false"></div>
      ${o.hover ? `<div class="card-hover">${ICON[o.hover]}</div>` : ''}
      ${o.selected ? `<div class="card-sel">${ICON.check}</div>` : ''}
      ${o.remove ? `<button class="remove" ${o.remove} aria-label="Убрать">${ICON.x}</button>` : ''}
      <div class="card-desc">
        <span class="card-name">${esc(skin.name)}</span>
        ${o.price === false ? '' : `<span class="card-price">${coin(o.priceValue ?? skin.price)}</span>`}
      </div>
    </div>`;
  }

  // ---------- live feed ----------
  const BOTS = ['Cr♱stal', 'SaKyra', 'KOKO', 'Lonely', 'Skuf', 'lens', 'kotly', 'KAWASAKI', 'Hameworld', 'ssawer4', 'Treezybad', 'blank', 'tt.spzm', 'imgonnadie', 'Bandit', 'RaidBoss', 'Нубик', 'Олег', 'ZergLord', 'scrap_king', 'Doorcamper', 'Ак47', 'Neon', 'Garage', 'MrMetal'];
  const feed = [];
  let best = null;

  function feedItem(d) {
    return `<a class="drop${d.enter ? ' enter' : ''}" href="#/" data-user="${esc(d.user)}">
      ${card(d.skin, { price: false, static: true })}
      <span class="badge">${ICON.bolt}${d.chance.toFixed(2)} %</span>
      <span class="drop-name">${esc(d.skin.name)}</span>
      <span class="drop-user">${avatarHtml(d.user, d.color, 'mini-ava')}<span>${esc(d.user)}</span></span>
    </a>`;
  }
  function renderBest(enter) {
    if (!best) return;
    $('#bestDrop').innerHTML = `<a class="best${enter ? ' enter' : ''}" href="#/" title="Лучший дроп за час: ${esc(best.skin.name)} — ${esc(best.user)}">
      <span class="best-glow"></span>
      <span class="best-skin"><img src="${best.skin.img}" alt="${esc(best.skin.name)}"></span>
      <span class="badge best">${ICON.bolt}${best.chance.toFixed(2)} %</span>
      <span class="best-label">ЛУЧШИЙ ЗА ЧАС</span>
      <span class="drop-name">${esc(best.skin.name)}</span>
    </a>`;
  }
  function pushDrop(d) {
    feed.unshift(d);
    if (feed.length > 16) feed.length = 16;
    const box = $('#drops');
    box.insertAdjacentHTML('afterbegin', feedItem({ ...d, enter: true }));
    while (box.children.length > 16) box.lastElementChild.remove();
    if (!best || d.skin.price > best.skin.price || Date.now() - best.t > 3600e3) { best = d; renderBest(true); }
  }
  function botDrop() {
    // weighted toward cheap skins, like a real feed
    const r = Math.random();
    const pool = SKINS.filter(s => r < 0.6 ? s.price < 20 : r < 0.92 ? s.price < 200 : true);
    return { user: pick(BOTS), color: pick(AVA_COLORS), skin: pick(pool), chance: rand(5, 79.9), t: Date.now() };
  }
  function initFeed() {
    const seed = Array.from({ length: 16 }, botDrop);
    seed.forEach(d => feed.push(d));
    $('#drops').innerHTML = feed.map(feedItem).join('');
    best = seed.reduce((a, b) => (b.skin.price > a.skin.price ? b : a));
    renderBest(false);
    (function loop() {
      setTimeout(() => { pushDrop(botDrop()); bumpStats(); loop(); }, rand(1800, 4200));
    })();
    // embers
    $('#embers').innerHTML = Array.from({ length: 11 }, (_, i) =>
      `<span class="ember" style="--x:${8 + i * 8}%;--size:${2 + (i % 2)}px;--duration:${rand(3, 4.6).toFixed(1)}s;--delay:-${rand(0, 3.5).toFixed(1)}s;--drift:${(i % 2 ? -1 : 1) * Math.round(rand(5, 12))}px"></span>`).join('');
  }
  let online = 1055, upgradesTotal = 46027915;
  function bumpStats() {
    online = Math.max(700, Math.round(online + rand(-6, 7)));
    upgradesTotal += Math.floor(rand(1, 4));
    $('#statOnline').textContent = fmtInt(online);
    $('#statUpgrades').textContent = fmtInt(upgradesTotal);
  }

  // ---------- upgrade math ----------
  const invItem = u => S.inventory.find(i => i.uid === u);
  const inputSkins = () => [...U.inputs].map(invItem).filter(Boolean).map(i => byName[i.name]);
  const inputValue = () => sum(inputSkins().map(s => s.price)) + U.balanceAdd;
  const targetValue = () => sum(U.targets.map(n => byName[n].price));
  function chance() {
    const iv = inputValue(), tv = targetValue();
    if (!iv || !tv) return 0;
    return (iv / tv) * RTP * 100;
  }
  function validity() {
    const c = chance();
    if (!S.user) return { ok: false, msg: 'Войдите, чтобы играть' };
    if (!inputValue()) return { ok: false, msg: 'Выберите скины или баланс' };
    if (!U.targets.length) return { ok: false, msg: 'Выберите предмет для апгрейда' };
    if (c > MAX_CHANCE) return { ok: false, msg: `Максимальный шанс ${MAX_CHANCE}% — выберите предмет дороже` };
    if (c < MIN_CHANCE) return { ok: false, msg: `Минимальный шанс ${MIN_CHANCE}% — выберите предмет дешевле` };
    return { ok: true, msg: '' };
  }
  const tone = c => (c < 35 ? 'low' : c < 55 ? 'mid' : 'high');
  const toneColor = { low: 'var(--chance-low)', mid: 'var(--chance-mid)', high: 'var(--chance-high)' };

  function rollFor(seeds) {
    const h = hmacSha256(seeds.server, `${seeds.client}:${seeds.nonce}`);
    return (parseInt(h.slice(0, 8), 16) / 0x100000000) * 100;
  }

  // ---------- upgrade page ----------
  function wheelSvg() {
    const ticks = Array.from({ length: 60 }, (_, i) => {
      const a = (i * 6 - 90) * Math.PI / 180, r1 = i % 5 ? 95 : 93, r2 = 98;
      return `<line x1="${100 + r1 * Math.cos(a)}" y1="${100 + r1 * Math.sin(a)}" x2="${100 + r2 * Math.cos(a)}" y2="${100 + r2 * Math.sin(a)}" stroke="${i % 5 ? '#3a352e' : '#5e574c'}" stroke-width="${i % 5 ? 0.8 : 1.4}"/>`;
    }).join('');
    return `<svg class="wheel-svg" viewBox="0 0 200 200">
      <defs>
        <radialGradient id="wInner" cx="50%" cy="40%" r="65%"><stop offset="0" stop-color="#211d18"/><stop offset="1" stop-color="#0b0a09"/></radialGradient>
        <linearGradient id="wRing" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b2722"/><stop offset=".5" stop-color="#151311"/><stop offset="1" stop-color="#2b2722"/></linearGradient>
      </defs>
      <circle cx="100" cy="100" r="99" fill="url(#wRing)" stroke="#020202" stroke-width="1"/>
      ${ticks}
      <circle class="wheel-ring-glow" cx="100" cy="100" r="84" fill="none" stroke-width="16"/>
      <circle cx="100" cy="100" r="84" fill="none" stroke="var(--wheel-bg)" stroke-width="14"/>
      <circle id="wSector" class="wheel-sector" cx="100" cy="100" r="84" fill="none" stroke-width="14" pathLength="100" stroke-dasharray="0 100" transform="rotate(-90 100 100)"/>
      <circle cx="100" cy="100" r="77" fill="none" stroke="#02020266" stroke-width="1"/>
      <circle cx="100" cy="100" r="91" fill="none" stroke="#02020266" stroke-width="1"/>
      <circle cx="100" cy="100" r="74" fill="url(#wInner)" stroke="var(--wheel-line)" stroke-width="2"/>
      <circle cx="100" cy="100" r="62" fill="none" stroke="#ffffff08" stroke-width="1" stroke-dasharray="2 3"/>
    </svg>`;
  }

  function upgradePage() {
    $('#page').innerHTML = `<div class="page">
      <div class="page-logo"><span class="logo"><span class="logo-rust">RUST</span><span class="logo-up">UP</span></span><p>Апгрейд предметов Rust</p></div>
      <div class="upgrader">
        <div class="controls-bar">
          <button class="btn btn-icon" id="ctlSound" title="Звук"></button>
          <button class="btn btn-icon" id="ctlFast" title="Быстрый режим">${ICON.bolt}</button>
          <button class="btn btn-icon" id="ctlHistory" title="История апгрейдов">${ICON.history}</button>
          <a class="btn btn-icon pf" href="#/provably-fair" title="Provably Fair">${ICON.shield}</a>
        </div>
        <div class="wheel-cell"><div class="wheel-wrap" id="wheel">
          ${wheelSvg()}
          <div class="wheel-arrow" id="wArrow" style="transform:rotate(${U.angle % 360}deg)">
            <svg viewBox="0 0 40 46"><path d="M20 44L4 8a4 4 0 013.6-6h24.8A4 4 0 0136 8z" fill="#f2f3f2" stroke="#020202" stroke-width="2"/><path d="M20 36L10 10h20z" fill="#cd412b"/></svg>
          </div>
          <div class="wheel-overlay"><span class="chance-percent" id="wPercent">0.00 %</span><span class="chance-label" id="wLabel">Выберите предметы</span></div>
        </div></div>
        <div class="item-panel left" id="leftPanel"></div>
        <div class="item-panel right" id="rightPanel"></div>
        <div class="balance-bar" id="balanceBar"></div>
        <button class="btn upgrade-btn" id="upBtn">Апгрейд</button>
        <span class="upgrade-hint" id="upHint"></span>
        <div class="multipliers-bar" id="mults"></div>
      </div>
      <div class="inventory-row">
        <div class="inv" id="invBox"></div>
        <div class="inv" id="targetsBox"></div>
      </div>
    </div>`;

    $('#ctlSound').onclick = () => { S.settings.sound = !S.settings.sound; save(); renderControls(); };
    $('#ctlFast').onclick = () => { S.settings.fast = !S.settings.fast; save(); renderControls(); toast(S.settings.fast ? 'Быстрый режим включён' : 'Быстрый режим выключен'); };
    $('#ctlHistory').onclick = openHistory;
    $('#upBtn').onclick = doUpgrade;
    renderControls();
    refreshUpgrade();
  }

  function renderControls() {
    const s = $('#ctlSound'); if (!s) return;
    s.innerHTML = S.settings.sound ? ICON.soundOn : ICON.soundOff;
    s.classList.toggle('active', !S.settings.sound);
    $('#ctlFast').classList.toggle('active', S.settings.fast);
  }

  function refreshUpgrade() {
    if (!$('#leftPanel')) return;
    // drop selections that no longer exist
    U.inputs.forEach(u => { if (!invItem(u)) U.inputs.delete(u); });
    U.balanceAdd = Math.min(U.balanceAdd, S.balance);
    renderLeft(); renderRight(); renderWheel(); renderBalanceBar(); renderMults(); renderButton();
    renderInventory(); renderTargets();
  }

  function renderLeft() {
    const p = $('#leftPanel');
    const skins = [...U.inputs].map(invItem).filter(Boolean);
    p.className = 'item-panel left' + (U.result ? ' ' + U.result : '');
    if (U.result === 'lose' && U.lastInputs) {
      return (p.innerHTML = selGrid(U.lastInputs.map(n => card(byName[n], { static: true, cls: 'flash' })), 'Потеряно', U.lastInputValue));
    }
    if (!skins.length && !U.balanceAdd) {
      p.innerHTML = `<div class="panel-labels"><span class="panel-title">Выберите скины или скины и баланс</span><span class="panel-sub">Можно выбрать несколько предметов</span></div><div class="item-slot">${WEAPON_SVG}</div>`;
      return;
    }
    const cards = skins.map(i => card(byName[i.name], { static: true, remove: `data-unselect="${i.uid}"` }));
    if (U.balanceAdd) cards.push(`<div class="balance-chip">${ICON.coin}<span>${fmt(U.balanceAdd)}</span></div>`);
    p.innerHTML = selGrid(cards, 'Ваша ставка', inputValue());
  }
  function selGrid(cards, label, total) {
    return `<div class="sel-grid" data-count="${cards.length}">${cards.join('')}</div>
      <div class="panel-total"><span class="label">${label}</span>${coin(total)}</div>`;
  }

  function renderRight() {
    const p = $('#rightPanel');
    p.className = 'item-panel right' + (U.result ? ' ' + U.result : '');
    if (U.result === 'win' && U.lastTargets) {
      p.innerHTML = selGrid(U.lastTargets.map(n => card(byName[n], { static: true, cls: 'flash' })), 'Выигрыш', sum(U.lastTargets.map(n => byName[n].price)));
      confetti(p);
      return;
    }
    if (!U.targets.length) {
      p.innerHTML = `<div class="panel-labels"><span class="panel-title">Выберите предмет для апгрейда</span><span class="panel-sub">Или нажмите множитель ниже</span></div><div class="item-slot">${WEAPON_SVG}</div>`;
      return;
    }
    p.innerHTML = selGrid(U.targets.map((n, i) => card(byName[n], { static: true, remove: `data-untarget="${i}"` })), 'Вы получите', targetValue());
  }

  function renderWheel() {
    const c = chance(), shown = Math.min(c, 100);
    const sec = $('#wSector');
    sec.setAttribute('stroke-dasharray', `${Math.min(c, MAX_CHANCE)} ${100 - Math.min(c, MAX_CHANCE)}`);
    sec.style.stroke = c > MAX_CHANCE ? 'var(--text-disabled)' : toneColor[tone(c)];
    $('#wheel').classList.toggle('result-win', U.result === 'win');
    $('#wheel').classList.toggle('result-lose', U.result === 'lose');
    const lbl = $('#wLabel');
    if (U.result) {
      $('#wPercent').textContent = U.result === 'win' ? 'ПОБЕДА' : 'НЕУДАЧА';
      lbl.className = 'chance-label ' + (U.result === 'win' ? 'safe' : 'high');
      lbl.textContent = `Выпало ${U.lastRoll.toFixed(2)}`;
      return;
    }
    $('#wPercent').textContent = `${shown.toFixed(2)} %`;
    if (!c) { lbl.className = 'chance-label'; lbl.textContent = 'Выберите предметы'; }
    else if (c > MAX_CHANCE) { lbl.className = 'chance-label high'; lbl.textContent = `Макс. ${MAX_CHANCE}%`; }
    else if (c >= 50) { lbl.className = 'chance-label safe'; lbl.textContent = 'Безопасно'; }
    else if (c >= 25) { lbl.className = 'chance-label risk'; lbl.textContent = 'Рискованно'; }
    else { lbl.className = 'chance-label high'; lbl.textContent = 'Высокий риск'; }
  }

  function renderBalanceBar() {
    const max = Math.floor(S.balance * 100) / 100;
    const pct = max ? (U.balanceAdd / max) * 100 : 0;
    $('#balanceBar').innerHTML = `
      <div class="balance-top"><span>Добавить баланс:</span>
        <div class="balance-right">${coin(U.balanceAdd, 18)}<small>(Макс ${fmt(max)})</small></div></div>
      <input type="range" class="slider" id="balSlider" min="0" max="${max}" step="0.01" value="${U.balanceAdd}" style="--p:${pct}%" ${max && !U.spinning ? '' : 'disabled'} aria-label="Добавить баланс">`;
    $('#balSlider').oninput = e => {
      U.balanceAdd = Math.round(+e.target.value * 100) / 100;
      U.result = null;
      e.target.style.setProperty('--p', (max ? (U.balanceAdd / max) * 100 : 0) + '%');
      $('#balanceBar .balance-right .coin span').textContent = fmt(U.balanceAdd);
      renderLeft(); renderRight(); renderWheel(); renderButton(); renderMults();
    };
  }

  function renderMults() {
    const has = inputValue() > 0 && !U.spinning;
    const m = [['x', 2, 'X2'], ['x', 4, 'X4'], ['x', 8, 'X8'], ['p', 35, '35%', 'low'], ['p', 55, '55%', 'mid'], ['p', 75, '75%', 'high']];
    $('#mults').innerHTML = m.map(([k, v, t, tn]) => `<button class="mult${U.mult === k + v ? ' on' : ''}" data-mult="${k}${v}" ${tn ? `data-tone="${tn}"` : ''} ${has ? '' : 'disabled'}>${t}</button>`).join('');
  }

  function renderButton() {
    const v = validity();
    const b = $('#upBtn');
    b.disabled = U.spinning || (!v.ok && S.user);
    b.textContent = U.spinning ? 'Крутим…' : S.user ? 'Апгрейд' : 'Войти и играть';
    $('#upHint').textContent = U.spinning ? '' : v.msg;
  }

  function applyMult(key) {
    const iv = inputValue();
    if (!iv) return;
    const kind = key[0], val = +key.slice(1);
    const want = kind === 'x' ? iv * val : (iv * RTP * 100) / val;
    // smallest-error skin whose chance stays within limits
    const ok = SKINS.filter(s => { const c = (iv / s.price) * RTP * 100; return c <= MAX_CHANCE && c >= MIN_CHANCE; });
    if (!ok.length) return toast('Нет подходящего предмета для такой ставки', 'error');
    const best = ok.reduce((a, b) => (Math.abs(Math.log(b.price / want)) < Math.abs(Math.log(a.price / want)) ? b : a));
    U.targets = [best.name];
    U.mult = key; U.result = null;
    refreshUpgrade();
  }

  // ---------- inventory (left) ----------
  function pager(total, page, per) {
    const pages = Math.max(1, Math.ceil(total / per));
    return { pages, page: Math.min(page, pages - 1) };
  }
  const perPage = () => (window.innerWidth <= 768 ? 15 : 16);

  function renderInventory() {
    const box = $('#invBox');
    const tab = U.invTab;
    const per = perPage();
    let items, html;
    const total = sum(S.inventory.map(i => byName[i.name].price));
    const head = `<div class="inv-header">
      <div class="tabs" role="tablist">
        <button class="tab${tab === 'inventory' ? ' active' : ''}" data-tab="inventory" role="tab">${ICON.bag}<span>Мой инвентарь</span></button>
        <button class="tab${tab === 'shop' ? ' active' : ''}" data-tab="shop" role="tab">${ICON.shop}<span>Магазин</span></button>
      </div>
      <div class="inv-header-right">
        <button class="sort-btn" data-sort="inv" data-dir="${U.invSort}" aria-label="Сортировка">${ICON.sort}</button>
        ${tab === 'inventory' ? `<div class="total-badge"><span>Всего скинов</span>${coin(total)}</div>` : `<div class="total-badge"><span>Баланс</span>${coin(S.balance)}</div>`}
      </div></div>`;

    if (tab === 'inventory') {
      items = S.inventory.map(i => ({ ...i, skin: byName[i.name] }))
        .sort((a, b) => (U.invSort === 'desc' ? b.skin.price - a.skin.price : a.skin.price - b.skin.price));
    } else {
      items = SKINS.slice().sort((a, b) => (U.invSort === 'desc' ? b.price - a.price : a.price - b.price)).map(s => ({ skin: s }));
    }
    const pg = pager(items.length, U.invPage, per); U.invPage = pg.page;
    const slice = items.slice(pg.page * per, pg.page * per + per);
    let cells = slice.map(it => tab === 'inventory'
      ? card(it.skin, { selected: U.inputs.has(it.uid), hover: 'plus', attrs: `data-inv="${it.uid}"`, disabled: U.spinning })
      : card(it.skin, { hover: 'cart', attrs: `data-buy="${it.skin.name}"`, disabled: U.spinning }));
    while (cells.length < per) cells.push('<div class="ghost-card"></div>');

    let overlay = '';
    if (tab === 'inventory' && !S.inventory.length) {
      overlay = S.balance >= MIN_TOPUP
        ? `<div class="empty-overlay"><div class="empty-content"><p>Инвентарь пуст</p><span class="muted" style="font-size:12px">Купите скины в магазине или используйте баланс в апгрейде</span><button class="btn btn-accent" data-tab="shop">${ICON.shop}<span>В магазин</span></button></div></div>`
        : tgBonusDone()
          ? `<div class="empty-overlay"><div class="empty-content"><p>Недостаточно монет</p><span class="muted" style="font-size:12px">Заберите ежедневный бонус или введите промокод</span><a class="btn btn-accent" href="#/rewards"><span>Награды</span></a></div></div>`
          : `<div class="empty-overlay"><div class="empty-content"><p>Получите ${coinInt(TG_BONUS, 20)}</p><span class="muted" style="font-size:12px">за подписку на Telegram-канал @${TG_CHANNEL}</span><button class="btn btn-tg" data-tg-bonus>${ICON.tg}<span>Получить</span></button></div></div>`;
    }
    const sel = [...U.inputs];
    html = head + `<div class="grid-container"><div class="grid">${cells.join('')}</div>${overlay}</div>
      <div class="inv-footer">
        ${tab === 'inventory' && sel.length && !U.spinning ? `<button class="btn sell-btn" data-sell>Продать (${sel.length}) · ${fmt(sum(sel.map(u => byName[invItem(u).name].price)))}</button><span class="spacer"></span>` : ''}
        <button class="page-btn" data-page="inv:-1" ${pg.page === 0 ? 'disabled' : ''} aria-label="Назад">${ICON.left}</button>
        <span class="page-num">${pg.page + 1} / ${pg.pages}</span>
        <button class="page-btn" data-page="inv:1" ${pg.page >= pg.pages - 1 ? 'disabled' : ''} aria-label="Вперёд">${ICON.right}</button>
      </div>`;
    box.innerHTML = html;
  }

  // ---------- upgrade targets (right) ----------
  function renderTargets() {
    const box = $('#targetsBox');
    const per = perPage();
    const f = U.filter;
    const iv = inputValue();
    let items = SKINS.filter(s =>
      (f.min === '' || s.price >= +f.min) && (f.max === '' || s.price <= +f.max) &&
      (!f.q || s.name.toLowerCase().includes(f.q.toLowerCase())));
    items.sort((a, b) => (U.upSort === 'desc' ? b.price - a.price : a.price - b.price));
    const pg = pager(items.length, U.upPage, per); U.upPage = pg.page;
    const slice = items.slice(pg.page * per, pg.page * per + per);
    const cells = slice.map(s => {
      const c = iv ? (iv / s.price) * RTP * 100 : 0;
      return card(s, { hover: 'plus', selected: U.targets.includes(s.name), attrs: `data-target="${esc(s.name)}"`, disabled: U.spinning || (iv && c > MAX_CHANCE && !U.targets.includes(s.name)) });
    });
    while (cells.length < per) cells.push('<div class="ghost-card"></div>');
    const keepFocus = document.activeElement && document.activeElement.dataset.filter;
    box.innerHTML = `<div class="inv-header">
        <h3>Предметы для апгрейда</h3>
        <div class="inv-header-right">
          <button class="sort-btn" data-sort="up" data-dir="${U.upSort}" aria-label="Сортировка">${ICON.sort}</button>
          <div class="filters">
            <label class="price-input"><span>MIN</span><input type="number" min="0" data-filter="min" value="${esc(f.min)}"></label>
            <label class="price-input"><span>MAX</span><input type="number" min="0" data-filter="max" value="${esc(f.max)}"></label>
            <input class="search" placeholder="Поиск..." data-filter="q" value="${esc(f.q)}">
          </div>
        </div></div>
      <div class="grid-container"><div class="grid">${cells.join('')}</div>
        ${!items.length ? '<div class="empty-overlay"><div class="empty-content"><p>Ничего не найдено</p></div></div>' : ''}</div>
      <div class="inv-footer">
        <button class="page-btn" data-page="up:-1" ${pg.page === 0 ? 'disabled' : ''} aria-label="Назад">${ICON.left}</button>
        <span class="page-num">${pg.page + 1} / ${pg.pages}</span>
        <button class="page-btn" data-page="up:1" ${pg.page >= pg.pages - 1 ? 'disabled' : ''} aria-label="Вперёд">${ICON.right}</button>
      </div>`;
    if (keepFocus) {
      const el = box.querySelector(`[data-filter="${keepFocus}"]`);
      el.focus();
      if (el.type !== 'number') el.setSelectionRange(el.value.length, el.value.length);
    }
  }

  // ---------- interactions on upgrade page ----------
  document.addEventListener('click', e => {
    const t = e.target;
    if (t.closest('[data-login]')) return requireLogin();
    if (t.closest('[data-tg-bonus]')) return openTgBonus();
    if (t.closest('[data-bell]')) { location.hash = '#/rewards'; return; }
    if (U.spinning) return;

    const un = t.closest('[data-unselect]');
    if (un) { U.inputs.delete(un.dataset.unselect); U.result = null; U.mult = null; return refreshUpgrade(); }
    const ut = t.closest('[data-untarget]');
    if (ut) { U.targets.splice(+ut.dataset.untarget, 1); U.result = null; U.mult = null; return refreshUpgrade(); }

    const tab = t.closest('[data-tab]');
    if (tab) { U.invTab = tab.dataset.tab; U.invPage = 0; return renderInventory(); }

    const so = t.closest('[data-sort]');
    if (so) {
      const k = so.dataset.sort === 'inv' ? 'invSort' : 'upSort';
      U[k] = U[k] === 'desc' ? 'asc' : 'desc';
      return so.dataset.sort === 'inv' ? renderInventory() : renderTargets();
    }
    const pgb = t.closest('[data-page]');
    if (pgb) {
      const [w, d] = pgb.dataset.page.split(':');
      if (w === 'inv') { U.invPage += +d; renderInventory(); } else { U.upPage += +d; renderTargets(); }
      return;
    }
    const inv = t.closest('[data-inv]');
    if (inv) {
      const u = inv.dataset.inv;
      if (U.inputs.has(u)) U.inputs.delete(u);
      else if (U.inputs.size + (U.balanceAdd ? 1 : 0) >= MAX_SLOTS) return toast(`Не больше ${MAX_SLOTS} предметов`, 'error');
      else U.inputs.add(u);
      U.result = null; U.mult = null;
      return refreshUpgrade();
    }
    const buy = t.closest('[data-buy]');
    if (buy) return buySkin(buy.dataset.buy);
    if (t.closest('[data-sell]')) return sellSelected();

    const tg = t.closest('[data-target]');
    if (tg) {
      const n = tg.dataset.target;
      const i = U.targets.indexOf(n);
      if (i >= 0) U.targets.splice(i, 1);
      else if (U.targets.length >= MAX_SLOTS) return toast(`Не больше ${MAX_SLOTS} предметов`, 'error');
      else U.targets.push(n);
      U.result = null; U.mult = null;
      return refreshUpgrade();
    }
    const m = t.closest('[data-mult]');
    if (m) return applyMult(m.dataset.mult);
  });

  document.addEventListener('input', e => {
    const f = e.target.dataset && e.target.dataset.filter;
    if (!f) return;
    U.filter[f] = e.target.value;
    U.upPage = 0;
    renderTargets();
  });

  function buySkin(name) {
    requireLogin(() => {
      const s = byName[name];
      if (S.balance < s.price) return toast(`Недостаточно средств: нужно ${coin(s.price)}`, 'error');
      addBalance(-s.price);
      addItem(name);
      save();
      toast(`Куплено: <b>${esc(name)}</b>`, 'success');
      refreshUpgrade();
    });
  }
  function sellSelected() {
    const items = [...U.inputs].map(invItem).filter(Boolean);
    const total = sum(items.map(i => byName[i.name].price));
    S.inventory = S.inventory.filter(i => !U.inputs.has(i.uid));
    U.inputs.clear();
    addBalance(total);
    toast(`Продано ${items.length} шт. за ${coin(total)}`, 'success');
    refreshUpgrade();
  }

  // ---------- the spin ----------
  function doUpgrade() {
    if (!S.user) return requireLogin();
    const v = validity();
    if (!v.ok || U.spinning) return v.msg && toast(v.msg, 'error');

    const c = chance();
    const seeds = { ...S.seeds };
    const roll = rollFor(seeds);
    const win = roll < c;
    const inSkins = [...U.inputs].map(invItem);
    const inValue = inputValue();
    const targets = U.targets.slice();
    const balUsed = U.balanceAdd;

    // commit stake immediately so a reload mid-spin can't duplicate it
    S.inventory = S.inventory.filter(i => !U.inputs.has(i.uid));
    S.balance = Math.round((S.balance - balUsed) * 100) / 100;
    S.seeds.nonce++;
    save(); renderHeader();

    U.spinning = true; U.result = null;
    renderButton(); renderMults(); renderBalanceBar(); renderInventory(); renderTargets();

    const dur = S.settings.fast ? 1400 : 5200;
    const start = U.angle, startNorm = start % 360;
    const end = start - startNorm + 360 * (S.settings.fast ? 3 : 6) + roll * 3.6;
    const arrow = $('#wArrow');
    const t0 = performance.now();
    let lastTick = Math.floor(start / 12);
    const ease = t => 1 - Math.pow(1 - t, 4);

    // rAF only draws; the timer settles the result even if frames are throttled (background tab)
    let done = false;
    requestAnimationFrame(function frame(now) {
      if (done) return;
      const t = Math.min(1, (now - t0) / dur);
      const a = start + (end - start) * ease(t);
      if (arrow && arrow.isConnected) arrow.style.transform = `rotate(${a}deg)`;
      const tick = Math.floor(a / 12);
      if (tick !== lastTick) { lastTick = tick; beep(1400, 0.015, 'square', 0.02); }
      if (t < 1) requestAnimationFrame(frame);
    });
    setTimeout(finish, dur + 20);

    function finish() {
      done = true;
      U.angle = end;
      const arr = $('#wArrow');
      if (arr) arr.style.transform = `rotate(${end}deg)`;
      if (win) targets.forEach(addItem);
      const tv = sum(targets.map(n => byName[n].price));
      S.stats.upgrades++;
      S.stats.wagered += inValue;
      if (win) { S.stats.wins++; S.stats.won += tv; S.stats.best = Math.max(S.stats.best, tv); }
      S.history.unshift({ t: Date.now(), inputs: inSkins.map(i => i.name), bal: balUsed, targets, chance: c, roll, win, inValue, tv, nonce: seeds.nonce, client: seeds.client, serverHash: seeds.serverHash });
      S.history.length = Math.min(S.history.length, 100);
      save();

      U.spinning = false;
      U.result = win ? 'win' : 'lose';
      U.lastRoll = roll;
      U.lastTargets = targets;
      U.lastInputs = inSkins.map(i => i.name);
      U.lastInputValue = inValue;
      U.inputs.clear(); U.balanceAdd = 0; U.targets = []; U.mult = null;

      if (win) {
        sfxWin();
        toast(`Победа! Вы получили ${targets.map(n => `<b>${esc(n)}</b>`).join(', ')}`, 'success');
        targets.forEach(n => pushDrop({ user: S.user.name, color: S.user.color, skin: byName[n], chance: c, t: Date.now() }));
      } else {
        sfxLose();
        toast(`Не повезло — выпало ${roll.toFixed(2)}, нужно было меньше ${c.toFixed(2)}`, 'error');
      }
      refreshUpgrade();
      renderHeader();
    }
  }

  // ---------- confetti ----------
  function confetti(host) {
    const cv = document.createElement('canvas');
    cv.className = 'confetti';
    host.appendChild(cv);
    const w = cv.width = host.clientWidth * devicePixelRatio, h = cv.height = host.clientHeight * devicePixelRatio;
    const ctx = cv.getContext('2d');
    const cols = ['#cd412b', '#ffdd59', '#84b030', '#f2f3f2', '#ae6eee'];
    const ps = Array.from({ length: 90 }, () => ({ x: w / 2, y: h * 0.6, vx: rand(-1, 1) * 9 * devicePixelRatio, vy: rand(-14, -5) * devicePixelRatio, s: rand(3, 7) * devicePixelRatio, c: pick(cols), r: rand(0, 6), vr: rand(-.3, .3) }));
    const t0 = performance.now();
    (function f(now) {
      ctx.clearRect(0, 0, w, h);
      ps.forEach(p => { p.vy += 0.45 * devicePixelRatio; p.x += p.vx; p.y += p.vy; p.vx *= 0.99; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore(); });
      if (now - t0 < 2200 && cv.isConnected) requestAnimationFrame(f); else cv.remove();
    })(t0);
  }

  // ---------- history modal ----------
  function openHistory() {
    const rows = S.history.slice(0, 30).map(h => `<div class="history-item">
      <span>${new Date(h.t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
      <span>${coin(h.inValue)} → ${coin(h.tv)}</span>
      <span class="muted">${h.chance.toFixed(2)}%</span>
      <span class="res" style="color:${h.win ? 'var(--success)' : 'var(--error)'}">${h.win ? 'WIN' : 'LOSE'} · ${h.roll.toFixed(2)}</span></div>`).join('');
    modal('История апгрейдов', rows ? `<div class="history-list">${rows}</div>` : '<p class="note">Пока пусто — сделайте первый апгрейд.</p>');
  }

  // ---------- rewards ----------
  const dailyReady = () => Date.now() - (S.rewards.lastDaily || 0) >= DAILY_MS;
  const LEVEL_XP = n => Math.round(40 * Math.pow(n, 1.6)); // wagered coins needed for level n
  function levelInfo() {
    const xp = S.stats.wagered;
    let lvl = 0;
    while (xp >= LEVEL_XP(lvl + 1)) lvl++;
    const cur = LEVEL_XP(lvl), next = LEVEL_XP(lvl + 1);
    return { lvl, xp, cur, next, pct: lvl === 0 && !xp ? 0 : ((xp - (lvl ? cur : 0)) / (next - (lvl ? cur : 0))) * 100 };
  }

  function rewardsPage() {
    const li = levelInfo();
    const dailyAmt = 10 + li.lvl * 2;
    const left = DAILY_MS - (Date.now() - (S.rewards.lastDaily || 0));
    const hh = Math.max(0, Math.floor(left / 3600e3)), mm = Math.max(0, Math.floor((left % 3600e3) / 60e3));
    const claimable = Math.max(0, li.lvl - S.rewards.claimedLevel);
    const lvlReward = sum(Array.from({ length: claimable }, (_, i) => (S.rewards.claimedLevel + i + 1) * 5));
    const from = Math.max(1, li.lvl - 4);
    const tiles = Array.from({ length: 10 }, (_, i) => from + i).map(n =>
      `<div class="level ${n <= li.lvl ? 'done' : ''} ${n === li.lvl + 1 ? 'now' : ''}">${n}</div>`).join('');

    $('#page').innerHTML = `<div class="page">
      <h2 class="section-title">Награды</h2>
      <div class="panel reward-card tg-banner"><span class="glow"></span>
        <div class="tg-banner-text"><h4>Подписка на Telegram</h4>
          <p>Подпишитесь на канал <b>@${TG_CHANNEL}</b> — новости, промокоды и розыгрыши. Бонус ${coinInt(TG_BONUS)} один раз на аккаунт.</p></div>
        <button class="btn ${tgBonusDone() ? 'btn-ghost' : 'btn-tg'}" data-tg-bonus>${ICON.tg}<span>${tgBonusDone() ? 'Получено' : `Получить ${BONUS_TXT}`}</span></button>
      </div>
      <div class="cards-3">
        <div class="panel reward-card"><span class="glow"></span>
          <h4>Ежедневный бонус</h4>
          <span class="big">${coin(dailyAmt)}</span>
          <p>Забирайте монеты каждые 24 часа. Чем выше уровень — тем больше бонус.</p>
          <button class="btn ${dailyReady() ? 'btn-accent' : 'btn-ghost'}" id="claimDaily" ${dailyReady() ? '' : 'disabled'}>${dailyReady() ? 'Забрать' : `Через ${hh} ч ${mm} мин`}</button>
        </div>
        <div class="panel reward-card">
          <h4>Промокод</h4>
          <p>Введите промокод и получите бонус на баланс. Для демо работают: <b>RUSTUP</b>, <b>WIPE</b>, <b>DEMO</b>.</p>
          <div class="row"><input class="text-input" id="promo" placeholder="Промокод" maxlength="20"><button class="btn btn-accent" id="applyPromo">OK</button></div>
        </div>
        <div class="panel reward-card">
          <h4>Награда за уровень</h4>
          <span class="big">${coin(lvlReward)}</span>
          <p>За каждый новый уровень боевого пропуска — уровень × 5 монет.</p>
          <button class="btn ${claimable ? 'btn-accent' : 'btn-ghost'}" id="claimLevel" ${claimable ? '' : 'disabled'}>${claimable ? `Забрать (${claimable})` : 'Нет наград'}</button>
        </div>
      </div>
      <h2 class="section-title">Боевой пропуск · Вайп</h2>
      <div class="panel" style="display:flex;flex-direction:column;gap:16px">
        <div class="row" style="justify-content:space-between;flex-wrap:wrap"><b style="font-size:18px">Уровень ${li.lvl}</b><span class="muted">${fmt(li.xp)} / ${fmt(li.next)} XP · 1 монета в апгрейде = 1 XP</span></div>
        <div class="progress"><div style="width:${Math.min(100, li.pct)}%"></div></div>
        <div class="levels">${tiles}</div>
      </div>
    </div>`;

    $('#claimDaily').onclick = () => requireLogin(() => {
      if (!dailyReady()) return;
      S.rewards.lastDaily = Date.now(); addBalance(dailyAmt);
      toast(`Ежедневный бонус: ${coin(dailyAmt)}`, 'success'); rewardsPage(); renderHeader();
    });
    $('#claimLevel').onclick = () => requireLogin(() => {
      S.rewards.claimedLevel = li.lvl; addBalance(lvlReward);
      toast(`Награда за уровни: ${coin(lvlReward)}`, 'success'); rewardsPage();
    });
    const apply = () => requireLogin(() => {
      const code = $('#promo').value.trim().toUpperCase();
      if (!PROMOS[code]) return toast('Промокод не найден', 'error');
      if (S.rewards.promos.includes(code)) return toast('Промокод уже использован', 'error');
      S.rewards.promos.push(code); addBalance(PROMOS[code]);
      toast(`Промокод активирован: ${coin(PROMOS[code])}`, 'success'); $('#promo').value = '';
    });
    $('#applyPromo').onclick = apply;
    $('#promo').addEventListener('keydown', e => e.key === 'Enter' && apply());
  }

  // ---------- profile ----------
  function profilePage() {
    if (!S.user) {
      $('#page').innerHTML = `<div class="page"><div class="panel" style="text-align:center;padding:60px 24px"><h2 style="margin-top:0">Профиль</h2><p class="muted">Войдите, чтобы увидеть профиль</p><button class="btn btn-steam" data-login>${ICON.steam}<span>Войти через Steam</span></button></div></div>`;
      return;
    }
    const st = S.stats, li = levelInfo();
    const rows = S.history.slice(0, 50).map(h => `<tr>
      <td>${new Date(h.t).toLocaleString('ru-RU')}</td>
      <td>${h.inputs.map(esc).join(', ') || '—'}${h.bal ? ` + ${fmt(h.bal)}` : ''}</td>
      <td>${h.targets.map(esc).join(', ')}</td>
      <td>${h.chance.toFixed(2)}%</td>
      <td class="mono">${h.roll.toFixed(4)}</td>
      <td class="${h.win ? 'ok' : 'bad'}">${h.win ? 'Победа' : 'Проигрыш'}</td></tr>`).join('');
    $('#page').innerHTML = `<div class="page">
      <div class="profile-head">
        ${avatarHtml(S.user.name, S.user.color)}
        <div><h2>${esc(S.user.name)}</h2><span class="muted">ID ${S.user.id} · Уровень ${li.lvl}</span></div>
        <div class="row" style="margin-left:auto;flex-wrap:wrap">
          <button class="btn btn-ghost" id="rename">Сменить ник</button>
          <button class="btn btn-ghost" id="reset">Сбросить демо</button>
          <button class="btn btn-accent" id="logout">Выйти</button>
        </div>
      </div>
      <div class="stat-grid">
        <div class="panel"><div class="k">Апгрейдов</div><div class="v">${fmtInt(st.upgrades)}</div></div>
        <div class="panel"><div class="k">Побед</div><div class="v">${fmtInt(st.wins)} <span class="muted" style="font-size:14px">${st.upgrades ? ((st.wins / st.upgrades) * 100).toFixed(1) + '%' : ''}</span></div></div>
        <div class="panel"><div class="k">Поставлено</div><div class="v">${coin(st.wagered)}</div></div>
        <div class="panel"><div class="k">Лучший выигрыш</div><div class="v">${coin(st.best)}</div></div>
      </div>
      <h2 class="section-title">История</h2>
      <div class="panel" style="padding:0"><div class="table-wrap">
        ${rows ? `<table class="table"><thead><tr><th>Время</th><th>Ставка</th><th>Цель</th><th>Шанс</th><th>Ролл</th><th>Итог</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted" style="padding:24px;margin:0">История пуста</p>'}
      </div></div>
    </div>`;
    $('#logout').onclick = () => { S.user = null; save(); renderHeader(); location.hash = '#/'; };
    $('#rename').onclick = () => {
      const n = prompt('Новый ник', S.user.name);
      if (n && n.trim()) { S.user.name = n.trim().slice(0, 20); save(); renderHeader(); profilePage(); }
    };
    $('#reset').onclick = () => {
      if (!confirm('Сбросить баланс, инвентарь и историю демо?')) return;
      const user = S.user; S = freshState(); S.user = user; save();
      U.inputs.clear(); U.targets = []; U.balanceAdd = 0; U.result = null;
      renderHeader(); profilePage(); toast('Демо сброшено');
    };
  }

  // ---------- provably fair ----------
  function fairPage() {
    const sd = S.seeds;
    $('#page').innerHTML = `<div class="page">
      <h2 class="section-title">Provably Fair</h2>
      <div class="prose">
        <p>Результат каждого апгрейда определяется заранее и может быть проверен. Сервер выбирает секретный <b>server seed</b> и показывает вам только его SHA-256 хэш. Вы задаёте свой <b>client seed</b>. Каждый апгрейд увеличивает <b>nonce</b> на 1.</p>
        <p>Ролл: <code>HMAC_SHA256(server_seed, client_seed:nonce)</code> → первые 8 hex-символов → число / 2<sup>32</sup> × 100. Если ролл меньше шанса — апгрейд успешен. Стрелка колеса останавливается ровно на ролле, а зелёный/жёлтый/красный сектор начинается сверху и занимает «шанс» процентов круга.</p>
        <p>Шанс считается так: <code>стоимость ставки / стоимость цели × ${RTP} × 100</code>, максимум ${MAX_CHANCE}%.</p>
      </div>
      <div class="cards-3" style="margin-top:24px">
        <div class="panel">
          <div class="field"><label>Хэш текущего server seed</label><div class="mono">${sd.serverHash}</div></div>
          <div class="field"><label for="cseed">Client seed</label><div class="row"><input id="cseed" class="text-input mono" value="${esc(sd.client)}" maxlength="64"><button class="btn btn-accent" id="saveSeed">OK</button></div></div>
          <div class="field"><label>Nonce</label><div class="mono">${sd.nonce}</div></div>
          <button class="btn btn-ghost" id="rotate" style="width:100%">Сменить server seed (раскрыть текущий)</button>
        </div>
        <div class="panel">
          <div class="field"><label>Предыдущий server seed (раскрыт)</label><div class="mono">${sd.prev ? sd.prev.server : '—'}</div></div>
          <div class="field"><label>Его хэш</label><div class="mono">${sd.prev ? sd.prev.serverHash : '—'}</div></div>
          <div class="field"><label>Client seed / последний nonce</label><div class="mono">${sd.prev ? `${esc(sd.prev.client)} / ${sd.prev.nonce - 1}` : '—'}</div></div>
        </div>
        <div class="panel">
          <div class="field"><label for="vS">Server seed</label><input id="vS" class="text-input mono" value="${sd.prev ? sd.prev.server : ''}"></div>
          <div class="field"><label for="vC">Client seed</label><input id="vC" class="text-input mono" value="${sd.prev ? esc(sd.prev.client) : ''}"></div>
          <div class="field"><label for="vN">Nonce</label><input id="vN" class="text-input mono" type="number" min="0" value="0"></div>
          <button class="btn btn-accent" id="verify" style="width:100%">Проверить</button>
          <div class="field" style="margin-top:12px"><label>Ролл</label><div class="pf-result" id="vR">—</div><div class="mono muted" id="vH"></div></div>
        </div>
      </div>
    </div>`;
    $('#saveSeed').onclick = () => {
      const v = $('#cseed').value.trim();
      if (!v) return toast('Client seed не может быть пустым', 'error');
      S.seeds.client = v; S.seeds.nonce = 0; save(); toast('Client seed сохранён, nonce сброшен', 'success'); fairPage();
    };
    $('#rotate').onclick = () => {
      const server = randHex(32);
      S.seeds.prev = { server: S.seeds.server, serverHash: S.seeds.serverHash, client: S.seeds.client, nonce: S.seeds.nonce };
      S.seeds.server = server; S.seeds.serverHash = sha256(server); S.seeds.nonce = 0;
      save(); toast('Server seed сменён, предыдущий раскрыт', 'success'); fairPage();
    };
    $('#verify').onclick = () => {
      const s = { server: $('#vS').value.trim(), client: $('#vC').value.trim(), nonce: +$('#vN').value || 0 };
      if (!s.server) return toast('Укажите server seed', 'error');
      $('#vR').textContent = rollFor(s).toFixed(4);
      $('#vH').textContent = 'SHA-256(server seed) = ' + sha256(s.server);
    };
  }

  // ---------- inventory page ----------
  const CATS = {
    weapon: /\b(ak47|ar|mp5|sar|sap|thompson|lr|m39|sks|revolver|shotgun|lmg|hmlmg|rocket launcher|bow|eoka|sword|longsword|bat|rifle)\b/i,
    clothing: /\b(pants|jacket|hoodie|kilt|boots|gloves|facemask|mask|helmet|chestplate|vest|bandana|balaclava|hat|cap|shirt|tshirt|t-shirt|poncho|wraps|jeans|backpack|pantalones|armor|bandana)\b/i,
    deploy: /\b(door|box|furnace|bed|sleeping bag|barricade|frame|sign|banner|turret|chest|lamp|torch|garlands|bbq|lights|cauldron|grave|post|storage|nest|wallpaper|rock|skull)\b/i
  };
  const catOf = name => (CATS.weapon.test(name) ? 'weapon' : CATS.clothing.test(name) ? 'clothing' : CATS.deploy.test(name) ? 'deploy' : 'other');
  const CAT_LABEL = { all: 'Все типы', weapon: 'Оружие', clothing: 'Одежда', deploy: 'Постройки', other: 'Прочее' };
  const RARITY_LABEL = { all: 'Все', gray: 'Обычные', blue: 'Необычные', fiol: 'Редкие', red: 'Мифические', yellow: 'Легендарные' };
  const TRADE_RE = /^https:\/\/steamcommunity\.com\/tradeoffer\/new\/\?partner=\d+&token=[\w-]{6,12}$/;
  const INV_PER = 30;

  function inventoryItems() {
    const v = U.inv;
    const q = v.q.trim().toLowerCase();
    const list = S.inventory.map(i => ({ ...i, skin: byName[i.name] })).filter(i =>
      (v.rarity === 'all' || i.skin.rarity === v.rarity) &&
      (v.cat === 'all' || catOf(i.name) === v.cat) &&
      (!q || i.name.toLowerCase().includes(q)));
    const cmp = {
      'price-desc': (a, b) => b.skin.price - a.skin.price,
      'price-asc': (a, b) => a.skin.price - b.skin.price,
      'new': (a, b) => (b.t || 0) - (a.t || 0),
      'old': (a, b) => (a.t || 0) - (b.t || 0),
      'name': (a, b) => a.name.localeCompare(b.name)
    }[v.sort];
    return list.sort(cmp);
  }

  function inventoryPage() {
    if (!S.user) {
      $('#page').innerHTML = `<div class="page"><div class="panel" style="text-align:center;padding:60px 24px"><h2 style="margin-top:0">Инвентарь</h2><p class="muted">Войдите, чтобы увидеть свои скины</p><button class="btn btn-steam" data-login>${ICON.steam}<span>Войти через Steam</span></button></div></div>`;
      return;
    }
    const v = U.inv;
    v.sel.forEach(u => { if (!invItem(u)) v.sel.delete(u); });
    const total = sum(S.inventory.map(i => byName[i.name].price));
    $('#page').innerHTML = `<div class="page inv-page">
      <div class="inv-page-head">
        <h2 class="section-title" style="margin:0">Инвентарь</h2>
        <div class="inv-summary">
          <div class="chip"><span>Предметов</span><b>${fmtInt(S.inventory.length)}</b></div>
          <div class="chip"><span>Стоимость</span>${coin(total)}</div>
          <div class="chip"><span>Баланс</span>${coin(S.balance)}</div>
        </div>
      </div>
      <div class="tabs inv-tabs">
        <button class="tab${v.view === 'items' ? ' active' : ''}" data-iview="items">${ICON.bag}<span>Предметы</span></button>
        <button class="tab${v.view === 'withdrawals' ? ' active' : ''}" data-iview="withdrawals">${ICON.history}<span>Выводы</span></button>
      </div>
      <div id="invPageBody"></div>
    </div>`;
    $('#page .inv-tabs').onclick = e => {
      const b = e.target.closest('[data-iview]');
      if (b) { v.view = b.dataset.iview; inventoryPage(); }
    };
    v.view === 'items' ? renderInvItems() : renderWithdrawals();
  }

  function renderInvItems() {
    const v = U.inv;
    const body = $('#invPageBody');
    const items = inventoryItems();
    const pages = Math.max(1, Math.ceil(items.length / INV_PER));
    v.page = Math.min(v.page, pages - 1);
    const slice = items.slice(v.page * INV_PER, (v.page + 1) * INV_PER);
    const selItems = [...v.sel].map(invItem).filter(Boolean);
    const selValue = sum(selItems.map(i => byName[i.name].price));
    const fresh = t => t && Date.now() - t < 10 * 60e3;

    body.innerHTML = `
      <div class="inv-toolbar">
        <input class="search" id="ipSearch" placeholder="Поиск по названию..." value="${esc(v.q)}">
        <div class="rarity-chips">${Object.keys(RARITY_LABEL).map(r =>
          `<button class="rchip${v.rarity === r ? ' on' : ''}" data-ir="${r}" ${r !== 'all' ? `style="--rc:var(--skin-${r})"` : ''}>${r !== 'all' ? '<i></i>' : ''}${RARITY_LABEL[r]}</button>`).join('')}</div>
        <select class="select" id="ipCat">${Object.keys(CAT_LABEL).map(c => `<option value="${c}"${v.cat === c ? ' selected' : ''}>${CAT_LABEL[c]}</option>`).join('')}</select>
        <select class="select" id="ipSort">
          <option value="price-desc">Сначала дорогие</option><option value="price-asc">Сначала дешёвые</option>
          <option value="new">Сначала новые</option><option value="old">Сначала старые</option><option value="name">По названию</option>
        </select>
      </div>
      ${!S.inventory.length ? `<div class="panel inv-empty">
          <p>В инвентаре пока пусто</p>
          <span class="muted">Купите скины в магазине или выиграйте их в апгрейде</span>
          <div class="row" style="justify-content:center;flex-wrap:wrap">
            <a class="btn btn-accent" href="#/" data-goshop>${ICON.shop}<span>В магазин</span></a>
            ${tgBonusDone() ? '' : `<button class="btn btn-tg" data-tg-bonus>${ICON.tg}<span>+${BONUS_TXT} за подписку</span></button>`}
          </div></div>`
      : !items.length ? '<div class="panel inv-empty"><p>Ничего не найдено</p><span class="muted">Измените фильтры</span></div>'
      : `<div class="inv-grid">${slice.map(i => `<div class="inv-cell${fresh(i.t) ? ' fresh' : ''}">
            ${card(i.skin, { selected: v.sel.has(i.uid), hover: 'check', attrs: `data-isel="${i.uid}"` })}
            <span class="cat-tag">${CAT_LABEL[catOf(i.name)]}</span>
          </div>`).join('')}</div>
        <div class="inv-pager">
          <button class="page-btn" data-ipage="-1" ${v.page === 0 ? 'disabled' : ''} aria-label="Назад">${ICON.left}</button>
          <span class="page-num">${v.page + 1} / ${pages}</span>
          <button class="page-btn" data-ipage="1" ${v.page >= pages - 1 ? 'disabled' : ''} aria-label="Вперёд">${ICON.right}</button>
        </div>`}
      <div class="action-bar${v.sel.size ? ' show' : ''}">
        <div class="ab-info"><b>Выбрано: ${v.sel.size}</b>${coin(selValue)}</div>
        <div class="ab-actions">
          <button class="btn btn-ghost" data-iact="all">${items.every(i => v.sel.has(i.uid)) && items.length ? 'Снять всё' : 'Выбрать всё'}</button>
          <button class="btn btn-ghost" data-iact="clear">Сбросить</button>
          <button class="btn sell-btn" data-iact="sell">Продать</button>
          <button class="btn btn-accent" data-iact="upgrade">В апгрейд</button>
          <button class="btn btn-steam" data-iact="withdraw">${ICON.steam}<span>Вывести</span></button>
        </div>
      </div>`;

    $('#ipSort').value = v.sort;
    const search = $('#ipSearch');
    search.oninput = () => {
      v.q = search.value; v.page = 0; renderInvItems();
      const s = $('#ipSearch'); s.focus(); s.setSelectionRange(s.value.length, s.value.length);
    };
    $('#ipCat').onchange = e => { v.cat = e.target.value; v.page = 0; renderInvItems(); };
    $('#ipSort').onchange = e => { v.sort = e.target.value; renderInvItems(); };
    body.onclick = e => {
      const t = e.target;
      const r = t.closest('[data-ir]');
      if (r) { v.rarity = r.dataset.ir; v.page = 0; return renderInvItems(); }
      const c = t.closest('[data-isel]');
      if (c) { const u = c.dataset.isel; v.sel.has(u) ? v.sel.delete(u) : v.sel.add(u); return renderInvItems(); }
      const p = t.closest('[data-ipage]');
      if (p) { v.page += +p.dataset.ipage; renderInvItems(); return window.scrollTo({ top: 0, behavior: 'smooth' }); }
      if (t.closest('[data-goshop]')) { U.invTab = 'shop'; return; }
      const a = t.closest('[data-iact]');
      if (a) invAction(a.dataset.iact, items);
    };
  }

  function invAction(act, visible) {
    const v = U.inv;
    const sel = [...v.sel].map(invItem).filter(Boolean);
    if (act === 'all') {
      const allOn = visible.every(i => v.sel.has(i.uid));
      visible.forEach(i => (allOn ? v.sel.delete(i.uid) : v.sel.add(i.uid)));
      return renderInvItems();
    }
    if (act === 'clear') { v.sel.clear(); return renderInvItems(); }
    if (!sel.length) return;
    if (act === 'sell') {
      const total = sum(sel.map(i => byName[i.name].price));
      if (!confirm(`Продать ${sel.length} шт. за ${fmt(total)} монет?`)) return;
      S.inventory = S.inventory.filter(i => !v.sel.has(i.uid));
      v.sel.clear();
      addBalance(total);
      toast(`Продано ${sel.length} шт. за ${coin(total)}`, 'success');
      return inventoryPage();
    }
    if (act === 'upgrade') {
      if (sel.length > MAX_SLOTS) return toast(`В апгрейд можно взять не больше ${MAX_SLOTS} предметов`, 'error');
      U.inputs = new Set(sel.map(i => i.uid));
      U.balanceAdd = 0; U.result = null; U.mult = null;
      v.sel.clear();
      location.hash = '#/';
      return;
    }
    if (act === 'withdraw') openWithdraw(sel);
  }

  function openWithdraw(sel) {
    const total = sum(sel.map(i => byName[i.name].price));
    modal('Вывод в Steam', `
      <p class="note" style="font-size:13px;color:var(--text-subtitle)">Будет отправлено <b style="color:var(--text-title)">${sel.length} шт.</b> на сумму ${coin(total)}. Бот пришлёт трейд-оффер на вашу ссылку обмена.</p>
      <div class="field"><label for="trade">Ссылка на обмен Steam</label>
        <input id="trade" class="text-input mono" placeholder="https://steamcommunity.com/tradeoffer/new/?partner=...&token=..." value="${esc(S.user.tradeLink || '')}"></div>
      <button class="btn btn-steam" id="doWithdraw" style="height:48px">${ICON.steam}<span>Вывести (демо)</span></button>
      <p class="note">Демо-режим: настоящий трейд не отправляется, предметы просто списываются из инвентаря и попадают в историю выводов. Ссылку можно найти в Steam: Инвентарь → Предложения обмена → «Кто может отправлять мне предложения».</p>`,
    m => {
      $('#doWithdraw', m).onclick = () => {
        const link = $('#trade', m).value.trim();
        if (!TRADE_RE.test(link)) return toast('Неверная ссылка на обмен', 'error');
        S.user.tradeLink = link;
        const uids = new Set(sel.map(i => i.uid));
        S.inventory = S.inventory.filter(i => !uids.has(i.uid));
        S.withdrawals.unshift({ id: Math.floor(rand(1e6, 9e6)), t: Date.now(), items: sel.map(i => i.name), value: total, status: 'sent' });
        U.inv.sel.clear();
        save(); closeModal();
        toast(`Вывод оформлен: ${sel.length} шт. на ${coin(total)}`, 'success');
        inventoryPage();
      };
    });
  }

  function renderWithdrawals() {
    const rows = S.withdrawals.map(w => `<tr>
      <td class="mono">#${w.id}</td>
      <td>${new Date(w.t).toLocaleString('ru-RU')}</td>
      <td>${w.items.slice(0, 3).map(esc).join(', ')}${w.items.length > 3 ? ` и ещё ${w.items.length - 3}` : ''}</td>
      <td>${coin(w.value)}</td>
      <td class="ok">Отправлено (демо)</td></tr>`).join('');
    $('#invPageBody').innerHTML = `<div class="panel" style="padding:0"><div class="table-wrap">${rows
      ? `<table class="table"><thead><tr><th>Заявка</th><th>Время</th><th>Предметы</th><th>Сумма</th><th>Статус</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="muted" style="padding:24px;margin:0">Выводов пока не было</p>'}</div></div>`;
  }

  // ---------- static text pages ----------
  function textPage(title, body) {
    $('#page').innerHTML = `<div class="page"><h2 class="section-title">${title}</h2><div class="panel prose">${body}</div></div>`;
  }

  // ---------- router ----------
  function route() {
    const path = (location.hash.replace(/^#/, '') || '/').split('?')[0];
    document.querySelectorAll('.nav-item[data-route]').forEach(a => a.classList.toggle('active', a.dataset.route === path));
    if (path !== '/') U.result = null;
    if (tgVer('6.1')) TG.BackButton[path === '/' ? 'hide' : 'show']();
    switch (path) {
      case '/rewards': rewardsPage(); break;
      case '/inventory': inventoryPage(); break;
      case '/profile': profilePage(); break;
      case '/provably-fair': fairPage(); break;
      case '/tos': textPage('Условия использования', '<p>RUST UP — демонстрационный интерфейс. Баланс, скины и результаты виртуальные и не имеют денежной стоимости, их нельзя вывести или обменять.</p><p>Проект не связан с Valve, Steam и Facepunch Studios. Изображения предметов принадлежат их правообладателям.</p>'); break;
      case '/privacy': textPage('Политика конфиденциальности', '<p>Демо-версия не отправляет данные на сервер. Ник, баланс, инвентарь и история хранятся только в localStorage вашего браузера. Очистка данных сайта полностью удаляет их.</p>'); break;
      default: upgradePage();
    }
    window.scrollTo({ top: 0 });
  }

  // re-render grids when crossing the mobile breakpoint (page size changes 16 <-> 15)
  let lastPer = perPage();
  window.addEventListener('resize', () => {
    if (perPage() !== lastPer) { lastPer = perPage(); if ($('#invBox')) { renderInventory(); renderTargets(); } }
  });

  window.addEventListener('hashchange', route);
  renderHeader();
  initFeed();
  route();
  // Telegram: pull newer progress from the account's cloud, then sign in with the Telegram profile
  cloudLoad(changed => {
    if (changed) { U.inputs.clear(); U.inv.sel.clear(); renderHeader(); route(); }
    tgLogin();
    scheduleTgPromo(5000);
  });
  setInterval(() => { renderHeader(); }, 60e3);
})();
