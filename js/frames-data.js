/* ============================================================
   frames-data.js — 鏡框百科 資料層
   ------------------------------------------------------------
   四大族群語意化代碼系統：
     mat-*    材質 × 形狀
     style-*  風格系列
     sun-*    太陽眼鏡
     func-*   功能 / 族群
   ------------------------------------------------------------
   ⚠️ 目前商品連結與部分文案為靜態佔位資料，
      待 ERP interface #36 開通後改由 API 帶入。
   ============================================================ */

/* ---------- 1. 舊站 ID → 新代碼 對照表 ----------
   實體 QR 已印製 lohasglasses.com/page/1/{舊ID}，
   由 404.html 導向 frames.html?f={舊ID}，於此處轉譯成新代碼。
   合併規則（做法2）：金屬+塑膠 / 金屬X塑膠 / 塑膠+金屬 統一視為 combo。 */
const LEGACY_ID_MAP = {
  // --- 材質 × 形狀 ---
  '396': 'mat-combo-round',        // QR1  金屬+塑膠(圓形)
  '399': 'mat-combo-round',        // QR6  金屬X塑膠(圓形)
  '414': 'mat-combo-round',        // QR22 塑膠+金屬(圓形)
  '397': 'mat-combo-square',       // QR2  金屬+塑膠(方形) ※QR37 太陽型男誤印同ID
  '400': 'mat-combo-square',       // QR7  金屬X塑膠(方形)
  '415': 'mat-combo-square',       // QR23 塑膠+金屬(方型)
  '398': 'mat-combo-poly',         // QR3  金屬+塑膠(多角)
  '403': 'mat-titan-round',        // QR11 鈦合金(圓形)
  '404': 'mat-titan-square',       // QR12 鈦合金(方形)
  '405': 'mat-titan-poly',         // QR13 鈦合金(多角)
  '406': 'mat-memory-round',       // QR14 記憶合金(圓形)
  '407': 'mat-memory-square',      // QR15 記憶合金(方形)
  '408': 'mat-memory-rect',        // QR16 記憶合金(長方)
  '409': 'mat-memory-poly',        // QR17 記憶合金(多角)
  '410': 'mat-plastic-pad-round',  // QR18 塑膠-鼻墊(圓形)
  '411': 'mat-plastic-pad-square', // QR19 塑膠-鼻墊(方形)
  '412': 'mat-plastic-nopad-round',// QR20 塑膠-無鼻墊(圓形)
  '413': 'mat-plastic-nopad-square',//QR21 塑膠-無鼻墊(方形)
  '416': 'mat-alloy-square',       // QR24 金屬合金(正方型)
  '418': 'mat-clear',              // QR26 塑膠(各式)透明框
  '471': 'mat-almgti',             // QR45 鋁鎂鈦

  // --- 風格系列 ---
  '87':  'style-meilin',           // QR4  Měi Lin
  '104': 'style-takumi',           // QR5  TAKUMI
  '425': 'style-seasar',           // QR8  時祤（原QR結尾多 ' 已於404.html濾除）
  '426': 'style-lady-oval',        // QR9  金屬(橢圓)淑女
  '115': 'style-w',                // QR10 W
  '116': 'style-theblock',         // QR27 THE BLOCK
  '109': 'style-bronx',            // QR28 BRONX
  '118_1974': 'style-1974',        // QR29 1974
  '118': 'style-1974',             // QR29 備援（僅掃到數字時）
  '113': 'style-morri',            // QR30 MORRI
  '106': 'style-young',            // QR34 YOUNG
  '117': 'style-twinsocean',       // QR35 Twins Ocean
  '119': 'style-oloroso',          // QR36 Oloroso
  '430': 'style-economy',          // QR41 樂活經濟學
  '429': 'style-brand',            // QR44 品牌框
  '566': 'style-gothic',           // QR47 Gothic

  // --- 太陽眼鏡 ---
  '127': 'sun-women',              // QR38 太陽-仕女
  '427': 'sun-clip',               // QR39 太陽-套鏡
  '428': 'sun-sport',              // QR40 太陽-運動
  '454': 'sun-kids',               // QR49 兒童太陽

  // --- 功能 / 族群 ---
  '417': 'func-browline',          // QR25 塑膠+金屬(方型)_眉型
  '420': 'func-business-full',     // QR31 商務全框
  '421': 'func-kids',              // QR32 兒童眼鏡(各式)
  '422': 'func-largesize',         // QR33 特殊尺碼眼鏡(各式)
  '423': 'func-special',           // QR42 特殊眼鏡(各式)
  '424': 'func-doublebridge',      // QR43 雙槓眼鏡(各式)
  '474': 'func-rimless',           // QR50 無邊框
};

