/* =============================================================
   Supabase Edge Function: admin-read
   -------------------------------------------------------------
   後台的【讀取】入口。與 admin-write 對稱。

   === 為什麼要有這一支 ===
   2026-09-11 盤點才發現:整天都在收「寫入」,但【讀取】從來沒查過。
   拿公開的 anon key 就能讀走:

     cs_messages     217 則,涉及 65 位客人(投了什麼、被退什麼理由)
     royalty_records 48 筆(哪位創作者賺了多少)
     member_notices  18 筆(客人的站內通知)
     member_status   誰被停權、停權理由

   前端那些 `.eq('member_erpid', 我)` 看起來像限制,其實只是
   「前端自己挑」—— 把它拿掉就整張表都拿得到。

   === 為什麼不能靠 RLS 解決 ===
   我方的登入是自簽的 session token,不是 Supabase Auth。
   對 Postgres 來說每一個呼叫端都是同一個 anon 角色,
   **RLS 無從分辨誰是誰**,寫不出「只能讀自己的」。
   所以個資的讀取只能搬進函式:客人的走各自的函式(cs / payout…),
   後台的走這一支。

   === 這一支的界線 ===
   它會讀到別人的資料,所以跟 admin-write 一樣要收緊:

     1. 只有【白名單裡的表】能讀
     2. 每張表只回【白名單裡的欄位】—— 不是 select *
     3. 只能用【白名單裡的欄位】當篩選條件
     4. 一次最多 MAX_ROWS 列

   加新的表要同時想清楚上面四件事,不要只加表名。

   部署:Supabase Dashboard → Edge Functions → 新增 admin-read → 貼上本檔
        Verify JWT 要【關閉】(我方自己驗 session token)

   ⚠ 這支不需要任何 Secret。
   ============================================================= */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const AUTH_FN = `${SUPABASE_URL}/functions/v1/auth-session`;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CODE_VERSION = '2026-09-11 · cs_messages';

const MAX_ROWS = 1000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

function reply(code: string, body: Record<string, unknown> = {}, http = 200) {
  return new Response(JSON.stringify({ code, ...body }), {
    status: http,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/* ===== 白名單 =====
   cols   : 允許回傳的欄位(不是 select *)
   filters: 允許當篩選條件的欄位
   order  : 允許排序的欄位 */
type Rule = { cols: string; filters: string[]; order: string[] };
const ALLOW: Record<string, Rule> = {
  cs_messages: {
    cols: 'id, member_erpid, design_id, sender, message, is_read, created_at',
    filters: ['id', 'member_erpid', 'design_id', 'sender', 'is_read'],
    order: ['created_at'],
  },
};

async function isAdmin(token: string): Promise<string> {
  if (!token) return '';
  let erpid = '';
  try {
    const r = await fetch(AUTH_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify', token }),
    });
    const j = await r.json();
    if (String(j?.code) !== '200') return '';
    erpid = String(j?.erpid ?? j?.data?.erpid ?? '').trim();
  } catch { return ''; }
  if (!erpid) return '';

  const { data, error } = await db.from('admins')
    .select('member_id, status').eq('member_id', erpid).maybeSingle();
  if (error || !data) return '';
  if (data.status && data.status !== 'active') return '';
  return erpid;
}

const HITS = new Map<string, number[]>();
function rateLimited(key: string): boolean {
  const now = Date.now();
  const arr = (HITS.get(key) || []).filter((t) => now - t < 60 * 60 * 1000);
  arr.push(now);
  HITS.set(key, arr);
  if (HITS.size > 5000) HITS.clear();
  return arr.length > 300;    // 後台一頁會打好幾次
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (req.method === 'GET') {
    return reply('200', { data: { code_version: CODE_VERSION, tables: Object.keys(ALLOW) } });
  }

  if (req.method !== 'POST') return reply('405', { message: '只接受 POST' }, 405);

  let body: Record<string, any>;
  try { body = await req.json(); }
  catch { return reply('006', { message: '請求格式錯誤' }, 400); }

  const caller = await isAdmin(String(body.token || ''));
  if (!caller) {
    /* 刻意不分「沒登入」與「不是管理員」—— 回應不該幫人確認
       自己踩到了什麼。 */
    return reply('403', { message: '沒有查詢權限' }, 403);
  }

  if (rateLimited(caller)) {
    return reply('429', { message: '查詢太頻繁,請稍候再試' }, 429);
  }

  const table = String(body.table || '');
  const rule = ALLOW[table];
  if (!rule) return reply('006', { message: '不支援的資料表' }, 400);

  /* 篩選條件:陣列形式 [{ col, op, value }],op 只認 eq / in。
     不開放任意運算子 —— like/ilike 在大表上是一條慢查詢的路。 */
  const where = Array.isArray(body.where) ? body.where : [];
  if (where.length > 5) return reply('006', { message: '條件太多' }, 400);

  let q = db.from(table).select(rule.cols, { count: 'exact' });

  for (const w of where) {
    const col = String(w?.col || '');
    const op  = String(w?.op || 'eq');
    if (rule.filters.indexOf(col) < 0) {
      return reply('006', { message: '不允許用這個欄位篩選:' + col }, 400);
    }
    if (op === 'eq') {
      q = q.eq(col, w.value);
    } else if (op === 'in') {
      const list = Array.isArray(w.value) ? w.value : [];
      if (!list.length) return reply('006', { message: '條件的清單是空的' }, 400);
      if (list.length > 500) return reply('006', { message: '一次最多 500 個值' }, 400);
      q = q.in(col, list);
    } else {
      return reply('006', { message: '不支援的條件運算子' }, 400);
    }
  }

  const orderBy = String(body.order_by || '');
  if (orderBy) {
    if (rule.order.indexOf(orderBy) < 0) {
      return reply('006', { message: '不允許用這個欄位排序:' + orderBy }, 400);
    }
    q = q.order(orderBy, { ascending: body.ascending !== false });
  }

  /* head:true 只要筆數不要內容(徽章的未讀數在用)。
     這樣不會把 217 則訊息整包送到瀏覽器。 */
  const headOnly = body.head === true;
  const limit = headOnly ? 1 : Math.min(Number(body.limit) || 200, MAX_ROWS);
  q = q.limit(limit);

  const { data, error, count } = await q;
  if (error) {
    console.error('[admin-read] 查詢失敗', caller, table, error.message);
    return reply('500', { message: '查詢失敗,請再試一次' }, 500);
  }

  return reply('200', {
    data: { rows: headOnly ? [] : (data || []), count: count ?? null },
  });
});
