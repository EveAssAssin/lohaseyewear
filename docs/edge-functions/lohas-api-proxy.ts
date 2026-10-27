// ⚠ repo 版本(2026-10-27 存):REALTIME_CONFIG 的兩個 apikey 已清成空字串 —— 公開 repo 不能放。
//   線上那份才有值。部署前一律先在 Dashboard 按 Download,在線上那份上改,不要直接貼這份。
// =============================================
// Supabase Edge Function: lohas-api-proxy
// ---------------------------------------------
// 樂活前端 → 此 Edge Function（在這做 AES 加密）→ 即時互動 API
//
// 部署方式：把整個檔案內容貼進 Supabase Dashboard
//   → Edge Functions → lohas-api-proxy → Code → 整段覆蓋 → Deploy
//
// 需要在 Supabase Dashboard 設定的 Secrets:
//   LOHAS_AES_KEY = (存在 Secrets,不要寫在這裡)
//   LOHAS_AES_IV = (存在 Secrets,不要寫在這裡)
//
// 註:使用 Supabase 內建 Deno.serve(無需 import std),避免 deno.land 模組載入失敗導致 boot error
//
// ---------------------------------------------
// 路由規則 (依 x-lohas-host header):
//   "map" (預設)  → 走 map / rsv 左手系統 (AES 加密)
//   "realtime"    → 走 lohas.realtime.tw 即時互動 (明文 + 雙層 data)
//
// 特殊 action (不分 host):
//   { action: "encrypt", values:{...} }   → 回流商城用,AES 加密多個欄位
//   { method: "encryptMemberId", memberId } → 左手客服頁 URL 用,加密單一會員編號
// =============================================

// === CORS 允許的來源 ===
const ALLOWED_ORIGINS = [
  "https://premium.lohasglasses.com",
  "https://www.lohasglasses.com",
  "https://lohaseyewear.com",
  "https://www.lohaseyewear.com",
  // 開發用
  "http://localhost:8000",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];

function getCorsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-lohas-mode, x-lohas-host",
    "Access-Control-Max-Age": "86400",
  };
}

// =============================================
// MAP / RSV (左手系統) 設定
// =============================================
const ENDPOINTS = {
  map: {
    prod: "https://map.lohasglasses.com/_api/v1.ashx",
    test: "https://maplohas.lefthand.tw/_api/v1.ashx",
  },
  rsv: {
    prod: "https://rsv.lohasglasses.com/_api/v1.ashx",
    test: "https://rsvlohasgalsses.lefthand.tw/_api/v1.ashx",
  },
};

// 哪些 method 屬於 rsv 站、哪些屬於 map 站
const RSV_METHODS = new Set([
  // 2026-10-27 左手第 31 階段:動態預約項目 + 外部建立預約
  "getreservationrounds",
  "addreservation",
  "GetGroupUnProcess",
  "getround",
  "createreservate",
  "finishreservate",
  "cancelreservate",
  "getunprocessbyemployee",
  "getgroupunprocess",
  "orderstateupdate",
  "customerServicePush",
  "getevaluationbyemployee",
]);

// 哪些參數欄位需要 AES 加密
const ENCRYPTED_FIELDS = new Set([
  "orderid",
  "employeeerp",
  "grouperp",
  "reservationid",
  "employeeerpid",
  "areaid",
  "groupid",
  "id",
  "mid",
  "gid",
  "memberId",
  // 2026-10-27 第 31 階段:getreservationrounds(逗號串接後整串加密一次)/ addreservation(單一編號)
  "employeeErpIds",
  "employeeErpId",
]);

// === AES-128-CBC 加密 ===
async function aesEncrypt(plaintext: string): Promise<string> {
  const keyStr = Deno.env.get("LOHAS_AES_KEY");
  const ivStr = Deno.env.get("LOHAS_AES_IV");
  if (!keyStr || !ivStr) {
    throw new Error("缺少 Supabase Secrets: LOHAS_AES_KEY 或 LOHAS_AES_IV");
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(keyStr),
    { name: "AES-CBC" },
    false,
    ["encrypt"]
  );
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-CBC", iv: encoder.encode(ivStr) },
    key,
    encoder.encode(plaintext)
  );
  const bytes = new Uint8Array(encrypted);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// === AES-128-CBC 解密 ===
async function aesDecrypt(ciphertext: string): Promise<string> {
  const keyStr = Deno.env.get("LOHAS_AES_KEY");
  const ivStr = Deno.env.get("LOHAS_AES_IV");
  if (!keyStr || !ivStr) {
    throw new Error("缺少 Supabase Secrets: LOHAS_AES_KEY 或 LOHAS_AES_IV");
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(keyStr),
    { name: "AES-CBC" },
    false,
    ["decrypt"]
  );
  const binary = atob(ciphertext);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv: encoder.encode(ivStr) },
    key,
    bytes
  );
  return new TextDecoder().decode(decrypted);
}

