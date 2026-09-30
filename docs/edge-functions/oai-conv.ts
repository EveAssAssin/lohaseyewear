/* =============================================================
   Supabase Edge Function: oai-conv
   -------------------------------------------------------------
   OpenAI(ChatGPT 廣告)的轉換 API 代理。
   2026-09-30

   🚨 目前【沒有部署】,也不該在不改前端的情況下部署。
     預約轉換現在走的是像素事件(js/booking-modal.js 的 oaiq('measure', …))。
     兩個同時開,同一次預約會被算兩次。要改用這一支的話,
     先拿掉 booking-modal.js 那一行,再部署這支並接上呼叫。
     留著它的理由:廣告攔截器會擋掉像素,量大之後若發現轉換漏報,
     伺服器端送的這條路不會被擋。

   === 為什麼要有這一支 ===
   轉換 API 要帶 API 金鑰。金鑰放在網頁上的話,任何人打開原始碼就拿得到,
   拿去就能對我們的廣告帳號灌假的轉換 —— 廣告平台會照那些假數字去
   調整投放,錢花在錯的地方,而且看報表完全看不出來。
   所以瀏覽器只送「發生了什麼事」,金鑰只在這裡。

   === 這一支刻意收得很窄 ===
   · 只接受白名單裡的事件類型(目前只有 appointment_scheduled)
   · 時間戳由伺服器產生,不收前端的
   · 不送任何個資(姓名、電話、Email 一律不帶)
   · 每個 IP 每小時有上限

   ⚠ 它【不能】證明那次預約真的發生過 —— 任何人都能直接打這支。
     上面那幾道只是讓灌水變得費力。真正能證明的做法是在預約 API
     (lohas-api-proxy)確認成功之後由伺服器送出,但那支所有預約都
     經過它,為了廣告數字去動它,風險不對等。

   === 部署 ===
   Supabase Dashboard → Edge Functions → 新增 oai-conv → 貼上本檔
   Verify JWT【關閉】(從瀏覽器呼叫,不帶 Supabase JWT)
   ⚠ 部署時把 FALLBACK_OAI_KEY 填上 OpenAI 廣告後台產生的 API 金鑰。
     只在 Dashboard 的編輯器裡填 —— 不要貼進對話、不要提交回 GitHub
     (這個 repo 是公開的)。
   ============================================================= */

/* ⚠ 只在 Dashboard 填,不要提交回 GitHub。 */
const FALLBACK_OAI_KEY = '';

const OAI_KEY = Deno.env.get('OAI_CONV_KEY') || FALLBACK_OAI_KEY;
const PIXEL_ID = 'NjscxQ8XG8RS61Uqj5n6JA';
const ENDPOINT = 'https://bzr.openai.com/v1/events?pid=' + PIXEL_ID;

const CODE_VERSION = '2026-09-30 · appointment_scheduled';

/* 只收這些事件類型。要加新的轉換(例如註冊、眼鏡布存檔)就加在這裡,
   前端送白名單以外的一律拒絕 —— 否則這支會變成「幫任何人送任意事件」。 */
const ALLOWED_TYPES = new Set(['appointment_scheduled']);

/* 只接受我們網站發出的請求。擋不住 curl,但擋得住別的網站的瀏覽器。 */
const ALLOWED_ORIGINS = new Set([
  'https://www.lohasglasses.com',
  'https://lohasglasses.com',
]);

function cors(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://www.lohasglasses.com',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Vary': 'Origin',
  };
}

function reply(origin: string | null, code: string, body: Record<string, unknown> = {}, http = 200) {
  return new Response(JSON.stringify({ code, ...body }), {
    status: http,
    headers: { ...cors(origin), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/* 每個 IP 每小時 10 次。一個真的客人一小時預約不會超過兩三次。
   記憶體計數,多個執行個體下不是嚴格上限 —— 目的是讓灌水費力,不是擋死。 */
const HITS = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (HITS.get(ip) || []).filter((t) => now - t < 3600 * 1000);
  arr.push(now);
  HITS.set(ip, arr);
  if (HITS.size > 5000) HITS.clear();
  return arr.length > 10;
}

/* 只接受我們自己網站的網址當 source_url。
   前端送什麼就轉什麼的話,報表上會出現別人網站的網址。 */
function safeSourceUrl(v: unknown): string {
  try {
    const u = new URL(String(v || ''));
    if (u.protocol === 'https:' && (u.hostname === 'www.lohasglasses.com' || u.hostname === 'lohasglasses.com')) {
      // 查詢字串拿掉:裡面可能有 token 或會員資訊
      return u.origin + u.pathname;
    }
  } catch { /* 解析不了就用首頁 */ }
  return 'https://www.lohasglasses.com/';
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });

  /* 自檢:只回版本與「金鑰有沒有填」,不回金鑰本身。 */
  if (req.method === 'GET') {
    return reply(origin, '200', { data: {
      code_version: CODE_VERSION,
      key_set: !!OAI_KEY,
      allowed_types: [...ALLOWED_TYPES],
    } });
  }
  if (req.method !== 'POST') return reply(origin, '405', { message: '只接受 POST' }, 405);

  if (!OAI_KEY) {
    console.error('[oai-conv] 沒有金鑰:請在 Dashboard 填 FALLBACK_OAI_KEY');
    return reply(origin, '500', { message: '設定不完整' }, 500);
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return reply(origin, '429', { message: '太頻繁' }, 429);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return reply(origin, '006', { message: '格式錯誤' }, 400); }

  const type = String(body.type || '');
  if (!ALLOWED_TYPES.has(type)) return reply(origin, '006', { message: '不支援的事件' }, 400);

  /* 事件編號:同一件事只算一次(預約就用預約單編號)。
     ⚠ 限制字元與長度 —— 它會原樣送到 OpenAI,也會進我們的 log。 */
  const eventId = String(body.event_id || '').trim();
  if (!/^[A-Za-z0-9_\-=+/.]{4,128}$/.test(eventId)) {
    return reply(origin, '006', { message: '缺少事件編號' }, 400);
  }

  /* validate_only:只驗證格式,不算進報表。第一次接好時用它確認金鑰對不對。 */
  const validateOnly = body.validate_only === true;

  const payload = {
    validate_only: validateOnly,
    events: [{
      id: eventId,
      type,
      timestamp_ms: Date.now(),          // 伺服器時間,不收前端的
      source_url: safeSourceUrl(body.source_url),
      action_source: 'web',
      data: { type: 'customer_action' },
    }],
  };

  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + OAI_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    /* 記下結果,不記金鑰。OpenAI 回的錯誤訊息是排查唯一的線索。 */
    console.log('[oai-conv] ' + type + ' id=' + eventId.slice(0, 16) +
                (validateOnly ? ' (validate_only)' : '') +
                ' → http ' + r.status + ' ' + text.slice(0, 300));
    if (!r.ok) return reply(origin, '502', { message: '轉換 API 回應錯誤', upstream_status: r.status }, 502);
    return reply(origin, '200', { data: { validate_only: validateOnly } });
  } catch (e) {
    console.error('[oai-conv] 連線失敗:', e instanceof Error ? e.message : e);
    return reply(origin, '502', { message: '連不上轉換 API' }, 502);
  }
});
