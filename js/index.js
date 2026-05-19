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

    const nowIso = new Date().toISOString();
    const { data, error } = await sb
      .from('news')
      .select('slug, title, homepage_tag, homepage_subtitle, homepage_image_url, cover_image_url, excerpt, category, published_at')
      .or('status.eq.published,and(status.eq.scheduled,published_at.lte.' + nowIso + ')')
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

  async function loadHomeMainBanner() {
    const section = document.getElementById('homeMainBannerSection');
    const track = document.getElementById('homeMainBannerTrack');
    const dots = document.getElementById('homeMainBannerDots');
    if (!section || !track) return;

    const sb = window.LohasSupabase && window.LohasSupabase.getClient && window.LohasSupabase.getClient();
    if (!sb) return;

    const { data, error } = await sb.from('banners')
      .select('*')
      .eq('position', 'home_main')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error || !data || !data.length) {
      section.style.display = 'none';
      return;
    }

    section.style.display = '';

    track.innerHTML = data.map((b, i) => {
      const href = b.link_url || '#';
      const target = b.link_url ? ' target="_blank" rel="noopener"' : '';
      const cta = b.cta_text
        ? `<a href="${escapeHtml(href)}" class="hmb-cta"${target}>${escapeHtml(b.cta_text)} <span>→</span></a>`
        : '';
      const overlay = (b.title || b.subtitle || b.cta_text)
        ? `<div class="hmb-overlay">
             ${b.title ? `<h2 class="hmb-title">${escapeHtml(b.title)}</h2>` : ''}
             ${b.subtitle ? `<p class="hmb-subtitle">${escapeHtml(b.subtitle)}</p>` : ''}
             ${cta}
           </div>`
        : '';
      return `<div class="hmb-slide${i === 0 ? ' on' : ''}" data-idx="${i}">
        ${b.image_url ? `<img src="${escapeHtml(b.image_url)}" alt="${escapeHtml(b.title || '')}">` : ''}
        ${overlay}
      </div>`;
    }).join('');

    if (data.length > 1) {
      dots.innerHTML = data.map((_, i) =>
        `<button class="hmb-dot${i === 0 ? ' on' : ''}" data-idx="${i}" aria-label="第 ${i+1} 張"></button>`
      ).join('');

      let current = 0;
      const slides = track.querySelectorAll('.hmb-slide');
      const dotBtns = dots.querySelectorAll('.hmb-dot');
      const prevBtn = document.getElementById('homeMainBannerPrev');
      const nextBtn = document.getElementById('homeMainBannerNext');

      function goTo(idx) {
        current = (idx + slides.length) % slides.length;
        slides.forEach((s, i) => s.classList.toggle('on', i === current));
        dotBtns.forEach((d, i) => d.classList.toggle('on', i === current));
      }

      dotBtns.forEach((d, i) => d.addEventListener('click', () => goTo(i)));
      if (prevBtn) {
        prevBtn.style.display = '';
        prevBtn.addEventListener('click', () => goTo(current - 1));
      }
      if (nextBtn) {
        nextBtn.style.display = '';
        nextBtn.addEventListener('click', () => goTo(current + 1));
      }

      // 自動輪播
      setInterval(() => goTo(current + 1), 5000);
    } else {
      dots.innerHTML = '';
      // 只有 1 張不顯示箭頭
      const prevBtn = document.getElementById('homeMainBannerPrev');
      const nextBtn = document.getElementById('homeMainBannerNext');
      if (prevBtn) prevBtn.style.display = 'none';
      if (nextBtn) nextBtn.style.display = 'none';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadHomepageCards();
    bindScrollButtons();
    loadHomeMainBanner();
  });
})();

