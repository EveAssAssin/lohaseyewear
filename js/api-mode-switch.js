/* =============================================
   LOHAS · API Mode Switcher (開發/管理用)
   --------------------------------------------
   提供右下角小浮動按鈕,讓開發或管理員快速切換 test/prod API mode。

   觸發顯示的三種方式:
     1. URL 加 ?lohas-debug          → 立刻顯示並記住
     2. 鍵盤 Ctrl+Shift+M             → 切換顯示/隱藏
     3. 之前已開啟過 (記在 localStorage)  → 自動顯示

   依賴: window.LohasApi (api-core.js)
   建議掛在 </body> 前,所有 API 模組之後。
   ============================================= */
(function () {
  "use strict";

  const STORAGE_KEY = "lohas_debug_panel";
  const PANEL_ID    = "lohas-mode-switch";

  /* ===== 顯示判定 ===== */
  function shouldShow() {
    // URL ?lohas-debug → 立刻打開並寫入記憶
    if (location.search.indexOf("lohas-debug") !== -1) {
      localStorage.setItem(STORAGE_KEY, "1");
      return true;
    }
    return localStorage.getItem(STORAGE_KEY) === "1";
  }

  /* ===== Panel HTML/CSS 注入 ===== */
  function injectPanel() {
    if (document.getElementById(PANEL_ID)) return;
    if (!window.LohasApi || !window.LohasApi.getMode) {
      console.warn("[mode-switch] LohasApi not loaded");
      return;
    }

    const currentMode = window.LohasApi.getMode();

    const style = document.createElement("style");
    style.textContent = `
      #${PANEL_ID}{
        position:fixed; right:16px; bottom:16px; z-index:99999;
        font-family:"Noto Sans TC",sans-serif;
      }
      #${PANEL_ID} .mode-toggle{
        background:#50422D; color:#fff; border:0;
        padding:8px 14px; border-radius:999px;
        font-size:12px; font-weight:500; letter-spacing:0.5px;
        box-shadow:0 4px 14px rgba(80,66,45,0.3);
        cursor:pointer; display:flex; align-items:center; gap:6px;
      }
      #${PANEL_ID} .mode-toggle .dot{
        width:8px; height:8px; border-radius:50%;
        background:#ffb547;
      }
      #${PANEL_ID} .mode-toggle.is-prod .dot{ background:#5BC97A; }
      #${PANEL_ID} .mode-menu{
        position:absolute; right:0; bottom:48px;
        background:#fff; border:1px solid #E8DED1;
        border-radius:12px; padding:8px;
        box-shadow:0 8px 32px rgba(80,66,45,0.18);
        min-width:160px;
        display:none;
      }
      #${PANEL_ID}.is-open .mode-menu{ display:block; }
      #${PANEL_ID} .mode-menu-head{
        font-size:11px; color:#9B9186; padding:6px 10px 8px;
        letter-spacing:1px;
      }
      #${PANEL_ID} .mode-item{
        display:flex; align-items:center; justify-content:space-between;
        padding:10px 12px; cursor:pointer;
        border-radius:8px; font-size:13px; color:#2F2A24;
      }
      #${PANEL_ID} .mode-item:hover{ background:#F9F8F6; }
      #${PANEL_ID} .mode-item.is-active{
        background:#F4F1EC; font-weight:500;
      }
      #${PANEL_ID} .mode-item .check{
        color:#50422D; font-size:14px;
        visibility:hidden;
      }
      #${PANEL_ID} .mode-item.is-active .check{ visibility:visible; }
      #${PANEL_ID} .mode-foot{
        border-top:1px solid #E8DED1; margin-top:6px; padding:8px 10px 4px;
        font-size:10px; color:#9B9186; line-height:1.5;
      }
      #${PANEL_ID} .mode-close{
        background:none; border:0; color:#9B9186;
        font-size:10px; cursor:pointer; padding:0;
        text-decoration:underline;
      }
    `;
    document.head.appendChild(style);

    const wrap = document.createElement("div");
    wrap.id = PANEL_ID;
    wrap.innerHTML = `
      <button type="button" class="mode-toggle ${currentMode === "prod" ? "is-prod" : ""}" id="${PANEL_ID}-btn">
        <span class="dot"></span>
        <span>API: <b class="mode-label">${currentMode === "prod" ? "正式" : "測試"}</b></span>
      </button>
      <div class="mode-menu">
        <div class="mode-menu-head">API 模式切換</div>
        <div class="mode-item ${currentMode === "test" ? "is-active" : ""}" data-mode="test">
          <span>測試環境 (test)</span>
          <span class="check">✓</span>
        </div>
        <div class="mode-item ${currentMode === "prod" ? "is-active" : ""}" data-mode="prod">
          <span>正式環境 (prod)</span>
          <span class="check">✓</span>
        </div>
        <div class="mode-foot">
          切換後自動重新整理 ·
          <button type="button" class="mode-close" id="${PANEL_ID}-close">隱藏面板</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);

    /* === 事件 === */
    const btn  = document.getElementById(`${PANEL_ID}-btn`);
    const root = document.getElementById(PANEL_ID);

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      root.classList.toggle("is-open");
    });

    document.addEventListener("click", (e) => {
      if (!root.contains(e.target)) root.classList.remove("is-open");
    });

    root.querySelectorAll(".mode-item").forEach((el) => {
      el.addEventListener("click", () => {
        const m = el.getAttribute("data-mode");
        if (m === window.LohasApi.getMode()) {
          root.classList.remove("is-open");
          return;
        }
        window.LohasApi.setMode(m);
        location.reload();
      });
    });

    document.getElementById(`${PANEL_ID}-close`).addEventListener("click", () => {
      localStorage.removeItem(STORAGE_KEY);
      root.remove();
      console.log("[mode-switch] 已隱藏。重新顯示請按 Ctrl+Shift+M 或網址加 ?lohas-debug");
    });
  }

  function removePanel() {
    const el = document.getElementById(PANEL_ID);
    if (el) el.remove();
  }

  /* ===== Ctrl+Shift+M 切換顯示 ===== */
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === "M" || e.key === "m")) {
      e.preventDefault();
      const cur = localStorage.getItem(STORAGE_KEY) === "1";
      if (cur) {
        localStorage.removeItem(STORAGE_KEY);
        removePanel();
        console.log("[mode-switch] 已隱藏");
      } else {
        localStorage.setItem(STORAGE_KEY, "1");
        injectPanel();
        console.log("[mode-switch] 已開啟");
      }
    }
  });

  /* ===== 啟動 ===== */
  function init() {
    if (shouldShow()) injectPanel();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
