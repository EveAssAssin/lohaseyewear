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
    const container = document.getElementById('newsCarouselTrack');
    if (!container) return;

    const sb = window.LohasSupabase && window.LohasSupabase.getClient && window.LohasSupabase.getClient();
    if (!sb) {
      container.innerHTML = '';
      return;
    }

    const nowIso = new Date().toISOString();
    const { data, error } = await sb
      .from('news')
      .select('slug, title, homepage_tag, homepage_subtitle, homepage_image_url, cover_image_url, excerpt, category, published_at, homepage_link_type, homepage_link_url')
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

    // 格式化日期 yyyy.MM.dd
    function fmtDate(d) {
      if (!d) return '';
      try {
        const dt = new Date(d);
        const y = dt.getFullYear();
        const m = String(dt.getMonth() + 1).padStart(2, '0');
        const day = String(dt.getDate()).padStart(2, '0');
        return y + '.' + m + '.' + day;
      } catch { return ''; }
    }

    const html = data.map(n => {
      const img = n.homepage_image_url || n.cover_image_url;
      // 連結:後台指定「custom」且填了 link_url 就用,否則跳 news-detail
      let href;
      if (n.homepage_link_type === 'custom' && n.homepage_link_url) {
        href = n.homepage_link_url;
      } else {
        href = 'news-detail.html?id=' + escapeHtml(n.slug);
      }
      const tag = n.homepage_tag || '';
      const sub = n.homepage_subtitle || n.excerpt || '';
      const date = fmtDate(n.published_at);
      return '<a href="' + escapeHtml(href) + '" class="home-carousel-card">' +
        '<div class="card-overlay">' +
          '<div class="card-meta">' +
            (tag ? '<span class="tag">' + escapeHtml(tag) + '</span>' : '') +
            (date ? '<span class="card-date">' + date + '</span>' : '') +
          '</div>' +
          '<h2>' + escapeHtml(n.title) + '</h2>' +
          (sub ? '<p>' + escapeHtml(sub) + '</p>' : '') +
          '<span class="btn-more"><span class="btn-more-text">VIEW MORE</span></span>' +
        '</div>' +
        (img ? '<img src="' + escapeHtml(img) + '" alt="' + escapeHtml(n.title) + '">' : '') +
      '</a>';
    }).join('');

    container.innerHTML = html;
  }

  // ===== 滑動箭頭按鈕 =====
  function bindScrollButtons() {
    const container1 = document.getElementById('newsCarouselTrack');
    const prevBtn1 = document.querySelector('.prev-btn');
    const nextBtn1 = document.querySelector('.next-btn');

    if (container1 && prevBtn1 && nextBtn1) {
      prevBtn1.addEventListener('click', () => {
        const first = container1.querySelector('.home-carousel-card');
        if (!first) return;
        const cardWidth = first.offsetWidth + 15;
        container1.scrollBy({ left: -cardWidth, behavior: 'smooth' });
      });
      nextBtn1.addEventListener('click', () => {
        const first = container1.querySelector('.home-carousel-card');
        if (!first) return;
        const cardWidth = first.offsetWidth + 15;
        container1.scrollBy({ left: cardWidth, behavior: 'smooth' });
      });
    }

    // 第二組 (商店街/AI鏡片)
    const container2 = document.getElementById('extraCardsTrack');
    const prevBtn2 = document.querySelector('.prev-btn-2');
    const nextBtn2 = document.querySelector('.next-btn-2');

    if (container2 && prevBtn2 && nextBtn2) {
      prevBtn2.addEventListener('click', () => {
        const first = container2.querySelector('.home-carousel-card');
        if (!first) return;
        const cardWidth = first.offsetWidth + 15;
        container2.scrollBy({ left: -cardWidth, behavior: 'smooth' });
      });
      nextBtn2.addEventListener('click', () => {
        const first = container2.querySelector('.home-carousel-card');
        if (!first) return;
        const cardWidth = first.offsetWidth + 15;
        container2.scrollBy({ left: cardWidth, behavior: 'smooth' });
      });
    }
  }

  async function loadHomeMainBanner() {
    const wrap = document.getElementById('homeMainBannerWrap');
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
      if (wrap) wrap.style.display = 'none';
      return;
    }

    if (wrap) wrap.style.display = '';

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

      // 圖片:有手機版圖時用 picture 切換,沒有就單一 img
      let imgHtml = '';
      if (b.image_url) {
        if (b.image_url_mobile) {
          imgHtml = `<picture>
            <source media="(max-width: 768px)" srcset="${escapeHtml(b.image_url_mobile)}">
            <img src="${escapeHtml(b.image_url)}" alt="${escapeHtml(b.title || '')}">
          </picture>`;
        } else {
          imgHtml = `<img src="${escapeHtml(b.image_url)}" alt="${escapeHtml(b.title || '')}">`;
        }
      }

      // 有手機圖時,slide 加 class 讓 CSS 切換 aspect-ratio
      const hasMobileImg = b.image_url_mobile ? ' has-mobile-img' : '';
      return `<div class="hmb-slide${i === 0 ? ' on' : ''}${hasMobileImg}" data-idx="${i}">
        ${imgHtml}
        ${overlay}
      </div>`;
    }).join('');

    if (data.length > 1) {
      dots.style.display = '';
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
      dots.style.display = 'none';
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

