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

    /* 優先用合成圖 —— 收禮人第一眼該看到的是「刻上去的樣子」,
       而不是型錄上那副乾淨的眼鏡。
       後兩個是舊資料的退路:合成圖上線前建立的禮物沒有這個欄位。 */
    var visual = g.preview_url || g.product_image || g.design_image_url || '';
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

  /* ⚠ 到門市要做什麼:唯一可行的是【App 出示條碼】。
     -----------------------------------------------------------------
     2026-08-28 主後端實查後給的結論(正式站統計):

       未過期的票券中心券           327 張
         其中門市用客編查得到        30 張   ← 9%

     為什麼那麼少 —— 三層條件疊在一起:
       · 不需授權的客編查詢只列五類券別,而票券中心的券全在第六類
       · 需授權的那一種要求「客人在 App 點過兌換且在 24 小時內」
       · 未綁定門市的人,券上的客編本來就是空的

     對方內部評估後決定【這一輪不開】客編查券核銷那條路 ——
     那等於移除一道內控(門市可在客人不知情下用掉他的折抵券)。

     ⚠ 所以結論是:目前門市核銷【實質上要求客人裝 App】。
     而掃碼那條路完全不碰客編(getCoupon 只認 qrcode),
     所以【綁不綁定都一樣】—— 先前寫「綁定之後當場就能兌換」
     是錯的,綁定不會讓他變得可以核銷。

     ⚠ 「到店再點」那一句【不要刪】。
     -----------------------------------------------------------
     它原本的理由是:點兌換會把門市可查期限覆蓋成 24 小時後,
     有 375 張券卡在那裡 —— 客人做了正確的事,卻把自己的券藏起來。

     那個覆蓋 2026-08-28 已由主後端修正並上正式站,成因消失了。
     但這句話【仍然成立】,只是嚴重程度變了:

       修正前:提早點 → 超過 24 小時 → 門市查不到(券被藏起來)
       修正後:提早點 → 那 24 小時的兌換視窗照樣開始跑,
               只是不再蓋掉更長的期限

     也就是說「提早點沒有好處」沒有變,變的只是壞處有多大。
     這句寫的是「有效時間會先開始跑」,講的正好是修正後的理由,
     所以文字不必動 —— 但別因為看到「對方修好了」就把它拿掉。 */
  function storeExtraNote() {
    return '到門市時,請用【樂活 App】打開這張券、點「兌換」出示條碼給店員掃描。' +
           '⚠ 建議到了櫃檯再點 —— 提早點的話有效時間會先開始跑。' +
           '還沒安裝 App 的話,請先下載並用同一個帳號登入,目前門市核銷需要 App 的條碼。';
  }

  /* B 路線領取完成後,主要動作是「去挑款式」而不是「到禮物中心看看」。
     把按鈕直接指過去,少一次轉折 —— 中間多一頁,就多一個關掉的機會。 */
  function applyDoneBtn(g) {
    if (!el.doneBtn) return;
    if (g && g.status === 'claimed' && !g.design_id) {
      /* 兩條路並行,由他自己選 —— 不再依「有沒有綁定」替他決定。
         線上挑:現在挑好,到店直接配鏡雷刻。
         到店挑:什麼都不用做,帶著手機去讓店員協助。 */
      el.doneBtn.textContent = '線 上 挑 選 款 式';
      el.doneBtn.className = 'gc-btn gc-btn--pri';
      el.doneBtn.href = 'design.html?pick=' + encodeURIComponent(g.id);

      if (el.storeBtn) {
        // ⚠ allstore.html 是門市清單;store.html 是單店內頁,
        //    沒帶門市代號進去會顯示「找不到此門市」。
        el.storeBtn.href = 'allstore.html';
        el.storeBtn.style.display = '';
      }
    }
  }

  function doneNote(g) {
    if (g.status === 'shipped') return '禮物已出貨,請留意物流通知。';
    if (g.status === 'redeemed') return '已在門市完成兌換。';

    /* B 路線:送禮人買的是通用禮物商品,款式還沒決定。
       這時候最該講的不是「已領取」,是「換你挑了」——
       他如果就這樣關掉頁面,那份禮物會一直停在未完成。 */
    if (g.status === 'claimed' && !g.design_id) {
      /* 兩條路都講,讓他自己選。
         未綁定的人也挑得了(pick 不需要客編),第一次到門市時
         店員會順手完成綁定 —— 那不影響他現在能不能挑。 */
      var bound = !Auth || !Auth.isErpBound || Auth.isErpBound();
      return '接下來換你挑 —— 選一副喜歡的鏡框、挑一張刻圖,決定要刻在哪裡。' +
        '挑好之後到任一樂活門市,店員會現場為你配鏡並雷刻。' +
        '不想現在挑也沒關係,帶著手機到門市讓店員陪你挑也可以。' +
        (bound ? '' : '第一次到門市時,店員會順手幫你完成會員綁定。');
    }

    if (g.fulfillment === 'ship') return '已收進你的帳號,商品出貨後會另行通知。';
    /* 不再指向「我的票券」——官網的票券中心已整併進禮物中心,那一頁不存在了。
       券本身發在樂活會員帳號(票券系統),而門市核銷是店員以客編查詢,
       客人不需要在任何 App 或網頁上「找到」那張券再出示。
       所以文案只講「發到帳號」與「到店直接兌換」,不指路到某個畫面。 */
    if (g.status === 'issued') {
      return '兌換券已發到你的樂活會員帳號。' + storeExtraNote();
    }
    /* 即使答案是「什麼都不用做」,也要說出來 ——
       只寫「兌換券準備中」會讓人停在原地,不知道是該等、該去門市、還是出錯了。 */
    return '你現在不用做任何事 —— 兌換券產生中,好了之後會發到你的樂活會員帳號。'
      + '禮物中心看得到最新狀態。' + storeExtraNote();
  }

  function renderStage() {
    var g = State.gift;

    if (['claimed', 'issued', 'shipped', 'redeemed'].indexOf(g.status) >= 0) {
      el.title.textContent = '這份禮物已經領取了';
      el.doneText.textContent = doneNote(g);
      applyDoneBtn(g);
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

    /* 2026-08-20:未綁定門市的會員【也能領】,兩條路線都是。
       -----------------------------------------------------------
       先前這裡整個擋掉,是把事情做反了 ——
       B 路線的用意本來就是讓還不是會員的人也收得到禮物,
       再把他帶進門市綁定。擋在領取這一關,他就沒有理由去店裡了。

       領取之後的差別寫在完成頁(見 doneNote):
       已挑好款式的 → 券進 App,到門市核銷
       還沒挑款式的 → 到門市綁定,店員會協助當場挑 */

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
    /* 2026-08-20 起 list 以 erpid 或 mid 皆可查,
       未綁定的人也看得到自己領的禮物,所以這裡不再擋。 */
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

  /* 記下「領完要回哪裡」。
     requireLogin() 只保留檔名、會把 ?c= 洗掉 —— 那串就是禮物本身,
     掉了就等於把人送去一個空的領取頁,所以自己帶 search 存。 */
  function rememberBack() {
    var back = window.location.pathname.split('/').pop() + window.location.search;
    if (Auth && Auth.setRedirect) Auth.setRedirect(back);
  }

  function gotoLogin() {
    rememberBack();
    window.location.href = 'login.html';
  }

  /* 直接送去註冊。
     -----------------------------------------------------------------
     這條路是通的,而且不需要門市客編:
       領取頁 → 註冊 → 前往登入 → 登入成功 → getRedirect() 帶回這一頁
     中間那個 redirect 存在 localStorage,穿過註冊頁不會掉。

     ⚠ 註冊完成【不會自動登入】(register.js 停在完成畫面),
     所以那一頁的「前往登入」是必經的一步,不是多餘的。 */
  function gotoRegister() {
    rememberBack();
    window.location.href = 'register.html';
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
        applyDoneBtn((d && d.gift) || State.gift);
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
      needLogin: $('gcNeedLogin'), loginBtn: $('gcLoginBtn'), regBtn: $('gcRegBtn'),
      form: $('gcForm'), forWho: $('gcForWho'), claimNote: $('gcClaimNote'),
      formErr: $('gcFormErr'), submit: $('gcSubmit'),
      done: $('gcDone'), doneText: $('gcDoneText'), doneBtn: $('gcDoneBtn'),
      storeBtn: $('gcStoreBtn')
    };
    if (!el.body) return;

    el.loginBtn.addEventListener('click', gotoLogin);
    if (el.regBtn) el.regBtn.addEventListener('click', gotoRegister);
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
