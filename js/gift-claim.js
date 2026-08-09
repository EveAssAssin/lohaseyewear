/* =============================================================
   LOHAS · 領取禮物 (gift-claim.html)
   -------------------------------------------------------------
   兩種進入方式:
     ?c=<claim_code>  連結領取 —— 領取碼本身就是憑證,不需先登入就能「看」,
                      但「領」一定要登入(禮物要進到某個會員名下)
     ?g=<gift_id>     從禮物中心點進來 —— 一定已登入,用 list 取回該筆

   依賴:window.LohasAuth (getToken / isLogin / setRedirect)
   ============================================================= */

(function (window, document) {
  'use strict';

  var Auth = window.LohasAuth;

  var CONFIG = {
    ENDPOINT: 'https://hqdmyxxrskvllkcedybl.supabase.co/functions/v1/gift',
    TIMEOUT_MS: 12000
  };

  var State = { gift: null, claimCode: '', giftId: '', claimable: false };
  var el = {};

  /* ---------- 工具 ---------- */

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
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
        if (String(j.code) !== '200') {
          var e = new Error(j.message || '操作失敗');
          e.code = String(j.code);
          throw e;
        }
        return j.data || {};
      })
      .catch(function (err) {
        clearTimeout(to);
        if (err.name === 'AbortError') throw new Error('連線逾時,請重新整理再試');
        // fetch 本身失敗(服務未上線 / 斷網 / CORS)只會丟出 TypeError,
        // 訊息是英文的 "Failed to fetch",不能直接給使用者看
        if (err instanceof TypeError) throw new Error('目前無法連線到禮物服務,請稍後再試。');
        throw err;
      });
  }

  function show(node) { if (node) node.style.display = ''; }
  function hide(node) { if (node) node.style.display = 'none'; }

  function fail(msg) {
    hide(el.loading); hide(el.body);
    el.errorText.textContent = msg;
    show(el.error);
  }

  /* ---------- 渲染 ---------- */

  function renderGift(g) {
    el.from.textContent = g.sender_name ? '來自 ' + g.sender_name : '來自一位朋友';

    var visual = g.product_image || g.design_image_url || '';
    if (visual) {
      el.visual.style.backgroundImage = "url('" + visual + "')";
    } else {
      el.visual.classList.add('is-empty');
      el.visual.innerHTML = '<i class="fa-solid fa-gift"></i>';
    }

    el.item.innerHTML = g.product_title
      ? '<span class="gc-item-label">禮物內容</span>' +
        '<span class="gc-item-name">' + esc(g.product_title) + '</span>'
      : '';

    el.design.innerHTML = g.design_name
      ? '<span class="gc-item-label">專屬刻圖</span>' +
        '<span class="gc-item-name">' + esc(g.design_name) + '</span>'
      : '';

    if (g.message) {
      el.msg.textContent = g.message;
      show(el.msg);
    }

    hide(el.loading);
    show(el.body);
  }

  function renderStage() {
    var g = State.gift;

    if (g.status === 'claimed' || g.status === 'shipped') {
      el.title.textContent = '這份禮物已經領取了';
      if (g.status === 'shipped') el.doneText.textContent = '禮物已出貨,請留意物流通知。';
      show(el.done);
      return;
    }
    if (!State.claimable) {
      el.title.textContent = '這份禮物目前無法領取';
      fail('這份禮物已失效或尚未完成付款,請聯繫送禮的人。');
      return;
    }
    if (!Auth || !Auth.getToken || !Auth.getToken()) {
      show(el.needLogin);
      return;
    }
    show(el.form);
  }

  /* ---------- 載入 ---------- */

  function loadByCode(code) {
    call({ action: 'preview', claim_code: code })
      .then(function (d) {
        State.gift = d.gift;
        State.claimable = !!d.claimable;
        renderGift(d.gift);
        renderStage();
      })
      .catch(function (err) { fail(err.message); });
  }

  function loadById(giftId) {
    var token = Auth && Auth.getToken ? Auth.getToken() : '';
    if (!token) {
      // 從禮物中心進來卻沒有 token,先去登入再回來
      gotoLogin();
      return;
    }
    call({ action: 'list', token: token })
      .then(function (d) {
        var g = (d.received || []).find(function (x) { return String(x.id) === String(giftId); });
        if (!g) throw new Error('查無這份禮物,可能不是給你的。');
        State.gift = g;
        State.claimable = g.status === 'paid';
        renderGift(g);
        renderStage();
      })
      .catch(function (err) { fail(err.message); });
  }

  /* ---------- 登入 ---------- */

  function gotoLogin() {
    // requireLogin() 只保留檔名、會把 ?c= 洗掉,所以自己帶 search 存
    var back = window.location.pathname.split('/').pop() + window.location.search;
    if (Auth && Auth.setRedirect) Auth.setRedirect(back);
    window.location.href = 'login.html';
  }

  /* ---------- 送出 ---------- */

  function onSubmit(e) {
    e.preventDefault();
    var token = Auth && Auth.getToken ? Auth.getToken() : '';
    if (!token) { gotoLogin(); return; }

    var name = el.name.value.trim();
    var phone = el.phone.value.trim();
    var addr = el.addr.value.trim();
    if (!name || !phone || !addr) {
      el.formErr.textContent = '三個欄位都要填喔。';
      show(el.formErr);
      return;
    }

    hide(el.formErr);
    el.submit.disabled = true;
    el.submit.textContent = '處 理 中...';

    var payload = {
      action: 'claim', token: token,
      recipient_name: name, recipient_phone: phone, recipient_address: addr
    };
    if (State.claimCode) payload.claim_code = State.claimCode;
    else payload.gift_id = State.giftId;

    call(payload)
      .then(function () {
        hide(el.form);
        el.title.textContent = '領取成功';
        show(el.done);
      })
      .catch(function (err) {
        el.formErr.textContent = err.message;
        show(el.formErr);
        el.submit.disabled = false;
        el.submit.textContent = '確 認 領 取';
      });
  }

  /* ---------- 啟動 ---------- */

  function init() {
    el = {
      loading: $('gcLoading'), error: $('gcError'), errorText: $('gcErrorText'),
      body: $('gcBody'), title: $('gcTitle'), from: $('gcFrom'),
      visual: $('gcVisual'), item: $('gcItem'), design: $('gcDesign'), msg: $('gcMsg'),
      needLogin: $('gcNeedLogin'), loginBtn: $('gcLoginBtn'),
      form: $('gcForm'), name: $('gcName'), phone: $('gcPhone'), addr: $('gcAddr'),
      formErr: $('gcFormErr'), submit: $('gcSubmit'),
      done: $('gcDone'), doneText: $('gcDoneText')
    };
    if (!el.body) return;

    el.loginBtn.addEventListener('click', gotoLogin);
    el.form.addEventListener('submit', onSubmit);

    var p = new URLSearchParams(window.location.search);
    State.claimCode = (p.get('c') || '').trim();
    State.giftId = (p.get('g') || '').trim();

    if (State.claimCode) loadByCode(State.claimCode);
    else if (State.giftId) loadById(State.giftId);
    else fail('這個連結不完整,請向送禮的人索取正確的領取連結。');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window, document);
