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

  // ===== 設計師模式:提示詞對照表 =====
  // 主題改用 categories 表(動態,跟快速模式/後台同一份)
  // 提示詞用「分類名稱」對應;沒對應到的分類 → 用 _default 通用提示詞
  // 每個分類有兩條路線:scratch(用文字生成) / material(素材改造)
  //
  // 【範例圖欄位(選填,留空就不顯示預覽)】
  //   用文字生成 scratch:  sample: '圖片URL'          → 顯示一張「成品範例」
  //   素材改造 material: before: 'URL', after: 'URL' → 顯示「改造前 → 改造後」兩張
  //   之後把圖傳到 Storage 或圖床,把網址填進對應欄位即可
  var PROMPT_MAP = {
    '_default': {
      scratch: [
        { id: 's-line', name: '極簡線條', desc: '單線勾勒、乾淨俐落', sample: '',
          prompt: '請畫一個「{主題}」主題的圖案,使用極簡單線條風格(single line art / minimalist line drawing),純黑線條、白色背景,無陰影、無填色,線條粗細一致,適合做成雷射雕刻圖案。正方形構圖,主體置中。' },
        { id: 's-cute', name: '可愛手繪', desc: '圓潤討喜、童趣感', sample: '',
          prompt: '請畫一個「{主題}」主題的圖案,使用圓潤的手繪卡通風格(cute hand-drawn cartoon),粗黑外框線、簡單造型,黑白色調為主,白色背景,適合雷射雕刻。正方形構圖。' },
      ],
      material: [
        { id: 'm-photo', name: '照片轉線稿', desc: '把照片變線條圖',
          prompt: '我會上傳一張「{主題}」相關的照片,請把它轉換成極簡單線條插畫(line art),只保留輪廓與必要特徵,純黑線條、白色背景,無陰影無填色,適合雷射雕刻。正方形構圖。' },
        { id: 'm-sketch', name: '手繪轉乾淨線稿', desc: '把手稿描成俐落線條',
          prompt: '我會上傳一張手繪草稿,請幫我重新描繪成乾淨俐落的黑色線條圖,去除雜線與陰影,白色背景,線條流暢一致,適合雷射雕刻。正方形構圖。' },
      ],
    },
    // ===== 以下針對特定分類客製(分類名稱要跟 categories 表一致) =====
    '文字標語': {
      scratch: [
        { id: 's-script', name: '手寫花體', desc: '優雅手寫字',
          prompt: '請把文字設計成優雅的手寫花體字(elegant hand-lettering script),黑色字、白色背景,線條流暢有粗細變化,適合雷射雕刻。正方形構圖,文字置中。' },
        { id: 's-stamp', name: '印章風格', desc: '方框 + 文字',
          prompt: '請把文字設計成印章風格(stamp / seal design),方形或圓形外框內含文字,黑白配色,復古質感,適合雷射雕刻。正方形構圖。' },
      ],
      material: [
        { id: 'm-handwrite', name: '手寫字跡轉向量', desc: '把親筆字變乾淨刻圖',
          prompt: '我會上傳一張親筆手寫字的照片,請幫我把字跡轉成乾淨的黑色向量線條,保留原本筆跡的個性,去背成白色背景,適合雷射雕刻。正方形構圖,文字置中。' },
      ],
    },
    '星座生肖': {
      scratch: [
        { id: 's-constellation', name: '星座連線', desc: '星點連線圖',
          prompt: '請畫出星座的星點連線圖(constellation line art),小圓點代表星星、細線連接,純黑線白底,簡潔現代,適合雷射雕刻。正方形構圖。' },
        { id: 's-totem', name: '符號圖騰', desc: '象徵性圖騰',
          prompt: '請設計一個星座/生肖的象徵圖騰(zodiac symbol icon),簡化的線條圖騰、黑白配色,對稱美感,適合雷射雕刻。正方形構圖置中。' },
      ],
      material: [
        { id: 'm-ref', name: '參考圖轉刻圖', desc: '拿無版權插圖改造',
          prompt: '我會上傳一張無版權的參考插圖,請以它為靈感重新繪製成簡潔的黑色線條刻圖,純黑線白底、無陰影,適合雷射雕刻。正方形構圖。' },
      ],
    },
  };

  // 依分類名稱取得提示詞組
  // 優先序:後台分類編輯器設的 → 前端 PROMPT_MAP 客製 → _default 通用
  function getPromptSet(catName){
    // 後台設的(categories.designer_prompts,經 loadCategoriesFromDB 帶進 catCache.prompts)
    if(catCache && catCache.prompts && catCache.prompts[catName]){
      var p = catCache.prompts[catName];
      if((p.scratch && p.scratch.length) || (p.material && p.material.length)) return p;
    }
    return PROMPT_MAP[catName] || PROMPT_MAP['_default'];
  }

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

        // ===== 模式切換 Tab =====
        '<div class="dum-tabs">',
          '<button type="button" class="dum-tab on" data-mode="designer"><i class="fa-solid fa-wand-magic-sparkles"></i> 設計師模式</button>',
          '<button type="button" class="dum-tab" data-mode="quick"><i class="fa-solid fa-bolt"></i> 快速模式</button>',
        '</div>',

        // ===== 設計師模式:3 步驟 =====
        '<div class="dum-designer" id="dumDesigner">',
          // 步驟指示
          '<div class="dum-steps">',
            '<div class="dum-step on" data-step="1"><span class="dum-step-n">1</span><span class="dum-step-t">選主題</span></div>',
            '<div class="dum-step-line"></div>',
            '<div class="dum-step" data-step="2"><span class="dum-step-n">2</span><span class="dum-step-t">選風格 · 生成</span></div>',
            '<div class="dum-step-line"></div>',
            '<div class="dum-step" data-step="3"><span class="dum-step-n">3</span><span class="dum-step-t">上傳作品</span></div>',
          '</div>',

          // --- 步驟 1:選主題 ---
          '<div class="dum-stepview on" data-stepview="1">',
            '<h3 class="dum-step-title">想做什麼主題的刻圖?</h3>',
            '<p class="dum-step-sub">選一個主題,下一步我們提供對應的 AI 生圖提示詞</p>',
            '<div class="dum-theme-grid" id="dumThemeGrid"></div>',
            '<div class="dum-theme-subs" id="dumThemeSubs" hidden>',
              '<div class="dum-theme-subs-head">細部標籤 <span class="dum-theme-subs-meta">可複選</span></div>',
              '<div class="dum-theme-subs-row" id="dumThemeSubsRow"></div>',
            '</div>',
            '<div class="dum-step-nav">',
              '<span></span>',
              '<button type="button" class="dum-btn-next" id="dumToStep2" disabled>下一步 <i class="fa-solid fa-arrow-right"></i></button>',
            '</div>',
          '</div>',

          // --- 步驟 2:選風格 + 提示詞 ---
          '<div class="dum-stepview" data-stepview="2">',
            '<h3 class="dum-step-title">選一個風格,用 AI 生成圖案</h3>',
            '<p class="dum-step-sub">複製提示詞 → 貼到 ChatGPT 生成圖片 → 存下來,下一步上傳</p>',
            '<div class="dum-routes">',
              // 路線 1:用文字生成
              '<div class="dum-route">',
                '<div class="dum-route-head"><span class="dum-route-badge a">A</span>用文字生成</div>',
                '<div class="dum-route-desc">直接用文字描述,讓 AI 從零生成</div>',
                '<div class="dum-style-list" id="dumScratchList"></div>',
              '</div>',
              // 路線 2:素材改造
              '<div class="dum-route">',
                '<div class="dum-route-head"><span class="dum-route-badge b">B</span>用現有素材改造</div>',
                '<div class="dum-route-desc">上傳手寫字、照片、無版權插圖,請 AI 改成刻圖</div>',
                '<div class="dum-style-list" id="dumMaterialList"></div>',
              '</div>',
            '</div>',
            '<div class="dum-style-sample" id="dumStyleSample" hidden></div>',
            '<div class="dum-prompt-box" id="dumPromptBox" hidden>',
              '<div class="dum-prompt-head">',
                '<span class="dum-prompt-label"><i class="fa-solid fa-quote-left"></i> 提示詞</span>',
                '<div class="dum-prompt-actions">',
                  '<button type="button" class="dum-prompt-btn" id="dumCopyPrompt"><i class="fa-solid fa-copy"></i> 複製</button>',
                  '<button type="button" class="dum-prompt-btn primary" id="dumOpenGpt"><i class="fa-solid fa-arrow-up-right-from-square"></i> 開啟 ChatGPT</button>',
                '</div>',
              '</div>',
              '<textarea class="dum-prompt-text" id="dumPromptText" readonly rows="4"></textarea>',
              '<div class="dum-gpt-hint" id="dumGptHint" hidden><i class="fa-solid fa-arrow-up"></i> 提示詞已複製!點上方「開啟 ChatGPT」貼上送出,生成你的圖案</div>',
              '<div class="dum-prompt-tip"><i class="fa-solid fa-lightbulb"></i> 小提示:生成後可以再請 ChatGPT 調整,例如「線條再細一點」「背景純白」。滿意後右鍵存圖,回來上傳。</div>',
            '</div>',
            '<div class="dum-step-nav">',
              '<button type="button" class="dum-btn-back" data-back="1"><i class="fa-solid fa-arrow-left"></i> 上一步</button>',
              '<button type="button" class="dum-btn-next" id="dumToStep3">下一步 <i class="fa-solid fa-arrow-right"></i></button>',
            '</div>',
          '</div>',

          // --- 步驟 3:上傳 + 名稱 + 描述 ---
          '<div class="dum-stepview" data-stepview="3">',
            '<h3 class="dum-step-title">上傳你的作品</h3>',
            '<p class="dum-step-sub">上傳剛生成的圖,填寫名稱與簡單描述</p>',
            '<div class="dum-d3-grid">',
              // 左:上傳區 (沿用同一套 uploader,id 不同)
              '<div class="dum-d3-upload">',
                '<div class="dum-uploader" id="dumUploader2" tabindex="0" role="button">',
                  '<div class="dum-uploader-empty">',
                    '<div class="dum-uploader-icon"><i class="fa-solid fa-arrow-up-from-bracket"></i></div>',
                    '<div class="dum-uploader-h">點擊或拖曳上傳</div>',
                    '<div class="dum-uploader-p">PNG / JPG / SVG · 最大 ' + CONFIG.MAX_SIZE_MB + 'MB</div>',
                  '</div>',
                  '<div class="dum-uploader-preview" id="dumPreview2" hidden>',
                    '<img alt="預覽" id="dumPreviewImg2">',
                    '<div class="dum-preview-actions">',
                      '<button type="button" class="dum-preview-btn" data-action="re-crop2"><i class="fa-solid fa-crop"></i> 重新裁切</button>',
                      '<button type="button" class="dum-preview-btn danger" data-action="remove2"><i class="fa-solid fa-xmark"></i> 移除</button>',
                    '</div>',
                  '</div>',
                '</div>',
                '<div class="dum-tip">',
                  '<b>小提示:</b> 上傳後可裁切,通過審核後會自動轉換成雷雕用透明底版本',
                  '<br><a href="market-about.html#not-suitable" target="_blank" rel="noopener" class="dum-tip-link"><i class="fa-solid fa-circle-question"></i> 不確定圖適不適合雷刻?看設計建議</a>',
                '</div>',
              '</div>',
              // 右:名稱 + 描述
              '<div class="dum-d3-form">',
                '<div class="dum-field">',
                  '<label for="dumName2">作品名稱 <span class="req">*</span></label>',
                  '<input type="text" id="dumName2" maxlength="20" placeholder="例如:愛笑貓咪" autocomplete="off">',
                '</div>',
                '<div class="dum-field">',
                  '<label for="dumSlogan2">簡單描述 <span class="req">*</span></label>',
                  '<input type="text" id="dumSlogan2" maxlength="40" placeholder="一句話介紹這個作品" autocomplete="off">',
                '</div>',
                '<div class="dum-d3-themetag" id="dumD3ThemeTag"></div>',
              '</div>',
            '</div>',
            // 六大載體模擬 (上傳後才顯示,含光學鏡片=眼鏡模擬)
            '<div class="dum-carriers" id="dumCarriers" hidden>',
              '<div class="dum-carriers-label"><i class="fa-solid fa-wand-magic-sparkles"></i> 刻在不同載體上的樣子(示意)</div>',
              '<div class="dum-carrier-grid" id="dumCarrierGrid"></div>',
            '</div>',
            // 條款:隱私權 / 使用條款
            '<div class="dum-terms">',
              '<div class="dum-terms-icon"><i class="fa-solid fa-info"></i></div>',
              '<div class="dum-terms-text">',
                '送出設計即表示您已閱讀並同意 <a href="https://www.lohasglasses.com/privacy.html" target="_blank" rel="noopener">隱私權政策</a> 與 <a href="https://www.lohasglasses.com/terms.html" target="_blank" rel="noopener">使用條款</a>,並授權樂活眼鏡將您的作品用於商品展示與宣傳。',
              '</div>',
            '</div>',
            // 審核流程 (含分潤說明)
            '<div class="dum-flow-info">',
              '<div class="dum-flow-label">審 核 流 程</div>',
              '<div class="dum-flow-desc">上傳後預設為 <b class="pending">待審核</b> 狀態,通過後自動上架創作者市集。</div>',
            '</div>',
            '<div class="dum-error" id="dumError2" hidden><i class="fa-solid fa-circle-exclamation"></i> <span class="dum-error-text"></span></div>',
            '<div class="dum-step-nav">',
              '<button type="button" class="dum-btn-back" data-back="2"><i class="fa-solid fa-arrow-left"></i> 上一步</button>',
              '<button type="button" class="dum-btn-submit" id="dumSubmit2"><span>送 出 審 核</span></button>',
            '</div>',
          '</div>',
        '</div>',

        // ===== 快速模式:現有左右兩欄 =====
        '<div class="dum-quick" id="dumQuick" hidden>',

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
            '<br><a href="market-about.html#not-suitable" target="_blank" rel="noopener" class="dum-tip-link"><i class="fa-solid fa-circle-question"></i> 不確定圖適不適合雷刻?看設計建議</a>',
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
            '<div class="dum-flow-desc">上傳後預設為 <b class="pending">待審核</b> 狀態,通過後自動上架創作者市集。</div>',
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

          // 條款: 隱私權 / 使用條款 (預設已同意)
          '<div class="dum-terms">',
            '<div class="dum-terms-icon"><i class="fa-solid fa-info"></i></div>',
            '<div class="dum-terms-text">',
              '送出設計即表示您已閱讀並同意 <a href="https://www.lohasglasses.com/privacy.html" target="_blank" rel="noopener">隱私權政策</a> 與 <a href="https://www.lohasglasses.com/terms.html" target="_blank" rel="noopener">使用條款</a>,並授權樂活眼鏡將您的作品用於商品展示與宣傳。',
            '</div>',
          '</div>',

          // CTA
          '<div class="dum-actions">',
            '<button type="button" class="dum-btn-cancel" id="dumCancel">取 消</button>',
            '<button type="button" class="dum-btn-submit" id="dumSubmit"><span>送 出 審 核</span></button>',
          '</div>',

        '</div>',
        '</div>',  // /dum-quick

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
  // 寫死的後備分類 (Supabase categories 表撈不到時才用)
  var CATEGORIES = [
    '愛情紀念','家人親情','寵物回憶','心靈寄託','個人簽名',
    '生日節慶','企業團體','開運祝福','客製圖案'
  ];

  // 從 categories 表載入的分類快取 (與後台分類管理共用同一份)
  // 結構: { mains: ['愛情紀念',...], subs: { '愛情紀念': ['交往紀念日',...] } }
  var catCache = null;

  async function loadCategoriesFromDB(){
    if(catCache) return catCache;
    try{
      var sb = window.LohasSupabase && window.LohasSupabase.getClient && window.LohasSupabase.getClient();
      if(!sb) throw new Error('no supabase');

      var res = await sb.from('categories')
        .select('id, parent_id, name, sort_order, is_active, designer_prompts')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if(res.error) throw res.error;

      var rows = res.data || [];
      var mains = [], subsById = {}, subs = {}, prompts = {};
      // 先收主分類
      rows.forEach(function(c){
        if(c.parent_id == null){
          mains.push(c); subs[c.name] = [];
          if(c.designer_prompts) prompts[c.name] = c.designer_prompts;
        }
      });
      // 再收子分類,掛到對應主分類名下
      var nameById = {};
      mains.forEach(function(m){ nameById[m.id] = m.name; });
      rows.forEach(function(c){
        if(c.parent_id != null && nameById[c.parent_id]){
          subs[nameById[c.parent_id]].push(c.name);
        }
      });

      catCache = {
        mains: mains.map(function(m){ return m.name; }),
        subs: subs,
        prompts: prompts,   // 分類名稱 → designer_prompts (後台設的)
      };
      return catCache;
    }catch(e){
      console.warn('[upload] 分類從 DB 載入失敗,改用內建後備:', e);
      // fallback: 用寫死的
      var fb = { mains: CATEGORIES.slice(), subs: {} };
      CATEGORIES.forEach(function(c){
        fb.subs[c] = (window.LohasSubcategories || {})[c] || [];
      });
      catCache = fb;
      return catCache;
    }
  }

  async function renderCategories(){
    var data = await loadCategoriesFromDB();
    els.categoryRow.innerHTML = data.mains.map(function(c){
      return '<button type="button" class="dum-chip" data-cat="' + escAttr(c) + '">' + escHtml(c) + '</button>';
    }).join('');

    els.categoryRow.querySelectorAll('.dum-chip').forEach(function(btn){
      btn.addEventListener('click', function(){
        var cat = btn.dataset.cat;
        state.selectedCategory = cat;
        state.selectedTags = [];   // 切主題 → 清空子標籤
        els.categoryRow.querySelectorAll('.dum-chip').forEach(function(b){ b.classList.toggle('on', b === btn); });
        renderSubcategories(cat);
      });
    });
  }


  function renderSubcategories(category){
    var tags = (catCache && catCache.subs[category]) || (window.LohasSubcategories || {})[category] || [];
    if(!tags.length){
      els.subcatWrap.hidden = true;
      return;
    }
    els.subcatWrap.hidden = false;

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

    bindDesignerMode();

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


  // ===== 設計師模式 =====
  var dz = { theme: null, style: null, route: null, subs: [] };   // 當前選的主題/風格/路線/子標籤
  // 光學鏡片刻圖定位(可拖曳/縮放/旋轉),預設值=原 CARRIERS 光學鏡片
  var lensPos = { x: 80, y: 22, w: 15, rot: 0 };

  function bindDesignerMode(){
    // tab 切換
    modal.querySelectorAll('.dum-tab').forEach(function(tab){
      tab.addEventListener('click', function(){
        switchMode(tab.dataset.mode);
      });
    });

    renderThemes();

    // 步驟導航
    var toStep2 = modal.querySelector('#dumToStep2');
    var toStep3 = modal.querySelector('#dumToStep3');
    if(toStep2) toStep2.addEventListener('click', function(){ gotoStep(2); });
    if(toStep3) toStep3.addEventListener('click', function(){ gotoStep(3); });
    modal.querySelectorAll('[data-back]').forEach(function(b){
      b.addEventListener('click', function(){ gotoStep(parseInt(b.dataset.back, 10)); });
    });

    // 複製提示詞
    var copyBtn = modal.querySelector('#dumCopyPrompt');
    if(copyBtn) copyBtn.addEventListener('click', copyPrompt);
    // 開 ChatGPT
    var gptBtn = modal.querySelector('#dumOpenGpt');
    if(gptBtn) gptBtn.addEventListener('click', function(){
      window.open('https://chatgpt.com', '_blank', 'noopener');
    });

    // 第三步上傳 (另一套 uploader)
    bindUploader2();

    // 第三步送出
    var submit2 = modal.querySelector('#dumSubmit2');
    if(submit2) submit2.addEventListener('click', submitDesigner);
  }

  function switchMode(mode){
    modal.querySelectorAll('.dum-tab').forEach(function(t){
      t.classList.toggle('on', t.dataset.mode === mode);
    });
    var designer = modal.querySelector('#dumDesigner');
    var quick = modal.querySelector('#dumQuick');
    if(mode === 'quick'){
      designer.hidden = true; quick.hidden = false;
    } else {
      designer.hidden = false; quick.hidden = true;
    }
  }

  // 依分類名稱關鍵字猜 FontAwesome icon (猜不到 → fa-shapes)
  function guessThemeIcon(name){
    var n = String(name || '');
    var map = [
      [/動物|寵物|貓|狗|喵|汪/, 'fa-paw'],
      [/植物|花|草|葉|園藝/, 'fa-leaf'],
      [/文字|標語|字|書法/, 'fa-font'],
      [/星座|生肖|占星/, 'fa-star'],
      [/節慶|節日|聖誕|新年|過年/, 'fa-gift'],
      [/居家|生活|家居/, 'fa-house'],
      [/愛情|情侶|心|婚/, 'fa-heart'],
      [/食物|美食|餐|咖啡|飲/, 'fa-mug-saucer'],
      [/音樂|樂器|歌/, 'fa-music'],
      [/運動|球|健身/, 'fa-dumbbell'],
      [/旅行|旅遊|地圖|出國/, 'fa-plane'],
      [/兒童|寶寶|嬰/, 'fa-baby'],
      [/車|交通/, 'fa-car'],
      [/海|魚|海洋|浪/, 'fa-fish'],
      [/幾何|圖形|抽象/, 'fa-shapes'],
      [/宗教|佛|神|廟/, 'fa-hands-praying'],
      [/英文|字母|英語/, 'fa-a'],
      [/數字|號碼/, 'fa-hashtag'],
    ];
    for(var i = 0; i < map.length; i++){
      if(map[i][0].test(n)) return map[i][1];
    }
    return 'fa-shapes';
  }

  async function renderThemes(){
    var grid = modal.querySelector('#dumThemeGrid');
    if(!grid) return;
    grid.innerHTML = '<div class="dum-style-empty" style="grid-column:1/-1">載入主題中...</div>';

    var data = await loadCategoriesFromDB();
    var mains = (data && data.mains) || [];
    if(!mains.length){
      grid.innerHTML = '<div class="dum-style-empty" style="grid-column:1/-1">尚無分類,請先到後台分類管理新增</div>';
      return;
    }
    grid.innerHTML = mains.map(function(name){
      return '<button type="button" class="dum-theme-card" data-theme="' + escAttr(name) + '">' +
               '<span class="dum-theme-emoji"><i class="fa-solid ' + guessThemeIcon(name) + '"></i></span>' +
               '<span class="dum-theme-name">' + escHtml(name) + '</span>' +
             '</button>';
    }).join('');
    grid.querySelectorAll('.dum-theme-card').forEach(function(card){
      card.addEventListener('click', function(){
        grid.querySelectorAll('.dum-theme-card').forEach(function(c){ c.classList.remove('on'); });
        card.classList.add('on');
        dz.theme = card.dataset.theme;   // 存分類名稱字串
        dz.style = null;
        dz.subs = [];                    // 換主題清空子標籤
        modal.querySelector('#dumToStep2').disabled = false;
        renderThemeSubs();
        renderStyles();
      });
    });
  }

  // 渲染選定主分類的子分類(可複選)
  function renderThemeSubs(){
    var wrap = modal.querySelector('#dumThemeSubs');
    var row = modal.querySelector('#dumThemeSubsRow');
    if(!wrap || !row) return;
    var subs = (catCache && catCache.subs && catCache.subs[dz.theme]) || [];
    if(!subs.length){ wrap.hidden = true; row.innerHTML = ''; return; }
    row.innerHTML = subs.map(function(name){
      return '<button type="button" class="dum-subchip-d" data-sub="' + escAttr(name) + '">' + escHtml(name) + '</button>';
    }).join('');
    row.querySelectorAll('.dum-subchip-d').forEach(function(chip){
      chip.addEventListener('click', function(){
        var name = chip.dataset.sub;
        var i = dz.subs.indexOf(name);
        if(i >= 0){ dz.subs.splice(i, 1); chip.classList.remove('on'); }
        else { dz.subs.push(name); chip.classList.add('on'); }
      });
    });
    wrap.hidden = false;
  }

  function renderStyles(){
    var scratchList = modal.querySelector('#dumScratchList');
    var materialList = modal.querySelector('#dumMaterialList');
    var box = modal.querySelector('#dumPromptBox');
    if(!scratchList || !materialList || !dz.theme) return;
    if(box) box.hidden = true;
    dz.style = null;

    var promptSet = getPromptSet(dz.theme);   // 依分類名稱取提示詞組

    function cardHtml(s){
      return '<button type="button" class="dum-style-card" data-style="' + s.id + '">' +
               '<span class="dum-style-name">' + escHtml(s.name) + '</span>' +
               '<span class="dum-style-desc">' + escHtml(s.desc || '') + '</span>' +
             '</button>';
    }
    scratchList.innerHTML = (promptSet.scratch || []).map(cardHtml).join('') ||
      '<div class="dum-style-empty">此主題暫無</div>';
    materialList.innerHTML = (promptSet.material || []).map(cardHtml).join('') ||
      '<div class="dum-style-empty">此主題暫無</div>';

    // 跨兩路線單選:所有 style 集中
    var allStyles = (promptSet.scratch || []).concat(promptSet.material || []);
    modal.querySelectorAll('#dumScratchList .dum-style-card, #dumMaterialList .dum-style-card').forEach(function(card){
      card.addEventListener('click', function(){
        modal.querySelectorAll('#dumScratchList .dum-style-card, #dumMaterialList .dum-style-card')
          .forEach(function(c){ c.classList.remove('on'); });
        card.classList.add('on');
        dz.style = allStyles.find(function(x){ return x.id === card.dataset.style; });
        // 記錄路線:卡片在哪個 list
        dz.route = card.closest('#dumMaterialList') ? 'material' : 'scratch';
        showPrompt();
      });
    });

    // 預設自動選 A(用文字生成)的第一個風格
    var firstCard = modal.querySelector('#dumScratchList .dum-style-card')
                 || modal.querySelector('#dumMaterialList .dum-style-card');
    if(firstCard) firstCard.click();
  }

  function showPrompt(){
    var box = modal.querySelector('#dumPromptBox');
    var ta = modal.querySelector('#dumPromptText');
    if(!box || !ta || !dz.style) return;
    // {主題} 自動替換成選的分類名稱
    var p = dz.style.prompt || '';
    if(dz.theme) p = p.split('{主題}').join(dz.theme);
    ta.value = p;
    box.hidden = false;
    // 範例圖預覽
    renderStyleSample();
    // 重置引導(換風格重來)
    var gpt = modal.querySelector('#dumOpenGpt');
    if(gpt) gpt.classList.remove('guide');
    var hint = modal.querySelector('#dumGptHint');
    if(hint) hint.hidden = true;
  }

  // 選風格後顯示範例圖:用文字生成=1張;素材改造=改造前後2張
  function renderStyleSample(){
    var wrap = modal.querySelector('#dumStyleSample');
    if(!wrap) return;
    var s = dz.style || {};
    if(dz.route === 'material'){
      var before = s.before || '', after = s.after || '';
      if(!before && !after){ wrap.hidden = true; wrap.innerHTML = ''; return; }
      wrap.innerHTML =
        '<div class="dum-sample-label">範例:改造前 → 改造後</div>' +
        '<div class="dum-sample-pair">' +
          '<figure class="dum-sample-fig">' +
            (before ? '<img src="' + escAttr(before) + '" alt="改造前">' : '<div class="dum-sample-ph">改造前</div>') +
            '<figcaption>改造前</figcaption>' +
          '</figure>' +
          '<i class="fa-solid fa-arrow-right dum-sample-arrow"></i>' +
          '<figure class="dum-sample-fig">' +
            (after ? '<img src="' + escAttr(after) + '" alt="改造後">' : '<div class="dum-sample-ph">改造後</div>') +
            '<figcaption>改造後</figcaption>' +
          '</figure>' +
        '</div>';
      wrap.hidden = false;
    } else {
      var sample = s.sample || '';
      if(!sample){ wrap.hidden = true; wrap.innerHTML = ''; return; }
      wrap.innerHTML =
        '<div class="dum-sample-label">這個風格的成品範例</div>' +
        '<div class="dum-sample-single"><img src="' + escAttr(sample) + '" alt="範例"></div>';
      wrap.hidden = false;
    }
  }

  async function copyPrompt(){
    var ta = modal.querySelector('#dumPromptText');
    if(!ta) return;
    var done = function(){
      var btn = modal.querySelector('#dumCopyPrompt');
      if(btn){
        var old = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> 已複製';
        setTimeout(function(){ btn.innerHTML = old; }, 1800);
      }
      // 引導:高亮「開啟 ChatGPT」鈕 + 顯示箭頭提示(依路線不同文案)
      var gpt = modal.querySelector('#dumOpenGpt');
      if(gpt) gpt.classList.add('guide');
      var hint = modal.querySelector('#dumGptHint');
      if(hint){
        var txt;
        if(dz.route === 'material'){
          txt = '提示詞已複製!點上方「開啟 ChatGPT」→ 在對話框<b>上傳你的素材圖</b>(手寫字/照片/插圖)→ 貼上提示詞送出,生成刻圖';
        } else {
          txt = '提示詞已複製!點上方「開啟 ChatGPT」→ 直接<b>貼上提示詞送出</b>,生成你的圖案';
        }
        hint.innerHTML = '<i class="fa-solid fa-arrow-up"></i> <span>' + txt + '</span>';
        hint.hidden = false;
      }
    };
    try {
      await navigator.clipboard.writeText(ta.value);
      done();
    } catch(e){
      ta.select(); document.execCommand('copy'); done();
    }
  }

  function gotoStep(n){
    // 步驟驗證
    if(n === 2 && !dz.theme){ return; }
    // 切步驟指示
    modal.querySelectorAll('.dum-step').forEach(function(s){
      var sn = parseInt(s.dataset.step, 10);
      s.classList.toggle('on', sn === n);
      s.classList.toggle('done', sn < n);
    });
    // 切步驟內容
    modal.querySelectorAll('.dum-stepview').forEach(function(v){
      v.classList.toggle('on', parseInt(v.dataset.stepview, 10) === n);
    });
    // 進第三步時,顯示選的主題標籤
    if(n === 3){
      var tag = modal.querySelector('#dumD3ThemeTag');
      if(tag && dz.theme){
        tag.innerHTML = '<i class="fa-solid fa-tag"></i> 主題:' + escHtml(dz.theme) +
          (dz.style ? ' · ' + escHtml(dz.style.name) : '');
      }
    }
    // 切步驟後捲到最上面 (手機/桌機都歸零)
    var designer = modal.querySelector('#dumDesigner');
    if(designer) designer.scrollTop = 0;
    var dialog = modal.querySelector('.dum-dialog');
    if(dialog) dialog.scrollTop = 0;
  }

  // 第三步的上傳器 (沿用 handleFile 同套處理,但獨立預覽)
  function bindUploader2(){
    var up = modal.querySelector('#dumUploader2');
    var fileInput = els.fileInput;   // 共用同一個 file input
    if(!up) return;
    up.addEventListener('click', function(e){
      if(e.target.closest('.dum-preview-btn')) return;
      fileInput.click();
    });
    ['dragenter','dragover'].forEach(function(ev){
      up.addEventListener(ev, function(e){ e.preventDefault(); up.classList.add('drag'); });
    });
    ['dragleave','drop'].forEach(function(ev){
      up.addEventListener(ev, function(e){ e.preventDefault(); up.classList.remove('drag'); });
    });
    up.addEventListener('drop', function(e){
      var f = e.dataTransfer?.files?.[0];
      if(f) handleFile(f);
    });
    // 第三步的移除/重裁
    modal.addEventListener('click', function(e){
      var act = e.target.closest('[data-action]')?.dataset?.action;
      if(act === 're-crop2') reCropCurrent();
      if(act === 'remove2')  removeFile();
    });
  }

  // 設計師模式送出 (用第三步的名稱/描述欄位)
  async function submitDesigner(){
    var nameEl = modal.querySelector('#dumName2');
    var sloganEl = modal.querySelector('#dumSlogan2');
    var name = (nameEl?.value || '').trim();
    var slogan = (sloganEl?.value || '').trim();

    if(!state.file && !state.svgString){ return showError2('請先上傳作品圖'); }
    if(!name){ return showError2('請填寫作品名稱'); }
    if(!slogan){ return showError2('請填一句簡單描述'); }

    // 把設計師模式的欄位灌進主流程用的欄位,沿用 submit()
    if(els.name)   els.name.value = name;
    if(els.slogan) els.slogan.value = slogan;
    // 主題 → category;子標籤 + 風格名 → tags
    state.selectedCategory = dz.theme || '';
    var tags = (dz.subs || []).slice();
    if(dz.style && dz.style.name) tags.push(dz.style.name);
    state.selectedTags = tags;

    submit();
  }

  function showError2(msg){
    var box = modal.querySelector('#dumError2');
    if(!box) return;
    box.querySelector('.dum-error-text').textContent = msg;
    box.hidden = false;
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

    // 同步第三步(設計師模式)的預覽
    var up2 = modal.querySelector('#dumUploader2');
    var pv2 = modal.querySelector('#dumPreview2');
    var pi2 = modal.querySelector('#dumPreviewImg2');
    if(up2 && pv2 && pi2){
      pi2.src = state.previewUrl;
      pv2.hidden = false;
      var empty2 = up2.querySelector('.dum-uploader-empty');
      if(empty2) empty2.hidden = true;
      up2.classList.add('has-file');
    }
    // 渲染六大載體模擬(含光學鏡片=眼鏡模擬)
    renderCarriers(state.previewUrl);
    // 設計師模式第三步:上傳後彈出鏡片定位視窗
    if(state.previewUrl && modal.querySelector('[data-stepview="3"]') &&
       modal.querySelector('[data-stepview="3"]').classList.contains('on')){
      openLensPositioner(state.previewUrl);
    }
  }

  // 六大載體設定:底圖 + 刻圖疊放位置(%,相對底圖)
  var CARRIERS = [
    { name: '光學鏡片', img: 'images/glasses-mockup.jpg', x: 80, y: 22, w: 15, glasses: true },
    { name: '鏡框',     img: 'images/carrier-frame.jpg',   x: 50, y: 40, w: 7 },
    { name: '眼鏡盒',   img: 'images/carrier-box.jpg',     x: 50, y: 45, w: 10 },
    { name: '眼鏡布',   img: 'images/carrier-cloth.jpg',   x: 72, y: 60, w: 11 },
    { name: '周邊配件', img: 'images/carrier-merch.jpg',   x: 51, y: 57, w: 10 },
    { name: '鼻墊',     img: 'images/carrier-nosepad.jpg', x: 34, y: 45, w: 8 },
    { name: '眼鏡袋',   img: 'images/carrier-pouch.jpg',   x: 45, y: 72, w: 11 },
  ];

  function renderCarriers(imgUrl){
    var box = modal.querySelector('#dumCarriers');
    var grid = modal.querySelector('#dumCarrierGrid');
    if(!box || !grid) return;
    if(!imgUrl){ box.hidden = true; grid.innerHTML = ''; return; }
    function carrierHtml(c){
      // 光學鏡片用使用者定位的 lensPos(水平置中、top為上緣、可旋轉),其他用中心對齊預設
      var engStyle;
      if(c.glasses){
        engStyle = 'left:' + lensPos.x + '%;top:' + lensPos.y + '%;width:' + lensPos.w +
          '%;transform:translateX(-50%) rotate(' + lensPos.rot + 'deg)';
      } else {
        engStyle = 'left:' + c.x + '%;top:' + c.y + '%;width:' + c.w + '%;transform:translate(-50%,-50%)';
      }
      return '<figure class="dum-carrier' + (c.glasses ? ' dum-carrier-lead' : '') + '">' +
               '<div class="dum-carrier-stage">' +
                 '<img class="dum-carrier-bg" src="' + escAttr(c.img) + '" alt="' + escAttr(c.name) + '">' +
                 '<img class="dum-carrier-engrave" src="' + escAttr(imgUrl) + '" style="' + engStyle + '">' +
               '</div>' +
               '<figcaption>' + escHtml(c.name) + '</figcaption>' +
             '</figure>';
    }
    // 光學鏡片(第一排,獨佔) + 其他六個(3個一排)
    var lead = CARRIERS.filter(function(c){ return c.glasses; });
    var rest = CARRIERS.filter(function(c){ return !c.glasses; });
    grid.innerHTML =
      '<div class="dum-carrier-lead-row">' + lead.map(carrierHtml).join('') + '</div>' +
      '<div class="dum-carrier-rest-row">' + rest.map(carrierHtml).join('') + '</div>';
    box.hidden = false;
  }

  // ===== 光學鏡片刻圖定位視窗(拖曳移動 / 滾輪+捏合縮放 / 旋轉點+雙指旋轉) =====
  function openLensPositioner(imgUrl){
    var ov = modal.querySelector('#dumLensPos');
    if(!ov){
      ov = document.createElement('div');
      ov.id = 'dumLensPos';
      ov.className = 'dum-lenspos-ovl';
      modal.appendChild(ov);
    }
    var edit = { x: lensPos.x, y: lensPos.y, w: lensPos.w, rot: lensPos.rot };

    ov.innerHTML =
      '<div class="dum-lenspos-dialog">' +
        '<div class="dum-lenspos-head">' +
          '<span><i class="fa-solid fa-up-down-left-right"></i> 調整刻圖在鏡片上的位置</span>' +
          '<button class="dum-lenspos-x" type="button" aria-label="關閉"><i class="fa-solid fa-xmark"></i></button>' +
        '</div>' +
        '<div class="dum-lenspos-stage" id="lpStage">' +
          '<img class="dum-lenspos-bg" src="images/glasses-mockup.jpg" alt="鏡片" draggable="false">' +
          '<div class="dum-lenspos-box" id="lpBox">' +
            '<img class="dum-lenspos-eng" id="lpEng" src="' + escAttr(imgUrl) + '" draggable="false">' +
            '<span class="dum-lenspos-rot" id="lpRot" title="拖曳旋轉"><i class="fa-solid fa-rotate"></i></span>' +
          '</div>' +
        '</div>' +
        '<p class="dum-lenspos-tip"><i class="fa-solid fa-hand-pointer"></i> 拖曳刻圖移動・滾輪或雙指縮放・拖曳上方旋轉鈕或雙指旋轉</p>' +
        '<div class="dum-lenspos-foot">' +
          '<button class="dum-lenspos-cancel" type="button">取消</button>' +
          '<button class="dum-lenspos-ok" type="button">確定</button>' +
        '</div>' +
      '</div>';

    var stage = ov.querySelector('#lpStage');
    var box = ov.querySelector('#lpBox');
    var rotBtn = ov.querySelector('#lpRot');

    function apply(){
      // box 用中心定位(方便旋轉鈕跟著轉),寬度=edit.w%,高度auto
      box.style.left = edit.x + '%';
      box.style.top = edit.y + '%';
      box.style.width = edit.w + '%';
      box.style.transform = 'translate(-50%,-50%) rotate(' + edit.rot + 'deg)';
    }
    apply();

    function stageRect(){ return stage.getBoundingClientRect(); }
    function clamp(v){ return Math.max(0, Math.min(100, v)); }

    // ---- 拖曳移動(單指/滑鼠在 box 本體) ----
    var dragging = false, sX, sY, sEx, sEy;
    function dragDown(e){
      if(e.target === rotBtn || rotBtn.contains(e.target)) return; // 旋轉鈕另外處理
      if(e.touches && e.touches.length > 1) return;                // 多指交給捏合
      dragging = true;
      var p = e.touches ? e.touches[0] : e;
      sX = p.clientX; sY = p.clientY; sEx = edit.x; sEy = edit.y;
      e.preventDefault();
    }
    function dragMove(e){
      if(!dragging) return;
      if(e.touches && e.touches.length > 1){ dragging = false; return; }
      var p = e.touches ? e.touches[0] : e;
      var r = stageRect();
      edit.x = clamp(sEx + (p.clientX - sX) / r.width * 100);
      edit.y = clamp(sEy + (p.clientY - sY) / r.height * 100);
      apply();
    }
    function dragUp(){ dragging = false; }

    box.addEventListener('mousedown', dragDown);
    box.addEventListener('touchstart', dragDown, { passive: false });
    window.addEventListener('mousemove', dragMove);
    window.addEventListener('touchmove', dragMove, { passive: false });
    window.addEventListener('mouseup', dragUp);
    window.addEventListener('touchend', dragUp);

    // ---- 滾輪縮放(桌機) ----
    function onWheel(e){
      e.preventDefault();
      var d = e.deltaY < 0 ? 1 : -1;
      edit.w = Math.max(5, Math.min(50, edit.w + d * 1.5));
      apply();
    }
    stage.addEventListener('wheel', onWheel, { passive: false });

    // ---- 旋轉鈕拖曳(桌機/觸控) ----
    var rotating = false;
    function center(){
      var r = stageRect();
      return { cx: r.left + r.width * edit.x / 100, cy: r.top + r.height * edit.y / 100 };
    }
    function rotDown(e){
      rotating = true;
      e.preventDefault(); e.stopPropagation();
    }
    function rotMove(e){
      if(!rotating) return;
      var p = e.touches ? e.touches[0] : e;
      var c = center();
      var ang = Math.atan2(p.clientY - c.cy, p.clientX - c.cx) * 180 / Math.PI;
      edit.rot = Math.round(ang + 90); // 旋轉鈕在上方,+90 對齊
      apply();
    }
    function rotUp(){ rotating = false; }
    rotBtn.addEventListener('mousedown', rotDown);
    rotBtn.addEventListener('touchstart', rotDown, { passive: false });
    window.addEventListener('mousemove', rotMove);
    window.addEventListener('touchmove', rotMove, { passive: false });
    window.addEventListener('mouseup', rotUp);
    window.addEventListener('touchend', rotUp);

    // ---- 雙指捏合縮放 + 旋轉(觸控) ----
    var pinch = null;
    function dist(t){ return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }
    function angle(t){ return Math.atan2(t[1].clientY - t[0].clientY, t[1].clientX - t[0].clientX) * 180 / Math.PI; }
    function touchStart(e){
      if(e.touches.length === 2){
        pinch = { d: dist(e.touches), a: angle(e.touches), w: edit.w, rot: edit.rot };
        e.preventDefault();
      }
    }
    function touchMove(e){
      if(pinch && e.touches.length === 2){
        e.preventDefault();
        var scale = dist(e.touches) / pinch.d;
        edit.w = Math.max(5, Math.min(50, pinch.w * scale));
        edit.rot = Math.round(pinch.rot + (angle(e.touches) - pinch.a));
        apply();
      }
    }
    function touchEnd(e){ if(e.touches.length < 2) pinch = null; }
    stage.addEventListener('touchstart', touchStart, { passive: false });
    stage.addEventListener('touchmove', touchMove, { passive: false });
    stage.addEventListener('touchend', touchEnd);

    function cleanup(){
      window.removeEventListener('mousemove', dragMove);
      window.removeEventListener('touchmove', dragMove);
      window.removeEventListener('mouseup', dragUp);
      window.removeEventListener('touchend', dragUp);
      window.removeEventListener('mousemove', rotMove);
      window.removeEventListener('touchmove', rotMove);
      window.removeEventListener('mouseup', rotUp);
      window.removeEventListener('touchend', rotUp);
      stage.removeEventListener('wheel', onWheel);
      ov.classList.remove('open');
    }
    ov.querySelector('.dum-lenspos-ok').addEventListener('click', function(){
      lensPos = { x: edit.x, y: edit.y, w: edit.w, rot: edit.rot };
      cleanup();
      renderCarriers(state.previewUrl);
    });
    ov.querySelector('.dum-lenspos-cancel').addEventListener('click', cleanup);
    ov.querySelector('.dum-lenspos-x').addEventListener('click', cleanup);

    ov.classList.add('open');
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

    // 同步清第三步預覽
    var up2 = modal.querySelector('#dumUploader2');
    var pv2 = modal.querySelector('#dumPreview2');
    var pi2 = modal.querySelector('#dumPreviewImg2');
    if(up2 && pv2 && pi2){
      pi2.src = '';
      pv2.hidden = true;
      var empty2 = up2.querySelector('.dum-uploader-empty');
      if(empty2) empty2.hidden = false;
      up2.classList.remove('has-file');
    }
    // 清六大載體模擬
    // 換圖重來,鏡片定位重置回預設
    lensPos = { x: 80, y: 22, w: 15, rot: 0 };
    renderCarriers(null);
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
  async function openModal(){
    ensureModalInjected();
    resetForm();
    await renderCategories();
    els.title.textContent = '新增刻圖設計';
    els.submit.querySelector('span').textContent = '送 出 審 核';
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    scrollDialogTop();
    setTimeout(function(){
      els.name.focus();
      syncSquareBoxes();   // 等 modal 顯示後再算
    }, 100);
  }


  async function openModalForEdit(design){
    ensureModalInjected();
    resetForm();
    await renderCategories();

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
    scrollDialogTop();
  }


  // 把 modal 捲到最上面 (手機版 .dum-dialog 是捲動容器;桌機是 .dum-left/.dum-right)
  function scrollDialogTop(){
    setTimeout(function(){
      var dialog = modal && modal.querySelector('.dum-dialog');
      if(dialog) dialog.scrollTop = 0;
      var left = modal && modal.querySelector('.dum-left');
      if(left) left.scrollTop = 0;
      var right = modal && modal.querySelector('.dum-right');
      if(right) right.scrollTop = 0;
    }, 0);
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
