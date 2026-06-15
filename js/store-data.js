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

  /* === 特約商家(暫時 demo 資料,未來改為即時互動 API)===
     資料結構是「區域級」(以 region key 索引,本店所屬區的所有合作商家)
     未來串 API:用 getPartnersByRegion(regionKey) 對接,目前回傳 demo 資料

     schema:
       category    類別(用於上方副標)
       name        商家名稱
       slogan      簡短一句話(編輯式描述,40 字內)
       offer       優惠內容(顯示在卡片下方)
       address     地址
       image       商家照片 URL(空字串時 fallback 到品牌色 + icon)
       icon        fallback 圖示(Font Awesome class)
       googleCid   Google 商家 CID(可選,有的話卡片可連到商家頁)
   */
  const PARTNER_MERCHANTS = {
    /* === 高雄區一 (示意資料) === */
    "kaohsiung1": [
      {
        category: "CAFÉ · 鼓山",
        name: "小巷弄咖啡",
        slogan: "巷弄裡的手沖咖啡店,出示樂活會員享單品 9 折,並贈手工餅乾一片。",
        offer: "單品咖啡 9 折",
        address: "鼓山區七賢三路 23 號",
        image: "",
        icon: "fa-mug-saucer",
        googleCid: ""
      },
      {
        category: "RESTAURANT · 鼓山",
        name: "老味道食堂",
        slogan: "傳承三代的中式定食,主廚特選樂活套餐 88 折,週末限定。",
        offer: "套餐 88 折",
        address: "鼓山區明誠四路 88 號",
        image: "",
        icon: "fa-utensils",
        googleCid: ""
      }
    ]
    /* 其餘區域待補:north / hsinchu / taichung1 / taichung2 / kaohsiung2 / tainan / malaysia */
  };

  function getPartnersByRegion(regionKey) {
    return PARTNER_MERCHANTS[regionKey] || [];
  }

  /* === Google Maps 商家 CID 對照表 ===
     用法：填 cid(從 Google Maps iframe URL 取出,後段 16 進位轉 10 進位)
     有 cid → 連結會直接打開該店的 Google 商家頁面(含照片、評論、評分)
     沒填的店 → fallback 用「店名+地址」搜尋(精度比座標好)

     如何取 cid：
       1. Google Maps 找到店家 → 右上角分享 → 「嵌入地圖」→ 複製 iframe HTML
       2. iframe URL 裡找到 !1s0xXXX:0xYYY 這段,0xYYY 就是 16 進位 cid
       3. 用 parseInt("0xYYY", 16) 或 BigInt("0xYYY").toString() 轉成 10 進位
     參考工具:https://www.findcid.com/ */
  const STORE_CID_MAP = {
    /* === 高雄區 === */
    "高雄高美店":    "12320247946653000025",
    "文化店":        "17053334741302631708",
    "高雄新左營店":  "4841597431479412955",
    "鼎山店":        "4899431815704409012",
    "高雄文山店":    "9123924423165508500",
    "熱河店":        "8107749224275590911",
    "高應大店":      "3340253409062500047",
    "高雄南京店":    "4704397589067798787",
    "高雄楠梓店":    "5220222403051908356",

    /* === 台中區 === */
    "台中北屯店":    "3999846151082108876",
    "台中中清店":    "2632364538632077056",
    "大里店":        "14913894513913273030",
    "十甲店":        "1898005182704102000",
    "中科店":        "13578374294055863809",
    "台中大墩店":    "16464089386081695024",
    "台中潭子店":    "4113471371369210448",
    "東山店":        "2549781061201304796",

    /* === 新竹區 === */
    "竹北店":        "10707430098406609984",
    "六家店":        "11173353723394396916",
    "新竹店":        "1830267896509043964",

    /* === 北區 === */
    "中壢店":        "787531801981521397",
    "林口店":        "12288741628030020733",
    "永和店":        "12339957459561409567",
    "板橋店":        "11651902979015465478",

    /* === 海外 (MALAYSIA) === */
    "SUBANG SS15":   "11264662630130957989"
    /* TODO:其餘分店待補 */
  };

  /* 店名 normalize:後台店名可能寫「高雄高美店 / 高美店 / 高美旗艦店」,
     比對 CID_MAP 時先去掉常見前綴/後綴 noise,再做包含關係 match */
  function normalizeStoreNameForMatch(name) {
    if (!name) return "";
    return String(name)
      .trim()
      .replace(/^LOHAS\s*/i, "")
      .replace(/^樂活眼鏡\s*/, "")
      .replace(/旗艦店?$/, "店")
      .replace(/\s+/g, "");
  }

  function getStoreCid(storeName) {
    if (!storeName) return "";
    /* 1. 完全比對 */
    if (STORE_CID_MAP[storeName]) return STORE_CID_MAP[storeName];
    /* 2. normalize 後比對(雙向包含) */
    const target = normalizeStoreNameForMatch(storeName);
    for (const key in STORE_CID_MAP) {
      const k = normalizeStoreNameForMatch(key);
      if (k === target || target.includes(k) || k.includes(target)) {
        return STORE_CID_MAP[key];
      }
    }
    return "";
  }

  /* 產生該店的 Google Maps 連結:
     有 cid → 直接打開商家頁面(showing photos/reviews/rating)
     沒 cid → fallback「店名+地址」搜尋(比座標精準) */
  function buildGoogleMapsUrl(storeName, address, lat, lng) {
    const cid = getStoreCid(storeName);
    if (cid) {
      return "https://www.google.com/maps?cid=" + cid;
    }
    const q = encodeURIComponent(
      ((storeName || "") + " " + (address || "")).trim()
    );
    if (q) return "https://www.google.com/maps/search/?api=1&query=" + q;
    /* 最後 fallback:座標 */
    if (lat && lng) {
      return "https://www.google.com/maps/search/?api=1&query=" + lat + "," + lng;
    }
    return "";
  }

  /* === 把 API getstoredatas 回傳的原始 store 物件正規化 ===
     輸出乾淨的 Store 物件 */
  /* === 緊急隱藏門市清單 ===
     需要臨時下架的門市寫在這裡,normalizeStore 會回傳 null 把它濾掉,
     allstore 地圖列表 / 單店頁 / vipstore 三處都會自動隱藏(因為它們都有 .filter)。
     比對方式:精確店名 + erpid 雙重,任一命中就隱藏。
     之後要恢復顯示,把對應的字串從陣列移除即可。 */
  const HIDDEN_STORE_NAMES = ["十甲店", "後甲店"];
  const HIDDEN_STORE_ERPIDS = [];  /* 若知道 erpid 可填這裡,更精準。例:["120061"] */

  function isHiddenStore(raw) {
    if (!raw) return false;
    const name = (raw.name || "").trim();
    const erpid = String(raw.erpid || "");
    if (HIDDEN_STORE_ERPIDS.includes(erpid)) return true;
    /* 店名精確比對(去頭尾空白);後台店名若帶前綴如「台中十甲店」也一併比對包含關係 */
    return HIDDEN_STORE_NAMES.some(hidden =>
      name === hidden || name.replace(/\s/g, "").includes(hidden)
    );
  }

  function normalizeStore(raw) {
    if (!raw) return null;
    /* 緊急隱藏的門市直接回 null,呼叫端的 .filter(Boolean) 會濾掉 */
    if (isHiddenStore(raw)) {
      console.info("[store-data] 已隱藏門市:", raw.name);
      return null;
    }
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
      googleMapsUrl: buildGoogleMapsUrl(
        raw.name,
        raw.address,
        parseFloat(raw.latitude) || null,
        parseFloat(raw.longitude) || null
      ),

      // 排序與標籤
      sort: parseInt(raw.sort, 10) || 0,
      isFlagship: isFlagship(raw.erpid, raw.subname),
      isOverseas: raw.city === "MALAYSIA",

      // 人員
      employees: (raw.employees || []).map(normalizeEmployeeShort),

      // 左手系統內部欄位，前端不使用（已於 2026/05 經左手確認）：
      // - dl: 健康指導（不是特約商家！特約商家資料在「即時互動」不在左手）
      // - ml: 每日排休上限
      // - wd: 月薪天數
      // - unspecifyemployee: 不指定人員（左手內部用）

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

  /* === 新 API:getevaluationbyemployee 的回應正規化 ===
     回應結構:{ statecode, data:{ averagescore, evaluationlist:[...] }, message }
     輸出:{ averageScore, evaluationList:[{ memberName, content, score }] }
     格式與舊 detail 內的 evaluations 一致,可直接 merge 進 emp 物件 */
  function normalizeEvaluationResponse(raw) {
    if (!raw) return { averageScore: null, evaluationList: [] };
    const data = raw.data || raw;  // 兼容 BFF 是否已剝外層
    return {
      averageScore: parseFloat(data.averagescore) || null,
      evaluationList: (data.evaluationlist || []).map(e => ({
        memberName: e.membername || "",
        content: e.content || "",
        score: parseInt(e.score, 10) || 0
      }))
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
    normalizeEvaluationResponse,
    normalizePhotos,
    groupByRegion,
    findStoreByErpid,
    getPartnersByRegion
  };

})(window);
