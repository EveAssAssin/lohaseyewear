/* ============================================================
   frames.js — 鏡框百科全書 邏輯層
   依賴：frames-data.js（LEGACY_ID_MAP / FRAME_GROUPS / FRAME_ITEMS / FRAME_ICONS）
   ------------------------------------------------------------
   ?f= 參數支援兩種值：
     1. 新代碼    frames.html?f=mat-titan-round
     2. 舊站 ID   frames.html?f=471  → 經 LEGACY_ID_MAP 轉譯
   ============================================================ */
(function () {
  'use strict';

  var state = { group: 'mat', code: null };

  /* ---------- 工具 ---------- */
  function icon(key, size) {
    var s = size || 64;
    var h = Math.round(s * 42 / 64);
    return '<svg viewBox="0 0 64 42" width="' + s + '" height="' + h +
           '" fill="none" xmlns="http://www.w3.org/2000/svg">' +
           (FRAME_ICONS[key] || FRAME_ICONS.square) + '</svg>';
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function byCode(code) {
    for (var i = 0; i < FRAME_ITEMS.length; i++) {
      if (FRAME_ITEMS[i].code === code) return FRAME_ITEMS[i];
    }
    return null;
  }
  function inGroup(g) {
    return FRAME_ITEMS.filter(function (it) { return it.group === g; });
  }

  /* ---------- 解析 ?f= ---------- */
  function resolveParam() {
    var raw = new URLSearchParams(location.search).get('f');
    if (!raw) return null;
    // 濾除非法字元（例：舊 QR #8 結尾多餘的單引號）
    raw = raw.replace(/[^\w-]/g, '');
    if (byCode(raw)) return { code: raw, legacy: false };          // 已是新代碼
    var mapped = LEGACY_ID_MAP[raw];
    if (mapped && byCode(mapped)) return { code: mapped, legacy: true }; // 舊 ID 轉譯
    return null;
  }

  /* ---------- 渲染：Tabs ---------- */
  function renderTabs() {
    document.getElementById('frTabs').innerHTML = FRAME_GROUPS.map(function (g) {
      return '<button type="button" class="fr-tab' +
        (g.key === state.group ? ' is-active' : '') +
        '" data-group="' + g.key + '">' + esc(g.label) +
        '<span class="fr-tab-n">' + inGroup(g.key).length + '</span></button>';
    }).join('');
  }

  /* ---------- 渲染：知識卡片 ---------- */
  function renderGrid() {
    var g = FRAME_GROUPS.filter(function (x) { return x.key === state.group; })[0];
    document.getElementById('frGroupDesc').textContent = g ? g.desc : '';
    document.getElementById('frGrid').innerHTML = inGroup(state.group).map(function (it) {
      return '<button type="button" class="fr-card' +
        (it.code === state.code ? ' is-active' : '') + '" data-code="' + it.code + '">' +
        '<span class="fr-card-icon">' + icon(it.icon, 64) + '</span>' +
        '<span class="fr-card-name">' + esc(it.name) + '</span>' +
        '<span class="fr-card-en">' + esc(it.en) + '</span>' +
        '<span class="fr-card-desc">' + esc(it.desc) + '</span>' +
        (it.tag ? '<span class="fr-card-tag">' + esc(it.tag) + '</span>' : '') +
        '</button>';
    }).join('');
  }

  /* ---------- 渲染：詳情 + 商品 ---------- */
  function renderDetail() {
    var box = document.getElementById('frDetail');
    var it = byCode(state.code);
    if (!it) { box.innerHTML = ''; box.style.display = 'none'; return; }
    box.style.display = 'block';

    function col(title, arr) {
      return '<div><div class="fr-col-t">' + title + '</div><ul class="fr-col-list">' +
        (arr || []).map(function (v) { return '<li>' + esc(v) + '</li>'; }).join('') +
        '</ul></div>';
    }
    var prods = it.products || [];

    box.innerHTML =
      '<div class="fr-detail-head">' +
        '<div class="fr-detail-icon">' + icon(it.icon, 66) + '</div>' +
        '<div><h2 class="fr-detail-title">' + esc(it.name) + '</h2>' +
        '<div class="fr-detail-en">' + esc(it.en) + ' · ' + esc(it.code) + '</div></div>' +
      '</div>' +
      '<p class="fr-detail-desc">' + esc(it.desc) + '</p>' +
      '<div class="fr-detail-cols">' +
        col('適合臉型', it.face) + col('推薦場合', it.scene) + col('常見材質', it.material) +
      '</div>' +
      '<div class="fr-prod-sec">' +
        '<div class="fr-prod-head"><h2>對應樂活商品</h2>' +
        '<span class="fr-prod-count">' + prods.length + ' 款</span></div>' +
        '<div class="fr-prod-grid">' +
          prods.map(function (p) {
            return '<a class="fr-prod" href="' + esc(p.url) + '" target="_blank" rel="noopener">' +
              '<span class="fr-prod-img">' + icon(it.icon, 58) + '</span>' +
              '<span class="fr-prod-body">' +
                '<span class="fr-prod-series">' + esc(p.series) + '</span>' +
                '<span class="fr-prod-name">' + esc(p.name) + '</span>' +
                '<span class="fr-prod-tag">' + esc(p.tag) + '</span>' +
                '<span class="fr-prod-cta">查看商品 →</span>' +
              '</span></a>';
          }).join('') +
        '</div>' +
        '<p class="fr-prod-note">想看更多款式？<a href="https://www.lohaseyewear.com/" target="_blank" rel="noopener">前往樂活購物商城 →</a></p>' +
      '</div>';
  }

  function render() { renderTabs(); renderGrid(); renderDetail(); }

  /* ---------- 事件 ---------- */
  function bind() {
    document.getElementById('frTabs').addEventListener('click', function (e) {
      var b = e.target.closest('.fr-tab'); if (!b) return;
      state.group = b.dataset.group;
      var first = inGroup(state.group)[0];
      state.code = first ? first.code : null;
      render();
      syncUrl();
    });

    document.getElementById('frGrid').addEventListener('click', function (e) {
      var b = e.target.closest('.fr-card'); if (!b) return;
      state.code = b.dataset.code;
      renderGrid(); renderDetail(); syncUrl();
      document.getElementById('frDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // 更新網址但不留下大量歷史紀錄
  function syncUrl() {
    if (!state.code) return;
    history.replaceState(null, '', 'frames.html?f=' + encodeURIComponent(state.code));
  }

  /* ---------- 初始化 ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    var hit = resolveParam();
    if (hit) {
      state.code = hit.code;
      state.group = byCode(hit.code).group;
      if (hit.legacy) document.getElementById('frQrHint').classList.add('is-show');
    } else {
      state.group = 'mat';
      state.code = inGroup('mat')[0].code;
    }
    render();
    bind();

    // 由舊 QR 進入 → 自動捲到詳情，讓使用者直接看到內容
    if (hit) {
      setTimeout(function () {
        document.getElementById('frDetail')
          .scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 320);
    }
  });
})();
