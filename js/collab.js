/* =============================================
   Lohas 聯名活動專頁 動態載入 + 渲染
   URL: collab.html?id=<slug>
   ============================================= */

(function(){
  'use strict';

  const PAGE = document.getElementById('collabPage');
  const LOADING = document.getElementById('collabLoading');
  const NOTFOUND = document.getElementById('collabNotFound');
  const CONTENT = document.getElementById('collabContent');
  const ALERT_EL = document.getElementById('cbAlert');

  // ====== 工具 ======
  function $(id){ return document.getElementById(id); }
  function setText(id, text){ const el = $(id); if(el) el.textContent = text || ''; }
  function setHTML(id, html){ const el = $(id); if(el) el.innerHTML = html || ''; }
  function showSection(id){ const el = $(id); if(el) el.style.display = ''; }
  function escapeHTML(s){
    return String(s||'').replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function toast(msg){
    if(!ALERT_EL) return;
    ALERT_EL.textContent = msg;
    ALERT_EL.classList.add('show');
    setTimeout(function(){ ALERT_EL.classList.remove('show'); }, 2200);
  }

  // ====== URL slug ======
  const urlParams = new URLSearchParams(window.location.search);
  const slug = urlParams.get('id') || urlParams.get('slug');

  if(!slug){
    showNotFound();
    return;
  }

  // ====== Supabase ======
  function getClient(){
    return window.LohasSupabase && window.LohasSupabase.getClient && window.LohasSupabase.getClient();
  }

  // ====== 主流程 ======
  async function load(){
    const sb = getClient();
    if(!sb){
      console.error('[collab] Supabase 未配置');
      showNotFound();
      return;
    }

    try {
      // 1. 主 collab
      const { data: collab, error: e1 } = await sb
        .from('collabs')
        .select('*')
        .eq('slug', slug)
        .maybeSingle();

      if(e1 || !collab){
        console.warn('[collab] not found', slug, e1);
        showNotFound();
        return;
      }

      // 2. 並行抓子表
      const [pkgRes, designRes, photoRes] = await Promise.all([
        sb.from('collab_packages').select('*').eq('collab_id', collab.id).order('sort_order'),
        sb.from('collab_designs').select('*').eq('collab_id', collab.id).order('sort_order'),
        sb.from('collab_customer_photos').select('*').eq('collab_id', collab.id).order('sort_order')
      ]);

      render(collab, pkgRes.data || [], designRes.data || [], photoRes.data || []);
    } catch (err) {
      console.error('[collab] load err', err);
      showNotFound();
    }
  }

  // ====== 渲染 ======
  function render(collab, packages, designs, photos){
    // 主題色票
    applyTheme(collab.theme_primary, collab.theme_accent, collab.theme_bg);

    // 標題列 (browser tab)
    document.title = (collab.hero_title || collab.brand_name) + ' | LOHAS 樂活眼鏡';

    // ====== Hero ======
    if(collab.hero_eyebrow){
      setText('heroEb', spaceLetters(collab.hero_eyebrow));
    }
    setHTML('heroTitle', renderHeroTitle(collab.hero_title));
    setText('heroSub', collab.hero_subtitle);

    const heroImgEl = $('heroImg');
    if(collab.hero_image_url){
      heroImgEl.innerHTML = '<img src="' + escapeHTML(collab.hero_image_url) + '" alt="' + escapeHTML(collab.brand_name) + '" />';
      heroImgEl.classList.add('has-img');
    } else {
      heroImgEl.textContent = '[ 主視覺大圖 ]';
    }

    // ====== 倒數 ======
    if(collab.show_countdown && collab.end_date){
      $('countdownWrap').style.display = '';
      startCountdown(collab.end_date);
    }

    // ====== 預購 / 門市按鈕 ======
    const preBtn = $('preorderBtn');
    if(collab.preorder_link){
      preBtn.href = collab.preorder_link;
    } else {
      preBtn.addEventListener('click', function(e){
        e.preventDefault();
        toast('預約預購表單會開啟,需登入會員');
      });
    }

    const storeBtn = $('storeBtn');
    if(collab.store_link){
      storeBtn.href = collab.store_link;
    } else {
      storeBtn.addEventListener('click', function(e){
        e.preventDefault();
        toast('跳轉到指定門市地圖');
      });
    }

    // ====== Meta bar (限量資訊) ======
    if(collab.show_limit){
      renderMetaBar(collab);
    }

    // ====== Story ======
    if(collab.story_paragraphs && collab.story_paragraphs.length){
      renderStory(collab.story_paragraphs, collab.story_image_url);
      showSection('storySec');
    }

    // ====== Package ======
    if(packages.length){
      renderPackages(packages);
      showSection('pkgSec');
    }

    // ====== Designs ======
    if(designs.length){
      renderDesigns(designs);
      showSection('designSec');
    }

    // ====== Interview ======
    if(collab.creator_name || collab.interview_title){
      renderInterview(collab);
      showSection('interviewSec');
    }

    // ====== Customer Photos ======
    if(photos.length){
      renderPhotos(photos);
      $('photoSecTitle').textContent = photos.length + ' 位客人已分享';
      showSection('photoSec');
    }

    // ====== Bottom CTA ======
    renderBottomCta(collab);

    // ====== 顯示 ======
    LOADING.style.display = 'none';
    CONTENT.style.display = '';
    PAGE.style.opacity = '1';
  }

  function applyTheme(primary, accent, bg){
    const root = document.documentElement;
    if(primary) root.style.setProperty('--cb-primary', primary);
    if(accent) root.style.setProperty('--cb-accent', accent);
    if(bg) root.style.setProperty('--cb-bg', bg);
  }

  function spaceLetters(str){
    // "LIMITED EDITION · 200 套" → "L I M I T E D ..."  (用 letter-spacing CSS 做更好,但簡單版用空格)
    return str;
  }

  function renderHeroTitle(t){
    // 把 × 圍特殊 class,做斜體紫色
    if(!t) return '';
    return escapeHTML(t).replace(/\s*×\s*/g, '<span class="cb-x">×</span>');
  }

  function renderMetaBar(c){
    const bar = $('metaBar');
    const items = [];
    if(c.limit_total){
      items.push({ lab:'限 量', val: c.limit_total + ' 套' });
    }
    if(c.preorder_count){
      items.push({ lab:'已 預 約', val: c.preorder_count + ' 位' });
      const left = (c.limit_total || 0) - c.preorder_count;
      if(left > 0) items.push({ lab:'剩 餘', val: left + ' 套' });
    }
    if(c.launch_date_text){
      items.push({ lab:'上 市', val: c.launch_date_text });
    }
    if(c.available_stores){
      items.push({ lab:'限 定 門 市', val: c.available_stores });
    }
    if(!items.length){ bar.style.display='none'; return; }

    bar.innerHTML = items.map(function(it){
      return '<div>' + escapeHTML(it.lab) + '<b>' + escapeHTML(it.val) + '</b></div>';
    }).join('');
  }

  function renderStory(paragraphs, imgUrl){
    const imgEl = $('storyImg');
    if(imgUrl){
      imgEl.innerHTML = '<img src="' + escapeHTML(imgUrl) + '" alt="" />';
      imgEl.classList.add('has-img');
    } else {
      imgEl.textContent = '[ 故事圖 ]';
    }

    const html = paragraphs.map(function(p){
      if(p.type === 'quote'){
        return '<p class="cb-story-quote">' + escapeHTML(p.text) + '</p>';
      }
      return '<p>' + escapeHTML(p.text) + '</p>';
    }).join('');
    setHTML('storyContent', html);
  }

  function renderPackages(packages){
    const grid = $('pkgGrid');
    grid.innerHTML = packages.map(function(p){
      const img = p.image_url
        ? '<img src="' + escapeHTML(p.image_url) + '" alt="" />'
        : '[ ' + escapeHTML(p.name) + ' ]';
      return '<div class="cb-pkg">'
        + '<div class="cb-pkg-img">' + img + '</div>'
        + '<div class="cb-pkg-name">' + escapeHTML(p.name) + '</div>'
        + (p.meta ? '<div class="cb-pkg-meta">' + escapeHTML(p.meta) + '</div>' : '')
        + '</div>';
    }).join('');
  }

  function renderDesigns(designs){
    const grid = $('iconGrid');
    grid.innerHTML = designs.map(function(d, i){
      const img = d.preview_image_url
        ? '<img src="' + escapeHTML(d.preview_image_url) + '" alt="" />'
        : '';
      return '<div class="cb-icon' + (i===0 ? ' on' : '') + '" data-label="' + escapeHTML(d.label) + '">'
        + img
        + '<span>' + escapeHTML(d.label) + '</span>'
        + '</div>';
    }).join('');

    grid.querySelectorAll('.cb-icon').forEach(function(icon){
      icon.addEventListener('click', function(){
        grid.querySelectorAll('.cb-icon').forEach(function(x){ x.classList.remove('on'); });
        icon.classList.add('on');
        toast('預覽切換:' + icon.dataset.label);
      });
    });

    $('designSecTitle').textContent = designs.length + ' 款圖案任選一款';
  }

  function renderInterview(c){
    if(c.creator_avatar_url){
      $('ivAvatar').innerHTML = '<img src="' + escapeHTML(c.creator_avatar_url) + '" alt="" />';
      $('ivAvatar').classList.add('has-img');
    } else {
      $('ivAvatar').textContent = '[ ' + escapeHTML(c.creator_name || '創作者') + ' ]';
    }
    setText('ivSubtitle', c.creator_subtitle);
    setText('ivTitle', c.interview_title);
    setText('ivQuote', c.interview_quote);

    const box = $('interviewBox');
    if(c.interview_full_link){
      box.href = c.interview_full_link;
    } else {
      box.addEventListener('click', function(e){
        e.preventDefault();
        toast('完整訪談連結尚未設定');
      });
    }
  }

  function renderPhotos(photos){
    const grid = $('galGrid');
    grid.innerHTML = photos.slice(0, 9).map(function(p){
      return '<div class="cb-gal"><img src="' + escapeHTML(p.image_url) + '" alt="' + escapeHTML(p.caption || '') + '" /></div>';
    }).join('') + '<a class="cb-gal cb-gal-more" href="gallery.html">查看全部 →</a>';
  }

  function renderBottomCta(c){
    let h2 = '一起參與這個聯名';
    let p = '預約專屬於你的限定組合';

    if(c.show_limit && c.limit_total){
      const left = (c.limit_total || 0) - (c.preorder_count || 0);
      if(left > 0){
        h2 = '還剩 ' + left + ' 套';
      }
    }

    if(c.date_range_text){
      p = c.date_range_text + ' · 限定門市憑會員預約購買';
    } else if(c.launch_date_text){
      p = '上市 ' + c.launch_date_text + ' · 限定門市憑會員預約購買';
    }

    $('bottomCtaH').textContent = h2;
    $('bottomCtaP').textContent = p;

    const btn = $('bottomPreorderBtn');
    if(c.preorder_link){
      btn.href = c.preorder_link;
    } else {
      btn.addEventListener('click', function(e){
        e.preventDefault();
        toast('預約預購表單會開啟,需登入會員');
      });
    }
  }

  // ====== 倒數 ======
  function startCountdown(endDate){
    const end = new Date(endDate).getTime();
    function tick(){
      const now = Date.now();
      const diff = end - now;
      if(diff <= 0){
        $('cdDays').textContent = '00';
        $('cdHours').textContent = '00';
        $('cdMin').textContent = '00';
        $('cdSec').textContent = '00';
        return;
      }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      $('cdDays').textContent = String(d).padStart(2, '0');
      $('cdHours').textContent = String(h).padStart(2, '0');
      $('cdMin').textContent = String(m).padStart(2, '0');
      $('cdSec').textContent = String(s).padStart(2, '0');
    }
    tick();
    setInterval(tick, 1000);
  }

  function showNotFound(){
    LOADING.style.display = 'none';
    NOTFOUND.style.display = '';
    PAGE.style.opacity = '1';
  }

  // ====== Init ======
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }

})();
