/* =============================================================
   Supabase Edge Function: shop-webhook
   -------------------------------------------------------------
   接收商城(即時互動)的付款完成與訂單狀態事件。

   部署:Supabase Dashboard → Edge Functions → shop-webhook
        Verify JWT【關閉】—— 呼叫方是商城,不會帶 Supabase JWT。
        驗證改用下方的自訂 Header 金鑰。

   ⚠ 部署前必做:把 FALLBACK_WEBHOOK_KEY 填成一組隨機長字串,
     並以安全管道交給商城(不要用通訊軟體、不要寫進 GitHub)。
     產生方式:Dashboard 的 SQL Editor 執行
       select encode(gen_random_bytes(32), 'hex');

   給商城的介面說明:
     POST https://hqdmyxxrskvllkcedybl.supabase.co/functions/v1/shop-webhook
     Header: X-Lohas-Webhook-Key: <金鑰>
     Body  : { event_id, event, ... }

   支援的事件(event):
     gift_paid       禮物付款完成   → gifts 推進到 paid
     gift_shipped    禮物已出貨     → gifts 推進到 shipped
     gift_redeemed   門市已核銷     → gifts 推進到 redeemed
     gift_cancelled  訂單取消       → gifts 推進到 cancelled
     design_order    客製訂單成立   → design_submissions 回填 order_no
                     (非禮物的一般客製訂單走這支)

   回應約定:
     200  已受理或已處理過 —— 請勿重試
     401  金鑰不符
     500  我方暫時性錯誤 —— 請依退避策略重試

   我方刻意「資料對不上也回 200」:那種情況重試 24 小時也不會變好,
   事件已完整留在 webhook_events,由我方事後補處理。
   ============================================================= */

// ⚠ 只在 Dashboard 填,不要提交回 GitHub
const FALLBACK_WEBHOOK_KEY = '';

const WEBHOOK_KEY = Deno.env.get('SHOP_WEBHOOK_KEY') || FALLBACK_WEBHOOK_KEY;

/* Supabase 自動注入 Edge Function,不需要設 Secrets */
const SB_URL = Deno.env.get('SUPABASE_URL') || '';
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function reply(http: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status: http, headers: HEADERS });
}

/* 定時比較。用 === 比字串會在第一個不同的字元就返回,
   理論上可由回應時間逐字元推出金鑰。成本很低,就做。 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---------- Supabase REST 薄包裝 ---------- */

async function sb(path: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(SB_URL + '/rest/v1/' + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SB_KEY,
      'Authorization': 'Bearer ' + SB_KEY,
      ...(init.headers || {}),
    },
  });
}

/** 寫入冪等紀錄。回 false 表示這個 event_id 已經處理過 */
async function claimEvent(eventId: string, event: string, payload: unknown): Promise<boolean> {
  const r = await sb('webhook_events', {
    method: 'POST',
    headers: { 'Prefer': 'return=minimal' },
    body: JSON.stringify({ event_id: eventId, event, payload }),
  });
  if (r.ok) return true;
  const txt = await r.text();
  // 23505 = unique_violation,代表主鍵撞了 → 已處理過
  if (r.status === 409 || txt.includes('23505')) return false;
  throw new Error('冪等紀錄寫入失敗 ' + r.status + ' ' + txt.slice(0, 200));
}

async function finishEvent(eventId: string, result: string, note?: string) {
  await sb('webhook_events?event_id=eq.' + encodeURIComponent(eventId), {
    method: 'PATCH',
    headers: { 'Prefer': 'return=minimal' },
    body: JSON.stringify({ result, note: note || null }),
  });
}

/* ---------- 禮物狀態事件 ---------- */

/* 每種事件允許從哪些狀態進來。
   ---------------------------------------------------------------
   不做這個檢查的話,亂序抵達的事件會把狀態往回推 ——
   webhook 沒有順序保證,shipped 比 paid 早到是有可能的。
   條件更新(status=in.(...))讓資料庫來把關,不是在程式裡先讀再寫。 */
const GIFT_TRANSITIONS: Record<string, { from: string[]; to: string; stamp?: string }> = {
  gift_paid:      { from: ['pending_payment'],                 to: 'paid',      stamp: 'paid_at' },
  gift_shipped:   { from: ['paid', 'claimed'],                 to: 'shipped',   stamp: 'shipped_at' },
  gift_redeemed:  { from: ['issued', 'claimed'],               to: 'redeemed',  stamp: 'redeemed_at' },
  gift_cancelled: { from: ['pending_payment', 'paid'],         to: 'cancelled' },
};

