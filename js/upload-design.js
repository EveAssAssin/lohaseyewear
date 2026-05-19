/* =============================================================
   LohasUploadDesign · 創作者刻圖設計上傳模組
   -------------------------------------------------------------
   入口:
     window.LohasUploadDesign.openModal()           新增
     window.LohasUploadDesign.openModalForEdit(d)   編輯/重新上傳
     window.LohasUploadDesign.closeModal()

   依賴 (從 <script> 順序載入):
     window.LohasSupabase   (getClient, CONFIG)
     window.LohasAuth       (getStoredMember)
     window.LohasCropper    (crop)               選用,沒有就跳過裁切
     window.LohasSubcategories                   細部標籤對照
     window.Utils           (escapeHtml, etc)    選用

   寫入:
     Storage:  engraving-uploads bucket (建議手動建好)
     Table:    engraving_designs
       - status='pending'、type='member'、creator_id=會員 erpid
       - name / slogan / category / keywords / image_url / image_url_png
   ============================================================= */

(function(window){
  'use strict';

  // ===== 設定 =====
  var CONFIG = {
    STORAGE_BUCKET:   'engraving-uploads',
    TABLE:            'engraving_designs',
    MAX_SIZE_MB:      5,
    ACCEPT:           'image/png,image/jpeg,image/jpg,image/svg+xml',
    CROP_ASPECT:      1,                   // 1:1
    // 透明轉換設定
    WHITE_THRESHOLD:  220,                 // 亮度 > 此值 → alpha=0
    INK_COLOR:        '#2F2A24',           // 雷雕用深棕黑色
  };

  // ===== State =====
  var state = {
    file:           null,    // 原始 (裁切後) Blob - JPG/PNG 原檔
    previewUrl:     null,    // 預覽 URL (透明 PNG)
    transparentBlob: null,   // 轉換後的透明 PNG blob
    svgString:      null,    // 追蹤後的 SVG XML
    editId:         null,    // 若是編輯模式
    selectedCategory: '',
    selectedTags:   [],
    submitting:     false,
  };

  // ===== DOM refs (在 init 時抓) =====
  var modal, els = {};


  // ===== 入口:首次呼叫時 inject modal HTML + 綁事件 =====
  function ensureModalInjected(){
    if(modal) return modal;

    var div = document.createElement('div');
    div.id = 'designUploadModal';
    div.className = 'design-upload-modal';
    div.setAttribute('aria-hidden', 'true');
    div.innerHTML = template();
    document.body.appendChild(div);

    modal = div;
    cacheEls();
    bindEvents();
    return modal;
  }

  function template(){
    var memberName = (window.LohasAuth?.getStoredMember?.()?.erpname) || '';
    return [
      '<div class="dum-bg"></div>',
      '<div class="dum-dialog" role="dialog" aria-modal="true">',
        '<button class="dum-close" type="button" aria-label="關閉"><i class="fa-solid fa-xmark"></i></button>',

        // ===== 左欄:上傳區 =====
        '<div class="dum-left">',
          '<div class="dum-eyebrow">DESIGN · UPLOAD</div>',

          '<div class="dum-uploader" id="dumUploader" tabindex="0" role="button" aria-label="點擊或拖曳上傳設計圖">',
            '<div class="dum-uploader-empty">',
              '<div class="dum-uploader-icon"><i class="fa-solid fa-arrow-up-from-bracket"></i></div>',
              '<div class="dum-uploader-h">點擊或拖曳上傳</div>',
              '<div class="dum-uploader-p">PNG (透明底) / JPG / SVG<br>建議 1:1 比例 · 最大 ' + CONFIG.MAX_SIZE_MB + 'MB</div>',
            '</div>',
            '<div class="dum-uploader-preview" id="dumPreview" hidden>',
              '<img alt="預覽" id="dumPreviewImg">',
              '<div class="dum-preview-actions">',
                '<button type="button" class="dum-preview-btn" data-action="re-crop"><i class="fa-solid fa-crop"></i> 重新裁切</button>',
                '<button type="button" class="dum-preview-btn danger" data-action="remove"><i class="fa-solid fa-xmark"></i> 移除</button>',
              '</div>',
            '</div>',
            '<input type="file" id="dumFileInput" accept="' + CONFIG.ACCEPT + '" hidden>',
          '</div>',

          '<div class="dum-tip">',
            '<b>小提示:</b> 上傳後可裁切,通過審核後會自動轉換成雷雕用透明底版本',
          '</div>',

          // 眼鏡模擬框 (上傳後才顯示)
          '<div class="dum-mock-frame" id="dumMockFrame" hidden>',
            '<div class="dum-mock-label">刻 在 眼 鏡 上 的 樣 子</div>',
            '<div class="dum-mock-stage">',
              '<div class="dum-mock-engrave" id="dumMockEngrave">',
                '<img alt="刻圖模擬" id="dumMockImg">',
              '</div>',
            '</div>',
          '</div>',

          '<div class="dum-flow-info">',
            '<div class="dum-flow-label">審 核 流 程</div>',
            '<div class="dum-flow-desc">上傳後預設為 <b class="pending">待審核</b> 狀態,通過後自動上架創作者市集</div>',
          '</div>',
        '</div>',

        // ===== 右欄:表單 =====
        '<div class="dum-right">',
          '<div class="dum-header">',
            '<h2 class="dum-title" id="dumTitle">新增刻圖設計</h2>',
            '<p class="dum-subtitle">填寫作品資訊,審核通過後將出現在創作者市集' + (memberName ? ' · <span class="dum-by">by ' + escAttr(memberName) + '</span>' : '') + '</p>',
          '</div>',

          // 錯誤訊息 (放最上面,顯眼)
          '<div class="dum-error" id="dumError" hidden>',
            '<i class="fa-solid fa-circle-exclamation"></i>',
            '<span class="dum-error-text"></span>',
          '</div>',

          '<div class="dum-form" id="dumForm">',

            // 設計名稱
            '<div class="dum-field">',
              '<label for="dumName">設計名稱 <span class="req">*</span></label>',
              '<input type="text" id="dumName" maxlength="20" placeholder="例如:愛笑貓咪、JT、雙魚座" autocomplete="off">',
              '<div class="dum-field-hint">建議 2-10 字,作品在市集卡片上的主標題</div>',
            '</div>',

            // 一句話說明你的作品
            '<div class="dum-field">',
              '<label for="dumSlogan">一句話說明你的作品 <span class="req">*</span></label>',
              '<input type="text" id="dumSlogan" maxlength="40" placeholder="這個作品的核心 idea,作品的子標題" autocomplete="off">',
            '</div>',

            // 主類別
            '<div class="dum-field">',
              '<label>靈感主題 <span class="req">*</span></label>',
              '<div class="dum-chip-row" id="dumCategoryRow"></div>',
            '</div>',

            // 細部標籤 (主類選了才顯示)
            '<div class="dum-field dum-subcat-wrap" id="dumSubcatWrap" hidden>',
              '<div class="dum-subcat-head">',
                '<label>細部標籤 <span class="dum-subcat-meta" id="dumSubcatMeta">可複選</span></label>',
                '<span class="dum-subcat-count" id="dumSubcatCount">已選 0</span>',
              '</div>',
              '<div class="dum-chip-row dum-subcat-row" id="dumSubcatRow"></div>',
            '</div>',

          '</div>',

          // 條款
          '<div class="dum-terms">',
            '<div class="dum-terms-icon"><i class="fa-solid fa-info"></i></div>',
            '<div class="dum-terms-text">',
              '上傳即同意樂活雷雕服務條款,作品被使用一次將獲得 <b>$100 分潤</b>,月底結算。首件通過審核後自動開通創作者身份。',
            '</div>',
          '</div>',

          // 隱私權 / 使用條款 同意提示 (預設已同意,不需勾選)
          '<div class="dum-terms">',
            '<i class="fa-solid fa-circle-check"></i>',
            '<span>送出設計即表示您已閱讀並同意 <a href="privacy.html" target="_blank" rel="noopener">隱私權政策</a> 與 <a href="terms.html" target="_blank" rel="noopener">使用條款</a>,並授權樂活眼鏡將您的作品用於商品展示與宣傳。</span>',
          '</div>',

          // CTA
          '<div class="dum-actions">',
            '<button type="button" class="dum-btn-cancel" id="dumCancel">取 消</button>',
            '<button type="button" class="dum-btn-submit" id="dumSubmit"><span>送 出 審 核</span></button>',
          '</div>',

        '</div>',

        // Loading overlay (透明轉換用)
        '<div class="dum-loading" aria-hidden="true">',
          '<div class="dum-loading-box">',
            '<div class="dum-loading-spinner"></div>',
            '<div class="dum-loading-text">正在轉換為雷雕格式...</div>',
            '<div class="dum-loading-hint">大圖片可能要 3-8 秒,請稍候</div>',
          '</div>',
        '</div>',

      '</div>',
    ].join('');
  }


  function cacheEls(){
    els.bg          = modal.querySelector('.dum-bg');
    els.closeBtn    = modal.querySelector('.dum-close');
    els.uploader    = modal.querySelector('#dumUploader');
    els.fileInput   = modal.querySelector('#dumFileInput');
    els.preview     = modal.querySelector('#dumPreview');
    els.previewImg  = modal.querySelector('#dumPreviewImg');
    els.mockFrame   = modal.querySelector('#dumMockFrame');
    els.mockImg     = modal.querySelector('#dumMockImg');
    els.title       = modal.querySelector('#dumTitle');
    els.name        = modal.querySelector('#dumName');
    els.slogan      = modal.querySelector('#dumSlogan');
    els.categoryRow = modal.querySelector('#dumCategoryRow');
    els.subcatWrap  = modal.querySelector('#dumSubcatWrap');
    els.subcatRow   = modal.querySelector('#dumSubcatRow');
    els.subcatCount = modal.querySelector('#dumSubcatCount');
    els.subcatMeta  = modal.querySelector('#dumSubcatMeta');
    els.cancel      = modal.querySelector('#dumCancel');
    els.submit      = modal.querySelector('#dumSubmit');
    els.error       = modal.querySelector('#dumError');
  }


  // ===== 主類別清單 (對齊 gallery workCategory) =====
  var CATEGORIES = [
    '愛情紀念','家人親情','寵物回憶','心靈寄託','個人簽名',
    '生日節慶','企業團體','開運祝福','客製圖案'
  ];

  function renderCategories(){
    els.categoryRow.innerHTML = CATEGORIES.map(function(c){
      return '<button type="button" class="dum-chip" data-cat="' + escAttr(c) + '">' + escHtml(c) + '</button>';
    }).join('');

    els.categoryRow.querySelectorAll('.dum-chip').forEach(function(btn){
      btn.addEventListener('click', function(){
        var cat = btn.dataset.cat;
        state.selectedCategory = cat;
        state.selectedTags = [];   // 切主題 → 清空子標籤
        // toggle UI
        els.categoryRow.querySelectorAll('.dum-chip').forEach(function(b){ b.classList.toggle('on', b === btn); });
        renderSubcategories(cat);
      });
    });
  }


  function renderSubcategories(category){
    var tags = (window.LohasSubcategories || {})[category] || [];
    if(!tags.length){
      els.subcatWrap.hidden = true;
      return;
    }

    els.subcatMeta.textContent = category + ' · 可複選';
    els.subcatRow.innerHTML = tags.map(function(t){
      return '<button type="button" class="dum-chip dum-subchip" data-tag="' + escAttr(t) + '">' + escHtml(t) + '</button>';
    }).join('');

    els.subcatRow.querySelectorAll('.dum-subchip').forEach(function(btn){
      btn.addEventListener('click', function(){
        var tag = btn.dataset.tag;
        var i = state.selectedTags.indexOf(tag);
        if(i >= 0) state.selectedTags.splice(i, 1);
        else state.selectedTags.push(tag);
        btn.classList.toggle('on');
        els.subcatCount.textContent = '已選 ' + state.selectedTags.length;
      });
    });
    els.subcatCount.textContent = '已選 0';
    els.subcatWrap.hidden = false;
  }


  // ===== 檔案處理 =====
  function bindEvents(){
    els.bg.addEventListener('click', closeModal);
    els.closeBtn.addEventListener('click', closeModal);
    els.cancel.addEventListener('click', closeModal);
    document.addEventListener('keydown', onKeydown);

    // 點上傳區 → 開啟檔案選取器
    els.uploader.addEventListener('click', function(e){
      // 點到「重新裁切/移除」按鈕不要觸發
      if(e.target.closest('.dum-preview-btn')) return;
      els.fileInput.click();
    });
    els.uploader.addEventListener('keydown', function(e){
      if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); els.fileInput.click(); }
    });

    // 拖曳
    ['dragenter','dragover'].forEach(function(ev){
      els.uploader.addEventListener(ev, function(e){ e.preventDefault(); els.uploader.classList.add('drag'); });
    });
    ['dragleave','drop'].forEach(function(ev){
      els.uploader.addEventListener(ev, function(e){ e.preventDefault(); els.uploader.classList.remove('drag'); });
    });
    els.uploader.addEventListener('drop', function(e){
      var f = e.dataTransfer?.files?.[0];
      if(f) handleFile(f);
    });

    // 檔案選取
    els.fileInput.addEventListener('change', function(){
      var f = els.fileInput.files?.[0];
      if(f) handleFile(f);
      els.fileInput.value = '';   // reset 讓同檔可重選
    });

    // 預覽區按鈕(重裁/移除)
    modal.addEventListener('click', function(e){
      var act = e.target.closest('[data-action]')?.dataset?.action;
      if(act === 're-crop')  reCropCurrent();
      if(act === 'remove')   removeFile();
    });

    els.submit.addEventListener('click', submit);
  }


  async function handleFile(file){
    clearError();

    if(!file) return;

    // 大小檢查
    if(file.size > CONFIG.MAX_SIZE_MB * 1024 * 1024){
      return showError('檔案太大 (上限 ' + CONFIG.MAX_SIZE_MB + 'MB)');
    }
    // 型別檢查
    var ok = /^image\/(png|jpeg|jpg|svg\+xml)$/.test(file.type);
    if(!ok) return showError('只支援 PNG / JPG / SVG');

    // SVG 不需要裁切,直接收下
    if(file.type === 'image/svg+xml'){
      return setFile(file);
    }

    // ===== 強制裁切流程 =====
    // 沒載入 cropper-helper 就直接告訴使用者,不要悄悄收下原圖
    if(!window.LohasCropper?.crop){
      console.error('[upload-design] LohasCropper 沒載入,請檢查 cropper-helper.js 引用');
      return showError('裁切工具沒載入,請重新整理頁面');
    }

    try {
      var cropped = await window.LohasCropper.crop(file, {
        aspectRatio: CONFIG.CROP_ASPECT,
        title: '裁切刻圖設計 (1:1)',
      });
      // 使用者按取消 → 不收檔
      if(!cropped) return;

      // 進入透明轉換流程
      showLoading(true, '正在轉換為雷雕格式...');
      try {
        var result = await transformToTransparent(cropped);
        // 設置兩種產物
        state.file            = cropped;             // 原始裁切檔(備援)
        state.transparentBlob = result.pngBlob;      // 透明 PNG (預覽 + 上傳)
        state.svgString       = result.svgString;    // SVG XML (上傳)
        setFile(result.pngBlob);
      } catch(transformErr){
        console.error('[upload-design] 透明轉換失敗:', transformErr);
        showError('透明轉換失敗,改用原圖預覽');
        // fallback - 用原圖
        state.file = cropped;
        state.transparentBlob = null;
        state.svgString = null;
        setFile(cropped);
      } finally {
        showLoading(false);
      }
    } catch(e){
      console.error('[upload-design] Cropper 錯誤:', e);
      showError('裁切失敗:' + (e.message || '請再試一次'));
    }
  }


  /**
   * 白底圖片轉透明 + 追蹤成 SVG
   * 流程: Canvas 載入 → 二值化(閾值 220)→ 輸出 透明PNG + SVG
   * @param {Blob} blob 裁切後的原始檔
   * @returns {Promise<{pngBlob: Blob, svgString: string}>}
   */
  async function transformToTransparent(blob){
    // 1. 載入圖片到 Canvas
    var imgUrl = URL.createObjectURL(blob);
    var img = await loadImage(imgUrl);

    var canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(imgUrl);

    // 2. 像素掃描 → 產生兩份 imgData:
    //    - imgDataForPng: 白底變透明 (給 PNG 用)
    //    - imgDataForSvg: 白底保白 (給 imagetracerjs 用,它不擅長處理 alpha)
    var imgDataForPng = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var dataPng = imgDataForPng.data;

    // 複製一份給 SVG 用
    var canvas2 = document.createElement('canvas');
    canvas2.width = canvas.width;
    canvas2.height = canvas.height;
    var ctx2 = canvas2.getContext('2d');
    ctx2.drawImage(img, 0, 0);
    var imgDataForSvg = ctx2.getImageData(0, 0, canvas.width, canvas.height);
    var dataSvg = imgDataForSvg.data;

    var threshold = CONFIG.WHITE_THRESHOLD;
    var inkRgb = hexToRgb(CONFIG.INK_COLOR); // {r,g,b}

    for(var i = 0; i < dataPng.length; i += 4){
      var r = dataPng[i], g = dataPng[i+1], b = dataPng[i+2];
      var lum = 0.299 * r + 0.587 * g + 0.114 * b;

      if(lum > threshold){
        // 白底 → PNG 變透明
        dataPng[i+3] = 0;
        // SVG 版本保留白底 (255,255,255,255)
        dataSvg[i]   = 255;
        dataSvg[i+1] = 255;
        dataSvg[i+2] = 255;
        dataSvg[i+3] = 255;
      } else {
        // 深色:PNG 和 SVG 都改成統一墨色
        dataPng[i]   = inkRgb.r;
        dataPng[i+1] = inkRgb.g;
        dataPng[i+2] = inkRgb.b;
        dataPng[i+3] = 255;
        dataSvg[i]   = inkRgb.r;
        dataSvg[i+1] = inkRgb.g;
        dataSvg[i+2] = inkRgb.b;
        dataSvg[i+3] = 255;
      }
    }
    ctx.putImageData(imgDataForPng, 0, 0);

    // 3. Canvas → 透明 PNG Blob
    var pngBlob = await new Promise(function(resolve, reject){
      canvas.toBlob(function(b){
        if(b) resolve(b);
        else reject(new Error('Canvas 轉 PNG 失敗'));
      }, 'image/png');
    });

    // 4. SVG 追蹤路徑:優先用 Potrace (品質接近 Illustrator),失敗 fallback imagetracerjs
    //    用白底版的 imgDataForSvg (透明像素會混淆 tracer)
    var svgString = '';

    // Potrace WASM (品質優先)
    if(window.LohasPotrace?.ready && window.LohasPotrace?.trace){
      try {
        svgString = await window.LohasPotrace.trace(imgDataForSvg, {
          turdsize: 2,            // 忽略小於 2px 的雜訊
          turnpolicy: 4,          // majority
          alphamax: 1,            // 角點閾值 (1 = 較圓滑)
          opticurve: 1,           // 啟用曲線優化
          opttolerance: 0.2,      // 曲線優化容差
          pathonly: false,        // 完整 SVG (不只 path)
          extractcolors: false,   // 不抽多色 (我們已二值化)
          posterizelevel: 2,      // 2 階 (黑白)
          posterizationalgorithm: 0,
        });
      } catch(e){
        console.warn('[upload-design] Potrace 失敗,fallback imagetracerjs:', e);
        svgString = '';
      }
    }

    // Fallback: imagetracerjs (品質較低,但保證 work)
    if(!svgString && window.ImageTracer){
      try {
        svgString = window.ImageTracer.imagedataToSVG(imgDataForSvg, {
          // 強制兩色:墨色 + 白色 (palette,跳過量化避免錯誤)
          pal: [
            { r: inkRgb.r, g: inkRgb.g, b: inkRgb.b, a: 255 },
            { r: 255,      g: 255,      b: 255,      a: 255 },
          ],
          ltres:    1,
          qtres:    1,
          pathomit: 8,
          rightangleenhance: false,
          strokewidth: 0,
          linefilter: false,
          scale:    1,
          roundcoords: 1,
          viewbox: true,
          desc: false,
          lcpr: 0,
          qcpr: 0,
        });
      } catch(e){
        console.warn('[upload-design] imagetracerjs 也失敗,只回傳 PNG:', e);
      }
    }

    // 移除 SVG 內白色路徑 (只保留墨色),讓 SVG 白底自動透明
    if(svgString){
      svgString = svgString.replace(
        /<path[^>]+fill="rgb\(255,255,255\)"[^>]*\/>/g, ''
      );
      svgString = svgString.replace(
        /<rect[^>]+fill="rgb\(255,255,255\)"[^>]*\/>/g, ''
      );
      // Potrace 預設 fill="#000000",也是好的,不用換
    }

    if(!svgString){
      console.warn('[upload-design] 兩個 tracer 都沒用,SVG 為空');
    }

    return { pngBlob: pngBlob, svgString: svgString };
  }


  function loadImage(src){
    return new Promise(function(resolve, reject){
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload  = function(){ resolve(img); };
      img.onerror = function(){ reject(new Error('圖片載入失敗')); };
      img.src = src;
    });
  }


  function hexToRgb(hex){
    var h = hex.replace('#','');
    if(h.length === 3){ h = h.split('').map(function(c){ return c+c; }).join(''); }
    var n = parseInt(h, 16);
    return { r: (n>>16)&255, g: (n>>8)&255, b: n&255 };
  }


  function showLoading(show, text){
    var overlay = modal && modal.querySelector('.dum-loading');
    if(!overlay) return;
    if(show){
      var t = overlay.querySelector('.dum-loading-text');
      if(t && text) t.textContent = text;
      overlay.classList.add('on');
    } else {
      overlay.classList.remove('on');
    }
  }


  function setFile(file){
    if(state.previewUrl){ URL.revokeObjectURL(state.previewUrl); }
    state.file = file;
    state.previewUrl = URL.createObjectURL(file);
    els.previewImg.src = state.previewUrl;
    els.preview.hidden = false;
    els.uploader.querySelector('.dum-uploader-empty').hidden = true;
    els.uploader.classList.add('has-file');
    // 顯示眼鏡模擬框
    els.mockImg.src = state.previewUrl;
    els.mockFrame.hidden = false;
    syncSquareBoxes();
  }


  // 強制 .dum-mock-stage / .dum-uploader 都變方形
  // 強制 .dum-mock-stage 變方形(uploader 由 CSS flex-shrink + aspect-ratio 處理)
  function syncSquareBoxes(){
    if(!modal) return;
    // 單 rAF 等 layout 重排
    requestAnimationFrame(function(){
      var stage = modal.querySelector('.dum-mock-stage');
      if(stage){
        var w = stage.offsetWidth;
        if(w > 0) stage.style.height = w + 'px';
      }
    });
  }


  // window resize 也要重算
  window.addEventListener('resize', function(){
    if(modal && modal.classList.contains('is-open')){
      syncSquareBoxes();
    }
  });


  function removeFile(){
    if(state.previewUrl){ URL.revokeObjectURL(state.previewUrl); }
    state.file = null;
    state.previewUrl = null;
    state.transparentBlob = null;
    state.svgString = null;
    els.previewImg.src = '';
    els.preview.hidden = true;
    els.uploader.querySelector('.dum-uploader-empty').hidden = false;
    els.uploader.classList.remove('has-file');
    // 隱藏眼鏡模擬框
    els.mockImg.src = '';
    els.mockFrame.hidden = true;
  }


  async function reCropCurrent(){
    if(!state.file || !window.LohasCropper?.crop) return;
    try {
      var blob = await window.LohasCropper.crop(state.file, {
        aspectRatio: CONFIG.CROP_ASPECT,
        title: '重新裁切 (1:1)',
      });
      if(blob) setFile(blob);
    } catch(e){ /* 取消即略 */ }
  }


  // ===== 送出 =====
  async function submit(){
    if(state.submitting) return;
    clearError();

    // 驗證
    var member = window.LohasAuth?.getStoredMember?.();
    if(!member?.erpid) return showError('請先登入會員');

    if(!state.file && !state.editId)   return showError('請選擇要上傳的設計圖');
    var name   = (els.name.value || '').trim();
    var slogan = (els.slogan.value || '').trim();
    if(!name)                       return showError('請填寫設計名稱');
    if(!slogan)                     return showError('請填寫一句話說明你的作品');
    if(!state.selectedCategory)     return showError('請選擇靈感主題');

    var sb = window.LohasSupabase?.getClient?.();
    if(!sb) return showError('Supabase 沒準備好,請稍候');

    setSubmitting(true);

    try {
      var pngUrl = null;
      var svgUrl = null;

      // 1. 上傳透明 PNG (預覽 + 雷雕用)
      var pngBlob = state.transparentBlob || state.file;
      if(pngBlob){
        var pngPath = 'designs/' + member.erpid + '/' + Date.now() + '-' + randStr(6) + '.png';
        var { error: pngErr } = await sb.storage
          .from(CONFIG.STORAGE_BUCKET)
          .upload(pngPath, pngBlob, { contentType: 'image/png', upsert: false });
        if(pngErr) throw new Error('PNG 上傳失敗:' + pngErr.message);

        var { data: pngPub } = sb.storage.from(CONFIG.STORAGE_BUCKET).getPublicUrl(pngPath);
        pngUrl = pngPub?.publicUrl;
      }

      // 2. 上傳 SVG (真向量,雷雕機台用)
      if(state.svgString){
        var svgBlob = new Blob([state.svgString], { type: 'image/svg+xml' });
        var svgPath = 'designs/' + member.erpid + '/' + Date.now() + '-' + randStr(6) + '.svg';
        var { error: svgErr } = await sb.storage
          .from(CONFIG.STORAGE_BUCKET)
          .upload(svgPath, svgBlob, { contentType: 'image/svg+xml', upsert: false });
        if(svgErr){
          console.warn('[upload-design] SVG 上傳失敗,只記錄 PNG:', svgErr);
        } else {
          var { data: svgPub } = sb.storage.from(CONFIG.STORAGE_BUCKET).getPublicUrl(svgPath);
          svgUrl = svgPub?.publicUrl;
        }
      }

      // 3. 寫進 engraving_designs
      var displayName = member.erpname || member.erpName || member.name || '';
      if(!displayName){
        console.warn('[upload-design] 會員物件沒有 name 欄位:', member);
      }
      var payload = {
        name:           name,
        slogan:         slogan,
        category:       state.selectedCategory,
        keywords:       state.selectedTags.join(','),
        creator_id:     String(member.erpid),
        designer_name:  displayName,
        status:         'pending',
        type:           'member',
      };
      if(pngUrl){
        payload.image_url     = pngUrl;
        payload.image_url_png = pngUrl;
      }
      if(svgUrl){
        payload.image_url_svg = svgUrl;
      }

      var resp;
      if(state.editId){
        resp = await sb.from(CONFIG.TABLE).update(payload).eq('id', state.editId).select().single();
      } else {
        resp = await sb.from(CONFIG.TABLE).insert(payload).select().single();
      }
      if(resp.error) throw new Error('資料寫入失敗:' + resp.error.message);

      // 成功 → 關閉 + 清空 + 通知
      closeModal();
      resetForm();
      toast(state.editId ? '已重新送審' : '已送出審核,我們會盡快通知你');
      // 通知 member-portal 重整列表
      window.dispatchEvent(new CustomEvent('lohas:design-upload-success', { detail: resp.data }));

    } catch(e){
      console.error('[upload-design] 送出失敗:', e);
      showError(e.message || '送出失敗,請稍後再試');
    } finally {
      setSubmitting(false);
    }
  }


  function setSubmitting(s){
    state.submitting = s;
    els.submit.disabled = s;
    els.submit.querySelector('span').textContent = s ? '送出中...' : (state.editId ? '重 新 送 審' : '送 出 審 核');
    els.cancel.disabled = s;
  }


  // ===== Open / Close =====
  function openModal(){
    ensureModalInjected();
    resetForm();
    renderCategories();
    els.title.textContent = '新增刻圖設計';
    els.submit.querySelector('span').textContent = '送 出 審 核';
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    setTimeout(function(){
      els.name.focus();
      syncSquareBoxes();   // 等 modal 顯示後再算
    }, 100);
  }


  function openModalForEdit(design){
    ensureModalInjected();
    resetForm();
    renderCategories();

    state.editId = design.id;
    els.title.textContent = '重新編輯設計';
    els.submit.querySelector('span').textContent = '重 新 送 審';

    els.name.value   = design.name || '';
    els.slogan.value = design.slogan || '';

    if(design.category){
      state.selectedCategory = design.category;
      var btn = els.categoryRow.querySelector('[data-cat="' + cssEsc(design.category) + '"]');
      if(btn) btn.classList.add('on');
      renderSubcategories(design.category);

      // 還原已選子標籤
      if(design.keywords){
        var tags = String(design.keywords).split(',').map(function(s){ return s.trim(); }).filter(Boolean);
        state.selectedTags = tags.slice();
        tags.forEach(function(t){
          var b = els.subcatRow.querySelector('[data-tag="' + cssEsc(t) + '"]');
          if(b) b.classList.add('on');
        });
        els.subcatCount.textContent = '已選 ' + tags.length;
      }
    }

    // 編輯時若有舊圖,顯示預覽 (但不視為新上傳的 file,送出時不重傳)
    if(design.image_url){
      els.previewImg.src = design.image_url;
      els.preview.hidden = false;
      els.uploader.querySelector('.dum-uploader-empty').hidden = true;
      els.uploader.classList.add('has-file');
      // 編輯模式也要顯示眼鏡模擬
      els.mockImg.src = design.image_url;
      els.mockFrame.hidden = false;
      syncSquareBoxes();
    }

    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }


  function closeModal(){
    if(!modal) return;
    if(state.submitting) return;   // 上傳中不准關
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }


  function resetForm(){
    state.file = null;
    if(state.previewUrl){ URL.revokeObjectURL(state.previewUrl); state.previewUrl = null; }
    state.transparentBlob = null;
    state.svgString = null;
    state.editId = null;
    state.selectedCategory = '';
    state.selectedTags = [];
    state.submitting = false;

    if(els.name)   els.name.value = '';
    if(els.slogan) els.slogan.value = '';
    if(els.previewImg) els.previewImg.src = '';
    if(els.preview) els.preview.hidden = true;
    if(els.uploader){
      els.uploader.classList.remove('has-file');
      els.uploader.querySelector('.dum-uploader-empty').hidden = false;
    }
    if(els.mockImg)   els.mockImg.src = '';
    if(els.mockFrame) els.mockFrame.hidden = true;
    // 清 mock-stage inline height
    var stage = modal && modal.querySelector('.dum-mock-stage');
    if(stage) stage.style.height = '';
    if(els.subcatWrap) els.subcatWrap.hidden = true;
    clearError();
  }


  function onKeydown(e){
    if(e.key !== 'Escape') return;
    if(modal?.classList.contains('is-open')) closeModal();
  }


  // ===== UI helpers =====
  function showError(msg){
    if(!els.error) return alert(msg);
    var txt = els.error.querySelector('.dum-error-text');
    if(txt) txt.textContent = msg;
    else els.error.textContent = msg;
    els.error.hidden = false;
    // 觸發抖動動畫(reset 再加)
    els.error.classList.remove('shake');
    void els.error.offsetWidth;   // 強制 reflow
    els.error.classList.add('shake');
    // 滾到視圖內 (右欄頂部)
    var rightCol = modal.querySelector('.dum-right');
    if(rightCol) rightCol.scrollTop = 0;
  }
  function clearError(){
    if(els.error){ els.error.hidden = true; els.error.textContent = ''; }
  }
  function toast(msg){
    // 共用 utils.js 的 toast,沒有就 alert
    if(window.Utils?.toast)  return window.Utils.toast(msg);
    if(window.showToast)     return window.showToast(msg);
    alert(msg);
  }


  // ===== Utils =====
  function escHtml(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }
  function escAttr(s){ return String(s == null ? '' : s).replace(/"/g,'&quot;'); }
  function cssEsc(s){ return String(s).replace(/["\\\[\]:]/g, '\\$&'); }
  function guessExt(file){
    if(file.type === 'image/png') return 'png';
    if(file.type === 'image/jpeg' || file.type === 'image/jpg') return 'jpg';
    if(file.type === 'image/svg+xml') return 'svg';
    return 'png';
  }
  function guessMime(ext){
    return { png:'image/png', jpg:'image/jpeg', svg:'image/svg+xml' }[ext] || 'image/png';
  }
  function randStr(n){
    var s = 'abcdefghijklmnopqrstuvwxyz0123456789';
    var r = '';
    for(var i=0; i<n; i++) r += s.charAt(Math.floor(Math.random()*s.length));
    return r;
  }


  // ===== Export =====
  window.LohasUploadDesign = {
    openModal:          openModal,
    openModalForEdit:   openModalForEdit,
    closeModal:         closeModal,
  };

})(window);
