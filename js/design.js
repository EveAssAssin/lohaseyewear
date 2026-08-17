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
    GIFT_FN: 'https://hqdmyxxrskvllkcedybl.supabase.co/functions/v1/gift',
    TIMEOUT_MS: 15000,
    /* 預設落點。以商品圖寬高為單位。
       y 用 0.5(垂直置中)而不是偏上:商品照一律是正面平放、鏡框大致
       置中,0.5 幾乎一定落在鏡框上;先前的 0.38 在造型款(例如翼形框)
       會落到鏡框上方的空白處 —— 客人沒調就送出的話,師傅收到的是一張
       刻在空氣中的圖。落在鏡框上再讓客人微調,比落在外面安全。 */
    DEF: { lens: 'right', scale: 0.12, x: 0.68, y: 0.5 },
    // 切到左鏡片時,水平位置以圖片中線鏡射
    LEFT_X: 0.32,
    // 刻圖先只顯示這麼多,其餘收在「展開全部」後面。
    // 目前有 300 張以上,全開會把右欄拉得又臭又長,選商品的人根本捲不到底。
    DESIGN_PREVIEW: 8
  };

  var State = {
    // 送禮模式:從刻圖市集帶著 design 進來,眼鏡要在這頁挑
    gift: false,
    frames: [],
    fulfillment: 'store',
    recipMode: 'link',

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

  function loadProduct(nid) {
    return shopCall({ action: 'product', nid: nid }).then(function (d) {
      var p = d.product;
      if (!p) throw new Error('查無這件商品,或商品已下架。');

      // 防呆:有人手動改網址,對不可文創的商品發起流程
      if (p.can_design === false) {
        throw new Error('這件商品沒有開放客製文創。請回商城挑選標示「可文創」的款式。');
      }

      State.product = p;
      State.nid = nid;
      State.specSid = null;
      State.specTitle = '';
      el.productName.textContent = p.title || '(未命名商品)';

      var price = (p.offer_price != null && p.offer_price !== '')
        ? '<b>NT$' + money(p.offer_price) + '</b> <s>NT$' + money(p.price) + '</s>'
        : '<b>NT$' + money(p.price) + '</b>';
      el.productPrice.innerHTML = price +
        /* 不寫「另計」。商城 2026-08-12 來文:刻圖費多為 0 元且已含在商品
           售價內,未另設收費品項,plus_buy 的 engraving_fee 不會加進購物車。
           但原文是「多為」0 元,不保證每件都是,所以也不能寫成「不另收費」。
           一律以結帳金額為準,兩種情況都成立。 */
        '<span class="dz-price-note">刻圖費用以商城結帳金額為準</span>';

      // 手機版疊在預覽上的標示(桌機由 CSS 隱藏)
      el.stageMeta.innerHTML =
        '<span class="dz-stage-meta-name">' + esc(p.title || '') + '</span>' +
        '<span class="dz-stage-meta-price">NT$' +
        money(p.offer_price != null && p.offer_price !== '' ? p.offer_price : p.price) +
        '</span>';

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
    // 沒有規格時,那張卡就只剩品名價格 —— 手機版靠這個 class 把它整張收掉,
    // 資訊改用預覽上的說明條呈現
    el.productCard.classList.toggle('has-specs', leaves.length > 0);
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

  /* 商品圖在舞台裡實際被畫出來的矩形。
     ---------------------------------------------------------------
     舞台是固定比例(桌機 1:1、手機 4:3),商品圖是 object-fit:contain,
     所以圖片通常不會填滿舞台,四周會有留白。

     疊層必須以【這個矩形】為基準,不能以舞台為基準 —— 否則同一組座標
     在不同裝置上會落在鏡框的不同位置。實測 1080x1080 的商品圖在 4:3 的
     舞台裡左右各留白 61px,x=0.2 在手機上是圖片的 10%、在桌機上是 20%,
     整整差一倍。客人在手機拉好的位置,師傅照桌機的合成圖去刻就是錯的。

     改成圖片基準之後,State.x / y / scale 才真的是「商品圖的比例」,
     payload 裡的 basis:'product_image' 也才名副其實。 */
  function imageRect() {
    var s = el.stage.getBoundingClientRect();
    var nw = el.productImg.naturalWidth  || 0;
    var nh = el.productImg.naturalHeight || 0;
    // 圖還沒載完就先用舞台代替,載完的 onload 會再算一次
    if (!nw || !nh || !s.width || !s.height) {
      return { x: 0, y: 0, w: s.width, h: s.height };
    }
    var k = Math.min(s.width / nw, s.height / nh);
    var w = nw * k, h = nh * k;
    return { x: (s.width - w) / 2, y: (s.height - h) / 2, w: w, h: h };
  }

  function applyPlacement() {
    if (!State.design) return;
    // 以商品圖的實際渲染矩形換算成像素定位(理由見 imageRect 的註解)
    var r = imageRect();
    el.overlay.style.width = (State.scale * r.w) + 'px';
    el.overlay.style.left  = (r.x + State.x * r.w) + 'px';
    el.overlay.style.top   = (r.y + State.y * r.h) + 'px';

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

  /* ---------- 產出兩張圖 ----------
     為什麼是兩張,不是一張:

     · preview  給消費者看。購物車與訂單縮圖,可裁可縮,好看即可。
     · guide    給雕刻師傅看。滿版不裁、標明位置與哪一片鏡片。

     師傅的實際作業方式是「參考圖片的位置與大小,依經驗決定」(商城端回覆),
     所以位置資訊的載體是圖,不是數值 —— 而縮圖與雕刻參考的需求正好相反
     (縮圖會被壓縮裁切,雕刻參考不能裁)。同一張兼任兩者一定有一邊被犧牲,
     而且不會有人發現,因為圖「看起來有出現」。 */

  var IMG_PROXY = 'https://hqdmyxxrskvllkcedybl.supabase.co/functions/v1/img-proxy';

  /* 商城 CDN(CloudFront)不回 CORS 標頭,直接畫進 canvas 會被汙染,
     toBlob() 會拋錯。走自家的 img-proxy 轉一手。
     只有【合成時】才繞這一圈 —— 畫面上顯示的商品圖仍然直連,
     這樣 proxy 掛掉時只有合成失敗,不會整頁沒圖。 */
  function proxied(url) {
    return url ? IMG_PROXY + '?url=' + encodeURIComponent(url) : '';
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('圖片載入失敗:' + src)); };
      img.src = src;
    });
  }

  function canvasToBlob(canvas) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) {
        b ? resolve(b) : reject(new Error('圖片輸出失敗'));
      }, 'image/png');
    });
  }

  /* 把刻圖畫到商品照上,輸出原始解析度的 canvas。
     幾何換算必須和畫面上的 CSS 完全一致,否則師傅拿到的位置是錯的:
       .dz-overlay { width: scale × 圖寬; transform: translate(-50%,-50%) }
     也就是 left/top 記的是【中心點】,寬度以商品圖寬度為單位。 */
  function drawComposite(product, design) {
    var W = product.naturalWidth, H = product.naturalHeight;
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');

    ctx.drawImage(product, 0, 0, W, H);

    var dw = State.scale * W;
    var dh = dw * (design.naturalHeight / design.naturalWidth);
    var dx = State.x * W - dw / 2;
    var dy = State.y * H - dh / 2;

    // 對應 CSS 的 mix-blend-mode:multiply —— 雷刻是黑線,
    // 用相乘才像刻在鏡片上,而不是貼一張圖上去。
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(design, dx, dy, dw, dh);
    ctx.globalCompositeOperation = 'source-over';

    return { canvas: canvas, W: W, H: H, dx: dx, dy: dy, dw: dw, dh: dh };
  }

  /* 加工圖:合成圖 + 下方一條說明帶。
     不把字疊在商品照上 —— 照片是淺色底,字會讀不清楚,
     而這張圖的用途就是要讓人讀得清楚。 */
  function drawGuide(base) {
    var W = base.W, H = base.H;
    /* 說明帶高度。算法不是隨手抓的:標題落在 0.30×band,底下三行小字
       各佔 1.9×字級,而字級是 0.026×W —— 三行加起來約 6.3 個字級。
       band 太矮的話最後一行(現場判斷那句)會被切掉,而那句正是免責說明。 */
    var band = Math.max(280, Math.round(H * 0.28));
    var pad  = Math.round(W * 0.04);

    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H + band;
    var ctx = canvas.getContext('2d');

    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H + band);
    ctx.drawImage(base.canvas, 0, 0);

    // 刻圖範圍框。用洋紅色是因為商品照裡幾乎不會有這個顏色,
    // 一眼就分得出「哪些是刻圖、哪些是鏡框本來就有的紋路」。
    ctx.strokeStyle = '#E5007F';
    ctx.lineWidth = Math.max(2, Math.round(W * 0.003));
    ctx.setLineDash([ctx.lineWidth * 4, ctx.lineWidth * 3]);
    ctx.strokeRect(base.dx, base.dy, base.dw, base.dh);
    ctx.setLineDash([]);

    // 分隔線
    ctx.strokeStyle = '#DDD';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, H + 1); ctx.lineTo(W, H + 1); ctx.stroke();

    /* 左右是這件事最容易錯、錯了就報廢的地方,所以兩種說法都寫出來。

       ⚠ 判斷依據是【刻圖實際落在圖片的哪一側】,不是 State.lens。
       介面上那兩顆按鈕只寫「左鏡片 / 右鏡片」,沒有講明以配戴者還是
       以看圖者為準 —— 而現行實作是把「右鏡片」放在圖片右側(預設 x=0.68),
       等於採看圖者視角。照眼鏡業慣例(配戴者視角)去解讀那個標籤就會標反,
       而師傅照著標反的圖刻下去,那副眼鏡就報廢了。

       畫出來的位置不會騙人,所以從 x 反推。 */
    var onRight = State.x >= 0.5;
    var onPhoto = onRight ? '本圖右側鏡片' : '本圖左側鏡片';
    var wearer  = onRight ? '配戴者左眼側' : '配戴者右眼側';

    var y = H + Math.round(band * 0.30);
    var big = Math.round(W * 0.042);

    /* 先寫「本圖哪一側」再寫「配戴者哪一眼」:
       師傅手上有的是這張圖,能當場核對的也是這張圖。
       配戴者視角放後面當補充,順序反過來會讓人先記住錯的那個。 */
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#E5007F';
    ctx.font = '700 ' + big + 'px "Noto Sans TC", sans-serif';
    var head = '刻於 ' + onPhoto;
    // 寬度要在【還是大字】的時候量,換了字體再量會偏
    var headW = ctx.measureText(head).width;
    ctx.fillText(head, pad, y);

    ctx.fillStyle = '#111';
    ctx.font = '400 ' + Math.round(big * 0.72) + 'px "Noto Sans TC", sans-serif';
    ctx.fillText('(' + wearer + ')', pad + headW + big * 0.5, y);

    var small = Math.round(W * 0.026);
    ctx.fillStyle = '#555';
    ctx.font = '400 ' + small + 'px "Noto Sans TC", sans-serif';

    var lines = [
      '刻圖:' + (State.design.name || '(未命名)') +
        '　寬度約為商品圖寬的 ' + Math.round(State.scale * 100) + '%',
      '設計編號 ' + State.design.id + '　商品 nid ' + State.product.nid +
        '　產生於 ' + new Date().toLocaleString('zh-TW', { hour12: false }),
      '虛線框為客人指定的位置與大小,供參考;實際雷刻由現場判斷。'
    ];
    lines.forEach(function (t, i) {
      ctx.fillText(t, pad, y + Math.round(small * 1.9) * (i + 1) + small * 0.6);
    });

    return canvas;
  }

  function uploadPng(blob, name) {
    var sb = window.LohasSupabase && window.LohasSupabase.getClient();
    if (!sb) return Promise.reject(new Error('Supabase 未初始化'));
    var bucket = (window.LohasSupabase.CONFIG || {}).STORAGE_BUCKET || 'gallery-uploads';
    var path = 'design-previews/' + name;
    return sb.storage.from(bucket)
      .upload(path, blob, { contentType: 'image/png', upsert: true })
      .then(function (res) {
        if (res.error) throw res.error;
        return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
      });
  }

  /* 產出並上傳兩張圖,回傳 { preview_url, guide_url }。 */
  function buildImages() {
    var stamp = State.design.id + '-' + Date.now();
    // 字型沒載完就畫,加工圖的中文會變成系統預設字體(甚至豆腐字)
    return Promise.all([
      loadImage(proxied(State.product.image)),
      loadImage(designUrl(State.design)),
      (document.fonts && document.fonts.ready) || Promise.resolve()
    ]).then(function (r) {
      var base = drawComposite(r[0], r[1]);
      return Promise.all([canvasToBlob(base.canvas), canvasToBlob(drawGuide(base))]);
    }).then(function (blobs) {
      return Promise.all([
        uploadPng(blobs[0], stamp + '-preview.png'),
        uploadPng(blobs[1], stamp + '-guide.png')
      ]);
    }).then(function (urls) {
      return { preview_url: urls[0], guide_url: urls[1] };
    });
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
      // 換算成「商品圖」的比例,不是舞台的 —— 與 applyPlacement 同一個基準,
      // 兩邊用不同基準的話,拖曳的手感會和實際存下來的數值對不上。
      var s = el.stage.getBoundingClientRect();
      var r = imageRect();
      if (!r.w || !r.h) return;
      State.x = Math.min(1, Math.max(0, (e.clientX - s.left - r.x) / r.w));
      State.y = Math.min(1, Math.max(0, (e.clientY - s.top  - r.y) / r.h));
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

  /* ---------- 送禮模式:選眼鏡 ----------
     只列 can_design 為 true 的商品。目前是 7 件造型太陽眼鏡,
     所以不做分類導覽 —— 直接列完比讓人點兩層分類快。 */
  function loadFrames() {
    return shopCall({ action: 'products', can_design_only: 1, limit: 100 })
      .then(function (d) {
        // 缺貨的不給送,免得付了款出不了貨
        State.frames = (d.products || []).filter(function (p) { return Number(p.stock) !== 0; });
        renderFrames();
      })
      .catch(function (err) {
        el.frames.innerHTML = '<p class="dz-empty">' + esc(err.message) + '</p>';
      });
  }

  function renderFrames() {
    if (!State.frames.length) {
      el.frames.innerHTML = '<p class="dz-empty">目前沒有可客製的眼鏡</p>';
      return;
    }
    el.frames.innerHTML = State.frames.map(function (p) {
      var on = State.product && State.product.nid === p.nid ? ' on' : '';
      var price = (p.offer_price != null && p.offer_price !== '') ? p.offer_price : p.price;
      return '<button class="dz-frame' + on + '" type="button" data-nid="' + p.nid + '">' +
        (p.image ? '<img src="' + esc(p.image) + '" alt="" loading="lazy">'
                 : '<span class="dz-frame-noimg"><i class="fa-regular fa-image"></i></span>') +
        '<span class="dz-frame-name">' + esc(p.title || '') + '</span>' +
        '<span class="dz-frame-price">NT$' + money(price) + '</span>' +
        '</button>';
    }).join('');
  }

  function pickFrame(nid) {
    el.frames.querySelectorAll('.dz-frame').forEach(function (b) {
      b.classList.toggle('on', String(b.dataset.nid) === String(nid));
    });
    loadProduct(Number(nid))
      .then(function () { refreshSubmit(); refreshScrollBtn(); })
      .catch(function (err) { showFormErr(err.message); });
  }

  /* ---------- 送禮模式:設定 ---------- */

  var FULFILL_NOTE = {
    store: '付款後對方會收到一張兌換券,帶去樂活門市現場配鏡雷刻。不需要地址,顏色尺寸也能到店再確認。',
    ship:  '你在商城結帳時填收件地址(可以填對方家),商品直接寄出。刻圖位置以這裡設定的為準。'
  };

  function setFulfillment(f) {
    State.fulfillment = f;
    el.fulfill.querySelectorAll('.dz-seg-btn').forEach(function (b) {
      b.classList.toggle('on', b.dataset.f === f);
    });
    el.fulfillNote.textContent = FULFILL_NOTE[f];
  }

  function setRecipMode(m) {
    State.recipMode = m;
    el.recipMode.querySelectorAll('.dz-seg-btn').forEach(function (b) {
      b.classList.toggle('on', b.dataset.m === m);
    });
    if (m === 'member') show(el.recipKeyRow); else hide(el.recipKeyRow);
  }

  /* 這一欄只認號碼(會員編號或手機)。填名字系統比對不到人,
     禮物會退回連結領取 —— 不擋,但要當場講,不然使用者以為送到對方帳號了。 */
  function checkRecipKey() {
    var v = (el.recipKey.value || '').trim();
    var looksLikeName = v && /[^\d\s\-+()]/.test(v);
    el.recipKeyWarn.style.display = looksLikeName ? '' : 'none';
  }

  function showFormErr(msg) {
    el.formErr.textContent = msg;
    show(el.formErr);
    el.formErr.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function giftCall(payload) {
    var ctrl = new AbortController();
    var to = setTimeout(function () { ctrl.abort(); }, CONFIG.TIMEOUT_MS);
    return fetch(CONFIG.GIFT_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    })
      .then(function (r) { clearTimeout(to); return r.json(); })
      .then(function (j) {
        if (String(j.code) !== '200' || !j.data) throw new Error(j.message || '建立失敗');
        return j.data;
      })
      .catch(function (err) {
        clearTimeout(to);
        if (err.name === 'AbortError') throw new Error('連線逾時,請稍後再試');
        if (err instanceof TypeError) throw new Error('目前無法連線到禮物服務,請稍後再試。');
        throw err;
      });
  }

  function createGift() {
    var token = Auth && Auth.getToken ? Auth.getToken() : '';
    if (!token) {
      if (Auth && Auth.setRedirect) {
        Auth.setRedirect(location.pathname.split('/').pop() + location.search);
      }
      window.location.href = 'login.html';
      return;
    }

    var key = (el.recipKey.value || '').trim();
    if (State.recipMode === 'member' && !key) {
      showFormErr('請填寫對方的會員編號或手機,或改用「產生領取連結」。');
      return;
    }

    hide(el.formErr);
    el.submit.disabled = true;
    el.submit.textContent = '產 生 預 覽 圖...';

    var m = Auth && Auth.getStoredMember ? Auth.getStoredMember() : null;

    /* 先產合成圖再建立禮物。
       ---------------------------------------------------------
       收禮人打開領取頁時,最該看到的是「刻上去的樣子」,不是型錄照。
       這裡用的是和「加入購物車」完全相同的 buildImages(),
       所以兩條路產出的圖一致,不會出現送禮看到一種、下單看到另一種。

       順帶產出的 guide_url 也一併存下 —— 門市兌換時加工人員要看它,
       而現在存的成本跟只存一張相同,等接上商城再回頭補就得重畫舊資料。 */
    buildImages().then(function (images) {
      el.submit.textContent = '建 立 禮 物...';
      return giftCall({
        action: 'create',
        token: token,
        sender_name: (m && m.name) || '',
        design_id: State.design.id,
        design_name: State.design.name,
        design_image_url: designUrl(State.design),
        preview_url: images.preview_url,
        guide_url: images.guide_url,
        product_nid: State.product.nid,
        product_sid: State.specSid,
        product_title: State.product.title,
        product_spec_title: State.specTitle,
        product_image: State.product.image,
        engrave_placement: {
          lens: State.lens, scale: State.scale, x: State.x, y: State.y,
          basis: 'product_image'
        },
        message: (el.message.value || '').trim(),
        fulfillment: State.fulfillment,
        recipient_mode: State.recipMode,
        recipient_key: key,
        recipient_label: (el.recipLabel.value || '').trim()
      });
    })
      .then(function (d) { onGiftCreated(d.gift); })
      .catch(function (err) {
        showFormErr(err.message);
        el.submit.disabled = false;
        el.submit.textContent = '建 立 禮 物';
      });
  }

  function onGiftCreated(g) {
    [el.frameCard, el.designCard, el.placeCard, el.giftCard,
     el.submit, el.submitHint, el.note].forEach(hide);
    hide(el.formErr);

    // cart/push 還沒開通,禮物會停在「待付款」。這件事一定要講白,
    // 不然使用者會以為已經送出去了。
    el.resultText.textContent = State.fulfillment === 'store'
      ? '禮物已建立,目前狀態是「待付款」。商城付款介面尚未開通,接上後你會在禮物中心看到付款入口;完成付款後對方才能領取。'
      : '禮物已建立,目前狀態是「待付款」。商城付款介面尚未開通,接上後你會在禮物中心看到付款入口。';

    if (g && g.claim_url) {
      el.claimUrl.value = g.claim_url;
      show(el.linkRow);
    }
    show(el.result);
    el.result.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ---------- 滑到底浮鈕 ----------
     刻圖展開後右欄會很長,「加入購物車」在最底部。
     行為比照刻圖市集:捲一段後浮出,到底後翻轉成「回到頂部」。 */
  var refreshScrollBtn = function () {};

  function bindScrollBtn() {
    var btn = el.scroll;
    var target = el.submit;
    if (!btn || !target) return;

    var label = btn.querySelector('.dz-scroll-label');

    function onScroll() {
      // 商品還沒載入時 #dzBody 是 display:none,rect 全為 0,
      // 這時算出來的 atBottom 是假的(會一載入就顯示「回到頂部」)。
      // 等版面真的存在再算。
      if (!target.offsetParent) return;

      btn.classList.toggle('show', window.scrollY > 240);
      var atBottom = target.getBoundingClientRect().top < window.innerHeight * 0.9;
      btn.classList.toggle('at-bottom', atBottom);
      if (label) label.textContent = atBottom ? '回到頂部' : '加入購物車';

      releaseSticky();
    }

    /* 手機版預覽是 sticky,會一路釘到 .dz-wrap 底部 ——
       也就是會蓋住最後的「加入購物車」。
       過了「刻在哪裡」之後已經沒有東西需要對照預覽,就讓它跟著捲走。 */
    function releaseSticky() {
      if (!el.left || !el.note) return;
      if (window.innerWidth > 900) {          // 桌機兩欄並排,不會互相遮蔽
        el.left.classList.remove('is-unstuck');
        return;
      }
      var pinnedBottom = 70 + el.stage.offsetHeight;   // 70 = 固定 header 高度
      el.left.classList.toggle('is-unstuck',
        el.note.getBoundingClientRect().top < pinnedBottom);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    // 展開刻圖、選規格都會改變頁面高度,連帶影響按鈕狀態
    window.addEventListener('resize', onScroll, { passive: true });
    refreshScrollBtn = onScroll;
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

    if (State.gift) {
      var ready = !!State.design && !!State.product && !needSpec;
      el.submit.disabled = !ready;
      el.submitHint.textContent = !State.product ? '請先選一副眼鏡'
        : !State.design ? '請選一張刻圖'
        : needSpec ? '請選擇規格'
        : '建立後會出現在你的禮物中心';
      return;
    }

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
  function buildPayload(images) {
    return {
      main: {
        nid: State.product.nid,
        sid: State.specSid,
        amount: 1,
        design: {
          design_id: State.design.id,
          design_name: State.design.name,
          // 純刻圖的向量檔,實際要進雕刻軟體的就是它
          engraving_url: State.design.image_url_svg || null,
          // 合成圖:給消費者看(購物車與訂單縮圖)
          preview_url: images.preview_url,
          // 加工圖:給師傅看位置。⚠ 商城端尚未新增此欄位,已於文件中提出
          guide_url: images.guide_url,
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
    if (State.gift) { createGift(); return; }

    // 產圖 + 上傳要幾秒,期間必須擋住重複點擊 ——
    // 點兩下就會上傳兩組檔案,而且第二組會覆蓋第一組的 URL。
    var label = el.submit.textContent;
    el.submit.disabled = true;
    el.submit.textContent = '產 生 預 覽 圖...';

    buildImages().then(function (images) {
      var payload = buildPayload(images);
      /* 送出前先留一份。cart/push 失敗、或客人在商城那邊中途關掉時,
         至少還知道他做了什麼設定,不必從頭來過。 */
      try { sessionStorage.setItem('lohasDesignDraft', JSON.stringify(payload)); } catch (e) {}

      el.submit.textContent = '送 進 購 物 車...';
      return shopCall({
        action: 'cart_push',
        /* 不送 client_id。商城規格明訂會員編號必須由官網後端從 session 取得,
           不可接受前端傳入 —— 否則任何人都能把商品推進別人的購物車。
           shop 函式會拿這個 token 去 auth-session 換回編號,前端送什麼都不看。 */
        token: (window.LohasAuth && window.LohasAuth.getToken()) || '',
        main: payload.main
      });
    }).then(function (data) {
      /* cart_url 的一次性 token 只有 60 秒,而且必須【整頁導轉】——
         放進 iframe 的話,兩站不同註冊網域,瀏覽器的第三方 cookie 限制
         會讓商城那邊建立不了登入,客人會看到一個沒登入的購物車。 */
      if (!data || !data.cart_url) throw new Error('商城未回傳購物車網址');
      window.location.href = data.cart_url;
    }).catch(function (e) {
      console.error('[design] 送進購物車失敗', e);
      el.formErr.textContent = (e && e.message) || '送出失敗,請重試一次。';
      show(el.formErr);
      el.submit.disabled = false;
      el.submit.textContent = label;
    });
  }

  /* ---------- 啟動 ---------- */

  function init() {
    el = {
      loading: $('dzLoading'), error: $('dzError'), errorText: $('dzErrorText'),
      body: $('dzBody'),
      stage: $('dzStage'), productImg: $('dzProductImg'), overlay: $('dzOverlay'),
      stageMeta: $('dzStageMeta'),
      left: document.querySelector('.dz-left'), note: document.querySelector('.dz-note'),
      productCard: document.querySelector('.dz-card--product'),
      productName: $('dzProductName'), productPrice: $('dzProductPrice'), specs: $('dzSpecs'),
      designSearch: $('dzDesignSearch'), designGrid: $('dzDesignGrid'), more: $('dzMore'),
      scroll: $('dzScroll'),
      placeCard: $('dzPlaceCard'), lens: $('dzLens'),
      scale: $('dzScale'), x: $('dzX'), y: $('dzY'),
      scaleVal: $('dzScaleVal'), xVal: $('dzXVal'), yVal: $('dzYVal'),
      reset: $('dzReset'), submit: $('dzSubmit'), submitHint: $('dzSubmitHint'),
      designCard: document.querySelector('.dz-card--design'),
      // 送禮模式專用
      frameCard: $('dzFrameCard'), frames: $('dzFrames'),
      giftCard: $('dzGiftCard'), fulfill: $('dzFulfill'), fulfillNote: $('dzFulfillNote'),
      recipMode: $('dzRecipMode'), recipKeyRow: $('dzRecipKeyRow'), recipKey: $('dzRecipKey'),
      recipKeyWarn: $('dzRecipKeyWarn'),
      recipLabel: $('dzRecipLabel'), message: $('dzMessage'),
      formErr: $('dzFormErr'), noteText: $('dzNoteText'),
      result: $('dzResult'), resultText: $('dzResultText'),
      linkRow: $('dzLinkRow'), claimUrl: $('dzClaimUrl'), copy: $('dzCopy')
    };
    if (!el.body) return;

    var q = new URLSearchParams(location.search);
    State.gift = q.get('gift') === '1';
    var nid = Number(q.get('nid') || 0);
    var presetDesign = (q.get('design') || '').trim();

    if (State.gift) {
      startGiftMode(presetDesign);
    } else if (!nid) {
      fail('這個連結沒有指定商品。請從商城的商品頁點「客製文創」進入。');
      return;
    } else {
      loadProduct(nid)
        .then(function () {
          hide(el.loading);
          show(el.body);
          applyPlacement();
          refreshScrollBtn();     // 版面出現了,重算浮鈕狀態
          return loadDesigns();
        })
        .then(function () { refreshScrollBtn(); })
        .catch(function (err) { fail(err.message); });
    }

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
      refreshScrollBtn();   // 展開後頁面變長,按鈕該重算
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

    // 送禮模式的事件
    el.frames.addEventListener('click', function (e) {
      var b = e.target.closest('.dz-frame');
      if (b) pickFrame(b.dataset.nid);
    });
    el.fulfill.addEventListener('click', function (e) {
      var b = e.target.closest('.dz-seg-btn');
      if (b) setFulfillment(b.dataset.f);
    });
    el.recipMode.addEventListener('click', function (e) {
      var b = e.target.closest('.dz-seg-btn');
      if (b) setRecipMode(b.dataset.m);
    });
    el.recipKey.addEventListener('input', checkRecipKey);
    el.copy.addEventListener('click', function () {
      var url = el.claimUrl.value;
      var done = function () {
        el.copy.textContent = '已複製';
        setTimeout(function () { el.copy.textContent = '複製'; }, 1800);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, function () { el.claimUrl.select(); });
      } else {
        el.claimUrl.select();
      }
    });

    bindDrag();
    bindScrollBtn();

    /* 疊層是以商品圖的渲染矩形定位的(見 imageRect),而那個矩形會在兩個
       時機改變:圖片載完(才知道原始尺寸)、視窗尺寸變動(舞台大小或
       比例跟著變,桌機 1:1 / 手機 4:3)。兩個時機都要重算,
       否則刻圖會停在舊的位置上。 */
    el.productImg.addEventListener('load', applyPlacement);
    window.addEventListener('resize', applyPlacement, { passive: true });
  }

  /* 送禮模式:刻圖已由市集帶進來,眼鏡要在這頁挑 */
  function startGiftMode(presetDesign) {
    document.querySelector('.dz-title').textContent = '把這張刻圖送給朋友';
    document.querySelector('.dz-sub').textContent =
      '選一副眼鏡、決定刻圖位置,填好要送給誰就完成。';
    el.submit.textContent = '建 立 禮 物';
    el.noteText.textContent =
      '此為示意畫面。實際雷刻位置會在門市與收禮人再次確認,金額以商城結帳為準。';

    hide(el.loading);
    show(el.body);
    show(el.frameCard);
    show(el.giftCard);
    setFulfillment('store');
    setRecipMode('link');
    applyPlacement();

    Promise.all([loadFrames(), loadDesigns()]).then(function () {
      if (presetDesign) pickDesign(presetDesign);
      refreshSubmit();
      refreshScrollBtn();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window, document);
