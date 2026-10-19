/* =============================================================
   Supabase Edge Function: design
   -------------------------------------------------------------
   創作者對【自己的】刻圖做上架 / 下架 / 刪除(垃圾桶)。

   === 為什麼要有這一支(2026-09-05) ===
   在這之前 member-portal.js 是直接打表:

       sb.from('engraving_designs').update({ is_show: '垃圾桶' }).eq('id', id)

   注意那一行【沒有任何擁有者條件】—— 連前端的形式檢查都沒有,
   只有一個 id。而 engraving_designs 的 anon 政策是無條件放行,
   anon key 又公開在 GitHub 上。

   結果是:任何人都能把【市集裡任何一張刻圖】下架或丟進垃圾桶,
   包含別人的作品。而且畫面上不會有任何異常,
   創作者只會發現自己的作品「不見了」。

   這一支把擁有者判斷搬到伺服器:先用 session token 解出客編,
   再確認那張圖的 creator_id 真的是他,才動手。

   === 為什麼不做成「順便什麼都能改」 ===
   只開 is_show 與 status 兩個欄位,而且值是白名單。
   開放整包 updates 的話,這支就變成「經過驗證的任意欄位寫入」——
   價格、名稱、image_url_svg 都會跟著能改,那等於沒修。

   部署:Supabase Dashboard → Edge Functions → 新增 design → 貼上本檔
        Verify JWT 要【關閉】(我方自己驗 session token)

   ⚠ 這支不需要任何 Secret。
   ============================================================= */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const AUTH_FN = `${SUPABASE_URL}/functions/v1/auth-session`;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CODE_VERSION = '2026-10-19 · 簽完名直接上架';

/* ===== 刻圖送審的著作權聲明(2026-10-16)=====
   -----------------------------------------------------------------
   送審(submit)與重新送審(update_own)一律要附上簽名,而且簽的必須是
   【這一版】。簽名、聲明全文、簽署人(從 token 取)與時間寫進
   design_agreements(RLS 開著、沒有政策,只有這支寫得進去)。

   ⚠ 前端 js/upload-design.js 的 AGREEMENT 顯示給客人看的是同一段文字,
     兩邊的 version 與內容要一起改。只改一邊的話 version 對不上,
     這裡會拒收(大聲壞掉,不會讓客人簽了一版、存成另一版)。
   ⚠ 改條文就要換 version —— 已簽的人簽的是舊的那一版,
     存在 agreement_text 裡的也是舊的,這樣才對得起來。 */
const AGREEMENT_VERSION = '2026-10-16-v1';
const AGREEMENT_TEXT = [
  '【刻圖作品著作權聲明】',
  '一、本人保證送審之作品為本人原創,或已取得著作權人之合法授權,未侵害任何第三人之著作權、商標權、肖像權或其他權利。',
  '二、如本作品發生任何侵權爭議、索賠或訴訟,概由本人自行負擔全部法律責任及相關費用,與樂活眼鏡無涉;如致樂活眼鏡受有損害,本人願負賠償責任。',
  '三、樂活眼鏡於接獲侵權通知,或認為作品有侵權疑慮時,得不經通知逕行下架或刪除該作品,本人無異議。',
  '四、本人已詳閱並同意以上內容,並以下方簽名確認。',
].join('\n');

/* 簽名圖:canvas.toDataURL('image/png')。設上下限 ——
   太短代表空白或假造,太長則是有人塞大檔(資料表另有 400,000 字的 CHECK)。 */
function checkSignature(sig: unknown): string {
  const s = String(sig || '');
  if (!s.startsWith('data:image/png;base64,')) return '';
  if (s.length < 800 || s.length > 400000) return '';
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s)) return '';
  return s;
}

