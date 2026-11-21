/* =============================================
   LOHAS · 2026 年終感謝祭一頁式活動頁(yearend.html)
   --------------------------------------------
   - 預約:js/booking-v2.js 的 preset:"yearend"(頁內彈窗,不跳頁)
   - 門市照片、顧客評價:官網既有 API 的真實資料;讀不到整區隱藏
   - 人氣數字、顧客故事:🚨 只放真實資料(需求書要求不可虛構),填在下面 CONFIG
   - 追蹤:每個 [data-ye-cta] 點擊送 GA4 事件 yearend_cta
   ============================================= */
(function (root) {
  "use strict";

  const CONFIG = {
    /* Google Play(使用者 2026-11-21 提供)。空字串 = 不顯示 Google Play 按鈕 */
    appAndroid: "https://play.google.com/store/apps/details?id=com.lohasglasses.app&hl=zh_TW",
    /* 人氣數字:只填總部提供的真實數字,例如
       [{ num: "1,234", label: "人參與本次感謝祭" }, { num: "567", label: "張第二副折價券已兌換" }]
       null = 整區不顯示 */
    stats: null,
    /* 顧客故事:只放取得同意的真實顧客,例如
       [{ type: "穿搭型", title: "三副眼鏡輪流換", body: "…", photo: "images/yearend/story-1.jpg" }]
       null = 整區不顯示 */
    stories: null,
    reviewCount: 6
  };

  const $ = (s, el) => (el || document).querySelector(s);
  const esc = s => s == null ? "" : String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const track = (name, params) => { try { if (root.lohasTrack) root.lohasTrack(name, params || {}); } catch (_e) {} };

  let stores = [];        // 官網門市(正規化後)
  let regionKey = null;

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
    markSource(cta);
    root.LohasBookingV2.open(store
      ? { preset: "yearend", store: { erpid: store.erpid, name: store.name, address: store.address } }
      : { preset: "yearend" });
    return true;
  }

  document.addEventListener("click", e => {
    const cta = e.target.closest("[data-ye-cta]");
    if (cta) track("yearend_cta", { cta: cta.getAttribute("data-ye-cta") });

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

  /* ---------- APP ---------- */
  function initApp() {
    const a = $("[data-ye-app-android]");
    if (a && CONFIG.appAndroid) { a.href = CONFIG.appAndroid; a.hidden = false; }
    /* 手機自動辨識:Android 有連結時把 Google Play 排前面 */
    if (a && !a.hidden && /Android/i.test(navigator.userAgent)) a.parentNode.prepend(a);
  }

  /* ---------- 人氣數字、顧客故事(只放真實資料) ---------- */
  function initStatic() {
    let any = false;
    if (Array.isArray(CONFIG.stats) && CONFIG.stats.length) {
      const el = $("[data-ye-stats]");
      el.innerHTML = CONFIG.stats.map(s => `<div class="ye-stat"><b class="ye-pop">${esc(s.num)}</b><span>${esc(s.label)}</span></div>`).join("");
      el.hidden = false; any = true;
    }
    if (Array.isArray(CONFIG.stories) && CONFIG.stories.length) {
      const el = $("[data-ye-stories]");
      el.innerHTML = CONFIG.stories.map(s =>
        `<article class="ye-story">${s.photo ? `<img src="${esc(s.photo)}" alt="" loading="lazy">` : ""}` +
        `<div><em>${esc(s.type)}</em><h3>${esc(s.title)}</h3><p>${esc(s.body)}</p></div></article>`).join("");
      el.hidden = false; any = true;
    }
    if (any) $("#voice").hidden = false;
  }

  /* ---------- 門市:預約區的選門市 + 門市照片 ---------- */
  async function loadStores() {
    const A = root.LohasApi && root.LohasApi.store, D = root.LohasStore && root.LohasStore.data;
    if (!A || !D) return failStores();
    try {
      const raw = await A.getAllStores();
      stores = (raw || []).map(D.normalizeStore).filter(s => s && !s.isOverseas && s.erpid);
    } catch (_e) { stores = []; }
    if (!stores.length) return failStores();
    renderStorePicker();
    renderGallery();
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

  function renderGallery() {
    /* 每間店取第一張照片,挑有照片的店;第一張放大 */
    const withPhoto = stores.filter(s => s.photos && s.photos.length);
    if (withPhoto.length < 4) return;
    const pick = shuffle(withPhoto.slice()).slice(0, 7);
    $("[data-ye-gallery]").innerHTML = pick.map((s, i) =>
      `<figure class="ye-shot${i === 0 ? " ye-shot--big" : ""}"><img src="${esc(s.photos[0])}" alt="${esc(s.name)}門市" loading="lazy" onerror="this.closest('figure').remove()"><figcaption>${esc(s.name)}</figcaption></figure>`).join("");
    $("#stores").hidden = false;
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
    const sample = shuffle(emps).slice(0, 10);
    const res = await Promise.all(sample.map(({ e, store }) =>
      A.getEvaluationByEmployee(e.erpid, 20)
        .then(r => D.normalizeEvaluationResponse(r).evaluationList.map(v =>
          Object.assign({}, v, { store: store.name, content: String(v.content || "").replace(/\s+/g, " ").trim() })))
        .catch(() => [])));
    const all = [].concat(...res).filter(v =>
      v.score >= 5 && v.content && v.content.length >= 20 && v.content.length <= 180 &&
      !/https?:|www\.|\d{4}[-\s]?\d{3}[-\s]?\d{3}/i.test(v.content));
    if (!all.length) return;
    /* 跟「多副眼鏡、一起配」有關的優先,其餘補滿;同一間店最多兩則 */
    const ordered = shuffle(all.filter(v => PREFER.test(v.content))).concat(shuffle(all.filter(v => !PREFER.test(v.content))));
    /* 同一位客人常給同店好幾位顧問寫一樣的評價 → 內容相同的只留一則 */
    const perStore = new Map(), seen = new Set(), out = [];
    for (const v of ordered) {
      const n = perStore.get(v.store) || 0;
      const key = v.content.slice(0, 40);
      if (n >= 2 || seen.has(key)) continue;
      seen.add(key);
      perStore.set(v.store, n + 1); out.push(v);
      if (out.length >= CONFIG.reviewCount) break;
    }
    $("[data-ye-review-list]").innerHTML = out.map(v =>
      `<article class="ye-review"><div class="ye-review-stars" aria-label="5 顆星">★★★★★</div>` +
      `<p>${esc(v.content)}</p><small>${esc(maskName(v.memberName))} · ${esc(v.store)}</small></article>`).join("");
    $("[data-ye-reviews]").hidden = false;
    $("#voice").hidden = false;
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

  /* ---------- 啟動 ---------- */
  initApp();
  initStatic();
  track("yearend_view", {});
  /* 網址帶 #book 直接打開預約(廣告可以直接導到預約) */
  if (/^#book-now$/.test(location.hash)) setTimeout(() => openBooking(null, "book_hash"), 300);
  loadStores();
})(window);
