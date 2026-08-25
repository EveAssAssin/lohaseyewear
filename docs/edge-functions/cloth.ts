/* =============================================================
   Supabase Edge Function: cloth
   -------------------------------------------------------------
   客製眼鏡布的存檔入口(cloth.html 用)。

   === 為什麼不讓前端直接寫資料表 ===
   cloth_designs 是 RLS 全鎖、零政策 —— 前端拿的 anon key 是公開的
   (GitHub Pages),讓它能 insert 就等於開放任何人往這張表塞東西。
   所以寫入一律經過這裡,由 service_role 執行,並先驗身分。

   === 這一支只做「自己的事」 ===
   存自己的作品。查別人的作品是後台的事,在另一支 cloth-admin。
   混在同一支的話,日後任何一次改動都可能不小心把特權查詢
   暴露成客人也能呼叫的動作。

   部署:Supabase Dashboard → Edge Functions → 新增 cloth → 貼上本檔
        Verify JWT 要【關閉】

   ⚠ 這支不需要任何金鑰,用的是 Supabase 自動注入的環境變數。
   ============================================================= */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const AUTH_FN = `${SUPABASE_URL}/functions/v1/auth-session`;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

/* 只放行我方 Storage 上的網址。
   這些網址會出現在後台、並被人點開下載製作 ——
   接受任意網址等於提供一條「讓自己人從後台點進外部連結」的路徑。 */
const ASSET_HOST = 'hqdmyxxrskvllkcedybl.supabase.co';

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

function ourAssetUrl(v: unknown): string | null {
  const s = String(v || '').slice(0, 500);
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

/* 身分。erpid 或 mid 有一個就算數 ——
   眼鏡布只做體驗、不成交,不需要 ERP 客編。
   官網註冊的新會員也應該玩得到。 */
async function whoFromToken(token: string): Promise<{ erpid: string; mid: string } | null> {
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
    const mid = String(j?.mid ?? j?.data?.mid ?? '').trim();
    if (!erpid && !mid) return null;
    return { erpid, mid };
  } catch {
    return null;
  }
}

/* 速率限制。記憶體計數,多執行個體下不是嚴格上限,
   目的是擋掉「同一個人狂按」與明顯的腳本,不是防禦機制。 */
const HITS = new Map<string, number[]>();
function rateLimited(key: string): boolean {
  const now = Date.now();
  const arr = (HITS.get(key) || []).filter((t) => now - t < 60 * 60 * 1000);
  arr.push(now);
  HITS.set(key, arr);
  if (HITS.size > 5000) HITS.clear();
  return arr.length > 30;          // 每小時 30 件,遠高於正常使用
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply('405', { message: '只接受 POST' }, 405);

  let body: Record<string, any>;
  try { body = await req.json(); }
  catch { return reply('006', { message: '請求格式錯誤' }, 400); }

  const action = String(body.action || '');
  if (action !== 'save' && action !== 'list') {
    return reply('006', { message: '不支援的動作' }, 400);
  }

  const who = await whoFromToken(String(body.token || ''));
  if (!who) return reply('401', { message: '登入狀態已失效,請重新登入' }, 401);

  /* ===== list:會員中心「我的眼鏡布」 =====
     ---------------------------------------------------------------
     只回這個人自己的。條件從 token 換出來的身分來,不看前端送什麼 ——
     接受前端指定 erpid 的話,任何人都能看別人存了什麼。

     erpid 與 mid 兩個都比:門市綁定之前存的那幾筆只有 mid,
     綁定之後存的有 erpid。只比其中一個,客人會發現自己的東西「少了幾件」,
     而那是最難解釋的一種 bug —— 資料還在,只是查不到。

     svg_url 不回:那是製作端用的檔案,前端不需要,
     回了等於把它散到瀏覽器紀錄與快取裡。 */
  if (action === 'list') {
    let q = db.from('cloth_designs')
      .select('id, source, design_name, preview_url, status, created_at, done_at')
      .order('created_at', { ascending: false })
      .limit(60);

    /* or() 收的是一段字串語法,值裡有逗號或括號會改變它的意思。
       這兩個值來自上游會員 API 而不是前端,但「不是前端來的」不等於
       「一定安全」—— 先確認只有英數與連字號,不合的就退回單欄比對。 */
    const plain = (v: string) => /^[A-Za-z0-9_-]+$/.test(v);

    if (who.erpid && who.mid && plain(who.erpid) && plain(who.mid)) {
      q = q.or('erpid.eq.' + who.erpid + ',mid.eq.' + who.mid);
    } else if (who.erpid) {
      q = q.eq('erpid', who.erpid);
    } else {
      q = q.eq('mid', who.mid);
    }

    const { data, error } = await q;
    if (error) {
      console.error('[cloth] 列表失敗:', error.message);
      return reply('500', { message: '讀取失敗,請稍後再試' }, 500);
    }
    return reply('200', { data: { items: data || [] } });
  }

  if (rateLimited(who.erpid || who.mid)) {
    return reply('429', { message: '操作太頻繁,請稍候再試' }, 429);
  }

  /* 兩個網址都必須是我方 Storage 的。
     svg 缺了就產不出 DXF —— 後台會拿到一筆永遠不能製作的資料,
     所以在這裡就擋住,不要讓它進資料表。 */
  const svgUrl = ourAssetUrl(body.svg_url);
  const previewUrl = ourAssetUrl(body.preview_url);
  if (!svgUrl) return reply('006', { message: '缺少線稿檔' }, 400);
  if (!previewUrl) return reply('006', { message: '缺少合成圖' }, 400);

  const source = body.source === 'draw' ? 'draw' : 'market';
  const p = body.placement || {};

  const row = {
    erpid: who.erpid || null,
    mid: who.mid || null,
    member_name: String(body.member_name || '').slice(0, 60) || null,
    source,
    // 市集刻圖才有作品編號;手繪沒有
    design_id: source === 'market' && body.design_id ? String(body.design_id) : null,
    design_name: String(body.design_name || '').slice(0, 120) || null,
    svg_url: svgUrl,
    preview_url: previewUrl,
    placement: {
      scale: clamp01(p.scale),
      x: clamp01(p.x),
      y: clamp01(p.y),
      basis: 'cloth_image',
    },
  };

  const { data, error } = await db.from('cloth_designs').insert(row).select('id').single();
  if (error) {
    console.error('[cloth] 存檔失敗:', error.message);
    return reply('500', { message: '儲存失敗,請再試一次' }, 500);
  }

  console.log('[cloth] 存檔 ' + data.id + ' source=' + source);
  return reply('200', { data: { id: data.id } });
});
