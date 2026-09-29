/* =============================================================
   Supabase Edge Function: shop-webhook
   -------------------------------------------------------------
   接收商城（即時互動）的付款完成與訂單狀態事件。

   部署：Supabase Dashboard → Edge Functions → shop-webhook
        Verify JWT【關閉】—— 呼叫方是商城，不會帶 Supabase JWT。
        驗證改用下方的自訂 Header 金鑰。

   ⚠ 金鑰【只讀 Secrets】，不再有程式內的備援值。
     2026-08-21 移除原本寫死的 FALLBACK_WEBHOOK_KEY —— 那把值曾出現在
     原始碼與通訊軟體中，已隨本次一併輪替。

     有備援值的問題不是「不安全」而已，是【Secret 沒設也不會有人發現】：
     函式照常運作、測試照樣通過，直到有人翻原始碼才知道用的是寫死那把。
     沒有備援時，Secret 一漏設就會立刻回 500，那是好事。

   ⚠ 因此【設定 Secret 必須早於本次部署】。順序反過來會讓函式直接 500。
     可用下方的 GET 自檢確認設定狀態（不回傳金鑰本身）。

   給商城的介面說明：
     POST https://hqdmyxxrskvllkcedybl.supabase.co/functions/v1/shop-webhook
     Header: X-Lohas-Webhook-Key: <金鑰>
     Body  : { event_id, event, ... }

   自檢（不需金鑰，只回設定狀態）：
     GET  https://hqdmyxxrskvllkcedybl.supabase.co/functions/v1/shop-webhook

   支援的事件（event）：
     gift_paid       禮物付款完成   → gifts 推進到 paid
     gift_shipped    禮物已出貨     → gifts 推進到 shipped
     gift_redeemed   門市已核銷     → gifts 推進到 redeemed
     gift_cancelled  訂單取消       → gifts 推進到 cancelled
     design_order    客製訂單成立   → design_submissions 回填 order_no
                     （非禮物的一般客製訂單走這支）

   回應約定：
     200  已受理或已處理過 —— 請勿重試
     401  金鑰不符
     500  我方暫時性錯誤 —— 請依退避策略重試

   我方刻意「資料對不上也回 200」：那種情況重試 24 小時也不會變好，
   事件已完整留在 webhook_events，由我方事後補處理。
   ============================================================= */

const WEBHOOK_KEY = Deno.env.get('SHOP_WEBHOOK_KEY') || '';

/* Supabase 自動注入 Edge Function，不需要設 Secrets */
const SB_URL = Deno.env.get('SUPABASE_URL') || '';
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function reply(http: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status: http, headers: HEADERS });
}

/* 定時比較。用 === 比字串會在第一個不同的字元就返回，
   理論上可由回應時間逐字元推出金鑰。成本很低，就做。 */
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
  // 23505 = unique_violation，代表主鍵撞了 → 已處理過
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
   不做這個檢查的話，亂序抵達的事件會把狀態往回推 ——
   webhook 沒有順序保證，shipped 比 paid 早到是有可能的。
   條件更新（status=in.(...)）讓資料庫來把關，不是在程式裡先讀再寫。 */
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

  // 付款完成時一併記下訂單編號，禮物這條線的 order_no 就有了
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
    // 兩種可能：查無此禮物，或它已經不在允許的來源狀態（重複/亂序事件）
    return { result: 'mismatch', note: `gift ${giftId} 不在 ${t.from.join('/')} 狀態，未更新` };
  }

  await sb('gift_events', {
    method: 'POST',
    headers: { 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      gift_id: giftId,
      from_status: null,          // 條件更新拿不到舊值，靠 payload 追溯
      to_status: t.to,
      actor: 'shop-webhook',
      note: event,
      payload: body,
    }),
  });

  return { result: 'ok', note: `gift ${giftId} → ${t.to}` };
}

/* ---------- 客製訂單成立：回填 order_no ---------- */

