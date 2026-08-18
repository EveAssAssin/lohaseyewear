/* =============================================================
   LOHAS · 會員註冊 (register.html)
   -------------------------------------------------------------
   兩步驟:
     ① 填資料 → member-auth register_send → 對方寄出驗證碼
     ② 填驗證碼 → member-auth register_verify → 建立完成

   金鑰在 member-auth 那一層,前端不碰。

   ⚠ 註冊出來的是【App 會員】,client_id(erpid)是空的 ——
     票券、禮物等需要 ERP 客編的功能要到門市綁定後才能用。
     完成頁會講明這件事,不要讓人以為註冊完就什麼都能做。
   ============================================================= */

(function (window, document) {
  'use strict';

  var ENDPOINT = 'https://hqdmyxxrskvllkcedybl.supabase.co/functions/v1/member-auth';
  var TIMEOUT_MS = 20000;

  /* ⚠ 尚未開放(2026-08-17)
     -------------------------------------------------------------
     member-auth 目前指向主後端的【測試站】,而登入走的是正式環境。
     在這種狀態下註冊成功的帳號會建在測試環境、然後登不進來,
     而且姓名、Email、手機會寫進不該寫的地方。

     擋在這裡而不是只拿掉 login.html 的連結,是因為這頁的網址一旦
     被分享或被搜尋引擎收錄,拿掉連結擋不住任何人。

     待 member-auth 的 base URL 改為正式站並驗證後,把這個常數改成
     false 即可。 */
  var NOT_READY = true;
  var NOT_READY_NOTE = '會員註冊功能整備中,尚未開放。' +
    '目前請至樂活門市或樂活 App 註冊,兩邊的帳號是共用的。';

  /* 內部測試入口:register.html?internal=1
     -------------------------------------------------------------
     這【不是安全機制】。真正的防線是 member-auth 指向測試站 ——
     就算有人猜到這個參數,他建立的帳號也只會進測試環境。
     它的用途只有一個:避免真實訪客在整備期間誤入。

     測試站沒有接郵件服務(register/send 會回 079),所以測試模式下
     只開放簡訊。簡訊在測試站會被攔截、不實際發送,但驗證碼照常產生,
     由後端的 healthz/smscode 取得(商城 2026-08-17 來文)。 */
  var IS_INTERNAL = /[?&]internal=1(?:&|$)/.test(location.search);
  var SMS_CODE_URL = 'https://lohas-app-backend-test.onrender.com/healthz/smscode';

  var State = { sessionKey: '', sentTo: '', verifyType: 'email' };
  var el = {};

  /* ---------- 工具 ---------- */

  function $(id) { return document.getElementById(id); }
  function show(n) { if (n) n.style.display = ''; }
  function hide(n) { if (n) n.style.display = 'none'; }

  function call(payload) {
    var ctrl = new AbortController();
    var to = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    })
      .then(function (r) { clearTimeout(to); return r.json(); })
      .then(function (j) {
        if (String(j.code) !== '200') {
          var e = new Error(msgOf(j));
          e.code = String(j.code);
          throw e;
        }
        return j.data || {};
      })
      .catch(function (err) {
        clearTimeout(to);
        if (err.name === 'AbortError') throw new Error('連線逾時,請重新送出一次。');
        // fetch 本身失敗只會丟 TypeError,訊息是英文的 "Failed to fetch"
        if (err instanceof TypeError) throw new Error('目前無法連線,請稍後再試。');
        throw err;
      });
  }

  /* 錯誤碼對照(票券文件附錄三)。
     沒對到的才退回對方原本的 message —— 那些訊息不一定是給客人看的。 */
  var CODE_MSG = {
    '006': '有欄位沒填或格式不對,請檢查後再送出。',
    '013': '這組驗證資訊已經失效,請回上一步重新索取。',
    '016': '這個帳號已經有人使用了,換一個試試。',
    '017': '這個 Email 已經註冊過了。忘記帳號的話可以用「忘記帳號」找回。',
    '018': '這支手機號碼已經註冊過了。',
    '019': '驗證碼不正確、已逾時,或錯誤次數過多。',
    '027': '這支手機已經有會員了,請改用登入,或使用「忘記帳號」。',
    '028': '不支援這個國碼。',
    '029': '索取驗證碼太頻繁了,請稍後再試。',
    '039': '密碼格式不符,請用 6–20 碼的英文與數字。',
    '001': '簡訊寄送失敗,請改用 Email 驗證,或稍後再試。',
    '079': 'Email 寄送失敗,請確認信箱正確,或改用手機驗證。'
  };

  function msgOf(j) {
    return CODE_MSG[String(j.code)] || j.message || '操作失敗,請稍後再試。';
  }

  function setHint(node, text, cls) {
    if (!node) return;
    node.textContent = text || '';
    node.className = 'rg-hint' + (cls ? ' ' + cls : '');
  }

  function fieldErr(input, on) {
    if (input) input.classList.toggle('is-err', !!on);
  }

  function showErr(node, msg) {
    if (!node) return;
    node.textContent = msg;
    show(node);
  }

  /* ---------- 即時檢查 ----------
     對方有一支 checkDuplicate,趁使用者還在這一頁時就講,
     不要等按下「下一步」、簡訊都寄出去了才說帳號被用了。 */

  function checkDup(field, value, input, hint) {
    if (!value) { setHint(hint, ''); fieldErr(input, false); return; }
    var payload = { action: 'check_duplicate' };
    payload[field] = value;

    call(payload).then(function (d) {
      var taken = d[field + '_taken'];
      if (taken) {
        setHint(hint, CODE_MSG[{ account: '016', email: '017', mobile: '018' }[field]], 'is-err');
        fieldErr(input, true);
      } else {
        setHint(hint, '可以使用', 'is-ok');
        fieldErr(input, false);
      }
    }).catch(function () {
      /* 查重複失敗不擋流程 —— 真正的把關在對方的註冊 API,
         這裡只是提前提示。網路不好就安靜略過,不要嚇使用者。 */
      setHint(hint, '');
    });
  }

  /* ---------- 前端檢查 ----------
     只擋「明顯不會過」的,格式細節交給對方 ——
     兩邊各寫一套規則,遲早會出現前端說可以、後端說不行的縫隙。 */

  function validate() {
    var account = el.account.value.trim();
    var pwd = el.pwd.value;
    var pwd2 = el.pwd2.value;
    var name = el.name.value.trim();
    var email = el.email.value.trim();
    var mobile = el.mobile.value.trim();

    if (account.length < 6) return { msg: '帳號至少要 6 碼。', focus: el.account };
    if (pwd.length < 6 || pwd.length > 20) return { msg: '密碼請用 6–20 碼。', focus: el.pwd };
    if (pwd !== pwd2) return { msg: '兩次輸入的密碼不一樣。', focus: el.pwd2 };
    if (!name) return { msg: '請填寫姓名。', focus: el.name };
    if (!email || email.indexOf('@') < 1) return { msg: '請填寫正確的 Email。', focus: el.email };
    if (!mobile) return { msg: '請填寫手機號碼。', focus: el.mobile };
    return null;
  }

  /* ---------- 第一步:送驗證碼 ---------- */

  function sendCode() {
    var bad = validate();
    if (bad) {
      showErr(el.err, bad.msg);
      if (bad.focus) bad.focus.focus();
      return;
    }

    hide(el.err);
    el.submit.disabled = true;
    el.submit.textContent = '寄 送 中...';

    State.verifyType = (document.querySelector('input[name="rgVerify"]:checked') || {}).value || 'email';

    call({
      action: 'register_send',
      account: el.account.value.trim(),
      pwd: el.pwd.value,
      name: el.name.value.trim(),
      email: el.email.value.trim(),
      mobile: el.mobile.value.trim(),
      country_code: el.country.value,
      verify_type: State.verifyType
      /* client_ip 由 member-auth 從 x-forwarded-for 取,前端拿不到真實 IP */
    })
      .then(function (d) {
        State.sessionKey = d.session_key || '';
        State.sentTo = d.sent_to || '';
        if (!State.sessionKey) throw new Error('未取得驗證資訊,請重新送出一次。');
        goStep2();
      })
      .catch(function (err) {
        showErr(el.err, err.message);
        el.submit.disabled = false;
        el.submit.textContent = '下 一 步';
      });
  }

  function goStep2() {
    el.step1.classList.remove('on');
    el.step2.classList.add('on');
    hide(el.form);
    show(el.verifyPane);

    var where = State.verifyType === 'sms' ? '手機' : 'Email';
    el.sentTo.innerHTML = '驗證碼已寄到你的' + where +
      (State.sentTo ? ' <b>' + State.sentTo + '</b>' : '') +
      '。<br>沒看到的話,檢查一下垃圾郵件或稍等一分鐘。';
    el.code.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- 第二步:驗證並建立 ---------- */

  function verify() {
    var code = el.code.value.trim();
    if (!code) { showErr(el.verifyErr, '請輸入驗證碼。'); return; }

    hide(el.verifyErr);
    el.verifyBtn.disabled = true;
    el.verifyBtn.textContent = '驗 證 中...';

    call({ action: 'register_verify', session_key: State.sessionKey, code: code })
      .then(function (d) { done(d); })
      .catch(function (err) {
        showErr(el.verifyErr, err.message);
        el.verifyBtn.disabled = false;
        el.verifyBtn.textContent = '完 成 註 冊';
      });
  }

  function done(d) {
    hide(el.verifyPane);
    show(el.donePane);
    el.step2.classList.remove('on');

    /* 講白「還沒綁定門市會員」這件事。
       對方回的 notice 是給系統看的措辭,這裡用客人聽得懂的說法。 */
    var acc = d.account ? '你的帳號是 ' + d.account + '。' : '';
    el.doneText.innerHTML = acc +
      '現在就可以登入,瀏覽刻圖、收藏喜歡的設計。<br><br>' +
      '<b>票券與禮物相關功能</b>需要門市會員身分,' +
      '第一次到樂活門市時,店員會協助你完成綁定,不需另外準備什麼。';

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function backToStep1() {
    el.step2.classList.remove('on');
    el.step1.classList.add('on');
    hide(el.verifyPane);
    show(el.form);
    hide(el.verifyErr);
    el.submit.disabled = false;
    el.submit.textContent = '下 一 步';
    State.sessionKey = '';
  }

  /* ---------- 內部測試模式 ---------- */

  /* 一眼看得出這不是正式流程。
     沒有這條橫幅的話,測試中的人很容易忘記自己在測試站,
     然後拿真實的手機號碼註冊、或以為帳號建在正式環境。 */
  function initInternalBanner() {
    var bar = document.createElement('div');
    bar.className = 'rg-internal';
    bar.innerHTML =
      '<b>內部測試模式</b>　資料會建立在<b>測試站</b>,不是正式環境。<br>' +
      '驗證碼不會實際發送,送出後到 ' +
      '<a href="' + SMS_CODE_URL + '" target="_blank" rel="noopener">healthz/smscode</a>' +
      ' 取得。';
    el.form.parentNode.insertBefore(bar, el.form);

    /* 測試站沒有郵件服務,Email 那條一定回 079。
       與其讓人選了才失敗,不如直接鎖成簡訊並說明原因。 */
    var email = document.querySelector('input[name="rgVerify"][value="email"]');
    var sms = document.querySelector('input[name="rgVerify"][value="sms"]');
    if (email && sms) {
      email.disabled = true;
      email.checked = false;
      sms.checked = true;
      var label = email.closest('.rg-radio');
      if (label) {
        label.style.opacity = '.45';
        label.style.cursor = 'not-allowed';
        label.title = '測試站沒有接郵件服務,只能用簡訊驗證';
      }
    }
  }

  /* ---------- 啟動 ---------- */

  function init() {
    el = {
      account: $('rgAccount'), accountHint: $('rgAccountHint'),
      pwd: $('rgPwd'), pwdHint: $('rgPwdHint'),
      pwd2: $('rgPwd2'), pwd2Hint: $('rgPwd2Hint'),
      name: $('rgName'),
      email: $('rgEmail'), emailHint: $('rgEmailHint'),
      country: $('rgCountry'), mobile: $('rgMobile'),
      err: $('rgErr'), submit: $('rgSubmit'),
      form: $('rgForm'), verifyPane: $('rgVerifyPane'), donePane: $('rgDone'),
      sentTo: $('rgSentTo'), code: $('rgCode'),
      verifyErr: $('rgVerifyErr'), verifyBtn: $('rgVerifyBtn'),
      back: $('rgBack'), doneText: $('rgDoneText'),
      step1: $('rgStep1'), step2: $('rgStep2')
    };
    if (!el.form) return;

    if (IS_INTERNAL) initInternalBanner();

    /* 未開放時直接停在說明畫面。表單連渲染都不渲染 ——
       讓人填完一整頁才說「尚未開放」比一開始就講更糟。 */
    if (NOT_READY && !IS_INTERNAL) {
      hide(el.form);
      show(el.donePane);
      el.donePane.querySelector('.rg-done-icon').innerHTML =
        '<i class="fa-solid fa-circle-info"></i>';
      el.donePane.querySelector('.rg-done-title').textContent = '尚未開放';
      el.doneText.textContent = NOT_READY_NOTE;
      el.donePane.querySelector('.rg-done-btn').textContent = '回 登 入';
      return;
    }

    el.account.addEventListener('blur', function () {
      var v = this.value.trim();
      if (v.length >= 6) checkDup('account', v, this, el.accountHint);
      else if (v) setHint(el.accountHint, '帳號至少要 6 碼', 'is-err');
      else setHint(el.accountHint, '');
    });

    el.email.addEventListener('blur', function () {
      var v = this.value.trim();
      if (v.indexOf('@') > 0) checkDup('email', v, this, el.emailHint);
      else setHint(el.emailHint, '');
    });

    el.mobile.addEventListener('blur', function () {
      var v = this.value.trim();
      if (v.length >= 8) checkDup('mobile', v, this, $('rgMobileHint'));
      else setHint($('rgMobileHint'), '日後到門市綁定會員時,以這支號碼比對');
    });

    el.pwd.addEventListener('input', function () {
      var v = this.value;
      if (!v) { setHint(el.pwdHint, ''); fieldErr(this, false); return; }
      var ok = v.length >= 6 && v.length <= 20;
      setHint(el.pwdHint, ok ? '' : '請用 6–20 碼', ok ? '' : 'is-err');
      fieldErr(this, !ok);
    });

    el.pwd2.addEventListener('input', function () {
      if (!this.value) { setHint(el.pwd2Hint, ''); fieldErr(this, false); return; }
      var same = this.value === el.pwd.value;
      setHint(el.pwd2Hint, same ? '' : '兩次密碼不一樣', same ? '' : 'is-err');
      fieldErr(this, !same);
    });

    el.submit.addEventListener('click', sendCode);
    el.verifyBtn.addEventListener('click', verify);
    el.back.addEventListener('click', function (e) { e.preventDefault(); backToStep1(); });

    el.code.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') verify();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window, document);
