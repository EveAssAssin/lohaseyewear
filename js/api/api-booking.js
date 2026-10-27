/* =============================================
   LOHAS API · Booking
   --------------------------------------------
   預約相關 API（共 5 支，打 rsv.lohasglasses.com）
   依賴：js/api/api-core.js
   --------------------------------------------
   涵蓋 API 文件 v0.2.4：
   2.  getround                  取得人員的預約時段
   3.  createreservate           建立暫時預約單
   4.  finishreservate           暫時預約單轉正式預約
   5.  cancelreservate           取消預約
   14. getunprocessbyemployee    取得顧問未處理留言數量
   ============================================= */

(function (root) {
  "use strict";

  const core = root.LohasApi && root.LohasApi.core;
  if (!core) {
    throw new Error("[LohasApi.booking] core module not loaded");
  }
  const { post, aesEncrypt, aesDecrypt } = core;

  /* ===== 2. 取得人員的預約時段 =====
     @param employeeErpId  人員 Erp 編號
     @param postpone       延後天數（>0 整數，預設 0 = 不延後）
     回傳：[{ date, rounds:[{ id, title, remain }] }, ...] */
  async function getRounds(employeeErpId, postpone, reservationTypes) {
    if (!employeeErpId) throw new Error("[LohasApi.booking] employeeErpId is required");
    const payload = {
      method: "getround",
      employeeerp: aesEncrypt(employeeErpId)
    };
    if (postpone != null && Number(postpone) > 0) {
      payload.postpone = String(postpone);
    }
    /* 🚨 2026-09-13 補。左手的文件寫著:
         「reservationTypes …【未提供時預設查詢「配鏡」】」

       先前我方【沒有帶這個參數】,所以不管客人要約什麼,
       畫面上顯示的一律是「配鏡」的可預約時段 ——
       然後 createreservate 帶著「取件」送出去,
       落在一個依配鏡算出來的時段上。

       這個參數存在,就表示不同類型的可預約時段是不一樣的。
       所以一定要帶。

       ⚠ 多筆用【半形】逗號分隔(對方文件特別註明)。 */
    if (reservationTypes) {
      payload.reservationTypes = Array.isArray(reservationTypes)
        ? reservationTypes.join(",")
        : String(reservationTypes);
    }
    return post("rsv", payload);
  }

  /* ===== 3. 建立暫時預約單 =====
     @param data {
       groupErpId, employeeErpId,
       reservationDate (yyyy-MM-dd),
       roundId, memberName, memberNumber,
       memberPhone, memberBirthday (yyyy-MM-dd),
       content
     }
     回傳：{ reservationid }（暫時預約單 ID，已 AES 加密） */
  async function createReservation(data) {
    const required = [
      "groupErpId", "employeeErpId", "reservationDate", "roundId",
      "memberName", "memberNumber", "memberPhone", "memberBirthday", "content"
    ];
    for (const k of required) {
      if (data[k] == null) {
        throw new Error("[LohasApi.booking] createReservation missing: " + k);
      }
    }
    const payload = {
      method: "createreservate",
      grouperp: aesEncrypt(data.groupErpId),
      employeeerp: aesEncrypt(data.employeeErpId),
      reservationdate: data.reservationDate,
      roundid: String(data.roundId),
      membername: data.memberName,
      membernumber: data.memberNumber,
      memberphone: data.memberPhone,
      memberbirthday: data.memberBirthday,
      content: data.content || ""
    };
    /* 預約類型 + 顯示名稱(讓後台顯示正確服務,不再是預設「商城賞鏡」)
       reservationType 可接受:諮詢 / 配鏡 / 調整 / 取件 / 視力健檢
       有值才送,沒值就讓左手用預設 */
    if (data.reservationType) {
      payload.reservationType = data.reservationType;
      /* reservationTitle 用同一個服務名當顯示名稱,覆蓋預設的「商城賞鏡」 */
      payload.reservationTitle = data.reservationTitle || data.reservationType;
    }
    return post("rsv", payload);
  }

  /* ===== 4. 暫時預約單轉正式預約 =====
     @param reservationId  暫時預約單 ID（從 createReservation 拿到，AES 解密後使用）
     @param orderId        賞鏡網站訂單編號（用來連結訂單詳情 iframe;純預約沒有訂單時可傳空字串）*/
  async function finishReservation(reservationId, orderId) {
    if (!reservationId) throw new Error("[LohasApi.booking] reservationId is required");
    return post("rsv", {
      method: "finishreservate",
      reservationid: aesEncrypt(reservationId),
      orderid: String(orderId || "")
    });
  }

  /* ===== 5. 取消預約 =====
     @param reservationId  預約單編號 */
  async function cancelReservation(reservationId) {
    if (!reservationId) throw new Error("[LohasApi.booking] reservationId is required");
    return post("rsv", {
      method: "cancelreservate",
      reservationid: aesEncrypt(reservationId)
    });
  }

  /* ===== 14. 取得顧問未處理留言數量 =====
     @param employeeErpId  顧問 Erp ID
     回傳：{ Amount }（含客戶＋訪客） */
  async function getUnprocessByEmployee(employeeErpId) {
    if (!employeeErpId) throw new Error("[LohasApi.booking] employeeErpId is required");
    return post("rsv", {
      method: "getunprocessbyemployee",
      employeeerpid: aesEncrypt(employeeErpId)
    });
  }

  /* ===== 新版預約 API(左手第 31 階段,2026-10-27 接)=====
     -----------------------------------------------------------------
     舊的 getround 只認五種固定類型,門市在左手後台自訂的項目(生日配鏡、
     生日DIY眼鏡布…)官網看不到。新的兩支以「項目 ID」為主:

       getreservationrounds  員工 → 項目(含自訂、人員新增)→ 日期 → 時段
       addreservation        用查到的 項目 ID + 時段 ID 建立預約(一步完成,不用 finish)

     ⚠ ERP 編號由 lohas-api-proxy 加密(employeeErpIds / employeeErpId),
       回傳的 reservationId 也由它解密 —— 前端只送明文。
     ⚠ addreservation 只收 10 個欄位,多送任何欄位都會被拒(對方文件)。
     ⚠ addreservation 沒有冪等鍵:逾時或回應遺失【不能】直接重送,會變兩筆。 */

  /* @param employeeErpIds  陣列或逗號字串,一次最多 10 位
     回傳:[{ employeeErpId, employeeName, reservationConfigs:[{ reservationConfigId,
             reservationConfigTitle, reservationType, dates:[{ date, rounds:[{ roundId,
             masterRoundId, title, remain }] }] }] }] */
  async function getReservationRounds(employeeErpIds) {
    const ids = Array.isArray(employeeErpIds) ? employeeErpIds.join(",") : String(employeeErpIds || "");
    if (!ids) throw new Error("[LohasApi.booking] employeeErpIds is required");
    return post("rsv", { method: "getreservationrounds", employeeErpIds: ids });
  }

  /* @param d { employeeErpId, reservationConfigId, reservationDate, roundId, masterRoundId,
                memberName, memberPhone, memberNumber?, content? }
     roundId / masterRoundId 恰好一個是 -1(個人時段 vs 公司時段)。
     回傳:{ reservationId(proxy 已解密), status:"新預約" } */
  async function addReservation(d) {
    const required = ["employeeErpId", "reservationConfigId", "reservationDate",
                      "roundId", "masterRoundId", "memberName", "memberPhone"];
    for (const k of required) {
      if (d[k] == null || String(d[k]).trim() === "") {
        throw new Error("[LohasApi.booking] addReservation missing: " + k);
      }
    }
    /* 全部用字串送(對方文件:各參數以字串傳送),欄位只有這 10 個 */
    return post("rsv", {
      method: "addreservation",
      employeeErpId: String(d.employeeErpId),
      reservationConfigId: String(d.reservationConfigId),
      reservationDate: String(d.reservationDate),
      roundId: String(d.roundId),
      masterRoundId: String(d.masterRoundId),
      memberName: String(d.memberName).trim(),
      memberPhone: String(d.memberPhone).trim(),
      memberNumber: String(d.memberNumber || ""),
      content: String(d.content || "")
    });
  }

  /* 把一位員工的 reservationConfigs 整理成「項目清單」,每個項目帶自己的時段。
     沒有任何可約時段的項目不列(客人選了也約不到)。
     時段的 key 用 r<個人ID> / m<公司ID>,兩種來源不會撞號。 */
  function normalizeConfigs(configs) {
    return (configs || []).map(c => {
      const rounds = [];
      (c.dates || []).forEach(day => {
        (day.rounds || []).forEach(r => {
          const personal = Number(r.roundId) >= 0;
          rounds.push({
            date: day.date,
            roundId: personal ? "r" + r.roundId : "m" + r.masterRoundId,   // 畫面用的 key
            apiRoundId: personal ? String(r.roundId) : "-1",
            apiMasterRoundId: personal ? "-1" : String(r.masterRoundId),
            title: r.title,
            remain: Number(r.remain) || 0,
            available: Number(r.remain) > 0
          });
        });
      });
      return {
        id: "c" + c.reservationConfigId,
        configId: c.reservationConfigId,
        name: c.reservationConfigTitle || c.reservationType || "預約",
        apiType: c.reservationType || "",
        rounds
      };
    }).filter(c => c.rounds.some(r => r.available));
  }

  /* ===== 衍生工具：把回傳的暫時預約 reservationid 解密 =====
     文件第 3 支「data.reservationid」說「請用 AES 解密」 */
  function decryptReservationId(encryptedId) {
    return aesDecrypt(encryptedId);
  }

  /* ===== 衍生工具：將時段資料 flatten 成 { date, ...round } 陣列 =====
     方便前端做日期 + 時段的 grid 渲染 */
  function flattenRounds(rounds) {
    const out = [];
    (rounds || []).forEach(day => {
      (day.rounds || []).forEach(r => {
        out.push({
          date: day.date,
          roundId: r.id,
          title: r.title,
          remain: r.remain,
          available: r.remain > 0,
          /* 一次查多種類型時,靠這一欄分辨這一格是哪一種的。
             左手文件:「回傳資料仍維持日期資料陣列格式,
             並透過每筆資料的 reservationType 區分預約類型」。 */
          reservationType: day.reservationType || ""
        });
      });
    });
    return out;
  }

  /* === 對外 namespace === */
  root.LohasApi = root.LohasApi || {};
  root.LohasApi.booking = {
    /* 直接 API 對應 */
    getRounds,
    createReservation,
    finishReservation,
    cancelReservation,
    getUnprocessByEmployee,
    /* 新版(第 31 階段) */
    getReservationRounds,
    addReservation,
    normalizeConfigs,
    /* 衍生工具 */
    decryptReservationId,
    flattenRounds
  };

})(window);
