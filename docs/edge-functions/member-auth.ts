/* =============================================================
   Supabase Edge Function: member-auth
   -------------------------------------------------------------
   會員註冊、忘記帳號、忘記密碼的後端代理。

   為什麼要有這一層:
     這六支介面需要 Header X-Site-Key,那把金鑰等同帳號接管權限,
     不可能放在公開的 GitHub Pages 前端。
     (與 coupon-list、shop 用的是同一把,見票券文件附錄三)

     另一個理由是 client_ip:對方以「每小時每 IP」限制索取驗證碼,
     但 server-to-server 呼叫下他們只看得到我方伺服器的 IP ——
     等於全站共用一個額度,擋不住攻擊者,還會讓正常客人互相排擠。
     所以真實訪客 IP 必須由這一層從 x-forwarded-for 取出來帶上去。

   部署:Supabase Dashboard → Edge Functions → member-auth → 貼上本檔
        Verify JWT 要【關閉】(註冊時使用者還沒有任何身分)

   金鑰設定(擇一):
     A. Secrets 新增 SITE_API_KEY(有權限時的正解)
     B. 沒有 Secrets 權限時,填在下面的 FALLBACK_SITE_KEY

   ⚠ 若走 B:金鑰【只能在 Supabase Dashboard 的編輯器裡填】。
     這份檔案在公開的 GitHub repo 裡,填了就等於公開。
     另外,取代本檔前請先按函式頁面右上角的 Download 備份 ——
     否則貼上新版就會把金鑰洗掉(2026-08-17 已發生過一次)。

   action 一覽:
     check_duplicate    帳號/Email/手機 是否已被使用(註冊表單即時提示)
     register_send      註冊第一步:送驗證碼
     register_verify    註冊第二步:驗證並建立
     forget_account     忘記帳號(寄到 Email)
     forgot_pwd_send    忘記密碼:送驗證碼
     forgot_pwd_reset   忘記密碼:驗證並重設
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

const SITE_KEY = Deno.env.get('SITE_API_KEY') || FALLBACK_SITE_KEY;

/* 主後端(會員 API 與票券 API 同一台)。
   2026-08-18 切至正式站。測試站是 lohas-app-backend-test.onrender.com,
   要切回去測的話金鑰也要換 —— 兩站是不同的兩把,只改網址會全部回未授權。

   ⚠ 切到正式站之後,這裡建立的是【真實會員】,且與 ERP 同步。
     測試站那套「簡訊被攔截、驗證碼從 healthz/smscode 取」在這裡不存在,
     簡訊會真的發送、帳號會真的建立,清除成本高。 */
const BASE = (Deno.env.get('TICKET_BASE_URL') ||
  'https://lohas.realtime.tw').replace(/\/+$/, '');

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

/* ---------- 路由與欄位白名單 ----------
   每一支只轉送它該有的欄位。
   直接把前端 body 轉發等於把這把金鑰的權限開放給任何呼叫者 ——
   對方日後新增參數時,我方不會在不知情的狀況下變成代打的管道。

   needsClientIp:對方以此限流,見檔頭說明。
   heavy:會實際送出簡訊或 Email 的,每一封都是成本,額外收緊。 */
type Route = {
  path: string;
  fields: string[];
  needsClientIp?: boolean;
  heavy?: boolean;
};

const ROUTES: Record<string, Route> = {
  check_duplicate: {
    path: '/siteapi/member/checkDuplicate',
    fields: ['account', 'email', 'mobile'],
  },
  register_send: {
    path: '/siteapi/member/register/send',
    fields: ['account', 'pwd', 'name', 'email', 'mobile', 'country_code', 'verify_type'],
    needsClientIp: true,
    heavy: true,
  },
  register_verify: {
    path: '/siteapi/member/register/verify',
    fields: ['session_key', 'code'],
  },
  forget_account: {
    path: '/siteapi/member/forgetAccount',
    fields: ['email', 'mobile'],
    heavy: true,
  },
  forgot_pwd_send: {
    path: '/siteapi/member/forgetPwd/send',
    fields: ['account', 'mobile'],
    needsClientIp: true,
    heavy: true,
  },
  forgot_pwd_reset: {
    path: '/siteapi/member/forgetPwd/reset',
    fields: ['account', 'mobile', 'code', 'pwd'],
  },
};

