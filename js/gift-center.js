/* =============================================================
   LohasGifts · 禮物中心
   -------------------------------------------------------------
   入口: window.LohasGifts.load()   (由 member-portal.js 於進頁時呼叫)

   依賴:
     window.LohasAuth  (getToken)

   ⚠ 資料來源說明
   gifts 表含收件人姓名/電話/地址與領取碼,RLS 全鎖、anon 讀不到。
   前端一律透過 Edge Function 存取:

       POST {SUPABASE_URL}/functions/v1/gift   { action, token, ... }

   身分由 token 決定,前端傳什麼 erpid 都會被忽略。
   ============================================================= */

(function (window, document) {
  'use strict';

  var Auth = window.LohasAuth;

  var CONFIG = {
    ENDPOINT: 'https://hqdmyxxrskvllkcedybl.supabase.co/functions/v1/gift',
    SHOP_FN:  'https://hqdmyxxrskvllkcedybl.supabase.co/functions/v1/shop',
    TIMEOUT_MS: 12000
  };

  // 狀態 → 文案 / 徽章樣式 / 圖示
  // 送禮與收禮兩側看到的敘述不同,所以分開兩張表
  var SENT_STATUS = {
    pending_payment: { label: '待付款',   cls: 'locked',  icon: 'fa-hourglass-half' },
    paid:            { label: '待領取',   cls: 'usable',  icon: 'fa-gift' },
    claimed:         { label: '已領取',   cls: 'usable',  icon: 'fa-circle-check' },
    issued:          { label: '已發券',   cls: 'usable',  icon: 'fa-ticket' },
    shipped:         { label: '已出貨',   cls: 'usable',  icon: 'fa-truck' },
    redeemed:        { label: '已兌換',   cls: 'usable',  icon: 'fa-store' },
    cancelled:       { label: '已取消',   cls: 'used',    icon: 'fa-ban' },
    expired:         { label: '已過期',   cls: 'expired', icon: 'fa-ban' }
  };
  var RECV_STATUS = {
    paid:      { label: '可領取',   cls: 'usable',  icon: 'fa-gift' },
    claimed:   { label: '已領取',   cls: 'usable',  icon: 'fa-circle-check' },
    issued:    { label: '待到門市', cls: 'usable',  icon: 'fa-ticket' },
    shipped:   { label: '已出貨',   cls: 'usable',  icon: 'fa-truck' },
    redeemed:  { label: '已兌換',   cls: 'usable',  icon: 'fa-store' },
    cancelled: { label: '已取消',   cls: 'used',    icon: 'fa-ban' },
    expired:   { label: '已過期',   cls: 'expired', icon: 'fa-ban' }
  };

  // 履約方式的標示,兩條路使用者看到的東西差很多,要一眼分得出來
  var FULFILL = {
    ship:  { label: '宅配到府',   icon: 'fa-truck-fast' },
    store: { label: '門市兌換',   icon: 'fa-store' }
  };

  var ERR_MSG = {
    '006': '資料不完整,請重新整理後再試',
    '007': '查無此禮物',
    '030': '這份禮物還在準備中',
    '034': '這份禮物已經領取過了',
    '037': '這份禮物無法取消,已付款的請聯繫客服',
    '401': '登入狀態已失效,請重新登入',
    '500': '系統忙碌中,請稍後再試一次'
  };

  var State = {
    sent: [],
    received: [],
    tab: 'received',   // 預設看「我收到的」—— 收禮比送禮更常回訪
    loaded: false,
    error: ''
  };

  /* ---------- 工具 ---------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* 用 LINE 把領取連結傳出去。
     -----------------------------------------------------------------
     用 line.me/R/msg/text/ 而不是官方的 lineit/share ——
     後者【只吃一個網址】,傳出去就是一條孤零零的連結,
     對方看到的是「不明人士傳來一個網址」,多半不敢點。
     這個介面可以帶一整句話,把「誰送的、這是什麼」講完再附連結。

     整段(文字+網址)一起編碼成 path,不是查詢字串 —— 這是
     LINE 這支介面的規定,寫成 ?text= 會變成空白訊息。

     ⚠ 這裡不放收禮人的稱呼。那是送禮人自己寫的備註(「小美」),
     由他本人在 LINE 裡挑對象,訊息開頭再稱呼一次是多餘的,
     而且傳錯人的時候會把備註洩漏給不相干的人。 */
  function lineShareUrl(g) {
    var what = g.product_title || g.design_name || '一份客製刻圖眼鏡';
    var msg = '我送了你一份禮物:' + what + '\n' +
              '點這個連結就能領取 👇\n' + g.claim_url;
    return 'https://line.me/R/msg/text/?' + encodeURIComponent(msg);
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function call(payload) {
    var ctrl = new AbortController();
    var to = setTimeout(function () { ctrl.abort(); }, CONFIG.TIMEOUT_MS);

    // 註:不可加 credentials:'include' —— Edge Function 的 CORS 回應為 '*'
    return fetch(CONFIG.ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    })
      .then(function (r) { clearTimeout(to); return r.json(); })
      .then(function (j) {
        if (String(j.code) !== '200') {
          var e = new Error(ERR_MSG[String(j.code)] || j.message || '操作失敗');
          e.code = String(j.code);
          throw e;
        }
        return j.data || {};
      })
      .catch(function (err) {
        clearTimeout(to);
        if (err.name === 'AbortError') throw new Error('連線逾時,請稍後再試');
        // fetch 本身失敗(服務未上線 / 斷網 / CORS)只會丟出 TypeError,
        // 訊息是英文的 "Failed to fetch",不能直接給使用者看
        if (err instanceof TypeError) throw new Error('目前無法連線到禮物服務,請稍後再試。');
        throw err;
      });
  }

  /* ---------- 渲染 ---------- */

  function thumbHtml(g) {
    // 合成圖優先(看得到刻上去的樣子),其次商品圖、刻圖;
    // 都沒有就給一個禮物圖示佔位。後兩者是合成圖上線前的舊資料退路。
    var img = g.preview_url || g.product_image || g.design_image_url || '';
    if (img) {
      return '<div class="gf-thumb" style="background-image:url(\'' + esc(img) + '\')"></div>';
    }
    return '<div class="gf-thumb gf-thumb--empty"><i class="fa-solid fa-gift"></i></div>';
  }

  function fulfillHtml(g) {
    var f = FULFILL[g.fulfillment] || FULFILL.store;
    return '<span><i class="fa-solid ' + f.icon + '"></i>' + f.label + '</span>';
  }

  function sentCardHtml(g) {
    var st = SENT_STATUS[g.status] || SENT_STATUS.pending_payment;
    var spec = g.product_spec_title ? '（' + g.product_spec_title + '）' : '';
    var title = (g.product_title || g.design_name || '禮物') + spec;

    var to = g.recipient_mode === 'member'
      ? '指定 ' + esc(g.recipient_label || '對方')
      : '連結領取';

    // 待領取 → 給複製按鈕,這是送禮者最需要的動作。
    // 兩種模式都有領取碼(指定沒對上時就靠它),所以不分模式都顯示。
    var actions = '';
    if (g.status === 'paid' && g.claim_url) {
      /* 連結本身也要看得見,不能只給一顆「複製」。
         -----------------------------------------------------------
         送禮人付完款會被導回商城的訂購成功頁,那一頁不會提到領取連結 ——
         他得自己想到回這裡拿。回來之後如果只看到一顆按鈕,
         他無從確認「我複製到的是不是對的東西」,也沒辦法用截圖傳給對方。

         readonly 的 input 而不是純文字:點一下就整串選起來,
         剪貼簿被瀏覽器擋掉時(權限、非 https 的內嵌情境)還有得救。 */
      actions =
        '<button class="gf-btn gf-btn--pri" data-copy="' + esc(g.claim_url) + '">' +
          '<i class="fa-regular fa-copy"></i> 複製領取連結</button>' +
        '<a class="gf-btn gf-btn--line" href="' + esc(lineShareUrl(g)) + '"' +
          ' target="_blank" rel="noopener">' +
          '<i class="fa-brands fa-line"></i> 用 LINE 傳給對方</a>' +
        '<input class="gf-link" type="text" readonly value="' + esc(g.claim_url) + '"' +
          ' onfocus="this.select()" aria-label="領取連結">' +
        '<span class="gf-hint">把這個連結傳給對方,他點開就能領取。' +
          '連結一直有效,關掉視窗也能回這裡再拿一次。</span>';
    } else if (g.status === 'pending_payment') {
      /* 「去付款」不是可有可無的。
         -----------------------------------------------------------
         建立禮物與推進購物車是兩支呼叫,前者成功、後者失敗是常態
         (關掉分頁、網路斷一下、商城暫時拒絕都會)。沒有這顆按鈕的話,
         那份禮物就永遠停在待付款 —— 而他已經填完留言、選完領取方式,
         唯一的出路是取消重做。

         沒有 product_nid 的舊資料不給按:按了也組不出購物車。 */
      actions = '';
      if (g.product_nid) {
        actions +=
          '<button class="gf-btn gf-btn--pri" data-pay="' + esc(g.id) + '">' +
            '<i class="fa-solid fa-cart-shopping"></i> 前往商城付款</button>';
      }
      /* ⚠ 文案刻意保守。
         -----------------------------------------------------------
         我方判斷「付款了沒」的唯一依據是商城的 gift_paid 事件,
         而 2026-08-27 實測發現:用【門市取貨付款】結帳,訂單在商城
         成立了,我方卻收到零個事件 —— 這張卡會一直停在待付款。

         也就是說「已經下過單」與「還沒下單」在我方看起來一模一樣。
         再按一次就是第二張訂單,而我方擋不住。

         2026-08-27 對方已答覆並於當日部署修正:取貨付款那條路會在
         【門市收到錢、後台標記已付款】的那一刻才送事件。
         所以現在講得準了 —— 而且必須講,因為取貨付款佔了商城
         八成的訂單,「下了單但這裡還是待付款」會是常態而不是異常。
         不講的話送禮人會以為壞掉,然後再按一次。 */
      actions +=
        '<span class="gf-hint"><i class="fa-solid fa-circle-info"></i>' +
          '已經在商城下過單的話就不用再按。' +
          '若你選的是<b>門市取貨付款</b>,要等到門市收款後,這裡才會變成「可領取」。</span>' +
        '<button class="gf-btn gf-btn--ghost" data-cancel="' + esc(g.id) + '">取消</button>';
    } else if (['claimed', 'issued', 'shipped', 'redeemed'].indexOf(g.status) >= 0) {
      // 這裡刻意不顯示對方姓名 —— Edge Function 的白名單也不會給,
      // 送禮者只該知道「領了沒」,不該拿到收禮人的個資
      actions = '<span class="gf-hint"><i class="fa-solid fa-circle-check"></i>對方已於 ' +
                fmtDate(g.claimed_at) + ' 領取</span>';
    }

    return '' +
      '<div class="gf-card">' +
        thumbHtml(g) +
        '<div class="gf-body">' +
          '<div class="gf-head">' +
            '<h3 class="gf-title">' + esc(title) + '</h3>' +
            '<span class="cp-badge ' + st.cls + '">' +
              '<i class="fa-solid ' + st.icon + '"></i>' + st.label + '</span>' +
          '</div>' +
          (g.message ? '<p class="gf-msg">「' + esc(g.message) + '」</p>' : '') +
          '<div class="gf-meta">' +
            '<span><i class="fa-regular fa-paper-plane"></i>' + to + '</span>' +
            fulfillHtml(g) +
            '<span><i class="fa-regular fa-calendar"></i>' + fmtDate(g.created_at) + '</span>' +
          '</div>' +
          (actions ? '<div class="gf-foot">' + actions + '</div>' : '') +
        '</div>' +
      '</div>';
  }

  /* 門市兌換的禮物,不論在「等券」或「可兌換」階段,下一步都會走進門市 ——
     所以兩個階段都給一條找門市的路,不必自己回首頁翻。 */
  function storeLinkHtml() {
    return '<a class="gf-hint-link" href="allstore.html">' +
           '<i class="fa-solid fa-location-dot"></i>查看門市據點</a>';
  }

  function recvCardHtml(g) {
    var st = RECV_STATUS[g.status] || RECV_STATUS.paid;
    var spec = g.product_spec_title ? '（' + g.product_spec_title + '）' : '';
    var title = (g.product_title || g.design_name || '禮物') + spec;

    var actions = '';
    if (g.status === 'paid') {
      actions = '<a class="gf-btn gf-btn--pri" href="gift-claim.html?g=' + encodeURIComponent(g.id) + '">' +
                '<i class="fa-solid fa-gift"></i> 領 取 禮 物</a>';
    } else if (g.status === 'claimed' && !g.design_id) {
      /* B 路線:送禮人買的是通用禮物商品,款式由收禮人自己挑。
         design_id 還是空的就代表還沒挑 —— 這是他現在唯一該做的事,
         所以給主要按鈕的外型,不是提示文字。 */
      /* ⚠ 2026-08-27:未綁定的收禮人也能挑,不再分兩條路。
         pick 不呼叫商城(送禮人早就付過款了),而發券本來就支援 mid ——
         先前那道守門的理由寫錯了,把一個不存在的相依當成硬限制。 */
      /* 兩條路並行,由他自己選:
           線上挑 —— 現在就挑好,到店直接配鏡雷刻
           到店挑 —— 什麼都不用做,帶著手機去讓店員協助
         先前是依「有沒有綁定」替他決定走哪一條,那是替客人做選擇;
         而兩條路其實都走得通。 */
      actions =
        '<a class="gf-btn gf-btn--pri" href="design.html?pick=' +
        encodeURIComponent(g.id) + '">' +
        '<i class="fa-solid fa-wand-magic-sparkles"></i> 線 上 挑 選 款 式</a>' +
        '<a class="gf-btn gf-btn--ghost" href="allstore.html">' +
        '<i class="fa-solid fa-location-dot"></i> 到 門 市 挑 選</a>' +
        '<span class="gf-hint">線上挑好可以到店直接配鏡;' +
        '不想現在挑也可以什麼都不做,帶著手機到門市讓店員協助。</span>';

    } else if (g.status === 'claimed') {
      /* 每一種狀態都要回答「所以我現在該做什麼」。
         只寫狀態(例:兌換券準備中)會讓人停在原地不知道下一步 ——
         即使答案是「什麼都不用做」,也要把它說出來,並講清楚接下來會發生什麼。 */
      actions = g.fulfillment === 'ship'
        ? '<span class="gf-hint"><i class="fa-solid fa-box"></i>' +
          '已領取,現在不用做任何事 —— 商品備貨中,出貨後會再通知你。</span>'
        /* 不指向「我的票券」——官網那一頁已整併進本頁。
           ⚠ 這裡原本寫「門市核銷是店員以客編查詢,客人不需要找到券再出示」——
           2026-08-28 查證後那是錯的,核銷要客人用 App 出示條碼。
           不過這一支是「券還沒發出來」的狀態,他現在什麼都不用做,
           所以不在這裡講 App —— 等券發好、狀態變 issued 再講。 */
        : '<span class="gf-hint"><i class="fa-solid fa-hourglass-half"></i>' +
          '已領取,現在不用做任何事 —— 兌換券產生中,好了這裡會變成「可到門市兌換」。</span>' +
          storeLinkHtml();
    } else if (g.status === 'issued') {
      /* ⚠ 2026-08-28:唯一可行的是【App 出示條碼】,與綁不綁定無關。
         -----------------------------------------------------------
         主後端實查(正式站):未過期的票券中心券 327 張,
         門市用客編查得到只有 30 張 —— 9%。三層條件疊在一起:
           · 不需授權的客編查詢只列五類券別,票券中心的券在第六類
           · 需授權的那一種要求「App 點過兌換且在 24 小時內」
           · 未綁定門市的人,券上的客編本來就是空的

         對方這一輪決定【不開】客編查券核銷 —— 那等於移除一道內控
         (門市可在客人不知情下用掉他的折抵券)。所以現況就是:
         門市核銷實質上要求客人裝 App。

         而掃碼完全不碰客編,所以【綁不綁定都一樣】——
         先前寫「綁定後當場就能兌換」是錯的,綁定不會讓他能核銷。

         ⚠ 「到店再點」那一句【不要刪】。
         它原本是為了擋一個 bug:點兌換會把門市可查期限覆蓋成
         24 小時後,375 張券卡在那裡。那個覆蓋 2026-08-28 已由
         主後端修正並上正式站 —— 但這句話仍然成立:
         提早點,那 24 小時的兌換視窗照樣會開始跑,只是不再蓋掉
         更長的期限。「提早點沒有好處」沒有變,變的只是壞處多大。 */
      actions = '<span class="gf-hint"><i class="fa-solid fa-ticket"></i>' +
                '可以兌換了 —— 到任一樂活門市,用【樂活 App】打開這張券、' +
                '點「兌換」出示條碼給店員掃描。' +
                '⚠ 建議到了櫃檯再點,提早點的話有效時間會先開始跑。' +
                '你挑的款式與刻圖店員都查得到,不用帶其他東西。' +
                '</span>' +
                storeLinkHtml();
    } else if (g.status === 'shipped') {
      actions = '<span class="gf-hint"><i class="fa-solid fa-truck"></i>已於 ' +
                fmtDate(g.shipped_at) + ' 出貨</span>';
    } else if (g.status === 'redeemed') {
      actions = '<span class="gf-hint"><i class="fa-solid fa-store"></i>已於 ' +
                fmtDate(g.redeemed_at) + ' 在門市完成兌換</span>';
    }

    return '' +
      '<div class="gf-card">' +
        thumbHtml(g) +
        '<div class="gf-body">' +
          '<div class="gf-head">' +
            '<h3 class="gf-title">' + esc(title) + '</h3>' +
            '<span class="cp-badge ' + st.cls + '">' +
              '<i class="fa-solid ' + st.icon + '"></i>' + st.label + '</span>' +
          '</div>' +
          (g.message ? '<p class="gf-msg">「' + esc(g.message) + '」</p>' : '') +
          '<div class="gf-meta">' +
            '<span><i class="fa-regular fa-user"></i>來自 ' + esc(g.sender_name || '一位朋友') + '</span>' +
            fulfillHtml(g) +
            '<span><i class="fa-regular fa-calendar"></i>' + fmtDate(g.created_at) + '</span>' +
          '</div>' +
          (actions ? '<div class="gf-foot">' + actions + '</div>' : '') +
        '</div>' +
      '</div>';
  }

  function render() {
    var box = document.getElementById('giftList');
    if (!box) return;

    // 分頁計數
    var cs = document.getElementById('gfCountSent');
    var cr = document.getElementById('gfCountRecv');
    if (cs) cs.textContent = State.sent.length;
    if (cr) cr.textContent = State.received.length;

    /* 第三個分頁「我的票券」由 my-coupons.js 負責,兩份清單各自
       一個容器,互相不知道對方的存在 —— 票券的資料來源、錯誤處理
       與空狀態跟禮物完全不同,硬塞進同一個 render 只會兩邊都難改。
       這裡只做一件事:決定誰現身。 */
    var cbox = document.getElementById('couponList');
    var onCoupons = State.tab === 'coupons';
    box.hidden = onCoupons;
    if (cbox) {
      cbox.hidden = !onCoupons;
      if (onCoupons) {
        if (window.LohasCoupons) window.LohasCoupons.load();
        return;                                   // 底下都是禮物的事
      }
      // 離開票券分頁就把倒數停掉,不要讓它在背景空轉
      if (window.LohasCoupons && window.LohasCoupons.stop) window.LohasCoupons.stop();
    }

    if (State.error) {
      box.innerHTML = '<div class="md-notice"><i class="fa-solid fa-circle-exclamation"></i>' +
                      '<div>' + esc(State.error) + '</div></div>';
      return;
    }

    var list = State.tab === 'sent' ? State.sent : State.received;

    if (!list.length) {
      /* 空狀態要給出口,不能只寫「你還沒有送出過禮物」。
         那句話描述了現況卻沒回答「所以我可以做什麼」——
         而這一頁的答案很明確:去挑一張刻圖做成禮物。

         「我收到的」不給按鈕:收禮物不是他能主動做的事,
         給一顆按鈕反而像在說「你可以自己送自己」。 */
      box.innerHTML = State.tab === 'sent'
        ? '<div class="gf-empty">' +
            '<i class="fa-solid fa-gift"></i>' +
            '<p>你還沒有送出過禮物</p>' +
            '<a class="gf-btn gf-btn--pri" href="design.html?gift=1">' +
              '<i class="fa-solid fa-wand-magic-sparkles"></i> 挑 一 張 刻 圖 送 人</a>' +
            '<span class="gf-empty-note">選一副眼鏡、挑一張刻圖,' +
              '或是讓對方自己挑款式。</span>' +
          '</div>'
        : '<div class="gf-empty">' +
            '<i class="fa-regular fa-envelope-open"></i>' +
            '<p>目前沒有收到禮物</p>' +
            '<span class="gf-empty-note">別人送你的禮物會出現在這裡。</span>' +
          '</div>';
      return;
    }

    box.innerHTML = list.map(State.tab === 'sent' ? sentCardHtml : recvCardHtml).join('');
  }

  /* ---------- 事件 ---------- */

  function bindOnce() {
    var tabs = document.getElementById('gfTabs');
    if (tabs && !tabs.dataset.bound) {
      tabs.dataset.bound = '1';
      tabs.addEventListener('click', function (e) {
        var btn = e.target.closest('.cp-filter');
        if (!btn) return;
        tabs.querySelectorAll('.cp-filter').forEach(function (b) { b.classList.remove('on'); });
        btn.classList.add('on');
        State.tab = btn.dataset.tab;
        render();
      });
    }

    var box = document.getElementById('giftList');
    if (box && !box.dataset.bound) {
      box.dataset.bound = '1';
      box.addEventListener('click', function (e) {
        var copyBtn = e.target.closest('[data-copy]');
        if (copyBtn) { onCopy(copyBtn); return; }
        var payBtn = e.target.closest('[data-pay]');
        if (payBtn) { onPay(payBtn); return; }
        var cancelBtn = e.target.closest('[data-cancel]');
        if (cancelBtn) { onCancel(cancelBtn.dataset.cancel); return; }
      });
    }
  }

  function onCopy(btn) {
    var url = btn.dataset.copy;
    var done = function () {
      var old = btn.innerHTML;
      btn.innerHTML = '<i class="fa-solid fa-check"></i> 已複製';
      setTimeout(function () { btn.innerHTML = old; }, 1800);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { window.prompt('複製這個連結:', url); });
    } else {
      window.prompt('複製這個連結:', url);
    }
  }

  /* 把一份待付款的禮物重新推進購物車。
     禮物已經存在,所以只是帶著同一個 gift_id 再推一次 ——
     不會產生第二份禮物。 */
  function onPay(btn) {
    var g = (State.sent || []).filter(function (x) { return String(x.id) === btn.dataset.pay; })[0];
    if (!g) return;

    var token = Auth && Auth.getToken ? Auth.getToken() : '';
    if (!token) { window.alert('登入狀態已失效,請重新登入'); return; }

    var old = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 前往付款…';

    var main = { nid: Number(g.product_nid), amount: 1 };
    if (g.product_sid) main.sid = Number(g.product_sid);

    fetch(CONFIG.SHOP_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'cart_push',
        token: token,
        main: main,
        /* 刻意不帶 design:B 路線本來就沒有,而 A 路線的刻圖資料
           在建立禮物時已經存進 gifts,商城靠 gift_id 對得回去。
           在這裡重建一份 design 只會多一個「兩邊不一致」的來源。 */
        gift: { is_gift: true, gift_id: g.id, fulfillment: g.fulfillment || 'store' }
      })
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var url = j && j.data && j.data.cart_url;
        if (String(j.code) !== '200' || !url) {
          throw new Error(j && j.message ? j.message : '商城未回傳購物車網址');
        }
        // 一次性 token 只有 60 秒,必須整頁導轉
        window.location.href = url;
      })
      .catch(function (e) {
        btn.disabled = false;
        btn.innerHTML = old;
        window.alert('目前無法前往付款:' + e.message);
      });
  }

  function onCancel(giftId) {
    if (!window.confirm('確定要取消這份禮物嗎?取消後就不能再付款了。')) return;
    var token = Auth && Auth.getToken ? Auth.getToken() : '';
    call({ action: 'cancel', token: token, gift_id: giftId })
      .then(function () { load(true); })
      .catch(function (err) { window.alert(err.message); });
  }

  /* ---------- 對外 ---------- */

  function load(force) {
    var box = document.getElementById('giftList');
    if (!box) return;
    bindOnce();

    if (State.loaded && !force) { render(); return; }

    var token = Auth && Auth.getToken ? Auth.getToken() : '';
    if (!token) {
      State.error = '請先重新登入一次,再查看禮物中心。';
      State.loaded = true;
      render();
      return;
    }

    /* 2026-08-20:不再擋未綁定門市的會員。
       gift 函式已改為 erpid 或 mid 皆可,他們領得到禮物、
       也該在這裡看得到自己領了什麼。挑款式那一步才需要客編,
       而那一步的提示寫在禮物卡片上,不是整頁擋掉。 */

    box.innerHTML = '<p class="empty-text">載入中...</p>';
    call({ action: 'list', token: token })
      .then(function (d) {
        State.sent = d.sent || [];
        State.received = d.received || [];
        State.error = '';
        State.loaded = true;
        render();
      })
      .catch(function (err) {
        State.error = err.message;
        State.loaded = true;
        render();
      });
  }

  window.LohasGifts = { load: load };

})(window, document);
