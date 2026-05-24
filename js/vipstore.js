/* =============================================
   LOHAS · vipstore.html · Leaflet 地圖版
   --------------------------------------------
   依賴：
   - js/api/api-core.js
   - js/api/api-store.js                  ← 門市資料（左手 API）
   - js/api/api-vipstore.js        ← 商店街資料（即時互動／搜點子 API）
   - js/store-data.js                     ← 門市資料正規化
   - Leaflet (CDN)
   --------------------------------------------
   流程：
   1. 同時打兩支 API
        a. LohasApi.vipstore.getUnitList()   → 商店街店家
        b. LohasApi.store.getAllStores()           → LOHAS 門市（含座標）
   2. 用 bindStore 欄位（門市 erpid 陣列）把兩邊 join 起來
   3. 列表渲染商店街店家；地圖只放 LOHAS 門市 pin
   4. 點店家 → 高亮「該店家綁定的所有門市」+ 顯示「離我最近合作門市」
   5. 點門市 pin → 顯示「此門市可用的所有商店街優惠」
   ============================================= */

(function () {
  "use strict";

  const { core } = window.LohasApi;
  const { store: storeApi } = window.LohasApi;
  const { vipstore: ssApi } = window.LohasApi;
  const { data: storeData } = window.LohasStore;

  /* ===== 開發階段開關 =====
     true  → 用內建假資料快速看畫面
     false → 打真實 API */
  const USE_MOCK = false;

  /* === State === */
  const state = {
    units: [],              // 商店街店家清單（已 attachBoundStores）
    stores: [],             // LOHAS 門市清單
    storesByErpid: new Map(),
    filtered: [],           // 篩選後的 units
    activeCat: "all",       // 目前選擇的類別
    activeUnitId: null,     // 目前選擇的店家
    activeStoreErpid: null, // 目前選擇的門市
    keyword: "",
    userPos: null,          // 使用者位置 {lat,lng}
    map: null,
    storeMarkers: {},       // erpid -> L.marker
    boundStoreErpids: new Set(), // 目前選擇店家的合作門市集合（用於高亮）
  };

  /* 預設地圖視角：台灣全島 */
  const DEFAULT_VIEW = { center: [23.7, 121.0], zoom: 7 };

  /* 類別 icon 對照（FontAwesome） */
  const CAT_ICONS = {
    "咖啡茶飲": "fa-mug-hot",
    "美食餐廳": "fa-utensils",
    "美容保養": "fa-spa",
    "生活選物": "fa-bag-shopping",
    "旅宿住宿": "fa-hotel",
    "書店文化": "fa-book",
    "運動健身": "fa-dumbbell",
    "花藝":     "fa-leaf",
    "公司行號": "fa-briefcase",
    "default":  "fa-store"
  };

  const dom = {};

  document.addEventListener("DOMContentLoaded", async () => {
    cacheDom();
    bindEvents();
    initMap();
    await loadAll();
  });

  function cacheDom() {
    dom.search        = document.getElementById("vs-search");
    dom.cats          = document.getElementById("vs-cats");
    dom.list          = document.getElementById("vs-list");
    dom.layout        = document.getElementById("vs-layout");
    dom.mapCanvas     = document.getElementById("vs-map-canvas");
    dom.pinCard       = document.getElementById("vs-pin-card");
    dom.viewTabs      = document.getElementById("vs-view-tabs");
    dom.mapCount      = document.getElementById("vs-map-count");
    dom.totalCount    = document.getElementById("vsTotalCount");
    dom.listTitle     = document.querySelector(".vs-list-title");
    /* KPI (手機版顯示) */
    dom.kpiUnits      = document.getElementById("vsKpiUnits");
    dom.kpiStores     = document.getElementById("vsKpiStores");
    dom.kpiCats       = document.getElementById("vsKpiCats");
    /* 新增: browse view 與 view 切換 */
    dom.browse        = document.getElementById("vs-browse");
    dom.browseInner   = document.querySelector("#vs-browse .vs-browse-inner");
    dom.viewSwitch    = document.getElementById("vs-view-switch");
    /* 新增: 詳情浮層 */
    dom.detailOvl     = document.getElementById("vs-detail-ovl");
    dom.detailModal   = document.getElementById("vs-detail-modal");
  }

  function bindEvents() {
    /* 類別 chip */
    dom.cats.addEventListener("click", e => {
      const chip = e.target.closest(".vs-chip");
      if (!chip) return;
      dom.cats.querySelectorAll(".vs-chip").forEach(c => c.classList.remove("is-active"));
      chip.classList.add("is-active");
      state.activeCat = chip.dataset.cat;
      clearActiveUnit();
      refresh();
      renderBrowse();   /* browse view 也要更新 */
    });

    /* 搜尋 */
    dom.search.addEventListener("input", debounce(e => {
      state.keyword = e.target.value.trim().toLowerCase();
      refresh();
      renderBrowse();
    }, 250));

    /* 列表點擊 */
    dom.list.addEventListener("click", e => {
      // 收藏按鈕單獨處理
      const fav = e.target.closest("[data-action='fav']");
      if (fav) {
        e.stopPropagation();
        fav.classList.toggle("is-on");
        fav.classList.toggle("fa-regular");
        fav.classList.toggle("fa-solid");
        return;
      }
      const card = e.target.closest(".vs-place");
      if (!card) return;
      selectUnit(card.dataset.unitId);
    });

    /* 地圖工具 */
    document.querySelectorAll(".vs-map-tool").forEach(btn => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.action;
        if (action === "zoom-in")  state.map.zoomIn();
        if (action === "zoom-out") state.map.zoomOut();
        if (action === "locate")   locateUser();
      });
    });

    /* 手機底部 TAB */
    if (dom.viewTabs) {
      dom.viewTabs.addEventListener("click", e => {
        const tab = e.target.closest(".vs-view-tab");
        if (!tab) return;
        switchView(tab.dataset.view);
      });
    }

    /* 電腦版 view 切換 */
    if (dom.viewSwitch) {
      dom.viewSwitch.addEventListener("click", e => {
        const btn = e.target.closest(".vs-view-btn");
        if (!btn) return;
        switchView(btn.dataset.view);
      });
    }

    /* Browse view 委派點擊 */
    if (dom.browseInner) {
      dom.browseInner.addEventListener("click", e => {
        /* 看全部 → 切換到單一類別 */
        const more = e.target.closest(".vs-sec-more");
        if (more) {
          const catId = more.dataset.cat;
          activateCategory(catId);
          return;
        }
        /* 看更多分類 → 滾到下方 */
        const moreCats = e.target.closest(".vs-browse-more");
        if (moreCats) {
          const all = dom.browseInner.querySelectorAll(".vs-sec");
          if (all.length) all[all.length - 1].scrollIntoView({ behavior: "smooth" });
          return;
        }
        /* 收藏按鈕 */
        const fav = e.target.closest("[data-action='fav']");
        if (fav) {
          e.stopPropagation();
          const icon = fav.querySelector("i");
          fav.classList.toggle("is-on");
          if (icon) {
            icon.classList.toggle("fa-regular");
            icon.classList.toggle("fa-solid");
          }
          return;
        }
        /* 點卡 → 開詳情浮層 */
        const card = e.target.closest(".vs-place");
        if (card) {
          openDetail(card.dataset.unitId);
        }
      });
    }

    /* 詳情浮層關閉 */
    if (dom.detailOvl) {
      dom.detailOvl.addEventListener("click", e => {
        if (e.target === dom.detailOvl) closeDetail();
        const closeBtn = e.target.closest("[data-action='detail-close']");
        if (closeBtn) closeDetail();
        const mapBtn = e.target.closest("[data-action='detail-show-on-map']");
        if (mapBtn) {
          const unitId = mapBtn.dataset.unitId;
          closeDetail();
          switchView("map");
          /* 等 view 切換完再 selectUnit (避免 map 還沒 render) */
          setTimeout(() => selectUnit(unitId), 100);
        }
      });
      document.addEventListener("keydown", e => {
        if (e.key === "Escape" && dom.detailOvl.classList.contains("is-show")) {
          closeDetail();
        }
      });
    }

    /* 浮動快速導引按鈕 (滾動 240px 後浮現,智慧切換) */
    bindScrollToCta();
  }

  /* === 浮動快速導引按鈕 === */
  function bindScrollToCta() {
    const btn = document.getElementById("vsScrollToCta");
    const target = document.getElementById("vsCtaBlock");
    if (!btn || !target) return;

    const label = btn.querySelector(".vs-scroll-label");

    function onScroll() {
      /* 滾動 240px 後浮現 */
      const scrolled = window.scrollY > 240;
      btn.classList.toggle("is-show", scrolled);

      /* 進入 CTA 範圍 60% 時切換成「回到頂部」 */
      const rect = target.getBoundingClientRect();
      const inCta = rect.top < window.innerHeight * 0.6;
      btn.classList.toggle("is-at-bottom", inCta);

      if (label) label.textContent = inCta ? "回到頂部" : "申請特約";
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    /* 點擊:依當前狀態決定捲到 CTA 或頂部 */
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      if (btn.classList.contains("is-at-bottom")) {
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

  /* === View 切換 === */
  function switchView(view) {
    if (view !== "browse" && view !== "map") return;
    dom.layout.dataset.view = view;

    /* 同步兩組切換按鈕的 active 狀態 */
    if (dom.viewSwitch) {
      dom.viewSwitch.querySelectorAll(".vs-view-btn").forEach(b => {
        b.classList.toggle("is-active", b.dataset.view === view);
      });
    }
    if (dom.viewTabs) {
      dom.viewTabs.querySelectorAll(".vs-view-tab").forEach(t => {
        t.classList.toggle("is-active", t.dataset.view === view);
      });
    }

    /* 切到地圖時要重新計算 Leaflet 尺寸 */
    if (view === "map" && state.map) {
      setTimeout(() => state.map.invalidateSize(), 50);
    }
  }

  /* === 啟用特定類別 (從 browse 「看全部」點過來) === */
  function activateCategory(catId) {
    /* 找對應 chip 並切換 */
    const chip = dom.cats.querySelector(`.vs-chip[data-cat="${cssEscape(catId)}"]`);
    if (chip) {
      dom.cats.querySelectorAll(".vs-chip").forEach(c => c.classList.remove("is-active"));
      chip.classList.add("is-active");
    }
    state.activeCat = catId;
    clearActiveUnit();
    refresh();
    renderBrowse();   /* browse view 也要更新 */
    /* 平滑滾到頂 */
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* === 載入資料 ===
     兩支 API 並行打，任一失敗都不會卡住另一邊
     -----
     B 方案說明:
     API 23 (getUnitList) 不回類別,所以列表畫完後,
     對每筆 unit 並行打 API 25 (getAppointedUnitByCode) 補類別。
     用 throttle 限制並發數,避免一次打太多 request。 */
  async function loadAll() {
    showLoading();

    let unitsRaw = [];
    let storesRaw = [];

    if (USE_MOCK) {
      const mock = getMockData();
      unitsRaw = mock.units;
      storesRaw = mock.stores;
    } else {
      const results = await Promise.allSettled([
        ssApi.getUnitList({ paginate: 3000 }),
        storeApi.getAllStores()
      ]);

      if (results[0].status === "fulfilled") {
        const r = results[0].value;
        unitsRaw = (r && r.info) ? r.info : (Array.isArray(r) ? r : []);
      } else {
        console.error("[vipstore] getUnitList fail", results[0].reason);
      }

      if (results[1].status === "fulfilled") {
        storesRaw = results[1].value || [];
      } else {
        console.error("[vipstore] getAllStores fail", results[1].reason);
      }
    }

    /* 正規化 */
    state.stores = storesRaw
      .map(storeData.normalizeStore)
      .filter(s => s && s.lat && s.lng);

    state.storesByErpid = new Map(state.stores.map(s => [String(s.erpid), s]));

    const units = unitsRaw.map(ssApi.normalizeUnit).filter(Boolean);
    state.units = ssApi.attachBoundStores(units, state.stores);

    /* 先渲染一次:列表會出來,但類別還沒 */
    renderCategories();
    renderStoreMarkers();
    refresh();
    renderBrowse();    /* 新增: browse view 也要渲染 */

    /* 更新總計 */
    if (dom.totalCount) dom.totalCount.textContent = state.units.length;
    updateKpi();

    /* === B 方案:背景補類別,完成後重新渲染 === */
    if (!USE_MOCK) {
      enrichCategoriesInBackground();
    }
  }

  /* === 背景補類別 (B 方案 - 改良版) ===
     策略: 不對 1075 筆店家各打一次 API 25,改用 category_id 反查
     -----
     1. 試 category_id 1~30,每個拿回該類別全部店家
     2. 建 unit_name → {categoryId, categoryName} 對照表
     3. 套回 state.units 補上類別
     -----
     優點:從 1075 次 request 降到 ~30 次
     並發數限制為 5 以免被擋 */
  async function enrichCategoriesInBackground() {
    const targets = state.units.filter(u => u.name && !u.categoryName);
    if (!targets.length) return;

    console.log(`[vipstore] 背景補類別 ${targets.length} 筆,改用 category_id 反查...`);

    /* 試所有可能的 category_id (1~30) */
    const MAX_CAT = 30;
    const CONCURRENCY = 5;
    const nameToCategory = new Map();   // unit_name → {id, name}
    let foundCategories = 0;

    let cursor = 1;
    async function worker() {
      while (cursor <= MAX_CAT) {
        const catId = cursor++;
        try {
          const r = await ssApi.getAppointedUnitByCode({
            category_id: String(catId)
          });
          /* API 25 回的是陣列 */
          const list = Array.isArray(r) ? r : (r ? [r] : []);
          if (!list.length) continue;

          foundCategories++;
          list.forEach(item => {
            if (item && item.unit_name) {
              nameToCategory.set(item.unit_name, {
                id:   String(item.category_id || catId),
                name: item.category_name || ""
              });
            }
          });
        } catch (e) {
          /* 該 category_id 沒資料,跳過 */
        }
      }
    }

    const workers = Array.from({ length: CONCURRENCY }, () => worker());
    await Promise.all(workers);

    /* 套對照表到 state.units */
    let updated = 0;
    state.units.forEach(u => {
      const cat = nameToCategory.get(u.name);
      if (cat) {
        u.categoryId   = cat.id;
        u.categoryName = cat.name;
        updated++;
      }
    });

    console.log(`[vipstore] 補類別完成: 找到 ${foundCategories} 個類別、${nameToCategory.size} 筆對照,套用 ${updated}/${targets.length} 筆店家`);

    if (updated > 0) {
      renderCategories();
      renderList();
      renderBrowse();   /* 新增: browse view 也要重渲染 */
      updateKpi();      /* 類別數會變,更新 KPI */
    }
  }

  /* === 更新手機版 KPI 三指標 === */
  function updateKpi() {
    if (dom.kpiUnits) dom.kpiUnits.textContent = state.units.length.toLocaleString();
    if (dom.kpiStores) {
      const usedStoreIds = new Set();
      state.units.forEach(u => {
        (u.boundStores || []).forEach(s => usedStoreIds.add(s.erpid));
      });
      const allStoreCount = state.stores.length;
      const usedCount = usedStoreIds.size || allStoreCount;
      dom.kpiStores.textContent = (usedCount >= 30) ? "30+" : usedCount;
    }
    if (dom.kpiCats) {
      const cats = new Set();
      state.units.forEach(u => { if (u.categoryId) cats.add(String(u.categoryId)); });
      dom.kpiCats.textContent = cats.size || "--";
    }
  }

  function showLoading() {
    if (dom.list) {
      dom.list.innerHTML = '<div class="vs-loading">載入中…</div>';
    }
  }

  /* === 渲染類別 chip === */
  function renderCategories() {
    /* 從 units 推類別清單（API 25 才有 categoryId/categoryName，
       API 23 沒給。如果都沒拿到就只顯示「全部」） */
    const seen = new Map();
    state.units.forEach(u => {
      if (u.categoryName && !seen.has(u.categoryName)) {
        seen.set(u.categoryName, u.categoryId || u.categoryName);
      }
    });

    /* 第一顆「全部」按鈕保留 HTML 既有的，後面 append */
    const html = Array.from(seen.entries()).map(([name, id]) => {
      const icon = CAT_ICONS[name] || CAT_ICONS.default;
      return `
        <button class="vs-chip" data-cat="${escapeAttr(id)}">
          <i class="fa-solid ${icon}"></i><span>${escapeHtml(name)}</span>
        </button>
      `;
    }).join("");

    /* 清掉舊的「非全部」chip，避免重複 append */
    dom.cats.querySelectorAll(".vs-chip:not([data-cat='all'])").forEach(el => el.remove());
    dom.cats.insertAdjacentHTML("beforeend", html);
  }

  /* === 篩選 === */
  function applyFilter() {
    state.filtered = state.units.filter(u => {
      if (state.activeCat !== "all" && String(u.categoryId) !== String(state.activeCat)) return false;
      if (state.keyword) {
        const text = (u.name + u.intro + u.categoryName).toLowerCase();
        if (!text.includes(state.keyword)) return false;
      }
      return true;
    });

    /* 若使用者已定位，依「最近合作門市」距離排序，否則照 sort 欄位 */
    if (state.userPos) {
      state.filtered.sort((a, b) => {
        const da = ssApi.nearestStoreDistance(a, state.userPos.lat, state.userPos.lng);
        const db = ssApi.nearestStoreDistance(b, state.userPos.lat, state.userPos.lng);
        if (da == null && db == null) return (b.sort || 0) - (a.sort || 0);
        if (da == null) return 1;
        if (db == null) return -1;
        return da - db;
      });
    } else {
      state.filtered.sort((a, b) => (b.sort || 0) - (a.sort || 0));
    }
  }

  function refresh() {
    applyFilter();
    renderList();
    updateMarkersHighlight();
    updateCount();
  }

  /* === 渲染列表 (地圖 view 左側用) === */
  function renderList() {
    if (!state.filtered.length) {
      dom.list.innerHTML = '<div class="vs-loading">這個類別目前沒有特約店家</div>';
      return;
    }
    dom.list.innerHTML = state.filtered.map((u, i) => renderPlaceCard(u, i)).join("");
  }

  /* === 地圖：建立門市 marker（所有門市一次建好）=== */
  function initMap() {
    state.map = L.map(dom.mapCanvas, { zoomControl: false })
      .setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap, &copy; CARTO",
      subdomains: "abcd",
      maxZoom: 20
    }).addTo(state.map);

    /* 點地圖空白處 → 取消選擇 */
    state.map.on("click", () => clearActiveUnit(true));
  }

  function renderStoreMarkers() {
    /* 先清掉舊的 */
    Object.values(state.storeMarkers).forEach(m => state.map.removeLayer(m));
    state.storeMarkers = {};

    state.stores.forEach(s => {
      if (!s.lat || !s.lng) return;
      const icon = createStoreIcon(s, false);
      const m = L.marker([s.lat, s.lng], { icon })
        .addTo(state.map)
        .on("click", () => selectStore(s.erpid));
      state.storeMarkers[s.erpid] = m;
    });
  }

  function createStoreIcon(store, isHighlight) {
    /* 兩種狀態：
       - 預設（灰）：未被選擇的店家點亮
       - 高亮（品牌色）：選擇某店家後，其合作門市 */
    const cls = "vs-store-pin" + (isHighlight ? " is-highlight" : "");
    const label = store.name.replace(/店$/, "");  // 「林口店」→「林口」
    return L.divIcon({
      html: `<div class="${cls}"><i class="fa-solid fa-store"></i><span>${escapeHtml(label)}</span></div>`,
      className: "vs-store-pin-wrap",
      iconSize: null,
      iconAnchor: [50, 14]
    });
  }

  function updateMarkersHighlight() {
    state.stores.forEach(s => {
      const m = state.storeMarkers[s.erpid];
      if (!m) return;
      const highlight = state.boundStoreErpids.has(String(s.erpid));
      m.setIcon(createStoreIcon(s, highlight));
    });
  }

  /* === 選擇店家 === */
  function selectUnit(unitId) {
    const u = state.units.find(x => String(x.id) === String(unitId));
    if (!u) return;

    /* 切換：再點一次取消 */
    if (String(state.activeUnitId) === String(unitId)) {
      clearActiveUnit();
      return;
    }

    state.activeUnitId = unitId;
    state.boundStoreErpids = new Set(
      (u.boundStores || []).map(s => String(s.erpid))
    );

    refresh();

    /* 地圖飛到合作門市群的 bounds，沒有合作門市就維持原視角 */
    if (u.boundStores && u.boundStores.length) {
      const latlngs = u.boundStores
        .filter(s => s.lat && s.lng)
        .map(s => [s.lat, s.lng]);
      if (latlngs.length === 1) {
        state.map.flyTo(latlngs[0], Math.max(state.map.getZoom(), 14), { duration: 0.6 });
      } else if (latlngs.length > 1) {
        state.map.flyToBounds(L.latLngBounds(latlngs), { padding: [60, 60], duration: 0.6 });
      }
    }

    /* 列表卷到該卡 */
    const card = dom.list.querySelector(`.vs-place[data-unit-id="${unitId}"]`);
    if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });

    /* 隱藏門市 popup（避免衝突） */
    dom.pinCard.classList.remove("is-show");
    state.activeStoreErpid = null;
  }

  function clearActiveUnit(alsoCloseMapCard) {
    state.activeUnitId = null;
    state.boundStoreErpids = new Set();
    if (alsoCloseMapCard) {
      dom.pinCard.classList.remove("is-show");
      state.activeStoreErpid = null;
    }
    refresh();
  }

  /* === 選擇門市 → 顯示這間門市有哪些優惠 === */
  function selectStore(erpid) {
    state.activeStoreErpid = String(erpid);
    const store = state.storesByErpid.get(String(erpid));
    if (!store) return;

    /* 找所有「綁定到這間門市 OR 沒綁定（全門市通用）」的特約店家 */
    const matched = state.units.filter(u => {
      if (!u.bindStore || u.bindStore.length === 0) return true; // 全門市通用
      return u.bindStore.map(String).includes(String(erpid));
    });

    /* 渲染 popup (版本 B: 白底 + 縮圖) */
    const showCount = Math.min(matched.length, 8);
    const listHtml = matched.slice(0, showCount).map((u, i) => {
      const palette = (i % 8) + 1;
      const catIcon = CAT_ICONS[u.categoryName] || CAT_ICONS.default;
      return `
        <li class="vs-pin-card-li" data-unit-id="${escapeAttr(u.id)}">
          <div class="vs-pin-card-li-l">
            <div class="vs-pin-card-li-thumb p${palette}">
              <i class="fa-solid ${catIcon}"></i>
            </div>
            <div class="vs-pin-card-li-text">
              <div class="vs-pin-card-li-name">${escapeHtml(u.name)}</div>
              <div class="vs-pin-card-li-cat">${escapeHtml(u.categoryName || '未分類')}</div>
            </div>
          </div>
          <i class="vs-pin-card-li-arr fa-solid fa-chevron-right"></i>
        </li>
      `;
    }).join("");

    dom.pinCard.innerHTML = `
      <div class="vs-pin-card-h">
        <div class="vs-pin-card-h-icon">
          <i class="fa-solid fa-store"></i>
        </div>
        <div class="vs-pin-card-h-text">
          <div class="vs-pin-card-h-name">${escapeHtml(store.name)}</div>
          ${store.address ? `<div class="vs-pin-card-h-addr">${escapeHtml(store.address)}</div>` : ""}
        </div>
        <button class="vs-pin-card-close" type="button" data-close aria-label="關閉">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <div class="vs-pin-card-stat">
        <span class="vs-pin-card-stat-num">${matched.length}</span>
        <span class="vs-pin-card-stat-lab">項<b>特約優惠</b>可在這裡使用</span>
      </div>
      <ul class="vs-pin-card-list">${listHtml}</ul>
      ${matched.length > 8 ? `
        <div class="vs-pin-card-foot" data-show-all-units="${escapeAttr(erpid)}">
          查看全部 ${matched.length} 項 <i class="fa-solid fa-arrow-right"></i>
        </div>
      ` : ""}
    `;
    dom.pinCard.classList.add("is-show");

    /* 關閉 */
    dom.pinCard.querySelector("[data-close]").addEventListener("click", () => {
      dom.pinCard.classList.remove("is-show");
      state.activeStoreErpid = null;
    });

    /* 點 list item → 開該店家詳情浮層 */
    dom.pinCard.querySelectorAll(".vs-pin-card-li").forEach(li => {
      li.addEventListener("click", () => openDetail(li.dataset.unitId));
    });
  }

  /* === 計數 === */
  function updateCount() {
    if (dom.mapCount) {
      const n = state.filtered.length;
      dom.mapCount.innerHTML = `<i class="fa-solid fa-circle"></i> 目前顯示 <b>${n}</b> 間特約店家`;
    }
  }

  /* === 使用者定位 === */
  function locateUser() {
    if (!navigator.geolocation) {
      alert("您的瀏覽器不支援定位");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        state.userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        state.map.flyTo([state.userPos.lat, state.userPos.lng], 13, { duration: 0.6 });
        refresh();
      },
      () => alert("無法取得您的位置，請確認瀏覽器權限"),
      { timeout: 8000, enableHighAccuracy: true }
    );
  }

  /* === 工具 === */
  function debounce(fn, ms) {
    let t;
    return function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function escapeAttr(s) { return escapeHtml(s); }

  /* === CSS 屬性選擇器安全跳脫 === */
  function cssEscape(s) {
    if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(String(s));
    return String(s == null ? "" : s).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  /* === 渲染單一店家卡 (共用,給 list / browse / grid 用) ===
     i 用來決定漸層配色 (p1~p8) */
  function renderPlaceCard(u, i) {
    const palette  = `p${(i % 8) + 1}`;
    const isActive = String(u.id) === String(state.activeUnitId);

    /* 圖區內容:有 logo 就放 logo,沒則放類別 icon 大字 */
    const catIcon = CAT_ICONS[u.categoryName] || CAT_ICONS.default;
    const imgContent = u.imgUrl
      ? `<img src="${escapeAttr(u.imgUrl)}" alt="${escapeAttr(u.name)} logo">`
      : `<i class="fa-solid ${catIcon} vs-place-cat-icon"></i>`;

    /* 距離資訊 */
    let distLine = "";
    if (state.userPos) {
      const d = ssApi.nearestStoreDistance(u, state.userPos.lat, state.userPos.lng);
      if (d != null) {
        distLine = `<span class="vs-place-dist"><i class="fa-solid fa-location-dot"></i> ${d.toFixed(1)} km</span>`;
      }
    }

    /* 合作門市數 */
    const storeCount = (u.boundStores || []).length;
    const storeLine = storeCount
      ? `<span><i class="fa-solid fa-store"></i> ${storeCount} 間合作門市</span>`
      : `<span><i class="fa-solid fa-globe"></i> 全門市通用</span>`;

    return `
      <article class="vs-place ${palette} ${isActive ? 'is-active' : ''}" data-unit-id="${escapeAttr(u.id)}">
        <div class="vs-place-img">
          ${u.categoryName ? `<span class="vs-place-badge">${escapeHtml(u.categoryName)}</span>` : ""}
          <button type="button" class="vs-place-fav" data-action="fav" aria-label="收藏">
            <i class="fa-regular fa-heart"></i>
          </button>
          ${imgContent}
        </div>
        <div class="vs-place-info">
          <div class="vs-place-row1">
            <h3 class="vs-place-name">${escapeHtml(u.name)}</h3>
          </div>
          ${u.intro ? `<p class="vs-place-intro">${escapeHtml(u.intro)}</p>` : ""}
          <div class="vs-place-meta">
            ${storeLine}
            ${distLine}
          </div>
        </div>
      </article>
    `;
  }

  /* === 渲染 Browse view (列表瀏覽) ===
     state.activeCat === "all"  → 顯示前 5 大類別,每類橫向滑卡
     state.activeCat === 其他   → 顯示該類別全部店家 (大網格)
     有搜尋關鍵字時:跨類別搜尋,顯示為大網格 */
  function renderBrowse() {
    if (!dom.browseInner) return;

    /* 載入中狀態:state.units 還沒準備好 */
    if (!state.units || !state.units.length) {
      dom.browseInner.innerHTML = '<div class="vs-loading">載入中…</div>';
      return;
    }

    /* 過濾後的單元 (套用搜尋關鍵字) */
    const matchKeyword = (u) => {
      if (!state.keyword) return true;
      const text = (u.name + u.intro + u.categoryName).toLowerCase();
      return text.includes(state.keyword);
    };

    /* ====== 模式 1: 單一類別模式 (大網格) ====== */
    if (state.activeCat !== "all") {
      const list = state.units.filter(u =>
        String(u.categoryId) === String(state.activeCat) && matchKeyword(u)
      );
      const sorted = list.slice().sort((a, b) => (b.sort || 0) - (a.sort || 0));
      const catName = (sorted[0] && sorted[0].categoryName) || "此分類";

      if (!sorted.length) {
        dom.browseInner.innerHTML = `
          <div class="vs-loading">這個類別目前沒有特約店家</div>
        `;
        return;
      }

      dom.browseInner.innerHTML = `
        <div class="vs-sec">
          <div class="vs-sec-head">
            <div class="vs-sec-l">
              <span class="vs-sec-eb">— CATEGORY</span>
              <h3 class="vs-sec-h">${escapeHtml(catName)}</h3>
              <span class="vs-sec-cnt">${sorted.length} 間</span>
            </div>
          </div>
          <div class="vs-browse-grid">
            ${sorted.map((u, i) => renderPlaceCard(u, i)).join("")}
          </div>
        </div>
      `;
      return;
    }

    /* ====== 模式 2: 搜尋中跨類別 (大網格) ====== */
    if (state.keyword) {
      const list = state.units.filter(matchKeyword);
      const sorted = list.slice().sort((a, b) => (b.sort || 0) - (a.sort || 0));

      if (!sorted.length) {
        dom.browseInner.innerHTML = `
          <div class="vs-loading">找不到符合的店家</div>
        `;
        return;
      }

      dom.browseInner.innerHTML = `
        <div class="vs-sec">
          <div class="vs-sec-head">
            <div class="vs-sec-l">
              <span class="vs-sec-eb">— SEARCH</span>
              <h3 class="vs-sec-h">搜尋結果</h3>
              <span class="vs-sec-cnt">${sorted.length} 間</span>
            </div>
          </div>
          <div class="vs-browse-grid">
            ${sorted.map((u, i) => renderPlaceCard(u, i)).join("")}
          </div>
        </div>
      `;
      return;
    }

    /* ====== 模式 3: 全部 (前 5 大類別 + 橫向滑卡) ====== */
    /* 統計每個類別的店家數,只取有 categoryId 的 */
    const catStats = new Map();   // catId → { name, items: [] }
    state.units.forEach(u => {
      if (!u.categoryId) return;
      const key = String(u.categoryId);
      if (!catStats.has(key)) {
        catStats.set(key, { name: u.categoryName || "其他", items: [] });
      }
      catStats.get(key).items.push(u);
    });

    /* 沒類別 (B 方案還沒跑完) → fallback: 顯示前 24 筆 */
    if (catStats.size === 0) {
      const top = state.units.slice(0, 24);
      dom.browseInner.innerHTML = `
        <div class="vs-sec">
          <div class="vs-sec-head">
            <div class="vs-sec-l">
              <span class="vs-sec-eb">— ALL</span>
              <h3 class="vs-sec-h">特約店家</h3>
              <span class="vs-sec-cnt">${state.units.length} 間</span>
            </div>
          </div>
          <div class="vs-browse-grid">
            ${top.map((u, i) => renderPlaceCard(u, i)).join("")}
          </div>
        </div>
      `;
      return;
    }

    /* 排序類別 (店家數多→少),取前 5 */
    const topCats = Array.from(catStats.entries())
      .sort((a, b) => b[1].items.length - a[1].items.length)
      .slice(0, 5);

    const sections = topCats.map(([catId, info]) => {
      const sortedItems = info.items.slice()
        .sort((a, b) => (b.sort || 0) - (a.sort || 0))
        .slice(0, 10);   /* 每類最多露 10 張 */
      return `
        <div class="vs-sec">
          <div class="vs-sec-head">
            <div class="vs-sec-l">
              <span class="vs-sec-eb">— CATEGORY</span>
              <h3 class="vs-sec-h">${escapeHtml(info.name)}</h3>
              <span class="vs-sec-cnt">${info.items.length} 間</span>
            </div>
            <button class="vs-sec-more" type="button" data-cat="${escapeAttr(catId)}">
              看全部 <i class="fa-solid fa-arrow-right"></i>
            </button>
          </div>
          <div class="vs-scroller">
            ${sortedItems.map((u, i) => renderPlaceCard(u, i)).join("")}
          </div>
        </div>
      `;
    }).join("");

    /* 如果類別超過 5 個,加「看更多分類」按鈕 */
    const moreBtn = catStats.size > 5
      ? `<button class="vs-browse-more" type="button">看更多分類 (共 ${catStats.size} 類)</button>`
      : "";

    dom.browseInner.innerHTML = sections + moreBtn;
  }

  /* === 開啟商家詳情浮層 === */
  function openDetail(unitId) {
    const u = state.units.find(x => String(x.id) === String(unitId));
    if (!u || !dom.detailOvl) return;

    const catIcon = CAT_ICONS[u.categoryName] || CAT_ICONS.default;
    const imgContent = u.imgUrl
      ? `<img src="${escapeAttr(u.imgUrl)}" alt="${escapeAttr(u.name)} logo">`
      : `<i class="fa-solid ${catIcon} vs-detail-cat-icon"></i>`;

    const boundStores = u.boundStores || [];
    const storesHtml = boundStores.length
      ? `
        <div class="vs-detail-stores">
          <p class="vs-detail-stores-title">合作門市 · ${boundStores.length} 間</p>
          <div class="vs-detail-stores-list">
            ${boundStores.map(s => `
              <span class="vs-detail-store-chip">
                <i class="fa-solid fa-location-dot"></i> ${escapeHtml(s.name)}
              </span>
            `).join("")}
          </div>
        </div>
      `
      : `
        <div class="vs-detail-all-stores">
          <i class="fa-solid fa-globe"></i> 全門市通用 · 任一間樂活門市皆可使用
        </div>
      `;

    const introClean = (u.intro || "").trim();
    const showIntro = introClean && !/^特約編號[::]/.test(introClean);

    const code = u._raw && (u._raw.appointed_unit_code || u._raw.id) || u.id;

    dom.detailModal.innerHTML = `
      <div class="vs-detail-img">
        ${u.categoryName ? `<span class="vs-detail-badge">${escapeHtml(u.categoryName)}</span>` : ""}
        <button class="vs-detail-close" type="button" data-action="detail-close" aria-label="關閉">
          <i class="fa-solid fa-xmark"></i>
        </button>
        ${imgContent}
      </div>
      <div class="vs-detail-body">
        <h2 class="vs-detail-name">${escapeHtml(u.name)}</h2>
        <p class="vs-detail-code">特約編號:${escapeHtml(code)}</p>
        ${showIntro ? `<p class="vs-detail-intro">${escapeHtml(introClean)}</p>` : ""}
        ${storesHtml}
        <div class="vs-detail-actions">
          ${boundStores.length ? `
            <button class="vs-detail-btn vs-detail-btn--solid" type="button"
              data-action="detail-show-on-map" data-unit-id="${escapeAttr(u.id)}">
              <i class="fa-solid fa-map-location-dot"></i>
              在地圖上看
            </button>
          ` : ""}
          <a class="vs-detail-btn vs-detail-btn--ghost"
            href="https://line.me/R/ti/p/@lohas" target="_blank" rel="noopener">
            <i class="fa-brands fa-line"></i>
            LINE 詢問優惠
          </a>
        </div>
      </div>
    `;
    dom.detailOvl.classList.add("is-show");
    dom.detailOvl.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeDetail() {
    if (!dom.detailOvl) return;
    dom.detailOvl.classList.remove("is-show");
    dom.detailOvl.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  /* === Mock 假資料（USE_MOCK=true 才用） ===
     門市座標取自 store-data.js 的旗艦店 erpid */
  function getMockData() {
    return {
      stores: [
        { id: 1, erpid: "120089", name: "林口店",   city: "北區",     subname: "", latitude: 25.0805, longitude: 121.3856, address: "新北市林口區...", phone: "" },
        { id: 2, erpid: "120074", name: "新竹店",   city: "新竹區",   subname: "", latitude: 24.8047, longitude: 120.9714, address: "新竹市...", phone: "" },
        { id: 3, erpid: "120073", name: "中科店",   city: "台中區一", subname: "", latitude: 24.1810, longitude: 120.6240, address: "台中市西屯區...", phone: "" },
        { id: 4, erpid: "120055", name: "高美店",   city: "高雄區一", subname: "", latitude: 22.6262, longitude: 120.3115, address: "高雄市左營區...", phone: "" }
      ],
      units: [
        { id: 1,  title: "晨間咖啡所",     introduce: "每日清晨手沖，一杯城市裡的溫柔開場", bindstore: "[120089,120074]", img_path: "", sortweight: 90, category_name: "咖啡茶飲", category_id: 1 },
        { id: 2,  title: "陽光餐桌",       introduce: "義法融合家庭式餐廳", bindstore: "[120089]",        img_path: "", sortweight: 80, category_name: "美食餐廳", category_id: 2 },
        { id: 3,  title: "靜謐美容室",     introduce: "藏在公寓三樓的精品護膚",  bindstore: "[120073]",        img_path: "", sortweight: 70, category_name: "美容保養", category_id: 3 },
        { id: 4,  title: "植葉花藝",       introduce: "當季花材歐式花束",   bindstore: "[]",              img_path: "", sortweight: 60, category_name: "花藝",     category_id: 4 },
        { id: 5,  title: "霧街書房",       introduce: "獨立書店與展覽空間", bindstore: "[120074,120073]", img_path: "", sortweight: 50, category_name: "書店文化", category_id: 5 },
        { id: 6,  title: "森林瑜珈",       introduce: "城市裡的森林系瑜珈教室", bindstore: "[120055]",      img_path: "", sortweight: 40, category_name: "運動健身", category_id: 6 },
        { id: 7,  title: "木質選物",       introduce: "日本職人木製器皿",   bindstore: "[120073,120055]", img_path: "", sortweight: 30, category_name: "生活選物", category_id: 7 },
        { id: 8,  title: "城南旅店",       introduce: "巷弄裡的設計旅店",   bindstore: "[120089,120055]", img_path: "", sortweight: 20, category_name: "旅宿住宿", category_id: 8 }
      ]
    };
  }

})();
