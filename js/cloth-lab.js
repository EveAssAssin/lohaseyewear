/* =============================================================
   LOHAS · 眼鏡布製作單(簡易後台)
   -------------------------------------------------------------
   給製作端用的一頁。不需要會員帳號、不用進管理後台,
   輸入一次通行碼,那台裝置就記住。

   === 為什麼不是完全開放 ===
   這一頁列的是客人的作品與檔案。完全不設防的話,網址一旦被轉貼
   或被搜尋引擎收錄,誰都看得到 —— 這與註冊入口當初的顧慮相同:
   「只拿掉連結擋不住任何人」。
   通行碼不是強認證,但它讓「知道網址」與「進得去」分開。

   資料一律經 cloth-admin Edge Function(它比對通行碼)。
   通行碼進來時對方不會回傳姓名 —— 製作端要的是「刻什麼、刻在哪」,
   不是「誰」。

   依賴:LohasDxf
   ============================================================= */

(function (window, document) {
  'use strict';

  var CONFIG = {
    FN: 'https://hqdmyxxrskvllkcedybl.supabase.co/functions/v1/cloth-admin',
    CODE_KEY: 'lohasClothLabCode'
  };

  /* area:'' = 全部,north = 台中以北,south = 台南以南,other = 其他
     ⚠ 記在 localStorage —— 兩個製作端各自固定看自己那一區,
     每次進來都要重選一次是每天都會重複的摩擦。 */
  var State = { code: '', status: 'new', area: '', items: [], total: 0, busy: false };
  var el = {};

  /* ---------- 工具 ---------- */

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function show(n) { if (n) n.hidden = false; }
  function hide(n) { if (n) n.hidden = true; }

  function call(payload) {
    return fetch(CONFIG.FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ code: State.code }, payload))
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (String(j.code) !== '200') {
          var e = new Error(j.message || '操作失敗');
          e.code = String(j.code);
          throw e;
        }
        return j.data || {};
      });
  }

  function fmtTime(s) {
    if (!s) return '';
    var d = new Date(s);
    if (isNaN(d)) return '';
    var p = function (n) { return String(n).padStart(2, '0'); };
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  var SOURCE = { market: '刻圖市集', draw: '手繪' };
  var STATUS = { new: '待製作', done: '已完成', archived: '已封存' };

  /* 產線分流:客人選的取貨門市在哪一區,這件就歸哪一條線。
     -----------------------------------------------------------------
     值是門市資料的 city 欄位原文(北區、台中區一、台南區…),
     與 js/store-data.js 的 REGION_MAP 同一組字串。

     ⚠ 兩張表要一起改。哪天總部新增一個區(例如「宜蘭區」),
     這裡沒跟上的話,那一區的件會安靜地掉進「其他」——
     不會報錯,只會有人某天問「怎麼一直沒收到宜蘭的布」。
     所以「其他」那一格永遠存在,而且有東西時會自己冒出來。 */
  var AREA_OF = {
    '北區': 'north', '新竹區': 'north', '台中區一': 'north', '台中區二': 'north',
    '台南區': 'south', '高雄區一': 'south', '高雄區二': 'south'
  };
  var AREA_LABEL = { north: '台中以北', south: '台南以南', other: '其他' };

  function areaOf(it) {
    return AREA_OF[String(it && it.store_city || '')] || 'other';
  }

  /* 取貨門市那一行。
     沒選的要明確講出來,而且要顯眼 —— 那件東西做好之後
     沒有人知道要送去哪,是要有人處理的,不是可以略過的空白。 */
  function storeHtml(it) {
    if (it.store_name) {
      return '<span class="lab-store"><i class="fa-solid fa-location-dot"></i>' +
             esc(it.store_name) + '</span>';
    }
    return '<span class="lab-store is-none"><i class="fa-solid fa-circle-question"></i>' +
           '未指定取貨門市</span>';
  }

  /* 座標翻成人看得懂的話。
     製作的人不需要知道 x=0.65,他需要知道「偏右下、約布寬的 22%」。 */
  function placeText(p) {
    if (!p) return '—';
    var h = Number(p.x) < 0.4 ? '偏左' : Number(p.x) > 0.6 ? '偏右' : '置中';
    var v = Number(p.y) < 0.4 ? '偏上' : Number(p.y) > 0.6 ? '偏下' : '置中';
    var t = h + v + ',寬約布的 ' + Math.round(Number(p.scale || 0) * 100) + '%';

    /* 有轉過就要寫出來,而且要顯眼。
       DXF 已經幫他轉好了,但製作的人手上還有合成圖與實體布 ——
       不講的話他會以為是圖檔歪了,然後「好心」把它轉回正的。 */
    var rot = Math.round(Number(p.rot) || 0);
    if (rot) t += '　·　⟳ 順時針轉 ' + rot + '°(DXF 已含旋轉)';
    return t;
  }

  /* 縮圖走 Supabase 的圖片縮放,不要載原圖 ——
     製作端常常在手機或工廠的網路下開這一頁。 */
  function thumbUrl(u) {
    if (!u || u.indexOf('/storage/v1/object/public/') < 0) return u;
    /* ⚠ width、height、resize 三個都要給。
       只給 width 的話 Supabase【不會等比縮放】—— 實測 926x926 的圖
       只給 width=320 會回 320x926,變成一條窄長的東西。
       resize=contain 才會把整張圖放進指定的方框裡。 */
    return u.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') +
           '?width=320&height=320&resize=contain&quality=70';
  }

  /* ---------- 呈現 ---------- */

  function cardHtml(it) {
    var who = it.erpid ? '會員 ' + esc(it.erpid) : '（官網註冊會員）';
    return '' +
      '<div class="lab-card">' +
        '<img class="lab-thumb" src="' + esc(thumbUrl(it.preview_url)) + '"' +
          ' data-full="' + esc(it.preview_url) + '" alt="" loading="lazy">' +
        '<div class="lab-info">' +
          '<div class="lab-row">' +
            '<span class="lab-name">' + esc(it.design_name || '(未命名)') + '</span>' +
            '<span class="lab-tag">' + (SOURCE[it.source] || esc(it.source)) + '</span>' +
            '<span class="lab-tag' + (it.status === 'done' ? ' is-done' : '') + '">' +
              (STATUS[it.status] || esc(it.status)) + '</span>' +
            /* 尺寸每張卡各自一個,不是全域設定 ——
               製作的人一次處理一件,全域的話得每下載一次改一次。 */
            '<label class="lab-size" title="這一件的 DXF 會依這個尺寸輸出">' +
              '<span>模擬刻在</span>' +
              '<input type="number" data-w="' + esc(it.id) + '" value="150" ' +
                'min="20" max="600" step="1">' +
              '<em>mm 的眼鏡布</em>' +
            '</label>' +
          '</div>' +
          '<div class="lab-meta">位置:<b>' + esc(placeText(it.placement)) + '</b></div>' +
          '<div class="lab-meta">' + who + '　·　' + esc(fmtTime(it.created_at)) + '</div>' +
          '<div>' + storeHtml(it) + '</div>' +
          '<div class="lab-btns">' +
            '<a class="lab-file" href="' + esc(it.svg_url) + '" download>' +
              '<i class="fa-solid fa-file-arrow-down"></i>SVG</a>' +
            '<button type="button" class="lab-file" data-dxf="' + esc(it.id) + '">' +
              '<i class="fa-solid fa-vector-square"></i>DXF</button>' +
            '<a class="lab-file" href="' + esc(it.preview_url) + '" target="_blank" rel="noopener">' +
              '<i class="fa-solid fa-eye"></i>看大圖</a>' +
            (it.status === 'new'
              ? '<span class="lab-done-wrap"><button type="button" class="lab-done" data-done="' +
                esc(it.id) + '">完 成 製 作</button></span>'
              : '') +
          '</div>' +
        '</div>' +
      '</div>';
  }

  /* 依區域篩,並把件數標在分頁上。
     -----------------------------------------------------------------
     篩在前端做:清單本來就一次抓 100 筆,再為了分區多打一次
     沒有意義,而且切分頁會變成每次都要等網路。 */
  function visibleItems() {
    if (!State.area) return State.items;
    return State.items.filter(function (it) { return areaOf(it) === State.area; });
  }

  function renderAreaTabs() {
    if (!el.area) return;
    var counts = { '': State.items.length, north: 0, south: 0, other: 0 };
    State.items.forEach(function (it) { counts[areaOf(it)]++; });

    el.area.querySelectorAll('.lab-seg-btn').forEach(function (b) {
      var k = b.dataset.a;
      var n = counts[k] || 0;
      b.querySelector('em[data-n]').textContent = n ? n : '';
      b.classList.toggle('on', k === State.area);
      /* 「其他」平時藏著,有東西才出現 —— 但【正在看它的時候不能藏】,
         否則按下去之後那顆鈕自己消失,人會以為畫面壞了。 */
      if (k === 'other') b.hidden = !n && State.area !== 'other';
    });
  }

  function render() {
    renderAreaTabs();
    var items = visibleItems();

    if (!items.length) {
      el.list.innerHTML = '<div class="lab-empty">' +
        (State.area ? AREA_LABEL[State.area] + '目前沒有' : '目前沒有') +
        (STATUS[State.status] || '') + '的項目</div>';
      return;
    }
    el.list.innerHTML = items.map(cardHtml).join('');

    /* ⚠ 一次只抓 100 筆。超過的要講出來,不能安靜地少給 ——
       製作端看到清單見底會當成「做完了」,而那時候還有東西沒列出來。 */
    if (State.total > State.items.length) {
      el.list.innerHTML +=
        '<div class="lab-empty">還有 ' + (State.total - State.items.length) +
        ' 件沒有列出來(一次最多 100 件)。做完上面這些再重新整理就會出現。</div>';
    }

    // 縮放版取不到時退回原圖(用事件,不用內聯 onerror)
    el.list.querySelectorAll('.lab-thumb[data-full]').forEach(function (img) {
      img.addEventListener('error', function back() {
        img.removeEventListener('error', back);
        img.src = img.dataset.full;
      });
    });
  }

  function load() {
    hide(el.msg);
    el.list.innerHTML = '<div class="lab-empty">載入中…</div>';
    return call({ action: 'list', status: State.status, limit: 100 })
      .then(function (d) {
        State.items = d.items || [];
        State.total = Number(d.total || State.items.length);
        render();
      })
      .catch(function (e) {
        /* 通行碼被換掉時要退回輸入畫面,不要留在一個永遠載不出東西的列表。 */
        if (e.code === '403') { forget(); return; }
        el.list.innerHTML = '';
        el.msg.textContent = '載入失敗:' + e.message;
        el.msg.className = 'lab-msg is-err';
        show(el.msg);
      });
  }

  /* ---------- DXF ---------- */

  function widthMm(id) {
    var input = el.list.querySelector('[data-w="' + id + '"]');
    var v = Number(input && input.value);
    return Number.isFinite(v) && v > 0 ? v : 150;
  }

  function downloadDxf(id, btn) {
    var it = State.items.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!it || !window.LohasDxf) return;

    var label = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = '轉換中…';

    fetch(it.svg_url)
      .then(function (r) {
        if (!r.ok) throw new Error('線稿檔取不到(' + r.status + ')');
        return r.text();
      })
      .then(function (svg) {
        /* ⚠ 旋轉一定要一起帶。客人在眼鏡布那一頁把圖轉了幾度,
           這裡不帶的話輸出的是【正的】—— 而那要等成品送到他手上
           才會被發現。 */
        var out = window.LohasDxf.fromSvg(svg, {
          widthMm: widthMm(it.id),
          rotateDeg: Number(it.placement && it.placement.rot) || 0,
        });
        var name = (it.design_name || 'cloth').replace(/[^\w一-龥-]/g, '_');
        var blob = new Blob([out.dxf], { type: 'application/dxf' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = name + '-' + String(it.id).slice(0, 8) + '.dxf';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      })
      .catch(function (e) { alert('轉換失敗:' + e.message); })
      .finally(function () { btn.disabled = false; btn.innerHTML = label; });
  }

  /* ---------- 通行碼 ---------- */

  function enter() {
    var code = (el.code.value || '').trim();
    if (!code) { el.code.focus(); return; }
    if (State.busy) return;

    State.busy = true;
    el.enter.disabled = true;
    el.enter.textContent = '檢 查 中';
    hide(el.gateErr);

    State.code = code;
    call({ action: 'list', status: 'new', limit: 1 })
      .then(function () {
        try { localStorage.setItem(CONFIG.CODE_KEY, code); } catch (e) {}
        openList();
      })
      .catch(function (e) {
        State.code = '';
        el.gateErr.textContent = e.message;
        show(el.gateErr);
      })
      .finally(function () {
        State.busy = false;
        el.enter.disabled = false;
        el.enter.textContent = '進 入';
      });
  }

  function openList() {
    hide(el.gate);
    show(el.body);
    show(el.out);
    load();
  }

  function forget() {
    try { localStorage.removeItem(CONFIG.CODE_KEY); } catch (e) {}
    State.code = '';
    State.items = [];
    hide(el.body);
    hide(el.out);
    show(el.gate);
    el.code.value = '';
    el.gateErr.textContent = '通行碼已失效,請重新輸入。';
    show(el.gateErr);
  }

  /* ---------- 啟動 ---------- */

  function init() {
    el = {
      gate: $('labGate'), code: $('labCode'), enter: $('labEnter'), gateErr: $('labGateErr'),
      body: $('labBody'), status: $('labStatus'), area: $('labArea'),
      msg: $('labMsg'), list: $('labList'), out: $('labOut')
    };
    if (!el.gate) return;

    el.enter.addEventListener('click', enter);
    el.code.addEventListener('keydown', function (e) { if (e.key === 'Enter') enter(); });
    el.out.addEventListener('click', forget);

    el.status.addEventListener('click', function (e) {
      var b = e.target.closest('.lab-seg-btn');
      if (!b) return;
      el.status.querySelectorAll('.lab-seg-btn').forEach(function (x) {
        x.classList.toggle('on', x === b);
      });
      State.status = b.dataset.s;
      load();
    });

    /* 換區域【不重新載入】—— 資料同一批,只是換一個看法。
       打一次網路只為了篩掉幾張卡,在工廠的網路下是白等。 */
    if (el.area) {
      el.area.addEventListener('click', function (e) {
        var b = e.target.closest('.lab-seg-btn');
        if (!b) return;
        State.area = b.dataset.a || '';
        try { localStorage.setItem('lohas_lab_area', State.area); } catch (err) { /* 無痕 */ }
        render();
      });
      try {
        var saved = localStorage.getItem('lohas_lab_area');
        if (saved && AREA_LABEL[saved] !== undefined || saved === '') State.area = saved || '';
      } catch (err) { /* 無痕 */ }
    }

    el.list.addEventListener('click', function (e) {
      var dxf = e.target.closest('[data-dxf]');
      if (dxf) { downloadDxf(dxf.dataset.dxf, dxf); return; }

      var done = e.target.closest('[data-done]');
      if (done) {
        done.disabled = true;
        call({ action: 'set_status', id: done.dataset.done, status: 'done' })
          .then(load)
          .catch(function (err) { alert(err.message); done.disabled = false; });
      }
    });

    // 這台裝置記過通行碼就直接進去
    var saved = '';
    try { saved = localStorage.getItem(CONFIG.CODE_KEY) || ''; } catch (e) {}
    if (saved) { State.code = saved; openList(); }
    else el.code.focus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window, document);
