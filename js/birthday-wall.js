/* =============================================================
   LOHAS · 壽星分享牆 (birthday.html)
   -------------------------------------------------------------
   資料來自 App 的生日分享。App 端的列表 API 尚未提供
   (需求見 docs/給黃總_生日分享牆API需求_0820c.md),
   所以現在跑的是佔位資料。

   === 接上真實資料時只需要動一個地方 ===
   把 CONFIG.ENDPOINT 填上 Edge Function 的網址即可。
   fetchPage() 會自動改走真的 API,其餘程式都不用改。

   ⚠ 金鑰不會出現在這裡。與站上其他外部呼叫一樣,
     一律經 Supabase Edge Function 代理。

   === 為什麼預設不顯示 ===
   佔位圖是假的。公開頁面放一牆假的客人照片,看的人不會知道那是假的 ——
   那不是佔位,那是造假。所以沒有 ENDPOINT 時整區隱藏,
   要看版型走 ?wall=preview。
   ============================================================= */

(function (window, document) {
  'use strict';

  var CONFIG = {
    /* 待填:Edge Function 的網址。
       填上去的那一刻,這一區就會自動對外顯示並改用真實資料。 */
    ENDPOINT: '',
    PAGE: 12,
    TIMEOUT_MS: 15000
  };

  var State = { offset: 0, loading: false, done: false };
  var el = {};

  /* ---------- 工具 ---------- */

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtDate(s) {
    if (!s) return '';
    var d = new Date(s);
    if (isNaN(d)) return '';
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  /* ---------- 佔位資料 ----------
     用 SVG 而不是真照片:一眼看得出是假的。
     拿站上現成的商品照來充數的話,預覽時很容易誤判成
     「真實資料已經接上了」。 */

  var PLACE_TINT = ['#F4E3DE', '#EDE4D6', '#E6E1D4', '#F2E7E0', '#E9E3DB', '#F5EAE4'];
  var PLACE_NAME = ['王小姐', '陳先生', '林小姐', '黃先生', '張小姐', '李先生',
                    '吳小姐', '劉先生', '蔡小姐', '鄭先生', '許小姐', '謝先生'];
  var PLACE_TEXT = [
    '今年生日收到樂活的禮物,刻了自己的名字,很喜歡。',
    '門市店員幫我挑了很久,最後選了這個圖案。',
    '本來只是路過,沒想到生日當月有這種活動。',
    '刻圖是自己畫的,店員說可以直接用,超開心。',
    '',
    '朋友推薦來的,結果自己也變成回頭客了。'
  ];

  function placeSvg(i) {
    var tint = PLACE_TINT[i % PLACE_TINT.length];
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">' +
        '<rect width="400" height="400" fill="' + tint + '"/>' +
        '<circle cx="200" cy="176" r="58" fill="none" stroke="#B7A78F" stroke-width="6"/>' +
        '<path d="M158 176h84M200 134v84" stroke="#B7A78F" stroke-width="6" ' +
              'stroke-linecap="round"/>' +
        '<text x="200" y="286" text-anchor="middle" font-family="sans-serif" ' +
              'font-size="20" fill="#8C7F6B" letter-spacing="2">佔位圖 ' + (i + 1) + '</text>' +
      '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function placeholderPage(offset, limit) {
    var items = [];
    var total = 30;                       // 假裝總共這麼多筆,好測「看更多」與結尾
    for (var i = offset; i < Math.min(offset + limit, total); i++) {
      items.push({
        id: 'placeholder-' + i,
        image_url: placeSvg(i),
        nickname: PLACE_NAME[i % PLACE_NAME.length],
        content: PLACE_TEXT[i % PLACE_TEXT.length],
        created_at: new Date(2026, 7, 20 - (i % 28)).toISOString()
      });
    }
    return { items: items, has_more: offset + limit < total };
  }

  /* ---------- 取資料 ----------
     這是唯一需要為了「接上真實 API」而改的地方。 */
  function fetchPage(offset, limit) {
    if (!CONFIG.ENDPOINT) {
      return Promise.resolve(placeholderPage(offset, limit));
    }

    var ctrl = new AbortController();
    var to = setTimeout(function () { ctrl.abort(); }, CONFIG.TIMEOUT_MS);

    return fetch(CONFIG.ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', offset: offset, limit: limit }),
      signal: ctrl.signal
    })
      .then(function (r) { clearTimeout(to); return r.json(); })
      .then(function (j) {
        if (String(j.code) !== '200') throw new Error(j.message || '載入失敗');
        var d = j.data || {};
        return {
          items: d.items || d.list || [],
          // 對方若沒回 has_more,就以「這一頁有沒有裝滿」推斷
          has_more: d.has_more !== undefined
            ? !!d.has_more
            : (d.items || d.list || []).length >= limit
        };
      })
      .catch(function (e) {
        clearTimeout(to);
        throw e;
      });
  }

  /* ---------- 呈現 ---------- */

  function cardHtml(it) {
    /* 主圖:單張或多張都吃。多張時先只顯示第一張 ——
       這一區的目的是「一眼看到很多人」,不是逐則細看。 */
    var img = it.image_url ||
              (Array.isArray(it.image_urls) ? it.image_urls[0] : '') || '';
    if (!img) return '';

    var text = String(it.content || '').trim();

    return '' +
      '<article class="bd-wall-card">' +
        '<div class="bd-wall-media">' +
          '<img src="' + esc(img) + '" alt="" loading="lazy" decoding="async">' +
        '</div>' +
        '<div class="bd-wall-body">' +
          '<div class="bd-wall-who">' +
            '<span class="bd-wall-name">' + esc(it.nickname || '樂活壽星') + '</span>' +
            '<span class="bd-wall-date">' + esc(fmtDate(it.created_at)) + '</span>' +
          '</div>' +
          (text ? '<p class="bd-wall-text">' + esc(text) + '</p>' : '') +
        '</div>' +
      '</article>';
  }

  function loadMore() {
    if (State.loading || State.done) return;
    State.loading = true;
    el.more.disabled = true;
    el.more.textContent = '載 入 中';

    fetchPage(State.offset, CONFIG.PAGE)
      .then(function (page) {
        var html = (page.items || []).map(cardHtml).join('');
        el.wall.insertAdjacentHTML('beforeend', html);
        State.offset += (page.items || []).length;

        if (!page.has_more || !(page.items || []).length) {
          State.done = true;
          el.more.hidden = true;
          // 第一頁就沒有東西的話,不要顯示「已經到底了」——
          // 那對一個空白區塊來說是句廢話
          el.end.hidden = State.offset === 0;
        }
      })
      .catch(function (err) {
        el.more.textContent = '載入失敗,再試一次';
        console.warn('[birthday-wall]', err && err.message);
      })
      .finally(function () {
        State.loading = false;
        if (!State.done) {
          el.more.disabled = false;
          if (el.more.textContent === '載 入 中') el.more.textContent = '看 更 多';
        }
      });
  }

  /* ---------- 啟動 ---------- */

  function init() {
    el = {
      sec: $('bdWallSec'), wall: $('bdWall'),
      more: $('bdWallMore'), end: $('bdWallEnd')
    };
    if (!el.sec || !el.wall) return;

    var preview = /[?&]wall=preview(?:&|$)/.test(location.search);

    /* 沒有真實資料來源時,只有預覽模式看得到。
       這一段不要拿掉 —— 它是「不要對外顯示假客人」的唯一保障。 */
    if (!CONFIG.ENDPOINT && !preview) return;

    if (!CONFIG.ENDPOINT) {
      el.wall.insertAdjacentHTML('beforebegin',
        '<p class="bd-wall-preview">⚠ 版型預覽:以下全部是佔位圖,' +
        '不是真實的客人分享。App 端的列表 API 尚未提供。</p>');
    }

    el.sec.hidden = false;
    el.more.addEventListener('click', loadMore);
    loadMore();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window, document);
