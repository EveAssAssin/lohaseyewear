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
  function sized(u, px, q) {
    if (!u) return '';
    return u.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') +
           '?width=' + px + '&height=' + px + '&resize=contain&quality=' + q;
  }
  function thumb(u) { return sized(u, 320, 70); }
  /* 詳情用 900:視網膜螢幕上放到 450pt 還是清楚的,
     而原圖是 1200 —— 差那 300 不值得多下載那些位元組。 */
  function big(u) { return sized(u, 900, 82); }

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
    /* 不寫「可到門市領取」——實際要先確認門市有沒有備好、人在不在。
       客人白跑一趟的成本遠高於這一行多幾個字。
       完成日期不併在這一句裡:詳情頁另有「完成日期」欄位,
       句子裡再塞一次會把重點(先聯絡)擠掉。 */
    if (s === 'done') return { cls: 'ok', text: '已完成，前往領取前請務必先聯絡門市' };
    if (s === 'archived') return { cls: 'muted', text: '已結案' };
    return { cls: 'wait', text: '製作中 · 約 3~5 個工作天' };
  }

  function card(it) {
    var st = statusText(it.status, it.done_at);
    return '' +
      '<div class="mc-card" data-id="' + esc(it.id) + '" role="button" tabindex="0">' +
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

  /* ---------- 詳情 ----------
     列表的縮圖只有 84px,看不出刻圖放在布上的位置與比例 ——
     而那正是客人想確認的事。點一下放大到看得清楚為止。 */

  var byId = {};
  var modal;

  function ensureModal() {
    if (modal) return;
    modal = document.createElement('div');
    modal.className = 'mc-modal';
    modal.innerHTML =
      '<div class="mc-modal-backdrop" data-close="1"></div>' +
      '<div class="mc-modal-box" role="dialog" aria-modal="true">' +
        '<button type="button" class="mc-modal-x" data-close="1" aria-label="關閉">' +
          '<i class="fa-solid fa-xmark"></i></button>' +
        '<div class="mc-modal-img"><img alt=""></div>' +
        '<div class="mc-modal-info"></div>' +
      '</div>';
    document.body.appendChild(modal);

    modal.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) closeModal();
    });
    // Esc 關閉。掛在 document 上,不然焦點不在 modal 裡就沒反應
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.classList.contains('on')) closeModal();
    });
  }

  function openModal(id) {
    var it = byId[id];
    if (!it) return;
    ensureModal();

    var st = statusText(it.status, it.done_at);
    modal.querySelector('.mc-modal-img img').src = big(it.preview_url);
    modal.querySelector('.mc-modal-info').innerHTML =
      '<p class="mc-modal-name">' +
        esc(it.design_name || (it.source === 'draw' ? '手繪設計' : '未命名')) + '</p>' +
      '<p class="mc-modal-status ' + st.cls + '">' + esc(st.text) + '</p>' +
      '<dl class="mc-modal-dl">' +
        '<dt>圖案來源</dt><dd>' + esc(it.source === 'draw' ? '自己畫的' : '刻圖市集') + '</dd>' +
        '<dt>儲存日期</dt><dd>' + esc(ymd(it.created_at)) + '</dd>' +
        (it.done_at ? '<dt>完成日期</dt><dd>' + esc(ymd(it.done_at)) + '</dd>' : '') +
      '</dl>' +
      '<p class="mc-modal-note">' +
        (it.status === 'done'
          ? '前往領取前請務必先聯絡門市確認,並出示會員編號。'
          : '製作時間約 3~5 個工作天,完成後我們會通知你。') +
      '</p>';

    modal.classList.add('on');
    // 背後的清單不要跟著捲 —— 手機上最明顯
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    if (!modal) return;
    modal.classList.remove('on');
    document.body.style.overflow = '';
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
        var items = (j.data && j.data.items) || [];
        byId = {};
        items.forEach(function (x) { byId[String(x.id)] = x; });
        render(items);
        bindCards();
      })
      .catch(function (e) {
        console.error('[my-cloth]', e);
        box.innerHTML = '<p class="empty-text">讀取失敗,請重新整理再試一次</p>';
      });
  }

  /* 綁在容器上而不是每一張卡 —— 重新載入時不必記得解綁。
     鍵盤也要能開:卡片是 role=button,Enter/空白鍵要有反應。 */
  var bound = false;
  function bindCards() {
    if (bound || !box) return;
    bound = true;
    box.addEventListener('click', function (e) {
      var c = e.target.closest('.mc-card');
      if (c) openModal(c.dataset.id);
    });
    box.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var c = e.target.closest('.mc-card');
      if (!c) return;
      e.preventDefault();
      openModal(c.dataset.id);
    });
  }

  window.LohasMyCloth = { load: load };
})();
