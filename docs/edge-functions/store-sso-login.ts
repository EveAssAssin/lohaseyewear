// ============================================================
// Edge Function: store-sso-login
// 路徑: supabase/functions/store-sso-login/index.ts
// 版本: v1.9
//
// 用途: API #4 — App / 商城 送 erpId(+ 選填 erpName、next),
//       生成 30 秒一次性 token,回 reUrl,對方以 WebView 或整頁導轉開啟完成 SSO
//
// 部署: Supabase Dashboard → Edge Functions → store-sso-login
//       設定 "Verify JWT" 為 OFF (對方不會帶 supabase JWT)
//
// v1.9 異動 (相對 v1.8):
//   - 新增呼叫紀錄與速率限制。前置作業:先在 SQL Editor 執行
//     docs/sso-login-log-schema.sql 建立 sso_login_log。
//
//     這一版的由來是商城 2026-08-17 的一句提醒:
//       「金鑰外洩時,我方這邊無從察覺 —— 對方拿去打的是貴方的端點。
//         只有貴方看得到異常。」
//     這把金鑰等同於「可為任意會員產生登入連結,不需要密碼」,
//     而先前這支完全沒有紀錄 —— 真的被拿去掃帳號,我們不會知道,
//     事後也查不出被存取過哪些帳號。
//
//   - 速率限制【擋】、掃描特徵【只告警不擋】。
//     擋錯的代價是真客人從 App 進不了官網,那比多一筆警示嚴重得多。
//
// v1.8 異動 (相對 v1.7):
//   - 金鑰改為多把。App 與商城各持一把,哪一把外洩就只輪替哪一把,
//     另一邊不受影響 —— 兩個入口的發布節奏不同,綁在同一把上遲早會互相卡住。
//   - 日誌記下是哪一把在呼叫(app / shop),追問題時知道來源。
//
// v1.7 異動 (相對 v1.6):
//   - 新增 next: 呼叫方傳「未編碼的站內相對路徑」,由本函式編碼後併入 reUrl。
//     原因: 先前要呼叫方自己把 &next=... 接在 reUrl 後面,漏做 encodeURIComponent
//     時,值裡的 & 會被瀏覽器當成 ssologin.html 自己的參數解析掉 —— 不會報錯,
//     只是安靜地遺失後半段。把編碼收回自己這邊,呼叫方就不可能踩到。
//   - next 的 open redirect 檢查提前到「發 token 的當下」。ssologin.html 端仍有
//     同樣的檢查(縱深防禦),但在這裡擋下能直接回 400 讓對方知道傳錯了,
//     而不是靜默退回 /market.html。
//   - erpName 改為選填。官網在 SSO 完成後會另以 erpId 向 ERP 取回完整會員資料,
//     顯示一律以那份為準,erpName 不作為顯示來源 —— 既然不用,就不該擋。
//   - Response 結構維持不變 (status / apiVer / reUrl / expiresIn 留外層)
//
// 注意: token 入庫的格式不變,store-sso-verify 那端不需要動。
//
// ⚠ 金鑰只在 Dashboard 填,不要提交回 GitHub。
//   整份覆蓋線上版本之前,先按函式頁面右上角的 Download 備份,
//   再把 API_KEYS 裡的值貼回去。
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

// ===== 設定 =====

// 每個呼叫來源一把金鑰。label 只進日誌,不會回給對方。
// 空字串代表「這把還沒發」—— 下面的比對會跳過空值,
// 否則沒填的那一把會變成「送空的 apiKey 就能通過」的後門。
// 開通順序:先在這裡填上金鑰 → Deploy → 才把值交付給對方。
// 還沒要開通的來源就留空字串,那一把等於不存在。
const API_KEYS: Array<{ key: string; label: string }> = [
  { key: '', label: 'app'       },   // App 用(原本那把,值不要改)
  { key: '', label: 'shop'      },   // 商城正式站
  { key: '', label: 'shop-test' },   // 商城測試站(2026-08-17 商城來文要求)
];

const API_VER = '1.0';
const SSO_BASE = 'https://www.lohasglasses.com/ssologin.html';
const SITE_ORIGIN = 'https://www.lohasglasses.com';

/* next 是不是「真的只指向本站」。
   ---------------------------------------------------------------
   用解析器判斷,不用字串比對。字串比對要猜完瀏覽器所有的正規化規則
   (反斜線、定位字元、多重斜線…),猜漏一種就是一個開放轉址;
   解析器已經知道那些規則,問它就好。

   ⚠ 只回 true/false,不回正規化後的值 —— 呼叫端存的仍是對方送來的
     原字串,兩邊若不一致,日後查 log 會對不上。 */
