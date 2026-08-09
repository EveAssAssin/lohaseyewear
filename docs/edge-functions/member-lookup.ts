/* =============================================================
   Supabase Edge Function: member-lookup
   -------------------------------------------------------------
   管理後台「查詢會員 / 升級身份」用的會員查詢。

   為什麼要有這一層:
     原本管理後台直接在瀏覽器帶著 ERP apikey 打代理,
     那把金鑰因此出現在公開 repo 的 js/admin-portal.js 裡。
     金鑰移到這裡之後,前端只送 session token,查不到金鑰。

   兩道關卡,缺一不可:
     1. 必須是有效的 session token(確認「是誰」)
     2. 該會員必須在 admins 表且狀態正常(確認「有沒有權限」)
     只驗第一道的話,任何登入中的會員都能查別人的手機與姓名。

   部署:Supabase Dashboard → Edge Functions → 新增 member-lookup → 貼上本檔
        Verify JWT 要【關閉】

   金鑰設定(擇一):
     A. Dashboard → Edge Functions → Secrets 新增 ERP_API_KEY(建議)
     B. 沒有 Secrets 權限時,把金鑰直接填在下面的 FALLBACK_ERP_KEY

   ⚠ 若走 B:金鑰【只能在 Supabase Dashboard 的編輯器裡填】。
     這份檔案在公開的 GitHub repo 裡,填了就等於公開,
     絕對不要把填好金鑰的版本回寫到 repo。
   ============================================================= */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ⚠ 只在 Dashboard 填,不要提交回 GitHub
const FALLBACK_ERP_KEY = '';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ERP_KEY      = Deno.env.get('ERP_API_KEY') || FALLBACK_ERP_KEY;
const PROXY_URL    = (Deno.env.get('PROXY_URL') || 'https://lohas-proxy-nwad.onrender.com/api')
  .replace(/\/+$/, '');
const AUTH_FN      = `${SUPABASE_URL}/functions/v1/auth-session`;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function reply(code: string, body: Record<string, unknown> = {}, http = 200) {
  return new Response(JSON.stringify({ code, ...body }), {
    status: http,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

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

  if (!ERP_KEY) {
    console.error('[member-lookup] 缺少 ERP 金鑰:請設 ERP_API_KEY 或填 FALLBACK_ERP_KEY');
    return reply('500', { message: '系統設定不完整,請聯繫技術窗口' }, 500);
  }

  let body: Record<string, any>;
  try { body = await req.json(); }
  catch { return reply('006', { message: '請求格式錯誤' }, 400); }

  /* ---------- 關卡 1:身分 ---------- */
  const caller = await erpidFromToken(String(body.token || ''));
  if (!caller) return reply('401', { message: '登入狀態已失效,請重新登入' }, 401);

  /* ---------- 關卡 2:權限 ---------- */
  const { data: admin, error: adminErr } = await db.from('admins')
    .select('member_id, status').eq('member_id', caller).maybeSingle();
  if (adminErr) return reply('500', { message: '系統忙碌,請稍後再試' }, 500);
  if (!admin || (admin.status && admin.status !== 'active')) {
    // 刻意不說「你不是管理員」—— 回應內容不該幫人確認自己踩到了什麼
    console.warn('[member-lookup] 非管理員嘗試查詢', caller);
    return reply('403', { message: '沒有查詢權限' }, 403);
  }

  /* ---------- 查詢條件:手機 / 會員編號 / 姓名,擇一 ---------- */
  const mobile = String(body.mobile || '').replace(/\D/g, '');
  const erpid  = String(body.erpid || '').trim();
  const name   = String(body.name || '').trim();
  if (!mobile && !erpid && !name) {
    return reply('006', { message: '請提供手機、會員編號或姓名' }, 400);
  }

  const query: Record<string, unknown> =
    mobile ? { mobile } : erpid ? { client_id: erpid } : { name };

  /* ---------- 打代理 ---------- */
  try {
    const r = await fetch(`${PROXY_URL}/proxy/member/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: { apikey: ERP_KEY, apiver: '0.1.0', data: query },
      }),
    });
    const j = await r.json();

    const code = String(j?.code ?? j?.status ?? '');
    if (code !== '200' && code !== '0') {
      return reply('007', { message: j?.message || j?.errmessage || '查無此會員' }, 404);
    }

    // 一律回陣列。用姓名查很可能命中多筆(同名同姓),
    // 在這裡就取第一筆的話,前端的「請選擇正確的會員」畫面會失效。
    const raw = Array.isArray(j.data) ? j.data : (j.data ? [j.data] : []);
    if (!raw.length) return reply('007', { message: '查無此會員' }, 404);

    // 白名單式回傳。上游回應可能還帶消費紀錄等其他欄位,
    // 管理後台用不到的就不要送到瀏覽器去。
    // email / birthday 是「會員詳情」畫面需要的,呼叫者已驗證為管理員。
    const members = raw
      .map((m: Record<string, any>) => ({
        erpid: String(m.client_id || m.erpid || m.erpId || ''),
        name: String(m.name || m.erpname || m.erpName || ''),
        mobile: String(m.mobile || m.phone || ''),
        email: String(m.email || ''),
        birthday: String(m.birthday || ''),
      }))
      .filter((m) => m.erpid);

    if (!members.length) return reply('007', { message: '查詢結果缺少會員編號' }, 404);

    return reply('200', { data: { members, count: members.length } });
  } catch (e) {
    console.error('[member-lookup] 上游連線失敗');
    return reply('500', { message: '查詢服務暫時無法連線,請稍後再試' }, 502);
  }
});
