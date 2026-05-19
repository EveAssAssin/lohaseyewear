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

  /* 服務項目（這份目前是固定清單；未來如有 API 可動態取得再改） */
  const SERVICES = [
    { id: "exam",     name: "視力檢測",   duration: 30, price: "免費" },
    { id: "consult",  name: "配鏡諮詢",   duration: 40, price: "免費" },
    { id: "multi",    name: "多焦點配鏡", duration: 90, price: "免費" },
    { id: "engrave",  name: "雷刻服務",   duration: 60, price: "NT$500" },
    { id: "repair",   name: "維修保養",   duration: 20, price: "NT$200" }
  ];

  /* state */
  const state = {
    open: false,
    step: 1,                  // 1=staff, 2=time, 3=form, 4=success
    store: null,
    employees: [],
    selectedEmployee: null,
    selectedService: SERVICES[1], // 預設「配鏡諮詢」（向 API 送這個值，但 UI 不再選）
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
    state.store = opts.store;
    state.employees = (opts.employees || []).filter(e => !e.isLeave && !e.isFreeze);
    state.step = 1;
    state.selectedEmployee = null;
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

    /* 預選顧問 → 直接跳第 2 步（時段） */
    if (opts.preselectEmployeeErpId) {
      const target = state.employees.find(e => String(e.erpid) === String(opts.preselectEmployeeErpId));
      if (target) {
        state.selectedEmployee = target;
        state.step = 2;
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
    if (state.step === 1) return renderStepStaff();
    if (state.step === 2) return renderStepTime();
    if (state.step === 3) return renderStepForm();
    if (state.step === 4) return renderSuccess();
    return "";
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
    return (
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
            const active = state.selectedRoundId === r.roundId;
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
      return !!(f.memberName && f.memberNumber && f.memberPhone && f.memberBirthday);
    }
    return false;
  }

  /* === 事件 === */
  function bindShell() {
    const r = getRoot();
    r.querySelector("[data-overlay]").addEventListener("click", e => {
      if (e.target.hasAttribute("data-overlay")) close();
    });
    r.querySelector("[data-close]").addEventListener("click", close);

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

  /* === API：建立預約 === */
  async function submitReservation() {
    if (state.submitting) return;

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
      state.successData = { reservationId };
      state.step = 4;
    } catch (err) {
      alert("建立預約失敗：" + (err.message || "請稍後再試"));
    } finally {
      state.submitting = false;
      renderInPlace();
    }
  }

  function buildContentText() {
    const svc = state.selectedService;
    const lines = [];
    if (svc) lines.push(`預約服務：${svc.name}（約 ${svc.duration} 分鐘）`);
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