/* ---------- 我方這一層的限流 ----------
   對方已有「每小時每 IP」與「每手機/Email 每日 5 次」兩層,
   這裡再擋一層的用意是:別讓我方成為打爆對方額度的來源。

   heavy 的那幾支分開計數 —— 送簡訊跟查重複的成本差了好幾個數量級,
   用同一個額度會讓「打字查帳號」把「真的要註冊」的次數吃掉。 */
const hits = new Map<string, number[]>();

function tooMany(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const win = (hits.get(key) || []).filter((t) => now - t < windowMs);
  win.push(now);
  hits.set(key, win);
  if (hits.size > 5000) hits.clear();     // 粗暴但有效的記憶體上限
  return win.length > limit;
}

/** 取真實訪客 IP。x-forwarded-for 是「客戶端, 代理1, 代理2」,第一段才是訪客 */
function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for') || '';
  const first = xff.split(',')[0].trim();
  return first || req.headers.get('cf-connecting-ip') || '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply('405', { message: '只接受 POST' }, 405);

  if (!SITE_KEY) {
    console.error('[member-auth] 缺少金鑰:請設 SITE_API_KEY 或填 FALLBACK_SITE_KEY');
    return reply('500', { message: '系統設定不完整,請聯繫技術窗口' }, 500);
  }

  let body: Record<string, any>;
  try { body = await req.json(); }
  catch { return reply('006', { message: '請求格式錯誤' }, 400); }

  const action = String(body.action || '');
  const route = ROUTES[action];
  if (!route) return reply('006', { message: '不支援的 action' }, 400);

  const ip = clientIp(req) || 'unknown';

  /* 會發簡訊/Email 的:每 IP 每小時 10 次。
     其餘(查重複、填驗證碼):每 IP 每分鐘 30 次。 */
  const limited = route.heavy
    ? tooMany('h:' + ip, 10, 3_600_000)
    : tooMany('l:' + ip, 30, 60_000);
  if (limited) {
    return reply('029', { message: '操作過於頻繁,請稍後再試' }, 429);
  }

  /* 逐欄挑出,不做內容檢查 —— 格式與長度由對方驗,
     我方多做一套只會出現「兩邊規則不一致」的縫隙。
     空字串一律不帶,讓對方用自己的必填規則回應。 */
  const out: Record<string, unknown> = {};
  for (const f of route.fields) {
    const v = body[f];
    if (v === undefined || v === null || v === '') continue;
    out[f] = String(v).slice(0, 200);
  }
  if (route.needsClientIp && ip !== 'unknown') out.client_ip = ip;

  try {
    const r = await fetch(BASE + route.path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Site-Key': SITE_KEY,
      },
      body: JSON.stringify(out),
      signal: AbortSignal.timeout(20000),
    });

    const text = await r.text();
    let j: any;
    try { j = JSON.parse(text); }
    catch {
      /* 對方是 Laravel,出錯時可能回 HTML 錯誤頁而不是 JSON。
         直接把 HTML 丟給前端會變成一堆亂碼,而且可能夾帶伺服器路徑。 */
      console.error('[member-auth] ' + action + ' 回應非 JSON:' + text.slice(0, 200));
      return reply('500', { message: '系統忙碌,請稍後再試' }, 502);
    }

    // 保險起見濾掉任何可能回音金鑰的欄位
    if (j && typeof j === 'object' && 'debug' in j) delete j.debug;

    /* ⚠ 只記 action 與結果代碼。
       這幾支的 body 含密碼與驗證碼,整包寫進 log 等於把它們留在 Supabase。 */
    console.log('[member-auth] ' + action + ' → ' + (j?.code ?? r.status));

    return new Response(JSON.stringify(j), {
      status: r.status,
      headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
    });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[member-auth] ' + action + ' 連線失敗:' + msg);
    return reply('500', { message: '目前無法連線,請稍後再試' }, 502);
  }
});
