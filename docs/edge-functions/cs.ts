/* =============================================================
   Supabase Edge Function: cs
   -------------------------------------------------------------
   客人這一側的客服對話(cs_messages)：送出訊息、標記已讀。

   === 為什麼要有這一支 ===
   原本會員中心是【以 anon 身分直接打資料表】送訊息:

     js/member-portal.js
       sb.from('cs_messages').insert({
         member_erpid: erpid,      ← 前端決定
         sender: 'member',         ← 前端決定
         message: text, ...
       })

   而 cs_messages 的 anon 政策是無條件放行。所以任何人都能:

     🚨 送出一則 sender:'staff' 的訊息,塞進【任何一位客人】的對話裡
        —— 在客人眼裡那就是樂活客服講的話
     · 冒用別人的 erpid 發言
     · 把別人的未讀訊息標成已讀(紅點消失,客人不會去看)

   偽造客服訊息可以拿來做什麼,不必想太久:改約定的價格、
   要客人加某個 LINE、說「請先匯款到這個帳號」。

   搬進來之後:
     · member_erpid 只認 token 裡簽出來的
     · sender 一律由伺服器寫死 'member' —— 這一支【永遠不會】寫 staff
       (客服那一側走 admin-write,那邊驗管理員)
     · 標記已讀的條件由伺服器組,前端只能指定「哪一張刻圖的對話」

   部署:Supabase Dashboard → Edge Functions → 新增 cs → 貼上本檔
        Verify JWT 要【關閉】(我方自己驗 session token)

   ⚠ 這支不需要任何 Secret。
   ============================================================= */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const AUTH_FN = `${SUPABASE_URL}/functions/v1/auth-session`;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CODE_VERSION = '2026-09-11 · 客人端客服對話(送出/已讀)';

const MAX_LEN = 2000;

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
    return String(j?.erpid ?? j?.data?.erpid ?? '').trim();
  } catch {
    return '';
  }
}

const HITS = new Map<string, number[]>();
function rateLimited(key: string): boolean {
  const now = Date.now();
  const arr = (HITS.get(key) || []).filter((t) => now - t < 60 * 60 * 1000);
  arr.push(now);
  HITS.set(key, arr);
  if (HITS.size > 5000) HITS.clear();
  return arr.length > 120;   // 聊天會比較密集
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (req.method === 'GET') {
    return reply('200', { data: { code_version: CODE_VERSION } });
  }

  if (req.method !== 'POST') return reply('405', { message: '只接受 POST' }, 405);

  let body: Record<string, any>;
  try { body = await req.json(); }
  catch { return reply('006', { message: '請求格式錯誤' }, 400); }

  const action = String(body.action || '');
  if (action !== 'send' && action !== 'mark_read') {
    return reply('006', { message: '不支援的動作' }, 400);
  }

  const erpid = await erpidFromToken(String(body.token || ''));
  if (!erpid) return reply('401', { message: '登入狀態已失效,請重新登入' }, 401);

  if (rateLimited(erpid)) {
    return reply('429', { message: '訊息送得太快,請稍候再試' }, 429);
  }

  const designId = String(body.design_id || '').trim();

  /* ===== mark_read:把「客服傳給我的」未讀訊息標成已讀 =====
     條件全部由伺服器組,前端唯一能指定的是 design_id
     ——「哪一張刻圖的對話」。少了這道,任何人都能把別人的
     未讀紅點清掉,而客人不會知道有訊息沒看到。 */
  if (action === 'mark_read') {
    let q = db.from('cs_messages').update({ is_read: true })
      .eq('member_erpid', erpid)     // ← token 裡的,不是前端送的
      .eq('sender', 'staff')
      .eq('is_read', false);
    if (designId) q = q.eq('design_id', designId);

    const { data, error } = await q.select('id');
    if (error) {
      console.error('[cs] 標記已讀失敗', erpid, error.message);
      return reply('500', { message: '系統忙碌,請稍後再試' }, 500);
    }
    // 本來就可能沒有未讀,0 列是正常的
    return reply('200', { data: { marked: data?.length || 0 } });
  }

  /* ===== send ===== */
  const message = String(body.message ?? '').trim();
  if (!message) return reply('006', { message: '訊息不可空白' }, 400);
  if (message.length > MAX_LEN) {
    return reply('006', { message: '訊息太長(上限 ' + MAX_LEN + ' 字)' }, 400);
  }
  if (!designId) return reply('006', { message: '缺少刻圖編號' }, 400);

  /* ⚠ 只能對【自己的作品】留言。
     不檢查的話,任何登入中的會員都能在別人的作品對話串裡發言。
     用 creator_id 比對 —— 那是伺服器讀出來的,不是前端說的。 */
  const { data: design, error: dErr } = await db.from('engraving_designs')
    .select('id, creator_id').eq('id', designId).maybeSingle();
  if (dErr) {
    console.error('[cs] 讀取作品失敗', erpid, dErr.message);
    return reply('500', { message: '系統忙碌,請稍後再試' }, 500);
  }
  if (!design) return reply('007', { message: '找不到這件作品' }, 404);
  if (String(design.creator_id || '') !== erpid) {
    console.warn('[cs] 拒絕在他人作品留言 erpid=' + erpid + ' design=' + designId);
    return reply('403', { message: '這不是你的作品' }, 403);
  }

  const { data, error } = await db.from('cs_messages').insert({
    member_erpid: erpid,      // 🚨 token 裡的
    design_id:    designId,
    sender:       'member',   // 🚨 寫死。這一支永遠不會產生 staff 訊息
    message,
    is_read:      false,
  }).select().single();

  if (error) {
    console.error('[cs] 送出失敗', erpid, error.message);
    return reply('500', { message: '送出失敗,請稍後再試' }, 500);
  }

  console.log('[cs] ' + erpid + ' 對 ' + designId + ' 留言');
  return reply('200', { data: { row: data } });
});
