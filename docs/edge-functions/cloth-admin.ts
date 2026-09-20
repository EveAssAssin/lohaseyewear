/* =============================================================
   Supabase Edge Function: cloth-admin
   -------------------------------------------------------------
   後台的「客製眼鏡布」列表。

   進得來的方式有兩種:
     A. 管理後台 —— session token + admins 表
     B. 製作端簡易頁 —— 共用通行碼(填在 FALLBACK_LAB_KEY)

   === ⚠ 通行碼要填在下面的 FALLBACK_LAB_KEY ===
   值只填在【Dashboard 的編輯器裡】,repo 這一份永遠是空字串。
   【每次取代這支函式之前,先按右上角 Download】——
   漏掉這一步,製作端那一頁會立刻進不去。
   ============================================================= */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const AUTH_FN = `${SUPABASE_URL}/functions/v1/auth-session`;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

/* 製作端簡易頁(cloth-lab.html)的通行碼。
   ⚠ 只在 Dashboard 填,不要提交回 GitHub。 */
const FALLBACK_LAB_KEY = '';

/* === 退件原因代碼 ===
   選單代碼 + 補充文字。這段文字客人會直接看到,
   純自由輸入容易寫成內部用語,客人不知道要改什麼。
   文案寫在顯示端,改文案不必動這支函式。 */
