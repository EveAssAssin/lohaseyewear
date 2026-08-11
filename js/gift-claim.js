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

    var spec = g.product_spec_title ? '（' + esc(g.product_spec_title) + '）' : '';
    el.item.innerHTML = g.product_title
      ? '<span class="gc-item-label">禮物內容</span>' +
        '<span class="gc-item-name">' + esc(g.product_title) + spec + '</span>'
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

  // 兩條履約路徑的說明文案分開寫,不共用一句含糊的
  function claimNote(g) {
    return g.fulfillment === 'ship'
      ? '送禮的人已經填好收件資訊、完成付款,商品會直接寄出。按下確認後,這份禮物與刻圖就會收進你的帳號。'
      : '確認後會發一張兌換券到你的帳號,帶著它到樂活門市,現場配鏡並雷刻這張刻圖。顏色與尺寸可以到店再挑。'
        + storeExtraNote();
  }

  /* 門市兌換要核銷,系統上需要 ERP 客編,而官網註冊只會建立 App 會員、
     客編是空的。這不影響領取(券發得出去,綁定後系統會自動回填客編),
     但到店時店員要先幫他綁一次。

     先講比到現場才被問好 —— 那時候人已經在櫃檯前,才知道還有一道手續,
     體驗上就是「這禮物怎麼這麼麻煩」。 */
  function storeExtraNote() {
    return '第一次到樂活門市的話,店員會先協助你完成會員綁定再兌換,不需另外準備什麼。';
  }

  function doneNote(g) {
    if (g.status === 'shipped') return '禮物已出貨,請留意物流通知。';
    if (g.status === 'redeemed') return '已在門市完成兌換。';
    if (g.fulfillment === 'ship') return '已收進你的帳號,商品出貨後會另行通知。';
    if (g.status === 'issued') {
      return '兌換券已在你的帳號裡,到「我的票券」就能看到。帶著它到門市即可。'
        + storeExtraNote();
    }
    return '兌換券準備中,稍後會出現在「我的票券」。';
  }

  function renderStage() {
    var g = State.gift;

    if (['claimed', 'issued', 'shipped', 'redeemed'].indexOf(g.status) >= 0) {
      el.title.textContent = '這份禮物已經領取了';
      el.doneText.textContent = doneNote(g);
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

    if (g.recipient_label) {
      el.forWho.innerHTML = '<i class="fa-solid fa-circle-info"></i> 送禮的人指名要送給「' +
                            esc(g.recipient_label) + '」。不是你的話,請把連結轉給對的人。';
      show(el.forWho);
    }
    el.claimNote.textContent = claimNote(g);
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

    hide(el.formErr);
    el.submit.disabled = true;
    el.submit.textContent = '處 理 中...';

    var payload = { action: 'claim', token: token };
    if (State.claimCode) payload.claim_code = State.claimCode;
    else payload.gift_id = State.giftId;

    call(payload)
      .then(function (d) {
        hide(el.form);
        el.title.textContent = '領取成功';
        el.doneText.textContent = doneNote((d && d.gift) || State.gift);
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
      form: $('gcForm'), forWho: $('gcForWho'), claimNote: $('gcClaimNote'),
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
