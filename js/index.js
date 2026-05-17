/* =============================================================
   首頁 · index.js
   ============================================================= */

(function () {
  'use strict';

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ===== 載入首頁輪播小卡 (show_in_homepage = true) =====
  async function loadHomepageCards() {
    const container = document.getElementById('owndays-container');
    if (!container) return;

    const sb = window.LohasSupabase && window.LohasSupabase.getClient && window.LohasSupabase.getClient();
    if (!sb) {
      container.innerHTML = '';
      return;
    }

    const { data, error } = await sb
      .from('news')
      .select('slug, title, homepage_tag, homepage_subtitle, homepage_image_url, cover_image_url, excerpt')
      .eq('status', 'published')
      .eq('show_in_homepage', true)
      .order('sort_order', { ascending: true })
      .order('published_at', { ascending: false })
      .limit(4);

    if (error) {
      console.error('[首頁輪播載入失敗]', error);
      container.innerHTML = '';
      return;
    }

    if (!data || !data.length) {
      // 沒設定就空著
      container.innerHTML = '';
      return;
    }

    const html = data.map(n => {
      const img = n.homepage_image_url || n.cover_image_url;
      const href = 'news-detail.html?id=' + escapeHtml(n.slug);
      const tag = n.homepage_tag || '';
      const sub = n.homepage_subtitle || n.excerpt || '';
      return '<a href="' + href + '" class="owndays-item">' +
        '<div class="item-overlay">' +
          (tag ? '<span class="tag">' + escapeHtml(tag) + '</span>' : '') +
          '<h2>' + escapeHtml(n.title) + '</h2>' +
          (sub ? '<p>' + escapeHtml(sub) + '</p>' : '') +
          '<span class="btn-more">VIEW MORE</span>' +
        '</div>' +
        (img ? '<img src="' + escapeHtml(img) + '" alt="' + escapeHtml(n.title) + '">' : '') +
      '</a>';
    }).join('');

    container.innerHTML = html;
  }

  // ===== 滑動箭頭按鈕 =====
  function bindScrollButtons() {
    const container1 = document.getElementById('owndays-container');
    const prevBtn1 = document.querySelector('.prev-btn');
    const nextBtn1 = document.querySelector('.next-btn');

    if (container1 && prevBtn1 && nextBtn1) {
      prevBtn1.addEventListener('click', () => {
        const first = container1.querySelector('.owndays-item');
        if (!first) return;
        const cardWidth = first.offsetWidth + 15;
        container1.scrollBy({ left: -cardWidth, behavior: 'smooth' });
      });
      nextBtn1.addEventListener('click', () => {
        const first = container1.querySelector('.owndays-item');
        if (!first) return;
        const cardWidth = first.offsetWidth + 15;
        container1.scrollBy({ left: cardWidth, behavior: 'smooth' });
      });
    }

    // 第二組 (商店街/AI鏡片)
    const container2 = document.getElementById('extra-cards-container');
    const prevBtn2 = document.querySelector('.prev-btn-2');
    const nextBtn2 = document.querySelector('.next-btn-2');

    if (container2 && prevBtn2 && nextBtn2) {
      prevBtn2.addEventListener('click', () => {
        const first = container2.querySelector('.owndays-item');
        if (!first) return;
        const cardWidth = first.offsetWidth + 15;
        container2.scrollBy({ left: -cardWidth, behavior: 'smooth' });
      });
      nextBtn2.addEventListener('click', () => {
        const first = container2.querySelector('.owndays-item');
        if (!first) return;
        const cardWidth = first.offsetWidth + 15;
        container2.scrollBy({ left: cardWidth, behavior: 'smooth' });
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadHomepageCards();
    bindScrollButtons();
  });
})();

