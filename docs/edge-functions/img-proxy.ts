// ============================================================
// Edge Function: img-proxy
// 路徑: supabase/functions/img-proxy/index.ts
// 版本: v1.0(2026-08-11)
//
// 用途:把商城 CDN 的商品圖轉一手,補上 CORS 標頭。
//
// 為什麼需要:
//   客製文創頁要把「商品照 + 刻圖」合成成一張 PNG(給消費者看的預覽,
//   以及給雕刻師傅看的加工圖)。合成要用 canvas,而 canvas 一旦畫進
//   沒有 CORS 標頭的跨網域圖片就會被「汙染」,toBlob() 直接拋錯,
//   一張圖都產不出來。
//
//   實測 dj1a0ugzmr4in.cloudfront.net 不回 Access-Control-Allow-Origin,
//   所以瀏覽器連載入都過不了。伺服器端抓圖沒有這個限制,轉一手即可。
//
//   若日後商城在 CDN 上加了 CORS 標頭,這支就可以拿掉,
//   把 design.js 裡的 proxied() 改成直接用原網址。
//
// 部署: Supabase Dashboard → Edge Functions → 新增 img-proxy → 貼上本檔
//       "Verify JWT" 要【關閉】(這是給 <img> 標籤直接載入的)
//
// ⚠ 這支沒有金鑰,但有來源白名單 —— 不能拿掉。
//   放行任意網址的話,它就成了一個誰都能用的開放圖片代理:
//   別人可以拿我們的頻寬去轉發他們的內容,出事時來源指向我們。
// ============================================================

// 只允許商城的 CDN。要新增來源時整個 host 加進來,不要用 endsWith 之類的
// 模糊比對 —— evil-cloudfront.net 也會 endsWith('cloudfront.net')。
const ALLOWED_HOSTS = new Set([
  'dj1a0ugzmr4in.cloudfront.net',
]);

// 商品照通常幾百 KB。設上限避免有人拿超大檔案灌爆函式的記憶體。
const MAX_BYTES = 10 * 1024 * 1024;

const CORS = {
  // 這裡放 * 是刻意的:代理的內容本來就是公開的商品照,
  // 真正的防線是上面的 host 白名單。收斂成特定 origin 會讓
  // 本機測試與預覽環境都拿不到圖,換來的安全性有限。
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

function fail(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'GET') return fail(405, '只接受 GET');

  const raw = new URL(req.url).searchParams.get('url') || '';
  if (!raw) return fail(400, '缺少 url 參數');

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return fail(400, 'url 格式錯誤');
  }

  // 只放行 https,擋掉 file: / data: / http: 之類的協定
  if (target.protocol !== 'https:') return fail(400, '只接受 https 網址');
  if (!ALLOWED_HOSTS.has(target.hostname)) {
    console.warn('[img-proxy] 擋下未列入白名單的來源:', target.hostname);
    return fail(403, '不支援的圖片來源');
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      headers: { 'Accept': 'image/*' },
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    console.error('[img-proxy] 取圖失敗:', e instanceof Error ? e.message : e);
    return fail(502, '取得圖片失敗');
  }

  if (!upstream.ok) return fail(upstream.status, '來源回應 ' + upstream.status);

  const type = upstream.headers.get('content-type') || '';
  if (!type.startsWith('image/')) return fail(415, '來源不是圖片');

  const len = Number(upstream.headers.get('content-length') || 0);
  if (len > MAX_BYTES) return fail(413, '圖片過大');

  const buf = await upstream.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return fail(413, '圖片過大');

  return new Response(buf, {
    headers: {
      ...CORS,
      'Content-Type': type,
      // 商品照不常變。快取一天,避免每次進頁面都重抓一次。
      'Cache-Control': 'public, max-age=86400',
    },
  });
});