/* ---------- 2. 族群定義 ---------- */
const FRAME_GROUPS = [
  { key:'mat',   icon:'fa-solid fa-shapes',              label:'材質 × 形狀', desc:'依製作材質與外框輪廓分類，決定重量、質感與耐用度。' },
  { key:'style', icon:'fa-solid fa-wand-magic-sparkles', label:'風格系列',    desc:'樂活自有設計系列，各有鮮明個性與設計主題。' },
  { key:'sun',   icon:'fa-solid fa-sun',                 label:'太陽眼鏡',    desc:'防護紫外線，兼顧造型與戶外機能。' },
  { key:'func',  icon:'fa-solid fa-user-group',          label:'功能 / 族群', desc:'依使用需求、年齡與特殊尺碼挑選。' },
];

/* ---------- 3. 鏡框分類資料 ----------
   icon: 純 SVG 線稿（不依賴圖檔）
   face / scene / material: 知識欄位
   products: 對應商品（靜態佔位，待 ERP API 接入） */
const FRAME_ITEMS = [
  /* ===== 材質 × 形狀 ===== */
  { code:'mat-combo-round', group:'mat', name:'複合材質 · 圓框', en:'Combo Round',
    desc:'金屬與塑膠結合的圓形框，前框板材保有色彩、腳架金屬減輕重量。',
    tag:'混搭人氣', icon:'round',
    face:['方形臉','長形臉','菱形臉'], scene:['日常休閒','文青藝文','學生穿搭'],
    material:['板材 + 金屬','塑膠 + 不鏽鋼'],
    products:[{name:'複合眼鏡',series:'光學眼鏡',tag:'圓框・板材金屬',url:'https://www.lohaseyewear.com/product/list/47'}] },

  { code:'mat-combo-square', group:'mat', name:'複合材質 · 方框', en:'Combo Square',
    desc:'方形複合框，剛硬線條配上金屬腳架，商務與個性感兼具。',
    tag:'最多人選', icon:'square',
    face:['橢圓臉','圓臉','心形臉'], scene:['辦公商務','日常穿搭','休閒出遊'],
    material:['板材 + 金屬','TR-90 + 金屬'],
    products:[
      {name:'複合眼鏡',series:'光學眼鏡',tag:'方框・板材金屬',url:'https://www.lohaseyewear.com/product/list/47'},
      {name:'粗框眼鏡',series:'光學眼鏡',tag:'方框・TR-90',url:'https://www.lohaseyewear.com/product/list/46'}] },

  { code:'mat-combo-poly', group:'mat', name:'複合材質 · 多角框', en:'Combo Polygon',
    desc:'六角、八角等多邊形輪廓，個性強烈的複合材質選擇。',
    tag:'個性首選', icon:'poly',
    face:['橢圓臉','圓臉'], scene:['個性穿搭','拍照造型'],
    material:['板材 + 金屬'],
    products:[{name:'複合眼鏡',series:'光學眼鏡',tag:'多角・板材金屬',url:'https://www.lohaseyewear.com/product/list/47'}] },

  { code:'mat-titan-round', group:'mat', name:'鈦合金 · 圓框', en:'Titanium Round',
    desc:'純鈦圓框，極輕且抗過敏，長時間配戴幾乎無壓迫感。',
    tag:'輕量抗敏', icon:'round-thin',
    face:['方形臉','長形臉'], scene:['商務辦公','日常通勤'],
    material:['純鈦','β-鈦'],
    products:[{name:'金屬眼鏡',series:'光學眼鏡',tag:'圓框・純鈦',url:'https://www.lohaseyewear.com/product/list/45'}] },

  { code:'mat-titan-square', group:'mat', name:'鈦合金 · 方框', en:'Titanium Square',
    desc:'鈦金屬方框，輕量卻強韌，簡潔俐落的專業形象。',
    tag:'商務首選', icon:'square-thin',
    face:['橢圓臉','圓臉'], scene:['商務辦公','正式場合'],
    material:['純鈦','β-鈦'],
    products:[{name:'金屬眼鏡',series:'光學眼鏡',tag:'方框・純鈦',url:'https://www.lohaseyewear.com/product/list/45'}] },

  { code:'mat-titan-poly', group:'mat', name:'鈦合金 · 多角框', en:'Titanium Polygon',
    desc:'多邊形鈦框，兼顧極輕重量與獨特造型。',
    tag:'輕量個性', icon:'poly-thin',
    face:['橢圓臉','圓臉'], scene:['個性穿搭','日常通勤'],
    material:['純鈦'],
    products:[{name:'金屬眼鏡',series:'光學眼鏡',tag:'多角・純鈦',url:'https://www.lohaseyewear.com/product/list/45'}] },

  { code:'mat-memory-round', group:'mat', name:'記憶合金 · 圓框', en:'Memory Alloy Round',
    desc:'記憶合金圓框，可彎折自動回彈，不易變形，耐操好照顧。',
    tag:'高彈性', icon:'round-thin',
    face:['方形臉','長形臉'], scene:['日常通勤','戶外活動'],
    material:['記憶合金（NT合金）'],
    products:[{name:'金屬眼鏡',series:'光學眼鏡',tag:'圓框・記憶合金',url:'https://www.lohaseyewear.com/product/list/45'}] },

  { code:'mat-memory-square', group:'mat', name:'記憶合金 · 方框', en:'Memory Alloy Square',
    desc:'方形記憶合金框，形狀穩定又能承受擠壓，通勤族好夥伴。',
    tag:'耐用抗折', icon:'square-thin',
    face:['橢圓臉','圓臉'], scene:['日常通勤','辦公商務'],
    material:['記憶合金（NT合金）'],
    products:[{name:'金屬眼鏡',series:'光學眼鏡',tag:'方框・記憶合金',url:'https://www.lohaseyewear.com/product/list/45'}] },

  { code:'mat-memory-rect', group:'mat', name:'記憶合金 · 長方框', en:'Memory Alloy Rectangle',
    desc:'橫向拉長的長方框型，視覺上讓臉部比例更短更協調。',
    tag:'修飾長臉', icon:'rect-thin',
    face:['長形臉','橢圓臉'], scene:['辦公商務','日常通勤'],
    material:['記憶合金（NT合金）'],
    products:[{name:'金屬眼鏡',series:'光學眼鏡',tag:'長方・記憶合金',url:'https://www.lohaseyewear.com/product/list/45'}] },

  { code:'mat-memory-poly', group:'mat', name:'記憶合金 · 多角框', en:'Memory Alloy Polygon',
    desc:'多邊形記憶合金框，造型突出同時保有回彈韌性。',
    tag:'造型耐折', icon:'poly-thin',
    face:['橢圓臉','圓臉'], scene:['個性穿搭','日常通勤'],
    material:['記憶合金（NT合金）'],
    products:[{name:'金屬眼鏡',series:'光學眼鏡',tag:'多角・記憶合金',url:'https://www.lohaseyewear.com/product/list/45'}] },

  { code:'mat-plastic-pad-round', group:'mat', name:'塑膠有鼻墊 · 圓框', en:'Plastic w/ Pads, Round',
    desc:'附鼻墊的塑膠圓框，可微調高度，改善下滑與壓痕問題。',
    tag:'可調鼻墊', icon:'round-pad',
    face:['方形臉','長形臉'], scene:['日常休閒','文青藝文'],
    material:['板材（Acetate）','TR-90'],
    products:[{name:'粗框眼鏡',series:'光學眼鏡',tag:'圓框・有鼻墊',url:'https://www.lohaseyewear.com/product/list/46'}] },

  { code:'mat-plastic-pad-square', group:'mat', name:'塑膠有鼻墊 · 方框', en:'Plastic w/ Pads, Square',
    desc:'附鼻墊的塑膠方框，兼具板材厚實感與配戴穩定度。',
    tag:'穩定不滑', icon:'square-pad',
    face:['橢圓臉','圓臉','心形臉'], scene:['日常穿搭','辦公商務'],
    material:['板材（Acetate）','TR-90'],
    products:[{name:'粗框眼鏡',series:'光學眼鏡',tag:'方框・有鼻墊',url:'https://www.lohaseyewear.com/product/list/46'}] },

  { code:'mat-plastic-nopad-round', group:'mat', name:'塑膠無鼻墊 · 圓框', en:'Plastic One-piece, Round',
    desc:'一體成形無鼻墊圓框，線條乾淨、清潔方便，經典復古款。',
    tag:'復古一體', icon:'round',
    face:['方形臉','長形臉'], scene:['文青藝文','日常休閒'],
    material:['板材（Acetate）'],
    products:[{name:'粗框眼鏡',series:'光學眼鏡',tag:'圓框・一體成形',url:'https://www.lohaseyewear.com/product/list/46'}] },

  { code:'mat-plastic-nopad-square', group:'mat', name:'塑膠無鼻墊 · 方框', en:'Plastic One-piece, Square',
    desc:'一體成形無鼻墊方框，厚實有型，是板材眼鏡的代表款。',
    tag:'板材經典', icon:'square',
    face:['橢圓臉','圓臉','心形臉'], scene:['日常穿搭','個性造型'],
    material:['板材（Acetate）'],
    products:[{name:'粗框眼鏡',series:'光學眼鏡',tag:'方框・一體成形',url:'https://www.lohaseyewear.com/product/list/46'}] },

  { code:'mat-alloy-square', group:'mat', name:'金屬合金 · 正方框', en:'Alloy Square',
    desc:'正方形金屬合金框，接近 1:1 比例，復古中帶點前衛。',
    tag:'復古前衛', icon:'square-thin',
    face:['橢圓臉','長形臉'], scene:['個性穿搭','拍照造型'],
    material:['金屬合金','不鏽鋼'],
    products:[{name:'金屬眼鏡',series:'光學眼鏡',tag:'正方・金屬合金',url:'https://www.lohaseyewear.com/product/list/45'}] },

  { code:'mat-clear', group:'mat', name:'透明框', en:'Clear Frame',
    desc:'透明板材框，存在感低又不失造型，百搭且顯膚色乾淨。',
    tag:'百搭透明', icon:'square-clear',
    face:['各種臉型'], scene:['日常穿搭','拍照造型','辦公商務'],
    material:['透明板材（Acetate）'],
    products:[{name:'透明框眼鏡',series:'光學眼鏡',tag:'方框・透明板材',url:'https://www.lohaseyewear.com/product/list/49'}] },

  { code:'mat-almgti', group:'mat', name:'鋁鎂鈦', en:'Al-Mg-Ti Alloy',
    desc:'鋁鎂鈦合金框，密度低、重量極輕，帶金屬光澤與現代感。',
    tag:'極輕合金', icon:'square-thin',
    face:['各種臉型'], scene:['商務辦公','日常通勤'],
    material:['鋁鎂合金','鈦'],
    products:[{name:'金屬眼鏡',series:'光學眼鏡',tag:'鋁鎂鈦',url:'https://www.lohaseyewear.com/product/list/45'}] },

  /* ===== 風格系列 ===== */
  { code:'style-meilin', group:'style', name:'Měi Lin｜男神眼鏡', en:'Měi Lin',
    desc:'俐落線條打造沉穩男性魅力，圓潤與眉線並存的設計語彙。',
    tag:'風格系列', icon:'browline',
    face:['橢圓臉','方形臉'], scene:['日常穿搭','約會出遊'],
    material:['金屬','複合材質'],
    products:[{name:'Měi Lin｜男神眼鏡',series:'風格系列',tag:'眉框・金屬',url:'https://www.lohaseyewear.com/product/list/51'}] },

  { code:'style-takumi', group:'style', name:'TAKUMI｜工藝眼鏡', en:'TAKUMI',
    desc:'職人工藝取向，細膩打磨的金屬結構，追求精準與耐久。',
    tag:'工藝系列', icon:'square-thin',
    face:['各種臉型'], scene:['商務辦公','正式場合'],
    material:['純鈦','金屬'],
    products:[{name:'TAKUMI｜工藝眼鏡',series:'風格系列',tag:'金屬・純鈦',url:'https://www.lohaseyewear.com/product/list/58'}] },

  { code:'style-seasar', group:'style', name:'時祤｜圓框眼鏡', en:'Seasar',
    desc:'柔和圓框搭配溫潤配色，文青氣息與日常感兼具。',
    tag:'文青圓框', icon:'round',
    face:['方形臉','長形臉'], scene:['日常休閒','文青藝文'],
    material:['板材（Acetate）'],
    products:[{name:'時祤｜圓框眼鏡',series:'風格系列',tag:'圓框・板材',url:'https://www.lohaseyewear.com/product/list/50'}] },

  { code:'style-lady-oval', group:'style', name:'金屬橢圓｜淑女款', en:'Lady Oval',
    desc:'細金屬橢圓框，線條輕柔優雅，襯托溫婉氣質。',
    tag:'優雅淑女', icon:'round-thin',
    face:['方形臉','菱形臉'], scene:['日常穿搭','正式場合'],
    material:['金屬','純鈦'],
    products:[{name:'金屬眼鏡',series:'光學眼鏡',tag:'橢圓・金屬',url:'https://www.lohaseyewear.com/product/list/45'}] },

  { code:'style-w', group:'style', name:'W｜商務眼鏡', en:'W Series',
    desc:'商務導向設計，沉穩配色與方正框型，建立專業第一印象。',
    tag:'商務系列', icon:'square',
    face:['橢圓臉','圓臉'], scene:['商務辦公','正式場合'],
    material:['金屬板材複合'],
    products:[{name:'W｜商務眼鏡',series:'風格系列',tag:'方框・金屬板材',url:'https://www.lohaseyewear.com/product/list/55'}] },

  { code:'style-theblock', group:'style', name:'THE BLOCK', en:'THE BLOCK',
    desc:'塊狀厚實框型，強調體積與存在感的街頭風格。',
    tag:'街頭厚框', icon:'square',
    face:['橢圓臉','長形臉'], scene:['個性穿搭','街頭風格'],
    material:['板材（Acetate）'],
    products:[{name:'THE BLOCK',series:'風格系列',tag:'粗框・板材',url:'https://www.lohaseyewear.com/product/list/116'}] },

  { code:'style-bronx', group:'style', name:'BRONX｜嘻哈眼鏡', en:'BRONX',
    desc:'取材紐約街頭嘻哈文化，大膽輪廓與粗框比例。',
    tag:'嘻哈街頭', icon:'square',
    face:['橢圓臉','長形臉'], scene:['個性穿搭','街頭風格'],
    material:['板材（Acetate）'],
    products:[{name:'BRONX｜嘻哈眼鏡',series:'風格系列',tag:'粗框・板材',url:'https://www.lohaseyewear.com/product/list/56'}] },

  { code:'style-1974', group:'style', name:'1974｜美式復古', en:'1974',
    desc:'重現七〇年代美式輪廓，微翹框角與復古配色。',
    tag:'美式復古', icon:'round',
    face:['方形臉','長形臉'], scene:['文青藝文','日常休閒'],
    material:['板材（Acetate）'],
    products:[{name:'1974｜美式復古',series:'風格系列',tag:'圓框・板材',url:'https://www.lohaseyewear.com/product/list/53'}] },

  { code:'style-morri', group:'style', name:'MORRI', en:'MORRI',
    desc:'簡約現代設計語言，去除多餘裝飾的純粹造型。',
    tag:'簡約現代', icon:'square-thin',
    face:['各種臉型'], scene:['日常穿搭','辦公商務'],
    material:['金屬','複合材質'],
    products:[{name:'MORRI',series:'風格系列',tag:'簡約・複合',url:'https://www.lohaseyewear.com/product/list/113'}] },

  { code:'style-young', group:'style', name:'YOUNG｜輕熟款', en:'YOUNG',
    desc:'介於學生與職場之間的輕熟比例，日常好搭不出錯。',
    tag:'輕熟百搭', icon:'square',
    face:['橢圓臉','圓臉','心形臉'], scene:['日常穿搭','初入職場'],
    material:['複合材質','板材'],
    products:[{name:'YOUNG｜輕熟款',series:'風格系列',tag:'方框・複合',url:'https://www.lohaseyewear.com/product/list/59'}] },

  { code:'style-twinsocean', group:'style', name:'Twins Ocean｜兩用眼鏡', en:'Twins Ocean',
    desc:'一副兩用，可切換日常光學與戶外遮陽，雙槓造型加分。',
    tag:'兩用機能', icon:'dual',
    face:['橢圓臉','長形臉'], scene:['戶外出遊','日常通勤'],
    material:['複合材質','金屬'],
    products:[{name:'Twins Ocean｜兩用眼鏡',series:'風格系列',tag:'雙槓・複合',url:'https://www.lohaseyewear.com/product/list/54'}] },

  { code:'style-oloroso', group:'style', name:'Oloroso', en:'Oloroso',
    desc:'取名自雪莉酒風味，溫暖琥珀色系與圓潤線條。',
    tag:'琥珀溫潤', icon:'round',
    face:['方形臉','長形臉'], scene:['日常休閒','文青藝文'],
    material:['板材（Acetate）'],
    products:[{name:'Oloroso',series:'風格系列',tag:'圓框・板材',url:'https://www.lohaseyewear.com/product/list/119'}] },

  { code:'style-economy', group:'style', name:'樂活經濟學', en:'LOHAS Economy',
    desc:'高性價比入門系列，兼顧品質與預算的實用選擇。',
    tag:'高性價比', icon:'square',
    face:['各種臉型'], scene:['日常穿搭','學生首購'],
    material:['TR-90','板材'],
    products:[{name:'樂活經濟學',series:'風格系列',tag:'入門・高性價比',url:'https://www.lohaseyewear.com/product/list/430'}] },

  { code:'style-brand', group:'style', name:'品牌框', en:'Brand Frames',
    desc:'國際品牌授權框型，設計語言與品牌識別完整呈現。',
    tag:'品牌授權', icon:'square-thin',
    face:['各種臉型'], scene:['正式場合','送禮'],
    material:['依品牌而異'],
    products:[{name:'品牌框',series:'品牌系列',tag:'國際品牌',url:'https://www.lohaseyewear.com/product/list/429'}] },

  { code:'style-gothic', group:'style', name:'Gothic', en:'Gothic',
    desc:'哥德風格框型，深色調與硬派輪廓，個性強烈。',
    tag:'哥德個性', icon:'square',
    face:['橢圓臉','長形臉'], scene:['個性穿搭','拍照造型'],
    material:['板材（Acetate）','金屬'],
    products:[{name:'Gothic',series:'風格系列',tag:'個性・板材',url:'https://www.lohaseyewear.com/product/list/566'}] },

  /* ===== 太陽眼鏡 ===== */
  { code:'sun-men', group:'sun', name:'太陽眼鏡｜型男', en:'Sunglasses for Men',
    desc:'俐落大框與深色鏡片，強調輪廓的男性化太陽眼鏡。',
    tag:'型男首選', icon:'sun-square',
    face:['橢圓臉','圓臉'], scene:['戶外出遊','駕車'],
    material:['板材','金屬'],
    products:[{name:'太陽眼鏡｜型男',series:'太陽眼鏡',tag:'各式・深色鏡片',url:'https://www.lohaseyewear.com/product/list/126'}] },

  { code:'sun-women', group:'sun', name:'太陽眼鏡｜仕女', en:'Sunglasses for Women',
    desc:'柔和框型與時尚配色，兼顧防曬與造型的女性款。',
    tag:'時尚仕女', icon:'sun-round',
    face:['方形臉','菱形臉'], scene:['戶外出遊','度假'],
    material:['板材','金屬'],
    products:[{name:'太陽眼鏡｜仕女',series:'太陽眼鏡',tag:'各式・時尚配色',url:'https://www.lohaseyewear.com/product/list/127'}] },

  { code:'sun-clip', group:'sun', name:'太陽眼鏡｜套鏡', en:'Clip-on Sunglasses',
    desc:'夾式／磁吸套鏡，直接扣在原有近視框上，一副兩用不用換。',
    tag:'近視族適用', icon:'sun-clip',
    face:['依原框而定'], scene:['戶外出遊','駕車','通勤'],
    material:['金屬夾具','偏光鏡片'],
    products:[{name:'太陽眼鏡｜套鏡',series:'太陽眼鏡',tag:'夾式・磁吸',url:'https://www.lohaseyewear.com/product/list/427'}] },

  { code:'sun-sport', group:'sun', name:'太陽眼鏡｜運動', en:'Sport Sunglasses',
    desc:'包覆式運動框，貼合臉型不易滑落，搭配防眩光鏡片。',
    tag:'運動機能', icon:'sun-sport',
    face:['各種臉型'], scene:['跑步騎行','球類運動','登山'],
    material:['TR-90','PC 鏡片'],
    products:[{name:'太陽眼鏡｜運動',series:'太陽眼鏡',tag:'包覆・防眩光',url:'https://www.lohaseyewear.com/product/list/428'}] },

  { code:'sun-kids', group:'sun', name:'兒童太陽眼鏡', en:'Kids Sunglasses',
    desc:'兒童專用太陽眼鏡，輕量安全材質，保護發育中的眼睛。',
    tag:'兒童專用', icon:'sun-round',
    face:['兒童臉型'], scene:['戶外活動','海邊','旅遊'],
    material:['TR-90','矽膠鼻墊'],
    products:[{name:'兒童太陽眼鏡',series:'太陽眼鏡',tag:'兒童・輕量安全',url:'https://www.lohaseyewear.com/product/list/454'}] },

  /* ===== 功能 / 族群 ===== */
  { code:'func-browline', group:'func', name:'眉框眼鏡', en:'Browline',
    desc:'上框粗、下框細（或半框），沿著眉線走，有型且立體。',
    tag:'強調眉線', icon:'browline',
    face:['橢圓臉','方形臉','心形臉'], scene:['個性穿搭','日常休閒'],
    material:['塑膠 + 金屬','板材'],
    products:[{name:'眉框眼鏡',series:'光學眼鏡',tag:'眉框・複合',url:'https://www.lohaseyewear.com/product/list/48'}] },

  { code:'func-business-full', group:'func', name:'商務全框', en:'Business Full-rim',
    desc:'完整包覆鏡片的全框設計，穩固耐用，適合長時間辦公。',
    tag:'穩固耐用', icon:'square',
    face:['各種臉型'], scene:['商務辦公','正式會議'],
    material:['金屬','板材','複合材質'],
    products:[{name:'商務全框',series:'光學眼鏡',tag:'全框・商務',url:'https://www.lohaseyewear.com/product/list/420'}] },

  { code:'func-business', group:'func', name:'商務眼鏡', en:'Business Frames',
    desc:'商務場合適用的低調框型，深色系與細金屬為主。',
    tag:'專業低調', icon:'square-thin',
    face:['各種臉型'], scene:['商務辦公','正式場合','商務談判'],
    material:['純鈦','金屬','複合材質'],
    products:[{name:'商務眼鏡',series:'光學眼鏡',tag:'商務・低調',url:'https://www.lohaseyewear.com/product/list/48'}] },

  { code:'func-kids', group:'func', name:'兒童眼鏡', en:'Kids Frames',
    desc:'兒童專用框，輕量高彈性材質，耐衝擊、耐摔耐折。',
    tag:'安全首選', icon:'round-pad',
    face:['兒童臉型'], scene:['上學','戶外活動'],
    material:['TR-90','矽膠鼻墊'],
    products:[{name:'兒童眼鏡',series:'光學眼鏡',tag:'兒童・TR-90',url:'https://www.lohaseyewear.com/product/list/421'}] },

  { code:'func-largesize', group:'func', name:'特殊尺碼眼鏡', en:'Large / Special Size',
    desc:'加大或加小尺碼框型，為臉寬較寬或較窄者提供合適選擇。',
    tag:'加大加小', icon:'rect-thin',
    face:['臉寬偏寬','臉寬偏窄'], scene:['日常穿搭','辦公商務'],
    material:['板材','金屬','TR-90'],
    products:[{name:'特殊尺碼眼鏡',series:'光學眼鏡',tag:'加大・加小',url:'https://www.lohaseyewear.com/product/list/422'}] },

  { code:'func-special', group:'func', name:'特殊眼鏡', en:'Special Purpose',
    desc:'各式特殊用途框型，如老花、防藍光、工作護目等需求。',
    tag:'特殊用途', icon:'square-thin',
    face:['各種臉型'], scene:['閱讀','電腦工作','特殊職業'],
    material:['依用途而異'],
    products:[{name:'特殊眼鏡',series:'光學眼鏡',tag:'各式・特殊用途',url:'https://www.lohaseyewear.com/product/list/423'}] },

  { code:'func-doublebridge', group:'func', name:'雙槓眼鏡', en:'Double Bridge',
    desc:'鼻樑上方多一道橫槓的雙橋設計，立體層次與歐美復古感。',
    tag:'復古歐美', icon:'dual',
    face:['橢圓臉','長形臉'], scene:['個性穿搭','歐美街頭'],
    material:['金屬','不鏽鋼'],
    products:[{name:'雙槓眼鏡',series:'光學眼鏡',tag:'雙橋・金屬',url:'https://www.lohaseyewear.com/product/list/292'}] },

  { code:'func-rimless', group:'func', name:'無邊框眼鏡', en:'Rimless',
    desc:'鏡片直接鎖上腳架，沒有外框包覆，輕薄若無最低存在感。',
    tag:'超輕量', icon:'rimless',
    face:['商務型男','中高齡','淡妝偏好'], scene:['正式會議','商務談判'],
    material:['純鈦','β-鈦'],
    products:[{name:'無邊框眼鏡',series:'光學眼鏡',tag:'無框・純鈦',url:'https://www.lohaseyewear.com/product/list/474'}] },
];

