/* =============================================================
   Supabase Edge Function: cloth-wall
   -------------------------------------------------------------
   客製眼鏡布分享牆的資料來源(cloth.html 下方那一區)。

   === 為什麼要有這一支 ===
   cloth_designs 是 RLS 全鎖、零政策 —— anon 完全讀不到,而這是
   刻意的:那張表裡有客編、姓名、門市、線稿網址。
   分享牆是【公開頁面】,不需要登入就看得到,所以不能直接開放讀取,
   必須有一層只挑出「可以公開的那幾個欄位」的代理。

   === 只放已完成的 ===
   status = 'done' 才會出現。還在製作中的放上去,客人會來問
   「別人的都好了我的怎麼還沒好」—— 那是製作端的排程,不是客服能答的。

   === 姓名遮罩在【這裡】做,不在前端 ===
   🚨 前端遮罩等於把完整姓名送到每一個訪客的瀏覽器,
     然後請瀏覽器不要顯示。看原始碼、看 network 面板都拿得到。
     遮罩必須在資料離開伺服器【之前】完成。

   部署:Supabase Dashboard → Edge Functions → 新增 cloth-wall → 貼上本檔
        Verify JWT 要【關閉】(這一區不需要登入,任何人都看得到)

   ⚠ 這支不需要任何 Secret。
   ============================================================= */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CODE_VERSION = '2026-09-05 · 眼鏡布分享牆';

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

/* 姓名遮罩:留第一個字,其餘一律換成 ★ 一個字一顆。
   王小明 → 王**   陳美 → 陳*   歐陽小明 → 歐***

   ⚠ 不要「固定兩顆星」—— 那會讓兩個字的名字看起來像三個字,
     而且四個字的名字被截成三個字時,反而更容易被猜出來。
     一個字一顆星,長度資訊本來就從版面上看得出來,遮掉的是內容。

   ⚠ 空字串要有東西可顯示,不然牆上會出現一張沒有名字的卡。 */
function maskName(raw: unknown): string {
  const s = String(raw || '').trim();
  if (!s) return '樂活客人';
  const chars = Array.from(s);          // 用 Array.from 才不會把表情符號拆成兩半
  if (chars.length === 1) return chars[0] + '*';
  return chars[0] + '*'.repeat(chars.length - 1);
}

/* ---------- 對外欄位白名單 ----------
   逐欄挑出來重建,不要把資料列原樣轉發。
   哪天有人在 cloth_designs 加一個欄位(例如電話、備註),
   原樣轉發就會把它送進所有訪客的瀏覽器。
   代價只是日後要多一個欄位時得改這裡一行。 */
function publicItem(r: Record<string, any>) {
  return {
    id: r.id,
    image_url: String(r.preview_url || ''),
    nickname: maskName(r.member_name),
    done_at: r.done_at || null,
  };
}

/* 記憶體快取。這一區以「天」為單位變動,沒有即時性需求;
   不快取的話眼鏡布主頁每次載入都打一次資料庫。
   Edge Function 重啟就沒了,剛好不必處理失效。 */
const CACHE_TTL_MS = 3 * 60 * 1000;
const cache = new Map<string, { at: number; body: string }>();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (req.method === 'GET') {
    return reply('200', { data: { code_version: CODE_VERSION } });
  }
  if (req.method !== 'POST') return reply('405', { message: '只接受 POST' }, 405);

  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { body = {}; }

  const limit  = Math.min(Math.max(Number(body.limit) || 24, 1), 60);
  const offset = Math.max(Number(body.offset) || 0, 0);

  const ck = limit + ':' + offset;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return new Response(hit.body, {
      headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  /* ⚠ 只挑要用的欄位,不要 select('*')。
     select('*') 會把客編、門市、線稿網址一起讀出來 ——
     就算下面的白名單擋住了,那些資料仍然進過這支函式的記憶體與 log。
     從查詢就不要拿,是比較穩的做法。 */
  const { data, error, count } = await db
    .from('cloth_designs')
    .select('id, member_name, preview_url, done_at', { count: 'exact' })
    .eq('status', 'done')
    .not('preview_url', 'is', null)
    .order('done_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error('[cloth-wall] 讀取失敗:', error.message);
    return reply('500', { message: '讀取失敗,請稍後再試' }, 500);
  }

  const payload = JSON.stringify({
    code: '200',
    data: {
      items: (data || []).map(publicItem),
      total: count || 0,
    },
  });

  cache.set(ck, { at: Date.now(), body: payload });
  if (cache.size > 200) cache.clear();

  return new Response(payload, {
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
});
