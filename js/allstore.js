/* =============================================
   LOHAS · allstore.html 邏輯
   --------------------------------------------
   依賴：
   - js/api/api-core.js
   - js/api/api-store.js
   - js/store-data.js
   --------------------------------------------
   流程：
   1. 載入時呼叫 getAllStores
   2. 正規化資料
   3. 第一次渲染（list + pins）
   4. 監聽：region 切換、搜尋、點 row/pin
   ============================================= */

(function () {
  "use strict";

  const { core } = window.LohasApi;
  const { store: storeApi } = window.LohasApi;
  const { data: storeData } = window.LohasStore;

  /* === State === */
  const state = {
    allStores: [],     // 全部正規化後的店家
    filtered: [],      // 過濾後的店家
    currentRegion: "all",
    searchText: "",
    activeErpid: null  // 目前選取的店 erpid
  };

  /* === DOM refs（DOMContentLoaded 後填入） === */
  const dom = {};

  document.addEventListener("DOMContentLoaded", async () => {
    cacheDom();
    bindEvents();
    renderRegionPills();
    await loadStores();
  });

  function cacheDom() {
    dom.resultCount = document.getElementById("as-result-count");
    dom.search = document.getElementById("as-search");
    dom.regions = document.getElementById("as-regions");
    dom.list = document.getElementById("as-store-list");
    dom.pins = document.getElementById("as-pins");
    dom.hint = document.getElementById("as-map-hint");
    dom.pinCard = document.getElementById("as-pin-card");
  }

  function bindEvents() {
    /* 區域切換 */
    dom.regions.addEventListener("click", e => {
      const pill = e.target.closest(".region-pill");
      if (!pill) return;
      dom.regions.querySelectorAll(".region-pill").forEach(x => x.classList.remove("active"));
      pill.classList.add("active");
      state.currentRegion = pill.dataset.region;
      state.activeErpid = null;
      dom.hint.classList.remove("hide");
      dom.pinCard.classList.remove("show");
      refresh();
    });

    /* 搜尋 */
    let searchTimer;
    dom.search.addEventListener("input", e => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.searchText = e.target.value.trim().toLowerCase();
        refresh();
      }, 200);
    });

    /* 點列表 row → selectStore */
    dom.list.addEventListener("click", e => {
      const row = e.target.closest(".as-store-row");
      if (!row) return;
      /* row 內的 button 不觸發選取（用 stopPropagation） */
      if (e.target.closest(".as-store-row-btn")) {
        const btn = e.target.closest(".as-store-row-btn");
        handleStoreAction(btn, row.dataset.erpid);
        return;
      }
      selectStore(row.dataset.erpid);
    });

    /* 點 SVG 內的 pin → selectStore（SVG 內事件要用 closest("[data-erpid]")）*/
    dom.pins.addEventListener("click", e => {
      const pin = e.target.closest("[data-erpid]");
      if (!pin) return;
      selectStore(pin.dataset.erpid);
    });
  }

  function renderRegionPills() {
    const regions = [
      { key: "all", label: "全部" }
    ].concat(
      storeData.getAllRegions().map(r => ({ key: r.key, label: r.label }))
    );
    dom.regions.innerHTML = regions.map((r, i) =>
      `<button class="region-pill${i === 0 ? " active" : ""}" data-region="${r.key}">` +
        `${r.label}<em data-count></em>` +
      `</button>`
    ).join("");
  }

  function updateRegionCounts() {
    const counts = { all: state.allStores.length };
    state.allStores.forEach(s => {
      counts[s.region.key] = (counts[s.region.key] || 0) + 1;
    });
    dom.regions.querySelectorAll(".region-pill").forEach(pill => {
      const region = pill.dataset.region;
      const n = counts[region] || 0;
      const em = pill.querySelector("em[data-count]");
      if (em) em.textContent = n;
    });
  }

  /* === 載入店家資料 === */
  async function loadStores() {
    renderLoading();
    try {
      const raw = await storeApi.getAllStores();
      state.allStores = (raw || [])
        .map(storeData.normalizeStore)
        .filter(Boolean)
        .sort((a, b) => a.region.order - b.region.order || a.sort - b.sort);
      updateRegionCounts();
      refresh();
    } catch (err) {
      renderError(err);
    }
  }

  /* === 過濾 === */
  function applyFilter() {
    state.filtered = state.allStores.filter(s => {
      if (state.currentRegion !== "all" && s.region.key !== state.currentRegion) return false;
      if (state.searchText) {
        const text = (s.name + s.address + s.slogan + s.region.label).toLowerCase();
        if (!text.includes(state.searchText)) return false;
      }
      return true;
    });
  }

  function refresh() {
    applyFilter();
    renderResultCount();
    renderList();
    renderPins();
    renderPinCard();
  }

  /* === 渲染 === */
  function renderResultCount() {
    const n = state.filtered.length;
    const total = state.allStores.length;
    dom.resultCount.textContent =
      state.currentRegion === "all" && !state.searchText
        ? `顯示全部 ${total} 間門市`
        : `顯示 ${n} 間門市`;
  }

  function renderList() {
    if (state.filtered.length === 0) {
      dom.list.innerHTML =
        '<div class="store-state">' +
          '<div class="store-state-icon"><i class="fa-regular fa-face-frown"></i></div>' +
          '<div class="store-state-title">沒有符合的門市</div>' +
          '<div class="store-state-msg">換個關鍵字或選別的地區試試</div>' +
        '</div>';
      return;
    }

    dom.list.innerHTML = state.filtered.map(s => {
      const flagBadge = s.isFlagship
        ? `<span class="store-flag-tag${s.isOverseas ? " overseas" : ""}">${s.isOverseas ? "海外" : "旗艦"}</span>`
        : "";
      const isActive = state.activeErpid === s.erpid;
      return (
        `<div class="as-store-row${isActive ? " active" : ""}" data-erpid="${s.erpid}">` +
          `<span class="as-store-row-distance">#${s.erpid}</span>` +
          `<div class="as-store-row-head">` +
            `<span class="as-store-row-name">${s.name}</span>` +
            flagBadge +
          `</div>` +
          (s.slogan ? `<div class="as-store-row-slogan">${s.slogan}</div>` : "") +
          `<div class="as-store-row-addr">${s.address}</div>` +
          `<div class="as-store-row-meta">` +
            `<span class="store-status-dot"><i class="fa-solid fa-circle"></i>營業中</span>` +
            (s.worktime ? `<span><i class="fa-regular fa-clock"></i>${s.worktime}</span>` : "") +
          `</div>` +
          `<div class="as-store-row-actions">` +
            `<a class="as-store-row-btn outline" data-action="navigate"><i class="fa-solid fa-diamond-turn-right"></i> 導航</a>` +
            `<a class="as-store-row-btn outline" data-action="info"><i class="fa-solid fa-store"></i> 門市資訊</a>` +
            `<a class="as-store-row-btn book" data-action="book"><i class="fa-regular fa-calendar-check"></i> 立即預約</a>` +
          `</div>` +
        `</div>`
      );
    }).join("");
  }

  function renderPins() {
    /* pin 用 SVG 渲染，直接畫在台灣輪廓 SVG 內，自動跟著縮放
       不畫海外店，台灣本島區域才有 pin */
    const list = state.filtered.filter(s => !s.isOverseas);

    const pinsSvg = list.map(s => {
      const pos = computeSvgPos(s);
      const cls =
        "pin-g" +
        (s.isFlagship ? " flagship" : "") +
        (state.activeErpid === s.erpid ? " active" : "");

      const isActive = state.activeErpid === s.erpid;
      const scale = s.isFlagship ? 1.15 : 1;
      const pulse = isActive
        ? `<circle class="pin-pulse" cx="${pos.x}" cy="${pos.y - 6}" r="5"/>`
        : "";

      return (
        pulse +
        `<g class="${cls}" data-erpid="${s.erpid}" transform="translate(${pos.x},${pos.y}) scale(${scale})">` +
          /* 陰影 */
          `<ellipse class="pin-shadow" cx="0" cy="0" rx="3" ry="1"/>` +
          /* 水滴 head（尖端在 (0,0)，圓在上方）*/
          `<path class="pin-head-svg" d="M 0,0 C -4,-6 -4,-10 0,-12 C 4,-10 4,-6 0,0 Z"/>` +
          /* 中心圓點 */
          `<circle class="pin-dot" cx="0" cy="-8" r="1.6"/>` +
        `</g>`
      );
    }).join("");

    /* 重要：SVG 內元素需用 SVG namespace 才能正確渲染。
       innerHTML 在 SVG 環境會 work，但某些瀏覽器邊界有問題。
       這裡用 DOMParser 解析後逐一搬移，最穩定。 */
    setSvgInnerHTML(dom.pins, pinsSvg);
  }

  /* 安全地把 HTML 字串塞進 SVG 子元素裡（修正命名空間問題） */
  function setSvgInnerHTML(svgNode, htmlString) {
    /* 把 string 包進臨時 SVG 解析，再搬移節點過來 */
    const parser = new DOMParser();
    const doc = parser.parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg">${htmlString}</svg>`,
      "image/svg+xml"
    );
    /* 清空現有 */
    while (svgNode.firstChild) svgNode.removeChild(svgNode.firstChild);
    /* 搬移所有節點 */
    const children = Array.from(doc.documentElement.childNodes);
    children.forEach(child => {
      svgNode.appendChild(child);
    });
  }

  /* === 經緯度 → SVG viewBox 座標（300×400）===
     viewBox 300×400 對應經度 119.5-122.5、緯度 21.5-25.5 */
  function computeSvgPos(s) {
    if (s.lat && s.lng) {
      const x = ((s.lng - 119.5) / 3.0) * 300;
      const y = ((25.5 - s.lat) / 4.0) * 400;
      return { x, y };
    }
    return regionFallbackSvgPos(s.region.key, s.erpid);
  }

  /* 沒座標時用 region 假位置（SVG 座標 0-300, 0-400） */
  function regionFallbackSvgPos(regionKey, erpid) {
    const base = {
      north:      { x: 155, y: 70 },   // 北部
      hsinchu:    { x: 135, y: 115 },  // 新竹
      taichung1:  { x: 140, y: 195 },  // 台中區一
      taichung2:  { x: 135, y: 188 },  // 台中區二
      kaohsiung1: { x: 160, y: 325 },  // 高雄區一
      tainan:     { x: 150, y: 290 },  // 台南
      kaohsiung2: { x: 155, y: 320 }   // 高雄區二
    }[regionKey] || { x: 150, y: 200 };
    const offset = (parseInt(String(erpid).slice(-2), 10) || 0) % 10;
    return {
      x: base.x + (offset - 5) * 3,
      y: base.y + ((offset * 7) % 10 - 5) * 2.5
    };
  }

  function renderPinCard() {
    if (!state.activeErpid) {
      dom.pinCard.classList.remove("show");
      return;
    }
    const s = storeData.findStoreByErpid(state.allStores, state.activeErpid);
    if (!s) return;
    const flagBadge = s.isFlagship
      ? `<span class="as-pin-card-flag">${s.isOverseas ? "海外旗艦" : "旗艦門市"}</span>`
      : `<span class="as-pin-card-flag">${s.region.label}</span>`;
    const imgStyle = s.coverimage
      ? `background-image:url('${s.coverimage}');`
      : "";

    dom.pinCard.innerHTML =
      `<div class="as-pin-card-img${s.isFlagship ? " flagship" : ""}" style="${imgStyle}">` +
        flagBadge +
        `<button class="as-pin-card-close" data-close><i class="fa-solid fa-xmark"></i></button>` +
        (s.coverimage ? "" : `<i class="fa-solid fa-store"></i>`) +
      `</div>` +
      `<div class="as-pin-card-body">` +
        `<div class="as-pin-card-name">${s.name}<span class="store-erp-tag">#${s.erpid}</span></div>` +
        (s.slogan ? `<div class="as-pin-card-slogan">${s.slogan}</div>` : "") +
        `<div class="as-pin-card-addr">${s.address}</div>` +
        `<div class="as-pin-card-meta">` +
          `<div><span class="store-status-dot"><i class="fa-solid fa-circle"></i><b>營業中</b></span></div>` +
          (s.worktime ? `<div><i class="fa-regular fa-clock"></i><b>${s.worktime}</b></div>` : "") +
          (s.phone ? `<div><i class="fa-solid fa-phone"></i><b>${s.phone}</b></div>` : "") +
          `<div><i class="fa-solid fa-route"></i><b>${s.region.label}</b></div>` +
        `</div>` +
        `<div class="as-pin-card-actions">` +
          `<a class="btn outline" data-action="navigate"><i class="fa-solid fa-diamond-turn-right"></i> 導航</a>` +
          `<a class="btn filled" data-action="book"><i class="fa-regular fa-calendar-check"></i> 立即預約此門市</a>` +
        `</div>` +
      `</div>`;
    dom.pinCard.classList.add("show");

    /* 綁定卡片內部事件 */
    dom.pinCard.querySelector("[data-close]").addEventListener("click", () => {
      state.activeErpid = null;
      dom.hint.classList.remove("hide");
      refresh();
    });
    dom.pinCard.querySelectorAll(".as-pin-card-actions .btn").forEach(btn => {
      btn.addEventListener("click", () => handleStoreAction(btn, s.erpid));
    });
  }

  function renderLoading() {
    dom.list.innerHTML =
      '<div class="store-state">' +
        '<div class="store-spinner"></div>' +
        '<div class="store-state-title" style="margin-top:14px;">載入門市資料中</div>' +
      '</div>';
  }

  function renderError(err) {
    console.error(err);
    dom.list.innerHTML =
      '<div class="store-state">' +
        '<div class="store-state-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>' +
        '<div class="store-state-title">無法載入門市資料</div>' +
        `<div class="store-state-msg">${err.message || "請稍後再試"}</div>` +
        '<button class="btn-retry" data-retry>重新載入</button>' +
      '</div>';
    const retry = dom.list.querySelector("[data-retry]");
    if (retry) retry.addEventListener("click", loadStores);
  }

  /* === 動作處理 === */
  function selectStore(erpid) {
    state.activeErpid = state.activeErpid === erpid ? null : erpid;
    refresh();
    if (state.activeErpid) {
      dom.hint.classList.add("hide");
      /* 滾動到 active row */
      requestAnimationFrame(() => {
        const row = dom.list.querySelector(".as-store-row.active");
        if (row) row.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    } else {
      dom.hint.classList.remove("hide");
    }
  }

  function handleStoreAction(btn, erpid) {
    const action = btn.dataset.action;
    const s = storeData.findStoreByErpid(state.allStores, erpid);
    if (!s) return;
    if (action === "navigate") {
      const q = encodeURIComponent(s.address);
      const url = s.lat && s.lng
        ? `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`
        : `https://www.google.com/maps/search/?api=1&query=${q}`;
      window.open(url, "_blank");
    } else if (action === "info") {
      window.location.href = `store.html?erpid=${encodeURIComponent(s.erpid)}`;
    } else if (action === "book") {
      window.location.href = `store.html?erpid=${encodeURIComponent(s.erpid)}#book`;
    }
  }

})();
