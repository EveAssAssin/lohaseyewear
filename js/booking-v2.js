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
   - 「我的預約」:手機驗證後列出預約,可取消(2026-11-12)

   三種用法(同一套畫面):
   - 門市頁:open({ store, employees, preselectEmployeeErpId })
   - 大學生專案(student.html):open({ student: true })
       多一個「選門市」;項目固定為該店的「配鏡」,畫面顯示「學生配鏡」,
       留言第一行自動加【大學生專案】讓門市知道。預約系統沒有「學生配鏡」項目,
       Louis 加了之後改 STUDENT_SVC 的比對就好。
       不收身分證字號(使用者 2026-11-12 決定):資格與一人一次由門市看學生證確認。
   - 我的預約:open({ mine: true })

   ⚠ 人員對應:官網的顧問資料(照片、職稱)用 erpid,預約系統用 app_number,
     兩邊唯一共同的欄位是【姓名】,所以用同門市內的姓名對。
   ⚠ 已登入會員免驗證手機(使用者 2026-11-11 指定):
     預約系統目前的身分【只認手機驗證碼】(串接文件 2026-11-10 第 8 節),
     所以要請 Louis 開一支「用官網登入換預約 token」的介面(MEMBER_EXCHANGE):
     官網送 lohasSessionToken → 預約系統拿去打我方 auth-session 的 verify
     (公開端點,回 erpid / mid / phone / name)→ 用那支手機簽一把 bk token。
     手機一定要由伺服器端從 token 取得 —— 前端說「我的手機是 09xx」不算驗證。
     那支介面上線前,已登入會員送出時會退回手機驗證(不會假裝成功)。
     沒綁定門市的會員,官網拿不到他的手機(上游 login 沒給),只能驗證一次。
   規格:桌面「預約系統_官網串接API_20261110.md」(Louis 提供,不進 repo)。
   ============================================= */

