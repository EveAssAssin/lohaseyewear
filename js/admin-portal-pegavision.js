/* ============================================================
   樂活管理後台 · 晶碩專頁管理 (cm-pegavision)
   ------------------------------------------------------------
   上傳一張長圖 → 存到 Supabase storage → URL 寫進
   site_settings (key = 'pegavision_page')
   前台 pegavision.html 讀這個 key 顯示圖片。
   ============================================================ */

(function () {
  'use strict';

  const STORAGE_KEY = 'pegavision_page';

  let state = {
    existingImageUrl: '',
    newFile: null,
    removed: false,
    loaded: false
  };

  function getSb() {
    return window.LohasSupabase && window.LohasSupabase.getClient && window.LohasSupabase.getClient();
  }

  function bucket() {
    return (window.LohasSupabase && window.LohasSupabase.CONFIG && window.LohasSupabase.CONFIG.STORAGE_BUCKET) || 'gallery-uploads';
  }

  function root() {
    return document.querySelector('.content-page[data-page="cm-pegavision"]');
  }

  // ===== 載入既有設定 =====
  async function load() {
    const sb = getSb();
    if (!sb) return;
    try {
      const { data, error } = await sb
        .from('site_settings')
        .select('value')
        .eq('key', STORAGE_KEY)
        .maybeSingle();
      if (error) throw error;
      state.existingImageUrl = (data && data.value && data.value.image_url) || '';
      state.newFile = null;
      state.removed = false;
      state.loaded = true;
      renderPreview();
    } catch (e) {
      console.warn('[cm-pegavision] load failed:', e);
    }
  }

  // ===== 預覽 =====
  function renderPreview() {
    const preview = document.getElementById('pegaPreview');
    const previewImg = document.getElementById('pegaPreviewImg');
    if (!preview || !previewImg) return;

    // 優先顯示新選的檔，其次既有圖
    if (state.newFile) {
      const url = URL.createObjectURL(state.newFile);
      previewImg.src = url;
      preview.style.display = '';
    } else if (state.existingImageUrl && !state.removed) {
      previewImg.src = state.existingImageUrl;
      preview.style.display = '';
    } else {
      previewImg.src = '';
      preview.style.display = 'none';
    }
  }

  // ===== 儲存 =====
  async function save() {
    const sb = getSb();
    if (!sb) { alert('資料庫未連線'); return; }

    const btn = document.getElementById('pegaSaveBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>儲存中...</span>'; }

    try {
      let imageUrl = state.existingImageUrl;

      // 移除圖片
      if (state.removed && !state.newFile) {
        imageUrl = '';
      }

      // 有新檔 → 上傳
      if (state.newFile) {
        const ext = (state.newFile.name || '').split('.').pop()?.toLowerCase() || 'jpg';
        const filePath = `pegavision/page-${Date.now()}.${ext}`;
        const { error: upErr } = await sb.storage.from(bucket())
          .upload(filePath, state.newFile, { cacheControl: '3600', upsert: false });
        if (upErr) throw new Error('圖片上傳失敗：' + upErr.message);
        const { data: urlData } = sb.storage.from(bucket()).getPublicUrl(filePath);
        imageUrl = urlData.publicUrl;
      }

      // 寫進 site_settings
      const { data, error } = await sb
        .from('site_settings')
        .upsert({ key: STORAGE_KEY, value: { image_url: imageUrl } }, { onConflict: 'key' })
        .select();

      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('沒有任何資料被更新（可能 RLS 擋住寫入）');
      }

      // 同步本地 state
      state.existingImageUrl = imageUrl;
      state.newFile = null;
      state.removed = false;
      renderPreview();

      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-check"></i><span>已儲存</span>';
        setTimeout(() => { btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i><span>儲存</span>'; }, 2000);
      }
    } catch (e) {
      alert('儲存失敗：' + (e.message || '未知錯誤'));
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i><span>儲存</span>';
      }
    }
  }

  // ===== 綁定事件 =====
  function bind() {
    const r = root();
    if (!r || r.dataset.pegaBound) return;
    r.dataset.pegaBound = '1';

    const pickBtn = document.getElementById('pegaPickBtn');
    const fileInput = document.getElementById('pegaFileInput');
    const removeBtn = document.getElementById('pegaRemoveBtn');
    const saveBtn = document.getElementById('pegaSaveBtn');

    if (pickBtn && fileInput) {
      pickBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        if (!f.type.startsWith('image/')) { alert('請選擇圖片檔'); return; }
        state.newFile = f;
        state.removed = false;
        renderPreview();
      });
    }

    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        state.newFile = null;
        state.removed = true;
        if (fileInput) fileInput.value = '';
        renderPreview();
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', save);
    }
  }

  async function init() {
    if (!root()) return;
    bind();
    if (!state.loaded) await load();
  }

  // 切換到 cm-pegavision 時初始化
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('.nav-link[data-page="cm-pegavision"], .drawer-item[data-page="cm-pegavision"]');
    if (!btn) return;
    setTimeout(init, 50);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.LohasAdminPegavision = { init, load, save };
})();
