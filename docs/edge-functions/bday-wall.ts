/* =============================================================
   Supabase Edge Function: bday-wall
   -------------------------------------------------------------
   壽星分享牆的資料來源代理(生日禮主頁下方那一區)。

   === 這些照片是什麼 ===
   不是客人上傳的。是樂活員工在後台上傳的生日相簿,每人每年 3 張,
   我方只取大圖那一張。客人在 App 按的「分享」是分享到 Facebook,
   圖在 FB,主後端沒有那些圖。

   牆上只會出現【按過分享並同意展示於官網】的那些 ——
   同意綁在客人按下「分享到 FB」的當下,舊資料不追溯。
   所以初期會是空的,之後逐筆累積。

   === 為什麼要有這一層 ===
   主後端要 X-Site-Key,那把金鑰不能放在公開的 GitHub Pages 前端。

   部署:Supabase Dashboard → Edge Functions → 新增 bday-wall → 貼上本檔
        Verify JWT 要【關閉】(這一區不需要登入,任何人都看得到)

   ⚠ 金鑰用 SITE_API_KEY(主後端那把),不是 SHOP_SITE_API_KEY。
     這一支在主後端 lohas.realtime.tw,與 coupon-list、member-auth 同一把。
     拿錯會回 403,而 403 看不出是金鑰錯還是網址錯。
   ============================================================= */

const SITE_KEY = Deno.env.get('SITE_API_KEY') || '';

const TICKET_BASE = (Deno.env.get('TICKET_BASE_URL') || 'https://lohas.realtime.tw')
  .replace(/\/+$/, '');

const UPSTREAM_TIMEOUT_MS = 10000;

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

/* ---------- 快取 ----------
   這一區的內容以月為單位變動,沒有任何即時性需求。
   不快取的話,生日主頁每一次載入都會打一次主後端 —— 那是白花的。

   記憶體快取,Edge Function 重啟就沒了,這樣剛好:
   不需要處理失效,最久也就 TTL 那麼久。 */
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; body: string; http: number }>();

function cacheGet(key: string) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(key); return null; }
  return hit;
}

/* ---------- 對外欄位白名單 ----------
   對方明確表示不會回傳個資,而且 nickname 是在他們那端就處理成
   「姓＋先生/小姐」才送出的。即便如此,這裡仍然逐欄挑出來重建。

   理由:這是【公開頁面】的資料,不需要登入就看得到。
   哪天對方為了別的用途在同一支介面多加一個欄位,
   原樣轉發就會把它送進所有人的瀏覽器。白名單讓那種事不會發生,
   代價只是日後要多一個欄位時得改這裡一行。 */
function publicItem(it: Record<string, any>) {
  return {
    id: it.id,
    image_url: String(it.image_url || ''),
    nickname: String(it.nickname || ''),
    created_at: it.created_at || null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply('405', { message: '只接受 POST' }, 405);

  if (!SITE_KEY) {
    console.error('[bday-wall] 缺少金鑰:請設 SITE_API_KEY');
    return reply('500', { message: '系統設定不完整' }, 500);
  }

  let body: Record<string, any>;
  try { body = await req.json(); }
  catch { return reply('006', { message: '請求格式錯誤' }, 400); }

  // 對方上限 60。前端要更多也不放行 —— 一次拉太多對誰都沒好處
  const limit = Math.min(Math.max(Number(body.limit) || 20, 1), 60);
  const offset = Math.max(Number(body.offset) || 0, 0);

  const key = limit + ':' + offset;
  const hit = cacheGet(key);
  if (hit) {
    return new Response(hit.body, {
      status: hit.http,
      headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8',
                 'X-Lohas-Cache': 'hit' },
    });
  }

  try {
    const r = await fetch(`${TICKET_BASE}/siteapi/bday/wall`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Site-Key': SITE_KEY,
      },
      body: JSON.stringify({ limit, offset }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    const j = await r.json();

    if (String(j?.code) !== '200') {
      console.warn('[bday-wall] 上游回應 ' + (j?.code ?? r.status));
      // 原樣轉回代碼,但不轉內容 —— 上游的錯誤訊息可能含內部資訊
      return reply(String(j?.code ?? r.status),
        { message: '分享牆暫時無法載入' }, r.status === 200 ? 200 : r.status);
    }

    const d = j.data || {};
    const items = (d.items || []).map(publicItem)
      // 沒有圖的那筆對這一區沒有意義,先濾掉,不要讓前端出現破圖
      .filter((it: Record<string, any>) => !!it.image_url);

    const out = JSON.stringify({
      code: '200',
      data: {
        items: items,
        total: Number(d.total) || 0,
        limit: limit,
        offset: offset,
      },
    });

    cache.set(key, { at: Date.now(), body: out, http: 200 });

    // 快取塞太多就整個清掉。這一區的鍵很少(limit×offset 組合有限),
    // 真的長到這個數字代表有人在亂打,清掉比逐筆淘汰簡單
    if (cache.size > 200) cache.clear();

    return new Response(out, {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8',
                 'X-Lohas-Cache': 'miss' },
    });

  } catch (e) {
    console.error('[bday-wall] 上游連線失敗:', e instanceof Error ? e.message : e);
    return reply('502', { message: '分享牆暫時無法載入' }, 502);
  }
});