(function (root) {
  "use strict";

  /* 預覽用:本機會被對方的 CORS 擋,預覽伺服器在 /mbk 轉接 */
  const API = root.LOHAS_BK_API || "https://market-backend-0544.onrender.com/api/booking/public";
  /* 預覽模式:驗證碼、送出、取消都是假的,不會真的建立預約、不會發簡訊 */
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
  /* 大學生專案用哪一個項目:目前是各店的「配鏡」(預約系統沒有學生專用項目) */
  const STUDENT_SVC = name => /^配鏡/.test(String(name || ""));
  const STUDENT_LABEL = "學生配鏡";
  const STUDENT_NOTE = "【大學生專案】學生配鏡(到店出示學生證或在學證明)";

  const STATUS = {
    booked: "已預約", arrived: "已到店", done: "已完成",
    no_show: "未到", cancelled: "已取消", moved: "已改期"
  };

  const state = {
    open: false,
    mode: "book",         // book | mine
    student: false,
    step: 1,
    store: null,          // 官網的門市(門市頁傳入;學生模式選了才有)
    bkStore: null,        // 預約系統的門市(含門市層級項目)
    bkStores: [],         // 預約系統全部門市(學生模式選門市用)
    siteStores: [],       // 官網門市資料(地區、地址;學生模式選門市用,讀不到就算了)
    employees: [],        // 官網的顧問(照片)
    staff: [],            // 合併後:{ key, app, name, photo, role, honor, services[], any }
    loading: true,
    staffLoading: false,
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
    done: null,
    mine: { loading: false, list: null, err: "" }
  };

  let rootEl = null;
  let openSeq = 0;

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
  const tpeISO = iso => new Date(Date.parse(iso) + 8 * 36e5).toISOString();
  const fmtAt = iso => { const t = tpeISO(iso); return fmtDay(t.slice(0, 10)) + " " + t.slice(11, 16); };

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

  /* 之前在這台裝置驗證過手機 → 不必再驗一次 */
  async function restoreToken() {
    if (!readToken()) return;
    if (PREVIEW) return;
    try {
      const me = await api("GET", "/me");
      if (me && me.phone) {
        state.verifiedPhone = String(me.phone).replace(/\D/g, "");
        if (!state.form.phone) state.form.phone = state.verifiedPhone;
        if (!state.form.name && me.name) state.form.name = me.name;
      }
    } catch (_e) { saveToken(""); }
  }

  /* ---------- 開關 ---------- */
  async function open(opts) {
    opts = opts || {};
    const seq = ++openSeq;
    Object.assign(state, {
      open: true, mode: opts.mine ? "mine" : "book", student: !!opts.student,
      step: 1, store: opts.store || null, bkStore: null,
      employees: (opts.employees || []).filter(e => e && !e.isLeave && !e.isFreeze),
      staff: [], loading: true, staffLoading: false, loadErr: "", selStaff: null, selSvc: null,
      weekFrom: null, days: null, selDay: null, selSlot: null, submitting: false, done: null,
      otp: { sent: false, busy: false, hint: "" },
      mine: { loading: false, list: null, err: "" }
    });
    state.member = readMember();
    const m = state.member;
    state.form = { name: (m && m.name) || "", phone: memberPhone(m), code: "", note: "", memberNo: memberNo(m) };
    state.verifiedPhone = "";
    render();

    if (state.mode === "mine") {
      await restoreToken();
      if (seq !== openSeq) return;
      state.loading = false;
      if (state.verifiedPhone || (PREVIEW && readToken())) return loadMine();
      return render();
    }

    try { if (root.lohasTrack) root.lohasTrack("booking_open", { store: (state.store && state.store.erpid) || (state.student ? "student" : "") }); } catch (_e) {}

    try {
      const [cfg, stores] = await Promise.all([
        api("GET", "/config"),
        api("GET", "/stores").catch(() => []),
        restoreToken(),
        state.student ? loadSiteStores() : null
      ]);
      if (seq !== openSeq) return;
      if (cfg && cfg.max_days_ahead) state.maxDays = cfg.max_days_ahead;
      state.bkStores = stores || [];
      if (cfg && cfg.enabled === false) state.loadErr = "線上預約暫停中,請直接致電門市。";
      if (state.store) await loadStore(String(state.store.erpid), opts.preselectEmployeeErpId);
    } catch (e) {
      state.loadErr = e.message || "讀取預約資料失敗";
    }
    if (seq !== openSeq) return;
    state.loading = false;
    render();
  }
  function close() { openSeq++; state.open = false; render(); }

  /* 官網的門市資料(地區、地址、顧問照片來源)—— 只有學生模式要自己讀 */
  async function loadSiteStores() {
    try {
      const A = root.LohasApi && root.LohasApi.store, D = root.LohasStore && root.LohasStore.data;
      if (!A || !D) return;
      const raw = await A.getAllStores();
      state.siteStores = (raw || []).map(D.normalizeStore).filter(Boolean);
    } catch (_e) { state.siteStores = []; }
  }

  /* 選定一間店:讀預約系統的人員,配上官網的顧問照片 */
  async function loadStore(erp, preselectErp) {
    state.pendingErp = erp;
    state.bkStore = state.bkStores.find(s => String(s.store_erpid) === erp) || null;
    if (!state.store || String(state.store.erpid) !== erp) {
      const site = state.siteStores.find(s => String(s.erpid) === erp);
      state.store = site || { erpid: erp, name: state.bkStore ? state.bkStore.store_name : "" };
      state.employees = [];
    }
    /* 學生模式沒有從門市頁帶顧問進來 → 自己讀(只為了照片,讀不到不影響預約) */
    const loadEmp = (async () => {
      if (state.employees.length) return;
      try {
        const A = root.LohasApi && root.LohasApi.store, D = root.LohasStore && root.LohasStore.data;
        if (!A || !D) return;
        const raw = await A.getEmployeesByGroup(erp);
        state.employees = (raw || []).map(D.normalizeEmployeeShort).filter(e => e && !e.isLeave && !e.isFreeze && !e.isUnspecify);
      } catch (_e) {}
    })();
    const [staff] = await Promise.all([api("GET", "/staff?" + q({ store: erp })), loadEmp]);
    if (state.pendingErp !== erp) return;
    state.staff = mergeStaff(staff || []);

    /* 從某位顧問的「預約」進來 → 先選起來(項目仍要客人自己選)。
       用 staff-by-erp 換成預約系統的人員;換不到再退回姓名比對。 */
    if (preselectErp) {
      let hit = null;
      try {
        const p = await api("GET", "/staff-by-erp?" + q({ erp: preselectErp }));
        if (p && p.unspecified) hit = state.staff.find(s => s.any);
        else if (p && p.app_number) hit = state.staff.find(s => s.app === String(p.app_number));
      } catch (_e) { /* 404:沒開放預約 */ }
      if (!hit) {
        const e = state.employees.find(x => String(x.erpid) === String(preselectErp));
        hit = e && state.staff.find(s => s.name === norm(e.name));
      }
      if (hit) pickStaff(hit);
    }
  }

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
    const pick = arr => state.student
      ? arr.filter(x => STUDENT_SVC(x.name)).slice(0, 1).map(x => Object.assign({}, x, { label: STUDENT_LABEL }))
      : sortSvc(arr);
    let list = bkStaff.map(s => {
      const e = byName.get(norm(s.name));
      const photo = e && e.photos && e.photos[0] && String(e.photos[0]).trim();
      return {
        key: "app:" + s.app_number,
        app: String(s.app_number),
        name: norm(s.name),
        photo: photo || "",
        role: e ? (e.role || e.jobtitle || "").trim() : "",
        honor: e ? (e.honor || "").trim() : "",
        services: pick(withStoreMin(s.services || []))
      };
    });
    /* 不指定:用門市層級的項目,由門市安排人 */
    if (state.bkStore && (state.bkStore.services || []).length) {
      list.push({ key: "any", any: true, name: "不指定店員", role: "(最快有空)", photo: "", honor: "", services: pick(state.bkStore.services) });
    }
    /* 學生模式:沒有「配鏡」的人約不了學生方案,不列出來 */
    if (state.student) list = list.filter(s => s.services.length);
    return list;
  }
  /* 一般項目在前、生日項目在後,各自保持原順序 */
  function sortSvc(arr) {
    return arr.filter(s => !BIRTHDAY_RE.test(s.name)).concat(arr.filter(s => BIRTHDAY_RE.test(s.name)));
  }
  const svcName = svc => (svc && (svc.label || svc.name)) || "";

  function pickStaff(s) {
    if (!state.selStaff || state.selStaff.key !== s.key) {
      state.selStaff = s;
      /* 換人:同名項目還在就保留(分鐘數換成這個人的),沒有就清掉。學生模式只有一個項目,直接選好 */
      state.selSvc = state.student ? (s.services[0] || null)
        : state.selSvc ? (s.services.find(x => x.name === state.selSvc.name) || null) : null;
      state.days = null; state.selSlot = null;
    }
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
      if (!state.selStaff || !state.selSvc || want !== state.selStaff.key + "|" + state.selSvc.id + "|" + state.weekFrom) return;   // 已換人/換項目/換週
      state.days = (data && data.days) || [];
      const keep = state.selDay && state.days.find(d => d.day === state.selDay && d.open && d.slots.length);
      if (!keep) {
        const first = state.days.find(d => d.open && d.slots.length);
        state.selDay = first ? first.day : (state.days[0] && state.days[0].day) || null;
      }
    } catch (e) {
      state.days = [];
    }
    state.daysLoading = false;
    renderBody();
  }

  /* ---------- 我的預約 ---------- */
  async function loadMine() {
    state.mode = "mine";
    state.mine = { loading: true, list: null, err: "" };
    renderBody();
    try {
      if (PREVIEW) {
        await new Promise(r => setTimeout(r, 400));
        const t = Date.now() + 3 * 864e5;
        state.mine.list = [
          { id: "P1", store_name: "中壢店", staff_name: "李明諺", service_name: "配鏡", start_at: new Date(t).toISOString(), status: "booked", need_reschedule: false },
          { id: "P2", store_name: "中壢店", staff_name: "(門市安排)", service_name: "視力健檢", start_at: new Date(Date.now() - 9 * 864e5).toISOString(), status: "done" }
        ];
      } else {
        state.mine.list = (await api("GET", "/mine")) || [];
      }
    } catch (e) {
      if (e.status === 401) { saveToken(""); state.verifiedPhone = ""; state.mine.err = ""; state.mine.list = null; }
      else state.mine.err = e.message || "讀不到預約紀錄";
    }
    state.mine.loading = false;
    renderBody();
  }
  async function cancelBooking(id) {
    const b = (state.mine.list || []).find(x => String(x.id) === String(id));
    if (!b) return;
    if (!confirm(`確定取消這筆預約?\n\n${b.store_name || ""} ${fmtAt(b.start_at)}\n${b.service_name || ""}`)) return;
    try {
      if (PREVIEW) b.status = "cancelled";
      else await api("POST", "/bookings/" + encodeURIComponent(id) + "/cancel", {});
      if (!PREVIEW) return loadMine();
      renderBody();
    } catch (e) { alert(e.message || "取消失敗,請再試一次或致電門市"); if (!PREVIEW) loadMine(); }
  }

  /* ---------- 渲染 ---------- */
  function getRoot() {
    if (rootEl) return rootEl;
    rootEl = document.getElementById("lohas-booking-modal");
    if (!rootEl) { rootEl = document.createElement("div"); rootEl.id = "lohas-booking-modal"; document.body.appendChild(rootEl); }
    return rootEl;
  }

  function headHtml() {
    const s = state.store;
    let title, sub = "";
    if (state.mode === "mine") { title = "我的預約"; sub = "用預約時的手機查詢、取消"; }
    else if (state.student) { title = "大學生專案 · 線上預約"; sub = s ? s.name + (s.address ? "|" + s.address : "") : "學生配鏡 $1700 起"; }
    else { title = s ? s.name + " · 線上預約" : "線上預約"; sub = (s && s.address) || ""; }
    return `<div class="bm-head"><div class="bm-head-info">` +
        `<span class="tag"><i class="fa-solid fa-bolt"></i> ${state.mode === "mine" ? "MY BOOKINGS" : "RESERVATION"}</span>` +
        `<h2>${esc(title)}</h2>` + (sub ? `<p>${esc(sub)}</p>` : "") +
      `</div><button class="bm-close" data-close aria-label="關閉"><i class="fa-solid fa-xmark"></i></button></div>`;
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
    r.innerHTML =
      `<div class="bm-overlay${fresh ? "" : " open"}" data-overlay>` +
        `<div class="bm-dialog bk2">` +
          headHtml() +
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
    const head = r.querySelector(".bm-head");
    if (head) head.outerHTML = headHtml();
    const steps = r.querySelector(".bm-steps");
    const newSteps = renderSteps();
    if (steps) { if (newSteps) steps.outerHTML = newSteps; else steps.remove(); }
    else if (newSteps) body.insertAdjacentHTML("beforebegin", newSteps);
    body.innerHTML = renderStep();
    body.scrollTop = top;
    const foot = r.querySelector(".bm-foot");
    const newFoot = renderFoot();
    if (foot) { if (newFoot) foot.outerHTML = newFoot; else foot.remove(); }
    else if (newFoot) body.insertAdjacentHTML("afterend", newFoot);
    bind();
  }

  function renderSteps() {
    if (state.done || state.mode === "mine") return "";
    const steps = [state.student ? "選門市與顧問" : "選顧問與項目", "選時段", "確認資料"];
    return `<div class="bm-steps">` + steps.map((t, i) => {
      const n = i + 1;
      const cls = state.step === n ? "active" : state.step > n ? "done" : "";
      return `<div class="bm-step ${cls}"><span class="bm-step-num">${state.step > n ? '<i class="fa-solid fa-check"></i>' : n}</span>${t}</div>`;
    }).join("") + `</div>`;
  }

  function renderStep() {
    if (state.mode === "mine") return renderMine();
    if (state.done) return renderDone();
    if (state.loading) return stateBox(`<div class="spinner"></div>`, "載入預約資料中…");
    if (state.loadErr) return stateBox("", esc(state.loadErr), "請致電門市預約");
    if (state.step === 1) return renderStaffStep();
    if (state.step === 2) return renderTimeStep();
    return renderFormStep();
  }
  const stateBox = (icon, title, msg) =>
    `<div class="bm-state">${icon}<div class="bm-state-title">${title}</div>${msg ? `<div class="bm-state-msg">${msg}</div>` : ""}</div>`;

  /* 學生模式:選門市(依官網的地區分組;官網資料讀不到就照預約系統的店名排) */
  function renderStorePick() {
    const site = new Map(state.siteStores.map(s => [String(s.erpid), s]));
    /* 只列官網門市據點上有的店 —— 官網會隱藏已結束營業的店(store-data.js 的 HIDDEN_STORE_NAMES),
       而預約系統不一定關掉了(2026-11-12 高應大店 8/14 已歇業,預約系統裡還開著)。
       官網門市資料讀不到時才全部列出。 */
    const list = state.bkStores.filter(s => (s.services || []).some(x => STUDENT_SVC(x.name)))
      .filter(s => !state.siteStores.length || site.has(String(s.store_erpid))).map(s => {
      const w = site.get(String(s.store_erpid));
      return { erp: String(s.store_erpid), name: (w && w.name) || s.store_name, region: w && w.region };
    });
    const groups = new Map();
    list.forEach(s => {
      const k = s.region ? s.region.order + "|" + s.region.label : "99|其他";
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s);
    });
    const sel = state.store ? String(state.store.erpid) : "";
    const opts = [...groups.entries()].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0])).map(([k, arr]) =>
      `<optgroup label="${esc(k.split("|")[1])}">` +
        arr.sort((a, b) => a.name.localeCompare(b.name, "zh-Hant")).map(s =>
          `<option value="${esc(s.erp)}"${s.erp === sel ? " selected" : ""}>${esc(s.name)}</option>`).join("") +
      `</optgroup>`).join("");
    return `<div class="bm-sec"><div class="bm-sec-title">選擇門市 <span class="bm-required">*</span></div>` +
      `<div class="bk2-store"><i class="fa-solid fa-store"></i><select data-store aria-label="選擇門市">` +
        `<option value="">請選擇要去的門市</option>${opts}</select><i class="fa-solid fa-chevron-down bk2-store-caret"></i></div></div>`;
  }

  /* 第 1 步:(學生模式先選門市)顧問(大頭像)+ 這位顧問的項目 */
  function renderStaffStep() {
    const storePick = state.student ? renderStorePick() : "";
    if (state.student && !state.store) return storePick + `<div class="bk2-hint">先選門市,就會列出可以預約的顧問</div>`;
    if (state.staffLoading) return storePick + stateBox(`<div class="spinner"></div>`, "載入顧問中…");
    if (!state.staff.length) return storePick + stateBox("", state.student ? "這間門市目前沒有開放學生配鏡的線上預約" : "這間門市尚未開放線上預約", "請選擇其他門市或致電門市預約");
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
            (state.student ? "" : `<div class="bk2-staff-count">可預約 ${s.services.length} 項服務</div>`) +
          `</div>` +
          `<div class="bm-staff-pick-check"><i class="fa-solid fa-check"></i></div>` +
        `</div>`;
    }).join("");
    return storePick + `<div class="bm-sec"><div class="bm-sec-title">選擇銷售顧問</div><div class="bm-staff-grid">${cards}</div></div>` +
      renderServices();
  }

  function renderServices() {
    const s = state.selStaff;
    let inner;
    if (!s) {
      inner = `<div class="bk2-hint">${state.student ? "先選一位顧問" : "先選一位顧問,就會列出他可以服務的項目"}</div>`;
    } else {
      const normal = s.services.filter(x => !BIRTHDAY_RE.test(x.name));
      const bday = s.services.filter(x => BIRTHDAY_RE.test(x.name));
      const chip = x => {
        const active = state.selSvc && state.selSvc.id === x.id;
        return `<button type="button" class="bm-svc-pick bk2-svc ${active ? "active" : ""}" data-svc="${x.id}">` +
            `<span class="bk2-svc-name">${esc(svcName(x))}</span>` +
            `<span class="bk2-svc-min"><i class="fa-regular fa-clock"></i> 約 ${Number(x.minutes) || "—"} 分鐘</span>` +
          `</button>`;
      };
      inner = (normal.length ? `<div class="bm-svc-grid">${normal.map(chip).join("")}</div>` : "") +
        (bday.length
          ? `<div class="bk2-svc-group"><i class="fa-solid fa-cake-candles"></i> 生日月專屬</div><div class="bm-svc-grid bk2-bday">${bday.map(chip).join("")}</div>`
          : "");
      if (state.student) inner += `<div class="bk2-student-note"><i class="fa-solid fa-graduation-cap"></i> 1700 元樂活配/2700 元任你配,到店請出示學生證或在學證明</div>`;
      if (!s.services.length) inner = `<div class="bk2-hint">這位顧問目前沒有開放線上預約的項目</div>`;
    }
    return `<div class="bm-sec"><div class="bm-sec-title">預約服務項目 <span class="bm-required">*</span>` +
      (s && !state.student ? `<span class="bk2-sec-sub">${esc(s.any ? "門市" : s.name)}可服務的項目</span>` : "") +
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
    const svcLine = `<div class="bk2-picked">${state.student && state.store ? esc(state.store.name) + " · " : ""}<b>${esc(state.selStaff.any ? ANY_LABEL : state.selStaff.name)}</b> · ${esc(svcName(state.selSvc))} · 約 ${state.selSvc.minutes} 分鐘</div>`;

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
        row("項目", `${esc(svcName(svc))} <span class="bk2-muted">約 ${svc.minutes} 分鐘</span>`) +
        row("時間", `<b>${fmtDay(state.selDay)} ${esc(slot.label)}</b>`) +
      `</div>` +
      (state.student ? `<div class="bk2-student-note"><i class="fa-solid fa-id-card"></i> 到店請出示學生證或在學證明,學生方案一人一生限本人使用一次</div>` : "");

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
      `<div class="bm-success-msg">前一天會再傳簡訊提醒您。要改時間或取消,請到「我的預約」或致電門市。` +
        (state.student ? `<br><b>到店請出示學生證或在學證明。</b>` : "") + `</div>` +
      `<div class="bm-success-detail">` +
        `<div>門市:<b>${esc(d.store_name || (state.store && state.store.name) || "")}</b></div>` +
        `<div>顧問:<b>${esc(state.selStaff.any ? ANY_LABEL : (d.staff_name || state.selStaff.name))}</b></div>` +
        `<div>項目:<b>${esc(state.student ? STUDENT_LABEL : (d.service_name || state.selSvc.name))}</b>(約 ${state.selSvc.minutes} 分鐘)</div>` +
        `<div>時間:<b>${fmtDay(state.selDay)} ${esc(state.selSlot.label)}</b></div>` +
      `</div></div>`;
  }

  /* 我的預約:沒驗證 → 手機驗證;驗過 → 列表(可取消) */
  function renderMine() {
    if (state.loading) return stateBox(`<div class="spinner"></div>`, "讀取中…");
    const verified = state.verifiedPhone || (PREVIEW && state.mine.list);
    if (!verified && !state.mine.list) {
      return `<div class="bm-sec"><div class="bm-sec-title">驗證手機</div>` +
        `<div class="bk2-hint" style="text-align:left;margin-bottom:14px">輸入預約時用的手機號碼,收到簡訊驗證碼後就能看到你的預約。</div>` +
        phoneOtp() + `</div>`;
    }
    if (state.mine.loading) return stateBox(`<div class="spinner"></div>`, "讀取預約中…");
    if (state.mine.err) return stateBox("", esc(state.mine.err), "請稍後再試或致電門市");
    const list = state.mine.list || [];
    const who = state.verifiedPhone
      ? `<div class="bk2-verified" style="margin-bottom:16px"><span><i class="fa-solid fa-circle-check"></i> ${esc(state.verifiedPhone)} 的預約</span>` +
        `<button type="button" class="bm-link" data-rephone>換一支手機</button></div>`
      : "";
    if (!list.length) return who + `<div class="bk2-hint">最近沒有預約紀錄</div>`;
    const now = Date.now();
    return who + list.map(b => {
      const live = b.status === "booked";
      const future = Date.parse(b.start_at) > now;
      const st = b.need_reschedule && live ? "門市會聯絡你改時間" : (STATUS[b.status] || b.status);
      return `<div class="bk2-mine${live ? "" : " bk2-mine--past"}">` +
          `<div class="bk2-mine-top"><b>${esc(fmtAt(b.start_at))}</b><span class="bk2-mine-st bk2-st-${esc(b.status)}">${esc(st)}</span></div>` +
          `<div class="bk2-mine-info">${esc(b.store_name || "")}|${esc(b.service_name || "")}|${esc(b.staff_name || "門市安排")}</div>` +
          (live && future ? `<button type="button" class="bk2-mine-cancel" data-cancel="${esc(b.id)}">取消預約</button>` : "") +
        `</div>`;
    }).join("");
  }

  function renderFoot() {
    if (state.mode === "mine") {
      return `<div class="bm-foot"><div class="bm-foot-summary"><b>我的預約</b>要改時間請先取消再重新預約</div>` +
        `<div class="bm-foot-actions"><button class="bm-btn primary" data-close>關閉</button></div></div>`;
    }
    if (state.done) {
      return `<div class="bm-foot"><div class="bm-foot-summary"><b>感謝您的預約</b>期待在門市見到您</div>` +
        `<div class="bm-foot-actions"><button class="bm-btn ghost" data-mine>我的預約</button>` +
        `<button class="bm-btn primary" data-close>完成</button></div></div>`;
    }
    if (state.loading || state.loadErr) return "";
    const ok = canNext();
    let hint;
    if (state.step === 1) hint = state.student && !state.store ? "<b>請先選擇門市</b>"
      : !state.selStaff ? "<b>請先選擇一位顧問</b>" : !state.selSvc ? "<b>請選擇預約服務項目</b>"
      : `<b>${esc(svcName(state.selSvc))}</b>約 ${state.selSvc.minutes} 分鐘・按「下一步」挑時段`;
    else if (state.step === 2) hint = state.selSlot ? `<b>${fmtDay(state.selDay)} ${esc(state.selSlot.label)}</b>${esc(svcName(state.selSvc))}・約 ${state.selSvc.minutes} 分鐘` : "<b>請選擇預約時段</b>可切換上一週 / 下一週";
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
    if (state.step === 1) return !!(state.store && state.selStaff && state.selSvc);
    if (state.step === 2) return !!state.selSlot;
    return identityOk();
  }

  /* ---------- 事件 ---------- */
  function bind() {
    const r = getRoot();
    const on = (sel, fn, ev) => r.querySelectorAll(sel).forEach(el => el.addEventListener(ev || "click", e => fn(el, e)));
    on("[data-overlay]", (el, e) => { if (e.target === el && (state.done || state.mode === "mine")) close(); });
    on(".bm-head [data-close]", () => close());

    on("[data-store]", async el => {
      const erp = el.value;
      state.selStaff = null; state.selSvc = null; state.days = null; state.selSlot = null; state.staff = [];
      state.pendingErp = erp;
      state.store = null;          // 讓 loadStore 重新帶店名、地址與顧問照片
      if (!erp) { state.staffLoading = false; return renderBody(); }
      state.staffLoading = true;
      renderBody();
      try { await loadStore(erp); } catch (e) { state.staff = []; }
      if (state.pendingErp !== erp) return;   // 客人換店的速度比網路快:丟掉舊的結果
      state.staffLoading = false;
      renderBody();
    }, "change");
    on("[data-staff]", el => {
      const s = state.staff.find(x => x.key === el.dataset.staff);
      if (!s) return;
      pickStaff(s);
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
    on("[data-rephone]", () => {
      state.verifiedPhone = ""; saveToken(""); state.otp = { sent: false, busy: false, hint: "" };
      if (state.mode === "mine") state.mine = { loading: false, list: null, err: "" };
      renderBody();
    });
    on("[data-cancel]", el => cancelBooking(el.dataset.cancel));
    on("[data-login]", () => {
      try { localStorage.setItem("redirectAfterLogin", location.pathname.split("/").pop() + location.search + location.hash); } catch (_e) {}
    });
    bindFoot();
  }
  function bindFoot() {
    const r = getRoot();
    const b = (sel, fn) => { const el = r.querySelector(sel); if (el) el.addEventListener("click", fn); };
    b(".bm-foot [data-close]", close);
    b(".bm-foot [data-mine]", () => { state.done = null; loadMine(); });
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
        saveToken("PREVIEW");
      } else {
        const d = await api("POST", "/otp/verify", { phone, code });
        saveToken(d.token);
        state.verifiedPhone = String(d.phone || phone).replace(/\D/g, "");
      }
      if (state.mode === "mine") return loadMine();
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
      if (state.student) noteLines.push(STUDENT_NOTE);
      if (state.form.memberNo) noteLines.push("會員編號:" + state.form.memberNo);
      if (state.form.note.trim()) noteLines.push(state.form.note.trim());
      const body = { service_id: svc.id, start_at: state.selSlot.start, name: state.form.name.trim(), note: noteLines.join("\n").slice(0, 300), source: "web" };
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
        item_type: state.student ? "學生方案" : state.selSvc.name,
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
