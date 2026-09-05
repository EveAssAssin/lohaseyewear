/* =============================================================
   Supabase Edge Function: admin-write
   -------------------------------------------------------------
   後台的寫入入口。管理後台原本是【以 anon 身分直接打資料表】,
   所以每一張後台要改的表都必須開一條 `for all / public / true` 的
   RLS 政策 —— 而 anon key 是公開的(在 GitHub 上的 js/supabase.js)。

   結果是任何人都能:
     · member_status  → 停權任何會員,或把自己解停權
     · site_settings  → 改掉全站頁尾的連結(釣魚)
     · news / banners → 竄改首頁與公告
   後台自己的「你是不是管理員」判斷是【前端查 admins 表】決定的,
   擋不住直接打 REST 的人。

   這一支把寫入收進來:service_role 執行,先驗身分再驗管理員。
   收完之後那些表的 anon 寫入政策就可以整條拿掉。

   === 為什麼不是「驗過身分就能任意寫」 ===
   🚨 這一支的危險在於它天生就是一把萬能鑰匙。所以:

     1. 只有【白名單裡的表】能動
     2. 每張表只開【白名單裡的欄位】—— 傳了沒列出的欄位直接拒絕,
        不是默默丟掉。默默丟掉的話,呼叫端會以為存進去了
     3. 每張表只開【白名單裡的動作】
     4. 條件(match)只能用該表指定的那一個鍵,不接受任意條件 ——
        不然 `delete where true` 就是一個合法請求

   加新的表要同時想清楚上面四件事,不要只加表名。

   部署:Supabase Dashboard → Edge Functions → 新增 admin-write → 貼上本檔
        Verify JWT 要【關閉】(我方自己驗 session token)

   ⚠ 這支不需要任何 Secret。
   ============================================================= */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const AUTH_FN = `${SUPABASE_URL}/functions/v1/auth-session`;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CODE_VERSION = '2026-09-05 · member_status + site_settings';

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

/* ===== 白名單 =====
   key   : match 只能用這個欄位(也就是 onConflict 的鍵)
   ops   : 允許的動作
   cols  : 允許寫入的欄位。沒列到的一律拒絕。

   ⚠ 目前只放兩張表 —— 這一支是逐張搬進來的,不是一次全開。
     搬一張、後台驗一次、再搬下一張;因為後台沒有測試環境,
     一次搬七張出事了會分不出是哪一張。 */
type Rule = { key: string; ops: string[]; cols: string[] };
const ALLOW: Record<string, Rule> = {
  member_status: {
    key: 'member_id',
    ops: ['upsert', 'update'],
    cols: ['member_id', 'status', 'reason', 'suspended_at', 'updated_at'],
  },
  site_settings: {
    key: 'key',
    ops: ['upsert'],
    cols: ['key', 'value', 'updated_at'],
  },
};

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
    return String(j?.erpid ?? j?.data?.erpid ?? '').trim();
  } catch {
    return '';
  }
}