/* ===== 簽完名直接上架(2026-10-19 營運決定:不再人工審核)=====
   -----------------------------------------------------------------
   原本「審核通過」由後台的人做,會做四件事(admin-portal.js 的 submitApproval):
     ① 到 ERP 建檔取號(create-erp-product,同一件重複叫只建一次)
     ② 售價(審核的人選 500 / 800 / 1000,預設 1000)
     ③ status='approved'、is_show='上架'、reviewed_at
     ④ 推播「已上架」+ 站內訊息
   現在改由這裡在送審當下做完。

   營運決定(2026-10-19):
     · 售價一律 1000(作品原本有售價的沿用,例如下架再上架的)
     · ERP 建檔失敗 → 留在 pending,後台「刻圖審核」照舊可以人工按通過(會重新建檔)
       —— 沒有 ERP 編號就上架的話,有人下單時對不到 ERP 商品
     · 照舊發上架通知

   ⚠ 例外,仍然走人工(留 pending):
     · 被駁回(rejected)的作品修改後重送 —— 駁回多半是因為侵權或內容,
       讓他改個名字就自動回到市集,等於駁回沒有作用
     · 沒有簽署紀錄的舊作品重新上架(set_show) */
const ANON_KEY      = Deno.env.get('SUPABASE_ANON_KEY') || '';
const ERP_CREATE_FN = `${SUPABASE_URL}/functions/v1/create-erp-product`;
const NOTIFY_FN     = `${SUPABASE_URL}/functions/v1/lohas-api-proxy`;
const AUTO_PRICE    = 1000;
/* 每人每天最多送審幾件(台北時間的一天,管理員不限)。
   原本只有前端在擋;沒有人工審核之後,這道一定要在伺服器。 */
const DAILY_LIMIT   = 3;

async function createErp(designId: string, name: string): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(ERP_CREATE_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ANON_KEY, 'apikey': ANON_KEY },
      body: JSON.stringify({ designId, name }),
      signal: ctl.signal,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.returnCode !== 'SUCCESS' || j.bindingId == null) {
      throw new Error(j.returnMsg || ('HTTP ' + r.status));
    }
    return String(j.bindingId);
  } finally {
    clearTimeout(timer);
  }
}

/* 上架:ERP 取號 → 寫回作品。失敗就維持 pending,回 { listed:false }。 */
async function autoList(
  designId: string, name: string, existingPrice: unknown,
): Promise<{ listed: boolean; reason?: string }> {
  let erp = '';
  try {
    erp = await createErp(designId, name);
  } catch (e) {
    console.error('[design] ERP 建檔失敗,留在待審核', designId, (e as Error).message);
    return { listed: false, reason: 'erp' };
  }
  const price = Number(existingPrice) > 0 ? Number(existingPrice) : AUTO_PRICE;
  const { error } = await db.from('engraving_designs').update({
    status: 'approved', is_show: '上架', price, erp_number: erp,
    reviewed_at: new Date().toISOString(),
  }).eq('id', designId);
  if (error) {
    console.error('[design] 上架寫入失敗,留在待審核', designId, error.message);
    return { listed: false, reason: 'db' };
  }
  return { listed: true };
}

/* 上架通知:App 推播(進「樂活訊息」)+ 站內客服訊息。
   與後台 sendApprovalNotice 同兩條路;失敗只記 log,不影響上架。 */
async function notifyListed(erpid: string, name: string, designId: string) {
  const link = 'https://www.lohasglasses.com/market.html?design=' + encodeURIComponent(designId);
  const message = '恭喜!您的刻圖「' + name + '」已上架創作者市集,可至市集查看。';
  const results = await Promise.allSettled([
    fetch(NOTIFY_FN, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': 'Bearer ' + ANON_KEY, 'apikey': ANON_KEY,
        'x-lohas-mode': 'prod', 'x-lohas-host': 'realtime',
      },
      body: JSON.stringify({
        method: 'CSLeftMessagePush', client_id: erpid,
        title: '刻圖上架通知', message, view_status: 2, link,
      }),
    }).then(async (r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json().catch(() => ({}));
      if (j && j.statecode != null && String(j.statecode) !== '0') throw new Error('statecode=' + j.statecode);
    }),
    db.from('cs_messages').insert({
      member_erpid: erpid, design_id: designId, message, is_read: false, sender: 'staff',
    }).then(({ error }) => { if (error) throw error; }),
  ]);
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.warn('[design] 上架通知失敗(' + (i === 0 ? 'App 推播' : '站內訊息') + ')', erpid, String(r.reason));
    }
  });
}

