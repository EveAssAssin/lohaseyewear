/* =============================================================
   Supabase Edge Function: gallery
   -------------------------------------------------------------
   客人自己的靈感牆投稿(gallery_posts)：新增、修改、刪除。

   === 為什麼要有這一支 ===
   原本這三件事都是【以 anon 身分直接打資料表】做的,而
   gallery_posts 的政策是無條件放行:

     js/upload.js
       .update(payload).eq('id', state.editId)     ← 條件只有 id
       .insert({ member_id: member.erpid, ... })   ← 作者由前端決定
     js/member-portal.js
       .delete().eq('id', postId)                  ← 條件只有 id

   也就是說,任何人拿公開的 anon key 就能:
     · 刪掉任何一位客人的投稿照片與故事
     · 把別人的投稿內容整個改掉(標題、故事、圖片全部)
     · 用別人的名字發表投稿

   「刪除故事」那一處有比對 member_id,但那個值來自 localStorage,
   改一下就過了 —— 那是宣稱,不是驗證。

   搬進來之後:
     · member_id / customer_name 由伺服器從 token 填,前端不送
     · 修改與刪除都先【讀出原列比對擁有者】,不是本人回 403
     · 圖片網址只收自家 Storage 的公開網址

   ⚠ 為什麼是「先讀再比」而不是把條件塞進 update/delete 的 where:
     後者被濾掉時是影響 0 列【而且不報錯】,呼叫端分不出
     「不是你的」與「這篇不存在」,畫面只能顯示一句含糊的失敗。

   部署:Supabase Dashboard → Edge Functions → 新增 gallery → 貼上本檔
        Verify JWT 要【關閉】(我方自己驗 session token)

   ⚠ 這支不需要任何 Secret。
   ============================================================= */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const AUTH_FN = `${SUPABASE_URL}/functions/v1/auth-session`;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CODE_VERSION = '2026-09-09 · 客人投稿的新增/修改/刪除';

/* 圖片只收自家 Storage 的公開網址。
   不驗的話前端可以把 main_image_url 指到任意網站 ——
   那些圖會出現在靈感牆上,而我方無法控管內容。 */
