/* =============================================================
   Supabase Edge Function: gift
   -------------------------------------------------------------
   禮物中心的唯一資料入口。

   為什麼所有事都得經過這裡:
     gifts 存了領取碼與收禮人聯絡方式,RLS 全鎖、anon 完全讀不到。
     前端拿的 anon key 是公開的(GitHub Pages),不可能讓它直接碰這張表。
     本函式用 service_role 連線(繞過 RLS),並自行做身分與權限判斷。

   兩條履約路徑:
     ship   宅配到府 —— 收件地址由送禮者在商城結帳時填,官網完全不碰
     store  門市兌換 —— 確定收禮人後,官網呼叫商城發券,到門市核銷

   部署:Supabase Dashboard → Edge Functions → 新增 gift → 貼上本檔
        Verify JWT 要【關閉】(前端沒有 Supabase 使用者,身分靠自家 session token)

   環境變數:
     SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  → Supabase 自動注入,不用設
     SITE_ORIGIN(選填)→ 產生領取連結用,預設 https://www.lohasglasses.com
     SITE_API_KEY → 呼叫主後端 siteapi/gift/issue 發券用(與 coupon-list 同一把)
     TICKET_BASE_URL(選填)→ 主後端位址,預設正式站 https://lohas.realtime.tw
     GIFT_CENTER_ITEM_ID(選填)→ 票券中心的禮物型品項編號,預設 2

   action 一覽:
     list     我送出的 / 我收到的            需 token
     create   建立禮物(狀態 pending_payment) 需 token
     preview  用領取碼看禮物長怎樣            不需 token(領取碼本身就是憑證)
     claim    領取(綁到自己帳號)            需 token
     pick     收禮人挑鏡框與刻圖(B 路線)     需 token
     cancel   送禮者取消(僅限尚未付款)       需 token
   ============================================================= */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SITE_ORIGIN  = Deno.env.get('SITE_ORIGIN') || 'https://www.lohasglasses.com';
const AUTH_FN      = `${SUPABASE_URL}/functions/v1/auth-session`;

/* ---------- 發券(主後端) ----------
   ⚠ gift/issue 在【主後端】siteapi/*,不是商城。
     金鑰因此是 SITE_API_KEY(coupon-list、member-auth 用的那把),
     不是商城的 SHOP_SITE_API_KEY。兩者混用的症狀是全部回 403。

   位址預設【正式站】。對方目前只在測試站開通,所以現階段這支呼叫
   會失敗 —— 那是可以接受的,見 issueCoupon() 的說明。 */
const TICKET_BASE = (Deno.env.get('TICKET_BASE_URL') || 'https://lohas.realtime.tw')
  .replace(/\/+$/, '');
const SITE_KEY = Deno.env.get('SITE_API_KEY') || '';

/* 票券中心裡「禮物型」品項的編號。
   對方限定只有明確勾選過禮物型的品項才能用這支端點發券
   (錯誤碼 ITEM_NOT_GIFT),所以這個值不能亂填。

   ⚠ 兩站的編號【不同】:測試站是 2,正式站是 7(客製太陽眼鏡體驗券)。
     這裡取正式站的值 —— 我方 2026-08-19 起一律走正式站。
     8/20 寫成 2 是照對方測試站的來文填的,當時沒有正式站的值。
     真要切回測試站的話用 GIFT_CENTER_ITEM_ID 覆蓋,不必改程式。 */
const CENTER_ITEM_ID = Number(Deno.env.get('GIFT_CENTER_ITEM_ID') || 7);

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
type Who = { erpid: string; mid: string };

/* 2026-08-20:改回傳 erpid 與 mid 兩者。
   -----------------------------------------------------------
   官網註冊的會員沒有 ERP 客編,只有 mid。在此之前這種人連
   【領取禮物】都做不到 —— 而收禮人正是最可能還不是會員的一群。

   主後端已確認:以 mid 發出的票券記在 owner_mid,該會員日後到門市
   綁定客編時會自動搬到 client_id 並清空 owner_mid,兩邊都查得到。
   所以「未綁定也能領」在票券那一端是成立的,卡點只在我方。

   ⚠ 但不是每個動作都能放寬,見下方各動作的守門。 */
