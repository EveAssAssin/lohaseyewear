// =============================================================
//  Supabase Edge Function · auth-session
//  官網登入的伺服器端驗證 + session token 簽發
//  支援:帳密登入 / SSO 登入 / token 驗證 / 取會員資料
//
//  ⚠ 這份是【repo 備份版,兩把金鑰已清空】。
//    線上版的 FALLBACK_PROXY_KEY 與 FALLBACK_SESSION_SECRET 有值,
//    取代線上版之前,請先按函式頁面右上角的 Download 備份,
//    再從備份把那兩行的值貼回來。
//
//  ⚠ FALLBACK_SESSION_SECRET 是簽發 session token 的密鑰。
//    拿到它的人可以自行簽出任意會員的登入憑證,不需要帳號密碼。
//    它比 PROXY_KEY 更敏感,絕對不可外流、不可寫進本檔。
//
//  2026-08-17 這一版的變更:支援尚未綁定 ERP 的會員
//  -------------------------------------------------------------
//  官網註冊只建立 App 會員,client_id(erpid)是空的,要到門市消費時
//  才由店員建立與綁定。先前這支在 erpid 為空時直接回 500,等於所有
//  官網註冊的人都拿不到 token、登不進來。
//
//  改為:erpid 與 mid 至少有一個就簽發 token,兩者都放進 payload,
//  並帶上 bound(是否已綁定 ERP)。需要 erpid 的功能自行判斷,
//  由那些功能各自給出「綁定後即可使用」的說明,而不是在這裡一律擋死。
// =============================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ⚠ 只在 Supabase Dashboard 填,不要提交回 GitHub
const FALLBACK_PROXY_KEY = "";
const FALLBACK_SESSION_SECRET = "";

const FALLBACK_PROXY_BASE = "https://lohas-proxy-nwad.onrender.com/api";
const SSO_VERIFY_FN =
  "https://hqdmyxxrskvllkcedybl.supabase.co/functions/v1/store-sso-verify";
const PROXY_API_VER = "0.1.0";
const TOKEN_TTL_SEC = 7 * 24 * 60 * 60;

/* 會員身分。erpid 與 mid 至少要有一個。
   bound=false 代表這是尚未綁定門市的 App 會員 —— 票券、禮物、預約
   這類需要 ERP 客編的功能對他不可用,但瀏覽、收藏、刻圖設計都可以。 */
type Identity = { erpid: string; mid: string; bound: boolean };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

function b64urlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmac(payloadB64: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(payloadB64),
  );
  return b64urlEncode(new Uint8Array(sig));
}

async function issueToken(id: Identity, secret: string): Promise<string> {
  const payload = {
    erpid: id.erpid,
    mid: id.mid,
    bound: id.bound,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC,
  };
  const payloadB64 = b64urlEncode(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return `${payloadB64}.${await hmac(payloadB64, secret)}`;
}

/* 回 null 代表無效。
   ⚠ 舊 token 的 payload 只有 { erpid, exp },必須繼續認 ——
   不然這一版一上線,所有已登入的人會同時被踢出去。 */
async function verifyToken(token: string, secret: string): Promise<Identity | null> {
  if (!token || !token.includes(".")) return null;
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return null;

  const expect = await hmac(payloadB64, secret);
  if (expect.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expect.length; i++) {
    diff |= expect.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  if (diff !== 0) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64)));
    if (Number(payload?.exp || 0) < Math.floor(Date.now() / 1000)) return null;

    const erpid = String(payload?.erpid || "");
    const mid = String(payload?.mid || "");
    if (!erpid && !mid) return null;

    // 舊 token 沒有 bound 欄位;有 erpid 就是已綁定
    const bound = payload?.bound === undefined ? !!erpid : !!payload.bound;
    return { erpid, mid, bound };
  } catch {
    return null;
  }
}

async function proxyPost(base: string, key: string, path: string, data: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: { apikey: key, apiver: PROXY_API_VER, data } }),
  });
  return res.json();
}

/* 會員資料只能用 erpid 查(對方的 member/list 吃 client_id)。
   未綁定的會員查不到,改用登入回應裡帶的資料組出來 —— 至少有名字可顯示。 */
async function fetchMember(
  base: string, key: string, id: Identity, fallback: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const base0: Record<string, unknown> = {
    client_id: id.erpid,
    mid: id.mid,
    is_erp_bound: id.bound,
    name: fallback.name || "",
    mobile: fallback.mobile || "",
    email: fallback.email || "",
    birthday: "",
  };
  if (!id.erpid) return base0;

  try {
    const p = await proxyPost(base, key, "/proxy/member/list", {
      client_id: Number(id.erpid),
    });
    const row = Array.isArray(p?.data) ? p.data[0] : p?.data;
    if (row) return { ...row, mid: id.mid, is_erp_bound: id.bound };
  } catch (e) {
    console.warn("[auth-session] 會員資料讀取失敗:", e);
  }
  return base0;
}

/* 從上游登入回應取出身分。
   ⚠ 一併記下對方實際回了哪些欄位 —— 只記【欄位名】不記值。
   官網註冊上線後需要 mid,但 officialWed/login 是舊介面,
   對方說已補上 mid 與 is_erp_bound,實際有沒有回只能靠這行確認。
   欄位名裡沒有個資,值裡面有(姓名、手機),所以只印 key。 */
