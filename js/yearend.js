/* =============================================
   LOHAS · 2026 年終感謝祭一頁式活動頁(yearend.html)
   --------------------------------------------
   - 預約:js/booking-v2.js 的 preset:"yearend"(頁內彈窗,不跳頁)
   - 門市照片、顧客評價:官網既有 API 的真實資料;讀不到整區隱藏
   - 人氣數字、顧客故事:🚨 只放真實資料(需求書要求不可虛構),填在下面 CONFIG
   - 詢問活動:先開「芽芽小幫手」預設問答(FAQ),看完再導 LINE
   - 好評浮窗:只輪播門市評價系統的真實 5 星評價,不寫時間、不編「誰剛配了」
   - 追蹤:每個 [data-ye-cta] 點擊送 GA4 事件 yearend_cta
   ============================================= */
(function (root) {
  "use strict";

  const CONFIG = {
    /* Google Play(使用者 2026-11-21 提供)。空字串 = 不顯示 Google Play 按鈕 */
    appAndroid: "https://play.google.com/store/apps/details?id=com.lohasglasses.app&hl=zh_TW",
    /* 門市評價系統的真實統計(2026-11-21 把在職 45 位顧問的評價全部讀出來加總:
       52,715 則,其中 5 星 52,182 則)。離職顧問的評價不在內,所以是「至少」。
       要更新就重算一次,改這裡的數字與日期。 */
    reviewStats: { total: 52715, five: 52182, asOf: "2026/11/21" },
    /* 本次活動參加人數:🚨 只填總部提供的真實數字(例 "1,234"),null = 不顯示 */
    joined: null,
    /* 顧客故事:只放取得同意的真實顧客,null = 不顯示 */
    stories: null,
    reviewCount: 10,
    line: "https://line.me/R/ti/p/@585ryopc"
  };

  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
  const esc = s => s == null ? "" : String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const track = (name, params) => { try { if (root.lohasTrack) root.lohasTrack(name, params || {}); } catch (_e) {} };
  const fmt = n => Number(n).toLocaleString("en-US");

  let stores = [];        // 官網門市(正規化後)
  let regionKey = null;
  let reviewPool = [];    // 真實 5 星評價(浮窗用)

  /* ---------- 按鈕 ---------- */
  function markSource(cta) {
    /* booking-v2 的 booking_complete 會帶上這筆(6 小時內有效),報表看得出預約來自感謝祭頁 */
    try {
      sessionStorage.setItem("lohas_booking_source", JSON.stringify({
        ts: Date.now(), news_id: "yearend-2026", news_title: "2026 年終感謝祭", cta_type: cta || "yearend"
      }));
    } catch (_e) {}
  }
  function openBooking(store, cta) {
    if (!root.LohasBookingV2) return false;
    closeChat();
    markSource(cta);
    root.LohasBookingV2.open(store
      ? { preset: "yearend", store: { erpid: store.erpid, name: store.name, address: store.address } }
      : { preset: "yearend" });
    return true;
  }

  document.addEventListener("click", e => {
    const cta = e.target.closest("[data-ye-cta]");
    if (cta) track("yearend_cta", { cta: cta.getAttribute("data-ye-cta") });

    const chat = e.target.closest("[data-ye-chat]");
    if (chat) { e.preventDefault(); openChat(chat.getAttribute("data-ye-cta")); return; }

    const book = e.target.closest("[data-ye-book]");
    if (book) { if (openBooking(null, book.getAttribute("data-ye-cta"))) e.preventDefault(); return; }

    const mine = e.target.closest("[data-ye-mine]");
    if (mine && root.LohasBookingV2) { e.preventDefault(); root.LohasBookingV2.open({ mine: true }); return; }

    const st = e.target.closest("[data-ye-store]");
    if (st) {
      const s = stores.find(x => x.erpid === st.getAttribute("data-ye-store"));
      track("yearend_cta", { cta: "book_store", store_id: s ? s.erpid : "" });
      if (s) openBooking(s, "book_store");
      return;
    }

    const rg = e.target.closest("[data-ye-region]");
    if (rg) { regionKey = rg.getAttribute("data-ye-region"); renderStorePicker(); }
  });

  /* ---------- 輪播:左右滑,沒滑就自己輪播 ----------
     原生橫向捲動 + scroll-snap(手指滑很順,不必自己算拖曳);
     自動播放在「看得到、沒人在操作、分頁沒切走」時才跑。 */
  function initSlider(sl) {
    if (sl._ye) return sl._ye.refresh();
    const track = $(".ye-track", sl), dots = $("[data-ye-dots]", sl);
    if (!track) return;
    let visible = false, pausedUntil = 0;
    const items = () => [...track.children];
    const step = () => { const it = items(); return it.length > 1 ? (it[1].offsetLeft - it[0].offsetLeft) : track.clientWidth || 1; };
    const perView = () => Math.max(1, Math.round(track.clientWidth / step()));
    const pages = () => Math.max(1, items().length - perView() + 1);
    const cur = () => Math.min(pages() - 1, Math.round(track.scrollLeft / step()));
    const pause = ms => { pausedUntil = Math.max(pausedUntil, Date.now() + (ms || 7000)); };
    function mark() { const c = cur(); [...dots.children].forEach((d, i) => d.classList.toggle("on", i === c)); }
    function refresh() {
      const n = pages();
      if (dots) dots.innerHTML = n > 1 ? Array.from({ length: n }, (_, i) => `<button type="button" aria-label="第 ${i + 1} 張"></button>`).join("") : "";
      sl.classList.toggle("ye-slider--static", n < 2);
      mark();
    }
    function go(i) { const n = pages(); i = ((i % n) + n) % n; track.scrollTo({ left: i * step(), behavior: "smooth" }); }
    track.addEventListener("scroll", () => { clearTimeout(track._t); track._t = setTimeout(mark, 60); }, { passive: true });
    if (dots) dots.addEventListener("click", e => { const b = e.target.closest("button"); if (b) { pause(); go([...dots.children].indexOf(b)); } });
    ["pointerdown", "touchstart", "wheel", "keydown"].forEach(ev => track.addEventListener(ev, () => pause(), { passive: true }));
    sl.addEventListener("mouseenter", () => pause(864e5));
    sl.addEventListener("mouseleave", () => { pausedUntil = Date.now() + 1500; });
    if ("IntersectionObserver" in root) new IntersectionObserver(es => { visible = es[0].isIntersecting; }, { threshold: 0.4 }).observe(sl);
    else visible = true;
    setInterval(() => {
      if (!visible || document.hidden || Date.now() < pausedUntil || pages() < 2) return;
      const c = cur(); go(c + 1 >= pages() ? 0 : c + 1);
    }, 3800);
    root.addEventListener("resize", () => { clearTimeout(sl._r); sl._r = setTimeout(refresh, 150); });
    sl._ye = { refresh };
    refresh();
  }
  const initSliders = () => $$("[data-ye-slider]").forEach(initSlider);

  /* ---------- APP ---------- */
  function initApp() {
    const a = $("[data-ye-app-android]");
    if (a && CONFIG.appAndroid) { a.href = CONFIG.appAndroid; a.hidden = false; }
    /* 手機自動辨識:Android 有連結時把 Google Play 排前面 */
    if (a && !a.hidden && /Android/i.test(navigator.userAgent)) a.parentNode.prepend(a);
  }

  /* ---------- 人氣數字(只放真實資料) ---------- */
  function renderStats() {
    /* 2026-11-22 使用者:只留「評價數」與「5 星比例」兩個數字(門市數、顧問數拿掉) */
    const list = [];
    const r = CONFIG.reviewStats;
    if (r && r.total) {
      list.push({ to: r.total, label: "則門市顧客評價" });
      list.push({ to: Math.floor(r.five / r.total * 100), suf: "%", label: "給了 5 星好評" });
    }
    if (!list.length) return;
    const el = $("[data-ye-stats]");
    /* 出處小字已拿掉(使用者 2026-11-21:「不用寫」);asOf 仍留在 CONFIG 供日後更新時對照 */
    el.innerHTML = list.map(s =>
      `<div class="ye-stat"><b class="ye-pop" data-to="${s.to}" data-suf="${esc(s.suf || "")}">${fmt(s.to)}${esc(s.suf || "")}</b><span>${esc(s.label)}</span></div>`).join("");
    el.hidden = false;
    $("#voice").hidden = false;
    countUp(el);
  }
  /* 數字從 0 跳到真實數字(使用者 2026-11-22:數字要會跳)。每次捲進畫面都重跳一次。
     🚨 終點一定是 CONFIG / 門市資料的真實數字,不做「一直往上加」的假即時計數 */
  function countUp(box) {
    const nums = $$("[data-to]", box);
    function run() {
      const t0 = performance.now(), dur = 1600;
      (function frame(t) {
        const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
        nums.forEach(n => { n.textContent = fmt(Math.round(Number(n.dataset.to) * e)) + n.dataset.suf; });
        if (p < 1) requestAnimationFrame(frame);
      })(t0);
    }
    if (!("IntersectionObserver" in root)) return;
    let inView = false;
    new IntersectionObserver(es => {
      const now = es[0].isIntersecting;
      if (now && !inView) run();
      inView = now;
    }, { threshold: 0.6 }).observe(box);
  }

  /* ---------- 全站 Cookie 提示條出現時,右下角按鈕、芽芽、好評浮窗一起往上讓 ----------
     提示條(#cookie-banner,layout.js 插入,z-index 10001)固定在畫面底部,會蓋住這些東西 */
  function syncCookieOffset() {
    const set = () => {
      const b = document.getElementById("cookie-banner");
      const h = b && b.classList.contains("show") && getComputedStyle(b).display !== "none" ? b.offsetHeight : 0;
      document.documentElement.style.setProperty("--ye-cookie", h + "px");
    };
    set();
    if (!("MutationObserver" in root)) return;
    /* 只盯提示條本身(芽芽每一格都在改 style,盯整個 body 會每一格都重算) */
    const watch = b => new MutationObserver(set).observe(b, { attributes: true, attributeFilter: ["class", "style"] });
    const b0 = document.getElementById("cookie-banner");
    if (b0) watch(b0);
    else {
      const mo = new MutationObserver(() => {
        const b = document.getElementById("cookie-banner");
        if (b) { mo.disconnect(); watch(b); set(); }
      });
      mo.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => mo.disconnect(), 15000);
    }
    root.addEventListener("resize", set);
  }

  /* ---------- 門市影片(2026-11-22 使用者提供) ----------
     [data-ye-autoplay]:捲到才下載、看得到才播(靜音循環),省廣告流量;
     [data-ye-video]:點了開視窗播放(有聲音) */
  function initVideos() {
    const auto = $$("video[data-ye-autoplay]");
    if ("IntersectionObserver" in root) {
      const io = new IntersectionObserver(es => es.forEach(en => {
        const v = en.target;
        if (en.isIntersecting) { const p = v.play(); if (p && p.catch) p.catch(() => {}); }
        else v.pause();
      }), { threshold: 0.3 });
      auto.forEach(v => io.observe(v));
    }
    const modal = $("[data-ye-vmodal]");
    if (!modal) return;
    const mv = $("[data-ye-vmodal-video]", modal);
    function close() {
      mv.pause(); modal.hidden = true;
      document.body.classList.remove("ye-chat-open");
    }
    document.addEventListener("click", e => {
      const b = e.target.closest("[data-ye-video]");
      if (b) {
        e.preventDefault();
        if (mv.getAttribute("src") !== b.getAttribute("data-ye-video")) mv.src = b.getAttribute("data-ye-video");
        modal.hidden = false;
        document.body.classList.add("ye-chat-open");   // 借用:芽芽、快捷鈕在開視窗時讓開
        mv.currentTime = 0;
        const p = mv.play(); if (p && p.catch) p.catch(() => {});
        return;
      }
      if (!modal.hidden && (e.target === modal || e.target.closest("[data-ye-vmodal-x]"))) close();
    });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !modal.hidden) close(); });
  }

  /* ---------- 快捷:回到最上面 / 跳到最下面 ---------- */
  function initJump() {
    const box = $("[data-ye-jump-box]");
    if (!box) return;
    const up = $('[data-ye-jump="top"]', box), down = $('[data-ye-jump="bottom"]', box);
    box.addEventListener("click", e => {
      const b = e.target.closest("[data-ye-jump]");
      if (!b) return;
      const top = b.getAttribute("data-ye-jump") === "top";
      track("yearend_cta", { cta: top ? "jump_top" : "jump_bottom" });
      root.scrollTo({ top: top ? 0 : document.documentElement.scrollHeight, behavior: "smooth" });
    });
    function sync() {
      const y = root.scrollY, max = document.documentElement.scrollHeight - root.innerHeight;
      up.classList.toggle("off", y < 400);
      down.classList.toggle("off", y > max - 400);
    }
    root.addEventListener("scroll", sync, { passive: true });
    root.addEventListener("resize", sync);
    sync();
  }

  /* ---------- 芽芽在畫面上走來走去、會講話(2026-11-22 使用者:像 App 那樣) ----------
     走到隨機位置 → 停一下 → 偶爾說一句(嘴巴開合)。點牠打開問答;× 收起(本次瀏覽不再出現)。
     🚨 台詞只用活動規則與頁面上已寫的事實。
     減少動態的裝置照樣走,只是走慢一點、不跳(同 heroParty 的考量:Windows 關動畫就會觸發) */
  const WALKER_OFF = "ye_walker_off";
  const YAYA_LINES = {
    why: ["生活不只一種風格,<b>眼鏡也是</b>～"],
    together: ["折價券<b>不限本人使用</b>,可以送給重要的人喔!"],
    offer: ["先完成第一副原價配鏡,就拿到 <b>2,680 元</b>折價券!", "第二副憑券折抵,符合方案條件 <b>0 元</b>!"],
    voice: ["這些都是門市顧客的<b>真實評價</b>喔～"],
    stores: ["<b>全台門市</b>都能用折價券!"],
    app: ["下載 APP,就能把我帶回家～"],
    book: ["選好門市,<b>一分鐘</b>完成預約!"],
    features: ["全館 <b>2,000 支以上</b>眼鏡任你挑!"],
    rules: ["活動到 <b>2027/1/31</b>,第二副折價券用到 <b>2/28</b> 喔"],
    _: ["有問題嗎?<b>點我</b>問活動～", "想知道第二副怎麼 0 元?<b>點我</b>!"]
  };
  function initWalker() {
    const w = $("[data-ye-walker]");
    if (!w) return;
    try { if (sessionStorage.getItem(WALKER_OFF)) return; } catch (_e) {}
    const say = $("[data-ye-walker-say]", w), text = $("[data-ye-walker-text]", w), mouth = $("[data-ye-walker-mouth]", w);
    const MOUTH = "https://lohas-pet.onrender.com/art/mouth.svg", MOUTH_OPEN = "https://lohas-pet.onrender.com/art/mouth_open.svg";
    new Image().src = MOUTH_OPEN;
    const calm = !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);
    /* x = 距離畫面左邊;y = 從「底線」往上抬多高(底線由 CSS 的 bottom 決定,已讓開手機按鈕列與 Cookie 條) */
    let x = 0, y = 0, tx = 0, ty = 0, idleUntil = 0, last = 0, stops = 0, talkTimer = 0, section = "_", lastLine = "";

    const size = () => w.offsetWidth || 96;
    const base = () => parseFloat(getComputedStyle(w).bottom) || 14;
    /* 2026-11-22 使用者:移動範圍變大 → 左右整個畫面、上下到畫面約一半高 */
    const bounds = () => ({ x0: 8, x1: Math.max(8, root.innerWidth - size() - 8), y0: 0, y1: Math.max(0, root.innerHeight * 0.5 - base()) });
    /* 芽芽在 (px,py) 時佔的畫面矩形 */
    const rectAt = (px, py) => { const s = size(), top = root.innerHeight - base() - py - s; return { l: px, t: top, r: px + s, b: top + s }; };
    const hit = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
    /* 要讓開的東西:好評浮窗(出現時)、右下角快捷鈕(使用者:不要被評價彈窗擋住) */
    function obstacles() {
      const out = [];
      const pad = 10;
      [$("[data-ye-toast]"), $("[data-ye-jump-box]")].forEach(el => {
        if (!el || el.hidden) return;
        if (el.matches("[data-ye-toast]") && !el.classList.contains("on")) return;
        const r = el.getBoundingClientRect();
        if (r.width) out.push({ l: r.left - pad, t: r.top - pad, r: r.right + pad, b: r.bottom + pad });
      });
      return out;
    }
    const blockedAt = (px, py) => { const me = rectAt(px, py); return obstacles().some(o => hit(me, o)); };
    function pickTarget() {
      const b = bounds();
      for (let i = 0; i < 30; i++) {
        const px = b.x0 + Math.random() * (b.x1 - b.x0);
        /* 多數時間在下半部走,偶爾跑高一點 */
        const py = b.y0 + Math.pow(Math.random(), 1.6) * (b.y1 - b.y0);
        if (!blockedAt(px, py)) { tx = px; ty = py; return; }
      }
      tx = b.x1 * 0.5; ty = b.y1 * 0.6;
    }

    /* 目前看到哪一區,講那一區的話 */
    if ("IntersectionObserver" in root) {
      const io = new IntersectionObserver(es => {
        es.forEach(en => { if (en.isIntersecting && YAYA_LINES[en.target.id]) section = en.target.id; });
      }, { threshold: 0.35 });
      Object.keys(YAYA_LINES).forEach(id => { const s = document.getElementById(id); if (s) io.observe(s); });
    }

    function talk() {
      const pool = (YAYA_LINES[section] || []).concat(YAYA_LINES._);
      let line = pool[(Math.random() * pool.length) | 0];
      if (line === lastLine && pool.length > 1) line = pool.find(l => l !== lastLine);
      lastLine = line;
      text.innerHTML = line;
      say.classList.add("on");
      placeSay();
      let open = false, n = 0;
      clearInterval(talkTimer);
      talkTimer = setInterval(() => {
        open = !open; mouth.src = open ? MOUTH_OPEN : MOUTH;
        if (++n > 12) { clearInterval(talkTimer); mouth.src = MOUTH; }
      }, 170);
      setTimeout(() => say.classList.remove("on"), 4800);
    }
    /* 對話框不超出畫面左右 */
    function placeSay() {
      const sw = say.offsetWidth, cx = x + size() / 2, vw = root.innerWidth;
      const left = Math.min(Math.max(cx - sw / 2, 8), vw - sw - 8);
      say.style.setProperty("--say-x", (left - x) + "px");
      say.style.left = "0";
    }
    function blocked() {
      return document.hidden || document.body.classList.contains("ye-chat-open") || document.body.style.overflow === "hidden";
    }
    function frame(t) {
      const dt = Math.min(0.05, (t - (last || t)) / 1000); last = t;
      w.classList.toggle("gone", blocked());
      if (!blocked()) {
        /* 好評浮窗剛跳出來、壓到芽芽 → 馬上換地方走開 */
        if (blockedAt(x, y) && blockedAt(tx, ty)) { pickTarget(); idleUntil = 0; }
        if (t < idleUntil) {
          w.classList.remove("walking");
        } else {
          const dx = tx - x, dy = ty - y, dist = Math.hypot(dx, dy), speed = calm ? 55 : 110;
          if (dist < 2) {
            idleUntil = t + 1500 + Math.random() * 2500;
            pickTarget();
            if (++stops % 2 === 1) talk();
          } else {
            const step = Math.min(dist, speed * dt);
            x += dx / dist * step; y += dy / dist * step;
            if (Math.abs(dx) > 1) w.classList.toggle("left", dx < 0);
            w.classList.toggle("walking", !calm);
          }
        }
        w.style.transform = `translate(${x}px, ${-y}px)`;
        if (say.classList.contains("on")) placeSay();
      }
      requestAnimationFrame(frame);
    }

    w.addEventListener("click", e => {
      if (e.target.closest("[data-ye-walker-x]")) {
        w.hidden = true;
        try { sessionStorage.setItem(WALKER_OFF, "1"); } catch (_e) {}
        track("yearend_cta", { cta: "yaya_walker_close" });
        return;
      }
      if (e.target.closest("[data-ye-walker-pet]")) openChat("yaya_walker");
    });
    root.addEventListener("resize", () => {
      const b = bounds();
      x = Math.min(Math.max(x, b.x0), b.x1); y = Math.min(Math.max(y, b.y0), b.y1);
      pickTarget();
    });

    /* 從畫面左邊走進來 */
    x = -size(); y = 0; idleUntil = 0;
    setTimeout(() => { w.hidden = false; pickTarget(); requestAnimationFrame(frame); setTimeout(talk, 1600); }, 2500);
  }
  function renderStories() {
    if (!Array.isArray(CONFIG.stories) || !CONFIG.stories.length) return;
    const el = $("[data-ye-stories]");
    el.innerHTML = CONFIG.stories.map(s =>
      `<article class="ye-story">${s.photo ? `<img src="${esc(s.photo)}" alt="" loading="lazy">` : ""}` +
      `<div><em>${esc(s.type)}</em><h3>${esc(s.title)}</h3><p>${esc(s.body)}</p></div></article>`).join("");
    el.hidden = false;
    $("#voice").hidden = false;
  }

  /* ---------- 門市:預約區的選門市 + 門市輪播 ---------- */
  async function loadStores() {
    const A = root.LohasApi && root.LohasApi.store, D = root.LohasStore && root.LohasStore.data;
    if (!A || !D) { renderStats(); return failStores(); }
    try {
      const raw = await A.getAllStores();
      stores = (raw || []).map(D.normalizeStore).filter(s => s && !s.isOverseas && s.erpid);
    } catch (_e) { stores = []; }
    renderStats();
    if (!stores.length) return failStores();
    renderStorePicker();
    renderStoreSlides();
    loadReviews(D, A);
  }
  function failStores() {
    const el = $("[data-ye-stores]");
    if (el) el.innerHTML = `<div class="ye-book-loading">門市清單暫時讀不到,請按下方「開始預約」在彈窗裡選門市</div>`;
  }

  function regionsOf() {
    const groups = new Map();
    stores.forEach(s => {
      const r = s.region || { order: 99, label: "其他", key: "other" };
      const k = r.order + "|" + r.label;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s);
    });
    return [...groups.entries()].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
      .map(([k, arr]) => ({ key: k, label: k.split("|")[1], stores: arr.sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name, "zh-Hant")) }));
  }
  function renderStorePicker() {
    const regions = regionsOf();
    if (!regions.length) return failStores();
    const cur = regions.find(r => r.key === regionKey) || regions[0];
    regionKey = cur.key;
    $("[data-ye-regions]").innerHTML = regions.map(r =>
      `<button type="button" class="ye-region ${r.key === cur.key ? "active" : ""}" role="tab" aria-selected="${r.key === cur.key}" data-ye-region="${esc(r.key)}">${esc(r.label)}</button>`).join("");
    $("[data-ye-stores]").innerHTML = cur.stores.map(s =>
      `<button type="button" class="ye-store" data-ye-store="${esc(s.erpid)}"><b>${esc(s.name)}</b>${s.address ? `<small>${esc(s.address)}</small>` : ""}</button>`).join("");
  }

  /* 到店看看:全部門市(使用者 2026-11-21:要放上所有門市),依地區順序 */
  function renderStoreSlides() {
    const list = regionsOf().flatMap(r => r.stores);
    if (!list.length) return;
    $("[data-ye-gallery]").innerHTML = list.map(s => {
      /* 永和店的 photos 是空陣列、只有 coverimage(2026-11-21 實測),沒照片就退回封面圖 */
      const photo = (s.photos && s.photos[0]) || s.coverimage;
      return `<article class="ye-shop">` +
          `<div class="ye-shop-photo">${photo ? `<img src="${esc(photo)}" alt="${esc(s.name)}門市" loading="lazy" onerror="this.remove()">` : ""}<i class="fa-solid fa-store" aria-hidden="true"></i>` +
            (s.region ? `<span>${esc(s.region.label)}</span>` : "") + `</div>` +
          `<div class="ye-shop-body"><h3>${esc(s.name)}</h3>${s.address ? `<p>${esc(s.address)}</p>` : ""}` +
            `<button type="button" class="ye-shop-btn" data-ye-store="${esc(s.erpid)}">預約這間 <i class="fa-solid fa-arrow-right"></i></button></div>` +
        `</article>`;
    }).join("");
    $("#stores").hidden = false;
    initSlider($("#stores [data-ye-slider]"));
  }

  /* ---------- 顧客評價(門市評價系統的真實評價) ---------- */
  const PREFER = /第二副|兩副|二副|多一副|家人|爸|媽|老公|老婆|先生|太太|男友|女友|另一半|朋友|小孩|孩子|搭配|穿搭|款式|風格/;
  async function loadReviews(D, A) {
    if (!A.getEvaluationByEmployee || !D.normalizeEvaluationResponse) return;
    const emps = [];
    stores.forEach(s => (s.employees || []).forEach(e => {
      /* 門市清單裡的 averageScore 是空的(2026-11-21 實測),不能拿來篩;改由下面只取 5 星評價 */
      if (e && e.erpid && !e.isLeave && !e.isFreeze && !e.isUnspecify) emps.push({ e, store: s });
    }));
    if (!emps.length) return;
    const sample = shuffle(emps).slice(0, 12);
    const res = await Promise.all(sample.map(({ e, store }) =>
      A.getEvaluationByEmployee(e.erpid, 20)
        .then(r => D.normalizeEvaluationResponse(r).evaluationList.map(v =>
          Object.assign({}, v, { store: store.name, content: String(v.content || "").replace(/\s+/g, " ").trim() })))
        .catch(() => [])));
    const all = [].concat(...res).filter(v =>
      v.score >= 5 && v.content && v.content.length >= 20 && v.content.length <= 180 &&
      !/https?:|www\.|\d{4}[-\s]?\d{3}[-\s]?\d{3}/i.test(v.content));
    if (!all.length) return;
    /* 跟「多副眼鏡、一起配」有關的優先,其餘補滿;同一間店最多兩則;
       同一位客人常給同店好幾位顧問寫一樣的評價 → 內容相同的只留一則 */
    const ordered = shuffle(all.filter(v => PREFER.test(v.content))).concat(shuffle(all.filter(v => !PREFER.test(v.content))));
    const perStore = new Map(), seen = new Set(), out = [];
    for (const v of ordered) {
      const key = v.content.slice(0, 40);
      if (seen.has(key)) continue;
      seen.add(key);
      reviewPool.push(v);
      const n = perStore.get(v.store) || 0;
      if (n >= 2 || out.length >= CONFIG.reviewCount) continue;
      perStore.set(v.store, n + 1); out.push(v);
    }
    /* 2026-11-22 使用者:評價卡不用輪播,而是一直隨機變換 → 固定 4 格,每隔幾秒隨機換掉其中一格 */
    const grid = $("[data-ye-review-list]");
    const SLOTS = 4;
    const cardHtml = v => `<div class="ye-review-stars" aria-label="5 顆星">★★★★★</div>` +
      `<p>${esc(v.content)}</p><small>${esc(maskName(v.memberName))} · ${esc(v.store)}</small>`;
    const shown = out.slice(0, SLOTS);
    grid.innerHTML = shown.map(v => `<article class="ye-review">${cardHtml(v)}</article>`).join("");
    $("[data-ye-reviews]").hidden = false;
    $("#voice").hidden = false;
    startToasts();

    if (reviewPool.length > SLOTS) {
      let visible = false, lastSlot = -1;
      if ("IntersectionObserver" in root) new IntersectionObserver(es => { visible = es[0].isIntersecting; }, { threshold: 0.3 }).observe(grid);
      else visible = true;
      setInterval(() => {
        if (!visible || document.hidden) return;
        let slot = Math.floor(Math.random() * SLOTS);
        if (slot === lastSlot) slot = (slot + 1) % SLOTS;
        lastSlot = slot;
        const onScreen = new Set(shown.map(v => v.content));
        const pick = shuffle(reviewPool.slice()).find(v => !onScreen.has(v.content));
        const card = grid.children[slot];
        if (!pick || !card) return;
        shown[slot] = pick;
        card.classList.add("out");
        setTimeout(() => { card.innerHTML = cardHtml(pick); card.classList.remove("out"); }, 350);
      }, 2600);
    }
  }
  function maskName(n) {
    n = String(n || "").trim();
    if (!n) return "門市顧客";
    return n.charAt(0) + "○○";
  }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  /* ---------- 好評浮窗(真實評價輪播) ----------
     🚨 不能寫「X 分鐘前」「誰剛配了」—— 我們沒有那種資料,寫了就是虛構。
     只說「某某給某店 5 星好評」+ 評價開頭,資料全來自門市評價系統。 */
  const TOAST_OFF = "ye_toast_off";
  function startToasts() {
    const el = $("[data-ye-toast]");
    if (!el || !reviewPool.length) return;
    try { if (sessionStorage.getItem(TOAST_OFF)) return; } catch (_e) {}
    const pool = shuffle(reviewPool.slice());
    let i = 0, shown = 0;
    el.addEventListener("click", e => {
      if (e.target.closest("[data-ye-toast-x]")) {
        el.classList.remove("on"); clearInterval(loop);
        try { sessionStorage.setItem(TOAST_OFF, "1"); } catch (_e) {}
      } else if (e.target.closest("[data-ye-toast-go]")) {
        const v = $("#voice"); if (v) v.scrollIntoView({ behavior: "smooth" });
      }
    });
    function show() {
      /* 預約彈窗、問答開著,或已經看到評價區時不打擾 */
      if (document.hidden || document.body.style.overflow === "hidden" || !$("[data-ye-chat-box]").hidden) return;
      const v = pool[i++ % pool.length];
      const snip = v.content.length > 34 ? v.content.slice(0, 34) + "…" : v.content;
      el.innerHTML =
        `<button type="button" class="ye-toast-x" data-ye-toast-x aria-label="關閉"><i class="fa-solid fa-xmark"></i></button>` +
        `<div class="ye-toast-body" data-ye-toast-go role="button" tabindex="0">` +
          `<span class="ye-toast-ico" aria-hidden="true">★</span>` +
          `<div><b>${esc(maskName(v.memberName))}</b> 給 <b>${esc(v.store)}</b> <span class="ye-toast-stars">★★★★★</span><br>` +
          `<small>「${esc(snip)}」</small></div></div>`;
      el.hidden = false;
      requestAnimationFrame(() => el.classList.add("on"));
      setTimeout(() => el.classList.remove("on"), 6500);
      if (++shown >= 10) clearInterval(loop);
    }
    const loop = setInterval(show, 16000);
    setTimeout(show, 7000);
  }

  /* ---------- 詢問活動:芽芽小幫手預設問答 ----------
     2026-11-21 使用者:「一上來就要加 LINE,大多會滑掉」→ 先讓客人點問題看答案,最後再導 LINE。
     🚨 答案只照活動規範寫(需求書第三、十節),不承諾規範以外的事;
     「配鏡要多久」「度數限制」沒有正式資料,先寫保守答案(使用者決定),有正式說法再改這裡。 */
  const FAQ = [
    { q: "可以兩個人一起配嗎?", a: () =>
      `可以!折價券<b>不限本人使用</b>。<br>先由一人完成第一副原價配鏡(指定全方案),就會拿到 2,680 元配鏡折價券,第二副可以給另一半、家人或朋友用,符合方案條件第二副 0 元。` },
    { q: "優惠是 2,680 就能拿到兩副嗎?", a: () =>
      `原價配鏡指定全方案,就送 <b>2,680 元配鏡折價券</b>;第二副憑券折抵,符合方案條件就是 0 元。<br>實際金額依你挑的方案而定,到店時顧問會幫你算清楚。` },
    { q: "第二副真的只要 0 元嗎?", a: () =>
      `符合方案條件就是 <b>0 元</b>!第二副全館鏡框任選(加價框除外);想升級鏡框、鏡片或方案,補差額就可以。` },
    { q: "可以升級功能嗎?", a: () =>
      `可以!鏡框、鏡片或方案都能升級,補差額即可。<br>功能性鏡片會依你的驗光結果和用眼習慣建議,現場驗光師會幫你挑。` },
    { q: "有多少款式可以挑?", a: () =>
      `全館 <b>2,000 支以上</b>的眼鏡任你挑!第二副一樣全館鏡框任選(加價框除外)。` },
    { q: "有哪些門市?", a: storeAnswer },
    { q: "配鏡要多久?", a: () =>
      `線上預約的配鏡時段約 <b>60 分鐘</b>(預約系統的配鏡項目)。<br>取件時間依鏡片與度數不同,驗光師會現場告訴你。建議先線上預約,到店不用等。` },
    { q: "度數有限制嗎?", a: () =>
      `能配哪種鏡片、適用哪個方案,要看驗光結果,到店由驗光師說明。<br>不確定的話,可以先加 LINE 問問看喔!` },
    { q: "活動到什麼時候?", a: () =>
      `活動期間 <b>2026/12/1 – 2027/1/31</b>;第二副折價券可以用到 <b>2027/2/28</b>。不得與其他優惠併用。` }
  ];
  function storeAnswer() {
    const regions = regionsOf();
    if (!regions.length) return `全台都有門市,可以到「門市據點」查看,或直接線上預約時選門市。`;
    return `全台 <b>${stores.length} 間門市</b>都能用折價券:<ul class="ye-chat-list">` +
      regions.map(r => `<li><b>${esc(r.label)}</b>${r.stores.map(s => esc(s.name.replace(/店$/, ""))).join("、")}</li>`).join("") + `</ul>`;
  }

  let chatAsked = new Set(), chatOpened = false;
  function chatBubble(html, who) {
    const log = $("[data-ye-chat-log]");
    const b = document.createElement("div");
    b.className = "ye-msg ye-msg--" + who;
    b.innerHTML = html;
    log.appendChild(b);
    log.scrollTop = log.scrollHeight;
    return b;
  }
  function chatChips() {
    const left = FAQ.filter(f => !chatAsked.has(f.q));
    const box = $("[data-ye-chat-chips]");
    box.innerHTML = left.map(f => `<button type="button" class="ye-chip" data-q="${esc(f.q)}">${esc(f.q)}</button>`).join("") +
      (chatAsked.size ? `<button type="button" class="ye-chip ye-chip--book" data-ye-book data-ye-cta="book_chat"><i class="fa-solid fa-calendar-check"></i> 直接預約到店</button>` : "");
  }
  function ask(q) {
    const f = FAQ.find(x => x.q === q);
    if (!f) return;
    chatAsked.add(q);
    track("yearend_chat_q", { q });
    chatBubble(esc(q), "me");
    $("[data-ye-chat-chips]").innerHTML = "";
    const typing = chatBubble(`<span class="ye-typing"><i></i><i></i><i></i></span>`, "bot");
    setTimeout(() => {
      typing.innerHTML = f.a();
      if (chatAsked.size === 2) {
        setTimeout(() => chatBubble(`還想知道更多?下面可以直接<b>預約到店</b>,或<b>加 LINE</b> 問真人顧問喔!`, "bot"), 500);
      }
      chatChips();
      const log = $("[data-ye-chat-log]"); log.scrollTop = log.scrollHeight;
    }, 650);
  }
  function openChat(from) {
    const box = $("[data-ye-chat-box]");
    if (!box) return root.open(CONFIG.line, "_blank", "noopener");
    box.hidden = false;
    document.body.classList.add("ye-chat-open");
    requestAnimationFrame(() => box.classList.add("on"));
    track("yearend_chat_open", { from: from || "" });
    if (!chatOpened) {
      chatOpened = true;
      chatBubble(`嗨!我是<b>芽芽</b> 👋<br>年終感謝祭有什麼想知道的?點下面的問題看看～`, "bot");
      chatChips();
    }
  }
  function closeChat() {
    const box = $("[data-ye-chat-box]");
    if (!box || box.hidden) return;
    box.classList.remove("on");
    document.body.classList.remove("ye-chat-open");
    setTimeout(() => { if (!box.classList.contains("on")) box.hidden = true; }, 220);
  }
  function initChat() {
    const box = $("[data-ye-chat-box]");
    if (!box) return;
    box.addEventListener("click", e => {
      if (e.target === box || e.target.closest("[data-ye-chat-close]")) return closeChat();
      const chip = e.target.closest(".ye-chip[data-q]");
      if (chip) ask(chip.getAttribute("data-q"));
    });
    document.addEventListener("keydown", e => { if (e.key === "Escape") closeChat(); });
  }

  /* ---------- 主視覺慶典彩帶(2026-11-21 使用者:hero 要動起來、要有慶典感) ----------
     進場先噴一波,之後保持少量飄落。只在主視覺看得到時才畫(IntersectionObserver),分頁切走也停。 */
  function heroParty() {
    const cv = $("[data-ye-party]");
    if (!cv || !cv.getContext) return;
    /* ⚠ 不因「減少動態」整個關掉:Windows 的「動畫效果」關閉就會觸發這個設定,
       使用者自己的電腦就是這樣(2026-11-21 實測),關掉等於大多數 Windows 訪客看不到。
       這些人改成量少、飄得慢 */
    const calm = !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const hero = cv.parentNode, ctx = cv.getContext("2d");
    const COLORS = ["#ffd23f", "#4fc1d6", "#f6a6b8", "#f08a24", "#ffffff", "#90d18f"];
    const dpr = Math.min(root.devicePixelRatio || 1, 2);
    let W = 0, H = 0, bits = [], visible = true, raf = 0, last = 0, drip = 0;

    function size() {
      W = hero.clientWidth; H = hero.clientHeight;
      cv.width = W * dpr; cv.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function bit(burst) {
      const s = W < 600 ? 0.8 : 1;
      return {
        x: burst ? W * (0.15 + Math.random() * 0.7) : Math.random() * W,
        y: burst ? -10 - Math.random() * H * 0.4 : -20,
        vx: (Math.random() - 0.5) * (burst ? 2.4 : 0.8),
        vy: (burst ? 1.6 : 0.9) + Math.random() * 1.6,
        w: (6 + Math.random() * 6) * s, h: (10 + Math.random() * 10) * s,
        r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.2,
        sway: Math.random() * Math.PI * 2,
        round: Math.random() < 0.3,
        c: COLORS[(Math.random() * COLORS.length) | 0]
      };
    }
    function tick(t) {
      raf = 0;
      if (!visible || document.hidden) return;
      const dt = Math.min(48, t - (last || t)) / 16.7; last = t;
      /* 平時每秒補約 4 片,手機少一點 */
      drip += dt;
      if (drip > (W < 600 ? 22 : 14) * (calm ? 2 : 1) && bits.length < 80) { bits.push(bit(false)); drip = 0; }
      ctx.clearRect(0, 0, W, H);
      bits = bits.filter(b => b.y < H + 30);
      for (const b of bits) {
        b.sway += 0.05 * dt;
        b.x += (b.vx + Math.sin(b.sway) * 0.6) * dt;
        b.y += b.vy * dt;
        b.r += b.vr * dt;
        ctx.save();
        ctx.translate(b.x, b.y); ctx.rotate(b.r);
        ctx.fillStyle = b.c;
        if (b.round) { ctx.beginPath(); ctx.arc(0, 0, b.w / 2, 0, Math.PI * 2); ctx.fill(); }
        else { ctx.scale(1, Math.cos(b.sway * 2)); ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); }
        ctx.restore();
      }
      raf = requestAnimationFrame(tick);
    }
    function go() { if (!raf && visible && !document.hidden) { last = 0; raf = requestAnimationFrame(tick); } }

    size();
    for (let i = 0; i < (W < 600 ? 70 : 140) * (calm ? 0.5 : 1); i++) bits.push(bit(true));   // 進場一波
    root.addEventListener("resize", size);
    document.addEventListener("visibilitychange", go);
    if ("IntersectionObserver" in root) {
      new IntersectionObserver(es => { visible = es[0].isIntersecting; go(); }).observe(hero);
    }
    go();
  }

  /* ---------- 啟動 ---------- */
  heroParty();
  initApp();
  initChat();
  initSliders();
  syncCookieOffset();
  initVideos();
  initJump();
  initWalker();
  renderStories();
  track("yearend_view", {});
  /* 網址帶 #book-now 直接打開預約、#ask 直接打開問答(廣告可以直接導到這兩個) */
  if (/^#book-now$/.test(location.hash)) setTimeout(() => openBooking(null, "book_hash"), 300);
  if (/^#ask$/.test(location.hash)) setTimeout(() => openChat("hash"), 300);
  loadStores();
})(window);
