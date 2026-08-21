/* =============================================================
   LOHAS · 壽星分享牆 (birthday.html)
   -------------------------------------------------------------
   === 這些照片是什麼(2026-08-21 更正) ===
   不是客人上傳的。是樂活員工在後台上傳的生日相簿,每人每年 3 張,
   我方只取大圖那一張。客人在 App 按的「分享」是分享到 Facebook,
   圖在 FB,主後端沒有那些圖。

   牆上只會出現【按過分享並同意展示於官網】的那些 ——
   同意綁在客人按下「分享到 FB」的當下,舊資料不追溯。
   所以初期會是空的,之後隨每月壽星逐筆累積。

   ⚠ 本檔 2026-08-20 的第一版是照「客人自行上傳、附文字說明」設計的,
     那個前提是錯的。因此:沒有 content 欄位、每人只有一張圖、
     不需要 image_urls 陣列。

   === 少量也要好看 ===
   初期可能只有個位數。與其在頁面上留一個空的分享牆,
   不如整區不顯示 —— 見 CONFIG.MIN_ITEMS。

   ⚠ 金鑰不在這裡。一律經 Supabase Edge Function(bday-wall)代理。
   ============================================================= */

(function (window, document) {
  'use strict';

  var CONFIG = {
    ENDPOINT: 'https://hqdmyxxrskvllkcedybl.supabase.co/functions/v1/bday-wall',
    PAGE: 20,

    /* 不足這個數量就整區不顯示。
       四欄的版面,少於兩排看起來像「沒人參加」,那比沒有這一區更糟。
       對方說初期可能只有個位數,所以這個門檻是會真的用到的。 */
    MIN_ITEMS: 8,

    TIMEOUT_MS: 15000
  };

  var State = { offset: 0, total: 0, loading: false, done: false, usePhotos: false };
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

  /* ---------- 佔位資料(僅預覽模式) ---------- */

  var PLACE_TINT = ['#F4E3DE', '#EDE4D6', '#E6E1D4', '#F2E7E0', '#E9E3DB', '#F5EAE4'];
  var PLACE_NAME = ['王小姐', '陳先生', '林小姐', '黃先生', '張小姐', '李先生',
                    '吳小姐', '劉先生', '蔡小姐', '鄭先生', '許小姐', '謝先生'];

  /* 站上現成的商品照,用來看「格子被真的照片填滿」的密度與裁切。
     ⚠ 這些是商品照,不是客人的生日照。 */
  var PLACE_PHOTO = [
    'images/birthday-gift.jpg', 'images/gift-sunglasses.jpg',
    'images/gift-box.jpg',      'images/gift-cloth.jpg',
    'images/gift-bag.jpg',      'images/flatlay-demo.jpg',
    'images/carrier-cloth.jpg', 'images/carrier-pouch.jpg',
    'images/cloth-01.jpg',      'images/carrier-merch.jpg',
    'images/box-01.jpg',        'images/frame-01.jpg'
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
    var total = 30;
    var items = [];
    for (var i = offset; i < Math.min(offset + limit, total); i++) {
      items.push({
        id: 'placeholder-' + i,
        image_url: State.usePhotos ? PLACE_PHOTO[i % PLACE_PHOTO.length] : placeSvg(i),
        nickname: PLACE_NAME[i % PLACE_NAME.length],
        created_at: new Date(2026, 7, 20 - (i % 28)).toISOString()
      });
    }
    return { items: items, total: total };
  }

  /* ---------- 取資料 ---------- */

  function fetchPage(offset, limit) {
    if (State.usePreviewData) {
      return Promise.resolve(placeholderPage(offset, limit));
    }

    var ctrl = new AbortController();
    var to = setTimeout(function () { ctrl.abort(); }, CONFIG.TIMEOUT_MS);

    return fetch(CONFIG.ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: limit, offset: offset }),
      signal: ctrl.signal
    })
      .then(function (r) { clearTimeout(to); return r.json(); })
      .then(function (j) {
        if (String(j.code) !== '200') throw new Error(j.message || '載入失敗');
        var d = j.data || {};
        return { items: d.items || [], total: Number(d.total) || 0 };
      })
      .catch(function (e) {
        clearTimeout(to);
        throw e;
      });
  }

  /* ---------- 呈現 ---------- */

  function cardHtml(it) {
    if (!it.image_url) return '';
    /* 只有圖與稱呼 —— 客人沒有寫任何文字,這一區也不該假裝有。
       原本那個兩行說明的版位是照錯誤前提做的,已移除。 */
    return '' +
      '<article class="bd-wall-card">' +
        '<div class="bd-wall-media">' +
          '<img src="' + esc(it.image_url) + '" alt="" loading="lazy" decoding="async">' +
        '</div>' +
        '<div class="bd-wall-body">' +
          '<span class="bd-wall-name">' + esc(it.nickname || '樂活壽星') + '</span>' +
          '<span class="bd-wall-date">' + esc(fmtDate(it.created_at)) + '</span>' +
        '</div>' +
      '</article>';
  }

  function appendPage(page) {
    var html = (page.items || []).map(cardHtml).join('');
    el.wall.insertAdjacentHTML('beforeend', html);
    State.offset += (page.items || []).length;
    State.total = page.total;

    // 用 total 判斷還有沒有下一頁(對方的回應以 total 為準,沒有 has_more)
    if (State.offset >= State.total || !(page.items || []).length) {
      State.done = true;
      el.more.hidden = true;
      el.end.hidden = false;
    }
  }

  function loadMore() {
    if (State.loading || State.done) return;
    State.loading = true;
    el.more.disabled = true;
    el.more.textContent = '載 入 中';

    fetchPage(State.offset, CONFIG.PAGE)
      .then(appendPage)
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

  /* ---------- 啟動 ----------
     先載入、再決定要不要顯示。
     反過來的話,照片不夠或載入失敗時,頁面上會留一個空的分享牆
     或一句「載入失敗」—— 對一個加分用的區塊來說,那比不出現更糟。 */

  function init() {
    el = {
      sec: $('bdWallSec'), wall: $('bdWall'),
      more: $('bdWallMore'), end: $('bdWallEnd')
    };
    if (!el.sec || !el.wall) return;

    var qs = location.search;
    var preview = /[?&]wall=preview(?:&|$)/.test(qs);
    State.usePhotos = preview && /[?&]photos=1(?:&|$)/.test(qs);
    // 預覽模式一律用佔位資料,不打真的 API —— 初期真的 API 會回空清單
    State.usePreviewData = preview;

    el.more.addEventListener('click', loadMore);

    fetchPage(0, CONFIG.PAGE)
      .then(function (page) {
        var n = (page.items || []).length;

        /* 數量不足就整區不顯示。
           預覽模式例外 —— 那是拿來看版型的,本來就沒有真實資料。 */
        if (!preview && n < CONFIG.MIN_ITEMS) {
          console.info('[birthday-wall] 目前 ' + n + ' 筆,未達 ' +
                       CONFIG.MIN_ITEMS + ' 筆,不顯示這一區');
          return;
        }

        if (preview) {
          el.wall.insertAdjacentHTML('beforebegin',
            '<p class="bd-wall-preview">⚠ 版型預覽:' +
            (State.usePhotos
              ? '格子裡是<b>站上現成的商品照</b>,不是客人的生日照,稱呼也是假的。'
              : '以下全部是佔位圖,不是真實的照片。') +
            '</p>');
        }

        el.sec.hidden = false;
        appendPage(page);
      })
      .catch(function (err) {
        // 失敗就當作沒有這一區。生日主頁的其他內容不受影響
        console.warn('[birthday-wall] 載入失敗,不顯示這一區:', err && err.message);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window, document);