/* 台北時間今天 00:00 的 ISO 字串(函式跑在 UTC,不能用 setHours) */
function taipeiDayStart(): string {
  const t = new Date(Date.now() + 8 * 3600 * 1000);
  const ymd = t.toISOString().slice(0, 10);
  return new Date(ymd + 'T00:00:00+08:00').toISOString();
}

/* 舊站留下來的作品清單。伺服器自己抓 —— 前端送進來的話,
   等於「匯入什麼由客人決定」。 */
const ICONS_URL = 'https://www.lohasglasses.com/data/icons.json';
const MAX_IMPORT = 300;   // 一個人一次最多匯入幾件

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

/* 回 { erpid, name }。
   ⚠ name 只能來自這裡(auth-session 簽在 token 裡的),
     絕對不可以改成從 body 讀 —— 見 auto_creator 那一段。 */
async function whoFromToken(
  token: string,
): Promise<{ erpid: string; name: string } | null> {
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
    if (!erpid) return null;
    return { erpid, name: String(j?.name ?? j?.data?.name ?? '').trim() };
  } catch {
    return null;
  }
}

const HITS = new Map<string, number[]>();
function rateLimited(key: string): boolean {
  const now = Date.now();
  const arr = (HITS.get(key) || []).filter((t) => now - t < 60 * 60 * 1000);
  arr.push(now);
  HITS.set(key, arr);
  if (HITS.size > 5000) HITS.clear();
  return arr.length > 60;
}

/* 允許的目標狀態。白名單,不是「前端傳什麼就寫什麼」。
   ⚠ 重新上架要一併把 status 打回 pending —— 那是既有的業務規則
     (重新上架必須重走審核)。少了這一條,下架再上架就變成
     一條繞過審核的路。 */
