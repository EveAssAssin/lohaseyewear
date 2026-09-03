/* =============================================================
   LOHAS · SVG → DXF
   -------------------------------------------------------------
   把刻圖線稿(potrace 產出的 SVG)轉成雷雕機吃得下的 DXF。

   === 為什麼是 R12 + POLYLINE ===
   DXF 有很多版本,而雕刻機、割字機這類設備常常是十幾年前的軟體。
   R12(AC1009)是相容性最好的一版,幾乎沒有機器不吃;
   LWPOLYLINE 是 R14 才有的,老機器會讀不到,所以用舊的 POLYLINE。

   === 曲線一律打成折線 ===
   potrace 產出的是貝茲曲線。DXF 的 SPLINE 各家解讀不一,
   而且很多雕刻軟體會直接忽略。折線每一家都吃,代價只是點多一些 ——
   對雕刻來說,點多不是問題,讀不到才是。

   === 座標系要翻轉 ===
   SVG 的 y 軸向下,DXF(與所有 CAD)的 y 軸向上。
   不翻的話出來的圖是上下顛倒的,而那種錯誤在螢幕上看
   常常不明顯(對稱的圖案根本看不出來),要到刻壞才發現。

   對外:window.LohasDxf.fromSvg(svgString, { widthMm, rotateDeg, mode })
        mode: 'outline'(預設,走線,R12) | 'fill'(填滿,R2000 HATCH)
   ============================================================= */

