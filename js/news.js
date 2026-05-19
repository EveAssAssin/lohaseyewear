/* =============================================================
   最新消息列表頁 · news.js
   ============================================================= */

(function () {
  'use strict';

  const CAT_LABEL = {
    story: '品牌故事',
    event: '活動優惠',
    engraving: '雷刻服務',
    people: '人物誌',
    member: '會員專區',
    official: '官方公告'
  };

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatDate(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return y + '.' + m + '.' + day;
    } catch { return ''; }
  }

  let allNews = [];
  let currentFilter = 'all';
  let visibleCount = 12;

  function renderList() {
    const grid = document.getElementById('newsGrid');
    const loading = document.getElementById('newsLoading');
    const empty = document.getElementById('newsEmpty');
    if (!grid) return;

    if (loading) loading.style.display = 'none';

    // 1. 處理「本月精選」(只取一篇,放在頁面上方 featured 區)
    renderFeatured();

    // 2. 列表排除精選那篇,並套用篩選
    const featuredId = (allNews.find(n => n.is_featured) || {}).id;
    const filtered = (currentFilter === 'all'
      ? allNews
      : allNews.filter(n => n.category === currentFilter)
    ).filter(n => n.id !== featuredId);

    grid.querySelectorAll('.news-card').forEach(el => el.remove());

    if (!filtered.length) {
      if (empty) empty.style.display = '';
      return;
    }

    if (empty) empty.style.display = 'none';

    const visible = filtered.slice(0, visibleCount);

    const html = visible.map(n => {
      const slug = escapeHtml(n.slug);
      const href = 'news-detail.html?id=' + slug;
      return '<article class="news-card" data-category="' + escapeHtml(n.category) + '">' +
        '<a href="' + href + '" class="news-card__image">' +
          (n.cover_image_url
            ? '<img src="' + escapeHtml(n.cover_image_url) + '" alt="' + escapeHtml(n.title) + '">'
            : '<div class="news-card__placeholder"></div>'
          ) +
        '</a>' +
        '<div class="news-card__body">' +
          '<div class="post-meta">' +
            '<span class="post-tag">' + escapeHtml(CAT_LABEL[n.category] || n.category) + '</span>' +
            '<span class="post-date">' + formatDate(n.published_at || n.created_at) + '</span>' +
          '</div>' +
          '<h3><a href="' + href + '">' + escapeHtml(n.title) + '</a></h3>' +
          '<p>' + escapeHtml(n.excerpt || '') + '</p>' +
          '<a href="' + href + '" class="post-readmore card-readmore">READ MORE <span>→</span></a>' +
        '</div>' +
      '</article>';
    }).join('');

    if (loading) {
      loading.insertAdjacentHTML('beforebegin', html);
    } else {
      grid.insertAdjacentHTML('afterbegin', html);
    }

    // load more 顯隱
    const loadMoreWrap = document.querySelector('.news-load-more-wrap');
    if (loadMoreWrap) {
      loadMoreWrap.style.display = filtered.length > visibleCount ? '' : 'none';
    }
  }

  function renderFeatured() {
    const section = document.getElementById('newsFeaturedSection');
    const slot = document.getElementById('newsFeaturedSlot');
    if (!section || !slot) return;

    const featured = allNews.find(n => n.is_featured);
    if (!featured) {
      section.style.display = 'none';
      return;
    }

    section.style.display = '';
    const href = 'news-detail.html?id=' + escapeHtml(featured.slug);
    slot.innerHTML =
      '<article class="featured-post">' +
        '<a href="' + href + '" class="featured-post__media">' +
          (featured.cover_image_url
            ? '<img src="' + escapeHtml(featured.cover_image_url) + '" alt="' + escapeHtml(featured.title) + '">'
            : '<div class="news-card__placeholder" style="width:100%;height:100%"></div>'
          ) +
        '</a>' +
        '<div class="featured-post__body">' +
          '<div class="post-meta">' +
            '<span class="post-tag">' + escapeHtml(CAT_LABEL[featured.category] || featured.category) + '</span>' +
            '<span class="post-date">' + formatDate(featured.published_at || featured.created_at) + '</span>' +
          '</div>' +
          '<h3><a href="' + href + '">' + escapeHtml(featured.title) + '</a></h3>' +
          '<p>' + escapeHtml(featured.excerpt || '') + '</p>' +
          '<a href="' + href + '" class="post-readmore">READ MORE <span>→</span></a>' +
        '</div>' +
      '</article>';
  }

  async function loadNews() {
    const sb = window.LohasSupabase && window.LohasSupabase.getClient && window.LohasSupabase.getClient();
    if (!sb) {
      const loading = document.getElementById('newsLoading');
      if (loading) loading.innerHTML = '<p style="text-align:center;color:#888;padding:60px 0">系統暫時無法使用</p>';
      return;
    }

    const { data, error } = await sb
      .from('news')
      .select('*')
      .eq('status', 'published')
      .order('published_at', { ascending: false });

    if (error) {
      console.error('[載入消息失敗]', error);
      const loading = document.getElementById('newsLoading');
      if (loading) loading.innerHTML = '<p style="text-align:center;color:#888;padding:60px 0">載入失敗</p>';
      return;
    }

    allNews = data || [];
    renderList();
  }

  function bindFilters() {
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter || 'all';
        visibleCount = 12;
        renderList();
      });
    });

    const loadMoreBtn = document.getElementById('loadMoreBtn');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', () => {
        visibleCount += 12;
        renderList();
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindFilters();
    loadNews();
  });
})();
