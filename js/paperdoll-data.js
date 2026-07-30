// paperdoll-data.js — 客製眼鏡測試資料
// v1.2 | 台灣百工計畫 + 刻圖市集同步 | 眼鏡與配件仍為測試資料

const PD_DATA = {

  /* ── 台灣百工計畫 ──
     八大工藝聚落。配件透過 craft 欄位對應到此表。 */
  crafts: {
    paper: {
      id:'paper', em:'📜', name:'廣興紙寮', region:'南投埔里', since:'1965',
      intro:'埔里四面環山，擁有純淨穩定的山泉水，日治時期起便成為台灣最重要的手工紙聚落。',
      craft:'採集植物纖維、蒸煮、打漿、抄紙、壓紙、乾燥，數十道工序凝聚的是職人的耐心，而非機器的速度。',
      spirit:'紙承載的不只是文字，而是一株植物、一座城市、一位職人的時間。',
    },
    wood: {
      id:'wood', em:'🪵', name:'三義木雕', region:'苗栗三義', since:'日治時期',
      intro:'三義因盛產樟樹而發展林業，伐木後留下的樹根與邊材，成為木匠創作的起點。',
      craft:'三義木雕源自珍惜資源、不浪費每一塊木頭的生活智慧。師傅不強迫木頭改變，而是順著木紋，找到作品原本的樣子。',
      spirit:'好的木頭需要時間，好的眼鏡也值得陪伴很長的歲月。',
    },
    ceramic: {
      id:'ceramic', em:'🏺', name:'鶯歌陶瓷', region:'新北鶯歌', since:'19世紀',
      intro:'鶯歌蘊藏優質陶土，加上河運便利，自十九世紀開始發展陶瓷產業，最初燒製的是碗盤茶壺等生活器皿。',
      craft:'一件陶器需要塑形、乾燥、修整、燒製、施釉，再次燒製。每一步都不能急。',
      spirit:'真正耐看的作品，都經得起等待。',
    },
    bamboo: {
      id:'bamboo', em:'🎋', name:'竹山竹藝', region:'南投竹山', since:'清代',
      intro:'竹山擁有豐富竹林，自清代便發展竹工藝。竹子生長快速、堅韌耐用，是最具代表性的天然材料。',
      craft:'早年竹匠利用竹子製作生活用品，也發展出細膩的竹編工藝，一根竹子可以陪伴一輩子。',
      spirit:'最好的設計不一定複雜。就像竹子，看似簡單，卻充滿韌性。',
    },
    indigo: {
      id:'indigo', em:'💙', name:'三峽藍染', region:'新北三峽', since:'清代',
      intro:'三峽曾大量種植馬藍，利用植物染料製作天然藍布，是台灣藍染工藝的重要發源地。',
      craft:'每一塊藍染布都需要反覆浸染與氧化。藍色不是一次完成，而是在等待中慢慢誕生。',
      spirit:'耐看的作品，不是第一眼驚豔，而是越看越有味道。',
    },
    umbrella: {
      id:'umbrella', em:'🌂', name:'美濃紙傘', region:'高雄美濃', since:'客家先民',
      intro:'客家先民將油紙傘技術帶到美濃，當地盛產竹子，加上桐油與手繪技術成熟，形成完整的紙傘聚落。',
      craft:'一把紙傘需要劈竹、削竹、編傘骨、裱紙、上油、彩繪等繁複工序，象徵圓滿、守護與祝福。',
      spirit:'守護視野，如同紙傘守護一家人的晴雨。',
    },
    rush: {
      id:'rush', em:'🌾', name:'苑裡藺草', region:'苗栗苑裡', since:'清代',
      intro:'苑裡擁有適合藺草生長的海風與濕地環境，早年家家戶戶編織草帽草蓆，是台灣重要的外銷產業。',
      craft:'藺草具有天然香氣、透氣、防潮等特性，越使用越柔軟，是從土地長出的天然纖維。',
      spirit:'最好的陪伴，是每天都能感受到自然。',
    },
    joinery: {
      id:'joinery', em:'⚙️', name:'大溪木藝', region:'桃園大溪', since:'清代',
      intro:'大溪因大漢溪木材運輸而興盛，發展出精湛家具工藝，其中最具代表性的就是榫卯結構。',
      craft:'不用一根鐵釘，也能讓家具穩固數十年。這是精準的極致，而非複雜的堆疊。',
      spirit:'真正好的設計，來自精準，而不是複雜。',
    },
  },

  /* ── Step 1 問卷 ── */
  quiz: [
    {
      id: 'lifestyle',
      q: '你的日常是什麼樣子？',
      opts: [
        { val:'cafe',    em:'☕', label:'咖啡廳工作者', desc:'手沖、筆電、一個下午' },
        { val:'outdoor', em:'🏔', label:'戶外探索者',   desc:'爬山、單車、走路上班' },
        { val:'urban',   em:'🏙', label:'都市穿梭者',   desc:'捷運、會議、快節奏' },
        { val:'creator', em:'🎨', label:'創作工作者',   desc:'設計、攝影、手作' },
      ]
    },
    {
      id: 'admire',
      q: '你欣賞哪種人的氣質？',
      opts: [
        { val:'artist',    em:'🎭', label:'藝術家', desc:'把生活過成作品的人' },
        { val:'traveler',  em:'✈️', label:'旅行者', desc:'到處留下足跡的人' },
        { val:'craftsman', em:'🔨', label:'職人',   desc:'把一件事做到極致的人' },
        { val:'scholar',   em:'📖', label:'學者',   desc:'對任何事都好奇的人' },
      ]
    },
    {
      id: 'impression',
      q: '你希望被記住的是哪個樣子？',
      opts: [
        { val:'subtle', em:'🤎', label:'低調有質感', desc:'不張揚，但細節都在' },
        { val:'bold',   em:'✨', label:'大膽有個性', desc:'走進一個房間就被看見' },
        { val:'warm',   em:'🌿', label:'溫暖有故事', desc:'讓人想靠近、想聊天' },
        { val:'sharp',  em:'⚡', label:'俐落有效率', desc:'清晰、直接、可信賴' },
      ]
    },
  ],

  /* ── Step 2 鏡框 ── */
  frames: [
    { id:'f01', em:'🪵', name:'木質方框',     code:'WD-301', price:3200, mat:'wood',    quote:'喜歡在舊書店消磨下午的人，通常會選這個。',           rec:['cafe','creator','warm'] },
    { id:'f02', em:'⭕', name:'金屬細框',     code:'MT-102', price:2800, mat:'metal',   quote:'相信少即是多，但對細節有潔癖的人，通常會選這個。',   rec:['urban','sharp','subtle'] },
    { id:'f03', em:'🟤', name:'玳瑁圓框',     code:'AC-205', price:3600, mat:'acetate', quote:'每次旅行都要去當地小書店的人，通常會選這個。',         rec:['traveler','scholar'] },
    { id:'f04', em:'⬜', name:'TR 輕量框',    code:'TR-410', price:2400, mat:'tr',      quote:'行事曆總是排得很滿，但還是想保持優雅的人，通常會選這個。', rec:['outdoor','urban'] },
    { id:'f05', em:'🔲', name:'粗框板材',     code:'AC-508', price:3900, mat:'acetate', quote:'說話直接，穿搭卻比任何人都有想法的人，通常會選這個。', rec:['bold','creator'] },
    { id:'f06', em:'🥇', name:'復古金屬橢圓', code:'MT-330', price:3100, mat:'metal',   quote:'書架上有二十本以上還沒讀完的書的人，通常會選這個。',   rec:['scholar','traveler'] },
  ],

  /* ── Step 3 刻圖：市集同步設定 ──
     實際刻圖即時從 Supabase engraving_designs 讀取（與 market.html 同源），
     條件 status='approved' 且 is_show='上架'。
     以下 engravingPrice 為刻圖加價，市集資料表無價格欄位，統一由此設定。 */
  engravingConfig: {
    price: 350,   // 刻圖加價（NT$）
    limit: 500,   // 一次載入上限
  },

  /* 市集連線失敗時的備援清單 */
  engravingsFallback: [
    { id:'e01', em:'🌸', name:'小花圖案',  author:'阿偉',        city:'台南・安平',    story:'某個雨天在騎樓下看見路邊野花，就畫了下來。',     series:'自然系', price:350, count:247, total:6, tags:['warm','creator','traveler'] },
    { id:'e02', em:'🌊', name:'海浪線條',  author:'小林工作室',  city:'高雄・鹽埕',    story:'從小在海邊長大，想把海的節奏刻進每一副眼鏡。', series:'自然系', price:350, count:183, total:6, tags:['outdoor','traveler'] },
    { id:'e03', em:'⭐', name:'星群排列',  author:'月球小姐',    city:'台北・大稻埕',  story:'失眠的夜晚把窗外的星空畫成了這個。',           series:'幾何系', price:380, count:312, total:4, tags:['bold','subtle'] },
    { id:'e04', em:'🦋', name:'蝴蝶展翅',  author:'阿偉',        city:'台南・安平',    story:'系列第二作，靈感來自老家院子的紫花。',           series:'自然系', price:350, count:156, total:6, tags:['warm','creator'] },
    { id:'e05', em:'🗺', name:'城市網格',  author:'Ting Studio', city:'台中・審計新村', story:'把最喜歡的城市街道化成線條。',                 series:'城市系', price:400, count:98,  total:5, tags:['urban','scholar','traveler'] },
    { id:'e06', em:'🌿', name:'草葉紋',    author:'綠意設計',    city:'宜蘭・羅東',    story:'農家子弟對土地的一份記憶。',                   series:'自然系', price:350, count:201, total:6, tags:['warm','outdoor'] },
    { id:'e07', em:'✍️', name:'手寫體字',  author:'Ting Studio', city:'台中・審計新村', story:'相信文字是最美的圖案。',                       series:'文字系', price:420, count:445, total:3, tags:['scholar','subtle'] },
    { id:'e08', em:'🔷', name:'幾何拼接',  author:'月球小姐',    city:'台北・大稻埕',  story:'數學之美，刻在眼鏡上。',                         series:'幾何系', price:380, count:267, total:4, tags:['bold','sharp','urban'] },
    { id:'e09', em:'🏔', name:'山脈輪廓',  author:'小林工作室',  city:'高雄・鹽埕',    story:'單車環島時畫的，每一座山都不同。',               series:'城市系', price:400, count:134, total:5, tags:['outdoor','traveler'] },
  ],

  /* ── Step 4 細節 ── */
  details: {
    legColors: [
      { val:'darkbrown', hex:'#3B2A1A', label:'深棕' },
      { val:'wood',      hex:'#8B6340', label:'原木' },
      { val:'black',     hex:'#1A1A1A', label:'黑' },
      { val:'silver',    hex:'#B0B0B0', label:'金屬銀' },
      { val:'rosegold',  hex:'#C48B8B', label:'玫瑰金' },
    ],
    nosePads: ['矽膠（舒適）', '金屬（穩固）', '透明（低調）'],
    screwColors: [
      { val:'gold',   hex:'#B58A42', label:'金色' },
      { val:'silver', hex:'#A0A0A0', label:'銀色' },
      { val:'black',  hex:'#222222', label:'黑色' },
    ],
    lensColors: [
      { val:'clear', hex:'#E8F4FD', label:'透明' },
      { val:'tea',   hex:'#C8A97A', label:'淡茶' },
      { val:'gray',  hex:'#A0A0A0', label:'淡灰' },
      { val:'brown', hex:'#7A5A3A', label:'漸層棕' },
    ],
  },

  /* ── Step 6 配件 ── */
  acc: {
    box: [
      { id:'b01', em:'🪵', name:'黑胡桃木翻蓋盒',   desc:'磁吸閉合，木紋呼應鏡框', price:880,  badge:'命中注定', bt:'brand', matchMat:'wood', craft:'wood' },
      { id:'b02', em:'🤎', name:'深棕植鞣革硬殼盒', desc:'手縫白線，越用越有味道', price:1200 },
      { id:'b03', em:'🌿', name:'楠竹雕花滑蓋盒',   desc:'鏤空花紋蓋，職人手作',   price:750, craft:'bamboo' },
      { id:'b04', em:'🩶', name:'深灰羊毛氈成型盒', desc:'木質按扣，靜音開合',     price:690 },
      { id:'b05', em:'📦', name:'回收紙漿壓模硬盒', desc:'植物染印花，環保材質',   price:420, craft:'paper' },
      { id:'b06', em:'🫙', name:'透明壓克力展示盒', desc:'金屬底座，直接當展示品', price:980 },
      { id:'b07', em:'🟤', name:'赤陶土色皮革對折盒', desc:'內有鏡框固定夾，不晃動', price:860 },
      { id:'b08', em:'🪖', name:'橄欖綠軍風金屬盒', desc:'扣環鎖扣，戶外超耐用',   price:550 },
      { id:'b09', em:'💜', name:'薰衣草紫絨布軟殼盒', desc:'束口繩設計，浪漫氣質', price:390 },
      { id:'b10', em:'🗾', name:'印花和紙包覆硬盒',  desc:'千代紙紋樣，日系職人感', price:640, craft:'paper' },
    ],
    cloth: [
      { id:'c01', em:'🎨', name:'搜點子創作者聯名布', desc:'超細纖維，限量插畫印花', price:280, badge:'搜點子', bt:'warn' },
      { id:'c02', em:'💙', name:'台灣藍染手工布',     desc:'有機棉，每塊紋路都不同', price:380, craft:'indigo' },
      { id:'c03', em:'🌸', name:'刻圖同款印花布',     desc:'和你的刻圖相同圖案',     price:320, badge:'配套', bt:'ok', matchEng:true },
      { id:'c04', em:'🌿', name:'竹纖維漸層布',       desc:'深淺漸層，親膚透氣',     price:220 },
      { id:'c05', em:'✨', name:'燙金幾何麂皮絨布',   desc:'燙金圖騰，擦拭零刮傷',   price:350 },
      { id:'c06', em:'🌸', name:'日本進口桃皮絨',     desc:'霧面細緻，頂級手感',     price:480 },
      { id:'c07', em:'🔷', name:'台灣老花磁磚紋布',   desc:'復古磁磚紋樣，台味十足', price:300 },
      { id:'c08', em:'🐾', name:'小動物刺繡棉布',     desc:'立體刺繡點綴，療癒系',   price:420 },
      { id:'c09', em:'🌂', name:'美濃紙傘紋客家眼鏡布', desc:'油紙傘彩繪紋樣，客家限定', price:460, badge:'台灣百工', bt:'brand', craft:'umbrella' },
    ],
    bag: [
      { id:'g01', em:'🤎', name:'植鞣革束口袋',     desc:'金屬圓環收口，越用越亮',   price:960,  badge:'命中注定', bt:'brand', matchMat:'wood' },
      { id:'g02', em:'🎨', name:'搜點子插畫帆布袋', desc:'絹印圖案，創作者限量款',   price:480,  badge:'搜點子', bt:'warn' },
      { id:'g03', em:'🪵', name:'楠竹編織袋',       desc:'傳統工藝，輕量透氣',       price:620, craft:'bamboo' },
      { id:'g04', em:'💙', name:'蠟染靛藍棉布袋',   desc:'手工蠟染，每件獨一無二',   price:540, craft:'indigo' },
      { id:'g05', em:'🩶', name:'歐洲羊毛氈成型袋', desc:'進口厚氈，完美包覆輪廓',   price:780 },
      { id:'g06', em:'⬜', name:'和紙纖維防潑水袋', desc:'輕如紙，防潑水塗層',       price:360 },
      { id:'g07', em:'🌸', name:'苗族風手工刺繡袋', desc:'手工彩色刺繡，藝術感十足', price:890 },
      { id:'g08', em:'🔵', name:'義大利皮革信封袋', desc:'折疊封口，超薄好帶',       price:1280 },
      { id:'g09', em:'🌾', name:'苑裡藺草束口袋',   desc:'天然香氣，越用越柔軟',     price:680, badge:'台灣百工', bt:'brand', craft:'rush' },
    ],
    stand: [
      { id:'s01', em:'🪵', name:'黑胡桃木橫桿掛架',   desc:'牆掛式，可掛 10 副',     price:2400, badge:'命中注定', bt:'brand', matchMat:'wood', craft:'wood' },
      { id:'s02', em:'✨', name:'手工彎折黃銅管架',   desc:'桌上型，雕塑感造型',     price:3200 },
      { id:'s03', em:'🔲', name:'清水模水泥底座架',   desc:'桌上型，極簡冷調',       price:1800 },
      { id:'s04', em:'⭕', name:'竹編圓形壁掛架',     desc:'牆掛式，傳統工藝',       price:1200, craft:'bamboo' },
      { id:'s05', em:'🔳', name:'壓克力旋轉展示塔',   desc:'360° 旋轉，展示 8 副',   price:2800 },
      { id:'s06', em:'🏺', name:'鶯歌陶瓷眼鏡托',     desc:'手拉坯燒製，一件一個樣',   price:1450, badge:'台灣百工', bt:'brand', craft:'ceramic' },
      { id:'s07', em:'⚙️', name:'大溪榫卯木質展示架', desc:'不用一根鐵釘，穩固數十年', price:3600, badge:'台灣百工', bt:'brand', craft:'joinery' },
    ],
  },
};
