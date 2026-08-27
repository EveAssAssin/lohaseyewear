/* =============================================================
   LOHAS · 門市查刻圖 (store-lookup.html)
   -------------------------------------------------------------
   店員輸入會員編號,查出這位客人的禮物要刻什麼、刻在哪。

   權限由 store-lookup Edge Function 把關(session token + admins 表),
   前端這一層只負責把畫面做得在櫃檯好用 —— 不做任何權限判斷,
   那種判斷放在前端等於沒有。

   依賴:window.LohasAuth
   ============================================================= */

(function (window, document) {
  'use strict';

  var Auth = window.LohasAuth;

  var CONFIG = {
    ENDPOINT: 'https://hqdmyxxrskvllkcedybl.supabase.co/functions/v1/store-lookup',
    // 手機換會員編號用。與本支走同一道權限關卡(admins 表),
    // 所以能開這一頁的店員就打得到,不需要額外授權。
    MEMBER_FN: 'https://hqdmyxxrskvllkcedybl.supabase.co/functions/v1/member-lookup',
    TIMEOUT_MS: 15000
  };

  var el = {};

  /* ---------- 工具 ---------- */

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function show(n) { if (n) n.style.display = ''; }
  function hide(n) { if (n) n.style.display = 'none'; }

  function msg(text, isErr) {
    el.msg.textContent = text;
    el.msg.className = 'sl-msg' + (isErr ? ' is-err' : '');
    show(el.msg);
    hide(el.result);
  }

  function call(payload) {
    var ctrl = new AbortController();
    var to = setTimeout(function () { ctrl.abort(); }, CONFIG.TIMEOUT_MS);
    return fetch(CONFIG.ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    })
      .then(function (r) { clearTimeout(to); return r.json(); })
      .then(function (j) {
        if (String(j.code) !== '200') throw new Error(j.message || '查詢失敗');
        return j.data || {};
      })
      .catch(function (err) {
        clearTimeout(to);
        if (err.name === 'AbortError') throw new Error('連線逾時,請再查一次。');
        if (err instanceof TypeError) throw new Error('目前無法連線,請稍後再試。');
        throw err;
      });
  }

  /* ---------- 呈現 ---------- */

  var STATUS = {
    claimed:  { label: '已領取',   cls: '' },
    issued:   { label: '可兌換',   cls: 'is-done' },
    redeemed: { label: '已兌換',   cls: 'is-done' }
  };

  function fmtDate(s) {
    if (!s) return '';
    var d = new Date(s);
    return isNaN(d) ? '' : d.toLocaleDateString('zh-TW');
  }

  /* 把座標翻成人看得懂的話。
     店員不需要知道 x=0.69,他需要知道「右鏡片、偏上、約商品圖寬的 12%」。
     ⚠ 左右一律以【本圖】為準,不是配戴者的左右 —— 那兩種說法相反,
     而店員手上有圖,以圖為準不會錯。 */
  function placementText(p) {
    if (!p) return '—';
    var side = Number(p.x) >= 0.5 ? '本圖右側鏡片' : '本圖左側鏡片';
    var v = Number(p.y) < 0.4 ? '偏上' : Number(p.y) > 0.6 ? '偏下' : '置中';
    var size = Math.round(Number(p.scale || 0) * 100);
    return side + '、' + v + ',寬約商品圖的 ' + size + '%';
  }

  function fileBtn(url, icon, label, download) {
    if (!url) return '';
    return '<a class="sl-file" href="' + esc(url) + '"' +
      (download ? ' download' : ' target="_blank" rel="noopener"') + '>' +
      '<i class="fa-solid ' + icon + '"></i>' + label + '</a>';
  }

  function cardHtml(g) {
    var st = STATUS[g.status] || { label: g.status, cls: '' };
    var spec = g.product_spec_title ? '（' + esc(g.product_spec_title) + '）' : '';

    /* 還沒挑款式的:整張卡只講這一件事。
       把「刻什麼」的欄位留在畫面上是誤導 —— 那些都還沒有值。 */
    if (g.needs_pick) {
      return '' +
        '<div class="sl-card">' +
          '<div class="sl-card-head">' +
            '<span class="sl-product">一份尚未挑選款式的禮物</span>' +
            '<span class="sl-badge is-todo">待客人挑選</span>' +
          '</div>' +
          '<div class="sl-todo">' +
            '這位客人收到了禮物,但還沒選鏡框與刻圖。<br>' +
            '請他用手機登入官網 → 會員專區 → 禮物中心 → 挑選款式,' +
            '完成後這裡就會顯示要做的內容。' +
          '</div>' +
          (g.sender_name ? '<div class="sl-rows" style="margin-top:12px"><div class="sl-row">' +
            '<dt>來自</dt><dd>' + esc(g.sender_name) + '</dd></div></div>' : '') +
        '</div>';
    }

    return '' +
      '<div class="sl-card">' +
        '<div class="sl-card-head">' +
          '<span class="sl-product">' + esc(g.product_title || '(未指定商品)') + spec + '</span>' +
          '<span class="sl-badge ' + st.cls + '">' + esc(st.label) + '</span>' +
        '</div>' +

        // 加工位置圖放最上面 —— 那是師傅要看的東西
        (g.guide_url ? '<img class="sl-guide" src="' + esc(g.guide_url) +
                       '" alt="加工位置指示圖" loading="lazy">' : '') +

        '<div class="sl-rows">' +
          '<div class="sl-row"><dt>刻圖</dt><dd>' + esc(g.design_name || '—') + '</dd></div>' +
          '<div class="sl-row"><dt>位置</dt><dd>' + esc(placementText(g.engrave_placement)) + '</dd></div>' +
          '<div class="sl-row"><dt>商品編號</dt><dd>' + esc(g.product_nid || '—') + '</dd></div>' +
          (g.sender_name ? '<div class="sl-row"><dt>來自</dt><dd>' + esc(g.sender_name) + '</dd></div>' : '') +
          (g.claimed_at ? '<div class="sl-row"><dt>領取日</dt><dd>' + fmtDate(g.claimed_at) + '</dd></div>' : '') +
        '</div>' +

        (g.message ? '<p class="sl-msgbox">「' + esc(g.message) + '」</p>' : '') +

        '<div class="sl-files">' +
          fileBtn(g.engraving_url, 'fa-file-arrow-down', '雕刻檔 SVG', true) +
          fileBtn(g.guide_url, 'fa-crosshairs', '加工位置圖', false) +
          fileBtn(g.preview_url, 'fa-eye', '給客人看的合成圖', false) +
        '</div>' +
      '</div>';
  }

  /* ---------- 查詢 ---------- */

  /* 輸入可能是手機或會員編號。是手機就先換成編號再往下走。
     查到多筆(同號碼多帳號)時交給店員選,不要自己挑第一筆 ——
     挑錯的話他會拿著別人的禮物去配鏡。 */
  function resolveErpid(token, input) {
    var digits = input.replace(/\D/g, '');
    if (!/^09\d{8}$/.test(digits)) return Promise.resolve(input);

    return fetch(CONFIG.MEMBER_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, mobile: digits })
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (String(j.code) !== '200') {
          /* 上游把「沒有客編的會員」濾掉了,所以官網註冊而未綁定門市的
             客人在這裡一定查不到。那不是打錯字,要講清楚下一步。 */
          throw new Error(
            '用這支手機查不到已綁定的會員。\n' +
            '若客人是在官網註冊、還沒到門市綁定過,請先在門市系統完成綁定,' +
            '再請他用手機開一次官網的會員專區,禮物就會掛到編號底下。'
          );
        }
        var ms = (j.data && j.data.members) || [];
        if (ms.length === 1) return ms[0].erpid;
        if (ms.length > 1) {
          throw new Error('這支手機對應到 ' + ms.length + ' 個會員編號:' +
            ms.map(function (m) { return m.erpid + '(' + (m.name || '未提供姓名') + ')'; }).join('、') +
            '。請向客人確認是哪一個,再用編號查一次。');
        }
        throw new Error('用這支手機查不到會員。');
      });
  }

  function search() {
    var erpid = (el.erpid.value || '').trim();
    if (!erpid) { msg('請輸入會員編號。', true); el.erpid.focus(); return; }

    var token = Auth && Auth.getToken ? Auth.getToken() : '';
    if (!token) {
      if (Auth && Auth.setRedirect) Auth.setRedirect('store-lookup.html');
      window.location.href = 'login.html';
      return;
    }

    el.btn.disabled = true;
    el.btn.textContent = '查 詢 中';
    msg('查詢中…', false);

    /* 手機號碼要在這一頁就換成會員編號。
       -----------------------------------------------------------
       店員【沒有管理後台的權限】,叫他「先去會員列表換編號」等於
       叫他去一個進不去的地方。而他手上最常有的就是手機號碼。

       member-lookup 與 store-lookup 走的是同一道權限關卡(admins 表),
       所以能開這一頁的店員本來就打得到會員查詢 —— 那一步在這裡做掉。 */
    resolveErpid(token, erpid)
      .then(function (id) {
        erpid = id;
        return call({ token: token, erpid: id });
      })
      .then(function (d) {
        var list = d.gifts || [];
        if (!list.length) {
          /* 剛綁定的客人查不到是有原因的,而且店員一定會遇到:
             未綁定時領的禮物記在 mid 底下,要等他本人帶著登入狀態
             再進一次官網才會搬到會員編號。講出來,不然店員會以為
             客人記錯了或系統壞了。 */
          msg('這位客人目前沒有待處理的禮物。\n' +
              '若他是剛剛才完成會員綁定,請他在手機上開一次官網的會員專區,' +
              '再查一次就會出現。', false);
          return;
        }
        hide(el.msg);
        el.resultHead.textContent = '會員 ' + erpid + '　共 ' + list.length + ' 筆';
        el.list.innerHTML = list.map(cardHtml).join('');
        show(el.result);
      })
      .catch(function (err) { msg(err.message, true); })
      .finally(function () {
        el.btn.disabled = false;
        el.btn.textContent = '查 詢';
      });
  }

  /* ---------- 啟動 ---------- */

  function init() {
    el = {
      erpid: $('slErpid'), btn: $('slBtn'),
      msg: $('slMsg'), result: $('slResult'),
      resultHead: $('slResultHead'), list: $('slList')
    };
    if (!el.btn) return;

    el.btn.addEventListener('click', search);
    el.erpid.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') search();
    });

    /* 櫃檯的動作是「客人一報編號就打」,游標先放好省一次點擊。
       ⚠ 但這一支現在也被管理後台載入(禮物中心加工管理共用同一份),
       那邊載入時這一頁是隱藏的 —— 對隱藏的輸入框 focus 會把畫面
       捲到奇怪的位置,而且搶走管理後台自己的焦點。
       offsetParent 為 null 就是看不到,那時候不要碰。 */
    if (el.erpid.offsetParent !== null) el.erpid.focus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window, document);
