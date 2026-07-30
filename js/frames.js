/* ============================================================
   frames.js — 鏡框百科 首頁
   依賴：frames-data.js
   ------------------------------------------------------------
   結構：Hero → 三入口引導卡 → Sidebar(搜尋 + 動態篩選) + 卡片牆
   ------------------------------------------------------------
   三入口（看分類／看臉型／看材質）點擊後，
   Sidebar 第二區的清單內容隨之切換，兩者為連動關係。
   點任一卡片 → /frame.html?f={新代碼}
   ============================================================ */
(function () {
  'use strict';

  var state = { mode: 'category', key: 'mat', q: '' };

  /* Sidebar 第二區標題（隨模式切換） */
  var RAIL_TITLES = {
    category: '框 型 分 類',
    face:     '臉 型',
    material: '材 質'
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function icon(key, w, h) {
    return '<svg viewBox="0 0 64 42" width="' + w + '" height="' + h +
      '" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      (FRAME_ICONS[key] || FRAME_ICONS.square) + '</svg>';
  }

  function options() {
    if (state.mode === 'face')     return FRAME_FACE_FILTERS;
    if (state.mode === 'material') return FRAME_MATERIAL_FILTERS;
    return FRAME_GROUPS;
  }

  /* 搜尋比對：名稱、英文、說明、標籤 */
  function hitSearch(it) {
    if (!state.q) return true;
    var q = state.q.toLowerCase();
    return [it.name, it.en, it.desc, it.tag, it.code].some(function (v) {
      return v && String(v).toLowerCase().indexOf(q) > -1;
    });
  }

  function filtered() {
    return FRAME_ITEMS.filter(function (it) {
      return frameMatches(it, state.mode, state.key) && hitSearch(it);
    });
  }

  function currentLabel() {
    var o = options().filter(function (x) { return x.key === state.key; })[0];
    return o ? o.label : '全部框型';
  }

  /* ---------- 渲染：三入口卡 ---------- */
  function renderEntries() {
    document.getElementById('frEntries').innerHTML = FRAME_ENTRIES.map(function (e) {
      return '<button type="button" class="fr-entry-card' +
        (e.key === state.mode ? ' is-active' : '') + '" data-mode="' + e.key + '">' +
        '<i class="' + e.icon + '" aria-hidden="true"></i>' +
        '<span class="fr-entry-label">' + esc(e.label) + '</span>' +
        '<span class="fr-entry-sub">' + esc(e.hint) + '</span>' +
        '</button>';
    }).join('');
  }

  /* ---------- 渲染：Sidebar 篩選清單 ---------- */
  function railIcon(o) {
    // 臉型：手繪插畫圖檔（PNG 去背）；分類與材質：Font Awesome
    if (state.mode === 'face' && o.shape && typeof FACE_IMG_BASE !== 'undefined') {
      return '<img class="fr-rail-face" src="' + FACE_IMG_BASE + o.shape + '.png" ' +
        'alt="" width="26" height="26" loading="lazy">';
    }
    return o.icon ? '<i class="' + o.icon + ' fr-rail-fa" aria-hidden="true"></i>' : '';
  }

  function renderRail() {
    document.getElementById('frRailTitle').textContent = RAIL_TITLES[state.mode] || '';
    document.getElementById('frRail').innerHTML = options().map(function (o) {
      var n = FRAME_ITEMS.filter(function (it) {
        return frameMatches(it, state.mode, o.key) && hitSearch(it);
      }).length;
      return '<button type="button" class="fr-rail-btn' +
        (o.key === state.key ? ' is-active' : '') + '" data-key="' + o.key + '">' +
        railIcon(o) +
        '<span class="fr-rail-label">' + esc(o.label) + '</span>' +
        '<span class="fr-rail-n">' + n + '</span>' +
        '</button>';
    }).join('');
  }

  /* ---------- 渲染：卡片牆 ---------- */
  function renderWall() {
    var list = filtered();
    document.getElementById('frBlockTitle').textContent =
      state.q ? '搜尋「' + state.q + '」' : currentLabel();
    document.getElementById('frCount').textContent = list.length + ' 種';

    if (!list.length) {
      document.getElementById('frWall').innerHTML =
        '<p class="fr-empty">找不到符合的框型，換個條件或關鍵字看看。</p>';
      return;
    }

    document.getElementById('frWall').innerHTML = list.map(function (it) {
      return '<a class="fr-card" href="/frame.html?f=' + encodeURIComponent(it.code) + '">' +
        '<span class="fr-card-visual">' +
          (it.tag ? '<span class="fr-card-badge">' + esc(it.tag) + '</span>' : '') +
          icon(it.icon, 56, 37) +
        '</span>' +
        '<span class="fr-card-body">' +
          '<span class="fr-card-name">' + esc(it.name) + '</span>' +
          '<span class="fr-card-desc">' + esc(it.desc) + '</span>' +
        '</span></a>';
    }).join('');
  }

  function render() { renderEntries(); renderRail(); renderWall(); }

  /* ---------- 事件 ---------- */
  function bind() {
    document.getElementById('frEntries').addEventListener('click', function (e) {
      var b = e.target.closest('.fr-entry-card'); if (!b) return;
      state.mode = b.dataset.mode;
      state.key = options()[0].key;      // 切換模式後預設選第一個條件
      render();
      document.getElementById('frBody')
        .scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    document.getElementById('frRail').addEventListener('click', function (e) {
      var b = e.target.closest('.fr-rail-btn'); if (!b) return;
      state.key = b.dataset.key;
      renderRail(); renderWall();
    });

    var t;
    document.getElementById('frSearch').addEventListener('input', function (e) {
      clearTimeout(t);
      var v = e.target.value.trim();
      t = setTimeout(function () {
        state.q = v;
        renderRail(); renderWall();
      }, 180);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    render();
    bind();
  });
})();
