/* 聯名活動列表 - Zoff 風 4 大分類 */
(function(){
  'use strict';

  const $ = id => document.getElementById(id);
  const LOADING = $('clLoading');
  const EMPTY = $('clEmpty');
  const WRAP = $('clCategoriesWrap');
  const ANCHOR_ROW = $('clAnchorRow');
  const ANCHOR_LIST = $('clAnchorList');

  const CATEGORIES = [
    { id: 'fashion',   label_en: 'FASHION / SPORTS',  label_zh: '時尚 / 運動' },
    { id: 'character', label_en: 'CHARACTER',         label_zh: '角色' },
    { id: 'anime',     label_en: 'ANIME / GAME',      label_zh: '動畫 / 遊戲' }
  ];

  function esc(s){
    return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function getClient(){
    return window.LohasSupabase?.getClient?.();
  }

  async function load(){
    const sb = getClient();
    if(!sb){
      LOADING.innerHTML = '<p>Supabase 未配置</p>';
      return;
    }

    try {
      const { data, error } = await sb
        .from('collabs')
        .select('*')
        .in('status', ['active', 'upcoming', 'ended'])
        .or('is_locked.is.null,is_locked.eq.false')  // 排除範例
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false });

      if(error) throw error;
      render(data || []);
    } catch(err){
      console.error('[collabs] load err', err);
      LOADING.innerHTML = '<p>載入失敗</p>';
    }
  }

  function render(collabs){
    LOADING.style.display = 'none';

    if(!collabs.length){
      EMPTY.style.display = '';
      return;
    }

    const grouped = {};
    CATEGORIES.forEach(cat => { grouped[cat.id] = []; });
    collabs.forEach(c => {
      const cat = c.category || 'character';
      if(grouped[cat]) grouped[cat].push(c);
    });

    const hasCategories = CATEGORIES.filter(cat => grouped[cat.id].length > 0);
    if(!hasCategories.length){ EMPTY.style.display = ''; return; }

    ANCHOR_LIST.innerHTML = hasCategories.map(cat =>
      `<a href="#cat-${cat.id}" class="cl-anchor-link" data-cat="${cat.id}">${esc(cat.label_en)}</a>`
    ).join('');
    ANCHOR_ROW.style.display = '';

    WRAP.innerHTML = hasCategories.map(cat => renderCategory(cat, grouped[cat.id])).join('');
    WRAP.style.display = '';

    bindScroll();
  }

  function renderCategory(cat, items){
    const cards = items.map(renderCard).join('');
    return `
      <section class="cl-cat-section" id="cat-${esc(cat.id)}">
        <div class="cl-cat-head">
          <h2 class="cl-cat-h">${esc(cat.label_en)}</h2>
          <p class="cl-cat-zh">${esc(cat.label_zh)}</p>
        </div>
        <div class="cl-cat-grid">
          ${cards}
        </div>
      </section>
    `;
  }

  function renderCard(c){
    const heroImg = c.hero_image_url
      ? `<img src="${esc(c.hero_image_url)}" alt="${esc(c.brand_name)}">`
      : `<div class="cl-card-img-fallback" style="background:${esc(c.theme_accent || '#F8E4ED')};color:${esc(c.theme_primary || '#7A2754')}">${esc(c.brand_name)}</div>`;

    const STATUS_LABEL = { active: '進行中', upcoming: '即將推出', ended: '已結束' };

    return `
      <a href="collab.html?id=${esc(c.slug)}" class="cl-card">
        <div class="cl-card-img">
          ${heroImg}
          ${c.status !== 'active' ? `<span class="cl-card-status cl-st-${esc(c.status)}">${esc(STATUS_LABEL[c.status])}</span>` : ''}
        </div>
        <div class="cl-card-body">
          <div class="cl-card-brand">${esc(c.brand_name)}</div>
          <div class="cl-card-h">${esc(c.hero_title || c.brand_name)}</div>
          ${c.hero_subtitle ? `<p class="cl-card-sub">${esc(c.hero_subtitle)}</p>` : ''}
          ${c.date_range_text ? `<p class="cl-card-date">${esc(c.date_range_text)}</p>` : ''}
        </div>
      </a>
    `;
  }

  function bindScroll(){
    document.querySelectorAll('.cl-anchor-link').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        const target = document.querySelector(link.getAttribute('href'));
        if(!target) return;
        const top = target.getBoundingClientRect().top + window.pageYOffset - 130;
        window.scrollTo({ top, behavior: 'smooth' });
      });
    });

    const sections = document.querySelectorAll('.cl-cat-section');
    const links = document.querySelectorAll('.cl-anchor-link');

    function updateActive(){
      const scrollY = window.pageYOffset + 200;
      let active = sections[0]?.id;
      sections.forEach(sec => {
        if(sec.offsetTop <= scrollY) active = sec.id;
      });
      links.forEach(link => {
        link.classList.toggle('active', link.getAttribute('href') === '#' + active);
      });
    }
    updateActive();
    window.addEventListener('scroll', updateActive, { passive: true });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
