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
    /* ⚠ 這一頁專用的底圖,不是 images/carrier-cloth.jpg。
       那一張還被 upload-design.js 的「刻在不同載體上的樣子」與
       birthday-wall.js 用著,而前者把位置寫死成 x:72 y:60 ——
       那組數字是照舊照片調的,共用一個檔名就會連帶把它們弄歪。 */
    BASE_IMG: 'images/cloth-base.jpg?v=20260827',
    /* 預設落點:置中偏上。
       新底圖是平放的正方形,右下角有 LOHAS EYEWEAR 的燙印 ——
       落在 y=0.58 以下會壓到那個標,所以往上移。
       舊值(0.65 / 0.58)是照斜擺的實拍調的,那張照片裡布沒有填滿畫面。 */
    DEF: { scale: 0.26, x: 0.5, y: 0.45 },
    /* 縮放上下限。⚠ 與 cloth.html 那支滑桿的 min/max 是同一組數字,
       改了要一起改 —— 兩邊不一致的話,拉節點拉得到滑桿到不了的值,
       滑桿就會顯示一個它自己表達不出來的位置。 */
    MIN_SCALE: 0.06,
    MAX_SCALE: 0.60,
    DESIGN_PREVIEW: 12,        // 刻圖先顯示這麼多,其餘收在「展開全部」後面
    TRACE_SIZE: 1000,          // 手繪畫布的實際解析度
    MAX_SVG_BYTES: 400 * 1024  // 線稿超過這個大小多半是畫得太碎,擋下來
  };

  var State = {
    designs: [],
    filter: '',
    expanded: false,
    source: 'market',

    /* 年度生日禮一年一件。本年度存過就鎖住存檔。
       -----------------------------------------------------------------
       ⚠ 這只是介面。真正的關卡在 cloth 函式裡(save 會回 409),
       因為停用一顆按鈕擋不住直接打 API 的人。
       這裡做的是「不要讓他花二十分鐘做完才在送出時被拒」。

       locked 預設 false:狀態還沒回來之前不要先鎖 ——
       誤鎖的代價(客人以為自己已經做過了)比誤放大得多,
       而誤放那一邊還有伺服器端接著。 */
    locked: false,
    current: null,       // 本年度那一件(含取貨門市),鎖住時用來還原畫面
    rejected: null,      // 被師傅退件、等重做的那一件(2026-09-02 新增)

    // 目前放在布上的圖案
    picked: null,        // { source, design_id, name, imageUrl, svgString }
    scale: CONFIG.DEF.scale,
    x: CONFIG.DEF.x,
    y: CONFIG.DEF.y,
    /* 旋轉角(度,順時針)。存進 placement 一起交給製作端 ——
       只有畫面上轉、DXF 沒轉的話,客人看到的與做出來的會不一樣。 */
    rot: 0,
    // 已經量過比例的那張圖(URL)。用來判斷「圖換了沒」
    ratioFor: '',
    /* 圖案的高寬比。外框要貼著圖,不能是一個永遠的正方形 ——
       寬扁的圖會出現一個大很多的框,節點也就不在圖的角上。
       圖載入前先當 1,載好再重畫一次。 */
    ratio: 1,

    // 手繪
    // 取貨門市清單(正規化後)。載不到就是空陣列 —— 不擋儲存。
    stores: [],

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

  /* ---------- 上傳自己的圖 ----------
     用刻圖市集現成的模組(js/upload-design.js)。
     那一支自己注入 modal、自己做裁切與向量化,完成時發
     lohas:design-upload-success 事件並附上寫進資料庫的那一列。

     為什麼不另做一套:同一件事有兩套上傳介面,兩邊的裁切比例、
     potrace 參數、命名規則遲早會走鐘,而走鐘的那天沒有人會發現 ——
     只會有一批線稿品質莫名其妙比較差。

     ⚠ 上傳需要 ERP 客編(那支模組拿它當 Storage 的路徑前綴)。
     官網註冊而未綁定門市的會員用不了,要在按下去之前就講清楚。 */

  function openUpload() {
    var token = Auth && Auth.getToken ? Auth.getToken() : '';
    if (!token) {
      if (Auth && Auth.setRedirect) Auth.setRedirect('cloth.html');
      window.location.href = 'login.html';
      return;
    }
    if (Auth.isErpBound && !Auth.isErpBound()) {
      showErr('上傳刻圖需要門市會員身分。' + Auth.erpRequiredNote() +
              '在那之前可以用「自己畫」,一樣做得出眼鏡布。');
      return;
    }
    if (!(window.LohasUploadDesign && window.LohasUploadDesign.openModal)) {
      showErr('上傳功能還沒載入好,請重新整理頁面再試一次。');
      return;
    }
    hide(el.err);
    // 與換模式一致:按了上傳就當作要重來,布上先清空
    clearPick();
    /* 關掉「刻在不同載體上的樣子」——
       這一頁本身就是眼鏡布的即時預覽,再給一次六種載體的示意,
       會讓人以為自己還在挑要刻在什麼上面。 */
    window.LohasUploadDesign.openModal({
      hideCarriers: true,
      /* 不送審 —— 他只是想把自己的圖印在自己的眼鏡布上,那不是投稿。
         寫「送出審核」卻不送審,他會一直等一個不會來的通知。 */
      noReview: true
    });
  }

  /* 上傳成功 → 直接套到布上。
     那張圖還在審核中(其他人看不到),但【這個人現在就能用】——
     叫他等審核通過再回來做眼鏡布,他多半不會回來。 */
  function onUploaded(e) {
    var d = e && e.detail;
    if (!d) return;
    // 市集那條路會有 id,不送審這條沒有
    if (!d.__noReview && !d.id) return;

    if (!d.image_url_svg) {
      showErr('圖傳上去了,但沒有產生線稿檔,暫時不能用在眼鏡布上。' +
              '試著換一張線條清楚一點的圖。');
      return;
    }

    /* 切到 upload:挑圖與畫布都收起來。
       他剛傳的那張已經在布上了,再給他一整片刻圖只會讓人以為
       「是不是還要再選一張」。要換的話按底下那三顆就好。
       ⚠ 要在設定 State.picked 之前 —— setSource 會清掉目前的圖。 */
    setSource('upload');

    hide(el.err);
    State.picked = {
      /* 不送審的圖沒有寫進刻圖市集,所以不是 market ——
         它跟手繪一樣是「這個人自己的圖」,歸在 draw。
         標成 market 卻沒有 design_id,後台會出現一筆
         「來自市集但查不到是哪一張」的紀錄。 */
      source: d.__noReview ? 'draw' : 'market',
      design_id: d.__noReview ? null : d.id,
      name: d.name || '我的圖',
      imageUrl: designThumb(d),
      svgUrl: d.image_url_svg,     // 兩條路都已經有現成的 SVG 網址
      svgString: ''
    };
    renderDesigns();
    applyOverlay();
    refreshSubmit();
  }

  /* ---------- 疊圖 ---------- */

  function applyOverlay() {
    // 市集、手繪、上傳三條路最後都會走到這裡,顯示與否只判斷一次
    syncChrome();

    /* 滑桿與數字先同步,而且要在下面那個 return 之前 ——
       清空時 State 已經回預設,若跟著 return 掉,畫面上會留著
       上一張圖的「45%」,下次挑圖就從那個數字開始。 */
    el.scaleVal.textContent = Math.round(State.scale * 100) + '%';
    el.xVal.textContent = Math.round(State.x * 100);
    el.yVal.textContent = Math.round(State.y * 100);
    el.scale.value = Math.round(State.scale * 100);
    el.x.value = Math.round(State.x * 100);
    el.y.value = Math.round(State.y * 100);

    if (!State.picked) { hide(el.overlay); return; }

    /* 換了一張圖就重量一次比例。掛在這裡而不是三個選圖的地方 ——
       市集、上傳、手繪三條路最後都會經過這一支,只掛一處就不會漏。
       量到之後 measureRatio 會再叫一次 applyOverlay,那時候 URL
       已經相同,不會再進來,所以不會無限繞。 */
    if (State.picked.imageUrl !== State.ratioFor) {
      State.ratioFor = State.picked.imageUrl;
      State.ratio = 1;
      measureRatio();
    }

    var r = el.stage.getBoundingClientRect();
    var w = r.width * State.scale;

    el.overlay.style.backgroundImage = 'url("' + State.picked.imageUrl + '")';
    el.overlay.style.width = w + 'px';
    /* ⚠ 高度用真實比例,不是正方形。
       先前是 w × w + background-size:contain —— 畫面上看起來一樣
       (圖被置中留白),但【外框會比圖大一圈】,四個節點就不在
       圖案的角上了。合成圖那邊本來就是用比例算的,兩邊要一致。 */
    el.overlay.style.height = (w * State.ratio) + 'px';
    el.overlay.style.left = (State.x * 100) + '%';
    el.overlay.style.top = (State.y * 100) + '%';
    el.overlay.style.setProperty('--cl-rot', State.rot + 'deg');
    show(el.overlay);
  }

  /* 量出圖案的高寬比,量完重畫一次。
     -----------------------------------------------------------------
     量不到就維持 1(正方形)—— 外框會比圖大一點,但不會壞掉。
     這比「載不到就不顯示外框」好:客人還是能拖、能拉。 */
  function measureRatio() {
    if (!State.picked || !State.picked.imageUrl) return;
    var url = State.picked.imageUrl;
    loadImage(url)
      .then(function (img) {
        // 期間可能已經換了一張圖,對不上就不要覆蓋
        if (!State.picked || State.picked.imageUrl !== url) return;
        if (img.naturalWidth && img.naturalHeight) {
          State.ratio = img.naturalHeight / img.naturalWidth;
          applyOverlay();
        }
      })
      .catch(function () { /* 量不到就用預設值,不影響操作 */ });
  }

  /* 三種拖曳共用一個手勢迴圈:移動、縮放、旋轉。
     -----------------------------------------------------------------
     為什麼不分成三組事件:三者互斥(同時只會有一個在進行),
     而且都要處理 pointer capture 與收尾。分開寫會有三份幾乎一樣
     的程式碼,而漏掉其中一份的 pointerup 就會出現「放開了還在跟著跑」。

     ⚠ 節點的 pointerdown 會【冒泡到 stage】—— stage 那一支若不先
     讓開,拉節點會同時觸發「把圖移到手指下面」,圖案會瞬間跳走。
     所以進入點先看 e.target 是不是節點。 */
  function bindDrag() {
    var mode = null;        // null | 'move' | 'scale' | 'rot'
    var start = null;

    function centerOf() {
      var r = el.stage.getBoundingClientRect();
      return { cx: r.left + r.width * State.x, cy: r.top + r.height * State.y, r: r };
    }

    function move(e) {
      if (!mode || !State.picked) return;
      var c = centerOf();

      if (mode === 'move') {
        State.x = Math.min(1, Math.max(0, (e.clientX - c.r.left) / c.r.width));
        State.y = Math.min(1, Math.max(0, (e.clientY - c.r.top) / c.r.height));

      } else if (mode === 'scale') {
        /* 用「手指到中心的距離」與按下當時的距離比,乘回原本的大小。
           不直接拿距離換算,是因為那樣一按下去圖就會跳到手指的位置 ——
           人期待的是「從我抓住的地方開始變」。 */
        var d = Math.hypot(e.clientX - c.cx, e.clientY - c.cy);
        if (start.dist > 4) {
          var next = start.scale * (d / start.dist);
          State.scale = Math.min(CONFIG.MAX_SCALE, Math.max(CONFIG.MIN_SCALE, next));
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
      try { el.stage.releasePointerCapture(e.pointerId); } catch (err) { /* 已釋放 */ }
    }

    el.stage.addEventListener('pointerdown', function (e) {
      if (!State.picked) return;
      var node = e.target.closest ? e.target.closest('[data-node]') : null;
      var c = centerOf();

      if (node) {
        // 節點:縮放或旋轉。不要讓它同時被當成「移動」
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
        move(e);            // 移動維持原本的行為:按下就跟到手指位置
      }

      el.stage.setPointerCapture(e.pointerId);
    });

    el.stage.addEventListener('pointermove', move);
    el.stage.addEventListener('pointerup', stop);
    el.stage.addEventListener('pointercancel', stop);
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

      /* ⚠ 旋轉一定要跟畫面一致,而且是【繞圖案中心】轉。
         把原點搬到中心 → 轉 → 以中心為基準畫,
         這樣 State.rot 在畫面與這張圖是同一個意思。
         少了這一段,客人看到轉過的圖、存下來的卻是正的。 */
      ctx.save();
      ctx.translate(SIZE * State.x, SIZE * State.y);
      if (State.rot) ctx.rotate(State.rot * Math.PI / 180);
      ctx.drawImage(art, -w / 2, -h / 2, w, h);
      ctx.restore();

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

  /* ---------- 取貨門市 ---------- */

  /* 依區域分組成 optgroup。
     -----------------------------------------------------------------
     六十幾家店平鋪在一個下拉裡找不到人 —— 客人心裡想的是
     「我家附近那家」,而那是區域問題,不是店名問題。

     ⚠ 這一段整段可以失敗。門市 API 掛掉、網路斷、正規化之後
     一家都不剩,都只會讓下拉停在「暫時取不到門市清單」——
     不擋儲存。一件已經畫完的設計不該因為一支查詢掛了而作廢;
     沒選門市的會落在製作端的「其他」,人工處理一下就好。 */
  function loadStores() {
    var api = window.LohasApi && window.LohasApi.store;
    var sd  = (window.LohasStore && window.LohasStore.data) || null;
    if (!api || !sd || !el.store) { storeFallback('暫時取不到門市清單'); return; }
    if (el.storeRetry) el.storeRetry.style.display = 'none';
    el.store.innerHTML = '<option value="">載入門市中…</option>';

    api.getAllStores()
      .then(function (raw) {
        var list = (raw || []).map(sd.normalizeStore).filter(Boolean)
          .sort(function (a, b) {
            return a.region.order - b.region.order || a.sort - b.sort;
          });
        if (!list.length) { storeFallback('暫時取不到門市清單'); return; }

        State.stores = list;

        var html = '<option value="">請選擇取貨門市</option>';
        var curr = '';
        list.forEach(function (st) {
          if (st.region.label !== curr) {
            if (curr) html += '</optgroup>';
            curr = st.region.label;
            html += '<optgroup label="' + esc(curr) + '">';
          }
          html += '<option value="' + esc(st.erpid) + '">' + esc(st.name) + '</option>';
        });
        if (curr) html += '</optgroup>';
        el.store.innerHTML = html;

        /* 上次選過的記起來 —— 同一個人做第二條布,多半還是去同一家。
           清單裡沒有那家了(已停業)就當作沒存過。 */
        try {
          var last = localStorage.getItem('lohas_cloth_store');
          if (last && /^[0-9A-Za-z_-]{1,32}$/.test(last)) {
            var opt = el.store.querySelector('option[value="' + last + '"]');
            if (opt) el.store.value = last;
          }
        } catch (e) { /* 無痕模式讀 localStorage 會丟例外 */ }

        if (el.storeRetry) el.storeRetry.style.display = 'none';
        refreshSubmit();
      })
      .catch(function (e) {
        console.warn('[cloth] 門市清單載入失敗', e && e.message);
        storeFallback('暫時取不到門市清單');
      });
  }

  function storeFallback(msg) {
    if (!el.store) return;
    State.stores = [];
    el.store.innerHTML = '<option value="">' + esc(msg) + '</option>';
    if (el.storeHint) {
      el.storeHint.textContent = '沒關係,先存起來 —— 到門市時跟店員說一聲就可以領。';
    }
    /* 必填 + 清單是空的 = 客人畫完了卻永遠存不了。
       所以一定要給他一條路:重試,或直接存。 */
    if (el.storeRetry) el.storeRetry.style.display = '';
    refreshSubmit();
  }

  /* 送出時把店名與區域一起帶走,不是只帶編號。
     製作端那一頁不登入,不能為了顯示店名去打門市 API ——
     那台一掛,整張製作單就變成一排「未知門市」。 */
  function pickedStore() {
    if (!el.store || !el.store.value) return null;
    var id = String(el.store.value);
    var hit = (State.stores || []).filter(function (st) {
      return String(st.erpid) === id;
    })[0];
    if (!hit) return null;
    try { localStorage.setItem('lohas_cloth_store', id); } catch (e) { /* 無痕 */ }
    return { erpid: id, name: hit.name || '', city: hit.city || '' };
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
    if (State.locked) return;       // 已鎖定,按鈕本來就停用;這是最後一道保險

    /* 存檔要有身分,預覽不用。
       這是「免帳號試玩」的分界:玩到看見成品都不需要登入,
       要留下東西才請他登入 —— 也順便讓匿名的人上傳不了檔案。 */
    var token = Auth && Auth.getToken ? Auth.getToken() : '';
    if (!token) {
      if (Auth && Auth.setRedirect) Auth.setRedirect('cloth.html');
      window.location.href = 'login.html';
      return;
    }

    /* 🚨 存檔前先講清楚:存下去就不能再改了。
       -----------------------------------------------------------------
       年度生日禮一年一件,而製作端會照著存檔當下的樣子做出實體。
       客人如果以為「先存起來,之後再回來調」,那就是一個
       他要等到明年才能修正的誤會。

       ⚠ 這一段【必須】在上傳與存檔之前 ——
         放在後面等於圖已經送出去了才問,那不是確認,是通知。

       用原生 confirm 是刻意的:官網沒有測試站,自製對話框
       在某些瀏覽器上壞掉的話,結果會是「按了存檔沒反應」,
       而那個症狀查起來比難看的原生視窗貴得多。 */
    if (!window.confirm(
      '存檔後就不能再調整了。\n\n' +
      '年度生日禮一年一件,製作端會照你現在看到的樣子做出來。\n' +
      '確定要存檔嗎?'
    )) return;

    State.busy = true;
    el.submit.disabled = true;
    el.submit.textContent = '產 生 圖 檔...';
    hide(el.err);

    var stamp = Date.now() + '-' + randStr(6);
    var svgUrl = '';

    /* 已經有現成 SVG 網址的就沿用(市集刻圖、上傳的圖都是)——
       同一個檔案存兩次,日後更新原作時會有一份永遠是舊的。
       只有手繪是當場產生的,那才需要上傳。

       ⚠ 判斷用「有沒有 svgUrl」,不要用 source ——
       不送審的上傳圖 source 是 draw 卻有現成網址,
       用 source 判斷會拿一個空字串去上傳。 */
    var svgStep = State.picked.svgUrl
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
              scale: State.scale, x: State.x, y: State.y,
              rot: State.rot,                    // 度,順時針
              basis: 'cloth_image'
            },
            store: pickedStore()
          })
        }).then(function (r) { return r.json(); });
      })
      .then(function (j) {
        /* 409 ＝ 本年度已經存過。這不是「這次輸入有問題」,
           所以不能只丟一句錯誤就算了 —— 要把畫面切換成鎖定狀態,
           否則他會一直按,而每一次都失敗。

           會走到這裡的情況:另一個分頁剛存過、或狀態查詢當時失敗。 */
        if (String(j.code) === '409') {
          State.locked = true;
          State.current = (j.data && j.data.current) || null;
          applyLock();
          throw new Error(j.message || '本年度已經完成過一件了。');
        }
        if (String(j.code) !== '200') throw new Error(j.message || '儲存失敗');
        State.locked = true;
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
      '您已經成功送件,製作時間約 3~5 個工作天,完成後即可前往門市領取。';
    show(el.done);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- 狀態 ---------- */

  /* 兩個條件都要滿足才能存:選了圖、選了取貨門市。
     -----------------------------------------------------------------
     ⚠ 門市是必填,但「清單載不出來」不算他沒填 ——
     那種時候他【想填也填不了】,擋住等於讓一件畫完的設計死在這裡。
     所以載入失敗時放行,那一筆會落在製作端的「其他」,人工處理。

     提示文字要講【還差哪一個】。只寫「請完成必填」等於要他自己
     一格一格找,而畫面上這時候通常已經捲到很下面了。 */
  /* ---------- 本年度鎖定 ---------- */

  /* 一進頁就問「本年度存過了嗎」。
     -----------------------------------------------------------------
     ⚠ 不擋畫面 —— 不 await、不顯示轉圈。狀態沒回來之前
       他照樣可以挑圖、調位置,那些都不需要伺服器。
       擋住的話,每個人都要為了一個多數情況是「沒存過」的查詢多等一秒。

     ⚠ 查詢失敗時【不鎖】。誤鎖的代價是客人以為自己已經做過了 ——
       他不會來問,只會覺得少了一份禮物。而誤放那一邊,
       伺服器端的 409 還接得住。這個不對稱決定了要往哪邊倒。 */
  function loadLockState() {
    var token = Auth && Auth.getToken ? Auth.getToken() : '';
    if (!token) return;             // 沒登入本來就存不了,等他登入再說

    fetch(CONFIG.SAVE_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', token: token })
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (String(j.code) !== '200' || !j.data) return;
        State.locked = !!j.data.locked;
        State.current = j.data.current || null;
        State.rejected = j.data.rejected || null;
        applyLock();
        applyRejected();
      })
      .catch(function (e) {
        console.error('[cloth] 查本年度狀態失敗,維持可存檔', e);
      });
  }

  /* 鎖定時:還原他存的那一件,標明已完成與取貨門市,停用存檔。
     編輯區【不停用】—— 他可以繼續拖著玩,只是存不了。 */
  function applyLock() {
    if (!State.locked) return;

    var c = State.current;
    if (c && c.svg_url) {
      /* 還原成他當初存的樣子。
         imageUrl 用 svg_url(線稿)而不是 preview_url(合成圖)——
         合成圖裡已經有那塊布了,再疊一次會變成布中布。 */
      State.picked = {
        source: c.source === 'draw' ? 'draw' : 'market',
        design_id: c.design_id || null,
        name: c.design_name || '',
        imageUrl: c.svg_url,
        svgUrl: c.svg_url,
        svgString: ''
      };
      var p = c.placement || {};
      if (typeof p.scale === 'number') State.scale = p.scale;
      if (typeof p.x === 'number') State.x = p.x;
      if (typeof p.y === 'number') State.y = p.y;
      if (typeof p.rot === 'number') State.rot = p.rot;
      // applyOverlay() 本身就會把 State 同步回三個滑桿與數字,不必另外呼叫
      applyOverlay();
    }

    if (el.lock) {
      var where = c && c.store_name
        ? '完成後可到「' + c.store_name + '」領取。'
        : '完成後可到門市領取。';   // 門市可能是空的(舊資料、或當時清單載不出來)
      el.lockText.textContent =
        '本年度的客製眼鏡布已經完成,' + where +
        ' 一年一件,明年可以再做一件。你仍然可以在這裡試著調整,但不會存檔。';
      show(el.lock);
    }

    el.submit.disabled = true;
    el.submit.textContent = '本 年 度 已 完 成';
    if (el.submitHint) el.submitHint.textContent = '';
  }

  /* 被加工師傅退件時,告訴客人原因並請他重做。
     -----------------------------------------------------------------
     這是 2026-09-02 新增的流程:師傅發現這張圖根本做不出來(線太細會斷、
     超出可雕刻範圍…),退回並附原因。

     🚨 退件【不佔用一年一件的額度】,而且重做時【不再檢查生日月】——
       那兩條都在 cloth 那支函式裡(存檔的入口),不在這裡。
       這一頁只負責「讓他知道發生什麼事」。
       所以這裡【不能】停用存檔鈕 —— 他就是要重做。

     ⚠ 少了這一段,客人打開頁面看到的是一個完全正常、可以存檔的畫面,
       完全不知道自己上一件被退了、也不知道要改什麼,
       多半會原封不動再送一次,兩邊都白做。 */
  function applyRejected() {
    if (State.locked || !State.rejected) return;

    var r = State.rejected;

    if (el.lock && el.lockText) {
      el.lockText.textContent =
        '你上一件客製眼鏡布無法製作,已由加工師傅退回:' +
        rejectText(r) +
        ' 請重新設計後再送出一次 —— 這一次不會佔用「一年一件」的額度。';
      show(el.lock);
    }
  }

  /* 退件原因:代碼轉成客人看得懂的文字。
     -----------------------------------------------------------------
     ⚠ 這份對照【與 js/cloth-lab.js 的 REJECT_REASONS 是同一份東西】,
       正本是 cloth-admin 函式裡的 REJECT_CODES(它決定收不收)。

       三個地方各有一份是刻意的取捨,不是疏忽:把文案移到伺服器組
       需要再部署一次 cloth,而官網沒有測試環境、當天已經動過兩次。
       **新增或改動原因代碼時,三個地方都要改** ——
       漏改這裡的後果是客人看到一句籠統的話(不會壞,但等於沒講清楚)。

     代碼查不到時退回補充文字,兩個都沒有才回籠統的那一句。
     絕不回空字串:畫面上出現「已退回:」後面什麼都沒有,
     比講得含糊更讓人不知所措。 */
  function rejectText(r) {
    var MAP = {
      line_too_thin: '線條太細,雕刻後會斷掉',
      out_of_bounds: '圖案超出可雕刻範圍',
      low_quality: '圖片解析度不足,刻出來會模糊',
      content: '圖案內容不適合雕刻',
      other: ''
    };
    var label = MAP[r.reject_code] || '';
    var extra = (r.reject_reason || '').trim();
    if (label && extra) return label + '(' + extra + ')';
    if (label) return label;
    if (extra) return extra;
    return '此設計無法製作';
  }

  function refreshSubmit() {
    /* 鎖定優先於一切條件判斷 —— 少了這一行,
       他挑一張新圖就會把按鈕重新打開。 */
    if (State.locked) {
      el.submit.disabled = true;
      el.submit.textContent = '本 年 度 已 完 成';
      if (el.submitHint) el.submitHint.textContent = '';
      return;
    }

    var hasPick = !!State.picked;
    var hasStore = !el.store || !!el.store.value;
    // 清單根本沒載出來 → 不能拿它當作沒填
    var storeUnavailable = !State.stores.length;

    var ok = hasPick && (hasStore || storeUnavailable);
    el.submit.disabled = !ok;

    if (!hasPick) {
      el.submitHint.textContent = '請先選一張刻圖,或自己畫一個';
    } else if (!hasStore && !storeUnavailable) {
      el.submitHint.textContent = '還差一個:請選擇要到哪一家門市拿';
    } else if (storeUnavailable) {
      el.submitHint.textContent = '門市清單暫時載不出來,先存起來 —— 到門市時跟店員說一聲就可以領';
    } else {
      el.submitHint.textContent = '存起來之後,到門市報會員編號就能製作';
    }
  }

  /* 換來源就把布上的圖清掉,回到還沒挑圖的狀態。
     -----------------------------------------------------------
     留著上一個來源的圖會變成「畫面上是市集那張,但操作區是空畫布」——
     兩邊對不起來,而客人以為存下去的是他看到的那一張。
     位置與大小一併回預設:那組數字是為了上一張圖調的,對新的沒有意義。 */
  function clearPick() {
    if (!State.picked) return;
    State.picked = null;
    State.scale = CONFIG.DEF.scale;
    State.x = CONFIG.DEF.x;
    State.y = CONFIG.DEF.y;
    State.rot = 0;
    State.ratio = 1;
    hide(el.err);
    renderDesigns();     // 取消市集那一格的選取外框
    applyOverlay();      // 藏疊圖,連帶把眼鏡布收回去
    refreshSubmit();
  }

  function setSource(src, scroll) {
    // 只有真的換了才清 —— 又按一次同一顆不該把人的圖弄掉
    if (State.source !== src) clearPick();
    State.source = src;
    el.source.querySelectorAll('.cl-seg-btn').forEach(function (b) {
      b.classList.toggle('on', b.dataset.src === src);
    });
    /* 三種狀態。upload 是「圖已經傳好了」——
       這時挑圖與畫布都沒有用處,收起來,畫面只留預覽與位置調整。
       留著「選一張刻圖」的話,客人會以為自己還得再挑一張。 */
    var open = null;
    if (src === 'market') { show(el.marketCard); hide(el.drawCard); open = el.marketCard; }
    else if (src === 'draw') { hide(el.marketCard); show(el.drawCard); open = el.drawCard; }
    else { hide(el.marketCard); hide(el.drawCard); }
    if (scroll && open) scrollToCard(open);
  }

  /* ---------- 釘住的兩塊 ---------- */

  var MOBILE = 960;

  /* 有圖之前不顯示眼鏡布(只在手機,實際的隱藏寫在 cloth.css)。
     空的布佔掉 276px,而那時它什麼都沒告訴你 —— 還沒有東西可以看。
     來源列不受影響:它永遠釘在最上面,三個入口隨時按得到。 */
  function syncChrome() {
    var has = !!State.picked;
    if (document.body.classList.contains('cl-has-art') === has) return;
    document.body.classList.toggle('cl-has-art', has);
    syncSticky();
  }

  /* 預覽要釘在來源列【正下方】,而來源列的高度隨字級與換行變 ——
     CSS 算不出來,量完寫進變數給 .cl-left 的 top 用。 */
  function syncSticky() {
    if (!el.sourceCard) return;
    var h = window.innerWidth <= MOBILE ? 70 + el.sourceCard.offsetHeight : 0;
    document.documentElement.style.setProperty('--cl-preview-top', h + 'px');
  }

  /* 捲動時上方要讓開的高度:header ＋ 來源列 ＋(有圖的話)預覽。
     .cl-left 隱藏時 offsetHeight 是 0,不必另外判斷。 */
  function stickyBottom() {
    if (window.innerWidth > MOBILE) return 90;   // 只有 header 擋著
    return 70 + el.sourceCard.offsetHeight + el.left.offsetHeight + 12;
  }

  /* 切了來源就把那張卡捲到釘住的兩塊底下。
     已經看得完整的就不要動 —— 沒事亂捲比不捲更讓人失去方向。 */
  function scrollToCard(card) {
    if (!card) return;
    var top = stickyBottom();
    var r = card.getBoundingClientRect();
    if (r.top >= top && r.bottom <= window.innerHeight) return;
    window.scrollTo({
      top: Math.max(0, window.scrollY + r.top - top),
      behavior: 'smooth'
    });
  }

  /* ---------- 啟動 ---------- */

  function init() {
    el = {
      stage: $('clStage'), base: $('clBase'), overlay: $('clOverlay'),
      left: document.querySelector('.cl-left'),
      sourceCard: $('clSourceCard'), source: $('clSource'),
      marketCard: $('clMarketCard'), drawCard: $('clDrawCard'),
      search: $('clSearch'), designs: $('clDesigns'), more: $('clMore'),
      upload: $('clUpload'),
      canvas: $('clCanvas'), brush: $('clBrush'),
      undo: $('clUndo'), clear: $('clClear'), apply: $('clApply'),
      placeCard: $('clPlaceCard'),
      scale: $('clScale'), x: $('clX'), y: $('clY'),
      scaleVal: $('clScaleVal'), xVal: $('clXVal'), yVal: $('clYVal'),
      reset: $('clReset'), note: document.querySelector('.cl-note'),
      err: $('clErr'), submit: $('clSubmit'), submitHint: $('clSubmitHint'),
      lock: $('clLock'), lockText: $('clLockText'),
      storeCard: $('clStoreCard'), store: $('clStore'), storeHint: $('clStoreHint'),
      storeRetry: $('clStoreRetry'),
      done: $('clDone'), doneText: $('clDoneText')
    };
    if (!el.stage) return;

    redraw();
    bindDrag();
    bindDraw();

    el.source.addEventListener('click', function (e) {
      var b = e.target.closest('.cl-seg-btn');
      /* ⚠ 要看 data-src 有沒有值。「上傳我的圖」也在這一列、也是 .cl-seg-btn,
         但它是動作不是模式 —— 少了這個判斷會呼叫 setSource(undefined),
         結果是兩張卡都關掉、畫面空一塊。 */
      if (b && b.dataset.src) setSource(b.dataset.src, true);
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
    if (el.upload) el.upload.addEventListener('click', openUpload);
    window.addEventListener('lohas:design-upload-success', onUploaded);

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
      State.rot = 0;          // 「回到預設位置」當然包含轉回正的
      applyOverlay();
    });

    el.submit.addEventListener('click', submit);

    // 視窗大小變了要重算疊圖的像素尺寸(scale 是比例,像素得跟著算),
    // 釘住那兩塊的高度也跟著變(直橫向切換時差很多)
    window.addEventListener('resize', function () {
      applyOverlay();
      syncSticky();
    });
    syncSticky();
    requestAnimationFrame(syncSticky);   // 字體換好之後高度會再動一次

    if (el.store) el.store.addEventListener('change', refreshSubmit);
    if (el.storeRetry) el.storeRetry.addEventListener('click', loadStores);

    loadDesigns();
    loadStores();
    loadLockState();     // 不 await:狀態沒回來之前照樣可以挑圖、調位置
    refreshSubmit();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window, document);
