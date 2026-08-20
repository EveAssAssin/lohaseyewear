/* =============================================================
   Supabase Edge Function: coupon-lock
   -------------------------------------------------------------
   票券的鎖定 / 續鎖 / 解鎖代理。App 票券頁點「使用」進到官網
   客製文創時,這條動線靠它。

   三個動作放同一支,不開三支函式:
     金鑰只有一把,分成三支就是三處要填、三次要部署,
     輪替金鑰時必然漏掉其中一支 —— 而漏掉的症狀是
     「續鎖突然失效、客人做到一半券被釋放」,很難聯想到金鑰。

   === 為什麼要有這一層(與 coupon-list 相同) ===
   票券 API 需要 Header X-Site-Key,那把金鑰等同帳號接管權限,
   不可能放在公開的 GitHub Pages 前端。
   而且對方明文要求:client_id 必須由後端從自己的 session 取得,
   絕不可接受前端傳入 —— 否則任何人都能鎖別人的票券。

   部署:Supabase Dashboard → Edge Functions → 新增 coupon-lock → 貼上本檔
        Verify JWT 要【關閉】(前端沒有 Supabase 使用者,身分靠自家 session token)

   金鑰:Secrets 的 SITE_API_KEY —— 【主後端正式站】那一把。
        與 shop 用的 SHOP_SITE_API_KEY 是不同的兩把,填錯兩邊都會壞。
        沒有 Secrets 權限時填下面的 FALLBACK_SITE_KEY,
        ⚠ 只能在 Dashboard 的編輯器裡填,這份檔案在公開 repo。

   === action 一覽 ===
     lock    { coupon_id }      → lock_token、category_tid、amount、expires_in
     extend  { lock_token }     → 再延 30 分鐘(自鎖定起算最多 4 小時)
     unlock  { lock_token }     → 放棄,立即釋放

   redeem(核銷)由【商城】呼叫,官網不經手,故不在此。
   ============================================================= */

// ⚠ 只在 Dashboard 填,不要提交回 GitHub
const FALLBACK_SITE_KEY = '';

const SITE_KEY = Deno.env.get('SITE_API_KEY') || FALLBACK_SITE_KEY;

/* 主後端。正式站為 lohas.realtime.tw。
   要切回測試站的話金鑰也要一起換 —— 兩者綁環境。 */
const TICKET_BASE = (Deno.env.get('TICKET_BASE_URL') ||
  'https://lohas.realtime.tw').replace(/\/+$/, '');

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const AUTH_FN = `${SUPABASE_URL}/functions/v1/auth-session`;

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

/* ---------- 身分 ----------
   不自行驗證 HMAC:簽章密鑰只放在 auth-session 一處。
   每支函式各驗一遍的話,哪天改了簽章格式就會有函式默默失效。 */
type Who = { erpid: string; mid: string; bound: boolean } | null;