const STORAGE_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/`;

const MAX_IMAGES = 9;

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

/* 回 { erpid, name }。
   ⚠ name 只能來自這裡(auth-session 簽在 token 裡的),
     絕對不可以改成從 body 讀 —— 那樣就等於「投稿者是誰由前端決定」。 */
async function whoFromToken(
  token: string,
): Promise<{ erpid: string; name: string } | null> {
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
    if (!erpid) return null;
    return { erpid, name: String(j?.name ?? j?.data?.name ?? '').trim() };
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (req.method === 'GET') {
    return reply('200', { data: { code_version: CODE_VERSION } });
  }

  if (req.method !== 'POST') return reply('405', { message: '只接受 POST' }, 405);

  let body: Record<string, any>;
  try { body = await req.json(); }
  catch { return reply('006', { message: '請求格式錯誤' }, 400); }

  const ACTIONS = ['submit', 'update_own', 'delete_own'];
  const action = String(body.action || '');
  if (ACTIONS.indexOf(action) < 0) {
    return reply('006', { message: '不支援的動作' }, 400);
  }

  const who = await whoFromToken(String(body.token || ''));
  if (!who) return reply('401', { message: '登入狀態已失效,請重新登入' }, 401);
  const erpid = who.erpid;

  if (rateLimited(erpid)) {
    return reply('429', { message: '操作太頻繁,請稍候再試' }, 429);
  }

  /* ===== 共用:讀出原列並確認是本人的 =====
     update_own 與 delete_own 都要走這一段。 */
  async function mustOwn(id: string) {
    if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
      return { err: reply('006', { message: '缺少投稿編號' }, 400) };
    }
    const { data, error } = await db.from('gallery_posts')
      .select('id, member_id, image_urls').eq('id', id).maybeSingle();
    if (error) {
      console.error('[gallery] 讀取失敗', erpid, error.message);
      return { err: reply('500', { message: '系統忙碌,請稍後再試' }, 500) };
    }
    if (!data) return { err: reply('007', { message: '找不到這篇投稿' }, 404) };
    if (String(data.member_id || '') !== erpid) {
      console.warn('[gallery] 拒絕操作他人投稿 erpid=' + erpid + ' id=' + id);
      return { err: reply('403', { message: '這不是你的投稿' }, 403) };
    }
    return { row: data };
  }

  /* ===== delete_own ===== */
  if (action === 'delete_own') {
    const got = await mustOwn(String(body.id || '').trim());
    if (got.err) return got.err;

    const { data, error } = await db.from('gallery_posts')
      .delete().eq('id', got.row!.id).select('id');
    if (error) {
      console.error('[gallery] 刪除失敗', erpid, error.message);
      return reply('500', { message: '刪除失敗,請再試一次' }, 500);
    }
    /* ⚠ 檢查影響幾列。0 列代表「以為刪掉了但沒刪」——
       前面 mustOwn 已經確認它存在,所以 0 列是真的異常,要說出來。 */
    if (!data || !data.length) {
      console.error('[gallery] 刪除影響 0 列', erpid, got.row!.id);
      return reply('007', { message: '刪除失敗,請重新整理再試' }, 404);
    }
    console.log('[gallery] ' + erpid + ' 刪除 ' + got.row!.id);
    return reply('200', { data: { id: got.row!.id } });
  }

  /* ===== submit / update_own ===== */
  const title = String(body.title || '').trim();
  if (!title) return reply('006', { message: '標題不可空白' }, 400);

  const imgs = Array.isArray(body.image_urls) ? body.image_urls : [];
  if (!imgs.length) return reply('006', { message: '請至少上傳一張照片' }, 400);
  if (imgs.length > MAX_IMAGES) {
    return reply('006', { message: '照片最多 ' + MAX_IMAGES + ' 張' }, 400);
  }
  for (const u of imgs) {
    if (typeof u !== 'string' || !u.startsWith(STORAGE_PREFIX)) {
      console.warn('[gallery] 外部圖檔網址被拒', erpid, String(u).slice(0, 80));
      return reply('006', { message: '圖片網址不正確' }, 400);
    }
  }

  const story = String(body.story || '');
  const row: Record<string, unknown> = {
    title,
    topic:   String(body.topic || ''),
    carrier: String(body.carrier || ''),
    story,
    /* 分流規則寫在伺服器:故事文字 >= 50 字算 story,否則是 photo。
       原本這是前端算好再送 —— 兩邊各算一次遲早會分岔。 */
    type: story.trim().length >= 50 ? 'story' : 'photo',
    image_urls:     imgs,
    main_image_url: imgs[0],
    is_public: true,
    /* 🚨 這四個由伺服器填,不看 body。
       原本 member_id 與 customer_name 都是前端送的,
       等於「這篇投稿掛在誰名下」由客人自己決定。 */
    member_id:     erpid,
    customer_name: who.name || '顧客',
    status:        'pending',   // 新投稿與改後重送都要重新審核
    reject_reason: null,        // 重送時把上一次的駁回理由清掉
  };

  try {
    if (action === 'submit') {
      const { data, error } = await db.from('gallery_posts')
        .insert(row).select().single();
      if (error) throw error;
      console.log('[gallery] ' + erpid + ' 新增投稿 ' + data.id);
      return reply('200', { data: { row: data } });
    }

    // update_own
    const got = await mustOwn(String(body.id || '').trim());
    if (got.err) return got.err;

    const { data, error } = await db.from('gallery_posts')
      .update(row).eq('id', got.row!.id).select().single();
    if (error) throw error;
    console.log('[gallery] ' + erpid + ' 修改投稿 ' + got.row!.id);
    return reply('200', { data: { row: data } });

  } catch (e) {
    console.error('[gallery] ' + action + ' 失敗', erpid, (e as Error).message);
    return reply('500', { message: '資料寫入失敗,請再試一次' }, 500);
  }
});
