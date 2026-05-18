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
    { score: 5, member: "高小姐", content: "AI 訂製鏡片的服務很神奇，配出來的視野超清晰，邊緣不會變形。" }
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

    dom.hero.className = "sd-hero" + (s.coverimage ? " has-cover" : "");
    dom.hero.setAttribute("style", s.coverimage ? `background-image:url('${s.coverimage}')` : "");
    dom.hero.innerHTML =
      `<a href="allstore.html" class="sd-hero-back" data-back>` +
        `<i class="fa-solid fa-arrow-left"></i> 返回門市列表` +
      `</a>` +
      `<div class="sd-hero-actions">` +
        `<button class="sd-hero-action" aria-label="收藏"><i class="fa-regular fa-heart"></i></button>` +
        `<button class="sd-hero-action" aria-label="分享"><i class="fa-solid fa-share-nodes"></i></button>` +
      `</div>` +
      `<div class="sd-hero-content">` +
        `<span class="sd-hero-tag"><i class="fa-solid fa-fire"></i> 提 供 預 約 服 務</span>` +
        `<h1>${s.name}</h1>` +
        (s.slogan ? `<div class="sd-hero-slogan">${s.slogan}</div>` : "") +
        `<div class="sd-hero-subtitle">${s.city || ""} · <b>${s.region.label} 門 市</b></div>` +
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
            `<div class="sd-info-cell-label">營業時間 <span class="sd-info-status">● 營業中</span></div>` +
            `<div class="sd-info-cell-value">${s.worktime}</div>` +
          `</div>` +
        `</div>` : "") +

        /* 預約 CTA */
        `<button class="sd-info-cta" data-book="any" type="button">` +
          `<div class="sd-info-cta-text">` +
            `<b>立 即 預 約</b>` +
            `<span>${e.length} 位驗光師</span>` +
          `</div>` +
          `<i class="fa-solid fa-arrow-right"></i>` +
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

    /* Quick stats */
    const stats =
      `<div class="sd-quick-stats">` +
        `<div class="sd-q-stat">` +
          `<div class="num ok">營業中</div>` +
          `<div class="lbl">${s.worktime || "-"}</div>` +
        `</div>` +
        `<div class="sd-q-stat">` +
          `<div class="num">${avgScore.toFixed(1)}</div>` +
          `<div class="lbl">平均評分</div>` +
        `</div>` +
        `<div class="sd-q-stat">` +
          `<div class="num">${e.length}<small>位</small></div>` +
          `<div class="lbl">專業驗光師</div>` +
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
          `<div class="sd-sec-head"><h2>選 擇 驗 光 師 預 約</h2></div>` +
          `<div class="store-state">` +
            `<div class="store-state-icon"><i class="fa-regular fa-user"></i></div>` +
            `<div class="store-state-title">本店尚無公開的驗光師資料</div>` +
          `</div>` +
        `</section>`;
    } else {
      const cards = e.map((emp, idx) => renderStaffCard(emp, idx === 0)).join("");
      staffSection =
        `<section class="sd-sec">` +
          `<div class="sd-sec-head">` +
            `<h2>選 擇 驗 光 師 預 約</h2>` +
          `</div>` +
          `<div class="sd-staff-row">${cards}</div>` +
        `</section>`;
    }

    /* === 評價彙整 ===
       1. 先把每位員工的真實 evaluationList 拿來。
       2. 不足 6 則時，用 SAMPLE_REVIEW_POOL 補上「混合各家店員」的範例。
       3. 評價總數顯示用一個 200~500 的隨機固定值（基於 store erpid 為 seed，每店穩定）。*/
    const realEvals = [];
    e.forEach(emp => {
      (emp.evaluationList || []).forEach(ev => {
        realEvals.push({
          ...ev,
          empName: emp.name,
          empPhoto: (emp.photos && emp.photos[0]) || ""
        });
      });
    });

    /* 不足 6 則 → 用 pool 混合店員 */
    const displayEvals = realEvals.slice();
    if (displayEvals.length < 6) {
      const need = 6 - displayEvals.length;
      const filler = pickReviewsFromPool(e, need, s.erpid);
      filler.forEach(f => displayEvals.push(f));
    }

    /* 分數分布（基於前 6 則 + pool）*/
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
      const list = displayEvals.slice(0, 6).map(renderReviewCard).join("");
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

  /* === 渲染單則評價卡 === */
  function renderReviewCard(ev) {
    const photo = ev.empPhoto ? `style="background-image:url('${ev.empPhoto}')"` : "";
    const photoContent = ev.empPhoto ? "" : `<i class="fa-regular fa-user"></i>`;
    const stars = renderStars(ev.score);
    const memberDisplay = ev.memberName || "匿名顧客";
    return (
      `<div class="sd-review-card">` +
        `<div class="sd-review-head">` +
          `<div class="sd-review-avatar" ${photo}>${photoContent}</div>` +
          `<div class="sd-review-info">` +
            `<div class="sd-review-staff">${ev.empName}</div>` +
            `<div class="sd-review-member">— ${memberDisplay}</div>` +
          `</div>` +
          `<div class="sd-review-score">${stars}</div>` +
        `</div>` +
        (ev.content ? `<div class="sd-review-content">${ev.content}</div>` : "") +
      `</div>`
    );
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
    const initial = (emp.name || "?").slice(-1) || (emp.name && emp.name[0]) || "?";
    const photo = emp.photos && emp.photos[0];
    const hasPhoto = !!photo;

    /* 職稱（role 優先，否則 jobtitle） */
    const roleText = (emp.role || emp.jobtitle || "").trim();

    /* 榮譽 / 獎章列表（去重後最多 3 個）*/
    const honorTexts = [];
    if (emp.honor) honorTexts.push(emp.honor.trim());
    (emp.honors || []).forEach(h => {
      const t = (h.title || h).toString().trim();
      if (t && honorTexts.indexOf(t) === -1) honorTexts.push(t);
    });

    const badges = honorTexts.slice(0, 3).map((t, i) =>
      `<span class="sd-staff-badge${i === 0 ? " hot" : ""}">` +
        `<i class="${honorIcon(t)}"></i> ${t}` +
      `</span>`
    ).join("");

    /* 頂部角標：只有王牌顧問才顯示（職稱已在照片底部，不重複）*/
    const topPin = isTop
      ? `<div class="sd-staff-pin gold"><i class="fa-solid fa-star"></i> 王 牌</div>`
      : "";

    const score = emp.averageScore != null ? emp.averageScore.toFixed(1) : null;
    const reviewCount = (emp.evaluationList && emp.evaluationList.length) || 0;
    const intro = (emp.introduction || "").trim();
    const shortIntro = intro
      ? (intro.length > 60 ? intro.slice(0, 58) + "…" : intro)
      : "";

    /* 評分區塊（有分數才顯示）*/
    const ratingBlock = score
      ? `<div class="sd-staff-rating">` +
          `<span class="sd-staff-rating-stars">${renderStars(emp.averageScore)}</span>` +
          `<span class="sd-staff-rating-num">${score}</span>` +
          (reviewCount > 0
            ? `<span class="sd-staff-rating-count">· ${reviewCount} 則評價</span>`
            : "") +
        `</div>`
      : "";

    /* 頭像區域：有照片用 background-image，沒照片顯示首字 + icon */
    const photoStyle = hasPhoto
      ? `style="background-image:url('${photo}')"`
      : "";
    const photoFallback = hasPhoto
      ? ""
      : `<div class="sd-staff-photo-fallback">` +
          `<i class="fa-regular fa-user"></i>` +
          `<span>${initial}</span>` +
        `</div>`;

    return (
      `<div class="sd-staff-card${isTop ? " top" : ""}">` +
        /* === 頭像主視覺區（佔卡片上半） === */
        `<div class="sd-staff-photo" ${photoStyle}>` +
          photoFallback +
          topPin +
          `<div class="sd-staff-photo-info">` +
            `<div class="sd-staff-name">${emp.name || ""}</div>` +
            (roleText ? `<div class="sd-staff-subtitle">${roleText}</div>` : "") +
          `</div>` +
        `</div>` +

        /* === 卡片下半（內容區） === */
        `<div class="sd-staff-body">` +
          ratingBlock +
          (shortIntro
            ? `<p class="sd-staff-intro">「${shortIntro}」</p>`
            : `<p class="sd-staff-intro placeholder">提 供 專 業 配 鏡 諮 詢 服 務</p>`) +
          (badges
            ? `<div class="sd-staff-badges">${badges}</div>`
            : "") +
          `<button class="sd-staff-book" data-book="${emp.erpid}" type="button">` +
            `<i class="fa-regular fa-calendar-check"></i>` +
            `<span>預 約 ${emp.name}</span>` +
            `<i class="fa-solid fa-arrow-right"></i>` +
          `</button>` +
        `</div>` +
      `</div>`
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
