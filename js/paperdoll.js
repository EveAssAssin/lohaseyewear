// paperdoll.js — 樂活眼鏡 客製眼鏡體驗
// v1.0 | 2026-06-29

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
  };

  /* ── 工具 ── */
  const $  = id => document.getElementById(id);
  const qs = (sel, ctx) => (ctx || document).querySelector(sel);
  const qsa = (sel, ctx) => [...(ctx || document).querySelectorAll(sel)];
  const fmt = n => 'NT$' + n.toLocaleString();
  const BASE  = () => (S.frame?.price || 0) + (S.engraving?.price || 0);
  const ACC   = () => Object.values(S.acc).reduce((s, a) => s + a.price, 0);
  const TOTAL = () => BASE() + ACC();

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
    if (n === 3) renderEngravings();
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
     STEP 3 — 刻圖
  ══════════════════════════════════════════ */
  let engFilter = 'all';

  function renderEngravings() {
    const prefs = Object.values(S.quiz);
    let list = PD_DATA.engravings;
    if (engFilter !== 'all') list = list.filter(e => e.series === engFilter);

    $('eng-grid').innerHTML = list.map(e => {
      const isRec = e.tags.some(t => prefs.includes(t));
      return `
      <div class="pd-eng-card ${S.engraving?.id === e.id ? 'active' : ''}"
           onclick="PD.pickEng('${e.id}')">
        ${isRec ? '<span class="pd-badge pd-badge-warn" style="position:absolute;top:7px;right:7px">推薦</span>' : ''}
        <span class="ec-icon">${e.em}</span>
        <div class="ec-name">${e.name}</div>
        <div class="ec-author">${e.author}</div>
        <div class="ec-price">${fmt(e.price)}</div>
      </div>`;
    }).join('');

    updateEngStory();
  }

  function pickEng(id) {
    S.engraving = PD_DATA.engravings.find(e => e.id === id);
    renderEngravings();
    $('step3-next').disabled = false;
  }

  function updateEngStory() {
    const e = S.engraving;
    const box = $('eng-story');
    if (!e) {
      box.innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:24px 0">選一個刻圖，看看它的故事</div>';
      return;
    }
    box.innerHTML = `
      <div class="es-title">${e.em} ${e.name}</div>
      <div class="es-city">✦ ${e.author} × ${e.city}</div>
      <div class="es-text">${e.story}</div>
      <div class="es-count">已有 ${e.count.toLocaleString()} 副眼鏡上有這個圖案</div>
      <div class="pd-eng-collect">
        📦 收集進度：${e.series}系列 1 / ${e.total} 款<br>
        集齊可解鎖限定包裝
      </div>`;
  }

  function setEngFilter(val) {
    engFilter = val;
    qsa('#eng-filters .pd-chip').forEach(el =>
      el.classList.toggle('active', el.dataset.val === val));
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
  const CAT_LBL = { box:'眼鏡盒', cloth:'拭鏡布', bag:'眼鏡袋', stand:'置物架' };
  const CAT_POS = { box:'tl', cloth:'bl', bag:'tr', stand:'br' };

  function renderAccGrid() {
    const items = PD_DATA.acc[accCat] || [];
    const mat   = S.frame?.mat;

    $('acc-grid').innerHTML = items.map(item => {
      const isMatch  = item.matchMat && mat === item.matchMat;
      const badge    = isMatch
        ? { text:'命中注定', bt:'brand' }
        : (item.badge ? { text:item.badge, bt:item.bt } : null);
      const picked   = !!S.acc[item.id];
      return `
      <div class="pd-acc-card ${picked ? 'active' : ''}" onclick="PD.toggleAcc('${item.id}')">
        <div class="ac-check"><svg viewBox="0 0 10 8"><polyline points="1,4 4,7 9,1"/></svg></div>
        ${badge ? `<div class="ac-badge"><span class="pd-badge pd-badge-${badge.bt}">${badge.text}</span></div>` : ''}
        <div class="pd-acc-card-img">${item.em}</div>
        <div class="pd-acc-name">${item.name}</div>
        <div class="pd-acc-desc">${item.desc}</div>
        <div class="pd-acc-price">${fmt(item.price)}</div>
      </div>`;
    }).join('');
  }

  function toggleAcc(id) {
    // 找出這個 id 在哪個分類
    let found = null;
    for (const [cat, items] of Object.entries(PD_DATA.acc)) {
      const item = items.find(i => i.id === id);
      if (item) { found = { ...item, cat }; break; }
    }
    if (!found) return;

    if (S.acc[id]) delete S.acc[id];
    else S.acc[id] = found;

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
        <div class="pd-fl-row-icon">${S.engraving.em}</div>
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
    $('oc-creator').textContent = S.engraving ? `${S.engraving.author} × ${S.engraving.city}` : '';
    $('oc-total').innerHTML     = `造型總計：<b>${fmt(TOTAL())}</b>`;

    $('oc-accs').innerHTML = accs.length
      ? accs.map(a => `
          <div class="pd-oc-acc">
            <div class="pd-oc-acc-em">${a.em}</div>
            <div class="pd-oc-acc-lbl">${a.name.slice(0, 5)}</div>
          </div>`).join('')
      : '<div style="font-size:12px;color:var(--lohas-light)">尚未選擇配件</div>';
  }

  function saveOutfit() {
    try {
      const saved = JSON.parse(localStorage.getItem('lohas_outfits') || '[]');
      saved.push({
        name:        S.name || '未命名造型',
        frame:       S.frame,
        engraving:   S.engraving,
        accessories: Object.values(S.acc),
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
    pickEng, setEngFilter, skipEng,
    setDetail,
    applyHint,
    toggleAcc, setAccTab,
    saveOutfit, shareCard,
  };

  document.addEventListener('DOMContentLoaded', init);
})();
