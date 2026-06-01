/* ============================================================
   樂活管理後台 · 頁尾管理（cm-footer）
   ------------------------------------------------------------
   功能：
   - 從 Supabase site_settings 表載入 key='footer' 的設定
   - 編輯：社群連結 / 欄位區塊 / 法規連結 / 版權聲明
   - 拖曳排序、新增、刪除
   - 即時預覽
   - 一鍵儲存到 Supabase
   ============================================================ */

(function () {
  'use strict';

  const STORAGE_KEY = 'footer';

  // 預設值（首次使用 / 抓不到時 fallback）
  const DEFAULTS = {
    social: [
      { id: 'facebook', label: 'Facebook', icon: 'fab fa-facebook-f', url: '', enabled: true },
      { id: 'instagram', label: 'Instagram', icon: 'fab fa-instagram', url: '', enabled: true },
      { id: 'threads', label: 'Threads', icon: 'fa-brands fa-threads', url: '', enabled: true },
      { id: 'youtube', label: 'YouTube', icon: 'fab fa-youtube', url: '', enabled: true },
      { id: 'line', label: 'LINE', icon: 'fab fa-line', url: '', enabled: true }
    ],
    columns: [],
    legal: [
      { label: '隱私權政策', url: 'privacy.html', data_legal: 'privacy' },
      { label: '服務條款', url: 'terms.html', data_legal: 'terms' }
    ],
    copyright: '© 2026 Lohas 樂活眼鏡 All Rights Reserved.'
  };

  let state = null;

  function getSupabase() {
    return window.LohasSupabase && window.LohasSupabase.getClient && window.LohasSupabase.getClient();
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function root() {
    return document.querySelector('.content-page[data-page="cm-footer"]');
  }

  // ===== 載入資料 =====
  async function load() {
    const sb = getSupabase();
    if (!sb) {
      state = JSON.parse(JSON.stringify(DEFAULTS));
      return;
    }
    try {
      const { data, error } = await sb
        .from('site_settings')
        .select('value')
        .eq('key', STORAGE_KEY)
        .maybeSingle();
      if (error) throw error;
      state = data && data.value ? data.value : JSON.parse(JSON.stringify(DEFAULTS));
      // 確保結構完整
      state.social = state.social || DEFAULTS.social;
      state.columns = state.columns || [];
      state.legal = state.legal || DEFAULTS.legal;
      state.copyright = state.copyright || DEFAULTS.copyright;
    } catch (e) {
      console.warn('[cm-footer] load failed:', e);
      state = JSON.parse(JSON.stringify(DEFAULTS));
    }
  }

  // ===== 儲存 =====
  async function save() {
    const sb = getSupabase();
    if (!sb) {
      alert('Supabase 未連線');
      return false;
    }
    try {
      const { error } = await sb
        .from('site_settings')
        .upsert({ key: STORAGE_KEY, value: state }, { onConflict: 'key' });
      if (error) throw error;
      return true;
    } catch (e) {
      console.error('[cm-footer] save failed:', e);
      alert('儲存失敗：' + (e.message || '未知錯誤'));
      return false;
    }
  }

  // ===== 渲染整個頁面 =====
  function render() {
    const r = root();
    if (!r) return;

    r.innerHTML = `
      <div class="page-head">
        <div>
          <h1 class="page-title">頁尾管理</h1>
          <div class="page-sub">前台頁尾的社群連結、欄位連結、法規與版權聲明</div>
        </div>
        <div class="page-actions">
          <button class="btn" id="cmFooterReset"><i class="fa-solid fa-rotate-left"></i>復原</button>
          <button class="btn primary" id="cmFooterSave"><i class="fa-solid fa-floppy-disk"></i>儲存變更</button>
        </div>
      </div>

      <div class="cm-footer-grid">

        <!-- 編輯區 -->
        <div class="cm-footer-edit">

          <!-- 社群連結 -->
          <section class="cm-card">
            <h3 class="cm-card-h"><i class="fa-solid fa-share-nodes"></i> 社群連結</h3>
            <div class="cm-social-list" id="cmSocialList"></div>
          </section>

          <!-- 欄位區塊 -->
          <section class="cm-card">
            <h3 class="cm-card-h">
              <i class="fa-regular fa-rectangle-list"></i> 欄位區塊
              <button class="cm-add-btn" id="cmAddColumn"><i class="fa-solid fa-plus"></i> 新增欄位</button>
            </h3>
            <div class="cm-columns-list" id="cmColumnsList"></div>
          </section>

          <!-- 底部法規連結 -->
          <section class="cm-card">
            <h3 class="cm-card-h">
              <i class="fa-solid fa-scale-balanced"></i> 底部法規連結
              <button class="cm-add-btn" id="cmAddLegal"><i class="fa-solid fa-plus"></i> 新增</button>
            </h3>
            <div class="cm-legal-list" id="cmLegalList"></div>
          </section>

          <!-- 版權聲明 -->
          <section class="cm-card">
            <h3 class="cm-card-h"><i class="fa-regular fa-copyright"></i> 版權聲明</h3>
            <input type="text" class="cm-input" id="cmCopyright" placeholder="© 2026 Lohas 樂活眼鏡 All Rights Reserved." />
          </section>

        </div>

        <!-- 預覽區 -->
        <div class="cm-footer-preview">
          <div class="cm-preview-h">
            <i class="fa-regular fa-eye"></i> 即時預覽
            <span class="cm-preview-tag">未儲存的變更</span>
          </div>
          <div class="cm-preview-box" id="cmPreview"></div>
        </div>

      </div>
    `;

    renderSocial();
    renderColumns();
    renderLegal();
    document.getElementById('cmCopyright').value = state.copyright || '';
    renderPreview();

    bindEvents();
  }

  // ===== 渲染社群 =====
  function renderSocial() {
    const list = document.getElementById('cmSocialList');
    if (!list) return;
    list.innerHTML = state.social.map((s, i) => `
      <div class="cm-social-row">
        <label class="cm-switch" title="顯示/隱藏">
          <input type="checkbox" data-soc-toggle="${i}" ${s.enabled ? 'checked' : ''}>
          <span class="cm-switch-slider"></span>
        </label>
        <i class="${esc(s.icon)} cm-social-icon"></i>
        <span class="cm-social-label">${esc(s.label)}</span>
        <input type="url" class="cm-input cm-social-url"
               data-soc-url="${i}"
               placeholder="https://..."
               value="${esc(s.url || '')}">
      </div>
    `).join('');
  }

  // ===== 渲染欄位區塊 =====
  function renderColumns() {
    const list = document.getElementById('cmColumnsList');
    if (!list) return;
    if (!state.columns.length) {
      list.innerHTML = '<div class="cm-empty">尚未建立欄位，點上方「新增欄位」開始。</div>';
      return;
    }
    list.innerHTML = state.columns.map((col, ci) => `
      <div class="cm-col" data-col-index="${ci}">
        <div class="cm-col-head">
          <button class="cm-drag-btn" title="拖曳排序" data-col-drag="${ci}"><i class="fa-solid fa-grip-vertical"></i></button>
          <input type="text" class="cm-input cm-col-title"
                 data-col-title="${ci}"
                 placeholder="欄位標題（例：最新消息）"
                 value="${esc(col.title || '')}">
          <button class="cm-col-up" data-col-up="${ci}" title="上移" ${ci === 0 ? 'disabled' : ''}><i class="fa-solid fa-arrow-up"></i></button>
          <button class="cm-col-down" data-col-down="${ci}" title="下移" ${ci === state.columns.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-arrow-down"></i></button>
          <button class="cm-col-del" data-col-del="${ci}" title="刪除欄位"><i class="fa-solid fa-trash"></i></button>
        </div>
        <div class="cm-links-list" data-col-links="${ci}">
          ${(col.links || []).map((l, li) => `
            <div class="cm-link-row">
              <i class="fa-solid fa-grip-vertical cm-link-grip"></i>
              <input type="text" class="cm-input cm-link-label"
                     data-link-label="${ci}-${li}"
                     placeholder="顯示文字"
                     value="${esc(l.label || '')}">
              <input type="text" class="cm-input cm-link-url"
                     data-link-url="${ci}-${li}"
                     placeholder="URL（# / page.html / https://...）"
                     value="${esc(l.url || '')}">
              <button class="cm-link-del" data-link-del="${ci}-${li}" title="刪除"><i class="fa-solid fa-xmark"></i></button>
            </div>
          `).join('')}
        </div>
        <button class="cm-add-link-btn" data-col-add-link="${ci}"><i class="fa-solid fa-plus"></i> 新增連結</button>
      </div>
    `).join('');

    bindColumnDrag(list);
  }

  // ===== 欄位拖曳排序 =====
  function bindColumnDrag(list) {
    let dragCi = null;
    const cols = list.querySelectorAll('.cm-col');
    cols.forEach((colEl) => {
      const handle = colEl.querySelector('[data-col-drag]');
      if (!handle) return;
      // 只有按住把手才可拖曳
      handle.addEventListener('mousedown', () => { colEl.setAttribute('draggable', 'true'); });
      handle.addEventListener('touchstart', () => { colEl.setAttribute('draggable', 'true'); }, { passive: true });
      colEl.addEventListener('mouseup', () => colEl.removeAttribute('draggable'));

      colEl.addEventListener('dragstart', (e) => {
        dragCi = +colEl.dataset.colIndex;
        colEl.classList.add('cm-dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      colEl.addEventListener('dragend', () => {
        colEl.classList.remove('cm-dragging');
        colEl.removeAttribute('draggable');
        list.querySelectorAll('.cm-drag-over').forEach(el => el.classList.remove('cm-drag-over'));
      });
      colEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (dragCi === null) return;
        colEl.classList.add('cm-drag-over');
      });
      colEl.addEventListener('dragleave', () => colEl.classList.remove('cm-drag-over'));
      colEl.addEventListener('drop', (e) => {
        e.preventDefault();
        const targetCi = +colEl.dataset.colIndex;
        if (dragCi === null || dragCi === targetCi) return;
        const moved = state.columns.splice(dragCi, 1)[0];
        state.columns.splice(targetCi, 0, moved);
        dragCi = null;
        renderColumns();
        renderPreview();
      });
    });
  }
  function renderLegal() {
    const list = document.getElementById('cmLegalList');
    if (!list) return;
    if (!state.legal.length) {
      list.innerHTML = '<div class="cm-empty">尚未建立法規連結。</div>';
      return;
    }
    list.innerHTML = state.legal.map((l, i) => `
      <div class="cm-link-row">
        <input type="text" class="cm-input"
               data-legal-label="${i}"
               placeholder="顯示文字"
               value="${esc(l.label || '')}">
        <input type="text" class="cm-input"
               data-legal-url="${i}"
               placeholder="URL"
               value="${esc(l.url || '')}">
        <button class="cm-link-del" data-legal-del="${i}" title="刪除"><i class="fa-solid fa-xmark"></i></button>
      </div>
    `).join('');
  }

  // ===== 即時預覽（mini footer） =====
  function renderPreview() {
    const box = document.getElementById('cmPreview');
    if (!box) return;

    const socialHtml = (state.social || [])
      .filter(s => s.enabled !== false && s.url && s.url !== '#')
      .map(s => `<a><i class="${esc(s.icon)}"></i> ${esc(s.label)}</a>`)
      .join('');

    const columnsHtml = (state.columns || []).map(col => `
      <div class="cm-pv-col">
        <div class="cm-pv-col-h">${esc(col.title)}</div>
        <ul>
          ${(col.links || []).map(l => `<li>${esc(l.label)}</li>`).join('')}
        </ul>
      </div>
    `).join('');

    const legalHtml = (state.legal || []).map((l, i) =>
      `<span>${esc(l.label)}</span>` + (i < state.legal.length - 1 ? '<span class="sep">·</span>' : '')
    ).join('');

    box.innerHTML = `
      <div class="cm-pv-social">${socialHtml || '<span class="cm-pv-empty">未啟用任何社群連結</span>'}</div>
      <div class="cm-pv-cols">${columnsHtml || '<span class="cm-pv-empty">尚無欄位</span>'}</div>
      <div class="cm-pv-bottom">
        <div class="cm-pv-legal">${legalHtml}</div>
        <div class="cm-pv-copy">${esc(state.copyright)}</div>
      </div>
    `;
  }

  // ===== 綁定事件 =====
  function bindEvents() {
    const r = root();

    // 儲存
    document.getElementById('cmFooterSave').onclick = async function () {
      const btn = this;
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 儲存中...';
      const ok = await save();
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i>儲存變更';
      if (ok) {
        btn.innerHTML = '<i class="fa-solid fa-check"></i>已儲存';
        setTimeout(() => btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i>儲存變更', 2000);
      }
    };

    // 復原
    document.getElementById('cmFooterReset').onclick = async function () {
      if (!confirm('確定要復原到資料庫最後一次儲存的內容嗎？目前未儲存的編輯將會消失。')) return;
      await load();
      render();
    };

    // 委派事件處理
    r.addEventListener('input', onInput);
    r.addEventListener('click', onClick);
  }

  function onInput(e) {
    const t = e.target;

    // 社群 URL
    if (t.dataset.socUrl != null) {
      state.social[+t.dataset.socUrl].url = t.value;
    }

    // 欄位標題
    if (t.dataset.colTitle != null) {
      state.columns[+t.dataset.colTitle].title = t.value;
    }

    // 欄位連結
    if (t.dataset.linkLabel != null) {
      const [ci, li] = t.dataset.linkLabel.split('-').map(Number);
      state.columns[ci].links[li].label = t.value;
    }
    if (t.dataset.linkUrl != null) {
      const [ci, li] = t.dataset.linkUrl.split('-').map(Number);
      state.columns[ci].links[li].url = t.value;
    }

    // 法規連結
    if (t.dataset.legalLabel != null) {
      state.legal[+t.dataset.legalLabel].label = t.value;
    }
    if (t.dataset.legalUrl != null) {
      state.legal[+t.dataset.legalUrl].url = t.value;
    }

    // 版權
    if (t.id === 'cmCopyright') {
      state.copyright = t.value;
    }

    renderPreview();
  }

  function onClick(e) {
    const t = e.target.closest('button, input[type="checkbox"]');
    if (!t) return;

    // 社群開關
    if (t.dataset.socToggle != null) {
      state.social[+t.dataset.socToggle].enabled = t.checked;
      renderPreview();
      return;
    }

    // 新增欄位
    if (t.id === 'cmAddColumn') {
      state.columns.push({ title: '新欄位', links: [{ label: '', url: '' }] });
      renderColumns();
      renderPreview();
      return;
    }

    // 刪除欄位
    if (t.dataset.colDel != null) {
      const ci = +t.dataset.colDel;
      if (!confirm(`確定刪除欄位「${state.columns[ci].title || '未命名'}」嗎？`)) return;
      state.columns.splice(ci, 1);
      renderColumns();
      renderPreview();
      return;
    }

    // 欄位上移
    if (t.dataset.colUp != null) {
      const ci = +t.dataset.colUp;
      if (ci === 0) return;
      [state.columns[ci - 1], state.columns[ci]] = [state.columns[ci], state.columns[ci - 1]];
      renderColumns();
      renderPreview();
      return;
    }

    // 欄位下移
    if (t.dataset.colDown != null) {
      const ci = +t.dataset.colDown;
      if (ci >= state.columns.length - 1) return;
      [state.columns[ci + 1], state.columns[ci]] = [state.columns[ci], state.columns[ci + 1]];
      renderColumns();
      renderPreview();
      return;
    }

    // 新增連結到欄位
    if (t.dataset.colAddLink != null) {
      const ci = +t.dataset.colAddLink;
      state.columns[ci].links = state.columns[ci].links || [];
      state.columns[ci].links.push({ label: '', url: '' });
      renderColumns();
      renderPreview();
      return;
    }

    // 刪除欄位連結
    if (t.dataset.linkDel != null) {
      const [ci, li] = t.dataset.linkDel.split('-').map(Number);
      state.columns[ci].links.splice(li, 1);
      renderColumns();
      renderPreview();
      return;
    }

    // 新增法規連結
    if (t.id === 'cmAddLegal') {
      state.legal.push({ label: '', url: '' });
      renderLegal();
      renderPreview();
      return;
    }

    // 刪除法規連結
    if (t.dataset.legalDel != null) {
      state.legal.splice(+t.dataset.legalDel, 1);
      renderLegal();
      renderPreview();
      return;
    }
  }

  // ===== 對外：初始化 =====
  async function init() {
    if (!root()) return;
    await load();
    render();
  }

  // 監聽頁面切換：當切到 cm-footer 時才初始化
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('.nav-link[data-page="cm-footer"], .drawer-item[data-page="cm-footer"]');
    if (!btn) return;
    setTimeout(init, 50); // 等頁面切換完
  });

  // 如果一進來就是 cm-footer 頁，也初始化（不太可能但保險）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.LohasAdminFooter = { init, load, save };
})();
