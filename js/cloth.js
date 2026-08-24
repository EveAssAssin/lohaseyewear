/* =============================================================
   LOHAS · 客製眼鏡布 (cloth.html)
   -------------------------------------------------------------
   底圖固定(一款眼鏡布),圖案有兩種來源:
     market  刻圖市集的作品(已經有現成的 SVG 線稿)
     draw    客人自己畫(用 potrace 轉成同一種線稿)

   === 第一階段只做體驗,不成交 ===
   沒有商城商品、沒有購物車、沒有金流。做完存檔,後台看得到並下載
   SVG / DXF 製作。所以這一頁不呼叫 shop,也不需要 ERP 客編。

   === 為什麼手繪也要轉成 SVG ===
   後台要下載的 DXF 是從 SVG 轉出來的。若手繪只存 PNG,那一筆就永遠
   產不出 DXF —— 而客人不會知道自己畫的那張跟挑市集的那張待遇不同。
   所以兩種來源在存檔時的產物一致:一張合成圖 + 一份 SVG 線稿。

   依賴:LohasAuth、LohasSupabase、LohasPotrace
   ============================================================= */

(function (window, document) {
  'use strict';

  var Auth = window.LohasAuth;

  var CONFIG = {
    BASE_IMG: 'images/carrier-cloth.jpg',
    /* 預設落點取自實際成品照(images/cloth-01.jpg 上那個「Louis」的位置)——
       那是攝影時就決定好的版面,照著放比自己猜一個中間值準。 */
    DEF: { scale: 0.22, x: 0.65, y: 0.58 },
    DESIGN_PREVIEW: 12,        // 刻圖先顯示這麼多,其餘收在「展開全部」後面
    TRACE_SIZE: 1000,          // 手繪畫布的實際解析度
    MAX_SVG_BYTES: 400 * 1024  // 線稿超過這個大小多半是畫得太碎,擋下來
  };

  var State = {
    designs: [],
    filter: '',
    expanded: false,
    source: 'market',

    // 目前放在布上的圖案
    picked: null,        // { source, design_id, name, imageUrl, svgString }
    scale: CONFIG.DEF.scale,
    x: CONFIG.DEF.x,
    y: CONFIG.DEF.y,

    // 手繪
    strokes: [],         // 每一筆是 { w, pts:[[x,y],…] },保留才做得到「上一步」
    drawing: false,
    brush: 18,
    busy: false
  };

  var el = {};

  /* ---------- 工具 ---------- */

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function show(n) { if (n) n.style.display = ''; }
  function hide(n) { if (n) n.style.display = 'none'; }

  function showErr(msg) {
    el.err.textContent = msg;
    show(el.err);
    el.err.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /* ---------- 刻圖市集 ---------- */

  function loadDesigns() {
    var sb = window.LohasSupabase && window.LohasSupabase.getClient
      ? window.LohasSupabase.getClient() : null;
    if (!sb) {
      el.designs.innerHTML = '<p class="cl-empty">刻圖載入失敗</p>';
      return Promise.resolve();
    }
    return sb.from('engraving_designs')
      .select('id, name, designer_name, image_url, image_url_png, image_url_svg')
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .limit(300)
      .then(function (res) {
        State.designs = res.data || [];
        renderDesigns();
      })
      .catch(function () {
        el.designs.innerHTML = '<p class="cl-empty">刻圖載入失敗</p>';
      });
  }

  function designThumb(d) {
    return d.image_url_png || d.image_url || d.image_url_svg || '';
  }

  function filtered() {
    var q = State.filter.trim().toLowerCase();
    if (!q) return State.designs;
    return State.designs.filter(function (d) {
      return (d.name || '').toLowerCase().indexOf(q) >= 0 ||
             (d.designer_name || '').toLowerCase().indexOf(q) >= 0;
    });
  }

  function renderDesigns() {
    var list = filtered();
    if (!list.length) {
      el.designs.innerHTML = '<p class="cl-empty">找不到符合的刻圖</p>';
      hide(el.more);
      return;
    }
    var shown = State.expanded ? list : list.slice(0, CONFIG.DESIGN_PREVIEW);
    el.designs.innerHTML = shown.map(function (d) {
      var on = State.picked && State.picked.design_id === d.id ? ' on' : '';
      return '<button type="button" class="cl-design' + on + '" data-id="' + esc(d.id) + '">' +
        '<img src="' + esc(designThumb(d)) + '" alt="' + esc(d.name || '') + '" loading="lazy">' +
        '</button>';
    }).join('');

    if (list.length > CONFIG.DESIGN_PREVIEW) {
      show(el.more);
      el.more.textContent = State.expanded ? '收合' : '展開全部(' + list.length + ')';
    } else {
      hide(el.more);
    }
  }

  function pickDesign(id) {
    var d = State.designs.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!d) return;

    /* 疊在布上用 PNG(去背、瀏覽器渲染快),存檔用 SVG(製作用)。
       兩者都沒有的話這張刻圖不能用 —— 與其讓客人挑了才失敗,先擋住。 */
    if (!d.image_url_svg) {
      showErr('這張刻圖缺少線稿檔,暫時不能用在眼鏡布上。換一張試試。');
      return;
    }
    hide(el.err);

    State.picked = {
      source: 'market',
      design_id: d.id,
      name: d.name || '',
      imageUrl: designThumb(d),
      svgUrl: d.image_url_svg,
      svgString: ''
    };
    renderDesigns();
    applyOverlay();
    refreshSubmit();
  }

  /* ---------- 疊圖 ---------- */

  function applyOverlay() {
    if (!State.picked) { hide(el.overlay); return; }
    var r = el.stage.getBoundingClientRect();
    var w = r.width * State.scale;

    el.overlay.style.backgroundImage = 'url("' + State.picked.imageUrl + '")';
    el.overlay.style.width = w + 'px';
    el.overlay.style.height = w + 'px';
    el.overlay.style.left = (State.x * 100) + '%';
    el.overlay.style.top = (State.y * 100) + '%';
    show(el.overlay);

    el.scaleVal.textContent = Math.round(State.scale * 100) + '%';
    el.xVal.textContent = Math.round(State.x * 100);
    el.yVal.textContent = Math.round(State.y * 100);
    el.scale.value = Math.round(State.scale * 100);
    el.x.value = Math.round(State.x * 100);
    el.y.value = Math.round(State.y * 100);
  }

  function bindDrag() {
    var dragging = false;

    function move(e) {
      if (!dragging || !State.picked) return;
      var r = el.stage.getBoundingClientRect();
      State.x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      State.y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      applyOverlay();
    }

    el.stage.addEventListener('pointerdown', function (e) {
      if (!State.picked) return;
      dragging = true;
      el.stage.setPointerCapture(e.pointerId);
      move(e);
    });
    el.stage.addEventListener('pointermove', move);
    el.stage.addEventListener('pointerup', function () { dragging = false; });
    el.stage.addEventListener('pointercancel', function () { dragging = false; });
  }

  /* ---------- 手繪 ---------- */

  function canvasPoint(e) {
    var r = el.canvas.getBoundingClientRect();
    return [
      (e.clientX - r.left) / r.width * CONFIG.TRACE_SIZE,
      (e.clientY - r.top) / r.height * CONFIG.TRACE_SIZE
    ];
  }

  function redraw() {
    var ctx = el.canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, CONFIG.TRACE_SIZE, CONFIG.TRACE_SIZE);
    ctx.strokeStyle = '#000';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    State.strokes.forEach(function (s) {
      if (!s.pts.length) return;
      ctx.lineWidth = s.w;
      ctx.beginPath();
      ctx.moveTo(s.pts[0][0], s.pts[0][1]);
      for (var i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i][0], s.pts[i][1]);
      /* 只有一點時 lineTo 畫不出東西,補一個極短的線段當作圓點 ——
         客人點一下想要一個點,結果什麼都沒有會以為壞掉。 */
      if (s.pts.length === 1) ctx.lineTo(s.pts[0][0] + 0.1, s.pts[0][1] + 0.1);
      ctx.stroke();
    });
    el.apply.disabled = !State.strokes.length;
  }

  function bindDraw() {
    el.canvas.addEventListener('pointerdown', function (e) {
      State.drawing = true;
      el.canvas.setPointerCapture(e.pointerId);
      State.strokes.push({ w: State.brush, pts: [canvasPoint(e)] });
      redraw();
    });
    el.canvas.addEventListener('pointermove', function (e) {
      if (!State.drawing) return;
      State.strokes[State.strokes.length - 1].pts.push(canvasPoint(e));
      redraw();
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
      el.canvas.addEventListener(ev, function () { State.drawing = false; });
    });

    el.brush.addEventListener('input', function () { State.brush = Number(this.value); });
    el.undo.addEventListener('click', function () { State.strokes.pop(); redraw(); });
    el.clear.addEventListener('click', function () { State.strokes = []; redraw(); });
  }

  /* 手繪 → 線稿。
     用與刻圖市集上傳完全相同的 potrace 參數 ——
     兩邊產出的線稿要是同一種東西,不然後台下載到的檔案會有兩種脾氣。 */
  function traceDrawing() {
    var ctx = el.canvas.getContext('2d');
    var data = ctx.getImageData(0, 0, CONFIG.TRACE_SIZE, CONFIG.TRACE_SIZE);

    if (!(window.LohasPotrace && window.LohasPotrace.trace)) {
      return Promise.reject(new Error('線稿轉換工具還沒載入好,請稍候再試一次。'));
    }
    return window.LohasPotrace.trace(data, {
      turdsize: 2, turnpolicy: 4, alphamax: 1,
      opticurve: 1, opttolerance: 0.2,
      pathonly: false, extractcolors: false,
      posterizelevel: 2, posterizationalgorithm: 0
    }).then(function (svg) {
      if (!svg) throw new Error('這張圖轉不出線稿,試著畫粗一點、簡單一點。');
      // 白色路徑去掉,只留墨色 —— 與 upload-design.js 的處理一致
      svg = svg.replace(/<path[^>]+fill="rgb\(255,255,255\)"[^>]*\/>/g, '')
               .replace(/<rect[^>]+fill="rgb\(255,255,255\)"[^>]*\/>/g, '');
      return svg;
    });
  }

  function applyDrawing() {
    if (!State.strokes.length || State.busy) return;
    State.busy = true;
    el.apply.disabled = true;
    el.apply.textContent = '轉 換 中...';
    hide(el.err);

    traceDrawing()
      .then(function (svg) {
        if (svg.length > CONFIG.MAX_SVG_BYTES) {
          throw new Error('這張圖的線條太細碎,轉出來的檔案過大。試著畫粗一點。');
        }
        State.picked = {
          source: 'draw',
          design_id: null,
          name: '手繪',
          // 直接用 data URI 疊上去,不必先上傳就能看到效果
          imageUrl: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg),
          svgUrl: '',
          svgString: svg
        };
        applyOverlay();
        refreshSubmit();
      })
      .catch(function (e) { showErr(e.message); })
      .finally(function () {
        State.busy = false;
        el.apply.disabled = !State.strokes.length;
        el.apply.textContent = '把 這 張 放 上 去';
      });
  }

  /* ---------- 合成圖 ---------- */

  function loadImage(src) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.crossOrigin = 'anonymous';   // 要畫進 canvas 再匯出,不能讓它污染畫布
      img.onload = function () { res(img); };
      img.onerror = function () { rej(new Error('圖片載入失敗:' + src)); };
      img.src = src;
    });
  }

  function buildPreview() {
    var SIZE = 1200;
    return Promise.all([
      loadImage(CONFIG.BASE_IMG),
      loadImage(State.picked.imageUrl)
    ]).then(function (imgs) {
      var base = imgs[0], art = imgs[1];
      var cv = document.createElement('canvas');
      cv.width = SIZE; cv.height = SIZE;
      var ctx = cv.getContext('2d');

      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.drawImage(base, 0, 0, SIZE, SIZE);

      /* 疊圖的座標與畫面上完全相同:寬度是底圖寬的 scale 倍,
         中心點落在 (x, y)。畫面與存檔用同一組數字,才不會「看到一種、做出另一種」。 */
      var w = SIZE * State.scale;
      var ratio = (art.naturalHeight && art.naturalWidth)
        ? art.naturalHeight / art.naturalWidth : 1;
      var h = w * ratio;
      ctx.drawImage(art, SIZE * State.x - w / 2, SIZE * State.y - h / 2, w, h);

      return new Promise(function (res) {
        cv.toBlob(function (b) { res(b); }, 'image/png', 0.92);
      });
    });
  }

  /* ---------- 存檔 ---------- */

  function uploadBlob(blob, path, type) {
    var sb = window.LohasSupabase && window.LohasSupabase.getClient();
    if (!sb) return Promise.reject(new Error('儲存服務未就緒'));
    var bucket = (window.LohasSupabase.CONFIG || {}).STORAGE_BUCKET || 'gallery-uploads';
    return sb.storage.from(bucket)
      .upload(path, blob, { contentType: type, upsert: true })
      .then(function (res) {
        if (res.error) throw res.error;
        return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
      });
  }

  function randStr(n) {
    var s = 'abcdefghijklmnopqrstuvwxyz0123456789', o = '';
    var buf = new Uint8Array(n);
    crypto.getRandomValues(buf);
    for (var i = 0; i < n; i++) o += s[buf[i] % s.length];
    return o;
  }

  function submit() {
    if (!State.picked || State.busy) return;

    /* 存檔要有身分,預覽不用。
       這是「免帳號試玩」的分界:玩到看見成品都不需要登入,
       要留下東西才請他登入 —— 也順便讓匿名的人上傳不了檔案。 */
    var token = Auth && Auth.getToken ? Auth.getToken() : '';
    if (!token) {
      if (Auth && Auth.setRedirect) Auth.setRedirect('cloth.html');
      window.location.href = 'login.html';
      return;
    }

    State.busy = true;
    el.submit.disabled = true;
    el.submit.textContent = '產 生 圖 檔...';
    hide(el.err);

    var stamp = Date.now() + '-' + randStr(6);
    var svgUrl = '';

    /* 市集刻圖已經有現成的 SVG,直接沿用它的網址,不要重新上傳一份 ——
       同一個檔案存兩次,日後更新原作時會有一份永遠是舊的。 */
    var svgStep = State.picked.source === 'market'
      ? Promise.resolve(State.picked.svgUrl)
      : uploadBlob(
          new Blob([State.picked.svgString], { type: 'image/svg+xml' }),
          'cloth/' + stamp + '.svg', 'image/svg+xml');

    svgStep
      .then(function (u) {
        svgUrl = u;
        el.submit.textContent = '上 傳 中...';
        return buildPreview();
      })
      .then(function (blob) {
        return uploadBlob(blob, 'cloth/' + stamp + '-preview.png', 'image/png');
      })
      .then(function (previewUrl) {
        el.submit.textContent = '儲 存 中...';
        var m = Auth.getStoredMember ? Auth.getStoredMember() : null;
        var sb = window.LohasSupabase.getClient();
        return sb.from('cloth_designs').insert({
          erpid: (m && m.erpid) || null,
          mid: (m && m.mid) || null,
          member_name: (m && m.name) || null,
          source: State.picked.source,
          design_id: State.picked.design_id,
          design_name: State.picked.name,
          svg_url: svgUrl,
          preview_url: previewUrl,
          placement: {
            scale: State.scale, x: State.x, y: State.y, basis: 'cloth_image'
          }
        });
      })
      .then(function (res) {
        if (res && res.error) throw res.error;
        done();
      })
      .catch(function (e) {
        console.error('[cloth] 儲存失敗', e);
        showErr((e && e.message) || '儲存失敗,請再試一次。');
      })
      .finally(function () {
        State.busy = false;
        el.submit.disabled = false;
        el.submit.textContent = '儲 存 我 的 設 計';
      });
  }

  function done() {
    [el.marketCard, el.drawCard, el.placeCard, el.sourceCard,
     el.submit, el.submitHint, el.note].forEach(hide);
    el.doneText.textContent =
      '帶著會員編號到任一樂活門市,店員就能查到這張設計並為你製作。' +
      '設計會一直保留著,不用急。';
    show(el.done);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- 狀態 ---------- */

  function refreshSubmit() {
    var ok = !!State.picked;
    el.submit.disabled = !ok;
    el.submitHint.textContent = ok
      ? '存起來之後,到門市報會員編號就能製作'
      : '請先選一張刻圖,或自己畫一個';
  }

  function setSource(src) {
    State.source = src;
    el.source.querySelectorAll('.cl-seg-btn').forEach(function (b) {
      b.classList.toggle('on', b.dataset.src === src);
    });
    if (src === 'market') { show(el.marketCard); hide(el.drawCard); }
    else { hide(el.marketCard); show(el.drawCard); }
  }

  /* ---------- 啟動 ---------- */

  function init() {
    el = {
      stage: $('clStage'), base: $('clBase'), overlay: $('clOverlay'),
      sourceCard: document.querySelector('.cl-card'), source: $('clSource'),
      marketCard: $('clMarketCard'), drawCard: $('clDrawCard'),
      search: $('clSearch'), designs: $('clDesigns'), more: $('clMore'),
      canvas: $('clCanvas'), brush: $('clBrush'),
      undo: $('clUndo'), clear: $('clClear'), apply: $('clApply'),
      placeCard: $('clPlaceCard'),
      scale: $('clScale'), x: $('clX'), y: $('clY'),
      scaleVal: $('clScaleVal'), xVal: $('clXVal'), yVal: $('clYVal'),
      reset: $('clReset'), note: document.querySelector('.cl-note'),
      err: $('clErr'), submit: $('clSubmit'), submitHint: $('clSubmitHint'),
      done: $('clDone'), doneText: $('clDoneText')
    };
    if (!el.stage) return;

    redraw();
    bindDrag();
    bindDraw();

    el.source.addEventListener('click', function (e) {
      var b = e.target.closest('.cl-seg-btn');
      if (b) setSource(b.dataset.src);
    });

    el.designs.addEventListener('click', function (e) {
      var b = e.target.closest('.cl-design');
      if (b) pickDesign(b.dataset.id);
    });
    el.search.addEventListener('input', function () {
      State.filter = this.value;
      State.expanded = false;      // 換關鍵字就收合,不然搜完還是一整片
      renderDesigns();
    });
    el.more.addEventListener('click', function () {
      State.expanded = !State.expanded;
      renderDesigns();
    });

    el.apply.addEventListener('click', applyDrawing);

    [['scale', 'scale', 100], ['x', 'x', 100], ['y', 'y', 100]].forEach(function (t) {
      el[t[0]].addEventListener('input', function () {
        State[t[1]] = Number(this.value) / t[2];
        applyOverlay();
      });
    });
    el.reset.addEventListener('click', function () {
      State.scale = CONFIG.DEF.scale;
      State.x = CONFIG.DEF.x;
      State.y = CONFIG.DEF.y;
      applyOverlay();
    });

    el.submit.addEventListener('click', submit);

    // 視窗大小變了要重算疊圖的像素尺寸(scale 是比例,像素得跟著算)
    window.addEventListener('resize', applyOverlay);

    loadDesigns();
    refreshSubmit();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window, document);