(function (window) {
  'use strict';

  /* 貝茲打成折線的密度。
     每段曲線切成這麼多小段 —— 太少會有稜角,太多檔案會胖。
     16 段在眼鏡布這種尺寸下,肉眼已經看不出折線。 */
  var CURVE_STEPS = 16;

  /* 縮到公釐之後的簡化門檻。
     -----------------------------------------------------------------
     固定切 16 段是「一段曲線不管多長都切 16 刀」——
     短曲線因此被切得遠比需要的細。細節豐富的圖(potrace 描的線稿)
     實測會產生四萬多個頂點,DXF 接近 2MB,EZCAD 匯入會很吃力。

     所以在座標已經是公釐之後,用 Douglas-Peucker 把「拿掉也不會
     偏離原線超過這個距離」的點刪掉。

     0.02 mm 的依據:雕刻機的光點直徑約 0.05 mm,
     偏差只有光點的四成,刻出來看不出來。
     這是【幾何誤差】不是取樣間距 —— 直線段會被壓成兩點,
     真正的曲線該留幾點就留幾點。 */
  var SIMPLIFY_MM = 0.02;

  /* Douglas-Peucker。遞迴改成堆疊,避免長路徑爆掉呼叫堆疊。 */
  function simplify(pts, tol) {
    if (pts.length < 3) return pts;
    var keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    var stack = [[0, pts.length - 1]], t2 = tol * tol;

    while (stack.length) {
      var seg = stack.pop(), i0 = seg[0], i1 = seg[1];
      if (i1 <= i0 + 1) continue;
      var ax = pts[i0][0], ay = pts[i0][1];
      var bx = pts[i1][0], by = pts[i1][1];
      var dx = bx - ax, dy = by - ay;
      var len2 = dx * dx + dy * dy;
      var far = -1, farD = -1;

      for (var i = i0 + 1; i < i1; i++) {
        var px = pts[i][0] - ax, py = pts[i][1] - ay, d2;
        if (len2 === 0) {                       // 起點終點重合,退化成點到點
          d2 = px * px + py * py;
        } else {
          var t = (px * dx + py * dy) / len2;
          t = t < 0 ? 0 : (t > 1 ? 1 : t);
          var ex = px - t * dx, ey = py - t * dy;
          d2 = ex * ex + ey * ey;
        }
        if (d2 > farD) { farD = d2; far = i; }
      }
      if (farD > t2) {
        keep[far] = 1;
        stack.push([i0, far], [far, i1]);
      }
    }

    var out = [];
    for (var k = 0; k < pts.length; k++) if (keep[k]) out.push(pts[k]);
    return out;
  }

  /* ---------- 路徑解析 ----------
     只處理 potrace 會產出的指令:M m L l H h V v C c S s Z z。
     A(弧)不處理 —— potrace 不產生弧,真的遇到就跳過那一段,
     總比整份轉失敗好。 */

  function tokenize(d) {
    /* ⚠ 這裡收【任何】字母,不是只收合法的那幾個。
       原本只寫 [MmLlHhVvCcSsZzAaQqTt],於是不認得的指令字母在
       這一步就被丟掉,連下面的解析都到不了 —— 也就沒有人會知道。
       數字那一支排在後面,但 JS 的交替是就地嘗試,像 1e-5 這種
       科學記號會被數字那一支整段吃掉,不會被拆成字母 e。 */
    var out = [], re = /([A-Za-z])|(-?\d*\.?\d+(?:[eE][-+]?\d+)?)/g, m;
    while ((m = re.exec(d))) out.push(m[1] || parseFloat(m[2]));
    return out;
  }

  function bezier(p0, p1, p2, p3, t) {
    var u = 1 - t;
    return [
      u*u*u*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t*t*t*p3[0],
      u*u*u*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t*t*t*p3[1]
    ];
  }

  /* ---------- 沒能完整處理的東西,一定要浮出水面 ----------
     2026-09-03 的教訓:Q 指令被當成「不認得的就跳過」,靜靜地
     壞了兩個月 —— 492 張圖案裡有 56 張受影響,而輸出的檔案
     看起來還是像那張圖,只是形狀不對。沒有人會去對照原圖。

     所以現在:凡是沒能完整還原的地方都記下來,由 fromSvg 回傳,
     下載的那一頁負責讓製作的人【看見】。寧可吵,不要安靜地錯。 */
  var _warnings = [];
  function warn(msg) {
    if (_warnings.indexOf(msg) < 0) _warnings.push(msg);
  }

  /** 把一個 path 的 d 拆成多條折線(每條是一個 [x,y] 陣列) */
  function pathToPolylines(d) {
    var t = tokenize(d);
    var polys = [], cur = null;
    var x = 0, y = 0, startX = 0, startY = 0;
    var lastC2 = null;          // 給 S 指令接續用(三次曲線的第二控制點)
    var lastQ1 = null;          // 給 T 指令接續用(二次曲線的控制點)
    var i = 0, cmd = '';

    function begin() { cur = [[x, y]]; polys.push(cur); }
    function push(nx, ny) { if (cur) cur.push([nx, ny]); x = nx; y = ny; }

    function curveTo(c1, c2, p) {
      if (!cur) begin();
      var p0 = [x, y];
      for (var s = 1; s <= CURVE_STEPS; s++) {
        var pt = bezier(p0, c1, c2, p, s / CURVE_STEPS);
        cur.push(pt);
      }
      x = p[0]; y = p[1];
      lastC2 = c2; lastQ1 = null;
    }

    /* 二次貝茲(Q/T)。
       ⚠ 這一段是 2026-09-03 補的。原本 Q 被當成「不認得的指令」整段跳過,
       而且跳過時連筆尖位置都沒更新 —— 後面接的 L 會從錯的點畫出去。
       客人上傳的圖走的是 imagetracer.js,它大量使用 Q;
       市集的圖走 potrace,只有 C —— 所以這個 bug 只有上傳的圖會中,
       而且圖看起來大致還像,只是轉角被削掉、弧線變直。 */
    function quadTo(c, p) {
      if (!cur) begin();
      var p0 = [x, y];
      for (var s = 1; s <= CURVE_STEPS; s++) {
        var u = 1 - s / CURVE_STEPS, tt = s / CURVE_STEPS;
        cur.push([
          u*u*p0[0] + 2*u*tt*c[0] + tt*tt*p[0],
          u*u*p0[1] + 2*u*tt*c[1] + tt*tt*p[1]
        ]);
      }
      x = p[0]; y = p[1];
      lastQ1 = c; lastC2 = null;
    }

    while (i < t.length) {
      if (typeof t[i] === 'string') { cmd = t[i]; i++; }
      var rel = cmd === cmd.toLowerCase();
      var C = cmd.toUpperCase();

      if (C === 'M') {
        var mx = t[i++], my = t[i++];
        x = rel ? x + mx : mx; y = rel ? y + my : my;
        startX = x; startY = y;
        begin();
        // M 後面接的座標視為 L(SVG 規格)
        cmd = rel ? 'l' : 'L';

      } else if (C === 'L') {
        var lx = t[i++], ly = t[i++];
        push(rel ? x + lx : lx, rel ? y + ly : ly);
        lastC2 = null;

      } else if (C === 'H') {
        var hx = t[i++];
        push(rel ? x + hx : hx, y); lastC2 = null;

      } else if (C === 'V') {
        var vy = t[i++];
        push(x, rel ? y + vy : vy); lastC2 = null;

      } else if (C === 'C') {
        var a1 = [t[i++], t[i++]], a2 = [t[i++], t[i++]], a3 = [t[i++], t[i++]];
        if (rel) { a1 = [x+a1[0], y+a1[1]]; a2 = [x+a2[0], y+a2[1]]; a3 = [x+a3[0], y+a3[1]]; }
        curveTo(a1, a2, a3);

      } else if (C === 'S') {
        var b2 = [t[i++], t[i++]], b3 = [t[i++], t[i++]];
        if (rel) { b2 = [x+b2[0], y+b2[1]]; b3 = [x+b3[0], y+b3[1]]; }
        // S 的第一個控制點是上一段第二控制點的鏡射
        var b1 = lastC2 ? [2*x - lastC2[0], 2*y - lastC2[1]] : [x, y];
        curveTo(b1, b2, b3);

      } else if (C === 'Q') {
        var q1 = [t[i++], t[i++]], q2 = [t[i++], t[i++]];
        if (rel) { q1 = [x+q1[0], y+q1[1]]; q2 = [x+q2[0], y+q2[1]]; }
        quadTo(q1, q2);

      } else if (C === 'T') {
        var s2 = [t[i++], t[i++]];
        if (rel) { s2 = [x+s2[0], y+s2[1]]; }
        // T 的控制點是上一段 Q 控制點的鏡射;前面不是 Q 就退化成直線
        quadTo(lastQ1 ? [2*x - lastQ1[0], 2*y - lastQ1[1]] : [x, y], s2);

      } else if (C === 'Z') {
        if (cur && cur.length) cur.push([startX, startY]);
        x = startX; y = startY;
        cur = null; lastC2 = null; lastQ1 = null;

      } else if (C === 'A') {
        warn('橢圓弧(A)');
        /* 橢圓弧。目前兩套描圖工具(potrace / imagetracer.js)都不產生 A,
           所以沒有實作完整的弧線換算。
           ⚠ 但【不能只是跳過】—— 跳過會讓筆尖留在舊位置,後面整段都歪。
           至少走一條直線到終點:形狀會少一個弧度,但不會錯位。
           真的遇到就會在主控台看到,不是默默壞掉。 */
        i += 5;                                   // rx ry rot large sweep
        var ax = t[i++], ay = t[i++];
        push(rel ? x + ax : ax, rel ? y + ay : ay);
        lastC2 = null; lastQ1 = null;

      } else {
        /* 真的不認得的指令:跳過一個參數,不要整份壞掉 ——
           但一定要留下紀錄。這正是 Q 能躲兩個月的原因。 */
        warn('未知指令 ' + C);
        i += 1;
        lastC2 = null; lastQ1 = null;
      }
    }
    return polys.filter(function (p) { return p.length > 1; });
  }

  /* ---------- SVG 的 transform ----------
     ⚠ 這一段不是為了完整支援 SVG,是為了 potrace。
     potrace 產出的檔案長這樣:

       <svg viewBox="0 0 266 266">
         <g transform="translate(0.000000,266.000000) scale(0.100000,-0.100000)">
           <path d="M100 900 L900 900 …"/>

     也就是:座標放大 10 倍存著,再靠 g 的 transform 縮回來,而且
     scale 的 Y 是【負的】。2026-09-03 之前這裡完全沒讀 transform,
     於是同時壞了兩件事,而且兩件都不會報錯:

       1. 尺寸 —— 要求 90mm 實際輸出 524mm(差 5.8 倍)
       2. 方向 —— 負的 Y 已經翻過一次,下面 tx() 再翻一次 = 上下顛倒

     第 2 項特別惡劣:對稱的圖(星座符號那種)看不出來,不對稱的圖
     才會現形,所以它可以一直躲著。 */

  function matMul(m, n) {
    return [
      m[0] * n[0] + m[2] * n[1],  m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3],  m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4],
      m[1] * n[4] + m[3] * n[5] + m[5]
    ];
  }

  function parseTransform(str) {
    var m = [1, 0, 0, 1, 0, 0];
    var re = /(matrix|translate|scale|rotate)\s*\(([^)]*)\)/g, seg;
    while ((seg = re.exec(str))) {
      var a = seg[2].trim().split(/[\s,]+/).map(Number);
      var t = null, sx, sy, r, c, s, cx, cy;
      if (seg[1] === 'matrix') {
        if (a.length === 6 && a.every(isFinite)) t = a;
      } else if (seg[1] === 'translate') {
        t = [1, 0, 0, 1, a[0] || 0, a.length > 1 ? (a[1] || 0) : 0];
      } else if (seg[1] === 'scale') {
        sx = isFinite(a[0]) ? a[0] : 1;
        sy = (a.length > 1 && isFinite(a[1])) ? a[1] : sx;   // scale(2) = scale(2,2)
        t = [sx, 0, 0, sy, 0, 0];
      } else if (seg[1] === 'rotate') {
        r = (a[0] || 0) * Math.PI / 180; c = Math.cos(r); s = Math.sin(r);
        t = [c, s, -s, c, 0, 0];
        if (a.length >= 3) {          // rotate(deg, cx, cy) = 繞指定點轉
          cx = a[1] || 0; cy = a[2] || 0;
          t = matMul(matMul([1, 0, 0, 1, cx, cy], t), [1, 0, 0, 1, -cx, -cy]);
        }
      }
      if (t) m = matMul(m, t);
    }
    return m;
  }

  /* 從這個節點一路往上收到 <svg> 為止。外層的先套,內層的後套。 */
  function ctmOf(node, root) {
    var chain = [], n = node;
    while (n && n !== root) { chain.push(n); n = n.parentNode; }
    var m = [1, 0, 0, 1, 0, 0];
    for (var i = chain.length - 1; i >= 0; i--) {
      var t = chain[i].getAttribute && chain[i].getAttribute('transform');
      if (t) m = matMul(m, parseTransform(t));
    }
    return m;
  }

  function applyMat(m, poly) {
    return poly.map(function (p) {
      return [m[0] * p[0] + m[2] * p[1] + m[4],
              m[1] * p[0] + m[3] * p[1] + m[5]];
    });
  }

  /* ---------- SVG 解析 ---------- */

  function parseSvg(svgString) {
    var doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
    var svg = doc.querySelector('svg');
    if (!svg) throw new Error('這不是有效的 SVG');

    // 尺寸以 viewBox 為準;沒有的話退回 width/height
    var vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    var box = (vb.length === 4 && vb.every(function (n) { return isFinite(n); }))
      ? { x: vb[0], y: vb[1], w: vb[2], h: vb[3] }
      : { x: 0, y: 0,
          w: parseFloat(svg.getAttribute('width')) || 1000,
          h: parseFloat(svg.getAttribute('height')) || 1000 };

    var polys = [];
    doc.querySelectorAll('path').forEach(function (p) {
      /* 白色路徑不要 —— potrace 的白色是背景,刻下去會變成把整塊挖掉。
         上傳流程已經濾過一次,這裡再擋一次:後台下載的檔案是要直接
         進機器的,多驗一次的成本遠低於刻壞一片布。 */
      var fill = (p.getAttribute('fill') || '').replace(/\s/g, '').toLowerCase();
      if (fill === '#fff' || fill === '#ffffff' || fill === 'rgb(255,255,255)' || fill === 'white') return;

      var d = p.getAttribute('d');
      if (!d) return;

      /* 套上這條路徑身上累積的 transform,把座標搬回 viewBox 的空間。
         沒有 transform 的檔案會拿到單位矩陣,結果完全不變。 */
      var m = ctmOf(p, svg);
      polys = polys.concat(pathToPolylines(d).map(function (poly) {
        return applyMat(m, poly);
      }));
    });

    if (!polys.length) throw new Error('這份 SVG 裡沒有可以轉換的線條');
    return { box: box, polys: polys };
  }

  /* ---------- DXF 輸出 ---------- */

  function pair(code, value) { return code + '\n' + value + '\n'; }

  /**
   * @param {string} svgString  potrace 產出的 SVG
   * @param {object} opt
   *        widthMm  成品實際寬度(公釐)。SVG 的 viewBox 寬會被縮放到這個值。
   *        layer    圖層名稱
   */
  /* =============================================================
     填滿版:用一個 SOLID HATCH 表達整張圖
     -------------------------------------------------------------
     為什麼需要這一版:
       DXF 的 POLYLINE 【沒有「洞」這個概念】。潦草地說,
       線稿在 SVG 裡是「外框一條、每個白色區塊各一條反向的」,
       瀏覽器靠 fill-rule 挖洞;轉成一堆各自獨立的封閉多段線之後,
       那個資訊就不見了 —— 會填色的軟體把洞也填黑,
       整張圖變成實心色塊。

     解法的關鍵:HATCH 有一個填充樣式叫【odd parity(奇偶)】,
     與 SVG 的 even-odd 是同一套規則 —— 射線穿過奇數條邊界是實心、
     偶數條是洞。所以【不必自己判斷誰是洞、誰包著誰】,
     把每一條輪廓都當成邊界丟進去,渲染端自己算。

     那省掉的是最貴的部分:1300 條輪廓要兩兩做包含測試,
     是 O(n²) 次多邊形內判定。

     ⚠ 代價:HATCH 是 R14 之後才有的實體,不能再用 R12(AC1009)。
     這一版輸出 R2000(AC1015),而 R2000 比 R12 嚴格:
       · 實體要有 handle(群組碼 5),標頭要有 $HANDSEED
       · 用到的圖層要在 TABLES 裡真的存在
     少了這些有些軟體會直接說檔案損毀,所以都補上。

     ⚠ 我方沒有那些雕刻軟體可以實測,只能照規格寫。
     第一次用請先拿一張圖試,確認洞是洞再進正式生產。
     ============================================================= */
  function buildFill(rings, widthMm, heightMm, layer) {
    var h = 0x100;
    function handle() { return (h++).toString(16).toUpperCase(); }

    var s = '';

    /* ---- HEADER ---- */
    s += pair(0, 'SECTION') + pair(2, 'HEADER');
    s += pair(9, '$ACADVER') + pair(1, 'AC1015');
    s += pair(9, '$INSUNITS') + pair(70, 4);
    s += pair(9, '$EXTMIN') + pair(10, 0) + pair(20, 0) + pair(30, 0);
    s += pair(9, '$EXTMAX') + pair(10, widthMm.toFixed(4)) +
         pair(20, heightMm.toFixed(4)) + pair(30, 0);
    // 比所有用掉的 handle 都大,否則有些軟體會拒收
    s += pair(9, '$HANDSEED') + pair(5, (0x100 + rings.length + 32).toString(16).toUpperCase());
    s += pair(0, 'ENDSEC');

    /* ---- TABLES:R2000 需要圖層真的存在 ---- */
    s += pair(0, 'SECTION') + pair(2, 'TABLES');
    s += pair(0, 'TABLE') + pair(2, 'LAYER') + pair(5, handle()) +
         pair(100, 'AcDbSymbolTable') + pair(70, 1);
    s += pair(0, 'LAYER') + pair(5, handle()) +
         pair(100, 'AcDbSymbolTableRecord') + pair(100, 'AcDbLayerTableRecord') +
         pair(2, layer) + pair(70, 0) + pair(62, 7) + pair(6, 'CONTINUOUS');
    s += pair(0, 'ENDTAB');
    s += pair(0, 'ENDSEC');

    /* ---- ENTITIES:一個 HATCH,每條輪廓一個邊界 ---- */
    s += pair(0, 'SECTION') + pair(2, 'ENTITIES');

    s += pair(0, 'HATCH') + pair(5, handle()) +
         pair(100, 'AcDbEntity') + pair(8, layer) +
         pair(100, 'AcDbHatch');
    // 基準點與擠出方向
    s += pair(10, 0) + pair(20, 0) + pair(30, 0);
    s += pair(210, 0) + pair(220, 0) + pair(230, 1);
    s += pair(2, 'SOLID') + pair(70, 1) + pair(71, 0);
    s += pair(91, rings.length);

    /* 邊界路徑。92 是位元旗標:1=external、2=polyline。
       ⚠ 面積最大的那一條標成 external —— 有些軟體要求至少有一條。
       其餘標成單純的 polyline,實際的洞由下面 75=0 的奇偶規則決定,
       不靠這裡的旗標。 */
    var biggest = 0, bigArea = -1;
    rings.forEach(function (r, i) {
      var xs = r.pts.map(function (p) { return p[0]; });
      var ys = r.pts.map(function (p) { return p[1]; });
      var a = (Math.max.apply(null, xs) - Math.min.apply(null, xs)) *
              (Math.max.apply(null, ys) - Math.min.apply(null, ys));
      if (a > bigArea) { bigArea = a; biggest = i; }
    });

    rings.forEach(function (r, i) {
      s += pair(92, i === biggest ? 3 : 2);   // external+polyline / polyline
      s += pair(72, 0);                        // 沒有凸度(不是圓弧)
      s += pair(73, 1);                        // 封閉
      s += pair(93, r.pts.length);
      r.pts.forEach(function (p) {
        s += pair(10, p[0].toFixed(4)) + pair(20, p[1].toFixed(4));
      });
      s += pair(97, 0);                        // 沒有來源邊界物件
    });

    /* 75 = 0 是【奇偶規則】。整份檔案的洞就是靠這一行成立的,
       改成 1(outer)或 2(ignore)會讓內部全部被填滿 —— 也就是
       這一版原本要解決的那個問題。 */
    s += pair(75, 0);
    s += pair(76, 1);                          // 預定義圖案
    s += pair(98, 0);                          // 沒有種子點

    s += pair(0, 'ENDSEC') + pair(0, 'EOF');
    return s;
  }

  function fromSvg(svgString, opt) {
    _warnings = [];                                // 每次轉換各自累積
    opt = opt || {};
    var widthMm = Number(opt.widthMm) || 150;      // 預設 15 公分
    var layer = String(opt.layer || 'ENGRAVE');
    /* 旋轉角(度,順時針,與客人在畫面上看到的一致)。
       -----------------------------------------------------------
       ⚠ 這不是選配的美化。客人在眼鏡布那一頁把圖轉了 30 度,
       DXF 沒轉的話,做出來的東西就跟他看到的不一樣 ——
       而那要等成品送到他手上才會被發現。 */
    var rotDeg = Number(opt.rotateDeg) || 0;
    /* 'outline'(預設)= 每條輪廓一條 POLYLINE,給走線/切割用,R12。
       'fill'          = 一個 SOLID HATCH,給填滿雕刻用,R2000。
       兩種是【不同用途】,不是新舊版本,見 buildFill 的說明。 */
    var mode = opt.mode === 'fill' ? 'fill' : 'outline';

    var parsed = parseSvg(svgString);
    var box = parsed.box;

    /* ⚠ 縮放的基準是【圖案本身的外框】,不是 viewBox。
       -----------------------------------------------------------
       原本用 viewBox 的寬去算,所以 SVG 邊緣有留白時,
       要求 80mm 實際只會刻出 64mm —— 而製作端那一格寫的是
       「刻圖寬度」,那個名字就成了假的。

       量圖案自己的外框,widthMm 才真的等於刻出來的寬度。
       量不到(沒有任何路徑)就退回 viewBox,至少不會除以零。 */
    var ax0 = Infinity, ay0 = Infinity, ax1 = -Infinity, ay1 = -Infinity;
    parsed.polys.forEach(function (poly) {
      poly.forEach(function (p) {
        if (p[0] < ax0) ax0 = p[0];
        if (p[0] > ax1) ax1 = p[0];
        if (p[1] < ay0) ay0 = p[1];
        if (p[1] > ay1) ay1 = p[1];
      });
    });
    var artW = isFinite(ax0) && ax1 > ax0 ? ax1 - ax0 : box.w;
    var artH = isFinite(ay0) && ay1 > ay0 ? ay1 - ay0 : box.h;
    if (isFinite(ax0)) { box = { x: ax0, y: ay0, w: artW, h: artH }; }

    var k = widthMm / (artW || 1);                  // SVG 單位 → 公釐
    var heightMm = artH * k;

    /* 座標轉換:平移到原點、縮放到公釐、y 軸翻轉。
       翻轉是必要的 —— SVG 的 y 向下,CAD 的 y 向上。 */
    function tx(p) {
      return [
        ((p[0] - box.x) * k),
        (heightMm - (p[1] - box.y) * k)
      ];
    }

    /* 先把所有點算出來(含旋轉),再決定圖框大小。
       -----------------------------------------------------------
       ⚠ 順序不能顛倒。轉過之後外框會變大(45 度時對角線最長),
       沿用原本的 widthMm/heightMm 當 $EXTMAX,圖會超出宣告的範圍,
       有些軟體會直接把超出的部分裁掉。

       轉完再整體平移回第一象限,讓左下角落在原點 ——
       維持這支函式原本的約定:輸出永遠從 (0,0) 開始。 */
    var polys = parsed.polys.map(function (poly) { return poly.map(tx); });

    if (rotDeg) {
      /* y 軸已經翻過了,所以這裡要用 -rad 才會與畫面上的
         「順時針」一致。用 +rad 的話畫面轉右、成品轉左,
         而那種錯誤看圖檔看不出來,要等實物。 */
      var rad = -rotDeg * Math.PI / 180;
      var cos = Math.cos(rad), sin = Math.sin(rad);
      var cx = widthMm / 2, cy = heightMm / 2;
      polys = polys.map(function (poly) {
        return poly.map(function (p) {
          var dx = p[0] - cx, dy = p[1] - cy;
          return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
        });
      });
    }

    // 重新量外框,並把整體平移到原點
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    polys.forEach(function (poly) {
      poly.forEach(function (p) {
        if (p[0] < minX) minX = p[0];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[1] > maxY) maxY = p[1];
      });
    });
    if (isFinite(minX)) {
      polys = polys.map(function (poly) {
        return poly.map(function (p) { return [p[0] - minX, p[1] - minY]; });
      });
      widthMm = maxX - minX;
      heightMm = maxY - minY;
    }

    /* 先把每一條輪廓整理成「封閉、不重複收尾點」的形式。
       兩種輸出都要用,所以在分岔之前做完。 */
    var rings = [];
    polys.forEach(function (pts) {
      var first = pts[0], last = pts[pts.length - 1];
      var closed = Math.abs(first[0] - last[0]) < 1e-6 &&
                   Math.abs(first[1] - last[1]) < 1e-6;
      if (closed) pts = pts.slice(0, -1);
      /* ⚠ 用【面積】濾掉描圖雜點,不是用點數。
         -----------------------------------------------------------
         點數擋不乾淨:實際檔案裡出現過「3 個點、但第 1 點與第 3 點
         幾乎重合」的針狀物 —— 點數是 3,面積卻是 0。
         (貓-a68d2841 那張螃蟹裡有兩條。)

         留著的話,填滿版會多算一條邊界、走線版會多一段幾乎零長度
         的刀路,有些軟體看到會報錯。

         這裡的座標【已經是公釐】(上面縮放過了),所以門檻可以直接
         用實際尺寸看:0.0001 mm² 大約是 0.01 mm 見方,遠小於任何
         雕刻機刻得出來的東西,不會誤傷真正的細節。 */
      if (pts.length < 3) return;
      var a2 = 0;
      for (var q = 0; q < pts.length; q++) {
        var r2 = pts[(q + 1) % pts.length];
        a2 += pts[q][0] * r2[1] - r2[0] * pts[q][1];
      }
      if (Math.abs(a2 / 2) < 1e-4) return;
      pts = simplify(pts, SIMPLIFY_MM);
      if (pts.length < 3) return;
      rings.push({ pts: pts, closed: closed });
    });

    if (mode === 'fill') {
      return {
        dxf: buildFill(rings, widthMm, heightMm, layer),
        widthMm: widthMm, heightMm: heightMm,
        paths: parsed.polys.length, rotateDeg: rotDeg, mode: 'fill',
        warnings: _warnings.slice(),
      };
    }

    var s = '';
    // 最小可用的 R12 標頭。$INSUNITS = 4 代表公釐,機器才知道尺寸單位。
    s += pair(0, 'SECTION') + pair(2, 'HEADER');
    s += pair(9, '$ACADVER') + pair(1, 'AC1009');
    s += pair(9, '$INSUNITS') + pair(70, 4);
    s += pair(9, '$EXTMIN') + pair(10, 0) + pair(20, 0) + pair(30, 0);
    s += pair(9, '$EXTMAX') + pair(10, widthMm.toFixed(4)) +
         pair(20, heightMm.toFixed(4)) + pair(30, 0);
    s += pair(0, 'ENDSEC');

    s += pair(0, 'SECTION') + pair(2, 'ENTITIES');

    rings.forEach(function (r) {
      var pts = r.pts, closed = r.closed;
      /* 封閉的標成 flag 70 = 1。雷雕的路徑規劃看這個旗標決定要不要收尾,
         不標的話有些軟體會在接縫處留一個小缺口。 */
      s += pair(0, 'POLYLINE') + pair(8, layer) + pair(66, 1) +
           pair(10, 0) + pair(20, 0) + pair(30, 0) + pair(70, closed ? 1 : 0);
      pts.forEach(function (p) {
        s += pair(0, 'VERTEX') + pair(8, layer) +
             pair(10, p[0].toFixed(4)) + pair(20, p[1].toFixed(4)) + pair(30, 0);
      });
      s += pair(0, 'SEQEND') + pair(8, layer);
    });

    s += pair(0, 'ENDSEC') + pair(0, 'EOF');
    return {
      dxf: s, widthMm: widthMm, heightMm: heightMm,
      paths: parsed.polys.length, rotateDeg: rotDeg, mode: 'outline',
      warnings: _warnings.slice(),
    };
  }

  window.LohasDxf = { fromSvg: fromSvg };

})(window);
