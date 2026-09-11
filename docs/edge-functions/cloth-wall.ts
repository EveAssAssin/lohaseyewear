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

const CODE_VERSION = '2026-09-11 · 分享牆改隨機排序(依種子)';

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

/* 全部已完成的作品,共用一份快取。
   隨機排序之後不能再用「limit:offset」當快取鍵 ——
   同一頁在不同種子下內容不同,那個鍵會把別人的順序餵給你。
   改成快取【原始資料】,排序每次現算(幾百筆的洗牌是微秒等級)。 */
const MAX_WALL = 500;
type Row = Record<string, any>;
let allCache: { at: number; rows: Row[] } | null = null;

/* 以種子決定順序的洗牌。
   ⚠ 一定要是【確定性】的:同一個種子每次都要洗出同一個順序,
     否則客人按「看更多」時第二頁是照另一個順序切的,
     結果就是有的重複、有的看不到。

   mulberry32 —— 短、夠均勻,這個用途不需要密碼學等級的亂數。 */
function rng(seed: number) {
  let a = (seed >>> 0) || 1;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(rows: T[], seed: number): T[] {
  /* 沒給種子(或給 0)就維持原本的「最新完成的在前」——
     舊版前端還沒更新時不會突然變成亂序,而且爬蟲拿到的順序穩定。 */
  if (!seed) return rows;
  const a = rows.slice();
  const rand = rng(seed);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

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
  /* 亂數種子。前端每次載入頁面產生一個,之後每一頁都帶同一個。
     ⚠ 沒有種子就【不能】每頁各自隨機 —— 那會讓同一張出現在
       第 1 頁也出現在第 2 頁,而另一些永遠輪不到。
       種子固定,順序就固定,分頁才接得起來。 */
  const seed = Math.floor(Number(body.seed)) || 0;

  /* ⚠ 只挑要用的欄位,不要 select('*')。
     select('*') 會把客編、門市、線稿網址一起讀出來 ——
     就算下面的白名單擋住了,那些資料仍然進過這支函式的記憶體與 log。
     從查詢就不要拿,是比較穩的做法。

     🚨 2026-09-11 改成隨機排序之後,這裡抓的是【全部】而不是一頁。
       理由:亂序沒辦法交給資料庫分頁 —— PostgREST 的 order 只能照
       欄位排,而 `random()` 每次查詢都會重排,兩次查詢之間對不起來。
       所以整份拿回來、在這裡依種子打亂、再切頁。

       眼鏡布是一年一件,完成的量以百計,整份拿回來很便宜;
       而且下面有一份共用快取,實際上每 3 分鐘才真的查一次資料庫
       —— 比原本「每一頁各查一次」還省。 */
  let all = allCache && Date.now() - allCache.at < CACHE_TTL_MS ? allCache.rows : null;
  if (!all) {
    const { data, error } = await db
      .from('cloth_designs')
      .select('id, member_name, preview_url, done_at')
      .eq('status', 'done')
      .not('preview_url', 'is', null)
      .order('done_at', { ascending: false })
      .limit(MAX_WALL);

    if (error) {
      console.error('[cloth-wall] 讀取失敗:', error.message);
      return reply('500', { message: '讀取失敗,請稍後再試' }, 500);
    }
    all = data || [];
    allCache = { at: Date.now(), rows: all };
  }

  const ordered = shuffled(all, seed);
  const page = ordered.slice(offset, offset + limit);

  const payload = JSON.stringify({
    code: '200',
    data: {
      items: page.map(publicItem),
      total: ordered.length,
    },
  });

  return new Response(payload, {
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
});