/* 比對優先用 submission_id —— 那是 shop 函式在送出 cart/push 當下產生的，
   而且就是 design_submissions 那一列的主鍵，一對一，沒有模糊空間。
   商城 2026-08-17 來文確認會原樣保存並回拋。

   退路是舊的模糊比對（design_id + nid + erpid，取最近一筆未成交的），
   保留它是為了兩種情況：submission_id 上線前送出、但之後才付款完成的訂單；
   以及商城那側尚未開始回傳該欄位的過渡期。
   ⚠ 那條路是機率不是保證 —— 同一個人用同一張刻圖對同一件商品送兩次就分不出來。
   兩邊都上線之後，退路應該不會再被走到，若 log 出現 fuzzy 就要查。 */
async function handleDesignOrder(body: Record<string, any>) {
  const orderNo      = String(body.order_no || '').trim();
  const submissionId = String(body.submission_id || '').trim();
  const designId     = String(body.design_id || '').trim();
  const nid          = Number(body.nid);
  const erpid        = String(body.client_id || body.erpid || '').trim();

  if (!orderNo) return { result: 'mismatch', note: '缺少 order_no' };

  let target = '';
  let how = '';

  if (submissionId) {
    const r = await sb('design_submissions?id=eq.' + encodeURIComponent(submissionId) +
                       '&select=id,order_no');
    if (!r.ok) throw new Error('查詢送單紀錄失敗 ' + r.status);
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return { result: 'mismatch', note: `submission_id ${submissionId} 查無此筆` };
    }
    if (rows[0].order_no && rows[0].order_no !== orderNo) {
      return { result: 'mismatch', note: `submission ${submissionId} 已對應 ${rows[0].order_no}，拒絕覆蓋` };
    }
    target = rows[0].id;
    how = 'submission_id';

  } else {
    /* 🚨 重試時先找「已經回填過這個訂單編號」的那一筆。
       -----------------------------------------------------------
       下面的模糊比對只找 order_no 還是空的。情境:
         第一次:回填 order_no 成功 → 搬眼鏡盒進加工中心失敗 → 回 500
         商城重試:模糊比對跳過那一筆(它已經有 order_no 了)→ mismatch
       → 回 200、商城不再重試 → 客人付了錢,盒子永遠進不了加工中心。
       先用 order_no 找一次,重試就會回到同一筆。 */
    const again = await sb('design_submissions?order_no=eq.' + encodeURIComponent(orderNo) +
                           '&select=id&limit=1');
    if (!again.ok) throw new Error('查詢送單紀錄失敗 ' + again.status);
    const againRows = await again.json();
    if (Array.isArray(againRows) && againRows.length) {
      const t = againRows[0].id;
      const moved = await moveCaseToLab(t, orderNo);
      return { result: 'ok', note: `submission ${t} → ${orderNo}（retry）` + moved };
    }

    if (!designId && !erpid) {
      return { result: 'mismatch', note: '缺少 submission_id、design_id 與 client_id，無從比對' };
    }
    let q = 'design_submissions?order_no=is.null&succeeded=is.true' +
            '&order=created_at.desc&limit=1&select=id';
    if (designId) q += '&design_id=eq.' + encodeURIComponent(designId);
    if (Number.isFinite(nid) && nid > 0) q += '&nid=eq.' + nid;
    /* client_id 可能是 ERP 客編,也可能是官網會員編號(mid)——
       shop 函式在 ALLOW_MID_CHECKOUT 打開時會用 mid 當 client_id。
       原本只比 erpid 欄,mid 的單【永遠對不上】,而且回的是 mismatch
       不是錯誤,不會有人發現。兩欄都比。
       ⚠ 只接受英數,因為要拼進 or=(...) 的語法裡。 */
    if (erpid && /^[A-Za-z0-9_-]+$/.test(erpid)) {
      q += '&or=(erpid.eq.' + erpid + ',mid.eq.' + erpid + ')';
    } else if (erpid) {
      q += '&erpid=eq.' + encodeURIComponent(erpid);
    }

    const found = await sb(q);
    if (!found.ok) throw new Error('查詢送單紀錄失敗 ' + found.status);
    const rows = await found.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return { result: 'mismatch', note: `找不到對應的送單紀錄（design_id=${designId} nid=${nid}）` };
    }
    target = rows[0].id;
    how = 'fuzzy';
    console.warn('[shop-webhook] 未帶 submission_id，改用模糊比對 → ' + target);
  }

  const r = await sb('design_submissions?id=eq.' + encodeURIComponent(target), {
    method: 'PATCH',
    headers: { 'Prefer': 'return=minimal' },
    body: JSON.stringify({ order_no: orderNo }),
  });
  if (!r.ok) throw new Error('回填 order_no 失敗 ' + r.status);

  /* 眼鏡盒:搬進加工中心(待確認)。太陽眼鏡不走這裡。 */
  const moved = await moveCaseToLab(target, orderNo);

  return { result: 'ok', note: `submission ${target} → ${orderNo}（${how}）` + moved };
}

