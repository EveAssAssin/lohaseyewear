// ============================================================
// Edge Function: partner-logo（2026-09-30，App/芽芽工程方新增）
//
// 用途：特約店家「負責人」在樂活 App 芽芽的「特約小幫手」做好店家 LOGO →
//       存進他自己在官網的「我的刻圖設計」，之後可以拿去雷射雕刻。
//
// 流程（對方來拉，不共用金鑰）：
//   寵物服務 POST 這支 { ticket }（64 碼 hex，一次性、10 分鐘）
//   → 這支 GET https://lohas-pet.onrender.com/site/logo-ticket/<ticket>（網址寫死，只信這一台）
//   → 拿到 { erpid, unit, unitTitle, name, svg, png(base64) }（客編由寵物服務的登入工作階段決定，
//     「是不是合約負責人」由主後端判定過）
//   → 檔案存 engraving-uploads/designs/<erpid>/partner-<unit>-<ms>.svg|.png（與會員上傳同一個資料夾）
//   → engraving_designs：同一個人、同一個特約單位只留一列（description 帶 [partner-unit:<nid>] 記號），重做就更新圖
//
// 🔒 狀態刻意用 status='private'、is_show='私人'（不是 approved）：
//   官網所有公開挑選器（市集、刻圖下單、手機殼、眼鏡布、紙娃娃、設計師名單）都是 .eq('status','approved')，
//   新的挑選器也會照這個寫法 → 私人 LOGO 預設就不會漏出去（寧可漏顯示，不可漏公開）。
//   只有兩個地方看得到：member-portal「我的刻圖設計」（依 creator_id）、design.html 下單頁（只加本人的私人 LOGO）。
//   不佔名稱唯一索引（那個索引只看 pending／approved）。
//
// verify_jwt = false：授權就是那張票券（猜不到、拉一次就作廢）。
// SVG 只收寵物服務組出來的固定格式（只有 <path fill="#000000" …>）；PNG 檢查檔頭、≤ 1MB。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const CODE_VERSION = 'partner-logo-20260930a';
const PET_BASE = 'https://lohas-pet.onrender.com';
const BUCKET = 'engraving-uploads';
const SVG_RE = /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d{2,4} \d{2,4}" width="\d{2,5}" height="\d{2,5}">(<path fill="#000000" fill-rule="evenodd" d="[MLQCZ0-9 .,\-]+"\/>){1,12}<\/svg>$/;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'GET') return json(200, { ok: true, code_version: CODE_VERSION }); // 自檢：線上是不是新版
  if (req.method !== 'POST') return json(405, { ok: false, error: 'method' });
  let body: any;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: 'bad_json' }); }
  const ticket = String(body?.ticket || '');
  if (!/^[0-9a-f]{64}$/.test(ticket)) return json(400, { ok: false, error: 'bad_ticket' });

  // 1. 回頭去寵物服務拉（只信這一台）
  let d: any;
  try {
    const r = await fetch(`${PET_BASE}/site/logo-ticket/${ticket}`, { headers: { 'User-Agent': 'lohas-site-partner-logo' } });
    d = await r.json().catch(() => null);
    if (!r.ok || !d?.ok) return json(403, { ok: false, error: 'ticket_rejected' });
  } catch (e) {
    console.error('[partner-logo] 拉票券失敗', e);
    return json(502, { ok: false, error: 'pet_unreachable' });
  }

  const erpid = String(d.erpid || '');
  const unit = Number(d.unit) || 0;
  const svg = String(d.svg || '');
  const name = String(d.name || '').trim().slice(0, 40);
  const unitTitle = String(d.unitTitle || '').trim().slice(0, 40);
  if (!/^\d{5,12}$/.test(erpid) || unit <= 0 || !name) return json(400, { ok: false, error: 'bad_payload' });
  if (svg.length > 300000 || !SVG_RE.test(svg)) return json(400, { ok: false, error: 'bad_svg' });
  let png: Uint8Array;
  try {
    png = Uint8Array.from(atob(String(d.png || '')), (c) => c.charCodeAt(0));
  } catch { return json(400, { ok: false, error: 'bad_png' }); }
  if (png.length < 100 || png.length > 1024 * 1024 || png[0] !== 0x89 || png[1] !== 0x50 || png[2] !== 0x4e || png[3] !== 0x47) {
    return json(400, { ok: false, error: 'bad_png' });
  }

  const sb = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

  // 2. 檔案（與會員自己上傳同一個資料夾，member-portal 的既有顯示照常可用）
  const base = `designs/${erpid}/partner-${unit}-${Date.now()}`;
  const up1 = await sb.storage.from(BUCKET).upload(base + '.svg', new TextEncoder().encode(svg), { contentType: 'image/svg+xml', upsert: false });
  const up2 = await sb.storage.from(BUCKET).upload(base + '.png', png, { contentType: 'image/png', upsert: false });
  if (up1.error || up2.error) {
    console.error('[partner-logo] 上傳失敗', up1.error, up2.error);
    return json(500, { ok: false, error: 'upload_failed' });
  }
  const svgUrl = sb.storage.from(BUCKET).getPublicUrl(base + '.svg').data.publicUrl;
  const pngUrl = sb.storage.from(BUCKET).getPublicUrl(base + '.png').data.publicUrl;

  // 3. 資料列：同一人、同一個特約單位只留一列（丟進垃圾桶的不算，那就再建一列）
  const mark = `[partner-unit:${unit}]`;
  const now = new Date().toISOString();
  const fields = {
    name, image_url: pngUrl, image_url_png: pngUrl, image_url_svg: svgUrl,
    status: 'private', is_show: '私人', reviewed_at: now, reviewed_by: 'lohas-pet', updated_at: now,
  };
  const { data: old, error: e0 } = await sb.from('engraving_designs').select('id, is_show')
    .eq('creator_id', erpid).like('description', `%${mark}%`).order('created_at', { ascending: false }).limit(5);
  if (e0) { console.error('[partner-logo] 查舊列失敗', e0); return json(500, { ok: false, error: 'db' }); }
  const keep = (old || []).find((x: any) => x.is_show !== '垃圾桶');
  if (keep) {
    const { error } = await sb.from('engraving_designs').update(fields).eq('id', keep.id);
    if (error) { console.error('[partner-logo] 更新失敗', error); return json(500, { ok: false, error: 'db' }); }
    return json(200, { ok: true, id: keep.id, created: false, code_version: CODE_VERSION });
  }
  const { data: row, error } = await sb.from('engraving_designs').insert(Object.assign({
    creator_id: erpid, type: 'member', category: '企業團體', designer_name: unitTitle || null,
    keywords: '特約店家,LOGO', slogan: '',
    description: `特約店家 LOGO（樂活 App 芽芽特約小幫手建立）${mark}`,
  }, fields)).select('id').single();
  if (error) { console.error('[partner-logo] 新增失敗', error); return json(500, { ok: false, error: 'db' }); }
  return json(200, { ok: true, id: row.id, created: true, code_version: CODE_VERSION });
});
