/* =============================================================
   客製眼鏡盒(case.html)
   -------------------------------------------------------------
   做圖的部分與 js/cloth.js 是【同一套】:刻圖市集、自己畫、打字、
   上傳,最後都走到同一個 applyOverlay。兩頁的操作方式要一樣,
   客人從客製中心跳過來不必重新學。

   === 與眼鏡布最大的不同:座標的基準 ===
   眼鏡布整塊都能印,所以 x / y 是相對【整張布】。
   眼鏡盒只有盒蓋中間那一塊能刻,所以 x / y 是相對
   【可雕刻範圍(.cs-plate)】—— 那也正是製作端要的座標系。

   ⚠ 位置一律存百分比不存像素。預覽框寬度隨螢幕變,存像素的話
     同一張圖在手機上會跑到框外,而送到製作端的座標是錯的 ——
     那種錯不報錯,會變成一件刻歪的成品。

   尚未接上:定價與結帳、分享牆的資料來源。
   ============================================================= */

(function (window, document) {
  'use strict';

  var Auth = window.LohasAuth;

  var CONFIG = {
    /* 描圖用的畫布邊長。與 cloth.js 一致。 */
    TRACE_SIZE: 1000,
    MIN_SCALE: 0.10,
    /* 圖最大可以佔可雕刻範圍的多少。
       ⚠ 不是 1.0 —— 留邊是因為雷射在邊緣的能量與中央不同,
         而且盒蓋是圓角,貼到框線的圖實際上刻不滿。 */
    MAX_SCALE: 1.00,
    MAX_SVG_BYTES: 900 * 1024
  };

  /* x / y 是 0~1(可雕刻範圍的左上到右下),scale 是佔範圍框寬度的比例。 */
  var DEFAULT = { x: 0.5, y: 0.5, scale: 0.55, rot: 0 };

  var State = {
    src: 'market',
    picked: null,        // { source, design_id, name, imageUrl, svgUrl, svgString }
    x: DEFAULT.x, y: DEFAULT.y, scale: DEFAULT.scale, rot: DEFAULT.rot,
    ratio: 1,            // 圖的高/寬
    ratioFor: '',
    strokes: [],
    busy: false
  };

  /* 一次先畫幾張,按「展開全部」才畫其餘的。
     ⚠ 三百張縮圖一次塞進 DOM,手機會卡住好幾秒 ——
       而那幾秒畫面是動不了的,客人會以為當掉。 */
  var PREVIEW_N = 12;
  var Market = { designs: [], filter: '', expanded: false };

  var el = {};

  /* ---------- 小工具 ---------- */

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function show(n) { if (n) n.style.display = ''; }
  function hide(n) { if (n) n.style.display = 'none'; }

  /* ⚠ 用 style.display 不是 hidden —— .cl-err 的預設隱藏寫在 HTML 的
     inline style(與站上其他頁一致),設 hidden 的話 inline 的
     display:none 仍然贏,訊息永遠顯示不出來。 */
  function showErr(msg) {
    if (!el.err) return;
    el.err.textContent = msg || '';
    if (msg) { show(el.err); el.err.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    else hide(el.err);
  }

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  /* =============================================================
     疊圖
     ============================================================= */

  /* 這一張圖能放到多大。
     ⚠ scale 是【寬度】佔範圍框的比例,而高度是 寬 × 高寬比。
       只擋 scale 只擋到寬 —— 一張 1:2 的直圖在 1.0 時高度是範圍框
       的兩倍,整個溢出盒蓋,而畫面上看起來「只是大了點」。
       所以拿長邊去算。(與 cloth.js 的 maxScale 同一個理由。) */
  function maxScale() {
    var longSide = Math.max(1, Number(State.ratio) || 1);
    return CONFIG.MAX_SCALE / longSide;
  }

  function loadImage(src) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () { res(img); };
      img.onerror = function () { rej(new Error('圖載不到')); };
      img.src = src;
    });
  }

  /* 量出圖案的高寬比,量完重畫一次。
     量不到就維持 1(正方形)—— 外框會比圖大一點,但不會壞掉。
     這比「載不到就不顯示外框」好:客人還是能拖、能拉。 */
  function measureRatio() {
    if (!State.picked || !State.picked.imageUrl) return;
    var url = State.picked.imageUrl;
    loadImage(url).then(function (img) {
      if (!State.picked || State.picked.imageUrl !== url) return;  // 期間換了圖
      if (img.naturalWidth && img.naturalHeight) {
        State.ratio = img.naturalHeight / img.naturalWidth;
        /* ⚠ 換到更長的圖時,原本的 scale 可能已經超過新的上限。
           不在這裡收的話,那一張會以超出範圍的尺寸送出去,
           而客人完全不會察覺 —— 他沒有動過任何東西。 */
        if (State.scale > maxScale()) State.scale = maxScale();
        applyOverlay();
      }
    }).catch(function () { /* 量不到就用預設值,不影響操作 */ });
  }

  function applyOverlay() {
    syncChrome();

    /* 滑桿與數字先同步,而且要在下面那個 return 之前 ——
       清空時 State 已經回預設,若跟著 return 掉,畫面上會留著
       上一張圖的數字,下次挑圖就從那個數字開始。 */
    el.scaleVal.textContent = Math.round(State.scale * 100) + '%';
    el.xVal.textContent = Math.round(State.x * 100);
    el.yVal.textContent = Math.round(State.y * 100);
    el.scale.value = Math.round(State.scale * 100);
    el.x.value = Math.round(State.x * 100);
    el.y.value = Math.round(State.y * 100);

    if (!State.picked) {
      hide(el.overlay);
      if (el.stageEmpty) el.stageEmpty.hidden = false;
      return;
    }
    if (el.stageEmpty) el.stageEmpty.hidden = true;

    if (State.picked.imageUrl !== State.ratioFor) {
      State.ratioFor = State.picked.imageUrl;
      State.ratio = 1;
      measureRatio();
    }

    var r = el.plate.getBoundingClientRect();
    var w = r.width * State.scale;

    el.overlay.style.backgroundImage = 'url("' + State.picked.imageUrl + '")';
    el.overlay.style.width = w + 'px';
    /* ⚠ 高度用真實比例,不是正方形。
       用 w × w + contain 的話畫面上看起來一樣(圖被置中留白),
       但【外框會比圖大一圈】,四個節點就不在圖案的角上了。 */
    el.overlay.style.height = (w * State.ratio) + 'px';
    el.overlay.style.left = (State.x * 100) + '%';
    el.overlay.style.top = (State.y * 100) + '%';
    el.overlay.style.setProperty('--cl-rot', State.rot + 'deg');
    show(el.overlay);
  }

  /* 三種手勢共用一個迴圈:移動、縮放、旋轉。
     分成三組事件的話會有三份幾乎一樣的程式碼,
     而漏掉其中一份的 pointerup 就會「放開了還在跟著跑」。

     ⚠ 節點的 pointerdown 會【冒泡到 plate】—— 不先讓開的話,
       拉節點會同時觸發「把圖移到手指下面」,圖案會瞬間跳走。 */
  function bindDrag() {
    var mode = null;
    var start = null;

    function centerOf() {
      var r = el.plate.getBoundingClientRect();
      return { cx: r.left + r.width * State.x, cy: r.top + r.height * State.y, r: r };
    }

    function move(e) {
      if (!mode || !State.picked) return;
      var c = centerOf();

      if (mode === 'move') {
        State.x = clamp01((e.clientX - c.r.left) / c.r.width);
        State.y = clamp01((e.clientY - c.r.top) / c.r.height);

      } else if (mode === 'scale') {
        /* 用「手指到中心的距離」與按下當時的距離比,乘回原本的大小。
           不直接拿距離換算,是因為那樣一按下去圖就會跳到手指的位置 ——
           人期待的是「從我抓住的地方開始變」。 */
        var d = Math.hypot(e.clientX - c.cx, e.clientY - c.cy);
        if (start.dist > 4) {
          var next = start.scale * (d / start.dist);
          State.scale = Math.min(maxScale(), Math.max(CONFIG.MIN_SCALE, next));
        }

      } else if (mode === 'rot') {
        var a = Math.atan2(e.clientY - c.cy, e.clientX - c.cx) * 180 / Math.PI;
        var deg = start.rot + (a - start.angle);
        // Shift 每 15 度一格 —— 要正的水平或垂直時,徒手很難剛好對上
        if (e.shiftKey) deg = Math.round(deg / 15) * 15;
        State.rot = ((deg % 360) + 360) % 360;
      }

      applyOverlay();
    }

    function stop(e) {
      if (!mode) return;
      mode = null;
      try { el.plate.releasePointerCapture(e.pointerId); } catch (err) { /* 已釋放 */ }
    }

    el.plate.addEventListener('pointerdown', function (e) {
      if (!State.picked) return;
      var node = e.target.closest ? e.target.closest('[data-node]') : null;
      var c = centerOf();

      if (node) {
        e.preventDefault();
        e.stopPropagation();
        if (node.dataset.node === 'rot') {
          mode = 'rot';
          start = {
            rot: State.rot,
            angle: Math.atan2(e.clientY - c.cy, e.clientX - c.cx) * 180 / Math.PI
          };
        } else {
          mode = 'scale';
          start = {
            scale: State.scale,
            dist: Math.hypot(e.clientX - c.cx, e.clientY - c.cy)
          };
        }
      } else {
        mode = 'move';
        move(e);            // 按下就跟到手指位置,與眼鏡布一致
      }

      el.plate.setPointerCapture(e.pointerId);
    });

    el.plate.addEventListener('pointermove', move);
    el.plate.addEventListener('pointerup', stop);
    el.plate.addEventListener('pointercancel', stop);
  }

  function bindSliders() {
    el.scale.addEventListener('input', function () {
      State.scale = Math.min(maxScale(), Number(el.scale.value) / 100);
      applyOverlay();
    });
    el.x.addEventListener('input', function () {
      State.x = Number(el.x.value) / 100; applyOverlay();
    });
    el.y.addEventListener('input', function () {
      State.y = Number(el.y.value) / 100; applyOverlay();
    });
    el.reset.addEventListener('click', function () {
      State.x = DEFAULT.x; State.y = DEFAULT.y;
      State.scale = Math.min(maxScale(), DEFAULT.scale); State.rot = DEFAULT.rot;
      applyOverlay();
    });
  }

  /* =============================================================
     刻圖市集
     -------------------------------------------------------------
     ⚠ 只讀 status='approved',與 js/cloth.js 一致。少了它,
       待審核與被駁回的作品會出現在客人的選單裡 —— 那是審核制度
       失效,而且畫面上完全看不出異常。
     ============================================================= */

  function loadDesigns() {
    var sb = window.LohasSupabase && window.LohasSupabase.getClient
      ? window.LohasSupabase.getClient() : null;
    if (!sb) {
      el.designs.innerHTML = '<p class="cl-empty">刻圖載入失敗</p>';
      return;
    }
    sb.from('engraving_designs')
      .select('id, name, designer_name, image_url, image_url_png, image_url_svg')
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .limit(300)
      .then(function (res) { Market.designs = res.data || []; renderDesigns(); })
      .catch(function () {
        el.designs.innerHTML = '<p class="cl-empty">刻圖載入失敗</p>';
      });
  }

  /* 縮圖用 PNG(去背、瀏覽器畫得快),真正要雕的是 SVG 線稿。
     兩者的用途不可互換 —— 見 pickDesign。 */
  function thumb(d) {
    return d.image_url_png || d.image_url || d.image_url_svg || '';
  }

  function filtered() {
    var q = Market.filter.trim().toLowerCase();
    if (!q) return Market.designs;
    return Market.designs.filter(function (d) {
      return (d.name || '').toLowerCase().indexOf(q) >= 0 ||
             (d.designer_name || '').toLowerCase().indexOf(q) >= 0;
    });
  }

  function renderDesigns() {
    if (!el.designs) return;
    var list = filtered();
    if (!list.length) {
      el.designs.innerHTML = '<p class="cl-empty">' +
        (Market.designs.length ? '找不到符合的刻圖' : '目前沒有可用的刻圖') + '</p>';
      hide(el.more);
      return;
    }
    var shown = Market.expanded ? list : list.slice(0, PREVIEW_N);
    el.designs.innerHTML = shown.map(function (d) {
      var on = State.picked && State.picked.design_id === d.id ? ' on' : '';
      return '<button type="button" class="cl-design' + on + '" data-id="' + esc(d.id) + '"' +
             ' title="' + esc(d.name || '') + '">' +
             '<img src="' + esc(thumb(d)) + '" alt="' + esc(d.name || '') + '" loading="lazy">' +
             '</button>';
    }).join('');

    if (list.length > PREVIEW_N) {
      show(el.more);
      el.more.textContent = Market.expanded ? '收合' : '展開全部（' + list.length + '）';
    } else {
      hide(el.more);
    }
  }

  function pickDesign(id) {
    var d = null;
    for (var i = 0; i < Market.designs.length; i++) {
      if (String(Market.designs[i].id) === String(id)) { d = Market.designs[i]; break; }
    }
    if (!d) return;

    /* 🚨 沒有 SVG 線稿就【不能選】。
       雷刻吃的是線稿(要轉成 DXF 給雕刻機),PNG 只是給人看的縮圖。
       讓客人挑了、調好位置、付完錢,才在製作端發現刻不出來 ——
       那時候退的是一筆已經收了的錢。先擋住。 */
    if (!d.image_url_svg) {
      showErr('這張刻圖缺少線稿檔，不能拿來雕刻。換一張試試。');
      return;
    }
    showErr('');
    setPicked({
      source: 'market',
      design_id: d.id,
      name: d.name || '',
      imageUrl: thumb(d),
      svgUrl: d.image_url_svg,
      svgString: ''
    });
    renderDesigns();
  }

  /* 換圖時位置回到預設。沿用上一張的位置看起來像「貼心」,
     實際上是上一張的構圖套在完全不同比例的圖上,幾乎一定要重調。 */
  function setPicked(p) {
    State.picked = p;
    State.x = DEFAULT.x; State.y = DEFAULT.y;
    State.scale = DEFAULT.scale; State.rot = DEFAULT.rot;
    applyOverlay();
    refreshSubmit();
  }

  function clearPick() {
    State.picked = null;
    State.x = DEFAULT.x; State.y = DEFAULT.y;
    State.scale = DEFAULT.scale; State.rot = DEFAULT.rot;
    applyOverlay();
    renderDesigns();
    refreshSubmit();
  }

  /* =============================================================
     自己畫
     ============================================================= */

  function canvasPoint(e) {
    var r = el.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width * CONFIG.TRACE_SIZE,
      y: (e.clientY - r.top) / r.height * CONFIG.TRACE_SIZE
    };
  }

  function redraw() {
    var ctx = el.canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, CONFIG.TRACE_SIZE, CONFIG.TRACE_SIZE);
    ctx.strokeStyle = '#000';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    State.strokes.forEach(function (s) {
      if (s.pts.length < 2) {
        // 單點也要畫得出來 —— 不然「點一下」看起來像沒反應
        ctx.beginPath();
        ctx.arc(s.pts[0].x, s.pts[0].y, s.w / 2, 0, Math.PI * 2);
        ctx.fillStyle = '#000';
        ctx.fill();
        return;
      }
      ctx.lineWidth = s.w;
      ctx.beginPath();
      ctx.moveTo(s.pts[0].x, s.pts[0].y);
      for (var i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i].x, s.pts[i].y);
      ctx.stroke();
    });
    el.drawApply.disabled = !State.strokes.length || State.busy;
  }

  function bindDraw() {
    if (!el.canvas) return;
    var drawing = false;

    el.canvas.addEventListener('pointerdown', function (e) {
      drawing = true;
      State.strokes.push({ w: Number(el.brush.value) || 14, pts: [canvasPoint(e)] });
      el.canvas.setPointerCapture(e.pointerId);
      redraw();
      e.preventDefault();
    });
    el.canvas.addEventListener('pointermove', function (e) {
      if (!drawing) return;
      State.strokes[State.strokes.length - 1].pts.push(canvasPoint(e));
      redraw();
    });
    function stop(e) {
      if (!drawing) return;
      drawing = false;
      try { el.canvas.releasePointerCapture(e.pointerId); } catch (_e) {}
    }
    el.canvas.addEventListener('pointerup', stop);
    el.canvas.addEventListener('pointercancel', stop);

    el.undo.addEventListener('click', function () { State.strokes.pop(); redraw(); });
    el.clear.addEventListener('click', function () { State.strokes = []; redraw(); });
    el.drawApply.addEventListener('click', function () { applyCanvas(el.canvas, 'draw', '手繪'); });

    redraw();
  }

  /* =============================================================
     打字
     -------------------------------------------------------------
     ⚠ 字型全部用【裝置上的系統字型】,不另外下載。中文字型檔動輒
       好幾 MB,為了四個選項讓每個客人下載那些,代價遠大於好處。
       而「不同裝置長得不一樣」在這裡不成立 —— 描邊是在客人自己的
       瀏覽器上做的,他看到的那一張就是被描的那一張。
     ============================================================= */

  var TEXT_FONTS = {
    hei:   '"Noto Sans TC","Microsoft JhengHei","PingFang TC",sans-serif',
    kai:   '"DFKai-SB","BiauKai","Kaiti TC","楷體",serif',
    ming:  '"PMingLiU","Songti TC","宋體",serif',
    round: '"Yuanti TC","圓體","Microsoft YaHei","Noto Sans TC",sans-serif'
  };

  function renderText() {
    if (!el.textCanvas) return;
    var ctx = el.textCanvas.getContext('2d');
    var S = CONFIG.TRACE_SIZE;

    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, S, S);

    var lines = (el.textInput.value || '').replace(/\r/g, '').split('\n')
      .map(function (t) { return t.trim(); })
      .filter(function (t) { return t.length; });

    el.textApply.disabled = !lines.length || State.busy;
    if (!lines.length) return;

    var family = TEXT_FONTS[el.textFont.value] || TEXT_FONTS.hei;
    var pad = S * 0.08;
    var avail = S - pad * 2;

    /* 字級用「試一個大的,再依實際量到的寬度收」的方式決定。
       中文字寬與字級大致成比例,但標點與英數不是 —— 量過才準。 */
    var lineH = avail / lines.length;
    var size = Math.min(lineH * 0.82, avail);
    ctx.font = '700 ' + size + 'px ' + family;
    var widest = Math.max.apply(null, lines.map(function (t) {
      return ctx.measureText(t).width;
    }));
    if (widest > avail) size = size * (avail / widest);

    ctx.font = '700 ' + size + 'px ' + family;
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    var step = size * 1.25;
    var startY = S / 2 - step * (lines.length - 1) / 2;
    lines.forEach(function (t, i) { ctx.fillText(t, S / 2, startY + step * i); });
  }

  function bindText() {
    if (!el.textCanvas) return;
    el.textInput.addEventListener('input', renderText);
    el.textFont.addEventListener('change', renderText);
    el.textApply.addEventListener('click', function () {
      applyCanvas(el.textCanvas, 'draw', '文字');
    });
    renderText();
  }

  /* =============================================================
     描圖(自己畫 / 打字共用)
     ============================================================= */

  function traceCanvas(canvas) {
    var ctx = canvas.getContext('2d');
    var data = ctx.getImageData(0, 0, CONFIG.TRACE_SIZE, CONFIG.TRACE_SIZE);

    if (!(window.LohasPotrace && window.LohasPotrace.trace)) {
      return Promise.reject(new Error('線稿轉換工具還沒載入好，請稍候再試一次。'));
    }
    return window.LohasPotrace.trace(data, {
      turdsize: 2, turnpolicy: 4, alphamax: 1,
      opticurve: 1, opttolerance: 0.2,
      pathonly: false, extractcolors: false,
      posterizelevel: 2, posterizationalgorithm: 0
    }).then(function (svg) {
      if (!svg) throw new Error('這張圖轉不出線稿，試著畫粗一點、簡單一點。');
      // 白色路徑去掉,只留墨色 —— 與 upload-design.js 的處理一致
      return svg.replace(/<path[^>]+fill="rgb\(255,255,255\)"[^>]*\/>/g, '')
                .replace(/<rect[^>]+fill="rgb\(255,255,255\)"[^>]*\/>/g, '');
    });
  }

  function applyCanvas(canvas, source, name) {
    if (State.busy) return;
    var btn = canvas === el.canvas ? el.drawApply : el.textApply;
    State.busy = true;
    btn.disabled = true;
    var was = btn.textContent;
    btn.textContent = '轉換中…';
    showErr('');

    traceCanvas(canvas)
      .then(function (svg) {
        if (svg.length > CONFIG.MAX_SVG_BYTES) {
          throw new Error('這張圖的線條太細碎，轉出來的檔案過大。試著畫粗一點。');
        }
        setPicked({
          source: source,
          design_id: null,
          name: name,
          // 直接用 data URI 疊上去,不必先上傳就能看到效果
          imageUrl: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg),
          svgUrl: '',
          svgString: svg
        });
      })
      .catch(function (e) { showErr(e.message); })
      .finally(function () {
        State.busy = false;
        btn.textContent = was;
        if (canvas === el.canvas) redraw(); else renderText();
      });
  }

  /* =============================================================
     上傳自己的圖
     -------------------------------------------------------------
     用刻圖市集現成的模組(js/upload-design.js)。那一支自己注入
     modal、自己做裁切與向量化,完成時發 lohas:design-upload-success。
     ============================================================= */

  function openUpload() {
    var token = Auth && Auth.getToken ? Auth.getToken() : '';
    if (!token) {
      if (Auth && Auth.setRedirect) Auth.setRedirect('case.html');
      window.location.href = 'login.html';
      return;
    }
    if (Auth.isErpBound && !Auth.isErpBound()) {
      showErr('上傳刻圖需要門市會員身分。' +
              (Auth.erpRequiredNote ? Auth.erpRequiredNote() : '') +
              '在那之前可以用「自己畫」或「打字」，一樣做得出眼鏡盒。');
      return;
    }
    if (!(window.LohasUploadDesign && window.LohasUploadDesign.openModal)) {
      showErr('上傳功能還沒載入好，請重新整理頁面再試一次。');
      return;
    }
    showErr('');
    clearPick();
    /* 關掉「刻在不同載體上的樣子」—— 這一頁本身就是眼鏡盒的即時預覽,
       再給一次六種載體的示意,會讓人以為自己還在挑要刻在什麼上面。 */
    window.LohasUploadDesign.openModal({ hideCarriers: true, noReview: true });
  }

  /* 上傳成功 → 直接套到盒子上。那張圖還在審核中(其他人看不到),
     但【這個人現在就能用】—— 叫他等審核通過再回來,他多半不會回來。 */
  function onUploaded(e) {
    var d = e && e.detail;
    if (!d) return;
    if (!d.__noReview && !d.id) return;

    if (!d.image_url_svg) {
      showErr('圖傳上去了，但沒有產生線稿檔，不能拿來雕刻。' +
              '試著換一張線條清楚一點的圖。');
      return;
    }
    showErr('');
    setPicked({
      /* 不送審的圖沒有寫進刻圖市集,所以不是 market ——
         標成 market 卻沒有 design_id,後台會出現一筆
         「來自市集但查不到是哪一張」的紀錄。 */
      source: d.__noReview ? 'draw' : 'market',
      design_id: d.__noReview ? null : d.id,
      name: d.name || '我的圖',
      imageUrl: d.image_url_png || d.image_url || d.image_url_svg || '',
      svgUrl: d.image_url_svg,
      svgString: ''
    });
    renderDesigns();
  }

  /* =============================================================
     取貨門市
     -------------------------------------------------------------
     ⚠ 必填之後,門市 API 掛掉不可以等於整頁停擺。先用本機快取的
       清單,真的沒有才停在「請重試」—— 被卡住的只剩「第一次來、
       而且當下剛好載不出來」的人。(做法與 cloth.js 一致。)
     ============================================================= */

  var STORE_CACHE_KEY = 'lohas_case_storelist';
  var STORE_CACHE_TTL = 14 * 24 * 3600 * 1000;   // 兩週

  function cacheStores(list) {
    try {
      window.localStorage.setItem(STORE_CACHE_KEY,
        JSON.stringify({ at: Date.now(), list: list }));
    } catch (_e) { /* 無痕或空間滿了,不影響這一次 */ }
  }

  function cachedStores() {
    try {
      var raw = window.localStorage.getItem(STORE_CACHE_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.list || Date.now() - o.at > STORE_CACHE_TTL) return null;
      return o.list;
    } catch (_e) { return null; }
  }

  var Stores = [];

  function renderStores(list, fromCache) {
    if (!el.store || !list || !list.length) return;
    Stores = list;
    el.store.innerHTML = '<option value="">請選擇門市</option>' +
      list.map(function (s) {
        return '<option value="' + esc(s.erpid) + '">' + esc(s.name) + '</option>';
      }).join('');
    hide(el.storeRetry);
    if (fromCache && el.storeHint) {
      el.storeHint.textContent =
        '門市清單暫時載不到，這是上次的清單。若找不到你要的那一家，請稍後重試。';
    }
  }

  /* ⚠ 門市清單是 LohasApi.store.getAllStores() ＋ LohasStore.data.normalizeStore,
     兩支都要有。先前這裡寫成 window.LohasStoreData.getStores() —— 那個物件
     【不存在】,所以每一次都直接走進 fallback,下拉永遠是「載入門市中…」。
     沒有任何錯誤訊息,因為程式自己把它當成「載不到」處理掉了。 */
  function loadStores() {
    var api = window.LohasApi && window.LohasApi.store;
    var sd  = (window.LohasStore && window.LohasStore.data) || null;
    if (!api || !sd || !el.store) { storeFallback(); return; }
    hide(el.storeRetry);
    el.store.innerHTML = '<option value="">載入門市中…</option>';

    api.getAllStores()
      .then(function (raw) {
        var list = (raw || []).map(sd.normalizeStore).filter(Boolean)
          .sort(function (a, b) {
            return a.region.order - b.region.order || a.sort - b.sort;
          });
        /* 回了一個空清單也算失敗。這通常是上游改了回應格式,
           那時「沒有門市可選」不是事實。 */
        if (!list.length) { storeFallback(); return; }
        cacheStores(list);
        renderStores(list, false);
      })
      .catch(function (e) {
        console.warn('[case] 門市清單載入失敗', e && e.message);
        storeFallback();
      });
  }

  /* 載不出來。先找快取,真的沒有才停在「請重試」。
     ⚠ 不要說「沒關係,先存起來」—— 門市是必填,那句話會讓客人以為
       自己已經送出去了,而伺服器會擋下來。兩個畫面講不同的話,
       是最難查的一種。 */
  function storeFallback() {
    if (!el.store) return;
    var cached = cachedStores();
    if (cached && cached.length) {
      console.info('[case] 門市清單改用本機快取', cached.length, '家');
      renderStores(cached, true);
      return;
    }
    Stores = [];
    el.store.innerHTML = '<option value="">暫時取不到門市清單</option>';
    if (el.storeHint) {
      el.storeHint.textContent =
        '門市清單暫時連不上。你做好的圖還在，按下面重新載入就可以繼續 ——' +
        '我們需要知道做好之後要送到哪一家。';
    }
    show(el.storeRetry);
  }

  /* 送出時把店名與區域一起帶走,不是只帶編號。
     製作端那一頁不登入,不能為了顯示店名去打門市 API ——
     那台一掛,整張製作單就變成一排「未知門市」。 */
  function pickedStore() {
    if (!el.store || !el.store.value) return null;
    var id = String(el.store.value);
    var hit = Stores.filter(function (st) { return String(st.erpid) === id; })[0];
    if (!hit) return null;
    return { erpid: id, name: hit.name || '', city: hit.city || '' };
  }

  /* =============================================================
     結帳:做圖 → 上傳 → 推進商城購物車 → 跳轉商城結帳
     -------------------------------------------------------------
     照 js/design.js(客製刻圖太陽眼鏡)那條已經跑通的路走,
     不另外發明一套 —— 那條路 8/27 端到端走通過 6 次。

     🚨 目前【只有網址帶 ?test=1 才打開】。
       新功能先上線但關著,自己跑過一遍再開(CLAUDE.md「環境的現實」)。
       沒帶參數的人看到的是「即將開放」,按鈕按不下去。

     🚨 目前【只開放刻圖市集的圖】。
       shop 函式只在「有刻圖編號」時才把圖案附進訂單
       (docs/edge-functions/shop.ts 的 if (d.design_id))。
       自己畫/打字/上傳的圖沒有刻圖編號 → 送出去的訂單【不含任何圖案】,
       商城也不會回通知 —— 客人付了錢,我方永遠不知道。
       在 shop 函式改好之前,那三條路一律擋在這裡。
     ============================================================= */

  var CHECKOUT = {
    /* 測試商品:雷刻小物|木紋眼鏡盒。正式商品建好之後換掉這一行。
       ⚠ 預覽底圖(images/case-base.jpg)是米白絨布盒,與這個測試商品
         長得不一樣 —— 測試沒關係,正式上線前要換成同一款的照片,
         而且【換照片就要重量一次可雕刻範圍】(見 css/case.css)。 */
    NID: 2881,
    SHOP_FN: 'https://hqdmyxxrskvllkcedybl.supabase.co/functions/v1/shop',
    /* 合成圖的邊長。與底圖同為正方形。 */
    PREVIEW_SIZE: 1000
  };

  var testMode = /[?&]test=1(?:&|$)/.test(String(window.location.search || ''));
  var product = null;      // 從商城讀回來的商品(價格以商城為準)
  var submitting = false;

  function shopCall(payload) {
    return fetch(CHECKOUT.SHOP_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (String(j.code) !== '200') {
          var err = new Error(j.message || '商城暫時連不上,請稍後再試');
          err.code = String(j.code || '');
          throw err;
        }
        return j.data || {};
      });
  }

  /* 價格【以商城為準】,不在這裡寫死。
     兩邊各存一份價格,遲早會出現「官網寫 800、結帳變 900」,
     而客人看到的是我們亂標價。 */
  function loadProduct() {
    return shopCall({ action: 'product', nid: CHECKOUT.NID })
      .then(function (d) {
        product = d.product || null;
        if (!product) throw new Error('查無商品');
        var price = product.offer_price || product.price;
        if (el.price) el.price.textContent = 'NT$ ' + Number(price).toLocaleString('zh-TW');
        if (el.priceNote) {
          el.priceNote.textContent = product.can_design
            ? '刻圖市集的圖另加刻圖費(分潤給創作者),金額以商城結帳頁為準。'
            : '⚠ 這個商品在商城沒有開啟「可客製」,推不進購物車。';
        }
      })
      .catch(function (e) {
        product = null;
        if (el.priceNote) el.priceNote.textContent = '商品資訊暫時讀不到(' + e.message + ')';
      })
      .then(refreshSubmit);
  }

  /* 按鈕能不能按,以及【為什麼不能】。
     只寫「請完成必填」等於要客人自己去猜還差哪一個。 */
  function blockReason() {
    if (!testMode) return '即將開放';
    if (!product) return '商品資訊讀取中';
    if (!product.can_design) return '商品未開放客製';
    if (!State.picked) return '請先挑一張圖';
    if (!pickedStore()) return '請選擇取貨門市';
    return '';
  }

  function refreshSubmit() {
    renderPayHint();
    if (!el.submit || submitting) return;
    var why = blockReason();
    el.submit.disabled = !!why;
    el.submit.textContent = why ? why : '前 往 結 帳';
  }

  /* 結帳前的提醒:付款方式與取貨門市。
     -----------------------------------------------------------------
     商城無法針對單一商品關閉付款方式,也無法由我方指定取貨門市,
     客人到了商城還要再選一次。選錯的話:
       · 取貨付款 → 還沒付錢,我方會先暫停製作
       · 門市不同 → 盒子會送錯店
     所以在【按下去之前】講清楚,而且把他剛選的店名寫出來。

     ⚠ 刻意不用 confirm() 對話框。APP 的 WebView 若沒有實作對應的
       處理,confirm() 會直接回傳「取消」而且不顯示任何東西 ——
       客人在 APP 裡會永遠按不過去,而我們看不到任何錯誤。
       一段一直看得到的字不會有這個問題。 */
  function renderPayHint() {
    if (!el.payHint) return;
    var st = pickedStore();
    if (!testMode || !st) { el.payHint.hidden = true; return; }
    el.payHint.hidden = false;
    el.payHint.innerHTML =
      '<b>到商城結帳時請這樣選:</b>' +
      '<span>付款方式　<em>樂活門市－線上信用卡付款</em></span>' +
      '<span>取貨門市　<em>' + esc(st.name || '你剛剛選的那一家') + '</em></span>' +
      '<small>選其他付款方式或其他門市的訂單,我們會先暫停製作並與你聯繫。</small>';
  }

  /* ---------- 合成圖 ---------- */

  /* ⚠ 要設 crossOrigin,而且要在設 src 之前。
     少了它,canvas 會被「污染」,toBlob 直接丟 SecurityError ——
     畫面上看起來一切正常,按下結帳才失敗,而錯誤訊息完全看不出原因。
     data: 網址不需要(也不能設,某些瀏覽器會因此載入失敗)。 */
  function loadForCanvas(src) {
    return new Promise(function (res, rej) {
      var img = new Image();
      if (!/^data:/.test(src)) img.crossOrigin = 'anonymous';
      img.onload = function () { res(img); };
      img.onerror = function () { rej(new Error('圖載不到:' + String(src).slice(0, 60))); };
      img.src = src;
    });
  }

  /* 可雕刻範圍在底圖上的位置,與 css/case.css 的 .cs-plate 【必須是同一組數字】。
     ⚠ 兩邊不一致的話,客人在畫面上擺好的位置,合成圖上會偏掉 ——
       而師傅與商城後台看到的都是合成圖。
     改 CSS 那四個數字時,這裡要一起改。 */
  var PLATE = { left: 0.271, top: 0.378, width: 0.462, height: 0.179 };

  function buildPreviewBlob() {
    var S = CHECKOUT.PREVIEW_SIZE;
    return Promise.all([
      loadForCanvas(el.base.currentSrc || el.base.src),
      loadForCanvas(State.picked.imageUrl)
    ]).then(function (imgs) {
      var base = imgs[0], art = imgs[1];
      var cv = document.createElement('canvas');
      cv.width = S; cv.height = S;
      var ctx = cv.getContext('2d');
      ctx.drawImage(base, 0, 0, S, S);

      var pw = S * PLATE.width, ph = S * PLATE.height;
      var px = S * PLATE.left,  py = S * PLATE.top;
      var w = pw * State.scale;
      var h = w * (State.ratio || 1);
      var cx = px + pw * State.x;
      var cy = py + ph * State.y;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((State.rot || 0) * Math.PI / 180);
      /* multiply:讓圖像是刻進材質裡,不是一張貼紙浮在上面。
         只影響合成圖的觀感,不影響雕刻檔。 */
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = 0.9;
      ctx.drawImage(art, -w / 2, -h / 2, w, h);
      ctx.restore();

      return new Promise(function (res, rej) {
        cv.toBlob(function (b) { b ? res(b) : rej(new Error('合成圖產生失敗')); }, 'image/png');
      });
    });
  }

  function uploadPreview(blob) {
    var sb = window.LohasSupabase && window.LohasSupabase.getClient();
    if (!sb) return Promise.reject(new Error('上傳工具未初始化'));
    var bucket = (window.LohasSupabase.CONFIG || {}).STORAGE_BUCKET || 'gallery-uploads';
    /* 與太陽眼鏡同一個資料夾(design-previews/),只加 case- 前綴。
       另開資料夾的話要另外確認儲存桶的上傳權限,而那是看不到錯誤、
       只會上傳失敗的那種設定。 */
    var path = 'design-previews/case-' + Date.now() + '-' +
               Math.random().toString(36).slice(2, 8) + '-preview.png';
    return sb.storage.from(bucket)
      .upload(path, blob, { contentType: 'image/png', upsert: false })
      .then(function (res) {
        if (res.error) throw res.error;
        return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
      });
  }

  /* 自己畫/打字的雕刻檔只存在瀏覽器裡(SVG 字串),要先上傳成網址。
     ⚠ 商城與加工中心只收我方 Storage 的網址(shop 函式會擋),
       而且那個網址會出現在商城後台,被人點開下載去雕刻。 */
  function uploadSvg(svgString) {
    var sb = window.LohasSupabase && window.LohasSupabase.getClient();
    if (!sb) return Promise.reject(new Error('上傳工具未初始化'));
    var bucket = (window.LohasSupabase.CONFIG || {}).STORAGE_BUCKET || 'gallery-uploads';
    var path = 'design-previews/case-' + Date.now() + '-' +
               Math.random().toString(36).slice(2, 8) + '.svg';
    var blob = new Blob([svgString], { type: 'image/svg+xml' });
    return sb.storage.from(bucket)
      .upload(path, blob, { contentType: 'image/svg+xml', upsert: false })
      .then(function (res) {
        if (res.error) throw res.error;
        return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
      });
  }

  /* ---------- 送出 ---------- */

  function submit() {
    if (submitting || blockReason()) return;

    var token = (Auth && Auth.getToken) ? Auth.getToken() : '';
    if (!token) {
      if (Auth && Auth.setRedirect) Auth.setRedirect('case.html' + window.location.search);
      window.location.href = 'login.html';
      return;
    }
    /* 需要門市客編。後端對「token 有效但沒有客編」一律回 401,前端會
       顯示成「登入失效」—— 那不是真的原因,而且是在產圖上傳之後才發生。
       所以擋在最前面,講真正的原因。 */
    if (Auth.isErpBound && !Auth.isErpBound()) {
      showErr('購買客製商品需要門市會員身分。' +
              (Auth.erpRequiredNote ? Auth.erpRequiredNote() : ''));
      return;
    }

    submitting = true;
    showErr('');
    el.submit.disabled = true;
    el.submit.textContent = '產 生 預 覽 圖 …';

    var p = State.picked;
    var store = pickedStore();
    var svgUrl = p.svgUrl || '';
    buildPreviewBlob()
      .then(function (blob) {
        el.submit.textContent = '上 傳 中 …';
        return Promise.all([
          uploadPreview(blob),
          svgUrl ? svgUrl : (p.svgString ? uploadSvg(p.svgString) : '')
        ]);
      })
      .then(function (urls) {
        var previewUrl = urls[0];
        svgUrl = urls[1];
        /* 沒有雕刻檔就刻不了。擋在這裡,不要送一張付了錢卻做不出來的單。 */
        if (!svgUrl) throw new Error('這張圖沒有線稿,不能拿來雕刻。換一張試試。');
        el.submit.textContent = '送 進 購 物 車 …';
        return shopCall({
          action: 'cart_push',
          /* 不送 client_id —— 商城規格明訂會員編號必須由官網後端從
             session 取得,不可接受前端傳入。shop 函式拿 token 去換。 */
          token: token,
          /* 取貨門市。商城的 cart/push 沒有這個欄位,而它的付款通知也不會
             告訴我們客人在商城選了哪一家 —— 所以要在這裡記下來,
             付款後把盒子搬進加工中心時才知道要送去哪裡。 */
          store: store,
          main: {
            nid: CHECKOUT.NID,
            amount: 1,
            design: {
              /* 只有刻圖市集的圖才有編號(創作者分潤靠它對作品)。
                 自己畫/打字/上傳一律不帶,由 shop 函式判定為 draw。 */
              design_id: p.source === 'market' ? p.design_id : '',
              design_name: p.name,
              engraving_url: svgUrl,
              preview_url: previewUrl,
              /* 相對「盒蓋上的可雕刻範圍」,含旋轉。
                 ⚠ 需要 shop 函式 2026-09-29 以後的版本 —— 更早的版本
                   會把它改成太陽眼鏡的格式,旋轉會被丟掉。 */
              placement: {
                scale: State.scale, x: State.x, y: State.y, rot: State.rot,
                basis: 'case_plate'
              }
            }
          }
        });
      })
      .then(function (data) {
        /* cart_url 的一次性 token 只有 60 秒,而且必須【整頁導轉】——
           放進 iframe 的話兩站不同網域,第三方 cookie 限制會讓商城
           建立不了登入,客人會看到一個沒登入的購物車。 */
        if (!data || !data.cart_url) throw new Error('商城沒有回傳購物車網址');
        el.submit.textContent = '前 往 商 城 …';
        window.location.href = data.cart_url;
      })
      .catch(function (e) {
        submitting = false;
        showErr(e.code === '401'
          ? '登入狀態已失效,請重新登入後再試一次。'
          : '送不出去:' + e.message);
        refreshSubmit();
      });
  }

  /* =============================================================
     來源切換
     ============================================================= */

  /* 一次只顯示一張來源卡片。
     ⚠ 用 inline 的 display 切換(與 cloth.js 一樣),不要用 class +
       CSS 的 display:none —— 這一頁的卡片是 .cl-card,而 cloth.css
       對 .cl-card 沒有 display 規則;靠 class 切的話,哪天有人在
       cloth.css 給 .cl-card 加一條 display,兩頁會同時壞掉而且
       只有眼鏡盒看得出來。

     ⚠ 預設隱藏寫在 HTML 的 inline style,不是寫在 CSS ——
       show() 是把 inline display 清成 '',若預設藏在 CSS 裡,
       清掉之後又會退回 none,卡片永遠打不開。
       (cloth.css 的 .cl-overlay 上面就有同一段警語。) */
  function syncChrome() {
    hide(el.marketCard); hide(el.drawCard); hide(el.textCard);
    if (State.src === 'market') show(el.marketCard);
    else if (State.src === 'draw') show(el.drawCard);
    else if (State.src === 'text') show(el.textCard);

    document.querySelectorAll('[data-src]').forEach(function (b) {
      b.classList.toggle('on', b.dataset.src === State.src);
    });
  }

  function setSource(src) {
    /* 手機上開始挑圖之後把大標題收起來 —— 與眼鏡布同一個 class,
       cloth.css 的 body.cl.cl-working 規則直接生效。
       加了就不再拿掉(反覆出現比一直佔著更煩)。 */
    document.body.classList.add('cl-working');
    if (State.src === src) return;
    State.src = src;
    /* 換來源就清掉目前的圖 —— 留著的話畫面上是 A 的圖、
       右邊是 B 的工具,客人按了「放到盒子上」才發現換掉了。 */
    clearPick();
    syncChrome();
  }

  function bindSource() {
    var bar = $('csSource');
    if (bar) {
      bar.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-src]');
        if (btn) setSource(btn.dataset.src);
      });
    }
    if (el.uploadBtn) el.uploadBtn.addEventListener('click', openUpload);
    document.addEventListener('lohas:design-upload-success', onUploaded);
  }

  function bindBoxes() {
    var wrap = $('csBoxes');
    if (!wrap) return;
    wrap.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-box]');
      if (!btn) return;
      wrap.querySelectorAll('.cs-box').forEach(function (b) {
        b.classList.toggle('on', b === btn);
      });
      /* ⚠ 之後換盒款要一起換預覽底圖【與可雕刻範圍】——
         範圍是對著某一張照片量的,換照片不換範圍會整個歪掉。 */
    });
  }

  function bindMarket() {
    if (!el.designs) return;
    el.designs.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-id]');
      if (btn) pickDesign(btn.dataset.id);
    });
    if (el.more) {
      el.more.addEventListener('click', function () {
        Market.expanded = !Market.expanded; renderDesigns();
      });
    }
    if (el.search) {
      el.search.addEventListener('input', function () {
        Market.filter = el.search.value;
        /* 搜尋之後回到收合 —— 不然搜出三張卻還顯示「收合」,
           而按下去畫面沒有變化。 */
        Market.expanded = false;
        renderDesigns();
      });
    }
    loadDesigns();
  }

  /* ---------- 起動 ---------- */

  function init() {
    el = {
      stage: $('csStage'), plate: $('csPlate'), overlay: $('csOverlay'),
      stageEmpty: $('csStageEmpty'),
      scale: $('csScale'), x: $('csX'), y: $('csY'),
      scaleVal: $('csScaleVal'), xVal: $('csXVal'), yVal: $('csYVal'),
      reset: $('csReset'),
      marketCard: $('csMarketCard'), drawCard: $('csDrawCard'),
      textCard: $('csTextCard'),
      designs: $('csDesigns'), more: $('csMore'), search: $('csSearch'),
      err: $('csErr'),
      canvas: $('csCanvas'), brush: $('csBrush'), undo: $('csUndo'),
      clear: $('csClear'), drawApply: $('csDrawApply'),
      textCanvas: $('csTextCanvas'), textInput: $('csTextInput'),
      textFont: $('csTextFont'), textApply: $('csTextApply'),
      uploadBtn: $('csUpload'),
      store: $('csStore'), storeHint: $('csStoreHint'), storeRetry: $('csStoreRetry'),
      base: $('csBase'), submit: $('csSubmit'), price: $('csPrice'),
      priceNote: $('csPriceNote'), payHint: $('csPayHint')
    };
    if (!el.stage || !el.plate || !el.overlay) return;

    applyOverlay();
    bindDrag();
    bindSliders();
    bindSource();
    bindBoxes();
    bindMarket();
    bindDraw();
    bindText();

    if (el.storeRetry) el.storeRetry.addEventListener('click', loadStores);
    if (el.store) el.store.addEventListener('change', refreshSubmit);
    if (el.submit) el.submit.addEventListener('click', submit);

    /* 只有測試模式才去讀商品與價格。
       ⚠ 正式商品還沒建,現在讀到的是【測試商品】的價格 ——
         沒帶 ?test=1 的人看到 NT$800 會以為那就是眼鏡盒的定價。 */
    if (testMode) loadProduct(); else refreshSubmit();
    loadStores();

    /* 視窗改變大小時疊圖要重算 —— overlay 的寬高是 px,
       不重算的話轉到橫向之後圖會變成錯的比例。 */
    window.addEventListener('resize', function () {
      if (State.picked) applyOverlay();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window, document);
