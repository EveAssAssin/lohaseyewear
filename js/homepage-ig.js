/* ============================================================
   樂活眼鏡 · 首頁 IG 區塊動態載入器
   ------------------------------------------------------------
   讀取 Supabase creator_info 表，依後台「首頁主打 / 首頁曝光」
   設定，把對應的 IG 貼文 URL 填進
     #igFeaturedSlot (主打 — 完整 embed)
     #igExposureSlot (4 小 — 用 .lohas-ig-wall__cell 裁切版)
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
      data-instgrm-permalink="${esc(normalizeIgUrl(url))}"
      data-instgrm-version="14"
      style="background:#FFF;border:0;border-radius:0;margin:0 auto;max-width:540px;min-width:326px;padding:0;width:100%;"></blockquote>`;
  }

  // 把 IG URL 正規化成 embed.js 認得的格式
  // - /reels/ → /reel/ (複數 IG 不認)
  // - 移除 query string (?utm_source=... 等)
  // - 確保結尾有 /
  function normalizeIgUrl(url) {
    if (!url) return url;
    let u = String(url).trim();
    // 拿掉 query string + hash
    u = u.split('?')[0].split('#')[0];
    // /reels/ → /reel/
    u = u.replace(/\/reels\//i, '/reel/');
    // 確保結尾有 /
    if (!u.endsWith('/')) u += '/';
    return u;
  }

  function processIgEmbeds() {
    if (window.instgrm && window.instgrm.Embeds && typeof window.instgrm.Embeds.process === 'function') {
      try { window.instgrm.Embeds.process(); } catch (e) { /* ignore */ }
      return true;
    }
    return false;
  }

  // 等 embed.js 載入完才能呼叫 .Embeds.process()
  function waitForIgScript(maxMs) {
    return new Promise(resolve => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        if (processIgEmbeds()) {
          clearInterval(timer);
          resolve(true);
        } else if (Date.now() - startedAt > (maxMs || 8000)) {
          clearInterval(timer);
          resolve(false);
        }
      }, 100);
    });
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
    slot.innerHTML = exposed.map(c => {
      const normalized = normalizeIgUrl(c.featured_ig_post_url);
      const isReel = /\/reel\//i.test(normalized);
      return `
        <div class="lohas-ig-wall__cell ${isReel ? 'is-reel' : ''}">
          ${blockquote(c.featured_ig_post_url)}
        </div>
      `;
    }).join('');
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

    // 等 IG embed.js 真的載入完再 process
    // 因為動態塞進 DOM 的 blockquote，embed.js 不會自動掃，要主動呼叫 process()
    waitForIgScript(8000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