function isSiteRelative(next: string): boolean {
  try {
    return new URL(next, SITE_ORIGIN).origin === SITE_ORIGIN;
  } catch {
    return false;
  }
}
const TOKEN_TTL_SECONDS = 30;

/* ===== 速率限制與異常門檻 =====
   RATE_MAX 是【會擋下來】的:同一把金鑰一分鐘內超過就拒絕。
   設 60 是因為正常情況下這是「客人點一下才發生一次」的動作,
   一分鐘六十次已經遠高於任何真實尖峰。

   SCAN_DISTINCT 只【告警不擋】:十分鐘內同一把金鑰為多少個不同的
   erpId 產生連結。逐一嘗試會員編號是拿到金鑰之後最自然的用法,
   而正常流量下這個數字不會太高。
   但商城的客人本來就多,擋錯的代價是真客人進不了官網 ——
   所以這一項只寫紀錄,由人看過再決定。 */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 60;
const SCAN_WINDOW_MS = 600_000;
const SCAN_DISTINCT = 100;

// CORS — 對外給 App,App 不走瀏覽器 CORS,但保留 OPTIONS 給瀏覽器測試工具
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type':                 'application/json; charset=utf-8',
};

const sb = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

serve(async (req: Request) => {
  // ===== CORS preflight =====
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }
  if (req.method !== 'POST') {
    return jsonResp(405, { status: 405, error: 'Method not allowed, use POST' });
  }

  const ip = clientIp(req);

  // ===== 解析 body =====
  let raw: any;
  try {
    raw = await req.json();
  } catch {
    await log({ key_label: '(invalid)', ip, result: 'bad_request', note: 'Invalid JSON body' });
    return jsonResp(400, { status: 400, error: 'Invalid JSON body' });
  }

  // ===== 雙收: 有外層 data 就剝一層,沒有就直接用 =====
  const body = unwrapBody(raw);

  const apiKey  = String(body?.apiKey || '');
  const apiVer  = body?.apiVer;
  const erpId   = String(body?.erpId   || '').trim();
  const erpName = String(body?.erpName || '').trim();   // 選填
  const next    = String(body?.next    || '').trim();   // 選填,未編碼的站內相對路徑

  // ===== apiKey 檢查 =====
  // k.key && 這個條件不能省:沒填的常數是空字串,少了它,
  // 對方送一個空的 apiKey 就會比對成功。
  const caller = API_KEYS.find((k) => k.key && k.key === apiKey);
  if (!caller) {
    /* ⚠ 不記錄對方送來的金鑰值 —— 那有可能正是真的那一把,
       寫進資料庫等於多開一個外洩點。只記「有人用錯的金鑰來過」。 */
    await log({ key_label: '(invalid)', erpid: erpId || null, ip, result: 'invalid_key' });
    return jsonResp(401, { status: 401, error: 'Invalid apiKey' });
  }

  // ===== 速率限制 =====
  const guard = await checkRate(caller.label);
  if (guard.blocked) {
    console.error('[store-sso-login] rate limited:', caller.label, guard.note);
    await log({ key_label: caller.label, erpid: erpId || null, ip,
                result: 'rate_limited', note: guard.note });
    return jsonResp(429, { status: 429, error: 'Too many requests' });
  }
  if (guard.scanWarning) {
    /* 這一行是給人看的。逐一嘗試會員編號是拿到金鑰後最自然的用法,
       但商城客人多,擋錯會讓真客人進不來 —— 所以只告警。 */
    console.error('[store-sso-login] ⚠ 可能的帳號掃描:', caller.label, guard.note);
  }

  // ===== apiVer 提醒 (不擋,只 log) =====
  if (apiVer && apiVer !== API_VER) {
    console.warn('[store-sso-login] unexpected apiVer:', apiVer, 'from', caller.label);
  }

  // ===== 必填檢查 =====
  if (!erpId) {
    await log({ key_label: caller.label, ip, result: 'bad_request', note: 'missing erpId' });
    return jsonResp(400, { status: 400, error: 'Missing required field: erpId' });
  }

  /* ===== next 檢查 =====
     只接受站內相對路徑。放行外部網址的話,這支 SSO 就成了釣魚跳板 ——
     連結是我方網域寄出的、客人也真的登入了,然後被送到別人的站。

     ⚠ 2026-08-25 修正:原本用字串比對(開頭是 / 且不是 //),
       被 `/\evil.com` 繞過。瀏覽器會把反斜線正規化成斜線,
       於是 `/\evil.com` 變成 `//evil.com`,解析結果是 https://evil.com/。
       實測 new URL('/\\evil.com', 'https://www.lohasglasses.com').href
       就是 'https://evil.com/'。

       所以不要比對字串,要【交給同一個解析器解完再看 origin】——
       我方猜不完瀏覽器所有的正規化規則,但可以問它答案。 */
  if (next && !isSiteRelative(next)) {
    await log({ key_label: caller.label, erpid: erpId, ip,
                result: 'bad_request', note: 'invalid next: ' + next.slice(0, 80) });
    return jsonResp(400, {
      status: 400,
      error: 'next must be a site-relative path starting with "/" (e.g. /design.html?nid=2612)',
    });
  }

  // ===== 寫 sso_tokens =====
  const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString();

  const { data: tokenRow, error } = await sb
    .from('sso_tokens')
    .insert({
      erpid:      erpId,
      erpname:    erpName,
      expires_at: expiresAt,
    })
    .select('token')
    .single();

  if (error || !tokenRow) {
    console.error('[store-sso-login] insert error:', error);
    await log({ key_label: caller.label, erpid: erpId, ip, result: 'error',
                note: String(error?.message || '').slice(0, 200) });
    return jsonResp(500, { status: 500, error: 'Internal server error' });
  }

  await log({ key_label: caller.label, erpid: erpId, ip, result: 'ok',
              next_path: next || null });

  console.log('[store-sso-login] issued for', caller.label, 'erpId', erpId, next ? '→ ' + next : '');

  // ===== 組 reUrl =====
  // next 由這裡編碼,呼叫方傳原始字串即可。
  // 沒帶 next 時 reUrl 與 v1.6 完全相同,既有的 App 串接不受影響。
  const reUrl = `${SSO_BASE}?token=${tokenRow.token}`
    + (next ? `&next=${encodeURIComponent(next)}` : '');

  return jsonResp(200, {
    status:    200,
    apiVer:    API_VER,
    reUrl,
    expiresIn: TOKEN_TTL_SECONDS,
  });
});

