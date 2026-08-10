// ============================================================
// Edge Function: store-sso-login
// 路徑: supabase/functions/store-sso-login/index.ts
// 版本: v1.8
//
// 用途: API #4 — App / 商城 送 erpId(+ 選填 erpName、next),
//       生成 30 秒一次性 token,回 reUrl,對方以 WebView 或整頁導轉開啟完成 SSO
//
// 部署: Supabase Dashboard → Edge Functions → store-sso-login
//       設定 "Verify JWT" 為 OFF (對方不會帶 supabase JWT)
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
//   整份覆蓋線上版本之後,務必把 API_KEYS 裡的值填回去。
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
  { key: '', label: 'app'  },   // App 用(原本那把,值不要改)
  { key: '', label: 'shop' },   // 商城用
];

const API_VER = '1.0';
const SSO_BASE = 'https://www.lohasglasses.com/ssologin.html';
const TOKEN_TTL_SECONDS = 30;

// CORS — 對外給 App,App 不走瀏覽器 CORS,但保留 OPTIONS 給瀏覽器測試工具
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type':                 'application/json; charset=utf-8',
};

serve(async (req: Request) => {
  // ===== CORS preflight =====
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }
  if (req.method !== 'POST') {
    return jsonResp(405, { status: 405, error: 'Method not allowed, use POST' });
  }

  // ===== 解析 body =====
  let raw: any;
  try {
    raw = await req.json();
  } catch {
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
    return jsonResp(401, { status: 401, error: 'Invalid apiKey' });
  }

  // ===== apiVer 提醒 (不擋,只 log) =====
  if (apiVer && apiVer !== API_VER) {
    console.warn('[store-sso-login] unexpected apiVer:', apiVer, 'from', caller.label);
  }

  // ===== 必填檢查 =====
  if (!erpId) {
    return jsonResp(400, { status: 400, error: 'Missing required field: erpId' });
  }

  // ===== next 檢查 =====
  // 只接受站內相對路徑。擋 // 開頭是為了防 open redirect:
  // //evil.example.com 在瀏覽器眼中是「同協定的絕對網址」,
  // 放行的話這支 SSO 就成了釣魚跳板。
  if (next && (!next.startsWith('/') || next.startsWith('//'))) {
    return jsonResp(400, {
      status: 400,
      error: 'next must be a site-relative path starting with "/" (e.g. /design.html?nid=2612)',
    });
  }

  // ===== 寫 sso_tokens =====
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString();

  const { data: tokenRow, error } = await supabase
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
    return jsonResp(500, { status: 500, error: 'Internal server error' });
  }

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
