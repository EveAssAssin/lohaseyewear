/* =============================================================
   Supabase Edge Function: design
   -------------------------------------------------------------
   創作者對【自己的】刻圖做上架 / 下架 / 刪除(垃圾桶)。

   === 為什麼要有這一支(2026-09-05) ===
   在這之前 member-portal.js 是直接打表:

       sb.from('engraving_designs').update({ is_show: '垃圾桶' }).eq('id', id)

   注意那一行【沒有任何擁有者條件】—— 連前端的形式檢查都沒有,
   只有一個 id。而 engraving_designs 的 anon 政策是無條件放行,
   anon key 又公開在 GitHub 上。

   結果是:任何人都能把【市集裡任何一張刻圖】下架或丟進垃圾桶,
   包含別人的作品。而且畫面上不會有任何異常,
   創作者只會發現自己的作品「不見了」。

   這一支把擁有者判斷搬到伺服器:先用 session token 解出客編,
   再確認那張圖的 creator_id 真的是他,才動手。

   === 為什麼不做成「順便什麼都能改」 ===
   只開 is_show 與 status 兩個欄位,而且值是白名單。
   開放整包 updates 的話,這支就變成「經過驗證的任意欄位寫入」——
   價格、名稱、image_url_svg 都會跟著能改,那等於沒修。

   部署:Supabase Dashboard → Edge Functions → 新增 design → 貼上本檔
        Verify JWT 要【關閉】(我方自己驗 session token)

   ⚠ 這支不需要任何 Secret。
   ============================================================= */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const AUTH_FN = `${SUPABASE_URL}/functions/v1/auth-session`;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CODE_VERSION = '2026-09-05 · 上下架改由伺服器驗擁有者';

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

async function whoFromToken(token: string): Promise<string | null> {
  if (!token) return null;
  try {
    const r = await fetch(AUTH_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify', token }),
    });
    const j = await r.json();
    if (String(j?.code) !== '200') return null;
    const erpid = String(j?.erpid ?? j?.data?.erpid ?? '').trim();
    return erpid || null;
  } catch {
    return null;
  }
}

const HITS = new Map<string, number[]>();
function rateLimited(key: string): boolean {
  const now = Date.now();
  const arr = (HITS.get(key) || []).filter((t) => now - t < 60 * 60 * 1000);
  arr.push(now);
  HITS.set(key, arr);
  if (HITS.size > 5000) HITS.clear();
  return arr.length > 60;
}

/* 允許的目標狀態。白名單,不是「前端傳什麼就寫什麼」。
   ⚠ 重新上架要一併把 status 打回 pending —— 那是既有的業務規則
     (重新上架必須重走審核)。少了這一條,下架再上架就變成
     一條繞過審核的路。 */
const SHOW_VALUES: Record<string, Record<string, string>> = {
  '上架':   { is_show: '上架', status: 'pending' },
  '下架':   { is_show: '下架' },
  '垃圾桶': { is_show: '垃圾桶' },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (req.method === 'GET') {
    return reply('200', { data: { code_version: CODE_VERSION } });
  }

  if (req.method !== 'POST') return reply('405', { message: '只接受 POST' }, 405);

  let body: Record<string, any>;
  try { body = await req.json(); }
  catch { return reply('006', { message: '請求格式錯誤' }, 400); }

  if (String(body.action || '') !== 'set_show') {
    return reply('006', { message: '不支援的動作' }, 400);
  }

  const erpid = await whoFromToken(String(body.token || ''));
  if (!erpid) return reply('401', { message: '登入狀態已失效,請重新登入' }, 401);

  if (rateLimited(erpid)) {
    return reply('429', { message: '操作太頻繁,請稍候再試' }, 429);
  }

  const id = String(body.id || '').trim();
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
    return reply('006', { message: '缺少作品編號' }, 400);
  }

  const patch = SHOW_VALUES[String(body.show || '')];
  if (!patch) return reply('006', { message: '不支援的狀態' }, 400);

  /* 🚨 擁有者判斷在這裡,不在前端。
     先讀出這張圖是誰的,不是他的就 403 —— 而且【不透露那張圖存不存在】,
     兩種情況回同一句話。回「查無此作品」與「這不是你的作品」
     會讓人可以拿這支去枚舉哪些 id 存在。 */
  const { data: row, error: readErr } = await db
    .from('engraving_designs')
    .select('id, creator_id, is_show')
    .eq('id', id)
    .maybeSingle();

  if (readErr) {
    console.error('[design] 讀取失敗:', readErr.message);
    return reply('500', { message: '操作失敗,請稍後再試' }, 500);
  }
  if (!row || String(row.creator_id || '') !== erpid) {
    console.warn('[design] 拒絕:非本人 erpid=' + erpid + ' id=' + id);
    return reply('403', { message: '找不到這件作品,或它不屬於你' }, 403);
  }

  /* 已經在垃圾桶的不給再動 —— 那是不可逆狀態,
     前端的文案也是這樣寫的(「刪除後永久無法恢復上架」)。 */
  if (String(row.is_show || '') === '垃圾桶') {
    return reply('409', { message: '這件作品已經刪除,無法再變更' }, 409);
  }

  const { error: updErr } = await db
    .from('engraving_designs').update(patch).eq('id', id);

  if (updErr) {
    console.error('[design] 更新失敗:', updErr.message);
    return reply('500', { message: '操作失敗,請再試一次' }, 500);
  }

  console.log('[design] ' + erpid + ' 把 ' + id + ' 設為 ' + body.show);
  return reply('200', {});
});
