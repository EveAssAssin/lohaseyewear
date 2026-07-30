/* ============================================================
   paperdoll-data.js — 從零開始，打造那副只有我才有的眼鏡
   ------------------------------------------------------------
   v2.0 | 五步重構 · LOHAS FOUND 發現機制
   ------------------------------------------------------------
   資料來源分工：
     鏡框  → js/frames-data.js 的 FRAME_ITEMS（鏡框百科 45 個分類）
     刻圖  → Supabase engraving_designs（與刻圖市集同源，執行期載入）
     配件  → 本檔 found[].products（LOHAS FOUND 城市系列）
   ------------------------------------------------------------
   ⚠️ 尚無實拍照片，城市主視覺以 CSS 色調 + 織理呈現。
      日後補照片只需填 found[].photo，版面結構不需更動。
   ============================================================ */

const PD_DATA = {

  /* ══════════════════════════════════════
     全域設定
  ══════════════════════════════════════ */
  config: {
    engravingPrice:    350,   // 刻圖加價（engraving_designs 無價格欄位）
    engravingLimit:    500,
    engravingPageSize: 12,
    // 鏡框參考價（FRAME_ITEMS 為百科資料，無價格欄位）
    // 待 ERP interface #36 開通後改由 API 帶入實際售價
    framePriceByGroup: { mat:3200, style:3600, sun:2800, func:2600 },
  },

  /* ══════════════════════════════════════
     Step 1 — 臉型（對應 images/face-*.png）
     match 需對齊 FRAME_ITEMS.face
  ══════════════════════════════════════ */
  faces: [
    { key:'oval',    label:'橢圓臉', img:'images/face-oval.png',    match:['橢圓臉'],
      desc:'比例均衡，多數框型都能駕馭。' },
    { key:'round',   label:'圓臉',   img:'images/face-round.png',   match:['圓臉'],
      desc:'輪廓柔和，俐落線條能修飾比例。' },
    { key:'square',  label:'方形臉', img:'images/face-square.png',  match:['方形臉'],
      desc:'下顎線條分明，圓潤框型可柔化角度。' },
    { key:'long',    label:'長形臉', img:'images/face-long.png',    match:['長形臉'],
      desc:'縱向較長，較寬的框能拉出橫向比例。' },
    { key:'heart',   label:'心形臉', img:'images/face-heart.png',   match:['心形臉'],
      desc:'額寬下巴窄，下緣輕盈的框最合適。' },
    { key:'diamond', label:'菱形臉', img:'images/face-diamond.png', match:['菱形臉'],
      desc:'顴骨突出，帶弧度的框能平衡輪廓。' },
  ],

  /* ══════════════════════════════════════
     Step 3 — LOHAS FOUND 城市系列
     ------------------------------------
     status: 'open'    第一季，可購買
             'pending' 尚未前往，護照留白
     敘事三段對齊品牌核心價值：
       discover 發現 / cocreate 共創 / continue 延續
  ══════════════════════════════════════ */
  found: [
    /* ---------- FOUND 001 ---------- */
    {
      id:'paper', no:'001', status:'open', em:'📜',
      city:'南投埔里', name:'廣興紙寮', since:'1965',
      theme:'一張紙，承載一座城。',
      tone:{ base:'#B9A98C', deep:'#6B5C42', light:'#EFE7D6', ink:'#FFFBF2' },
      texture:'fiber',
      discover:{
        title:'埔里的水，養出了紙',
        body:'埔里四面環山，擁有純淨且穩定的山泉水，自日治時期開始便發展造紙產業，逐漸成為台灣最重要的手工紙聚落。1965 年成立的廣興紙寮，見證了這個產業的興衰。當機械製紙逐漸取代手工紙後，廣興紙寮沒有放棄，而是投入文化保存與教育推廣，讓傳統抄紙工藝延續至今。',
      },
      cocreate:{
        title:'一張紙要經過幾雙手',
        intro:'每一張手工紙都需要數十道工序。凝聚的是職人的耐心，而不是機器的速度。',
        steps:[
          { name:'採纖', desc:'採集構樹、雁皮等植物纖維，去皮取內層。' },
          { name:'蒸煮', desc:'長時間蒸煮軟化纖維，去除雜質。' },
          { name:'打漿', desc:'反覆搗打，讓纖維均勻散開成漿。' },
          { name:'抄紙', desc:'竹簾入槽、晃動、提起，厚薄全靠手感。' },
          { name:'壓紙', desc:'層層堆疊擠出水分，不能急也不能重。' },
          { name:'烘乾', desc:'貼上烘牆逐張乾燥，紙面才會平整。' },
        ],
        note:'我們沒有改變抄紙的做法，只是把樂活的故事，交給埔里的紙來承載。',
      },
      spirit:'紙承載的不只是文字。<br>而是一株植物、一座城市、一位職人的時間。',
      products:[
        { id:'p1', type:'box',  em:'📦', name:'手工紙壓模硬盒',   desc:'植物染印花，可完全分解',       price:420 },
        { id:'p2', type:'box',  em:'🗾', name:'和紙包覆收藏盒',   desc:'千代紙紋樣，一盒一個花色',     price:640 },
        { id:'p3', type:'card', em:'📇', name:'手工紙故事卡組',   desc:'含保證卡，抄紙職人親筆落款',   price:280 },
        { id:'p4', type:'box',  em:'🎁', name:'VIP 手工紙禮盒',   desc:'埔里山泉抄紙，送禮專用規格',   price:1280 },
      ],
    },

    /* ---------- FOUND 002 ---------- */
    {
      id:'wood', no:'002', status:'open', em:'🪵',
      city:'苗栗三義', name:'三義木雕', since:'日治時期',
      theme:'時間刻下木紋。',
      tone:{ base:'#6B4A2B', deep:'#3A2716', light:'#C8A87C', ink:'#FFF6E9' },
      texture:'grain',
      discover:{
        title:'從不浪費一塊木頭開始',
        body:'三義因盛產樟樹而發展林業，日治時期更是世界重要的樟腦產地。伐木之後留下的大量樹根、邊材與木塊，成為木匠創作的起點。因此三義木雕並不是因藝術而誕生，而是源自珍惜資源、不浪費每一塊木頭的生活智慧。',
      },
      cocreate:{
        title:'順著木紋，找到它原本的樣子',
        intro:'真正的木雕師傅不是強迫木頭改變，而是順著木紋走。因為每塊木頭的紋路都不同，所以每件作品，都只有一件。',
        steps:[
          { name:'選料', desc:'觀察木紋走向與節疤位置，決定它適合成為什麼。' },
          { name:'粗胚', desc:'鑿出大致輪廓，這一步決定作品的骨架。' },
          { name:'細修', desc:'順著木紋修整，讓線條貼合材料本身。' },
          { name:'打磨', desc:'由粗到細反覆研磨，直到觸感溫潤。' },
          { name:'上油', desc:'植物油養護，木色會隨時間慢慢變深。' },
        ],
        note:'眼鏡盒的開合角度改了七次，只為了讓翻蓋的手感，跟師傅做神桌抽屜時一樣順。',
      },
      spirit:'好的木頭，需要時間。<br>好的眼鏡，也值得陪伴很長的歲月。',
      products:[
        { id:'w1', type:'box',     em:'🪵', name:'黑胡桃木翻蓋盒',   desc:'磁吸閉合，木紋與木質鏡框同源', price:880 },
        { id:'w2', type:'box',     em:'🟤', name:'樟木限量收藏盒',   desc:'三義原生樟木，帶天然香氣',     price:1680 },
        { id:'w3', type:'stand',   em:'🗄', name:'黑胡桃木橫桿掛架', desc:'牆掛式，五支橫桿可掛十副',     price:2400 },
        { id:'w4', type:'service', em:'✍️', name:'雷雕姓名服務',     desc:'木盒側面刻上你的名字',         price:300 },
      ],
    },

    /* ---------- FOUND 003 ---------- */
    {
      id:'ceramic', no:'003', status:'open', em:'🏺',
      city:'新北鶯歌', name:'鶯歌陶瓷', since:'19 世紀',
      theme:'等待，是最好的工藝。',
      tone:{ base:'#9C6A4E', deep:'#573524', light:'#DDB99A', ink:'#FFF4EA' },
      texture:'glaze',
      discover:{
        title:'陶瓷不是藝術品，是生活',
        body:'鶯歌因蘊藏優質陶土，加上大漢溪河運便利，自十九世紀開始發展陶瓷產業。最初燒製的是碗、盤、茶壺、水缸這些生活器皿——陶瓷從來不是為了展示，而是每個家庭每天都會使用的日常用品。經過日治時期的技術改良，鶯歌逐漸成為台灣最大的陶瓷聚落。',
      },
      cocreate:{
        title:'每一步都不能急，急了就裂',
        intro:'一件陶器需要塑形、乾燥、修整、素燒、施釉，再次入窯。窯門關上之後，結果就交給火。',
        steps:[
          { name:'練土', desc:'反覆揉練排出氣泡，否則入窯必炸。' },
          { name:'拉坯', desc:'轆轤成形，厚薄全憑手指的力道。' },
          { name:'修坯', desc:'半乾時削修底足，決定器物的重心。' },
          { name:'素燒', desc:'約 800 度初燒，讓坯體吃得住釉。' },
          { name:'施釉', desc:'浸釉或淋釉，釉層厚薄影響最終發色。' },
          { name:'釉燒', desc:'1200 度以上高溫，窯變的結果無法預測。' },
        ],
        note:'因為窯變無法控制，所以你收到的那只眼鏡托，發色不會跟照片一模一樣。這是缺點，也是它唯一的理由。',
      },
      spirit:'真正耐看的作品，<br>都經得起等待。',
      products:[
        { id:'c1', type:'stand', em:'🏺', name:'陶瓷眼鏡托',     desc:'手拉坯燒製，一件一個樣',     price:1450 },
        { id:'c2', type:'stand', em:'🍶', name:'釉燒收納皿',     desc:'鑰匙、戒指與眼鏡的入口皿',   price:980 },
        { id:'c3', type:'stand', em:'🎨', name:'陶瓷飾品展示盤', desc:'窯變釉色，每只發色都不同',   price:1180 },
      ],
    },

    /* ---------- FOUND 004 ---------- */
    {
      id:'indigo', no:'004', status:'open', em:'💙',
      city:'新北三峽', name:'三峽藍染', since:'清代',
      theme:'時間染出的藍。',
      tone:{ base:'#2E4A6B', deep:'#152538', light:'#8FB3D9', ink:'#EAF2FB' },
      texture:'mottle',
      discover:{
        title:'河邊晾滿藍布的年代',
        body:'三峽曾大量種植馬藍，加上鄰近河運與充足水源，成為台灣藍染的重要發源地。當年染坊沿著三峽溪林立，染好的布匹就在河邊漂洗、晾曬。整條溪谷一片藍，是這座小鎮最鮮明的風景。',
      },
      cocreate:{
        title:'藍色不是一次完成的',
        intro:'每一次浸染只加深一點點，中間必須讓布接觸空氣氧化，顏色才會真正吃進纖維。急不得，也跳不過。',
        steps:[
          { name:'採藍', desc:'收割馬藍葉，浸泡打藍製成藍靛。' },
          { name:'建藍', desc:'養菌發酵起缸，這一步最考驗經驗。' },
          { name:'綁紮', desc:'以縫、綁、夾決定花紋，圖案在此定案。' },
          { name:'浸染', desc:'入缸浸泡、取出氧化，反覆多次。' },
          { name:'漂洗', desc:'清水洗去浮色，晾乾後顏色才算完成。' },
        ],
        note:'眼鏡布染了九次。第七次的藍其實就很漂亮了，但師傅說再兩次，洗過之後才不會走色。',
      },
      spirit:'耐看的作品，不是第一眼驚豔，<br>而是越看越有味道。',
      products:[
        { id:'i1', type:'cloth', em:'💙', name:'藍染手工眼鏡布', desc:'有機棉，每塊紋路都不同',   price:380 },
        { id:'i2', type:'bag',   em:'🔵', name:'藍染束口收納袋', desc:'植物染色，越洗越溫潤',     price:540 },
        { id:'i3', type:'bag',   em:'👜', name:'藍染提袋',       desc:'夾染方格紋，日常好搭',     price:780 },
        { id:'i4', type:'cloth', em:'🧵', name:'藍染包裝布',     desc:'可重複使用的風呂敷包法',   price:320 },
      ],
    },

    /* ---------- FOUND 005 ---------- */
    {
      id:'umbrella', no:'005', status:'open', em:'🌂',
      city:'高雄美濃', name:'美濃紙傘', since:'客家先民',
      theme:'守護。',
      tone:{ base:'#A8452F', deep:'#5A2115', light:'#E8A78E', ink:'#FFF0EA' },
      texture:'spoke',
      discover:{
        title:'女兒出嫁要帶兩把傘',
        body:'客家先民將油紙傘技術帶到美濃。當地盛產竹子，加上桐油與手繪技術成熟，逐漸形成完整的紙傘聚落。紙傘不只是遮陽避雨——傘形渾圓，客家人取其圓滿之意，女兒出嫁時要帶兩把紙傘，象徵多子多孫與家庭和睦。',
      },
      cocreate:{
        title:'一把傘，一個月',
        intro:'劈竹、削竹、編傘骨、裱紙、上油、彩繪，前後超過一個月。一把傘上有上百個手工綁的線結。',
        steps:[
          { name:'劈竹', desc:'選桂竹剖成傘骨，粗細必須完全一致。' },
          { name:'編骨', desc:'棉線穿孔綁紮，一把傘上百個結。' },
          { name:'裱紙', desc:'柿子水糊上棉紙，貼合不能有皺。' },
          { name:'彩繪', desc:'手繪花鳥或書法，每把圖案都不同。' },
          { name:'上油', desc:'反覆刷桐油防水，日曬陰乾交替數回。' },
        ],
        note:'我們沒有做傘，而是請彩繪師傅把畫在傘面上的花鳥，畫到眼鏡布上。同一支筆，同一雙手。',
      },
      spirit:'紙傘守護一家人的晴雨。<br>眼鏡守護一個人的視野。',
      products:[
        { id:'u1', type:'cloth', em:'🌂', name:'紙傘紋客家眼鏡布', desc:'油紙傘彩繪紋樣，客家限定', price:460 },
        { id:'u2', type:'box',   em:'🎁', name:'油紙傘紋禮盒',     desc:'手繪花鳥圖樣，圓滿寓意',   price:1180 },
        { id:'u3', type:'cloth', em:'🖌', name:'手繪限量收藏布組', desc:'職人親筆，每組獨立編號',   price:1580 },
      ],
    },

    /* ---------- 尚未前往 ---------- */
    { id:'bamboo',  no:'006', status:'pending', em:'🎋', city:'南投竹山', name:'竹山竹藝',
      theme:'一根竹子，可以陪伴一輩子。',
      tone:{ base:'#5E7A42', deep:'#33471F', light:'#B7CE8A', ink:'#F4FAE8' }, texture:'stripe', products:[] },

    { id:'rush',    no:'007', status:'pending', em:'🌾', city:'苗栗苑裡', name:'苑裡藺草',
      theme:'從土地長出的天然纖維。',
      tone:{ base:'#A8935E', deep:'#5F5230', light:'#E2D6AC', ink:'#FBF7E9' }, texture:'weave', products:[] },

    { id:'joinery', no:'008', status:'pending', em:'⚙️', city:'桃園大溪', name:'大溪木藝',
      theme:'不靠釘子，也能傳承百年。',
      tone:{ base:'#4A4038', deep:'#26201B', light:'#A89684', ink:'#F7F2EC' }, texture:'joint', products:[] },
  ],

  /* 商品類型 */
  types: [
    { key:'all',     label:'全部' },
    { key:'box',     label:'收納盒' },
    { key:'cloth',   label:'眼鏡布' },
    { key:'bag',     label:'收納袋' },
    { key:'stand',   label:'展示架' },
    { key:'card',    label:'紙品' },
    { key:'service', label:'職人服務' },
  ],
  typeLabel: {
    box:'收納盒', cloth:'眼鏡布', bag:'收納袋',
    stand:'展示架', card:'紙品', service:'職人服務',
  },

  /* 刻圖市集連線失敗時的備援清單 */
  engravingsFallback: [
    { id:'e01', em:'🌸', name:'小花圖案', designer:'阿偉',        category:'自然系', slogan:'某個雨天在騎樓下看見路邊野花，就畫了下來。' },
    { id:'e02', em:'🌊', name:'海浪線條', designer:'小林工作室',  category:'自然系', slogan:'從小在海邊長大，想把海的節奏刻進每一副眼鏡。' },
    { id:'e03', em:'⭐', name:'星群排列', designer:'月球小姐',    category:'幾何系', slogan:'失眠的夜晚把窗外的星空畫成了這個。' },
    { id:'e04', em:'🦋', name:'蝴蝶展翅', designer:'阿偉',        category:'自然系', slogan:'系列第二作，靈感來自老家院子的紫花。' },
    { id:'e05', em:'🗺', name:'城市網格', designer:'Ting Studio', category:'城市系', slogan:'把最喜歡的城市街道化成線條。' },
    { id:'e06', em:'✍️', name:'手寫體字', designer:'Ting Studio', category:'文字系', slogan:'相信文字是最美的圖案。' },
  ],
};
