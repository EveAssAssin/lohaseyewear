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

    /* 如果 URL 有 #book，自動開啟預約 */
    if (location.hash === "#book") {
      setTimeout(openBookingModal, 300);
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
      /* 並行：getAllStores + getEmployeesByGroup
         說明：API 文件中沒有「依 erpid 取單一店家」的 API，
         所以先取全部再 filter。getEmployeesByGroup 用 group ERP 直接拿到員工。 */
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
        .filter(e => e && !e.isLeave && !e.isFreeze);

      renderAll();
    } catch (err) {
      renderError(err);
    }
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

    /* Reviews（先用 placeholder；未來可逐人呼叫 getEmployeeDetail 拿到 evaluations 後彙整） */
    const reviews =
      `<section class="sd-sec">` +
        `<div class="sd-sec-head">` +
          `<h2>顧 客 評 價</h2>` +
        `</div>` +
        `<div class="sd-review-summary">` +
          `<div class="sd-score-block">` +
            `<div class="num">${avgScore.toFixed(1)}</div>` +
            `<div class="stars">★★★★★</div>` +
            `<div class="count">依驗光師平均</div>` +
          `</div>` +
          `<div class="sd-score-bars">` +
            renderScoreBar("5★", 78) +
            renderScoreBar("4★", 16) +
            renderScoreBar("3★", 4) +
            renderScoreBar("2★", 1) +
            renderScoreBar("1★", 1) +
          `</div>` +
        `</div>` +
        `<div class="store-state" style="padding:24px;">` +
          `<div class="store-state-msg">完整評價將於下一階段串接 <code>getemployeeinfobyerpid</code> 取得</div>` +
        `</div>` +
      `</section>`;

    dom.body.innerHTML = stats + gallery + staffSection + reviews;
  }

  function renderStaffCard(emp, isTop) {
    const initial = (emp.name || "?").slice(-1) || emp.name[0] || "?";
    const photo = emp.photos && emp.photos[0];
    const avatarStyle = photo ? `style="background-image:url('${photo}')"` : "";
    const avatarContent = photo ? "" : initial;

    const badges = [];
    if (emp.honor) badges.push(`<span class="sd-staff-badge hot">${emp.honor}</span>`);
    if (isTop) badges.push(`<span class="sd-staff-badge gold">王牌</span>`);
    if (emp.jobtitle) {
      emp.jobtitle.split(/[·,，、]/).slice(0, 2).forEach(t => {
        const tt = t.trim();
        if (tt) badges.push(`<span class="sd-staff-badge">${tt}</span>`);
      });
    }

    const score = emp.averageScore != null ? emp.averageScore.toFixed(1) : "—";

    return (
      `<div class="sd-staff-card${isTop ? " top" : ""}">` +
        `<div class="sd-staff-avatar" ${avatarStyle}>${avatarContent}</div>` +
        `<div class="sd-staff-name">${emp.name || ""}</div>` +
        `<div class="sd-staff-title">${emp.role || emp.jobtitle || ""}</div>` +
        `<div class="sd-staff-badges">${badges.join("")}</div>` +
        `<div class="sd-staff-stats">` +
          `<div>滿意度<b>${score}</b></div>` +
          `<div>${emp.honors.length > 0 ? "事蹟<b>" + emp.honors.length + "</b>" : "資歷<b>—</b>"}</div>` +
        `</div>` +
        `<button class="sd-staff-book" data-book="${emp.erpid}">` +
          `<i class="fa-regular fa-calendar-check"></i> 預約 ${emp.name}` +
        `</button>` +
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
