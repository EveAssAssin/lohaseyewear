/* =============================================
   LOHAS API · Core (BFF 版)
   --------------------------------------------
   架構：前端 → Supabase Edge Function → 左手 API
   --------------------------------------------
   差異：
   - 不需要 CryptoJS（AES 加密改在 Supabase Edge Function 做）
   - 不需要 AES 金鑰（金鑰存在 Supabase Secrets，永遠不會在瀏覽器）
   - 不會遇到 CORS 問題（Supabase Edge Function 預設支援 CORS）
   - 前端只送明文，BFF 自動處理加密
   --------------------------------------------
   被以下檔案 import：
   - js/api/api-store.js
   - js/api/api-booking.js
   ============================================= */

(function (root) {
  "use strict";

  /* === 設定 ===
     Supabase Edge Function endpoint
     部署完成後在 Supabase Dashboard 取得 */
  const CONFIG = {
    /* TODO: 部署 Edge Function 後填入實際 URL */
    bffUrl: "https://hqdmyxxrskvllkcedybl.supabase.co/functions/v1/lohas-api-proxy",

    /* Supabase anon key（給 BFF 認證用，不是左手系統 key）
       這個 key 可以放前端，是 Supabase 設計允許的 */
    supabaseAnonKey:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhxZG15eHhyc2t2bGxrY2VkeWJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MzkxMDIsImV4cCI6MjA5MzExNTEwMn0.OsHmLXwgQvxxZ2MTCULxhYmDt3fMO6x9RXohn_eP1RM"
  };

  /* === Mode 切換：test / prod ===
     透過 header x-lohas-mode 傳給 BFF
     預設 prod (一般訪客看到的是正式環境資料);
     開發者可在 console 或 mode switcher 切到 test */
  function getMode() {
    return localStorage.getItem("lohas_api_mode") || "prod";
  }
  function setMode(mode) {
    if (mode !== "prod" && mode !== "test") {
      console.warn("[LohasApi] mode must be 'prod' or 'test'");
      return;
    }
    localStorage.setItem("lohas_api_mode", mode);
    console.log("[LohasApi] mode switched to", mode);
  }

  /* === 統一錯誤類別 === */
  class LohasApiError extends Error {
    constructor(message, opts) {
      super(message);
      this.name = "LohasApiError";
      this.statecode = opts && opts.statecode;
      this.method = opts && opts.method;
      this.original = opts && opts.original;
    }
  }

  /* === HTTP POST → Supabase Edge Function ===
     payload 用明文，BFF 會自動加密該加密的欄位
     host 透過 x-lohas-host header 傳遞,讓 BFF 知道要轉發到哪個系統:
       "map"      → map.lohasglasses.com / rsv.lohasglasses.com (左手 API,AES 加密)
       "realtime" → lohas.realtime.tw (即時互動,明文 + 雙層 data 包裝)
     預設為 "map" 以維持舊呼叫相容性 */
  async function post(host, payload) {
    const method = payload && payload.method;
    const targetHost = host || "map";
    let response;

    try {
      response = await fetch(CONFIG.bffUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Authorization": "Bearer " + CONFIG.supabaseAnonKey,
          "apikey": CONFIG.supabaseAnonKey,
          "x-lohas-mode": getMode(),
          "x-lohas-host": targetHost
        },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      throw new LohasApiError("網路連線失敗，請稍後再試", {
        method, original: err
      });
    }

    if (!response.ok) {
      throw new LohasApiError(
        "BFF 回應錯誤 (HTTP " + response.status + ")",
        { method, statecode: response.status }
      );
    }

    let json;
    try {
      json = await response.json();
    } catch (err) {
      throw new LohasApiError("回應格式錯誤", { method, original: err });
    }

    if (String(json.statecode) !== "0") {
      throw new LohasApiError(
        json.message || "API 回傳失敗",
        { method, statecode: json.statecode }
      );
    }

    /* data 欄位可能是 stringified JSON，統一解析 */
    let data = json.data;
    if (typeof data === "string" && data.length > 0) {
      try {
        data = JSON.parse(data);
      } catch (_e) { /* 不是 JSON 字串，保留原樣 */ }
    }
    return data;
  }

  /* === Stub: BFF 版本前端不直接做加解密
     這兩個函式保留 API 相容性，實際在 Edge Function 做 */
  function aesEncrypt(plaintext) {
    console.warn("[LohasApi] aesEncrypt 在 BFF 版本中已停用，加密由 Edge Function 處理");
    return plaintext;
  }
  function aesDecrypt(ciphertext) {
    /* 部分回傳值（如 reservationid）需要解密
       BFF 應該在回傳前就先解密好，但為相容保留此函式 */
    console.warn("[LohasApi] aesDecrypt 在 BFF 版本中已停用，解密應由 Edge Function 處理");
    return ciphertext;
  }

  /* === 呼叫 BFF 加密欄位(回流商城用)===
     傳入 { StoreId:"120061", StaffId:"176" },回傳 { StoreId:"<密文>", StaffId:"<密文>" }
     加密在 Edge Function 做(key 不放前端)。
     不走 post() 因為這個 endpoint 回的不是 {statecode,data} 格式。 */
  async function encrypt(values) {
    let response;
    try {
      response = await fetch(CONFIG.bffUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Authorization": "Bearer " + CONFIG.supabaseAnonKey,
          "apikey": CONFIG.supabaseAnonKey,
          "x-lohas-mode": getMode()
        },
        body: JSON.stringify({ action: "encrypt", values: values || {} })
      });
    } catch (err) {
      throw new LohasApiError("加密連線失敗", { original: err });
    }
    if (!response.ok) {
      throw new LohasApiError("加密回應錯誤 (HTTP " + response.status + ")", {});
    }
    return response.json();
  }

  /* === 對外 namespace === */
  root.LohasApi = root.LohasApi || {};
  root.LohasApi.core = {
    CONFIG,
    getMode,
    setMode,
    post,
    encrypt,
    aesEncrypt,    // stub
    aesDecrypt,    // stub
    LohasApiError
  };
  root.LohasApi.setMode = setMode;
  root.LohasApi.getMode = getMode;

})(window);