async function whoFromToken(token: string): Promise<Who | null> {
  if (!token) return null;
  try {
    const r = await fetch(AUTH_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify', token }),
    });
    const j = await r.json();
    if (String(j?.code) !== '200') return null;
    // auth-session 的成功回應欄位名未經確認,這裡容錯取值。
    const rawErp =
      j?.data?.erpid ?? j?.data?.client_id ?? j?.data?.member?.client_id ??
      j?.erpid ?? j?.client_id ?? j?.member?.client_id ?? '';
    const rawMid = j?.data?.mid ?? j?.mid ?? '';
    const erpid = String(rawErp || '').trim();
    const mid = String(rawMid || '').trim();
    if (!erpid && !mid) return null;      // 兩個都沒有才是真的無身分
    return { erpid, mid };
  } catch {
    return null;
  }
}

/* 需要 ERP 客編的動作統一用這句擋。
   措辭與前端的 LohasAuth.erpRequiredNote() 一致 ——
   同一件事在兩個地方講成兩種說法,客服會收到兩種問題。 */
function needErp() {
  return reply('403', {
    reason: 'erp_required',
    message: '這項功能需要門市會員身分。第一次到樂活門市時,店員會協助你完成綁定,不需另外準備什麼。',
  }, 403);
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

/* 手機號碼正規化,讓 09xx 與 +8869xx 視為同一支 */
function normPhone(v: string): string {
  const d = String(v || '').replace(/[^0-9]/g, '');
  if (d.startsWith('8869') && d.length === 12) return '0' + d.slice(3);
  return d;
}

/* 只放行我方 Storage 上的圖片網址。
   ---------------------------------------------------------------
   合成圖會顯示在領取頁、加工位置圖會給門市人員下載。若接受任意網址,
   這支介面就成了「把外部連結種進禮物」的管道 —— 收禮人或門市人員
   點下去的東西,就不是我方能保證的了。
   我方自己產的圖一律在 Supabase Storage,鎖死這個 host 沒有副作用。 */
const ASSET_HOST = 'hqdmyxxrskvllkcedybl.supabase.co';

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

/* 對外欄位白名單。
   收禮人聯絡方式與內部欄位一律不出去 —— 送禮者只該知道「領了沒」,
   不該拿到對方的手機或姓名(對方可能根本不是他原本要送的人)。 */
function publicGift(g: Record<string, any>, viewer: 'sender' | 'recipient' | 'anon') {
  const base = {
    id: g.id,
    status: g.status,
    fulfillment: g.fulfillment,
    design_id: g.design_id,
    design_name: g.design_name,
    design_image_url: g.design_image_url,
    /* 合成圖對外開放,那是收禮人該看到的東西。
       guide_url 刻意不放 —— 那是給加工人員的位置指示圖,
       走管理後台取用,沒有理由出現在任何前台介面。 */
    preview_url: g.preview_url,
    product_title: g.product_title,
    product_spec_title: g.product_spec_title,
    product_image: g.product_image,
    engrave_placement: g.engrave_placement,
    message: g.message,
    sender_name: g.sender_name,
    recipient_label: g.recipient_label,
    created_at: g.created_at,
    paid_at: g.paid_at,
    claimed_at: g.claimed_at,
    issued_at: g.issued_at,
    shipped_at: g.shipped_at,
    redeemed_at: g.redeemed_at,
    expires_at: g.expires_at,
  };
  if (viewer === 'sender') {
    return {
      ...base,
      /* 商品編號只給送禮人。
         用途是「待付款的禮物要能再推一次購物車」——
         建立成功但 cart/push 失敗時(關掉分頁、網路斷、商城拒絕),
         禮物會停在待付款,而送禮人手上沒有任何能回到付款的東西。

         不給收禮人:他不需要,而且那是送禮人買的東西。
         nid 本身是商城的公開商品編號,不是機密。 */
      product_nid: g.product_nid,
      product_sid: g.product_sid,
      recipient_mode: g.recipient_mode,
      claim_code: g.claim_code,
      claim_url: g.claim_code ? `${SITE_ORIGIN}/gift-claim.html?c=${g.claim_code}` : null,
      order_trade_no: g.order_trade_no,
    };
  }
  if (viewer === 'recipient') {
    return { ...base, coupon_id: g.coupon_id };
  }
  return base;   // anon:只看得到禮物長相與稱呼,看不到任何人的資料
}

/**
 * 把「指定給我、但還沒綁定」的禮物認回來。
 *
 * 送禮者填的是會員編號或手機,建立當下官網不查(不做探測工具),
 * 所以認領這件事延到本人登入時才做 —— 比對的是「我自己的」號碼,
 * 不會洩漏任何別人的資訊。
 */
/**
 * 綁定門市會員之後,把以 mid 領取的禮物搬到客編底下。
 *
 * 這是主後端 owner_mid 回填的鏡像。少了它,門市用會員編號查刻圖
 * 會查不到那份禮物 —— 而那正是 B 路線最後一哩路要用的東西。
 *
 * 【搬過去並清空 mid】,不是兩欄都留:
 * 兩欄同時有值的話,這個人日後解除綁定,兩個身分會各自
 * 從不同欄位看到同一份禮物。主後端的取捨也是如此。
 *
 * 觸發時機是本人下一次帶著 token 進來(list)。店員在櫃檯剛綁完時
 * 資料還沒搬,請客人在手機上開一次會員專區即可。
 */
async function backfillMidGifts(erpid: string, mid: string) {
  if (!erpid || !mid) return;
  try {
    await db.from('gifts')
      .update({ claimed_by_erpid: erpid, claimed_by_mid: null })
      .eq('claimed_by_mid', mid);
  } catch { /* 搬不動下次進頁再試,不影響這一次的查詢 */ }
}

/**
 * 補發券:收禮人打開禮物中心時,幫他把上次沒發成的券補上。
 *
 * 為什麼是這種做法:
 *   我方沒有排程器可以跑重試佇列,而加一套 pg_cron 只為了這件事
 *   太重。收禮人本來就會回來看「我的券好了沒」—— 那正是最自然的
 *   重試時機,而且只有真的有人在等的禮物才會被重試。
 *
 * 一次只補一份,而且要求 claimed 超過一分鐘:
 *   claim 當下已經試過一次,立刻再試多半是同一個結果;
 *   一次只補一份則是為了不要讓禮物中心的載入被好幾次外部呼叫拖住。
 *   剩下的下次進頁再補,反正他還會回來。
 */
async function retryIssue(rows: Record<string, any>[]) {
  const cutoff = Date.now() - 60 * 1000;
  const target = rows.find((g) =>
    g.status === 'claimed' &&
    g.fulfillment === 'store' &&
    !g.coupon_id &&
    g.claimed_at && new Date(g.claimed_at).getTime() < cutoff
  );
  if (!target) return;

  const res = await issueCoupon(target);
  if (res.ok) {
    const updated = await applyIssued(target, res.couponId, res.already);
    // 就地換掉,讓這一次的回應就看得到新狀態,不必再重整一次
    Object.assign(target, updated);
  } else if (!res.retryable) {
    // 不可重試的錯誤要留下明確紀錄,不然它會被每次進頁重試洗掉
    console.error('[gift] 補發券失敗且不可重試 ' + target.id + ' code=' + res.code);
  }
}

async function bindPending(erpid: string, token: string) {
  const keys = [erpid];

  // 手機要從 auth-session 的 profile 拿。拿不到就只用會員編號比對,
  // 手機指定的那批會退回連結領取,不影響其他人。
  try {
    const r = await fetch(AUTH_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'profile', token }),
    });
    const j = await r.json();
    if (String(j?.code) === '200') {
      const p = j?.data?.member ?? j?.data ?? j?.member ?? {};
      const phone = normPhone(p.phone ?? p.mobile ?? p.cellphone ?? '');
      if (phone) keys.push(phone);
    }
  } catch { /* profile 拿不到不是致命問題 */ }

  try {
    await db.from('gifts')
      .update({ recipient_erpid: erpid })
      .is('recipient_erpid', null)
      .in('recipient_key', keys)
      .neq('sender_erpid', erpid)                 // 不可能送給自己
      .not('status', 'in', '("cancelled","expired")');
  } catch { /* 綁定失敗下次進頁會再試 */ }
}

