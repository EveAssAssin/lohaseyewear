/* =============================================
   LOHAS API · Shopping Street
   --------------------------------------------
   商店街相關 API（共 5 支，打「即時互動 / 搜點子」 host）
   依賴：js/api/api-core.js
   --------------------------------------------
   涵蓋 API 文件「即時互動科技_搜點子 API 串接文件 v2.0.8」：
   22. getCarouselStoreList         取得廣告輪播圖列表（含 bindstore）
   23. getUnitList                  取得特約單位列表
   25. getAppointedUnitByCode       特約廠商查詢（單筆，含 img_path）
   28. login                        商店街會員登入
   31. save-svg                     上傳雕刻 LOGO（雷刻服務用，本頁不使用）
   --------------------------------------------
   重要：
   - host 名稱用 "sodian"（搜點子），請後端 BFF 對應到
     https://lohas.realtime.tw/webapi/v010/officialWed/
   - 此 API 不含 lat/lng/address，地圖座標靠 bindstore 欄位
     對應到 LohasApi.store.getAllStores() 取得的 LOHAS 門市座標
   ============================================= */

(function (root) {
  "use strict";

  const core = root.LohasApi && root.LohasApi.core;
  if (!core) {
    throw new Error("[LohasApi.vipstore] core module not loaded");
  }
  const { post } = core;

  /* ===== 22. 取得廣告輪播圖列表 =====
     回傳含 bindstore（字串型陣列，如 "[120035,120046]"）
     可依目前選擇的門市過濾顯示 */
  async function getCarouselStoreList() {
    return post("sodian", { method: "getCarouselStoreList" });
  }

  /* ===== 23. 取得特約單位列表 =====
     @param opts.bindstore  門市代碼（選填，例：120035）
     @param opts.page       頁碼（選填，預設 1）
     @param opts.paginate   每頁筆數（選填，預設 20；可設大值如 3000 一次撈完）
     回傳：{ count, page_count, last_page, per_page, current_page, info: [...] } */
  async function getUnitList(opts) {
    const payload = { method: "getUnitList" };
    if (opts) {
      if (opts.bindstore != null) payload.bindstore = String(opts.bindstore);
      if (opts.page != null)      payload.page      = Number(opts.page);
      if (opts.paginate != null)  payload.paginate  = Number(opts.paginate);
    }
    return post("sodian", payload);
  }

  /* ===== 25. 特約廠商查詢（單筆） =====
     @param opts.appointed_unit_code  廠商代碼（與 category_id 二擇一）
     @param opts.category_id          類別 ID（與 appointed_unit_code 二擇一）
     v2.0.7 起回傳含 img_path */
  async function getAppointedUnitByCode(opts) {
    if (!opts || (!opts.appointed_unit_code && !opts.category_id)) {
      throw new Error("[LohasApi.vipstore] need appointed_unit_code or category_id");
    }
    const payload = { method: "getAppointedUnitByCode" };
    if (opts.appointed_unit_code) payload.appointed_unit_code = String(opts.appointed_unit_code);
    if (opts.category_id)         payload.category_id         = String(opts.category_id);
    return post("sodian", payload);
  }

  /* ===== 28. 商店街會員登入 =====
     @param account   帳號
     @param password  密碼
     回傳：{ erpid, erpname } */
  async function login(account, password) {
    if (!account || !password) {
      throw new Error("[LohasApi.vipstore] account and password required");
    }
    return post("sodian", {
      method: "login",
      account: String(account),
      password: String(password)
    });
  }

  /* ===== 衍生工具：normalizeBindStore =====
     文件中 bindstore 同時出現兩種型態：
       - 陣列：[1,3,5,7,8]
       - JSON 字串："[120035,120046]" 或 "[]"
     統一輸出 number[]，方便跟 LOHAS 門市 erpid 做 join。 */
  function normalizeBindStore(v) {
    if (!v) return [];
    if (Array.isArray(v)) {
      return v.map(Number).filter(n => !Number.isNaN(n));
    }
    if (typeof v === "string") {
      const s = v.trim();
      if (!s || s === "[]") return [];
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) {
          return parsed.map(Number).filter(n => !Number.isNaN(n));
        }
      } catch (_e) {
        return s.split(",").map(x => Number(x.trim())).filter(n => !Number.isNaN(n));
      }
    }
    return [];
  }

  /* ===== 衍生工具：normalizeUnit =====
     把 API 23 / 25 回傳的特約單位物件正規化為前端統一結構。
     注意：API 不提供 lat/lng，店家位置交由前端用 bindstore join 門市座標。 */
  function normalizeUnit(raw) {
    if (!raw) return null;
    return {
      id:           raw.id,
      // 文件中 API 23 用 title，API 25 用 unit_name → 統一成 name
      name:         raw.title || raw.unit_name || "",
      intro:        raw.introduce || raw.unit_introduce || "",
      contractTime: raw.contracttime || null,
      bindStore:    normalizeBindStore(raw.bindstore || raw.bind_store_ids),
      imgId:        raw.img_id || null,
      imgUrl:       raw.img_path || "",
      sort:         parseInt(raw.sortweight, 10) || 0,
      // 類別（API 25 才有）
      categoryId:   raw.category_id || null,
      categoryName: raw.category_name || "",
      // 廠商代碼（API 25 才有）
      unitCode:     raw.appointed_unit_code || null,
      // 留原始
      _raw: raw
    };
  }

  /* ===== 衍生工具：依 bindStore 對應到 LOHAS 門市座標 =====
     @param units   normalizeUnit 後的陣列
     @param stores  LohasStore.data.normalizeStore 後的門市陣列
     回傳：units 上每筆 unit 多一個 boundStores: Store[] 欄位 */
  function attachBoundStores(units, stores) {
    const storeMap = new Map();
    (stores || []).forEach(s => {
      if (s && s.erpid) storeMap.set(String(s.erpid), s);
    });
    return (units || []).map(u => {
      const boundStores = (u.bindStore || [])
        .map(erpid => storeMap.get(String(erpid)))
        .filter(Boolean);
      return Object.assign({}, u, { boundStores });
    });
  }

  /* ===== 衍生工具：計算單一 unit 對使用者距離 =====
     取 boundStores 中距離最近一間的距離，用於排序
     @param u           unit (已 attachBoundStores)
     @param userLat
     @param userLng     使用者經緯度
     回傳：number (km) 或 null */
  function nearestStoreDistance(u, userLat, userLng) {
    if (!u.boundStores || !u.boundStores.length) return null;
    if (userLat == null || userLng == null) return null;
    let min = Infinity;
    u.boundStores.forEach(s => {
      if (s.lat == null || s.lng == null) return;
      const d = haversine(userLat, userLng, s.lat, s.lng);
      if (d < min) min = d;
    });
    return Number.isFinite(min) ? min : null;
  }

  /* Haversine 距離（公里） */
  function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const toRad = x => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /* === 對外 namespace === */
  root.LohasApi = root.LohasApi || {};
  root.LohasApi.vipstore = {
    /* 直接 API 對應 */
    getCarouselStoreList,
    getUnitList,
    getAppointedUnitByCode,
    login,
    /* 衍生工具 */
    normalizeBindStore,
    normalizeUnit,
    attachBoundStores,
    nearestStoreDistance,
    haversine
  };

})(window);