const SHOW_VALUES: Record<string, Record<string, string>> = {
  '上架':   { is_show: '上架', status: 'pending' },
  '下架':   { is_show: '下架' },
  '垃圾桶': { is_show: '垃圾桶' },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (req.method === 'GET') {
    return reply('200', { data: { code_version: CODE_VERSION } });
  }

  if (req.method !== 'POST') return reply('405', { message: '只接受 POST' }, 405);

  let body: Record<string, any>;
  try { body = await req.json(); }
  catch { return reply('006', { message: '請求格式錯誤' }, 400); }

  const ACTIONS = ['set_show', 'retrace', 'auto_creator', 'submit', 'update_own'];
  const action = String(body.action || '');
  if (ACTIONS.indexOf(action) < 0) {
    return reply('006', { message: '不支援的動作' }, 400);
  }

  const who = await whoFromToken(String(body.token || ''));
  if (!who) return reply('401', { message: '登入狀態已失效,請重新登入' }, 401);
  const erpid = who.erpid;

  if (rateLimited(erpid)) {
    return reply('429', { message: '操作太頻繁,請稍候再試' }, 429);
  }

  /* ===== auto_creator:舊作品自動認回本人,並升級為創作者 =====
     -----------------------------------------------------------------
     🚨 2026-09-09 從前端搬進來。原本這整段跑在【客人的瀏覽器】:

       js/member-portal.js
         .update({ creator_id: member.erpid })
         .eq('designer_name', member.name).is('creator_id', null)
       js/legacy-icons.js
         .insert({ ...icons.json 的一筆, status: 'approved' })

     兩個都是 anon 身分直接打表,而條件與要寫的值全都來自前端。
     也就是說:
       · 送別人的姓名 → 把別人的無主作品認領成自己的(而且開始算分潤)
       · 自己組一筆 payload → 塞一件 status='approved' 的作品進市集,
         完全不經過審核

     搬進來之後,姓名只認 token 裡簽出來的那一份(auth-session 的
     verify 回傳),icons.json 由伺服器自己去抓、自己比對。
     ⚠ 這一段【不接受任何前端傳入的欄位】,body 只有 token。

     沒有 id,所以放在下面那道作品編號檢查【之前】。 */
  if (action === 'auto_creator') {
    // 沒有姓名就什麼都不做。舊 token 沒簽姓名,下次登入(最多七天)就有了
    if (!who.name) return reply('200', { data: { skipped: 'no_name' } });

    // 已經是創作者就不必再跑
    const { data: already } = await db.from('creator_info')
      .select('member_id').eq('member_id', erpid).eq('status', 'active').maybeSingle();
    if (already) return reply('200', { data: { skipped: 'already_creator' } });

    /* A. 先認領 Supabase 既有的孤兒作品(同名 + 還沒有主人)。
       ⚠ 同名不同人是這個做法先天的風險 —— 但它跟搬進來之前一樣,
         不是這次改動造成的。差別在於現在姓名是伺服器簽的,
         而不是前端說了算。 */
    const { data: claimed, error: claimErr } = await db.from('engraving_designs')
      .update({ creator_id: erpid })
      .eq('designer_name', who.name)
      .is('creator_id', null)
      .select('id');
    if (claimErr) {
      console.error('[design/auto_creator] 認領失敗', erpid, claimErr.message);
      return reply('500', { message: '系統忙碌,請稍後再試' }, 500);
    }
    let claimedCount = claimed?.length || 0;
    let importedCount = 0;

    /* B. 一件都沒有才去翻 icons.json(舊站留下來的作品清單)。
       這是靜態檔,伺服器自己抓 —— 前端送進來的話等於可以自訂內容。 */
    if (!claimedCount) {
      try {
        const res = await fetch(ICONS_URL, { headers: { 'Cache-Control': 'no-cache' } });
        if (res.ok) {
          const all = await res.json();
          const mine = (Array.isArray(all) ? all : [])
            .filter((x: any) => String(x?.designer || '').trim() === who.name)
            .slice(0, MAX_IMPORT);

          if (mine.length) {
            /* 查重:同一個 designer_name + name + type='legacy' 只留一筆。
               少了這道,重整頁面就會再匯入一次。 */
            const { data: exist } = await db.from('engraving_designs')
              .select('name').eq('designer_name', who.name).eq('type', 'legacy');
            const seen = new Set((exist || []).map((r: any) => String(r.name || '')));

            const rows = mine
              .filter((x: any) => !seen.has(String(x?.name || '')))
              .map((x: any) => {
                const row: Record<string, unknown> = {
                  name:          String(x?.name || ''),
                  slogan:        String(x?.slogan || ''),
                  category:      String(x?.category || ''),
                  keywords:      String(x?.keywords || ''),
                  creator_id:    erpid,
                  designer_name: who.name,
                  status:        'approved',   // 舊作品視為已上架,與搬進來之前一致
                  type:          'legacy',
                };
                if (x?.image_jpg) row.image_url = String(x.image_jpg);
                if (x?.image_png) row.image_url_png = String(x.image_png);
                const t = String(x?.timestamp || '');
                if (/^\d{14}$/.test(t)) {
                  const iso = t.slice(0, 4) + '-' + t.slice(4, 6) + '-' + t.slice(6, 8) +
                              'T' + t.slice(8, 10) + ':' + t.slice(10, 12) + ':' + t.slice(12, 14);
                  const d = new Date(iso);
                  if (!isNaN(d.getTime())) row.listed_at = d.toISOString();
                }
                return row;
              });

            if (rows.length) {
              const { data: ins, error: insErr } = await db.from('engraving_designs')
                .insert(rows).select('id');
              if (insErr) {
                console.error('[design/auto_creator] 匯入失敗', erpid, insErr.message);
              } else {
                importedCount = ins?.length || 0;
              }
            }
          }
        }
      } catch (e) {
        // 匯入失敗不影響認領,也不該把客人擋在外面
        console.warn('[design/auto_creator] icons.json 讀取失敗', (e as Error).message);
      }
    }

    if (!claimedCount && !importedCount) {
      return reply('200', { data: { skipped: 'no_works' } });
    }

    // C. 兩者有其一才建立創作者身分
    const { data: created, error: ciErr } = await db.from('creator_info')
      .insert({ member_id: erpid, display_name: who.name, status: 'active' })
      .select().maybeSingle();
    if (ciErr) {
      console.error('[design/auto_creator] creator_info 建立失敗', erpid, ciErr.message);
      return reply('500', { message: '系統忙碌,請稍後再試' }, 500);
    }

    console.log('[design/auto_creator] ' + erpid + ' 認領 ' + claimedCount +
                ' 匯入 ' + importedCount);
    return reply('200', {
      data: { claimed: claimedCount, imported: importedCount, creator_info: created },
    });
  }

  /* ===== submit / update_own:客人送審與修改自己的作品 =====
     -----------------------------------------------------------------
     🚨 2026-09-09 從 js/upload-design.js 搬進來。原本是:

       sb.from(CONFIG.TABLE).insert(payload)                    ← 新作品
       sb.from(CONFIG.TABLE).update(payload).eq('id', editId)   ← 修改

     兩個問題:
       · payload 帶 `creator_id: String(member.erpid)`,而 member
         來自 localStorage —— 作品掛在誰名下由前端說了算
       · update 的條件【只有 id】,沒有比對這件作品是不是他的。
         擋住它的一直只有 RLS,而那條政策是無條件放行 ——
         也就是任何人都能改掉任何一件刻圖的名稱與圖檔。

     搬進來之後 creator_id / designer_name 一律由伺服器從 token 填,
     update 先讀出原列比對擁有者,對不上直接 403。 */
  if (action === 'submit' || action === 'update_own') {
    const name = String(body.name || '').trim();
    if (!name) return reply('006', { message: '作品名稱不可空白' }, 400);

    /* 著作權聲明與簽名(2026-10-16)。放在最前面擋 ——
       沒簽的不寫任何東西。前端的「確認送出」鈕只是介面,擋不住直接打 API 的人。 */
    const ag = (body.agreement || {}) as Record<string, unknown>;
    if (String(ag.version || '') !== AGREEMENT_VERSION) {
      return reply('006', {
        message: '著作權聲明已更新,請重新整理頁面後再簽署送出',
      }, 400);
    }
    const signature = checkSignature(ag.signature);
    if (ag.accepted !== true || !signature) {
      return reply('006', { message: '請先閱讀著作權聲明、勾選同意並簽名' }, 400);
    }
    const agreementRow = (designId: string) => ({
      design_id:      designId,
      erpid,
      signer_name:    who.name || null,     // 只認 token 裡的姓名
      version:        AGREEMENT_VERSION,
      agreement_text: AGREEMENT_TEXT,       // 存伺服器這份,不存前端顯示的
      action,
      signature_png:  signature,
      user_agent:     (req.headers.get('user-agent') || '').slice(0, 300) || null,
      ip:             (req.headers.get('x-forwarded-for') || '').split(',')[0].trim().slice(0, 64) || null,
    });

    /* 圖檔網址只收自家 Storage 的公開網址。
       不驗的話,前端可以把 image_url 指到任意網站 ——
       那些圖會出現在市集,而且我方無法控管內容。 */
    const PREFIX = `${SUPABASE_URL}/storage/v1/object/public/`;
    const urlOk = (u: string) => !u || u.startsWith(PREFIX);
    const imgs: Record<string, string> = {
      image_url:     String(body.image_url || ''),
      image_url_png: String(body.image_url_png || ''),
      image_url_svg: String(body.image_url_svg || ''),
    };
    for (const k of Object.keys(imgs)) {
      if (!urlOk(imgs[k])) {
        console.warn('[design] 外部圖檔網址被拒', erpid, imgs[k].slice(0, 80));
        return reply('006', { message: '圖檔網址不正確' }, 400);
      }
    }

    const row: Record<string, unknown> = {
      name,
      slogan:   String(body.slogan || ''),
      category: String(body.category || ''),
      keywords: String(body.keywords || ''),
      /* 🚨 這三個由伺服器填,不看 body。
         designer_name 是顯示用的作者名,跟認領用的是同一個來源。 */
      creator_id:    erpid,
      designer_name: who.name,
      /* 先以 pending 寫入;簽署紀錄寫好、ERP 建檔成功之後,autoList 才改成上架。
         中間任何一步失敗,作品都停在 pending —— 後台可以人工補,不會半套上架。 */
      status:        'pending',
      type:          'member',
    };
    for (const k of Object.keys(imgs)) if (imgs[k]) row[k] = imgs[k];

    try {
      if (action === 'submit') {
        /* 每日上限(台北時間),管理員不限。原本只有前端擋,
           沒有人工審核之後一定要在伺服器擋。查詢失敗時放行(與前端原本一致)。 */
        const { data: adm } = await db.from('admins')
          .select('member_id, status').eq('member_id', erpid).maybeSingle();
        const isAdmin = !!adm && (!adm.status || adm.status === 'active');
        if (!isAdmin) {
          const { count, error: cntErr } = await db.from('engraving_designs')
            .select('id', { count: 'exact', head: true })
            .eq('creator_id', erpid).gte('created_at', taipeiDayStart());
          if (!cntErr && (count || 0) >= DAILY_LIMIT) {
            return reply('429', { message: '每天最多上傳 ' + DAILY_LIMIT + ' 件刻圖作品,今天已達上限,請明天再來' }, 429);
          }
        }

        const { data, error } = await db.from('engraving_designs')
          .insert(row).select().single();
        if (error) throw error;

        /* 簽署紀錄要和作品同生共死:紀錄寫不進去,就把剛建的作品刪掉 ——
           不能留下一件「在審核佇列裡、卻沒有簽名」的作品。 */
        const { error: agErr } = await db.from('design_agreements').insert(agreementRow(data.id));
        if (agErr) {
          console.error('[design] 簽署紀錄寫入失敗,撤回作品', erpid, data.id, agErr.message);
          await db.from('engraving_designs').delete().eq('id', data.id);
          return reply('500', { message: '簽署紀錄儲存失敗,請再試一次' }, 500);
        }

        // 簽完名直接上架(ERP 建檔失敗就留在 pending,人工補)
        const res = await autoList(data.id, name, null);
        if (res.listed) await notifyListed(erpid, name, data.id);
        console.log('[design] ' + erpid + ' 送出 ' + data.id + (res.listed ? ' 已上架' : ' 留待審核(' + res.reason + ')'));
        return reply('200', { data: { row: { ...data, status: res.listed ? 'approved' : 'pending' }, listed: res.listed } });
      }

      /* update_own —— 先確認這件作品是他的。
         ⚠ 用讀出來的 creator_id 比對,不是把條件寫進 update ——
           兩者結果一樣,但分開寫才能區分「不是你的」與「不存在」,
           而 RLS 濾掉的 update 是 0 列且不報錯,分不出是哪一種。 */
      const target = String(body.id || '').trim();
      if (!/^[0-9a-fA-F-]{36}$/.test(target)) {
        return reply('006', { message: '缺少作品編號' }, 400);
      }
      const { data: own, error: readErr } = await db.from('engraving_designs')
        .select('id, creator_id, status, price').eq('id', target).maybeSingle();
      if (readErr) throw readErr;
      if (!own) return reply('007', { message: '找不到這件作品' }, 404);
      if (String(own.creator_id || '') !== erpid) {
        console.warn('[design] 拒絕修改他人作品 erpid=' + erpid + ' id=' + target);
        return reply('403', { message: '這不是你的作品' }, 403);
      }

      /* 重新送審:先寫簽署紀錄,寫不進去就不改作品(順序與 submit 相反,
         因為這裡作品已經存在,先改再撤回會把舊內容弄丟)。 */
      const { error: agErr } = await db.from('design_agreements').insert(agreementRow(target));
      if (agErr) {
        console.error('[design] 簽署紀錄寫入失敗', erpid, target, agErr.message);
        return reply('500', { message: '簽署紀錄儲存失敗,請再試一次' }, 500);
      }

      const { data, error } = await db.from('engraving_designs')
        .update(row).eq('id', target).select().single();
      if (error) throw error;

      /* 被駁回過的作品修改後重送 → 留在 pending,給人看過再說(理由見 autoList 上方)。
         其他情況簽完名直接上架。 */
      if (String(own.status || '') === 'rejected') {
        console.log('[design] ' + erpid + ' 重送被駁回的作品 ' + target + ',留待人工審核');
        return reply('200', { data: { row: data, listed: false, reason: 'was_rejected' } });
      }
      const res = await autoList(target, name, own.price);
      if (res.listed) await notifyListed(erpid, name, target);
      return reply('200', { data: { row: { ...data, status: res.listed ? 'approved' : 'pending' }, listed: res.listed } });

    } catch (e) {
      const err = e as { code?: string; message?: string };
      // 名稱唯一索引。這句要照原樣傳回去,前端會直接顯示給客人
      if (err.code === '23505' || /duplicate key|unique/i.test(err.message || '')) {
        return reply('009', { message: '「' + name + '」這個名稱已經有人用了,請換一個' }, 409);
      }
      console.error('[design] ' + action + ' 失敗', erpid, err.message);
      return reply('500', { message: '資料寫入失敗,請再試一次' }, 500);
    }
  }

  const id = String(body.id || '').trim();
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
    return reply('006', { message: '缺少作品編號' }, 400);
  }

  /* ===== retrace:後台「重新描圖」換掉 image_url_svg =====
     -----------------------------------------------------------------
     🚨 2026-09-05 補。刻圖管理的「重新描圖」原本是後台以 anon 直接
     `update({ image_url_svg }).eq('id', id)`。當天稍晚把 UPDATE 政策
     縮成「只有 creator_id is null 的列」之後,那個 update 就變成
     影響 0 列 —— 而 supabase-js 對「RLS 濾掉」不回錯誤,
     畫面照樣顯示「完成 22 → 47」,SVG 也照樣傳上 Storage,
     只有資料庫那一行沒變。無聲。

     所以搬進來。這一支走 service_role,不受那條政策影響。

     ⚠ 這是【管理員動作】,與 set_show 的擁有者判斷不同 ——
       後台改的是別人的作品,本來就不該用 creator_id 比對。 */
  if (action === 'retrace') {
    const { data: admin, error: admErr } = await db.from('admins')
      .select('member_id, status').eq('member_id', erpid).maybeSingle();
    if (admErr) return reply('500', { message: '系統忙碌,請稍後再試' }, 500);
    if (!admin || (admin.status && admin.status !== 'active')) {
      // 刻意不說「你不是管理員」—— 回應不該幫人確認自己踩到了什麼
      console.warn('[design] 非管理員嘗試重新描圖', erpid);
      return reply('403', { message: '沒有操作權限' }, 403);
    }

    /* 只收我方 Storage 上的網址。這個值會直接變成製作端下載的檔案 ——
       接受任意網址等於開一條「讓自己人從後台點進外部連結」的路。 */
    const url = String(body.svg_url || '').slice(0, 500);
    let ok = false;
    try {
      const u = new URL(url);
      ok = u.protocol === 'https:' && u.hostname === 'hqdmyxxrskvllkcedybl.supabase.co';
    } catch { ok = false; }
    if (!ok) return reply('006', { message: '線稿網址不合法' }, 400);

    const { data: done, error: upErr } = await db
      .from('engraving_designs')
      .update({ image_url_svg: url })
      .eq('id', id)
      .select('id');

    if (upErr) {
      console.error('[design] 重新描圖寫入失敗:', upErr.message);
      return reply('500', { message: '寫入失敗,請再試一次' }, 500);
    }
    /* ⚠ 一定要看影響了幾列。這整段就是因為「0 列但沒有錯誤」才存在的,
       不檢查的話同一個坑會再踩一次。 */
    if (!done || !done.length) {
      console.warn('[design] 重新描圖影響 0 列 id=' + id);
      return reply('007', { message: '找不到這件作品' }, 404);
    }

    console.log('[design] ' + erpid + ' 重新描圖 ' + id);
    return reply('200', {});
  }

  const patch = SHOW_VALUES[String(body.show || '')];
  if (!patch) return reply('006', { message: '不支援的狀態' }, 400);

  /* 🚨 擁有者判斷在這裡,不在前端。
     先讀出這張圖是誰的,不是他的就 403 —— 而且【不透露那張圖存不存在】,
     兩種情況回同一句話。回「查無此作品」與「這不是你的作品」
     會讓人可以拿這支去枚舉哪些 id 存在。 */
  const { data: row, error: readErr } = await db
    .from('engraving_designs')
    .select('id, creator_id, is_show, status, erp_number')
    .eq('id', id)
    .maybeSingle();

  if (readErr) {
    console.error('[design] 讀取失敗:', readErr.message);
    return reply('500', { message: '操作失敗,請稍後再試' }, 500);
  }
  if (!row || String(row.creator_id || '') !== erpid) {
    console.warn('[design] 拒絕:非本人 erpid=' + erpid + ' id=' + id);
    return reply('403', { message: '找不到這件作品,或它不屬於你' }, 403);
  }

  /* 已經在垃圾桶的不給再動 —— 那是不可逆狀態,
     前端的文案也是這樣寫的(「刪除後永久無法恢復上架」)。 */
  if (String(row.is_show || '') === '垃圾桶') {
    return reply('409', { message: '這件作品已經刪除,無法再變更' }, 409);
  }

  /* 重新上架(2026-10-19 起不再人工審核):
     有簽過著作權聲明、沒被駁回、而且已經有 ERP 編號的 → 直接回到 approved;
     否則照舊回 pending 等人工(沒簽過的舊作品、被駁回的、沒建過 ERP 的)。 */
  let finalPatch: Record<string, string> = patch;
  if (String(body.show) === '上架' && String(row.status || '') !== 'rejected' && row.erp_number) {
    const { count } = await db.from('design_agreements')
      .select('id', { count: 'exact', head: true }).eq('design_id', id);
    if ((count || 0) > 0) finalPatch = { is_show: '上架', status: 'approved' };
  }

  const { error: updErr } = await db
    .from('engraving_designs').update(finalPatch).eq('id', id);

  if (updErr) {
    console.error('[design] 更新失敗:', updErr.message);
    return reply('500', { message: '操作失敗,請再試一次' }, 500);
  }

  console.log('[design] ' + erpid + ' 把 ' + id + ' 設為 ' + body.show + (finalPatch.status ? ' (' + finalPatch.status + ')' : ''));
  return reply('200', { data: { status: finalPatch.status || null } });
});
