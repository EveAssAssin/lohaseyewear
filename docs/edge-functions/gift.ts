/* =============================================================
   Supabase Edge Function: gift
   -------------------------------------------------------------
   禮物中心的唯一資料入口。

   為什麼所有事都得經過這裡:
     gifts 表存了收件姓名/電話/地址與領取碼,RLS 全鎖、anon 完全讀不到。
     前端拿的 anon key 是公開的(GitHub Pages),不可能讓它直接碰這張表。
     本函式用 service_role 連線(繞過 RLS),並自行做身分與權限判斷。

   部署:Supabase Dashboard → Edge Functions → 新增 gift → 貼上本檔
        Verify JWT 要【關閉】(前端沒有 Supabase 使用者,身分靠自家 session token)

   環境變數:
     SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  → Supabase 自動注入,不用設
     SITE_ORIGIN(選填)→ 產生領取連結用,預設 https://www.lohasglasses.com

   action 一覽:
     list     我送出的 / 我收到的            需 token
     create   建立禮物(狀態 pending_payment) 需 token
     preview  用領取碼看禮物長怎樣            不需 token(領取碼本身就是憑證)
     claim    領取                           需 token
     cancel   送禮者取消(僅限尚未付款)       需 token
   ============================================================= */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SITE_ORIGIN  = Deno.env.get('SITE_ORIGIN') || 'https://www.lohasglasses.com';
const AUTH_FN      = `${SUPABASE_URL}/functions/v1/auth-session`;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

