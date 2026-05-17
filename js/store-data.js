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

  /* === Slogan fallback ===
     部分舊店 alt 為空時用此資料替代。對應 API 拿到的 subname 為空時使用。 */
  const SLOGAN_FALLBACK = {
    "120046": "具有貴族式氣質的眼鏡店",       // 楠梓
    "120048": "優美空間感浪漫氛圍的眼鏡店",     // 熱河
    "120049": "空間視覺藝術般的眼鏡店",        // 鼎山
    "120050": "風格的細緻美感眼鏡店，就在您我生活中", // 南京
    "120052": "美與生活無界限的眼鏡店",        // 新左營
    "120053": "一家充滿風格與美感，有如一家有生命的眼鏡店", // 高應大
    "120055": "讓心情與眼睛能一同放鬆的絕美眼鏡店",  // 高美
    "120056": "低調簡奢奇景之美的眼鏡店",      // 中壢
    "120057": "氣息相當足夠的優美文青眼鏡店",   // 文化
    "120059": "創意混搭的中樞美感的眼鏡店",     // 文山
    "120061": "格外耀眼的古典主義文學的眼鏡店", // 東山
    "120069": "Walk-in to a magical Eyewear shop", // SUBANG SS15
    "120072": "文藝復興氛圍的眼鏡店",          // 潭子
    "120073": "古典主義文學的眼鏡店",          // 中科
    "120074": "全台灣最大的旗艦眼鏡門市",       // 新竹
    "120075": "復古情懷的眼鏡店",              // 竹北
    "120078": "充滿文學氣息的森林眼鏡店",       // 六家
    "120085": "偏向文藝氣息如藝術班的眼鏡店",   // 後甲
    "120089": "浮誇兼具內涵的旗艦門市",        // 林口
    "120096": "明亮溫暖的社區眼鏡空間",        // 大里（舊版 alt 空）
    "2456300": "繁忙城市中，能讓時間停滯的空間", // 板橋
    "2465300": "十甲黃昏市場旁的小憩處",        // 十甲
    "2466300": "寧靜社區裡的精緻眼鏡空間",     // 永和（舊版 alt 空）
    "2469300": "時尚與生活共融的眼鏡店",        // 中清（舊版 alt 空）
    "2471300": "年輕時尚的潮流眼鏡據點",        // 北屯（舊版 alt 空）
    "2473300": "精緻簡約風格的眼鏡店"          // 大墩（舊版 alt 空）
  };

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

  /* === 把 API getstoredatas 回傳的原始 store 物件正規化 ===
     輸出乾淨的 Store 物件 */
  function normalizeStore(raw) {
    if (!raw) return null;
    const region = getRegion(raw.city);
    const sloganFromApi = (raw.subname || "").trim();
    const slogan = sloganFromApi || SLOGAN_FALLBACK[raw.erpid] || "";

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
      leaveTime: raw.leavetime || null,
      averageScore: parseFloat(raw.averagescore) || null,
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
