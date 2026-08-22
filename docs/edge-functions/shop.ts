/* =============================================================
   Supabase Edge Function: shop
   -------------------------------------------------------------
   商城 API 的後端代理。金鑰留在這裡,不落到瀏覽器。

   部署:Supabase Dashboard → Edge Functions → shop
        Verify JWT 關閉(官網前端不帶 Supabase JWT)

   金鑰兩種來源,擇一:
     A. Secrets 設 SHOP_SITE_API_KEY(有權限時的正解)
     B. 沒有 Secrets 權限時,把金鑰直接填在下面的 FALLBACK_SITE_KEY
        絕對不要把填好金鑰的版本回寫到 repo。

   ⚠ 這支讀的是 SHOP_SITE_API_KEY,【不是】SITE_API_KEY,也刻意不做備援。

     2026-08-22 對方查證後更正:兩台正式站的金鑰【目前是同一個值】,
     先前說「不同值、不能互推」是依據一份沒跟著更新的內部紀錄。

     即便值相同,兩個變數名稱仍然【維持分開】——
     它們相同純屬現況,任一站輪替金鑰時就會再度分開。
     合併成一個的話,那一天會有兩支函式同時壞掉而查不出原因。

     也刻意不寫 `SHOP_SITE_API_KEY || SITE_API_KEY`:變數哪天沒設,
     備援會讓它安靜地拿另一把去打錯的站,而不是明確地壞掉。

   Base URL:2026-08-22 起指向【商城正式站】。
   對方已於我方 Supabase 設定 SHOP_BASE_URL,下面那行只是沒設定時的退路。
   要切回測試站的話設 SHOP_BASE_URL,不必改程式。

   action 一覽:
     categories  分類樹
     products    商品列表(tid / limit / offset / can_design_only)
     product     商品詳情(nid),含規格樹
     cart_push   把客製完成品送回商城購物車,回傳 cart_url
                 ⚠ 這支需要 session token,規則見下方註解
                 ⚠ 這支會在 design_submissions 留一筆紀錄(成功與失敗都留)
   ============================================================= */

// ⚠ 只在 Dashboard 填,不要提交回 GitHub
const FALLBACK_SITE_KEY = '';

const SHOP_BASE = (Deno.env.get('SHOP_BASE_URL') || 'https://www.lohaseyewear.com')
  .replace(/\/+$/, '');
const SITE_KEY  = Deno.env.get('SHOP_SITE_API_KEY') || FALLBACK_SITE_KEY;

const AUTH_FN = 'https://hqdmyxxrskvllkcedybl.supabase.co/functions/v1/auth-session';

/* 送單紀錄用。這兩個是 Supabase 自動注入 Edge Function 的環境變數,
   不需要在 Secrets 裡設定,也不需要填 FALLBACK。 */
const SB_URL = Deno.env.get('SUPABASE_URL') || '';
const SB_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

/* 送進 cart/push 的圖片網址只允許這個 host。
   ---------------------------------------------------------------
   那些網址會顯示在【商城後台的訂單頁】,供人員點開下載雕刻檔與加工圖。
   如果放任前端指定任意網址,等於提供一條「讓樂活自己人從後台點進
   外部連結」的路徑 —— 釣魚頁、惡意下載都能這樣送進去。
   我們自己產的圖一律在 Supabase Storage,鎖死這個 host 沒有副作用。 */
const ASSET_HOST = 'hqdmyxxrskvllkcedybl.supabase.co';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/* 白名單:只允許這幾支。
   不做白名單的話,這支就成了「任何人都能打商城任意路徑」的開放中繼站。 */
const ROUTES: Record<string, string> = {
  categories: '/api/site/categories',
  products:   '/api/site/products',
  product:    '/api/site/product',
  cart_push:  '/api/site/cart/push',
};

/* 每 IP 每分鐘 60 次。商城本身也有 120/分 的限制,
   這裡先擋一層,避免我們把對方的額度用光。 */
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const win = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  win.push(now);
  hits.set(ip, win);
  if (hits.size > 5000) hits.clear();      // 粗暴但有效的記憶體上限
  return win.length > 60;
}

