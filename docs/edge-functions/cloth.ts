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

   ⚠ 這支需要 Secret「SITE_API_KEY」(問我方生日資格用)。
     其餘用的是 Supabase 自動注入的環境變數。
   ============================================================= */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const AUTH_FN = `${SUPABASE_URL}/functions/v1/auth-session`;

/* 主後端(我方)。生日只存在我方,官網不做任何日期判斷 ——
   理由寫在我方 SiteClothApi 的檔頭:同一個業務規則在兩個系統
   各實作一份的話,症狀會是「兩邊各自看都正常,合起來不對」。
   所以這裡問的是【結論】,拿到什麼就顯示什麼。 */
const SITE_KEY = Deno.env.get('SITE_API_KEY') || '';
const TICKET_BASE = (Deno.env.get('TICKET_BASE_URL') ||
  'https://lohas.realtime.tw').replace(/\/+$/, '');

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

/* 只放行我方 Storage 上的網址。
   這些網址會出現在後台、並被人點開下載製作 ——
   接受任意網址等於提供一條「讓自己人從後台點進外部連結」的路徑。 */
const ASSET_HOST = 'hqdmyxxrskvllkcedybl.supabase.co';

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

/* 角度正規化成 0–359。非數字一律當 0(沒轉)。 */
function normDeg(v: unknown): number {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return ((n % 360) + 360) % 360;
}

/* 取貨門市:只留這三個欄位,而且都截短。
   erpid 限定英數,不是為了安全(它不授權任何事),
   而是為了不讓奇怪的東西進到製作單的畫面上。 */
function pickStore(v: unknown) {
  const o = (v || {}) as Record<string, unknown>;
  const id = String(o.erpid ?? '').trim();
  if (!id || !/^[0-9A-Za-z_-]{1,32}$/.test(id)) return {};
  return {
    store_erpid: id,
    store_name: String(o.name ?? '').slice(0, 80) || null,
    store_city: String(o.city ?? '').slice(0, 40) || null,
  };
}

/* 身分。erpid 或 mid 有一個就算數。

   ⚠ 2026-09-03 起加了生日閘門之後,只有 mid 的人(官網註冊、
     尚未到門市綁定)實際上會被我方判成 no_birthday 而擋下 ——
     因為生日來自 ERP 建檔,我方查不到就是查不到。
     這不是這一支的判斷,是我方回的結論;訊息會請他去門市建檔。
     (查證:2026-09-03 既有 54 筆作品全部都有 erpid,mid-only 是 0,
      所以這個改動沒有影響到任何既有客人。) */
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

/* ===== 生日資格:問我方,不自己算 =====
   -----------------------------------------------------------------
   回 null ＝【問不到】(未設定金鑰 / 連線失敗 / 回應異常)。

   🚨 呼叫端必須把 null 當成「不能做」並顯示系統異常。
     放行才是危險的那一邊:我方一抖,全站就變成沒有生日限制,
     而且完全不會有人發現 —— 客人做得出來、製作端照做,
     一切看起來都正常。fail-closed 至少會有人來問客服。

   ⚠ 與「不是生日月」要分得出來:那是客人的狀態(要顯示原因),
     這是我方的故障(要顯示系統異常)。混在一起的話,我方斷線期間
     所有客人都會看到「不是您的生日月」,然後去門市理論。 */
type Eligible = { ok: boolean; reason: string; message: string; birth_month: number };

