/* =============================================================
   LOHAS · 客製文創落地頁 (design.html)
   -------------------------------------------------------------
   入口:design.html?nid=<商城商品編號>
        由商城商品頁的「客製文創」按鈕,經 store-sso-login 的
        reUrl + next 導進來。

   為什麼只收 nid、不收商品名稱與價格:
     網址上的東西使用者改得動。名稱與價格一律用 nid 回頭跟
     商城 API 取,任何人改網址都只能換到「另一個真實商品」,
     沒辦法偽造商品內容或價格。

   商城 API 需要 X-Site-Key,金鑰不能放前端,
   因此一律經 Supabase Edge Function `shop` 代理。

   依賴:window.LohasAuth / window.LohasSupabase
   ============================================================= */

(function (window, document) {
  'use strict';

  var Auth = window.LohasAuth;

  var CONFIG = {
    SHOP_FN: 'https://hqdmyxxrskvllkcedybl.supabase.co/functions/v1/shop',
    TIMEOUT_MS: 15000,
    // 預設落點:鏡片右上。以商品圖寬度為單位。
    DEF: { lens: 'right', scale: 0.12, x: 0.68, y: 0.38 },
    // 切到左鏡片時,水平位置以圖片中線鏡射
    LEFT_X: 0.32,
    // 刻圖先只顯示這麼多,其餘收在「展開全部」後面。
    // 目前有 300 張以上,全開會把右欄拉得又臭又長,選商品的人根本捲不到底。
    DESIGN_PREVIEW: 8
  };

  var State = {
    nid: 0,
    product: null,
    specSid: null,
    specTitle: '',
    designs: [],
    design: null,
    designsExpanded: false,
    lens: CONFIG.DEF.lens,
    scale: CONFIG.DEF.scale,
    x: CONFIG.DEF.x,
    y: CONFIG.DEF.y,
    filter: ''
  };

  var el = {};

  /* ---------- 工具 ---------- */

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function money(n) { return Number(n || 0).toLocaleString(); }

  function show(n) { if (n) n.style.display = ''; }
  function hide(n) { if (n) n.style.display = 'none'; }

  function fail(msg) {
    hide(el.loading); hide(el.body);
    el.errorText.textContent = msg;
    show(el.error);
  }

  function shopCall(payload) {
    var ctrl = new AbortController();
    var to = setTimeout(function () { ctrl.abort(); }, CONFIG.TIMEOUT_MS);
    return fetch(CONFIG.SHOP_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    })
      .then(function (r) { clearTimeout(to); return r.json(); })
      .then(function (j) {
        if (String(j.code) !== '200' || !j.data) {
          throw new Error(j.message || '商品讀取失敗');
        }
        return j.data;
      })
      .catch(function (err) {
        clearTimeout(to);
        if (err.name === 'AbortError') throw new Error('連線逾時,請重新整理再試');
        if (err instanceof TypeError) throw new Error('目前無法連線到商城,請稍後再試。');
        throw err;
      });
  }

  /* ---------- 商品 ---------- */

  function loadProduct() {
    return shopCall({ action: 'product', nid: State.nid }).then(function (d) {
      var p = d.product;
      if (!p) throw new Error('查無這件商品,或商品已下架。');

      // 防呆:有人手動改網址,對不可文創的商品發起流程
      if (p.can_design === false) {
        throw new Error('這件商品沒有開放客製文創。請回商城挑選標示「可文創」的款式。');
      }

      State.product = p;
      el.productName.textContent = p.title || '(未命名商品)';

      var price = (p.offer_price != null && p.offer_price !== '')
        ? '<b>NT$' + money(p.offer_price) + '</b> <s>NT$' + money(p.price) + '</s>'
        : '<b>NT$' + money(p.price) + '</b>';
      el.productPrice.innerHTML = price +
        '<span class="dz-price-note">刻圖費用另計,以結帳金額為準</span>';

      if (p.image) el.productImg.src = p.image;
      renderSpecs(p.specifications || []);
      return p;
    });
  }

  /* 規格樹最多三層,這裡只攤平成可點的葉節點 —— 第一版不做多層連動,
     因為眼鏡商品實務上就是「顏色」或「尺寸」單層居多。
     真的遇到多層,攤平後仍能選到正確的 sid,只是選項會多一點。 */
  function flattenSpecs(nodes, path, out) {
    (nodes || []).forEach(function (n) {
      var label = path ? path + ' / ' + n.title : n.title;
      if (n.children && n.children.length) {
        flattenSpecs(n.children, label, out);
      } else {
        out.push({ sid: n.sid, title: label, price: n.price, stock: n.stock, image: n.image });
      }
    });
    return out;
  }

  function renderSpecs(tree) {
    var leaves = flattenSpecs(tree, '', []);
    if (!leaves.length) { el.specs.innerHTML = ''; return; }

    el.specs.innerHTML =
      '<div class="dz-spec-label">規格</div>' +
      '<div class="dz-spec-list">' +
      leaves.map(function (s, i) {
        var out = Number(s.stock) === 0;
        return '<button class="dz-spec' + (out ? ' is-out' : '') + '" ' +
               'data-sid="' + s.sid + '" data-title="' + esc(s.title) + '"' +
               (out ? ' disabled' : '') + '>' +
               esc(s.title) + (out ? '<span class="dz-spec-out">缺貨</span>' : '') +
               '</button>';
      }).join('') +
      '</div>';

    el.specs.addEventListener('click', function (e) {
      var b = e.target.closest('.dz-spec');
      if (!b || b.disabled) return;
      el.specs.querySelectorAll('.dz-spec').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      State.specSid = Number(b.dataset.sid);
      State.specTitle = b.dataset.title;
      // 規格有自己的圖就換掉主視覺,客人才看得到自己選的顏色
      var leaf = leaves.find(function (s) { return String(s.sid) === b.dataset.sid; });
      if (leaf && leaf.image) el.productImg.src = leaf.image;
      refreshSubmit();
    });
  }

  /* ---------- 刻圖 ---------- */

  function loadDesigns() {
    var sb = window.LohasSupabase && window.LohasSupabase.getClient
      ? window.LohasSupabase.getClient() : null;
    if (!sb) { el.designGrid.innerHTML = '<p class="dz-empty">刻圖載入失敗</p>'; return; }

    return sb.from('engraving_designs')
      .select('id, name, designer_name, category, image_url, image_url_png, image_url_svg')
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .limit(300)
      .then(function (res) {
        State.designs = res.data || [];
        renderDesigns();
      })
      .catch(function () {
        el.designGrid.innerHTML = '<p class="dz-empty">刻圖載入失敗</p>';
      });
  }

  function designUrl(d) {
    return [d.image_url_png, d.image_url, d.image_url_svg].filter(function (u) {
      return u && /^https?:\/\//.test(u);
    })[0] || '';
  }

  function renderDesigns() {
    var q = State.filter.trim().toLowerCase();
    var list = State.designs.filter(function (d) {
      if (!q) return true;
      return (d.name || '').toLowerCase().indexOf(q) >= 0 ||
             (d.designer_name || '').toLowerCase().indexOf(q) >= 0 ||
             (d.category || '').toLowerCase().indexOf(q) >= 0;
    });

    if (!list.length) {
      el.designGrid.innerHTML = '<p class="dz-empty">找不到符合的刻圖</p>';
      hide(el.more);
      return;
    }

    // 已選中的那張一定要在畫面上,否則收合後使用者會看不到自己選了什麼
    var shown = list;
    if (!State.designsExpanded && list.length > CONFIG.DESIGN_PREVIEW) {
      shown = list.slice(0, CONFIG.DESIGN_PREVIEW);
      if (State.design && !shown.some(function (d) { return d.id === State.design.id; })) {
        var picked = list.find(function (d) { return d.id === State.design.id; });
        if (picked) shown = [picked].concat(shown.slice(0, CONFIG.DESIGN_PREVIEW - 1));
      }
    }

    el.designGrid.innerHTML = shown.map(function (d) {
      var u = designUrl(d);
      var on = State.design && State.design.id === d.id ? ' on' : '';
      return '<button class="dz-design' + on + '" data-id="' + esc(d.id) + '" ' +
             'title="' + esc(d.name || '') + '">' +
             (u ? '<img src="' + esc(u) + '" alt="' + esc(d.name || '') + '" loading="lazy">'
                : '<i class="fa-regular fa-image"></i>') +
             '</button>';
    }).join('');

    if (list.length <= CONFIG.DESIGN_PREVIEW) {
      hide(el.more);
    } else {
      show(el.more);
      el.more.innerHTML = State.designsExpanded
        ? '<i class="fa-solid fa-chevron-up"></i> 收合'
        : '<i class="fa-solid fa-chevron-down"></i> 展開全部 ' + list.length + ' 張';
    }
  }

  function pickDesign(id) {
    var d = State.designs.find(function (x) { return String(x.id) === String(id); });
    if (!d) return;
    State.design = d;
    var u = designUrl(d);
    if (u) {
      el.overlay.src = u;
      show(el.overlay);
    }
    show(el.placeCard);
    renderDesigns();
    applyPlacement();
    refreshSubmit();
  }

  /* ---------- 位置 ---------- */

  function applyPlacement() {
    if (!State.design) return;
    // 以商品圖寬度為單位,換算成百分比定位。
    // 用百分比而不是像素,是為了讓同一組數值在任何尺寸的畫面上都一致。
    el.overlay.style.width = (State.scale * 100) + '%';
    el.overlay.style.left  = (State.x * 100) + '%';
    el.overlay.style.top   = (State.y * 100) + '%';

    el.scaleVal.textContent = Math.round(State.scale * 100) + '%';
    el.xVal.textContent = Math.round(State.x * 100);
    el.yVal.textContent = Math.round(State.y * 100);
    el.scale.value = State.scale;
    el.x.value = State.x;
    el.y.value = State.y;
  }

  function setLens(lens) {
    if (lens === State.lens) return;
    State.lens = lens;
    // 換鏡片時把水平位置鏡射過去,使用者不用重調
    State.x = 1 - State.x;
    el.lens.querySelectorAll('.dz-lens-btn').forEach(function (b) {
      b.classList.toggle('on', b.dataset.lens === lens);
    });
    applyPlacement();
  }

  function resetPlacement() {
    State.lens = CONFIG.DEF.lens;
    State.scale = CONFIG.DEF.scale;
    State.x = CONFIG.DEF.x;
    State.y = CONFIG.DEF.y;
    el.lens.querySelectorAll('.dz-lens-btn').forEach(function (b) {
      b.classList.toggle('on', b.dataset.lens === CONFIG.DEF.lens);
    });
    applyPlacement();
  }

  /* 拖曳:滑鼠與觸控共用 pointer 事件,不必寫兩套 */
  function bindDrag() {
    var dragging = false;

    el.overlay.addEventListener('pointerdown', function (e) {
      dragging = true;
      el.overlay.setPointerCapture(e.pointerId);
      el.overlay.classList.add('is-dragging');
      e.preventDefault();
    });

    el.overlay.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var r = el.stage.getBoundingClientRect();
      if (!r.width || !r.height) return;
      State.x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      State.y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      applyPlacement();
    });

    function end(e) {
      if (!dragging) return;
      dragging = false;
      try { el.overlay.releasePointerCapture(e.pointerId); } catch (_) {}
      el.overlay.classList.remove('is-dragging');
    }
    el.overlay.addEventListener('pointerup', end);
    el.overlay.addEventListener('pointercancel', end);
  }

  /* ---------- 滑到底浮鈕 ----------
     刻圖展開後右欄會很長,「加入購物車」在最底部。
     行為比照刻圖市集:捲一段後浮出,到底後翻轉成「回到頂部」。 */
  function bindScrollBtn() {
    var btn = el.scroll;
    var target = el.submit;
    if (!btn || !target) return;

    var label = btn.querySelector('.dz-scroll-label');

    function onScroll() {
      btn.classList.toggle('show', window.scrollY > 240);
      var atBottom = target.getBoundingClientRect().top < window.innerHeight * 0.9;
      btn.classList.toggle('at-bottom', atBottom);
      if (label) label.textContent = atBottom ? '回到頂部' : '加入購物車';
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    btn.addEventListener('click', function () {
      if (btn.classList.contains('at-bottom')) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }

  /* ---------- 送出 ---------- */

  function refreshSubmit() {
    var needSpec = el.specs.querySelector('.dz-spec') && State.specSid == null;
    var ok = !!State.design && !needSpec;
    el.submit.disabled = !ok;
    el.submitHint.textContent = !State.design ? '請先選一張刻圖'
      : needSpec ? '請選擇規格'
      : '完成後會帶著這張設計回到商城結帳';
  }

  /* 產出要送進 cart/push 的內容。
     ⚠ 商城的 cart/push 正式規格尚未收到(手上是草案版,且沒有位置欄位),
     所以這一版先把 payload 準備好並存進 sessionStorage,
     等規格確認就把下面的 TODO 換成真正的呼叫。 */
  function buildPayload() {
    return {
      main: {
        nid: State.product.nid,
        sid: State.specSid,
        amount: 1,
        design: {
          design_id: State.design.id,
          design_name: State.design.name,
          engraving_url: State.design.image_url_svg || null,
          preview_url: designUrl(State.design),
          placement: {
            lens: State.lens,
            scale: State.scale,
            x: State.x,
            y: State.y,
            basis: 'product_image'    // 座標基準:商品圖寬高的比例
          }
        }
      },
      plus_buy: [{ type: 'engraving_fee', amount: 1 }]
    };
  }

  function onSubmit() {
    if (!State.design || !State.product) return;
    var payload = buildPayload();
    try { sessionStorage.setItem('lohasDesignDraft', JSON.stringify(payload)); } catch (e) {}

    // TODO(等商城 cart/push 正式規格):
    //   POST {SHOP}/api/site/cart/push → 取得 cart_url → location.href = cart_url
    //   一次性 token 60 秒有效,且必須整頁導轉(不可放 iframe),
    //   否則第三方 cookie 限制會讓商城那邊建立不了登入。
    console.info('[design] cart/push payload', payload);
    window.alert(
      '設計已完成\n\n' +
      (State.product.title || '') + (State.specTitle ? ' · ' + State.specTitle : '') + '\n' +
      '刻圖:' + (State.design.name || '') + '\n\n' +
      '購物車回拋介面尚未開通,設計已暫存。介面接上後會直接帶你到商城結帳。'
    );
  }

  /* ---------- 啟動 ---------- */

  function init() {
    el = {
      loading: $('dzLoading'), error: $('dzError'), errorText: $('dzErrorText'),
      body: $('dzBody'),
      stage: $('dzStage'), productImg: $('dzProductImg'), overlay: $('dzOverlay'),
      productName: $('dzProductName'), productPrice: $('dzProductPrice'), specs: $('dzSpecs'),
      designSearch: $('dzDesignSearch'), designGrid: $('dzDesignGrid'), more: $('dzMore'),
      scroll: $('dzScroll'),
      placeCard: $('dzPlaceCard'), lens: $('dzLens'),
      scale: $('dzScale'), x: $('dzX'), y: $('dzY'),
      scaleVal: $('dzScaleVal'), xVal: $('dzXVal'), yVal: $('dzYVal'),
      reset: $('dzReset'), submit: $('dzSubmit'), submitHint: $('dzSubmitHint')
    };
    if (!el.body) return;

    var nid = Number(new URLSearchParams(location.search).get('nid') || 0);
    if (!nid) {
      fail('這個連結沒有指定商品。請從商城的商品頁點「客製文創」進入。');
      return;
    }
    State.nid = nid;

    loadProduct()
      .then(function () {
        hide(el.loading);
        show(el.body);
        applyPlacement();
        return loadDesigns();
      })
      .catch(function (err) { fail(err.message); });

    // 事件
    el.designGrid.addEventListener('click', function (e) {
      var b = e.target.closest('.dz-design');
      if (b) pickDesign(b.dataset.id);
    });
    el.designSearch.addEventListener('input', function () {
      State.filter = el.designSearch.value;
      // 換關鍵字就收回去,不然搜完還是一整片
      State.designsExpanded = false;
      renderDesigns();
    });
    el.more.addEventListener('click', function () {
      State.designsExpanded = !State.designsExpanded;
      renderDesigns();
    });
    el.lens.addEventListener('click', function (e) {
      var b = e.target.closest('.dz-lens-btn');
      if (b) setLens(b.dataset.lens);
    });
    el.scale.addEventListener('input', function () {
      State.scale = parseFloat(el.scale.value); applyPlacement();
    });
    el.x.addEventListener('input', function () {
      State.x = parseFloat(el.x.value); applyPlacement();
    });
    el.y.addEventListener('input', function () {
      State.y = parseFloat(el.y.value); applyPlacement();
    });
    el.reset.addEventListener('click', resetPlacement);
    el.submit.addEventListener('click', onSubmit);

    bindDrag();
    bindScrollBtn();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window, document);
