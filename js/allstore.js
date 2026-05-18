/* =============================================
   LOHAS · allstore.html · Leaflet 地圖版
   --------------------------------------------
   依賴：
   - js/api/api-core.js
   - js/api/api-store.js
   - js/store-data.js
   - Leaflet (CDN)
   --------------------------------------------
   流程：
   1. 初始化 Leaflet 地圖（台灣全島視角）
   2. 載入店家資料 + 為每間店建 marker（自訂 divIcon）
   3. 列表 row 點擊 ↔ 地圖 marker 點擊 雙向連動
   4. 區域 chip 切換 → 地圖飛到該區域
   ============================================= */

(function () {
  "use strict";

  const { core } = window.LohasApi;
  const { store: storeApi } = window.LohasApi;
  const { data: storeData } = window.LohasStore;

  /* === State === */
  const state = {
    allStores: [],
    filtered: [],
    currentRegion: "all",
    searchText: "",
    activeErpid: null,
    map: null,
    markers: {}
  };

  /* === Region 中心座標 + zoom === */
  const REGION_VIEWS = {
    all:        { center: [23.7, 121.0], zoom: 7 },
    north:      { center: [25.0, 121.5], zoom: 11 },
    hsinchu:    { center: [24.8, 121.0], zoom: 11 },
    taichung1:  { center: [24.15, 120.7], zoom: 12 },
    taichung2:  { center: [24.17, 120.65], zoom: 12 },
    kaohsiung1: { center: [22.66, 120.31], zoom: 13 },
    tainan:     { center: [22.99, 120.23], zoom: 13 },
    kaohsiung2: { center: [22.68, 120.30], zoom: 12 },
    malaysia:   { center: [3.08, 101.59], zoom: 12 }
  };

  const dom = {};

  document.addEventListener("DOMContentLoaded", async () => {
    cacheDom();
    bindEvents();
    renderRegionPills();
    initMap();
    await loadStores();
  });

  function cacheDom() {
    dom.search = document.getElementById("as-search");
    dom.regions = document.getElementById("as-regions");
    dom.list = document.getElementById("as-store-list");
    dom.layout = document.getElementById("as-layout");
    dom.mapCanvas = document.getElementById("as-map-canvas");
    dom.pinCard = document.getElementById("as-pin-card");
    dom.viewToggle = document.getElementById("as-view-toggle");
    dom.viewToggleText = document.getElementById("as-view-toggle-text");
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
      dom.pinCard.classList.remove("show");
      refresh();
      flyToRegion(state.currentRegion);
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

    /* 點卡片 */
    dom.list.addEventListener("click", e => {
      const card = e.target.closest(".as-card");
      if (!card) return;
      const erpid = card.dataset.erpid;

      /* 預約按鈕 */
      const bookBtn = e.target.closest('[data-action="book"]');
      if (bookBtn) {
        e.stopPropagation();
        handleStoreAction("book", erpid);
        return;
      }
      /* 導航按鈕 */
      const navBtn = e.target.closest('[data-action="navigate"]');
      if (navBtn) {
        e.stopPropagation();
        handleStoreAction("navigate", erpid);
        return;
      }

      /* 點卡片其他地方 → 選店 + 飛到該店 */
      selectStore(erpid);
    });

    /* 手機版底部切換 FAB */
    if (dom.viewToggle) {
      dom.viewToggle.addEventListener("click", () => {
        dom.layout.classList.toggle("map-mode");
        const isMap = dom.layout.classList.contains("map-mode");
        dom.viewToggleText.textContent = isMap ? "清單" : "地圖";
        const icon = dom.viewToggle.querySelector("i");
        if (icon) {
          icon.className = isMap
            ? "fa-solid fa-list-ul"
            : "fa-solid fa-map-location-dot";
        }
        /* 切到地圖時讓 Leaflet 重算 tiles */
        if (isMap && state.map) {
          setTimeout(() => state.map.invalidateSize(), 250);
        }
      });
    }
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

  /* === Leaflet 地圖初始化 === */
  function initMap() {
    if (typeof L === "undefined") {
      console.error("[allstore] Leaflet (L) 未載入，請確認 leaflet.js 已在 HTML 中載入");
      return;
    }
    state.map = L.map(dom.mapCanvas, {
      center: REGION_VIEWS.all.center,
      zoom: REGION_VIEWS.all.zoom,
      minZoom: 6,
      maxZoom: 18,
      zoomControl: false,
      attributionControl: true,
      scrollWheelZoom: true
    });

    /* Tile layer：OpenStreetMap 預設（免費、無金鑰、無流量限制） */
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19
    }).addTo(state.map);

    /* zoom 控制改放右下 */
    L.control.zoom({ position: "bottomright" }).addTo(state.map);

    /* 點地圖空白處：關閉詳情卡與 marker 高亮 */
    state.map.on("click", () => {
      if (state.activeErpid) {
        state.activeErpid = null;
        renderList();
        renderPinCard();
        updateMarkerStates();
      }
    });

    console.log("[allstore] Leaflet 地圖初始化完成");
  }

  function flyToRegion(regionKey) {
    if (!state.map) return;
    const view = REGION_VIEWS[regionKey] || REGION_VIEWS.all;
    state.map.flyTo(view.center, view.zoom, { duration: 0.8 });
  }

  /* === 載入店家資料 === */
  async function loadStores() {
    console.log("[allstore] loadStores: 開始");
    renderLoading();
    try {
      const raw = await storeApi.getAllStores();
      console.log("[allstore] getAllStores 回傳", raw && raw.length, "筆");

      state.allStores = (raw || [])
        .map(storeData.normalizeStore)
        .filter(Boolean)
        .sort((a, b) => a.region.order - b.region.order || a.sort - b.sort);
      console.log("[allstore] 正規化", state.allStores.length, "間");

      updateRegionCounts();
      addMarkersToMap();
      refresh();
      console.log("[allstore] 渲染完成");
    } catch (err) {
      console.error("[allstore] loadStores 失敗:", err);
      console.error(err.stack);
      renderError(err);
    }
  }

  function addMarkersToMap() {
    if (!state.map) return;
    Object.values(state.markers).forEach(m => state.map.removeLayer(m));
    state.markers = {};

    state.allStores.forEach(s => {
      if (!s.lat || !s.lng) return;
      const icon = createPinIcon(s, false);
      const marker = L.marker([s.lat, s.lng], { icon })
        .addTo(state.map)
        .on("click", () => selectStore(s.erpid));
      state.markers[s.erpid] = marker;
    });
  }

  function createPinIcon(store, isActive) {
    /* C 版電話 pin：顯示電話末四碼或店名 */
    const label = store.phone || store.name;
    const cls = "lohas-pin" + (isActive ? " active" : "");
    return L.divIcon({
      html: `<div class="${cls}">${label}</div>`,
      className: "lohas-pin-wrap",
      iconSize: null,        /* 讓 div 自適應寬度 */
      iconAnchor: [50, 14]   /* 中心錨點 */
    });
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
    renderList();
    updateMarkersVisibility();
  }

  function updateMarkersVisibility() {
    if (!state.map) return;
    const visibleErpIds = new Set(state.filtered.map(s => s.erpid));
    Object.entries(state.markers).forEach(([erpid, marker]) => {
      const shouldShow = state.currentRegion === "all" && !state.searchText
        ? true
        : visibleErpIds.has(erpid);
      const onMap = state.map.hasLayer(marker);
      if (shouldShow && !onMap) state.map.addLayer(marker);
      else if (!shouldShow && onMap) state.map.removeLayer(marker);
    });
  }

  /* === 渲染 === */
  /* === 解析 worktime 並判斷營業中 === */
  function parseWorktime(worktime) {
    if (!worktime) return null;
    const normalized = String(worktime)
      .replace(/：/g, ":")
      .replace(/[~～\-—–－]/g, "~");
    const m = normalized.match(/(\d{1,2}):(\d{2})\s*~\s*(\d{1,2}):(\d{2})/);
    if (!m) return null;
    return {
      startH: parseInt(m[1], 10), startM: parseInt(m[2], 10),
      endH:   parseInt(m[3], 10), endM:   parseInt(m[4], 10)
    };
  }
  function isOpenNow(worktime) {
    const p = parseWorktime(worktime);
    if (!p) return null;
    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();
    const start = p.startH * 60 + p.startM;
    let end = p.endH * 60 + p.endM;
    if (end < start) end += 24 * 60;
    return cur >= start && cur < end;
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
      const isActive = state.activeErpid === s.erpid;
      const photoStyle = s.coverimage ? `style="background-image:url('${s.coverimage}')"` : "";
      const photoEmpty = s.coverimage
        ? ""
        : '<div class="as-card-photo-empty"><i class="fa-solid fa-store"></i></div>';

      /* 真實營業狀態 */
      const openStatus = isOpenNow(s.worktime);
      const statusText = openStatus === true ? "● 營業中" :
                         openStatus === false ? "● 休息中" : "● 營業";
      const statusClass = openStatus === true ? "" :
                          openStatus === false ? "off" : "muted";

      return (
        `<div class="as-card${isActive ? " active" : ""}" data-erpid="${s.erpid}">` +
          `<div class="as-card-photo-wrap">` +
            `<div class="as-card-photo" ${photoStyle}></div>` +
            photoEmpty +
            `<div class="as-card-status ${statusClass}">${statusText}</div>` +
            `<div class="as-card-region">${s.region.label}</div>` +
            `<div class="as-card-name-overlay">` +
              `<div class="as-card-name">${s.name}</div>` +
            `</div>` +
          `</div>` +
          `<div class="as-card-body">` +
            `<div class="as-card-slogan">${s.slogan || ""}</div>` +
            `<div class="as-card-meta">` +
              (s.worktime ? `<span class="as-card-meta-item"><i class="fa-regular fa-clock"></i>${s.worktime}</span>` : "") +
              (s.city ? `<span class="as-card-meta-item"><i class="fa-solid fa-location-dot"></i>${s.city}</span>` : "") +
            `</div>` +
            `<div class="as-card-foot">` +
              `<div class="as-card-phone">` +
                (s.phone
                  ? `<span class="as-card-phone-num"><i class="fa-solid fa-phone"></i>${s.phone}</span>`
                  : `<span class="as-card-phone-num">—</span>`) +
                `<small>${s.region.label}</small>` +
              `</div>` +
              `<div class="as-card-actions">` +
                `<button class="as-card-btn" data-action="navigate" type="button" title="導航">` +
                  `<i class="fa-solid fa-diamond-turn-right"></i>` +
                `</button>` +
                `<button class="as-card-btn as-card-btn-book" data-action="book" type="button">` +
                  `立即預約` +
                `</button>` +
              `</div>` +
            `</div>` +
          `</div>` +
        `</div>`
      );
    }).join("");
  }

  function renderPinCard() {
    if (!state.activeErpid) {
      dom.pinCard.classList.remove("show");
      return;
    }
    const s = storeData.findStoreByErpid(state.allStores, state.activeErpid);
    if (!s) return;
    const imgStyle = s.coverimage ? `background-image:url('${s.coverimage}');` : "";

    dom.pinCard.innerHTML =
      `<div class="as-pin-card-img" style="${imgStyle}">` +
        `<span class="as-pin-card-flag">${s.region.label}</span>` +
        `<button class="as-pin-card-close" data-close type="button"><i class="fa-solid fa-xmark"></i></button>` +
        (s.coverimage ? "" : `<i class="fa-solid fa-store"></i>`) +
      `</div>` +
      `<div class="as-pin-card-body">` +
        `<div class="as-pin-card-name">${s.name}</div>` +
        (s.slogan ? `<div class="as-pin-card-slogan">${s.slogan}</div>` : "") +
        `<div class="as-pin-card-addr">${s.address}</div>` +
        `<div class="as-pin-card-meta">` +
          `<div><span class="store-status-dot"><i class="fa-solid fa-circle"></i><b>營業中</b></span></div>` +
          (s.worktime ? `<div><i class="fa-regular fa-clock"></i><b>${s.worktime}</b></div>` : "") +
          (s.phone ? `<div><i class="fa-solid fa-phone"></i><b>${s.phone}</b></div>` : "") +
          `<div><i class="fa-solid fa-route"></i><b>${s.region.label}</b></div>` +
        `</div>` +
        `<div class="as-pin-card-actions">` +
          `<button class="btn outline" data-action="navigate" type="button"><i class="fa-solid fa-diamond-turn-right"></i> 導航</button>` +
          `<button class="btn filled" data-action="book" type="button"><i class="fa-regular fa-calendar-check"></i> 立即預約此門市</button>` +
        `</div>` +
      `</div>`;
    dom.pinCard.classList.add("show");

    dom.pinCard.querySelector("[data-close]").addEventListener("click", () => {
      state.activeErpid = null;
      updateMarkerStates();
      renderList();
      renderPinCard();
    });
    dom.pinCard.querySelectorAll(".as-pin-card-actions .btn").forEach(btn => {
      btn.addEventListener("click", () => handleStoreAction(btn.dataset.action, s.erpid));
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

  /* === 選店：列表 ↔ 地圖 雙向連動 === */
  function selectStore(erpid) {
    state.activeErpid = state.activeErpid === erpid ? null : erpid;
    renderList();
    renderPinCard();
    updateMarkerStates();

    if (state.activeErpid) {
      const s = storeData.findStoreByErpid(state.allStores, state.activeErpid);
      if (s && s.lat && s.lng && state.map) {
        state.map.flyTo([s.lat, s.lng], Math.max(state.map.getZoom(), 14), { duration: 0.6 });
      }
      requestAnimationFrame(() => {
        const card = dom.list.querySelector(".as-card.active");
        if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }
  }

  function updateMarkerStates() {
    state.allStores.forEach(s => {
      const marker = state.markers[s.erpid];
      if (!marker) return;
      const isActive = state.activeErpid === s.erpid;
      marker.setIcon(createPinIcon(s, isActive));
    });
  }

  /* === 動作處理 === */
  function handleStoreAction(action, erpid) {
    const s = storeData.findStoreByErpid(state.allStores, erpid);
    if (!s) return;
    if (action === "navigate") {
      const q = encodeURIComponent(s.address);
      const url = s.lat && s.lng
        ? `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`
        : `https://www.google.com/maps/search/?api=1&query=${q}`;
      window.open(url, "_blank");
    } else if (action === "book") {
      window.location.href = `store.html?erpid=${encodeURIComponent(s.erpid)}#staff`;
    } else {
      window.location.href = `store.html?erpid=${encodeURIComponent(s.erpid)}`;
    }
  }

})();
