// paperdoll.js — 樂活眼鏡 客製眼鏡體驗
// v1.2 | 台灣百工計畫 + 刻圖市集同步 | 2026-07-30

(function () {
  'use strict';

  /* ── 狀態 ── */
  const S = {
    step: 1,
    quiz: {},        // { lifestyle, admire, impression }
    frame: null,
    engraving: null,
    details: { legColor:'darkbrown', nosePad:'矽膠（舒適）', screwColor:'gold', innerText:'', lensColor:'clear', choices:0 },
    name: '',
    acc: {},         // { id: { ...item, cat } }
    lastCraft: null, // 最近一次選到的工藝 id（用於故事帶）
  };

  /* ── 工具 ── */
  const $  = id => document.getElementById(id);
  const qs = (sel, ctx) => (ctx || document).querySelector(sel);
  const qsa = (sel, ctx) => [...(ctx || document).querySelectorAll(sel)];
  const fmt = n => 'NT$' + n.toLocaleString();
  const BASE  = () => (S.frame?.price || 0) + (S.engraving?.price || 0);
  const ACC   = () => Object.values(S.acc).reduce((s, a) => s + a.price, 0);
  const TOTAL = () => BASE() + ACC();

  /* ── 台灣百工輔助 ── */
  const CRAFTS     = () => PD_DATA.crafts || {};
  const CRAFT_IDS  = () => Object.keys(CRAFTS());
  // 目前造型已收集到的工藝聚落（去重）
  const ownedCrafts = () => [...new Set(
    Object.values(S.acc).map(a => a.craft).filter(Boolean)
  )];

  /* ── 步驟切換 ── */
  function goStep(n) {
    S.step = n;
    qsa('.pd-step').forEach((el, i) => {
      el.classList.toggle('done',   i + 1 < n);
      el.classList.toggle('active', i + 1 === n);
    });
    qsa('.pd-screen').forEach(el => {
      el.style.display = (el.dataset.step == n) ? '' : 'none';
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // 進入各步驟時渲染
    if (n === 2) renderFrames();
    if (n === 3) { loadEngravings(); renderEngravings(); }
    if (n === 4) renderDetails();
    if (n === 5) renderNaming();
    if (n === 6) { renderAccGrid(); updateFlatlay(); }
    if (n === 7) renderCard();
  }

  function nextStep() { if (S.step < 7) goStep(S.step + 1); }
  function prevStep() { if (S.step > 1) goStep(S.step - 1); }

  /* ══════════════════════════════════════════
     STEP 1 — 問卷
  ══════════════════════════════════════════ */
  let qIdx = 0;

  function renderQuiz() {
    const q = PD_DATA.quiz[qIdx];
    // 進度條
    $('quiz-prog').innerHTML = PD_DATA.quiz.map((_, i) =>
      `<span class="${i < qIdx ? 'done' : ''}"></span>`).join('');
    // 問題
    $('quiz-q').textContent = q.q;
    // 選項
    $('quiz-opts').innerHTML = q.opts.map(o => `
      <button class="pd-quiz-opt ${S.quiz[q.id] === o.val ? 'sel' : ''}"
              onclick="PD.quizPick('${q.id}','${o.val}')">
        <span class="oe">${o.em}</span>
        <div class="ol">${o.label}</div>
        <div class="od">${o.desc}</div>
      </button>`).join('');
  }

  function quizPick(qid, val) {
    S.quiz[qid] = val;
    // 視覺回饋
    qsa(`#quiz-opts .pd-quiz-opt`).forEach(el => el.classList.remove('sel'));
    event.currentTarget.classList.add('sel');
    setTimeout(() => {
      qIdx++;
      if (qIdx < PD_DATA.quiz.length) {
        renderQuiz();
      } else {
        qIdx = 0;
        goStep(2);
      }
    }, 280);
  }

  /* ══════════════════════════════════════════
     STEP 2 — 鏡框
  ══════════════════════════════════════════ */
  let frameFilter = 'all';

  function renderFrames() {
    const prefs = Object.values(S.quiz);
    let list = PD_DATA.frames;
    if (frameFilter !== 'all') list = list.filter(f => f.mat === frameFilter);

    $('frame-grid').innerHTML = list.map(f => {
      const isRec = f.rec.some(r => prefs.includes(r));
      return `
      <div class="pd-frame-card ${S.frame?.id === f.id ? 'active' : ''} ${isRec ? 'rec' : ''}"
           onclick="PD.pickFrame('${f.id}')">
        <div class="pd-frame-img">${f.em}</div>
        <div class="pd-frame-name">${f.name}</div>
        <div class="pd-frame-quote">${f.quote}</div>
        <div class="pd-frame-price">${fmt(f.price)}</div>
      </div>`;
    }).join('');

    updateFramePreview();
  }

  function pickFrame(id) {
    S.frame = PD_DATA.frames.find(f => f.id === id);
    renderFrames();
    // 小動畫：圖示跳動
    const icon = $('sp-icon');
    if (icon) { icon.style.transform = 'scale(1.18)'; setTimeout(() => { icon.style.transform = 'scale(1)'; }, 300); }
  }

  function updateFramePreview() {
    const f = S.frame;
    $('sp-icon').textContent  = f ? f.em : '👓';
    $('sp-name').textContent  = f ? f.name : '尚未選擇';
    $('sp-code').textContent  = f ? f.code : '';
    $('sp-price').textContent = f ? fmt(f.price) : '';
    $('step2-next').disabled  = !f;
  }

  function setFrameFilter(val) {
    frameFilter = val;
    qsa('#frame-filters .pd-chip').forEach(el =>
      el.classList.toggle('active', el.dataset.val === val));
    renderFrames();
  }

  /* ══════════════════════════════════════════
     STEP 3 — 刻圖（與刻圖市集同步）
  ══════════════════════════════════════════ */
  let engFilter   = 'all';
  let engSearch   = '';
  let engLoaded   = false;
  let engLoading  = false;
  let engShowAll  = false;
  const ENG_PAGE  = 12;   // 預設先顯示幾件

  const ENG_CFG = () => PD_DATA.engravingConfig || { price: 350, limit: 500 };

  /* 取得 Supabase client（與 market.js 同一組 fallback） */
  function getSb() {
    return window.LohasSupabase?.getClient?.()
        || window.Supabase?.client
        || window.supabase;
  }

  /* supabase.js 為 defer 載入，用輪詢等待就緒（勿用單次 setTimeout） */
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

  /* 從 engraving_designs 載入，條件與 market.html 完全一致 */
  async function loadEngravings() {
    if (engLoaded || engLoading) return;
    engLoading = true;
    renderEngravings();

    try {
      const sb = await waitForSb();
      if (!sb) throw new Error('Supabase client 未就緒');

      const { data, error } = await sb
        .from('engraving_designs')
        .select('id, legacy_id, name, slogan, keywords, designer_name, category, image_url, image_url_png, like_count, collect_count, status, is_show, created_at, creator_id')
        .eq('status', 'approved')
        .order('created_at', { ascending: false })
        .limit(ENG_CFG().limit);

      if (error) throw error;

      // 排除已下架（is_show 為 NULL 視為上架）
      const rows = (data || []).filter(d => (d.is_show || '上架') === '上架');
      PD_DATA.engravings = rows.map(normalizeDesign);
      engLoaded = true;

    } catch (err) {
      console.warn('[paperdoll] 刻圖市集載入失敗，改用備援清單:', err);
      PD_DATA.engravings = (PD_DATA.engravingsFallback || []).map(e => ({
        id: e.id, name: e.name, designer: e.author, category: e.series,
        slogan: e.story, keywords: '', img: '', likes: e.count,
        price: e.price, em: e.em, isFallback: true,
      }));
    } finally {
      engLoading = false;
      renderEngFilters();
      renderEngravings();
    }
  }

  function normalizeDesign(d) {
    return {
      id:       d.id,
      legacyId: d.legacy_id,
      name:     d.name || '未命名作品',
      designer: d.designer_name || '樂活創作者',
      category: d.category || '',
      slogan:   d.slogan || '',
      keywords: d.keywords || '',
      img:      d.image_url || d.image_url_png || '',
      likes:    d.like_count || 0,
      collects: d.collect_count || 0,
      price:    ENG_CFG().price,
      em:       '',
    };
  }

  /* 縮圖：有圖用圖，沒圖用文字首字 */
  function engThumb(e, cls) {
    if (e.img) return `<img class="${cls}" src="${e.img}" alt="${e.name}" loading="lazy">`;
    if (e.em)  return `<span class="${cls} is-em">${e.em}</span>`;
    return `<span class="${cls} is-em">${(e.name || '刻').slice(0, 1)}</span>`;
  }

  /* 分類 chips 由實際資料動態產生 */
  function renderEngFilters() {
    const box = $('eng-filters');
    if (!box) return;
    const cats = [...new Set((PD_DATA.engravings || []).map(e => e.category).filter(Boolean))];
    box.innerHTML =
      `<button class="pd-chip ${engFilter === 'all' ? 'active' : ''}" data-val="all" onclick="PD.setEngFilter('all')">全部</button>` +
      cats.map(c =>
        `<button class="pd-chip ${engFilter === c ? 'active' : ''}" data-val="${c}" onclick="PD.setEngFilter('${c.replace(/'/g, "\\'")}')">${c}</button>`
      ).join('');
  }

  function renderEngravings() {
    const grid = $('eng-grid');
    if (!grid) return;

    if (engLoading) {
      grid.innerHTML = '<div class="pd-eng-state"><i class="fa-solid fa-circle-notch fa-spin"></i> 正在同步刻圖市集…</div>';
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
      grid.innerHTML = '<div class="pd-eng-state">找不到符合的刻圖，換個關鍵字試試</div>';
      renderEngMore(0, 0);
      return;
    }

    // 已選中的刻圖一定要在可見範圍內，避免收合後看不到自己的選擇
    const total   = list.length;
    let   visible = engShowAll ? list : list.slice(0, ENG_PAGE);
    if (!engShowAll && S.engraving &&
        !visible.some(e => String(e.id) === String(S.engraving.id)) &&
        list.some(e => String(e.id) === String(S.engraving.id))) {
      visible = [S.engraving, ...visible.slice(0, ENG_PAGE - 1)];
    }

    grid.innerHTML = visible.map(e => `
      <div class="pd-eng-card ${String(S.engraving?.id) === String(e.id) ? 'active' : ''}"
           onclick="PD.pickEng('${e.id}')">
        ${engThumb(e, 'ec-thumb')}
        <div class="ec-name">${e.name}</div>
        <div class="ec-author">${e.designer}</div>
        <div class="ec-price">${fmt(e.price)}</div>
      </div>`).join('');

    renderEngMore(visible.length, total);
  }

  /* 展開 / 收合列 */
  function renderEngMore(shown, total) {
    const box = $('eng-more');
    if (!box) return;

    if (!total || total <= ENG_PAGE) { box.innerHTML = ''; return; }

    box.innerHTML = engShowAll
      ? `<div class="em-count">已顯示全部 ${total} 件刻圖</div>
         <button class="pd-chip em-btn" onclick="PD.toggleEngShowAll()">
           <i class="fa-solid fa-chevron-up"></i> 收合
         </button>`
      : `<div class="em-count">顯示 ${shown} / ${total} 件</div>
         <button class="pd-chip em-btn" onclick="PD.toggleEngShowAll()">
           <i class="fa-solid fa-chevron-down"></i> 展開全部 ${total} 件
         </button>`;
  }

  function toggleEngShowAll() {
    engShowAll = !engShowAll;
    renderEngravings();
    if (!engShowAll) {
      // 收合時捲回刻圖區頂端
      $('eng-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function pickEng(id) {
    S.engraving = (PD_DATA.engravings || []).find(e => String(e.id) === String(id));
    renderEngravings();
    updateEngStory();
    $('step3-next').disabled = false;
  }

  function updateEngStory() {
    const e   = S.engraving;
    const box = $('eng-story');
    if (!box) return;

    if (!e) {
      box.innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:24px 0">選一個刻圖，看看它的故事</div>';
      return;
    }

    const kw = (e.keywords || '')
      .split(',').map(k => k.trim()).filter(Boolean)
      .slice(0, 4)
      .map(k => `<span class="es-kw">#${k}</span>`).join('');

    box.innerHTML = `
      <div class="es-thumb-wrap">${engThumb(e, 'es-thumb')}</div>
      <div class="es-title">${e.name}</div>
      <div class="es-city"><i class="fa-solid fa-pen-nib"></i> ${e.designer}${e.category ? ' · ' + e.category : ''}</div>
      ${e.slogan ? `<div class="es-text">${e.slogan}</div>` : ''}
      ${kw ? `<div class="es-kws">${kw}</div>` : ''}
      <div class="es-count">
        <i class="fa-regular fa-heart"></i> ${(e.likes || 0).toLocaleString()} 人喜歡這個作品
      </div>
      <div class="pd-eng-collect">
        <i class="fa-solid fa-store"></i>
        此作品來自樂活刻圖市集，由創作者親自上架
      </div>`;
  }

  function setEngFilter(val) {
    engFilter  = val;
    engShowAll = false;
    renderEngFilters();
    renderEngravings();
  }

  function setEngSearch(val) {
    const next = (val || '').trim();
    if (next === engSearch) return;
    engSearch  = next;
    engShowAll = false;
    renderEngravings();
  }

  function skipEng() {
    S.engraving = null;
    $('step3-next').disabled = false;
    nextStep();
  }

  /* ══════════════════════════════════════════
     STEP 4 — 細節微調
  ══════════════════════════════════════════ */
  function renderDetails() {
    const d = PD_DATA.details;

    $('leg-colors').innerHTML = d.legColors.map(c => `
      <div class="pd-color-swatch ${S.details.legColor === c.val ? 'active' : ''}"
           style="background:${c.hex}"
           onclick="PD.setDetail('legColor','${c.val}')"
           title="${c.label}">
        <span class="sw-tip">${c.label}</span>
      </div>`).join('');

    $('nose-pads').innerHTML = d.nosePads.map(p => `
      <button class="pd-radio-opt ${S.details.nosePad === p ? 'active' : ''}"
              onclick="PD.setDetail('nosePad','${p}')">${p}</button>`).join('');

    $('screw-colors').innerHTML = d.screwColors.map(c => `
      <div class="pd-color-swatch ${S.details.screwColor === c.val ? 'active' : ''}"
           style="background:${c.hex};border:1px solid #ddd"
           onclick="PD.setDetail('screwColor','${c.val}')"
           title="${c.label}">
        <span class="sw-tip">${c.label}</span>
      </div>`).join('');

    $('lens-colors').innerHTML = d.lensColors.map(c => `
      <div class="pd-color-swatch ${S.details.lensColor === c.val ? 'active' : ''}"
           style="background:${c.hex};border:1px solid #ddd"
           onclick="PD.setDetail('lensColor','${c.val}')"
           title="${c.label}">
        <span class="sw-tip">${c.label}</span>
      </div>`).join('');

    $('detail-count').innerHTML = `已做了 <b>${S.details.choices}</b> 個選擇`;
    $('detail-preview-icon').textContent = S.frame?.em || '👓';
    const inner = $('inner-text');
    if (inner) inner.value = S.details.innerText;
  }

  function setDetail(key, val) {
    const changed = S.details[key] !== val;
    S.details[key] = val;
    if (changed) S.details.choices++;
    renderDetails();
  }

  /* ══════════════════════════════════════════
     STEP 5 — 命名
  ══════════════════════════════════════════ */
  function renderNaming() {
    const inp = $('naming-input');
    if (inp) inp.value = S.name;
    updateNamingPreview();
  }

  function updateNamingPreview() {
    const n = S.name.trim();
    $('np-name').textContent   = n || '（還沒有名字）';
    $('np-frame').textContent  = S.frame?.name || '';
    $('np-eng').textContent    = S.engraving ? ' · ' + S.engraving.name : '';
  }

  function applyHint(text) {
    S.name = text;
    const inp = $('naming-input');
    if (inp) inp.value = text;
    updateNamingPreview();
  }

  /* ══════════════════════════════════════════
     STEP 6 — 配件 Flat Lay
  ══════════════════════════════════════════ */
  let accCat = 'box';
  let accOnlyCraft = false;
  const CAT_LBL = { box:'眼鏡盒', cloth:'拭鏡布', bag:'眼鏡袋', stand:'置物架' };
  const CAT_POS = { box:'tl', cloth:'bl', bag:'tr', stand:'br' };

  function renderAccGrid() {
    let items  = PD_DATA.acc[accCat] || [];
    const mat  = S.frame?.mat;
    // 「台灣百工」篩選：只留有掛 craft 的品項
    if (accOnlyCraft) items = items.filter(i => i.craft);

    if (!items.length) {
      $('acc-grid').innerHTML =
        '<div class="pd-acc-empty">此分類目前沒有台灣百工品項</div>';
      return;
    }

    $('acc-grid').innerHTML = items.map(item => {
      const isMatch  = item.matchMat && mat === item.matchMat;
      const badge    = isMatch
        ? { text:'命中注定', bt:'brand' }
        : (item.badge ? { text:item.badge, bt:item.bt } : null);
      const picked   = !!S.acc[item.id];
      const craft    = item.craft ? CRAFTS()[item.craft] : null;
      return `
      <div class="pd-acc-card ${picked ? 'active' : ''}" onclick="PD.toggleAcc('${item.id}')">
        <div class="ac-check"><svg viewBox="0 0 10 8"><polyline points="1,4 4,7 9,1"/></svg></div>
        ${badge ? `<div class="ac-badge"><span class="pd-badge pd-badge-${badge.bt}">${badge.text}</span></div>` : ''}
        <div class="pd-acc-card-img">${item.em}</div>
        ${craft ? `<div class="pd-acc-craft"><i class="fa-solid fa-location-dot"></i> ${craft.region} · ${craft.name}</div>` : ''}
        <div class="pd-acc-name">${item.name}</div>
        <div class="pd-acc-desc">${item.desc}</div>
        <div class="pd-acc-price">${fmt(item.price)}</div>
      </div>`;
    }).join('');
  }

  /* 台灣百工篩選切換 */
  function setAccCraftFilter(on) {
    accOnlyCraft = !!on;
    qsa('#acc-filters .pd-chip').forEach(el =>
      el.classList.toggle('active', (el.dataset.craft === '1') === accOnlyCraft));
    renderAccGrid();
  }

  function toggleAcc(id) {
    // 找出這個 id 在哪個分類
    let found = null;
    for (const [cat, items] of Object.entries(PD_DATA.acc)) {
      const item = items.find(i => i.id === id);
      if (item) { found = { ...item, cat }; break; }
    }
    if (!found) return;

    if (S.acc[id]) {
      delete S.acc[id];
      // 移除後若該工藝已無品項，故事帶改顯示其他仍在的工藝
      if (S.lastCraft && !ownedCrafts().includes(S.lastCraft)) {
        S.lastCraft = ownedCrafts()[ownedCrafts().length - 1] || null;
      }
    } else {
      S.acc[id] = found;
      if (found.craft) S.lastCraft = found.craft;
    }

    renderAccGrid();
    updateFlatlay();
  }

  function updateFlatlay() {
    const count = Object.keys(S.acc).length;

    // hint 隱藏
    const hint = $('fl-hint');
    if (hint) hint.style.opacity = count === 0 ? '1' : '0';

    // 眼鏡主角
    $('fl-glasses-em').textContent   = S.frame?.em || '🕶';
    $('fl-glasses-name').textContent = S.frame?.name || '';

    // 套餐名稱
    const outfitName = [S.frame?.name, S.engraving?.name].filter(Boolean).join(' · ') || '我的造型';
    $('fl-outfit-name').textContent = outfitName;

    // 四角配件飛入
    const catPicked = {};
    Object.values(S.acc).forEach(a => { if (!catPicked[a.cat]) catPicked[a.cat] = a; });

    ['box', 'cloth', 'bag', 'stand'].forEach(cat => {
      const el   = $('fl-' + cat);
      const item = catPicked[cat];
      if (!el) return;
      if (item) {
        qs('.fo-em',  el).textContent = item.em;
        qs('.fo-lbl', el).textContent = item.name.length > 8 ? item.name.slice(0, 8) + '…' : item.name;
        el.classList.add('show');
      } else {
        el.classList.remove('show');
      }
    });

    // 底部清單
    const list = $('fl-list');
    const fixed = `
      <div class="pd-fl-row">
        <div class="pd-fl-row-icon">${S.frame?.em || '👓'}</div>
        <div class="pd-fl-row-info">
          <div class="pd-fl-row-name">${S.frame?.name || ''}</div>
          <div class="pd-fl-row-cat">鏡框</div>
        </div>
        <div class="pd-fl-row-price">${S.frame ? fmt(S.frame.price) : ''}</div>
      </div>
      ${S.engraving ? `
      <div class="pd-fl-row">
        <div class="pd-fl-row-icon">${engThumb(S.engraving, 'fl-row-thumb')}</div>
        <div class="pd-fl-row-info">
          <div class="pd-fl-row-name">${S.engraving.name}</div>
          <div class="pd-fl-row-cat">刻圖</div>
        </div>
        <div class="pd-fl-row-price">${fmt(S.engraving.price)}</div>
      </div>` : ''}`;

    const extras = Object.values(S.acc).map(a => `
      <div class="pd-fl-row">
        <div class="pd-fl-row-icon">${a.em}</div>
        <div class="pd-fl-row-info">
          <div class="pd-fl-row-name">${a.name}</div>
          <div class="pd-fl-row-cat">${CAT_LBL[a.cat] || ''}</div>
        </div>
        <div class="pd-fl-row-price">${fmt(a.price)}</div>
        <div class="pd-fl-row-rm" onclick="PD.toggleAcc('${a.id}')" title="移除">✕</div>
      </div>`).join('');

    list.innerHTML = fixed + extras;

    // 總計
    $('fl-total').textContent     = fmt(TOTAL());
    $('acc-foot-cnt').innerHTML   = `已加入 <b>${count}</b> 件配件`;

    // 台灣百工：故事帶 + 收集進度
    renderCraftStory();
    renderCraftProgress();
  }

  /* ── 工藝故事帶 ── */
  function renderCraftStory() {
    const box = $('craft-story');
    if (!box) return;
    const c = S.lastCraft ? CRAFTS()[S.lastCraft] : null;

    if (!c) {
      box.classList.remove('show');
      box.innerHTML = `
        <div class="cs-idle">
          <i class="fa-solid fa-mountain-sun"></i>
          選一件台灣百工配件，聽聽它來自哪片土地
        </div>`;
      return;
    }

    box.classList.add('show');
    box.innerHTML = `
      <div class="cs-head">
        <span class="cs-em">${c.em}</span>
        <div class="cs-title">
          <div class="cs-name">${c.name}</div>
          <div class="cs-region"><i class="fa-solid fa-location-dot"></i> ${c.region} · ${c.since}</div>
        </div>
      </div>
      <div class="cs-craft">${c.craft}</div>
      <div class="cs-spirit">「${c.spirit}」</div>`;
  }

  /* ── 八大工藝收集進度 ── */
  function renderCraftProgress() {
    const wrap = $('craft-progress');
    if (!wrap) return;
    const owned = ownedCrafts();
    const all   = CRAFT_IDS();
    const done  = owned.length === all.length && all.length > 0;

    wrap.innerHTML = `
      <div class="cp-top">
        <span class="cp-label">
          <i class="fa-solid fa-map-location-dot"></i>
          台灣工藝聚落
        </span>
        <span class="cp-count ${done ? 'done' : ''}">${owned.length} / ${all.length}</span>
      </div>
      <div class="cp-dots">
        ${all.map(id => {
          const c  = CRAFTS()[id];
          const on = owned.includes(id);
          return `<span class="cp-dot ${on ? 'on' : ''}" title="${c.region} · ${c.name}">${on ? c.em : ''}</span>`;
        }).join('')}
      </div>
      ${done
        ? `<div class="cp-unlock"><i class="fa-solid fa-award"></i> 百工收藏家達成，已解鎖限定包裝</div>`
        : `<div class="cp-hint">再收集 ${all.length - owned.length} 個聚落，解鎖「百工收藏家」限定包裝</div>`}`;
  }

  function setAccTab(cat) {
    accCat = cat;
    qsa('.pd-acc-tab').forEach(el =>
      el.classList.toggle('active', el.dataset.cat === cat));
    renderAccGrid();
  }

  /* ══════════════════════════════════════════
     STEP 7 — 造型卡
  ══════════════════════════════════════════ */
  function renderCard() {
    const name = S.name.trim() || '未命名造型';
    const accs = Object.values(S.acc);

    $('oc-glasses').textContent = S.frame?.em || '🕶';
    $('oc-name').textContent    = name;
    $('oc-items').textContent   = [S.frame?.name, S.engraving?.name].filter(Boolean).join(' · ');
    $('oc-creator').textContent = S.engraving
      ? `刻圖 ${S.engraving.name} · 創作者 ${S.engraving.designer}`
      : '';
    $('oc-total').innerHTML     = `造型總計：<b>${fmt(TOTAL())}</b>`;

    $('oc-accs').innerHTML = accs.length
      ? accs.map(a => `
          <div class="pd-oc-acc">
            <div class="pd-oc-acc-em">${a.em}</div>
            <div class="pd-oc-acc-lbl">${a.name.slice(0, 5)}</div>
          </div>`).join('')
      : '<div style="font-size:12px;color:var(--lohas-light)">尚未選擇配件</div>';

    // 台灣百工足跡
    const owned = ownedCrafts();
    const line  = $('oc-crafts');
    if (line) {
      if (!owned.length) {
        line.style.display = 'none';
      } else {
        const all     = CRAFT_IDS();
        const regions = owned.map(id => CRAFTS()[id].region).join(' · ');
        const full    = owned.length === all.length;
        line.style.display = '';
        line.innerHTML = `
          <div class="oc-crafts-lbl">
            <i class="fa-solid fa-map-location-dot"></i>
            這套造型走過 ${owned.length} 個台灣職人聚落
          </div>
          <div class="oc-crafts-regions">${regions}</div>
          ${full ? '<div class="oc-crafts-medal"><i class="fa-solid fa-award"></i> 百工收藏家</div>' : ''}`;
      }
    }
  }

  function saveOutfit() {
    try {
      const saved = JSON.parse(localStorage.getItem('lohas_outfits') || '[]');
      saved.push({
        name:        S.name || '未命名造型',
        frame:       S.frame,
        engraving:   S.engraving,
        accessories: Object.values(S.acc),
        crafts:      ownedCrafts().map(id => ({
                       id,
                       name:   CRAFTS()[id].name,
                       region: CRAFTS()[id].region,
                     })),
        total:       TOTAL(),
        savedAt:     Date.now(),
      });
      localStorage.setItem('lohas_outfits', JSON.stringify(saved));
      // 使用全站 toast（如有）或 alert
      if (window.lohasToast) {
        window.lohasToast('✦ 造型已收藏！');
      } else {
        alert('✦ 造型已收藏！\n可在「我的造型」頁面查看。');
      }
    } catch(e) { console.error('[PD] save error', e); }
  }

  function shareCard() {
    const name = S.name.trim() || '我的造型';
    const text = `我在樂活眼鏡做了一副專屬眼鏡「${name}」！\nlohasglasses.com`;
    if (navigator.share) {
      navigator.share({ title: name, text }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      alert('造型文字已複製到剪貼簿！');
    }
  }

  /* ── 初始化 ── */
  function init() {
    // naming input 監聽
    const ni = $('naming-input');
    if (ni) {
      ni.addEventListener('input', () => {
        S.name = ni.value;
        updateNamingPreview();
      });
    }
    // 刻圖搜尋監聽
    const es = $('eng-search');
    if (es) {
      let t = null;
      es.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => setEngSearch(es.value), 180);
      });
    }
    // inner-text 監聽
    const it = $('inner-text');
    if (it) {
      it.addEventListener('input', () => { S.details.innerText = it.value; });
    }
    goStep(1);
    renderQuiz();
  }

  /* ── 公開 API ── */
  window.PD = {
    goStep, nextStep, prevStep,
    quizPick,
    pickFrame, setFrameFilter,
    pickEng, setEngFilter, setEngSearch, toggleEngShowAll, skipEng,
    setDetail,
    applyHint,
    toggleAcc, setAccTab, setAccCraftFilter,
    saveOutfit, shareCard,
  };

  document.addEventListener('DOMContentLoaded', init);
})();