async function handleGiftEvent(event: string, body: Record<string, any>) {
  const t = GIFT_TRANSITIONS[event];
  const giftId = String(body.gift_id || '').trim();
  if (!giftId) return { result: 'mismatch', note: '缺少 gift_id' };

  const patch: Record<string, unknown> = { status: t.to };
  if (t.stamp) patch[t.stamp] = new Date().toISOString();

  // 付款完成時一併記下訂單編號,禮物這條線的 order_no 就有了
  const orderNo = String(body.order_no || '').trim();
  if (event === 'gift_paid' && orderNo) patch.order_trade_no = orderNo;

  const q = 'gifts?id=eq.' + encodeURIComponent(giftId) +
            '&status=in.(' + t.from.join(',') + ')';
  const r = await sb(q, {
    method: 'PATCH',
    headers: { 'Prefer': 'return=representation' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error('禮物狀態更新失敗 ' + r.status + ' ' + (await r.text()).slice(0, 200));

  const rows = await r.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    // 兩種可能:查無此禮物,或它已經不在允許的來源狀態(重複/亂序事件)
    return { result: 'mismatch', note: `gift ${giftId} 不在 ${t.from.join('/')} 狀態,未更新` };
  }

  await sb('gift_events', {
    method: 'POST',
    headers: { 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      gift_id: giftId,
      from_status: null,          // 條件更新拿不到舊值,靠 payload 追溯
      to_status: t.to,
      actor: 'shop-webhook',
      note: event,
      payload: body,
    }),
  });

  return { result: 'ok', note: `gift ${giftId} → ${t.to}` };
}

/* ---------- 客製訂單成立:回填 order_no ---------- */

/* ⚠ 這裡的比對有一個已知的不精確之處,已同步向商城提出:
   商城回拋的是 design_id + nid + sid,而 design_id 是【刻圖作品】的編號,
   不是【這一次送出】的編號 —— 同一張刻圖被同一個人重複送出時,
   光靠這三個欄位分不出是哪一筆。

   目前的處理:取該會員最近一筆「同 design_id + 同 nid 且尚未有 order_no」
   的送單紀錄。實務上客人不會在同一分鐘內用同一張刻圖對同一件商品下兩單,
   但這是機率問題不是保證。

   根治要商城回拋一個由我方產生、對每次送出唯一的識別碼。已提出。 */
async function handleDesignOrder(body: Record<string, any>) {
  const orderNo  = String(body.order_no || '').trim();
  const designId = String(body.design_id || '').trim();
  const nid      = Number(body.nid);
  const erpid    = String(body.client_id || body.erpid || '').trim();

  if (!orderNo) return { result: 'mismatch', note: '缺少 order_no' };
  if (!designId && !erpid) return { result: 'mismatch', note: '缺少 design_id 與 client_id,無從比對' };

  let q = 'design_submissions?order_no=is.null&succeeded=is.true' +
          '&order=created_at.desc&limit=1&select=id';
  if (designId) q += '&design_id=eq.' + encodeURIComponent(designId);
  if (Number.isFinite(nid) && nid > 0) q += '&nid=eq.' + nid;
  if (erpid) q += '&erpid=eq.' + encodeURIComponent(erpid);

  const found = await sb(q);
  if (!found.ok) throw new Error('查詢送單紀錄失敗 ' + found.status);
  const rows = await found.json();

  if (!Array.isArray(rows) || rows.length === 0) {
    return { result: 'mismatch', note: `找不到對應的送單紀錄(design_id=${designId} nid=${nid})` };
  }

  const r = await sb('design_submissions?id=eq.' + encodeURIComponent(rows[0].id), {
    method: 'PATCH',
    headers: { 'Prefer': 'return=minimal' },
    body: JSON.stringify({ order_no: orderNo }),
  });
  if (!r.ok) throw new Error('回填 order_no 失敗 ' + r.status);

  return { result: 'ok', note: `submission ${rows[0].id} → ${orderNo}` };
}

/* ---------- 入口 ---------- */

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { code: '405', message: '只接受 POST' });

  if (!WEBHOOK_KEY) {
    console.error('[shop-webhook] 缺少金鑰:請設 SHOP_WEBHOOK_KEY 或填 FALLBACK_WEBHOOK_KEY');
    return reply(500, { code: '500', message: '系統設定不完整' });
  }
  const got = req.headers.get('x-lohas-webhook-key') || '';
  if (!safeEqual(got, WEBHOOK_KEY)) {
    console.warn('[shop-webhook] 金鑰不符,來源 ' + (req.headers.get('x-forwarded-for') || 'unknown'));
    return reply(401, { code: '401', message: '驗證失敗' });
  }

  let body: Record<string, any>;
  try { body = await req.json(); }
  catch { return reply(200, { code: '006', message: '請求格式錯誤,不需重試' }); }

  const eventId = String(body.event_id || '').trim();
  const event   = String(body.event || '').trim();
  if (!eventId || !event) {
    return reply(200, { code: '006', message: '缺少 event_id 或 event,不需重試' });
  }

  /* 冪等:先卡位再處理。順序反過來的話,重試會在前一次還沒寫完時
     擠進來做第二次。 */
  let fresh: boolean;
  try {
    fresh = await claimEvent(eventId, event, body);
  } catch (e) {
    console.error('[shop-webhook] 冪等紀錄失敗:', e instanceof Error ? e.message : e);
    return reply(500, { code: '500', message: '暫時性錯誤,請重試' });
  }
  if (!fresh) {
    return reply(200, { code: '200', message: '此事件已處理過' });
  }

  try {
    let out: { result: string; note: string };

    if (GIFT_TRANSITIONS[event]) {
      out = await handleGiftEvent(event, body);
    } else if (event === 'design_order') {
      out = await handleDesignOrder(body);
    } else {
      // 未知事件不重試 —— 對方重送 24 小時也不會變成我方認得的事件。
      // payload 已留底,需要時再補處理。
      out = { result: 'skipped', note: '未支援的事件:' + event };
    }

    await finishEvent(eventId, out.result, out.note);
    console.log('[shop-webhook] ' + event + ' ' + out.result + ' ' + out.note);
    return reply(200, { code: '200', message: '已受理' });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[shop-webhook] 處理失敗:', msg);
    /* 這裡回 500 是刻意的:走到這代表我方資料庫出問題,重試會成功。
       但冪等紀錄已經寫進去了,重試會被當成「已處理」擋掉 ——
       所以要把它刪掉,讓下一次重試能真的重跑。 */
    await sb('webhook_events?event_id=eq.' + encodeURIComponent(eventId), { method: 'DELETE' })
      .catch(() => {});
    return reply(500, { code: '500', message: '暫時性錯誤,請重試' });
  }
});
