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

const CODE_VERSION = '2026-09-09b · gallery_posts 擴到後台九個寫入點';

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

   ⚠ 這一支是【逐批】搬進來的,不是一次全開。
     搬一批、後台驗一次、再搬下一批;因為後台沒有測試環境,
     一次搬七張表出事了會分不出是哪一張。
       第一批(已驗)  member_status、site_settings
       第二批        banners、featured_creators
       還沒搬        news、categories、collabs、collab_customer_photos */
type Rule = { key: string; ops: string[]; cols: string[] };
const ALLOW: Record<string, Rule> = {
  member_status: {
    key: 'member_id',
    ops: ['upsert', 'update'],
    cols: ['member_id', 'status', 'reason', 'suspended_at', 'updated_at'],
    // suspended_by 不在這裡:由伺服器填,見下面「伺服器自己填的欄位」
  },
  site_settings: {
    key: 'key',
    ops: ['upsert'],
    cols: ['key', 'value', 'updated_at'],
  },
  banners: {
    key: 'id',
    ops: ['insert', 'update', 'delete'],
    cols: ['position', 'image_url', 'image_url_mobile', 'title', 'subtitle',
           'cta_text', 'link_url', 'is_active', 'sort_order', 'updated_at'],
  },
  featured_creators: {
    key: 'featured_month',
    ops: ['insert', 'delete'],
    cols: ['creator_id', 'featured_month', 'sort_order'],
    // featured_by 不在這裡:同 suspended_by,由伺服器填
  },

  news: {
    key: 'id',
    ops: ['insert', 'update', 'delete', 'news_clear_featured'],
    /* ⚠ 2026-09-08 修正。這串原本是【憑印象寫的】,結果:
         · 少了首頁曝光那一整組(show_in_homepage、homepage_* 六欄)、
           excerpt、cta_buttons、author —— 一存檔就被自己的白名單擋下
         · 多了 summary / tags / link_url —— 這三欄在 news 表【根本不存在】
       下面這串是對著資料表實際欄位抄的,不是想出來的。
       加欄位時請先確認資料表真的有,多寫一個不會報錯,只會在
       某天有人真的送它的時候才爆。 */
    cols: ['id', 'title', 'slug', 'category', 'excerpt', 'content', 'cover_image_url',
           'status', 'is_featured', 'sort_order', 'published_at', 'scheduled_at',
           'view_count', 'author', 'updated_at',
           'show_in_homepage', 'homepage_tag', 'homepage_subtitle',
           'homepage_image_url', 'homepage_link_type', 'homepage_link_url',
           'homepage_text_hidden', 'cta_buttons'],
    // author_id 不在這裡:同 suspended_by / featured_by,由伺服器填
  },
  categories: {
    key: 'id',
    ops: ['insert', 'update', 'delete'],
    cols: ['id', 'parent_id', 'name', 'sort_order', 'is_active', 'designer_prompts'],
  },
  collabs: {
    key: 'id',
    ops: ['insert', 'update', 'delete'],
    /* 聯名頁欄位很多,而且都是後台自己填的內容。
       這裡不逐欄列出會失去白名單的意義,所以照著後台的 payload 抄。 */
    cols: ['id', 'slug', 'brand_name', 'category', 'status', 'lifecycle_status',
           'hero_eyebrow', 'hero_title', 'hero_subtitle', 'hero_image_url',
           'story_image_url', 'story_paragraphs', 'packages_group_photo_url',
           'creator_name', 'creator_subtitle', 'creator_avatar_url',
           'interview_title', 'interview_quote', 'interview_full_link',
           'date_range_text', 'launch_date_text', 'start_date', 'end_date',
           'show_countdown', 'show_limit', 'limit_total', 'preorder_count',
           'preorder_link', 'store_link', 'available_stores', 'is_locked',
           'theme_primary', 'theme_accent', 'theme_bg', 'sort_order', 'updated_at'],
  },
  /* ===== 聯名子表 =====
     🚨 2026-09-07 補。這三張在 Tier 1 被誤判成「沒人寫」而收掉了 ALL 政策 ——
     因為後台的 saveSubtable() 用【變數】當表名(client.from(table)),
     grep 字面表名只看得到 select。實際上編輯聯名頁按儲存時
     會對它們 delete + upsert,收掉之後那個儲存就壞了。

     教訓:判斷「有沒有人寫這張表」不能只 grep 字面的表名。 */
  collab_packages: {
    key: 'id',
    ops: ['upsert', 'delete'],
    cols: ['id', 'collab_id', 'name', 'image_url', 'meta', 'sort_order'],
  },
  collab_designs: {
    key: 'id',
    ops: ['upsert', 'delete'],
    cols: ['id', 'collab_id', 'label', 'preview_image_url', 'sort_order'],
  },
  collab_customer_photos: {
    key: 'id',
    ops: ['insert', 'upsert', 'delete'],
    cols: ['id', 'collab_id', 'image_url', 'caption', 'sort_order'],
  },

  /* ===== 刻圖與投稿的【後台】寫入(2026-09-09 第四批) =====
     ⚠ 這兩張表【不能因此就收政策】。它們還有客人端的寫入點:
         · engraving_designs —— member-portal 的 Auto-Creator
           (認領孤兒作品 + 匯入 icons.json 舊作品)
         · gallery_posts     —— 客人投稿、客人刪自己的投稿
     那些要另外進 design.ts、而且需要伺服器端拿得到客人姓名
     (auth-session 的 verify 目前不回姓名)。搬完那些才能收。

     reviewed_by 不在 cols 裡:誰審的由伺服器填,見下面「伺服器自己填的欄位」。 */
  engraving_designs: {
    key: 'id',
    ops: ['update', 'delete'],
    cols: ['status', 'reject_reason', 'reviewed_at',
           'name', 'slogan', 'category', 'keywords', 'designer_name',
           'erp_number', 'price', 'is_show'],
    /* 刻意【不開】creator_id 與 image_url* ——
       前者是「這件作品屬於誰」,後者是作品本身。
       後台沒有改它們的功能,開了只是把攻擊面留在那裡。
       重新描圖改 image_url_svg 走 design 函式,那支會檢查影響幾列。 */
  },
  gallery_posts: {
    key: 'id',
    ops: ['insert', 'update', 'delete'],
    /* 2026-09-09 從「只有審核那三欄」擴到後台九個寫入點都用得到。
       客人自己的投稿走另一支(gallery 函式),那邊會比對擁有者;
       這裡是管理員,本來就會動別人的東西,所以不比對。

       ⚠ member_id 開著是因為【官方上傳與聯名照片要指定作者】:
         樂活官方上傳寫 'OFFICIAL',聯名照片寫 'collab-<id>'。
         這是管理員動作,呼叫端已經驗過是 admins 表裡的人。
         客人端那一支【沒有】開這個欄位 —— 那裡的作者只能是他自己。 */
    cols: ['title', 'topic', 'carrier', 'story', 'type',
           'customer_name', 'member_id', 'image_urls', 'main_image_url',
           'is_public', 'subcategories',
           'status', 'reject_reason', 'reviewed_at'],
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

  /* delete 與 news_clear_featured 不帶資料,其餘都要。
     upsert 另外接受 rows 陣列(後台的聯名子表是一次存一整批)。 */
  const noBody = (op === 'delete' || op === 'news_clear_featured');
  const rowsIn: any[] = noBody ? []
    : (Array.isArray(body.rows) ? body.rows : [body.row]);

  if (!noBody) {
    if (!rowsIn.length) return reply('006', { message: '缺少資料內容' }, 400);
    if (rowsIn.length > 200) return reply('006', { message: '一次最多 200 筆' }, 400);
    for (const r of rowsIn) {
      if (!r || typeof r !== 'object' || Array.isArray(r)) {
        return reply('006', { message: '資料格式錯誤' }, 400);
      }
    }
  }
  const row = rowsIn[0] || {};

  /* ⚠ 沒列在白名單的欄位【直接拒絕】,不要默默丟掉。
     默默丟掉的話呼叫端會以為存進去了,而那正是今天已經踩過一次的
     「畫面說成功、資料沒變」。 */
  for (const r of rowsIn) {
    const bad = Object.keys(r).filter((k) => rule.cols.indexOf(k) < 0);
    if (bad.length) {
      return reply('006', { message: '不允許寫入這些欄位:' + bad.join(', ') }, 400);
    }
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
  /* 同理:本月精選是誰設定的。原本後台送
     `featured_by: LohasAuth.getStoredMember().erpid || 'admin'` ——
     來自 localStorage,而且拿不到時退回字串 'admin',
     等於這個欄位既可偽造、又可能根本沒有意義。 */
  if (table === 'featured_creators' && op === 'insert') {
    row.featured_by = caller;
  }
  /* 同理:最新消息是誰建的。 */
  if (table === 'news' && op === 'insert') {
    for (const r of rowsIn) r.author_id = caller;
  }
  /* 同理:這件刻圖／投稿是誰審的。
     ⚠ 「重新開放審核」是把狀態退回 pending,那時要把 reviewed_by
        清成 null —— 不是留著上一個審核者的名字。前端不必(也不能)
        送這個欄位,狀態決定它的值。 */
  if ((table === 'engraving_designs' || table === 'gallery_posts') && op === 'update') {
    for (const r of rowsIn) {
      if (r.status === 'approved' || r.status === 'rejected') r.reviewed_by = caller;
      else if (r.status === 'pending') r.reviewed_by = null;
    }
  }

  try {
    if (op === 'news_clear_featured') {
      /* 「把本月精選換成另一篇」的第一步:先清掉現有的那一篇。
         ⚠ 這是唯一一個【條件不是主鍵】的動作(eq('is_featured', true)),
           所以做成專用動作而不是開放任意條件 —— 開放的話
           `update ... where 任意欄位` 就變成一個合法請求。
           這個動作【不接受任何客戶端參數】,條件寫死在這裡。 */
      const { error } = await db.from('news')
        .update({ is_featured: false }).eq('is_featured', true);
      if (error) throw error;
      // 本來就可能一篇都沒有,0 列是正常的,不檢查

    } else if (op === 'insert') {
      /* ⚠ 回傳整列。後台新增聯名之後要拿 id 去存子表 ——
         只回主鍵的話那條流程接不下去。呼叫端是已驗證的管理員,
         回整列不會多洩漏任何他本來看不到的東西。 */
      const { data, error } = await db.from(table).insert(rowsIn).select('*');
      if (error) throw error;
      if (!data || !data.length) {
        return reply('007', { message: '沒有寫入任何資料' }, 404);
      }
      return reply('200', { data: { row: data[0], rows: data } });

    } else if (op === 'delete') {
      /* ⚠ 條件只能是白名單指定的那個鍵,而且一定要有值 ——
         少了這道,`delete` 不帶條件就是「清空整張表」。 */
      /* 單筆用 match_value,多筆用 match_values(陣列)——
         後台的聯名子表是「這一批被刪掉的一起刪」。
         ⚠ 兩個都沒給就拒絕:少了這道,delete 不帶條件就是清空整張表。 */
      const many = Array.isArray(body.match_values) ? body.match_values : null;
      const matchVal = body.match_value;
      if (many) {
        const list = many.filter(function (v: any) {
          return v !== undefined && v !== null && v !== '';
        });
        if (!list.length) return reply('006', { message: '缺少 ' + rule.key }, 400);
        if (list.length > 200) return reply('006', { message: '一次最多 200 筆' }, 400);
        const { error } = await db.from(table).delete().in(rule.key, list);
        if (error) throw error;
      } else {
        if (matchVal === undefined || matchVal === null || matchVal === '') {
          return reply('006', { message: '缺少 ' + rule.key }, 400);
        }
        const { error } = await db.from(table).delete().eq(rule.key, matchVal);
        if (error) throw error;
      }
      /* 刪除【不檢查影響幾列】:後台有幾處是「先刪掉本月的,再新增」,
         本來就常常是 0 列。把 0 列當失敗會讓那個流程每次都報錯。 */

    } else if (op === 'upsert') {
      // 每一筆都要有主鍵 —— 沒有的話 onConflict 無從比對
      for (const r of rowsIn) {
        if (r[rule.key] === undefined || r[rule.key] === null || r[rule.key] === '') {
          return reply('006', { message: '缺少 ' + rule.key }, 400);
        }
      }
      const { data, error } = await db.from(table)
        .upsert(rowsIn, { onConflict: rule.key })
        .select(rule.key);
      if (error) throw error;
      if (!data || !data.length) {
        console.warn('[admin-write] upsert 影響 0 列', table);
        return reply('007', { message: '沒有寫入任何資料' }, 404);
      }
    } else {
      /* update:條件只能是白名單指定的那個鍵。
         接受任意條件的話,`update where true` 就是一個合法請求。

         單筆用 match_value,多筆用 match_values(陣列)——
         後台「批次改價」是把篩選結果一次改掉,原本是 .in('id', ids)。 */
      const manyU = Array.isArray(body.match_values) ? body.match_values : null;
      const matchVal = body.match_value;
      let q = db.from(table).update(row);
      if (manyU) {
        const list = manyU.filter(function (v: any) {
          return v !== undefined && v !== null && v !== '';
        });
        if (!list.length) return reply('006', { message: '缺少 ' + rule.key }, 400);
        if (list.length > 500) return reply('006', { message: '一次最多 500 筆' }, 400);
        q = q.in(rule.key, list);
      } else {
        if (matchVal === undefined || matchVal === null || matchVal === '') {
          return reply('006', { message: '缺少 ' + rule.key }, 400);
        }
        q = q.eq(rule.key, matchVal);
      }
      const { data, error } = await q.select(rule.key);
      if (error) throw error;
      if (!data || !data.length) {
        console.warn('[admin-write] update 影響 0 列', table, matchVal ?? '(批次)');
        return reply('007', { message: '找不到要更新的資料' }, 404);
      }
      /* ⚠ 批次時把【實際改到幾列】回給呼叫端。
         篩選結果 40 筆卻只改到 3 筆是一個要看得見的事實,
         不然又是一次「畫面說成功、資料沒動」。 */
      if (manyU) return reply('200', { data: { affected: data.length } });
    }
  } catch (e) {
    console.error('[admin-write] 寫入失敗:', table, op, (e as Error).message);
    return reply('500', { message: '寫入失敗,請再試一次' }, 500);
  }

  console.log('[admin-write] ' + caller + ' ' + op + ' ' + table);
  return reply('200', {});
});
