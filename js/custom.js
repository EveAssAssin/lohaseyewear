/* =============================================================
   客製中心(custom.html)·「我的客製作品」
   -------------------------------------------------------------
   這一頁在 APP 裡是一個【分頁】,不是一次性的說明頁 ——
   客人會一直回來,而他回來多半是想看「我那一件做好了沒」。
   所以產品介紹下面要有他自己的東西。

   資料來自 cloth 函式的 list(與會員中心的「我的客製眼鏡布」同一支),
   它回的是這個人自己的全部客製件,眼鏡布與眼鏡盒都在裡面。

   === 沒登入時不要顯示一個空的區塊 ===
   ⚠ 不要畫一個「目前沒有作品」給沒登入的人看 —— 他會以為自己
     做過的那一件不見了。沒登入就說「登入之後看得到」。

   === APP 裡本來就是登入狀態 ===
   APP 走 store-sso-login 開這一頁,所以多數情況下 token 已經在了。
   但【不要假設】:SSO 失敗、token 過期都會落回未登入,
   那時候要給得出一條路(登入連結),不是一片空白。
   ============================================================= */

(function (window, document) {
  'use strict';

  var FN = 'https://hqdmyxxrskvllkcedybl.supabase.co/functions/v1/cloth';

  /* 與 js/cloth-lab.js、js/admin-portal-cloth.js 是同一份對照。
     ⚠ 舊資料沒有 product 欄位時當眼鏡布(它們本來就是)。 */
  var PRODUCT = { cloth: '眼鏡布', case: '眼鏡盒' };

  var el = {};

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function ymd(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0') +
           '/' + String(d.getDate()).padStart(2, '0');
  }

  /* 狀態的說法與會員中心【完全一致】。
     ⚠ 同一件事在兩個地方講不同的話,客人會以為那是兩件事,
       或是以為其中一邊出錯了。 */
  function statusText(s) {
    if (s === 'rejected') return { cls: 'warn', text: '需要重做 · 請回製作頁修改' };
    if (s === 'done')     return { cls: 'ok',   text: '已完成，前往領取前請務必先聯絡門市' };
    if (s === 'archived') return { cls: 'muted', text: '已結案' };
    return { cls: 'wait', text: '製作中 · 約 3~5 個工作天' };
  }

  /* 縮圖走 Supabase 的圖片縮放,不要載原圖 ——
     這一頁在 APP 裡是分頁,每次切過來都會載一次。 */
  function thumb(u) {
    if (!u || u.indexOf('/storage/v1/object/public/') < 0) return u;
    /* ⚠ width、height、resize 三個都要給。只給 width 的話 Supabase
       【不會等比縮放】,會回一張被拉長的圖。 */
    return u.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') +
           '?width=240&height=240&resize=contain&quality=70';
  }

  function cardHtml(it) {
    var st = statusText(it.status);
    var name = it.design_name || '(未命名)';
    var prod = PRODUCT[it.product || 'cloth'] || esc(it.product);
    return '' +
      '<div class="cc-mine-card">' +
        '<div class="cc-mine-thumb">' +
          (it.preview_url
            ? '<img src="' + esc(thumb(it.preview_url)) + '" alt="" loading="lazy">'
            : '<i class="fa-regular fa-image"></i>') +
        '</div>' +
        '<div class="cc-mine-info">' +
          '<div class="cc-mine-top">' +
            '<span class="cc-mine-name">' + esc(name) + '</span>' +
            '<span class="cc-mine-prod">' + esc(prod) + '</span>' +
          '</div>' +
          '<p class="cc-mine-status is-' + st.cls + '">' + esc(st.text) + '</p>' +
          '<p class="cc-mine-meta">' +
            (it.store_name ? '<i class="fa-solid fa-location-dot"></i> ' + esc(it.store_name) : '尚未指定門市') +
            (it.done_at ? '　·　完成 ' + esc(ymd(it.done_at))
                        : (it.created_at ? '　·　送件 ' + esc(ymd(it.created_at)) : '')) +
          '</p>' +
        '</div>' +
      '</div>';
  }

  function show(msgHtml) {
    el.sec.hidden = false;
    el.body.innerHTML = msgHtml;
  }

  function load() {
    var A = window.LohasAuth;
    var token = (A && A.getToken) ? A.getToken() : '';

    if (!token) {
      /* 沒登入。不要畫空清單 —— 見檔頭。 */
      show('<p class="cc-mine-empty">' +
           '登入之後，這裡會顯示你做過的每一件客製作品與製作進度。' +
           '<a class="cc-mine-login" href="login.html">登入會員</a></p>');
      return;
    }

    show('<p class="cc-mine-empty">載入中…</p>');

    fetch(FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', token: token })
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (String(j.code) !== '200') throw new Error(j.message || '讀取失敗');
        var items = (j.data && j.data.items) || [];
        if (!items.length) {
          /* 真的一件都沒有。這裡可以講「還沒有」,因為我們確定他登入了。 */
          show('<p class="cc-mine-empty">你還沒有客製作品。上面挑一個開始做吧。</p>');
          return;
        }
        el.body.innerHTML = items.map(cardHtml).join('');
      })
      .catch(function (e) {
        /* ⚠ 讀不到就說讀不到,不要顯示「沒有作品」——
           那會讓一個做過眼鏡布的人以為東西不見了。 */
        show('<p class="cc-mine-empty">作品清單暫時讀不到（' + esc(e.message) + '）。' +
             '稍後再開一次就好，你的作品不會受影響。</p>');
      });
  }

  function init() {
    el = { sec: $('ccMineSec'), body: $('ccMine') };
    if (!el.sec || !el.body) return;
    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window, document);