async function whoIs(token: string): Promise<Who> {
  if (!token) return null;
  try {
    const r = await fetch(AUTH_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify', token }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const j = await r.json();
    if (String(j?.code) !== '200') return null;
    const erpid = String(j?.erpid ?? j?.data?.erpid ?? '').trim();
    const mid = String(j?.mid ?? j?.data?.mid ?? '').trim();
    if (!erpid && !mid) return null;
    return { erpid, mid, bound: j?.bound === undefined ? !!erpid : !!j.bound };
  } catch {
    return null;
  }
}

/* ---------- 速率限制 ----------
   記憶體計數。Edge Function 會有多個執行個體,所以這不是嚴格的上限,
   是擋掉「同一個人狂點」與明顯的腳本,不是防禦機制。
   真正的權限判斷在上游(票券 API 自己會驗 client_id 與 lock_token)。

   extend 的額度要寬:客人做客製時前端每 5–10 分鐘就會續一次,
   一次流程最長 4 小時,正常使用會累積數十次。 */
const HITS = new Map<string, number[]>();
const LIMITS: Record<string, { max: number; windowMs: number }> = {
  lock:   { max: 20,  windowMs: 60 * 60 * 1000 },   // 每小時 20 次
  extend: { max: 120, windowMs: 60 * 60 * 1000 },   // 每小時 120 次
  unlock: { max: 40,  windowMs: 60 * 60 * 1000 },
};

function rateLimited(key: string, action: string): boolean {
  const rule = LIMITS[action];
  if (!rule) return false;
  const now = Date.now();
  const k = action + ':' + key;
  const arr = (HITS.get(k) || []).filter((t) => now - t < rule.windowMs);
  arr.push(now);
  HITS.set(k, arr);

  // 不讓 Map 無限成長:超過一定規模就清掉過期的
  if (HITS.size > 5000) {
    for (const [kk, vv] of HITS) {
      if (!vv.some((t) => now - t < 60 * 60 * 1000)) HITS.delete(kk);
    }
  }
  return arr.length > rule.max;
}

/* ---------- 上游 ---------- */
async function callTicket(path: string, body: Record<string, unknown>) {
  const r = await fetch(`${TICKET_BASE}/siteapi/coupon/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Site-Key': SITE_KEY,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  const j = await r.json();

  // 對方若在回應裡帶了 debug 之類的欄位,不要原樣轉給前端
  if (j && typeof j === 'object' && 'debug' in j) delete (j as any).debug;
  return { http: r.status, json: j };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply('405', { message: '只接受 POST' }, 405);

  if (!SITE_KEY) {
    console.error('[coupon-lock] 缺少金鑰:請設 SITE_API_KEY 或填 FALLBACK_SITE_KEY');
    return reply('500', { message: '系統設定不完整,請聯繫客服' }, 500);
  }

  let body: Record<string, any>;
  try { body = await req.json(); }
  catch { return reply('006', { message: '請求格式錯誤' }, 400); }

  const action = String(body.action || '').trim();
  if (!['lock', 'extend', 'unlock'].includes(action)) {
    return reply('006', { message: '不支援的動作' }, 400);
  }

  /* ---------- 關卡一:登入 ----------
     三個動作都要求登入。extend / unlock 雖然只帶 lock_token
     (那串 64 字元隨機值本身就難以猜到,上游也會驗),
     但不要求登入的話,這支就成了一個誰都能打的公開端點,
     只要猜中一次就能把別人做到一半的券解鎖掉。 */
  const who = await whoIs(String(body.token || ''));
  if (!who) return reply('401', { message: '登入狀態已失效,請重新登入' }, 401);

  if (rateLimited(who.erpid || who.mid, action)) {
    return reply('429', { message: '操作太頻繁,請稍候再試' }, 429);
  }

  /* ---------- 關卡二:客編 ----------
     票券 API 以 client_id 為索引,官網註冊而尚未到門市綁定的會員
     沒有這個值。這種情況不能回 401 ——
     他登入得好好的,叫他重新登入只會讓他再做一次一樣的事,
     而結果不會改變。回一個可辨識的代碼,前端據此顯示正確的說明。 */
  if (!who.erpid) {
    return reply('403', {
      reason: 'erp_required',
      message: '這項功能需要門市會員身分。第一次到樂活門市時,店員會協助你完成綁定。',
    }, 403);
  }

  try {
    let out;

    if (action === 'lock') {
      const couponId = Number(body.coupon_id);
      if (!Number.isFinite(couponId) || couponId <= 0) {
        return reply('006', { message: '缺少票券編號' }, 400);
      }
      /* client_id 一律取自 session,不看前端送什麼 ——
         接受前端傳入等於讓任何人鎖走別人的票券。 */
      out = await callTicket('lock', { client_id: who.erpid, coupon_id: couponId });

    } else {
      const lockToken = String(body.lock_token || '').trim();
      // 上游的 token 是 64 字元隨機字串;長度不合的一律不轉送,省一趟往返
      if (lockToken.length < 32 || lockToken.length > 128) {
        return reply('006', { message: '缺少鎖定憑證' }, 400);
      }
      out = await callTicket(action, { lock_token: lockToken });
    }

    /* 只記動作與代碼。
       回應裡有票券面額、可換分類、以及 lock_token ——
       前兩者是會員個資,lock_token 是憑證,進了 log 就等於
       在平台上留了一份副本。 */
    console.log('[coupon-lock] ' + action + ' → ' + (out.json?.code ?? out.http));

    return new Response(JSON.stringify(out.json), {
      status: out.http,
      headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
    });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[coupon-lock] ' + action + ' 連線失敗:' + msg);
    // 502 而不是 500:問題在上游,前端可以據此決定要不要重試
    return reply('502', { message: '票券服務暫時無法連線,請稍後再試' }, 502);
  }
});
