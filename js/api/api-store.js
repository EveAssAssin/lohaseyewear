/* =============================================
   LOHAS API · Store
   --------------------------------------------
   門市與人員相關 API（共 8 支，打 map.lohasglasses.com）
   依賴：js/api/api-core.js
   --------------------------------------------
   涵蓋 API 文件 v0.2.4 第 6 ~ 13 + 17 支：
   6.  getstoredatas              取得全部店家＋底下人員
   7.  getemployeeinfobyerpid     取得人員詳細資料（含評價）
   8.  getareas                   取得全部地區
   9.  getgroups                  依地區取得所有店家
   10. getemployeebygroup         依分店取所有人員
   11. getemployeebyerps          依多 ErpId 批次取人員
   12. GetEmployeeByAppNumber     依客戶編號檢查人員
   13. getallemployees            取得全部人員客戶編號
   17. getpushclass               取得推播類別
   ============================================= */

(function (root) {
  "use strict";

  const core = root.LohasApi && root.LohasApi.core;
  if (!core) {
    throw new Error("[LohasApi.store] core module not loaded");
  }
  const { post, aesEncrypt } = core;

  /* ===== 6. 取得全部店家及底下人員 ===== */
  async function getAllStores() {
    return post("map", { method: "getstoredatas" });
  }

  /* ===== 7. 取得人員詳細資料（含評價列表） =====
     @param erpId   人員 ERP 編號
     @param amount  欲取得評價數量（必填，預設 10） */
  async function getEmployeeDetail(erpId, amount) {
    if (!erpId) throw new Error("[LohasApi.store] erpId is required");
    return post("map", {
      method: "getemployeeinfobyerpid",
      employeeerpid: aesEncrypt(erpId),
      amount: String(amount == null ? 10 : amount)
    });
  }

  /* ===== 29. 取得員工評價(獨立 API,可拿較大量)=====
     endpoint:rsv.lohasglasses.com/_api/v1.ashx
     參數:method=getevaluationbyemployee, employeeid(實為員工 ERP ID), amount
     回傳:{ statecode, data:{ averagescore, evaluationlist:[...] }, message }
     注意:BFF 需支援 host="rsv" 路由轉發 */
  async function getEvaluationByEmployee(erpId, amount) {
    if (!erpId) throw new Error("[LohasApi.store] erpId is required");
    return post("rsv", {
      method: "getevaluationbyemployee",
      /* 文件強調:參數名固定為 employeeid 但實為員工 ERP ID,不要 AES 加密
         (參考文件範例,employeeid 直接用明文 "94") */
      employeeid: String(erpId),
      amount: String(amount == null ? 0 : amount)
    });
  }

  /* ===== 8. 取得全部地區 ===== */
  async function getAreas() {
    return post("map", { method: "getareas" });
  }

  /* ===== 9. 依地區取得所有店家 =====
     @param areaIds  number | number[] | string  地區 ID
     文件要求：多個 ID 以半形逗號隔開後「整串一次加密」 */
  async function getGroupsByArea(areaIds) {
    if (areaIds == null) throw new Error("[LohasApi.store] areaIds is required");
    const ids = Array.isArray(areaIds) ? areaIds.join(",") : String(areaIds);
    return post("map", {
      method: "getgroups",
      areaid: aesEncrypt(ids)
    });
  }

  /* ===== 10. 依分店取得所有人員（顧問） =====
     @param groupErpId  分店 ERP ID */
  async function getEmployeesByGroup(groupErpId) {
    if (!groupErpId) throw new Error("[LohasApi.store] groupErpId is required");
    return post("map", {
      method: "getemployeebygroup",
      groupid: aesEncrypt(groupErpId)
    });
  }

  /* ===== 11. 依指定 ErpId 取得人員（雇員）資料 =====
     @param erpIds  string | string[]  人員 ErpId
     文件要求：多個 ID 以半形逗號隔開後「整串一次加密」 */
  async function getEmployeesByErps(erpIds) {
    if (erpIds == null) throw new Error("[LohasApi.store] erpIds is required");
    const ids = Array.isArray(erpIds) ? erpIds.join(",") : String(erpIds);
    return post("map", {
      method: "getemployeebyerps",
      id: aesEncrypt(ids)
    });
  }

  /* ===== 12. 依客戶編號檢查是否有該人員 =====
     @param appNumbers  string | string[]  人員客戶編號 */
  async function checkEmployeesByAppNumber(appNumbers) {
    if (appNumbers == null) throw new Error("[LohasApi.store] appNumbers is required");
    const ids = Array.isArray(appNumbers) ? appNumbers.join(",") : String(appNumbers);
    return post("map", {
      method: "GetEmployeeByAppNumber",
      id: aesEncrypt(ids)
    });
  }

  /* ===== 13. 取得全部人員客戶編號（排除離職） ===== */
  async function getAllEmployees() {
    return post("map", { method: "getallemployees" });
  }

  /* ===== 17. 取得推播類別 ===== */
  async function getPushClass() {
    return post("map", { method: "getpushclass" });
  }

  /* ===== 衍生工具：把 photos 欄位正規化 =====
     文件對「photos」格式描述不一（string vs array），這個工具統一輸出陣列 */
  function normalizePhotos(photos) {
    if (!photos) return [];
    if (Array.isArray(photos)) return photos.filter(Boolean);
    if (typeof photos === "string") {
      return photos.split(/[,;]/).map(s => s.trim()).filter(Boolean);
    }
    return [];
  }

  /* ===== 衍生工具：把 getstoredatas 結果依 area 分組 =====
     回傳 [{ areaName, stores: [...] }, ...] */
  function groupStoresByArea(stores) {
    const map = new Map();
    (stores || []).forEach(s => {
      const key = s.city || "其他";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(s);
    });
    return Array.from(map.entries()).map(([areaName, stores]) => ({
      areaName, stores
    }));
  }

  /* ===== 衍生工具：判斷店家是否旗艦店（依命名規範） =====
     舊版 alt 文案常含「旗艦」字眼；可依此判斷 */
  function isFlagshipStore(store) {
    const text = (store.subname || "") + (store.description || "");
    return /旗艦|flagship/i.test(text);
  }

  /* === 對外 namespace === */
  root.LohasApi = root.LohasApi || {};
  root.LohasApi.store = {
    /* 直接 API 對應 */
    getAllStores,
    getEmployeeDetail,
    getEvaluationByEmployee,
    getAreas,
    getGroupsByArea,
    getEmployeesByGroup,
    getEmployeesByErps,
    checkEmployeesByAppNumber,
    getAllEmployees,
    getPushClass,
    /* 衍生工具 */
    normalizePhotos,
    groupStoresByArea,
    isFlagshipStore
  };

})(window);
