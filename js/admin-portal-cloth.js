/* ============================================================
   樂活管理後台 · 客製眼鏡布 (cloth)
   ------------------------------------------------------------
   列出客人在官網做好的眼鏡布設計,下載製作用的檔案。

   === 為什麼不直接查資料表 ===
   cloth_designs 是 RLS 全鎖零政策,後台用的也是公開的 anon key,
   讀不到。一律經 cloth-admin Edge Function ——
   那支會驗 session token 並確認呼叫者在 admins 表裡。

   === DXF 在瀏覽器即時轉,不另存一份 ===
   存兩份檔案就會有「哪一份才是最新」的問題,而且成品尺寸日後
   可能會改(換一種布)。從 SVG 當場轉,尺寸永遠是按下載當下設定的那個。
   ============================================================ */
(function () {
  'use strict';

  var FN = 'https://hqdmyxxrskvllkcedybl.supabase.co/functions/v1/cloth-admin';

  var state = { items: [], total: 0, loading: false, status: 'new', q: '' };

  function root() {
    return document.querySelector('.content-page[data-page="cloth"]');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function token() {
    return (window.LohasAuth && window.LohasAuth.getToken && window.LohasAuth.getToken()) || '';
  }

  function call(payload) {
    return fetch(FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ token: token() }, payload))
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (String(j.code) !== '200') throw new Error(j.message || '操作失敗');
        return j.data || {};
      });
  }

  function fmtTime(s) {
    if (!s) return '';
    var d = new Date(s);
    if (isNaN(d)) return '';
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate()) +
           ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* 縮圖走 Supabase 的圖片縮放,不要直接載原圖。
     -----------------------------------------------------------
     原圖是合成圖(整張眼鏡布),而這裡只用 120px 顯示。
     一列載一張全尺寸的圖,列表一多就會很慢 ——
     實測同一張圖 15.8KB → 1.5KB,差十倍。

     這也順便救了舊資料:早期存的是 PNG(更肥),不必重存也會變快。
     縮放失敗時 onerror 會退回原圖,不會變成破圖。 */
  function thumbUrl(u) {
    if (!u || u.indexOf('/storage/v1/object/public/') < 0) return u;
    /* ⚠ width、height、resize 三個都要給。
       只給 width 的話 Supabase【不會等比縮放】—— 實測 926x926 的圖
       只給 width=320 會回 320x926,變成一條窄長的東西。
       resize=contain 才會把整張圖放進指定的方框裡。 */
    return u.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') +
           '?width=240&height=240&resize=contain&quality=70';
  }

  var SOURCE = { market: '刻圖市集', draw: '手繪' };
  var STATUS = { new: '待處理', done: '已完成', archived: '已封存' };

  /* 座標翻成人看得懂的話。
     後台的人不需要知道 x=0.65,他需要知道「偏右下、約布寬的 22%」。 */
  function placeText(p) {
    if (!p) return '—';
    var h = Number(p.x) < 0.4 ? '偏左' : Number(p.x) > 0.6 ? '偏右' : '置中';
    var v = Number(p.y) < 0.4 ? '偏上' : Number(p.y) > 0.6 ? '偏下' : '置中';
    return h + v + ',寬約布的 ' + Math.round(Number(p.scale || 0) * 100) + '%';
  }

  /* 對方的排程有沒有停掉。
     -----------------------------------------------------------
     眼鏡布做好之後通知客人那條線,靠對方每天 10:30 來抓 cloth-feed。
     那支排程與其他 28 支共用同一個 Jenkins 觸發器,而那台不在對方
     控制之下 —— 停掉的話全部一起【安靜地死,不報錯】。

     後果:客人的眼鏡布做好了卻永遠收不到通知,
     而製作端、官網、App 三邊各自看都正常。

     所以這裡要偵測的不是「設定對不對」,是「有沒有東西在動」。

     ⚠ 刻意不做郵件或推播:那需要另一支排程,而排程正是這裡
     不能信任的東西 —— 用一個可能一起死掉的機制去監控它沒有意義。
     這一頁後台天天有人開,看得到就夠了。 */
  var STALE_HOURS = 36;   // 每日一次,留一天半的餘裕

  function renderHeartbeat() {
    var box = document.getElementById('clothHeartbeat');
    if (!box) return;
    var hb = state.heartbeat;
    if (!hb || !hb.last_fetch_at) { box.style.display = 'none'; return; }

    var hours = (Date.now() - new Date(hb.last_fetch_at).getTime()) / 3600000;
    if (!isFinite(hours)) { box.style.display = 'none'; return; }

    /* ⚠ 建表時那一列是我方自己塞的(預設 now()),不是真的被抓過。
       last_status 只有【真實抓取】才會有值 —— 沒有值就不要宣稱
       「App 上次來抓是 0 小時前」,那是一句假話,而且會讓人以為
       串接已經在跑了。

       逾時的判斷照樣從那個時間算起:塞進去的時間等於給了 36 小時
       的寬限期,若期限內都沒有人來抓,一樣會變成紅字。 */
    if (!hb.last_status) {
      box.className = 'cloth-hb';
      box.innerHTML = '<i class="fa-regular fa-clock"></i> ' +
        '尚未收到 App 的抓取紀錄(等待第一次每日 10:30 的抓取)。';
      if (hours >= STALE_HOURS) {
        box.className = 'cloth-hb is-stale';
        box.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> ' +
          '<b>建立監控後已經 ' + esc(fmtDur(hours)) + ',App 一次都沒有來抓過。</b>' +
          '請確認對方的每日排程有沒有接上。';
      }
      box.style.display = '';
      return;
    }

    if (hours < STALE_HOURS) {
      // 正常時不佔版面,只留一行小字說明「這件事有人在看」
      box.className = 'cloth-hb';
      box.innerHTML = '<i class="fa-regular fa-circle-check"></i> App 上次來抓紀錄:' +
        esc(fmtAgo(hours)) + '(每日 10:30)';
    } else {
      box.className = 'cloth-hb is-stale';
      box.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> ' +
        '<b>App 已經 ' + esc(fmtDur(hours)) + '沒有來抓紀錄了。</b>' +
        '客人的眼鏡布做好之後可能收不到通知 —— ' +
        '這通常代表對方那組每日排程停了,請通知主後端確認。';
    }
    box.style.display = '';
  }

  /* 兩種說法不能共用一個函式:
       fmtAgo 回的是【時間點】 ——「2 天前」
       fmtDur 回的是【時間長度】——「2 天」
     警示那句是「已經 X 沒有來抓了」,套時間點會變成
     「已經 2 天前沒有來抓紀錄了」,讀起來不通。 */
  function fmtAgo(hours) {
    if (hours < 1) return Math.round(hours * 60) + ' 分鐘前';
    if (hours < 48) return Math.round(hours) + ' 小時前';
    return Math.round(hours / 24) + ' 天前';
  }

  function fmtDur(hours) {
    if (hours < 48) return Math.round(hours) + ' 小時';
    return Math.round(hours / 24) + ' 天';
  }

  function render() {
    var r = root(); if (!r) return;

    var sub = document.getElementById('clothSub');
    if (sub) sub.textContent = state.total + ' 件';

    renderHeartbeat();

    var list = document.getElementById('clothList');
    if (!list) return;

    if (state.loading && !state.items.length) {
      list.innerHTML = '<div class="cloth-loading">載入中…</div>';
      return;
    }
    if (!state.items.length) {
      list.innerHTML = '<div class="cloth-empty">' +
        (state.q ? '找不到符合「' + esc(state.q) + '」的設計'
                 : '目前沒有' + (STATUS[state.status] || '') + '的設計') + '</div>';
      return;
    }

    list.innerHTML = state.items.map(function (it) {
      var who = it.member_name
        ? esc(it.member_name) + (it.erpid ? '(' + esc(it.erpid) + ')' : '')
        : (it.erpid ? esc(it.erpid) : (it.mid ? 'App 會員 ' + esc(it.mid) : '—'));

      return '' +
        '<div class="cloth-card" data-id="' + esc(it.id) + '">' +
          '<img class="cloth-thumb" src="' + esc(thumbUrl(it.preview_url)) + '"' +
            ' data-full="' + esc(it.preview_url) + '" alt="" loading="lazy">' +
          '<div class="cloth-info">' +
            '<div class="cloth-row"><b>' + esc(it.design_name || '(未命名)') + '</b>' +
              '<span class="cloth-tag">' + (SOURCE[it.source] || it.source) + '</span>' +
              '<span class="cloth-tag is-' + esc(it.status) + '">' +
                (STATUS[it.status] || it.status) + '</span>' +
              /* 尺寸每張卡各自一個,不是全域設定。
                 製作的人一次處理一件,而日後不同款布尺寸不同時,
                 全域設定就得每下載一次改一次,很容易改了忘了改回來。 */
              '<label class="cloth-size-in" title="這一件的 DXF 會依這個尺寸輸出">' +
                '<span>模擬刻在</span>' +
                '<input type="number" data-w="' + esc(it.id) + '" value="150" ' +
                  'min="20" max="600" step="1">' +
                '<em>mm 的眼鏡布</em>' +
              '</label>' +
            '</div>' +
            '<div class="cloth-meta">' + who + '　·　' + fmtTime(it.created_at) + '</div>' +
            '<div class="cloth-meta">位置:' + esc(placeText(it.placement)) + '</div>' +
            '<div class="cloth-btns">' +
              '<a class="cloth-btn" href="' + esc(it.svg_url) + '" download>' +
                '<i class="fa-solid fa-file-arrow-down"></i> SVG</a>' +
              '<button type="button" class="cloth-btn" data-dxf="' + esc(it.id) + '">' +
                '<i class="fa-solid fa-vector-square"></i> DXF</button>' +
              '<a class="cloth-btn" href="' + esc(it.preview_url) + '" target="_blank" rel="noopener">' +
                '<i class="fa-solid fa-eye"></i> 合成圖</a>' +
              (it.status === 'new'
                ? '<span class="cloth-done-wrap">' +
                  '<button type="button" class="cloth-done" data-done="' + esc(it.id) + '">' +
                  '完 成 製 作</button></span>'
                : '') +
            '</div>' +
          '</div>' +
        '</div>';
    }).join('');

    /* 縮放版取不到時退回原圖。
       用事件而不是內聯 onerror —— 內聯的引號要在字串串接裡跳脫,
       改一次就壞一次(這一行就被我改壞過)。 */
    list.querySelectorAll('.cloth-thumb[data-full]').forEach(function (img) {
      img.addEventListener('error', function fallback() {
        img.removeEventListener('error', fallback);
        img.src = img.dataset.full;
      });
    });
  }

  function load() {
    state.loading = true; render();
    return call({ action: 'list', status: state.status, q: state.q, limit: 100 })
      .then(function (d) {
        state.items = d.items || [];
        state.total = d.total || 0;
        state.heartbeat = d.heartbeat || null;
      })
      .catch(function (e) {
        var list = document.getElementById('clothList');
        if (list) list.innerHTML = '<div class="cloth-empty">載入失敗:' + esc(e.message) + '</div>';
      })
      .finally(function () { state.loading = false; render(); });
  }

  /* ---------- 下載 DXF ---------- */

  function widthMm(id) {
    var input = document.querySelector('[data-w="' + id + '"]');
    var v = Number(input && input.value);
    return Number.isFinite(v) && v > 0 ? v : 150;
  }

  function saveText(text, filename) {
    var blob = new Blob([text], { type: 'application/dxf' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    // 立刻 revoke 在部分瀏覽器會讓下載中斷,延後放掉
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function downloadDxf(id, btn) {
    var it = state.items.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!it) return;
    if (!window.LohasDxf) { alert('DXF 轉換工具沒有載入'); return; }

    var label = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = '轉換中…';

    /* SVG 在 Supabase Storage,跨網域取回。那個 bucket 是公開讀取,
       所以 fetch 拿得到;拿不到時多半是檔案被刪了,講清楚比丟一個
       CORS 錯誤給後台的人看有用。 */
    fetch(it.svg_url)
      .then(function (r) {
        if (!r.ok) throw new Error('線稿檔取不到(' + r.status + ')');
        return r.text();
      })
      .then(function (svg) {
        var out = window.LohasDxf.fromSvg(svg, { widthMm: widthMm(it.id) });
        var name = (it.design_name || 'cloth').replace(/[^\w一-龥-]/g, '_');
        saveText(out.dxf, name + '-' + String(it.id).slice(0, 8) + '.dxf');
        console.log('[cloth] DXF ' + out.paths + ' 條路徑,' +
          out.widthMm.toFixed(1) + ' × ' + out.heightMm.toFixed(1) + ' mm');
      })
      .catch(function (e) { alert('轉換失敗:' + e.message); })
      .finally(function () { btn.disabled = false; btn.innerHTML = label; });
  }

  /* ---------- 事件 ---------- */

  function bind() {
    var r = root(); if (!r || r.dataset.bound) return;
    r.dataset.bound = '1';

    r.addEventListener('click', function (e) {
      var dxf = e.target.closest('[data-dxf]');
      if (dxf) { downloadDxf(dxf.dataset.dxf, dxf); return; }

      var done = e.target.closest('[data-done]');
      if (done) {
        done.disabled = true;
        call({ action: 'set_status', id: done.dataset.done, status: 'done' })
          .then(load)
          .catch(function (err) { alert(err.message); done.disabled = false; });
        return;
      }
    });

    var sel = document.getElementById('clothStatus');
    if (sel) sel.addEventListener('change', function () {
      state.status = this.value; state.items = []; load();
    });

    /* 搜尋不要每打一個字就打一次 API ——
       打「28095839」會送出八次請求,而只有最後一次的結果有意義。 */
    var search = document.getElementById('clothSearch');
    if (search) {
      var timer = 0;
      search.addEventListener('input', function () {
        var v = this.value;
        clearTimeout(timer);
        timer = setTimeout(function () {
          state.q = v.trim(); state.items = []; load();
        }, 350);
      });
    }
  }

  function init() {
    if (!root()) return;
    bind();
    load();
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.nav-link[data-page="cloth"], .drawer-item[data-page="cloth"]');
    if (!btn) return;
    setTimeout(init, 50);
  });

  window.LohasAdminCloth = { init: init, load: load };
})();
