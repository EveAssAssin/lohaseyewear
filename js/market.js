/* =============================================================
   創作者刻圖市集 · market.js (v2 - legacy 圖庫適配)
   -------------------------------------------------------------
   功能:
   - 從 Supabase engraving_designs 載入 260+ 件設計 (status='approved')
   - 對齊新 schema 欄位:
       name, slogan, keywords, designer_name, category,
       image_url (jpg), image_url_png (透明底雷雕用),
       like_count, share_count, collect_count,
       legacy_id, detail_url, type
   - 全部歸類為 Creator (Member/Collab 之後再加)
   - 卡片顯示:name 主標 + slogan 子標
   - Modal 詳情、我的最愛刻圖、Toast 維持
   ============================================================= */

(function(){
  'use strict';

  // ===== State =====
  var State = {
    designs: [],
    collabs: [],
    allCollabs: [],
    wishlistIds: new Set(),
    activeTier: 'all',
    searchTerm: '',
    member: null,
  };

  var root, ovl, toast;

  // 全部歸創作者
  var DEFAULT_TIER = 'creator';
  var tierName = { creator:'Creator' };
  var tierIcon = { creator: '<i class="fa-solid fa-star"></i>' };


  // ===== DOM Ready =====
  document.addEventListener('DOMContentLoaded', init);

  async function init(){
    root  = document.getElementById('cm');
    ovl   = document.getElementById('ovl');
    toast = document.getElementById('toast');
    if(!root) return;

    try {
      // 對齊專案實際的 auth wrapper
      State.member = window.LohasAuth?.getMember?.()
                  || window.Auth?.getStoredMember?.()
                  || JSON.parse(localStorage.getItem('lohasMember') || 'null');
    } catch(e){ State.member = null }

    bindEvents();

    try {
      await loadFromSupabase();
      console.log('[market] 載入', State.designs.length, '件設計');
    } catch(e) {
      console.error('[market] Supabase 載入失敗:', e);
      showToast('載入失敗,請重新整理');
      return;
    }

    try {
      await loadCollabsFromSupabase();
      console.log('[market] 載入', State.collabs.length, '個聯名');
    } catch(e) {
      console.warn('[market] 聯名載入失敗:', e);
    }

    await renderFeatured();
    renderAllSections();
    if(State.member) await loadWishlist();

    // 監聽上傳成功事件 - 提示使用者
    window.addEventListener('lohas:design-upload-success', function(){
      showToast('設計已送出審核,通過後會出現在市集');
    });
  }


  // ===== Supabase 載入 =====
  async function loadFromSupabase(){
    // 對齊 v2 專案實際的 supabase.js wrapper
    var sb = window.LohasSupabase?.getClient?.()
          || window.Supabase?.client
          || window.supabase;
    if(!sb || typeof sb.from !== 'function') {
      throw new Error('Supabase client 取得失敗,檢查 supabase.js 是否載入');
    }

    var { data, error } = await sb
      .from('engraving_designs')
      .select(`
        id, legacy_id, name, slogan, keywords, designer_name, category,
        image_url, image_url_png, image_url_svg, like_count, share_count, collect_count,
        detail_url, type, status, created_at, creator_id
      `)
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .limit(500);

    if(error) throw error;

    // 整理 → 統一資料結構
    State.designs = (data || []).map(function(d){
      return {
        id: d.id,
        legacyId: d.legacy_id,
        name: d.name || '',
        slogan: d.slogan || '',
        keywords: d.keywords || '',
        designer: d.designer_name || '',
        category: d.category || '',
        imageJpg: d.image_url || '',
        imagePng: d.image_url_png || d.image_url || '',
        imageSvg: d.image_url_svg || '',
        likes: d.like_count || 0,
        shares: d.share_count || 0,
        collects: d.collect_count || 0,
        detailUrl: d.detail_url || '',
        // 全部歸 creator
        tier: DEFAULT_TIER,
        isLegacy: d.type === 'legacy',
      };
    });
  }

  // ===== 載入聯名 =====
  async function loadCollabsFromSupabase(){
    var sb = window.LohasSupabase?.getClient?.()
          || window.Supabase?.client
          || window.supabase;
    if(!sb || typeof sb.from !== 'function') {
      State.collabs = [];
      State.allCollabs = [];
      return;
    }

    // 進行中 (顯示在上方 market block) - active/upcoming
    var { data, error } = await sb
      .from('collabs')
      .select('id, slug, brand_name, hero_title, hero_subtitle, hero_image_url, lifecycle_status, status, sort_order')
      .in('status', ['active', 'upcoming'])
      .or('is_locked.is.null,is_locked.eq.false')
      .order('sort_order', { ascending: true });

    if(error){ console.warn('[market] collabs 讀取失敗', error); State.collabs = []; }
    else State.collabs = data || [];

    // 全部聯名 (顯示在下方授權聯名牆) - 含已結束
    var allResp = await sb
      .from('collabs')
      .select('id, slug, brand_name, hero_title, hero_image_url, creator_name, lifecycle_status, status, sort_order')
      .neq('status', 'draft')
      .neq('status', 'archived')
      .or('is_locked.is.null,is_locked.eq.false')
      .order('sort_order', { ascending: true });

    if(allResp.error){ console.warn('[market] all collabs 讀取失敗', allResp.error); State.allCollabs = []; }
    else State.allCollabs = allResp.data || [];
  }


  // ===== 本月精選 =====
  async function renderFeatured(){
    var featured = null;

    // 1. 優先讀 featured_creators table (本月由管理員指定)
    var sb = window.LohasSupabase?.getClient?.() || window.Supabase?.client;
    if(sb){
      try {
        var month = currentMonthKey();
        var fcRes = await sb.from('featured_creators')
          .select('creator_id')
          .eq('featured_month', month)
          .maybeSingle();

        if(fcRes.data?.creator_id){
          var creatorId = fcRes.data.creator_id;

          // 拿 creator_info 補頭像/介紹
          var ciRes = await sb.from('creator_info')
            .select('member_id, display_name, tagline, bio, avatar_url')
            .eq('member_id', creatorId)
            .maybeSingle();

          var ci = ciRes.data || {};

          // 算這個 creator 在當前列表內的作品數 + 統計
          var works = State.designs.filter(function(d){
            return String(d.creator_id || '') === String(creatorId);
          });
          var totalLikes    = works.reduce(function(s, w){ return s + (w.likes || 0); }, 0);
          var totalCollects = works.reduce(function(s, w){ return s + (w.collects || 0); }, 0);

          featured = {
            source:     'featured_table',
            creatorId:  creatorId,
            name:       ci.display_name || (works[0] && works[0].designer) || '創作者',
            tagline:    ci.tagline || ci.bio || '',
            avatar:     ci.avatar_url || '',
            worksCount: works.length,
            likes:      totalLikes,
            collects:   totalCollects,
            slogan:     (works[0] && works[0].slogan) || '',
          };
        }
      } catch(e){
        console.warn('[market] 讀取 featured_creators 失敗:', e);
      }
    }

    // 2. Fallback: 取 like 最高的當本月精選 (legacy 邏輯)
    if(!featured){
      var top = State.designs
        .slice()
        .sort(function(a,b){ return b.likes - a.likes; })[0];
      if(!top) return;

      featured = {
        source:     'fallback_likes',
        creatorId:  top.creator_id,
        name:       top.designer || top.name,
        tagline:    top.slogan || top.keywords || '',
        avatar:     '',
        worksCount: countByDesigner(top.designer),
        likes:      top.likes,
        collects:   top.collects,
        slogan:     top.slogan || top.keywords || '每一張設計,都是被認真活過的故事。',
      };
    }

    var setLocalText = function(id, v){
      var el = document.getElementById(id);
      if(el) el.textContent = v;
    };

    // 對齊 v18 featured-hero 結構
    setLocalText('featuredName',    maskName(featured.name));
    setLocalText('featuredTag',     '上架 ' + featured.worksCount + ' 件設計');
    setLocalText('featuredQuote',   featured.slogan || featured.tagline || '每一張設計,都是被認真活過的故事。');
    setLocalText('featuredUses',    featured.likes);
    setLocalText('featuredStories', featured.collects);

    // 頭像:有圖片就用,沒有就顯示前 2 字
    var avatar = document.getElementById('featuredAvatar');
    if(avatar){
      if(featured.avatar){
        avatar.style.backgroundImage = "url('" + featured.avatar + "')";
        avatar.style.backgroundSize = 'cover';
        avatar.style.backgroundPosition = 'center';
        avatar.textContent = '';
      } else {
        var initials = (featured.name || '?').substring(0, 2).toUpperCase();
        avatar.textContent = initials;
        avatar.style.backgroundImage = '';
      }
    }

    // 點擊跳創作者個人頁(本月精選有 creatorId 才跳)
    var hero = document.getElementById('featuredHero');
    if(hero){
      hero.addEventListener('click', function(e){
        e.preventDefault();
        if(featured.creatorId){
          window.location.href = 'creator-public.html?id=' + encodeURIComponent(featured.creatorId);
        } else {
          // Fallback (沒 creatorId,例如 legacy 沒 creator_id 的設計):用舊邏輯篩選
          State.searchTerm = featured.name;
          var input = document.getElementById('marketSearch');
          if(input) input.value = featured.name;
          applySearch();
          showToast('已篩選 ' + featured.name + ' 的作品');
        }
      });
    }
  }

  // 'YYYY-MM' 例如 '2026-05'
  function currentMonthKey(){
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function countByDesigner(designer){
    if(!designer) return 0;
    return State.designs.filter(function(d){ return d.designer === designer; }).length;
  }


  // ===== 三大區塊 grid =====
  function renderAllSections(){
    // 目前全部歸 Creator,只渲染 creator 區塊;Member/Collab 區隱藏
    var creatorList = State.designs.filter(function(d){ return d.tier === 'creator'; });

    setText('countAll',      State.designs.length);
    setText('countCreator',  creatorList.length);
    setText('countMember',   0);
    setText('countCollab',   0);

    // CTA 區塊的 KPI 數字
    setText('kpiTotalDesigns', (State.designs.length + 5000) + '+');
    setText('seeAllCreator', creatorList.length);

    // Member 區塊先隱藏 (DOM 還在,只是 display:none)
    var memberBlock = root.querySelector('.market-block[data-section="member"]');
    if(memberBlock) memberBlock.style.display = 'none';

    // Member sidebar 按鈕也隱藏
    var memberBtn = root.querySelector('.cat-btn[data-tier="member"]');
    if(memberBtn) memberBtn.closest('li').style.display = 'none';

    // 聯名區 — 有 active/upcoming 聯名才顯示
    var collabBlock = root.querySelector('.market-block[data-section="collab"]');
    var collabBtn = root.querySelector('.cat-btn[data-tier="collab"]');
    var collabCount = State.collabs ? State.collabs.length : 0;
    if(collabCount > 0){
      if(collabBlock) collabBlock.style.display = '';
      if(collabBtn){
        collabBtn.closest('li').style.display = '';
        setText('countCollab', collabCount);
      }
      renderCollabs(State.collabs);
    } else {
      if(collabBlock) collabBlock.style.display = 'none';
      if(collabBtn) collabBtn.closest('li').style.display = 'none';
    }

    // 官方授權聯名牆 (含已結束)
    renderOfficialCollabWall(State.allCollabs || []);

    // 先渲染前 9 件到 creator grid (跟原本 v18 設計一致)
    renderGrid('creator', creatorList.slice(0, 9));

    // 「顯示全部」按鈕功能 → 改成載入全部
    var seeAllBtn = root.querySelector('.market-block[data-section="creator"] .see-all');
    if(seeAllBtn){
      seeAllBtn.addEventListener('click', function(e){
        e.preventDefault();
        renderGrid('creator', creatorList);
        seeAllBtn.style.display = 'none';
      });
    }
  }

  // ===== 渲染聯名卡片 (上方 market block) =====
  function renderCollabs(list){
    var grid = root.querySelector('.design-grid[data-grid="collab"]');
    if(!grid) return;

    if(!list.length){ grid.innerHTML = ''; return; }

    var STAGE_LABEL = {
      upcoming: '即將推出',
      preorder: '預購中',
      on_sale: '販售中',
      sold_out: '已售完',
      ended: '已結束'
    };

    grid.innerHTML = list.map(function(c){
      var stage = c.lifecycle_status || 'preorder';
      var stageLabel = STAGE_LABEL[stage] || stage;
      var img = c.hero_image_url
        ? '<img src="' + escapeHtml(c.hero_image_url) + '" alt="' + escapeHtml(c.brand_name) + '" loading="lazy" />'
        : '<div class="collab-card-no-img"></div>';
      return '<a class="design-card collab-card" href="collab.html?id=' + escapeHtml(c.slug) + '">'
        + '<div class="design-card-img collab-card-img">' + img
        + '<span class="collab-stage-tag stage-' + stage + '">' + escapeHtml(stageLabel) + '</span>'
        + '</div>'
        + '<div class="design-card-body">'
        +   '<div class="design-card-name">' + escapeHtml(c.brand_name || c.hero_title || '') + '</div>'
        +   '<div class="design-card-meta">LOHAS × ' + escapeHtml(c.brand_name || '') + '</div>'
        + '</div>'
      + '</a>';
    }).join('');
  }

  // ===== 官方授權聯名牆 (深棕金邊,含已結束) =====
  function renderOfficialCollabWall(list){
    var block = document.getElementById('officialCollabBlock');
    var grid = document.getElementById('officialCollabGrid');
    if(!block || !grid) return;

    if(!list.length){
      block.style.display = 'none';
      return;
    }

    block.style.display = '';
    grid.innerHTML = list.map(function(c){
      var stage = c.lifecycle_status || 'preorder';
      var isEnded = (stage === 'ended' || stage === 'sold_out');
      var coverContent;
      if(c.hero_image_url){
        coverContent = '<img src="' + escapeHtml(c.hero_image_url) + '" alt="' + escapeHtml(c.brand_name || '') + '" loading="lazy" />';
      } else {
        // 沒圖時用品牌名大字
        var displayName = (c.brand_name || c.hero_title || '?')
          .toUpperCase()
          .split('').join(' ');
        coverContent = escapeHtml(displayName);
      }
      var creator = c.creator_name || (c.brand_name || '');
      return '<a class="collab-wall-card' + (isEnded ? ' is-ended' : '') + '" href="collab.html?id=' + escapeHtml(c.slug) + '">'
        + '<div class="collab-wall-badge"><i class="fa-solid fa-crown"></i>Collab</div>'
        + '<div class="collab-wall-cover">' + coverContent + '</div>'
        + '<div class="collab-wall-info">'
        +   '<div class="collab-wall-name">' + escapeHtml(c.brand_name || c.hero_title || '') + '</div>'
        +   '<div class="collab-wall-by">' + escapeHtml(creator) + '</div>'
        + '</div>'
      + '</a>';
    }).join('');
  }

  function renderGrid(tier, list){
    var grid = root.querySelector('.design-grid[data-grid="'+tier+'"]');
    if(!grid) return;

    if(!list.length){
      grid.innerHTML = '<div class="design-empty">這個分類還沒有作品</div>';
      return;
    }

    grid.innerHTML = list.map(function(d, idx){
      // 卡片封面優先 SVG (向量銳利) → PNG (透明底) → JPG (fallback)
      // 過濾掉空字串、'null'、'undefined' 字串
      var imgs = [d.imageSvg, d.imagePng, d.imageJpg].filter(function(u){
        return u && typeof u === 'string' && u.trim() !== '' && u !== 'null' && u !== 'undefined' && /^https?:\/\//.test(u);
      });
      var coverImg = imgs[0] || '';

      return (
        '<div class="design-card" data-id="' + escapeAttr(d.id) + '" data-tier="' + tier + '">' +
          '<div class="design-cover">' +
            '<span class="design-card-pill">' +
              '<span class="pill ' + tier + '">' + tierIcon[tier] + tierName[tier] + '</span>' +
            '</span>' +
            (coverImg
              ? '<img src="' + escapeAttr(coverImg) + '" alt="' + escapeAttr(d.name) + '" loading="lazy"' +
                ' onerror="this.style.display=\'none\';this.parentNode.classList.add(\'no-img\')">'
              : '<span class="cover-text">' + escapeHtml(d.name || '(未命名)') + '</span>'
            ) +
          '</div>' +
          '<div class="design-info">' +
            '<div class="design-name">' + escapeHtml(d.name || '(未命名)') + '</div>' +
            '<div class="design-slogan">' + escapeHtml(d.slogan || '') + '</div>' +
            '<div class="design-by">by ' + escapeHtml(maskName(d.designer) || '匿名') + '</div>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    // 綁卡片點擊
    grid.querySelectorAll('.design-card').forEach(function(card){
      card.addEventListener('click', function(){
        var id = card.dataset.id;
        var design = State.designs.find(function(x){ return String(x.id) === String(id); });
        if(design) openModal(design);
      });
    });
  }


  // ===== Sidebar 分類切換 =====
  function bindCategoryFilter(){
    root.querySelectorAll('.cat-btn').forEach(function(btn){
      btn.addEventListener('click', function(){
        root.querySelectorAll('.cat-btn').forEach(function(b){ b.classList.remove('on'); });
        btn.classList.add('on');
        State.activeTier = btn.dataset.tier;

        // 目前只有 all 和 creator,效果一樣
        root.querySelectorAll('.market-block[data-section]').forEach(function(blk){
          var section = blk.dataset.section;
          // member/collab 永遠隱藏 (目前)
          if(section !== 'creator'){
            blk.style.display = 'none';
            return;
          }
          var show = (State.activeTier === 'all' || State.activeTier === 'creator');
          blk.style.display = show ? '' : 'none';
        });
      });
    });
  }


  // ===== 搜尋 =====
  function bindSearch(){
    var input = document.getElementById('marketSearch');
    if(!input) return;
    var timer;
    input.addEventListener('input', function(){
      clearTimeout(timer);
      timer = setTimeout(function(){
        State.searchTerm = input.value.trim().toLowerCase();
        applySearch();
      }, 200);
    });
  }

  function applySearch(){
    var term = State.searchTerm.toLowerCase();
    root.querySelectorAll('.design-card').forEach(function(card){
      if(!term){ card.style.display = ''; return; }
      var id = card.dataset.id;
      var d = State.designs.find(function(x){ return String(x.id) === String(id); });
      if(!d){ card.style.display = 'none'; return; }
      var haystack = [d.name, d.slogan, d.keywords, d.designer, d.category]
        .join(' ').toLowerCase();
      card.style.display = haystack.indexOf(term) >= 0 ? '' : 'none';
    });
  }


  // ===== Modal =====
  function openModal(d){
    var tier = d.tier || 'creator';

    // 左側大圖:用 png (透明底) 比較像雷雕預覽,沒有就退 jpg
    // 過濾掉空字串/壞 URL
    var imgUrlCandidates = [d.imageSvg, d.imagePng, d.imageJpg].filter(function(u){
      return u && typeof u === 'string' && u.trim() !== '' && u !== 'null' && u !== 'undefined' && /^https?:\/\//.test(u);
    });
    var imgUrl = imgUrlCandidates[0] || '';
    var stage = document.getElementById('slide-design');
    if(stage){
      stage.style.background = '#F4F1EC';
      if(imgUrl){
        stage.innerHTML = '<img src="' + escapeAttr(imgUrl) + '" style="width:100%;height:100%;object-fit:contain" onerror="this.style.display=\'none\'">';
      } else {
        stage.innerHTML = '<span>' + escapeHtml(d.name) + '</span>';
      }
    }

    // 刻圖模擬 (第二張) - 眼鏡背景 + 刻圖縮在左鏡片
    var slideMock = document.getElementById('slide-mock');
    if(slideMock){
      slideMock.classList.add('mock-glasses');
      slideMock.style.background = '';  // 清舊的 gradient
      if(imgUrl){
        slideMock.innerHTML =
          '<div class="engrave-on-lens">' +
            '<img src="' + escapeAttr(imgUrl) + '" alt="刻圖模擬">' +
          '</div>' +
          '<div class="mock-hint">刻 在 鏡 片 左 上 · 預 覽 示 意</div>';
      } else {
        slideMock.innerHTML = '<div class="mock-hint">刻圖模擬</div>';
      }
    }

    // 縮圖用 jpg
    var thumbDesign = document.getElementById('thumb-design');
    if(thumbDesign){
      thumbDesign.style.background = '#fff';
      thumbDesign.innerHTML = imgUrl
        ? '<img src="' + escapeAttr(imgUrl) + '" style="width:100%;height:100%;object-fit:contain">'
        : '刻 圖 檔';
    }

    document.getElementById('modalPill').innerHTML =
      '<span class="pill ' + tier + '">' + tierIcon[tier] + tierName[tier] + '</span>';

    var maskedDesigner = maskName(d.designer) || '匿名';

    var avatar = document.getElementById('modalByAvatar');
    if(avatar){
      avatar.className = 'modal-by-avatar ' + tier;
      avatar.textContent = (maskedDesigner).charAt(0);
    }

    setText('modalByLabel', 'designed by · ' + tierName[tier]);
    var byNameEl = document.getElementById('modalByName');
    if(byNameEl){
      byNameEl.innerHTML = escapeHtml(maskedDesigner) +
        ' <span class="pill ' + tier + '" style="font-size:10px;padding:1.5px 7px">' +
        tierIcon[tier] + tierName[tier] + '</span>';
    }

    setText('modalTitle', d.name || '(未命名)');
    setText('modalCat', (d.category ? '#' + d.category + ' · ' : '') + (d.keywords || '客製作品'));
    setText('modalQuote', d.slogan || '每一張設計,都是被認真活過的故事。');

    setSlide('mock');

    // 我的最愛刻圖狀態
    var inWish = State.wishlistIds.has(String(d.id));
    setWishlistState(inWish);

    // 我的最愛刻圖 toggle
    document.getElementById('wishBtn').onclick = function(){
      toggleWishlist(d.id);
    };

    ovl.classList.add('show');
    ovl.setAttribute('aria-hidden', 'false');
  }

  function closeModal(){
    ovl.classList.remove('show');
    ovl.setAttribute('aria-hidden', 'true');
  }

  function setSlide(which){
    var sd = document.getElementById('slide-design');
    var sm = document.getElementById('slide-mock');
    var td = document.getElementById('thumb-design');
    var tm = document.getElementById('thumb-mock');
    if(which === 'design'){
      sd?.classList.add('on'); sm?.classList.remove('on');
      td?.classList.add('on'); tm?.classList.remove('on');
    } else {
      sm?.classList.add('on'); sd?.classList.remove('on');
      tm?.classList.add('on'); td?.classList.remove('on');
    }
  }


  // ===== Wishlist =====
  async function loadWishlist(){
    if(!State.member) return;
    var sb = window.LohasSupabase?.getClient?.() || window.Supabase?.client;
    if(!sb || typeof sb.from !== 'function') return;
    try {
      var { data } = await sb
        .from('engraving_wishlist')
        .select('design_id')
        .eq('member_id', String(State.member.erpid));
      State.wishlistIds = new Set((data || []).map(function(r){ return String(r.design_id); }));
    } catch(e){
      console.warn('[market] 我的最愛刻圖載入失敗:', e);
    }
  }

  async function toggleWishlist(designId){
    if(!State.member){
      showToast('請先登入才能加入我的最愛刻圖');
      setTimeout(function(){ window.location.href = 'login.html'; }, 1200);
      return;
    }

    var sb = window.LohasSupabase?.getClient?.() || window.Supabase?.client;
    var memberId = String(State.member.erpid);
    var idStr = String(designId);

    if(State.wishlistIds.has(idStr)){
      State.wishlistIds.delete(idStr);
      setWishlistState(false);
      showToast('已從我的最愛刻圖移除');
      if(sb){
        await sb.from('engraving_wishlist').delete()
          .eq('member_id', memberId).eq('design_id', idStr);
        // like_count -1 (用 RPC 或讀 → 寫)
        try {
          var dec = await sb.from('engraving_designs')
            .select('like_count').eq('id', idStr).single();
          if(dec?.data){
            var newCount = Math.max(0, (dec.data.like_count || 0) - 1);
            await sb.from('engraving_designs')
              .update({ like_count: newCount }).eq('id', idStr);
          }
        } catch(e){ console.warn('[wishlist] like_count -1 失敗', e); }
      }
      // 通知其他頁面 (member-portal 同視窗會自動 reload)
      window.dispatchEvent(new CustomEvent('lohas:wishlist-changed', {
        detail: { action: 'remove', designId: idStr }
      }));
    } else {
      State.wishlistIds.add(idStr);
      setWishlistState(true);
      showToast('已加入我的最愛刻圖');
      if(sb){
        await sb.from('engraving_wishlist').insert({
          member_id: memberId,
          design_id: idStr,
          created_at: new Date().toISOString(),
        });
        // like_count +1
        try {
          var inc = await sb.from('engraving_designs')
            .select('like_count').eq('id', idStr).single();
          if(inc?.data){
            var newCount = (inc.data.like_count || 0) + 1;
            await sb.from('engraving_designs')
              .update({ like_count: newCount }).eq('id', idStr);
          }
        } catch(e){ console.warn('[wishlist] like_count +1 失敗', e); }
      }
      window.dispatchEvent(new CustomEvent('lohas:wishlist-changed', {
        detail: { action: 'add', designId: idStr }
      }));
    }
  }

  function setWishlistState(inWish){
    var btn  = document.getElementById('wishBtn');
    var txt  = document.getElementById('wishText');
    var icon = btn?.querySelector('i');
    if(!btn || !txt || !icon) return;
    if(inWish){
      btn.classList.add('added');
      txt.textContent = '已 加 入 最 愛 刻 圖';
      icon.className = 'fa-solid fa-heart';
    } else {
      btn.classList.remove('added');
      txt.textContent = '加 入 我 的 最 愛 刻 圖';
      icon.className = 'fa-regular fa-heart';
    }
  }


  // ===== Toast =====
  function showToast(msg){
    var t = document.getElementById('toastText');
    if(t) t.textContent = msg;
    toast?.classList.add('show');
    setTimeout(function(){ toast?.classList.remove('show'); }, 1800);
  }


  // ===== 事件繫結 =====
  function bindEvents(){
    bindCategoryFilter();
    bindSearch();

    var closeBtn = document.getElementById('closeBtn');
    closeBtn?.addEventListener('click', closeModal);
    ovl?.addEventListener('click', closeModal);
    document.addEventListener('keydown', function(e){
      if(ovl?.classList.contains('show') && e.key === 'Escape') closeModal();
    });

    var tD = document.getElementById('thumb-design');
    var tM = document.getElementById('thumb-mock');
    tD?.addEventListener('click', function(){ setSlide('design'); });
    tM?.addEventListener('click', function(){ setSlide('mock'); });

    bindScrollToJoin();
    bindCtaUploadDesign();
  }


  // ===== CTA「開始我的創作旅程」→ 直接開上傳 modal =====
  function bindCtaUploadDesign(){
    document.querySelectorAll('[data-action="upload-design"]').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.preventDefault();

        // 未登入 → 先去登入
        var member = (window.LohasAuth?.getStoredMember?.())
                  || (function(){ try { return JSON.parse(localStorage.getItem('lohasMember')||'null'); } catch(e){ return null } })();
        if(!member?.erpid){
          // 記住要回來的位置
          try { localStorage.setItem('redirectAfterLogin', 'market.html'); } catch(e){}
          showToast('請先登入才能上傳設計');
          setTimeout(function(){ window.location.href = 'login.html'; }, 1200);
          return;
        }

        if(window.LohasUploadDesign?.openModal){
          window.LohasUploadDesign.openModal();
        } else {
          console.warn('[market] LohasUploadDesign 模組沒載入');
          // fallback 回 member-portal
          window.location.href = 'member-portal.html#my-designs';
        }
      });
    });
  }


  // ===== 滑到 CTA 浮鈕 =====
  function bindScrollToJoin(){
    var btn = document.getElementById('scrollToJoin');
    var target = document.getElementById('joinBlock');
    if(!btn || !target) return;

    // 滾動 240px 後浮出來
    function onScroll(){
      var scrolled = window.scrollY > 240;
      btn.classList.toggle('show', scrolled);

      // 進到 joinBlock 範圍時切換狀態 (icon 翻轉 + 文字改「回到頂部」)
      var rect = target.getBoundingClientRect();
      var inJoin = rect.top < window.innerHeight * 0.6;
      btn.classList.toggle('at-bottom', inJoin);

      var label = btn.querySelector('.scroll-label');
      if(label) label.textContent = inJoin ? '回到頂部' : '創作者計畫';
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    // 點擊:依當前狀態決定捲到 CTA 或頂部
    btn.addEventListener('click', function(e){
      e.preventDefault();
      if(btn.classList.contains('at-bottom')){
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }


  // ===== Utils =====
  function setText(id, v){
    var el = document.getElementById(id);
    if(el) el.textContent = v;
  }

  // 姓名遮罩:中文姓名第 2 字改 *,英文/暱稱原樣顯示
  function maskName(name){
    if(!name) return '';
    var s = String(name).trim();
    // 中文姓名 (3 字以上,且第 2 字是中文)
    if(s.length >= 2 && /[\u4e00-\u9fa5]/.test(s.charAt(1))){
      return s.charAt(0) + '*' + s.slice(2);
    }
    return s;
  }

  function escapeHtml(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }
  function escapeAttr(s){
    return String(s == null ? '' : s).replace(/"/g, '&quot;');
  }

})();