const HITS = new Map<string, number[]>();
function rateLimited(key: string): boolean {
  const now = Date.now();
  const arr = (HITS.get(key) || []).filter((t) => now - t < 60 * 60 * 1000);
  arr.push(now);
  HITS.set(key, arr);
  if (HITS.size > 5000) HITS.clear();
  return arr.length > 200;      // 後台批次操作會比較密集,給寬一點
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (req.method === 'GET') {
    return reply('200', {
      data: { code_version: CODE_VERSION, tables: Object.keys(ALLOW) },
    });
  }

  if (req.method !== 'POST') return reply('405', { message: '只接受 POST' }, 405);

  let body: Record<string, any>;
  try { body = await req.json(); }
  catch { return reply('006', { message: '請求格式錯誤' }, 400); }

  /* ---------- 關卡 1:身分 ---------- */
  const caller = await erpidFromToken(String(body.token || ''));
  if (!caller) return reply('401', { message: '登入狀態已失效,請重新登入' }, 401);

  /* ---------- 關卡 2:管理員 ----------
     與 cloth-admin / design 一致。只驗第一道的話,
     任何登入中的會員都能停權別人。 */
  const { data: admin, error: admErr } = await db.from('admins')
    .select('member_id, status').eq('member_id', caller).maybeSingle();
  if (admErr) return reply('500', { message: '系統忙碌,請稍後再試' }, 500);
  if (!admin || (admin.status && admin.status !== 'active')) {
    // 刻意不說「你不是管理員」—— 回應不該幫人確認自己踩到了什麼
    console.warn('[admin-write] 非管理員嘗試寫入', caller, body.table, body.op);
    return reply('403', { message: '沒有操作權限' }, 403);
  }

  if (rateLimited(caller)) {
    return reply('429', { message: '操作太頻繁,請稍候再試' }, 429);
  }

  /* ---------- 白名單 ---------- */
  const table = String(body.table || '');
  const rule = ALLOW[table];
  if (!rule) return reply('006', { message: '不支援的資料表' }, 400);

  const op = String(body.op || '');
  if (rule.ops.indexOf(op) < 0) return reply('006', { message: '這張表不支援這個動作' }, 400);

  const row = body.row;
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return reply('006', { message: '缺少資料內容' }, 400);
  }

  /* ⚠ 沒列在白名單的欄位【直接拒絕】,不要默默丟掉。
     默默丟掉的話呼叫端會以為存進去了,而那正是今天已經踩過一次的
     「畫面說成功、資料沒變」。 */
  const bad = Object.keys(row).filter((k) => rule.cols.indexOf(k) < 0);
  if (bad.length) {
    return reply('006', { message: '不允許寫入這些欄位:' + bad.join(', ') }, 400);
  }

  /* ===== 伺服器自己填的欄位 =====
     🚨 suspended_by 刻意【不在 cols 白名單裡】,所以前端傳了會被上面
     那道擋掉;真正的值在這裡由伺服器用驗過的 caller 填。

     原本後台是前端送 `suspended_by: State.member.erpid` —— 而
     State.member 來自 localStorage。也就是「停權紀錄上寫誰都可以」,
     可以把別人的名字寫進去。稽核紀錄能被偽造,那份紀錄就沒有意義。 */
  if (table === 'member_status' && row.status === 'suspended') {
    row.suspended_by = caller;
  }

  try {
    if (op === 'upsert') {
      if (row[rule.key] === undefined || row[rule.key] === null || row[rule.key] === '') {
        return reply('006', { message: '缺少 ' + rule.key }, 400);
      }
      const { data, error } = await db.from(table)
        .upsert(row, { onConflict: rule.key })
        .select(rule.key);
      if (error) throw error;
      if (!data || !data.length) {
        console.warn('[admin-write] upsert 影響 0 列', table, row[rule.key]);
        return reply('007', { message: '沒有寫入任何資料' }, 404);
      }
    } else {
      /* update:條件只能是白名單指定的那個鍵。
         接受任意條件的話,`update where true` 就是一個合法請求。 */
      const matchVal = body.match_value;
      if (matchVal === undefined || matchVal === null || matchVal === '') {
        return reply('006', { message: '缺少 ' + rule.key }, 400);
      }
      const { data, error } = await db.from(table)
        .update(row).eq(rule.key, matchVal).select(rule.key);
      if (error) throw error;
      if (!data || !data.length) {
        console.warn('[admin-write] update 影響 0 列', table, matchVal);
        return reply('007', { message: '找不到要更新的資料' }, 404);
      }
    }
  } catch (e) {
    console.error('[admin-write] 寫入失敗:', table, op, (e as Error).message);
    return reply('500', { message: '寫入失敗,請再試一次' }, 500);
  }

  console.log('[admin-write] ' + caller + ' ' + op + ' ' + table);
  return reply('200', {});
});
