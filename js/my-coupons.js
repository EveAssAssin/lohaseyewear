/* =============================================================
   LohasCoupons · 我的票券(禮物中心的第三個分頁)
   -------------------------------------------------------------
   入口: window.LohasCoupons.load()   (由 gift-center.js 切到該分頁時呼叫)

   依賴: window.LohasAuth (getToken / isErpBound / erpRequiredNote)

   資料來源:
       POST {SUPABASE_URL}/functions/v1/coupon-list   { token }

   票券 API 需要 X-Site-Key,那把金鑰等同帳號接管權限,不可能放在
   前端(本 repo 是公開的 GitHub Pages)。而且對方明文要求 client_id
   必須由後端從 session 取得,絕不接受前端傳入 —— 否則任何人都能查
   別人的票券。所以一律走 Edge Function。

   === 這一頁是 2026-09-03 重做的,不是把舊版搬回來 ===
   舊的 js/my-coupons.js 於 2026-08-11 隨「票券移出官網」一起刪除。
   這次重做刻意改掉三件事:

   1. 【不顯示 amount】。舊版把它印成「$N 折抵金額」,那是錯的 ——
      贈品型券的 amount 是票券中心的欄位設定值,不是折抵金額。
      實測有一張「客製太陽眼鏡體驗券」的 amount 是 10,印出來變成
      「折 10 元」,客人會以為只折十塊。折抵一律以商城結帳頁為準。
      (同一個警告也寫在 js/design.js 的票券模式裡。)

   2. 【拿不到資料就說拿不到】。舊版在 Edge Function 還沒部署時會
      退回五張示範票券。那個過渡措施現在是負債:函式早就上線了,
      再退回假資料只會讓人看到五張不存在的券還以為是真的。

   3. 【講清楚官網不能轉贈】。轉贈是 App 的功能,官網做不到。
      兩邊並排而不說,客人會以為官網壞了。
   ============================================================= */