/* ---------- 4. SVG 線稿圖庫 ---------- */
const FRAME_ICONS = {
  square:      '<rect x="4" y="6" width="56" height="30" rx="4" stroke="currentColor" stroke-width="3" fill="none"/>',
  'square-thin':'<rect x="5" y="8" width="54" height="26" rx="4" stroke="currentColor" stroke-width="1.6" fill="none"/><line x1="5" y1="21" x2="1" y2="15" stroke="currentColor" stroke-width="1.6"/><line x1="59" y1="21" x2="63" y2="15" stroke="currentColor" stroke-width="1.6"/>',
  'square-pad': '<rect x="4" y="6" width="56" height="30" rx="4" stroke="currentColor" stroke-width="2.6" fill="none"/><path d="M29 18 L32 26 L35 18" stroke="currentColor" stroke-width="1.6" fill="none"/>',
  'square-clear':'<rect x="4" y="6" width="56" height="30" rx="4" stroke="currentColor" stroke-width="2.6" fill="none" opacity="0.4"/><rect x="9" y="11" width="46" height="20" rx="3" fill="currentColor" opacity="0.06"/>',
  round:       '<ellipse cx="32" cy="21" rx="27" ry="15" stroke="currentColor" stroke-width="3" fill="none"/>',
  'round-thin':'<ellipse cx="32" cy="21" rx="26" ry="13" stroke="currentColor" stroke-width="1.6" fill="none"/><line x1="6" y1="21" x2="1" y2="15" stroke="currentColor" stroke-width="1.6"/><line x1="58" y1="21" x2="63" y2="15" stroke="currentColor" stroke-width="1.6"/>',
  'round-pad': '<ellipse cx="32" cy="21" rx="27" ry="15" stroke="currentColor" stroke-width="2.6" fill="none"/><path d="M29 18 L32 26 L35 18" stroke="currentColor" stroke-width="1.6" fill="none"/>',
  'rect-thin': '<rect x="2" y="10" width="60" height="22" rx="3" stroke="currentColor" stroke-width="1.8" fill="none"/>',
  poly:        '<path d="M10 10 L54 10 L60 21 L54 33 L10 33 L4 21 Z" stroke="currentColor" stroke-width="3" fill="none"/>',
  'poly-thin': '<path d="M11 11 L53 11 L59 21 L53 32 L11 32 L5 21 Z" stroke="currentColor" stroke-width="1.6" fill="none"/>',
  browline:    '<rect x="4" y="5" width="56" height="12" rx="3" fill="currentColor" opacity="0.85"/><path d="M8 17 Q8 36 32 36 Q56 36 56 17" stroke="currentColor" stroke-width="2.6" fill="none"/>',
  dual:        '<rect x="5" y="9" width="54" height="24" rx="8" stroke="currentColor" stroke-width="2.6" fill="none"/><line x1="21" y1="9" x2="21" y2="33" stroke="currentColor" stroke-width="1.8"/><line x1="43" y1="9" x2="43" y2="33" stroke="currentColor" stroke-width="1.8"/><line x1="24" y1="14" x2="40" y2="14" stroke="currentColor" stroke-width="1.6"/>',
  rimless:     '<ellipse cx="19" cy="21" rx="15" ry="11" stroke="currentColor" stroke-width="1.4" fill="none" stroke-dasharray="3 2.5"/><ellipse cx="45" cy="21" rx="15" ry="11" stroke="currentColor" stroke-width="1.4" fill="none" stroke-dasharray="3 2.5"/><line x1="34" y1="21" x2="30" y2="21" stroke="currentColor" stroke-width="1.6"/>',
  'sun-square':'<rect x="4" y="6" width="56" height="30" rx="5" stroke="currentColor" stroke-width="2.6" fill="currentColor" fill-opacity="0.5"/><line x1="32" y1="6" x2="32" y2="36" stroke="var(--bg-warm,#F9F8F6)" stroke-width="2.6"/>',
  'sun-round': '<ellipse cx="32" cy="21" rx="27" ry="15" stroke="currentColor" stroke-width="2.6" fill="currentColor" fill-opacity="0.5"/><line x1="32" y1="7" x2="32" y2="35" stroke="var(--bg-warm,#F9F8F6)" stroke-width="2.6"/>',
  'sun-clip':  '<rect x="4" y="8" width="56" height="26" rx="4" stroke="currentColor" stroke-width="1.8" fill="none"/><rect x="8" y="12" width="48" height="18" rx="3" fill="currentColor" fill-opacity="0.45"/><path d="M26 8 L26 4 M38 8 L38 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  'sun-sport': '<path d="M4 14 Q32 4 60 14 L58 28 Q32 38 6 28 Z" stroke="currentColor" stroke-width="2.4" fill="currentColor" fill-opacity="0.45"/>',
};

