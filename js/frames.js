/* ============================================================
   frames.js — 鏡框百科 首頁（標本牆）
   依賴：frames-data.js
   ------------------------------------------------------------
   結構：Hero → 三入口引導 → 左側篩選軸 + 標本牆
   三入口點擊後切換左側篩選軸的內容（分類／臉型／材質）。
   點任一標本 → /frame.html?f={新代碼}
   ============================================================ */
(function () {
  'use strict';

  var state = { mode: 'category', key: 'mat' };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function icon(key, w, h) {
    return '<svg viewBox="0 0 64 42" width="' + w + '" height="' + h +
      '" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      (FRAME_ICONS[key] || FRAME_ICONS.square) + '</svg>';
  }

  /* 目前模式對應的篩選選項 */
  function options() {
    if (state.mode === 'face')     return FRAME_FACE_FILTERS;
    if (state.mode === 'material') return FRAME_MATERIAL_FILTERS;
    return FRAME_GROUPS.map(function (g) { return { key: g.key, label: g.label }; });
  }

  function filtered() {
    return FRAME_ITEMS.filter(function (it) {
      return frameMatches(it, state.mode, state.key);
    });
  }

  function currentLabel() {
    var o = options().filter(function (x) { return x.key === state.key; })[0];
    return o ? o.label : '全部框型';
  }

  /* ---------- 渲染：三入口 ---------- */
  function renderEntries() {
    document.getElementById('frEntries').innerHTML = FRAME_ENTRIES.map(function (e) {
      return '<button type="button" class="fr-entry-card' +
        (e.key === state.mode ? ' is-active' : '') + '" data-mode="' + e.key + '">' +
        '<i class="ti ' + e.icon + '" aria-hidden="true"></i>' +
        '<span class="fr-entry-label">' + esc(e.label) + '</span>' +
        '<span class="fr-entry-sub">' + esc(e.hint) + '</span>' +
        '</button>';
    }).join('');
  }

  /* ---------- 渲染：左側篩選軸 ---------- */
  function renderRail() {
    document.getElementById('frRail').innerHTML = options().map(function (o) {
      var n = FRAME_ITEMS.filter(function (it) {
        return frameMatches(it, state.mode, o.key);
      }).length;
      return '<button type="button" class="fr-rail-btn' +
        (o.key === state.key ? ' is-active' : '') + '" data-key="' + o.key + '">' +
        '<span>' + esc(o.label) + '</span><span class="fr-rail-n">' + n + '</span>' +
        '</button>';
    }).join('');
  }

  /* ---------- 渲染：標本牆 ---------- */
  function renderWall() {
    var list = filtered();
    document.getElementById('frBodyTitle').textContent = currentLabel();
    document.getElementById('frCount').textContent = list.length + ' 種';

    if (!list.length) {
      document.getElementById('frWall').innerHTML =
        '<p class="fr-empty">這個條件下沒有對應框型，換一個看看。</p>';
      return;
    }

    document.getElementById('frWall').innerHTML = list.map(function (it) {
      return '<a class="fr-cell" href="/frame.html?f=' + encodeURIComponent(it.code) + '">' +
        '<span class="fr-cell-icon">' + icon(it.icon, 52, 34) + '</span>' +
        '<span class="fr-cell-name">' + esc(it.name) + '</span>' +
        (it.tag ? '<span class="fr-cell-tag">' + esc(it.tag) + '</span>' : '') +
        '</a>';
    }).join('');
  }

  function render() { renderEntries(); renderRail(); renderWall(); }

  /* ---------- 事件 ---------- */
  function bind() {
    document.getElementById('frEntries').addEventListener('click', function (e) {
      var b = e.target.closest('.fr-entry-card'); if (!b) return;
      state.mode = b.dataset.mode;
      state.key = options()[0].key;   // 切換模式後預設選第一個條件
      render();
      document.querySelector('.fr-body')
        .scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    document.getElementById('frRail').addEventListener('click', function (e) {
      var b = e.target.closest('.fr-rail-btn'); if (!b) return;
      state.key = b.dataset.key;
      renderRail(); renderWall();
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    render();
    bind();
  });
})();