(function (window, document) {
  'use strict';

  var CONFIG = {
    ENDPOINT: 'https://hqdmyxxrskvllkcedybl.supabase.co/functions/v1/coupon-list',
    TIMEOUT_MS: 12000,
    /* 客人按「立即使用」要去的地方。與 App 票券頁按「使用」是同一條路 ——
       兩邊落在同一頁,客人才不會覺得官網是另一套東西。 */
    USE_URL: 'design.html?coupon_id='
  };

  /* 對方的錯誤碼 → 客人看得懂的話。
     沒對到的碼一律走通用訊息,不要把代碼原樣丟給客人看。 */
  var ERR_MSG = {
    '006': '資料不完整,請重新整理後再試',
    '007': '查無此票券',
    '401': '登入狀態已失效,請重新登入',
    '429': '操作太頻繁,請稍候再試',
    '500': '票券服務忙碌中,請稍後再試一次'
  };

  var STATUS = {
    usable:  { label: '可使用',   cls: 'usable',  icon: 'fa-circle-check' },
    locked:  { label: '使用中',   cls: 'locked',  icon: 'fa-hourglass-half' },
    used:    { label: '已使用',   cls: 'used',    icon: 'fa-check' },
    expired: { label: '已過期',   cls: 'expired', icon: 'fa-ban' },
    notyet:  { label: '尚未開始', cls: 'notyet',  icon: 'fa-clock' }
  };

  /* 排序權重。可以用的排最前面 —— 客人打開這一頁是要用券,
     不是要看自己過期了幾張。 */
  var ORDER = { usable: 0, locked: 1, notyet: 2, used: 3, expired: 4 };

  /* 已失效的券預設收起來。
     實測 28095839 這個帳號:27 張裡有 20 張已過期 —— 全部攤開的話
     客人要一路捲過二十張灰卡才看得到能用的那幾張。
     不直接濾掉是因為他會想確認「我那張是不是過期了」,
     所以收起來但留一個開關,並且把張數寫在按鈕上。 */
  var DEAD = { used: 1, expired: 1 };

  /* 這一頁只列【在官網用得到】的券。
     -----------------------------------------------------------------
     判斷標準有兩層,兩層都要過:
       status      券本身有效嗎(已使用/已過期就沒了)
       site_usable 這張券開放在官網用嗎(由主後端決定)

     locked(使用中)算「用得到」—— 它是暫時的,最多四小時就自己放掉,
     藏起來的話客人會覺得券憑空消失了,那比看到一張倒數更難解釋。

     ⚠ 其餘的【藏起來但不是當作不存在】。客人的券還在,只是不在這裡用 ——
     所以摘要那一行一定要把張數講出來,並指向 App。
     直接讓畫面空白等於告訴他「你沒有券」,那是假的。 */
  function usableHere(c) {
    if (DEAD[c.status]) return false;
    if (c.status === 'locked') return true;
    return c.site_usable === true && c.status === 'usable';
  }

  var State = { loaded: false, loading: false, list: [], err: '',
                needLogin: false, showAll: false };
  var timer = 0;

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtDate(c) {
    if (c.end_date) return String(c.end_date);
    if (!c.end_time) return '';
    var d = new Date(Number(c.end_time) * 1000);
    return isNaN(d) ? '' : d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function fmtRemain(sec) {
    if (sec <= 0) return '00:00';
    var m = Math.floor(sec / 60), s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  /* ---------- 取資料 ---------- */

  function fetchCoupons() {
    var Auth = window.LohasAuth;
    var token = Auth && Auth.getToken ? Auth.getToken() : '';
    if (!token) return Promise.reject({ needLogin: true });

    var ctrl = new AbortController();
    var to = setTimeout(function () { ctrl.abort(); }, CONFIG.TIMEOUT_MS);

    /* ⚠ 不可加 credentials:'include' —— Edge Function 的 CORS 回應是 '*',
       兩者並存會被瀏覽器擋下。 */
    return fetch(CONFIG.ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token }),
      signal: ctrl.signal
    })
      .then(function (r) {
        clearTimeout(to);
        if (r.status === 401) throw { needLogin: true };
        return r.json();
      })
      .then(function (j) {
        var code = String(j && j.code);
        if (code === '401') throw { needLogin: true };
        if (code !== '200' || !j.data) {
          throw { msg: ERR_MSG[code] || (j && j.message) || '票券服務暫時無法使用' };
        }
        return j.data.coupons || [];
      })
      .catch(function (e) {
        clearTimeout(to);
        if (e && (e.needLogin || e.msg)) throw e;
        // AbortError 與網路錯誤都走這裡。不退回假資料,見檔頭第 2 點。
        throw { msg: '票券服務連線失敗,請稍後再試一次' };
      });
  }

  /* ---------- 畫面 ---------- */

  function cardHtml(c) {
    var st = STATUS[c.status] || STATUS.usable;
    var dim = (c.status === 'used' || c.status === 'expired');
    var canUse = c.site_usable === true && c.status === 'usable';

    /* ⚠ status 與 site_usable 是兩件事:券本身有效(status=usable),
       但不見得開放在官網用(site_usable=false)。兩個都照字面畫的話,
       同一張卡上會出現「可使用」徽章配上「此票券未開放在官網使用」——
       客人只會覺得網站壞了。徽章改講實話:這裡不能用,去 App。 */
    if (c.status === 'usable' && c.site_usable !== true) {
      st = { label: '限 App 使用', cls: 'notyet', icon: 'fa-mobile-screen-button' };
    }

    var action;
    if (canUse) {
      action = '<a class="cp-use" href="' + CONFIG.USE_URL + encodeURIComponent(c.coupon_id) + '">' +
               '立 即 使 用</a>';
    } else if (c.status === 'locked') {
      /* 使用中 = 有人(可能就是他自己在另一個分頁)正鎖著這張券。
         倒數讓他知道等多久,不然只看到「使用中」會以為券壞了。 */
      action = '<span class="cp-wait" data-until="' + (Number(c.locked_until) || 0) + '">' +
               '<i class="fa-solid fa-hourglass-half"></i>使用中</span>';
    } else if (c.site_block_reason) {
      action = '<span class="cp-blocked"><i class="fa-solid fa-circle-info"></i>' +
               esc(c.site_block_reason) + '</span>';
    } else {
      action = '';
    }

    var end = fmtDate(c);

    return '' +
      '<div class="cp-card' + (dim ? ' is-dim' : '') + '">' +
        '<div class="cp-mark"><i class="fa-solid fa-ticket"></i></div>' +
        '<div class="cp-body">' +
          '<div class="cp-head">' +
            '<h3 class="cp-title">' + esc(c.title || '票券') + '</h3>' +
            '<span class="cp-badge ' + st.cls + '">' +
              '<i class="fa-solid ' + st.icon + '"></i>' + st.label +
            '</span>' +
          '</div>' +
          /* ⚠ 這裡故意只印 redeem_content,不印 amount。理由見檔頭第 1 點。 */
          (c.redeem_content ? '<p class="cp-desc">' + esc(c.redeem_content) + '</p>' : '') +
          '<div class="cp-meta">' +
            (end ? '<span><i class="fa-regular fa-calendar"></i>有效至 ' + esc(end) + '</span>' : '') +
            (c.site_note ? '<span><i class="fa-solid fa-circle-exclamation"></i>' +
                           esc(c.site_note) + '</span>' : '') +
          '</div>' +
          (action ? '<div class="cp-foot">' + action + '</div>' : '') +
        '</div>' +
      '</div>';
  }

  function render() {
    var box = $('couponList');
    if (!box) return;

    if (State.loading) { box.innerHTML = '<p class="empty-text">載入中...</p>'; return; }

    if (State.needLogin) {
      box.innerHTML =
        '<div class="md-notice"><i class="fa-solid fa-circle-exclamation"></i>' +
        '<div>登入狀態已失效,請<a href="login.html" style="text-decoration:underline">重新登入</a>' +
        '後再查看票券。</div></div>';
      return;
    }

    if (State.err) {
      box.innerHTML =
        '<div class="md-notice"><i class="fa-solid fa-triangle-exclamation"></i>' +
        '<div>' + esc(State.err) + '</div></div>';
      return;
    }

    /* 轉贈說明放在最上面,而且不論有沒有券都要出現。
       客人來這一頁很可能就是要找轉贈,找不到才是最糟的體驗。 */
    var note =
      '<div class="cp-hint">' +
        '<i class="fa-solid fa-mobile-screen-button"></i>' +
        '<div><b>要轉贈給親友,請開【樂活 App】。</b>' +
        '官網這一頁只能查看與使用,轉贈功能在 App 的票券頁。</div>' +
      '</div>';

    if (!State.list.length) {
      box.innerHTML = note + '<p class="empty-text">目前沒有票券。生日票券會在生日當月自動匯入。</p>';
      return;
    }

    var here   = State.list.filter(usableHere);
    var hidden = State.list.length - here.length;
    var appOnly = State.list.filter(function (c) {
      return !DEAD[c.status] && c.status !== 'locked' && c.site_usable !== true;
    }).length;
    var dead = State.list.filter(function (c) { return DEAD[c.status]; }).length;

    /* 摘要那一行是這一頁最重要的一句話。
       藏起來的券【還在客人手上】,只是不在這裡用 —— 不把張數說出來,
       空白的畫面等於告訴他「你沒有券」,而那是假的。 */
    var parts = [];
    if (appOnly) parts.push('<b>' + appOnly + '</b> 張只能在 App 用');
    if (dead)    parts.push('<b>' + dead + '</b> 張已失效');

    var bar = '<div class="cp-sum">' +
      '<span>共 <b>' + State.list.length + '</b> 張' +
      (parts.length ? '，其中 ' + parts.join('、') : '') + '</span>' +
      (hidden ? '<button type="button" class="cp-toggle" data-toggle>' +
                (State.showAll ? '只看能用的' : '全部顯示 ' + State.list.length + ' 張') +
                '</button>' : '') +
      '</div>';

    if (!here.length && appOnly) {
      bar += '<div class="cp-hint cp-hint--warn">' +
        '<i class="fa-solid fa-mobile-screen-button"></i>' +
        '<div>你的券<b>目前都只開放在【樂活 App】或門市使用</b>，' +
        '所以這裡列不出來。券沒有不見 —— 打開 App 的票券頁就看得到。</div></div>';
    }

    var list = (State.showAll ? State.list.slice() : here).sort(function (a, b) {
      var d = (ORDER[a.status] == null ? 9 : ORDER[a.status]) -
              (ORDER[b.status] == null ? 9 : ORDER[b.status]);
      if (d) return d;
      return (Number(a.end_time) || 0) - (Number(b.end_time) || 0);  // 快到期的排前面
    });

    box.innerHTML = note + bar + (
      list.length ? list.map(cardHtml).join('')
                  : '<p class="empty-text">目前沒有可以在官網使用的票券。</p>'
    );
    bindToggle();
    startCountdown();
  }

  function bindToggle() {
    var b = document.querySelector('#couponList [data-toggle]');
    if (!b) return;
    b.addEventListener('click', function () {
      State.showAll = !State.showAll;
      render();
    });
  }

  /* 「使用中」的倒數。只在畫面上真的有這種券時才跑計時器 ——
     沒有的話留著一個每秒醒來的 interval 是白費電。 */
  function startCountdown() {
    if (timer) { clearInterval(timer); timer = 0; }
    var box = $('couponList');
    if (!box || !box.querySelector('[data-until]')) return;

    timer = setInterval(function () {
      var nodes = box.querySelectorAll('[data-until]');
      if (!nodes.length) { clearInterval(timer); timer = 0; return; }
      var now = Math.floor(Date.now() / 1000);
      nodes.forEach(function (n) {
        var left = Number(n.dataset.until) - now;
        if (left <= 0) {
          // 鎖已經放掉了。不自己改成「可使用」—— 那是猜的,重新查才算數。
          n.innerHTML = '<i class="fa-solid fa-rotate"></i>已釋放,重新整理即可使用';
          n.removeAttribute('data-until');
          return;
        }
        n.innerHTML = '<i class="fa-solid fa-hourglass-half"></i>使用中 ' + fmtRemain(left);
      });
    }, 1000);
  }

  /* ---------- 對外 ---------- */

  function load(force) {
    var box = $('couponList');
    if (!box) return;
    if (State.loaded && !force) { render(); return; }

    /* 票券以 ERP 客編為索引。官網註冊而未綁定門市的會員查不到 ——
       在打 API 之前就講,不要讓他等一趟往返才看到空白。
       (design.js 的票券模式在鎖券之前也是這樣擋。) */
    var Auth = window.LohasAuth;
    if (Auth && Auth.isErpBound && !Auth.isErpBound()) {
      box.innerHTML = '<div class="md-notice"><i class="fa-solid fa-circle-info"></i><div>' +
        esc(Auth.erpRequiredNote ? Auth.erpRequiredNote() : '這項功能需要門市會員資格。') +
        '</div></div>';
      State.loaded = true;
      return;
    }

    State.loading = true; State.err = ''; State.needLogin = false;
    render();

    fetchCoupons()
      .then(function (list) { State.list = Array.isArray(list) ? list : []; })
      .catch(function (e) {
        State.list = [];
        if (e && e.needLogin) State.needLogin = true;
        else State.err = (e && e.msg) || '票券服務暫時無法使用';
      })
      .then(function () {
        State.loading = false;
        State.loaded = true;
        render();
      });
  }

  function stop() { if (timer) { clearInterval(timer); timer = 0; } }

  window.LohasCoupons = { load: load, stop: stop };

})(window, document);