async function askEligible(who: { erpid: string; mid: string }): Promise<Eligible | null> {
  if (!SITE_KEY) {
    console.error('[cloth] 缺少 SITE_API_KEY,無法確認生日資格');
    return null;
  }
  try {
    const r = await fetch(`${TICKET_BASE}/siteapi/cloth/eligible`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Site-Key': SITE_KEY,
      },
      body: JSON.stringify({ client_id: who.erpid || '', mid: who.mid || '' }),
    });
    const j = await r.json();
    if (String(j?.code) !== '200' || !j?.data) {
      // 不記錄回應內容:那裡面有生日月,屬於個資,不要留副本在平台 log 上
      console.warn('[cloth] 資格查詢上游回應 code=' + j?.code + ' http=' + r.status);
      return null;
    }
    const d = j.data;

    /* 🚨 每一次資格判定都留一行。
       -----------------------------------------------------------------
       2026-09-04 門市回報「客人是當月壽星,畫面卻顯示尚未開放」時,
       【兩邊都沒有任何紀錄】—— 查不出是誰、被什麼原因擋下。
       而門市不可能開 DevTools 把 console 讀給我們聽,
       所以唯一可行的地方就是這裡。

       ⚠ 不記 birth_month 的【值】—— 那是個資,不要在平台 log 上留副本。
         只記「它是不是本月」,而那已經足以分辨兩種完全不同的病因:
           是本月卻被擋 → 對方的判斷邏輯有問題
           不是本月     → ERP 那筆生日資料本身不對(或客人記錯) */
    const taipeiMonth = new Date(Date.now() + 8 * 3600 * 1000).getUTCMonth() + 1;
    console.log(
      '[cloth] 生日資格 erpid=' + (who.erpid || '-') +
      ' mid=' + (who.mid || '-') +
      ' ok=' + !!d.ok +
      ' reason=' + (String(d.reason || '') || '-') +
      ' 生日月是否為本月=' + (Number(d.birth_month) === taipeiMonth),
    );

    return {
      ok: !!d.ok,
      reason: String(d.reason || ''),
      message: String(d.message || ''),
      birth_month: Number(d.birth_month) || 0,
    };
  } catch {
    console.error('[cloth] 資格查詢連線失敗');
    return null;
  }
}

const SYS_ERR_MSG = '系統異常,請聯繫客服。';

/* 線上實際跑的是哪一版。每次改這支就一併更新 ——
   從外面看不出線上是哪一版,是 2026-08-28 那次事故的根本原因
   (程式改好、信上寫「已上線」,但那支函式從頭到尾沒有部署過)。 */
const CODE_VERSION = '2026-09-04 · 生日閘門判定留紀錄';

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

/* 「這個人自己的」查詢條件。
   -----------------------------------------------------------------
   erpid 與 mid 兩個都比:門市綁定之前存的那幾筆只有 mid,
   綁定之後存的有 erpid。只比其中一個,客人會發現自己的東西「少了幾件」,
   而那是最難解釋的一種 bug —— 資料還在,只是查不到。

   ⚠ 抽成函式是刻意的:本年度鎖定與「我的眼鏡布」列表【必須】用
   完全相同的條件。兩邊各寫一份的話,遲早出現「列表看得到、
   但鎖定判斷看不到」——那等於鎖定失效,而且完全不會報錯。 */
function mineOnly(q: any, who: { erpid: string; mid: string }) {
  const plain = (v: string) => /^[A-Za-z0-9_-]+$/.test(v);
  if (who.erpid && who.mid && plain(who.erpid) && plain(who.mid)) {
    return q.or('erpid.eq.' + who.erpid + ',mid.eq.' + who.mid);
  }
  if (who.erpid) return q.eq('erpid', who.erpid);
  return q.eq('mid', who.mid);
}

/* 本曆年的起點,以【台北時間】為準,轉成 UTC 的 ISO 字串。
   -----------------------------------------------------------------
   🚨 不可以直接用 new Date().getFullYear() 拼 '2026-01-01T00:00:00Z' ——
   Edge Function 跑在 UTC,而 created_at 存的是 timestamptz。
   台北的 1/1 00:30 是 UTC 的 12/31 16:30,用 UTC 的年界會把它算成去年,
   於是那個人在元旦凌晨可以存第二張。

   一年只發生一次、只影響那 8 小時,所以出事了也很難重現 ——
   這種 bug 要在寫的時候就避開,不是等它被回報。 */
function taipeiYearStartIso(): string {
  const now = new Date();
  // 台北固定 UTC+8,沒有日光節約,所以加 8 小時就是台北的牆上時間
  const taipei = new Date(now.getTime() + 8 * 3600 * 1000);
  const year = taipei.getUTCFullYear();
  // 台北 year-01-01 00:00:00 ＝ UTC (year-1)-12-31 16:00:00
  return new Date(Date.UTC(year, 0, 1, 0, 0, 0) - 8 * 3600 * 1000).toISOString();
}

