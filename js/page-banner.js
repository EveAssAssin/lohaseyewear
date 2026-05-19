/*
 * page-banner.js
 * 通用頁面 banner 載入器
 *
 * 每個頁面只要在 <body> 加 data-banner-pos="engraving" (or market, gallery, home_hero)
 * 並在 hero 圖<img> 加 id="pageHeroImg"
 * 就會自動從 banners 表載入並覆蓋
 */

(function(){
  'use strict';

  document.addEventListener('DOMContentLoaded', loadPageBanner);

  async function loadPageBanner() {
    const pos = document.body.dataset.bannerPos;
    if (!pos) return;

    const sb = window.LohasSupabase && window.LohasSupabase.getClient && window.LohasSupabase.getClient();
    if (!sb) return;

    const { data, error } = await sb.from('banners')
      .select('*')
      .eq('position', pos)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .limit(1);

    if (error || !data || !data.length) return;
    const b = data[0];

    // 替換背景圖
    if (b.image_url) {
      const heroImg = document.getElementById('pageHeroImg');
      if (heroImg) heroImg.src = b.image_url;

      // 替換 <source> srcset (若有 picture)
      const heroImgParent = heroImg?.parentElement;
      if (heroImgParent?.tagName === 'PICTURE') {
        heroImgParent.querySelectorAll('source').forEach(s => {
          s.srcset = b.image_url;
        });
      }
    }

    // 替換文字 (可選)
    if (b.title) {
      const titleEl = document.querySelector('[data-banner-title]');
      if (titleEl) titleEl.textContent = b.title;
    }
    if (b.subtitle) {
      const subEl = document.querySelector('[data-banner-subtitle]');
      if (subEl) subEl.textContent = b.subtitle;
    }
    if (b.cta_text || b.link_url) {
      const ctaEl = document.querySelector('[data-banner-cta]');
      if (ctaEl) {
        if (b.cta_text) ctaEl.textContent = b.cta_text;
        if (b.link_url) ctaEl.href = b.link_url;
      }
    }
  }
})();
