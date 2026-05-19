/* =============================================
   LOHAS Store · 資料正規化層
   --------------------------------------------
   把 API getstoredatas / getemployeeXxx 回傳的原始欄位
   轉成前端統一可用的物件結構。
   --------------------------------------------
   依賴：js/api/api-store.js
   ============================================= */

(function (root) {
  "use strict";

  /* === 9 大區域定義（沿用舊版 allstore.html 命名）===
     city 欄位回傳值 → 我們前端的 region key */
  const REGION_MAP = {
    "北區":      { key: "north",       order: 1, label: "北區" },
    "新竹區":    { key: "hsinchu",     order: 2, label: "新竹區" },
    "台中區一":  { key: "taichung1",   order: 3, label: "台中區一" },
    "台中區二":  { key: "taichung2",   order: 4, label: "台中區二" },
    "高雄區一":  { key: "kaohsiung1",  order: 5, label: "高雄區一" },
    "台南區":    { key: "tainan",      order: 6, label: "台南區" },
    "高雄區二":  { key: "kaohsiung2",  order: 7, label: "高雄區二" },
    "MALAYSIA":  { key: "malaysia",    order: 8, label: "MALAYSIA" }
  };

  function getRegion(cityValue) {
    return REGION_MAP[cityValue] || { key: "other", order: 99, label: cityValue || "其他" };
  }

  function getAllRegions() {
    return Object.entries(REGION_MAP)
      .map(([city, info]) => ({ city, ...info }))
      .sort((a, b) => a.order - b.order);
  }

  /* === 旗艦店判定 ===
     優先順序：(1) subname 含「旗艦」(2) 在白名單內 */
  const FLAGSHIP_ERPS = new Set([
    "120089", // 林口
    "120074", // 新竹
    "120073", // 中科
    "120055", // 高美
    "120069"  // SUBANG SS15（海外）
  ]);

  function isFlagship(erpid, subname) {
    if (FLAGSHIP_ERPS.has(String(erpid))) return true;
    if (subname && /旗艦|flagship/i.test(subname)) return true;
    return false;
  }

  /* === Slogan fallback ===
     後台 subname 是空字串時的預設 slogan（依店名對照）
     未來若該店在後台填寫 subname，會自動覆蓋此處 */
  const SLOGAN_FALLBACKS = {
    "永和店": "巷弄裡的職人配鏡角落",
    "中清店": "中港路上最暖的眼鏡站",
    "北屯店": "隱身樓間的細緻配鏡所",
    "大墩店": "七期繁華中的安靜對焦",
    "大里店": "在地深耕的優雅配鏡空間"
  };

  function pickSlogan(rawSubname, storeName) {
    const s = (rawSubname || "").trim();
    if (s) return s;
    return SLOGAN_FALLBACKS[storeName] || "";
  }

  /* === 把 API getstoredatas 回傳的原始 store 物件正規化 ===
     輸出乾淨的 Store 物件 */
  function normalizeStore(raw) {
    if (!raw) return null;
    const region = getRegion(raw.city);
    const slogan = pickSlogan(raw.subname, raw.name);   // 後台空白時用對照表 fallback

    return {
      // 識別
      id: raw.id,                       // Map Id
      erpid: String(raw.erpid || ""),   // ERP Id（前端主鍵）

      // 顯示
      name: raw.name || "",
      slogan,                            // 副標（保證有值）
      description: raw.description || "",
      address: raw.address || "",
      phone: raw.phone || "",
      worktime: raw.worktime || "",
      coverimage: raw.coverimage || "",
      photos: normalizePhotos(raw.photos),

      // 位置
      city: raw.city || "",
      region,                            // { key, order, label }
      lat: parseFloat(raw.latitude) || null,
      lng: parseFloat(raw.longitude) || null,

      // 排序與標籤
      sort: parseInt(raw.sort, 10) || 0,
      isFlagship: isFlagship(raw.erpid, raw.subname),
      isOverseas: raw.city === "MALAYSIA",

      // 人員
      employees: (raw.employees || []).map(normalizeEmployeeShort),

      // 後台未確認用途的欄位（保留以便未來釐清）
      // - dl: 推測為特約商家 ID 陣列，但 API 文件 v0.2.4 未列出對應 endpoint
      //       目前不使用，等左手系統提供說明
      // - wd, ml, unspecifyemployee: 暫不使用
      dl: Array.isArray(raw.dl) ? raw.dl : [],
      _meta: {
        wd: raw.wd,
        ml: raw.ml,
        unspecifyemployee: raw.unspecifyemployee
      },

      // 留原始 raw 給需要時取用
      _raw: raw
    };
  }

  /* === 員工資料正規化（簡略版，從 getstoredatas / getemployeebygroup）=== */
  function normalizeEmployeeShort(raw) {
    if (!raw) return null;
    return {
      id: raw.id,
      groupId: raw.groupid,
      groupErpId: raw.grouperpid || "",
      groupName: raw.groupname || "",
      erpid: String(raw.erpid || ""),
      account: raw.account || "",
      name: raw.name || "",
      role: raw.role || "",
      jobtitle: raw.jobtitle || "",
      introduction: raw.introduction || "",
      photos: normalizePhotos(raw.photos),
      honor: raw.honor || raw.firsthonor || "",
      honors: (raw.honors || []).map(h => ({
        title: h.title || "",
        date: h.date || ""
      })),
      timeLimitedMessage: raw.timelimitedmessage || "",
      isFreeze: !!raw.isfreeze,
      isLeave: !!raw.isleave,
      isUnspecify: !!raw.isunspecify,
      leaveTime: raw.leavetime || null,
      averageScore: parseFloat(raw.averagescore) || null,
      evaluationList: [],
      _raw: raw
    };
  }

  /* === 員工資料正規化（詳細版，含評價，從 getemployeeinfobyerpid） === */
  function normalizeEmployeeDetail(raw) {
    if (!raw) return null;
    const evals = raw.evaluations || {};
    return {
      erpid: String(raw.employeeerpid || ""),
      name: raw.employeename || "",
      groupName: raw.groupname || "",
      jobtitle: raw.jobtitle || "",
      photos: normalizePhotos(raw.employeephotos),
      introduction: raw.introduction || "",
      honors: (raw.honors || []).map(h => ({
        title: h.title || "",
        date: h.date || ""
      })),
      averageScore: parseFloat(evals.averagescore) || null,
      evaluationList: (evals.evaluationlist || []).map(e => ({
        memberName: e.membername || "",
        content: e.content || "",
        score: parseInt(e.score, 10) || 0
      })),
      _raw: raw
    };
  }

  /* === photos 欄位統一輸出陣列 === */
  function normalizePhotos(photos) {
    if (!photos) return [];
    if (Array.isArray(photos)) return photos.filter(Boolean);
    if (typeof photos === "string") {
      return photos.split(/[,;]/).map(s => s.trim()).filter(Boolean);
    }
    return [];
  }

  /* === 把多個 store 依 region.order 排序，並依 region 分組 === */
  function groupByRegion(stores) {
    const groups = new Map();
    stores.forEach(s => {
      const key = s.region.key;
      if (!groups.has(key)) {
        groups.set(key, { region: s.region, stores: [] });
      }
      groups.get(key).stores.push(s);
    });
    return Array.from(groups.values()).sort(
      (a, b) => a.region.order - b.region.order
    );
  }

  /* === 用 erpid 在 stores 陣列裡找一間店（單店頁會用） === */
  function findStoreByErpid(stores, erpid) {
    return stores.find(s => String(s.erpid) === String(erpid)) || null;
  }

  /* === 旗艦店判定（供其他模組使用） === */
  function getFlagshipErps() {
    return Array.from(FLAGSHIP_ERPS);
  }

  /* === 對外 namespace === */
  root.LohasStore = root.LohasStore || {};
  root.LohasStore.data = {
    REGION_MAP,
    getRegion,
    getAllRegions,
    isFlagship,
    getFlagshipErps,
    normalizeStore,
    normalizeEmployeeShort,
    normalizeEmployeeDetail,
    normalizePhotos,
    groupByRegion,
    findStoreByErpid
  };

})(window);
