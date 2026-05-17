/* =============================================
   LOHAS API · Core
   --------------------------------------------
   底層工具：AES-128-CBC 加解密、HTTP 封裝、錯誤處理
   依賴：CryptoJS 4.x （由 HTML head 載入）
   --------------------------------------------
   被以下檔案 import：
   - js/api/api-store.js
   - js/api/api-booking.js
   - js/api/api-message.js (未來)
   - js/api/api-order.js (未來)
   ============================================= */

(function (root) {
  "use strict";

  /* === 環境設定（對應 API 文件 v0.2.4） === */
  const ENV = {
    // AES 加解密金鑰（左手系統提供）
    aesKey: "GmAOoS003d5OJ2G2",
    aesIv: "bgfDcfWdWG6NSUr5",

    // 預約系統 endpoint
    rsv: {
      prod: "https://rsv.lohasglasses.com/_api/v1.ashx",
      test: "https://rsvlohasgalsses.lefthand.tw/_api/v1.ashx"
    },

    // 門市/人員系統 endpoint
    map: {
      prod: "https://map.lohasglasses.com/_api/v1.ashx",
      test: "https://maplohas.lefthand.tw/_api/v1.ashx"
    }
  };

  /* === Mode 切換：用 localStorage 'lohas_api_mode' 控制 ===
     開啟 console 後執行 LohasApi.setMode('test') 或 'prod' */
  function getMode() {
    return localStorage.getItem("lohas_api_mode") || "test";
  }
  function setMode(mode) {
    if (mode !== "prod" && mode !== "test") {
      console.warn("[LohasApi] mode must be 'prod' or 'test'");
      return;
    }
    localStorage.setItem("lohas_api_mode", mode);
    console.log("[LohasApi] mode switched to", mode);
  }

  function getEndpoint(host) {
    const mode = getMode();
    return ENV[host][mode];
  }

  /* === AES-128-CBC 加密 ===
     CryptoJS 預設 Pkcs7 padding，UTF-8 編碼，Base64 輸出 */
  function aesEncrypt(plaintext) {
    if (plaintext === null || plaintext === undefined) return "";
    if (typeof CryptoJS === "undefined") {
      throw new Error("[LohasApi] CryptoJS not loaded — please include before api-core.js");
    }
    const key = CryptoJS.enc.Utf8.parse(ENV.aesKey);
    const iv = CryptoJS.enc.Utf8.parse(ENV.aesIv);
    const encrypted = CryptoJS.AES.encrypt(
      CryptoJS.enc.Utf8.parse(String(plaintext)),
      key,
      { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
    );
    return encrypted.toString(); // Base64
  }

  function aesDecrypt(ciphertext) {
    if (!ciphertext) return "";
    if (typeof CryptoJS === "undefined") {
      throw new Error("[LohasApi] CryptoJS not loaded");
    }
    const key = CryptoJS.enc.Utf8.parse(ENV.aesKey);
    const iv = CryptoJS.enc.Utf8.parse(ENV.aesIv);
    const decrypted = CryptoJS.AES.decrypt(ciphertext, key, {
      iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7
    });
    return decrypted.toString(CryptoJS.enc.Utf8);
  }

  /* === 統一錯誤類別 === */
  class LohasApiError extends Error {
    constructor(message, opts) {
      super(message);
      this.name = "LohasApiError";
      this.statecode = opts && opts.statecode;
      this.method = opts && opts.method;
      this.host = opts && opts.host;
      this.original = opts && opts.original;
    }
  }

  /* === HTTP POST 封裝 ===
     host: 'rsv' | 'map'
     payload: 已加密好的純物件（含 method）
     回傳：解析後的 data；錯誤統一 throw LohasApiError */
  async function post(host, payload) {
    const url = getEndpoint(host);
    const method = payload && payload.method;
    let response;

    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      throw new LohasApiError("網路連線失敗，請稍後再試", {
        method, host, original: err
      });
    }

    if (!response.ok) {
      throw new LohasApiError(
        "伺服器回應錯誤 (HTTP " + response.status + ")",
        { method, host, statecode: response.status }
      );
    }

    let json;
    try {
      json = await response.json();
    } catch (err) {
      throw new LohasApiError("回應格式錯誤", { method, host, original: err });
    }

    /* 統一回傳結構：{ statecode, data, message }
       statecode "0" = 成功；"1" = 失敗 */
    if (String(json.statecode) !== "0") {
      throw new LohasApiError(
        json.message || "API 回傳失敗",
        { method, host, statecode: json.statecode }
      );
    }

    /* data 欄位有兩種格式：
       1. 直接是 JSON 物件/陣列（多數 API）
       2. 是 stringified JSON（少數 API 如 getGroupUnProcess） */
    let data = json.data;
    if (typeof data === "string" && data.length > 0) {
      try {
        data = JSON.parse(data);
      } catch (_e) {
        /* 不是 JSON 字串，保留原樣 */
      }
    }
    return data;
  }

  /* === 對外 namespace === */
  root.LohasApi = root.LohasApi || {};
  root.LohasApi.core = {
    ENV,
    getMode,
    setMode,
    getEndpoint,
    aesEncrypt,
    aesDecrypt,
    post,
    LohasApiError
  };

  /* 方便 console debug：window.LohasApi.setMode('test') */
  root.LohasApi.setMode = setMode;
  root.LohasApi.getMode = getMode;

})(window);
