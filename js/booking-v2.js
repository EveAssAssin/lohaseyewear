/* =============================================
   LOHAS · 門市預約(舊版介面 × 樂活自建預約系統)
   --------------------------------------------
   2026-11-11 建立。介面沿用左手時期的三步彈窗(顧問照片卡 → 時段 → 資料),
   資料改接樂活自建預約(市場部系統 market-backend 的 /api/booking/public)。

   比舊版多的:
   - 項目標出「約 N 分鐘」,含四個生日項目
   - 項目只列【這位人員】可服務的(每個人不一樣,分鐘數也不一樣)
   - 時段一次看一週,可切上一週 / 下一週,每天標出還有幾個時段
   - 沒登入 → 手機驗證碼;已登入 → 帶入姓名、會員編號、手機

   ⚠ 人員對應:官網的顧問資料(照片、職稱)用 erpid,預約系統用 app_number,
     兩邊唯一共同的欄位是【姓名】,所以用同門市內的姓名對。對不到的顧問
     不顯示(預約系統裡沒有他,約了也建不了單)。
   ⚠ 已登入會員免驗證手機(使用者 2026-11-11 指定):
     預約系統目前的身分【只認手機驗證碼】(串接文件 2026-11-10 第 8 節),
     所以要請 Louis 開一支「用官網登入換預約 token」的介面(MEMBER_EXCHANGE):
     官網送 lohasSessionToken → 預約系統拿去打我方 auth-session 的 verify
     (公開端點,回 erpid / mid / phone / name)→ 用那支手機簽一把 bk token。
     手機一定要由伺服器端從 token 取得 —— 前端說「我的手機是 09xx」不算驗證。
     那支介面上線前,已登入會員送出時會退回手機驗證(不會假裝成功)。
     沒綁定門市的會員,官網拿不到他的手機(上游 login 沒給),只能驗證一次。
   規格:桌面「預約系統_官網串接API_20261110.md」(Louis 提供,不進 repo)。

   對外:window.LohasBookingV2.open({ store, employees, preselectEmployeeErpId })
   ============================================= */

