/* =============================================================
   Supabase Edge Function: creator
   -------------------------------------------------------------
   創作者編輯【自己的】個人頁(creator_info)。

   === 為什麼要有這一支 ===
   原本會員中心的「創作者個人頁」是這樣存的:

     js/member-portal.js
       sb.from('creator_info').update({ ... })
         .eq('member_id', State.member.erpid)

   條件看起來有比對本人,但 `State.member` 來自 localStorage ——
   改一下裡面的 erpid,就能編輯【任何一位創作者】的個人頁:
   顯示名稱、自我介紹、社群連結、影片、自訂區塊全部。
   而 creator_info 的 anon 政策是無條件放行,擋不住。

   那是宣稱,不是驗證。

   搬進來之後 member_id 只認 token 裡簽出來的那一份,
   前端連送都不用送。

   === 哪些欄位【不開】給本人改 ===
     status                      是不是有效創作者 —— 後台決定
     is_homepage_featured        首頁主打 —— 後台決定
     homepage_exposure_order     首頁曝光順序 —— 同上
     featured_ig_post_url        後台挑的 IG 貼文
     kol_main_image_url          後台放的 KOL 主圖
     bank_* / account_holder     匯款資料走 payout 函式,不從這裡改

   少了這道,創作者可以自己把 status 設成 active、自己上首頁主打。

   部署:Supabase Dashboard → Edge Functions → 新增 creator → 貼上本檔
        Verify JWT 要【關閉】(我方自己驗 session token)

   ⚠ 這支不需要任何 Secret。
   ============================================================= */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const AUTH_FN = `${SUPABASE_URL}/functions/v1/auth-session`;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CODE_VERSION = '2026-09-10 · 創作者編輯自己的個人頁';

/* 站內圖片只收自家 Storage 的公開網址。
   社群連結(IG/FB/官網)本來就是外部網址,不在這個檢查範圍。 */
const STORAGE_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/`;

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
  return arr.length > 60;
}

/* 自訂區塊裡可能夾帶圖片網址。整包掃過一遍,
   出現非自家 Storage 的 http 網址就拒絕 ——
   不然那些圖會出現在創作者頁上,而我方無法控管內容。 */
function hasForeignUrl(v: unknown): boolean {
  const s = JSON.stringify(v ?? '');
  const urls = s.match(/https?:\/\/[^"'\\\s]+/g) || [];
  return urls.some((u) => !u.startsWith(STORAGE_PREFIX));
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

  if (String(body.action || '') !== 'save_profile') {
    return reply('006', { message: '不支援的動作' }, 400);
  }

  const erpid = await erpidFromToken(String(body.token || ''));
  if (!erpid) return reply('401', { message: '登入狀態已失效,請重新登入' }, 401);

  if (rateLimited(erpid)) {
    return reply('429', { message: '操作太頻繁,請稍候再試' }, 429);
  }

  const display_name = String(body.display_name || '').trim();
  if (!display_name) return reply('006', { message: '請填寫顯示名稱' }, 400);

  const joining_photo_url = String(body.joining_photo_url || '');
  if (joining_photo_url && !joining_photo_url.startsWith(STORAGE_PREFIX)) {
    console.warn('[creator] 外部圖檔網址被拒', erpid, joining_photo_url.slice(0, 80));
    return reply('006', { message: '圖片網址不正確' }, 400);
  }
  if (hasForeignUrl(body.custom_blocks)) {
    console.warn('[creator] 自訂區塊夾帶外部網址', erpid);
    return reply('006', { message: '自訂區塊裡有不允許的外部圖片網址' }, 400);
  }

  /* 🚨 這裡【只列本人可以改的欄位】。
     status / is_homepage_featured / homepage_exposure_order 等
     刻意不在其中 —— 見檔頭。多加欄位前請先想清楚
     「創作者自己改這個會不會有問題」。 */
  const row = {
    display_name,
    tagline:           String(body.tagline || ''),
    bio:               String(body.bio || ''),
    joining_photo_url: joining_photo_url,
    joining_story:     String(body.joining_story || ''),
    video_url:         String(body.video_url || ''),
    video_title:       String(body.video_title || ''),
    social_links:      body.social_links ?? {},
    custom_blocks:     body.custom_blocks ?? [],
  };

  /* ⚠ 條件是 token 裡的 erpid,不是前端送的。
     這裡不必「先讀再比」—— 因為條件本身就是伺服器決定的,
     不存在「改到別人」的可能。影響 0 列只代表他還不是創作者。 */
  const { data, error } = await db.from('creator_info')
    .update(row).eq('member_id', erpid).select().maybeSingle();

  if (error) {
    console.error('[creator] 儲存失敗', erpid, error.message);
    return reply('500', { message: '儲存失敗,請再試一次' }, 500);
  }
  if (!data) {
    return reply('007', { message: '找不到你的創作者資料,請重新整理再試' }, 404);
  }

  console.log('[creator] ' + erpid + ' 更新個人頁');
  return reply('200', { data: { row: data } });
});
