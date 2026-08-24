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

  function render() {
    var r = root(); if (!r) return;

    var sub = document.getElementById('clothSub');
    if (sub) sub.textContent = state.total + ' 件';

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
          '<img class="cloth-thumb" src="' + esc(it.preview_url) + '" alt="" loading="lazy">' +
          '<div class="cloth-info">' +
            '<div class="cloth-row"><b>' + esc(it.design_name || '(未命名)') + '</b>' +
              '<span class="cloth-tag">' + (SOURCE[it.source] || it.source) + '</span>' +
              '<span class="cloth-tag is-' + esc(it.status) + '">' +
                (STATUS[it.status] || it.status) + '</span></div>' +
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
                ? '<button type="button" class="cloth-btn is-done" data-done="' + esc(it.id) + '">' +
                  '<i class="fa-solid fa-check"></i> 標記完成</button>'
                : '') +
            '</div>' +
          '</div>' +
        '</div>';
    }).join('');
  }

  function load() {
    state.loading = true; render();
    return call({ action: 'list', status: state.status, q: state.q, limit: 100 })
      .then(function (d) {
        state.items = d.items || [];
        state.total = d.total || 0;
      })
      .catch(function (e) {
        var list = document.getElementById('clothList');
        if (list) list.innerHTML = '<div class="cloth-empty">載入失敗:' + esc(e.message) + '</div>';
      })
      .finally(function () { state.loading = false; render(); });
  }

  /* ---------- 下載 DXF ---------- */

  function widthMm() {
    var input = document.getElementById('clothWidthMm');
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
        var out = window.LohasDxf.fromSvg(svg, { widthMm: widthMm() });
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