(function (root) {
  "use strict";

  /* 預覽用:本機會被對方的 CORS 擋,預覽伺服器在 /mbk 轉接 */
  const API = root.LOHAS_BK_API || "https://market-backend-0544.onrender.com/api/booking/public";
  /* 預覽模式:驗證碼與送出都是假的,不會真的建立預約、不會發簡訊 */
  const PREVIEW = !!root.LOHAS_BK_PREVIEW;

  const TOKEN_KEY = "bk_phone_token";   // 與預約系統自己的頁面同名,驗證一次兩邊通用
  /* 已登入會員換 token 的介面 —— ⚠ 名稱待 Louis 確定,上線前要對過 */
  const MEMBER_EXCHANGE = "/member-session";
  /* 那支介面上線了才改 true。false 時已登入會員照樣自動帶入,但手機要驗證一次
     (避免畫面寫「免驗證」、按送出才被要求驗證)。預覽模式一律當作已上線。 */
  const MEMBER_EXCHANGE_READY = false;
  const memberSkip = () => (MEMBER_EXCHANGE_READY || PREVIEW) && !!(state.member && memberPhone(state.member));
  const BIRTHDAY_RE = /^生日/;
  const ANY_LABEL = "不指定店員(最快有空)";

  const state = {
    open: false,
    step: 1,
    store: null,          // 官網的門市
    bkStore: null,        // 預約系統的門市(含門市層級項目)
    employees: [],        // 官網的顧問(照片)
    staff: [],            // 合併後:{ key, app, name, photo, role, honor, services[], any }
    loading: true,
    loadErr: "",
    maxDays: 45,
    selStaff: null,
    selSvc: null,
    weekFrom: null,       // yyyy-mm-dd
    days: null,           // 這一週
    daysLoading: false,
    selDay: null,
    selSlot: null,
    form: { name: "", phone: "", code: "", note: "", memberNo: "" },
    member: null,         // 官網登入的會員
    verifiedPhone: "",    // 手機驗證通過的號碼
    otp: { sent: false, busy: false, hint: "" },
    submitting: false,
    done: null
  };

  let rootEl = null;

  /* ---------- API ---------- */
  async function api(method, path, body) {
    const headers = { "Content-Type": "application/json" };
    const tk = readToken();
    if (tk) headers["x-bk-token"] = tk;
    const res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let j = {};
    try { j = await res.json(); } catch (_e) {}
    if (!res.ok || j.success === false) {
      const e = new Error(j.message || ("連線失敗(" + res.status + ")"));
      e.status = res.status;
      throw e;
    }
    return j.data;
  }
  const q = o => Object.entries(o).filter(([, v]) => v != null && v !== "").map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&");
  function readToken() { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (_e) { return ""; } }
  function saveToken(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (_e) {} }

  /* ---------- 日期(一律台北時間) ---------- */
  const W = ["日", "一", "二", "三", "四", "五", "六"];
  const tpeToday = () => new Date(Date.now() + 8 * 36e5).toISOString().slice(0, 10);
  const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
  const dow = d => new Date(d + "T00:00:00Z").getUTCDay();
  const md = d => { const [, m, dd] = d.split("-").map(Number); return m + "/" + dd; };
  const fmtDay = d => md(d) + "(週" + W[dow(d)] + ")";

  /* ---------- 會員 ---------- */
  /* 「有沒有登入」必須跟頁首(layout.js)用同一個判斷,否則頁首顯示已登入、預約卻說沒登入。
     2026-11-11 踩到:這裡原本自己加了 7 天過期,而 store.html 沒載 auth.js,
     頁首只看 lohasMember 在不在 —— 登入超過 7 天的會員就兩邊說法不一。 */
  function readMember() {
    try {
      const A = root.LohasAuth;
      if (A && A.isLogin && !A.isLogin()) return null;
      return JSON.parse(localStorage.getItem("lohasMember") || "null");
    } catch (_e) { return null; }
  }
  const memberPhone = m => String((m && (m.phone || m.mobile || m.memberPhone)) || "").replace(/\D/g, "");
  const memberNo = m => String((m && (m.erpid || m.memberNumber || m.mid)) || "");

  /* ---------- 開關 ---------- */
  async function open(opts) {
    opts = opts || {};
    Object.assign(state, {
      open: true, step: 1, store: opts.store || null, bkStore: null,
      employees: (opts.employees || []).filter(e => e && !e.isLeave && !e.isFreeze),
      staff: [], loading: true, loadErr: "", selStaff: null, selSvc: null,
      weekFrom: null, days: null, selDay: null, selSlot: null, submitting: false, done: null,
      otp: { sent: false, busy: false, hint: "" }
    });
    state.member = readMember();
    const m = state.member;
    state.form = {
      name: (m && m.name) || "",
      phone: memberPhone(m),
      code: "",
      note: "",
      memberNo: memberNo(m)
    };
    state.verifiedPhone = "";
    render();
    try { if (root.lohasTrack) root.lohasTrack("booking_open", { store: (state.store && state.store.erpid) || "" }); } catch (_e) {}

    try {
      const erp = String((state.store && state.store.erpid) || "");
      const [cfg, stores, staff] = await Promise.all([
        api("GET", "/config"),
        api("GET", "/stores").catch(() => []),
        api("GET", "/staff?" + q({ store: erp }))
      ]);
      if (cfg && cfg.max_days_ahead) state.maxDays = cfg.max_days_ahead;
      state.bkStore = (stores || []).find(s => String(s.store_erpid) === erp) || null;
      state.staff = mergeStaff(staff || []);
      if (cfg && cfg.enabled === false) state.loadErr = "線上預約暫停中,請直接致電門市。";
      /* 從某位顧問的「預約」進來 → 先選起來(項目仍要客人自己選)。
         用 staff-by-erp 換成預約系統的人員;換不到再退回姓名比對。 */
      if (opts.preselectEmployeeErpId) {
        let hit = null;
        try {
          const p = await api("GET", "/staff-by-erp?" + q({ erp: opts.preselectEmployeeErpId }));
          if (p && p.unspecified) hit = state.staff.find(s => s.any);
          else if (p && p.app_number) hit = state.staff.find(s => s.app === String(p.app_number));
        } catch (_e) { /* 404:沒開放預約 */ }
        if (!hit) {
          const e = state.employees.find(x => String(x.erpid) === String(opts.preselectEmployeeErpId));
          hit = e && state.staff.find(s => s.name === norm(e.name));
        }
        if (hit) state.selStaff = hit;
      }
      /* 之前在這台裝置驗證過手機 → 不必再驗一次 */
      if (readToken()) {
        try {
          const me = await api("GET", "/me");
          if (me && me.phone) {
            state.verifiedPhone = String(me.phone).replace(/\D/g, "");
            if (!state.form.phone) state.form.phone = state.verifiedPhone;
            if (!state.form.name && me.name) state.form.name = me.name;
          }
        } catch (_e) { saveToken(""); }
      }
    } catch (e) {
      state.loadErr = e.message || "讀取預約資料失敗";
    }
    state.loading = false;
    render();
  }
  function close() { state.open = false; render(); }

  const norm = s => String(s || "").replace(/\s+/g, "");

  /* 官網顧問(照片)× 預約系統人員(項目)— 用姓名對 */
  function mergeStaff(bkStaff) {
    const byName = new Map(state.employees.map(e => [norm(e.name), e]));
    /* 顯示的分鐘數一律用【門市】的(使用者 2026-11-11 指定)。
       人員各自的分鐘數在預約系統裡設得很亂(同一店配鏡 15 / 60、取件 105),
       客人看到會困惑。⚠ 這只改顯示:預約系統排時段與實際保留的長度
       仍是人員自己的設定(ownMinutes),要真的一致得在預約系統後台改。 */
    const storeMin = new Map(((state.bkStore && state.bkStore.services) || []).map(x => [x.name, x.minutes]));
    const withStoreMin = arr => arr.map(x => Object.assign({}, x, {
      ownMinutes: x.minutes,
      minutes: storeMin.has(x.name) ? storeMin.get(x.name) : x.minutes
    }));
    const list = bkStaff.map(s => {
      const e = byName.get(norm(s.name));
      const photo = e && e.photos && e.photos[0] && String(e.photos[0]).trim();
      return {
        key: "app:" + s.app_number,
        app: String(s.app_number),
        name: norm(s.name),
        photo: photo || "",
        role: e ? (e.role || e.jobtitle || "").trim() : "",
        honor: e ? (e.honor || "").trim() : "",
        services: sortSvc(withStoreMin(s.services || []))
      };
    });
    /* 不指定:用門市層級的項目,由門市安排人 */
    if (state.bkStore && (state.bkStore.services || []).length) {
      list.push({ key: "any", any: true, name: "不指定店員", role: "(最快有空)", photo: "", honor: "", services: sortSvc(state.bkStore.services) });
    }
    return list;
  }
  /* 一般項目在前、生日項目在後,各自保持原順序 */
  function sortSvc(arr) {
    return arr.filter(s => !BIRTHDAY_RE.test(s.name)).concat(arr.filter(s => BIRTHDAY_RE.test(s.name)));
  }

  /* ---------- 時段 ---------- */
  async function loadWeek(from) {
    state.weekFrom = from;
    state.daysLoading = true;
    state.days = null;
    state.selSlot = null;
    renderBody();
    const s = state.selStaff, svc = state.selSvc;
    const want = s.key + "|" + svc.id + "|" + from;
    try {
      const p = { service_id: svc.id, from, to: addDays(from, 6) };
      if (s.any) p.store = state.bkStore.store_erpid; else p.app = s.app;
      const data = await api("GET", "/slots?" + q(p));
      if (want !== state.selStaff.key + "|" + state.selSvc.id + "|" + state.weekFrom) return;   // 已換人/換項目/換週
      state.days = (data && data.days) || [];
      const keep = state.selDay && state.days.find(d => d.day === state.selDay && d.open && d.slots.length);
      if (!keep) {
        const first = state.days.find(d => d.open && d.slots.length);
        state.selDay = first ? first.day : (state.days[0] && state.days[0].day) || null;
      }
    } catch (e) {
      state.days = [];
      state.daysErr = e.message || "讀不到可預約時段";
    }
    state.daysLoading = false;
    renderBody();
  }

  /* ---------- 渲染 ---------- */
  function getRoot() {
    if (rootEl) return rootEl;
    rootEl = document.getElementById("lohas-booking-modal");
    if (!rootEl) { rootEl = document.createElement("div"); rootEl.id = "lohas-booking-modal"; document.body.appendChild(rootEl); }
    return rootEl;
  }

  function render() {
    const r = getRoot();
    if (!state.open) {
      const ov = r.querySelector(".bm-overlay");
      if (ov) ov.classList.remove("open");
      setTimeout(() => { if (!state.open) r.innerHTML = ""; }, 250);
      document.body.style.overflow = "";
      return;
    }
    document.body.style.overflow = "hidden";
    const fresh = !r.querySelector(".bm-overlay");
    const s = state.store;
    r.innerHTML =
      `<div class="bm-overlay${fresh ? "" : " open"}" data-overlay>` +
        `<div class="bm-dialog bk2">` +
          `<div class="bm-head"><div class="bm-head-info">` +
            `<span class="tag"><i class="fa-solid fa-bolt"></i> RESERVATION</span>` +
            `<h2>${s ? esc(s.name) + " · 線上預約" : "線上預約"}</h2>` +
            (s && s.address ? `<p>${esc(s.address)}</p>` : "") +
          `</div><button class="bm-close" data-close aria-label="關閉"><i class="fa-solid fa-xmark"></i></button></div>` +
          renderSteps() +
          `<div class="bm-body" data-body>${renderStep()}</div>` +
          renderFoot() +
        `</div>` +
      `</div>`;
    if (fresh) requestAnimationFrame(() => { const ov = r.querySelector(".bm-overlay"); if (ov) ov.classList.add("open"); });
    bind();
  }
  function renderBody() {
    const r = getRoot();
    const body = r.querySelector("[data-body]");
    if (!body) return render();
    const top = body.scrollTop;
    const steps = r.querySelector(".bm-steps");
    if (steps) steps.outerHTML = renderSteps();
    body.innerHTML = renderStep();
    body.scrollTop = top;
    const foot = r.querySelector(".bm-foot");
    if (foot) foot.outerHTML = renderFoot();
    bind();
  }

  function renderSteps() {
    if (state.done) return "";
    const steps = ["選顧問與項目", "選時段", "確認資料"];
    return `<div class="bm-steps">` + steps.map((t, i) => {
      const n = i + 1;
      const cls = state.step === n ? "active" : state.step > n ? "done" : "";
      return `<div class="bm-step ${cls}"><span class="bm-step-num">${state.step > n ? '<i class="fa-solid fa-check"></i>' : n}</span>${t}</div>`;
    }).join("") + `</div>`;
  }

  function renderStep() {
    if (state.done) return renderDone();
    if (state.loading) return stateBox(`<div class="spinner"></div>`, "載入預約資料中…");
    if (state.loadErr) return stateBox("", esc(state.loadErr), "請致電門市預約");
    if (state.step === 1) return renderStaffStep();
    if (state.step === 2) return renderTimeStep();
    return renderFormStep();
  }
  const stateBox = (icon, title, msg) =>
    `<div class="bm-state">${icon}<div class="bm-state-title">${title}</div>${msg ? `<div class="bm-state-msg">${msg}</div>` : ""}</div>`;

  /* 第 1 步:顧問(大頭像)+ 這位顧問的項目 */
  function renderStaffStep() {
    if (!state.staff.length) return stateBox("", "這間門市尚未開放線上預約", "請致電門市預約");
    const cards = state.staff.map(s => {
      const active = state.selStaff && state.selStaff.key === s.key;
      const photo = s.photo
        ? `<img src="${esc(s.photo)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><span class="bm-staff-pick-fallback" style="display:none"><i class="fa-regular fa-user"></i></span>`
        : `<span class="bm-staff-pick-fallback"><i class="fa-${s.any ? "solid fa-shuffle" : "regular fa-user"}"></i></span>`;
      return `<div class="bm-staff-pick ${active ? "active" : ""}${s.any ? " bk2-any" : ""}" data-staff="${esc(s.key)}" role="button" tabindex="0">` +
          `<div class="bm-staff-pick-photo${s.photo ? "" : " no-photo"}">${photo}</div>` +
          `<div class="bm-staff-pick-info">` +
            `<div class="bm-staff-pick-name">${esc(s.name)}</div>` +
            (s.role ? `<div class="bm-staff-pick-role">${esc(s.role)}</div>` : "") +
            (s.honor ? `<div class="bm-staff-pick-honor"><i class="fa-solid fa-medal"></i> ${esc(s.honor)}</div>` : "") +
            `<div class="bk2-staff-count">可預約 ${s.services.length} 項服務</div>` +
          `</div>` +
          `<div class="bm-staff-pick-check"><i class="fa-solid fa-check"></i></div>` +
        `</div>`;
    }).join("");
    return `<div class="bm-sec"><div class="bm-sec-title">選擇銷售顧問</div><div class="bm-staff-grid">${cards}</div></div>` +
      renderServices();
  }

  function renderServices() {
    const s = state.selStaff;
    let inner;
    if (!s) {
      inner = `<div class="bk2-hint">先選一位顧問,就會列出他可以服務的項目</div>`;
    } else {
      const normal = s.services.filter(x => !BIRTHDAY_RE.test(x.name));
      const bday = s.services.filter(x => BIRTHDAY_RE.test(x.name));
      const chip = x => {
        const active = state.selSvc && state.selSvc.id === x.id;
        return `<button type="button" class="bm-svc-pick bk2-svc ${active ? "active" : ""}" data-svc="${x.id}">` +
            `<span class="bk2-svc-name">${esc(x.name)}</span>` +
            `<span class="bk2-svc-min"><i class="fa-regular fa-clock"></i> 約 ${Number(x.minutes) || "—"} 分鐘</span>` +
          `</button>`;
      };
      inner = (normal.length ? `<div class="bm-svc-grid">${normal.map(chip).join("")}</div>` : "") +
        (bday.length
          ? `<div class="bk2-svc-group"><i class="fa-solid fa-cake-candles"></i> 生日月專屬</div><div class="bm-svc-grid bk2-bday">${bday.map(chip).join("")}</div>`
          : "");
      if (!s.services.length) inner = `<div class="bk2-hint">這位顧問目前沒有開放線上預約的項目</div>`;
    }
    return `<div class="bm-sec"><div class="bm-sec-title">預約服務項目 <span class="bm-required">*</span>` +
      (s ? `<span class="bk2-sec-sub">${esc(s.any ? "門市" : s.name)}可服務的項目</span>` : "") +
      `</div>${inner}</div>`;
  }

  /* 第 2 步:一次一週 */
  function renderTimeStep() {
    const today = tpeToday();
    const last = addDays(today, state.maxDays - 1);
    const from = state.weekFrom || today;
    const to = addDays(from, 6);
    const canPrev = from > today;
    const canNext = addDays(from, 7) <= last;
    const nav =
      `<div class="bk2-week">` +
        `<button type="button" class="bk2-week-btn" data-week="-1" ${canPrev ? "" : "disabled"}><i class="fa-solid fa-chevron-left"></i> 上一週</button>` +
        `<div class="bk2-week-range">${md(from)} – ${md(to)}</div>` +
        `<button type="button" class="bk2-week-btn" data-week="1" ${canNext ? "" : "disabled"}>下一週 <i class="fa-solid fa-chevron-right"></i></button>` +
      `</div>`;
    const svcLine = `<div class="bk2-picked"><b>${esc(state.selStaff.any ? ANY_LABEL : state.selStaff.name)}</b> · ${esc(state.selSvc.name)} · 約 ${state.selSvc.minutes} 分鐘</div>`;

    if (state.daysLoading || !state.days) {
      return svcLine + `<div class="bm-sec"><div class="bm-sec-title">選擇日期</div>${nav}</div>` + stateBox(`<div class="spinner"></div>`, "載入可預約時段中");
    }
    const dayChips = state.days.map(d => {
      const n = d.open ? d.slots.length : 0;
      const off = !d.open || !n;
      const label = !d.open ? esc(shortReason(d.reason_text)) : n ? `${n} 個時段` : "額滿";
      const active = state.selDay === d.day;
      return `<div class="bm-date-pick bk2-day ${active ? "active" : ""} ${off ? "full" : ""}" data-day="${d.day}">` +
          `<div class="dw">${d.day === today ? "今天" : "週" + W[dow(d.day)]}</div>` +
          `<div class="dn">${md(d.day)}</div>` +
          `<div class="da">${label}</div>` +
        `</div>`;
    }).join("");
    const day = state.days.find(d => d.day === state.selDay);
    const slots = day && day.open ? day.slots : [];
    const total = state.days.reduce((a, d) => a + (d.open ? d.slots.length : 0), 0);
    const grid = slots.length
      ? `<div class="bm-time-grid">` + slots.map(s => {
          const active = state.selSlot && state.selSlot.start === s.start;
          return `<button type="button" class="bm-time-pick ${active ? "active" : ""}" data-slot="${esc(s.start)}">${esc(s.label)}</button>`;
        }).join("") + `</div>`
      : `<div class="bk2-hint">${total ? "這一天沒有可預約的時段,請選其他日期" : "這一週都約滿了,請看下一週"}</div>`;
    return svcLine +
      `<div class="bm-sec"><div class="bm-sec-title">選擇日期</div>${nav}<div class="bk2-days">${dayChips}</div></div>` +
      `<div class="bm-sec"><div class="bm-sec-title">選擇時段${day ? `(${fmtDay(day.day)}・${slots.length} 個)` : ""}</div>${grid}</div>`;
  }
  const shortReason = t => { t = String(t || "休息"); return /不開放|休/.test(t) ? "休" : t.length > 4 ? t.slice(0, 4) : t; };

  /* 第 3 步:確認 + 身分 */
  function renderFormStep() {
    const s = state.selStaff, svc = state.selSvc, slot = state.selSlot;
    const f = state.form;
    const summary =
      `<div class="bk2-summary">` +
        row("門市", esc(state.store ? state.store.name : (state.bkStore && state.bkStore.store_name) || "")) +
        row("顧問", esc(s.any ? ANY_LABEL : s.name)) +
        row("項目", `${esc(svc.name)} <span class="bk2-muted">約 ${svc.minutes} 分鐘</span>`) +
        row("時間", `<b>${fmtDay(state.selDay)} ${esc(slot.label)}</b>`) +
      `</div>`;

    const m = state.member;
    let who;
    if (memberSkip()) {
      who =
        `<div class="bk2-member"><i class="fa-solid fa-circle-check"></i> 已登入會員,資料已自動帶入,免手機驗證</div>` +
        input("姓名", "name", f.name, "怎麼稱呼你") +
        (f.memberNo ? input("會員編號", "memberNo", f.memberNo, "", "text", true) : "") +
        input("手機號碼", "phone", memberPhone(m), "", "tel", true);
    } else if (m) {
      /* 已登入但不能免驗證:官網沒有他的手機(還沒綁定門市),或換 token 的介面還沒上線 */
      who =
        `<div class="bk2-member"><i class="fa-solid fa-circle-check"></i> 已登入會員,資料已自動帶入</div>` +
        input("姓名", "name", f.name, "怎麼稱呼你") +
        (f.memberNo ? input("會員編號", "memberNo", f.memberNo, "", "text", true) : "") +
        phoneOtp() +
        (state.verifiedPhone ? "" : `<div class="bk2-login">${memberPhone(m) ? "第一次預約請驗證手機一次,之後 30 天內免驗證" : "會員資料裡還沒有手機,這次需要驗證一次"}</div>`);
    } else {
      who =
        input("姓名", "name", f.name, "怎麼稱呼你") +
        phoneOtp() +
        `<div class="bk2-login">已經是會員?<a href="login.html" data-login>登入</a>後自動帶入資料</div>`;
    }
    return `<div class="bm-sec"><div class="bm-sec-title">預約內容</div>${summary}</div>` +
      `<div class="bm-sec"><div class="bm-sec-title">預約人資料</div>${who}</div>` +
      `<div class="bm-sec"><div class="bm-sec-title">想先告訴門市的事(選填)</div>` +
        `<div class="bm-form-row"><textarea data-f="note" placeholder="例如:想看漸進鏡片、上次的眼鏡要調整">${esc(f.note)}</textarea></div></div>`;
  }
  const row = (k, v) => `<div class="bk2-sum-row"><span>${k}</span><span>${v}</span></div>`;
  function input(label, key, val, ph, type, ro) {
    return `<div class="bm-form-row"><label>${label}</label>` +
      `<input type="${type || "text"}" data-f="${key}" value="${esc(val)}" placeholder="${ph || ""}"${ro ? ' readonly class="bk2-ro"' : ""}${type === "tel" ? ' inputmode="numeric"' : ""}></div>`;
  }
  function phoneOtp() {
    const f = state.form;
    const ok = state.verifiedPhone && state.verifiedPhone === f.phone.replace(/\D/g, "");
    if (ok) {
      return `<div class="bm-form-row"><label>手機號碼</label>` +
        `<div class="bk2-verified"><span><i class="fa-solid fa-circle-check"></i> ${esc(state.verifiedPhone)} 已驗證</span>` +
        `<button type="button" class="bm-link" data-rephone>換一支手機</button></div></div>`;
    }
    return `<div class="bm-form-row"><label>手機號碼(會收到驗證碼)</label>` +
        `<div class="bk2-otp"><input type="tel" inputmode="numeric" data-f="phone" value="${esc(f.phone)}" placeholder="09xxxxxxxx">` +
        `<button type="button" class="bm-btn ghost" data-otp-send ${state.otp.busy ? "disabled" : ""}>${state.otp.sent ? "重寄" : "寄驗證碼"}</button></div></div>` +
      (state.otp.sent
        ? `<div class="bm-form-row"><label>驗證碼</label><div class="bk2-otp">` +
            `<input type="tel" inputmode="numeric" data-f="code" value="${esc(f.code)}" placeholder="6 位數驗證碼" maxlength="6">` +
            `<button type="button" class="bm-btn primary" data-otp-verify>確認</button></div>` +
            (state.otp.hint ? `<div class="bk2-otp-hint">${esc(state.otp.hint)}</div>` : "") + `</div>`
        : "");
  }

  function renderDone() {
    const d = state.done;
    return `<div class="bm-success">` +
      `<div class="bm-success-icon"><i class="fa-solid fa-check"></i></div>` +
      `<div class="bm-success-title">預約完成</div>` +
      `<div class="bm-success-msg">前一天會再傳簡訊提醒您。要改時間或取消,請到「我的預約」或致電門市。</div>` +
      `<div class="bm-success-detail">` +
        `<div>門市:<b>${esc(d.store_name || (state.store && state.store.name) || "")}</b></div>` +
        `<div>顧問:<b>${esc(state.selStaff.any ? ANY_LABEL : (d.staff_name || state.selStaff.name))}</b></div>` +
        `<div>項目:<b>${esc(d.service_name || state.selSvc.name)}</b>(約 ${state.selSvc.minutes} 分鐘)</div>` +
        `<div>時間:<b>${fmtDay(state.selDay)} ${esc(state.selSlot.label)}</b></div>` +
      `</div></div>`;
  }

  function renderFoot() {
    if (state.done) {
      return `<div class="bm-foot"><div class="bm-foot-summary"><b>感謝您的預約</b>期待在門市見到您</div>` +
        `<div class="bm-foot-actions"><a class="bm-btn ghost" href="${API.replace(/\/api\/booking\/public$/, "").replace("market-backend-0544", "market-frontend-qz17")}/book?src=web" target="_blank" rel="noopener" data-mine>我的預約</a>` +
        `<button class="bm-btn primary" data-close>完成</button></div></div>`;
    }
    if (state.loading || state.loadErr) return "";
    const ok = canNext();
    let hint;
    if (state.step === 1) hint = !state.selStaff ? "<b>請先選擇一位顧問</b>" : !state.selSvc ? "<b>請選擇預約服務項目</b>" : `<b>${esc(state.selSvc.name)}</b>約 ${state.selSvc.minutes} 分鐘・按「下一步」挑時段`;
    else if (state.step === 2) hint = state.selSlot ? `<b>${fmtDay(state.selDay)} ${esc(state.selSlot.label)}</b>${esc(state.selSvc.name)}・約 ${state.selSvc.minutes} 分鐘` : "<b>請選擇預約時段</b>可切換上一週 / 下一週";
    else hint = identityOk() ? "<b>資料確認無誤</b>按「確認預約」送出" : "<b>請填姓名並完成手機驗證</b>";
    return `<div class="bm-foot"><div class="bm-foot-summary">${hint}</div><div class="bm-foot-actions">` +
      (state.step > 1 ? `<button class="bm-btn ghost" data-prev>上一步</button>` : "") +
      (state.step < 3
        ? `<button class="bm-btn primary" data-next ${ok ? "" : "disabled"}>下一步 <i class="fa-solid fa-arrow-right"></i></button>`
        : `<button class="bm-btn primary" data-submit ${ok && !state.submitting ? "" : "disabled"}>${state.submitting ? '<i class="fa-solid fa-spinner fa-spin"></i> 送出中…' : '確認預約 <i class="fa-solid fa-check"></i>'}</button>`) +
      `</div></div>`;
  }

  function identityOk() {
    const f = state.form;
    if (!f.name.trim()) return false;
    if (memberSkip()) return true;   // 已登入且有手機:免驗證
    return !!state.verifiedPhone && state.verifiedPhone === f.phone.replace(/\D/g, "");
  }
  function canNext() {
    if (state.step === 1) return !!(state.selStaff && state.selSvc);
    if (state.step === 2) return !!state.selSlot;
    return identityOk();
  }

  /* ---------- 事件 ---------- */
  function bind() {
    const r = getRoot();
    const on = (sel, fn, ev) => r.querySelectorAll(sel).forEach(el => el.addEventListener(ev || "click", e => fn(el, e)));
    on("[data-overlay]", (el, e) => { if (e.target === el && state.done) close(); });
    on("[data-close]", () => close());

    on("[data-staff]", el => {
      const s = state.staff.find(x => x.key === el.dataset.staff);
      if (!s) return;
      if (!state.selStaff || state.selStaff.key !== s.key) {
        state.selStaff = s;
        /* 換人:同名項目還在就保留(分鐘數換成這個人的),沒有就清掉 */
        state.selSvc = state.selSvc ? (s.services.find(x => x.name === state.selSvc.name) || null) : null;
        state.days = null; state.selSlot = null;
      }
      renderBody();
    });
    on("[data-svc]", el => {
      const svc = state.selStaff && state.selStaff.services.find(x => String(x.id) === el.dataset.svc);
      if (!svc) return;
      state.selSvc = svc; state.days = null; state.selSlot = null;
      renderBody();
    });
    on("[data-week]", el => {
      const n = Number(el.dataset.week);
      let from = addDays(state.weekFrom || tpeToday(), n * 7);
      if (from < tpeToday()) from = tpeToday();
      loadWeek(from);
    });
    on("[data-day]", el => {
      if (el.classList.contains("full")) return;
      state.selDay = el.dataset.day; state.selSlot = null;
      renderBody();
    });
    on("[data-slot]", el => {
      const day = state.days && state.days.find(d => d.day === state.selDay);
      state.selSlot = day && day.slots.find(s => s.start === el.dataset.slot) || null;
      renderBody();
    });
    on("[data-f]", el => {
      state.form[el.dataset.f] = el.value;
      const foot = r.querySelector(".bm-foot");
      if (foot) { foot.outerHTML = renderFoot(); bindFoot(); }
    }, "input");
    on("[data-otp-send]", () => sendOtp());
    on("[data-otp-verify]", () => verifyOtp());
    on("[data-rephone]", () => { state.verifiedPhone = ""; saveToken(""); state.otp = { sent: false, busy: false, hint: "" }; renderBody(); });
    on("[data-login]", (el, e) => {
      try { localStorage.setItem("redirectAfterLogin", location.pathname.split("/").pop() + location.search + "#staff"); } catch (_e) {}
    });
    bindFoot();
  }
  function bindFoot() {
    const r = getRoot();
    const b = (sel, fn) => { const el = r.querySelector(sel); if (el) el.addEventListener("click", fn); };
    b(".bm-foot [data-close]", close);
    b("[data-prev]", () => { state.step = Math.max(1, state.step - 1); renderBody(); });
    b("[data-next]", () => {
      if (!canNext()) return;
      state.step++;
      if (state.step === 2 && !state.days) loadWeek(state.weekFrom && state.weekFrom >= tpeToday() ? state.weekFrom : tpeToday());
      else renderBody();
    });
    b("[data-submit]", submit);
  }

  /* ---------- 手機驗證 ---------- */
  async function sendOtp() {
    const phone = state.form.phone.replace(/\D/g, "");
    if (!/^09\d{8}$/.test(phone)) return alert("請輸入手機號碼(09 開頭 10 碼)");
    state.otp.busy = true; renderBody();
    try {
      if (PREVIEW) {
        state.otp = { sent: true, busy: false, hint: "(預覽模式:不會真的發簡訊,輸入任意 6 碼即可)" };
      } else {
        const d = await api("POST", "/otp/send", { phone });
        state.otp = { sent: true, busy: false, hint: d && d.test_code ? "(測試驗證碼:" + d.test_code + ")" : "驗證碼已寄出,請查看簡訊" };
      }
    } catch (e) {
      state.otp.busy = false;
      alert(e.message || "驗證碼寄送失敗");
    }
    renderBody();
  }
  async function verifyOtp() {
    const phone = state.form.phone.replace(/\D/g, "");
    const code = state.form.code.trim();
    if (!/^\d{4,6}$/.test(code)) return alert("請輸入簡訊裡的驗證碼");
    try {
      if (PREVIEW) {
        state.verifiedPhone = phone;
      } else {
        const d = await api("POST", "/otp/verify", { phone, code });
        saveToken(d.token);
        state.verifiedPhone = String(d.phone || phone).replace(/\D/g, "");
      }
      renderBody();
    } catch (e) { alert(e.message || "驗證失敗"); }
  }

  /* ---------- 送出 ---------- */
  async function submit() {
    if (state.submitting || !canNext()) return;
    const s = state.selStaff, svc = state.selSvc;
    /* 已登入會員:用官網登入換一把預約 token(伺服器端驗身分與取手機) */
    if (!PREVIEW && !readToken() && memberSkip()) {
      try {
        const sess = (root.LohasAuth && root.LohasAuth.getToken && root.LohasAuth.getToken()) ||
                     localStorage.getItem("lohasSessionToken") || "";
        const d = await api("POST", MEMBER_EXCHANGE, { token: sess });
        if (d && d.token) saveToken(d.token);
      } catch (_e) { /* 介面還沒上線或登入過期 → 下面退回手機驗證 */ }
    }
    if (!PREVIEW && !readToken()) {
      state.verifiedPhone = "";
      state.member = null;   // 退回手機驗證畫面,不假裝成功
      alert("請先完成手機驗證");
      return renderBody();
    }
    state.submitting = true; renderBody();
    try {
      const noteLines = [];
      if (state.form.memberNo) noteLines.push("會員編號:" + state.form.memberNo);
      if (state.form.note.trim()) noteLines.push(state.form.note.trim());
      const body = { service_id: svc.id, start_at: state.selSlot.start, name: state.form.name.trim(), note: noteLines.join("\n"), source: "web" };
      if (s.any) body.store = state.bkStore.store_erpid; else body.app = s.app;
      let res;
      if (PREVIEW) {
        console.log("[booking-v2] 預覽模式,不送出:", body);
        await new Promise(r => setTimeout(r, 600));
        res = { id: "PREVIEW" };
      } else {
        res = await api("POST", "/bookings", body);
      }
      state.done = res || {};
      track(res);
    } catch (e) {
      alert(e.message || "預約失敗,請再試一次");
      if (e.status === 409) { state.step = 2; state.submitting = false; return loadWeek(state.weekFrom); }
      if (e.status === 401) { saveToken(""); state.verifiedPhone = ""; }
    }
    state.submitting = false;
    renderBody();
  }

  /* GA4 / Meta / OpenAI 的預約轉換 —— 與舊彈窗同一個事件名,報表不必改 */
  function track(res) {
    if (PREVIEW) return;
    try {
      let src = {};
      try {
        const p = JSON.parse(sessionStorage.getItem("lohas_booking_source") || "null");
        if (p && p.ts && Date.now() - p.ts < 6 * 36e5) src = p;
      } catch (_e) {}
      const params = {
        reservation_id: (res && res.id) || "",
        store_id: (state.store && state.store.erpid) || "",
        store_name: (state.store && state.store.name) || "",
        item_type: state.selSvc.name,
        source_news_id: src.news_id || "",
        source_news_title: src.news_title || "",
        source_cta_type: src.cta_type || ""
      };
      if (root.lohasTrack) root.lohasTrack("booking_complete", params);
      else { root.dataLayer = root.dataLayer || []; root.dataLayer.push(Object.assign({ event: "booking_complete" }, params)); }
      if (typeof root.oaiq === "function") root.oaiq("measure", "appointment_scheduled", { type: "customer_action" });
      try { sessionStorage.removeItem("lohas_booking_source"); } catch (_e) {}
    } catch (e) { console.error("[booking-v2] 追蹤失敗", e); }
  }

  function esc(s) {
    return s == null ? "" : String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  root.LohasBookingV2 = { open, close };
})(window);
