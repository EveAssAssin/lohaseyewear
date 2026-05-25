/* ============================================================
   樂活眼鏡 · 首頁 IG 區塊動態載入器
   ------------------------------------------------------------
   讀取 Supabase creator_info 表，依後台「首頁主打 / 首頁曝光」
   設定，把對應的 IG 貼文 URL 填進 #igFeaturedSlot 與 #igExposureSlot。
   ------------------------------------------------------------
   依賴：js/supabase.js
   ============================================================ */

(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function blockquote(url) {
    if (!url) return '';
    return `<blockquote class="instagram-media"
      data-instgrm-captioned
      data-instgrm-permalink="${esc(url)}"
      data-instgrm-version="14"
      style="background:#FFF;border:0;border-radius:0;margin:0;max-width:540px;min-width:326px;padding:0;width:100%;"></blockquote>`;
  }

  function processIgEmbeds() {
    if (window.instgrm && window.instgrm.Embeds && typeof window.instgrm.Embeds.process === 'function') {
      try { window.instgrm.Embeds.process(); } catch (e) { /* ignore */ }
    }
  }

  async function fetchCreators() {
    const sb = window.LohasSupabase
      && window.LohasSupabase.getClient
      && window.LohasSupabase.getClient();
    if (!sb) return [];

    try {
      // 優先用 v_homepage_creators view
      let { data, error } = await sb
        .from('v_homepage_creators')
        .select('*');

      // 若 view 不存在 (尚未跑 SQL)，fallback 直接查表
      if (error) {
        const r = await sb.from('creator_info')
          .select('member_id, display_name, avatar_url, featured_ig_post_url, is_homepage_featured, homepage_exposure_order')
          .or('is_homepage_featured.eq.true,homepage_exposure_order.not.is.null');
        if (r.error) throw r.error;
        data = r.data;
      }
      return data || [];
    } catch (e) {
      console.warn('[homepage-ig] 讀取失敗:', e);
      return [];
    }
  }

  function renderFeatured(creators) {
    const slot = document.getElementById('igFeaturedSlot');
    if (!slot) return;

    const featured = creators.find(c => c.is_homepage_featured === true);

    if (!featured || !featured.featured_ig_post_url) {
      // 沒設定 → 隱藏整個主打位（讓右側 2×2 排版自動調整）
      slot.style.display = 'none';
      return;
    }

    slot.style.display = '';
    slot.innerHTML = blockquote(featured.featured_ig_post_url);
  }

  function renderExposure(creators) {
    const slot = document.getElementById('igExposureSlot');
    if (!slot) return;

    const exposed = creators
      .filter(c => c.homepage_exposure_order != null && c.featured_ig_post_url)
      .sort((a, b) => a.homepage_exposure_order - b.homepage_exposure_order);

    if (!exposed.length) {
      slot.style.display = 'none';
      return;
    }

    slot.style.display = '';
    slot.innerHTML = exposed.map(c => `
      <div class="lohas-ig-wall__cell">
        ${blockquote(c.featured_ig_post_url)}
      </div>
    `).join('');
  }

  async function init() {
    const creators = await fetchCreators();
    renderFeatured(creators);
    renderExposure(creators);

    // 兩個 slot 都空 → 整區隱藏
    const f = document.getElementById('igFeaturedSlot');
    const e = document.getElementById('igExposureSlot');
    if ((!f || f.style.display === 'none') && (!e || e.style.display === 'none')) {
      const wall = document.getElementById('lohas-ig-wall');
      if (wall) wall.style.display = 'none';
      return;
    }

    // 延遲一下確保 embed.js 載完
    setTimeout(processIgEmbeds, 100);
    setTimeout(processIgEmbeds, 800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
