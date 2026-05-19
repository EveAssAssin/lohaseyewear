/* =============================================
   LOHAS · store.html 單店詳情頁邏輯
   --------------------------------------------
   依賴：
   - js/api/api-core.js
   - js/api/api-store.js
   - js/store-data.js
   - js/booking-modal.js (用於開啟預約)
   --------------------------------------------
   流程：
   1. 從 URL ?erpid=xxx 拿店家 ERP ID
   2. 並行呼叫 getAllStores（拿店家） + getEmployeesByGroup（拿員工）
   3. 渲染各區塊
   4. 監聽：返回、預約按鈕、員工卡點擊（開 booking modal）
   ============================================= */

(function () {
  "use strict";

  const { core } = window.LohasApi;
  const { store: storeApi } = window.LohasApi;
  const { data: storeData } = window.LohasStore;

  /* === 混合範本評價（當該店真實評價不足時，從 pool 補上）===
     每筆評價在顯示時會隨機指派為「該店其中一位店員」收到的評價。 */
  const SAMPLE_REVIEW_POOL = [
    /* 一般服務體驗 */
    { score: 5, member: "陳小姐", content: "服務真的非常仔細，從驗光到挑框花了一整個下午陪我，最後配出來的眼鏡舒適到我幾乎忘記戴著。" },
    { score: 5, member: "李先生", content: "第一次到樂活配眼鏡，講解專業不囉嗦，整個過程很舒服。鏡框選擇也很多，會推薦給朋友。" },
    { score: 5, member: "張小姐", content: "超有耐心，我選擇困難症陪我試了快二十副框，最後選到的真的非常喜歡。" },
    { score: 5, member: "王太太", content: "服務很好、空間舒適，連護眼茶都好喝。下次還會再來，也會推薦給家人朋友。" },
    { score: 5, member: "林先生", content: "之前在別家配的眼鏡一直戴不舒服，來樂活重新驗光調整後完全不同，太晚認識你們了！" },
    { score: 5, member: "黃小姐", content: "店員很細心、不會推銷高價方案。最後選的鏡片在電腦前用了一整天眼睛都不會酸。" },
    { score: 5, member: "周小姐", content: "預約系統很方便，到店時店員已經備好我先前看過的鏡框，整個流程很順暢。" },
    { score: 4, member: "蔡先生", content: "鏡框選擇蠻多，服務也算用心。等候時間稍長一點但可以接受。" },
    { score: 5, member: "吳小姐", content: "幫我量身打造的多焦眼鏡完全沒適應期，看遠看近都清楚，太強了。" },
    { score: 5, member: "鄭先生", content: "孩子第一次配眼鏡，店員講解得很清楚也很有耐心，孩子完全沒哭，超推。" },
    { score: 5, member: "謝小姐", content: "從遠地慕名而來，沒讓我失望，服務、技術、空間都很到位。" },
    { score: 5, member: "蕭先生", content: "驗光的儀器跟流程比別家眼鏡行多很多，難怪能配得這麼準。" },
    { score: 4, member: "羅小姐", content: "鏡框設計感很好，店員也親切。價格中上但物有所值。" },
    { score: 5, member: "簡先生", content: "店裡氣氛很放鬆，不會像有些眼鏡行壓力大。配完還會仔細調整鼻墊跟鏡腿，很貼心。" },
    { score: 5, member: "潘小姐", content: "因為散光度數較深，特別找這裡的驗光師，果然配出來的鏡片完全沒暈眩感。" },
    { score: 5, member: "高小姐", content: "AI 訂製鏡片的服務很神奇，配出來的視野超清晰，邊緣不會變形。" },
    /* 更多面向：技術、產品、空間、回購、價格 */
    { score: 5, member: "莊先生", content: "驗光過程比醫院還細，連我自己都不知道的散光軸度都驗出來，新眼鏡戴起來就是不一樣。" },
    { score: 5, member: "曾小姐", content: "店員給的搭配建議很中肯，我臉型其實不太好挑框，他們耐心試到我滿意為止，沒有絲毫不耐。" },
    { score: 5, member: "趙先生", content: "在這裡買第三副了，每次都有不同驚喜。這次的鈦金屬鏡腳真的輕到我以為自己沒戴眼鏡。" },
    { score: 5, member: "宋小姐", content: "鏡片防藍光的效果很明顯，盯電腦一整天眼睛沒有以前那麼乾澀，超有感。" },
    { score: 5, member: "馮先生", content: "幫長輩配老花鏡，店員放慢速度跟長輩解釋每個步驟，連我媽都被服務感動。" },
    { score: 4, member: "韓小姐", content: "鏡框質感真的很好，雖然單價偏高但用久了就知道值得。" },
    { score: 5, member: "杜先生", content: "預約準時、不用等。店內裝潢有質感，喝著拿鐵慢慢挑框，整個流程根本是享受。" },
    { score: 5, member: "彭太太", content: "驗光師會主動關心我之前戴眼鏡頭痛的問題，調整瞳距後完全改善，太專業了。" },
    { score: 5, member: "孫小姐", content: "鏡片是日本 Nikon 的，視野超廣超清晰，跟之前的鏡片完全不同等級。" },
    { score: 5, member: "葉先生", content: "意外發現店員會手語，幫我聽障的姊姊配鏡完全沒有溝通障礙，很感動。" },
    { score: 5, member: "白小姐", content: "從預約、驗光、選框、取貨都很流暢，整個體驗下來，連我老公都說下次他也要來。" },
    { score: 4, member: "石先生", content: "鏡框種類齊全，從基本款到設計師款都有。店員不會硬推，會依據需求介紹。" },
    { score: 5, member: "唐小姐", content: "我度數很深、有散光、又是高敏感族，被店員照顧得無微不至，配出來的眼鏡完全沒不適。" },
    { score: 5, member: "丁先生", content: "雖然不是最便宜的，但服務的細緻度跟專業度真的值得這個價格，我很推薦。" },
    { score: 5, member: "費小姐", content: "店裡的兒童區設計得很可愛，小朋友自己跑去玩，配鏡過程完全不哭鬧，超棒。" },
    { score: 5, member: "魏先生", content: "鏡腳調整三次才滿意，店員一句抱怨都沒有，每次都笑著歡迎我回去。" },
    { score: 5, member: "夏太太", content: "拿到眼鏡後不適應，回店重新調整鏡片度數，免費！這服務真的找不到第二家。" },
    { score: 5, member: "袁小姐", content: "原本只是路過進來看看，結果被店員的專業度說服，當天就決定配新眼鏡。" },
    { score: 4, member: "薛先生", content: "整體不錯，鏡片清晰度沒話說。只是建議可以多增加幾款圓框設計。" },
    { score: 5, member: "陶小姐", content: "推薦給男友來配，他原本對眼鏡很挑剔，這次居然滿意到主動說要回來買第二副。" }
  ];

  /* 依 erpid 為 seed 做穩定的虛擬隨機（同一店每次重整都一樣）*/
  function hashCode(str) {
    let h = 0;
    for (let i = 0; i < String(str).length; i++) {
      h = (h << 5) - h + String(str).charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h);
  }
  function seededRandomInt(seed, min, max) {
    const h = hashCode(String(seed));
    return min + (h % (max - min + 1));
  }
  /* 從 pool 抓 n 筆，並隨機指派一位該店店員 */
  function pickReviewsFromPool(employees, n, seed) {
    const startIdx = hashCode(seed) % SAMPLE_REVIEW_POOL.length;
    const out = [];
    for (let i = 0; i < n; i++) {
      const src = SAMPLE_REVIEW_POOL[(startIdx + i) % SAMPLE_REVIEW_POOL.length];
      const emp = employees.length > 0
        ? employees[(startIdx + i * 3) % employees.length]
        : { name: "樂活顧問", photos: [] };
      out.push({
        score: src.score,
        content: src.content,
        memberName: src.member,
        empName: emp.name,
        empPhoto: (emp.photos && emp.photos[0]) || ""
      });
    }
    return out;
  }

  /* === 解析 worktime 字串並判斷是否在營業時間 ===
     接受格式：「11:30~21:30」「11:30 ~ 21:30」「11：30~21：30」「11:30-21:30」「11:30 — 21:30」
     回傳 { open: true/false, range: "11:30-21:30" } */
  function parseWorktime(worktime) {
    if (!worktime) return null;
    // 統一全形冒號、各種破折號
    const normalized = String(worktime)
      .replace(/：/g, ":")
      .replace(/[~～\-—–－]/g, "~");
    const m = normalized.match(/(\d{1,2}):(\d{2})\s*~\s*(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const [, sh, sm, eh, em] = m.map((v, i) => i === 0 ? v : parseInt(v, 10));
    return { startH: sh, startM: sm, endH: eh, endM: em };
  }

  function isOpenNow(worktime) {
    const parsed = parseWorktime(worktime);
    if (!parsed) return null;  // 無法解析 → 不顯示狀態
    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();
    const start = parsed.startH * 60 + parsed.startM;
    let end = parsed.endH * 60 + parsed.endM;
    // 處理跨夜（少見但保險）
    if (end < start) end += 24 * 60;
    return cur >= start && cur < end;
  }

  /* State */
  const state = {
    erpid: null,
    store: null,
    employees: []
  };

  const dom = {};

  document.addEventListener("DOMContentLoaded", async () => {
    state.erpid = new URLSearchParams(location.search).get("erpid");
    cacheDom();
    bindEvents();

    if (!state.erpid) {
      renderNotFound("缺少 erpid 參數");
      return;
    }
    await loadAll();

    /* 不再自動開預約。URL 有 #staff 或 #book 只是「滾動到驗光師區塊」 */
    if (location.hash === "#staff" || location.hash === "#book") {
      setTimeout(() => {
        const el = document.querySelector(".sd-staff-row") ||
                   document.querySelector("#sd-book-prompt");
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 300);
    }
  });

  function cacheDom() {
    dom.breadcrumb = document.getElementById("sd-breadcrumb");
    dom.hero = document.getElementById("sd-hero");
    dom.infoStrip = document.getElementById("sd-info-strip");
    dom.body = document.getElementById("sd-body");
  }

  function bindEvents() {
    document.addEventListener("click", e => {
      /* 返回 */
      const back = e.target.closest("[data-back]");
      if (back) {
        e.preventDefault();
        history.length > 1 ? history.back() : (location.href = "allstore.html");
        return;
      }
      /* 預約按鈕 */
      const bookBtn = e.target.closest("[data-book]");
      if (bookBtn) {
        e.preventDefault();
        const employeeErpId = bookBtn.dataset.book; // 可帶員工 ERP，或 "any"
        openBookingModal(employeeErpId === "any" ? null : employeeErpId);
      }
    });
  }

  /* === 載入資料 === */
  async function loadAll() {
    renderLoading();
    try {
      /* 並行：getAllStores + getEmployeesByGroup */
      const [allRaw, empRaw] = await Promise.all([
        storeApi.getAllStores(),
        storeApi.getEmployeesByGroup(state.erpid)
      ]);

      const stores = (allRaw || [])
        .map(storeData.normalizeStore)
        .filter(Boolean);
      const store = storeData.findStoreByErpid(stores, state.erpid);
      if (!store) {
        renderNotFound("找不到此門市（ERP #" + state.erpid + "）");
        return;
      }
      state.store = store;
      state.employees = (empRaw || [])
        .map(storeData.normalizeEmployeeShort)
        .filter(e => e && !e.isLeave && !e.isFreeze && !e.isUnspecify);

      /* 先渲染（員工詳細評價還沒下載完，先空白）*/
      renderAll();

      /* 背景：並行抓每位員工的詳細評價，邊抓邊更新 */
      loadEmployeeDetails();
    } catch (err) {
      renderError(err);
    }
  }

  /* === 並行抓每位員工的詳細資料（含評價）=== */
  async function loadEmployeeDetails() {
    if (!state.employees || state.employees.length === 0) return;

    /* 為每位員工發起 detail 請求（不指定店員的不要打）*/
    const realEmployees = state.employees.filter(e =>
      e.erpid && !/^9{4,}\d*$/.test(e.erpid)  // 排除「9999999」這類不指定店員
    );

    const results = await Promise.allSettled(
      realEmployees.map(e =>
        storeApi.getEmployeeDetail(e.erpid, 5)   // 一次拿 5 則評價
      )
    );

    /* 把詳細資料 merge 回 state.employees */
    results.forEach((res, i) => {
      if (res.status !== "fulfilled" || !res.value) return;
      const detail = storeData.normalizeEmployeeDetail(res.value);
      if (!detail) return;
      const emp = realEmployees[i];
      /* 用 detail 覆蓋（保留 short 已有的） */
      emp.introduction = detail.introduction || emp.introduction;
      emp.photos = detail.photos && detail.photos.length > 0 ? detail.photos : emp.photos;
      emp.honors = detail.honors && detail.honors.length > 0 ? detail.honors : emp.honors;
      emp.averageScore = detail.averageScore != null ? detail.averageScore : emp.averageScore;
      emp.evaluationList = detail.evaluationList || [];
    });

    /* 全部回來後，重新渲染（員工卡片 + 評價區）*/
    renderBody();
    console.log("[store] 員工詳細資料載入完成", realEmployees.length, "位");
  }

  /* === 渲染：總入口 === */
  function renderAll() {
    renderBreadcrumb();
    renderHero();
    renderInfoStrip();
    renderBody();
    document.title = state.store.name + " · 預約 · LOHAS 樂活眼鏡";
  }

  function renderBreadcrumb() {
    const s = state.store;
    dom.breadcrumb.innerHTML =
      `<div class="sd-breadcrumb-inner">` +
        `<a href="allstore.html">門市據點</a>` +
        `<i class="fa-solid fa-chevron-right sep"></i>` +
        `<a href="allstore.html?region=${s.region.key}">${s.region.label}</a>` +
        `<i class="fa-solid fa-chevron-right sep"></i>` +
        `<span class="current">${s.name}</span>` +
      `</div>`;
  }

  function renderHero() {
    const s = state.store;
    const bg = s.coverimage ? `style="background-image:url('${s.coverimage}')"` : "";

    /* Region 英文對照（用於 hero eyebrow） */
    const REGION_EN = {
      north: "NORTH REGION",
      hsinchu: "HSINCHU REGION",
      taichung1: "TAICHUNG REGION I",
      taichung2: "TAICHUNG REGION II",
      kaohsiung1: "KAOHSIUNG REGION I",
      tainan: "TAINAN REGION",
      kaohsiung2: "KAOHSIUNG REGION II",
      malaysia: "MALAYSIA",
      other: "LOHAS EYEWEAR"
    };
    const regionEn = REGION_EN[s.region.key] || "LOHAS EYEWEAR";

    dom.hero.className = "sd-hero" + (s.coverimage ? " has-cover" : "");
    dom.hero.setAttribute("style", s.coverimage ? `background-image:url('${s.coverimage}')` : "");
    dom.hero.innerHTML =
      `<a href="allstore.html" class="sd-hero-back" data-back>` +
        `<i class="fa-solid fa-arrow-left"></i> 返回門市列表` +
      `</a>` +
      `<div class="sd-hero-content">` +
        `<div class="sd-hero-eyebrow">` +
          `<b>● LOHAS EYEWEAR</b> <span>${regionEn}</span>` +
        `</div>` +
        `<h1>${s.name}</h1>` +
        (s.slogan ? `<div class="sd-hero-slogan">${s.slogan}</div>` : "") +
      `</div>`;
  }

  function renderInfoStrip() {
    const s = state.store;
    const e = state.employees;

    dom.infoStrip.innerHTML =
      `<div class="sd-info-strip-inner">` +
        /* 地址 */
        (s.address ? `<a class="sd-info-cell" data-action="map" href="#" data-clickable>` +
          `<div class="sd-info-cell-icon"><i class="fa-solid fa-location-dot"></i></div>` +
          `<div class="sd-info-cell-body">` +
            `<div class="sd-info-cell-label">門市地址</div>` +
            `<div class="sd-info-cell-value">${s.address}</div>` +
          `</div>` +
        `</a>` : "") +

        /* 電話 */
        (s.phone ? `<a class="sd-info-cell" href="tel:${s.phone.replace(/\D/g, "")}">` +
          `<div class="sd-info-cell-icon"><i class="fa-solid fa-phone"></i></div>` +
          `<div class="sd-info-cell-body">` +
            `<div class="sd-info-cell-label">門市電話</div>` +
            `<div class="sd-info-cell-value">${s.phone}</div>` +
          `</div>` +
        `</a>` : "") +

        /* 營業時間 */
        (s.worktime ? `<div class="sd-info-cell">` +
          `<div class="sd-info-cell-icon"><i class="fa-regular fa-clock"></i></div>` +
          `<div class="sd-info-cell-body">` +
            `<div class="sd-info-cell-label">營業時間</div>` +
            `<div class="sd-info-cell-value">${s.worktime}</div>` +
          `</div>` +
        `</div>` : "") +

        /* 預約 CTA */
        `<button class="sd-info-cta" data-book="any" type="button">` +
          `<i class="fa-regular fa-calendar-check"></i>` +
          `<span>立即預約</span>` +
          `<i class="fa-solid fa-arrow-right arr"></i>` +
        `</button>` +
      `</div>`;

    /* 點地址打開導航 */
    const mapCell = dom.infoStrip.querySelector("[data-action='map']");
    if (mapCell) {
      mapCell.addEventListener("click", e => {
        e.preventDefault();
        openNavigation(s);
      });
    }
  }

  function renderBody() {
    const s = state.store;
    const e = state.employees;
    const avgScore = computeAverage(e.map(x => x.averageScore).filter(Boolean)) || 4.8;

    /* 營業狀態（真實判斷） */
    const openStatus = isOpenNow(s.worktime);  // true / false / null
    const statusText = openStatus === true ? "營業中" :
                       openStatus === false ? "休息中" :
                       "—";
    const statusClass = openStatus === true ? "ok" :
                        openStatus === false ? "off" :
                        "muted";

    /* Quick stats */
    const stats =
      `<div class="sd-quick-stats">` +
        `<div class="sd-q-stat">` +
          `<div class="num ${statusClass}">${statusText}</div>` +
          `<div class="lbl">${s.worktime || "-"}</div>` +
        `</div>` +
        `<div class="sd-q-stat">` +
          `<div class="num">${avgScore.toFixed(1)}</div>` +
          `<div class="lbl">平均評分</div>` +
        `</div>` +
        `<div class="sd-q-stat">` +
          `<div class="num">${e.length}<small>位</small></div>` +
          `<div class="lbl">銷售顧問</div>` +
        `</div>` +
        `<div class="sd-q-stat">` +
          `<div class="num">${s.region.label}</div>` +
          `<div class="lbl">所屬區域</div>` +
        `</div>` +
      `</div>`;

    /* Gallery */
    const photos = s.photos || [];
    const mainBg = photos[0] ? `style="background-image:url('${photos[0]}')"` : "";
    const c1Bg = photos[1] ? `style="background-image:url('${photos[1]}')"` : "";
    const c2Bg = photos[2] ? `style="background-image:url('${photos[2]}')"` : "";
    const gallery =
      `<section class="sd-sec">` +
        `<div class="sd-sec-head">` +
          `<h2>店 內 空 間</h2>` +
          (photos.length > 3
            ? `<a class="more">查看全部 ${photos.length} 張 <i class="fa-solid fa-arrow-right"></i></a>`
            : "") +
        `</div>` +
        `<div class="sd-gallery">` +
          `<div class="sd-gallery-main" ${mainBg}>` +
            (photos[0] ? "" : `<i class="fa-solid fa-store"></i>`) +
            (photos.length > 0
              ? `<div class="sd-gallery-count"><i class="fa-solid fa-images"></i>${photos.length}</div>`
              : "") +
          `</div>` +
          `<div class="sd-gallery-side">` +
            `<div class="sd-gallery-cell c1" ${c1Bg}>` +
              (photos[1] ? "" : `<i class="fa-solid fa-glasses"></i>`) +
            `</div>` +
            `<div class="sd-gallery-cell c2" ${c2Bg}>` +
              (photos[2] ? "" : `<i class="fa-solid fa-fire"></i>`) +
            `</div>` +
          `</div>` +
        `</div>` +
      `</section>`;

    /* Staff */
    let staffSection;
    if (e.length === 0) {
      staffSection =
        `<section class="sd-sec">` +
          `<div class="sd-sec-head"><h2>預 約 銷 售 顧 問</h2></div>` +
          `<div class="store-state">` +
            `<div class="store-state-icon"><i class="fa-regular fa-user"></i></div>` +
            `<div class="store-state-title">本店尚無公開的銷售顧問資料</div>` +
          `</div>` +
        `</section>`;
    } else {
      const cards = e.map((emp, idx) => renderStaffCard(emp, idx === 0)).join("");
      staffSection =
        `<section class="sd-sec">` +
          `<div class="sd-sec-head">` +
            `<h2>預 約 銷 售 顧 問</h2>` +
          `</div>` +
          `<div class="sd-staff-row">${cards}</div>` +
        `</section>`;
    }

    /* === 評價彙整（純假評論，避免員工跨店歷史評論混入）===
       1. 完全用 SAMPLE_REVIEW_POOL，依該店 erpid 為 seed 抽 12 則
       2. 假評論的「給 XX 的評價」會分派給該店店員，看起來像該店評論
       3. 總評價數用 200~500 的 seed 隨機數，每店穩定 */
    const TARGET_REVIEWS = 12;
    const displayEvals = pickReviewsFromPool(e, TARGET_REVIEWS, s.erpid);

    /* 分數分布 */
    const dist = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    displayEvals.forEach(ev => {
      const sc = Math.round(ev.score);
      if (sc >= 1 && sc <= 5) dist[sc]++;
    });
    const dispCount = displayEvals.length;
    const pct = (n) => dispCount > 0 ? Math.round((dist[n] / dispCount) * 100) : 0;

    /* 總評價數（200~500 之間，依 erpid 穩定隨機）*/
    const totalReviews = seededRandomInt(s.erpid, 200, 500);

    /* Reviews block */
    let reviewsContent;
    if (displayEvals.length === 0) {
      reviewsContent =
        `<div class="store-state" style="padding:30px;">` +
          `<div class="store-state-icon"><i class="fa-regular fa-comments"></i></div>` +
          `<div class="store-state-title">目前還沒有評價</div>` +
          `<div class="store-state-msg">完成預約並體驗後，您也可以留下您的回饋</div>` +
        `</div>`;
    } else {
      const list = displayEvals.slice(0, 12).map(renderReviewCard).join("");
      reviewsContent =
        `<div class="sd-review-list">${list}</div>` +
        `<div class="sd-review-more"><a href="#">查看全部 ${totalReviews} 則評價 <i class="fa-solid fa-arrow-right"></i></a></div>`;
    }

    const reviews =
      `<section class="sd-sec">` +
        `<div class="sd-sec-head">` +
          `<h2>顧 客 評 價</h2>` +
          `<a class="more">${totalReviews} 則評價</a>` +
        `</div>` +
        `<div class="sd-review-summary">` +
          `<div class="sd-score-block">` +
            `<div class="num">${avgScore.toFixed(1)}</div>` +
            `<div class="stars">${renderStars(avgScore)}</div>` +
            `<div class="count">${totalReviews} 則評價</div>` +
          `</div>` +
          `<div class="sd-score-bars">` +
            renderScoreBar("5★", pct(5)) +
            renderScoreBar("4★", pct(4)) +
            renderScoreBar("3★", pct(3)) +
            renderScoreBar("2★", pct(2)) +
            renderScoreBar("1★", pct(1)) +
          `</div>` +
        `</div>` +
        reviewsContent +
      `</section>`;

    /* === 特約商家（API 文件無此 endpoint，先用 Coming Soon 佔位） === */
    const partners =
      `<section class="sd-sec">` +
        `<div class="sd-sec-head">` +
          `<h2>區 域 特 約 商 家</h2>` +
          `<span class="sd-sec-tag">即將上線</span>` +
        `</div>` +
        `<div class="sd-partners-placeholder">` +
          `<i class="fa-solid fa-store-alt"></i>` +
          `<div class="sd-partners-title">${s.region.label} 特約商家專區</div>` +
          `<div class="sd-partners-msg">本店所屬區域的合作商家優惠資訊即將於此呈現</div>` +
        `</div>` +
      `</section>`;

    dom.body.innerHTML = stats + gallery + staffSection + reviews + partners;
  }

  /* === 渲染單則評價卡（顯示客人首字頭像，不顯示店員照） === */
  function renderReviewCard(ev) {
    const stars = renderStars(ev.score);
    const memberName = (ev.memberName || "匿名顧客").trim();
    /* 取客人姓名最後一字作為頭像（如「陳小姐」→「陳」、「李先生」→「李」） */
    const initial = memberName.charAt(0) || "客";
    /* 用一致性 hash 給每位客人不同色調 */
    const hue = stringToHue(memberName);
    const avatarStyle = `background: linear-gradient(135deg, hsl(${hue}, 35%, 65%) 0%, hsl(${hue}, 30%, 50%) 100%);`;

    return (
      `<div class="sd-review-card">` +
        `<div class="sd-review-head">` +
          `<div class="sd-review-avatar" style="${avatarStyle}">${initial}</div>` +
          `<div class="sd-review-info">` +
            `<div class="sd-review-member">${memberName}</div>` +
            `<div class="sd-review-staff">給 ${ev.empName} 的評價</div>` +
          `</div>` +
          `<div class="sd-review-score">${stars}</div>` +
        `</div>` +
        (ev.content ? `<div class="sd-review-content">${ev.content}</div>` : "") +
      `</div>`
    );
  }

  /* 把字串轉成 hue 值（0-360）讓相同名字永遠是同色 */
  function stringToHue(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (h << 5) - h + s.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h) % 360;
  }

  /* === 把分數轉成 ★★★★☆ === */
  function renderStars(score) {
    const n = Math.round(score || 0);
    let s = "";
    for (let i = 0; i < 5; i++) s += i < n ? "★" : "☆";
    return s;
  }

  /* === 把職稱／榮譽文字映射到合適的 icon ===
     依關鍵字判斷，找不到時用通用 icon */
  function honorIcon(text) {
    const t = String(text || "");
    if (/冠軍|王牌/.test(t)) return "fa-solid fa-trophy";
    if (/金|gold|白金|platinum/i.test(t)) return "fa-solid fa-medal";
    if (/銀|silver/i.test(t)) return "fa-solid fa-medal";
    if (/驗光生|驗光師|驗配/.test(t)) return "fa-solid fa-eye";
    if (/AI|認證/.test(t)) return "fa-solid fa-certificate";
    if (/隱形/.test(t)) return "fa-regular fa-circle";
    if (/多焦|漸進/.test(t)) return "fa-solid fa-glasses";
    if (/光學|鏡片/.test(t)) return "fa-solid fa-magnifying-glass-plus";
    if (/微笑|服務|親切/.test(t)) return "fa-regular fa-face-smile";
    if (/聖誕|祝福|大使/.test(t)) return "fa-solid fa-gift";
    if (/店長|店長職憑/.test(t)) return "fa-solid fa-crown";
    if (/副店長/.test(t)) return "fa-solid fa-user-tie";
    if (/門市管理|管理者|經理|店主/.test(t)) return "fa-solid fa-user-shield";
    if (/區長/.test(t)) return "fa-solid fa-map-location-dot";
    if (/樂活人/.test(t)) return "fa-solid fa-leaf";
    return "fa-solid fa-star";
  }

  /* === role 圖示（職稱專用，較精簡）=== */
  function roleIcon(role) {
    const t = String(role || "");
    if (/區長/.test(t)) return "fa-solid fa-map-location-dot";
    if (/店長/.test(t) && !/副/.test(t)) return "fa-solid fa-crown";
    if (/副店長/.test(t)) return "fa-solid fa-user-tie";
    return "fa-regular fa-user";
  }

  function renderStaffCard(emp, isTop) {
    const rawPhoto = emp.photos && emp.photos[0];
    const photo = (rawPhoto && String(rawPhoto).trim()) ? rawPhoto : "";
    const hasPhoto = !!photo;

    /* 職稱（role 優先，否則 jobtitle） */
    const roleText = (emp.role || emp.jobtitle || "").trim();

    /* === 榮譽 / 獎章列表 ===
       支援兩種 schema：
       - emp.honor (string)         單一榮譽（後台主要欄位、視為 featured）
       - emp.honors (array)         多榮譽，可能是 string 或 { title, top|featured|highlight }
       featured 為 true 的會排前面且有金邊強調 */
    const honorItems = [];
    if (emp.honor) {
      honorItems.push({ title: emp.honor.trim(), featured: true });
    }
    (emp.honors || []).forEach(h => {
      if (typeof h === "string") {
        honorItems.push({ title: h.trim(), featured: false });
      } else if (h && h.title) {
        honorItems.push({
          title: h.title.trim(),
          featured: !!(h.top || h.featured || h.highlight)
        });
      }
    });
    /* 依 title 去重 */
    const seen = {};
    const honors = [];
    honorItems.forEach(it => {
      if (it.title && !seen[it.title]) {
        seen[it.title] = true;
        honors.push(it);
      }
    });
    /* featured 排前 */
    honors.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
    const topHonors = honors.slice(0, 4);

    /* 獎章 HTML：使用設計感緞帶圖示，不用 fa-icon */
    const badges = topHonors.map(h => {
      const cls = h.featured ? "sd-honor featured" : "sd-honor";
      return (
        `<div class="${cls}" title="${h.title}">` +
          `<span class="sd-honor-medal">${medalSvg(h.featured)}</span>` +
          `<span class="sd-honor-text">${h.title}</span>` +
        `</div>`
      );
    }).join("");

    /* 王牌徽章（左上）*/
    const topBadge = isTop
      ? `<div class="sd-staff-flag"><i class="fa-solid fa-award"></i> 王 牌 顧 問</div>`
      : "";

    /* 評分（真值優先，沒值就用 seed 假分數 4.7~4.9） */
    const fakeScore = (seededRandomInt(emp.erpid || emp.name, 47, 49) / 10).toFixed(1);
    const score = emp.averageScore != null
      ? emp.averageScore.toFixed(1)
      : fakeScore;

    /* 評價數（真值優先，沒足夠評論就用 seed 假數字 30~200） */
    const realReviewCount = (emp.evaluationList && emp.evaluationList.length) || 0;
    const reviewCount = realReviewCount >= 10
      ? realReviewCount
      : seededRandomInt(emp.erpid || emp.name, 30, 200);

    /* 簡介 ─ 完整顯示，不再切斷 */
    const intro = (emp.introduction || "").trim();

    /* 頭像 — img 載入失敗時自動切換成 fallback */
    const photoBlock = hasPhoto
      ? `<img class="sd-staff-photo" src="${photo}" alt="${emp.name || ''}" loading="lazy" ` +
          `onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">` +
        `<div class="sd-staff-photo-fallback" style="display:none"><i class="fa-regular fa-user"></i></div>`
      : `<div class="sd-staff-photo-fallback"><i class="fa-regular fa-user"></i></div>`;

    return (
      `<article class="sd-staff-card${isTop ? " top" : ""}">` +
        /* === 上半：照片滿版填滿卡片頂部 === */
        `<div class="sd-staff-photo-wrap">` +
          photoBlock +
          topBadge +
        `</div>` +

        /* === 下半：內容區 === */
        `<div class="sd-staff-body">` +
          /* 姓名 + 評分一行 */
          `<div class="sd-staff-head">` +
            `<div class="sd-staff-name">${emp.name || ""}</div>` +
            (score
              ? `<div class="sd-staff-rating">` +
                  `<i class="fa-solid fa-star"></i>` +
                  `<span class="num">${score}</span>` +
                  (reviewCount > 0 ? `<span class="count">(${reviewCount})</span>` : "") +
                `</div>`
              : "") +
          `</div>` +
          /* 職稱 */
          (roleText ? `<div class="sd-staff-role">${roleText}</div>` : "") +
          /* 簡介（不切斷）*/
          (intro
            ? `<p class="sd-staff-intro">${intro}</p>`
            : `<p class="sd-staff-intro placeholder">提 供 專 業 配 鏡 諮 詢 服 務</p>`) +
          /* 獎章區（獨立 block）*/
          (badges
            ? `<div class="sd-staff-honors">${badges}</div>`
            : "") +
          /* CTA */
          `<div class="sd-staff-foot">` +
            `<div class="sd-staff-foot-meta">線上立即預約</div>` +
            `<button class="sd-staff-book" data-book="${emp.erpid}" type="button">` +
              `跟我預約 <i class="fa-solid fa-arrow-right"></i>` +
            `</button>` +
          `</div>` +
        `</div>` +
      `</article>`
    );
  }

  /* === 獎章 SVG（緞帶 + 圓徽） === */
  function medalSvg(featured) {
    /* featured 時：金色立體 + 星形；一般：青銅色簡化版 */
    if (featured) {
      return (
        `<svg viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
          /* 緞帶左 */
          `<path d="M8 2 L12 14 L18 18 L14 4 Z" fill="#A8412B"/>` +
          `<path d="M8 2 L12 14 L15 12 L11 2 Z" fill="#C95440"/>` +
          /* 緞帶右 */
          `<path d="M28 2 L24 14 L18 18 L22 4 Z" fill="#A8412B"/>` +
          `<path d="M28 2 L24 14 L21 12 L25 2 Z" fill="#C95440"/>` +
          /* 圓徽底（金色漸層）*/
          `<circle cx="18" cy="23" r="11" fill="#B89154"/>` +
          `<circle cx="18" cy="23" r="11" fill="url(#gold-grad)"/>` +
          /* 金色內圈 */
          `<circle cx="18" cy="23" r="8" fill="none" stroke="#A57F44" stroke-width="0.5"/>` +
          /* 中央星 */
          `<path d="M18 17 L19.5 21 L23.5 21 L20.5 23.5 L22 27.5 L18 25 L14 27.5 L15.5 23.5 L12.5 21 L16.5 21 Z" fill="#fff" opacity="0.95"/>` +
          /* 漸層定義 */
          `<defs>` +
            `<linearGradient id="gold-grad" x1="0" y1="0" x2="0" y2="1">` +
              `<stop offset="0%" stop-color="#F4D27A"/>` +
              `<stop offset="100%" stop-color="#B89154"/>` +
            `</linearGradient>` +
          `</defs>` +
        `</svg>`
      );
    }
    /* 一般獎章（簡化版）*/
    return (
      `<svg viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
        /* 緞帶（淺色）*/
        `<path d="M10 4 L14 14 L18 16 L13 6 Z" fill="#7A6B5C"/>` +
        `<path d="M26 4 L22 14 L18 16 L23 6 Z" fill="#7A6B5C"/>` +
        /* 圓徽 */
        `<circle cx="18" cy="22" r="10" fill="#C9BCA3"/>` +
        `<circle cx="18" cy="22" r="10" fill="url(#silver-grad)"/>` +
        `<circle cx="18" cy="22" r="7" fill="none" stroke="#8F7E66" stroke-width="0.5"/>` +
        /* 中央簡化圖案：交叉葉 */
        `<path d="M18 17 L18 27 M15 22 L21 22" stroke="#fff" stroke-width="1.5" stroke-linecap="round" opacity="0.9"/>` +
        `<defs>` +
          `<linearGradient id="silver-grad" x1="0" y1="0" x2="0" y2="1">` +
            `<stop offset="0%" stop-color="#E8DED1"/>` +
            `<stop offset="100%" stop-color="#A89882"/>` +
          `</linearGradient>` +
        `</defs>` +
      `</svg>`
    );
  }

  function renderScoreBar(label, pct) {
    return (
      `<div class="sd-score-bar">` +
        `<span class="lbl">${label}</span>` +
        `<div class="bar"><div class="fill" style="width:${pct}%;"></div></div>` +
        `<span class="pct">${pct}%</span>` +
      `</div>`
    );
  }

  function openNavigation(s) {
    const q = encodeURIComponent(s.address);
    const url = s.lat && s.lng
      ? `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`
      : `https://www.google.com/maps/search/?api=1&query=${q}`;
    window.open(url, "_blank");
  }

  /* === 開啟預約 modal ===
     若 booking-modal.js 載入了就用它，否則 fallback alert */
  function openBookingModal(employeeErpId) {
    if (window.LohasBookingModal && typeof window.LohasBookingModal.open === "function") {
      window.LohasBookingModal.open({
        store: state.store,
        employees: state.employees,
        preselectEmployeeErpId: employeeErpId
      });
    } else {
      alert("預約功能載入中… (booking-modal.js 尚未載入)");
    }
  }

  function computeAverage(arr) {
    if (!arr || arr.length === 0) return null;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  /* === 狀態畫面 === */
  function renderLoading() {
    dom.body.innerHTML =
      '<div class="store-state">' +
        '<div class="store-spinner"></div>' +
        '<div class="store-state-title" style="margin-top:14px;">載入門市資料中</div>' +
      '</div>';
  }

  function renderError(err) {
    console.error(err);
    dom.body.innerHTML =
      '<div class="store-state">' +
        '<div class="store-state-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>' +
        '<div class="store-state-title">無法載入此門市</div>' +
        `<div class="store-state-msg">${err.message || "請稍後再試"}</div>` +
        '<button class="btn-retry" data-retry>重新載入</button>' +
      '</div>';
    const retry = dom.body.querySelector("[data-retry]");
    if (retry) retry.addEventListener("click", loadAll);
  }

  function renderNotFound(msg) {
    dom.body.innerHTML =
      '<div class="store-state">' +
        '<div class="store-state-icon"><i class="fa-regular fa-circle-question"></i></div>' +
        '<div class="store-state-title">找不到此門市</div>' +
        `<div class="store-state-msg">${msg}</div>` +
        '<a class="btn-retry" href="allstore.html">回門市列表</a>' +
      '</div>';
  }

})();
