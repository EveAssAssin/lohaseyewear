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

   === status(2026-08-25 新增)===
   done(預設) / pending / all

   done    已完成,走增量,以 done_at 為游標 → items / next_since
   pending 製作中,回【當下的完整快照】,不受 since 影響 → pending
   archived 一律不回:那是後台手動歸檔的,不該再出現在客人的 App 上。

   ⚠ 兩者不共用游標,而且刻意如此。
     增量只能說「有東西進來」,不能說「有東西離開」——
     一筆做完之後就不再是 pending,若 pending 也走增量,
     對方的「製作中」清單只會越積越多,永遠沒有人被移出去。
     所以 pending 每次回全部,對方【整份取代】自己那一份。

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

/* === 輪替用的舊金鑰槽 ===
   ---------------------------------------------------------------
   輪替時【不要】直接覆蓋上面那一把 —— 那會製造一段
   「我方已經換、對方還沒換」的空窗,期間對方每天的抓取都回 403,
   而 403 看起來像介面壞了,不像「金鑰換了」。

   正確做法分兩次部署:
     第一次  上面填【新】的、這裡填【舊】的 → 兩把都收,沒有空窗
     第二次  對方確認換好之後,把這裡清成空字串

   ⚠ 空字串會被 sameSecret 擋掉(它先檢查 !a || !b),
     所以不輪替時留空不會變成後門。 */
const FALLBACK_APP_KEY_OLD = '';

/* 線上實際跑的是哪一版。
   -----------------------------------------------------------------
   2026-08-28 踩過:程式改好、進了版控,信上寫「已上線」,
   但那支函式從頭到尾沒有部署過,而對方照著那句話把接收端做完了。
   從外面看不出線上是哪一版,是那次事故的根本原因。

   每次改這支【一併更新這個字串】,對方就能自己確認,不必問也不必等回信。
   (shop 函式的 code_version 是同一個做法。) */
const CODE_VERSION = '2026-09-03 · product 標記';

