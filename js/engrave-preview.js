/* =============================================================
   LOHAS · 刻圖模擬 (engrave-preview.html)
   -------------------------------------------------------------
   用途:讓消費者用相機或照片,預覽刻圖雷刻在「自己已戴的眼鏡」
         鏡片上的樣子。與 tryon.html(試戴新鏡框)不同,
         本頁不套鏡框,只把刻圖疊在使用者原本的鏡片上。

   入口:engrave-preview.html?design=<engraving_designs.id>

   定位:預設落在畫面右上那片鏡片。
        相機模式為鏡像(自拍視角),畫面右側 = 配戴者的右眼;
        照片模式不鏡像,故改用另一側 landmark,
        使兩種模式在畫面上的視覺位置一致。

   依賴:
     window.LohasSupabase  (getClient)
     MediaPipe FaceMesh(相機串流與偵測迴圈由本檔自行處理)
   ============================================================= */

(function (window, document) {
  'use strict';

  var CONFIG = {
    TABLE: 'engraving_designs',
    // 預設位置(以雙眼間距為單位,相對目標眼睛中心)
    DEF_SIZE: 0.18,     // 刻圖寬度
    DEF_DX: -0.10,      // 沿雙眼軸,負值 = 往外側
    DEF_DY: -0.28,      // 垂直,負值 = 往上
    DEF_OPACITY: 0.85
  };

  var State = {
    design: null,
    mode: 'camera',          // camera | photo
    stream: null,
    running: false,
    faceMesh: null,
    photoImg: null,
    lastLandmarks: null,
    engraveImg: null,
    engraveReady: false,
    // 使用者微調(在預設值上再偏移)
    size: CONFIG.DEF_SIZE,
    dx: 0,
    dy: 0,
    opacity: CONFIG.DEF_OPACITY
  };

  var el = {};

  /* ---------- 工具 ---------- */

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function setStatus(t) { if (el.status) el.status.textContent = t || ''; }

  function getSb() {
    return window.LohasSupabase && window.LohasSupabase.getClient
      ? window.LohasSupabase.getClient() : null;
  }

  /* ---------- 載入刻圖 ---------- */

  function designIdFromUrl() {
    return new URL(location.href).searchParams.get('design') || '';
  }

  async function loadDesign() {
    var id = designIdFromUrl();
    if (!id) {
      el.designName.textContent = '未指定刻圖';
      el.designBy.textContent = '請從刻圖市集選擇一張設計';
      return;
    }

    var sb = getSb();
    if (!sb) {
      el.designName.textContent = '連線失敗';
      return;
    }

    try {
      var res = await sb.from(CONFIG.TABLE)
        .select('id, name, designer_name, image_url, image_url_png, image_url_svg, status')
        .eq('id', id)
        .single();

      if (res.error || !res.data) throw new Error('查無此刻圖');
      var d = res.data;
      State.design = d;

      // 優先用透明底 PNG,較接近雷刻呈現
      var url = [d.image_url_png, d.image_url, d.image_url_svg].filter(function (u) {
        return u && typeof u === 'string' && /^https?:\/\//.test(u);
      })[0] || '';

      el.designName.textContent = d.name || '(未命名)';
      el.designBy.textContent = d.designer_name ? 'by ' + d.designer_name : '';
      if (url) el.designImg.style.backgroundImage = "url('" + url + "')";

      if (url) {
        State.engraveImg = new Image();
        State.engraveImg.onload = function () {
          State.engraveReady = true;
          redrawPhoto();
        };
        State.engraveImg.onerror = function () {
          setStatus('刻圖載入失敗');
        };
        State.engraveImg.src = url;
      }
    } catch (e) {
      el.designName.textContent = '載入失敗';
      el.designBy.textContent = e.message || '';
    }
  }

  /* ---------- 繪製 ---------- */

  /**
   * 取得目標鏡片(畫面右側那片)的定位資訊。
   * 相機模式鏡像 → 畫面右 = 配戴者右眼(landmark 33/133)
   * 照片模式不鏡像 → 畫面右 = 配戴者左眼(landmark 362/263)
   */
  function anchorFrom(lm, W, H) {
    function pt(i) { return { x: lm[i].x * W, y: lm[i].y * H }; }

    var rOuter = pt(33), rInner = pt(133);    // 配戴者右眼
    var lInner = pt(362), lOuter = pt(263);   // 配戴者左眼

    var rc = { x: (rOuter.x + rInner.x) / 2, y: (rOuter.y + rInner.y) / 2 };
    var lc = { x: (lInner.x + lOuter.x) / 2, y: (lInner.y + lOuter.y) / 2 };

    var eyeDist = Math.hypot(lc.x - rc.x, lc.y - rc.y) || 1;
    var angle = Math.atan2(lc.y - rc.y, lc.x - rc.x);

    // 相機為鏡像,畫面右側對應右眼;照片未鏡像,對應左眼
    var target = (State.mode === 'camera') ? rc : lc;
    // 「往外側」的方向:相機模式外側為 -x 軸向,照片模式為 +x 軸向
    var outward = (State.mode === 'camera') ? 1 : -1;

    return { center: target, eyeDist: eyeDist, angle: angle, outward: outward };
  }

  function drawEngrave(ctx, lm, W, H) {
    if (!State.engraveReady || !State.engraveImg) return;

    var a = anchorFrom(lm, W, H);
    var img = State.engraveImg;
    if (!img.naturalWidth) return;

    var w = State.size * a.eyeDist;
    var h = w * (img.naturalHeight / img.naturalWidth);

    // 預設偏移 + 使用者微調(單位:雙眼間距)
    var offX = (CONFIG.DEF_DX * a.outward + State.dx * 0.35) * a.eyeDist;
    var offY = (CONFIG.DEF_DY + State.dy * 0.35) * a.eyeDist;

    ctx.save();
    ctx.globalAlpha = State.opacity;
    ctx.translate(a.center.x, a.center.y);
    ctx.rotate(a.angle);                    // 跟著臉的傾斜
    ctx.drawImage(img, offX - w / 2, offY - h / 2, w, h);
    ctx.restore();
  }

  function onResults(results) {
    var src = results.image;
    var W = src.width, H = src.height;
    if (!W || !H) return;

    el.canvas.width = W;
    el.canvas.height = H;
    var ctx = el.canvas.getContext('2d');

    ctx.save();
    ctx.clearRect(0, 0, W, H);
    if (State.mode === 'camera') { ctx.translate(W, 0); ctx.scale(-1, 1); }
    ctx.drawImage(src, 0, 0, W, H);

    var lm = results.multiFaceLandmarks && results.multiFaceLandmarks[0];
    if (lm) {
      if (State.mode === 'photo') State.lastLandmarks = lm;
      drawEngrave(ctx, lm, W, H);
      setStatus(State.mode === 'camera'
        ? '偵測到臉部 — 可用右側滑桿微調位置'
        : '偵測到臉部 ✓');
    } else {
      setStatus(State.mode === 'camera'
        ? '沒偵測到臉,請正對鏡頭、光線充足'
        : '這張照片沒偵測到臉,換一張更正面、清楚的試試');
    }
    ctx.restore();
  }

  // 照片模式:改參數時用暫存 landmarks 重畫,不必重新偵測
  function redrawPhoto() {
    if (State.mode !== 'photo' || !State.photoImg || !State.lastLandmarks) return;
    var img = State.photoImg;
    var W = img.naturalWidth, H = img.naturalHeight;
    el.canvas.width = W;
    el.canvas.height = H;
    var ctx = el.canvas.getContext('2d');
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0, W, H);
    drawEngrave(ctx, State.lastLandmarks, W, H);
    ctx.restore();
  }

  /* ---------- FaceMesh ---------- */

  async function ensureFaceMesh() {
    if (State.faceMesh) return State.faceMesh;
    State.faceMesh = new FaceMesh({
      locateFile: function (f) {
        return 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/' + f;
      }
    });
    State.faceMesh.setOptions({
      maxNumFaces: 1, refineLandmarks: true,
      minDetectionConfidence: 0.5, minTrackingConfidence: 0.5
    });
    State.faceMesh.onResults(onResults);
    return State.faceMesh;
  }

  /* ---------- 相機 ---------- */

  function camErrorMsg(err) {
    var name = (err && err.name) || '';
    var msg = (err && err.message) || String(err || '');

    if (name === 'NotAllowedError' || name === 'SecurityError' ||
        /not allowed|permission|denied/i.test(msg)) {
      return '相機權限被擋住了。iPhone 請檢查:① 不要用「私密瀏覽」分頁,Safari 私密瀏覽不給相機 ' +
             '② 網址列左邊「ᴀA」→ 網站設定 → 相機 → 允許。或直接改用下方「上傳照片」。';
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError' ||
        /not found|device not found/i.test(msg)) {
      return '找不到相機。請改用「上傳照片」,或換手機開啟。';
    }
    if (name === 'NotReadableError' || name === 'AbortError') {
      return '相機正被其他 App 佔用。關掉其他用到相機的程式再試一次。';
    }
    return '啟動失敗:' + msg;
  }

  /**
   * 先取得相機串流,拿到之後才建立 FaceMesh。
   * 這樣排序的理由是「使用者感受」:權限詢問立刻跳出,而不是等畫面先卡一下;
   * 被拒絕時也不必白白初始化模型。
   * 註:不是為了保住 iOS 手勢視窗 —— ensureFaceMesh 內部沒有真正的下載
   *     (WASM 是第一次 send() 才載),舊寫法量到的延遲是 1ms,從未超時。
   */
  function startCamera() {
    if (!window.isSecureContext) {
      setStatus('相機只能在 https 網址下使用,請從 www.lohasglasses.com 開啟。');
      return;
    }
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
      setStatus('此瀏覽器不支援相機,請改用「上傳照片」。');
      return;
    }

    el.startBtn.disabled = true;
    setStatus('要求相機權限中…');

    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 720 } }
    }).then(attachStream).catch(function (err) {
      setStatus(camErrorMsg(err));
      el.startBtn.disabled = false;
    });
  }

  async function attachStream(stream) {
    State.stream = stream;
    el.video.srcObject = stream;
    el.video.muted = true;
    el.video.setAttribute('playsinline', '');
    el.video.style.display = 'block';

    try {
      await el.video.play();
    } catch (e) { /* iOS 偶爾丟 AbortError,實際仍會播放 */ }

    el.hint.classList.add('hidden');
    el.startBtn.style.display = 'none';
    el.stopBtn.style.display = 'block';

    setStatus('載入臉部偵測中…');
    try {
      await ensureFaceMesh();
    } catch (e) {
      setStatus('臉部偵測載入失敗,請重新整理再試一次。');
      return;
    }

    State.running = true;
    setStatus('相機已啟動');
    pump();
  }

  /* 自行驅動偵測迴圈,取代 MediaPipe Camera utils。
     串流已由 startCamera 取得,不需要 camera_utils 再代為呼叫一次 getUserMedia,
     順便少一支 CDN 相依。 */
  async function pump() {
    while (State.running) {
      if (State.faceMesh && el.video.readyState >= 2) {
        try { await State.faceMesh.send({ image: el.video }); } catch (e) {}
      }
      await new Promise(function (r) { requestAnimationFrame(r); });
    }
  }

  /* ---------- 照片 ---------- */

  function onPickPhoto(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    setStatus('載入臉部偵測中…');
    ensureFaceMesh().then(function () {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = async function () {
        State.photoImg = img;
        el.hint.classList.add('hidden');
        el.photoBtn.style.display = 'none';
        el.stopBtn.style.display = 'block';
        setStatus('偵測臉部中…');
        await State.faceMesh.send({ image: img });
        URL.revokeObjectURL(url);
      };
      img.onerror = function () { setStatus('照片載入失敗,換一張試試'); };
      img.src = url;
    });
  }

  /* ---------- 停止 / 切換 ---------- */

  function teardown() {
    State.running = false;
    if (State.stream) {
      State.stream.getTracks().forEach(function (t) { t.stop(); });
      State.stream = null;
    }
    var s = el.video.srcObject;
    if (s && s.getTracks) s.getTracks().forEach(function (t) { t.stop(); });
    el.video.srcObject = null;
    el.video.style.display = 'none';
    State.photoImg = null;
    State.lastLandmarks = null;
    if (el.fileInput) el.fileInput.value = '';
    var ctx = el.canvas.getContext('2d');
    ctx.clearRect(0, 0, el.canvas.width, el.canvas.height);
    el.hint.classList.remove('hidden');
    el.stopBtn.style.display = 'none';
    el.startBtn.disabled = false;
    setStatus('');
  }

  function switchMode(m) {
    if (m === State.mode) return;
    teardown();
    State.mode = m;
    el.tabCamera.classList.toggle('on', m === 'camera');
    el.tabPhoto.classList.toggle('on', m === 'photo');
    el.hintCamera.style.display = m === 'camera' ? 'block' : 'none';
    el.hintPhoto.style.display = m === 'photo' ? 'block' : 'none';
    el.startBtn.style.display = m === 'camera' ? 'block' : 'none';
    el.photoBtn.style.display = m === 'photo' ? 'block' : 'none';
  }

  /* ---------- 滑桿 ---------- */

  function bindSlider(input, valEl, onChange, fmt) {
    input.addEventListener('input', function () {
      onChange(parseFloat(input.value));
      if (valEl) valEl.textContent = fmt(parseFloat(input.value));
      redrawPhoto();
    });
    if (valEl) valEl.textContent = fmt(parseFloat(input.value));
  }

  function resetPosition() {
    State.size = CONFIG.DEF_SIZE;
    State.dx = 0;
    State.dy = 0;
    State.opacity = CONFIG.DEF_OPACITY;
    el.size.value = CONFIG.DEF_SIZE;
    el.x.value = 0;
    el.y.value = 0;
    el.opacity.value = CONFIG.DEF_OPACITY;
    el.sizeVal.textContent = Math.round(CONFIG.DEF_SIZE * 100) + '%';
    el.xVal.textContent = '0';
    el.yVal.textContent = '0';
    el.opacityVal.textContent = Math.round(CONFIG.DEF_OPACITY * 100) + '%';
    redrawPhoto();
  }

  /* ---------- 啟動 ---------- */

  function init() {
    el = {
      stage: $('epStage'), video: $('epVideo'), canvas: $('epCanvas'),
      hint: $('epHint'), hintCamera: $('epHintCamera'), hintPhoto: $('epHintPhoto'),
      status: $('epStatus'),
      tabCamera: $('epTabCamera'), tabPhoto: $('epTabPhoto'),
      startBtn: $('epStartBtn'), photoBtn: $('epPhotoBtn'),
      stopBtn: $('epStopBtn'), fileInput: $('epFileInput'),
      designImg: $('epDesignImg'), designName: $('epDesignName'), designBy: $('epDesignBy'),
      size: $('epSize'), x: $('epX'), y: $('epY'), opacity: $('epOpacity'),
      sizeVal: $('epSizeVal'), xVal: $('epXVal'), yVal: $('epYVal'), opacityVal: $('epOpacityVal'),
      reset: $('epReset')
    };
    if (!el.canvas) return;

    loadDesign();

    el.tabCamera.addEventListener('click', function () { switchMode('camera'); });
    el.tabPhoto.addEventListener('click', function () { switchMode('photo'); });
    el.startBtn.addEventListener('click', startCamera);
    el.photoBtn.addEventListener('click', function () { el.fileInput.click(); });
    el.fileInput.addEventListener('change', onPickPhoto);
    el.stopBtn.addEventListener('click', function () {
      teardown();
      el.startBtn.style.display = State.mode === 'camera' ? 'block' : 'none';
      el.photoBtn.style.display = State.mode === 'photo' ? 'block' : 'none';
    });

    bindSlider(el.size, el.sizeVal, function (v) { State.size = v; },
      function (v) { return Math.round(v * 100) + '%'; });
    bindSlider(el.x, el.xVal, function (v) { State.dx = v; },
      function (v) { return (v > 0 ? '+' : '') + Math.round(v * 100); });
    bindSlider(el.y, el.yVal, function (v) { State.dy = v; },
      function (v) { return (v > 0 ? '+' : '') + Math.round(v * 100); });
    bindSlider(el.opacity, el.opacityVal, function (v) { State.opacity = v; },
      function (v) { return Math.round(v * 100) + '%'; });

    el.reset.addEventListener('click', resetPosition);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window, document);
