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

async function issueToken(erpid: string, secret: string): Promise<string> {
  const payload = { erpid, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC };
  const payloadB64 = b64urlEncode(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return `${payloadB64}.${await hmac(payloadB64, secret)}`;
}

async function verifyToken(token: string, secret: string): Promise<string | null> {
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
    if (!payload?.erpid) return null;
    if (Number(payload.exp || 0) < Math.floor(Date.now() / 1000)) return null;
    return String(payload.erpid);
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

async function fetchMember(
  base: string, key: string, erpid: string, fallbackName: string,
): Promise<Record<string, unknown>> {
  let member: Record<string, unknown> = {
    client_id: erpid, name: fallbackName, mobile: "", email: "", birthday: "",
  };
  try {
    const p = await proxyPost(base, key, "/proxy/member/list", {
      client_id: Number(erpid),
    });
    const row = Array.isArray(p?.data) ? p.data[0] : p?.data;
    if (row) member = row;
  } catch (e) {
    console.warn("[auth-session] 會員資料讀取失敗:", e);
  }
  return member;
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

    // ⚠ 這裡會擋掉所有【官網註冊的 App 會員】——他們的 erpid 是空的,
    //   要到門市消費時才由店員建立與綁定。
    //   官網註冊功能上線後,此處與 issueToken / verifyToken 都需要改為
    //   同時支援 mid。詳見 2026-08-17 的討論。
    const erpid = loginRes?.data?.erpid;
    if (!erpid) return json({ code: "500", message: "未取得會員編號" }, 500);

    const member = await fetchMember(PROXY_BASE, PROXY_KEY, String(erpid),
      loginRes?.data?.erpname || loginRes?.data?.name || "");

    return json({
      code: "200",
      token: await issueToken(String(erpid), SECRET),
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

    const erpid = String(v.erpid);
    // 一次性 token 已消耗,以下即使失敗仍須回傳成功,否則使用者會卡住
    const member = await fetchMember(PROXY_BASE, PROXY_KEY, erpid, v.erpname || "");

    return json({
      code: "200",
      token: await issueToken(erpid, SECRET),
      member,
    });
  }

  // ===== 憑 token 取會員資料 =====
  if (action === "profile") {
    const erpid = await verifyToken((body.token ?? "").trim(), SECRET);
    if (!erpid) return json({ code: "401", message: "登入狀態已失效" }, 401);
    const member = await fetchMember(PROXY_BASE, PROXY_KEY, erpid, "");
    return json({ code: "200", member });
  }

  // ===== 驗證 token(給其他函式呼叫) =====
  if (action === "verify") {
    const erpid = await verifyToken((body.token ?? "").trim(), SECRET);
    if (!erpid) return json({ code: "401", message: "token 無效或已過期" }, 401);
    return json({ code: "200", erpid });
  }

  return json({ code: "400", message: "未知的 action" }, 400);
});