/* ---------- 眼鏡盒:付款通知進來 → 搬進加工中心 ----------

   🚨 搬進去的狀態是 'hold'(待確認),【不是】'new'(待製作)。
   -----------------------------------------------------------------
   商城無法針對單一商品關閉付款方式,而這個通知【只代表訂單成立】,
   裡面沒有付款狀態、取貨門市、數量。所以:
     · 選取貨付款的客人還沒付錢
     · 客人可能在商城選了另一家門市
     · 客人可能把數量改成 2
   三件都要人去商城後台用 order_no 查一次,確認後才放行給師傅。
   hold 的單師傅【看不到】(cloth-admin 對通行碼那條路擋掉)。

   ⚠ 失敗要 throw,不要吞掉。
     這裡失敗代表「客人付了錢、盒子卻沒進加工中心」。throw 之後
     入口會回 500、刪掉冪等紀錄,商城重試時會再跑一次;
     order_no 已經回填過,重試時 submission_id 那條路會對到同一筆,
     而 cloth_designs 的 submission_id 有 unique 約束,不會變成兩個盒子。 */
async function moveCaseToLab(submissionId: string, orderNo: string): Promise<string> {
  const r = await sb('design_submissions?id=eq.' + encodeURIComponent(submissionId) +
    '&select=product,source,erpid,mid,member_name,design_id,design_name,' +
    'engraving_url,preview_url,placement,store_erpid,store_name,store_city');
  if (!r.ok) throw new Error('讀取送單紀錄失敗 ' + r.status);
  const rows = await r.json();
  const s = Array.isArray(rows) ? rows[0] : null;
  if (!s || s.product !== 'case') return '';        // 不是眼鏡盒

  /* cloth_designs.design_id 是 uuid 欄位,design_submissions 的是 text。
     刻圖市集的編號是 uuid;自己畫的是空字串 → 存 null。
     ⚠ 不是 uuid 的東西硬塞進去,整筆 insert 會失敗 —— 那是一個
       付了錢卻進不了加工中心的盒子。 */
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const designId = UUID.test(String(s.design_id || '')) ? s.design_id : null;

  const row = {
    product:       'case',
    status:        'hold',
    submission_id: submissionId,
    order_no:      orderNo,
    erpid:         s.erpid || null,
    mid:           s.mid || null,
    member_name:   s.member_name || null,
    source:        s.source === 'market' ? 'market' : 'draw',
    design_id:     designId,
    design_name:   s.design_name || null,
    svg_url:       s.engraving_url,
    preview_url:   s.preview_url,
    placement:     s.placement || null,
    store_erpid:   s.store_erpid,
    store_name:    s.store_name || null,
    store_city:    s.store_city || null,
  };

  /* on_conflict + ignore-duplicates:同一筆送單第二次進來時什麼都不做。
     重試、商城重送都會走到這裡,不能變成第二個盒子。 */
  const ins = await sb('cloth_designs?on_conflict=submission_id', {
    method: 'POST',
    headers: { 'Prefer': 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(row),
  });
  if (!ins.ok) {
    const txt = await ins.text();
    throw new Error('眼鏡盒搬進加工中心失敗 ' + ins.status + ' ' + txt.slice(0, 200));
  }
  console.log('[shop-webhook] 眼鏡盒進加工中心(待確認) submission=' + submissionId + ' order=' + orderNo);
  return ' · 眼鏡盒已進待確認';
}

/* ---------- 入口 ---------- */

Deno.serve(async (req) => {
  /* 自檢：不需金鑰，只回設定狀態，不回傳金鑰本身。
     移除備援值之後，「Secret 有沒有設」變成會直接影響服務的事，
     所以要有一個不必真的送事件就能確認的方法。 */
  if (req.method === 'GET') {
    return reply(200, {
      function: 'shop-webhook',
      /* 線上實際跑的是哪一版。2026-08-28 那次事故的根本原因就是
         「從外面看不出線上是哪一版」。每改一次就更新這個字串。 */
      code_version: '2026-09-29 · 眼鏡盒進待確認',
      設定完整: WEBHOOK_KEY !== '' && SB_URL !== '' && SB_KEY !== '',
      SHOP_WEBHOOK_KEY: WEBHOOK_KEY === '' ? '✗ 未設定' : '✓ 已設定（長度 ' + WEBHOOK_KEY.length + '）',
      SUPABASE_URL: SB_URL === '' ? '✗ 未注入' : '✓',
      SUPABASE_SERVICE_ROLE_KEY: SB_KEY === '' ? '✗ 未注入' : '✓',
      說明: '此端點只回設定狀態，不回傳金鑰。實際事件請用 POST 並帶 X-Lohas-Webhook-Key。',
    });
  }

  if (req.method !== 'POST') return reply(405, { code: '405', message: '只接受 POST' });

  if (!WEBHOOK_KEY) {
    console.error('[shop-webhook] 缺少金鑰：請在 Dashboard 設定 Secret SHOP_WEBHOOK_KEY');
    return reply(500, { code: '500', message: '系統設定不完整' });
  }
  const got = req.headers.get('x-lohas-webhook-key') || '';
  if (!safeEqual(got, WEBHOOK_KEY)) {
    console.warn('[shop-webhook] 金鑰不符，來源 ' + (req.headers.get('x-forwarded-for') || 'unknown'));
    return reply(401, { code: '401', message: '驗證失敗' });
  }

  let body: Record<string, any>;
  try { body = await req.json(); }
  catch { return reply(200, { code: '006', message: '請求格式錯誤，不需重試' }); }

  const eventId = String(body.event_id || '').trim();
  const event   = String(body.event || '').trim();
  if (!eventId || !event) {
    return reply(200, { code: '006', message: '缺少 event_id 或 event，不需重試' });
  }

  /* 冪等：先卡位再處理。順序反過來的話，重試會在前一次還沒寫完時
     擠進來做第二次。 */
  let fresh: boolean;
  try {
    fresh = await claimEvent(eventId, event, body);
  } catch (e) {
    console.error('[shop-webhook] 冪等紀錄失敗：', e instanceof Error ? e.message : e);
    return reply(500, { code: '500', message: '暫時性錯誤，請重試' });
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
      // payload 已留底，需要時再補處理。
      out = { result: 'skipped', note: '未支援的事件：' + event };
    }

    await finishEvent(eventId, out.result, out.note);
    console.log('[shop-webhook] ' + event + ' ' + out.result + ' ' + out.note);
    return reply(200, { code: '200', message: '已受理' });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[shop-webhook] 處理失敗：', msg);
    /* 這裡回 500 是刻意的：走到這代表我方資料庫出問題，重試會成功。
       但冪等紀錄已經寫進去了，重試會被當成「已處理」擋掉 ——
       所以要把它刪掉，讓下一次重試能真的重跑。 */
    await sb('webhook_events?event_id=eq.' + encodeURIComponent(eventId), { method: 'DELETE' })
      .catch(() => {});
    return reply(500, { code: '500', message: '暫時性錯誤，請重試' });
  }
});