/* ---------- 發券 ----------
   門市自取的禮物,收禮人領取後要在票券中心發一張兌換券給他。

   === 為什麼失敗不是災難 ===
   依雙方約定「發券失敗不退回可領取狀態」:claimed(歸屬)與
   issued(發券)是兩個狀態,歸屬已定不可逆。退回的話,禮物會在
   重試期間被其他持有連結的人領走 —— 那比晚幾分鐘拿到券嚴重得多。

   所以這支失敗時只留紀錄,禮物停在 claimed,
   收禮人看到「兌換券準備中」,由 list 的重試補上(見 retryIssue)。

   === 現階段預期會失敗 ===
   對方的 gift/issue 目前只在測試站開通,而我方指向正式站。
   這是刻意的:正式站部署後這支會自己通,不必再改一次程式。

   === 冪等 ===
   以 gift_id 為冪等鍵。重複呼叫回同一個 coupon_id 且
   already_issued: true —— 對方以資料表唯一鍵實作,不是先查再寫,
   所以併發下也不會發出兩張。 */
type IssueResult =
  | { ok: true; couponId: number; already: boolean }
  | { ok: false; retryable: boolean; code: string; message: string };

async function issueCoupon(g: Record<string, any>): Promise<IssueResult> {
  if (!SITE_KEY) {
    return { ok: false, retryable: true, code: 'NO_KEY', message: '未設定 SITE_API_KEY' };
  }

  /* client_id 或 mid 擇一。未綁定門市的收禮人只有 mid ——
     對方會把擁有權記在 owner_mid,該會員綁定客編時自動回填。 */
  const owner: Record<string, unknown> = g.claimed_by_erpid
    ? { client_id: Number(g.claimed_by_erpid) }
    : { mid: String(g.claimed_by_mid || '') };
  if (!g.claimed_by_erpid && !g.claimed_by_mid) {
    return { ok: false, retryable: false, code: 'NO_OWNER', message: '這份禮物沒有擁有者' };
  }

  try {
    const r = await fetch(`${TICKET_BASE}/siteapi/gift/issue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Site-Key': SITE_KEY,
      },
      body: JSON.stringify({
        gift_id: g.id,                  // 冪等鍵
        center_item_id: CENTER_ITEM_ID,
        ...owner,
        // expires_at 不帶 = 無期限(雙方 8/14 約定)
        order_no: g.order_trade_no || '',
      }),
      signal: AbortSignal.timeout(10000),
    });

    const j = await r.json();
    const code = String(j?.code ?? r.status);

    if (code === '200' || code === 'OK') {
      const couponId = Number(j?.data?.coupon_id);
      if (!Number.isFinite(couponId) || couponId <= 0) {
        // 回了成功卻沒有券號,這種情況重試沒有意義,要人看
        return { ok: false, retryable: false, code: 'NO_COUPON_ID', message: '發券成功但未回傳券號' };
      }
      return { ok: true, couponId, already: !!j?.data?.already_issued };
    }

    /* ALREADY_ISSUED 視為成功 —— 對方會一併回既有的 coupon_id。
       只當成錯誤的話,我方會永遠停在 claimed 拿不到券號,
       收禮人的 App 看得到券、禮物中心卻顯示「準備中」。 */
    if (code === 'ALREADY_ISSUED') {
      const couponId = Number(j?.data?.coupon_id);
      if (Number.isFinite(couponId) && couponId > 0) {
        return { ok: true, couponId, already: true };
      }
      return { ok: false, retryable: false, code, message: '對方回報已發過但未附券號' };
    }

    /* 未知的代碼一律以 retryable 為準(雙方約定)。
       這樣對方日後新增錯誤碼,我方不必為了分類而改程式。
       retryable 沒帶時保守當成不可重試 —— 無止境地重打一個
       其實不會成功的請求,比停下來要人看更糟。 */
    return {
      ok: false,
      retryable: j?.retryable === true || j?.data?.retryable === true,
      code,
      message: String(j?.message || '發券失敗'),
    };

  } catch (e) {
    // 連線失敗、逾時:這一類重試會好
    return {
      ok: false, retryable: true, code: 'NETWORK',
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

/* 發券成功後把狀態推進到 issued。失敗則原樣留著,不動狀態。 */
async function applyIssued(g: Record<string, any>, couponId: number, already: boolean) {
  const { data: updated, error } = await db.from('gifts')
    .update({
      status: 'issued',
      coupon_id: couponId,
      issued_at: new Date().toISOString(),
    })
    .eq('id', g.id).eq('status', 'claimed')     // 條件更新,不覆蓋別人推進過的狀態
    .select().maybeSingle();

  /* 券已經真的發出去了,這裡失敗只是我方沒記到。
     不能當作沒發過 —— 下次 retryIssue 會再打一次,對方以 gift_id 冪等,
     回的是同一個 coupon_id,所以會自己補正。留下 log 讓人看得到。 */
  if (error) {
    console.error('[gift] 券已發出但狀態寫入失敗 ' + g.id +
                  ' coupon=' + couponId + ' ' + error.message);
  }

  await logEvent(g.id, 'claimed', 'issued', 'system',
    already ? `發券(對方回報已發過)券號 ${couponId}` : `發券成功,券號 ${couponId}`);

  return updated || { ...g, status: 'issued', coupon_id: couponId };
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
    return reply('200', {
      data: { gift: publicGift(g, 'anon'), claimable: g.status === 'paid' },
    });
  }

  /* 以下動作都需要身分。
     有 erpid 或 mid 其中之一即可通過這一關 ——
     個別動作要不要求客編,由各自的守門決定,不在這裡一刀切。 */
  const who = await whoFromToken(String(body.token || ''));
  if (!who) return reply('401', { message: '登入狀態已失效,請重新登入' }, 401);
  const erpid = who.erpid;
  const mid = who.mid;

  /* ---------- list ---------- */
  if (action === 'list') {
    /* 認領待比對的禮物只在有客編時做:送禮人填的是會員編號或手機,
       兩者都對應到客編,沒有客編就沒有東西可比對。
       同時把先前以 mid 領的禮物搬到客編底下(剛綁定的人會走到這裡)。 */
    if (erpid) {
      await Promise.all([
        bindPending(erpid, String(body.token || '')),
        backfillMidGifts(erpid, mid),
      ]);
    }

    /* 收到的禮物:客編與 mid 兩種擁有權都要查。
       未綁定時領的禮物記在 claimed_by_mid,綁定之後新的會記在客編,
       兩邊都列出來才不會在綁定前後「少一半」。 */
    const recvOr = [
      erpid ? `recipient_erpid.eq.${erpid}` : '',
      erpid ? `claimed_by_erpid.eq.${erpid}` : '',
      mid ? `claimed_by_mid.eq.${mid}` : '',
    ].filter(Boolean).join(',');

    /* 收到的那一份用條件式串接,不要用「哨兵值」。
       先前寫成 .neq('sender_erpid', erpid || '…') —— 沒有客編時
       就會拿一個假值去比對,那種寫法遲早會有人挑到真的撞上的值。
       沒有客編的人本來就不可能是送禮人,直接不加這個條件。 */
    let recvQ = db.from('gifts').select('*')
      .or(recvOr)
      .neq('status', 'pending_payment')      // 對方還沒付款的不該出現在我這邊
      .order('created_at', { ascending: false }).limit(100);
    if (erpid) recvQ = recvQ.neq('sender_erpid', erpid);

    const [sentRes, recvRes] = await Promise.all([
      // 送出的禮物一定有客編(建立禮物要付款,付款需要客編)
      erpid
        ? db.from('gifts').select('*')
            .eq('sender_erpid', erpid)
            .order('created_at', { ascending: false }).limit(100)
        : Promise.resolve({ data: [], error: null }),
      recvQ,
    ]);
    if (sentRes.error || recvRes.error) {
      return reply('500', { message: '系統忙碌,請稍後再試' }, 500);
    }

    // 上次沒發成的券,趁他來看的時候補一張(一次一份,見 retryIssue)
    const received = recvRes.data || [];
    await retryIssue(received);

    return reply('200', {
      data: {
        sent: (sentRes.data || []).map((g) => publicGift(g, 'sender')),
        received: received.map((g) => publicGift(g, 'recipient')),
      },
    });
  }

  /* ---------- create ---------- */
  if (action === 'create') {
    // 送禮要在商城付款,商城必須有客編。沒有客編的人建不了禮物。
    if (!erpid) return needErp();

    const fulfillment = body.fulfillment === 'ship' ? 'ship' : 'store';
    const mode = body.recipient_mode === 'member' ? 'member' : 'link';
    const keyRaw = String(body.recipient_key || '').trim();

    if (mode === 'member' && !keyRaw) {
      return reply('006', { message: '請填寫對方的會員編號或手機' }, 400);
    }
    if (mode === 'member' && (keyRaw === erpid || normPhone(keyRaw) === normPhone(erpid))) {
      return reply('031', { message: '不能把禮物送給自己' }, 400);
    }

    // 這裡【不做任何會員查詢】。
    // 官網沒有本地會員名冊(會員資料在即時互動端),要查就得打對方 API,
    // 那等於做出一支「這支號碼是不是會員」的探測工具。
    // 改成:只記下 recipient_key,等對方自己登入禮物中心時由 bindPending() 比對綁定。
    // 同時一律附上領取碼,對方沒登入過也能靠連結領。

    const row = {
      sender_erpid: erpid,
      sender_name: String(body.sender_name || '').slice(0, 60) || null,

      design_id: body.design_id || null,
      design_name: String(body.design_name || '').slice(0, 120) || null,
      design_image_url: String(body.design_image_url || '').slice(0, 500) || null,

      /* 合成圖與加工位置圖。這兩個網址會顯示給收禮人、或供門市人員下載,
         所以只放行我方 Storage 上的網址 —— 若照單全收,任何人都能呼叫
         這支介面把外部連結種進禮物,再讓收禮人或門市人員點下去。 */
      preview_url: ourAssetUrl(body.preview_url),
      guide_url:   ourAssetUrl(body.guide_url),

      product_nid: body.product_nid ? Number(body.product_nid) : null,
      product_sid: body.product_sid ? Number(body.product_sid) : null,
      product_title: String(body.product_title || '').slice(0, 200) || null,
      product_spec_title: String(body.product_spec_title || '').slice(0, 120) || null,
      product_image: String(body.product_image || '').slice(0, 500) || null,

      engrave_placement: body.engrave_placement || null,
      message: String(body.message || '').slice(0, 300) || null,

      fulfillment,
      recipient_mode: mode,
      recipient_key: mode === 'member' ? keyRaw.slice(0, 40) : null,
      recipient_erpid: null,          // 等 bindPending() 比對成功才回填
      recipient_label: String(body.recipient_label || '').slice(0, 40) || null,
      claim_code: newClaimCode(),     // 兩種模式都給,指定失敗時就是退路
      status: 'pending_payment',
    };

    const { data: g, error } = await db.from('gifts').insert(row).select().single();
    if (error) return reply('500', { message: '建立失敗,請稍後再試' }, 500);

    await logEvent(g.id, null, 'pending_payment', 'sender',
      `建立禮物(${fulfillment}/${mode})`);
    return reply('200', { data: { gift: publicGift(g, 'sender') } });
  }

  /* ---------- claim:把禮物綁到自己帳號 ----------
     宅配路徑:商城已依送禮者填的地址出貨,綁定只是為了讓收禮人
               在禮物中心看得到、並把刻圖收進最愛。
     門市路徑:綁定後官網才知道該把兌換券發給誰。 */
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

    if (erpid && g.sender_erpid === erpid) {
      return reply('032', { message: '這是你自己送出的禮物' }, 403);
    }
    // 已指定會員的禮物,只有那個人能領。
    // 沒有客編的人無從證明自己是被指定的那位,一律擋下 ——
    // 放行等於讓任何拿到連結的人領走指名給別人的禮物。
    if (g.recipient_erpid && g.recipient_erpid !== erpid) {
      return reply('033', { message: '這份禮物是指定給其他會員的' }, 403);
    }

    /* 兩條路線都放行給未綁定的會員,B 路線尤其不能擋。
       -----------------------------------------------------------
       B 路線的用意本來就是「未綁定的人也收得到禮物,再把他帶進門市」。
       擋在領取這一關的話,他沒有理由到店裡,那條路線就失去意義了。
       而且第一階段是門市自取 —— 他本來就要去店裡,綁定在那裡順手就做。

       他確實暫時挑不了款式(pick 要送 cart/push,商城需要客編),
       但那不是死路:門市查刻圖對「尚未挑選」的禮物會顯示指引,
       店員綁定後請他當場挑,或綁完自己回官網挑。 */
    if (['claimed', 'issued', 'shipped', 'redeemed'].includes(g.status)) {
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

    // 條件更新:只有仍是 paid 的那一刻才寫得進去。
    // 兩個人同時點領取時,第二個人會更新到 0 筆而不是覆蓋掉第一個人。
    /* 有客編就記客編,沒有就記 mid。
       兩欄不同時寫 —— 同時有值的話,這個人日後解除綁定,
       兩個身分會各自從不同欄位都看得到同一份禮物。
       (主後端的 owner_mid 回填也是同樣的取捨,見對方 8/20 來文) */
    const owner = erpid
      ? { claimed_by_erpid: erpid, recipient_erpid: g.recipient_erpid || erpid }
      : { claimed_by_mid: mid };

    const { data: updated, error: upErr } = await db.from('gifts')
      .update({
        status: 'claimed',
        claimed_at: new Date().toISOString(),
        ...owner,
      })
      .eq('id', g.id).eq('status', 'paid')
      .select().maybeSingle();

    if (upErr) return reply('500', { message: '領取失敗,請稍後再試' }, 500);
    if (!updated) return reply('034', { message: '這份禮物已經領取過了' }, 409);

    await logEvent(g.id, 'paid', 'claimed', 'recipient', '收禮人完成領取');

    /* 刻圖收進對方的「我的最愛刻圖」。失敗不影響領取本身。
       ⚠ 只在有客編時做:收藏表的 member_id 是客編,
       沒有客編就沒有鍵可以寫(見 repo 的收藏改鍵議題)。 */
    if (updated.design_id && erpid) {
      try {
        await db.from('engraving_wishlist')
          .insert({ member_id: erpid, design_id: updated.design_id });
      } catch { /* 已收藏過會撞唯一鍵,忽略 */ }
    }

    /* 門市自取:發一張兌換券給他。
       宅配不發券 —— 商城已依送禮者填的地址出貨,沒有東西要兌換。

       發券失敗【不影響領取本身】:歸屬已經定了,這裡只是少一張券,
       由 list 的重試補上。所以整段包住,錯誤不往外丟。 */
    let finalGift = updated;
    if (updated.fulfillment === 'store') {
      const res = await issueCoupon(updated);
      if (res.ok) {
        finalGift = await applyIssued(updated, res.couponId, res.already);
      } else {
        console.warn('[gift] 發券失敗 ' + updated.id +
                     ' code=' + res.code + ' retryable=' + res.retryable);
        await logEvent(updated.id, 'claimed', 'claimed', 'system',
          '發券失敗(' + res.code + ',' + (res.retryable ? '可重試' : '不可重試') + '):' + res.message);
      }
    }

    return reply('200', { data: { gift: publicGift(finalGift, 'recipient') } });
  }

  /* ---------- pick:收禮人挑選鏡框與刻圖(B 路線) ----------
     A 買的是「客製刻圖眼鏡・禮物」這件通用商品,款式由 B 自己決定。
     B 領取之後走 design.html 挑鏡框、挑刻圖、拉位置,結果寫回這裡。

     「尚未挑選」的判斷用 design_id is null,不另外加欄位 ——
     A 路線的禮物一定有 design_id,B 路線建立時是空的,天然分得開。

     不呼叫商城:A 已經付過款了,這一步只是補上「要做哪一副」。
     第一階段限定門市自取,店員查管理後台就看得到,商城不需要知道。 */
  if (action === 'pick') {
    /* 挑款式會送 cart/push,商城要客編,所以這一步仍需綁定。
       未綁定的人【領得到】B 路線的禮物(那是刻意的),只是還挑不了 ——
       訊息要指路,不要只說「你不能用」:他到門市綁定後就能挑,
       或請店員當場協助。禮物不會因此失效。 */
    if (!erpid) {
      return reply('403', {
        reason: 'erp_required',
        message: '挑選款式需要門市會員身分。帶著手機到樂活門市,' +
                 '店員會協助你完成綁定,當場就能挑鏡框與刻圖。禮物會一直保留著。',
      }, 403);
    }

    const giftId = String(body.gift_id || '').trim();
    if (!giftId) return reply('006', { message: '缺少禮物識別' }, 400);

    const { data: g, error } = await db.from('gifts')
      .select('*').eq('id', giftId).maybeSingle();
    if (error) return reply('500', { message: '系統忙碌,請稍後再試' }, 500);
    if (!g) return reply('007', { message: '查無此禮物' }, 404);

    // 只有收禮人本人能挑。送禮人不行 —— 他送的就是「自己挑」這件事。
    const mine = g.claimed_by_erpid === erpid || g.recipient_erpid === erpid;
    if (!mine) return reply('033', { message: '這份禮物不是給你的' }, 403);

    if (g.status !== 'claimed') {
      return reply('035', { message: '這份禮物目前的狀態無法挑選' }, 409);
    }
    if (g.design_id) {
      return reply('037', { message: '這份禮物已經挑選過了' }, 409);
    }

    const nid = Number(body.product_nid);
    if (!Number.isFinite(nid) || nid <= 0) {
      return reply('006', { message: '缺少商品編號' }, 400);
    }
    if (!body.design_id) {
      return reply('006', { message: '請先選一張刻圖' }, 400);
    }

    /* ⚠ 已知限制:此處不驗證 nid 是否確實在可客製清單內。
       要驗就得從這裡再打一次商城的 products,為了一個「挑錯款式會被
       門市當場發現」的情境增加一條跨服務相依,划不來。
       第一階段限定門市自取,店員配鏡時就會對到實物。 */
    const patch: Record<string, unknown> = {
      product_nid: nid,
      product_sid: body.product_sid ? Number(body.product_sid) : null,
      product_title: String(body.product_title || '').slice(0, 200) || null,
      product_spec_title: String(body.product_spec_title || '').slice(0, 120) || null,
      product_image: String(body.product_image || '').slice(0, 500) || null,

      design_id: body.design_id,
      design_name: String(body.design_name || '').slice(0, 120) || null,
      design_image_url: String(body.design_image_url || '').slice(0, 500) || null,

      preview_url: ourAssetUrl(body.preview_url),
      guide_url:   ourAssetUrl(body.guide_url),
      engrave_placement: body.engrave_placement || null,
    };

    /* 條件更新:只有 design_id 仍為空時才寫得進去。
       兩個分頁同時送出的話,第二個會更新到 0 筆而不是覆蓋掉第一個。 */
    const { data: updated, error: upErr } = await db.from('gifts')
      .update(patch)
      .eq('id', g.id).is('design_id', null)
      .select().maybeSingle();

    if (upErr) return reply('500', { message: '系統忙碌,請稍後再試' }, 500);
    if (!updated) return reply('037', { message: '這份禮物已經挑選過了' }, 409);

    await logEvent(g.id, 'claimed', 'claimed', 'recipient',
      `收禮人挑選:nid ${nid} / ${patch.design_name || ''}`);

    // 挑好的刻圖收進他的「我的最愛刻圖」,與 claim 那邊一致
    try {
      await db.from('engraving_wishlist')
        .insert({ member_id: erpid, design_id: body.design_id });
    } catch { /* 已收藏過會撞唯一鍵,忽略 */ }

    return reply('200', { data: { gift: publicGift(updated, 'recipient') } });
  }

  /* ---------- cancel ---------- */
  if (action === 'cancel') {
    // 只有送禮者能取消,而送禮者一定有客編
    if (!erpid) return needErp();

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
