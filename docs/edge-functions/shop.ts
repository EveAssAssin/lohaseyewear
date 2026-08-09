/* =============================================================
   Supabase Edge Function: shop
   -------------------------------------------------------------
   商城商品 API 的代理。

   為什麼要代理:
     商城 API 需要 Header X-Site-Key,那把金鑰等同帳號接管權限。
     本站是公開的 GitHub Pages,前端放什麼別人就看得到什麼,
     金鑰只能留在這裡。前端只跟本函式對話。

   商品目錄本身是公開資訊(商城前台看得到),所以本函式
   【不需要登入】即可查詢,但仍限制可呼叫的路徑並做簡易頻率控制,
   避免變成任何人都能用的免費商城 API 中繼站。

   部署:Supabase Dashboard → Edge Functions → 新增 shop → 貼上本檔
        Verify JWT 要【關閉】

   環境變數(Dashboard → Edge Functions → Secrets):
     SHOP_BASE_URL   商城 Base URL,例:https://lohas-shop-test.onrender.com
     SITE_API_KEY    與票券共用的那把金鑰

   action 一覽:
     categories  分類樹
     products    商品列表(tid / limit / offset / can_design_only)
     product     商品詳情(nid),含規格樹
   ============================================================= */

const SHOP_BASE = (Deno.env.get('SHOP_BASE_URL') || 'https://lohas-shop-test.onrender.com')
  .replace(/\/+$/, '');
const SITE_KEY  = Deno.env.get('SITE_API_KEY') || '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/* 白名單:只允許這三支。
   不做白名單的話,這支就成了「任何人都能打商城任意路徑」的開放中繼站。 */
const ROUTES: Record<string, string> = {
  categories: '/api/site/categories',
  products:   '/api/site/products',
  product:    '/api/site/product',
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply('405', { message: '只接受 POST' }, 405);

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return reply('429', { message: '操作太頻繁,請稍候再試' }, 429);

  if (!SITE_KEY) return reply('500', { message: '尚未設定 SITE_API_KEY' }, 500);

  let body: Record<string, any>;
  try { body = await req.json(); }
  catch { return reply('006', { message: '請求格式錯誤' }, 400); }

  const path = ROUTES[String(body.action || '')];
  if (!path) return reply('006', { message: '不支援的 action' }, 400);

  // 只轉送白名單內的參數,前端傳什麼就照單全收會把金鑰的權限放大
  const out: Record<string, unknown> = {};
  if (body.nid !== undefined) out.nid = Number(body.nid);
  if (body.tid !== undefined) out.tid = String(body.tid).slice(0, 200);
  if (body.limit !== undefined) out.limit = Math.min(Number(body.limit) || 200, 500);
  if (body.offset !== undefined) out.offset = Math.max(Number(body.offset) || 0, 0);
  if (body.can_design_only) out.can_design_only = 1;

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
