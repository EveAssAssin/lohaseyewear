/* =============================================================
   LohasCoupons · 我的票券
   -------------------------------------------------------------
   入口: window.LohasCoupons.load()   （由 member-portal.js 於進頁時呼叫）

   依賴:
     window.LohasAuth  (getStoredMember)   取得 erpid

   ⚠ 資料來源說明
   票券 API 需要 X-Site-Key,該金鑰等同帳號接管權限,
   絕對不可寫在前端(本 repo 為公開的 GitHub Pages)。
   因此一律透過 Supabase Edge Function 代理:

       POST {SUPABASE_URL}/functions/v1/coupon-list

   Edge Function 內部才持有金鑰,並自 session 取得 erpId
   (對方要求 client_id 必須由後端 session 取得,不可由前端傳入)。

   Edge Function 尚未部署前,自動退回示範資料並顯示提示,
   以便先行檢視 UI。接上真 API 後 UI 無需任何改動。
   ============================================================= */

(function (window) {
  'use strict';

  var Auth = window.LohasAuth;

  var CONFIG = {
    // Edge Function 代理端點(尚未部署)
    ENDPOINT: 'https://hqdmyxxrskvllkcedybl.supabase.co/functions/v1/coupon-list',
    TIMEOUT_MS: 12000
  };

  // 狀態對照:文案 + 徽章樣式 + 圖示
  var STATUS_MAP = {
    usable:  { label: '可使用',   cls: 'usable',  icon: 'fa-circle-check' },
    locked:  { label: '使用中',   cls: 'locked',  icon: 'fa-hourglass-half' },
    used:    { label: '已使用',   cls: 'used',    icon: 'fa-check' },
    expired: { label: '已過期',   cls: 'expired', icon: 'fa-ban' },
    notyet:  { label: '尚未開始', cls: 'notyet',  icon: 'fa-clock' }
  };

  var State = {
    coupons: [],
    filter: 'all',
    isDemo: false,
    loaded: false,
    countdownTimer: null
  };

  /* ---------- 工具 ---------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function money(n) {
    return Number(n || 0).toLocaleString();
  }

  // unix 秒 → YYYY-MM-DD
  function fmtDate(unix) {
    if (!unix) return '';
    var d = new Date(unix * 1000);
    if (isNaN(d)) return '';
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  // 剩餘秒數 → mm:ss
  function fmtRemain(sec) {
    if (sec <= 0) return '00:00';
    var m = Math.floor(sec / 60), s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  /* ---------- 取得票券 ---------- */

  function fetchCoupons() {
    var ctrl = new AbortController();
    var to = setTimeout(function () { ctrl.abort(); }, CONFIG.TIMEOUT_MS);

    // ⚠ 過渡期:session 機制尚未完成,暫由前端帶 erpid。
    // Edge Function 完成 session 驗證後會忽略此值,屆時可移除。
    var m = Auth && Auth.getStoredMember ? Auth.getStoredMember() : null;

    // 註:不可加 credentials:'include' —— Edge Function 的 CORS 回應為 '*',
    // 兩者並存會被瀏覽器擋下。未來改用 session cookie 時,
    // 需同時把 Edge Function 的 Allow-Origin 改為指定網域才能開啟。
    return fetch(CONFIG.ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ erpid: m && m.erpid ? m.erpid : '' }),
      signal: ctrl.signal
    })
      .then(function (r) {
        clearTimeout(to);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (j) {
        if (j.code !== '200' || !j.data) throw new Error(j.message || '回應格式不符');
        State.isDemo = false;
        return j.data.coupons || [];
      })
      .catch(function (err) {
        clearTimeout(to);
        console.warn('[coupons] 代理尚未就緒,改用示範資料:', err.message);
        State.isDemo = true;
        return demoCoupons();
      });
  }

  // 示範資料(取自測試環境真實回應,結構完全一致)
  function demoCoupons() {
    return [
      {
        coupon_id: 1447, title: '客製太陽眼鏡體驗券', amount: 3000,
        status: 'usable', site_usable: true, site_block_reason: '',
        category_tid: [37], redeem_content: '可兌換太陽眼鏡一副並含客製刻圖',
        usage_rule: '1. 每次限用一張\n2. 逾期無效', site_note: '刻圖費用另計',
        end_date: '2026-08-31', end_time: 1788191999, locked_until: 0
      },
      {
        coupon_id: 1448, title: '生日專屬折抵券', amount: 1000,
        status: 'locked', site_usable: true, site_block_reason: '',
        category_tid: [37], redeem_content: '生日當月配鏡折抵',
        usage_rule: '', site_note: '',
        end_date: '2026-12-31', end_time: 1798646400,
        locked_until: Math.floor(Date.now() / 1000) + 1180
      },
      {
        coupon_id: 1445, title: '禮程現金抵用券', amount: 10,
        status: 'usable', site_usable: false,
        site_block_reason: '此票券未開放在官網使用',
        category_tid: [], redeem_content: '', usage_rule: '', site_note: '',
        end_date: '2038-01-19', end_time: 2147483647, locked_until: 0
      },
      {
        coupon_id: 392, title: '年年換新計劃', amount: 0,
        status: 'used', site_usable: false, site_block_reason: '此票券已使用',
        category_tid: [], redeem_content: '', usage_rule: '', site_note: '',
        end_date: '2027-02-18', end_time: 1802966399, locked_until: 0
      },
      {
        coupon_id: 334, title: '禮程現金抵用券', amount: 200,
        status: 'expired', site_usable: false, site_block_reason: '此票券已過期',
        category_tid: [], redeem_content: '', usage_rule: '', site_note: '',
        end_date: '2021-05-24', end_time: 1621871999, locked_until: 0
      }
    ];
  }

  /* ---------- 渲染 ---------- */

  function cardHtml(c) {
    var st = STATUS_MAP[c.status] || STATUS_MAP.usable;
    var inactive = (c.status === 'used' || c.status === 'expired');
    var canUse = c.site_usable === true && c.status === 'usable';

    // 動作區:可用→按鈕 / 使用中→倒數 / 其他→不可用原因
    var action;
    if (canUse) {
      action = '<button class="cp-use" data-use="' + c.coupon_id + '">立 即 使 用</button>';
    } else if (c.status === 'locked') {
      action = '<span class="cp-countdown" data-until="' + (c.locked_until || 0) + '">' +
               '<i class="fa-solid fa-hourglass-half"></i>使用中</span>';
    } else if (c.site_block_reason) {
      action = '<span class="cp-blocked"><i class="fa-solid fa-circle-info"></i>' +
               esc(c.site_block_reason) + '</span>';
    } else {
      action = '';
    }

    var desc = c.redeem_content
      ? '<p class="cp-desc">' + esc(c.redeem_content) + '</p>'
      : '';

    var note = c.site_note
      ? '<span><i class="fa-solid fa-circle-exclamation"></i>' + esc(c.site_note) + '</span>'
      : '';

    return '' +
      '<div class="cp-card' + (inactive ? ' is-inactive' : '') + '">' +
        '<div class="cp-amt">' +
          '<span class="cp-amt-num">$' + money(c.amount) + '</span>' +
          '<span class="cp-amt-unit">折抵金額</span>' +
        '</div>' +
        '<div class="cp-body">' +
          '<div class="cp-head">' +
            '<h3 class="cp-title">' + esc(c.title) + '</h3>' +
            '<span class="cp-badge ' + st.cls + '">' +
              '<i class="fa-solid ' + st.icon + '"></i>' + st.label +
            '</span>' +
          '</div>' +
          desc +
          '<div class="cp-meta">' +
            '<span><i class="fa-regular fa-calendar"></i>有效期限 ' +
              esc(c.end_date || fmtDate(c.end_time)) + '</span>' +
            note +
          '</div>' +
          (action ? '<div class="cp-foot"><span></span>' + action + '</div>' : '') +
        '</div>' +
      '</div>';
  }

  function render() {
    var box = document.getElementById('couponList');
    if (!box) return;

    var list = State.coupons;
    if (State.filter !== 'all') {
      list = list.filter(function (c) { return c.status === State.filter; });
    }

    var html = '';

    if (State.isDemo) {
      html += '<div class="md-notice" style="margin-bottom:12px">' +
              '<i class="fa-solid fa-circle-info"></i>' +
              '<div>目前顯示<b>示範資料</b>。票券代理服務(Edge Function)尚未部署,' +
              '接上後會自動改為你的真實票券,畫面不會變動。</div></div>';
    }

    if (!list.length) {
      html += '<p class="empty-text">此分類目前沒有票券。</p>';
    } else {
      html += list.map(cardHtml).join('');
    }

    box.innerHTML = html;
    startCountdown();
  }

  // 使用中票券的倒數
  function startCountdown() {
    if (State.countdownTimer) clearInterval(State.countdownTimer);
    var els = document.querySelectorAll('.cp-countdown[data-until]');
    if (!els.length) return;

    function tick() {
      var now = Math.floor(Date.now() / 1000);
      var alive = 0;
      document.querySelectorAll('.cp-countdown[data-until]').forEach(function (el) {
        var until = Number(el.dataset.until || 0);
        if (!until) return;
        var remain = until - now;
        if (remain > 0) {
          alive++;
          el.innerHTML = '<i class="fa-solid fa-hourglass-half"></i>使用中 · 剩 ' + fmtRemain(remain);
        } else {
          el.innerHTML = '<i class="fa-solid fa-rotate-right"></i>鎖定已釋放,請重新整理';
        }
      });
      if (!alive && State.countdownTimer) {
        clearInterval(State.countdownTimer);
        State.countdownTimer = null;
      }
    }
    tick();
    State.countdownTimer = setInterval(tick, 1000);
  }

  /* ---------- 事件 ---------- */

  function bindOnce() {
    var filters = document.getElementById('cpFilters');
    if (filters && !filters.dataset.bound) {
      filters.dataset.bound = '1';
      filters.addEventListener('click', function (e) {
        var btn = e.target.closest('.cp-filter');
        if (!btn) return;
        filters.querySelectorAll('.cp-filter').forEach(function (b) { b.classList.remove('on'); });
        btn.classList.add('on');
        State.filter = btn.dataset.filter;
        render();
      });
    }

    var list = document.getElementById('couponList');
    if (list && !list.dataset.bound) {
      list.dataset.bound = '1';
      list.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-use]');
        if (!btn) return;
        onUse(Number(btn.dataset.use));
      });
    }
  }

  // 「立即使用」—— 鎖定流程(待 Edge Function 就緒後接上)
  function onUse(couponId) {
    var c = State.coupons.find(function (x) { return x.coupon_id === couponId; });
    if (!c) return;
    // TODO: 接 coupon/lock → 取得 lock_token → 依 category_tid 導向商品挑選
    alert('「' + c.title + '」\n\n折抵金額 $' + money(c.amount) +
          '\n\n鎖定與商品挑選流程尚未開放,待票券代理服務部署後啟用。');
  }

  /* ---------- 對外 ---------- */

  function load(force) {
    var box = document.getElementById('couponList');
    if (!box) return;
    bindOnce();

    if (State.loaded && !force) { render(); return; }

    box.innerHTML = '<p class="empty-text">載入中...</p>';
    fetchCoupons().then(function (list) {
      State.coupons = Array.isArray(list) ? list : [];
      State.loaded = true;
      render();
    });
  }

  window.LohasCoupons = { load: load };

})(window);
