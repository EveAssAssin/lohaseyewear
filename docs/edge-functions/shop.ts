/* =============================================================
   Supabase Edge Function: shop
   -------------------------------------------------------------
   商城 API 的後端代理。金鑰留在這裡,不落到瀏覽器。

   部署:Supabase Dashboard → Edge Functions → shop
        Verify JWT 關閉(官網前端不帶 Supabase JWT)

   金鑰兩種來源,擇一:
     A. Secrets 設 SITE_API_KEY(有權限時的正解)
     B. 沒有 Secrets 權限時,把金鑰直接填在下面的 FALLBACK_SITE_KEY
        絕對不要把填好金鑰的版本回寫到 repo。

   Base URL 已有預設值(測試環境),不需要設定。
   正式環境上線時,設 SHOP_BASE_URL 或直接改下面那行。

   action 一覽:
     categories  分類樹
     products    商品列表(tid / limit / offset / can_design_only)
     product     商品詳情(nid),含規格樹
     cart_push   把客製完成品送回商城購物車,回傳 cart_url
                 ⚠ 這支需要 session token,規則見下方註解
   ============================================================= */

// ⚠ 只在 Dashboard 填,不要提交回 GitHub
const FALLBACK_SITE_KEY = '';

const SHOP_BASE = (Deno.env.get('SHOP_BASE_URL') || 'https://lohas-shop-test.onrender.com')
  .replace(/\/+$/, '');
const SITE_KEY  = Deno.env.get('SITE_API_KEY') || FALLBACK_SITE_KEY;

const AUTH_FN = 'https://hqdmyxxrskvllkcedybl.supabase.co/functions/v1/auth-session';

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
function buildCartBody(clientId: string, body: Record<string, any>) {
  const m = body.main || {};
  const d = m.design || {};
  const p = d.placement || {};

  const design: Record<string, unknown> = {
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply('405', { message: '只接受 POST' }, 405);

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return reply('429', { message: '操作太頻繁,請稍候再試' }, 429);

  if (!SITE_KEY) {
    console.error('[shop] 缺少金鑰:請設 SITE_API_KEY 或填 FALLBACK_SITE_KEY');
    return reply('500', { message: '系統設定不完整,請聯繫技術窗口' }, 500);
  }

  let body: Record<string, any>;
  try { body = await req.json(); }
  catch { return reply('006', { message: '請求格式錯誤' }, 400); }

  const action = String(body.action || '');
  const path = ROUTES[action];
  if (!path) return reply('006', { message: '不支援的 action' }, 400);

  let out: Record<string, unknown>;

  if (action === 'cart_push') {
    const erpid = await erpidFromToken(String(body.token || ''));
    if (!erpid) return reply('401', { message: '登入狀態已失效,請重新登入' }, 401);

    if (!Number(body?.main?.nid)) return reply('006', { message: '缺少商品編號' }, 400);

    out = buildCartBody(erpid, body);
    console.log('[shop] cart_push erpid=' + erpid + ' nid=' + (out as any).main.nid);
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

    return new Response(JSON.stringify(j), {
      status: r.status,
      headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (e) {
    return reply('500', { message: '無法連線到商城,請稍後再試' }, 502);
  }
});
