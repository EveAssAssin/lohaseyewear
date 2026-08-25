/* =============================================================
   cloth-mine.js — 會員中心「我的眼鏡布」
   -------------------------------------------------------------
   客人在 cloth.html 存下來的設計清單。

   資料走 cloth 函式的 list 動作,條件由 token 換出來的身分決定 ——
   前端不送 erpid,送了也不會被採用(那支函式只看 token)。

   為什麼不直接用 supabase-js 讀 cloth_designs:
   那張表 RLS 全鎖、零政策,anon key 讀不到。而 anon key 是公開的,
   要讓它讀得到就得開政策,那等於「拿得到 key 的人看得到所有人的作品」。
   ============================================================= */
(function () {
  'use strict';

  var FN = 'https://hqdmyxxrskvllkcedybl.supabase.co/functions/v1/cloth';

  var loaded = false;
  var box;

  /* 縮圖走 Supabase 的 render 端點,不要抓 1200×1200 的原圖 ——
     一頁十幾張就是十幾 MB。
     ⚠ width 與 height 要一起給再加 resize=contain:
       只給 width 回來的是 320×926,不會等比縮。 */
  function thumb(u) {
    if (!u) return '';
    return u.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') +
           '?width=320&height=320&resize=contain&quality=70';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function ymd(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '/' +
           String(d.getMonth() + 1).padStart(2, '0') + '/' +
           String(d.getDate()).padStart(2, '0');
  }

  /* 狀態只給客人看得懂的三種說法。
     資料庫的值是 new / done / archived —— 直接顯示英文,
     或是把 archived 講成「已封存」,客人都會來問那是什麼意思。 */
  function statusText(s, doneAt) {
    if (s === 'done') return { cls: 'ok', text: '已完成 · 可到門市領取' + (doneAt ? '(' + ymd(doneAt) + ' 完成)' : '') };
    if (s === 'archived') return { cls: 'muted', text: '已結案' };
    return { cls: 'wait', text: '製作中 · 約 3~5 個工作天' };
  }

  function card(it) {
    var st = statusText(it.status, it.done_at);
    return '' +
      '<div class="mc-card">' +
        '<div class="mc-thumb"><img src="' + esc(thumb(it.preview_url)) + '" alt="" loading="lazy"></div>' +
        '<div class="mc-body">' +
          '<p class="mc-name">' + esc(it.design_name || (it.source === 'draw' ? '手繪設計' : '未命名')) + '</p>' +
          '<p class="mc-meta">' + esc(it.source === 'draw' ? '自己畫的' : '刻圖市集') +
            ' · ' + esc(ymd(it.created_at)) + ' 儲存</p>' +
          '<p class="mc-status ' + st.cls + '">' + esc(st.text) + '</p>' +
        '</div>' +
      '</div>';
  }

  function render(items) {
    if (!items.length) {
      box.innerHTML =
        '<div class="mc-empty">' +
          '<i class="fa-solid fa-vector-square"></i>' +
          '<p>還沒有設計過眼鏡布</p>' +
          '<a class="mc-empty-btn" href="cloth.html">去做一條</a>' +
        '</div>';
      return;
    }
    box.innerHTML = '<div class="mc-list">' + items.map(card).join('') + '</div>';
  }

  function load(force) {
    box = document.getElementById('myClothList');
    if (!box) return;
    // 切分頁進來會重打一次,沒必要 —— 這份清單不會自己變
    if (loaded && !force) return;

    // 全域是 LohasAuth,不是 Auth —— 寫錯的話會一路安靜地當成「沒登入」
    var A = window.LohasAuth;
    var token = (A && A.getToken) ? A.getToken() : '';
    if (!token) {
      box.innerHTML = '<p class="empty-text">請先登入</p>';
      return;
    }

    box.innerHTML = '<p class="empty-text">載入中...</p>';

    fetch(FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', token: token }),
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (String(j.code) !== '200') throw new Error(j.message || '讀取失敗');
        loaded = true;
        render((j.data && j.data.items) || []);
      })
      .catch(function (e) {
        console.error('[my-cloth]', e);
        box.innerHTML = '<p class="empty-text">讀取失敗,請重新整理再試一次</p>';
      });
  }

  window.LohasMyCloth = { load: load };
})();
