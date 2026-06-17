/* =============================================
   LOHAS · Booking Modal
   --------------------------------------------
   完整預約流程：驗光師 → 服務 → 日期/時段 → 會員資料 → 建立預約
   --------------------------------------------
   依賴：
   - js/api/api-core.js
   - js/api/api-booking.js
   - js/store-data.js
   --------------------------------------------
   對外 API：
   window.LohasBookingModal.open({ store, employees, preselectEmployeeErpId })
   window.LohasBookingModal.close()
   ============================================= */

(function (root) {
  "use strict";

  const { core } = root.LohasApi;
  const { booking: bookingApi } = root.LohasApi;

  /* 服務項目（門市預約四項；duration 供顯示用）*/
  const SERVICES = [
    { id: "pickup",   name: "取件",          duration: 20 },
    { id: "maintain", name: "眼鏡保養、調整", duration: 20 },
    { id: "fitting",  name: "配鏡",          duration: 40 },
    { id: "consult",  name: "諮詢",          duration: 30 }
  ];

  /* state */
  const state = {
    open: false,
    step: 1,                  // 1=staff, 2=time, 3=form, 4=success
    store: null,
    employees: [],
    selectedEmployee: null,
    selectedService: null,    // 必選,使用者在 step 3 選
    rounds: [],
    selectedDate: null,
    selectedRoundId: null,
    form: {
      memberName: "",
      memberNumber: "",
      memberPhone: "",
      memberBirthday: "",
      content: ""
    },
    loadingRounds: false,
    submitting: false,
    error: null,
    successData: null
  };

  let rootEl = null;

  function open(opts) {
    opts = opts || {};
    /* 商城取貨流程：傳入 stores（全部門市，含 employees）→ 先選門市、再選顧問 */
    state.stores = opts.stores || [];
    state.cartStorePick = !!(opts.stores && !opts.store);
    state.store = opts.store || null;
    state.employees = (opts.employees || []).filter(e => !e.isLeave && !e.isFreeze);
    state.step = 1;
    state.selectedEmployee = null;
    state.selectedService = null;
    state.selectedDate = null;
    state.selectedRoundId = null;
    state.rounds = [];
    state.successData = null;
    state.error = null;

    /* 預載會員資料（如果有登入） */
    try {
      const member = JSON.parse(localStorage.getItem("lohasMember") || "null");
      if (member) {
        state.form.memberName = member.name || "";
        state.form.memberNumber = member.erpid || member.memberNumber || "";
        state.form.memberPhone = member.phone || "";
        state.form.memberBirthday = member.birthday || "";
      }
    } catch (_e) { /* ignore */ }

    /* 商城帶入的資料(sessionStorage 由 allstore.js captureCartPrefill 存)
       優先級在會員之下:會員已登入則不覆蓋姓名/電話 */
    state.cartPrefill = null;
    try {
      const raw = sessionStorage.getItem("lohas_cart_prefill");
      if (raw) {
        const cart = JSON.parse(raw);
        state.cartPrefill = cart;
        if (!state.form.memberName && cart.name) state.form.memberName = cart.name;
        if (!state.form.memberPhone && cart.phone) state.form.memberPhone = cart.phone;
        console.log("[booking-modal] 套用商城 prefill", cart);
      }
    } catch (_e) { /* ignore */ }

    /* 預選顧問 → 一般情況直接跳第 2 步（時段）；
       商城模式(cartPrefill)只選顧問、時段交給商城那頁，故維持在第 1 步 */
    if (opts.preselectEmployeeErpId) {
      const target = state.employees.find(e => String(e.erpid) === String(opts.preselectEmployeeErpId));
      if (target) {
        state.selectedEmployee = target;
        if (!state.cartPrefill) state.step = 2;
      }
    }

    state.open = true;
    render();
    if (state.selectedEmployee) loadRounds();
  }

  function close() {
    state.open = false;
    render();
  }

  function getRoot() {
    if (rootEl) return rootEl;
    rootEl = document.getElementById("lohas-booking-modal");
    if (!rootEl) {
      rootEl = document.createElement("div");
      rootEl.id = "lohas-booking-modal";
      document.body.appendChild(rootEl);
    }
    return rootEl;
  }

  /* === 主渲染 === */
  function render() {
    const r = getRoot();
    if (!state.open) {
      const ov = r.querySelector(".bm-overlay");
      if (ov) ov.classList.remove("open");
      setTimeout(() => { r.innerHTML = ""; }, 250);
      document.body.style.overflow = "";
      return;
    }

    document.body.style.overflow = "hidden";
    r.innerHTML = renderShell();
    requestAnimationFrame(() => {
      r.querySelector(".bm-overlay").classList.add("open");
    });
    bindShell();
  }

  function renderShell() {
    const s = state.store;
    return (
      `<div class="bm-overlay" data-overlay>` +
        `<div class="bm-dialog">` +
          /* head */
          `<div class="bm-head">` +
            `<div class="bm-head-info">` +
              `<span class="tag"><i class="fa-solid fa-bolt"></i> RESERVATION</span>` +
              `<h2>${s ? s.name + " · 線上預約" : "線上預約"}</h2>` +
              (s ? `<p>${s.address || ""}</p>` : "") +
            `</div>` +
            `<button class="bm-close" data-close><i class="fa-solid fa-xmark"></i></button>` +
          `</div>` +
          /* steps */
          renderSteps() +
          /* body */
          `<div class="bm-body" data-body>${renderStepContent()}</div>` +
          /* footer */
          renderFooter() +
        `</div>` +
      `</div>`
    );
  }

  function renderSteps() {
    /* 商城模式：時段交給商城那頁，不選時段 */
    if (state.cartPrefill) {
      /* 先選門市再選顧問 → 兩步 */
      if (state.cartStorePick) {
        const onStore = !state.store;
        return (
          `<div class="bm-steps">` +
            `<div class="bm-step ${onStore ? "active" : ""}"><span class="bm-step-num">1</span>選擇門市</div>` +
            `<div class="bm-step ${onStore ? "" : "active"}"><span class="bm-step-num">2</span>選擇顧問</div>` +
          `</div>`
        );
      }
      /* 已帶入門市（從 store.html 來）→ 只剩選顧問一步 */
      return (
        `<div class="bm-steps">` +
          `<div class="bm-step active"><span class="bm-step-num">1</span>選擇銷售顧問</div>` +
        `</div>`
      );
    }
    const steps = [
      { n: 1, label: "選銷售顧問" },
      { n: 2, label: "選時段" },
      { n: 3, label: "確認資料" }
    ];
    return (
      `<div class="bm-steps">` +
        steps.map(s => {
          const cls =
            state.step === s.n ? "active" :
            state.step > s.n ? "done" : "";
          const icon = state.step > s.n
            ? `<i class="fa-solid fa-check"></i>`
            : s.n;
          return (
            `<div class="bm-step ${cls}">` +
              `<span class="bm-step-num">${icon}</span>${s.label}` +
            `</div>`
          );
        }).join("") +
      `</div>`
    );
  }

  function renderStepContent() {
    /* 商城「先選門市」模式：還沒選門市前，先顯示門市清單 */
    if (state.cartPrefill && state.cartStorePick && !state.store) return renderStoreStep();
    if (state.step === 1) return renderStepStaff();
    if (state.step === 2) return renderStepTime();
    if (state.step === 3) return renderStepForm();
    if (state.step === 4) return renderSuccess();
    return "";
  }

  /* === 商城取貨：選門市（含搜尋） === */
  function renderStoreStep() {
    if (!state.stores || state.stores.length === 0) {
      return (
        `<div class="bm-state">` +
          `<div class="spinner"></div>` +
          `<div class="bm-state-title">載入門市中…</div>` +
        `</div>`
      );
    }
    return (
      `<div class="bm-sec">` +
        `<div class="bm-sec-title">選擇取貨門市</div>` +
        `<div class="bm-store-search">` +
          `<i class="fa-solid fa-magnifying-glass"></i>` +
          `<input type="search" id="bm-store-q" placeholder="輸入縣市、地址或門市名稱" autocomplete="off">` +
        `</div>` +
        `<div class="bm-store-list" id="bm-store-list">` +
          renderStoreItems(state.stores) +
        `</div>` +
      `</div>`
    );
  }

  function renderStoreItems(list) {
    if (!list.length) {
      return `<div class="bm-store-empty">找不到符合的門市</div>`;
    }
    return list.map(s => {
      const region = s.region ? s.region.label : "";
      const count = (s.employees || []).filter(e => e && !e.isLeave && !e.isFreeze && !e.isUnspecify).length;
      return (
        `<button type="button" class="bm-store-item" data-store-pick="${s.erpid}">` +
          `<span class="bm-store-item-main">` +
            `<span class="bm-store-item-name">${s.name}</span>` +
            `<span class="bm-store-item-addr">${region ? region + "｜" : ""}${s.address || ""}</span>` +
          `</span>` +
          (count ? `<span class="bm-store-item-meta">${count} 位顧問</span>` : "") +
          `<i class="fa-solid fa-chevron-right"></i>` +
        `</button>`
      );
    }).join("");
  }

  /* === 服務項目選擇（取件 / 眼鏡保養、調整 / 配鏡 / 諮詢）必選 === */
  function renderServiceSection() {
    return (
      `<div class="bm-sec">` +
        `<div class="bm-sec-title">預約服務項目 <span class="bm-required">*</span></div>` +
        `<div class="bm-svc-grid">` +
          SERVICES.map(s => {
            const active = state.selectedService && state.selectedService.id === s.id;
            return (
              `<button type="button" class="bm-svc-pick ${active ? "active" : ""}" data-svc="${s.id}">` +
                `${s.name}` +
              `</button>`
            );
          }).join("") +
        `</div>` +
      `</div>`
    );
  }

  /* === Step 1: 選顧問（大頭像版） === */
  function renderStepStaff() {
    if (state.employees.length === 0) {
      return (
        `<div class="bm-state">` +
          `<div class="bm-state-title">本店尚未公開銷售顧問資料</div>` +
          `<div class="bm-state-msg">請致電門市直接預約</div>` +
        `</div>`
      );
    }
    /* 商城「先選門市」模式：顧問清單上方顯示已選門市 + 可重選 */
    const storeBar = (state.cartPrefill && state.cartStorePick && state.store)
      ? `<div class="bm-picked-store">` +
          `<span><i class="fa-solid fa-store"></i> 取貨門市：<b>${state.store.name}</b></span>` +
          `<button type="button" class="bm-link" data-change-store>重新選擇</button>` +
        `</div>`
      : "";
    return (
      storeBar +
      `<div class="bm-sec">` +
        `<div class="bm-sec-title">選擇銷售顧問</div>` +
        `<div class="bm-staff-grid">` +
          state.employees.map(e => {
            const rawPhoto = e.photos && e.photos[0];
            /* 確認真的是有效的照片 URL（不是 null / 空字串 / 純空白） */
            const photo = (rawPhoto && String(rawPhoto).trim()) ? rawPhoto : "";
            const isActive = state.selectedEmployee && state.selectedEmployee.erpid === e.erpid;
            const role = (e.role || e.jobtitle || "").trim();
            const honor = (e.honor || "").trim();
            /* 照片區：有效 URL 用 <img>（含 onerror fallback）、無 URL 直接 icon */
            const photoInner = photo
              ? `<img src="${photo}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">` +
                `<span class="bm-staff-pick-fallback" style="display:none"><i class="fa-regular fa-user"></i></span>`
              : `<span class="bm-staff-pick-fallback"><i class="fa-regular fa-user"></i></span>`;
            return (
              `<div class="bm-staff-pick ${isActive ? "active" : ""}" data-staff="${e.erpid}">` +
                `<div class="bm-staff-pick-photo${photo ? "" : " no-photo"}">` +
                  photoInner +
                `</div>` +
                `<div class="bm-staff-pick-info">` +
                  `<div class="bm-staff-pick-name">${e.name}</div>` +
                  (role ? `<div class="bm-staff-pick-role">${role}</div>` : "") +
                  (honor ? `<div class="bm-staff-pick-honor"><i class="fa-solid fa-medal"></i> ${honor}</div>` : "") +
                `</div>` +
                `<div class="bm-staff-pick-check"><i class="fa-solid fa-check"></i></div>` +
              `</div>`
            );
          }).join("") +
        `</div>` +
      `</div>`
    );
  }

  /* === Step 2: 選時段 === */
  function renderStepTime() {
    if (state.loadingRounds) {
      return (
        `<div class="bm-state">` +
          `<div class="spinner"></div>` +
          `<div class="bm-state-title">載入可預約時段中</div>` +
          `<div class="bm-state-msg">查詢 ${state.selectedEmployee ? state.selectedEmployee.name : ""} 的時段…</div>` +
        `</div>`
      );
    }
    if (state.error) {
      return (
        `<div class="bm-state">` +
          `<div class="bm-state-title" style="color:var(--err)">載入失敗</div>` +
          `<div class="bm-state-msg">${state.error}</div>` +
        `</div>`
      );
    }

    /* 依日期分組 */
    const byDate = new Map();
    state.rounds.forEach(r => {
      if (!byDate.has(r.date)) byDate.set(r.date, []);
      byDate.get(r.date).push(r);
    });
    const dates = Array.from(byDate.keys());
    if (dates.length === 0) {
      return (
        `<div class="bm-state">` +
          `<div class="bm-state-title">目前沒有可預約時段</div>` +
          `<div class="bm-state-msg">請致電門市，或選擇其他銷售顧問</div>` +
        `</div>`
      );
    }

    if (!state.selectedDate) state.selectedDate = dates[0];
    const rounds = byDate.get(state.selectedDate) || [];

    return (
      /* 日期 row */
      `<div class="bm-sec">` +
        `<div class="bm-sec-title">選擇日期</div>` +
        `<div class="bm-date-row">` +
          dates.slice(0, 14).map(d => renderDatePick(d, byDate.get(d))).join("") +
        `</div>` +
      `</div>` +
      /* 時段 grid */
      `<div class="bm-sec">` +
        `<div class="bm-sec-title">選擇時段（${formatDate(state.selectedDate)}）</div>` +
        `<div class="bm-time-grid">` +
          rounds.map(r => {
            const active = String(state.selectedRoundId) === String(r.roundId);
            const full = !r.available;
            return (
              `<button class="bm-time-pick ${active ? "active" : ""} ${full ? "full" : ""}" ` +
                `data-round="${r.roundId}" ${full ? "disabled" : ""}>` +
                r.title +
              `</button>`
            );
          }).join("") +
        `</div>` +
      `</div>`
    );
  }

  function renderDatePick(date, rounds) {
    const d = new Date(date + "T00:00:00");
    const dayName = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
    const remain = rounds.reduce((sum, r) => sum + (r.remain || 0), 0);
    const totalAvailable = rounds.filter(r => r.available).length;
    const full = totalAvailable === 0;
    const isToday = isSameDate(d, new Date());
    const remainLabel = full ? "滿" : (remain > 20 ? "多" : remain > 5 ? "中" : "少");
    const active = state.selectedDate === date;
    return (
      `<div class="bm-date-pick ${active ? "active" : ""} ${full ? "full" : ""}" data-date="${date}">` +
        `<div class="dw">${isToday ? "今天" : "週" + dayName}</div>` +
        `<div class="dn">${d.getDate()}</div>` +
        `<div class="da">${remainLabel}</div>` +
      `</div>`
    );
  }

  /* === Step 4: 填會員資料 === */
  function renderStepForm() {
    const f = state.form;
    return (
      renderServiceSection() +
      `<div class="bm-sec">` +
        `<div class="bm-sec-title">會員資料（建立預約所需）</div>` +
        renderInput("姓名", "memberName", f.memberName, "請輸入姓名") +
        renderInput("會員編號", "memberNumber", f.memberNumber, "若無請填手機末四碼") +
        renderInput("手機號碼", "memberPhone", f.memberPhone, "09xxxxxxxx") +
        renderInput("生日", "memberBirthday", f.memberBirthday, "yyyy-mm-dd", "date") +
      `</div>` +
      `<div class="bm-sec">` +
        `<div class="bm-sec-title">給門市的留言（選填）</div>` +
        `<div class="bm-form-row">` +
          `<textarea data-field="content" placeholder="例如：第一次配鏡、希望試多焦…">${escapeHtml(f.content)}</textarea>` +
        `</div>` +
      `</div>`
    );
  }

  function renderInput(label, field, value, placeholder, type) {
    return (
      `<div class="bm-form-row">` +
        `<label>${label}</label>` +
        `<input type="${type || "text"}" data-field="${field}" ` +
          `value="${escapeHtml(value)}" placeholder="${placeholder || ""}">` +
      `</div>`
    );
  }

  /* === Step 5: 預約成功 === */
  function renderSuccess() {
    const d = state.successData || {};
    return (
      `<div class="bm-success">` +
        `<div class="bm-success-icon"><i class="fa-solid fa-check"></i></div>` +
        `<div class="bm-success-title">預約已建立</div>` +
        `<div class="bm-success-msg">我們已收到您的預約資料，門市將於 24 小時內聯繫確認。請保持手機暢通。</div>` +
        `<div class="bm-success-detail">` +
          `<div>門市：<b>${state.store ? state.store.name : "-"}</b></div>` +
          `<div>銷售顧問：<b>${state.selectedEmployee ? state.selectedEmployee.name : "-"}</b></div>` +
          `<div>服務：<b>${state.selectedService ? state.selectedService.name : "-"}</b></div>` +
          `<div>時段：<b>${formatDate(state.selectedDate)} ${getRoundTitle(state.selectedRoundId)}</b></div>` +
          (d.reservationId ? `<div>預約編號：<b>${d.reservationId}</b></div>` : "") +
        `</div>` +
      `</div>`
    );
  }

  /* === Footer === */
  function renderFooter() {
    /* 商城模式：不選時段、不建單 */
    if (state.cartPrefill) {
      /* 還在選門市這一步：點門市就進下一步，這裡只給提示、不放按鈕 */
      if (state.cartStorePick && !state.store) {
        return (
          `<div class="bm-foot">` +
            `<div class="bm-foot-summary"><b>請選擇取貨門市</b>選好後接著挑銷售顧問</div>` +
          `</div>`
        );
      }
      /* 選顧問這一步：確認 → 回商城 */
      const ok = !!state.selectedEmployee;
      const summary = state.selectedEmployee
        ? `<b>${state.selectedEmployee.name}</b>確認後回商城選預約時段`
        : `<b>請選擇銷售顧問</b>選好後即可回商城繼續`;
      return (
        `<div class="bm-foot">` +
          `<div class="bm-foot-summary">${summary}</div>` +
          `<div class="bm-foot-actions">` +
            `<button class="bm-btn primary" data-cart-submit ${ok && !state.submitting ? "" : "disabled"}>` +
              (state.submitting
                ? `<i class="fa-solid fa-spinner fa-spin"></i> 處理中…`
                : `確認顧問，回商城選時段 <i class="fa-solid fa-arrow-right"></i>`) +
            `</button>` +
          `</div>` +
        `</div>`
      );
    }
    if (state.step === 4) {
      return (
        `<div class="bm-foot">` +
          `<div class="bm-foot-summary">` +
            `<b>感謝您的預約</b>` +
            `預約資料已寄至您的手機` +
          `</div>` +
          `<div class="bm-foot-actions">` +
            `<button class="bm-btn primary" data-close>完成</button>` +
          `</div>` +
        `</div>`
      );
    }

    const canNext = canProceed();
    const summary = renderSummary();
    return (
      `<div class="bm-foot">` +
        `<div class="bm-foot-summary">${summary}</div>` +
        `<div class="bm-foot-actions">` +
          (state.step > 1
            ? `<button class="bm-btn ghost" data-prev>上一步</button>`
            : "") +
          (state.step < 3
            ? `<button class="bm-btn primary" data-next ${canNext ? "" : "disabled"}>` +
              `下一步 <i class="fa-solid fa-arrow-right"></i></button>`
            : `<button class="bm-btn primary" data-submit ${state.submitting ? "disabled" : ""}>` +
              (state.submitting
                ? `<i class="fa-solid fa-spinner fa-spin"></i> 送出中…`
                : `確認預約 <i class="fa-solid fa-check"></i>`) +
              `</button>`) +
        `</div>` +
      `</div>`
    );
  }

  function renderSummary() {
    const parts = [];
    if (state.selectedEmployee) parts.push(state.selectedEmployee.name);
    if (state.selectedDate && state.selectedRoundId) {
      parts.push(formatDate(state.selectedDate) + " " + getRoundTitle(state.selectedRoundId));
    }
    if (parts.length === 0) return `<b>步驟 ${state.step} / 3</b>依序完成以建立預約`;
    return `<b>${parts[0] || ""}</b>${parts.slice(1).join(" · ") || "請繼續選擇"}`;
  }

  function canProceed() {
    if (state.step === 1) return !!state.selectedEmployee;
    if (state.step === 2) return !!state.selectedRoundId;
    if (state.step === 3) {
      const f = state.form;
      const formOk = !!(f.memberName && f.memberNumber && f.memberPhone && f.memberBirthday);
      /* 一般模式服務必選;商城模式服務由商城帶,不檢查 */
      const svcOk = state.cartPrefill ? true : !!state.selectedService;
      return formOk && svcOk;
    }
    return false;
  }

  /* === 事件 === */
  function bindShell() {
    const r = getRoot();
    r.querySelector("[data-overlay]").addEventListener("click", e => {
      if (e.target.hasAttribute("data-overlay")) close();
    });
    /* 綁定所有 data-close 元素 ─ 右上角 X 按鈕 + 成功畫面的「完成」按鈕
       (原本用 querySelector 只抓到第一個 X,導致「完成」按鈕沒反應) */
    r.querySelectorAll("[data-close]").forEach(el => {
      el.addEventListener("click", close);
    });

    r.querySelectorAll("[data-staff]").forEach(el => {
      el.addEventListener("click", () => {
        const erpid = el.dataset.staff;
        state.selectedEmployee = state.employees.find(e => String(e.erpid) === String(erpid));
        state.selectedRoundId = null;
        state.selectedDate = null;
        state.rounds = [];
        renderInPlace();
      });
    });

    /* 商城取貨：選門市 → 設定門市與該店顧問 → 進選顧問步驟 */
    r.querySelectorAll("[data-store-pick]").forEach(el => {
      el.addEventListener("click", () => {
        const erpid = el.dataset.storePick;
        const store = state.stores.find(s => String(s.erpid) === String(erpid));
        if (!store) return;
        state.store = store;
        state.employees = (store.employees || [])
          .filter(e => e && !e.isLeave && !e.isFreeze && !e.isUnspecify);
        state.selectedEmployee = null;
        state.step = 1;
        renderInPlace();
      });
    });

    /* 商城取貨：重新選門市 → 退回門市清單 */
    const changeStore = r.querySelector("[data-change-store]");
    if (changeStore) changeStore.addEventListener("click", () => {
      state.store = null;
      state.selectedEmployee = null;
      renderInPlace();
    });

    /* 門市搜尋（只篩清單，不重繪整個 modal） */
    const storeQ = r.querySelector("#bm-store-q");
    if (storeQ) storeQ.addEventListener("input", () => {
      const q = storeQ.value.trim().toLowerCase();
      const filtered = !q ? state.stores : state.stores.filter(s => {
        const hay = `${s.name} ${s.address || ""} ${s.city || ""} ${s.region ? s.region.label : ""}`.toLowerCase();
        return hay.includes(q);
      });
      const listEl = r.querySelector("#bm-store-list");
      if (listEl) {
        listEl.innerHTML = renderStoreItems(filtered);
        bindShell(); // 重新綁定新出現的 data-store-pick
        const q2 = r.querySelector("#bm-store-q");
        if (q2) { q2.value = storeQ.value; q2.focus(); }
      }
    });

    r.querySelectorAll("[data-svc]").forEach(el => {
      el.addEventListener("click", () => {
        state.selectedService = SERVICES.find(s => s.id === el.dataset.svc);
        renderInPlace();
      });
    });

    r.querySelectorAll("[data-date]").forEach(el => {
      el.addEventListener("click", () => {
        if (el.classList.contains("full")) return;
        state.selectedDate = el.dataset.date;
        state.selectedRoundId = null;
        renderInPlace();
        /* re-render 後找到新的 .active 日期,捲到視野內。
           inline:"nearest" 表示「已經在視野裡的不滾」,
           只有選了被切到的最遠日期時才會真的捲動。 */
        const root = getRoot();
        const activeDate = root.querySelector(".bm-date-pick.active");
        if (activeDate) {
          activeDate.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
        }
      });
    });

    r.querySelectorAll("[data-round]").forEach(el => {
      el.addEventListener("click", () => {
        if (el.disabled) return;
        state.selectedRoundId = el.dataset.round;
        renderInPlace();
      });
    });

    r.querySelectorAll("[data-field]").forEach(el => {
      el.addEventListener("input", () => {
        state.form[el.dataset.field] = el.value;
        /* 不要 full re-render，只更新 footer（會自動重綁按鈕）*/
        updateFooter();
      });
    });

    bindFooterButtons();
  }

  function renderInPlace() {
    const r = getRoot();
    const body = r.querySelector("[data-body]");
    if (body) body.innerHTML = renderStepContent();
    const stepsEl = r.querySelector(".bm-steps");
    if (stepsEl) stepsEl.outerHTML = renderSteps();
    updateFooter();
    bindShell();
  }

  function updateFooter() {
    const r = getRoot();
    const oldFoot = r.querySelector(".bm-foot");
    if (oldFoot) {
      const tmp = document.createElement("div");
      tmp.innerHTML = renderFooter();
      oldFoot.replaceWith(tmp.firstElementChild);
    }
    /* 重綁 footer 上的按鈕（上一步 / 下一步 / 確認預約）
       不重綁的話，輸入時 footer 被替換，submit 按鈕的 click listener 會消失 */
    bindFooterButtons();
  }

  function bindFooterButtons() {
    const r = getRoot();
    const prev = r.querySelector("[data-prev]");
    if (prev) prev.addEventListener("click", () => {
      state.step--;
      if (state.step < 1) state.step = 1;
      renderInPlace();
    });

    const next = r.querySelector("[data-next]");
    if (next) next.addEventListener("click", () => {
      if (!canProceed()) return;
      state.step++;
      if (state.step === 2 && state.rounds.length === 0) {
        loadRounds();
      }
      renderInPlace();
    });

    const submit = r.querySelector("[data-submit]");
    if (submit) submit.addEventListener("click", submitReservation);

    /* 商城模式的確認按鈕：只回傳商城，不建立左手預約單 */
    const cartSubmit = r.querySelector("[data-cart-submit]");
    if (cartSubmit) cartSubmit.addEventListener("click", submitCartReserve);

    /* 成功畫面的「完成」按鈕(data-close)住在 footer 裡,
       footer 被 updateFooter 的 replaceWith 換掉後事件會掉,所以這裡也要綁 */
    r.querySelectorAll(".bm-foot [data-close]").forEach(el => {
      el.addEventListener("click", close);
    });
  }

  /* === API：取得可預約時段 === */
  async function loadRounds() {
    if (!state.selectedEmployee) return;
    state.loadingRounds = true;
    state.error = null;
    renderInPlace();
    try {
      const data = await bookingApi.getRounds(state.selectedEmployee.erpid, 0);
      state.rounds = bookingApi.flattenRounds(data);
    } catch (err) {
      state.error = err.message || "讀取時段失敗";
      state.rounds = [];
    } finally {
      state.loadingRounds = false;
      renderInPlace();
    }
  }

  /* === 商城模式：只選顧問，不建立左手預約單，選完直接回傳商城（時段由商城那頁選）=== */
  async function submitCartReserve() {
    if (state.submitting) return;
    if (!state.selectedEmployee) { alert("請先選擇銷售顧問"); return; }
    if (!state.store) { alert("缺少門市資訊，請重新從門市列表進入"); return; }
    state.submitting = true;
    updateFooter();
    try {
      /* 加密門市/顧問 ID → 隱藏 form POST 回商城 → 瀏覽器跳轉（之後不再執行） */
      await postBackToMall();
    } catch (err) {
      alert("回傳商城失敗：" + (err.message || "請稍後再試"));
      state.submitting = false;
      renderInPlace();
    }
  }

  /* === API：建立預約 === */
  async function submitReservation() {
    if (state.submitting) return;

    /* 服務項目必選(商城模式由商城帶,不檢查)*/
    if (!state.cartPrefill && !state.selectedService) {
      alert("請先選擇預約服務項目");
      return;
    }

    /* 欄位檢查：缺哪個就提示哪個,並把焦點移到該欄位 */
    const f = state.form;
    const missing = [];
    if (!f.memberName) missing.push({ field: "memberName", label: "姓名" });
    if (!f.memberNumber) missing.push({ field: "memberNumber", label: "會員編號(若無請填手機末四碼)" });
    if (!f.memberPhone) missing.push({ field: "memberPhone", label: "手機號碼" });
    if (!f.memberBirthday) missing.push({ field: "memberBirthday", label: "生日" });

    if (missing.length > 0) {
      const labels = missing.map(m => m.label).join("、");
      alert("請先填寫:" + labels);
      const firstInput = getRoot().querySelector(`[data-field="${missing[0].field}"]`);
      if (firstInput) firstInput.focus();
      return;
    }

    state.submitting = true;
    updateFooter();
    try {
      /* === Step 1:建立暫時預約單 === */
      const data = await bookingApi.createReservation({
        groupErpId: state.store.erpid,
        employeeErpId: state.selectedEmployee.erpid,
        reservationDate: state.selectedDate,
        roundId: state.selectedRoundId,
        memberName: state.form.memberName,
        memberNumber: state.form.memberNumber,
        memberPhone: state.form.memberPhone,
        memberBirthday: state.form.memberBirthday,
        content: buildContentText()
      });

      /* data.reservationid 文件說「請用 AES 解密」 */
      let reservationId = "";
      if (data && data.reservationid) {
        reservationId = bookingApi.decryptReservationId(data.reservationid);
      }
      if (!reservationId) {
        throw new Error("建立暫時預約單失敗:後端沒有回傳 reservationid");
      }

      /* === Step 2:暫時預約單轉正式預約(orderid 傳空字串,純預約沒有訂單)===
         若沒呼叫這支,門市端不會收到預約通知 */
      console.log("[booking] createReservation 成功,reservationId =", reservationId);
      try {
        const finishResult = await bookingApi.finishReservation(reservationId, "");
        console.log("[booking] finishReservation 結果:", finishResult);
      } catch (finishErr) {
        /* finishReservation 失敗:暫時單已建立但沒轉成正式,門市看不到 */
        console.error("[booking] finishReservation 失敗:", finishErr);
        throw new Error("預約最終確認失敗:" + (finishErr.message || "請聯絡客服或重試"));
      }

      state.successData = { reservationId };
      state.step = 4;
      /* GA4 主要轉換:預約完成事件(經 dataLayer 由 GTM 轉發) */
      try {
        if (window.lohasTrack) {
          // 讀取預約來源歸因（若是從最新消息 CTA 點進來的）
          var src = {};
          try {
            var raw = sessionStorage.getItem('lohas_booking_source');
            if (raw) {
              var parsed = JSON.parse(raw);
              // 來源僅在 6 小時內有效，避免跨 session 誤歸因
              if (parsed && parsed.ts && (Date.now() - parsed.ts) < 6 * 3600 * 1000) {
                src = parsed;
              }
            }
          } catch (e) {}

          window.lohasTrack('booking_complete', {
            reservation_id: reservationId,
            store_name: (state.store && state.store.name) || '',
            source_news_id: src.news_id || '',
            source_news_title: src.news_title || '',
            source_cta_type: src.cta_type || ''
          });

          // 用完即清，避免下一次預約沿用舊來源
          try { sessionStorage.removeItem('lohas_booking_source'); } catch (e) {}
        }
      } catch (e) {}

      /* === 回流商城(只在從商城跳過來的情況才觸發)===
         預約成功後 AES 加密門市/顧問 ID → form POST 回商城 → 瀏覽器跳轉 */
      if (state.cartPrefill) {
        await postBackToMall();
      }
    } catch (err) {
      alert("建立預約失敗：" + (err.message || "請稍後再試"));
    } finally {
      state.submitting = false;
      renderInPlace();
    }
  }

  /* === 商城 cartType / cartPaymentMethod 對照表 === */
  const CART_TYPE_MAP = {
    wear: "配戴用",
    shop: "代客選購"
  };
  const CART_PAYMENT_MAP = {
    "1":"樂活門市-取貨付款","2":"樂活門市-取貨付款","3":"ATM",
    "4":"樂活門市-線上信用卡付款","5":"信用卡","6":"宅配-ATM付款",
    "7":"宅配-線上信用卡付款","8":"美國-信用卡付款","9":"日本-信用卡付款",
    "10":"韓國-信用卡付款","11":"歐洲國家","12":"超商-取貨付款",
    "13":"樂活門市-取貨付款","14":"樂活門市-線上信用卡付款","15":"宅配-ATM付款",
    "16":"宅配-線上信用卡付款","17":"美國-信用卡付款","18":"日本-信用卡付款",
    "19":"韓國-信用卡付款","20":"歐洲國家","21":"超商-取貨付款","26":"測試"
  };

  /* === 回流商城:AES 加密 StoreId/StaffId → 隱藏 form POST ===
     回流規格(商城後端提供):
       POST https://www.lohaseyewear.com/order/{cartType}/Reserve/{cartPaymentMethod}
       欄位: name / phone / StoreId(AES) / storename / StaffId(AES) / employeeerp / pname
     用真實 <form> submit(非 fetch)→ 帶 session cookie 跨 domain + 瀏覽器跳轉商城 */
  async function postBackToMall() {
    try {
      const cart = state.cartPrefill || {};
      const store = state.store || {};
      const emp = state.selectedEmployee || {};
      const storeIdPlain = String(store.erpid || "");
      const staffIdPlain = String(emp.erpid || "");

      /* 呼叫 BFF 加密 StoreId / StaffId */
      let enc = { StoreId: storeIdPlain, StaffId: staffIdPlain };
      try {
        enc = await window.LohasApi.core.encrypt({
          StoreId: storeIdPlain,
          StaffId: staffIdPlain
        });
      } catch (e) {
        console.error("[booking] 回流加密失敗,用明文 fallback", e);
      }

      const cartType = encodeURIComponent(cart.cartType || "");
      const cartPay  = encodeURIComponent(cart.cartPaymentMethod || "");
      const actionUrl = `https://www.lohaseyewear.com/order/${cartType}/Reserve/${cartPay}`;

      const fields = {
        name:        state.form.memberName || cart.name || "",
        phone:       state.form.memberPhone || cart.phone || "",
        StoreId:     enc.StoreId || "",
        storename:   store.name || "",
        StaffId:     enc.StaffId || "",
        employeeerp: staffIdPlain,
        pname:       emp.name || ""
      };

      const form = document.createElement("form");
      form.method = "POST";
      form.action = actionUrl;
      form.style.display = "none";
      Object.entries(fields).forEach(([k, v]) => {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = k;
        input.value = v;
        form.appendChild(input);
      });
      document.body.appendChild(form);
      console.log("[booking] 回流商城 POST →", actionUrl, fields);

      /* 清掉 sessionStorage */
      try { sessionStorage.removeItem("lohas_cart_prefill"); } catch (_e) {}

      form.submit();  /* 跳離樂活到商城,之後程式不再執行 */
    } catch (err) {
      console.error("[booking] postBackToMall 失敗(預約仍成功)", err);
    }
  }

  function buildContentText() {
    const svc = state.selectedService;
    const lines = [];
    if (svc) lines.push(`預約服務：${svc.name}（約 ${svc.duration} 分鐘）`);

    /* 商城帶入的訂單資訊(若有)*/
    if (state.cartPrefill) {
      const cp = state.cartPrefill;
      const cartLines = [];
      if (cp.cartType) cartLines.push(`商城用途：${CART_TYPE_MAP[cp.cartType] || cp.cartType}`);
      if (cp.cartPaymentMethod) cartLines.push(`付款方式：${CART_PAYMENT_MAP[cp.cartPaymentMethod] || cp.cartPaymentMethod}`);
      if (cartLines.length > 0) {
        lines.push("─── 商城訂單資訊 ───");
        lines.push(...cartLines);
      }
    }

    if (state.form.content) lines.push(state.form.content);
    return lines.join("\n");
  }

  /* === Utils === */
  function formatDate(d) {
    if (!d) return "";
    const date = new Date(d + "T00:00:00");
    const m = date.getMonth() + 1;
    const day = date.getDate();
    const w = ["日", "一", "二", "三", "四", "五", "六"][date.getDay()];
    return `${m}/${day}（週${w}）`;
  }
  function getRoundTitle(roundId) {
    if (!roundId) return "";
    const r = state.rounds.find(x => String(x.roundId) === String(roundId));
    return r ? r.title : "";
  }
  function isSameDate(a, b) {
    return a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
  }
  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* === Export === */
  root.LohasBookingModal = { open, close };

})(window);