/* ---------- 5. 引導入口與篩選軸定義 ----------
   對應首頁三入口：看臉型 / 看材質 / 看風格
   rail 有三種模式，點入口即切換左側篩選軸內容。 */
const FRAME_ENTRIES = [
  { key:'category', icon:'fa-solid fa-table-cells-large', label:'看分類', hint:'依族群瀏覽全部' },
  { key:'face',     icon:'fa-regular fa-face-smile',      label:'看臉型', hint:'不確定適合什麼' },
  { key:'material', icon:'fa-solid fa-gem',               label:'看材質', hint:'在意輕重與觸感' },
];

/* 臉型篩選：以關鍵字比對 FRAME_ITEMS[].face
   「各種臉型」視為全部符合，任何臉型篩選都會命中。 */
const FRAME_FACE_FILTERS = [
  { key:'oval',    label:'橢圓臉', shape:'oval',    match:['橢圓臉'] },
  { key:'round',   label:'圓臉',   shape:'round',   match:['圓臉'] },
  { key:'square',  label:'方形臉', shape:'square',  match:['方形臉'] },
  { key:'long',    label:'長形臉', shape:'long',    match:['長形臉'] },
  { key:'heart',   label:'心形臉', shape:'heart',   match:['心形臉'] },
  { key:'diamond', label:'菱形臉', shape:'diamond', match:['菱形臉'] },
];