/* 不受「一年一件」限制的客編。
   -----------------------------------------------------------------
   目前只有內部人員的 28095839,用途是【測試】——
   每改一次眼鏡布的流程都要能重跑一次,受年度限制的話一年只能測一次。

   ⚠ 這是白名單,不是開關。加人進來之前先想清楚:
     這些客編做出來的眼鏡布,在製作端看起來與一般工單【完全一樣】,
     師傅會照做。所以只放真的知道自己在做什麼的人。

   ⚠ erpid 來自 whoFromToken(),是伺服器端從 session token 解出來的,
     前端傳什麼都會被忽略 —— 所以這份名單偽造不了。

   ⚠ 白名單同時略過【一年一件】與【生日月】兩道關卡:
     測試流程本來就不會剛好在測試者的生日月。 */
const UNLIMITED_ERPIDS = new Set(['28095839']);

function isUnlimited(who: { erpid: string; mid: string }): boolean {
  return !!who.erpid && UNLIMITED_ERPIDS.has(who.erpid);
}

/* 本年度已經存過的那一件(沒有就 null)。
   年度生日禮一年一張,所以最多只會有一筆;取最新的一筆以防萬一。 */
async function thisYearOne(db: any, who: { erpid: string; mid: string }) {
  const q = mineOnly(
    db.from('cloth_designs')
      .select('id, source, design_id, design_name, preview_url, svg_url, placement, status, reject_code, reject_reason, rejected_at, reject_count, created_at, done_at, store_erpid, store_name')
      .gte('created_at', taipeiYearStartIso())
      .order('created_at', { ascending: false })
      .limit(1),
    who,
  );
  const { data, error } = await q;
  if (error) {
    /* 🚨 查詢失敗時【不可以】當成「沒有存過」。
       那會在資料庫抖一下的時候讓所有人都能再存一張,
       而且完全沒有痕跡。呼叫端要把 undefined 當成「無法判斷」並拒絕存檔。 */
    console.error('[cloth] 查本年度作品失敗:', error.message);
    return undefined;
  }
  return (data && data[0]) || null;
}

/* 被退件而還沒重做。
   -----------------------------------------------------------------
   🚨 這個狀態要【略過生日月檢查】,而且順序必須排在生日之前。

   情境:客人在生日月最後一天送出,隔天雕刻師退件 ——
   這時已經不是生日月了。若照生日月擋,退件等於把他今年的
   生日禮直接沒收,而畫面上只會說「限生日當月」,
   沒有任何人看得出來是退件造成的。

   (2026-09-03 查證:當時有 2 筆 rejected,兩位都沒有重做成功 ——
    因為 thisYearOne 原本不分狀態,退件那一筆照樣把人擋在
    「本年度已完成」的 409。退件功能上線但重做是斷的。) */