/* ===== 速率限制 =====
   用資料庫而不是記憶體計數 —— Edge Function 會有多個執行個體,
   各自記數等於沒有限制。

   ⚠ 查詢失敗時【放行】。理由:這條路徑是客人從 App 進官網的入口,
   因為紀錄表出問題就讓所有人進不來,比放行一分鐘嚴重得多。
   放行時會寫 error log,不會安靜略過。 */
async function checkRate(label: string): Promise<{
  blocked: boolean; scanWarning: boolean; note: string;
}> {
  const since = new Date(Date.now() - SCAN_WINDOW_MS).toISOString();
  const { data, error } = await sb
    .from('sso_login_log')
    .select('erpid, created_at')
    .eq('key_label', label)
    .eq('result', 'ok')
    .gte('created_at', since);

  if (error) {
    console.error('[store-sso-login] 速率限制查詢失敗,本次放行:', error.message);
    return { blocked: false, scanWarning: false, note: '' };
  }

  const rows = data || [];
  const rateFrom = Date.now() - RATE_WINDOW_MS;
  const recent = rows.filter((r) => new Date(r.created_at).getTime() >= rateFrom).length;
  const distinct = new Set(rows.map((r) => r.erpid).filter(Boolean)).size;

  return {
    blocked: recent >= RATE_MAX,
    scanWarning: distinct >= SCAN_DISTINCT,
    note: `1分鐘 ${recent} 次 / 10分鐘 ${distinct} 個不同會員`,
  };
}

/* 寫紀錄。⚠ 失敗絕不影響主流程 —— 記錄是我方的內部需求,
   不是客人這次登入的一部分。 */
async function log(row: Record<string, unknown>): Promise<void> {
  try {
    const { error } = await sb.from('sso_login_log').insert(row);
    if (error) console.error('[store-sso-login] 紀錄寫入失敗:', error.message);
  } catch (e) {
    console.error('[store-sso-login] 紀錄寫入例外:', e instanceof Error ? e.message : e);
  }
}

/** 取真實來源 IP。x-forwarded-for 是「客戶端, 代理1, ...」,第一段才是來源 */
function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for') || '';
  return xff.split(',')[0].trim() || req.headers.get('cf-connecting-ip') || '';
}

// 雙收解包: 有 data 包就剝、沒有就回原物件
function unwrapBody(raw: any): any {
  if (raw && typeof raw === 'object' && raw.data && typeof raw.data === 'object'
      && (raw.data.apiKey !== undefined || raw.data.apiVer !== undefined)) {
    return raw.data;
  }
  return raw;
}

function jsonResp(httpStatus: number, payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), {
    headers: CORS,
    status:  httpStatus,
  });
}
