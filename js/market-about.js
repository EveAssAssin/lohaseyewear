/* =========================================================
 * market-about.js · 創作者專區頁面互動
 * 1. Scroll spy:nav 跟著滾動高亮
 * 2. 平滑跳轉
 * 3. 創作者牆:從 Supabase 撈 active 創作者 + 姓名遮蔽
 * ========================================================= */

(function(){
  'use strict';

  // ===========================================================
  // 姓名遮蔽 (台灣個資保護慣例)
  // 2 字:王芳 → 王＊
  // 3 字:張右筠 → 張＊筠
  // 4+:林志玲玲 → 林＊＊玲
  // ===========================================================
  function maskName(name){
    if (!name) return '匿名';
    var n = String(name).trim();
    if (n.length <= 1) return n;
    if (n.length === 2) return n[0] + '＊';
    // 3 字以上:留首末、中間全 ＊
    var mid = '＊'.repeat(n.length - 2);
    return n[0] + mid + n[n.length - 1];
  }


  // ===========================================================
  // Scroll Spy
  // ===========================================================
  function initScrollSpy(){
    var navLinks = document.querySelectorAll('.mab-nav a[data-tab]');
    var sections = ['creator', 'guide', 'faq'].map(function(id){
      return document.getElementById(id);
    }).filter(Boolean);

    if (!navLinks.length || !sections.length) return;

    navLinks.forEach(function(a){
      a.addEventListener('click', function(e){
        e.preventDefault();
        var target = document.getElementById(this.dataset.tab);
        if (!target) return;
        var top = target.getBoundingClientRect().top + window.scrollY - 80;
        window.scrollTo({ top: top, behavior: 'smooth' });
      });
    });

    function updateActive(){
      var scrollY = window.scrollY + 120;
      var current = sections[0].id;
      sections.forEach(function(sec){
        if (sec.offsetTop <= scrollY) current = sec.id;
      });
      navLinks.forEach(function(a){
        a.classList.toggle('active', a.dataset.tab === current);
      });
    }

    var ticking = false;
    window.addEventListener('scroll', function(){
      if (!ticking) {
        window.requestAnimationFrame(function(){ updateActive(); ticking = false; });
        ticking = true;
      }
    });
    updateActive();
  }


  // ===========================================================
  // 創作者牆 · 從 Supabase 真實連動
  // 撈 engraving_designs 表所有 approved 作品的 designer_name,
  // 去重後產出創作者清單
  // ===========================================================
  async function loadCreators(){
    var wall = document.getElementById('creatorsWall');
    if (!wall) return;

    try {
      var sb = window.LohasApi && window.LohasApi.supabase;
      if (!sb) {
        // 等 LohasApi 初始化
        await new Promise(function(resolve){
          var t = 0;
          var tk = setInterval(function(){
            if (window.LohasApi && window.LohasApi.supabase) {
              clearInterval(tk);
              sb = window.LohasApi.supabase;
              resolve();
            } else if (++t > 50) {
              clearInterval(tk);
              resolve();
            }
          }, 100);
        });
      }

      if (!sb) throw new Error('Supabase 未初始化');

      // 撈所有 approved 設計的 designer_name (去重)
      var { data, error } = await sb
        .from('engraving_designs')
        .select('designer_name')
        .eq('status', 'approved')
        .not('designer_name', 'is', null);

      if (error) throw error;

      // 用 Set 去重
      var nameSet = new Set();
      (data || []).forEach(function(d){
        var name = (d.designer_name || '').trim();
        if (name) nameSet.add(name);
      });

      var names = Array.from(nameSet).sort(function(a, b){
        // 用 localeCompare 排序中文
        return a.localeCompare(b, 'zh-TW');
      });

      renderMarquee(wall, names);

    } catch (e) {
      console.error('[market-about] 撈創作者失敗:', e);
      wall.innerHTML = '<div class="creators-loading">暫無法載入創作者清單,請稍後再試</div>';
    }
  }

  // 渲染:橫排 ✱ 分隔、姓名遮蔽
  function renderMarquee(container, names){
    if (!names || !names.length) {
      container.innerHTML = '<div class="creators-loading">目前還沒有創作者加入</div>';
      return;
    }

    var maskedNames = names.map(maskName);
    var html = '<div class="creators-line">';
    html += maskedNames.map(function(n){
      return '<span class="creator-name-chip">' + escapeHtml(n) + '</span>';
    }).join('<span class="creators-sep">✱</span>');
    html += '</div>';
    html += '<div class="creators-count">共 ' + names.length + ' 位創作者已加入樂活</div>';

    container.innerHTML = html;
  }


  // ===========================================================
  // Utils
  // ===========================================================
  function escapeHtml(s){
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }


  // FAQ tab 切換
  function initFaqTabs(){
    var tabs = document.querySelectorAll('.faq-tab');
    var panels = document.querySelectorAll('.faq-panel');
    if(!tabs.length) return;
    tabs.forEach(function(tab){
      tab.addEventListener('click', function(){
        var key = tab.dataset.faqTab;
        tabs.forEach(function(t){ t.classList.toggle('active', t === tab); });
        panels.forEach(function(p){ p.hidden = (p.dataset.faqPanel !== key); });
      });
    });
  }

  // ===========================================================
  // Init
  // ===========================================================
  function init(){
    initScrollSpy();
    loadCreators();
    initFaqTabs();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
