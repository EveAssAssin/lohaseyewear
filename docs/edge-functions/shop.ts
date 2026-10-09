/* =============================================================
   Supabase Edge Function: shop
   -------------------------------------------------------------
   商城 API 的後端代理。金鑰留在這裡,不落到瀏覽器。

   部署:Supabase Dashboard → Edge Functions → shop
        Verify JWT 關閉(官網前端不帶 Supabase JWT)

   ⚠【這一支的金鑰不在我方手上】
     SHOP_SITE_API_KEY 由商城工程方於 2026-08-19 自行設在 Secrets,
     我方從來沒有拿到那個值。所以:
       · 下面的 FALLBACK_SITE_KEY 永遠是空的,不是漏填 ——
         我方沒有東西可以填。
       · 取代這支之前【不需要】從下載檔搶救金鑰(其他函式需要)。
       · 這支不能用 FALLBACK 救。Secret 被刪掉的話只能請對方重設。

   金鑰兩種來源,擇一:
     A. Secrets 設 SHOP_SITE_API_KEY(這一支的實際情形)
     B. 沒有 Secrets 權限時填 FALLBACK_SITE_KEY
        絕對不要把填好金鑰的版本回寫到 repo。

   設定確認:用瀏覽器開這支的網址(GET)就會回自檢結果 ——
     https://hqdmyxxrskvllkcedybl.supabase.co/functions/v1/shop
   看 site_key_from_env 與 shop_base_host 兩欄。不需要終端機。

   ⚠ 這支讀的是 SHOP_SITE_API_KEY,【不是】SITE_API_KEY,也刻意不做備援。

     2026-08-22 對方查證後更正:兩台正式站的金鑰【目前是同一個值】,
     先前說「不同值、不能互推」是依據一份沒跟著更新的內部紀錄。

     即便值相同,兩個變數名稱仍然【維持分開】——
     它們相同純屬現況,任一站輪替金鑰時就會再度分開。
     合併成一個的話,那一天會有兩支函式同時壞掉而查不出原因。

     也刻意不寫 `SHOP_SITE_API_KEY || SITE_API_KEY`:變數哪天沒設,
     備援會讓它安靜地拿另一把去打錯的站,而不是明確地壞掉。

   Base URL:2026-08-22 起指向【商城正式站】。
   對方已於我方 Supabase 設定 SHOP_BASE_URL,下面那行只是沒設定時的退路。
   要切回測試站的話設 SHOP_BASE_URL,不必改程式。

   action 一覽:
     categories  分類樹
     products    商品列表(tid / limit / offset / can_design_only)
     product     商品詳情(nid),含規格樹
     cart_push   把客製完成品或禮物送回商城購物車,回傳 cart_url
                 ⚠ 這支需要 session token,規則見下方註解
                 ⚠ 這支會在 design_submissions 留一筆紀錄(成功與失敗都留)
   ============================================================= */

/* 這一份程式碼的版本標記。
   ---------------------------------------------------------------
   ⚠ 存在的理由:2026-09-02 發現 claim_url「改完了但從沒部署」,
   而【沒有任何地方看得出來】—— GET 自檢的輸出新舊版一模一樣,
   線上跑的是哪一份只能用猜的,對方也只能相信我方說詞。

   改動這支函式時把這個值一起改(日期 + 這一版加了什麼),
   然後用瀏覽器開這支的網址就知道線上是不是那一份。

   ⚠ 這是給人看的字串,不參與任何邏輯。不要拿它來做版本判斷分支。 */
const CODE_VERSION = '2026-10-09 · 付費眼鏡布';

/* ===== 客製眼鏡盒 =====
   -----------------------------------------------------------------
   哪些商品編號是眼鏡盒。【由伺服器決定】,不看前端說它是什麼 ——
   前端說「我是眼鏡盒」就走眼鏡盒流程的話,任何人都能把一張
   太陽眼鏡的單塞進加工中心的待確認清單。

   2026-10-09 起不只眼鏡盒:付費客製品是一張對照表,nid → 進加工中心時的 product。
     2881 雷刻小物|木紋眼鏡盒 → 'case'(js/case.js 的 CHECKOUT.NID)
     2884 雷刻小物|創作眼鏡布 → 'cloth'(付費眼鏡布,cloth-shop.html 的頁面設定)
   ⚠ 前端的 nid 與這張表不一致的話:那一單會照太陽眼鏡的規則送出去,
     旋轉被丟掉、門市沒存,付款後也不會進加工中心。而且完全不會報錯。 */
