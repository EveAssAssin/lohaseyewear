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
    SAVE_FN: 'https://hqdmyxxrskvllkcedybl.supabase.co/functions/v1/cloth',
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

  /* ---------- 筆觸 ----------
     等寬的線畫出來像水管,不像筆。三件事讓它有筆的感覺:

       1. 速度 —— 畫得快線變細、慢下來變粗。真實的筆就是這樣,
          而且滑鼠沒有筆壓時,速度是唯一可用的線索。
       2. 筆壓 —— 有觸控筆就用 pointer 的 pressure(滑鼠固定回 0.5)。
       3. 收尖 —— 起筆與收筆的幾個點漸細,線條才有頭尾,
          不會兩端都是齊頭的圓棒。

     粗細變化不直接套用,而是往目標值靠(lerp)——
     直接套的話手一抖線就忽粗忽細,看起來是雜訊不是筆觸。

     這對之後轉線稿也有好處:potrace 描的是輪廓,
     有粗細變化的筆畫轉出來才像手寫,不是等寬的管子。 */

  function widthAt(stroke, pt, pressure) {
    var base = stroke.w;
    var prev = stroke.pts.length ? stroke.pts[stroke.pts.length - 1] : null;

    // 筆壓:沒有觸控筆時瀏覽器固定回 0.5,算出來就是 1 倍,不影響
    var pf = 0.6 + 0.8 * (pressure > 0 ? pressure : 0.5);

    // 速度:兩個取樣點的距離。畫得越快越細
    var sf = 1;
    if (prev) {
      var dx = pt[0] - prev[0], dy = pt[1] - prev[1];
      var v = Math.sqrt(dx * dx + dy * dy);
      sf = Math.min(1, Math.max(0.35, 1 - v / 220));
    }

    var target = base * pf * sf;
    var last = prev ? prev[2] : base * 0.45;   // 起筆從細的開始
    return last + (target - last) * 0.35;      // 往目標靠,不要跳
  }

  /* 收尾時把最後幾點縮細,做出收筆。
     在放開的那一刻做,而不是邊畫邊猜 —— 畫的當下不知道哪一點是最後一點。 */
  function taperEnd(stroke) {
    var n = stroke.pts.length;
    var tail = Math.min(6, Math.floor(n / 3));
    for (var i = 0; i < tail; i++) {
      var idx = n - 1 - i;
      var k = (i + 1) / (tail + 1);            // 越靠尾巴越細
      stroke.pts[idx][2] *= (1 - k * 0.75);
    }
  }

  function drawStroke(ctx, s) {
    var p = s.pts;
    if (!p.length) return;

    /* 單點:畫一個圓。點一下想要一個點,結果什麼都沒有會以為壞掉。 */
    if (p.length === 1) {
      ctx.beginPath();
      ctx.arc(p[0][0], p[0][1], Math.max(1, p[0][2] / 2), 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    /* 逐段畫,每段自己的寬度。用中點做二次貝茲平滑,
       線條才不會是一節一節的折線。 */
    for (var i = 1; i < p.length; i++) {
      var a = p[i - 1], b = p[i];
      var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      var pmx = i > 1 ? (p[i - 2][0] + a[0]) / 2 : a[0];
      var pmy = i > 1 ? (p[i - 2][1] + a[1]) / 2 : a[1];

      ctx.beginPath();
      ctx.lineWidth = Math.max(0.8, (a[2] + b[2]) / 2);
      ctx.moveTo(pmx, pmy);
      ctx.quadraticCurveTo(a[0], a[1], mx, my);
      ctx.stroke();
    }
  }

  function prepCtx(ctx) {
    ctx.strokeStyle = '#000';
    ctx.fillStyle = '#000';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  function redraw() {
    var ctx = el.canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, CONFIG.TRACE_SIZE, CONFIG.TRACE_SIZE);
    prepCtx(ctx);
    State.strokes.forEach(function (s) { drawStroke(ctx, s); });
    el.apply.disabled = !State.strokes.length;
  }

  function bindDraw() {
    var ctx = el.canvas.getContext('2d');

    el.canvas.addEventListener('pointerdown', function (e) {
      State.drawing = true;
      el.canvas.setPointerCapture(e.pointerId);
      var pt = canvasPoint(e);
      var s = { w: State.brush, pts: [] };
      pt.push(widthAt(s, pt, e.pressure));
      s.pts.push(pt);
      State.strokes.push(s);
      prepCtx(ctx);
      drawStroke(ctx, s);
      el.apply.disabled = false;
    });

    el.canvas.addEventListener('pointermove', function (e) {
      if (!State.drawing) return;
      var s = State.strokes[State.strokes.length - 1];
      var pt = canvasPoint(e);
      pt.push(widthAt(s, pt, e.pressure));
      s.pts.push(pt);

      /* 只畫新增的那一段,不整張重畫。
         每次移動都重畫全部的話,畫久了會開始頓 —— 而頓的時候
         取樣點會變疏,線條反而更醜,是會自己惡化的那種問題。 */
      prepCtx(ctx);
      drawStroke(ctx, { w: s.w, pts: s.pts.slice(-3) });
    });

    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
      el.canvas.addEventListener(ev, function () {
        if (!State.drawing) return;
        State.drawing = false;
        var s = State.strokes[State.strokes.length - 1];
        if (s && s.pts.length > 3) { taperEnd(s); redraw(); }
      });
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

      /* 存成 JPEG,不是 PNG。
         這張是【照片】(眼鏡布的實拍圖 + 疊上去的線稿),
         PNG 存照片會肥到兩三 MB,而後台列表只用 120px 顯示它 ——
         客人與後台都要為那幾 MB 等。JPEG 同樣的畫面約是十分之一,
         而合成圖不需要透明背景,沒有任何損失。 */
      return new Promise(function (res) {
        cv.toBlob(function (b) { res(b); }, 'image/jpeg', 0.88);
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
        return uploadBlob(blob, 'cloth/' + stamp + '-preview.jpg', 'image/jpeg');
      })
      .then(function (previewUrl) {
        el.submit.textContent = '儲 存 中...';
        var m = Auth.getStoredMember ? Auth.getStoredMember() : null;

        /* ⚠ 不用前端的 anon key 直接寫資料表。
           cloth_designs 是 RLS 全鎖、零政策 —— anon key 是公開的
           (GitHub Pages),能寫就等於誰都能往這張表塞東西。
           寫入一律經 cloth Edge Function,由它驗身分後以 service_role 執行。 */
        return fetch(CONFIG.SAVE_FN, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'save',
            token: token,
            member_name: (m && m.name) || '',
            source: State.picked.source,
            design_id: State.picked.design_id,
            design_name: State.picked.name,
            svg_url: svgUrl,
            preview_url: previewUrl,
            placement: {
              scale: State.scale, x: State.x, y: State.y, basis: 'cloth_image'
            }
          })
        }).then(function (r) { return r.json(); });
      })
      .then(function (j) {
        if (String(j.code) !== '200') throw new Error(j.message || '儲存失敗');
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