const APP_KEY = Deno.env.get('CLOTH_FEED_KEY') || FALLBACK_APP_KEY;
const APP_KEY_OLD = Deno.env.get('CLOTH_FEED_KEY_OLD') || FALLBACK_APP_KEY_OLD;

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

  /* 新舊都比。兩個都要跑完再判斷 ——
     用 || 短路的話,新的對上就不比舊的,回應時間會出現差異。
     這支不是高風險端點,但比對金鑰時養成一致的習慣比較省事。 */
  const okNew = sameSecret(given, APP_KEY);
  const okOld = sameSecret(given, APP_KEY_OLD);
  if (!okNew && !okOld) {
    console.warn('[cloth-feed] 金鑰不符');
    return reply('403', { message: 'forbidden' }, 403);
  }
  /* 對方還在用舊的就留一行紀錄。這是「第二次部署可以做了嗎」
     唯一看得到的訊號 —— 沒有它只能用猜的。 */
  if (okOld && !okNew) {
    console.warn('[cloth-feed] ⚠ 呼叫方仍在使用【舊】金鑰,尚不可清掉舊槽');
  }

  /* 不帶 since 時只回最近 7 天。
     第一次接上就整包回全部歷史的話,對方會對所有舊客人各推一次。 */
  const since = parseSince(body.since ?? url.searchParams.get('since')) ||
    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const limit = Math.min(
    Math.max(Number(body.limit ?? url.searchParams.get('limit')) || 200, 1), 500);

  /* status:要哪一種。done(預設)/ pending / all
     -----------------------------------------------------------
     2026-08-25 黃總來文 3-1:App 需要顯示「製作中」的卡片,
     否則客人已經做完設計、正在等雕刻的那段期間,App 上看起來像
     沒做過,他可能會再做一條。

     ⚠ pending 與 done 【不共用同一個游標】,而且是刻意的:
       done 走增量(以 done_at 為游標),pending 回的是【當下的完整快照】。

       理由:增量只能告訴你「有東西進來」,不能告訴你「有東西離開」。
       一筆紀錄做完之後就不再是 pending —— 若 pending 也走增量,
       對方的「製作中」清單只會越積越多,永遠不會有人被移出去。
       所以 pending 每次都回全部,對方直接【整份取代】自己那一份。

     archived 不回:那是後台手動歸檔的,不該再出現在客人的 App 上。 */
  const statusWant = String(body.status ?? url.searchParams.get('status') ?? 'done')
    .toLowerCase();
  const wantDone    = statusWant === 'done' || statusWant === 'all';
  const wantPending = statusWant === 'pending' || statusWant === 'all';

  if (!wantDone && !wantPending) {
    return reply('006', { message: 'status 只接受 done / pending / all' }, 400);
  }

  /* 取貨門市。2026-08-27 新增,對方(App)要求。
     -----------------------------------------------------------
     用途是通知文案:「你的眼鏡布做好了,可到○○店領取」——
     少了店名,那句話只能寫成「可到門市領取」,而客人會回問
     「哪一家」,那通推播就等於沒發。

     ⚠ 舊資料兩欄都是 null(這個功能上線前存的),而且客人
     【可以不選】—— 所以對方一定要能處理 null,不能假設有值。
     null 的意思是「還沒指定」,不是「資料壞了」。 */
  /* 門市欄位 ＋ 用途標記。
     -----------------------------------------------------------------
     ⚠ product / product_name 是 2026-09-03 加的,不是裝飾。

     在此之前這支回的每一筆都只有「店名 + 圖名 + source」,
     而 source 是 'market' / 'draw' —— 那是【圖從哪裡來】,
     不是【客人要來拿什麼】。門市端收到一筆取件通知,
     看不出要拿的是眼鏡布還是別的東西。

     現在多兩個欄位:
       product       機器讀的類別,固定 'cloth'
       product_name  直接可以放進推播文案的中文

     兩個都給,是因為對方若只拿 product 去做判斷,
     哪天多一種產品時文案要改兩處;給了中文就只改我方這一處。

     新增欄位對舊的接收端無害(多的欄位會被忽略),
     但仍要告知對方 —— 他們可能想把它放進推播。 */
  const storeOf = (r: Record<string, unknown>) => ({
    store_erpid: r.store_erpid ?? null,
    store_name: r.store_name ?? null,
    product: 'cloth',
    product_name: '客製眼鏡布',
  });

  let data: any[] = [];
  if (wantDone) {
    const r = await db.from('cloth_designs')
      .select('id, erpid, mid, source, design_name, preview_url, done_at, store_erpid, store_name')
      .eq('status', 'done')
      .gt('done_at', since.toISOString())
      .order('done_at', { ascending: true })    // 由舊到新,對方好記「抓到哪」
      .limit(limit);
    if (r.error) {
      console.error('[cloth-feed] 查詢失敗:', r.error.message);
      return reply('500', { message: '系統忙碌,請稍後再試' }, 500);
    }
    data = r.data || [];
  }

  /* 製作中的完整清單。不受 since 影響 —— 見上面那段。
     筆數上限刻意比 done 寬:那是「目前還沒做完的」,
     總量本來就有限,被截斷的話對方會少顯示幾張卡片而不自知。 */
  let pending: Array<Record<string, unknown>> = [];
  if (wantPending) {
    const r = await db.from('cloth_designs')
      .select('id, erpid, mid, source, design_name, preview_url, created_at, store_erpid, store_name')
      .eq('status', 'new')
      .order('created_at', { ascending: false })
      .limit(1000);
    if (r.error) {
      console.error('[cloth-feed] 製作中查詢失敗:', r.error.message);
      return reply('500', { message: '系統忙碌,請稍後再試' }, 500);
    }
    pending = (r.data || []).map((x) => ({
      id: x.id,
      client_id: x.erpid || null,
      mid: x.mid || null,
      design_name: x.design_name,
      source: x.source,
      preview_url: x.preview_url,
      created_at: x.created_at,
      ...storeOf(x),
    }));
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
    ...storeOf(r),
  }));

  /* next_since 直接給出來,對方不必自己從清單裡挑最後一筆的時間。
       沒有資料時原樣回傳這次的 since,對方下次照樣帶回來即可。 */
  const nextSince = items.length ? items[items.length - 1].done_at : since.toISOString();

  /* 記一次心跳。
     -----------------------------------------------------------
     用途是偵測【對方的排程有沒有停掉】—— 那 29 支排程共用同一個
     Jenkins 觸發器(對方 2026-08-27 說明),停掉的話全部一起安靜地死,
     而三邊各自看都正常。

     ⚠ 寫失敗不能影響回應:對方要的是資料,不是我方的監控。
     整段包住,錯了只記 log。 */
  db.from('cloth_feed_heartbeat')
    .update({
      last_fetch_at: new Date().toISOString(),
      last_status: statusWant,
      last_count: items.length + pending.length,
    })
    .eq('id', 1)
    .then((r) => {
      if (r.error) console.error('[cloth-feed] 心跳寫入失敗:', r.error.message);
    });

  console.log('[cloth-feed] status=' + statusWant +
              ' since=' + since.toISOString() +
              ' → 完成 ' + items.length + ' 筆,製作中 ' + pending.length + ' 筆');

  const out: Record<string, unknown> = {
    code_version: CODE_VERSION,
    items,
    count: items.length,
    since: since.toISOString(),
    next_since: nextSince,
    /* 回傳筆數等於上限,代表可能還有沒抓完的。
       對方看到 true 就帶 next_since 再抓一次,不必等明天。 */
    has_more: items.length >= limit,
  };

  /* 只有問了才給。沒問卻給的話,對方會以為那是增量的一部分而累加,
     而它是快照 —— 兩種語意混在同一個回應裡遲早會被誤用。 */
  if (wantPending) {
    out.pending = pending;
    out.pending_count = pending.length;
    /* 明講語意,寫在回應裡而不是只寫在文件裡 ——
       接手的人多半是看回應長什麼樣就開始寫,不會回頭翻信。 */
    out.pending_is_snapshot = true;
  }

  return reply('200', { data: out });
});