const REJECT_CODES = ['line_too_thin', 'out_of_bounds', 'low_quality', 'content', 'other'];

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

  let caller = '';

  const labKey = Deno.env.get('CLOTH_LAB_KEY') || FALLBACK_LAB_KEY;
  const givenCode = String(body.code || '');

  function sameSecret(a: string, b: string): boolean {
    if (!a || !b || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  if (givenCode) {
    if (!labKey) {
      console.error('[cloth-admin] 通行碼未設定,簡易頁停用');
      return reply('403', { message: '簡易後台尚未啟用' }, 403);
    }
    if (!sameSecret(givenCode, labKey)) {
      console.warn('[cloth-admin] 通行碼錯誤');
      return reply('403', { message: '通行碼不正確' }, 403);
    }
    caller = 'lab';
  } else {
    caller = await erpidFromToken(String(body.token || ''));
    if (!caller) return reply('401', { message: '登入狀態已失效,請重新登入' }, 401);

    const { data: admin, error: adminErr } = await db.from('admins')
      .select('member_id, status').eq('member_id', caller).maybeSingle();
    if (adminErr) return reply('500', { message: '系統忙碌,請稍後再試' }, 500);
    if (!admin || (admin.status && admin.status !== 'active')) {
      console.warn('[cloth-admin] 非管理員嘗試查詢', caller);
      return reply('403', { message: '沒有查詢權限' }, 403);
    }
  }

  const action = String(body.action || 'list');

  /* ---------- 列印製作單(2026-09-03 新增) ----------
     用途:雕刻師按下「完成製作」後列印 80mm 熱感應製作單,
     隨布一起寄到門市;門市收到時掃單上的 QR 登錄到店。

     🚨 為什麼單獨一支而不是把姓名加回列表:
       列表對製作端是【不給姓名】的(下面那段) ——
       他要的是「刻什麼、刻在哪」,不是「誰」。
       但製作單會跟著布到門市,門市需要姓名才找得到人。

       所以姓名【只在列印那一張時】給,一次一筆。
       製作端因此不能瀏覽所有客人的姓名,只在真的要印那張時
       看到那一位 —— 需求滿足了,而原本的顧慮也還在。

     ⚠ QR 裡放的是【這一筆的 id】,不是樂活那邊的 token ——
       token 要等對方每日同步才存在,而製作單是按下完成的當下就要列印。
       (對方的 ClothArrival 已改成以 cloth_id 查詢) */
  if (action === 'print') {
    const id = String(body.id || '').trim();
    if (!id) return reply('006', { message: '缺少識別碼' }, 400);

    const { data, error } = await db.from('cloth_designs')
      .select('id, erpid, member_name, design_name, source, status, created_at, done_at, store_erpid, store_name')
      .eq('id', id).maybeSingle();

    if (error) {
      console.error('[cloth-admin] 製作單查詢失敗:', error.message);
      return reply('500', { message: '讀取失敗' }, 500);
    }
    if (!data) return reply('006', { message: '查無這一筆' }, 400);

    console.log('[cloth-admin] ' + caller + ' 列印製作單 ' + id);
    return reply('200', { data });
  }

  /* ---------- 改狀態 ---------- */
  if (action === 'set_status') {
    const id = String(body.id || '').trim();
    const status = String(body.status || '');
    if (!id) return reply('006', { message: '缺少識別碼' }, 400);
    if (['new', 'done', 'archived', 'rejected'].indexOf(status) < 0) {
      return reply('006', { message: '狀態值不正確' }, 400);
    }
    /* 記下完成的時間。對方以它做增量抓取 ——
       改回 new / archived / rejected 時把時間清掉,
       不然那筆會一直被當成「某天完成過」而重複推播。 */
    const patch: Record<string, unknown> = { status };
    patch.done_at = status === 'done' ? new Date().toISOString() : null;

    /* ---------- 退件 ----------
       🚨 退件【不佔用一年一件的額度】,且客人重做時【不再檢查生日月】。
         那兩件事做在 cloth 那支(客人存檔的入口),不是這裡 ——
         但兩邊是同一套規則的兩半,改任一邊之前要先看另一邊。

       🚨 status 的 CHECK 約束必須包含 'rejected'。
         2026-09-02 新增退件時我方【假設】沒有這個約束、沒有查證,
         結果雕刻師按下退件只看到一句「更新失敗」。
         約束已於 2026-09-03 修正。 */
    if (status === 'rejected') {
      const rcode = String(body.reject_code || '').trim();
      const rtext = String(body.reject_reason || '').trim().slice(0, 300);

      if (REJECT_CODES.indexOf(rcode) < 0) {
        return reply('006', { message: '請選擇退件原因' }, 400);
      }
      if (rcode === 'other' && rtext === '') {
        return reply('006', { message: '選擇「其他」時請填寫說明' }, 400);
      }

      const cur = await db.from('cloth_designs')
        .select('reject_count').eq('id', id).maybeSingle();
      if (cur.error) {
        console.error('[cloth-admin] 讀取退件次數失敗:', cur.error.message);
        return reply('500', { message: '更新失敗' }, 500);
      }

      patch.reject_code   = rcode;
      patch.reject_reason = rtext || null;
      patch.rejected_at   = new Date().toISOString();
      patch.reject_count  = (Number(cur.data?.reject_count) || 0) + 1;
    }

    const { error } = await db.from('cloth_designs')
      .update(patch).eq('id', id);
    if (error) {
      /* 🚨 這一行是 2026-09-03 補的。原本只回「更新失敗」、不寫 log ——
         資料庫講的 violates check constraint 完全沒被記下來,
         日誌裡只有「列出 N 筆」,看起來像什麼事都沒發生。
         通則:回給使用者的訊息可以籠統,但機器端一定要留下原因。 */
      console.error('[cloth-admin] 更新失敗 id=' + id + ' status=' + status
        + ' → ' + error.message);
      return reply('500', { message: '更新失敗' }, 500);
    }
    console.log('[cloth-admin] ' + caller + ' 將 ' + id + ' 改為 ' + status
      + (status === 'rejected' ? ' (' + String(body.reject_code) + ')' : ''));
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

  const status = String(body.status || '');
  if (['new', 'done', 'archived', 'rejected'].indexOf(status) >= 0) q = q.eq('status', status);

  /* 品項。2026-09-20 起眼鏡盒與眼鏡布共用這張表(共用同一個加工中心),
     用 product 欄位區分。
     ⚠ 沒帶就是【全部】—— 製作端一天要把兩種都做完,預設只給一種的話,
       另一種會安靜地堆在看不到的地方。
     ⚠ 用白名單比對,不要把前端字串直接丟進查詢。 */
  const product = String(body.product || '');
  if (['cloth', 'case'].indexOf(product) >= 0) q = q.eq('product', product);

  const keyword = String(body.q || '').trim();
  if (keyword) q = q.or(`erpid.eq.${keyword},member_name.ilike.%${keyword}%`);

  const { data, error, count } = await q;
  if (error) {
    console.error('[cloth-admin] 查詢失敗:', error.message);
    return reply('500', { message: '系統忙碌,請稍後再試' }, 500);
  }

  console.log('[cloth-admin] ' + caller + ' 列出 ' + (data || []).length + ' 筆');

  /* 通行碼進來的(製作端)不給姓名。
     他要的是「刻什麼、刻在哪、哪一件」,不是「誰」。
     ⚠ 列印製作單是例外(見上面的 print 動作):那張單會跟著布到門市,
       門市需要姓名才找得到人 —— 但一次只給一筆。 */
  const items = (data || []).map((r: Record<string, any>) =>
    caller === 'lab' ? { ...r, member_name: null, mid: null } : r);

  let heartbeat: Record<string, unknown> | null = null;
  if (caller !== 'lab') {
    const hb = await db.from('cloth_feed_heartbeat')
      .select('last_fetch_at, last_status, last_count').eq('id', 1).maybeSingle();
    if (hb.error) console.error('[cloth-admin] 心跳讀取失敗:', hb.error.message);
    else if (hb.data) heartbeat = hb.data;
  }

  return reply('200', {
    data: { items, total: count || 0, limit, offset, heartbeat },
  });
});