function identityOf(loginData: Record<string, any>): Identity {
  const d = loginData || {};
  const erpid = String(d.erpid ?? d.client_id ?? "").trim();
  const mid = String(d.mid ?? "").trim();
  const bound = d.is_erp_bound === undefined ? !!erpid : !!d.is_erp_bound;

  console.log(
    "[auth-session] 上游 login 回傳欄位:" + Object.keys(d).join(",") +
    " | erpid=" + (erpid ? "有" : "無") +
    " | mid=" + (mid ? "有" : "無") +
    " | bound=" + bound,
  );

  return { erpid, mid, bound };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ code: "405", message: "只接受 POST" }, 405);

  const PROXY_BASE = Deno.env.get("PROXY_BASE") ?? FALLBACK_PROXY_BASE;
  const PROXY_KEY = Deno.env.get("PROXY_API_KEY") ?? FALLBACK_PROXY_KEY;
  const SECRET = Deno.env.get("SESSION_SECRET") ?? FALLBACK_SESSION_SECRET;

  if (!PROXY_KEY || !SECRET || SECRET.startsWith("請貼上")) {
    return json({ code: "500", message: "後端未設定完成" }, 500);
  }

  let body: {
    action?: string; account?: string; password?: string;
    token?: string; ssoToken?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ code: "400", message: "請求格式錯誤" }, 400);
  }

  const action = (body.action ?? "").trim();

  // ===== 帳密登入 =====
  if (action === "login") {
    const account = (body.account ?? "").trim();
    const password = (body.password ?? "").toString();
    if (!account || !password) {
      return json({ code: "400", message: "請輸入帳號與密碼" }, 400);
    }

    let loginRes: any;
    try {
      loginRes = await proxyPost(PROXY_BASE, PROXY_KEY,
        "/proxy/officialWed/login", { account, password });
    } catch (e) {
      return json({ code: "502", message: "登入服務連線失敗" }, 502);
    }

    if (String(loginRes?.code ?? "").trim() !== "200") {
      const upstreamMsg = loginRes?.message || loginRes?.errmessage;

      // 代理失敗時回的是 { error: ... },欄位名和上游不同。
      // 少了這個判斷,上游整台掛掉也會顯示「帳號或密碼錯誤」——
      // 2026-08-11 就是這樣讓人花了一小時查密碼和金鑰。
      if (!upstreamMsg && loginRes?.error) {
        return json({ code: "502", message: "登入服務暫時無法使用,請稍後再試" }, 502);
      }

      return json({
        code: "401",
        message: upstreamMsg || "帳號或密碼錯誤",
      }, 401);
    }

    const id = identityOf(loginRes?.data);

    /* 只要有一個識別碼就放行。
       兩個都沒有才是真的異常 —— 那代表上游回了 200 卻沒給身分。 */
    if (!id.erpid && !id.mid) {
      console.error("[auth-session] 上游回 200 但沒有 erpid 也沒有 mid");
      return json({ code: "500", message: "未取得會員識別" }, 500);
    }

    const member = await fetchMember(PROXY_BASE, PROXY_KEY, id, {
      name: loginRes?.data?.erpname || loginRes?.data?.name || "",
      mobile: loginRes?.data?.mobile || "",
      email: loginRes?.data?.email || "",
    });

    return json({
      code: "200",
      token: await issueToken(id, SECRET),
      member,
    });
  }

  // ===== SSO 登入(APP 帶一次性 token 進官網) =====
  if (action === "sso") {
    const ssoToken = (body.ssoToken ?? "").trim();
    if (!ssoToken) return json({ code: "400", message: "缺少 SSO token" }, 400);

    let v: any;
    try {
      const r = await fetch(SSO_VERIFY_FN, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: ssoToken }),
      });
      v = await r.json();
    } catch (e) {
      return json({ code: "502", message: "SSO 驗證服務連線失敗" }, 502);
    }

    if (!v?.ok || !v?.erpid) {
      return json({
        code: "401",
        message: v?.error || "SSO 驗證失敗,請重新從 App 進入",
      }, 401);
    }

    /* 從 App 進來的一定已綁定 ERP —— App 那側本來就是以客編識別。 */
    const id: Identity = { erpid: String(v.erpid), mid: String(v.mid || ""), bound: true };

    // 一次性 token 已消耗,以下即使失敗仍須回傳成功,否則使用者會卡住
    const member = await fetchMember(PROXY_BASE, PROXY_KEY, id, { name: v.erpname || "" });

    return json({
      code: "200",
      token: await issueToken(id, SECRET),
      member,
    });
  }

  // ===== 憑 token 取會員資料 =====
  if (action === "profile") {
    const id = await verifyToken((body.token ?? "").trim(), SECRET);
    if (!id) return json({ code: "401", message: "登入狀態已失效" }, 401);
    const member = await fetchMember(PROXY_BASE, PROXY_KEY, id, {});
    return json({ code: "200", member });
  }

  // ===== 驗證 token(給其他函式呼叫) =====
  if (action === "verify") {
    const id = await verifyToken((body.token ?? "").trim(), SECRET);
    if (!id) return json({ code: "401", message: "token 無效或已過期" }, 401);

    /* erpid 照舊回傳,呼叫端不必改就能繼續運作 ——
       未綁定的會員 erpid 是空字串,那些函式本來就會擋下來。
       要給出「綁定後即可使用」這種說明的,再自行讀 mid 與 bound。 */
    return json({ code: "200", erpid: id.erpid, mid: id.mid, bound: id.bound });
  }

  return json({ code: "400", message: "未知的 action" }, 400);
});