const PAID_PRODUCTS: Record<number, 'case' | 'cloth'> = { 2881: 'case', 2884: 'cloth' };

// ⚠ 只在 Dashboard 填,不要提交回 GitHub
const FALLBACK_SITE_KEY = '';

const SHOP_BASE = (Deno.env.get('SHOP_BASE_URL') || 'https://www.lohaseyewear.com')
  .replace(/\/+$/, '');
const SITE_KEY  = Deno.env.get('SHOP_SITE_API_KEY') || FALLBACK_SITE_KEY;

const AUTH_FN = 'https://hqdmyxxrskvllkcedybl.supabase.co/functions/v1/auth-session';

/* 允許未綁定門市的會員以官網會員編號(mid)下單。
   ---------------------------------------------------------------
   2026-08-25 商城確認可以收 mid 當 client_id,不強制 ERP 客編。
   這一步解開的是【所有官網註冊會員】的下單問題 ——
   註冊 8/19 就對外開放了,那批人現在就存在,而他們到目前為止
   按下「加入購物車」拿到的是 401「登入狀態已失效」(他其實登入著)。

   ⚠ 預設關著,照站上的慣例:先上線、自己跑一遍再開。
     開之前要先做完:
       1. 跑 docs/design-submissions-mid.sql(erpid 改可空、加 mid 欄位)
       2. 這一行改 true 並 Deploy
       3. 前端 js/design.js 的 ALLOW_MID_CHECKOUT 也改 true
     ⚠ 順序不能顛倒。前端先開的話,客人會等完產圖與上傳
       才在最後一步拿到 401,而那時圖都做完了。 */
const ALLOW_MID_CHECKOUT = false;

/* 送單紀錄用。這兩個是 Supabase 自動注入 Edge Function 的環境變數,
   不需要在 Secrets 裡設定,也不需要填 FALLBACK。 */
const SB_URL = Deno.env.get('SUPABASE_URL') || '';
const SB_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

/* 送進 cart/push 的圖片網址只允許這個 host。
   ---------------------------------------------------------------
   那些網址會顯示在【商城後台的訂單頁】,供人員點開下載雕刻檔與加工圖。
   如果放任前端指定任意網址,等於提供一條「讓樂活自己人從後台點進
   外部連結」的路徑 —— 釣魚頁、惡意下載都能這樣送進去。
   我們自己產的圖一律在 Supabase Storage,鎖死這個 host 沒有副作用。 */
const ASSET_HOST = 'hqdmyxxrskvllkcedybl.supabase.co';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/* 白名單:只允許這幾支。
   不做白名單的話,這支就成了「任何人都能打商城任意路徑」的開放中繼站。 */
const ROUTES: Record<string, string> = {
  categories: '/api/site/categories',
  products:   '/api/site/products',
  product:    '/api/site/product',
  cart_push:  '/api/site/cart/push',
};

/* 每 IP 每分鐘 60 次。商城本身也有 120/分 的限制,
   這裡先擋一層,避免我們把對方的額度用光。 */
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const win = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  win.push(now);
  hits.set(ip, win);
  if (hits.size > 5000) hits.clear();      // 粗暴但有效的記憶體上限
  return win.length > 60;
}