function reply(code: string, body: Record<string, unknown> = {}, http = 200) {
  return new Response(JSON.stringify({ code, ...body }), {
    status: http,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/* ---------- 身分 ----------
   不自行驗證 HMAC:密鑰只放在 auth-session 一處,
   任何一邊改了簽章格式都不會造成兩邊不同步。 */
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
    // auth-session 的成功回應欄位名未經確認,這裡容錯取值。
    // 首次實測後可收斂成單一路徑。
    const raw =
      j?.data?.erpid ?? j?.data?.client_id ?? j?.data?.member?.client_id ??
      j?.erpid ?? j?.client_id ?? j?.member?.client_id ?? '';
    return String(raw || '').trim();
  } catch {
    return '';
  }
}

/* ---------- 領取碼 ----------
   22 字元 base62 ≈ 131 bits。領取碼等同禮物的所有權憑證,
   熵不足就會被暴力猜中,不可用時間戳或流水號。 */
const B62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function newClaimCode(): string {
  const buf = new Uint8Array(22);
  crypto.getRandomValues(buf);
  let s = '';
  for (const b of buf) s += B62[b % 62];
  return s;
}

/* 對外欄位白名單:收件人個資與內部欄位一律不出去 */
function publicGift(g: Record<string, unknown>, viewer: 'sender' | 'recipient' | 'anon') {
  const base = {
    id: g.id,
    status: g.status,
    design_id: g.design_id,
    design_name: g.design_name,
    design_image_url: g.design_image_url,
    product_title: g.product_title,
    product_image: g.product_image,
    message: g.message,
    sender_name: g.sender_name,
    created_at: g.created_at,
    paid_at: g.paid_at,
    claimed_at: g.claimed_at,
    shipped_at: g.shipped_at,
    expires_at: g.expires_at,
  };
  if (viewer === 'sender') {
    return {
      ...base,
      recipient_mode: g.recipient_mode,
      recipient_erpid: g.recipient_erpid,
      claim_code: g.claim_code,
      claim_url: g.claim_code ? `${SITE_ORIGIN}/gift-claim.html?c=${g.claim_code}` : null,
      order_trade_no: g.order_trade_no,
    };
  }
  if (viewer === 'recipient') {
    return { ...base, recipient_name: g.recipient_name };
  }
  return base;   // anon:只看得到禮物長相,看不到任何人的資料
}

async function logEvent(
  gift_id: string, from: string | null, to: string,
  actor: string, note = '', payload: unknown = null,
) {
  try {
    await db.from('gift_events').insert({
      gift_id, from_status: from, to_status: to, actor, note, payload,
    });
  } catch { /* 流水帳寫失敗不該擋住主流程 */ }
}

/* ============================================================= */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply('405', { message: '只接受 POST' }, 405);

  let body: Record<string, any>;
  try { body = await req.json(); }
  catch { return reply('006', { message: '請求格式錯誤' }, 400); }

  const action = String(body.action || '');

  /* ---------- preview:用領取碼看禮物 ---------- */
  if (action === 'preview') {
    const code = String(body.claim_code || '').trim();
    if (!code) return reply('006', { message: '缺少領取碼' }, 400);

    const { data: g, error } = await db.from('gifts')
      .select('*').eq('claim_code', code).maybeSingle();
    if (error) return reply('500', { message: '系統忙碌,請稍後再試' }, 500);
    if (!g) return reply('007', { message: '查無此禮物,連結可能不正確' }, 404);

    // 尚未付款的禮物不對外顯示 —— 否則送禮者還沒付錢,對方就先看到了
    if (g.status === 'pending_payment') {
      return reply('030', { message: '這份禮物還在準備中,請稍後再試' }, 409);
    }
    return reply('200', { data: { gift: publicGift(g, 'anon'), claimable: g.status === 'paid' } });
  }

  /* 以下動作都需要身分 */
  const erpid = await erpidFromToken(String(body.token || ''));
  if (!erpid) return reply('401', { message: '登入狀態已失效,請重新登入' }, 401);

  /* ---------- list ---------- */
  if (action === 'list') {
    const [sentRes, recvRes] = await Promise.all([
      db.from('gifts').select('*')
        .eq('sender_erpid', erpid)
        .order('created_at', { ascending: false }).limit(100),
      db.from('gifts').select('*')
        .or(`recipient_erpid.eq.${erpid},claimed_by_erpid.eq.${erpid}`)
        .neq('sender_erpid', erpid)
        .neq('status', 'pending_payment')      // 對方還沒付款的不該出現在我這邊
        .order('created_at', { ascending: false }).limit(100),
    ]);
    if (sentRes.error || recvRes.error) {
      return reply('500', { message: '系統忙碌,請稍後再試' }, 500);
    }
    return reply('200', {
      data: {
        sent: (sentRes.data || []).map((g) => publicGift(g, 'sender')),
        received: (recvRes.data || []).map((g) => publicGift(g, 'recipient')),
      },
    });
  }

  /* ---------- create ---------- */
  if (action === 'create') {
    const mode = body.recipient_mode === 'member' ? 'member' : 'link';
    const recipientErpid = String(body.recipient_erpid || '').trim();

    if (mode === 'member' && !recipientErpid) {
      return reply('006', { message: '請指定收禮的會員' }, 400);
    }
    if (mode === 'member' && recipientErpid === erpid) {
      return reply('031', { message: '不能把禮物送給自己' }, 400);
    }

    const row = {
      sender_erpid: erpid,
      sender_name: String(body.sender_name || '').slice(0, 60) || null,
      design_id: body.design_id || null,
      design_name: String(body.design_name || '').slice(0, 120) || null,
      design_image_url: String(body.design_image_url || '').slice(0, 500) || null,
      product_nid: body.product_nid ? Number(body.product_nid) : null,
      product_sid: body.product_sid ? Number(body.product_sid) : null,
      product_title: String(body.product_title || '').slice(0, 200) || null,
      product_image: String(body.product_image || '').slice(0, 500) || null,
      message: String(body.message || '').slice(0, 300) || null,
      recipient_mode: mode,
      recipient_erpid: mode === 'member' ? recipientErpid : null,
      claim_code: mode === 'link' ? newClaimCode() : null,
      status: 'pending_payment',
    };

    const { data: g, error } = await db.from('gifts').insert(row).select().single();
    if (error) return reply('500', { message: '建立失敗,請稍後再試' }, 500);

    await logEvent(g.id, null, 'pending_payment', 'sender', '建立禮物');
    return reply('200', { data: { gift: publicGift(g, 'sender') } });
  }

  /* ---------- claim ---------- */
  if (action === 'claim') {
    const code = String(body.claim_code || '').trim();
    const giftId = String(body.gift_id || '').trim();
    if (!code && !giftId) return reply('006', { message: '缺少禮物識別' }, 400);

    const q = db.from('gifts').select('*');
    const { data: g, error } = code
      ? await q.eq('claim_code', code).maybeSingle()
      : await q.eq('id', giftId).maybeSingle();
    if (error) return reply('500', { message: '系統忙碌,請稍後再試' }, 500);
    if (!g) return reply('007', { message: '查無此禮物' }, 404);

    if (g.sender_erpid === erpid) {
      return reply('032', { message: '這是你自己送出的禮物' }, 403);
    }
    // 指定會員的禮物,只有那個人能領
    if (g.recipient_mode === 'member' && g.recipient_erpid && g.recipient_erpid !== erpid) {
      return reply('033', { message: '這份禮物是指定給其他會員的' }, 403);
    }
    if (g.status === 'claimed' || g.status === 'shipped') {
      return reply('034', { message: '這份禮物已經領取過了' }, 409);
    }
    if (g.status === 'pending_payment') {
      return reply('030', { message: '這份禮物還在準備中,請稍後再試' }, 409);
    }
    if (g.status !== 'paid') {
      return reply('035', { message: '這份禮物已失效,請聯繫送禮的人' }, 409);
    }
    if (g.expires_at && new Date(g.expires_at).getTime() < Date.now()) {
      return reply('036', { message: '這份禮物已超過領取期限' }, 409);
    }

    const name = String(body.recipient_name || '').trim().slice(0, 60);
    const phone = String(body.recipient_phone || '').trim().slice(0, 30);
    const address = String(body.recipient_address || '').trim().slice(0, 200);
    if (!name || !phone || !address) {
      return reply('006', { message: '請填寫收件姓名、電話與地址' }, 400);
    }

    // 條件更新:只有仍是 paid 的那一刻才寫得進去。
    // 兩個人同時點領取時,第二個人會更新到 0 筆而不是覆蓋掉第一個人。
    const { data: updated, error: upErr } = await db.from('gifts')
      .update({
        status: 'claimed',
        claimed_at: new Date().toISOString(),
        claimed_by_erpid: erpid,
        recipient_name: name,
        recipient_phone: phone,
        recipient_address: address,
      })
      .eq('id', g.id).eq('status', 'paid')
      .select().maybeSingle();

    if (upErr) return reply('500', { message: '領取失敗,請稍後再試' }, 500);
    if (!updated) return reply('034', { message: '這份禮物已經領取過了' }, 409);

    await logEvent(g.id, 'paid', 'claimed', 'recipient', '收禮人完成領取');

    // 刻圖收進對方的「我的最愛刻圖」。失敗不影響領取本身。
    if (updated.design_id) {
      try {
        await db.from('engraving_wishlist')
          .insert({ member_id: erpid, design_id: updated.design_id });
      } catch { /* 已收藏過會撞唯一鍵,忽略 */ }
    }

    return reply('200', { data: { gift: publicGift(updated, 'recipient') } });
  }

  /* ---------- cancel ---------- */
  if (action === 'cancel') {
    const giftId = String(body.gift_id || '').trim();
    if (!giftId) return reply('006', { message: '缺少禮物識別' }, 400);

    // 只有送禮者本人、且還沒付款才能取消。
    // 已付款的要走退款,不能讓前端直接改狀態。
    const { data: updated, error } = await db.from('gifts')
      .update({ status: 'cancelled' })
      .eq('id', giftId).eq('sender_erpid', erpid).eq('status', 'pending_payment')
      .select().maybeSingle();

    if (error) return reply('500', { message: '系統忙碌,請稍後再試' }, 500);
    if (!updated) return reply('037', { message: '這份禮物無法取消,已付款的請聯繫客服' }, 409);

    await logEvent(giftId, 'pending_payment', 'cancelled', 'sender', '送禮者取消');
    return reply('200', { data: { gift: publicGift(updated, 'sender') } });
  }

  return reply('006', { message: '不支援的 action' }, 400);
});
