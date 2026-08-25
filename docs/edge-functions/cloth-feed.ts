/* =============================================================
   Supabase Edge Function: cloth-feed
   -------------------------------------------------------------
   給【樂活 App / 主後端】抓「眼鏡布已完成」的紀錄,用來發推播。

   總經理 2026-08-25 的需求:
     「雕刻後台針對已完成的商品,做一個按下完成後
       App 可以每天來抓取記錄的 API,並同時串聯推播功能」

   分工:
     我方  提供「哪些完成了、何時完成、是誰的」
     App   每天抓一次,對名單裡的人發推播
   我方發不了 App 推播,那一段在對方。

   === 為什麼與 cloth-admin 分開 ===
   cloth-admin 那支的通行碼是給【製作端的人】用的,會出現在
   後台人員的手機瀏覽器裡。這一支的金鑰是給【對方的伺服器】用的。
   兩者的保管方式、輪替時機、外流風險都不同 —— 共用一把的話,
   製作端換人就得同時通知對方換程式,而那多半不會發生。

   === 增量抓取 ===
   帶 since(ISO 8601 或 Unix 秒)只會拿到那之後完成的。
   不帶 since 預設只回最近 7 天 —— 對方第一次接上時,
   若整包回傳全部歷史,他們會對所有舊客人發一次推播。

   部署:Supabase Dashboard → Edge Functions → 新增 cloth-feed → 貼上本檔
        Verify JWT 要【關閉】

   === ⚠ 金鑰填在下面的 FALLBACK_APP_KEY ===
   使用者沒有 Secrets 權限,值只填在【Dashboard 的編輯器裡】,
   repo 這一份永遠是空字串。取代這支之前先按 Download。
   ============================================================= */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/* App / 主後端呼叫這一支用的金鑰。
   ⚠ 只在 Dashboard 填,不要提交回 GitHub。留空 = 這支停用。 */
const FALLBACK_APP_KEY = '';
const APP_KEY = Deno.env.get('CLOTH_FEED_KEY') || FALLBACK_APP_KEY;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-lohas-key',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

function reply(code: string, body: Record<string, unknown> = {}, http = 200) {
  return new Response(JSON.stringify({ code, ...body }), {
    status: http,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/* 逐字元比對,不要用 !== ——
   字串比較會在第一個不同的字元就返回,回應時間會洩漏「對了幾個字」。 */
function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* since 兩種格式都收:ISO 8601 字串,或 Unix 秒。
   對方的系統用哪一種我方不知道,收兩種比事後再約一次省事。 */
function parseSince(v: unknown): Date | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (Number.isFinite(n) && n > 1000000000) return new Date(n * 1000);
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (!APP_KEY) {
    console.error('[cloth-feed] 金鑰未設定(FALLBACK_APP_KEY 或 CLOTH_FEED_KEY),本支停用');
    return reply('403', { message: '介面尚未啟用' }, 403);
  }

  /* 金鑰從 Header 或 body 都收。
     對方若用 GET 排程工具打,放 Header 比較自然;
     用 POST 則放 body。兩種都支援,少一次來回確認。 */
  let body: Record<string, any> = {};
  if (req.method === 'POST') {
    try { body = await req.json(); } catch { body = {}; }
  } else if (req.method !== 'GET') {
    return reply('405', { message: '只接受 GET 或 POST' }, 405);
  }

  const url = new URL(req.url);
  const given =
    req.headers.get('x-lohas-key') ||
    String(body.key || '') ||
    url.searchParams.get('key') || '';

  if (!sameSecret(given, APP_KEY)) {
    console.warn('[cloth-feed] 金鑰不符');
    return reply('403', { message: 'forbidden' }, 403);
  }

  /* 不帶 since 時只回最近 7 天。
     第一次接上就整包回全部歷史的話,對方會對所有舊客人各推一次。 */
  const since = parseSince(body.since ?? url.searchParams.get('since')) ||
    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const limit = Math.min(
    Math.max(Number(body.limit ?? url.searchParams.get('limit')) || 200, 1), 500);

  const { data, error } = await db.from('cloth_designs')
    .select('id, erpid, mid, source, design_name, preview_url, done_at')
    .eq('status', 'done')
    .gt('done_at', since.toISOString())
    .order('done_at', { ascending: true })    // 由舊到新,對方好記「抓到哪」
    .limit(limit);

  if (error) {
    console.error('[cloth-feed] 查詢失敗:', error.message);
    return reply('500', { message: '系統忙碌,請稍後再試' }, 500);
  }

  const items = (data || []).map((r) => ({
    id: r.id,
    /* 兩種身分擇一有值。門市綁定過的有 client_id,
       官網註冊而尚未綁定的只有 mid —— 兩種都要能推播,
       所以兩個都給,由對方看哪一個有值。 */
    client_id: r.erpid || null,
    mid: r.mid || null,
    design_name: r.design_name,
    // 手繪 / 市集刻圖。推播文案若要分開講,對方用得上
    source: r.source,
    preview_url: r.preview_url,
    done_at: r.done_at,
  }));

  /* next_since 直接給出來,對方不必自己從清單裡挑最後一筆的時間。
       沒有資料時原樣回傳這次的 since,對方下次照樣帶回來即可。 */
  const nextSince = items.length ? items[items.length - 1].done_at : since.toISOString();

  console.log('[cloth-feed] since=' + since.toISOString() + ' → ' + items.length + ' 筆');

  return reply('200', {
    data: {
      items,
      count: items.length,
      since: since.toISOString(),
      next_since: nextSince,
      /* 回傳筆數等於上限,代表可能還有沒抓完的。
         對方看到 true 就帶 next_since 再抓一次,不必等明天。 */
      has_more: items.length >= limit,
    },
  });
});
