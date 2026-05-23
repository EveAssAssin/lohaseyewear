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
  async function getRounds(employeeErpId, postpone) {
    if (!employeeErpId) throw new Error("[LohasApi.booking] employeeErpId is required");
    const payload = {
      method: "getround",
      employeeerp: aesEncrypt(employeeErpId)
    };
    if (postpone != null && Number(postpone) > 0) {
      payload.postpone = String(postpone);
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
    return post("rsv", {
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
    });
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
          available: r.remain > 0
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
    /* 衍生工具 */
    decryptReservationId,
    flattenRounds
  };

})(window);
