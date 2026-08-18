/* =============================================================
   Supabase Edge Function: store-lookup
   -------------------------------------------------------------
   門市查刻圖:店員輸入會員編號,查出這位客人要刻什麼、刻在哪。

   為什麼要獨立一支,而不是加在 gift 裡:
     gift 那支是【給客人用的】—— 每個動作都以「呼叫者本人」為範圍。
     這一支是【給店員用的】,查的是別人的資料。
     混在同一支的話,日後任何一次改動都可能不小心把特權查詢
     暴露成客人也能呼叫的動作。分開就不會有這種事。

   兩道關卡(沿用 member-lookup 的模式,缺一不可):
     1. 有效的 session token             確認「是誰」
     2. 該會員在 admins 表且狀態正常      確認「有沒有權限」
     只驗第一道的話,任何登入中的會員都能查別人的禮物與刻圖。

   部署:Supabase Dashboard → Edge Functions → 新增 store-lookup → 貼上本檔
        Verify JWT 要【關閉】

   ⚠ 這支不需要任何金鑰。用的是 Supabase 自動注入的環境變數。

   === 目前的範圍 ===
   只查【禮物】。一般客製訂單要等商城開始回拋 design_order、
   把訂單編號填進 design_submissions 之後才查得到,屆時再擴充。
   ============================================================= */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const AUTH_FN = `${SUPABASE_URL}/functions/v1/auth-session`;

const db = createClient(SUPABASE_URL, SERVICE_KEY);

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
    return String(j?.erpid || '').trim();
  } catch {
    return '';
  }
}

/* 對店員開放的欄位。
   刻意不含 claim_code —— 那是領取憑證,店員不需要,
   而且看得到就有可能被抄走、拿去領別人的禮物。 */
function forStore(g: Record<string, any>, svg: string | null) {
  return {
    id: g.id,
    status: g.status,
    fulfillment: g.fulfillment,

    // 要做什麼
    product_nid: g.product_nid,
    product_title: g.product_title,
    product_spec_title: g.product_spec_title,
    design_name: g.design_name,
    engrave_placement: g.engrave_placement,

    // 三張圖:合成圖給客人核對,加工圖與雕刻檔給師傅
    preview_url: g.preview_url,
    guide_url: g.guide_url,
    engraving_url: svg,

    // 來源與時間,現場對話用得上
    sender_name: g.sender_name,
    message: g.message,
    created_at: g.created_at,
    claimed_at: g.claimed_at,
    redeemed_at: g.redeemed_at,

    /* 還沒挑款式的也回,而且明講 ——
       客人到店說「我有一份禮物」,店員查到這筆才知道
       要請他先在手機上挑,而不是「查無資料」把人打發走。 */
    needs_pick: !g.design_id,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply('405', { message: '只接受 POST' }, 405);

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
    console.warn('[store-lookup] 非管理員嘗試查詢', caller);
    return reply('403', { message: '沒有查詢權限' }, 403);
  }

  const target = String(body.erpid || '').trim();
  if (!target) return reply('006', { message: '請輸入會員編號' }, 400);

  /* ---------- 查禮物 ----------
     收到的禮物才是門市要處理的。送出去的不看 ——
     那是別人要去領的,查了也幫不上忙。 */
  const { data: gifts, error } = await db.from('gifts')
    .select('*')
    .or(`claimed_by_erpid.eq.${target},recipient_erpid.eq.${target}`)
    .in('status', ['claimed', 'issued', 'redeemed'])
    .order('claimed_at', { ascending: false })
    .limit(30);

  if (error) {
    console.error('[store-lookup] 查詢失敗:', error.message);
    return reply('500', { message: '系統忙碌,請稍後再試' }, 500);
  }

  const rows = gifts || [];

  /* 雕刻檔的 SVG 不在 gifts 裡,在刻圖庫。一次撈完,不要逐筆查 ——
     一位客人可能有好幾份禮物,逐筆查就是好幾個來回。 */
  const ids = Array.from(new Set(rows.map((g) => g.design_id).filter(Boolean)));
  const svgOf: Record<string, string> = {};
  if (ids.length) {
    const { data: designs } = await db.from('engraving_designs')
      .select('id, image_url_svg').in('id', ids);
    (designs || []).forEach((d: any) => {
      if (d.image_url_svg) svgOf[d.id] = d.image_url_svg;
    });
  }

  console.log('[store-lookup] ' + caller + ' 查詢 ' + target + ',' + rows.length + ' 筆');

  return reply('200', {
    data: {
      erpid: target,
      gifts: rows.map((g) => forStore(g, g.design_id ? (svgOf[g.design_id] || null) : null)),
    },
  });
});
