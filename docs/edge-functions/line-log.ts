/* =============================================================
   Supabase Edge Function: line-log
   -------------------------------------------------------------
   LINE 官方帳號「樂活工作日誌」的 webhook 接收端。

   做兩件事:
     1. 把群組訊息、以及你轉傳給 bot 的訊息,存進 line_messages
     2. bot 被加進群組時,自動在群裡自我介紹
        —— 這不是禮貌,是告知義務。群裡的人有權知道對話正在被記錄。

   ⚠ 這支函式會收到同事的對話內容。line_messages RLS 全鎖,
     週報產出後請依 schema 檔尾的語法清除原始訊息。

   部署:Supabase Dashboard → Edge Functions → 新增 line-log → 貼上本檔
        Verify JWT 要【關閉】(LINE 不會帶 Supabase 的 JWT)

   部署後把函式網址填回 LINE Developers Console:
     Messaging API 分頁 → Webhook URL
     https://hqdmyxxrskvllkcedybl.supabase.co/functions/v1/line-log
     填完按「Verify」應該回成功,並把「Use webhook」打開。

   另外在 LINE Official Account Manager 要關掉兩個預設值:
     · 自動回應訊息 → 停用(否則同事每發一句 bot 就回一句)
     · 加入好友的歡迎訊息 → 視需要
   並開啟「允許加入群組」,否則 bot 拉不進群。

   金鑰:填在下面兩個常數。只在 Dashboard 填,不要回寫到 GitHub。
   ============================================================= */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ⚠ 只在 Dashboard 填,不要提交回 GitHub
const CHANNEL_SECRET = '';   // LINE Developers → Basic settings → Channel secret
const ACCESS_TOKEN   = '';   // LINE Developers → Messaging API → Channel access token

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

/* 加進群組時的自我介紹。這是告知義務 —— 群裡的人有權知道對話正在被記錄。 */
const JOIN_NOTICE =
  '我是「樂活工作日誌」。我會記錄這個群組的文字訊息,用來整理每週工作摘要,不會外流也不會回覆訊息。';

/* ---------- 簽章驗證 ----------
   LINE 會在 X-Line-Signature 帶上「用 channel secret 對 raw body 做 HMAC-SHA256
   再 base64」的結果。不驗的話,任何人都能偽造 webhook 往你的表塞資料。 */
async function validSignature(raw: string, signature: string): Promise<boolean> {
  if (!signature) return false;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(CHANNEL_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw));
    const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
    // 長度不同就直接不等;長度相同才逐字元比較,避免早退洩漏資訊
    if (expected.length !== signature.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return diff === 0;
  } catch {
    return false;
  }
}

/* ---------- LINE API ---------- */

async function lineFetch(path: string) {
  const r = await fetch('https://api.line.me' + path, {
    headers: { Authorization: 'Bearer ' + ACCESS_TOKEN },
  });
  if (!r.ok) return null;
  return await r.json();
}

async function linePost(path: string, body: unknown) {
  try {
    await fetch('https://api.line.me' + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + ACCESS_TOKEN,
      },
      body: JSON.stringify(body),
    });
  } catch { /* 回覆失敗不該影響記錄 */ }
}

/* 取發話者名稱。只有 userId 的日誌沒人看得懂,但每則都去查太浪費,
   所以查過就寫進 line_members 當快取。 */
async function displayName(userId: string, srcType: string, srcId: string): Promise<string> {
  if (!userId) return '';

  const { data: hit } = await db.from('line_members')
    .select('display_name').eq('user_id', userId).maybeSingle();
  if (hit?.display_name) return hit.display_name;

  let p: any = null;
  if (srcType === 'group')      p = await lineFetch(`/v2/bot/group/${srcId}/member/${userId}`);
  else if (srcType === 'room')  p = await lineFetch(`/v2/bot/room/${srcId}/member/${userId}`);
  else                          p = await lineFetch(`/v2/bot/profile/${userId}`);

  const name = p?.displayName || '';
  if (name) {
    try {
      await db.from('line_members')
        .upsert({ user_id: userId, display_name: name, updated_at: new Date().toISOString() });
    } catch { /* 快取寫失敗無所謂 */ }
  }
  return name;
}

/* 來源第一次出現就建一筆,方便你之後補上群組名稱。
   回傳 false 代表這個來源被你關掉了,不記錄。 */
async function sourceEnabled(sourceId: string): Promise<boolean> {
  const { data } = await db.from('line_sources')
    .select('enabled').eq('source_id', sourceId).maybeSingle();
  if (data) return data.enabled !== false;

  try { await db.from('line_sources').insert({ source_id: sourceId }); } catch { /* 併發重複,忽略 */ }
  return true;
}

/* ============================================================= */

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok');   // LINE 的健康檢查

  if (!CHANNEL_SECRET || !ACCESS_TOKEN) {
    console.error('[line-log] 尚未填入 CHANNEL_SECRET / ACCESS_TOKEN');
    return new Response('ok');     // 一律回 200,否則 LINE 會停用 webhook
  }

  const raw = await req.text();
  const sig = req.headers.get('x-line-signature') || '';
  if (!(await validSignature(raw, sig))) {
    console.warn('[line-log] 簽章驗證失敗,已丟棄');
    return new Response('ok');
  }

  let body: any;
  try { body = JSON.parse(raw); } catch { return new Response('ok'); }

  for (const ev of body.events || []) {
    const src = ev.source || {};
    const srcType = src.type || '';
    const srcId = src.groupId || src.roomId || src.userId || '';
    if (!srcId) continue;

    // 被加進群組 → 自我介紹(告知義務)
    if (ev.type === 'join' && ev.replyToken) {
      await sourceEnabled(srcId);
      await linePost('/v2/bot/message/reply', {
        replyToken: ev.replyToken,
        messages: [{ type: 'text', text: JOIN_NOTICE }],
      });
      continue;
    }

    if (ev.type !== 'message') continue;

    if (!(await sourceEnabled(srcId))) continue;

    const msg = ev.message || {};
    const name = await displayName(src.userId || '', srcType, srcId);

    try {
      await db.from('line_messages').insert({
        source_type: srcType,
        source_id: srcId,
        sender_id: src.userId || null,
        sender_name: name || null,
        message_type: msg.type || 'unknown',
        // 只留文字。貼圖、圖片、檔案對工作日誌沒有幫助,
        // 存下來只會讓摘要變雜,而且圖片還是額外的個資風險。
        text: msg.type === 'text' ? String(msg.text || '').slice(0, 4000) : null,
        sent_at: new Date(ev.timestamp || Date.now()).toISOString(),
      });
    } catch (e) {
      console.error('[line-log] 寫入失敗');
    }
  }

  // LINE 只看 200。回其他狀態碼多次會被自動停用 webhook。
  return new Response('ok');
});
