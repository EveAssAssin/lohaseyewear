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
    dom.bookPrompt = document.getElementById("sd-book-prompt");
    dom.body = document.getElementById("sd-body");
    dom.right = document.getElementById("sd-right");
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
    renderBookingPrompt();
    renderBody();
    renderRightPanel();
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

  function renderBookingPrompt() {
    /* 簡單顯示「本店預約服務」訊息列；之後可串 getRounds 拿即時剩餘時段 */
    const remaining = Math.max(state.employees.length * 3, 5);
    dom.bookPrompt.innerHTML =
      `<div class="booking-prompt-left">` +
        `<div class="booking-prompt-icon"><i class="fa-regular fa-calendar-check"></i></div>` +
        `<div class="booking-prompt-text">` +
          `<b>本店預計尚有 ${remaining} 個預約時段</b>` +
          `<span>選擇驗光師 → 服務項目 → 日期時段，1 分鐘完成預約</span>` +
        `</div>` +
      `</div>` +
      `<button class="booking-prompt-btn" data-book="any">` +
        `立即預約 <i class="fa-solid fa-arrow-right"></i>` +
      `</button>`;
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
            `<a class="more">查看完整介紹 <i class="fa-solid fa-arrow-right"></i></a>` +
          `</div>` +
          `<div class="sd-staff-row">${cards}</div>` +
        `</section>`;
    }

    /* === 真實評價彙整 ===
       把每位員工的 evaluationList 全部彙整，按時間（無 date 欄位則按出現順序）顯示。
       分數分布也基於真實評價計算。 */
    const allEvals = [];
    e.forEach(emp => {
      (emp.evaluationList || []).forEach(ev => {
        allEvals.push({
          ...ev,
          empName: emp.name,
          empPhoto: (emp.photos && emp.photos[0]) || ""
        });
      });
    });

    /* 分數分布計算 */
    const dist = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    allEvals.forEach(ev => {
      const s = Math.round(ev.score);
      if (s >= 1 && s <= 5) dist[s]++;
    });
    const totalReviews = allEvals.length;
    const pct = (n) => totalReviews > 0 ? Math.round((dist[n] / totalReviews) * 100) : 0;

    /* Reviews block */
    let reviewsContent;
    if (totalReviews === 0) {
      reviewsContent =
        `<div class="store-state" style="padding:30px;">` +
          `<div class="store-state-icon"><i class="fa-regular fa-comments"></i></div>` +
          `<div class="store-state-title">目前還沒有評價</div>` +
          `<div class="store-state-msg">完成預約並體驗後，您也可以留下您的回饋</div>` +
        `</div>`;
    } else {
      /* 評價列表（最多顯示 6 則）*/
      const list = allEvals.slice(0, 6).map(renderReviewCard).join("");
      reviewsContent =
        `<div class="sd-review-list">${list}</div>` +
        (allEvals.length > 6
          ? `<div class="sd-review-more"><a href="#">查看全部 ${allEvals.length} 則評價 <i class="fa-solid fa-arrow-right"></i></a></div>`
          : "");
    }

    const reviews =
      `<section class="sd-sec">` +
        `<div class="sd-sec-head">` +
          `<h2>顧 客 評 價</h2>` +
          (totalReviews > 0 ? `<a class="more">${totalReviews} 則真實評價</a>` : "") +
        `</div>` +
        `<div class="sd-review-summary">` +
          `<div class="sd-score-block">` +
            `<div class="num">${avgScore.toFixed(1)}</div>` +
            `<div class="stars">${renderStars(avgScore)}</div>` +
            `<div class="count">${totalReviews > 0 ? totalReviews + " 則評價" : "依驗光師平均"}</div>` +
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

    /* 頂部角標：王牌顧問 or 職稱 */
    const topPin = isTop
      ? `<div class="sd-staff-pin gold"><i class="fa-solid fa-star"></i> 王 牌 顧 問</div>`
      : "";
    const rolePin = roleText
      ? `<div class="sd-staff-pin role"><i class="${roleIcon(roleText)}"></i> ${roleText}</div>`
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
          rolePin +
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

  function renderRightPanel() {
    const s = state.store;
    const e = state.employees;

    dom.right.innerHTML =
      `<div class="sd-right-pad">` +
        /* Map preview */
        `<div class="store-map-preview" data-action="map">` +
          `<div class="store-map-road d"></div>` +
          `<div class="store-map-road h"></div>` +
          `<div class="store-map-road v"></div>` +
          `<div class="store-map-pin-pulse"></div>` +
          `<div class="store-map-pin-big">` +
            `<div class="store-map-pin-body"><i class="fa-solid fa-store"></i></div>` +
          `</div>` +
          `<div class="store-map-overlay">` +
            `<i class="fa-solid fa-location-dot"></i> <b>${s.name}</b> · 開啟地圖` +
          `</div>` +
        `</div>` +

        /* Info list */
        `<div class="sd-info-list">` +
          (s.address ? `<div class="store-info-row">` +
            `<div class="store-info-row-icon"><i class="fa-solid fa-location-dot"></i></div>` +
            `<div class="store-info-row-content"><b>${s.address}</b><span>點擊開啟導航</span></div>` +
            `<span class="store-info-row-arr"><i class="fa-solid fa-chevron-right"></i></span>` +
          `</div>` : "") +
          (s.phone ? `<div class="store-info-row">` +
            `<div class="store-info-row-icon"><i class="fa-solid fa-phone"></i></div>` +
            `<div class="store-info-row-content"><b>${s.phone}</b><span>WhatsApp / LINE 同號</span></div>` +
            `<span class="store-info-row-arr"><i class="fa-solid fa-chevron-right"></i></span>` +
          `</div>` : "") +
          (s.worktime ? `<div class="store-info-row">` +
            `<div class="store-info-row-icon"><i class="fa-regular fa-clock"></i></div>` +
            `<div class="store-info-row-content"><b>${s.worktime}</b><span>除夕公休 · 年初一正常營業</span></div>` +
          `</div>` : "") +
        `</div>` +

        /* Booking CTA */
        `<div class="booking-cta-card" style="margin-top:24px;">` +
          `<span class="tag"><i class="fa-solid fa-bolt"></i> RESERVATION</span>` +
          `<h3>立 即 預 約 ${s.name}</h3>` +
          `<p>線上預約享 NT$200 折抵 · 任選驗光師專屬時段</p>` +
          `<div class="booking-cta-meta">` +
            `<div class="booking-cta-meta-item"><b>${e.length}</b>位驗光師</div>` +
            `<div class="booking-cta-meta-item"><b>${Math.max(e.length * 3, 5)}</b>今日時段</div>` +
            `<div class="booking-cta-meta-item"><b>1m</b>完成預約</div>` +
          `</div>` +
          `<button class="booking-cta-btn" data-book="any">` +
            `<i class="fa-regular fa-calendar-check"></i> 開始預約` +
          `</button>` +
        `</div>` +

        /* Features list — 從 description 拆，或用預設 */
        `<div class="sd-feat-block">` +
          `<h4><i class="fa-solid fa-circle-check"></i> 本店特色服務</h4>` +
          `<ul class="sd-feat-ul">` +
            renderFeatures(s) +
          `</ul>` +
        `</div>` +
      `</div>`;

    /* 地圖點擊開啟導航 */
    const mapEl = dom.right.querySelector(".store-map-preview");
    if (mapEl) mapEl.addEventListener("click", () => openNavigation(s));
  }

  function renderFeatures(store) {
    /* 若 store.description 有條列就用，否則用預設 */
    if (store.description) {
      const lines = store.description.split(/[\n\r、，]/).map(s => s.trim()).filter(Boolean).slice(0, 6);
      if (lines.length >= 3) return lines.map(l => `<li>${l}</li>`).join("");
    }
    return [
      "免費鏡架調整與清洗",
      "會員專屬保固方案",
      "驗光諮詢免收費",
      "多焦點鏡片試戴"
    ].map(l => `<li>${l}</li>`).join("");
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