/* 臉型輪廓 SVG（viewBox 0 0 24 28） */
const FACE_SHAPES = {
  oval:    '<ellipse cx="12" cy="14" rx="8" ry="11" stroke="currentColor" stroke-width="1.8" fill="none"/>',
  round:   '<circle cx="12" cy="14" r="9.5" stroke="currentColor" stroke-width="1.8" fill="none"/>',
  square:  '<rect x="3.5" y="4.5" width="17" height="19" rx="4.5" stroke="currentColor" stroke-width="1.8" fill="none"/>',
  long:    '<rect x="5" y="2.5" width="14" height="23" rx="7" stroke="currentColor" stroke-width="1.8" fill="none"/>',
  heart:   '<path d="M12 25 C6 20 3.5 15 3.5 10 C3.5 5.5 7 3 12 3 C17 3 20.5 5.5 20.5 10 C20.5 15 18 20 12 25 Z" stroke="currentColor" stroke-width="1.8" fill="none"/>',
  diamond: '<path d="M12 2.5 L20 14 L12 25.5 L4 14 Z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/>',
};

/* 材質篩選：以關鍵字比對 FRAME_ITEMS[].material */
const FRAME_MATERIAL_FILTERS = [
  { key:'acetate', icon:'fa-solid fa-layer-group',       label:'板材',     match:['板材'] },
  { key:'titan',   icon:'fa-solid fa-feather-pointed',   label:'鈦金屬',   match:['純鈦','β-鈦','鈦'] },
  { key:'metal',   icon:'fa-solid fa-ring',              label:'金屬',     match:['金屬','不鏽鋼'] },
  { key:'memory',  icon:'fa-solid fa-arrows-rotate',     label:'記憶合金', match:['記憶合金'] },
  { key:'tr90',    icon:'fa-solid fa-bolt',              label:'TR-90',    match:['TR-90'] },
  { key:'combo',   icon:'fa-solid fa-object-group',      label:'複合材質', match:['複合材質','+'] },
];

/* 判斷單一 item 是否命中某篩選條件 */
function frameMatches(item, mode, key) {
  if (!key) return true;
  if (mode === 'category') return item.group === key;

  if (mode === 'face') {
    var f = FRAME_FACE_FILTERS.filter(function (x) { return x.key === key; })[0];
    if (!f) return true;
    var list = item.face || [];
    // 「各種臉型」為通用款，任何臉型都適合
    if (list.some(function (v) { return v.indexOf('各種臉型') > -1; })) return true;
    return list.some(function (v) {
      return f.match.some(function (m) { return v.indexOf(m) > -1; });
    });
  }

  if (mode === 'material') {
    var g = FRAME_MATERIAL_FILTERS.filter(function (x) { return x.key === key; })[0];
    if (!g) return true;
    return (item.material || []).some(function (v) {
      return g.match.some(function (m) { return v.indexOf(m) > -1; });
    });
  }
  return true;
}
