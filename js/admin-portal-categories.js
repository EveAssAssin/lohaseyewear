/* ============================================================
   樂活管理後台 · 分類管理 (cm-categories)
   - 主分類 + 子分類兩層;新增/改名/啟用停用/刪除
   - 拖曳排序 (主分類之間、同主分類下的子分類之間)
   - 即時儲存到 Supabase
   ============================================================ */
(function () {
  'use strict';

  function getSb() {
    return window.LohasSupabase && window.LohasSupabase.getClient && window.LohasSupabase.getClient();
  }
  function root() {
    return document.querySelector('.content-page[data-page="cm-categories"]');
  }

  let state = { mains: [], loading: false };
  let dragInfo = null;

  async function load() {
    const sb = getSb();
    if (!sb) { console.error('[categories] Supabase 未就緒'); return; }
    state.loading = true; render();
    try {
      const { data, error } = await sb.from('categories')
        .select('id, parent_id, name, sort_order, is_active, designer_prompts')
        .order('sort_order', { ascending: true });
      if (error) throw error;
      const mains = [], subsByParent = {};
      (data || []).forEach(c => {
        if (c.parent_id == null) mains.push({ ...c, subs: [] });
        else (subsByParent[c.parent_id] = subsByParent[c.parent_id] || []).push(c);
      });
      mains.forEach(m => {
        m.subs = (subsByParent[m.id] || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      });
      state.mains = mains;
    } catch (err) {
      console.error('[categories] 載入失敗:', err);
      alert('載入分類失敗:' + err.message);
    } finally {
      state.loading = false; render();
    }
  }

  function render() {
    const r = root(); if (!r) return;
    const sub = document.getElementById('catListSub');
    if (sub) {
      const totalSubs = state.mains.reduce((n, m) => n + m.subs.length, 0);
      sub.textContent = state.mains.length + ' 個主分類 · ' + totalSubs + ' 個子分類';
    }
    const list = document.getElementById('catList');
    if (!list) return;
    if (state.loading && !state.mains.length) { list.innerHTML = '<div class="cat-loading">載入中…</div>'; return; }
    if (!state.mains.length) { list.innerHTML = '<div class="cat-empty">還沒有分類,點右上「新增主分類」開始</div>'; return; }
    list.innerHTML = state.mains.map(m => renderMain(m)).join('');
    bindEvents();
  }

  function renderMain(m) {
    const subCount = m.subs.length;
    const activeSubs = m.subs.filter(s => s.is_active).length;
    return '' +
      '<div class="cat-block ' + (m.is_active ? '' : 'inactive') + '" data-id="' + m.id + '" data-type="main" draggable="true">' +
        '<div class="cat-main-row">' +
          '<span class="cat-drag" title="拖曳排序"><i class="fa-solid fa-grip-vertical"></i></span>' +
          '<button class="cat-toggle" data-act="toggle-expand" title="展開/收合"><i class="fa-solid fa-chevron-down"></i></button>' +
          '<input type="text" class="cat-name-input cat-name-main" value="' + escapeHtml(m.name) + '" data-act="rename" data-id="' + m.id + '" data-old="' + escapeHtml(m.name) + '">' +
          '<span class="cat-meta">子分類 ' + activeSubs + '/' + subCount + '</span>' +
          '<div class="cat-actions">' +
            '<button class="cat-prompt-btn" data-act="edit-prompts" data-id="' + m.id + '" title="設計師模式提示詞"><i class="fa-solid fa-wand-magic-sparkles"></i> 提示詞</button>' +
            '<label class="cat-switch" title="' + (m.is_active ? '點擊停用' : '點擊啟用') + '"><input type="checkbox" ' + (m.is_active ? 'checked' : '') + ' data-act="toggle-active" data-id="' + m.id + '"><span></span></label>' +
            '<button class="cat-del" data-act="delete-main" data-id="' + m.id + '" title="刪除"><i class="fa-solid fa-trash"></i></button>' +
          '</div>' +
        '</div>' +
        '<div class="cat-subs" data-parent="' + m.id + '">' +
          m.subs.map(s => renderSub(s, m.id)).join('') +
          '<button class="cat-add-sub" data-act="add-sub" data-parent="' + m.id + '"><i class="fa-solid fa-plus"></i> 新增子分類</button>' +
        '</div>' +
      '</div>';
  }

  function renderSub(s, parentId) {
    return '' +
      '<div class="cat-sub-row ' + (s.is_active ? '' : 'inactive') + '" data-id="' + s.id + '" data-type="sub" data-parent="' + parentId + '" draggable="true">' +
        '<span class="cat-drag" title="拖曳排序"><i class="fa-solid fa-grip-vertical"></i></span>' +
        '<input type="text" class="cat-name-input" value="' + escapeHtml(s.name) + '" data-act="rename" data-id="' + s.id + '" data-old="' + escapeHtml(s.name) + '">' +
        '<div class="cat-actions">' +
          '<label class="cat-switch" title="' + (s.is_active ? '點擊停用' : '點擊啟用') + '"><input type="checkbox" ' + (s.is_active ? 'checked' : '') + ' data-act="toggle-active" data-id="' + s.id + '"><span></span></label>' +
          '<button class="cat-del" data-act="delete-sub" data-id="' + s.id + '" title="刪除"><i class="fa-solid fa-trash"></i></button>' +
        '</div>' +
      '</div>';
  }

  function bindEvents() {
    const list = document.getElementById('catList');
    if (!list) return;

    list.querySelectorAll('[data-act]').forEach(el => {
      const act = el.dataset.act;
      if (act === 'toggle-expand') {
        el.addEventListener('click', () => el.closest('.cat-block').classList.toggle('collapsed'));
      } else if (act === 'rename') {
        el.addEventListener('blur', () => handleRename(el));
        el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } });
      } else if (act === 'toggle-active') {
        el.addEventListener('change', () => handleToggleActive(el));
      } else if (act === 'add-sub') {
        el.addEventListener('click', () => handleAddSub(el.dataset.parent));
      } else if (act === 'delete-main') {
        el.addEventListener('click', () => handleDelete(el.dataset.id, true));
      } else if (act === 'delete-sub') {
        el.addEventListener('click', () => handleDelete(el.dataset.id, false));
      } else if (act === 'edit-prompts') {
        el.addEventListener('click', () => openPromptsModal(el.dataset.id));
      }
    });

    // 主分類拖曳
    list.querySelectorAll('.cat-block[draggable="true"]').forEach(block => {
      block.addEventListener('dragstart', e => {
        if (e.target.closest('.cat-subs')) { e.preventDefault(); return; }
        if (e.target.closest('.cat-name-input')) { e.preventDefault(); return; }
        dragInfo = { type: 'main', id: block.dataset.id };
        block.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      block.addEventListener('dragend', () => {
        block.classList.remove('dragging'); dragInfo = null;
        list.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over'));
      });
      block.addEventListener('dragover', e => {
        if (!dragInfo || dragInfo.type !== 'main') return;
        e.preventDefault();
        if (e.currentTarget.dataset.id !== dragInfo.id) e.currentTarget.classList.add('drag-over');
      });
      block.addEventListener('dragleave', e => e.currentTarget.classList.remove('drag-over'));
      block.addEventListener('drop', e => {
        if (!dragInfo || dragInfo.type !== 'main') return;
        e.preventDefault();
        e.currentTarget.classList.remove('drag-over');
        handleDropMain(dragInfo.id, e.currentTarget.dataset.id);
      });
    });

    // 子分類拖曳
    list.querySelectorAll('.cat-sub-row[draggable="true"]').forEach(row => {
      row.addEventListener('dragstart', e => {
        if (e.target.closest('.cat-name-input')) { e.preventDefault(); return; }
        e.stopPropagation();
        dragInfo = { type: 'sub', id: row.dataset.id, parentId: row.dataset.parent };
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      row.addEventListener('dragend', e => {
        e.stopPropagation();
        row.classList.remove('dragging'); dragInfo = null;
        list.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over'));
      });
      row.addEventListener('dragover', e => {
        if (!dragInfo || dragInfo.type !== 'sub') return;
        if (dragInfo.parentId !== row.dataset.parent) return;
        e.preventDefault(); e.stopPropagation();
        if (row.dataset.id !== dragInfo.id) row.classList.add('drag-over');
      });
      row.addEventListener('dragleave', e => { e.stopPropagation(); e.currentTarget.classList.remove('drag-over'); });
      row.addEventListener('drop', e => {
        if (!dragInfo || dragInfo.type !== 'sub') return;
        if (dragInfo.parentId !== row.dataset.parent) return;
        e.preventDefault(); e.stopPropagation();
        e.currentTarget.classList.remove('drag-over');
        handleDropSub(dragInfo.id, row.dataset.id, row.dataset.parent);
      });
    });
  }

  async function handleDropMain(draggedId, targetId) {
    if (draggedId === targetId) return;
    const arr = state.mains;
    const from = arr.findIndex(m => m.id === draggedId);
    const to = arr.findIndex(m => m.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    await resequence(arr); render();
  }

  async function handleDropSub(draggedId, targetId, parentId) {
    if (draggedId === targetId) return;
    const main = state.mains.find(m => m.id === parentId);
    if (!main) return;
    const arr = main.subs;
    const from = arr.findIndex(s => s.id === draggedId);
    const to = arr.findIndex(s => s.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    await resequence(arr); render();
  }

  async function resequence(arr) {
    const sb = getSb();
    const updates = [];
    arr.forEach((item, i) => {
      const newOrder = (i + 1) * 10;
      if (item.sort_order !== newOrder) {
        item.sort_order = newOrder;
        updates.push(sb.from('categories').update({ sort_order: newOrder }).eq('id', item.id));
      }
    });
    try { if (updates.length) await Promise.all(updates); }
    catch (err) { console.error('[categories] 排序儲存失敗:', err); alert('排序儲存失敗:' + err.message); load(); }
  }

  async function handleRename(input) {
    const id = input.dataset.id, oldName = input.dataset.old, newName = input.value.trim();
    if (!newName || newName === oldName) { input.value = oldName; return; }
    const sb = getSb();
    try {
      const { error } = await sb.from('categories').update({ name: newName }).eq('id', id);
      if (error) throw error;
      input.dataset.old = newName; updateLocalName(id, newName);
    } catch (err) { alert('改名失敗:' + err.message); input.value = oldName; }
  }

  async function handleToggleActive(checkbox) {
    const id = checkbox.dataset.id, newActive = checkbox.checked;
    const sb = getSb();
    try {
      const { error } = await sb.from('categories').update({ is_active: newActive }).eq('id', id);
      if (error) throw error;
      updateLocalActive(id, newActive); render();
    } catch (err) { alert('操作失敗:' + err.message); checkbox.checked = !newActive; }
  }

  async function handleAddSub(parentId) {
    const name = prompt('輸入新子分類名稱:');
    if (!name || !name.trim()) return;
    const main = state.mains.find(m => m.id === parentId);
    if (!main) return;
    const nextOrder = main.subs.length ? Math.max.apply(null, main.subs.map(s => s.sort_order || 0)) + 10 : 10;
    const sb = getSb();
    try {
      const { data, error } = await sb.from('categories')
        .insert({ parent_id: parentId, name: name.trim(), sort_order: nextOrder, is_active: true })
        .select().single();
      if (error) throw error;
      main.subs.push(data); render();
    } catch (err) { alert('新增失敗:' + err.message); }
  }

  async function handleAddMain() {
    const name = prompt('輸入新主分類名稱:');
    if (!name || !name.trim()) return;
    const nextOrder = state.mains.length ? Math.max.apply(null, state.mains.map(m => m.sort_order || 0)) + 10 : 10;
    const sb = getSb();
    try {
      const { data, error } = await sb.from('categories')
        .insert({ parent_id: null, name: name.trim(), sort_order: nextOrder, is_active: true })
        .select().single();
      if (error) throw error;
      state.mains.push({ ...data, subs: [] }); render();
    } catch (err) { alert('新增失敗:' + err.message); }
  }

  async function handleDelete(id, isMain) {
    const target = isMain
      ? state.mains.find(m => m.id === id)
      : state.mains.flatMap(m => m.subs).find(s => s.id === id);
    if (!target) return;
    const msg = isMain
      ? '確定刪除主分類「' + target.name + '」?\n\n· 連同 ' + (target.subs || []).length + ' 個子分類一起刪除\n· 已分類的作品不會被刪除,但會失去分類'
      : '確定刪除子分類「' + target.name + '」?\n\n· 已分類的作品不會被刪除,但會失去這個子分類';
    if (!confirm(msg)) return;
    const sb = getSb();
    try {
      const { error } = await sb.from('categories').delete().eq('id', id);
      if (error) throw error;
      if (isMain) state.mains = state.mains.filter(m => m.id !== id);
      else state.mains.forEach(m => { m.subs = m.subs.filter(s => s.id !== id); });
      render();
    } catch (err) { alert('刪除失敗:' + err.message); }
  }

  function updateLocalName(id, name) {
    for (const m of state.mains) {
      if (m.id === id) { m.name = name; return; }
      for (const s of m.subs) if (s.id === id) { s.name = name; return; }
    }
  }
  function updateLocalActive(id, active) {
    for (const m of state.mains) {
      if (m.id === id) { m.is_active = active; return; }
      for (const s of m.subs) if (s.id === id) { s.is_active = active; return; }
    }
  }
  // ===== 設計師模式提示詞編輯 =====
  var pmState = { catId: null };

  function findMain(id) {
    return state.mains.find(m => String(m.id) === String(id));
  }

  function openPromptsModal(catId) {
    const m = findMain(catId);
    if (!m) return;
    pmState.catId = catId;
    const dp = m.designer_prompts || {};
    const scratch = Array.isArray(dp.scratch) ? dp.scratch : [];
    const material = Array.isArray(dp.material) ? dp.material : [];

    let modal = document.getElementById('catPromptsModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'catPromptsModal';
      modal.className = 'cpm-overlay';
      document.body.appendChild(modal);
    }
    modal.innerHTML =
      '<div class="cpm-dialog">' +
        '<div class="cpm-head">' +
          '<h2><i class="fa-solid fa-wand-magic-sparkles"></i> 設計師模式提示詞 · ' + escapeHtml(m.name) + '</h2>' +
          '<button class="cpm-close" type="button"><i class="fa-solid fa-xmark"></i></button>' +
        '</div>' +
        '<div class="cpm-body">' +
          '<p class="cpm-hint">這些風格與提示詞會出現在「設計師模式」第二步。留空不填,此分類會自動使用系統通用提示詞。</p>' +
          '<div class="cpm-route">' +
            '<div class="cpm-route-title"><span class="cpm-badge a">A</span> 無中生有(純文字生成)</div>' +
            '<div class="cpm-list" id="cpmScratch"></div>' +
            '<button class="cpm-add" type="button" data-route="scratch"><i class="fa-solid fa-plus"></i> 新增風格</button>' +
          '</div>' +
          '<div class="cpm-route">' +
            '<div class="cpm-route-title"><span class="cpm-badge b">B</span> 用現有素材改造</div>' +
            '<div class="cpm-list" id="cpmMaterial"></div>' +
            '<button class="cpm-add" type="button" data-route="material"><i class="fa-solid fa-plus"></i> 新增風格</button>' +
          '</div>' +
        '</div>' +
        '<div class="cpm-foot">' +
          '<button class="cpm-btn-cancel" type="button">取消</button>' +
          '<button class="cpm-btn-save" type="button">儲存</button>' +
        '</div>' +
      '</div>';

    // 填入現有風格
    scratch.forEach(s => addStyleRow('scratch', s));
    material.forEach(s => addStyleRow('material', s));

    // 綁事件
    modal.querySelector('.cpm-close').addEventListener('click', closePromptsModal);
    modal.querySelector('.cpm-btn-cancel').addEventListener('click', closePromptsModal);
    modal.querySelector('.cpm-btn-save').addEventListener('click', savePrompts);
    modal.addEventListener('click', e => { if (e.target === modal) closePromptsModal(); });
    modal.querySelectorAll('.cpm-add').forEach(btn => {
      btn.addEventListener('click', () => addStyleRow(btn.dataset.route, null));
    });

    modal.classList.add('open');
  }

  function addStyleRow(route, data) {
    const listId = route === 'material' ? 'cpmMaterial' : 'cpmScratch';
    const list = document.getElementById(listId);
    if (!list) return;
    data = data || {};
    const row = document.createElement('div');
    row.className = 'cpm-style';
    row.dataset.route = route;
    const imgFields = route === 'material'
      ? '<div class="cpm-field"><label>改造前圖 URL</label><input class="cpm-before" value="' + escapeHtml(data.before || '') + '" placeholder="https://..."></div>' +
        '<div class="cpm-field"><label>改造後圖 URL</label><input class="cpm-after" value="' + escapeHtml(data.after || '') + '" placeholder="https://..."></div>'
      : '<div class="cpm-field"><label>範例圖 URL</label><input class="cpm-sample" value="' + escapeHtml(data.sample || '') + '" placeholder="https://..."></div>';
    row.innerHTML =
      '<div class="cpm-style-head">' +
        '<input class="cpm-name" value="' + escapeHtml(data.name || '') + '" placeholder="風格名稱(例:極簡線條)">' +
        '<button class="cpm-style-del" type="button" title="刪除"><i class="fa-solid fa-trash"></i></button>' +
      '</div>' +
      '<div class="cpm-field"><label>說明</label><input class="cpm-desc" value="' + escapeHtml(data.desc || '') + '" placeholder="一句話說明這個風格"></div>' +
      '<div class="cpm-field"><label>提示詞</label><textarea class="cpm-prompt" rows="3" placeholder="貼到 ChatGPT 的提示詞...">' + escapeHtml(data.prompt || '') + '</textarea></div>' +
      imgFields;
    row.querySelector('.cpm-style-del').addEventListener('click', () => row.remove());
    list.appendChild(row);
  }

  function collectStyles(route) {
    const listId = route === 'material' ? 'cpmMaterial' : 'cpmScratch';
    const list = document.getElementById(listId);
    if (!list) return [];
    const out = [];
    let i = 0;
    list.querySelectorAll('.cpm-style').forEach(row => {
      const name = row.querySelector('.cpm-name').value.trim();
      const prompt = row.querySelector('.cpm-prompt').value.trim();
      if (!name && !prompt) return;   // 整列空 → 跳過
      const item = {
        id: (route === 'material' ? 'm-' : 's-') + (i++),
        name: name,
        desc: row.querySelector('.cpm-desc').value.trim(),
        prompt: prompt,
      };
      if (route === 'material') {
        item.before = row.querySelector('.cpm-before').value.trim();
        item.after = row.querySelector('.cpm-after').value.trim();
      } else {
        item.sample = row.querySelector('.cpm-sample').value.trim();
      }
      out.push(item);
    });
    return out;
  }

  async function savePrompts() {
    const sb = getSb();
    if (!sb || !pmState.catId) return;
    const scratch = collectStyles('scratch');
    const material = collectStyles('material');
    // 兩邊都空 → 存 null(用通用)
    const payload = (scratch.length || material.length)
      ? { scratch: scratch, material: material }
      : null;
    const saveBtn = document.querySelector('#catPromptsModal .cpm-btn-save');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '儲存中...'; }
    try {
      const { error } = await sb.from('categories')
        .update({ designer_prompts: payload })
        .eq('id', pmState.catId);
      if (error) throw error;
      const m = findMain(pmState.catId);
      if (m) m.designer_prompts = payload;
      closePromptsModal();
      alert('已儲存');
    } catch (err) {
      console.error('[categories] 提示詞儲存失敗:', err);
      alert('儲存失敗:' + err.message);
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '儲存'; }
    }
  }

  function closePromptsModal() {
    const modal = document.getElementById('catPromptsModal');
    if (modal) modal.classList.remove('open');
    pmState.catId = null;
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  async function init() {
    if (!root()) return;
    const addBtn = document.getElementById('catAddMainBtn');
    if (addBtn && !addBtn.dataset.bound) {
      addBtn.dataset.bound = '1';
      addBtn.addEventListener('click', handleAddMain);
    }
    await load();
  }

  document.addEventListener('click', function (e) {
    const btn = e.target.closest('.nav-link[data-page="cm-categories"], .drawer-item[data-page="cm-categories"]');
    if (!btn) return;
    setTimeout(init, 50);
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.LohasAdminCategories = { init, load };
})();