function isRedoPending(cur: any): boolean {
  return !!cur && String(cur.status) === 'rejected';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  /* GET = 自檢。回【設定狀態與端點主機,不回金鑰】。
     -----------------------------------------------------------------
     這支自 2026-09-03 起會 fail-closed:SITE_API_KEY 沒設的話
     所有人都存不了檔,而客人看到的只有「系統異常」——
     從外面完全看不出是設定漏了還是我方掛了。

     官網沒有測試環境,所以需要一個「不必真的存一件」就能
     確認設定的方法。同 shop / cloth-feed 的 code_version 做法。

     ⚠ upstream 探測【故意不帶金鑰】:預期回 401,
       收到 401 就證明路由存在且連得到,而過程中不需要用到金鑰。 */
  if (req.method === 'GET') {
    let upstream = 'unknown';
    try {
      const r = await fetch(`${TICKET_BASE}/siteapi/cloth/eligible`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: '{}',
      });
      const j = await r.json().catch(() => ({}));
      upstream = 'http ' + r.status + ' / code ' + ((j as any)?.code ?? '?');
    } catch {
      upstream = 'unreachable';
    }
    return reply('200', {
      data: {
        code_version: CODE_VERSION,
        site_key_set: !!SITE_KEY,
        ticket_base: TICKET_BASE,
        upstream_probe: upstream,
      },
    });
  }

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

     svg_url 不回:那是製作端用的檔案,前端不需要,
     回了等於把它散到瀏覽器紀錄與快取裡。 */
  if (action === 'list') {
    const q = mineOnly(
      db.from('cloth_designs')
        .select('id, source, design_name, preview_url, status, reject_code, reject_reason, rejected_at, reject_count, created_at, done_at, store_erpid, store_name')
        .order('created_at', { ascending: false })
        .limit(60),
      who,
    );

    const { data, error } = await q;
    if (error) {
      console.error('[cloth] 列表失敗:', error.message);
      return reply('500', { message: '讀取失敗,請稍後再試' }, 500);
    }

    /* 本年度鎖定狀態一併回,讓眼鏡布頁一進來就知道要不要鎖。
       ------------------------------------------------------------
       ⚠ locked 為 true 時仍然回 current —— 前端要載入他存的那一張,
       並顯示取貨門市。少了 current,畫面只能顯示一句「已完成」,
       客人會以為自己做的東西不見了。

       ⚠ 查不到年度狀態(undefined)時 locked 回 true(偏嚴格)。
       這一支只是介面提示,真正的關卡在 save;
       但寧可讓他看到「已完成」再去問客服,
       也不要讓他花二十分鐘做完才在送出時被拒。 */
    const cur = await thisYearOne(db, who);
    const redo = isRedoPending(cur);

    /* 生日資格也在這裡一併回,讓客人【進頁面就知道】能不能做。
       ------------------------------------------------------------
       真正的關卡在 save —— 這裡只是提示。但少了它,客人會花
       二十分鐘挑圖排版,按下送出才被告知「不是你的生日月」,
       那比一開始就講更難解釋。

       ⚠ 被退件的人不問資格:他本來就該被放行(見 isRedoPending)。
       ⚠ 問不到時不擋畫面,只是不給提示 —— 這一支是提示層,
         擋人是 save 的事;在提示層 fail-closed 會讓我方一抖
         就變成所有人都看到系統異常,即使他們根本還沒要存檔。 */
    let eligible: Eligible | null = null;
    if (!redo && !isUnlimited(who)) {
      eligible = await askEligible(who);
    }

    /* 白名單的人永遠不鎖。
       ⚠ current 照樣回 —— 那是他本年度存的那一張,前端拿它還原畫面。
       只把 locked 關掉,不要連資料一起藏,不然畫面會像「東西不見了」。 */
    return reply('200', {
      data: {
        items: data || [],
        // 退件待重做時不算鎖定 —— 他就是要再做一件
        locked: isUnlimited(who) ? false : (redo ? false : cur !== null),
        current: cur || null,
        /* 🚨 前端(js/cloth.js)從 2026-09-02 起就在讀 j.data.rejected,
           而這一支【從來沒有回過那個欄位】—— applyRejected() 因此
           一次都沒有作用過:被退件的客人打開頁面看到的是一個完全正常、
           可以存檔的畫面,不知道自己上一件被退了、也不知道要改什麼。

           ⚠ 刻意【不】在這裡新增 rejected 欄位:redo_pending + current
             已經足夠讓前端自己組出來,而官網沒有測試環境,
             能少部署一次就少一次風險。前端已改為從這兩個欄位取值。 */
        redo_pending: redo,
        /* null = 問不到(前端就別顯示資格提示,不要自己編一句話)。
           前端只負責顯示 message,不要用 birth_month 自己算月份 ——
           那就是把規則複製到第三個地方。 */
        eligible: eligible,
      },
    });
  }

  if (rateLimited(who.erpid || who.mid)) {
    return reply('429', { message: '操作太頻繁,請稍候再試' }, 429);
  }

  /* 🚨 年度生日禮一年一張 —— 這裡是【唯一】真正的關卡。
     -----------------------------------------------------------------
     前端會把存檔鈕停用,但那只是介面。直接 POST 這支就繞過去了,
     而繞過去的結果是同一個人拿到兩張眼鏡布 —— 製作端會照做,
     因為對他們而言那就是兩筆正常的工單。

     ⚠ 擋在 insert 之前,不是靠資料庫的唯一索引 ——
       目前沒有那個索引。因此兩個請求同時進來理論上都會通過。
       速率限制讓這個窗口很窄,但它不是零。
       要真正杜絕,需要一個以「台北年份」為鍵的唯一索引;
       created_at 的時區轉換不是 immutable,得先加一個產生欄位。
       **這件事還沒做,不要把現況說成「不可能重複」。**

     ⚠ 回 409 而不是 400:前端要分得出「這次輸入有問題」與
       「你本來就不能再存了」,兩者的處理方式完全不同。 */
  /* 白名單的人跳過這道關卡。
     留一行 log —— 這是【刻意繞過業務規則】,出現在製作端的工單
     與一般客人的完全一樣,所以要在紀錄裡看得到是誰、什麼時候繞的。 */
  if (isUnlimited(who)) {
    console.log('[cloth] 略過一年一件與生日月的限制 erpid=' + who.erpid);
  }

  /* ===== 三道關卡,順序不可調換 =====
       ① 有沒有待重做的退件 → 有就直接放行(略過②③)
       ② 本年度做過了嗎     → 做過就 409
       ③ 是不是生日月       → 問我方

     ③ 排在最後,是因為它是唯一要跨網路的一道;
     前兩道在本地就答得出來,先擋掉能少打我方一次。 */
  const cur = isUnlimited(who) ? null : await thisYearOne(db, who);
  if (cur === undefined) {
    // 查不到 = 無法判斷。此時放行等於在資料庫抖一下的時候讓所有人都能再存一張。
    return reply('500', { message: '無法確認本年度狀態,請稍後再試' }, 500);
  }

  const redo = isRedoPending(cur);

  if (!isUnlimited(who) && !redo) {
    if (cur) {
      return reply('409', {
        message: '本年度的客製眼鏡布已經完成,一年一件,明年才能再做一件。',
        data: { current: cur },
      }, 409);
    }

    /* 生日月。問我方,拿到什麼顯示什麼。
       null(問不到)一律擋下 —— 理由見 askEligible 的說明。 */
    const el = await askEligible(who);
    if (el === null) {
      return reply('503', { message: SYS_ERR_MSG }, 503);
    }
    if (!el.ok) {
      /* 403 而不是 409:409 的意思是「你已經做過了」,
         這裡是「你現在還不能做」,前端的處理與文案都不同。 */
      return reply('403', {
        message: el.message || '目前尚未開放製作。',
        data: { reason: el.reason, birth_month: el.birth_month },
      }, 403);
    }
  }

  if (redo) {
    /* 重做會產生【新的一筆】,不覆蓋被退件的那一筆。
       保留原件才看得出退件過幾次、退的理由是什麼;
       覆蓋的話那段歷史就消失了,而它正是要拿來檢討的東西。 */
    console.log('[cloth] 退件重做 previous=' + cur.id);
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
      /* 旋轉角(度,順時針)。2026-08-27 新增。
         ⚠ 這個值會傳到製作端並套進 DXF —— 它不是裝飾,
         做出來的東西會照著轉。所以要正規化成 0–359,
         而不是原封不動存進去:負數或 400 度在畫面上看不出問題,
         到了 DXF 那一端才會變成轉錯方向。 */
      rot: normDeg(p.rot),
      basis: 'cloth_image',
    },

    /* 取貨門市。前端傳的是 { erpid, name, city }。
       -----------------------------------------------------------
       ⚠ 三個值都是【前端給的】,所以只做長度與字元的限制,
       不當成可信資料。它們的用途是「印在製作單上給人看」與
       「分流到哪一條產線」,不是授權判斷 —— 沒有任何東西
       因為這三個欄位而被允許或拒絕。

       為什麼不在這裡用 erpid 去反查店名:這支要為每一次儲存
       多打一次門市 API,而那台是外部系統。存下來的是當下的
       快照,製作端不必連線就看得到,也不會因為門市改劃區域
       而讓一件已排入產線的工作隔天跳到另一組人手上。

       沒選門市是合法的:落在製作端的「其他」,人工處理。 */
    ...pickStore(body.store),
  };

  const { data, error } = await db.from('cloth_designs').insert(row).select('id').single();
  if (error) {
    console.error('[cloth] 存檔失敗:', error.message);
    return reply('500', { message: '儲存失敗,請再試一次' }, 500);
  }

  console.log('[cloth] 存檔 ' + data.id + ' source=' + source + (redo ? ' (退件重做)' : ''));
  return reply('200', { data: { id: data.id } });
});
