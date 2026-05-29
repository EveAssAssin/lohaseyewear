/* ============================================================
   樂活管理後台 · 分類管理 (cm-categories)
   ------------------------------------------------------------
   功能:
   - 從 Supabase categories 表載入 9 大主分類 + 子分類
   - 兩層樹狀結構顯示 (主分類可展開/收合)
   - 新增/改名/排序/啟用停用 (主分類 + 子分類)
   - 即時儲存到 Supabase
   ============================================================ */

(function () {
  'use strict';

  // 取得 Supabase client
  function getSb() {
    return (window.LohasApi && window.LohasApi.supabase) || window.supabase || null;
  }

  // 容器
  function root() {
    return document.querySelector('.content-page[data-page="cm-categories"]');
  }

  // ===== 狀態 =====
  let state = {
    mains: [],     // [{id, name, sort_order, is_active, subs: [...]}]
    loading: false,
  };

  // ===== 載入 =====
  async function load() {
    const sb = getSb();
    if (!sb) {
      console.error('[categories] Supabase 未就緒');
      return;
    }

    state.loading = true;
    render();

    try {
      const { data, error } = await sb
        .from('categories')
        .select('id, parent_id, name, sort_order, is_active')
        .order('sort_order', { ascending: true });

      if (error) throw error;

      // 拆成主 / 子
      const mains = [];
      const subsByParent = {};
      (data || []).forEach(c => {
        if (c.parent_id == null) {
          mains.push({ ...c, subs: [] });
        } else {
          (subsByParent[c.parent_id] = subsByParent[c.parent_id] || []).push(c);
        }
      });
      mains.forEach(m => {
        m.subs = (subsByParent[m.id] || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      });

      state.mains = mains;
    } catch (err) {
      console.error('[categories] 載入失敗:', err);
      alert('載入分類失敗:' + err.message);
    } finally {
      state.loading = false;
      render();
    }
  }

  // ===== 渲染 =====
  function render() {
    const r = root();
    if (!r) return;

    // 副標
    const sub = document.getElementById('catListSub');
    if (sub) {
      const totalSubs = state.mains.reduce((n, m) => n + m.subs.length, 0);
      sub.textContent = `${state.mains.length} 個主分類 · ${totalSubs} 個子分類`;
    }

    const list = document.getElementById('catList');
    if (!list) return;

    if (state.loading && !state.mains.length) {
      list.innerHTML = '<div class="cat-loading">載入中…</div>';
      return;
    }

    if (!state.mains.length) {
      list.innerHTML = '<div class="cat-empty">還沒有分類,點右上「新增主分類」開始</div>';
      return;
    }

    list.innerHTML = state.mains.map((m, i) => renderMain(m, i)).join('');
    bindEvents();
  }

  function renderMain(m, idx) {
    const subCount = m.subs.length;
    const activeSubs = m.subs.filter(s => s.is_active).length;
    return `
      <div class="cat-block ${m.is_active ? '' : 'inactive'}" data-id="${m.id}">
        <div class="cat-main-row">
          <button class="cat-toggle" data-act="toggle-expand" title="展開/收合">
            <i class="fa-solid fa-chevron-down"></i>
          </button>
          <div class="cat-main-info">
            <input type="text" class="cat-name-input" value="${escapeHtml(m.name)}" data-act="rename-main" data-id="${m.id}" data-old="${escapeHtml(m.name)}">
            <span class="cat-meta">子分類 ${activeSubs}/${subCount}</span>
          </div>
          <div class="cat-actions">
            <button class="cat-move" data-act="move-main-up"   data-id="${m.id}" title="上移" ${idx === 0 ? 'disabled' : ''}><i class="fa-solid fa-arrow-up"></i></button>
            <button class="cat-move" data-act="move-main-down" data-id="${m.id}" title="下移" ${idx === state.mains.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-arrow-down"></i></button>
            <label class="cat-switch">
              <input type="checkbox" ${m.is_active ? 'checked' : ''} data-act="toggle-active-main" data-id="${m.id}">
              <span></span>
            </label>
            <button class="cat-del" data-act="delete-main" data-id="${m.id}" title="刪除"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>
        <div class="cat-subs">
          ${m.subs.map((s, j) => renderSub(s, j, m.subs.length)).join('')}
          <button class="cat-add-sub" data-act="add-sub" data-parent="${m.id}">
            <i class="fa-solid fa-plus"></i> 新增子分類
          </button>
        </div>
      </div>`;
  }

  function renderSub(s, idx, total) {
    return `
      <div class="cat-sub-row ${s.is_active ? '' : 'inactive'}" data-id="${s.id}">
        <input type="text" class="cat-name-input" value="${escapeHtml(s.name)}" data-act="rename-sub" data-id="${s.id}" data-old="${escapeHtml(s.name)}">
        <div class="cat-actions">
          <button class="cat-move" data-act="move-sub-up"   data-id="${s.id}" title="上移" ${idx === 0 ? 'disabled' : ''}><i class="fa-solid fa-arrow-up"></i></button>
          <button class="cat-move" data-act="move-sub-down" data-id="${s.id}" title="下移" ${idx === total - 1 ? 'disabled' : ''}><i class="fa-solid fa-arrow-down"></i></button>
          <label class="cat-switch">
            <input type="checkbox" ${s.is_active ? 'checked' : ''} data-act="toggle-active-sub" data-id="${s.id}">
            <span></span>
          </label>
          <button class="cat-del" data-act="delete-sub" data-id="${s.id}" title="刪除"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>`;
  }

  // ===== 事件綁定 =====
  function bindEvents() {
    const list = document.getElementById('catList');
    if (!list) return;

    list.querySelectorAll('[data-act]').forEach(el => {
      const act = el.dataset.act;

      if (act === 'toggle-expand') {
        el.addEventListener('click', () => {
          const block = el.closest('.cat-block');
          block.classList.toggle('collapsed');
        });
      }

      else if (act === 'rename-main' || act === 'rename-sub') {
        el.addEventListener('blur', () => handleRename(el));
        el.addEventListener('keydown', e => {
          if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
        });
      }

      else if (act === 'toggle-active-main' || act === 'toggle-active-sub') {
        el.addEventListener('change', () => handleToggleActive(el));
      }

      else if (act === 'move-main-up' || act === 'move-main-down') {
        el.addEventListener('click', () => handleMoveMain(el.dataset.id, act.endsWith('up') ? -1 : 1));
      }

      else if (act === 'move-sub-up' || act === 'move-sub-down') {
        el.addEventListener('click', () => handleMoveSub(el.dataset.id, act.endsWith('up') ? -1 : 1));
      }

      else if (act === 'add-sub') {
        el.addEventListener('click', () => handleAddSub(el.dataset.parent));
      }

      else if (act === 'delete-main') {
        el.addEventListener('click', () => handleDelete(el.dataset.id, true));
      }
      else if (act === 'delete-sub') {
        el.addEventListener('click', () => handleDelete(el.dataset.id, false));
      }
    });
  }

  // ===== 操作 =====
  async function handleRename(input) {
    const id = input.dataset.id;
    const oldName = input.dataset.old;
    const newName = input.value.trim();
    if (!newName || newName === oldName) {
      input.value = oldName;
      return;
    }
    const sb = getSb();
    try {
      const { error } = await sb.from('categories').update({ name: newName }).eq('id', id);
      if (error) throw error;
      input.dataset.old = newName;
      // 同步本地狀態,避免下次 render 還是舊值
      updateLocalName(id, newName);
    } catch (err) {
      alert('改名失敗:' + err.message);
      input.value = oldName;
    }
  }

  async function handleToggleActive(checkbox) {
    const id = checkbox.dataset.id;
    const newActive = checkbox.checked;
    const sb = getSb();
    try {
      const { error } = await sb.from('categories').update({ is_active: newActive }).eq('id', id);
      if (error) throw error;
      updateLocalActive(id, newActive);
      render();
    } catch (err) {
      alert('啟用/停用失敗:' + err.message);
      checkbox.checked = !newActive;
    }
  }

  async function handleMoveMain(id, dir) {
    const idx = state.mains.findIndex(m => m.id === id);
    if (idx < 0) return;
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= state.mains.length) return;

    const a = state.mains[idx];
    const b = state.mains[targetIdx];
    // 交換 sort_order
    const tmp = a.sort_order;
    a.sort_order = b.sort_order;
    b.sort_order = tmp;

    const sb = getSb();
    try {
      await Promise.all([
        sb.from('categories').update({ sort_order: a.sort_order }).eq('id', a.id),
        sb.from('categories').update({ sort_order: b.sort_order }).eq('id', b.id),
      ]);
      // 重排
      state.mains.sort((x, y) => (x.sort_order || 0) - (y.sort_order || 0));
      render();
    } catch (err) {
      alert('排序失敗:' + err.message);
    }
  }

  async function handleMoveSub(id, dir) {
    let main, sub, subIdx;
    for (const m of state.mains) {
      const i = m.subs.findIndex(s => s.id === id);
      if (i >= 0) { main = m; sub = m.subs[i]; subIdx = i; break; }
    }
    if (!sub) return;
    const targetIdx = subIdx + dir;
    if (targetIdx < 0 || targetIdx >= main.subs.length) return;

    const a = main.subs[subIdx];
    const b = main.subs[targetIdx];
    const tmp = a.sort_order;
    a.sort_order = b.sort_order;
    b.sort_order = tmp;

    const sb = getSb();
    try {
      await Promise.all([
        sb.from('categories').update({ sort_order: a.sort_order }).eq('id', a.id),
        sb.from('categories').update({ sort_order: b.sort_order }).eq('id', b.id),
      ]);
      main.subs.sort((x, y) => (x.sort_order || 0) - (y.sort_order || 0));
      render();
    } catch (err) {
      alert('排序失敗:' + err.message);
    }
  }

  async function handleAddSub(parentId) {
    const name = prompt('輸入新子分類名稱:');
    if (!name || !name.trim()) return;

    const main = state.mains.find(m => m.id === parentId);
    if (!main) return;
    const nextOrder = main.subs.length ? Math.max(...main.subs.map(s => s.sort_order || 0)) + 10 : 10;

    const sb = getSb();
    try {
      const { data, error } = await sb.from('categories')
        .insert({ parent_id: parentId, name: name.trim(), sort_order: nextOrder, is_active: true })
        .select()
        .single();
      if (error) throw error;
      main.subs.push(data);
      render();
    } catch (err) {
      alert('新增失敗:' + err.message);
    }
  }

  async function handleAddMain() {
    const name = prompt('輸入新主分類名稱:');
    if (!name || !name.trim()) return;

    const nextOrder = state.mains.length ? Math.max(...state.mains.map(m => m.sort_order || 0)) + 10 : 10;

    const sb = getSb();
    try {
      const { data, error } = await sb.from('categories')
        .insert({ parent_id: null, name: name.trim(), sort_order: nextOrder, is_active: true })
        .select()
        .single();
      if (error) throw error;
      state.mains.push({ ...data, subs: [] });
      render();
    } catch (err) {
      alert('新增失敗:' + err.message);
    }
  }

  async function handleDelete(id, isMain) {
    const target = isMain
      ? state.mains.find(m => m.id === id)
      : state.mains.flatMap(m => m.subs).find(s => s.id === id);
    if (!target) return;

    const msg = isMain
      ? `確定刪除主分類「${target.name}」?\n\n· 連同 ${(target.subs || []).length} 個子分類一起刪除\n· 已分類的作品不會被刪除,但會失去分類`
      : `確定刪除子分類「${target.name}」?\n\n· 已分類的作品不會被刪除,但會失去這個子分類`;
    if (!confirm(msg)) return;

    const sb = getSb();
    try {
      const { error } = await sb.from('categories').delete().eq('id', id);
      if (error) throw error;
      if (isMain) {
        state.mains = state.mains.filter(m => m.id !== id);
      } else {
        state.mains.forEach(m => { m.subs = m.subs.filter(s => s.id !== id); });
      }
      render();
    } catch (err) {
      alert('刪除失敗:' + err.message);
    }
  }

  // ===== 本地狀態小工具 =====
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

  // ===== utils =====
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ===== 初始化 =====
  async function init() {
    if (!root()) return;
    // 綁定「新增主分類」按鈕 (只綁一次)
    const addBtn = document.getElementById('catAddMainBtn');
    if (addBtn && !addBtn.dataset.bound) {
      addBtn.dataset.bound = '1';
      addBtn.addEventListener('click', handleAddMain);
    }
    await load();
  }

  // 監聽 nav 切換
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('.nav-link[data-page="cm-categories"], .drawer-item[data-page="cm-categories"]');
    if (!btn) return;
    setTimeout(init, 50);
  });

  // 一進來就是該頁
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.LohasAdminCategories = { init, load };
})();
