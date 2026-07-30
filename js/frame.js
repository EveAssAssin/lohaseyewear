/* ============================================================
   frame.js — 鏡框百科 單一框型頁（模板）
   依賴：frames-data.js
   ------------------------------------------------------------
   網址：/frame.html?f={新代碼}   例：/frame.html?f=mat-almgti
        /frame.html?f={舊站ID}   例：/frame.html?f=471（經 LEGACY_ID_MAP 轉譯）

   採單一模板（方案 2）：45 種框型共用本頁，內容依 ?f= 參數渲染。
   為彌補單頁 SEO 弱勢，本檔會動態覆寫 title / description /
   canonical / og 標籤，並輸出 JSON-LD 結構化資料。
   ============================================================ */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function icon(key, w, h) {
    return '<svg viewBox="0 0 64 42" width="' + w + '" height="' + h +
      '" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      (FRAME_ICONS[key] || FRAME_ICONS.square) + '</svg>';
  }
  function byCode(code) {
    for (var i = 0; i < FRAME_ITEMS.length; i++) {
      if (FRAME_ITEMS[i].code === code) return FRAME_ITEMS[i];
    }
    return null;
  }
  function groupOf(key) {
    return FRAME_GROUPS.filter(function (g) { return g.key === key; })[0];
  }

  /* 解析 ?f=：支援新代碼與舊站 ID */
  function resolveParam() {
    var raw = new URLSearchParams(location.search).get('f');
    if (!raw) return null;
    raw = raw.replace(/[^\w-]/g, '');           // 濾除 QR#8 結尾多餘的單引號
    if (byCode(raw)) return { code: raw, legacy: false };
    var mapped = LEGACY_ID_MAP[raw];
    if (mapped && byCode(mapped)) return { code: mapped, legacy: true };
    return null;
  }

  /* ---------- SEO：動態覆寫 head ---------- */
  function applyMeta(it) {
    var title = it.name + '｜鏡框百科 - Lohas 樂活眼鏡';
    var desc  = it.desc + ' 適合' + (it.face || []).slice(0, 3).join('、') +
                '，常見材質為' + (it.material || []).slice(0, 2).join('、') + '。';
    var url   = 'https://www.lohasglasses.com/frame.html?f=' + it.code;

    document.title = title;

    function meta(sel, attr, val) {
      var el = document.querySelector(sel);
      if (!el) {
        el = document.createElement('meta');
        var parts = sel.replace(/[\[\]"]/g, '').split('=');
        el.setAttribute(parts[0].replace('meta', ''), parts[1]);
        document.head.appendChild(el);
      }
      el.setAttribute(attr, val);
    }
    meta('meta[name="description"]', 'content', desc);

    var link = document.querySelector('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'canonical';
      document.head.appendChild(link);
    }
    link.href = url;

    // JSON-LD：讓搜尋引擎理解這是一則知識條目
    var ld = document.createElement('script');
    ld.type = 'application/ld+json';
    ld.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: it.name,
      description: it.desc,
      url: url,
      isPartOf: {
        '@type': 'WebSite',
        name: 'LOHAS 樂活眼鏡',
        url: 'https://www.lohasglasses.com/'
      },
      publisher: { '@type': 'Organization', name: 'LOHAS 樂活眼鏡' }
    });
    document.head.appendChild(ld);
  }

  /* ---------- 渲染 ---------- */
  function renderNotFound() {
    document.getElementById('fdWrap').innerHTML =
      '<div class="fd-empty">' +
        '<h1>找不到這個鏡框分類</h1>' +
        '<p>連結可能已更新。歡迎回到鏡框百科，瀏覽全部 45 種框型。</p>' +
        '<a class="fd-back-btn" href="/frames.html">返回鏡框百科</a>' +
      '</div>';
  }

  function render(it) {
    var g = groupOf(it.group);
    var prods = it.products || [];

    function col(title, arr) {
      return '<div class="fd-col">' +
        '<div class="fd-col-t">' + title + '</div>' +
        '<ul class="fd-col-list">' +
          (arr || []).map(function (v) { return '<li>' + esc(v) + '</li>'; }).join('') +
        '</ul></div>';
    }

    // 同族群的其他框型（最多 6 個），作為站內互連
    var siblings = FRAME_ITEMS.filter(function (x) {
      return x.group === it.group && x.code !== it.code;
    }).slice(0, 6);

    document.getElementById('fdWrap').innerHTML =
      '<nav class="fd-crumb">' +
        '<a href="/frames.html">鏡框百科</a>' +
        '<span>/</span>' +
        '<a href="/frames.html">' + esc(g ? g.label : '') + '</a>' +
        '<span>/</span><em>' + esc(it.name) + '</em>' +
      '</nav>' +

      '<header class="fd-hero">' +
        '<div class="fd-hero-icon">' + icon(it.icon, 96, 63) + '</div>' +
        '<div class="fd-hero-text">' +
          (it.tag ? '<span class="fd-badge">' + esc(it.tag) + '</span>' : '') +
          '<h1 class="fd-title">' + esc(it.name) + '</h1>' +
          '<p class="fd-en">' + esc(it.en) + ' · ' + esc(it.code) + '</p>' +
        '</div>' +
      '</header>' +

      '<p class="fd-desc">' + esc(it.desc) + '</p>' +

      '<div class="fd-cols">' +
        col('適合臉型', it.face) + col('推薦場合', it.scene) + col('常見材質', it.material) +
      '</div>' +

      '<section class="fd-prod">' +
        '<div class="fd-sec-head"><h2>對應樂活商品</h2>' +
        '<span class="fd-sec-n">' + prods.length + ' 款</span></div>' +
        '<div class="fd-prod-grid">' +
          prods.map(function (p) {
            return '<a class="fd-prod-card" href="' + esc(p.url) + '" target="_blank" rel="noopener">' +
              '<span class="fd-prod-img">' + icon(it.icon, 56, 37) + '</span>' +
              '<span class="fd-prod-body">' +
                '<span class="fd-prod-series">' + esc(p.series) + '</span>' +
                '<span class="fd-prod-name">' + esc(p.name) + '</span>' +
                '<span class="fd-prod-tag">' + esc(p.tag) + '</span>' +
                '<span class="fd-prod-cta">查看商品 →</span>' +
              '</span></a>';
          }).join('') +
        '</div>' +
      '</section>' +

      (siblings.length ?
      '<section class="fd-more">' +
        '<div class="fd-sec-head"><h2>' + esc(g ? g.label : '') + ' 的其他框型</h2></div>' +
        '<div class="fd-more-grid">' +
          siblings.map(function (s) {
            return '<a class="fd-more-card" href="/frame.html?f=' + encodeURIComponent(s.code) + '">' +
              '<span class="fd-more-icon">' + icon(s.icon, 44, 29) + '</span>' +
              '<span class="fd-more-name">' + esc(s.name) + '</span></a>';
          }).join('') +
        '</div>' +
      '</section>' : '') +

      '<div class="fd-back"><a class="fd-back-btn" href="/frames.html">← 返回鏡框百科</a></div>';
  }

  document.addEventListener('DOMContentLoaded', function () {
    var hit = resolveParam();
    if (!hit) { renderNotFound(); return; }

    var it = byCode(hit.code);
    applyMeta(it);
    render(it);

    if (hit.legacy) document.getElementById('fdQrHint').classList.add('is-show');

    // 網址正規化：舊 ID 換成新代碼，分享出去是語意化網址
    if (hit.legacy) {
      history.replaceState(null, '', '/frame.html?f=' + encodeURIComponent(it.code));
    }
  });
})();
