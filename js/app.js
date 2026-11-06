/* RUST UP — Telegram Mini App: wallet, inventory and results must be server-authoritative. */
(function () {
  'use strict';

  // ---------- constants: game rules are shared with the server (js/rules.js → bot/gamedata.js) ----------
  const R = window.RUSTUP_RULES;
  const { RTP, MAX_CHANCE, MIN_CHANCE, MAX_SLOTS, TG_CHANNEL, TG_BONUS, PROMOS, DAILY_MS, DAILY_BONUS } = R;
  const MIN_TOPUP = 10;           // below this balance the upgrader suggests getting coins
  // Rewards are denominated in rubles; the backend must credit exactly 5000 kopecks.
  const bonusTxt = () => `${R.BONUS_RUB} ₽`;
  const STORE_KEY = 'rustup_demo_v1';

  // one catalog for all games; names don't collide ("AK47" in Rust vs "AK-47 | ..." in CS2)
  const SKINS = [
    ...window.SKINS.map(s => ({ ...s, game: 'rust' })),
    ...(window.SKINS_CS2 || []).map(s => ({ ...s, game: 'cs2' })),
    // the Telegram tab holds both NFT gifts and regular (star) gifts
    ...(window.SKINS_NFT || []).map(s => ({ ...s, game: 'nft' })),
    ...(window.SKINS_GIFTS || []).map(s => ({ ...s, game: 'nft' }))
  ].map((s, i) => ({ ...s, id: i }));
  const byName = Object.fromEntries(SKINS.map(s => [s.name, s]));
  // per-game skins, cheapest first
  const POOL = { rust: [], cs2: [], nft: [] };
  SKINS.forEach(s => POOL[s.game].push(s));
  Object.values(POOL).forEach(p => p.sort((a, b) => a.price - b.price));
  const gamePool = () => POOL[U.game] || POOL.rust;
  const ofGame = name => byName[name].game === U.game;

  // ---------- utils ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const fmtInt = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const randHex = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('');
  const sum = arr => arr.reduce((a, b) => a + b, 0);

  const ICON = {
    coin: '<svg viewBox="0 0 20 20" aria-hidden="true"><polygon points="10,1 18,5.5 18,14.5 10,19 2,14.5 2,5.5" fill="#e0a83a"/><polygon points="10,3.5 15.8,6.8 15.8,13.2 10,16.5 4.2,13.2 4.2,6.8" fill="#b97a1c"/><path d="M10 5.5l3.6 2.1v4.8L10 14.5l-3.6-2.1V7.6z" fill="#f6cf6a"/><path d="M8.3 8.2h2.4a1.3 1.3 0 010 2.6H9.4l2 2" fill="none" stroke="#8a5510" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#e5383b"/><path d="M12 7v10M7 12h10" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>',
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
    gift: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 7v13M12 7H8.5a2 2 0 010-4C11 3 12 7 12 7zm0 0h3.5a2 2 0 000-4C13 3 12 7 12 7zM20 11v7.5c0 1-.8 1.5-1.8 1.5H5.8c-1 0-1.8-.5-1.8-1.5V11M3 7h18v4H3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    lock: '<svg viewBox="0 0 20 20"><rect x="4" y="9" width="12" height="9" rx="2" fill="currentColor"/><path d="M6.5 9V6.5a3.5 3.5 0 017 0V9" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>'
  };
  const WEAPON_SVG = '<svg class="placeholder-weapon" viewBox="0 0 160 70"><path fill="#f2f3f2" d="M4 26h70l6-8h18l3 5h36l6-4h11v12h-6l-2 6h-38l-6 6h-12l-4 20H76l4-18-8-1-6 10H50l4-14H34l-8 7H14l-2-9H4z"/></svg>';

  // ---------- currency ----------
  // prices and the balance are stored in coins (1 coin = $0.02); the switch in the header only changes how they are shown
  const COIN_USD = 0.02;
  const STAR_USD = 0.015;          // same rate as the gift catalog (tools/build-gifts.js)
  const RATE_KEY = 'rustup_usdrub';
  let usdRub = 81;                 // fallback until the Central Bank rate loads
  try { const r = JSON.parse(localStorage.getItem(RATE_KEY)); if (r && r.v > 0) usdRub = r.v; } catch (e) { /* no storage */ }
  const CURRENCIES = {
    rub: { name: 'Рубли', sym: '₽', perCoin: () => COIN_USD * usdRub, dec: n => (n && Math.abs(n) < 100 ? 2 : 0),
      icon: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="10" fill="#2f7cf6"/><circle cx="10" cy="10" r="8.6" fill="#3d8bff"/><path d="M8.2 15V5.2h3a2.55 2.55 0 010 5.1H6.6M6.6 12.7h5" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
    usdt: { name: 'USDT', sym: 'USDT', perCoin: () => COIN_USD, dec: () => 2,
      icon: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="10" fill="#26a17b"/><path d="M5.6 5.8h8.8M10 5.8v9.4" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/><ellipse cx="10" cy="9.4" rx="4.7" ry="1.5" fill="none" stroke="#fff" stroke-width="1.1"/></svg>' },
    stars: { name: 'Звёзды', sym: '⭐', perCoin: () => COIN_USD / STAR_USD, dec: n => (n && Math.abs(n) < 10 ? 1 : 0),
      icon: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.4l2.65 5.4 5.95.85-4.3 4.2 1 5.9L10 15l-5.3 2.75 1-5.9-4.3-4.2 5.95-.85z" fill="#ffc83d" stroke="#f29d12" stroke-width=".9" stroke-linejoin="round"/></svg>' }
  };
  const curId = () => (S.settings.currency in CURRENCIES ? S.settings.currency : 'rub');
  const toCur = (v, id = curId()) => v * CURRENCIES[id].perCoin();
  const fromCur = v => v / CURRENCIES[curId()].perCoin();
  const numFmt = (n, d) => n.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d });
  // amount in coins → number in the chosen currency
  const fmt = (v, id = curId()) => { const n = toCur(v, id); return numFmt(n, CURRENCIES[id].dec(n)); };
  // plain text with the currency sign, for toasts, confirm() and share texts
  const money = v => `${fmt(v)} ${CURRENCIES[curId()].sym}`;
  const coin = (v, size, whole) => `<span class="coin cur-${curId()}"${size ? ` style="--coin-size:${size}px"` : ''}>${CURRENCIES[curId()].icon}<span>${whole ? numFmt(Math.round(toCur(v)), 0) : fmt(v)}</span></span>`;
  // whole amounts without kopecks/cents, for promo texts
  const coinInt = (v, size) => coin(v, size, true);
  const moneyInt = v => `${numFmt(Math.round(toCur(v)), 0)} ${CURRENCIES[curId()].sym}`;

  // the ruble rate follows the Central Bank of Russia; cached so the next start shows it right away
  fetch('https://www.cbr-xml-daily.ru/daily_json.js').then(r => r.json()).then(d => {
    const v = d && d.Valute && d.Valute.USD && d.Valute.USD.Value;
    if (!(v > 0)) return;
    try { localStorage.setItem(RATE_KEY, JSON.stringify({ v, t: Date.now() })); } catch (e) { /* ignore */ }
    if (Math.abs(v - usdRub) < 0.01) return;
    usdRub = v;
    if (curId() === 'rub') rerenderMoney();
  }).catch(() => { /* offline: keep the cached rate */ });

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
      rewards: { lastDaily: 0, promos: [], subs: {}, cases: {}, cashback: 0 },
      settings: { sound: true, fast: false }
    };
  }
  function load() {
    // Never restore mutable wallet, items, history or rewards from browser storage.
    const st = freshState();
    try {
      const cached = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (cached && cached.settings && typeof cached.settings === 'object') {
        const settings = cached.settings;
        st.settings.sound = settings.sound !== false;
        st.settings.fast = settings.fast === true;
        if (['rub', 'usdt', 'stars'].includes(settings.currency)) st.settings.currency = settings.currency;
      }
    } catch (e) { /* corrupt or inaccessible browser storage */ }
    return st;
  }
  let S = load();
  // catalog can change between versions: drop owned items that no longer exist
  function sanitize() {
    S.inventory = S.inventory.filter(i => byName[i.name]);
    S.withdrawals = S.withdrawals || [];
    // profiles saved before the free cases existed
    S.rewards.subs = S.rewards.subs || {};
    S.rewards.cases = S.rewards.cases || {};
  }
  sanitize();
  const addItem = name => S.inventory.push({ uid: uid(), name, t: Date.now() });
  function save() {
    // No authoritative financial values are ever persisted on the device.
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ settings: S.settings })); }
    catch (e) { /* local storage unavailable */ }
  }

  // ---------- game server (bot/game.js): balance, items, rewards and every roll live there ----------
  // The app only shows the state and asks the server to act; the device copy is a cache for the first paint.
  let gameReady = false;
  const GAME_ERR = {
    funds: 'Недостаточно средств', items: 'Предметы уже не в инвентаре — обновили данные', chance: 'Шанс должен быть от 1% до 75%',
    game: 'В апгрейде предметы только одной игры', cooldown: 'Пока недоступно — подождите', opened: 'Этот кейс уже открыт',
    subs: 'Сначала подпишитесь на каналы', used: 'Промокод уже использован', not_found: 'Промокод не найден',
    expired: 'Срок промокода истёк — новый придёт в бота в 15:00 МСК', limit: 'Активации закончились — ждите новый промокод завтра в 15:00 МСК',
    done: 'Уже получено', empty: 'Пока пусто', mix: 'NFT-подарки и скины выводятся отдельно', busy: 'Сервер занят, попробуйте ещё раз',
    noacc: 'Профиль ещё загружается, попробуйте через секунду'
  };
  const gameErr = d => GAME_ERR[d && d.error] || 'Не удалось выполнить — попробуйте ещё раз';
  function applyState(st) {
    if (!st || !Number.isFinite(st.balance) || st.balance < 0 ||
        !Array.isArray(st.inventory) || !Array.isArray(st.withdrawals) ||
        !Array.isArray(st.history) || !st.stats || !st.seeds || !st.rewards ||
        !st.user || typeof st.user !== 'object') {
      throw new Error('Invalid authoritative game state');
    }
    S.balance = st.balance;
    S.inventory = st.inventory.filter(i => i && typeof i.uid === 'string' && byName[i.name]);
    S.withdrawals = st.withdrawals;
    S.history = st.history;
    S.stats = st.stats;
    S.seeds = st.seeds;
    S.rewards = st.rewards;
    S.tx = Array.isArray(st.tx) ? st.tx : [];
    const u = tgUser() || {};
    S.user = { ...st.user, id: u.id || st.user.id, tg: true };
    if (!/^#[0-9a-f]{6}$/i.test(S.user.color || ''))
      S.user.color = AVA_COLORS[(Number(u.id) || 0) % AVA_COLORS.length];
    save();
  }
  // one action on the server; the new state is applied before the promise resolves,
  // unless defer is set (the upgrade wheel and the case roulette show the result first, then apply it)
  // Prevent overlapping client requests while an authoritative result is animating.
  // Server-side atomicity, uniqueness and idempotency are still required.
  let actionQueue = Promise.resolve();
  let releaseVisual = null;
  function releaseVisualAction() {
    if (releaseVisual) { const done = releaseVisual; releaseVisual = null; done(); }
  }
  function api(action, extra = {}, defer = false) {
    const running = actionQueue.catch(() => {}).then(async () => {
      const res = await fetch(window.RUSTUP_API.replace(/\/$/, '') + '/api/game', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData: TG.initData, action, ...extra })
      });
      if (!res.ok) return { d: { ok: false, error: 'net' } };
      const d = await res.json();
      if (d && d.state && !(defer && d.ok)) { applyState(d.state); renderHeader(); }
      if (d && d.error === 'items') refreshUpgrade();
      if (defer && d && d.ok) {
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        releaseVisual = release;
        setTimeout(() => { if (releaseVisual === release) releaseVisualAction(); }, 20000);
        return { d, gate };
      }
      return { d: d || { ok: false } };
    });
    actionQueue = running.then(result => result.gate).catch(() => {});
    return running.then(result => result.d).catch(() => ({ ok: false, error: 'net' }));
  }
  const netToast = d => toast(d.error === 'net' ? 'Нет связи с сервером, попробуйте ещё раз' : gameErr(d), 'error');

  // ---------- Telegram Mini App ----------
  // Only active when opened from a Telegram bot (initData present); otherwise TG is null and the site works as usual.
  const TG = window.Telegram && Telegram.WebApp && Telegram.WebApp.initData ? Telegram.WebApp : null;
  const tgVer = v => TG && TG.isVersionAtLeast && TG.isVersionAtLeast(v);
  // Server owns wallet and game progress; do not import Telegram CloudStorage.
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
  // heartbeat for the bot's admin statistics (online now, top balances); only inside Telegram,
  // the server verifies initData so a player can only report about themselves
  const PING_MS = 45000;
  function statsPing() {
    if (!TG || !window.RUSTUP_API || !S.user || document.hidden) return;
    fetch(window.RUSTUP_API.replace(/\/$/, '') + '/api/ping', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ initData: TG.initData, balance: S.balance, nick: S.user.name })
    }).then(r => r.json()).then(d => {
      // an admin gave coins (/give in the bot): collect them right away
      if (d && d.grants) refSync();
    }).catch(() => { /* offline: next tick */ });
  }
  // ---------- referrals (server: bot/worker.js /api/ref) ----------
  let REF = null;          // last answer from /api/ref: { link, invited, active, earned, refBonus, welcomeBonus }
  let refBusy = false;
  const refAvailable = () => !!(TG && window.RUSTUP_API);
  function refSync() {
    if (!refAvailable() || !S.user || refBusy) return;
    refBusy = true;
    fetch(window.RUSTUP_API.replace(/\/$/, '') + '/api/ref', {
      // grants: 1 — this version adds admin grants (/give) to the balance
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: TG.initData, grants: 1 })
    }).then(r => r.json()).then(d => {
      if (!d.ok) return;
      REF = d;
      // the server already put them on the account balance: pull the new state
      if (d.credited > 0 || d.granted > 0) api('load').then(() => { bumpBalance(); refreshUpgrade(); });
      if (d.credited > 0) { sfxWin(); toast(`Награда за друзей: ${coinInt(d.credited)}`, 'success'); }
      if (d.granted > 0) { sfxWin(); haptic('success'); toast(`Начислено администрацией: ${coinInt(d.granted)}${d.grantNote ? ` — ${esc(d.grantNote)}` : ''}`, 'success'); }
      if ($('#refPanel')) renderRefPanel();
      syncRoadWithdrawals();
      if ($('#refRoad')) renderRoad();
    }).catch(() => { /* offline: try again on next visit */ }).finally(() => { refBusy = false; });
  }
  function shareRef() {
    if (!REF) return;
    const text = `Залетай в RUST UP — апгрейд скинов Rust, CS2 и NFT-подарков! По моей ссылке +${bonusTxt()} на старт 🎁`;
    const url = `https://t.me/share/url?url=${encodeURIComponent(REF.link)}&text=${encodeURIComponent(text)}`;
    if (TG && tgVer('6.1')) TG.openTelegramLink(url); else window.open(url, '_blank', 'noopener');
  }
  function copyRef() {
    if (!REF) return;
    const done = () => { toast('Ссылка скопирована', 'success'); haptic('light'); };
    const fallback = () => { const i = $('#refLink'); i.select(); try { document.execCommand('copy'); done(); } catch (e) { toast('Скопируйте ссылку вручную', 'error'); } };
    if (navigator.clipboard) navigator.clipboard.writeText(REF.link).then(done, fallback); else fallback();
  }
  function renderRefPanel() {
    const box = $('#refPanel');
    if (!box) return;
    const bot = window.RUSTUP_BOT;
    if (!refAvailable()) {
      box.innerHTML = `<div class="ref-head"><h4>Пригласи друзей</h4><span class="ref-bonus">${bonusTxt()} за друга</span></div>
        <p class="muted">Реферальная ссылка работает в Telegram-боте. Откройте игру через бота — там будет ваша личная ссылка.</p>
        ${bot ? `<a class="btn btn-tg" href="https://t.me/${esc(bot)}" target="_blank" rel="noopener">${ICON.tg}<span>Открыть @${esc(bot)}</span></a>` : ''}`;
      return;
    }
    if (!REF) { box.innerHTML = `<div class="ref-head"><h4>Пригласи друзей</h4></div><p class="muted">Загрузка…</p>`; return; }
    box.innerHTML = `
      <div class="ref-head"><h4>Пригласи друзей</h4><span class="ref-bonus">${bonusTxt()} за друга</span></div>
      <p class="muted">Друг получает ${bonusTxt()} на старт, а вы — ${bonusTxt()}, как только он зайдёт в игру. Награды начисляются сами.</p>
      <div class="ref-link"><input id="refLink" class="text-input mono" readonly value="${esc(REF.link)}"><button class="btn btn-ghost" data-ref="copy">Копировать</button></div>
      <button class="btn btn-tg" data-ref="share" style="height:44px">${ICON.tg}<span>Отправить друзьям</span></button>
      <div class="ref-stats">
        <div><b>${REF.invited}</b><span>пришло</span></div>
        <div><b>${REF.active}</b><span>в игре</span></div>
        <div><b>${coinInt(REF.earned)}</b><span>заработано</span></div>
      </div>`;
    box.querySelector('[data-ref="copy"]').onclick = copyRef;
    box.querySelector('[data-ref="share"]').onclick = shareRef;
  }
  // ---------- friends road: a real Telegram gift per level of invited friends who opened the game ----------
  // server: /api/road records the claim and notifies admins, who send the gift by hand (bot/worker.js, same list)
  // [friends in the game, gift]: 5 regular gifts, then 25 NFTs up to 3 000 stars
  const ROAD = [[5, 'Сердце'], [10, 'Подарок'], [15, 'Мишка'], [20, 'Букет'], [25, 'Алмаз'],
    [70, 'Big Year #22608'], [100, 'Candy Cane #42032'], [150, 'B-Day Candle #158980'], [175, 'Clover Pin #185914'], [200, 'Bow Tie #15505'],
    [250, 'Desk Calendar #250031'], [300, 'Eternal Candle #11125'], [450, 'Evil Eye #43197'], [500, 'Berry Box #29950'], [600, 'Fine Pen #26659'],
    [700, 'Bunny Muffin #14351'], [800, 'Hanging Star #12289'], [900, 'Jingle Bells #34384'], [1000, 'Crystal Ball #21104'], [1100, 'Flying Broom #13266'],
    [1200, 'Trapped Heart #6334'], [1300, 'Skull Flower #8176'], [1400, 'Record Player #923'], [1500, 'Joyful Bundle #26929'], [1600, 'Love Potion #24098'],
    [1700, 'Cupid Charm #10012'], [1800, 'Bling Binky #4664'], [1900, 'Eternal Rose #18648'], [2000, 'Electric Skull #1225'], [2100, 'Diamond Ring #26470']];
  // a gift missing from the catalog still shows up, without a picture
  const ROAD_ITEMS = ROAD.map(([lvl, name]) => ({ lvl, skin: byName[name] || { name, rarity: 'gray', game: 'nft', price: 0, img: '' } }));
  const STAR_COINS = 0.75;   // catalog: 1 star = $0.015, 1 coin = $0.02
  const starsOf = s => s.stars || Math.round(s.price / STAR_COINS);
  // statuses of real gift requests come from the server
  function syncRoadWithdrawals() {
    const sent = new Set((REF && REF.roadSent) || []);
    let changed = false;
    S.withdrawals.forEach(w => { if (w.real && w.status !== 'sent' && sent.has(w.level)) { w.status = 'sent'; changed = true; } });
    if (changed) save();
  }
  let roadBusy = false;
  function renderRoad() {
    const box = $('#refRoad');
    if (!box) return;
    const active = REF ? REF.active : 0, claimed = new Set((REF && REF.road) || []);
    box.innerHTML = `
      <div class="road-head">
        <div><h4>Дорога друзей <span class="real-badge">РЕАЛЬНЫЕ NFT</span></h4>
          <p class="muted">Мы выдаём <b>РЕАЛЬНЫЕ</b> подарки и NFT Telegram прямо на ваш аккаунт! ${ROAD.length} наград: первые 5 — подарки, дальше NFT до 3 000 ⭐. Считаются друзья, которые зашли в игру по вашей ссылке.</p></div>
        <div class="road-count"><b>${fmtInt(active)}</b><span>друзей в игре</span></div>
      </div>
      <div class="road-scroll"><div class="road">${ROAD_ITEMS.map((r, i) => {
        const st = claimed.has(r.lvl) ? 'claimed' : active >= r.lvl ? 'ready' : 'locked';
        const prev = i ? ROAD_ITEMS[i - 1].lvl : 0;
        const pct = Math.max(0, Math.min(100, ((active - prev) / (r.lvl - prev)) * 100));
        return `<div class="road-step ${st}">
          <span class="road-line"><i style="width:${pct}%"></i></span>
          <span class="road-dot">${st === 'claimed' ? ICON.check : r.lvl}</span>
          ${card(r.skin, { static: true, price: false })}
          <span class="road-stars">⭐ ${fmtInt(starsOf(r.skin))}</span>
          ${st === 'ready' ? `<button class="btn btn-accent road-btn" data-road="${r.lvl}">Забрать</button>`
            : st === 'claimed' ? '<span class="road-btn done">Получено</span>'
            : `<span class="road-btn">Ещё ${fmtInt(r.lvl - active)}</span>`}
        </div>`;
      }).join('')}</div></div>
      ${refAvailable() ? '' : '<p class="note">Награды выдаются в Telegram-боте — там считаются приглашённые друзья.</p>'}`;
    box.querySelectorAll('[data-road]').forEach(b => { b.onclick = () => claimRoad(+b.dataset.road, b); });
    // start the strip at the first reward that is not taken yet
    const next = box.querySelector('.road-step.ready, .road-step.locked');
    const sc = box.querySelector('.road-scroll');
    if (next) sc.scrollLeft = Math.max(0, next.getBoundingClientRect().left - sc.getBoundingClientRect().left - 24);
  }
  function claimRoad(lvl, btn) {
    if (!refAvailable() || roadBusy) return;
    const r = ROAD_ITEMS.find(x => x.lvl === lvl);
    roadBusy = true; btn.disabled = true; btn.textContent = '…';
    fetch(window.RUSTUP_API.replace(/\/$/, '') + '/api/road', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: TG.initData, level: lvl })
    }).then(res => res.json()).then(d => {
      if (!d.ok) return toast(d.active != null ? `Нужно ${lvl} друзей в игре, сейчас ${d.active}` : 'Не удалось забрать награду', 'error');
      REF.road = [...(REF.road || []), lvl];
      if (!d.claimed) return toast('Эта награда уже получена', 'error');
      // a real gift, not an inventory item: the server added it to the withdrawals until an admin sends it
      api('load');
      sfxWin();
      const tgu = tgUser() && tgUser().username;
      modal('Заявка принята!', `
        <div class="case-win">${card(r.skin, { static: true, price: false })}</div>
        <p class="note" style="text-align:center;font-size:14px;color:var(--text-subtitle)">Мы отправим <b style="color:var(--text-title)">реальный подарок ${esc(r.skin.name)}</b> на ваш Telegram-аккаунт${tgu ? ` <b>@${esc(tgu)}</b>` : ''}. Бот напишет, когда он будет отправлен.</p>
        <a class="btn btn-accent" href="#/inventory" data-close-go style="height:48px">Мои заявки</a>`,
      m => $('[data-close-go]', m).addEventListener('click', () => { U.inv.view = 'withdrawals'; closeModal(); }));
    }).catch(() => toast('Нет связи с сервером, попробуйте ещё раз', 'error'))
      .finally(() => { roadBusy = false; renderRoad(); });
  }
  function friendsPage() {
    const nfts = ROAD_ITEMS.filter(r => r.skin.img.includes('assets/nft/')).slice(-3).reverse().map(r => r.skin);
    // Both accounts receive 50 RUB once; the backend must reject duplicate or reciprocal invitations.
    const steps = [
      [ICON.tg, 'Отправь ссылку', 'Своя ссылка — ниже. Скинь её в чаты, сторис или под ролики'],
      [ICON.gift, `Друг получает ${bonusTxt()}`, 'Сразу, как только зайдёт в игру по твоей ссылке'],
      [ICON.coin, `Тебе ${bonusTxt()} и шаг по дороге`, `За каждого друга в игре. ${ROAD.length} наград — до РЕАЛЬНЫХ NFT`]];
    $('#page').innerHTML = `<div class="page friends-page">
      <button class="hero-slide hs-friends" type="button" data-ref-invite>
        <span class="hero-text"><span class="hero-kicker real">РЕАЛЬНЫЕ NFT</span><b class="hero-title">Зови друзей —<br>забирай NFT</b>
          <span class="hero-sub">${bonusTxt()} за каждого друга и ${ROAD.length} наград на дороге</span><span class="hero-btn">Пригласить ${ICON.right}</span></span>
        <span class="hero-art">${nfts.map((s, i) => `<img class="hr-${i} nft" src="${s.img}" alt="" draggable="false">`).join('')}</span>
      </button>
      <div class="row-head"><h2 class="home-title">Как это работает</h2></div>
      <div class="friend-steps">${steps.map(([ico, t, d], i) => `<div class="friend-step"><span class="fs-num">${i + 1}</span><span class="fs-ico">${ico}</span><b>${t}</b><span>${d}</span></div>`).join('')}</div>
      <div class="row-head"><h2 class="home-title">Твоя ссылка</h2></div>
      <div class="panel ref-panel" id="refPanel"></div>
      <div class="row-head"><h2 class="home-title">Дорога друзей</h2></div>
      <div class="panel road-panel" id="refRoad"></div>
    </div>`;
    $('[data-ref-invite]').onclick = () => REF ? shareRef() : $('#refPanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
    renderRefPanel(); renderRoad(); refSync();
  }
  // ---------- earnings: paid TikTok / Shorts videos ----------
  // videos are submitted in the creators bot (@rustuptiktok_bot, site /creator/, server bot/creator.js); here only the offer and the rates
  // [id, title, min views for a request, USD for 1 000 / 100 000 / 1 000 000 views]; must match CLIP_CATS in bot/creator.js
  const CLIP_CATS = [
    ['gameplay', 'Геймплей в RUST UP', 3000, [3, 270, 2000]],
    ['gifts', 'Подарки Telegram', 3000, [1.5, 100, 700]],
    ['games', 'Игры (Rust, CS2)', 6000, [1, 100, 700]],
    ['creative', 'Креатив (мемы, нарезки, тренды)', 6000, [0.15, 15, 150]]];
  const CLIPS_CHANNEL = 'rustuptiktok';   // channel with banners and rules; empty = button hidden
  const CREATOR_BOT = 'rustuptiktok_bot'; // creators bot with the Mini App: submit videos, stats, balance
  const CLIP_MAX = 2000;      // top payout in the headline, USD
  const usd = n => numFmt(n, n < 10 && n % 1 ? (n * 10 % 1 ? 2 : 1) : 0) + ' $';
  const TIKTOK_ICO = '<svg viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="12" fill="#000"/><path d="M27.5 10h5.3c.4 3.6 2.6 6 6.2 6.3v5.4c-2.3.1-4.4-.6-6.2-1.8v10.6c0 6.3-4.6 10.2-10 10.2-5.7 0-9.8-4.2-9.8-9.7 0-6 4.9-10.3 11.3-9.6v5.6c-3-.7-5.6 1.2-5.6 4 0 2.4 1.9 4.2 4.2 4.2 2.6 0 4.6-1.8 4.6-5.1z" fill="#25f4ee" transform="translate(-1.2 -1)"/><path d="M27.5 10h5.3c.4 3.6 2.6 6 6.2 6.3v5.4c-2.3.1-4.4-.6-6.2-1.8v10.6c0 6.3-4.6 10.2-10 10.2-5.7 0-9.8-4.2-9.8-9.7 0-6 4.9-10.3 11.3-9.6v5.6c-3-.7-5.6 1.2-5.6 4 0 2.4 1.9 4.2 4.2 4.2 2.6 0 4.6-1.8 4.6-5.1z" fill="#fe2c55" transform="translate(1.2 1)"/><path d="M27.5 10h5.3c.4 3.6 2.6 6 6.2 6.3v5.4c-2.3.1-4.4-.6-6.2-1.8v10.6c0 6.3-4.6 10.2-10 10.2-5.7 0-9.8-4.2-9.8-9.7 0-6 4.9-10.3 11.3-9.6v5.6c-3-.7-5.6 1.2-5.6 4 0 2.4 1.9 4.2 4.2 4.2 2.6 0 4.6-1.8 4.6-5.1z" fill="#fff"/></svg>';
  const FRIEND_ICO = '<svg viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="12" fill="#e5383b22"/><circle cx="20" cy="18" r="6" fill="#ff5a4e"/><path d="M9 36c1-6.5 5.2-10 11-10s10 3.5 11 10z" fill="#ff5a4e"/><path d="M35 17v10M30 22h10" stroke="#ffd166" stroke-width="3" stroke-linecap="round"/></svg>';

  function earnPage() {
    $('#page').innerHTML = `<div class="page earn">
      <h2 class="section-title">Заработок</h2>
      <a class="earn-offer earn-tiktok" href="#/earn/tiktok">
        <span class="earn-ico">${TIKTOK_ICO}</span><b>Ролики в TikTok</b>
        <span class="earn-amount">до <b>${usd(CLIP_MAX)}</b></span>
      </a>
      <h3 class="earn-sub">Как получить ещё</h3>
      <a class="earn-offer earn-friend" href="#/friends">
        <span class="earn-ico">${FRIEND_ICO}</span><b>Пригласить друга</b>
        <span class="earn-amount">+<b>${bonusTxt()}</b></span>
      </a>
    </div>`;
  }

  function tiktokPage() {
    const cols = ['1 000', '100 000', '1 млн'];
    $('#page').innerHTML = `<div class="page earn">
      <div class="panel earn-hero">
        <span class="earn-hero-ico">${TIKTOK_ICO}</span>
        <h2>Ролики в TikTok и Shorts</h2>
        <p><b>${usd(CLIP_MAX)}</b> за 1 000 000 просмотров</p>
      </div>
      ${CLIPS_CHANNEL ? `<a class="earn-offer earn-channel" href="https://t.me/${esc(CLIPS_CHANNEL)}" target="_blank" rel="noopener">
        <span class="earn-ico">${TIKTOK_ICO}</span>
        <span class="earn-channel-txt"><b>Баннеры и примеры роликов</b><small>Начните с канала: там баннеры и все правила</small></span>
        <span class="earn-arrow">${ICON.right}</span></a>` : ''}
      <div class="panel earn-rates">
        <h3>Сколько платим</h3>
        <div class="rate-cols"><span></span>${cols.map(c => `<span>${c}</span>`).join('')}</div>
        ${CLIP_CATS.map(([, title, min, r]) => `<div class="rate-row">
          <div class="rate-name"><b>${title}</b> · заявка от ${fmtInt(min)}</div>
          <div class="rate-cols"><span></span>${r.map(v => `<b>${usd(v)}</b>`).join('')}</div>
        </div>`).join('')}
        <p class="muted">YouTube Shorts — половина ставки. Деньги копятся на балансе кабинета автора, вывод — USDT в @xRocket. Приглашайте других авторов и получайте 5% от их заработка.</p>
      </div>
      <div class="panel earn-how">
        <h3>Как получить выплату</h3>
        <ol>
          <li>Снимите ролик про RUST UP и укажите в описании свою ссылку на игру из кабинета автора (или <b>@${esc(window.RUSTUP_BOT || 'rustuper_bot')}</b>).</li>
          <li>Наберите просмотры — от ${fmtInt(CLIP_CATS[0][2])} для геймплея и подарков, от ${fmtInt(CLIP_CATS[2][2])} для остального.</li>
          <li>Отправьте ссылку в кабинете автора @${CREATOR_BOT} — там же статистика людей по вашей ссылке, баланс и вывод USDT в @xRocket.</li>
        </ol>
        <p class="muted">Накрутка просмотров, чужие ролики и повторные заявки на один ролик не оплачиваются.</p>
      </div>
      <a class="btn btn-accent earn-cta" href="https://t.me/${CREATOR_BOT}" target="_blank" rel="noopener" data-tg-link>${ICON.tg}<span>Открыть кабинет автора</span></a>
    </div>`;
    // inside Telegram, t.me links open in the app itself
    if (TG && tgVer('6.1')) document.querySelectorAll('.earn-channel, [data-tg-link]').forEach(a => { a.onclick = e => { e.preventDefault(); TG.openTelegramLink(a.href); }; });
  }

  function startStatsPing() {
    if (!TG || !window.RUSTUP_API) return;
    statsPing();
    setInterval(statsPing, PING_MS);
    document.addEventListener('visibilitychange', statsPing);
  }
  function tgInit() {
    if (!TG) return;
    document.documentElement.classList.add('tg');
    TG.ready();
    TG.expand();
    try {
      if (tgVer('6.1')) { TG.setHeaderColor('#141518'); TG.setBackgroundColor('#141518'); }
      if (tgVer('7.10')) TG.setBottomBarColor('#141518');
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
    game: 'rust',          // upgrade tab: 'rust' | 'cs2' | 'nft'
    // inventory page
    inv: { sel: new Set(), q: '', game: 'all', rarity: 'all', cat: 'all', sort: 'price-desc', page: 0, view: 'items' }
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

  // ---------- top-up window (visual only: payments are not connected, the pay button says so) ----------
  const DEPOSIT_SUMS = [100, 1500, 3000, 5000, 10000, 25000];
  const DEPOSIT_WAYS = [['sbp', 'СБП'], ['card', 'Карта'], ['crypto', 'Крипта'], ['stars', 'Звёзды']];
  // [rubles, NFT, CS2 skin]: the bonus is worth about the top-up itself (catalog price in rubles 75–100% of the sum, CBR rate 2026-11-04).
  // 100 ₽ — a regular Telegram gift; 200–1 000 ₽ — Rust or CS2 skin (no gift or NFT costs that much); from 1 500 ₽ — NFT (the cheapest in the catalog).
  const DEPOSIT_BONUSES = [
    [100, 'Алмаз', 'Desert Eagle | Sputnik'],
    [200, 'The Fallen Vest', 'MAC-10 | Heat'], [350, 'Abyss MP5', 'AWP | Atheris'],
    [500, 'Tactical Leather Gloves', 'MP9 | Hydra'], [1000, 'Bombshell M249', 'Dual Berettas | Demolition'],
    [1500, 'Crystal Ball #21104', 'Galil AR | Rainbow Spoon'], [2000, 'Evil Eye #21943', 'AWP | Chrome Cannon'],
    [3000, 'Cupid Charm #15429', 'Dual Berettas | Cobra Strike'], [5000, 'Diamond Ring #29692', '★ Gut Knife | Rust Coat'],
    [7500, 'Magic Potion #4607', '★ Moto Gloves | Smoke Out'], [10000, 'Trapped Heart #661', '★ Bayonet | Boreal Forest'],
    [15000, 'Artisan Brick #701', '★ Specialist Gloves | Big Swell'], [25000, 'Nail Bracelet #1347', 'M4A4 | The Coalition'],
    [50000, 'Astral Shard #2122', '★ Butterfly Knife | Lore'], [100000, 'Perfume Bottle #2327', 'AK-47 | Gold Arabesque']];
  const rubFmt = n => fmtInt(n) + ' ₽';
  // one «бонус за пополнение» card; also used on the bonuses page (amount 0 = empty progress)
  // the first option is a gift, an NFT or a Rust skin — the toggle names it after its kind
  const depKind = s => !s || s.img.includes('assets/gifts/') ? 'Подарок' : s.game === 'nft' || s.img.includes('assets/nft/') ? 'NFT' : 'Rust';
  const depCard = (b, i, amount, kind) => {
    const s = byName[kind === 'gift' ? b[1] : b[2]], first = depKind(byName[b[1]]);
    return `<div class="dep-bonus${amount >= b[0] ? ' on' : ''}" data-i="${i}">
      <div class="dep-seg"><button type="button" class="${kind === 'gift' ? 'on' : ''}" data-kind="gift">${first}</button><button type="button" class="${kind === 'skin' ? 'on' : ''}" data-kind="skin">${first === 'Rust' ? 'CS2' : 'Скин'}</button></div>
      <div class="dep-art rarity-${s ? s.rarity : 'gray'}">${s ? `<img${imgCls(s) ? ' class="nft"' : ''} src="${s.img}" alt="" draggable="false">` : ''}</div>
      <span class="dep-name">${s ? esc(s.name.replace(/^★ /, '')) : ''}</span>
      <span class="dep-bar"><i style="width:${Math.min(100, (amount / b[0]) * 100)}%"></i></span>
      <span class="dep-from">Пополните от <b>${rubFmt(b[0])}</b></span>
      <button class="btn btn-accent dep-take" type="button" data-sum="${b[0]}">Пополнить</button>
    </div>`;
  };
  // the top-up and the bonus cards lead to the wallet page
  function openDeposit(sum = 1500) {
    location.hash = `#/wallet?tab=deposit&sum=${sum}`;
  }

  // ---------- wallet page (like RubUP): top up · withdraw · history ----------
  // Top-up and cash-out are visual only — no payment provider is connected, the buttons say so. The history is real (server ledger).
  // payment method icons: glossy, with their own gradients and a light rim on top
  const WICO = {
    sbp: '<svg viewBox="0 0 40 40"><defs><linearGradient id="wiSbp" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6be38f"/><stop offset=".55" stop-color="#1fa155"/><stop offset="1" stop-color="#0f6b36"/></linearGradient></defs><rect x="2" y="2" width="36" height="36" rx="11" fill="url(#wiSbp)"/><path d="M4 12c6-7 26-7 32 0v-1c-2-6-8-9-16-9S6 5 4 11z" fill="#fff" opacity=".28"/><path d="M11.5 20.5l5.6 5.6 11.4-12.3" fill="none" stroke="#fff" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    card: '<svg viewBox="0 0 40 40"><defs><linearGradient id="wiCard" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8fb4ff"/><stop offset=".5" stop-color="#4f7ff0"/><stop offset="1" stop-color="#2a4fb8"/></linearGradient><linearGradient id="wiChip" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0b0"/><stop offset="1" stop-color="#e0a83a"/></linearGradient></defs><rect x="2" y="7" width="36" height="26" rx="6" fill="url(#wiCard)"/><rect x="2" y="13" width="36" height="5" fill="#1b2f75" opacity=".75"/><rect x="7" y="22" width="9" height="6.5" rx="1.8" fill="url(#wiChip)"/><path d="M27 25h6" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".7"/><path d="M4 9.5c8-3 24-3 32 0" stroke="#fff" stroke-width="1.4" opacity=".35" fill="none"/></svg>',
    usdt: '<svg viewBox="0 0 40 40"><defs><radialGradient id="wiUsdt" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#5fe0b4"/><stop offset=".6" stop-color="#26a17b"/><stop offset="1" stop-color="#14684e"/></radialGradient></defs><circle cx="20" cy="20" r="18" fill="url(#wiUsdt)"/><path d="M11 12h18v4.5h-6.6v2.2c4.7.3 8 1.3 8 2.4s-3.3 2.1-8 2.4V31h-4.8v-7.5c-4.7-.3-8-1.3-8-2.4s3.3-2.1 8-2.4v-2.2H11z" fill="#fff"/><path d="M7 14a14 14 0 0126 0" stroke="#fff" stroke-width="1.5" fill="none" opacity=".3"/></svg>',
    ton: '<svg viewBox="0 0 40 40"><defs><radialGradient id="wiTon" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#5cc9ff"/><stop offset=".6" stop-color="#0098ea"/><stop offset="1" stop-color="#005f99"/></radialGradient></defs><circle cx="20" cy="20" r="18" fill="url(#wiTon)"/><path d="M12 13h16l-8 15z" fill="none" stroke="#fff" stroke-width="2.6" stroke-linejoin="round"/><path d="M20 13v15" stroke="#fff" stroke-width="2.6"/><path d="M7 14a14 14 0 0126 0" stroke="#fff" stroke-width="1.5" fill="none" opacity=".3"/></svg>',
    star: '<svg viewBox="0 0 40 40"><defs><linearGradient id="wiStar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff1a8"/><stop offset=".45" stop-color="#ffc83d"/><stop offset="1" stop-color="#e88a0c"/></linearGradient></defs><path d="M20 3l5.2 10.6 11.8 1.7-8.5 8.3 2 11.7L20 29.8 9.5 35.3l2-11.7L3 15.3l11.8-1.7z" fill="url(#wiStar)" stroke="#c9700a" stroke-width="1.2" stroke-linejoin="round"/><path d="M20 8l3 6.2 5 .8" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".6"/></svg>',
    gift: '<svg viewBox="0 0 40 40"><defs><linearGradient id="wiGift" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7a6e"/><stop offset="1" stop-color="#b8202a"/></linearGradient><linearGradient id="wiRib" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0b0"/><stop offset="1" stop-color="#e0a83a"/></linearGradient></defs><rect x="6" y="17" width="28" height="19" rx="3.5" fill="url(#wiGift)"/><rect x="4" y="11.5" width="32" height="7.5" rx="2.5" fill="#ff5a4e"/><path d="M20 11.5V36" stroke="url(#wiRib)" stroke-width="4.5"/><path d="M20 11.5c-3-6.5-10.5-6.5-9.5-1.2.8 3.4 9.5 1.2 9.5 1.2zm0 0c3-6.5 10.5-6.5 9.5-1.2-.8 3.4-9.5 1.2-9.5 1.2z" fill="url(#wiRib)"/><path d="M6 14h28" stroke="#fff" stroke-width="1.2" opacity=".35"/></svg>'
  };
  const TXICO = {
    upgrade: '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M8 0L1.3 4.9v4.5L8 4.5l6.7 4.9V4.9zM8 6.3L1.3 11.2v4.6L8 10.9l6.7 4.9v-4.6z"/></svg>',
    case: '<svg viewBox="0 0 20 20"><path d="M3 7l7-4 7 4v7l-7 4-7-4zM3 7l7 4 7-4M10 11v7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    gift: '<svg viewBox="0 0 20 20"><path d="M10 6v12M10 6H7a1.8 1.8 0 010-3.5C9.3 2.5 10 6 10 6zm0 0h3a1.8 1.8 0 000-3.5C10.7 2.5 10 6 10 6zM16.5 9.5V16c0 1-.7 1.5-1.6 1.5H5.1c-.9 0-1.6-.5-1.6-1.5V9.5M2.5 6h15v3.5h-15z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    shop: '<svg viewBox="0 0 20 20"><path d="M4 7h12l-1 10H5zM7.5 7V5.5a2.5 2.5 0 015 0V7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    cashback: '<svg viewBox="0 0 20 20"><path d="M4 10a6 6 0 1010.2-4.3M14.5 2.5v3.5H11" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    promo: '<svg viewBox="0 0 20 20"><path d="M6 14L14 6M7 7.5a1 1 0 100-.01M13 13.5a1 1 0 100-.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    tg: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M20.7 4.3L2.9 11.2c-1.2.5-1.2 1.2-.2 1.5l4.6 1.4 1.8 5.4c.2.6.4.8.9.8.4 0 .6-.2.9-.5l2.2-2.1 4.6 3.4c.8.5 1.4.2 1.6-.8l3-14.2c.3-1.2-.5-1.8-1.6-1.3z"/></svg>',
    friends: '<svg viewBox="0 0 20 20"><circle cx="8" cy="7" r="3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M2.5 17c.6-3.3 2.7-5 5.5-5s4.9 1.7 5.5 5M14 5.5v5M11.5 8h5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    deposit: '<svg viewBox="0 0 20 20"><path d="M10 3v10M5.5 8.5L10 13l4.5-4.5M4 17h12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    withdraw: '<svg viewBox="0 0 20 20"><path d="M10 13V3M5.5 7.5L10 3l4.5 4.5M4 17h12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };
  // [id, title, min ₽, bonus %, icons, detail title, detail lines]
  const DEP_METHODS = [
    ['rub', 'Рубли', 500, 0, ['sbp'], 'СБП и карты', ['SberPay', 'T-Pay', 'Банковская карта']],
    ['crypto', 'Криптовалюта', 10, 5, ['usdt', 'ton'], 'USDT · TON', ['@xRocket', '@CryptoBot', 'Кошелёк TON']],
    ['gifts', 'Telegram Stars', 10, 7, ['star'], 'Звёзды Telegram', ['Оплата через Telegram Stars']]];
  // [id, title, min ₽, fee %, icon, input label, placeholder]
  const WD_METHODS = [
    ['rub', 'Рубли', 2000, 5, 'card', 'Номер карты', '0000 0000 0000 0000'],
    ['crypto', 'Криптовалюта', 2000, 3, 'usdt', 'Адрес USDT (TRC-20) или @username в @xRocket', 'T… или @username'],
    ['gift', 'Подарком', 0, 0, 'gift', '', '']];
  const TX_FILTERS = [['all', 'Все'], ['deposit', 'Пополнения'], ['withdraw', 'Выводы'], ['game', 'Игры'], ['bonus', 'Бонусы']];
  const WF = { tab: 'deposit', dep: 'rub', wd: 'rub', amount: 1500, out: 0, period: 30, filter: 'all', kinds: DEPOSIT_BONUSES.map(() => 'gift') };
  const NOT_YET = 'На данный момент такой возможности нет';

  function walletPage(q) {
    const params = new URLSearchParams(q || '');
    if (['deposit', 'withdraw', 'history'].includes(params.get('tab'))) WF.tab = params.get('tab');
    if (+params.get('sum') > 0) WF.amount = Math.floor(+params.get('sum'));
    const tabs = [['deposit', 'Пополнить'], ['withdraw', 'Вывести'], ['history', 'История']];
    $('#page').innerHTML = `<div class="page wallet-page">
      <span class="w-glow g1"></span><span class="w-glow g2"></span><span class="w-glow g3"></span>
      <h1 class="up-title">Кошелёк</h1>
      <div class="wallet-tabs">${tabs.map(([id, t]) => `<button type="button" class="wtab${WF.tab === id ? ' on' : ''}" data-wtab="${id}">${t}</button>`).join('')}</div>
      <div id="walletBody"></div>
    </div>`;
    renderWallet();
  }
  function renderWallet() {
    const box = $('#walletBody');
    if (!box) return;
    document.querySelectorAll('.wtab').forEach(b => b.classList.toggle('on', b.dataset.wtab === WF.tab));
    box.innerHTML = WF.tab === 'withdraw' ? walletWithdraw() : WF.tab === 'history' ? walletHistory() : walletDeposit();
  }
  function walletDeposit() {
    const m = DEP_METHODS.find(x => x[0] === WF.dep);
    return `
      <div class="wm-grid">${DEP_METHODS.map(([id, t, min, bonus, icons]) => `<button type="button" class="wm${WF.dep === id ? ' on' : ''}" data-wdep="${id}">
        ${bonus ? `<span class="wm-bonus">+${bonus}%</span>` : ''}${WF.dep === id ? '<span class="wm-check"></span>' : ''}<span class="wm-icons">${icons.map(i => `<i>${WICO[i]}</i>`).join('')}</span><b>${t}</b><small>от ${rubFmt(min)}</small></button>`).join('')}</div>
      <div class="wm-detail"><span class="wm-icons big">${m[4].map(i => `<i>${WICO[i]}</i>`).join('')}</span>
        <span class="wm-lines"><b>${m[5]}</b>${m[6].map(l => `<span>${l}</span>`).join('')}</span><span class="wm-min">от ${rubFmt(m[2])}</span></div>
      <div class="w-glass">
        <div class="w-field"><label>Сумма</label>
          <div class="dep-input"><input class="text-input" id="wAmt" inputmode="numeric" maxlength="7" value="${WF.amount || ''}"><span>₽</span></div>
          <div class="dep-sums">${DEPOSIT_SUMS.map(v => `<button type="button" class="dep-sum${v === WF.amount ? ' on' : ''}" data-wsum="${v}">${rubFmt(v)}</button>`).join('')}</div></div>
        ${m[3] ? `<p class="w-note">Бонус <b>+${m[3]}%</b> к сумме пополнения этим способом</p>` : ''}
        <button class="btn btn-accent w-go" type="button" data-wpay>Пополнить на ${rubFmt(WF.amount || 0)}</button>
      </div>
      <div class="row-head"><h2 class="home-title">Бонусы за пополнение</h2><span class="muted">по цене как пополнение</span></div>
      <div class="dep-bonuses page-bonuses" id="wBonuses">${DEPOSIT_BONUSES.map((b, i) => depCard(b, i, WF.amount, WF.kinds[i])).join('')}</div>`;
  }
  function walletWithdraw() {
    const m = WD_METHODS.find(x => x[0] === WF.wd);
    const reqs = S.withdrawals.slice(0, 10).map(w => `<div class="w-req"><span class="w-req-ico">${TXICO[w.real ? 'gift' : 'withdraw']}</span>
      <span class="w-req-body"><b>${w.items.slice(0, 2).map(esc).join(', ')}${w.items.length > 2 ? ` и ещё ${w.items.length - 2}` : ''}</b><small>#${w.id} · ${new Date(w.t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</small></span>
      <span class="w-req-st ${w.real && w.status !== 'sent' ? 'wait' : 'ok'}">${w.real ? (w.status === 'sent' ? 'Отправлен' : 'Ожидает') : 'Выполнен'}</span></div>`).join('');
    const body = m[0] === 'gift'
      ? `<div class="w-gift"><span class="w-gift-ico">${WICO.gift}</span><b>Вывод подарками и скинами</b>
          <span>Выберите NFT, подарки или скины в инвентаре и нажмите «Вывести»: NFT и подарки — на ваш Telegram-аккаунт, скины — трейдом в Steam.</span>
          <a class="btn btn-accent w-go" href="#/inventory">Открыть инвентарь</a></div>`
      : `<div class="w-field"><label>Сумма <span class="muted">Доступно: ${coin(S.balance)}</span></label>
          <div class="dep-input"><input class="text-input" id="wOut" inputmode="numeric" maxlength="8" placeholder="0" value="${WF.out || ''}"><span>₽</span></div></div>
        <div class="w-field"><label>${m[5]}</label><input class="text-input${m[0] === 'rub' ? ' mono' : ''}" id="wReq" placeholder="${m[6]}" maxlength="64"></div>
        <div class="w-fee"><span>Комиссия ${m[3]}% · вывод от ${rubFmt(m[2])}</span><b id="wGet">${WF.out ? `К получению ${rubFmt(Math.floor(WF.out * (1 - m[3] / 100)))}` : ''}</b></div>
        <button class="btn btn-accent w-go" type="button" data-wsend>Отправить заявку</button>`;
    return `
      <div class="wm-grid">${WD_METHODS.map(([id, t, min, fee, icon]) => `<button type="button" class="wm${WF.wd === id ? ' on' : ''}" data-wwd="${id}">
        ${WF.wd === id ? '<span class="wm-check"></span>' : ''}<span class="wm-icons"><i>${WICO[icon]}</i></span><b>${t}</b><small>${min ? `от ${rubFmt(min)}` : 'NFT и скины'}</small></button>`).join('')}</div>
      <div class="w-glass w-panel">${body}</div>
      <div class="w-glass w-panel"><h3 class="w-h3">Заявки на вывод</h3>${reqs || '<p class="muted w-empty">Заявок пока нет</p>'}</div>`;
  }
  function walletHistory() {
    const since = WF.period ? Date.now() - WF.period * 864e5 : 0;
    const tx = (S.tx || []).filter(x => x.t >= since);
    const count = k => (k === 'all' ? tx.length : tx.filter(x => x.kind === k).length);
    const rows = tx.filter(x => WF.filter === 'all' || x.kind === WF.filter);
    const day = t => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    return `
      <div class="case-chips w-chips">
        <button type="button" class="chip w-period" data-wperiod>${WF.period === 7 ? '7 дней' : WF.period === 30 ? '30 дней' : 'Всё время'} ▾</button>
        <div class="chips-scroll">${TX_FILTERS.map(([id, t]) => `<button type="button" class="chip${WF.filter === id ? ' on' : ''}" data-wfilter="${id}">${t}${count(id) ? ` <span class="chip-n">${count(id)}</span>` : ''}</button>`).join('')}</div>
      </div>
      <div class="tx-list${rows.length ? ' w-glass' : ''}">${rows.length ? rows.map(x => `<div class="tx tx-${x.kind}">
          <span class="tx-ico">${TXICO[x.icon] || TXICO.case}</span>
          <span class="tx-body"><b>${esc(x.title)}</b><small>${day(x.t)}${x.note ? ` · ${esc(x.note)}` : ''}</small></span>
          <span class="tx-sum ${x.amount > 0 ? 'plus' : x.amount < 0 ? 'minus' : ''}">${x.amount ? `${x.amount > 0 ? '+' : '−'}${coin(Math.abs(x.amount))}` : 'подарок'}</span>
        </div>`).join('') : '<div class="panel cases-empty"><b>Операций пока нет</b><span class="muted">Здесь появятся апгрейды, кейсы, бонусы и выводы</span></div>'}</div>`;
  }
  document.addEventListener('click', e => {
    if (!$('#walletBody')) return;
    const t = e.target.closest('button, a');
    if (!t) return;
    const d = t.dataset;
    if (d.wtab) { WF.tab = d.wtab; haptic('light'); history.replaceState(null, '', `#/wallet?tab=${d.wtab}`); return renderWallet(); }
    if (d.wdep) { WF.dep = d.wdep; haptic('light'); return renderWallet(); }
    if (d.wwd) { WF.wd = d.wwd; haptic('light'); return renderWallet(); }
    if (d.wsum) { WF.amount = +d.wsum; return renderWallet(); }
    if (d.kind && t.closest('#wBonuses')) { WF.kinds[+t.closest('.dep-bonus').dataset.i] = d.kind; return renderWallet(); }
    if (d.sum && t.closest('#wBonuses')) { WF.amount = +d.sum; renderWallet(); return window.scrollTo({ top: 0, behavior: 'smooth' }); }
    if ('wsend' in d) {
      const m = WD_METHODS.find(x => x[0] === WF.wd);
      if (WF.out < m[2]) { haptic('warning'); return toast(`Вывод от ${rubFmt(m[2])}`, 'error'); }
    }
    if ('wpay' in d || 'wsend' in d) { haptic('warning'); return toast(NOT_YET, 'error'); }
    if (d.wfilter) { WF.filter = d.wfilter; return renderWallet(); }
    if ('wperiod' in d) { WF.period = WF.period === 30 ? 7 : WF.period === 7 ? 0 : 30; return renderWallet(); }
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'wAmt') {
      WF.amount = Math.floor(Number(e.target.value.replace(/\D/g, ''))) || 0;
      const b = $('[data-wpay]'); if (b) b.textContent = `Пополнить на ${rubFmt(WF.amount)}`;
      document.querySelectorAll('[data-wsum]').forEach(x => x.classList.toggle('on', +x.dataset.wsum === WF.amount));
      const wb = $('#wBonuses'); if (wb) wb.innerHTML = DEPOSIT_BONUSES.map((b2, i) => depCard(b2, i, WF.amount, WF.kinds[i])).join('');
    }
    if (e.target.id === 'wOut') {
      WF.out = Math.floor(Number(e.target.value.replace(/\D/g, ''))) || 0;
      const m = WD_METHODS.find(x => x[0] === WF.wd), g = $('#wGet');
      if (g) g.textContent = WF.out ? `К получению ${rubFmt(Math.floor(WF.out * (1 - m[3] / 100)))}` : '';
    }
  });

  // ---------- auth (demo) ----------
  const AVA_COLORS = ['#cd412b', '#467edf', '#7c954d', '#ae6eee', '#d68a1f', '#2c9c8f'];
  // the Telegram profile photo (served by the bot, /api/ava/<id>) over the letter; the letter stays if there is no photo
  const avaUrl = id => (id && window.RUSTUP_API ? window.RUSTUP_API.replace(/\/$/, '') + '/api/ava/' + encodeURIComponent(String(id)) : '');
  const myPhoto = () => (tgUser() && tgUser().photo_url) || avaUrl(S.user && S.user.id);
  const avatarHtml = (name, color, cls = 'avatar', photo = '') => {
    const safeColor = /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#467edf';
    const safePhoto = /^(https:\/\/|\/)/i.test(photo || '') ? photo : '';
    return `<span class="${cls}" style="background:linear-gradient(135deg,${safeColor},#111)">${esc((name || '?').trim()[0] || '?').toUpperCase()}${safePhoto ? `<img class="ava-img" src="${esc(safePhoto)}" alt="" loading="lazy" draggable="false" onerror="this.remove()">` : ''}</span>`;
  };

  // inside Telegram the account is already known: sign in silently with the Telegram name
  // the account is the Telegram one; after the game server loaded it, a new player gets the starter pack
  function tgLogin() {
    if (!gameReady) return false;
    if (!S.rewards.starter) giveStarterPack();
    return true;
  }

  function requireLogin(then) {
    if (gameReady && S.user) return then && then();
    toast('Профиль ещё загружается, попробуйте через секунду', 'error');
  }

  // ---------- starter pack: chosen by the server, once per account ----------
  function giveStarterPack() {
    api('starter').then(d => {
      if (!d.ok) return;
      refreshUpgrade();
      showStarter(d.names);
    });
  }
  function showStarter(names) {
    const total = sum(names.map(n => byName[n].price));
    modal('Стартовый набор', `
      <p class="note" style="font-size:13px;color:var(--text-subtitle)">Подарок за первый вход — ${names.length} скинов на ${coin(total)}. Они уже в вашем инвентаре: продайте их или поставьте в апгрейд.</p>
      <div class="starter-grid">${names.map((n, i) => `<div class="starter-cell" style="animation-delay:${i * 0.12}s">${card(byName[n], { static: true })}</div>`).join('')}</div>
      <div class="row">
        <a class="btn btn-ghost" href="#/inventory" data-close-go style="flex:1">В инвентарь</a>
        <a class="btn btn-accent" href="#/cases" data-close-go style="flex:1">Бесплатные кейсы</a>
      </div>`,
    m => { m.querySelectorAll('[data-close-go]').forEach(a => a.addEventListener('click', closeModal)); });
    sfxWin();
  }

  // ---------- wallet ----------
  // the balance changes on the server; this only plays the header bump
  function bumpBalance() {
    renderHeader();
    const b = $('.balance'); if (b) { b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
  }
  // ---------- Telegram channel bonus (replaces top-up) ----------
  // A static site cannot ask Telegram whether the user really joined (that needs the bot token on a server),
  // so the claim unlocks after the channel link was opened.
  const tgBonusDone = () => !!S.rewards.tgSub;
  function openChannel(ch = TG_CHANNEL) {
    const url = 'https://t.me/' + ch;
    if (TG && tgVer('6.1')) TG.openTelegramLink(url); else window.open(url, '_blank', 'noopener');
  }
  // auto pop-up advertising the channel bonus; waits for open modals (login, starter pack) to close
  const PROMO_SNOOZE = 6 * 60 * 60 * 1000;
  // also shows the free cases and the daily gift pop-ups (order: cases, channel bonus, daily gift)
  let dailyPopupClosed = false;   // closing the daily pop-up hides it until the page reloads
  function scheduleTgPromo(delay) {
    setTimeout(() => {
      if ($('.tg-promo')) return;
      const casesWanted = S.user && casesLeft().length === CASES.length && !curPath().startsWith('/case') && Date.now() - (S.rewards.casesPromoHidden || 0) >= PROMO_SNOOZE;
      const tgWanted = !tgBonusDone() && Date.now() - (S.rewards.promoHidden || 0) >= PROMO_SNOOZE;
      const dailyWanted = S.user && dailyReady() && !dailyPopupClosed;
      if (!casesWanted && !tgWanted && !dailyWanted) return;
      if ($('#modalRoot').children.length || U.spinning || caseSpinning) return scheduleTgPromo(3000);
      showTgPromo(casesWanted ? 'cases' : tgWanted ? 'tg' : 'daily');
    }, delay);
  }
  function showTgPromo(kind = 'tg') {
    const daily = kind === 'daily', cases = kind === 'cases';
    const el = document.createElement('div');
    el.className = 'tg-promo' + (daily ? ' daily' : cases ? ' daily cases' : '');
    el.setAttribute('role', 'dialog');
    el.innerHTML = cases ? `
      <button class="tg-promo-x" aria-label="Закрыть">${ICON.x}</button>
      <div class="tg-promo-icon"><span class="nav-icon icon-gift"></span></div>
      <div class="tg-promo-body">
        <span class="tg-promo-kicker">Для новых игроков</span>
        <b class="tg-promo-title">${CASES.length} кейса бесплатно</b>
        <span class="tg-promo-text">Rust, CS2 и Telegram NFT — за подписку на 2 канала</span>
      </div>
      <button class="btn btn-accent tg-promo-go">Открыть кейсы</button>` : daily ? `
      <button class="tg-promo-x" aria-label="Закрыть">${ICON.x}</button>
      <div class="tg-promo-icon"><span class="nav-icon icon-gift"></span></div>
      <div class="tg-promo-body">
        <span class="tg-promo-kicker">Ежедневный подарок</span>
        <b class="tg-promo-title">Забирай ${bonusTxt()} прямо сейчас</b>
        <span class="tg-promo-text">Новый подарок — каждые 24 часа</span>
      </div>
      <button class="btn btn-accent tg-promo-go">Забрать подарок</button>` : `
      <button class="tg-promo-x" aria-label="Закрыть">${ICON.x}</button>
      <div class="tg-promo-icon">${ICON.tg}</div>
      <div class="tg-promo-body">
        <span class="tg-promo-kicker">Бонус за подписку</span>
        <b class="tg-promo-title">Забирай ${bonusTxt()} на аккаунт</b>
        <span class="tg-promo-text">за подписку на <b>@${TG_CHANNEL}</b></span>
      </div>
      <button class="btn btn-tg tg-promo-go">Забрать</button>`;
    const hide = snooze => {
      if (snooze && daily) dailyPopupClosed = true;
      else if (snooze || cases) { S.rewards[cases ? 'casesPromoHidden' : 'promoHidden'] = Date.now(); save(); }
      el.classList.add('out');
      setTimeout(() => { el.remove(); scheduleTgPromo(4000); }, 300);
    };
    el.querySelector('.tg-promo-x').onclick = () => hide(true);
    el.querySelector('.tg-promo-go').onclick = () => {
      hide(false);
      if (cases) location.hash = '#/cases'; else if (daily) claimDaily(); else openTgBonus();
    };
    document.body.appendChild(el);
    haptic('light');
    beep(880, 0.08, 'triangle', 0.04); setTimeout(() => beep(1320, 0.12, 'triangle', 0.04), 90);
  }
  function openTgBonus() {
    requireLogin(() => {
      if (tgBonusDone()) return modal('Бонус за подписку', `<p class="note" style="font-size:14px">Бонус ${bonusTxt()} уже получен. Спасибо, что с нами в <b>@${TG_CHANNEL}</b>! Ещё больше бонусов — в разделе <a href="#/rewards" data-close-go>Rewards</a>.</p>`,
        m => $('[data-close-go]', m).addEventListener('click', closeModal));
      let opened = !!S.rewards.tgOpened;
      modal('Бонус за подписку', `
        <div class="tg-bonus"><span class="big">${bonusTxt()}</span><p>Подпишитесь на наш Telegram-канал <b>@${TG_CHANNEL}</b> и получите бонус на баланс. Один раз на аккаунт.</p></div>
        <button class="btn btn-tg" id="tgSub" style="height:48px">${ICON.tg}<span>1. Подписаться на @${TG_CHANNEL}</span></button>
        <button class="btn btn-accent" id="tgClaim" style="height:48px" ${opened ? '' : 'disabled'}><span>2. Получить ${bonusTxt()}</span></button>
        <p class="note">Бонусный баланс виртуальный и не выводится.</p>`,
      m => {
        $('#tgSub', m).onclick = () => {
          openChannel();
          opened = true;
          $('#tgClaim', m).disabled = false;
        };
        // the server asks Telegram whether the player really joined
        $('#tgClaim', m).onclick = () => {
          if (!opened || tgBonusDone()) return;
          const b = $('#tgClaim', m); b.disabled = true;
          api('tgbonus').then(d => {
            b.disabled = false;
            if (!d.ok) return toast(d.error === 'subs' ? `Подпишитесь на @${TG_CHANNEL} и нажмите ещё раз` : gameErr(d), 'error');
            $('.tg-promo')?.remove();
            closeModal(); sfxWin(); bumpBalance();
            toast(`Бонус за подписку: ${bonusTxt()}`, 'success');
            refreshUpgrade();
            if (location.hash === '#/rewards') rewardsPage();
          });
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
    $('#footerSocials').innerHTML = socials();
    const us = $('#userSection');
    if (!S.user) {
      us.innerHTML = `<button class="btn btn-steam" data-login>${ICON.steam}<span>Войти</span></button>`;
    } else {
      us.innerHTML = `
        <button class="balance${$('#curMenu') ? ' open' : ''}" type="button" data-cur-menu aria-label="Баланс и валюта" aria-haspopup="menu">${coin(S.balance)}<svg class="balance-caret" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 7.5l3-3 3 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <button class="btn btn-accent btn-pill btn-deposit" type="button" data-deposit>Пополнить</button>
        <a href="#/profile" aria-label="Профиль">${avatarHtml(S.user.name, S.user.color, 'avatar', myPhoto())}</a>`;
    }
    document.querySelectorAll('.nav-item[data-route="/rewards"]').forEach(a => {
      a.querySelector('.nav-dot')?.remove();
      if (S.user && (dailyReady() || (S.rewards.cashback || 0) >= 1)) a.insertAdjacentHTML('beforeend', '<span class="nav-dot"></span>');
    });
  }

  // ---------- currency menu (under the balance in the header) ----------
  function curMenuHtml() {
    const rows = Object.entries(CURRENCIES).map(([id, c]) => `
      <button class="cur-row${id === curId() ? ' on' : ''}" type="button" data-cur="${id}" role="menuitemradio" aria-checked="${id === curId()}">
        <span class="cur-ico">${c.icon}</span><span class="cur-name">${c.name}</span><b>${fmt(S.balance, id)}</b><span class="cur-radio"></span>
      </button>`).join('');
    return `<div class="cur-title">Валюта</div>${rows}
      <div class="cur-foot">
        <a class="btn btn-ghost" href="#/wallet?tab=history" data-cur-close>${ICON.wallet}<span>Кошелёк</span></a>
        <button class="btn btn-accent" type="button" data-deposit><span>Пополнить</span></button>
      </div>
      <p class="cur-rate">1 USDT = ${numFmt(usdRub, 2)} ₽ (курс ЦБ) · 1 ⭐ = ${numFmt(STAR_USD, 3)} USDT</p>`;
  }
  function placeCurMenu() {
    const m = $('#curMenu'), b = $('[data-cur-menu]');
    if (!m || !b) return closeCurMenu();
    const r = b.getBoundingClientRect();
    const w = Math.min(360, window.innerWidth - 24);
    m.style.width = w + 'px';
    m.style.top = r.bottom + 8 + 'px';
    m.style.left = Math.max(12, Math.min(r.right - w, window.innerWidth - w - 12)) + 'px';
  }
  function openCurMenu() {
    let m = $('#curMenu');
    if (!m) { m = document.createElement('div'); m.id = 'curMenu'; m.className = 'cur-menu'; m.setAttribute('role', 'menu'); document.body.appendChild(m); }
    m.innerHTML = curMenuHtml();
    placeCurMenu();
    $('[data-cur-menu]')?.classList.add('open');
  }
  function closeCurMenu() {
    $('#curMenu')?.remove();
    $('[data-cur-menu]')?.classList.remove('open');
  }
  // every amount on screen is rendered from coins, so a currency change just redraws the page in place
  function rerenderMoney() {
    const y = window.scrollY;
    renderHeader();
    if ($('#curMenu')) $('#curMenu').innerHTML = curMenuHtml();
    if (feed.length) { $('#drops').innerHTML = feed.map(d => feedItem(d)).join(''); renderBest(false); }
    if (!U.spinning && !caseSpinning) { route(); window.scrollTo({ top: y }); }
  }
  function setCurrency(id) {
    if (!(id in CURRENCIES)) return;
    S.settings.currency = id; save();
    haptic('light');
    closeCurMenu();
    rerenderMoney();
  }
  document.addEventListener('click', e => {
    const t = e.target;
    const c = t.closest('[data-cur]');
    if (c) return setCurrency(c.dataset.cur);
    if (t.closest('[data-cur-menu]')) return $('#curMenu') ? closeCurMenu() : openCurMenu();
    if (t.closest('[data-cur-close]') || !t.closest('#curMenu')) closeCurMenu();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCurMenu(); });
  window.addEventListener('resize', () => placeCurMenu());
  window.addEventListener('scroll', () => placeCurMenu(), { passive: true });

  // ---------- skin card ----------
  function card(skin, o = {}) {
    const cls = ['skin-card', 'rarity-' + skin.rarity, 'game-' + skin.game];
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

  // ---------- live feed: real wins of all players, Rust + CS2 + NFT in one strip (server: /api/drop, /api/feed) ----------
  const FEED_MS = 6000;           // poll period; the server caches the answer for a few seconds
  const ONLINE_MULT = 4;          // owner's choice: the site shows 4× the players counted by the server (admin /stats stays exact)
  const feed = [];
  const seenDrops = new Set();    // server ids already in the strip (our own wins are shown before the server has them)
  let best = null;

  function feedItem(d, cls = 'drop') {
    return `<a class="${cls} rarity-${d.skin.rarity} game-${d.skin.game}${d.enter ? ' enter' : ''}" href="#/upgrade?game=${d.skin.game}" title="${esc(d.skin.name)} · ${esc(d.user)} · ${d.chance.toFixed(2)} %">
      <span class="drop-img"><img src="${d.skin.img}" alt="${esc(d.skin.name)}" draggable="false"></span>
      <span class="drop-info">
        <span class="drop-user">${avatarHtml(d.user, d.color, 'mini-ava', avaUrl(d.uid))}<span>${esc(d.user)}</span></span>
        <span class="drop-price">${coin(d.skin.price)}</span>
      </span>
    </a>`;
  }
  function renderBest(enter) {
    if (!best) return;
    $('#bestDrop').innerHTML = feedItem({ ...best, enter }, 'drop best');
  }
  function renderFeedEmpty() {
    if (!feed.length) $('#drops').innerHTML = '<span class="drops-empty">Здесь появятся выигрыши игроков</span>';
  }
  function pushDrop(d) {
    if (!feed.length) $('#drops').innerHTML = '';
    feed.unshift(d);
    if (feed.length > 16) feed.length = 16;
    const box = $('#drops');
    box.insertAdjacentHTML('afterbegin', feedItem({ ...d, enter: true }));
    while (box.children.length > 16) box.lastElementChild.remove();
    if (!best || d.skin.price > best.skin.price) { best = d; renderBest(true); }
  }
  // a server row → a strip item; skins missing from this build's catalog are skipped
  const fromServer = r => { const skin = byName[r.name]; return skin && { id: r.id, uid: r.uid, user: r.nick, color: r.color || AVA_COLORS[r.id % AVA_COLORS.length], skin, chance: r.chance || 100, t: r.t }; };
  // the server writes our win to the feed itself; pull the strip sooner than the regular poll
  // (the feed answer is cached for a few seconds, so ask twice)
  function reportDrops() {
    setTimeout(() => loadFeed(false), 1500);
    setTimeout(() => loadFeed(false), 5500);
  }
  let online = 0;
  function loadFeed(first) {
    if (!window.RUSTUP_API) return renderFeedEmpty();
    fetch(window.RUSTUP_API.replace(/\/$/, '') + '/api/feed').then(r => r.json()).then(d => {
      if (!d || !d.ok) return;
      online = (d.online || 0) * ONLINE_MULT;
      $('#statOnline').textContent = fmtInt(Math.max(1, online));
      document.querySelectorAll('.gc-online[data-share]').forEach(el => {
        const n = Math.round(online * el.dataset.share);
        el.hidden = !n;
        el.lastChild.textContent = fmtInt(n);
      });
      const fresh = d.drops.filter(r => !seenDrops.has(r.id)).reverse();   // oldest first, so the newest ends up on the left
      fresh.forEach(r => seenDrops.add(r.id));
      const items = fresh.map(fromServer).filter(Boolean);
      if (first) {
        feed.length = 0;
        items.reverse().forEach(x => feed.push(x));
        $('#drops').innerHTML = feed.map(x => feedItem(x)).join('');
      } else items.forEach(pushDrop);
      const b = d.best && fromServer(d.best);
      if (b && (!best || b.skin.price >= best.skin.price)) { best = b; renderBest(first ? false : true); }
      renderFeedEmpty();
    }).catch(() => renderFeedEmpty());
  }
  function initFeed() {
    renderFeedEmpty();
    loadFeed(true);
    setInterval(() => { if (!document.hidden) loadFeed(false); }, FEED_MS);
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
      return `<line x1="${100 + r1 * Math.cos(a)}" y1="${100 + r1 * Math.sin(a)}" x2="${100 + r2 * Math.cos(a)}" y2="${100 + r2 * Math.sin(a)}" stroke="${i % 5 ? '#3a3d45' : '#5d616b'}" stroke-width="${i % 5 ? 0.8 : 1.4}"/>`;
    }).join('');
    return `<svg class="wheel-svg" viewBox="0 0 200 200">
      <defs>
        <radialGradient id="wInner" cx="50%" cy="40%" r="65%"><stop offset="0" stop-color="#2a2d34"/><stop offset="1" stop-color="#16171b"/></radialGradient>
        <linearGradient id="wRing" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2c2f36"/><stop offset=".5" stop-color="#1b1d22"/><stop offset="1" stop-color="#2c2f36"/></linearGradient>
      </defs>
      <circle cx="100" cy="100" r="99" fill="url(#wRing)" stroke="#0e0f12" stroke-width="1"/>
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

  // ---------- game switch: Rust, CS2, Telegram NFT gifts; a game marked `soon` shows a placeholder screen ----------
  const GAME_ICON = {
    cs2: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="15" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="24" cy="24" r="3.5" fill="currentColor"/><path d="M24 3v11M24 34v11M3 24h11M34 24h11" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
    nft: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="7" y="20" width="34" height="22" rx="4" fill="currentColor" opacity=".35"/><rect x="4" y="13" width="40" height="9" rx="3" fill="currentColor"/><path d="M24 13v29" stroke="#141518" stroke-width="4"/><path d="M24 13c-3-7-12-8-12-2.5S20 13 24 13zm0 0c3-7 12-8 12-2.5S28 13 24 13z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/></svg>'
  };
  const GAMES = [
    { id: 'rust', name: 'Rust', sub: 'Скины Rust' },
    { id: 'cs2', name: 'CS2', sub: 'Скины CS2' },
    { id: 'nft', name: 'NFT Telegram', sub: 'Подарки' }
  ];
  // the priciest AK reads best as a game icon; fall back to the priciest skin if the catalog changes
  const akIcon = id => {
    const pool = POOL[id], ak = pool.filter(s => /AK-?47/.test(s.name));
    return (ak.length ? ak : pool).reduce((a, b) => (b.price > a.price ? b : a));
  };
  const gameIcon = id => (POOL[id] && POOL[id].length ? `<img src="${akIcon(id).img}" alt="" draggable="false">` : GAME_ICON[id]);

  // stake and targets belong to one game, so switching games starts a fresh upgrade
  function setGame(id) {
    if (id === U.game) return;
    U.game = id;
    U.inputs.clear(); U.targets = []; U.balanceAdd = 0; U.mult = null; U.result = null;
    U.invPage = 0; U.upPage = 0; U.filter = { min: '', max: '', q: '' };
  }

  function gameSwitch() {
    return `<div class="game-switch" role="tablist" aria-label="Игра">${GAMES.map(g => `
      <button class="game-tab game-${g.id}${U.game === g.id ? ' active' : ''}" data-game="${g.id}" role="tab" aria-selected="${U.game === g.id}">
        <span class="game-icon">${gameIcon(g.id)}</span>
        <span class="game-text"><b>${g.name}</b><small>${g.sub}</small></span>
        ${g.soon ? '<span class="soon-badge">Скоро</span>' : ''}
      </button>`).join('')}</div>`;
  }

  function soonPage(g) {
    $('#page').innerHTML = `<div class="page">
      <div class="up-head"><h1 class="up-title">Апгрейд</h1>${gameSwitch()}</div>
      <div class="soon game-${g.id}">
        <div class="soon-preview" aria-hidden="true"><span></span><span class="soon-circle"></span><span></span></div>
        <div class="soon-body">
          <span class="soon-art">${GAME_ICON[g.id]}</span>
          <span class="soon-badge">Скоро</span>
          <h2>Апгрейд ${g.name}</h2>
          <p>Режим в разработке: скоро здесь можно будет улучшать ${g.what}. А пока доступен апгрейд скинов Rust и CS2.</p>
          <div class="row" style="justify-content:center;flex-wrap:wrap">
            <button class="btn btn-accent btn-pill" data-game="rust">Rust</button>
            <button class="btn btn-accent btn-pill" data-game="cs2">CS2</button>
          </div>
        </div>
      </div>
    </div>`;
  }

  function upgradePage() {
    const g = GAMES.find(x => x.id === U.game) || GAMES[0];
    if (g.soon) return soonPage(g);
    $('#page').innerHTML = `<div class="page">
      <div class="up-head"><h1 class="up-title">Апгрейд</h1>${gameSwitch()}</div>
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
            <svg viewBox="0 0 40 46"><path d="M20 44L4 8a4 4 0 013.6-6h24.8A4 4 0 0136 8z" fill="#f4f5f7" stroke="#141518" stroke-width="2"/><path d="M20 36L10 10h20z" fill="#e5383b"/></svg>
          </div>
          <div class="wheel-overlay"><span class="chance-percent" id="wPercent">0.00 %</span><span class="chance-label" id="wLabel">Выберите предметы</span></div>
        </div></div>
        <div class="item-panel left" id="leftPanel"></div>
        <div class="item-panel right" id="rightPanel"></div>
        <div class="balance-bar" id="balanceBar"></div>
        <button class="btn upgrade-btn" id="upBtn">Улучшить</button>
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
      const what = U.game === 'nft' ? 'подарки' : 'скины';
      p.innerHTML = `<div class="panel-labels"><span class="panel-title">Выберите ${what} или ${what} и баланс</span><span class="panel-sub">Можно выбрать несколько предметов</span></div><div class="item-slot">${slotArt()}</div>`;
      return;
    }
    const cards = skins.map(i => card(byName[i.name], { static: true, remove: `data-unselect="${i.uid}"` }));
    if (U.balanceAdd) cards.push(`<div class="balance-chip">${CURRENCIES[curId()].icon}<span>${fmt(U.balanceAdd)}</span></div>`);
    p.innerHTML = selGrid(cards, 'Ваша ставка', inputValue());
  }
  // empty-slot silhouette: a gun for skins, a gift box for Telegram NFT
  const slotArt = () => (U.game === 'nft' ? GAME_ICON.nft.replace('<svg', '<svg class="placeholder-weapon placeholder-gift"') : WEAPON_SVG);
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
      p.innerHTML = `<div class="panel-labels"><span class="panel-title">Выберите предмет для апгрейда</span><span class="panel-sub">Или нажмите множитель ниже</span></div><div class="item-slot">${slotArt()}</div>`;
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
    b.textContent = U.spinning ? 'Крутим…' : S.user ? 'Улучшить' : 'Войти и играть';
    $('#upHint').textContent = U.spinning ? '' : v.msg;
  }

  function applyMult(key) {
    const iv = inputValue();
    if (!iv) return;
    const kind = key[0], val = +key.slice(1);
    const want = kind === 'x' ? iv * val : (iv * RTP * 100) / val;
    // smallest-error skin whose chance stays within limits
    const ok = gamePool().filter(s => { const c = (iv / s.price) * RTP * 100; return c <= MAX_CHANCE && c >= MIN_CHANCE; });
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
    const mine = S.inventory.filter(i => ofGame(i.name));
    const total = sum(mine.map(i => byName[i.name].price));
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
      items = mine.map(i => ({ ...i, skin: byName[i.name] }))
        .sort((a, b) => (U.invSort === 'desc' ? b.skin.price - a.skin.price : a.skin.price - b.skin.price));
    } else {
      items = gamePool().slice().sort((a, b) => (U.invSort === 'desc' ? b.price - a.price : a.price - b.price)).map(s => ({ skin: s }));
    }
    const pg = pager(items.length, U.invPage, per); U.invPage = pg.page;
    const slice = items.slice(pg.page * per, pg.page * per + per);
    let cells = slice.map(it => tab === 'inventory'
      ? card(it.skin, { selected: U.inputs.has(it.uid), hover: 'plus', attrs: `data-inv="${it.uid}"`, disabled: U.spinning })
      : card(it.skin, { hover: 'cart', attrs: `data-buy="${it.skin.name}"`, disabled: U.spinning }));
    while (cells.length < per) cells.push('<div class="ghost-card"></div>');

    let overlay = '';
    if (tab === 'inventory' && !mine.length) {
      overlay = S.balance >= MIN_TOPUP
        ? `<div class="empty-overlay"><div class="empty-content"><p>Инвентарь пуст</p><span class="muted" style="font-size:12px">Купите скины в магазине или используйте баланс в апгрейде</span><button class="btn btn-accent" data-tab="shop">${ICON.shop}<span>В магазин</span></button></div></div>`
        : tgBonusDone()
          ? `<div class="empty-overlay"><div class="empty-content"><p>Недостаточно средств</p><span class="muted" style="font-size:12px">Заберите ежедневный бонус или введите промокод</span><a class="btn btn-accent" href="#/rewards"><span>Награды</span></a></div></div>`
          : `<div class="empty-overlay"><div class="empty-content"><p>Получите ${bonusTxt()}</p><span class="muted" style="font-size:12px">за подписку на Telegram-канал @${TG_CHANNEL}</span><button class="btn btn-tg" data-tg-bonus>${ICON.tg}<span>Получить</span></button></div></div>`;
    }
    const sel = [...U.inputs];
    html = head + `<div class="grid-container"><div class="grid">${cells.join('')}</div>${overlay}</div>
      <div class="inv-footer">
        ${tab === 'inventory' && sel.length && !U.spinning ? `<button class="btn sell-btn" data-sell>Продать (${sel.length}) · ${money(sum(sel.map(u => byName[invItem(u).name].price)))}</button><span class="spacer"></span>` : ''}
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
    let items = gamePool().filter(s =>
      (f.min === '' || s.price >= fromCur(+f.min)) && (f.max === '' || s.price <= fromCur(+f.max)) &&
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
    if (t.closest('[data-deposit]')) { closeCurMenu(); return openDeposit(); }
    if (t.closest('[data-bell]')) { location.hash = '#/rewards'; return; }
    const sub = t.closest('[data-sub]');
    if (sub) return openSub(sub.dataset.sub);
    const chk = t.closest('[data-subs-check]');
    if (chk) return manualSubsCheck(chk);
    const oc = t.closest('[data-open-case]');
    if (oc) return openCase(oc.dataset.openCase, oc);
    const cc = t.closest('[data-case-count]');
    if (cc) return setCaseCount(Number(cc.dataset.caseCount));
    if (U.spinning) return;

    const gm = t.closest('[data-game]');
    if (gm) {
      if (gm.dataset.game !== U.game) { setGame(gm.dataset.game); haptic('light'); upgradePage(); }
      return;
    }
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
      api('buy', { name }).then(d => {
        if (!d.ok) return netToast(d);
        bumpBalance();
        toast(`Куплено: <b>${esc(name)}</b>`, 'success');
        refreshUpgrade();
      });
    });
  }
  function sellSelected() {
    const uids = [...U.inputs];
    if (!uids.length) return;
    api('sell', { uids }).then(d => {
      if (!d.ok) return netToast(d);
      U.inputs.clear();
      bumpBalance();
      toast(`Продано ${d.count} шт. за ${coin(d.total)}`, 'success');
      refreshUpgrade();
    });
  }

  // ---------- the spin ----------
  function doUpgrade() {
    if (!S.user) return requireLogin();
    const v = validity();
    if (!v.ok || U.spinning) return v.msg && toast(v.msg, 'error');

    const inSkins = [...U.inputs].map(invItem);
    const inValue = inputValue();
    const targets = U.targets.slice();
    const balUsed = U.balanceAdd;
    U.spinning = true; U.result = null;
    renderButton(); renderMults();
    // the server takes the stake, rolls and keeps the result; the wheel then spins to its roll
    api('upgrade', { uids: inSkins.map(i => i.uid), bal: balUsed, targets }, true).then(d => {
      if (!d.ok) { U.spinning = false; renderButton(); renderMults(); return netToast(d); }
      spinWheel(d, inSkins, inValue, targets, balUsed);
    });
  }
  function spinWheel(d, inSkins, inValue, targets, balUsed) {
    const { roll, win, chance: c } = d;
    // until the wheel stops, show the stake as taken and nothing won yet
    const staked = new Set(inSkins.map(i => i.uid));
    S.inventory = S.inventory.filter(i => !staked.has(i.uid));
    S.balance = Math.round((S.balance - balUsed) * 100) / 100;
    renderHeader(); renderBalanceBar(); renderInventory(); renderTargets();

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
      applyState(d.state);   // wins, history, stats and cashback as the server saved them

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
        reportDrops();
      } else {
        sfxLose();
        const cb = d.cashback;
        toast(`Не повезло — выпало ${roll.toFixed(2)}, нужно было меньше ${c.toFixed(2)}${cb ? ` · кешбэк +${money(cb)}` : ''}`, 'error');
      }
      refreshUpgrade();
      renderHeader();
      releaseVisualAction();
    }
  }

  // ---------- confetti ----------
  function confetti(host) {
    const cv = document.createElement('canvas');
    cv.className = 'confetti';
    host.appendChild(cv);
    const w = cv.width = host.clientWidth * devicePixelRatio, h = cv.height = host.clientHeight * devicePixelRatio;
    const ctx = cv.getContext('2d');
    const cols = ['#e5383b', '#ff7a6b', '#f4f5f7', '#9aa0aa', '#ffd166'];
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
  function claimDaily() {
    requireLogin(() => {
      if (!dailyReady()) return;
      api('daily').then(d => {
        if (!d.ok) return netToast(d);
        $('.tg-promo.daily')?.remove();
        sfxWin(); bumpBalance();
        toast(`Ежедневный подарок: ${bonusTxt()}`, 'success');
        refreshUpgrade();
        if (location.hash === '#/rewards') rewardsPage();
      });
    });
  }
  // cashback: a share of every lost upgrade stake and of every paid case that paid out less than its price (counted by the server)
  const { CASHBACK } = R;
  function claimCashback() {
    if ((S.rewards.cashback || 0) < 0.01) return;
    api('cashback').then(d => {
      if (!d.ok) return netToast(d);
      sfxWin(); bumpBalance();
      toast(`Кешбэк зачислен: ${coin(d.amount)}`, 'success');
      refreshUpgrade();
      if (location.hash === '#/rewards') rewardsPage();
    });
  }

  function rewardsPage() {
    const left = DAILY_MS - (Date.now() - (S.rewards.lastDaily || 0));
    const hh = Math.max(0, Math.floor(left / 3600e3)), mm = Math.max(0, Math.floor((left % 3600e3) / 60e3));
    const cb = S.rewards.cashback || 0;

    // RubUP-like layout: hero banner, deposit bonuses strip, daily tiles, friends
    const roadNfts = ROAD_ITEMS.filter(r => r.skin.img.includes('assets/nft/')).slice(-3).reverse().map(r => r.skin);
    const tile = (cls, art, title, value, text, btn) => `<div class="bonus-tile ${cls}"><span class="bt-art">${art}</span>
      <span class="bt-body"><b class="bt-title">${title}</b>${value ? `<span class="bt-value">${value}</span>` : ''}<span class="bt-text">${text}</span></span>${btn}</div>`;
    $('#page').innerHTML = `<div class="page bonus-page">
      <button class="hero-slide hs-road bonus-hero" type="button" data-to-road>
        <span class="hero-text"><span class="hero-kicker real">РЕАЛЬНЫЕ NFT</span><b class="hero-title">Дорога<br>друзей</b>
          <span class="hero-sub">${ROAD.length} наград · NFT до <b class="gold">3 000 ⭐</b> на твой аккаунт</span><span class="hero-btn">Открыть ${ICON.right}</span></span>
        <span class="hero-art">${roadNfts.map((s, i) => `<img class="hr-${i} nft" src="${s.img}" alt="" draggable="false">`).join('')}</span>
      </button>

      <div class="row-head"><h2 class="home-title">Бонусы за пополнение</h2>
        <span class="strip-nav"><button type="button" class="chip chip-icon" data-strip="-1" aria-label="Назад">${ICON.right}</button><button type="button" class="chip chip-icon" data-strip="1" aria-label="Вперёд">${ICON.right}</button></span></div>
      <div class="dep-bonuses page-bonuses" id="pageBonuses">${DEPOSIT_BONUSES.map((b, i) => depCard(b, i, 0, 'gift')).join('')}</div>

      <div class="row-head"><h2 class="home-title">Ежедневные</h2></div>
      <div class="bonus-grid">
        ${tile('bt-daily', `<img src="${giftImg('Подарок')}" alt="" draggable="false">`, 'Подарок дня', bonusTxt(), 'Каждые 24 часа, не копится',
          `<button class="btn ${dailyReady() ? 'btn-accent' : 'btn-ghost'} bt-btn" id="claimDaily" ${dailyReady() ? '' : 'disabled'}>${dailyReady() ? 'Забрать' : `${hh} ч ${mm} мин`}</button>`)}
        ${tile('bt-cash', `<span class="bt-coin">${ICON.coin}</span>`, `Кешбэк ${CASHBACK * 100}%`, coin(cb), 'С проигрышей в апгрейде и кейсах',
          `<button class="btn ${cb >= 0.01 ? 'btn-accent' : 'btn-ghost'} bt-btn" id="claimCashback" ${cb >= 0.01 ? '' : 'disabled'}>${cb >= 0.01 ? 'Забрать' : 'Пока пусто'}</button>`)}
        ${tile('bt-tg wide', `<span class="bt-tg-ico">${ICON.tg}</span>`, 'Подписка на Telegram', `+${bonusTxt()}`, `Канал <b>@${TG_CHANNEL}</b> — новости, промокоды и розыгрыши. Один раз на аккаунт`,
          `<button class="btn ${tgBonusDone() ? 'btn-ghost' : 'btn-tg'} bt-btn" data-tg-bonus>${tgBonusDone() ? 'Получено' : 'Получить'}</button>`)}
        <div class="bonus-tile bt-promo wide"><span class="bt-art"><span class="bt-promo-ico">%</span></span>
          <span class="bt-body"><b class="bt-title">Промокод</b><span class="bt-text">Новый промокод дня — в боте в 15:00 МСК. Для демо: <b>RUSTUP</b>, <b>WIPE</b>, <b>DEMO</b></span>
            <span class="row bt-promo-row"><input class="text-input" id="promo" placeholder="Промокод" maxlength="20"><button class="btn btn-accent" id="applyPromo">OK</button></span></span></div>
      </div>

      <div class="row-head"><h2 class="home-title">Друзья</h2></div>
      <div class="panel ref-panel" id="refPanel"></div>
      <div class="panel road-panel" id="refRoad"></div>
    </div>`;

    // bonus strip on the page: gift / skin toggle, arrows, «Пополнить» opens the top-up window with that sum
    const kinds = DEPOSIT_BONUSES.map(() => 'gift');
    $('#pageBonuses').addEventListener('click', e => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.kind) { const i = +t.closest('.dep-bonus').dataset.i; kinds[i] = t.dataset.kind; t.closest('.dep-bonus').outerHTML = depCard(DEPOSIT_BONUSES[i], i, 0, kinds[i]); return; }
      if (t.dataset.sum) openDeposit(+t.dataset.sum);
    });
    document.querySelectorAll('[data-strip]').forEach(b => b.onclick = () => $('#pageBonuses').scrollBy({ left: +b.dataset.strip * 220, behavior: 'smooth' }));
    $('[data-to-road]').onclick = () => $('#refRoad').scrollIntoView({ behavior: 'smooth', block: 'start' });

    $('#claimDaily').onclick = claimDaily;
    renderRefPanel();
    renderRoad();
    refSync();
    $('#claimCashback').onclick = () => requireLogin(claimCashback);
    const apply = () => requireLogin(() => {
      const code = $('#promo').value.trim().toUpperCase();
      if (!code) return;
      if (S.rewards.promos.includes(code)) return toast('Промокод уже использован', 'error');
      redeemPromo(code);
    });
    $('#applyPromo').onclick = apply;
    $('#promo').addEventListener('keydown', e => e.key === 'Enter' && apply());
  }
  // demo codes and the promo code of the day (posted by the bot at 15:00 MSK): checked and credited by the server, once per account
  let promoBusy = false;
  function redeemPromo(code) {
    if (promoBusy) return;
    promoBusy = true;
    const btn = $('#applyPromo');
    if (btn) btn.disabled = true;
    api('promo', { code }).then(d => {
      if (!d.ok) return netToast(d);
      sfxWin(); haptic('success'); bumpBalance();
      toast(`Промокод активирован: ${coinInt(d.amount)}`, 'success');
      if ($('#promo')) $('#promo').value = '';
      refreshUpgrade();
    }).finally(() => { promoBusy = false; if (btn) btn.disabled = false; });
  }

  // ---------- profile ----------
  function profilePage() {
    if (!S.user) {
      $('#page').innerHTML = `<div class="page"><div class="panel" style="text-align:center;padding:60px 24px"><h2 style="margin-top:0">Профиль</h2><p class="muted">Войдите, чтобы увидеть профиль</p><button class="btn btn-steam" data-login>${ICON.steam}<span>Войти через Steam</span></button></div></div>`;
      return;
    }
    // glass profile: the Telegram photo and name, stats, best wins, recent upgrades, links
    const st = S.stats, tgu = tgUser() || {};
    const winRate = st.upgrades ? ((st.wins / st.upgrades) * 100).toFixed(1) : '0';
    const invValue = sum(S.inventory.map(i => (byName[i.name] ? byName[i.name].price : 0)));
    const since = S.history.length ? S.history[S.history.length - 1].t : 0;
    // best wins: every won upgrade target and every case prize from the ledger, priciest first
    const wins = [];
    S.history.filter(h => h.win).forEach(h => h.targets.forEach(n => byName[n] && wins.push({ skin: byName[n], t: h.t, how: `Апгрейд · ${h.chance.toFixed(1)}%` })));
    const best = wins.sort((a, b) => b.skin.price - a.skin.price).slice(0, 6);
    const recent = S.history.slice(0, 8).map(h => `<div class="tx ${h.win ? 'tx-bonus' : 'tx-game'}">
        <span class="tx-ico">${TXICO.upgrade}</span>
        <span class="tx-body"><b>${h.targets.map(esc).join(', ')}</b><small>${new Date(h.t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · шанс ${h.chance.toFixed(2)}% · выпало ${h.roll.toFixed(2)}</small></span>
        <span class="tx-sum ${h.win ? 'plus' : 'minus'}">${h.win ? `+${coin(h.tv)}` : `−${coin(h.inValue)}`}</span></div>`).join('');
    const stat = (ico, k, v, sub = '') => `<div class="pf-stat w-glass"><span class="pf-stat-ico">${ico}</span><span class="pf-k">${k}</span><b class="pf-v">${v}</b>${sub ? `<span class="pf-sub">${sub}</span>` : ''}</div>`;
    $('#page').innerHTML = `<div class="page wallet-page profile-page">
      <span class="w-glow g1"></span><span class="w-glow g2"></span><span class="w-glow g3"></span>
      <div class="pf-hero w-glass">
        <div class="pf-ava">${avatarHtml(S.user.name, S.user.color, 'avatar', myPhoto())}<span class="pf-tg">${ICON.tg}</span></div>
        <div class="pf-who">
          <h1>${esc(S.user.name)}</h1>
          <span class="pf-meta">${tgu.username ? `@${esc(tgu.username)} · ` : ''}ID ${S.user.id}</span>
          ${since ? `<span class="pf-meta">Играет с ${new Date(since).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</span>` : ''}
        </div>
        <div class="pf-balance"><span>Баланс</span><b>${coin(S.balance)}</b></div>
        <div class="pf-actions">
          <a class="btn btn-accent" href="#/wallet?tab=deposit">Пополнить</a>
          <a class="btn btn-ghost" href="#/inventory">Инвентарь</a>
          <button class="btn btn-ghost" id="rename" type="button">Сменить ник</button>
        </div>
      </div>
      <div class="pf-stats">
        ${stat(TXICO.upgrade, 'Апгрейдов', fmtInt(st.upgrades))}
        ${stat(TXICO.gift, 'Побед', fmtInt(st.wins), `${winRate}% удачных`)}
        ${stat(TXICO.cashback, 'Поставлено', coin(st.wagered))}
        ${stat(TXICO.case, 'Лучший выигрыш', coin(st.best))}
        ${stat(TXICO.shop, 'Инвентарь', coin(invValue), `${fmtInt(S.inventory.length)} предметов`)}
        ${stat(TXICO.deposit, 'Выиграно всего', coin(st.won))}
      </div>
      <div class="row-head"><h2 class="home-title">Лучшие выигрыши</h2></div>
      ${best.length ? `<div class="pf-best">${best.map(w => `<div class="pf-best-card">${card(w.skin, { static: true })}<span>${esc(w.how)}</span></div>`).join('')}</div>`
        : `<div class="w-glass pf-empty"><b>Пока без побед</b><span class="muted">Сделайте первый апгрейд — лучшие выигрыши появятся здесь</span><a class="btn btn-accent w-go" href="#/upgrade">К апгрейду</a></div>`}
      <div class="row-head"><h2 class="home-title">Последние апгрейды</h2><a href="#/wallet?tab=history">Вся история ${ICON.right}</a></div>
      ${recent ? `<div class="tx-list w-glass">${recent}</div>` : '<div class="w-glass pf-empty"><span class="muted">Апгрейдов пока не было</span></div>'}
      <div class="pf-links">
        <a class="w-glass pf-link" href="#/wallet?tab=history"><span class="tx-ico">${TXICO.deposit}</span><b>Кошелёк и история</b>${ICON.right}</a>
        <a class="w-glass pf-link" href="#/friends"><span class="tx-ico">${TXICO.friends}</span><b>Друзья и рефералы</b>${ICON.right}</a>
        <a class="w-glass pf-link" href="#/provably-fair"><span class="tx-ico">${ICON.shield}</span><b>Проверка честности</b>${ICON.right}</a>
      </div>
    </div>`;
    $('#rename').onclick = () => {
      const n = prompt('Новый ник', S.user.name);
      if (n && n.trim()) api('nick', { name: n.trim().slice(0, 20) }).then(d => { if (!d.ok) return netToast(d); renderHeader(); profilePage(); });
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
      api('seed', { client: v }).then(d => { if (!d.ok) return netToast(d); toast('Client seed сохранён, nonce сброшен', 'success'); fairPage(); });
    };
    // the server keeps the seed secret until it is rotated, then reveals it here
    $('#rotate').onclick = () => api('rotate').then(d => { if (!d.ok) return netToast(d); toast('Server seed сменён, предыдущий раскрыт', 'success'); fairPage(); });
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
  // CS2 skins carry their category from the catalog; Rust ones are guessed by name
  const catOf = name => byName[name].cat || (CATS.weapon.test(name) ? 'weapon' : CATS.clothing.test(name) ? 'clothing' : CATS.deploy.test(name) ? 'deploy' : 'other');
  const CAT_LABEL = { all: 'Все типы', weapon: 'Оружие', knife: 'Ножи', gloves: 'Перчатки', nft: 'NFT', gift: 'Подарок', clothing: 'Одежда', deploy: 'Постройки', other: 'Прочее' };
  const GAME_LABEL = { all: 'Все игры', rust: 'Rust', cs2: 'CS2', nft: 'NFT Telegram' };
  const GAME_TAG = { cs2: 'CS2 · ' };
  const RARITY_LABEL = { all: 'Все', gray: 'Обычные', blue: 'Необычные', fiol: 'Редкие', pink: 'Засекреченные', red: 'Мифические', yellow: 'Легендарные' };
  const TRADE_RE = /^https:\/\/steamcommunity\.com\/tradeoffer\/new\/\?partner=\d+&token=[\w-]{6,12}$/;
  const INV_PER = 30;

  function inventoryItems() {
    const v = U.inv;
    const q = v.q.trim().toLowerCase();
    const list = S.inventory.map(i => ({ ...i, skin: byName[i.name] })).filter(i =>
      (v.game === 'all' || i.skin.game === v.game) &&
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
        <select class="select" id="ipGame">${Object.keys(GAME_LABEL).map(g => `<option value="${g}"${v.game === g ? ' selected' : ''}>${GAME_LABEL[g]}</option>`).join('')}</select>
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
            <a class="btn btn-accent" href="#/upgrade" data-goshop>${ICON.shop}<span>В магазин</span></a>
            ${tgBonusDone() ? '' : `<button class="btn btn-tg" data-tg-bonus>${ICON.tg}<span>+${bonusTxt()} за подписку</span></button>`}
          </div></div>`
      : !items.length ? '<div class="panel inv-empty"><p>Ничего не найдено</p><span class="muted">Измените фильтры</span></div>'
      : `<div class="inv-grid">${slice.map(i => `<div class="inv-cell${fresh(i.t) ? ' fresh' : ''}">
            ${card(i.skin, { selected: v.sel.has(i.uid), hover: 'check', attrs: `data-isel="${i.uid}"` })}
            <span class="cat-tag">${GAME_TAG[i.skin.game] || ''}${CAT_LABEL[catOf(i.name)]}</span>
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
    $('#ipGame').onchange = e => { v.game = e.target.value; v.page = 0; renderInvItems(); };
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
      if (!confirm(`Продать ${sel.length} шт. за ${money(total)}?`)) return;
      return api('sell', { uids: sel.map(i => i.uid) }).then(d => {
        if (!d.ok) return netToast(d);
        v.sel.clear();
        bumpBalance();
        toast(`Продано ${d.count} шт. за ${coin(d.total)}`, 'success');
        inventoryPage();
      });
    }
    if (act === 'upgrade') {
      if (sel.length > MAX_SLOTS) return toast(`В апгрейд можно взять не больше ${MAX_SLOTS} предметов`, 'error');
      const games = new Set(sel.map(i => byName[i.name].game));
      if (games.size > 1) return toast('В апгрейд можно взять предметы только одной игры', 'error');
      setGame([...games][0]);
      U.inputs = new Set(sel.map(i => i.uid));
      U.balanceAdd = 0; U.result = null; U.mult = null;
      v.sel.clear();
      location.hash = '#/upgrade';
      return;
    }
    if (act === 'withdraw') openWithdraw(sel);
  }

  const TG_USER_RE = /^@?[A-Za-z0-9_]{5,32}$/;
  function openWithdraw(sel) {
    const total = sum(sel.map(i => byName[i.name].price));
    // NFT gifts go to a Telegram account, skins to a Steam trade link; one request can't mix them
    const nft = sel.filter(i => byName[i.name].game === 'nft').length;
    if (nft && nft < sel.length) return toast('NFT-подарки и скины выводятся отдельно', 'error');
    const head = `<p class="note" style="font-size:13px;color:var(--text-subtitle)">Будет отправлено <b style="color:var(--text-title)">${sel.length} шт.</b> на сумму ${coin(total)}.`;
    const tgName = (tgUser() && tgUser().username) || S.user.tgName || '';
    modal(nft ? 'Вывод в Telegram' : 'Вывод в Steam', nft ? `${head} Подарки придут на ваш Telegram-аккаунт.</p>
      <div class="field"><label for="trade">Telegram-юзернейм получателя</label>
        <input id="trade" class="text-input" placeholder="@username" value="${esc(tgName ? '@' + tgName.replace(/^@/, '') : '')}"></div>
      <button class="btn btn-tg" id="doWithdraw" style="height:48px">${ICON.tg}<span>Вывести (демо)</span></button>
      <p class="note">Демо-режим: настоящий подарок не отправляется, предметы просто списываются из инвентаря и попадают в историю выводов.</p>` : `${head} Бот пришлёт трейд-оффер на вашу ссылку обмена.</p>
      <div class="field"><label for="trade">Ссылка на обмен Steam</label>
        <input id="trade" class="text-input mono" placeholder="https://steamcommunity.com/tradeoffer/new/?partner=...&token=..." value="${esc(S.user.tradeLink || '')}"></div>
      <button class="btn btn-steam" id="doWithdraw" style="height:48px">${ICON.steam}<span>Вывести (демо)</span></button>
      <p class="note">Демо-режим: настоящий трейд не отправляется, предметы просто списываются из инвентаря и попадают в историю выводов. Ссылку можно найти в Steam: Инвентарь → Предложения обмена → «Кто может отправлять мне предложения».</p>`,
    m => {
      $('#doWithdraw', m).onclick = () => {
        const link = $('#trade', m).value.trim();
        if (nft ? !TG_USER_RE.test(link) : !TRADE_RE.test(link)) return toast(nft ? 'Неверный юзернейм Telegram' : 'Неверная ссылка на обмен', 'error');
        api('withdraw', { uids: sel.map(i => i.uid), link }).then(d => {
          if (!d.ok) return netToast(d);
          U.inv.sel.clear();
          closeModal();
          toast(`Вывод оформлен: ${d.count} шт. на ${coin(d.value)}`, 'success');
          inventoryPage();
        });
      };
    });
  }

  function renderWithdrawals() {
    const rows = S.withdrawals.map(w => `<tr>
      <td class="mono">#${w.id}</td>
      <td>${new Date(w.t).toLocaleString('ru-RU')}</td>
      <td>${w.items.slice(0, 3).map(esc).join(', ')}${w.items.length > 3 ? ` и ещё ${w.items.length - 3}` : ''}</td>
      <td>${coin(w.value)}</td>
      <td class="${w.real && w.status !== 'sent' ? 'muted' : 'ok'}">${w.real ? (w.status === 'sent' ? 'Отправлен на аккаунт' : 'Ожидает отправки') : 'Отправлено (демо)'}</td></tr>`).join('');
    $('#invPageBody').innerHTML = `<div class="panel" style="padding:0"><div class="table-wrap">${rows
      ? `<table class="table"><thead><tr><th>Заявка</th><th>Время</th><th>Предметы</th><th>Сумма</th><th>Статус</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="muted" style="padding:24px;margin:0">Выводов пока не было</p>'}</div></div>`;
  }

  // ---------- free cases: one per game, unlocked by subscribing to both channels ----------
  const { SUB_CHANNELS, CASES, PAID_CASES, TIMER_CASE, TIMER_MS } = R;
  PAID_CASES.forEach(c => { c.paid = true; });
  const timerLeft = () => Math.max(0, TIMER_MS - (Date.now() - (S.rewards.timerCase || 0)));
  const mmss = ms => {
    const s = Math.ceil(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
  };
  const { CASE_RTP } = R;         // average win is 90% of a paid case's price
  const caseById = id => CASES.find(c => c.id === id) || PAID_CASES.find(c => c.id === id) || (id === TIMER_CASE.id ? TIMER_CASE : null);
  const casesLeft = () => CASES.filter(c => !S.rewards.cases[c.id]);
  const casePrice = c => {
    if (!c.paid) return 0;
    if (c.price) return c.price;
    const p = sum(caseItems(c).map(i => (i.chance / 100) * i.skin.price)) / CASE_RTP;
    const step = p < 100 ? 1 : p < 1000 ? 5 : 50;
    return (c.price = Math.ceil(p / step) * step);
  };
  const caseCache = {};
  // evenly spread picks inside each price band, so a case holds the same items on every visit
  function caseItems(c) {
    if (caseCache[c.id]) return caseCache[c.id];
    const out = [];
    const games = c.game === 'mix' ? GAMES.map(g => g.id) : [c.game];
    c.tiers.forEach(([lo, hi, n, pct]) => {
      const groups = games.map(g => {
        const band = POOL[g].filter(s => s.price >= lo && s.price < hi);
        const k = Math.min(n, band.length);
        return [...new Set(Array.from({ length: k }, (_, i) => band[Math.floor(((i + 0.5) * band.length) / k)]))];
      }).filter(picks => picks.length);
      groups.forEach(picks => picks.forEach(skin => out.push({ skin, chance: pct / groups.length / picks.length })));
    });
    const total = sum(out.map(i => i.chance));
    out.forEach(i => { i.chance = (i.chance / total) * 100; });
    return (caseCache[c.id] = out.sort((a, b) => b.skin.price - a.skin.price));
  }
  function rollCase(c) {
    const items = caseItems(c);
    const r = (crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000) * 100;
    let acc = 0;
    return (items.find(i => (acc += i.chance) > r) || items[items.length - 1]).skin;
  }

  // the game server asks Telegram whether the player joined and keeps the answer in the account
  const subsOk = () => SUB_CHANNELS.every(c => S.rewards.subs[c.id]);
  let subsBusy = null, subsCheckedAt = 0;
  function checkSubs() {
    if (!gameReady) return Promise.resolve(S.rewards.subs);
    if (subsBusy) return subsBusy;
    subsBusy = api('subs').then(d => {
      if (!d.ok) throw new Error('subs check failed');
      subsCheckedAt = Date.now();
      return S.rewards.subs;
    }).finally(() => { subsBusy = null; });
    return subsBusy;
  }
  function openSub(id) {
    openChannel(id);
    refreshCases();
  }
  function manualSubsCheck(btn) {
    btn.disabled = true; btn.textContent = 'Проверяем…';
    checkSubs().then(() => {
      if (subsOk()) { sfxWin(); toast('Подписки подтверждены — кейсы открыты!', 'success'); }
      else toast('Не видим подписку на ' + SUB_CHANNELS.filter(c => !S.rewards.subs[c.id]).map(c => '@' + c.id).join(' и '), 'error');
    }).catch(() => toast('Не удалось проверить подписку, попробуйте ещё раз', 'error')).finally(refreshCases);
  }
  // silent re-check when the player comes back from a channel
  function autoCheckSubs() {
    if (!refAvailable() || !S.user || subsOk() || !casesLeft().length || Date.now() - subsCheckedAt < 10000) return;
    checkSubs().then(() => { if (subsOk()) { sfxWin(); toast('Подписки подтверждены — кейсы открыты!', 'success'); refreshCases(); } }).catch(() => {});
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && curPath().startsWith('/case')) { subsCheckedAt = 0; autoCheckSubs(); }
  });
  const curPath = () => (location.hash.replace(/^#/, '') || '/').split('?')[0];
  function refreshCases() {
    if (caseSpinning) return;
    const p = curPath();
    if (p === '/cases') casesPage();
    else if (p.startsWith('/case/')) casePage(p.slice(6));
  }

  function subsBlock() {
    return `<div class="panel subs-panel">
      <div class="subs-head"><b>Откройте ${CASES.length} кейса бесплатно</b><span>Выполните 2 условия — и кейсы ваши</span></div>
      ${SUB_CHANNELS.map((c, i) => {
        const ok = S.rewards.subs[c.id];
        return `<div class="sub-row${ok ? ' done' : ''}">
          <span class="sub-ico">${ICON.tg}</span>
          <span class="sub-text"><b>${i + 1}. Подпишитесь на ${esc(c.name)}</b><small>@${c.id} · ${esc(c.sub)}</small></span>
          ${ok ? `<span class="sub-ok">${ICON.check}</span>` : `<button class="btn btn-tg sub-btn" data-sub="${c.id}">Подписаться</button>`}
        </div>`;
      }).join('')}
      ${refAvailable() ? '<button class="btn btn-accent subs-check" data-subs-check>Проверить подписку</button>'
        : `<p class="note">В Telegram-боте${window.RUSTUP_BOT ? ` @${esc(window.RUSTUP_BOT)}` : ''} подписка проверяется автоматически.</p>`}
    </div>`;
  }

  const imgCls = s => (s.img.includes('assets/nft/') ? ' nft' : '');
  function caseArt(c) {
    const items = caseItems(c);
    return `<span class="case-rays"></span>
      ${items.slice(1, 5).map((i, n) => `<img class="ca-side ca-${n}${imgCls(i.skin)}" src="${i.skin.img}" alt="" draggable="false" loading="lazy">`).join('')}
      <img class="ca-hero${imgCls(items[0].skin)}" src="${items[0].skin.img}" alt="" draggable="false">
      <i class="spark s1"></i><i class="spark s2"></i><i class="spark s3"></i>`;
  }
  const caseState = c => (!S.user ? 'login' : c.paid ? 'buy' : c.timer ? (timerLeft() ? 'cooldown' : 'ready') : S.rewards.cases[c.id] ? 'opened' : subsOk() ? 'ready' : 'locked');
  // wide banner of the 15-minute case (cases page and home)
  function timerCaseCard() {
    const c = TIMER_CASE, st = caseState(c), left = timerLeft();
    const btn = st === 'cooldown' ? `${ICON.history}<span data-timer-left>${mmss(left)}</span>` : 'Бесплатно';
    return `<a class="timer-case ${st}" href="#/case/${c.id}" style="--cc:${c.color}">
      <span class="case-art">${caseArt(c)}</span>
      <span class="tc-text"><span class="case-kicker">Каждые 24 часа</span><b>${c.name}</b><small>Rust · CS2 · NFT — до ${coinInt(500)}</small></span>
      <span class="case-btn">${btn}</span>
    </a>`;
  }
  // live 24h countdown: the timer text ticks every second, and the case becomes available without a reload
  let timerWasReady = timerLeft() === 0;
  setInterval(() => {
    const left = timerLeft();
    document.querySelectorAll('[data-timer-left]').forEach(el => { el.textContent = mmss(left); });
    const ready = left === 0;
    if (ready === timerWasReady) return;
    timerWasReady = ready;
    if (!ready || caseSpinning) return;
    document.querySelectorAll('.timer-case').forEach(el => { el.outerHTML = timerCaseCard(); });
    if (curPath() === '/case/' + TIMER_CASE.id) $('#caseActions').innerHTML = caseActions(TIMER_CASE);
  }, 1000);
  function caseCard(c) {
    const st = caseState(c);
    const btn = c.paid ? coinInt(casePrice(c)) : st === 'opened' ? 'Открыт' : `${st === 'locked' ? ICON.lock : ''}Бесплатно`;
    return `<a class="case-card ${st}${c.paid ? ' paid' : ''}" href="#/case/${c.id}" style="--cc:${c.color}">
      <span class="case-art">${caseArt(c)}${st === 'opened' ? '<span class="case-badge">Открыт</span>' : ''}</span>
      <span class="case-foot"><b>${c.name}</b><span class="case-btn">${btn}</span></span>
    </a>`;
  }

  // cases page like RubUP: game switch, filter chips (search, all / free / cheap / premium, price sort), sections of the chosen game
  const CASE_CHIPS = [['all', 'Все'], ['free', 'Бесплатные'], ['cheap', 'Недорогие'], ['premium', 'Премиум']];
  const CHEAP_MAX = 500, PREMIUM_MIN = 1000;   // case price in coins
  const CF = { game: null, chip: 'all', sort: 'asc', q: '', search: false };
  function casesPage() {
    if (!CF.game) CF.game = GAMES.some(g => g.id === U.game) ? U.game : GAMES[0].id;
    const left = casesLeft().length, game = GAMES.find(g => g.id === CF.game);
    const q = CF.q.trim().toLowerCase(), match = c => !q || c.name.toLowerCase().includes(q);
    const free = CF.chip === 'all' || CF.chip === 'free' ? CASES.filter(c => c.game === CF.game && match(c)) : [];
    const paid = CF.chip === 'free' ? [] : PAID_CASES.filter(c => c.game === CF.game && match(c)
      && (CF.chip !== 'cheap' || casePrice(c) <= CHEAP_MAX) && (CF.chip !== 'premium' || casePrice(c) >= PREMIUM_MIN))
      .sort((a, b) => (casePrice(a) - casePrice(b)) * (CF.sort === 'asc' ? 1 : -1));
    $('#page').innerHTML = `<div class="page cases-page">
      <h1 class="up-title">Кейсы</h1>
      ${timerCaseCard()}
      ${S.user && left && !subsOk() ? subsBlock() : ''}
      <div class="game-switch cases-switch">${GAMES.map(g => `<button type="button" class="game-tab${g.id === CF.game ? ' active' : ''}" data-cgame="${g.id}">
        <span class="game-icon">${gameIcon(g.id)}</span><span class="game-text"><b>${g.name}</b><small>${g.sub}</small></span></button>`).join('')}</div>
      <div class="case-chips">
        <button type="button" class="chip chip-icon${CF.search ? ' on' : ''}" data-cchip="search" aria-label="Поиск">${ICON.search || '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M15.5 15.5L20 20" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>'}</button>
        <div class="chips-scroll">${CASE_CHIPS.map(([id, t]) => `<button type="button" class="chip${CF.chip === id ? ' on' : ''}" data-cchip="${id}">${t}</button>`).join('')}</div>
        <button type="button" class="chip chip-icon" data-cchip="sort" aria-label="Сортировка по цене" title="${CF.sort === 'asc' ? 'Сначала дешёвые' : 'Сначала дорогие'}"><svg viewBox="0 0 24 24"><path d="M8 4v16M8 20l-4-4M8 20l4-4M16 20V4M16 4l-4 4M16 4l4 4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" ${CF.sort === 'asc' ? '' : 'transform="scale(1 -1) translate(0 -24)"'}/></svg></button>
      </div>
      ${CF.search ? `<input class="text-input cases-search" id="caseSearch" placeholder="Название кейса" value="${esc(CF.q)}" maxlength="30">` : ''}
      ${free.length ? `<div class="row-head"><h2 class="home-title">Бесплатные</h2><span class="muted">${left ? `Доступно ${left} из ${CASES.length}` : 'Все открыты'}</span></div>
        <div class="cases-grid">${free.map(caseCard).join('')}</div>` : ''}
      ${free.length && !S.user ? `<div class="panel cases-login"><p>Войдите, чтобы забрать бесплатные кейсы</p><button class="btn btn-steam" data-login>${ICON.steam}<span>Войти</span></button></div>` : ''}
      ${paid.length ? `<div class="row-head"><h2 class="home-title">${CF.chip === 'premium' ? 'Премиум' : CF.chip === 'cheap' ? 'Недорогие' : 'Кейсы ' + game.name}</h2><span class="muted">${paid.length}</span></div>
        <div class="cases-grid">${paid.map(caseCard).join('')}</div>` : ''}
      ${!free.length && !paid.length ? '<div class="panel cases-empty"><b>Ничего не найдено</b><span class="muted">Попробуйте другой фильтр или игру</span></div>' : ''}
    </div>`;
    const s = $('#caseSearch');
    if (s) {
      s.addEventListener('input', () => { CF.q = s.value; const pos = s.selectionStart; casesPage(); const n = $('#caseSearch'); n.focus(); n.setSelectionRange(pos, pos); });
    }
    autoCheckSubs();
  }
  document.addEventListener('click', e => {
    const g = e.target.closest('[data-cgame]');
    if (g) { CF.game = g.dataset.cgame; haptic('light'); return casesPage(); }
    const c = e.target.closest('[data-cchip]');
    if (!c) return;
    const v = c.dataset.cchip;
    if (v === 'search') { CF.search = !CF.search; if (!CF.search) CF.q = ''; casesPage(); if (CF.search) $('#caseSearch').focus(); return; }
    if (v === 'sort') CF.sort = CF.sort === 'asc' ? 'desc' : 'asc'; else CF.chip = v;
    haptic('light');
    casesPage();
  });

  // ---------- case page: roulette ----------
  const ROUL_N = 56, ROUL_WIN = 46;   // strip length and the index the winner lands on
  let caseSpinning = false;
  // paid cases open up to 5 at once (one roulette per case); free cases are always one
  const CASE_COUNTS = [1, 2, 3, 4, 5];
  let caseCount = 1;
  const countFor = c => (c.paid ? caseCount : 1);
  const rollCell = s => `<div class="roll-cell rarity-${s.rarity}"><img class="${imgCls(s).trim()}" src="${s.img}" alt="" draggable="false"></div>`;
  const roulettes = (c, n) => Array.from({ length: n }, () =>
    `<div class="roulette${n > 1 ? ' multi' : ''}"><div class="roulette-track">${Array.from({ length: 14 }, () => rollCell(rollCase(c))).join('')}</div><span class="roulette-marker"></span></div>`).join('');
  function setCaseCount(n) {
    const c = caseById(curPath().slice(6));
    if (!c || !c.paid || caseSpinning || !CASE_COUNTS.includes(n)) return;
    caseCount = n;
    $('#roulettes').innerHTML = roulettes(c, n);
    $('#caseActions').innerHTML = caseActions(c);
  }
  function caseActions(c) {
    const st = caseState(c);
    if (st === 'login') return `<button class="btn btn-accent case-open" data-login>Войти и открыть</button>`;
    if (st === 'locked') return subsBlock();
    if (st === 'cooldown') return `<button class="btn btn-accent case-open" disabled>Следующий через&nbsp;<span data-timer-left>${mmss(timerLeft())}</span></button>
        <a class="btn btn-ghost case-next" href="#/upgrade">К апгрейду</a>`;
    if (st === 'buy') {
      const n = countFor(c), price = casePrice(c) * n;
      const counts = `<div class="case-count">${CASE_COUNTS.map(k => `<button class="cc-btn${k === n ? ' on' : ''}" data-case-count="${k}">x${k}</button>`).join('')}</div>`;
      return counts + (S.balance >= price
        ? `<button class="btn btn-accent case-open" data-open-case="${c.id}">Открыть${n > 1 ? ` ${n} шт.` : ''} за ${coinInt(price, 20)}</button>`
        : `<button class="btn btn-accent case-open" disabled>Не хватает ${coin(price - S.balance, 18)}</button>
          <a class="btn btn-ghost case-next" href="#/rewards">Получить бонусы</a>`);
    }
    if (st === 'opened') {
      const next = casesLeft()[0];
      return `<button class="btn btn-accent case-open" disabled>Кейс уже открыт</button>
        ${next ? `<a class="btn btn-ghost case-next" href="#/case/${next.id}">Открыть ${next.name}</a>` : `<a class="btn btn-ghost case-next" href="#/upgrade?game=${c.game}">К апгрейду</a>`}`;
    }
    return `<button class="btn btn-accent case-open" data-open-case="${c.id}">Открыть бесплатно</button>`;
  }
  function casePage(id) {
    const c = caseById(id);
    if (!c) { location.hash = '#/cases'; return; }
    const items = caseItems(c);
    const gameName = (GAMES.find(g => g.id === c.game) || GAMES[0]).name;
    $('#page').innerHTML = `<div class="page case-page" style="--cc:${c.color}">
      <a class="back-link" href="#/cases">${ICON.left}<span>Все кейсы</span></a>
      <div class="case-hero">
        <span class="case-art big">${caseArt(c)}</span>
        <div class="case-hero-text">${c.paid
          ? `<span class="case-kicker paid">Кейс ${gameName}</span><h1>${c.name}</h1><span class="muted">${items.length} предметов · ${coinInt(casePrice(c))}</span>`
          : c.timer
          ? `<span class="case-kicker">Бесплатно каждые 24 часа</span><h1>${c.name}</h1><span class="muted">${items.length} предметов · Rust, CS2 и NFT · до ${coinInt(500)}</span>`
          : `<span class="case-kicker">Бесплатный кейс</span><h1>${c.name}</h1><span class="muted">${items.length} предметов · один раз на аккаунт</span>`}</div>
      </div>
      <div class="roulettes" id="roulettes">${roulettes(c, countFor(c))}</div>
      <div class="case-actions" id="caseActions">${caseActions(c)}</div>
      <div class="row-head"><h2 class="home-title">Содержимое кейса</h2></div>
      <div class="case-items">${items.map(i => `<div class="case-item">${card(i.skin, { static: true })}<span class="chance-tag">${i.chance < 1 ? i.chance.toFixed(2) : i.chance.toFixed(1)}%</span></div>`).join('')}</div>
    </div>`;
    if (caseState(c) === 'locked') autoCheckSubs();
  }

  function openCase(id, btn) {
    const c = caseById(id);
    if (!c || caseSpinning || !S.user) return;
    if (c.paid) {
      const n = countFor(c), price = casePrice(c) * n;
      if (S.balance < price) return toast(`Недостаточно средств: нужно ${coin(price)}`, 'error');
      return spinCase(c, n);
    }
    if (c.timer) return timerLeft() ? toast(`Следующий кейс через ${mmss(timerLeft())}`, 'error') : spinCase(c);
    if (S.rewards.cases[c.id]) return;
    // the server checks both subscriptions itself before opening a free case
    btn.disabled = true; btn.textContent = 'Проверяем подписку…';
    spinCase(c, 1, () => { btn.disabled = false; btn.textContent = 'Открыть бесплатно'; });
  }

  // the server opens the case (price, timer, subscriptions) and picks the items; the roulettes then stop on them
  function spinCase(c, n = 1, onFail) {
    if (caseSpinning) return;
    caseSpinning = true;
    $('#caseActions').innerHTML = `<button class="btn btn-accent case-open" disabled>Открываем${n > 1 ? ` ${n} шт.` : ''}…</button>`;
    api('case', { id: c.id, n }, true).then(d => {
      if (!d.ok) {
        caseSpinning = false;
        if (onFail) onFail();
        if (d.error === 'subs') toast('Сначала подпишитесь на оба канала', 'error'); else netToast(d);
        return refreshCases();
      }
      spinRoulettes(c, n, d);
    });
  }
  function spinRoulettes(c, n, d) {
    const wins = d.wins.map(name => byName[name]), uids = d.uids;
    // until the strips stop, the header shows the price as paid
    if (c.paid) { S.balance = Math.round((S.balance - casePrice(c) * n) * 100) / 100; renderHeader(); }
    $('#caseActions').innerHTML = `<button class="btn btn-accent case-open" disabled>Открываем${n > 1 ? ` ${n} шт.` : ''}…</button>`;
    // one roulette per case; they spin together and each stops on its own winner
    $('#roulettes').innerHTML = roulettes(c, n);
    const strips = [...document.querySelectorAll('#roulettes .roulette')].map((view, k) => {
      const track = view.firstElementChild;
      track.innerHTML = Array.from({ length: ROUL_N }, (_, i) => rollCell(i === ROUL_WIN ? wins[k] : rollCase(c))).join('');
      track.style.transform = 'translateX(0)';
      const cellW = track.firstElementChild.offsetWidth;
      const step = cellW + (parseFloat(getComputedStyle(track).columnGap) || 0);
      return { view, track, step, end: ROUL_WIN * step + cellW * rand(0.15, 0.85) - view.clientWidth / 2 };
    });
    const dur = S.settings.fast ? 2600 : 6500;
    const ease = t => 1 - Math.pow(1 - t, 4);
    const t0 = performance.now();
    let lastCell = -1, done = false;
    requestAnimationFrame(function frame(now) {
      if (done) return;
      const t = Math.min(1, (now - t0) / dur);
      strips.forEach(s => { if (s.track.isConnected) s.track.style.transform = `translateX(${-s.end * ease(t)}px)`; });
      // one tick sound for all strips: they move at the same speed
      const s0 = strips[0], cell = Math.floor((s0.end * ease(t) + s0.view.clientWidth / 2) / s0.step);
      if (cell !== lastCell) { lastCell = cell; beep(1400, 0.015, 'square', 0.02); }
      if (t < 1) requestAnimationFrame(frame);
    });
    // the timer settles the result even if frames are throttled (background tab)
    setTimeout(() => {
      done = true;
      caseSpinning = false;
      strips.forEach(s => {
        if (!s.track.isConnected) return;
        s.track.style.transform = `translateX(${-s.end}px)`;
        s.track.children[ROUL_WIN].classList.add('win');
      });
      sfxWin();
      applyState(d.state); renderHeader();
      // paid cases that paid out less than their price count as a loss for cashback (counted by the server)
      if (d.cashback) toast(`Кешбэк +${coin(d.cashback)} — забрать в «Бонусах»`, 'success');
      reportDrops();
      if (curPath() === '/case/' + c.id) $('#caseActions').innerHTML = caseActions(c);
      releaseVisualAction();
      showCaseWin(c, wins, uids);
    }, dur + 30);
  }

  function showCaseWin(c, wins, uids) {
    const n = wins.length, total = sum(wins.map(w => w.price));
    const next = c.paid ? null : casesLeft()[0];
    const again = c.paid && S.balance >= casePrice(c) * n;
    const owned = () => uids.filter(u => invItem(u));
    modal(n > 1 ? `Ваш выигрыш · ${n} шт.` : 'Ваш выигрыш', `
      <div class="case-win${n > 1 ? ' multi' : ''}">${wins.map(w => card(w, { static: true })).join('')}</div>
      <p class="note" style="text-align:center">${n > 1 ? `Всего на ${coin(total)}. Предметы` : 'Предмет'} уже в инвентаре: продайте ${n > 1 ? 'их' : 'его'} или поставьте в апгрейд, чтобы выиграть дороже.</p>
      <div class="row">
        <button class="btn btn-ghost" id="cwSell" style="flex:1">${n > 1 ? 'Продать всё' : 'Продать'} за ${coin(total)}</button>
        <button class="btn btn-accent" id="cwUp" style="flex:1">В апгрейд</button>
      </div>
      ${next ? `<a class="btn btn-ghost" href="#/case/${next.id}" id="cwNext">Открыть ${next.name}</a>` : ''}
      ${again ? `<button class="btn btn-ghost" id="cwAgain">Открыть ещё${n > 1 ? ` ${n} шт.` : ''} за ${coinInt(casePrice(c) * n)}</button>` : ''}`,
    m => {
      const ag = $('#cwAgain', m);
      if (ag) ag.onclick = () => {
        closeModal();
        if (curPath() !== '/case/' + c.id) location.hash = '#/case/' + c.id;
        setTimeout(() => openCase(c.id), 50);
      };
      $('#cwSell', m).onclick = () => {
        // only what is still in the inventory (an item may have been used meanwhile)
        const left = owned();
        closeModal();
        if (!left.length) return;
        api('sell', { uids: left }).then(d => {
          if (!d.ok) return netToast(d);
          bumpBalance();
          toast(`Продано ${d.count > 1 ? `${d.count} шт. ` : ''}за ${coin(d.total)}`, 'success');
          // the balance changed: the "open for N coins" button may become available
          if (c.paid && curPath() === '/case/' + c.id) $('#caseActions').innerHTML = caseActions(c);
        });
      };
      $('#cwUp', m).onclick = () => {
        closeModal();
        const left = owned();
        if (!left.length) return;
        setGame(wins[0].game);
        U.inputs = new Set(left.slice(0, MAX_SLOTS)); U.balanceAdd = 0; U.result = null; U.mult = null;
        location.hash = '#/upgrade';
      };
      const nx = $('#cwNext', m); if (nx) nx.addEventListener('click', closeModal);
    });
  }

  // ---------- home: banner carousel, games, free cases ----------
  let heroTimer = null;
  const giftImg = n => (byName[n] || akIcon('nft')).img;
  function heroSlides() {
    const heroes = CASES.map(c => caseItems(c)[0].skin);
    const coins = ['c1', 'c2', 'c3'].map(k => `<span class="ha-coin ${k}">${ICON.coin}</span>`).join('');
    // the three priciest friends-road NFTs
    const roadNfts = ROAD_ITEMS.filter(r => r.skin.img.includes('assets/nft/')).slice(-3).reverse().map(r => r.skin);
    return [
      `<a class="hero-slide hs-road" href="#/friends">
        <span class="hero-text"><span class="hero-kicker real">РЕАЛЬНЫЕ NFT</span><b class="hero-title">Дорога<br>друзей</b><span class="hero-sub">Подарки и NFT Telegram на твой аккаунт за друзей</span><span class="hero-btn">Смотреть награды ${ICON.right}</span></span>
        <span class="hero-art">${roadNfts.map((s, i) => `<img class="hr-${i} nft" src="${s.img}" alt="" draggable="false">`).join('')}</span></a>`,
      `<a class="hero-slide hs-cases" href="#/cases">
        <span class="hero-text"><span class="hero-kicker"><i class="dot-online"></i>Для новых игроков</span><b class="hero-title">${CASES.length} кейса<br>бесплатно</b><span class="hero-sub">Rust · CS2 · Telegram NFT</span><span class="hero-btn">Открыть ${ICON.right}</span></span>
        <span class="hero-art">${heroes.map((s, i) => `<img class="ha-${i}${imgCls(s)}" src="${s.img}" alt="" draggable="false">`).join('')}</span></a>`,
      tgBonusDone()
        ? `<a class="hero-slide hs-daily" href="#/rewards">
          <span class="hero-text"><span class="hero-kicker">Каждые 24 часа</span><b class="hero-title">Подарок<br>${bonusTxt()}</b><span class="hero-sub">на баланс — бесплатно</span><span class="hero-btn">Забрать ${ICON.right}</span></span>
          <span class="hero-art"><img class="ha-gift" src="${giftImg('Подарок')}" alt="" draggable="false">${coins}</span></a>`
        : `<button class="hero-slide hs-tg" data-tg-bonus>
          <span class="hero-text"><span class="hero-kicker">Бонус за подписку</span><b class="hero-title">+${bonusTxt()}<br>на баланс</b><span class="hero-sub">за подписку на @${TG_CHANNEL}</span><span class="hero-btn">Забрать ${ICON.right}</span></span>
          <span class="hero-art"><span class="ha-tg">${ICON.tg}</span>${coins}</span></button>`
    ];
  }
  function homePage() {
    const slides = heroSlides();
    // the real online split between the tiles by a fixed share (the server counts players, not what they are playing)
    const playing = share => fmtInt(Math.round(online * share));
    const games = [
      // upgrade tiles: item on a pedestal with golden chevrons (assets/games, made by tools/build-game-art.ps1)
      { href: '#/upgrade?game=rust', cls: 'gc-rust', title: 'Апгрейд Rust', share: 0.27, art: `<img class="gc-art" src="assets/games/upgrade-rust.png" alt="" draggable="false">` },
      { href: '#/upgrade?game=cs2', cls: 'gc-cs2', title: 'Апгрейд CS2', share: 0.18, art: `<img class="gc-art" src="assets/games/upgrade-cs2.png" alt="" draggable="false">` },
      { href: '#/upgrade?game=nft', cls: 'gc-nft', title: 'Апгрейд NFT', share: 0.12, art: `<img class="gc-art" src="assets/games/upgrade-nft.png" alt="" draggable="false">` },
      { href: '#/cases', cls: 'gc-cases', title: 'Кейсы', share: 0.21, badge: 'FREE', art: CASES.map((c, i) => { const s = caseItems(c)[0].skin; return `<img class="gc-mini m${i}${imgCls(s)}" src="${s.img}" alt="" draggable="false">`; }).join('') },
      // Бонусы and Друзья are not games: no «playing» counter on them
      { href: '#/rewards', cls: 'gc-bonus', title: 'Бонусы', share: 0, art: `<img class="gc-img gift" src="${giftImg('Подарок')}" alt="" draggable="false">` },
      { href: '#/friends', cls: 'gc-friends', title: 'Друзья', share: 0, badge: 'NFT', art: `<img class="gc-img gift" src="${giftImg('Мишка')}" alt="" draggable="false">` }
    ];
    $('#page').innerHTML = `<div class="page home">
      <div class="hero">
        <div class="hero-track" id="heroTrack">${slides.join('')}</div>
        <div class="hero-dots" id="heroDots">${slides.map((_, i) => `<i${i ? '' : ' class="on"'}></i>`).join('')}</div>
      </div>
      <div class="row-head"><h2 class="home-title">Игры</h2></div>
      <div class="games-grid">${games.map(g => `<a class="game-card ${g.cls}" href="${g.href}">
        ${g.art}
        ${g.share ? `<span class="gc-online" title="Сейчас играют" data-share="${g.share}"${Math.round(online * g.share) ? '' : ' hidden'}><i class="dot-online"></i>${playing(g.share)}</span>` : ''}
        ${g.badge ? `<span class="gc-badge">${g.badge}</span>` : ''}
        <b class="gc-title">${g.title}</b></a>`).join('')}</div>
      <div class="row-head"><h2 class="home-title">Бесплатные кейсы</h2><a href="#/cases">Все ${ICON.right}</a></div>
      ${timerCaseCard()}
      <div class="cases-grid">${CASES.map(caseCard).join('')}</div>
      <div class="row-head"><h2 class="home-title">Популярные кейсы</h2><a href="#/cases">Все ${ICON.right}</a></div>
      <div class="cases-grid">${['rust-metal', 'cs2-assault', 'nft-collector'].map(id => caseCard(caseById(id))).join('')}</div>
    </div>`;
    initHero();
  }
  function initHero() {
    clearInterval(heroTimer);
    const track = $('#heroTrack');
    const dots = [...document.querySelectorAll('#heroDots i')];
    const cur = () => Math.round(track.scrollLeft / track.clientWidth);
    track.addEventListener('scroll', () => dots.forEach((d, i) => d.classList.toggle('on', i === cur())), { passive: true });
    heroTimer = setInterval(() => {
      if (!track.isConnected) return clearInterval(heroTimer);
      if (document.hidden || track.matches(':hover')) return;
      track.scrollTo({ left: ((cur() + 1) % dots.length) * track.clientWidth, behavior: 'smooth' });
    }, 5000);
  }

  // ---------- static text pages ----------
  function textPage(title, body) {
    $('#page').innerHTML = `<div class="page"><h2 class="section-title">${title}</h2><div class="panel prose">${body}</div></div>`;
  }

  // ---------- router ----------
  function route() {
    let [path, query] = (location.hash.replace(/^#/, '') || '/').split('?');
    // deep link to an upgrade tab: #/upgrade?game=cs2 (older links: #/?game=cs2)
    const game = new URLSearchParams(query || '').get('game');
    if (game && GAMES.some(g => g.id === game)) setGame(game);
    if (path === '/' && game) path = '/upgrade';
    const navKey = path === '/upgrade' ? '/' : path.startsWith('/case/') ? '/cases' : path.startsWith('/earn') ? '/earn' : path;
    document.querySelectorAll('.nav-item[data-route]').forEach(a => a.classList.toggle('active', a.dataset.route === navKey));
    if (path !== '/upgrade') U.result = null;
    if (path !== '/') clearInterval(heroTimer);
    closeCurMenu();
    if (tgVer('6.1')) TG.BackButton[path === '/' ? 'hide' : 'show']();
    switch (path) {
      case '/upgrade': upgradePage(); break;
      case '/cases': casesPage(); break;
      case '/friends': friendsPage(); break;
      case '/wallet': walletPage(query); break;
      case '/earn': earnPage(); break;
      case '/earn/tiktok': tiktokPage(); break;
      case '/rewards': rewardsPage(); break;
      case '/inventory': inventoryPage(); break;
      case '/profile': profilePage(); break;
      case '/provably-fair': fairPage(); break;
      case '/tos': textPage('Условия использования', '<p>RUST UP — демонстрационный интерфейс. Баланс, скины и результаты виртуальные и не имеют денежной стоимости, их нельзя вывести или обменять.</p><p>Проект не связан с Valve, Steam и Facepunch Studios. Изображения предметов принадлежат их правообладателям.</p>'); break;
      case '/privacy': textPage('Политика конфиденциальности', '<p>В Telegram-игре используется серверная авторизация. Баланс, инвентарь и история хранятся на сервере, а на устройстве — только настройки интерфейса. Перед публичным запуском необходимо опубликовать полную политику конфиденциальности.</p>'); break;
      default: if (path.startsWith('/case/')) casePage(path.slice(6)); else homePage();
    }
    window.scrollTo({ top: 0 });
  }

  // re-render grids when crossing the mobile breakpoint (page size changes 16 <-> 15)
  let lastPer = perPage();
  window.addEventListener('resize', () => {
    if (perPage() !== lastPer) { lastPer = perPage(); if ($('#invBox')) { renderInventory(); renderTargets(); } }
  });

  // the game is played through the Telegram bot only (the server checks the Telegram account)
  if (!TG || !window.RUSTUP_API) {
    const bot = window.RUSTUP_BOT || 'rustuper_bot';
    document.querySelector('.app').innerHTML = `<div class="tg-only">
      <span class="logo"><span class="logo-rust">RUST</span><span class="logo-up">UP</span></span>
      <h1>Играть можно в Telegram</h1>
      <p>Апгрейды, кейсы и выигрыши теперь считаются на сервере и привязаны к вашему Telegram-аккаунту. Откройте игру через бота — прогресс сохранится на любом устройстве.</p>
      <a class="btn btn-tg" href="https://t.me/${esc(bot)}">${ICON.tg}<span>Открыть @${esc(bot)}</span></a>
    </div>`;
    return;
  }

  window.addEventListener('hashchange', route);
  renderHeader();
  initFeed();
  route();
  // Telegram: take the newest progress of the device (cloud copy), then the game server; its first load imports that progress once
  function startGame(tries = 0) {
    api('load').then(d => {
      if (!d.ok) {
        if (tries < 4) return setTimeout(() => startGame(tries + 1), 1500 * (tries + 1));
        return toast('Не удалось загрузить профиль — перезапустите игру', 'error');
      }
      gameReady = true;
      U.inputs.clear(); U.inv.sel.clear();
      renderHeader(); route();
      tgLogin();
      scheduleTgPromo(5000);
      startStatsPing();
      refSync();
    });
  }
  startGame();

  // Keep the displayed wallet current when Telegram Stars settle or refunds
  // reverse game credits while this Mini App is already open. Always obtain
  // the authoritative server state; do not mutate a local wallet cache.
  let walletRefreshBusy = false;
  let walletRefreshAt = 0;
  function refreshAuthoritativeWallet() {
    if (!gameReady || document.hidden || walletRefreshBusy || releaseVisual ||
        Date.now() - walletRefreshAt < 12000) return;
    walletRefreshBusy = true;
    walletRefreshAt = Date.now();
    api('load').then(d => {
      if (!d.ok) return;
      // api('load') already applies state and renders the header.
      // Refresh the open wallet panel only if its route is active.
      if (curPath().startsWith('/wallet')) route();
    }).finally(() => { walletRefreshBusy = false; });
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshAuthoritativeWallet();
  });
  window.addEventListener('focus', refreshAuthoritativeWallet);
  setInterval(refreshAuthoritativeWallet, 30000);
  setInterval(() => { renderHeader(); scheduleTgPromo(0); }, 60e3);
})();