// =============================================
// REALTIME (即時互動 lohas.realtime.tw) 設定
// ---------------------------------------------
// 與 map/rsv 不同:
//   - 不需要 AES 加密 (純明文)
//   - URL 是 /webapi/v010/<pathPrefix>/<method>
//   - 需要雙層 data 包裝
//   - 回傳結構是 { code: "200", data: {...} }，要轉成 { statecode: "0", data: {...} }
//
// pathPrefix 視 method 而定:
//   - /officialWed/* — 廣告輪播、特約單位、特約廠商、會員登入
//   - /member/*      — 銷售人員追蹤數等
//   - /message/*     — 客服聊天推播
// =============================================
const REALTIME_CONFIG = {
  test: {
    base:   "https://lohastest.realtime.tw/webapi/v010",
    apikey: "",
  },
  prod: {
    base:   "https://lohas.realtime.tw/webapi/v010",
    apikey: "",
  },
};

// method → 路徑前綴
const REALTIME_METHOD_PATH: Record<string, string> = {
  // /officialWed/* 系列
  "getCarouselStoreList":    "officialWed",
  "getUnitList":             "officialWed",
  "getAppointedUnitByCode":  "officialWed",
  "login":                   "officialWed",
  // /member/* 系列
  "getSalesMenTrackSum":     "member",
  // /message/* 系列 (客服聊天推播)
  "CSLeftMessagePush":         "message",
  "multipleLeftMessagePush":   "message",
};

// 允許帶入第二層 data 的欄位（白名單，防注入）
const REALTIME_PARAMS = new Set([
  // getUnitList
  "bindstore", "page", "paginate",
  // getAppointedUnitByCode
  "appointed_unit_code", "category_id",
  // login
  "account", "password",
  // getSalesMenTrackSum
  "sell_man_id", "month",
  // CSLeftMessagePush (客服聊天推播)
  "client_id", "title", "message", "view_status", "link", "category",
  // multipleLeftMessagePush (多筆推播)
  "client_data", "staffId", "img_url",
]);

// === 處理 realtime host ===
async function handleRealtime(
  payload: Record<string, unknown>,
  mode: "test" | "prod"
): Promise<{ statecode: string; message: string; data: unknown }> {
  const method = payload.method as string | undefined;

  if (!method || !REALTIME_METHOD_PATH[method]) {
    return {
      statecode: "400",
      message: `[realtime] 未提供有效 Method: ${method ?? "(none)"}`,
      data: null,
    };
  }

  const config = REALTIME_CONFIG[mode];
  const pathPrefix = REALTIME_METHOD_PATH[method];

  // 內層 data 只放白名單欄位
  const innerData: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (k === "method") continue;
    if (REALTIME_PARAMS.has(k)) innerData[k] = v;
  }

  const url = `${config.base}/${pathPrefix}/${method}`;

  // message 類 (客服推播) 依文件用「平鋪」格式;其他 realtime API 用「雙層 data 包裝」
  const isMessageApi = pathPrefix === "message";

  // 平鋪格式 (依文件範例: {client_id, title, message, view_status, ...})
  const flatBody = innerData;
  // 雙層包裝格式 (officialWed / member 系列用)
  const wrappedBody = {
    data: {
      apikey: config.apikey,
      apiver: "0.1.0",
      data: innerData,
    },
  };

  async function callUpstream(reqBody: unknown) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reqBody),
    });
    const j = await r.json();
    return j as { code?: string; data?: unknown; message?: string };
  }

  console.log(`[proxy] realtime/${mode} ${pathPrefix}/${method} → ${url} (${isMessageApi ? "flat" : "wrapped"})`);

  let json: { code?: string; data?: unknown; message?: string };
  try {
    // message 類先試平鋪;若回非 200,再 fallback 試雙層包裝
    if (isMessageApi) {
      json = await callUpstream(flatBody);
      if (String(json.code ?? "") !== "200") {
        console.log(`[proxy] message 平鋪格式回 ${json.code},fallback 試雙層包裝`);
        const json2 = await callUpstream(wrappedBody);
        // 包裝格式有成功就用它,否則保留原本結果
        if (String(json2.code ?? "") === "200") json = json2;
      }
    } else {
      json = await callUpstream(wrappedBody);
    }
  } catch (err) {
    return {
      statecode: "502",
      message: "即時互動 API 連線/格式錯誤: " + (err instanceof Error ? err.message : String(err)),
      data: null,
    };
  }

  // { code, data } → { statecode, data }
  const code = String(json.code ?? "");
  const isOk = code === "200";

  return {
    statecode: isOk ? "0" : code,
    message:   json.message ?? (isOk ? "OK" : "即時互動 API 回傳失敗"),
    data:      json.data ?? null,
  };
}

