/* =============================================================
   Supabase Edge Function: coupon-list
   -------------------------------------------------------------
   會員票券清單。前端(我的票券)唯一的資料來源。

   為什麼要有這一層:
     票券 API 需要 Header X-Site-Key,那把金鑰等同帳號接管權限,
     不可能放在公開的 GitHub Pages 前端。
     而且對方明文要求:client_id 必須由後端從自己的 session 取得,
     絕不可接受前端傳入 —— 否則任何人都能查別人的票券。

   2026-08-09 這一版的兩個變更:
     1. STRICT_SESSION 改為 true。不再接受前端直接帶 erpid。
     2. 金鑰只讀環境變數,移除原本硬寫在原始碼裡的 FALLBACK_KEY。
        金鑰散在多支函式的原始碼裡,輪替時一定會漏掉一處。

   部署:Supabase Dashboard → Edge Functions → coupon-list → 貼上本檔
        Verify JWT 要【關閉】(前端沒有 Supabase 使用者,身分靠自家 session token)

   金鑰設定(擇一):
     A. Dashboard → Edge Functions → Secrets 新增 SITE_API_KEY(建議)
     B. 沒有 Secrets 權限時,把金鑰直接填在下面的 FALLBACK_SITE_KEY

   ⚠ 若走 B:金鑰【只能在 Supabase Dashboard 的編輯器裡填】。
     這份檔案在公開的 GitHub repo 裡,填了就等於公開,
     絕對不要把填好金鑰的版本回寫到 repo。

   2026-08-18:已切至正式站
   -------------------------------------------------------------
   先前指向主後端的【測試站】,那是票券開發初期沿用下來的。
   若在客人看得到票券的狀態下維持測試站,他們會看到不存在的券、
   或折抵時失敗 —— 商城 2026-08-17 來文特別點出這一項。

   查證後確認:官網目前【沒有任何前端程式呼叫這支】
   (「我的票券」已於 8/11 移除並整併為禮物中心),因此無客人受影響。
   但 App 票券頁點「使用」進入官網文創頁那條動線之後會用到它,
   故趁現在一併切好,不等到那時候才發現。

   ⚠ 金鑰也要一起換。主後端的測試站與正式站是【兩把不同的值】,
     只改網址、沿用舊金鑰的話六支 API 會全部回未授權,
     症狀是「改完之後全部不能用」,很容易誤判成網址給錯。
   ============================================================= */

/* ⚠ 2026-08-27 起這一格【故意保持空白,不要填回去】。
   -------------------------------------------------------------
   `SITE_API_KEY` 已由對方設成 Secret,程式讀的是 env,
   env 有值時這一格根本不會被讀到 —— 它現在是死碼。

   而它不是普通的死碼:8/25 對方內部查證把五把金鑰讀出來、留在工作紀錄裡,
   全部輪替過了。這一格裡躺著的是【那一批已外流的舊值】,
   留著只有一個作用 —— 哪天 Secret 被刪掉,它會安靜地拿一把
   外流的金鑰繼續打正式站,而沒有人會發現。

   要「Secret 不見時明確地壞掉」,不要「安靜地用舊金鑰活著」。

   ⚠ 所以取代本檔時:Download 仍然要按(那是備份),
     但【不要】把下載檔裡的 FALLBACK_SITE_KEY 複製回來。 */
const FALLBACK_SITE_KEY = '';

/* 是否只認 session token。
   設 false 會退回「允許前端傳 erpid」的舊行為 —— 那是 session 機制上線前
   的過渡措施,只在緊急回滾時才該打開,平常一律 true。 */
const STRICT_SESSION = true;

const SITE_KEY = Deno.env.get('SITE_API_KEY') || FALLBACK_SITE_KEY;
/* 主後端。正式站為 lohas.realtime.tw,siteapi/* 的路徑不變。
   測試站是 lohas-app-backend-test.onrender.com —— 要切回去測的話
   記得金鑰也要換成測試站那把,兩者綁環境。 */
const TICKET_BASE = (Deno.env.get('TICKET_BASE_URL') ||
  'https://lohas.realtime.tw').replace(/\/+$/, '');

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const AUTH_FN = `${SUPABASE_URL}/functions/v1/auth-session`;

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
    // auth-session 的成功回應欄位名未經確認,容錯取值。
    // 實測後可收斂成單一路徑。
    const raw =
      j?.data?.erpid ?? j?.data?.client_id ?? j?.data?.member?.client_id ??
      j?.erpid ?? j?.client_id ?? j?.member?.client_id ?? '';
    return String(raw || '').trim();
  } catch {
    return '';
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply('405', { message: '只接受 POST' }, 405);

  if (!SITE_KEY) {
    console.error('[coupon-list] 缺少金鑰:請設 SITE_API_KEY 或填 FALLBACK_SITE_KEY');
    return reply('500', { message: '系統設定不完整,請聯繫客服' }, 500);
  }

  let body: Record<string, any>;
  try { body = await req.json(); }
  catch { return reply('006', { message: '請求格式錯誤' }, 400); }

  /* ---------- 決定 client_id ---------- */
  let clientId = await erpidFromToken(String(body.token || ''));

  if (!clientId) {
    if (STRICT_SESSION) {
      // 前端會把 401 轉成「請重新登入」的提示,不會退回示範資料
      return reply('401', { message: '登入狀態已失效,請重新登入' }, 401);
    }
    // 僅在 STRICT_SESSION=false 的回滾情境下才走到這裡
    clientId = String(body.erpid || '').trim();
    if (!clientId) return reply('006', { message: '缺少會員識別' }, 400);
    console.warn('[coupon-list] 以前端 erpid 查詢(非嚴格模式)');
  }

  /* ---------- 向票券 API 查詢 ---------- */
  try {
    const r = await fetch(`${TICKET_BASE}/siteapi/coupon/list`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Site-Key': SITE_KEY,
      },
      body: JSON.stringify({ client_id: clientId }),
    });

    const j = await r.json();

    // 不記錄回應內容:票券清單含金額與有效期,屬於會員個資,
    // 進了 log 就等於留了一份副本在平台上。只記狀態碼。
    if (String(j?.code) !== '200') {
      console.warn('[coupon-list] 上游回應', j?.code, 'http', r.status);
    }

    // 保險:對方若在回應裡帶了 debug 之類的欄位,不要原樣轉給前端
    if (j && typeof j === 'object' && 'debug' in j) delete (j as any).debug;

    return new Response(JSON.stringify(j), {
      status: r.status,
      headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (e) {
    console.error('[coupon-list] 上游連線失敗');
    return reply('500', { message: '票券服務暫時無法連線,請稍後再試' }, 502);
  }
});
