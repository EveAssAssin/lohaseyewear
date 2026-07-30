/* ============================================================
   paperdoll.js — 從零開始，打造那副只有我才有的眼鏡
   v2.0 | 五步重構 · LOHAS FOUND 發現機制 | 2026-07-31
   ------------------------------------------------------------
   設計要點：
   1. Step 3 進站時完全看不到 FOUND 品牌，就是一般配件購物頁。
      卡片角落只有一枚不解釋的壓印章。
   2. 點卡片主區域 → 全螢幕故事接管；點右下 ＋ → 直接加購不進故事。
   3. 第一次看完故事退回列表，護照才滑出（彩蛋在此揭曉）。
   ============================================================ */

(function () {
  'use strict';

  /* ══════════════════════════════════════
     狀態
  ══════════════════════════════════════ */
  const S = {
    step: 1,
    face: null,        // 臉型 key
    frame: null,       // FRAME_ITEMS item（附 price）
    engraving: null,
    acc: {},           // productId -> { ...product, foundId }
    name: '',
    found: [],         // 已發現的城市 id（依發現順序）
    passportShown: false,
  };

  /* ══════════════════════════════════════
     工具
  ══════════════════════════════════════ */
  const $   = id => document.getElementById(id);
  const qs  = (s, c) => (c || document).querySelector(s);
  const qsa = (s, c) => [...(c || document).querySelectorAll(s)];
  const fmt = n => 'NT$' + Number(n || 0).toLocaleString();
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const CFG = () => PD_DATA.config;
  const FOUND_ALL  = () => PD_DATA.found || [];
  const FOUND_OPEN = () => FOUND_ALL().filter(f => f.status === 'open');
  const findCity   = id => FOUND_ALL().find(f => f.id === id);

  /* 所有可購商品攤平（附城市資訊） */
  function allProducts() {
    return FOUND_OPEN().flatMap(f =>
      f.products.map(p => ({ ...p, foundId: f.id, foundNo: f.no })));
  }
  const findProduct = id => allProducts().find(p => p.id === id);

  const BASE  = () => (S.frame?.price || 0) + (S.engraving?.price || 0);
  const ACCS  = () => Object.values(S.acc);
  const TOTAL = () => BASE() + ACCS().reduce((s, a) => s + a.price, 0);

  /* ══════════════════════════════════════
     步驟切換
  ══════════════════════════════════════ */
  const STEP_MAX = 5;

  function goStep(n) {
    n = Math.min(Math.max(n, 1), STEP_MAX);
    S.step = n;

    qsa('.pd-step').forEach((el, i) => {
      el.classList.toggle('done',   i + 1 < n);
      el.classList.toggle('active', i + 1 === n);
    });
    qsa('.pd-screen').forEach(el => {
      el.style.display = (Number(el.dataset.step) === n) ? '' : 'none';
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (n === 1) renderFaces();
    if (n === 2) { loadEngravings(); renderEngravings(); }
    if (n === 3) { renderTypeTabs(); renderShop(); renderCartBar(); }
    if (n === 4) renderNaming();
    if (n === 5) renderFinal();

    syncPassport();
  }
  const nextStep = () => goStep(S.step + 1);
  const prevStep = () => goStep(S.step - 1);

  /* ══════════════════════════════════════
     STEP 1 — 臉型 → 鏡框（連動鏡框百科）
  ══════════════════════════════════════ */
  let frameGroupFilter = 'all';

  function framePrice(item) {
    return CFG().framePriceByGroup[item.group] || 3000;
  }

  function frameIconSvg(item) {
    const raw = (typeof FRAME_ICONS !== 'undefined' && FRAME_ICONS[item.icon]) || '';
    return `<svg class="fc-icon" viewBox="0 0 64 42" aria-hidden="true">${raw}</svg>`;
  }

  function renderFaces() {
    const box = $('face-grid');
    if (!box) return;
    box.innerHTML = (PD_DATA.faces || []).map(f => `
      <button class="pd-face-card ${S.face === f.key ? 'active' : ''}"
              onclick="PD.pickFace('${f.key}')">
        <img src="${f.img}" alt="${esc(f.label)}" loading="lazy">
        <div class="fa-label">${esc(f.label)}</div>
        <div class="fa-desc">${esc(f.desc)}</div>
      </button>`).join('');
    renderFrames();
  }

  function pickFace(key) {
    S.face = key;
    frameGroupFilter = 'all';
    renderFaces();
    $('frame-result')?.scrollIntoView({ behavior:'smooth', block:'start' });
  }

  /* 依臉型從 FRAME_ITEMS 篩選（含「各種臉型」通用款） */
  function matchedFrames() {
    if (typeof FRAME_ITEMS === 'undefined') return [];
    if (!S.face) return [];
    const face = (PD_DATA.faces || []).find(f => f.key === S.face);
    if (!face) return [];
    return FRAME_ITEMS.filter(item => {
      const arr = item.face || [];
      return arr.some(x => face.match.includes(x) || x === '各種臉型');
    });
  }

  function renderFrames() {
    const wrap = $('frame-result');
    const grid = $('frame-grid');
    if (!wrap || !grid) return;

    if (!S.face) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';

    let list = matchedFrames();
    const face = (PD_DATA.faces || []).find(f => f.key === S.face);

    // 群組 chips
    const groups = [...new Set(list.map(i => i.group))];
    const gLabel = {};
    (typeof FRAME_GROUPS !== 'undefined' ? FRAME_GROUPS : []).forEach(g => gLabel[g.key] = g.label);
    $('frame-groups').innerHTML =
      `<button class="pd-chip ${frameGroupFilter === 'all' ? 'active' : ''}"
               onclick="PD.setFrameGroup('all')">全部 ${list.length}</button>` +
      groups.map(g => `
        <button class="pd-chip ${frameGroupFilter === g ? 'active' : ''}"
                onclick="PD.setFrameGroup('${g}')">${esc(gLabel[g] || g)}</button>`).join('');

    if (frameGroupFilter !== 'all') list = list.filter(i => i.group === frameGroupFilter);

    $('frame-count').innerHTML =
      `<b>${esc(face.label)}</b> 適合的鏡框，鏡框百科共收錄 <b>${matchedFrames().length}</b> 種`;

    grid.innerHTML = list.map(item => `
      <div class="pd-frame-card ${S.frame?.code === item.code ? 'active' : ''}"
           onclick="PD.pickFrame('${item.code}')">
        ${item.tag ? `<span class="fc-tag">${esc(item.tag)}</span>` : ''}
        <div class="fc-img">${frameIconSvg(item)}</div>
        <div class="fc-name">${esc(item.name)}</div>
        <div class="fc-en">${esc(item.en || '')}</div>
        <div class="fc-desc">${esc(item.desc)}</div>
        <div class="fc-foot">
          <span class="fc-price">${fmt(framePrice(item))}</span>
          <a class="fc-more" href="frames.html?f=${encodeURIComponent(item.code)}"
             target="_blank" rel="noopener"
             onclick="event.stopPropagation()">百科 <i class="fa-solid fa-arrow-up-right-from-square"></i></a>
        </div>
      </div>`).join('');

    updateFrameBar();
  }

  function setFrameGroup(g) { frameGroupFilter = g; renderFrames(); }

  function pickFrame(code) {
    const item = FRAME_ITEMS.find(i => i.code === code);
    if (!item) return;
    S.frame = { ...item, price: framePrice(item) };
    renderFrames();
  }

  function updateFrameBar() {
    const bar = $('frame-bar');
    if (!bar) return;
    if (!S.frame) { bar.classList.remove('show'); return; }
    bar.classList.add('show');
    $('fb-name').textContent  = S.frame.name;
    $('fb-price').textContent = fmt(S.frame.price);
    $('step1-next').disabled  = false;
  }

  /* ══════════════════════════════════════
     STEP 2 — 刻圖（刻圖市集同步）
  ══════════════════════════════════════ */
  let engFilter  = 'all';
  let engSearch  = '';
  let engLoaded  = false;
  let engLoading = false;
  let engShowAll = false;

  const getSb = () =>
    window.LohasSupabase?.getClient?.() || window.Supabase?.client || window.supabase;

  /* supabase.js 為 defer 載入，用輪詢等待就緒 */
  function waitForSb(maxMs = 8000, interval = 100) {
    return new Promise(resolve => {
      const t0 = Date.now();
      (function poll() {
        const sb = getSb();
        if (sb && typeof sb.from === 'function') return resolve(sb);
        if (Date.now() - t0 > maxMs) return resolve(null);
        setTimeout(poll, interval);
      })();
    });
  }

  async function loadEngravings() {
    if (engLoaded || engLoading) return;
    engLoading = true;
    renderEngravings();

    try {
      const sb = await waitForSb();
      if (!sb) throw new Error('Supabase client 未就緒');

      const { data, error } = await sb
        .from('engraving_designs')
        .select('id, legacy_id, name, slogan, keywords, designer_name, category, image_url, image_url_png, like_count, collect_count, status, is_show, created_at')
        .eq('status', 'approved')
        .order('created_at', { ascending: false })
        .limit(CFG().engravingLimit);

      if (error) throw error;

      // 排除已下架（is_show 為 NULL 視為上架），與 market.html 一致
      PD_DATA.engravings = (data || [])
        .filter(d => (d.is_show || '上架') === '上架')
        .map(d => ({
          id: d.id,
          name:     d.name || '未命名作品',
          designer: d.designer_name || '樂活創作者',
          category: d.category || '',
          slogan:   d.slogan || '',
          keywords: d.keywords || '',
          img:      d.image_url || d.image_url_png || '',
          likes:    d.like_count || 0,
          price:    CFG().engravingPrice,
          em:       '',
        }));
      engLoaded = true;

    } catch (err) {
      console.warn('[paperdoll] 刻圖市集載入失敗，改用備援清單:', err);
      PD_DATA.engravings = (PD_DATA.engravingsFallback || [])
        .map(e => ({ ...e, img:'', likes:0, keywords:'', price: CFG().engravingPrice }));
    } finally {
      engLoading = false;
      renderEngFilters();
      renderEngravings();
    }
  }

  function engThumb(e, cls) {
    if (e.img) return `<img class="${cls}" src="${esc(e.img)}" alt="${esc(e.name)}" loading="lazy">`;
    return `<span class="${cls} is-em">${e.em || esc((e.name || '刻').slice(0, 1))}</span>`;
  }

  function renderEngFilters() {
    const box = $('eng-filters');
    if (!box) return;
    const cats = [...new Set((PD_DATA.engravings || []).map(e => e.category).filter(Boolean))];
    box.innerHTML =
      `<button class="pd-chip ${engFilter === 'all' ? 'active' : ''}" onclick="PD.setEngFilter('all')">全部</button>` +
      cats.map(c => `<button class="pd-chip ${engFilter === c ? 'active' : ''}"
                             onclick="PD.setEngFilter(decodeURIComponent('${encodeURIComponent(c)}'))">${esc(c)}</button>`).join('');
  }

  function renderEngravings() {
    const grid = $('eng-grid');
    if (!grid) return;

    if (engLoading) {
      grid.innerHTML = '<div class="pd-state"><i class="fa-solid fa-circle-notch fa-spin"></i> 正在同步刻圖市集…</div>';
      $('eng-more').innerHTML = '';
      return;
    }

    let list = PD_DATA.engravings || [];
    if (engFilter !== 'all') list = list.filter(e => e.category === engFilter);
    if (engSearch) {
      const kw = engSearch.toLowerCase();
      list = list.filter(e =>
        [e.name, e.designer, e.keywords, e.category, e.slogan].join(' ').toLowerCase().includes(kw));
    }

    if (!list.length) {
      grid.innerHTML = '<div class="pd-state">找不到符合的刻圖，換個關鍵字試試</div>';
      $('eng-more').innerHTML = '';
      return;
    }

    const total = list.length;
    const size  = CFG().engravingPageSize;
    let visible = engShowAll ? list : list.slice(0, size);

    // 已選中的刻圖務必可見
    if (!engShowAll && S.engraving &&
        !visible.some(e => String(e.id) === String(S.engraving.id)) &&
        list.some(e => String(e.id) === String(S.engraving.id))) {
      visible = [S.engraving, ...visible.slice(0, size - 1)];
    }

    grid.innerHTML = visible.map(e => `
      <div class="pd-eng-card ${String(S.engraving?.id) === String(e.id) ? 'active' : ''}"
           onclick="PD.pickEng('${esc(e.id)}')">
        ${engThumb(e, 'ec-thumb')}
        <div class="ec-name">${esc(e.name)}</div>
        <div class="ec-author">${esc(e.designer)}</div>
        <div class="ec-price">${fmt(e.price)}</div>
      </div>`).join('');

    $('eng-more').innerHTML = (total <= size) ? '' : (engShowAll
      ? `<div class="em-count">已顯示全部 ${total} 件</div>
         <button class="pd-chip em-btn" onclick="PD.toggleEngShowAll()"><i class="fa-solid fa-chevron-up"></i> 收合</button>`
      : `<div class="em-count">顯示 ${visible.length} / ${total} 件</div>
         <button class="pd-chip em-btn" onclick="PD.toggleEngShowAll()"><i class="fa-solid fa-chevron-down"></i> 展開全部 ${total} 件</button>`);

    updateEngStory();
  }

  function pickEng(id) {
    S.engraving = (PD_DATA.engravings || []).find(e => String(e.id) === String(id)) || null;
    renderEngravings();
    $('step2-next').disabled = false;
  }

  function updateEngStory() {
    const box = $('eng-story');
    if (!box) return;
    const e = S.engraving;

    if (!e) {
      box.innerHTML = '<div class="pd-state" style="padding:24px 0">選一個刻圖，看看它的故事</div>';
      return;
    }
    const kw = (e.keywords || '').split(',').map(k => k.trim()).filter(Boolean).slice(0, 4)
      .map(k => `<span class="es-kw">#${esc(k)}</span>`).join('');

    box.innerHTML = `
      <div class="es-thumb-wrap">${engThumb(e, 'es-thumb')}</div>
      <div class="es-title">${esc(e.name)}</div>
      <div class="es-by"><i class="fa-solid fa-pen-nib"></i> ${esc(e.designer)}${e.category ? ' · ' + esc(e.category) : ''}</div>
      ${e.slogan ? `<div class="es-text">${esc(e.slogan)}</div>` : ''}
      ${kw ? `<div class="es-kws">${kw}</div>` : ''}
      ${e.likes ? `<div class="es-count"><i class="fa-regular fa-heart"></i> ${e.likes.toLocaleString()} 人喜歡</div>` : ''}
      <div class="es-note"><i class="fa-solid fa-store"></i> 來自樂活刻圖市集，由創作者親自上架</div>`;
  }

  function setEngFilter(v) { engFilter = v; engShowAll = false; renderEngFilters(); renderEngravings(); }
  function setEngSearch(v) {
    const n = (v || '').trim();
    if (n === engSearch) return;
    engSearch = n; engShowAll = false; renderEngravings();
  }
  function toggleEngShowAll() {
    engShowAll = !engShowAll;
    renderEngravings();
    if (!engShowAll) $('eng-grid')?.scrollIntoView({ behavior:'smooth', block:'start' });
  }
  function skipEng() { S.engraving = null; nextStep(); }

  /* ══════════════════════════════════════
     STEP 3 — 配件（表面是購物，內裡是 FOUND）
  ══════════════════════════════════════ */
  let typeFilter = 'all';

  function renderTypeTabs() {
    const box = $('type-tabs');
    if (!box) return;
    const prods = allProducts();
    box.innerHTML = (PD_DATA.types || []).map(t => {
      const n = t.key === 'all' ? prods.length : prods.filter(p => p.type === t.key).length;
      if (!n) return '';
      return `<button class="pd-tab ${typeFilter === t.key ? 'active' : ''}"
                      onclick="PD.setType('${t.key}')">${esc(t.label)}<span class="tab-n">${n}</span></button>`;
    }).join('');
  }

  function setType(k) { typeFilter = k; renderTypeTabs(); renderShop(); }

  function renderShop() {
    const grid = $('shop-grid');
    if (!grid) return;

    let list = allProducts();
    if (typeFilter !== 'all') list = list.filter(p => p.type === typeFilter);

    grid.innerHTML = list.map(p => {
      const city    = findCity(p.foundId);
      const picked  = !!S.acc[p.id];
      const known   = S.found.includes(p.foundId);   // 已發現過的城市才顯示地名
      return `
      <div class="pd-shop-card ${picked ? 'picked' : ''}" onclick="PD.openStory('${p.foundId}','${p.id}')">
        <!-- 不解釋的壓印章 -->
        <span class="pd-seal ${known ? 'known' : ''}" title="${known ? esc(city.city) : ''}">
          <i class="fa-regular fa-circle"></i>${esc(p.foundNo)}
        </span>

        <div class="sc-img">${p.em}</div>
        <div class="sc-type">${esc(PD_DATA.typeLabel[p.type] || '')}</div>
        <div class="sc-name">${esc(p.name)}</div>
        <div class="sc-desc">${esc(p.desc)}</div>

        ${known ? `<div class="sc-city"><i class="fa-solid fa-location-dot"></i> ${esc(city.city)} · ${esc(city.name)}</div>` : ''}

        <div class="sc-foot">
          <span class="sc-price">${fmt(p.price)}</span>
          <button class="sc-add ${picked ? 'on' : ''}"
                  onclick="event.stopPropagation(); PD.toggleAcc('${p.id}')"
                  title="${picked ? '移除' : '直接加入'}">
            <i class="fa-solid ${picked ? 'fa-check' : 'fa-plus'}"></i>
          </button>
        </div>
      </div>`;
    }).join('');
  }

  function toggleAcc(id) {
    const p = findProduct(id);
    if (!p) return;
    if (S.acc[id]) delete S.acc[id];
    else S.acc[id] = p;
    renderShop();
    renderCartBar();
    renderStoryProducts();
  }

  function renderCartBar() {
    const bar = $('cart-bar');
    if (!bar) return;
    const n = ACCS().length;
    $('cb-count').innerHTML = n ? `已選 <b>${n}</b> 件配件` : '尚未選擇配件';
    $('cb-total').textContent = fmt(TOTAL());
  }

  /* ── 全螢幕故事 ── */
  function openStory(cityId, fromProductId) {
    const city = findCity(cityId);
    if (!city || city.status !== 'open') return;

    const layer = $('story-layer');
    const from  = fromProductId ? findProduct(fromProductId) : null;

    layer.dataset.city = cityId;
    layer.style.setProperty('--c-base',  city.tone.base);
    layer.style.setProperty('--c-deep',  city.tone.deep);
    layer.style.setProperty('--c-light', city.tone.light);
    layer.style.setProperty('--c-ink',   city.tone.ink);

    layer.innerHTML = buildStory(city, from);
    layer.classList.add('open');
    document.body.classList.add('pd-locked');
    layer.scrollTop = 0;
  }

  function buildStory(city, from) {
    const cc = city.cocreate || {};
    return `
    <button class="story-close" onclick="PD.closeStory()" aria-label="關閉">
      <i class="fa-solid fa-xmark"></i>
    </button>

    <!-- 一、揭曉 -->
    <section class="story-hero tex-${city.texture}">
      <div class="sh-inner">
        <div class="sh-no">FOUND ${esc(city.no)}</div>
        <div class="sh-city">${esc(city.city)}</div>
        <h1 class="sh-theme">${city.theme}</h1>
        ${from ? `
          <div class="sh-reveal">
            你剛剛看的那個<span>${esc(from.name)}</span><br>來自這裡。
          </div>` : ''}
        <div class="sh-scroll"><i class="fa-solid fa-chevron-down"></i></div>
      </div>
    </section>

    <!-- 二、發現 -->
    <section class="story-sec">
      <div class="sec-eyebrow"><span class="sec-no">01</span> DISCOVER｜發現</div>
      <h2 class="sec-title">${esc(city.discover.title)}</h2>
      <p class="sec-body">${esc(city.discover.body)}</p>
      <div class="sec-meta">
        <span><i class="fa-solid fa-location-dot"></i> ${esc(city.city)}</span>
        <span><i class="fa-regular fa-clock"></i> ${esc(city.since)}</span>
        <span><i class="fa-solid fa-hammer"></i> ${esc(city.name)}</span>
      </div>
    </section>

    <!-- 三、共創 -->
    <section class="story-sec alt">
      <div class="sec-eyebrow"><span class="sec-no">02</span> CO-CREATE｜共創</div>
      <h2 class="sec-title">${esc(cc.title || '')}</h2>
      <p class="sec-body">${esc(cc.intro || '')}</p>
      <ol class="proc-list">
        ${(cc.steps || []).map((s, i) => `
          <li class="proc-item">
            <span class="pi-n">${String(i + 1).padStart(2, '0')}</span>
            <div>
              <div class="pi-name">${esc(s.name)}</div>
              <div class="pi-desc">${esc(s.desc)}</div>
            </div>
          </li>`).join('')}
      </ol>
      ${cc.note ? `<div class="proc-note"><i class="fa-solid fa-quote-left"></i>${esc(cc.note)}</div>` : ''}
    </section>

    <!-- 四、延續 -->
    <section class="story-spirit tex-${city.texture}">
      <div class="sec-eyebrow light"><span class="sec-no">03</span> CONTINUE｜延續</div>
      <blockquote>${city.spirit}</blockquote>
    </section>

    <!-- 五、作品 -->
    <section class="story-sec">
      <div class="sec-eyebrow"><span class="sec-no">◆</span> ${esc(city.city)}的作品</div>
      <h2 class="sec-title">帶一件回家</h2>
      <div class="story-products" id="story-products"></div>

      <div class="story-cardnote">
        <div class="scn-em">📜</div>
        <div>
          <div class="scn-t">每一件 FOUND 商品都附一張故事卡</div>
          <div class="scn-d">你剛剛讀到的這段故事，會印在南投埔里的手工紙上，跟著你的眼鏡一起寄到家。</div>
        </div>
      </div>

      <button class="story-back" onclick="PD.closeStory()">
        <i class="fa-solid fa-arrow-left"></i> 回到配件
      </button>
    </section>`;
  }

  function renderStoryProducts() {
    const box = $('story-products');
    if (!box) return;
    const cityId = $('story-layer')?.dataset.city;
    const city = findCity(cityId);
    if (!city) return;

    box.innerHTML = city.products.map(p => {
      const picked = !!S.acc[p.id];
      return `
      <button class="sp-card ${picked ? 'on' : ''}" onclick="PD.toggleAcc('${p.id}')">
        <span class="sp-em">${p.em}</span>
        <span class="sp-info">
          <span class="sp-name">${esc(p.name)}</span>
          <span class="sp-desc">${esc(p.desc)}</span>
        </span>
        <span class="sp-right">
          <span class="sp-price">${fmt(p.price)}</span>
          <span class="sp-btn"><i class="fa-solid ${picked ? 'fa-check' : 'fa-plus'}"></i></span>
        </span>
      </button>`;
    }).join('');
  }

  function closeStory() {
    const layer = $('story-layer');
    const cityId = layer?.dataset.city;
    layer.classList.remove('open');
    document.body.classList.remove('pd-locked');

    // 第一次發現 → 護照登場
    if (cityId && !S.found.includes(cityId)) {
      S.found.push(cityId);
      setTimeout(() => revealPassport(cityId), 260);
    }
    renderShop();
    renderCartBar();
  }

  /* ══════════════════════════════════════
     FOUND 護照
  ══════════════════════════════════════ */
  function syncPassport() {
    const bar = $('passport');
    if (!bar) return;
    // 未發現任何城市，或不在 Step 3 之後 → 不顯示
    if (!S.found.length) { bar.classList.remove('show'); return; }
    bar.classList.add('show');
    renderPassport();
  }

  function renderPassport() {
    const total = FOUND_OPEN().length;
    $('pp-count').innerHTML = `你找到 <b>${S.found.length}</b> / ${total} 個城市`;
    $('pp-stamps').innerHTML = FOUND_ALL().map(c => {
      const got     = S.found.includes(c.id);
      const pending = c.status === 'pending';
      return `<span class="pp-stamp ${got ? 'got' : ''} ${pending ? 'pending' : ''}"
                    title="${pending ? '尚未前往' : (got ? c.city + ' · ' + c.name : '尚未發現')}"
                    ${got ? `onclick="PD.openStory('${c.id}')"` : ''}>
                ${got ? c.em : (pending ? '<i class="fa-solid fa-lock"></i>' : '?')}
              </span>`;
    }).join('');
  }

  function revealPassport(cityId) {
    const city = findCity(cityId);
    const bar  = $('passport');
    if (!bar || !city) return;

    renderPassport();
    bar.classList.add('show');

    const toast = $('pp-toast');
    toast.innerHTML = `
      <span class="pt-em">${city.em}</span>
      <span>
        <b>你發現了 FOUND ${esc(city.no)}</b><br>
        ${esc(city.city)} · ${esc(city.name)}
      </span>`;
    toast.classList.add('show');
    clearTimeout(revealPassport._t);
    revealPassport._t = setTimeout(() => toast.classList.remove('show'), 3600);

    if (!S.passportShown) {
      S.passportShown = true;
      bar.classList.add('first');
      setTimeout(() => bar.classList.remove('first'), 1600);
    }
  }

  /* ══════════════════════════════════════
     STEP 4 — 命名
  ══════════════════════════════════════ */
  function renderNaming() {
    const i = $('naming-input');
    if (i) i.value = S.name;
    updateNamingPreview();
  }
  function updateNamingPreview() {
    $('np-name').textContent = S.name.trim() || '（還沒有名字）';
    $('np-detail').textContent =
      [S.frame?.name, S.engraving?.name].filter(Boolean).join(' · ');
  }
  function applyHint(t) {
    S.name = t;
    const i = $('naming-input');
    if (i) i.value = t;
    updateNamingPreview();
  }

  /* ══════════════════════════════════════
     STEP 5 — 收藏（Flat Lay 造型卡 + 護照）
  ══════════════════════════════════════ */
  function renderFinal() {
    const name = S.name.trim() || '未命名造型';

    $('oc-name').textContent = name;
    $('oc-sub').textContent  = [S.frame?.name, S.engraving?.name].filter(Boolean).join(' · ');
    $('oc-by').textContent   = S.engraving ? `刻圖創作者 ${S.engraving.designer}` : '';
    $('oc-total').innerHTML  = `<span>造型總計</span><b>${fmt(TOTAL())}</b>`;

    /* Flat Lay：3×3 俯拍構圖，中央是眼鏡，周圍八格放配件 */
    const items = ACCS().slice(0, 8);
    const cells = [];
    let k = 0;
    for (let i = 0; i < 9; i++) {
      if (i === 4) {
        cells.push(`
          <div class="fl-cell fl-center">
            <div class="flc-glasses">
              ${typeof FRAME_ICONS !== 'undefined' && S.frame
                ? `<svg viewBox="0 0 64 42">${FRAME_ICONS[S.frame.icon] || ''}</svg>` : '🕶'}
            </div>
            ${S.engraving ? `<div class="flc-eng">${engThumb(S.engraving, 'flc-eng-img')}</div>` : ''}
            <div class="flc-name">${esc(S.frame?.name || '')}</div>
          </div>`);
      } else {
        const it = items[k++];
        cells.push(it
          ? `<div class="fl-cell fl-item" title="${esc(it.name)}">
               <span class="fli-em">${it.em}</span>
               <span class="fli-name">${esc(it.name)}</span>
             </div>`
          : `<div class="fl-cell fl-empty"></div>`);
      }
    }
    $('flatlay').innerHTML = cells.join('');

    const more = ACCS().length - items.length;
    $('fl-more').textContent = more > 0 ? `另有 ${more} 件配件未顯示` : '';

    /* 明細 */
    const rows = [];
    if (S.frame) rows.push({ em:'👓', name:S.frame.name, cat:'鏡框', price:S.frame.price });
    if (S.engraving) rows.push({ em:'✦', name:S.engraving.name, cat:'刻圖', price:S.engraving.price });
    ACCS().forEach(a => {
      const c = findCity(a.foundId);
      rows.push({ em:a.em, name:a.name, cat:`FOUND ${a.foundNo} · ${c ? c.city : ''}`, price:a.price });
    });
    $('oc-list').innerHTML = rows.map(r => `
      <div class="ol-row">
        <span class="ol-em">${r.em}</span>
        <span class="ol-info"><b>${esc(r.name)}</b><small>${esc(r.cat)}</small></span>
        <span class="ol-price">${fmt(r.price)}</span>
      </div>`).join('');

    /* 護照回顧 */
    const box = $('oc-passport');
    if (!S.found.length) {
      box.style.display = 'none';
    } else {
      box.style.display = '';
      const total = FOUND_OPEN().length;
      const done  = S.found.length === total;
      box.innerHTML = `
        <div class="ocp-top">
          <span><i class="fa-solid fa-passport"></i> FOUND 護照</span>
          <span class="ocp-n ${done ? 'done' : ''}">${S.found.length} / ${total}</span>
        </div>
        <div class="ocp-cities">
          ${S.found.map(id => {
            const c = findCity(id);
            return `<span class="ocp-city">${c.em} FOUND ${esc(c.no)} · ${esc(c.city)}</span>`;
          }).join('')}
        </div>
        ${done
          ? `<div class="ocp-medal"><i class="fa-solid fa-award"></i> 第一季全數走訪，已解鎖限量收藏編號</div>`
          : `<div class="ocp-hint">還有 ${total - S.found.length} 個城市等你發現</div>`}`;
    }
  }

  function saveOutfit() {
    try {
      const saved = JSON.parse(localStorage.getItem('lohas_outfits') || '[]');
      saved.push({
        name:        S.name || '未命名造型',
        face:        S.face,
        frame:       S.frame ? { code:S.frame.code, name:S.frame.name, price:S.frame.price } : null,
        engraving:   S.engraving ? { id:S.engraving.id, name:S.engraving.name, designer:S.engraving.designer, price:S.engraving.price } : null,
        accessories: ACCS().map(a => ({ id:a.id, name:a.name, price:a.price, found:a.foundNo })),
        found:       S.found,
        total:       TOTAL(),
        savedAt:     Date.now(),
      });
      localStorage.setItem('lohas_outfits', JSON.stringify(saved));
      alert('✦ 造型已收藏！\n可在「我的造型」查看。');
    } catch (e) { console.error('[paperdoll] save error', e); }
  }

  function shareCard() {
    const name = S.name.trim() || '我的造型';
    const cities = S.found.map(id => findCity(id).city).join('、');
    const text = `我在樂活眼鏡做了一副專屬眼鏡「${name}」`
               + (cities ? `，走過 ${cities}。` : '。')
               + '\nlohasglasses.com';
    if (navigator.share) navigator.share({ title:name, text }).catch(() => {});
    else if (navigator.clipboard) { navigator.clipboard.writeText(text); alert('已複製到剪貼簿'); }
  }

  /* ══════════════════════════════════════
     初始化
  ══════════════════════════════════════ */
  function init() {
    // 刻圖搜尋
    const es = $('eng-search');
    if (es) {
      let t = null;
      es.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => setEngSearch(es.value), 180);
      });
    }
    // 命名
    const ni = $('naming-input');
    if (ni) ni.addEventListener('input', () => { S.name = ni.value; updateNamingPreview(); });

    // Esc 關閉故事
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && $('story-layer')?.classList.contains('open')) closeStory();
    });

    // 故事層內的商品列需在 DOM 就緒後補渲染
    const layer = $('story-layer');
    if (layer) {
      const mo = new MutationObserver(() => renderStoryProducts());
      mo.observe(layer, { childList:true });
    }

    goStep(1);
  }

  /* 公開 API */
  window.PD = {
    goStep, nextStep, prevStep,
    pickFace, pickFrame, setFrameGroup,
    pickEng, setEngFilter, setEngSearch, toggleEngShowAll, skipEng,
    setType, toggleAcc, openStory, closeStory,
    applyHint, saveOutfit, shareCard,
  };

  document.addEventListener('DOMContentLoaded', init);
})();