// =============================================
// 主函式
// =============================================
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();

    // ============ Encrypt 分支(回流商城用)============
    // 前端預約成功後,需要把 StoreId / StaffId 等欄位 AES 加密才能 POST 回商城。
    // key 不能放前端,所以由 BFF 代為加密後回傳密文。
    // 請求格式:{ action: "encrypt", values: { StoreId: "120061", StaffId: "176" } }
    // 回應格式:{ StoreId: "<base64密文>", StaffId: "<base64密文>" }
    // 放在 method 檢查之前,因為 encrypt 請求沒有 method 欄位。
    if (body.action === "encrypt") {
      const values = (body.values && typeof body.values === "object") ? body.values : {};
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(values)) {
        if (v == null || v === "") { out[k] = ""; continue; }
        try {
          out[k] = await aesEncrypt(String(v));
        } catch (e) {
          console.error("[proxy] encrypt 失敗:", k, e);
          out[k] = "";
        }
      }
      return new Response(JSON.stringify(out), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const method: string = body.method;
    if (!method) {
      return new Response(
        JSON.stringify({ statecode: "1", message: "method is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const mode = req.headers.get("x-lohas-mode") === "prod" ? "prod" : "test";
    const hostHeader = req.headers.get("x-lohas-host") || "map";

    // ============ 工具:加密會員編號 (給左手客服頁 URL 用) ============
    // 前端送 { method:"encryptMemberId", memberId:"28xxxxxx" }
    // 回 { statecode:"0", data:{ encrypted:"<AES字串>" } }
    // 前端用它組: https://rsv.lohasglasses.com/Message/_Visitor/CustomerServicePage.aspx?MemberId=<encrypted>
    if (method === "encryptMemberId") {
      const mid = body.memberId;
      if (!mid) {
        return new Response(
          JSON.stringify({ statecode: "1", message: "memberId is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      try {
        const encrypted = await aesEncrypt(String(mid));
        return new Response(
          JSON.stringify({ statecode: "0", data: { encrypted }, message: "OK" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (e) {
        return new Response(
          JSON.stringify({ statecode: "1", message: "加密失敗: " + (e instanceof Error ? e.message : String(e)) }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ============ Realtime 分支(即時互動)============
    // 為了兼容性,也接受舊的 "sodian" host 名(等前端全部部署完可移除)
    if (hostHeader === "realtime" || hostHeader === "sodian") {
      const result = await handleRealtime(body, mode as "test" | "prod");
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ============ Map / Rsv 分支(左手系統)============
    const encryptedBody: Record<string, unknown> = { method };
    for (const [key, value] of Object.entries(body)) {
      if (key === "method") continue;
      if (ENCRYPTED_FIELDS.has(key) && typeof value === "string") {
        encryptedBody[key] = await aesEncrypt(value);
      } else {
        encryptedBody[key] = value;
      }
    }

    const host = RSV_METHODS.has(method) ? "rsv" : "map";
    const url = ENDPOINTS[host][mode];
    console.log(`[proxy] ${method} → ${host}/${mode}`);

    const apiResponse = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(encryptedBody),
    });

    if (!apiResponse.ok) {
      throw new Error(`左手 API HTTP ${apiResponse.status}`);
    }

    const json = await apiResponse.json();

    // createreservate 回傳的 reservationid 需要解密
    if (
      method === "createreservate" &&
      json.statecode === "0" &&
      json.data
    ) {
      try {
        const parsedData =
          typeof json.data === "string" ? JSON.parse(json.data) : json.data;
        if (parsedData.reservationid) {
          parsedData.reservationid = await aesDecrypt(parsedData.reservationid);
        }
        json.data = parsedData;
      } catch (e) {
        console.warn("[proxy] reservationid 解密失敗:", e);
      }
    }

    // addreservation 回傳的 reservationId(大寫 I)也是密文,解開給前端(2026-10-27)
    if (
      method === "addreservation" &&
      String(json.statecode) === "0" &&
      json.data
    ) {
      try {
        const parsedData =
          typeof json.data === "string" ? JSON.parse(json.data) : json.data;
        if (parsedData && parsedData.reservationId) {
          parsedData.reservationId = await aesDecrypt(parsedData.reservationId);
        }
        json.data = parsedData;
      } catch (e) {
        console.warn("[proxy] addreservation reservationId 解密失敗:", e);
      }
    }

    return new Response(JSON.stringify(json), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[proxy] Error:", err);
    return new Response(
      JSON.stringify({
        statecode: "1",
        message: err instanceof Error ? err.message : "代理錯誤",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});