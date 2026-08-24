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

   對外:window.LohasDxf.fromSvg(svgString, { widthMm })
   ============================================================= */

(function (window) {
  'use strict';

  /* 貝茲打成折線的密度。
     每段曲線切成這麼多小段 —— 太少會有稜角,太多檔案會胖。
     16 段在眼鏡布這種尺寸下,肉眼已經看不出折線。 */
  var CURVE_STEPS = 16;

  /* ---------- 路徑解析 ----------
     只處理 potrace 會產出的指令:M m L l H h V v C c S s Z z。
     A(弧)不處理 —— potrace 不產生弧,真的遇到就跳過那一段,
     總比整份轉失敗好。 */

  function tokenize(d) {
    var out = [], re = /([MmLlHhVvCcSsZzAaQqTt])|(-?\d*\.?\d+(?:[eE][-+]?\d+)?)/g, m;
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

  /** 把一個 path 的 d 拆成多條折線(每條是一個 [x,y] 陣列) */
  function pathToPolylines(d) {
    var t = tokenize(d);
    var polys = [], cur = null;
    var x = 0, y = 0, startX = 0, startY = 0;
    var lastC2 = null;          // 給 S 指令接續用
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
      lastC2 = c2;
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

      } else if (C === 'Z') {
        if (cur && cur.length) cur.push([startX, startY]);
        x = startX; y = startY;
        cur = null; lastC2 = null;

      } else {
        /* 不認得的指令(例如 A):跳過它的參數,不要整份壞掉。
           potrace 不產生這些,會走到這裡多半是別的工具做的 SVG。 */
        var skip = { A: 7, Q: 4, T: 2 }[C] || 0;
        i += skip || 1;
        lastC2 = null;
      }
    }
    return polys.filter(function (p) { return p.length > 1; });
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
      if (d) polys = polys.concat(pathToPolylines(d));
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
  function fromSvg(svgString, opt) {
    opt = opt || {};
    var widthMm = Number(opt.widthMm) || 150;      // 預設 15 公分
    var layer = String(opt.layer || 'ENGRAVE');

    var parsed = parseSvg(svgString);
    var box = parsed.box;
    var k = widthMm / (box.w || 1);                // SVG 單位 → 公釐
    var heightMm = box.h * k;

    /* 座標轉換:平移到原點、縮放到公釐、y 軸翻轉。
       翻轉是必要的 —— SVG 的 y 向下,CAD 的 y 向上。 */
    function tx(p) {
      return [
        ((p[0] - box.x) * k),
        (heightMm - (p[1] - box.y) * k)
      ];
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

    parsed.polys.forEach(function (poly) {
      var pts = poly.map(tx);
      /* 頭尾重合就標成封閉多段線(flag 70 = 1)。
         雷雕的路徑規劃看這個旗標決定要不要收尾,
         不標的話有些軟體會在接縫處留一個小缺口。 */
      var first = pts[0], last = pts[pts.length - 1];
      var closed = Math.abs(first[0] - last[0]) < 1e-6 &&
                   Math.abs(first[1] - last[1]) < 1e-6;
      if (closed) pts = pts.slice(0, -1);
      if (pts.length < 2) return;

      s += pair(0, 'POLYLINE') + pair(8, layer) + pair(66, 1) +
           pair(10, 0) + pair(20, 0) + pair(30, 0) + pair(70, closed ? 1 : 0);
      pts.forEach(function (p) {
        s += pair(0, 'VERTEX') + pair(8, layer) +
             pair(10, p[0].toFixed(4)) + pair(20, p[1].toFixed(4)) + pair(30, 0);
      });
      s += pair(0, 'SEQEND') + pair(8, layer);
    });

    s += pair(0, 'ENDSEC') + pair(0, 'EOF');
    return { dxf: s, widthMm: widthMm, heightMm: heightMm, paths: parsed.polys.length };
  }

  window.LohasDxf = { fromSvg: fromSvg };

})(window);
