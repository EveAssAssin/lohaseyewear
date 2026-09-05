/* =============================================================
   Supabase Edge Function: payout
   -------------------------------------------------------------
   創作者匯款帳戶的讀寫入口(member-portal.html 的「分潤」區用)。

   === 為什麼要有這一支(2026-09-05) ===
   在這之前,前端是【直接打 payout_accounts 這張表】的,而那張表的
   RLS 政策是 `ALL / public / true / true` —— 無條件放行。
   前端用來限定「只看自己那筆」的條件是:

       .eq('member_id', State.member.erpid)

   而 State.member 來自 localStorage,也就是【客戶端自己宣告的身分】。
   任何人把 anon key(公開在 GitHub 上)配上別人的客編,就能:
     · 讀出任何創作者的銀行帳號與戶名
     · 把別人的收款帳號改成自己的
   後者是實質的金流竊取,而且改完之後畫面上一切正常,
   直到那個人下次沒收到分潤才會發現。

   所以身分一律由伺服器端從 session token 解出來,
   前端傳什麼 member_id 都【完全忽略】。這一支上線之後,
   payout_accounts 的 anon 政策就可以整條收掉。

   === 這一支只做「自己的事」 ===
   只能讀寫呼叫者自己那一筆。沒有任何動作接受指定他人的參數 ——
   不是靠檢查,是靠【根本沒有那個入口】。

   部署:Supabase Dashboard → Edge Functions → 新增 payout → 貼上本檔
        Verify JWT 要【關閉】(我方自己驗 session token)

   ⚠ 這支不需要任何 Secret,用的是 Supabase 自動注入的環境變數。
   ============================================================= */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const AUTH_FN = `${SUPABASE_URL}/functions/v1/auth-session`;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

/* 線上實際跑的是哪一版。每次改這支就一併更新 ——
   從外面看不出線上是哪一版,是 2026-08-28 那次事故的根本原因。 */
const CODE_VERSION = '2026-09-05 · 匯款帳戶改由伺服器驗身分';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

function reply(code: string, body: Record<string, unknown> = {}, http = 200) {
  return new Response(JSON.stringify({ code, ...body }), {
    status: http,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/* 身分。⚠ 這一支【一定要有 erpid】,只有 mid 不行。
   匯款帳戶是綁在 ERP 客編上的(creator_id 就是 erpid),
   沒有客編的人本來就不會是創作者、也不會有分潤可領。
   放行 mid 的話會產生一筆沒有人領得到的孤兒資料。 */
async function whoFromToken(token: string): Promise<string | null> {
  if (!token) return null;
  try {
    const r = await fetch(AUTH_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify', token }),
    });
    const j = await r.json();
    if (String(j?.code) !== '200') return null;
    const erpid = String(j?.erpid ?? j?.data?.erpid ?? '').trim();
    return erpid || null;
  } catch {
    return null;
  }
}

/* 速率限制。記憶體計數,多執行個體下不是嚴格上限,
   目的是擋掉狂按與明顯的腳本,不是防禦機制。 */
const HITS = new Map<string, number[]>();
function rateLimited(key: string): boolean {
  const now = Date.now();
  const arr = (HITS.get(key) || []).filter((t) => now - t < 60 * 60 * 1000);
  arr.push(now);
  HITS.set(key, arr);
  if (HITS.size > 5000) HITS.clear();
  return arr.length > 60;
}

const COLS = 'member_id, bank_name, branch, account_number, recipient_name, updated_at';

/* 欄位檢查。長度上限是為了不讓奇怪的東西進到匯款作業的畫面上,
   帳號限定純數字則與前端原本的檢查一致。 */
function cleanAccount(body: Record<string, any>) {
  const bank_name       = String(body.bank_name ?? '').trim().slice(0, 60);
  const branch          = String(body.branch ?? '').trim().slice(0, 60);
  const recipient_name  = String(body.recipient_name ?? '').trim().slice(0, 60);
  const account_number  = String(body.account_number ?? '').trim().slice(0, 30);

  if (!bank_name)      return { err: '請填銀行名稱' };
  if (!recipient_name) return { err: '請填受款人姓名' };
  if (!account_number) return { err: '請填帳號' };
  if (!/^\d+$/.test(account_number)) return { err: '帳號請輸入純數字' };

  return { row: { bank_name, branch, account_number, recipient_name } };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  /* GET = 自檢。不回任何客人的資料,只回這支活著、是哪一版。 */
  if (req.method === 'GET') {
    return reply('200', { data: { code_version: CODE_VERSION } });
  }

  if (req.method !== 'POST') return reply('405', { message: '只接受 POST' }, 405);

  let body: Record<string, any>;
  try { body = await req.json(); }
  catch { return reply('006', { message: '請求格式錯誤' }, 400); }

  const action = String(body.action || '');
  if (['get', 'save', 'delete'].indexOf(action) < 0) {
    return reply('006', { message: '不支援的動作' }, 400);
  }

  /* 🚨 身分只從 token 來。
     前端若傳了 member_id / erpid,【完全不看】——
     這一支從頭到尾沒有讀取那些欄位的程式碼,
     不是「有檢查」,是根本沒有那個入口。 */
  const erpid = await whoFromToken(String(body.token || ''));
  if (!erpid) return reply('401', { message: '登入狀態已失效,請重新登入' }, 401);

  if (rateLimited(erpid)) {
    return reply('429', { message: '操作太頻繁,請稍候再試' }, 429);
  }

  if (action === 'get') {
    const { data, error } = await db
      .from('payout_accounts').select(COLS).eq('member_id', erpid).maybeSingle();
    if (error) {
      // ⚠ 不記錄 error 以外的東西:那筆資料裡有銀行帳號
      console.error('[payout] 讀取失敗:', error.message);
      return reply('500', { message: '讀取失敗,請稍後再試' }, 500);
    }
    return reply('200', { data: { account: data || null } });
  }

  if (action === 'save') {
    const c = cleanAccount(body);
    if (c.err) return reply('006', { message: c.err }, 400);

    const { error } = await db.from('payout_accounts').upsert({
      /* ⚠ member_id 用伺服器解出來的 erpid,不是前端傳的。
         這一行就是這整支函式存在的理由。 */
      member_id: erpid,
      ...c.row,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'member_id' });

    if (error) {
      console.error('[payout] 儲存失敗:', error.message);
      return reply('500', { message: '儲存失敗,請再試一次' }, 500);
    }
    // 只記客編,不記任何帳戶內容
    console.log('[payout] 已更新匯款帳戶 erpid=' + erpid);
    return reply('200', {});
  }

  // delete
  const { error } = await db.from('payout_accounts').delete().eq('member_id', erpid);
  if (error) {
    console.error('[payout] 刪除失敗:', error.message);
    return reply('500', { message: '刪除失敗,請再試一次' }, 500);
  }
  console.log('[payout] 已刪除匯款帳戶 erpid=' + erpid);
  return reply('200', {});
});