function reply(code: string, body: Record<string, unknown> = {}, http = 200) {
  return new Response(JSON.stringify({ code, ...body }), {
    status: http,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/* 用 session token 換回會員編號。
   ---------------------------------------------------------------
   商城的串接規格寫得很清楚:
     「client_id 必須由官網後端從自己的登入 session 取得,
       絕不可接受前端傳入的值」
   理由是商城無從驗證那個 ID 是否真的屬於當下登入者 —— 若接受前端指定,
   任何人都能把商品推進別人的購物車、用掉別人的票券。
   所以 client_id 只有這一個來源,前端送什麼都不看。 */
async function whoFromToken(token: string): Promise<{ erpid: string; mid: string; name: string }> {
  const none = { erpid: '', mid: '', name: '' };
  if (!token) return none;
  try {
    const r = await fetch(AUTH_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify', token }),
    });
    const j = await r.json();
    if (String(j?.code) !== '200') return none;
    /* auth-session 一直都有回 mid,是這支先前自己丟掉的。
       未綁定門市的人 erpid 是空字串、mid 有值。

       name(2026-09-29):眼鏡盒進加工中心時要有客人姓名,
       製作單會跟著盒子寄到門市,門市靠姓名找人。
       ⚠ 姓名【只能】來自這裡(簽進 token 的那一份),不從前端讀 ——
         前端說了算的話,製作單上寫的就是任何人想寫的名字。 */
    return {
      erpid: String(j?.erpid || '').trim(),
      mid: String(j?.mid || '').trim(),
      name: String(j?.name || '').trim().slice(0, 60),
    };
  } catch {
    return none;
  }
}

/* 取貨門市(眼鏡盒用)。與 cloth 函式的 pickStore 同一個規則:
   只留三個欄位、截短、erpid 限英數。取不到就回 null 讓呼叫端拒絕。 */
function pickStore(v: unknown): { store_erpid: string; store_name: string | null; store_city: string | null } | null {
  const o = (v || {}) as Record<string, unknown>;
  const id = String(o.erpid ?? '').trim();
  if (!id || !/^[0-9A-Za-z_-]{1,32}$/.test(id)) return null;
  return {
    store_erpid: id,
    store_name: String(o.name ?? '').slice(0, 80) || null,
    store_city: String(o.city ?? '').slice(0, 40) || null,
  };
}

/* 角度正規化成 0–359。非數字一律當 0。
   ⚠ 這個值會進 DXF —— 負數或 400 度在畫面上看不出問題,
     到了雕刻機那一端才會變成轉錯方向。 */
function normDeg(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return ((n % 360) + 360) % 360;
}

/** 只放行我方 Storage 上的網址,其餘一律丟掉(理由見 ASSET_HOST) */
function safeAssetUrl(v: unknown): string | null {
  const s = String(v || '');
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

/* 組出要送給商城的 cart/push body。
   前端送來的東西一律當成不可信,逐欄挑出來重建 ——
   直接把 body 轉發等於把金鑰的權限開放給任何呼叫者。 */
function buildCartBody(clientId: string, idType: 'erp' | 'mid', body: Record<string, any>,
                       submissionId: string, paidProduct: 'case' | 'cloth' | null = null) {
  const m = body.main || {};
  const d = m.design || {};
  const p = d.placement || {};

  const design: Record<string, unknown> = {
    /* 這一次送出的唯一識別碼。
       ---------------------------------------------------------
       design_id 是【刻圖作品】的編號,同一張刻圖可以被送出很多次,
       所以它無法回答「訂單對應到哪一筆送單」。submission_id 才可以。

       它由我方在此產生,並且【就是 design_submissions 那一列的主鍵】——
       商城原樣保存、付款完成時原樣回拋,我方拿到就能直接對上,
       不必再靠「最近一筆未成交的」這種機率性比對。

       商城 2026-08-17 來文確認採此做法(做法 A),並說明會與 placement
       同樣處理:原樣保存、不解析、只做長度上限 100。 */
    submission_id: submissionId,

    design_id:   String(d.design_id || '').slice(0, 100),
    design_name: String(d.design_name || '').slice(0, 200),
    /* 🚨 眼鏡盒與太陽眼鏡的座標是【兩套不同的東西】,不能共用一個格式。
       -----------------------------------------------------------
         太陽眼鏡  相對「商品圖」,要分左右鏡片,沒有旋轉
         眼鏡盒    相對「盒蓋上的可雕刻範圍」,沒有左右,【有旋轉】

       2026-09-28 的測試就是用太陽眼鏡的格式送的:rot 被丟掉、
       basis 被蓋成 product_image —— 師傅拿到的位置沒有旋轉,
       而且不會有任何錯誤。 */
    /* 付費眼鏡布(2026-10-09)與眼鏡盒同一套格式,只是基準換成布上的雕刻範圍。 */
    placement: paidProduct
      ? {
          scale: clamp01(p.scale),
          x:     clamp01(p.x),
          y:     clamp01(p.y),
          rot:   normDeg(p.rot),
          basis: paidProduct === 'cloth' ? 'cloth_plate' : 'case_plate',
        }
      : {
          lens:  p.lens === 'left' ? 'left' : 'right',
          scale: clamp01(p.scale),
          x:     clamp01(p.x),
          y:     clamp01(p.y),
          basis: 'product_image',
        },
  };
  // 三個網址各自檢查,缺哪個就不帶哪個(商城端對缺欄位的處理比對錯誤網址安全)
  const eng   = safeAssetUrl(d.engraving_url);
  const prev  = safeAssetUrl(d.preview_url);
  const guide = safeAssetUrl(d.guide_url);
  if (eng)   design.engraving_url = eng;
  if (prev)  design.preview_url   = prev;
  if (guide) design.guide_url     = guide;

  const main: Record<string, unknown> = {
    nid: Number(m.nid),
    amount: 1,          // 一次一件,不開放前端指定數量
  };

  /* design 只在真的有刻圖時才帶。
     -----------------------------------------------------------
     禮物 B 路線(送禮人買通用禮物、收禮人自己挑款式)在下單當下
     還沒有任何刻圖 —— 硬塞一個空的 design 進去,商城會收到一筆
     design_id 為空字串、placement 全是 0 的資料,那比沒有更糟:
     後台會顯示「有客製」但點開什麼都沒有。 */
  /* 🚨 眼鏡盒【一律】帶 design,就算沒有刻圖編號(自己畫/打字/上傳)。
     -----------------------------------------------------------
     商城只對「含 main.design」的訂單發 design_order 通知
     (docs/串接現況.md 第 171 行)。自己畫的盒子不帶的話:
     客人付了錢 → 商城不通知 → 那個盒子永遠進不了加工中心,
     而且我方完全不知道有這一單。
     它不像禮物 B 路線那樣「點開什麼都沒有」—— 盒子一定有
     雕刻檔與合成圖(下方 cart_push 會擋掉缺圖的)。 */
  if (d.design_id || paidProduct) main.design = design;
  /* sid 只在「真的有規格」時才帶。商城端說明:無規格商品帶了 sid 會被擋,
     省略 / null / 0 都會被當成 0 通過。所以寧可不帶。 */
  const sid = Number(m.sid);
  if (Number.isFinite(sid) && sid > 0) main.sid = sid;

  const out: Record<string, unknown> = {
    client_id: clientId,
    /* 告訴商城這個 client_id 是哪一種編號。
       他們現在可能不讀這一欄(未知欄位會被忽略),但沒有它的話
       兩種編號在對方眼中長得一樣 —— 而 ERP 客編與官網會員編號
       是兩個不同的號碼空間,總有一天會撞號。 */
    client_id_type: idType,
    main,
  };

  // 刻圖費由商城依自己的設定計算,我方只表明「有含刻圖」。
  // 規格明訂不得帶入任何金額欄位,帶了也會被忽略。
  // 沒有刻圖(B 路線)就不帶 —— 那一單本來就不含刻圖。
  if (d.design_id) out.plus_buy = [{ type: 'engraving_fee', amount: 1 }];

  /* 禮物:送禮人結帳時要讓商城知道這一單是禮物。
     -----------------------------------------------------------
     商城 2026-08-19 的規格:
       is_gift / gift_id / fulfillment / recipient_erpid(非必填)

     gift_id 是我方 gifts 那一列的主鍵 —— 付款完成時商城以它回拋
     gift_paid,我方據此把禮物推進到「可領取」。沒有它,客人付了錢
     而禮物永遠停在待付款。

     金額與商品資訊刻意不帶:那些以商城的設定為準,
     兩邊各存一份就會有「哪一份才算數」的問題(對方 8/19 亦如此說明)。 */
  const g = body.gift || {};
  const giftId = String(g.gift_id || '').slice(0, 64);
  if (g.is_gift && giftId) {
    const gift: Record<string, unknown> = {
      is_gift: true,
      gift_id: giftId,
      // 未知值一律當宅配,與商城的處理一致
      fulfillment: g.fulfillment === 'store' ? 'store' : 'ship',
    };
    const rec = String(g.recipient_erpid || '').slice(0, 40);
    if (rec) gift.recipient_erpid = rec;

    /* 領取連結。2026-08-27 對方要求補送。
       -----------------------------------------------------------
       用途:商城的訂購完成頁要放「複製領取連結」與「用 LINE 傳給對方」。
       送禮人付完款會被導回那一頁,而在此之前那一頁不會提到領取連結 ——
       當下把視窗關掉的人就找不回來了。

       ⚠ 提早交出去為什麼安全:gift 的 claim 硬性要求 status === 'paid',
       pending_payment 明確擋掉。所以這串在付款事件回來之前領不了,
       它只是「先放在對方頁面上」,不是「提前開放領取」。

       只放行自家網域的網址。這一段是我方組給對方印在頁面上的連結,
       若哪天上游改成回傳任意網址,不擋就成了把外部連結種進商城頁面
       的管道 —— 同 imgOk() 的理由。 */
    const cu = String(g.claim_url || '').slice(0, 300);
    if (cu && /^https:\/\/(www\.)?lohasglasses\.com\//.test(cu)) {
      gift.claim_url = cu;
    }

    out.gift = gift;
  }

  // 票券:有帶才附上。lock_token 由商城在建立訂單時拿去 redeem。
  const c = body.coupon || {};
  const couponId = Number(c.coupon_id);
  const lockToken = String(c.lock_token || '').slice(0, 128);
  if (Number.isFinite(couponId) && couponId > 0 && lockToken) {
    out.coupon = { coupon_id: couponId, lock_token: lockToken };
  }

  return out;
}

/* 送單紀錄。
   ---------------------------------------------------------------
   成功與失敗都寫,失敗的那些才是排查用得上的 ——
   在此之前送單失敗只能請客人開瀏覽器 console,實務上做不到。

   紀錄取自 buildCartBody 的產出(已消毒過的版本),不是前端原始 body。

   ⚠ 這一步失敗絕對不能影響客人:寫紀錄是我方的內部需求,
     不是客人的交易的一部分。整段包在 try/catch 裡,錯了只留 log。

   刻意不存的東西:session token、coupon.lock_token —— 兩者都是憑證。 */
async function logSubmission(row: Record<string, unknown>) {
  if (!SB_URL || !SB_SERVICE_KEY) {
    console.warn('[shop] 缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY,略過送單紀錄');
    return;
  }
  try {
    const r = await fetch(SB_URL + '/rest/v1/design_submissions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SB_SERVICE_KEY,
        'Authorization': 'Bearer ' + SB_SERVICE_KEY,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) {
      console.error('[shop] 送單紀錄寫入失敗 ' + r.status + ' ' + (await r.text()).slice(0, 200));
    }
  } catch (e) {
    console.error('[shop] 送單紀錄例外:', e instanceof Error ? e.message : e);
  }
}

/** 把 buildCartBody 的產出 + 商城回應,攤平成一筆資料列 */
function submissionRow(
  erpid: string,
  mid: string,
  out: Record<string, any>,
  shop: { code: string; message: string; cartUrl: string },
  caseInfo: Record<string, unknown> | null = null,
): Record<string, unknown> {
  const main = out.main || {};
  const design = main.design || {};
  return {
    /* 眼鏡盒才有的:品項、來源、姓名、取貨門市。
       付款通知進來時 shop-webhook 靠這幾欄把盒子搬進加工中心 ——
       商城的通知裡沒有門市也沒有姓名,這裡沒存就再也拿不到。
       太陽眼鏡這幾欄是 null。 */
    ...(caseInfo || {}),
    /* 主鍵用我方送給商城的那一組,不讓資料庫自己產 ——
       兩邊必須是同一個值,商城回拋時才對得上。 */
    id: design.submission_id,
    /* 兩欄擇一有值。不要把 mid 塞進 erpid ——
       欄位名說謊之後,任何人用 erpid 查客人都會安靜地查錯。 */
    erpid: erpid || null,
    mid: mid || null,
    nid: main.nid ?? null,
    sid: main.sid ?? null,
    design_id:     design.design_id || null,
    design_name:   design.design_name || null,
    engraving_url: design.engraving_url || null,
    preview_url:   design.preview_url || null,
    guide_url:     design.guide_url || null,
    placement:     design.placement || null,
    coupon_id:     out.coupon?.coupon_id ?? null,
    succeeded:     shop.code === '200' && !!shop.cartUrl,
    shop_code:     shop.code || null,
    shop_message:  shop.message ? String(shop.message).slice(0, 500) : null,
    cart_url:      shop.cartUrl || null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  /* 設定自檢(商城工程方 2026-08-19 加的,保留)。
     只回「有沒有設」與「連到哪個主機」,不回金鑰內容。

     這兩項設錯都不會報錯,所以特別需要一個看得到的地方:
       金鑰錯 → 上游 403 被包成「無法連線到商城」
       網址錯 → 完全正常運作,只是把客人推進另一個環境的購物車

     ⚠ site_key_from_env 為 true 只代表【讀到了值】,不代表那個值是對的。
       要確認金鑰真的可用,POST {"action":"categories"} 實打一次。 */
  if (req.method === 'GET') {
    return new Response(JSON.stringify({
      function: 'shop',
      code_version: CODE_VERSION,
      project_ref: 'hqdmyxxrskvllkcedybl',
      key_var: 'SHOP_SITE_API_KEY',
      site_key_from_env: Deno.env.get('SHOP_SITE_API_KEY') ? true : false,
      shop_base_host: new URL(SHOP_BASE).hostname,
      shop_base_from_env: !!Deno.env.get('SHOP_BASE_URL'),
      actions: Object.keys(ROUTES),
      note: 'site_key_from_env 只表示讀到值;金鑰是否正確請以 categories 實打驗證。' +
            ' code_version 是這支【線上實際跑的那一份】的標記,用來確認部署有沒有真的做到。',
    }, null, 2), {
      headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  if (req.method !== 'POST') return reply('405', { message: '只接受 POST' }, 405);

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return reply('429', { message: '操作太頻繁,請稍候再試' }, 429);

  if (!SITE_KEY) {
    console.error('[shop] 缺少金鑰:請設 SHOP_SITE_API_KEY 或填 FALLBACK_SITE_KEY');
    return reply('500', { message: '系統設定不完整,請聯繫技術窗口' }, 500);
  }

  let body: Record<string, any>;
  try { body = await req.json(); }
  catch { return reply('006', { message: '請求格式錯誤' }, 400); }

  const action = String(body.action || '');
  const path = ROUTES[action];
  if (!path) return reply('006', { message: '不支援的 action' }, 400);

  let out: Record<string, unknown>;
  let erpid = '';
  let mid = '';
  let caseInfo: Record<string, unknown> | null = null;

  if (action === 'cart_push') {
    const who = await whoFromToken(String(body.token || ''));
    erpid = who.erpid;
    mid = who.mid;

    /* 客編優先,沒有才用官網會員編號。
       旗標關著的時候維持原本的行為:沒有客編就擋下來。 */
    const clientId = erpid || (ALLOW_MID_CHECKOUT ? mid : '');
    if (!clientId) {
      /* 分兩種訊息。他明明登入著卻被告知「登入失效」是最難查的那一種 ——
         客服會去看 session,而問題根本不在那裡。 */
      if (mid) {
        return reply('403', {
          message: '這項服務目前需要門市會員身分,到門市綁定之後就能使用。',
          reason: 'erp_required',
        }, 403);
      }
      return reply('401', { message: '登入狀態已失效,請重新登入' }, 401);
    }

    if (!Number(body?.main?.nid)) return reply('006', { message: '缺少商品編號' }, 400);

    /* ===== 眼鏡盒:送進購物車之前先把關 =====
       擋在這裡,不是等付款後才發現。付款後才發現少東西的話,
       那是一筆已經收了錢、卻做不出來的訂單。 */
    const paidProduct = PAID_PRODUCTS[Number(body.main.nid)] || null;
    const isCase = !!paidProduct;      // 名稱沿用:這一段對所有付費客製品都一樣
    if (isCase) {
      const dz = (body.main.design || {}) as Record<string, unknown>;
      /* 沒有雕刻檔就刻不了。合成圖是給師傅與客人對照位置的,也要有。
         ⚠ 兩者都必須是我方 Storage 的網址(safeAssetUrl)——
           這兩個網址會出現在商城後台與加工中心,會被人點開。 */
      if (!safeAssetUrl(dz.engraving_url) || !safeAssetUrl(dz.preview_url)) {
        return reply('006', { message: '圖案檔案不完整,請重新產生後再送出' }, 400);
      }
      const store = pickStore(body.store);
      if (!store) {
        return reply('006', { message: '請選擇要到哪一家門市拿' }, 400);
      }
      /* 付費眼鏡布有顏色規格,一定要帶 sid(商城也會擋,但在這裡擋客人看得懂)。
         variant 是顏色名稱,存進送單與加工中心,師傅據此拿布。
         ⚠ 只在有值時才放進去 —— 眼鏡盒沒有這一欄的值,
           variant 欄位(docs/cloth-paid.sql)還沒建的話也不會讓眼鏡盒壞掉。 */
      if (paidProduct === 'cloth' && !(Number(body.main.sid) > 0)) {
        return reply('006', { message: '請選擇眼鏡布的顏色' }, 400);
      }
      const variant = String(body.main.variant ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40);
      caseInfo = {
        product: paidProduct,
        ...(variant ? { variant } : {}),
        /* 有刻圖市集編號才算 market;自己畫/打字/上傳一律 draw。
           ⚠ cloth_designs 的 source 只收 market / draw(資料表約束),
             送別的值進去,付款後搬進加工中心那一步會被擋下。 */
        source: dz.design_id ? 'market' : 'draw',
        member_name: who.name || null,
        ...store,
      };
    }

    /* 送出前先決定這一筆的識別碼,而不是等寫紀錄時才由資料庫產生 ——
       商城要收到的和我方要存的必須是同一個值。 */
    out = buildCartBody(clientId, erpid ? 'erp' : 'mid', body, crypto.randomUUID(), paidProduct);

    /* 眼鏡盒的結帳限制,由商城在伺服器端執行(2026-10-01,商城 PR site-case-checkout)。
       -----------------------------------------------------------
       ・payment online_card:只能「樂活門市-線上信用卡付款」。
         商城是在【付款完成】才發 design_order,我方收到才開始刻;
         到門市才付款的話通知要等取貨才來,盒子卻要先刻好才能取貨 ——
         那一單永遠做不出來。
       ・pickup_store_erpid:客人在我方頁面選的門市,商城轉成它自己的門市代碼
         並鎖住結帳頁的門市選單。對不到門市時商城回 027,客人當下就看得到。
       ・max_quantity 1:一份設計對應一件雷刻,數量 2 等於同一張圖刻兩次。
       ⚠ 商城還沒部署這一版之前,未知的 main.checkout 會被忽略(不會出錯),
         所以這一段可以先上線。商城有沒有收到,看回應裡的 data.checkout。 */
    if (isCase && caseInfo) {
      (out.main as Record<string, unknown>).checkout = {
        payment: 'online_card',
        pickup_store_erpid: String(caseInfo.store_erpid),
        max_quantity: 1,
      };
    }

    console.log('[shop] cart_push client=' + clientId + '(' + (erpid ? 'erp' : 'mid') + ')' +
                ' nid=' + (out as any).main.nid +
                ' submission=' + ((out as any).main.design?.submission_id || '-'));
  } else {
    // 讀取型的三支:只轉送白名單內的參數,
    // 前端傳什麼就照單全收會把金鑰的權限放大
    out = {};
    if (body.nid !== undefined) out.nid = Number(body.nid);
    if (body.tid !== undefined) out.tid = String(body.tid).slice(0, 200);
    if (body.limit !== undefined) out.limit = Math.min(Number(body.limit) || 200, 500);
    if (body.offset !== undefined) out.offset = Math.max(Number(body.offset) || 0, 0);
    if (body.can_design_only) out.can_design_only = 1;
  }

  try {
    const r = await fetch(SHOP_BASE + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Site-Key': SITE_KEY,
      },
      body: JSON.stringify(out),
    });
    const j = await r.json();

    // 原樣轉回,但保險起見濾掉任何可能回音金鑰的欄位
    if (j && typeof j === 'object' && 'debug' in j) delete (j as any).debug;

    if (action === 'cart_push') {
      /* 送了限制,商城卻沒有回報收到 —— 代表商城還沒部署那一版,或欄位被白名單吃掉。
         這時客人仍選得到其他付款方式。不擋(擋了就完全買不了),但一定要留紀錄,
         否則要等到一單永遠刻不出來才會發現。 */
      if (caseInfo && String(j?.code) === '200' && !j?.data?.checkout) {
        console.warn('[shop] 眼鏡盒送了 checkout,商城回應沒有 data.checkout(商城未部署限制?)');
      }
      await logSubmission(submissionRow(erpid, mid, out, {
        code:    String(j?.code ?? r.status),
        message: String(j?.message ?? ''),
        cartUrl: String(j?.data?.cart_url ?? ''),
      }, caseInfo));
    }

    return new Response(JSON.stringify(j), {
      status: r.status,
      headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (e) {
    // 連不上商城 / 對方回的不是 JSON。這種也要留紀錄,
    // 否則「客人說送不出去」在我方查不到任何東西。
    if (action === 'cart_push') {
      await logSubmission(submissionRow(erpid, mid, out, {
        code:    'FETCH_FAILED',
        message: e instanceof Error ? e.message : String(e),
        cartUrl: '',
      }, caseInfo));
    }
    return reply('500', { message: '無法連線到商城,請稍後再試' }, 502);
  }
});