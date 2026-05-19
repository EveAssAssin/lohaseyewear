/* =============================================
   LOHAS · shopping-street.html · Leaflet 地圖版
   --------------------------------------------
   依賴：
   - js/api/api-core.js
   - js/api/api-store.js                  ← 門市資料（左手 API）
   - js/api/api-shopping-street.js        ← 商店街資料（即時互動／搜點子 API）
   - js/store-data.js                     ← 門市資料正規化
   - Leaflet (CDN)
   --------------------------------------------
   流程：
   1. 同時打兩支 API
        a. LohasApi.shoppingStreet.getUnitList()   → 商店街店家
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
  const { shoppingStreet: ssApi } = window.LohasApi;
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
    dom.search        = document.getElementById("ss-search");
    dom.cats          = document.getElementById("ss-cats");
    dom.list          = document.getElementById("ss-list");
    dom.layout        = document.getElementById("ss-layout");
    dom.mapCanvas     = document.getElementById("ss-map-canvas");
    dom.pinCard       = document.getElementById("ss-pin-card");
    dom.viewTabs      = document.getElementById("ss-view-tabs");
    dom.mapCount      = document.getElementById("ss-map-count");
    dom.totalCount    = document.getElementById("ssTotalCount");
    dom.listTitle     = document.querySelector(".ss-list-title");
  }

  function bindEvents() {
    /* 類別 chip */
    dom.cats.addEventListener("click", e => {
      const chip = e.target.closest(".ss-chip");
      if (!chip) return;
      dom.cats.querySelectorAll(".ss-chip").forEach(c => c.classList.remove("is-active"));
      chip.classList.add("is-active");
      state.activeCat = chip.dataset.cat;
      clearActiveUnit();
      refresh();
    });

    /* 搜尋 */
    dom.search.addEventListener("input", debounce(e => {
      state.keyword = e.target.value.trim().toLowerCase();
      refresh();
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
      const card = e.target.closest(".ss-place");
      if (!card) return;
      selectUnit(card.dataset.unitId);
    });

    /* 地圖工具 */
    document.querySelectorAll(".ss-map-tool").forEach(btn => {
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
        const tab = e.target.closest(".ss-view-tab");
        if (!tab) return;
        dom.viewTabs.querySelectorAll(".ss-view-tab").forEach(t => t.classList.remove("is-active"));
        tab.classList.add("is-active");
        document.body.dataset.ssView = tab.dataset.view;
        if (tab.dataset.view === "map") {
          setTimeout(() => state.map.invalidateSize(), 50);
        }
      });
    }
  }

  /* === 載入資料 ===
     兩支 API 並行打，任一失敗都不會卡住另一邊 */
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
        console.error("[shopping-street] getUnitList fail", results[0].reason);
      }

      if (results[1].status === "fulfilled") {
        storesRaw = results[1].value || [];
      } else {
        console.error("[shopping-street] getAllStores fail", results[1].reason);
      }
    }

    /* 正規化 */
    state.stores = storesRaw
      .map(storeData.normalizeStore)
      .filter(s => s && s.lat && s.lng);

    state.storesByErpid = new Map(state.stores.map(s => [String(s.erpid), s]));

    const units = unitsRaw.map(ssApi.normalizeUnit).filter(Boolean);
    state.units = ssApi.attachBoundStores(units, state.stores);

    /* 渲染 */
    renderCategories();
    renderStoreMarkers();
    refresh();

    /* 更新總計 */
    if (dom.totalCount) dom.totalCount.textContent = state.units.length;
  }

  function showLoading() {
    if (dom.list) {
      dom.list.innerHTML = '<div class="ss-loading">載入中…</div>';
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
        <button class="ss-chip" data-cat="${escapeAttr(id)}">
          <i class="fa-solid ${icon}"></i><span>${escapeHtml(name)}</span>
        </button>
      `;
    }).join("");

    /* 清掉舊的「非全部」chip，避免重複 append */
    dom.cats.querySelectorAll(".ss-chip:not([data-cat='all'])").forEach(el => el.remove());
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

  /* === 渲染列表 === */
  function renderList() {
    if (!state.filtered.length) {
      dom.list.innerHTML = '<div class="ss-loading">這個類別目前沒有特約店家</div>';
      return;
    }

    dom.list.innerHTML = state.filtered.map((u, i) => {
      const isActive = String(u.id) === String(state.activeUnitId);

      const imgStyle = u.imgUrl
        ? `style="background-image:url('${escapeAttr(u.imgUrl)}')"`
        : `style="background:${gradientFor(i)}"`;

      /* 距離資訊 */
      let distLine = "";
      if (state.userPos) {
        const d = ssApi.nearestStoreDistance(u, state.userPos.lat, state.userPos.lng);
        if (d != null) {
          distLine = `<span class="ss-place-dist">最近合作門市 ${d.toFixed(1)} km</span>`;
        }
      }

      /* 合作門市數 */
      const storeCount = (u.boundStores || []).length;
      const storeLine = storeCount
        ? `<span class="ss-place-stores"><i class="fa-solid fa-store"></i> ${storeCount} 間合作門市</span>`
        : `<span class="ss-place-stores ss-place-stores--all"><i class="fa-solid fa-globe"></i> 全門市通用</span>`;

      return `
        <article class="ss-place ${isActive ? 'is-active' : ''}" data-unit-id="${escapeAttr(u.id)}">
          <div class="ss-place-img" ${imgStyle}>
            <span class="ss-place-badge">${escapeHtml(u.categoryName || '特約優惠')}</span>
            <i class="fa-regular fa-heart ss-place-fav" data-action="fav"></i>
          </div>
          <h3 class="ss-place-name">${escapeHtml(u.name)}</h3>
          ${u.intro ? `<p class="ss-place-intro">${escapeHtml(u.intro)}</p>` : ""}
          <div class="ss-place-meta">
            ${storeLine}
            ${distLine}
          </div>
        </article>
      `;
    }).join("");
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
    const cls = "ss-store-pin" + (isHighlight ? " is-highlight" : "");
    const label = store.name.replace(/店$/, "");  // 「林口店」→「林口」
    return L.divIcon({
      html: `<div class="${cls}"><i class="fa-solid fa-store"></i><span>${escapeHtml(label)}</span></div>`,
      className: "ss-store-pin-wrap",
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
    const card = dom.list.querySelector(`.ss-place[data-unit-id="${unitId}"]`);
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

    /* 渲染 popup */
    dom.pinCard.innerHTML = `
      <button class="ss-pin-card-close" data-close>
        <i class="fa-solid fa-xmark"></i>
      </button>
      <div class="ss-pin-card-head">
        <i class="fa-solid fa-store"></i>
        <div>
          <h3>${escapeHtml(store.name)}</h3>
          <p>${escapeHtml(store.address || "")}</p>
        </div>
      </div>
      <div class="ss-pin-card-body">
        <p class="ss-pin-card-title">
          這間門市可以使用的特約優惠
          <b>${matched.length}</b> 項
        </p>
        <ul class="ss-pin-card-list">
          ${matched.slice(0, 8).map(u => `
            <li data-unit-id="${escapeAttr(u.id)}">
              <span class="ss-pin-card-list-name">${escapeHtml(u.name)}</span>
              <span class="ss-pin-card-list-cat">${escapeHtml(u.categoryName || '')}</span>
            </li>
          `).join("")}
        </ul>
        ${matched.length > 8 ? `<p class="ss-pin-card-more">…還有 ${matched.length - 8} 項</p>` : ''}
      </div>
    `;
    dom.pinCard.classList.add("is-show");

    /* 關閉 */
    dom.pinCard.querySelector("[data-close]").addEventListener("click", () => {
      dom.pinCard.classList.remove("is-show");
      state.activeStoreErpid = null;
    });

    /* 點 list item → 選該店家 */
    dom.pinCard.querySelectorAll(".ss-pin-card-list li").forEach(li => {
      li.addEventListener("click", () => selectUnit(li.dataset.unitId));
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

  /* 列表卡片無圖時的漸層池（呼應 LOHAS 配色暖棕系） */
  const GRADIENTS = [
    "linear-gradient(135deg,#E8DED1,#CDBEA2)",
    "linear-gradient(135deg,#D4C5A8,#A89378)",
    "linear-gradient(135deg,#EFE9F5,#C9B8DC)",
    "linear-gradient(135deg,#F0E1D4,#C9A076)",
    "linear-gradient(135deg,#D9D2C5,#9B8C77)",
    "linear-gradient(135deg,#F4F1EC,#CDBEA2)",
    "linear-gradient(135deg,#E0D4C2,#8A7558)",
    "linear-gradient(135deg,#EDE3D3,#B59E7E)"
  ];
  function gradientFor(i) {
    return GRADIENTS[i % GRADIENTS.length];
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
