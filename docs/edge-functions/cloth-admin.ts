/* =============================================================
   Supabase Edge Function: cloth-admin
   -------------------------------------------------------------
   後台的「客製眼鏡布」列表。

   為什麼與 cloth 分開:
     cloth 那支是【給客人用的】—— 只做「存自己的作品」這一件事。
     這一支是【給後台用的】,查的是所有人的作品。
     混在同一支的話,日後任何一次改動都可能不小心把特權查詢
     暴露成客人也能呼叫的動作。分開就不會有這種事。
     (與 gift / store-lookup 的分法一致)

   進得來的方式有兩種(見 Deno.serve 內的說明):
     A. 管理後台 —— session token + admins 表
     B. 製作端簡易頁 —— 共用通行碼 CLOTH_LAB_KEY(Secrets 設定)

   A 的兩道關卡,缺一不可:
     1. 有效的 session token          確認「是誰」
     2. 該會員在 admins 表且狀態正常   確認「有沒有權限」
     只驗第一道的話,任何登入中的會員都能看到全部客人的作品。

   部署:Supabase Dashboard → Edge Functions → 新增 cloth-admin → 貼上本檔
        Verify JWT 要【關閉】

   ⚠ 這支不需要任何金鑰,用的是 Supabase 自動注入的環境變數。
   ============================================================= */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const AUTH_FN = `${SUPABASE_URL}/functions/v1/auth-session`;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(code: string, body: Record<string, unknown> = {}, http = 200) {
  return new Response(JSON.stringify({ code, ...body }), {
    status: http,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function erpidFromToken(token: string): Promise<string> {
  if (!token) return '';
  try {
    const r = await fetch(AUTH_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify', token }),
    });
    const j = await r.json();
    if (String(j?.code) !== '200') return '';
    return String(j?.erpid || '').trim();
  } catch {
    return '';
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply('405', { message: '只接受 POST' }, 405);

  let body: Record<string, any>;
  try { body = await req.json(); }
  catch { return reply('006', { message: '請求格式錯誤' }, 400); }

  /* ---------- 兩種進得來的方式 ----------
     A. 管理後台:session token + admins 表(與其他後台頁一致)
     B. 製作端的簡易頁:一組共用通行碼(CLOTH_LAB_KEY)

     為什麼要有 B:製作的人沒有管理員帳號,也不該為了下載一個檔案
     去開一個。但也不能完全不設防 —— 這一頁列的是客人的作品與檔案,
     網址一旦被轉貼或被搜尋引擎收錄,就擋不住任何人。

     通行碼比對用逐字元累積,不要用 !== 直接比 ——
     字串比較會在第一個不同的字元就返回,回應時間會洩漏「對了幾個字」。 */
  let caller = '';

  const labKey = Deno.env.get('CLOTH_LAB_KEY') || '';
  const givenCode = String(body.code || '');

  function sameSecret(a: string, b: string): boolean {
    if (!a || !b || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  if (givenCode) {
    if (!labKey) {
      console.error('[cloth-admin] 未設定 CLOTH_LAB_KEY,簡易頁無法使用');
      return reply('403', { message: '簡易後台尚未啟用' }, 403);
    }
    if (!sameSecret(givenCode, labKey)) {
      console.warn('[cloth-admin] 通行碼錯誤');
      return reply('403', { message: '通行碼不正確' }, 403);
    }
    caller = 'lab';
  } else {
    /* ---------- 關卡 1:身分 ---------- */
    caller = await erpidFromToken(String(body.token || ''));
    if (!caller) return reply('401', { message: '登入狀態已失效,請重新登入' }, 401);

    /* ---------- 關卡 2:權限 ---------- */
    const { data: admin, error: adminErr } = await db.from('admins')
      .select('member_id, status').eq('member_id', caller).maybeSingle();
    if (adminErr) return reply('500', { message: '系統忙碌,請稍後再試' }, 500);
    if (!admin || (admin.status && admin.status !== 'active')) {
      // 刻意不說「你不是管理員」—— 回應內容不該幫人確認自己踩到了什麼
      console.warn('[cloth-admin] 非管理員嘗試查詢', caller);
      return reply('403', { message: '沒有查詢權限' }, 403);
    }
  }

  const action = String(body.action || 'list');

  /* ---------- 改狀態 ---------- */
  if (action === 'set_status') {
    const id = String(body.id || '').trim();
    const status = String(body.status || '');
    if (!id) return reply('006', { message: '缺少識別碼' }, 400);
    if (['new', 'done', 'archived'].indexOf(status) < 0) {
      return reply('006', { message: '狀態值不正確' }, 400);
    }
    const { error } = await db.from('cloth_designs')
      .update({ status }).eq('id', id);
    if (error) return reply('500', { message: '更新失敗' }, 500);
    console.log('[cloth-admin] ' + caller + ' 將 ' + id + ' 改為 ' + status);
    return reply('200', {});
  }

  /* ---------- 列表 ---------- */
  if (action !== 'list') return reply('006', { message: '不支援的動作' }, 400);

  const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);
  const offset = Math.max(Number(body.offset) || 0, 0);

  let q = db.from('cloth_designs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  // 後台預設只想看還沒處理的。要看全部就不帶這個參數。
  const status = String(body.status || '');
  if (['new', 'done', 'archived'].indexOf(status) >= 0) q = q.eq('status', status);

  const keyword = String(body.q || '').trim();
  if (keyword) q = q.or(`erpid.eq.${keyword},member_name.ilike.%${keyword}%`);

  const { data, error, count } = await q;
  if (error) {
    console.error('[cloth-admin] 查詢失敗:', error.message);
    return reply('500', { message: '系統忙碌,請稍後再試' }, 500);
  }

  console.log('[cloth-admin] ' + caller + ' 列出 ' + (data || []).length + ' 筆');

  /* 通行碼進來的(製作端)不給姓名。
     他要的是「刻什麼、刻在哪、哪一件」,不是「誰」——
     會員編號足以對得上人,姓名多給了只是多一份可外流的個資。 */
  const items = (data || []).map((r: Record<string, any>) =>
    caller === 'lab' ? { ...r, member_name: null, mid: null } : r);

  return reply('200', {
    data: { items, total: count || 0, limit, offset },
  });
});