function reply(code: string, body: Record<string, unknown> = {}, http = 200) {
  return new Response(JSON.stringify({ code, ...body }), {
    status: http,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/* 用 session token 換回會員編號。
   ---------------------------------------------------------------
   商城的串接規格寫得很清楚:
     「client_id 必須由官網後端從自己的登入 session 取得,
       絕不可接受前端傳入的值」
   理由是商城無從驗證那個 ID 是否真的屬於當下登入者 —— 若接受前端指定,
   任何人都能把商品推進別人的購物車、用掉別人的票券。
   所以 client_id 只有這一個來源,前端送什麼都不看。 */
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

/** 只放行我方 Storage 上的網址,其餘一律丟掉(理由見 ASSET_HOST) */
function safeAssetUrl(v: unknown): string | null {
  const s = String(v || '');
  if (!s) return null;
  try {
    const u = new URL(s);
    return (u.protocol === 'https:' && u.hostname === ASSET_HOST) ? s : null;
  } catch {
    return null;
  }
}

function clamp01(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

/* 組出要送給商城的 cart/push body。
   前端送來的東西一律當成不可信,逐欄挑出來重建 ——
   直接把 body 轉發等於把金鑰的權限開放給任何呼叫者。 */
function buildCartBody(clientId: string, body: Record<string, any>, submissionId: string) {
  const m = body.main || {};
  const d = m.design || {};
  const p = d.placement || {};

  const design: Record<string, unknown> = {
    /* 這一次送出的唯一識別碼。
       ---------------------------------------------------------
       design_id 是【刻圖作品】的編號,同一張刻圖可以被送出很多次,
       所以它無法回答「訂單對應到哪一筆送單」。submission_id 才可以。

       它由我方在此產生,並且【就是 design_submissions 那一列的主鍵】——
       商城原樣保存、付款完成時原樣回拋,我方拿到就能直接對上,
       不必再靠「最近一筆未成交的」這種機率性比對。

       商城 2026-08-17 來文確認採此做法(做法 A),並說明會與 placement
       同樣處理:原樣保存、不解析、只做長度上限 100。 */
    submission_id: submissionId,

    design_id:   String(d.design_id || '').slice(0, 100),
    design_name: String(d.design_name || '').slice(0, 200),
    placement: {
      lens:  p.lens === 'left' ? 'left' : 'right',
      scale: clamp01(p.scale),
      x:     clamp01(p.x),
      y:     clamp01(p.y),
      basis: 'product_image',
    },
  };
  // 三個網址各自檢查,缺哪個就不帶哪個(商城端對缺欄位的處理比對錯誤網址安全)
  const eng   = safeAssetUrl(d.engraving_url);
  const prev  = safeAssetUrl(d.preview_url);
  const guide = safeAssetUrl(d.guide_url);
  if (eng)   design.engraving_url = eng;
  if (prev)  design.preview_url   = prev;
  if (guide) design.guide_url     = guide;

  const main: Record<string, unknown> = {
    nid: Number(m.nid),
    amount: 1,          // 一次一件,不開放前端指定數量
    design,
  };
  /* sid 只在「真的有規格」時才帶。商城端說明:無規格商品帶了 sid 會被擋,
     省略 / null / 0 都會被當成 0 通過。所以寧可不帶。 */
  const sid = Number(m.sid);
  if (Number.isFinite(sid) && sid > 0) main.sid = sid;

  const out: Record<string, unknown> = {
    client_id: clientId,
    main,
    // 刻圖費由商城依自己的設定計算,我方只表明「有含刻圖」。
    // 規格明訂不得帶入任何金額欄位,帶了也會被忽略。
    plus_buy: [{ type: 'engraving_fee', amount: 1 }],
  };

  // 票券:有帶才附上。lock_token 由商城在建立訂單時拿去 redeem。
  const c = body.coupon || {};
  const couponId = Number(c.coupon_id);
  const lockToken = String(c.lock_token || '').slice(0, 128);
  if (Number.isFinite(couponId) && couponId > 0 && lockToken) {
    out.coupon = { coupon_id: couponId, lock_token: lockToken };
  }

  return out;
}

/* 送單紀錄。
   ---------------------------------------------------------------
   成功與失敗都寫,失敗的那些才是排查用得上的 ——
   在此之前送單失敗只能請客人開瀏覽器 console,實務上做不到。

   紀錄取自 buildCartBody 的產出(已消毒過的版本),不是前端原始 body。

   ⚠ 這一步失敗絕對不能影響客人:寫紀錄是我方的內部需求,
     不是客人的交易的一部分。整段包在 try/catch 裡,錯了只留 log。

   刻意不存的東西:session token、coupon.lock_token —— 兩者都是憑證。 */
async function logSubmission(row: Record<string, unknown>) {
  if (!SB_URL || !SB_SERVICE_KEY) {
    console.warn('[shop] 缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY,略過送單紀錄');
    return;
  }
  try {
    const r = await fetch(SB_URL + '/rest/v1/design_submissions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SB_SERVICE_KEY,
        'Authorization': 'Bearer ' + SB_SERVICE_KEY,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) {
      console.error('[shop] 送單紀錄寫入失敗 ' + r.status + ' ' + (await r.text()).slice(0, 200));
    }
  } catch (e) {
    console.error('[shop] 送單紀錄例外:', e instanceof Error ? e.message : e);
  }
}

/** 把 buildCartBody 的產出 + 商城回應,攤平成一筆資料列 */
function submissionRow(
  erpid: string,
  out: Record<string, any>,
  shop: { code: string; message: string; cartUrl: string },
): Record<string, unknown> {
  const main = out.main || {};
  const design = main.design || {};
  return {
    /* 主鍵用我方送給商城的那一組,不讓資料庫自己產 ——
       兩邊必須是同一個值,商城回拋時才對得上。 */
    id: design.submission_id,
    erpid,
    nid: main.nid ?? null,
    sid: main.sid ?? null,
    design_id:     design.design_id || null,
    design_name:   design.design_name || null,
    engraving_url: design.engraving_url || null,
    preview_url:   design.preview_url || null,
    guide_url:     design.guide_url || null,
    placement:     design.placement || null,
    coupon_id:     out.coupon?.coupon_id ?? null,
    succeeded:     shop.code === '200' && !!shop.cartUrl,
    shop_code:     shop.code || null,
    shop_message:  shop.message ? String(shop.message).slice(0, 500) : null,
    cart_url:      shop.cartUrl || null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply('405', { message: '只接受 POST' }, 405);

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return reply('429', { message: '操作太頻繁,請稍候再試' }, 429);

  if (!SITE_KEY) {
    console.error('[shop] 缺少金鑰:請設 SHOP_SITE_API_KEY 或填 FALLBACK_SITE_KEY');
    return reply('500', { message: '系統設定不完整,請聯繫技術窗口' }, 500);
  }

  let body: Record<string, any>;
  try { body = await req.json(); }
  catch { return reply('006', { message: '請求格式錯誤' }, 400); }

  const action = String(body.action || '');
  const path = ROUTES[action];
  if (!path) return reply('006', { message: '不支援的 action' }, 400);

  let out: Record<string, unknown>;
  let erpid = '';

  if (action === 'cart_push') {
    erpid = await erpidFromToken(String(body.token || ''));
    if (!erpid) return reply('401', { message: '登入狀態已失效,請重新登入' }, 401);

    if (!Number(body?.main?.nid)) return reply('006', { message: '缺少商品編號' }, 400);

    /* 送出前先決定這一筆的識別碼,而不是等寫紀錄時才由資料庫產生 ——
       商城要收到的和我方要存的必須是同一個值。 */
    out = buildCartBody(erpid, body, crypto.randomUUID());
    console.log('[shop] cart_push erpid=' + erpid + ' nid=' + (out as any).main.nid +
                ' submission=' + (out as any).main.design.submission_id);
  } else {
    // 讀取型的三支:只轉送白名單內的參數,
    // 前端傳什麼就照單全收會把金鑰的權限放大
    out = {};
    if (body.nid !== undefined) out.nid = Number(body.nid);
    if (body.tid !== undefined) out.tid = String(body.tid).slice(0, 200);
    if (body.limit !== undefined) out.limit = Math.min(Number(body.limit) || 200, 500);
    if (body.offset !== undefined) out.offset = Math.max(Number(body.offset) || 0, 0);
    if (body.can_design_only) out.can_design_only = 1;
  }

  try {
    const r = await fetch(SHOP_BASE + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Site-Key': SITE_KEY,
      },
      body: JSON.stringify(out),
    });
    const j = await r.json();

    // 原樣轉回,但保險起見濾掉任何可能回音金鑰的欄位
    if (j && typeof j === 'object' && 'debug' in j) delete (j as any).debug;

    if (action === 'cart_push') {
      await logSubmission(submissionRow(erpid, out, {
        code:    String(j?.code ?? r.status),
        message: String(j?.message ?? ''),
        cartUrl: String(j?.data?.cart_url ?? ''),
      }));
    }

    return new Response(JSON.stringify(j), {
      status: r.status,
      headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (e) {
    // 連不上商城 / 對方回的不是 JSON。這種也要留紀錄,
    // 否則「客人說送不出去」在我方查不到任何東西。
    if (action === 'cart_push') {
      await logSubmission(submissionRow(erpid, out, {
        code:    'FETCH_FAILED',
        message: e instanceof Error ? e.message : String(e),
        cartUrl: '',
      }));
    }
    return reply('500', { message: '無法連線到商城,請稍後再試' }, 502);
  }
});
