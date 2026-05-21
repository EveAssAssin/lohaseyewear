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

  /* === 從所有員工的真實 evaluationList 蒐集評論,組成門市總評論列表 ===
     每則評論加上 empName / empPhoto 以便顯示「給 XX 的評價」
     輸出按 score 高→低、再按原始順序排列 */
  function collectAllEvaluations(employees) {
    const out = [];
    (employees || []).forEach(emp => {
      const list = emp.evaluationList || [];
      const photo = (emp.photos && emp.photos[0]) || "";
      list.forEach(ev => {
        out.push({
          score: ev.score,
          content: ev.content,
          memberName: ev.memberName,
          empName: emp.name,
          empPhoto: photo
        });
      });
    });
    /* 高分優先 */
    out.sort((a, b) => (b.score || 0) - (a.score || 0));
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
        return;
      }
      /* 員工卡 → 查看 N 則完整評價 */
      const revBtn = e.target.closest("[data-staff-reviews]");
      if (revBtn) {
        e.preventDefault();
        openStaffReviewModal(revBtn.dataset.staffReviews);
        return;
      }
    });

    /* ESC 關閉評論彈窗 */
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && document.getElementById("sd-review-modal")) {
        closeStaffReviewModal();
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

  /* === 並行抓每位員工的詳細資料 + 真實評價 ===
     兩支 API 並行:
       getEmployeeDetail        → 拿員工介紹、照片、榮譽
       getEvaluationByEmployee  → 拿真實評論清單(新 API,可拿較多筆) */
  async function loadEmployeeDetails() {
    if (!state.employees || state.employees.length === 0) return;

    /* 不指定店員(9999999)的不要打 API */
    const realEmployees = state.employees.filter(e =>
      e.erpid && !/^9{4,}\d*$/.test(e.erpid)
    );

    /* 為每位員工發起 2 支並行請求(detail + evaluation),共 2N 個 request 一起發 */
    const requests = realEmployees.map(e => ({
      emp: e,
      detail: storeApi.getEmployeeDetail(e.erpid, 10),      // detail 用 amount=10 (avoid amount=0 整支失敗)
      evals:  storeApi.getEvaluationByEmployee(e.erpid, 99999) // 評價清單實質無上限
    }));

    await Promise.all(requests.map(async (r) => {
      /* detail:介紹、照片、榮譽 + 內建 evaluations(備案) */
      let detailEvals = null;
      try {
        const dRes = await r.detail;
        const detail = storeData.normalizeEmployeeDetail(dRes);
        if (detail) {
          r.emp.introduction = detail.introduction || r.emp.introduction;
          r.emp.photos = detail.photos && detail.photos.length > 0 ? detail.photos : r.emp.photos;
          r.emp.honors = detail.honors && detail.honors.length > 0 ? detail.honors : r.emp.honors;
          /* detail 內附的評論先存著,新 API 失敗時用 */
          if (detail.evaluationList && detail.evaluationList.length > 0) {
            detailEvals = {
              averageScore: detail.averageScore,
              evaluationList: detail.evaluationList
            };
          }
        }
      } catch (e) {
        console.warn("[store] detail 失敗", r.emp.name, e);
      }
      /* evaluation:真實評論清單 + 平均分(新 API 為主) */
      try {
        const eRes = await r.evals;
        const evals = storeData.normalizeEvaluationResponse(eRes);
        if (evals.evaluationList && evals.evaluationList.length > 0) {
          r.emp.averageScore = evals.averageScore;
          r.emp.evaluationList = evals.evaluationList;
        } else if (detailEvals) {
          /* 新 API 回空陣列 → fallback 到 detail 內附的評論 */
          console.info("[store] evaluation 新 API 回空,用 detail 內附評論 fallback", r.emp.name);
          r.emp.averageScore = detailEvals.averageScore;
          r.emp.evaluationList = detailEvals.evaluationList;
        } else {
          r.emp.evaluationList = [];
        }
      } catch (e) {
        /* 新 API 失敗(BFF 不支援 rsv host 或網路錯)→ fallback */
        console.warn("[store] evaluation 失敗,fallback 到 detail 內附評論", r.emp.name, e);
        if (detailEvals) {
          r.emp.averageScore = detailEvals.averageScore;
          r.emp.evaluationList = detailEvals.evaluationList;
        } else {
          r.emp.evaluationList = r.emp.evaluationList || [];
        }
      }
    }));

    /* 全部回來後重新渲染 */
    renderBody();
    console.log("[store] 員工詳細資料 + 評價載入完成", realEmployees.length, "位");
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

    /* === 評價彙整(全部來自真實 evaluation API)===
       1. 從所有員工的 evaluationList 蒐集真實評論 (高分排前)
       2. 總評論數 = 所有員工真實評論加總(門市總和)
       3. UI 只展示前 12 則,其他用「查看全部」連結 */
    const allEvals = collectAllEvaluations(e);
    const totalReviews = allEvals.length;
    const displayEvals = allEvals.slice(0, 12);

    /* 分數分布(用全部資料而非展示的 12 則,反映門市整體口碑) */
    const dist = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    allEvals.forEach(ev => {
      const sc = Math.round(ev.score);
      if (sc >= 1 && sc <= 5) dist[sc]++;
    });
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
      const list = displayEvals.map(renderReviewCard).join("");
      const moreLink = totalReviews > 12
        ? `<div class="sd-review-more"><a href="#" data-action="show-all-reviews">查看全部 ${totalReviews} 則評價 <i class="fa-solid fa-arrow-right"></i></a></div>`
        : "";
      reviewsContent =
        `<div class="sd-review-list">${list}</div>` +
        moreLink;
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

    /* === 特約商家(資料源:即時互動,目前用 store-data demo 資料) === */
    const partners = renderPartnersSection(s);

    dom.body.innerHTML = stats + gallery + staffSection + reviews + partners;
  }

  /* 特約商家 section:風格 B 雜誌編輯式
     有資料 → 渲染卡片 grid;無資料 → 維持原本「即將上線」placeholder */
  function renderPartnersSection(s) {
    const list = (window.LohasStore && window.LohasStore.data &&
                  typeof window.LohasStore.data.getPartnersByRegion === "function")
      ? window.LohasStore.data.getPartnersByRegion(s.region.key)
      : [];

    if (!list || list.length === 0) {
      return (
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
        `</section>`
      );
    }

    const cards = list.map(p => {
      const imgBlock = p.image
        ? `<div class="sd-partner-img" style="background-image:url('${p.image}')"></div>`
        : `<div class="sd-partner-img sd-partner-img-fallback">` +
            `<i class="fa-solid ${p.icon || "fa-store"}"></i>` +
          `</div>`;
      const link = p.googleCid
        ? `href="https://www.google.com/maps?cid=${p.googleCid}" target="_blank" rel="noopener"`
        : "";
      return (
        `<a class="sd-partner-card" ${link}>` +
          imgBlock +
          `<div class="sd-partner-body">` +
            `<div class="sd-partner-cat">${p.category || ""}</div>` +
            `<div class="sd-partner-name">${p.name || ""}</div>` +
            `<div class="sd-partner-desc">${p.slogan || ""}</div>` +
            `<div class="sd-partner-foot">` +
              `<span class="sd-partner-offer">${p.offer || ""}</span>` +
              (p.googleCid ? `<i class="fa-solid fa-arrow-right"></i>` : "") +
            `</div>` +
          `</div>` +
        `</a>`
      );
    }).join("");

    return (
      `<section class="sd-sec">` +
        `<div class="sd-sec-head">` +
          `<h2>區 域 特 約 商 家</h2>` +
          `<span class="sd-sec-subtitle">${s.region.label} · 樂活會員專屬合作優惠</span>` +
        `</div>` +
        `<div class="sd-partners-grid">${cards}</div>` +
      `</section>`
    );
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

    /* 評分:真實平均分,沒有顯示「-」 */
    const score = emp.averageScore != null
      ? emp.averageScore.toFixed(1)
      : "-";

    /* 評論數:真實值,沒有就是 0 */
    const reviewCount = (emp.evaluationList && emp.evaluationList.length) || 0;

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
          /* === 評論精選(B 樣式:引文 + 查看 N 則按鈕)=== */
          renderStaffReviewBlock(emp) +
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

  /* === 員工評論精選 block(B 樣式) ===
     精選引文取第一筆(score 高的優先,因為 collectAllEvaluations 與這裡都用 sort)
     按鈕點下去 → openStaffReviewModal(erpid) 開彈窗 */
  function renderStaffReviewBlock(emp) {
    const list = emp.evaluationList || [];
    if (list.length === 0) return "";

    /* 取第一筆當精選引文(規格 a) */
    const featured = list[0];
    const content = (featured.content || "").trim();
    if (!content) return "";

    const author = featured.memberName || "顧客";
    const total = list.length;

    return (
      `<div class="sd-staff-review">` +
        `<div class="sd-staff-review-title">顧 客 真 實 評 論</div>` +
        `<div class="sd-staff-review-quote">` +
          `<div class="sd-staff-review-text">${escapeHtml(content)}</div>` +
          `<div class="sd-staff-review-author">— ${escapeHtml(author)}</div>` +
        `</div>` +
        `<button class="sd-staff-review-btn" type="button" ` +
          `data-staff-reviews="${emp.erpid}">` +
          `查看 ${total.toLocaleString()} 則完整評價` +
        `</button>` +
      `</div>`
    );
  }

  /* HTML escape (避免評論裡的 < > & 等字符破壞 HTML 結構) */
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /* ===== 員工評論彈窗(B3 樣式:無限滾動)===== */
  const reviewModalState = {
    emp: null,         // 當前員工
    loadedCount: 10,   // 已載入則數(初始 10,按一次「載入更多」+10)
    perLoad: 10        // 每次載入 10 則
  };

  function openStaffReviewModal(erpid) {
    const emp = state.employees.find(e => String(e.erpid) === String(erpid));
    if (!emp) return;
    reviewModalState.emp = emp;
    reviewModalState.loadedCount = reviewModalState.perLoad;
    document.body.style.overflow = "hidden";
    renderReviewModal();
  }

  function closeStaffReviewModal() {
    const el = document.getElementById("sd-review-modal");
    if (el) el.remove();
    document.body.style.overflow = "";
    reviewModalState.emp = null;
  }

  function renderReviewModal() {
    const emp = reviewModalState.emp;
    if (!emp) return;

    const all = emp.evaluationList || [];
    const total = all.length;
    /* clamp loadedCount */
    const loaded = Math.min(reviewModalState.loadedCount, total);
    const items = all.slice(0, loaded);
    const hasMore = loaded < total;

    const avg = emp.averageScore != null ? emp.averageScore.toFixed(1) : "-";

    /* === 頭部 === */
    const rawPhoto = emp.photos && emp.photos[0];
    const photo = (rawPhoto && String(rawPhoto).trim()) ? rawPhoto : "";
    const avatarBlock = photo
      ? `<img class="sd-rm-avatar" src="${photo}" alt="${emp.name}" ` +
          `onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">` +
        `<div class="sd-rm-avatar-fallback" style="display:none"><i class="fa-regular fa-user"></i></div>`
      : `<div class="sd-rm-avatar-fallback"><i class="fa-regular fa-user"></i></div>`;

    const head =
      `<div class="sd-rm-head">` +
        avatarBlock +
        `<div class="sd-rm-head-info">` +
          `<div class="sd-rm-name">${escapeHtml(emp.name || "")} 的顧客評價</div>` +
          `<div class="sd-rm-sub">${escapeHtml((emp.role || emp.jobtitle || "").trim())}${state.store ? " · " + escapeHtml(state.store.name) : ""}</div>` +
        `</div>` +
        `<div class="sd-rm-stat">` +
          `<div class="sd-rm-stat-stars">${renderStars(emp.averageScore || 0)}</div>` +
          `<div class="sd-rm-stat-num">${avg}</div>` +
          `<div class="sd-rm-stat-meta">${total.toLocaleString()} 則</div>` +
        `</div>` +
        `<button class="sd-rm-close" type="button" data-action="rm-close">✕</button>` +
      `</div>`;

    /* === 評論列表 === */
    let listHtml;
    if (total === 0) {
      listHtml =
        `<div class="sd-rm-empty">` +
          `<i class="fa-regular fa-comments"></i>` +
          `<div>目前還沒有評論</div>` +
        `</div>`;
    } else {
      listHtml = items.map(ev => {
        const stars = renderStars(ev.score);
        return (
          `<div class="sd-rm-review">` +
            `<div class="sd-rm-rv-head">` +
              `<span class="sd-rm-rv-name">${escapeHtml(ev.memberName || "顧客")}</span>` +
              `<span class="sd-rm-rv-stars">${stars}</span>` +
            `</div>` +
            (ev.content ? `<div class="sd-rm-rv-content">${escapeHtml(ev.content)}</div>` : "") +
          `</div>`
        );
      }).join("");
    }

    /* === 載入更多 footer (B3:無限滾動)===
       還有更多 → 顯示載入鈕 + 進度條
       已全部載入 → 顯示「已顯示全部 N 則」 */
    let footerHtml = "";
    if (total > 0) {
      if (hasMore) {
        footerHtml =
          `<div class="sd-rm-scroll-foot">` +
            `<button class="sd-rm-load-more" type="button" data-action="rm-load-more">` +
              `<i class="fa-solid fa-circle-arrow-down"></i> 載入更多評價` +
            `</button>` +
            `<div class="sd-rm-scroll-info">已顯示 ${loaded.toLocaleString()} / ${total.toLocaleString()} 則</div>` +
          `</div>`;
      } else {
        footerHtml =
          `<div class="sd-rm-scroll-foot">` +
            `<div class="sd-rm-scroll-info end">已顯示全部 ${total.toLocaleString()} 則評價</div>` +
          `</div>`;
      }
    }

    /* === 組裝彈窗 === */
    const existing = document.getElementById("sd-review-modal");
    const html =
      `<div class="sd-rm-overlay" id="sd-review-modal" data-action="rm-bg">` +
        `<div class="sd-rm-dialog">` +
          head +
          `<div class="sd-rm-body">${listHtml}${footerHtml}</div>` +
        `</div>` +
      `</div>`;

    if (existing) {
      /* 已開啟 → 只替換內容,避免閃爍 */
      existing.outerHTML = html;
    } else {
      document.body.insertAdjacentHTML("beforeend", html);
    }

    /* === 綁事件(每次重綁,因為 outerHTML 替換掉舊 DOM)=== */
    const root = document.getElementById("sd-review-modal");
    if (!root) return;
    root.addEventListener("click", (e) => {
      const t = e.target;
      /* 點 overlay 背景關閉 */
      if (t.dataset.action === "rm-bg") {
        closeStaffReviewModal();
        return;
      }
      /* 關閉按鈕 */
      if (t.closest("[data-action='rm-close']")) {
        closeStaffReviewModal();
        return;
      }
      /* 載入更多 */
      const moreEl = t.closest("[data-action='rm-load-more']");
      if (moreEl) {
        reviewModalState.loadedCount += reviewModalState.perLoad;
        renderReviewModal();
        return;
      }
    });

    /* === 捲動到底自動載入更多 === */
    const bodyEl = root.querySelector(".sd-rm-body");
    if (bodyEl) {
      let busy = false;
      bodyEl.addEventListener("scroll", () => {
        if (busy) return;
        const list = (reviewModalState.emp && reviewModalState.emp.evaluationList) || [];
        if (reviewModalState.loadedCount >= list.length) return;
        const nearBottom = bodyEl.scrollTop + bodyEl.clientHeight >= bodyEl.scrollHeight - 120;
        if (nearBottom) {
          busy = true;
          reviewModalState.loadedCount += reviewModalState.perLoad;
          renderReviewModal();
        }
      });
    }
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
    /* 優先用 store-data 算好的 googleMapsUrl(有 cid 走商家頁,沒 cid 走店名+地址搜尋)
       fallback 處理舊資料或缺欄位的情況 */
    let url = s.googleMapsUrl;
    if (!url) {
      const q = encodeURIComponent(((s.name || "") + " " + (s.address || "")).trim());
      url = s.lat && s.lng
        ? `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`
        : `https://www.google.com/maps/search/?api=1&query=${q}`;
    }
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
