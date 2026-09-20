/* =============================================================
   客製眼鏡盒(case.html)· 版型階段
   -------------------------------------------------------------
   這一版【只做版面上的互動】:來源切換、圖案拖曳/縮放/旋轉。
   刻圖市集、上傳描圖、手繪、結帳都還沒接上。

   ⚠ 位置與角度用「百分比 + 角度」存,不要存像素。
     預覽框的大小會隨螢幕寬度變(手機上只有桌機的一半),
     存像素的話同一張圖在手機上會跑到盒子外面,
     而且送到製作端的座標會是錯的 —— 那種錯不會報錯,
     會變成一件刻歪的成品。

     這與客製眼鏡布的 placement 是同一個約定
     ({ scale, x, y, rot } 全部 0~1 或角度),之後接製作端時
     兩邊可以共用同一組欄位。
   ============================================================= */

(function (window, document) {
  'use strict';

  /* 圖案在「可雕刻範圍」裡的位置。
     x / y 是 0~1(範圍框的左上到右下),scale 是佔範圍框寬度的比例。 */
  var DEFAULT = { x: 0.5, y: 0.5, scale: 0.55, rot: 0 };
  var state = Object.assign({}, DEFAULT);

  /* 一次先畫幾張,按「展開全部」才畫其餘的。
     ⚠ 三百張縮圖一次塞進 DOM,手機會卡住好幾秒 ——
       而那幾秒之內畫面是動不了的,客人會以為當掉。 */
  var PREVIEW_N = 12;

  var Market = { designs: [], filter: '', expanded: false, picked: null };

  var el = {};

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- 套用到畫面 ---------- */

  function apply() {
    if (!el.art) return;
    el.art.style.left = (state.x * 100) + '%';
    el.art.style.top = (state.y * 100) + '%';
    el.art.style.width = (state.scale * 100) + '%';
    el.art.style.transform =
      'translate(-50%, -50%) rotate(' + state.rot + 'deg)';
  }

  /* ---------- 拖曳 ----------
     用 pointer 事件一次涵蓋滑鼠與觸控,不要分開寫兩套 ——
     分開寫的結果是其中一套沒有人測。

     setPointerCapture:手指滑出預覽框之後還要繼續拖得動。
     少了它,拖到邊緣就會鬆手,而客人會以為是卡住。 */
  function bindDrag() {
    var dragging = false;
    var startX = 0, startY = 0, baseX = 0, baseY = 0, rect = null;

    el.art.addEventListener('pointerdown', function (e) {
      dragging = true;
      rect = el.plate.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      baseX = state.x; baseY = state.y;
      el.art.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    el.art.addEventListener('pointermove', function (e) {
      if (!dragging || !rect || !rect.width || !rect.height) return;
      /* ⚠ 位移要除以【範圍框】的寬高換算成比例,不是除以整張預覽。
         底圖是正上方拍的,範圍框沒有旋轉也沒有斜切,
         所以這個換算是【精確的】,不是近似。
         哪天換成有角度的棚拍當底圖,這裡就要改成把游標座標
         反投影回那個平面 —— 不改的話圖會愈拖愈偏,而且不報錯。 */
      state.x = clamp01(baseX + (e.clientX - startX) / rect.width);
      state.y = clamp01(baseY + (e.clientY - startY) / rect.height);
      apply();
    });

    function stop(e) {
      if (!dragging) return;
      dragging = false;
      try { el.art.releasePointerCapture(e.pointerId); } catch (_e) {}
    }
    el.art.addEventListener('pointerup', stop);
    el.art.addEventListener('pointercancel', stop);
  }

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  /* =============================================================
     刻圖市集
     -------------------------------------------------------------
     與 js/cloth.js 的 loadDesigns 讀同一張表、同一組條件。
     ⚠ 兩邊要一致:只讀 status='approved'。少了它,待審核與被
       駁回的作品會出現在客人的選單裡 —— 那是審核制度失效,
       而且畫面上完全看不出異常。
     ============================================================= */

  function loadDesigns() {
    var sb = window.LohasSupabase && window.LohasSupabase.getClient
      ? window.LohasSupabase.getClient() : null;
    if (!sb) {
      el.designs.innerHTML = '<p class="cs-pane-empty">刻圖載入失敗</p>';
      return;
    }
    sb.from('engraving_designs')
      .select('id, name, designer_name, image_url, image_url_png, image_url_svg')
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .limit(300)
      .then(function (res) {
        Market.designs = res.data || [];
        renderDesigns();
      })
      .catch(function () {
        el.designs.innerHTML = '<p class="cs-pane-empty">刻圖載入失敗</p>';
      });
  }

  /* 縮圖用 PNG(去背、瀏覽器畫得快),真正要雕的是 SVG 線稿。
     兩者的用途不可互換 —— 見 pickDesign。 */
  function thumb(d) {
    return d.image_url_png || d.image_url || d.image_url_svg || '';
  }

  function filtered() {
    var q = Market.filter.trim().toLowerCase();
    if (!q) return Market.designs;
    return Market.designs.filter(function (d) {
      return (d.name || '').toLowerCase().indexOf(q) >= 0 ||
             (d.designer_name || '').toLowerCase().indexOf(q) >= 0;
    });
  }

  function renderDesigns() {
    var list = filtered();
    if (!list.length) {
      el.designs.innerHTML = '<p class="cs-pane-empty">' +
        (Market.designs.length ? '找不到符合的刻圖' : '目前沒有可用的刻圖') + '</p>';
      el.more.style.display = 'none';
      return;
    }
    var shown = Market.expanded ? list : list.slice(0, PREVIEW_N);
    el.designs.innerHTML = shown.map(function (d) {
      var on = Market.picked && Market.picked.id === d.id ? ' on' : '';
      return '<button type="button" class="cs-design' + on + '" data-id="' + esc(d.id) + '"' +
             ' title="' + esc(d.name || '') + '">' +
             '<img src="' + esc(thumb(d)) + '" alt="' + esc(d.name || '') + '" loading="lazy">' +
             '</button>';
    }).join('');

    if (list.length > PREVIEW_N) {
      el.more.style.display = '';
      el.more.textContent = Market.expanded ? '收合' : '展開全部（' + list.length + '）';
    } else {
      el.more.style.display = 'none';
    }
  }

  function pickErr(msg) {
    if (!el.pickErr) return;
    el.pickErr.textContent = msg || '';
    el.pickErr.hidden = !msg;
  }

  function pickDesign(id) {
    var d = null;
    for (var i = 0; i < Market.designs.length; i++) {
      if (String(Market.designs[i].id) === String(id)) { d = Market.designs[i]; break; }
    }
    if (!d) return;

    /* 🚨 沒有 SVG 線稿就【不能選】。
       雷刻吃的是線稿(要轉成 DXF 給雕刻機),PNG 只是給人看的縮圖。
       讓客人挑了、調好位置、付完錢,才在製作端發現刻不出來 ——
       那時候退的是一筆已經收了的錢。先擋住。 */
    if (!d.image_url_svg) {
      pickErr('這張刻圖缺少線稿檔，不能拿來雕刻。換一張試試。');
      return;
    }
    pickErr('');

    Market.picked = {
      id: d.id,
      name: d.name || '',
      designer: d.designer_name || '',
      thumbUrl: thumb(d),
      svgUrl: d.image_url_svg
    };

    el.artImg.src = Market.picked.thumbUrl;
    el.artImg.alt = Market.picked.name;
    el.art.hidden = false;
    if (el.stageEmpty) el.stageEmpty.hidden = true;

    /* 換圖時位置回到預設。沿用上一張的位置看起來像「貼心」,
       實際上是上一張的構圖套在完全不同比例的圖上,幾乎一定要重調。 */
    state = Object.assign({}, DEFAULT);
    if (el.scale) el.scale.value = String(Math.round(DEFAULT.scale * 100));
    if (el.rot) el.rot.value = String(DEFAULT.rot);
    apply();

    renderDesigns();
  }

  function bindMarket() {
    if (!el.designs) return;

    el.designs.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-id]');
      if (btn) pickDesign(btn.dataset.id);
    });

    if (el.more) {
      el.more.addEventListener('click', function () {
        Market.expanded = !Market.expanded;
        renderDesigns();
      });
    }

    if (el.search) {
      el.search.addEventListener('input', function () {
        Market.filter = el.search.value;
        /* 搜尋之後回到收合 —— 不然搜出三張卻還顯示「收合」,
           而按下去畫面沒有變化。 */
        Market.expanded = false;
        renderDesigns();
      });
    }

    loadDesigns();
  }

  /* ---------- 來源切換 ---------- */

  function bindSource() {
    var bar = $('csSource');
    if (!bar) return;
    bar.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-src]');
      if (!btn) return;
      bar.querySelectorAll('.cs-seg-btn').forEach(function (b) {
        b.classList.toggle('on', b === btn);
      });
      var want = btn.dataset.src;
      document.querySelectorAll('[data-pane]').forEach(function (p) {
        p.classList.toggle('on', p.dataset.pane === want);
      });
    });
  }

  /* ---------- 盒款 ---------- */

  function bindBoxes() {
    var wrap = $('csBoxes');
    if (!wrap) return;
    wrap.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-box]');
      if (!btn) return;
      wrap.querySelectorAll('.cs-box').forEach(function (b) {
        b.classList.toggle('on', b === btn);
      });
      /* 之後換盒款要一起換預覽底圖與可雕刻範圍 ——
         範圍是對著【某一張照片】量的,換照片不換範圍會整個歪掉。 */
    });
  }

  /* ---------- 滑桿 ---------- */

  function bindSliders() {
    if (el.scale) {
      el.scale.addEventListener('input', function () {
        state.scale = Number(el.scale.value) / 100;
        apply();
      });
    }
    if (el.rot) {
      el.rot.addEventListener('input', function () {
        state.rot = Number(el.rot.value);
        apply();
      });
    }
    if (el.reset) {
      el.reset.addEventListener('click', function () {
        state = Object.assign({}, DEFAULT);
        el.scale.value = String(Math.round(DEFAULT.scale * 100));
        el.rot.value = String(DEFAULT.rot);
        apply();
      });
    }
  }

  /* ---------- 起動 ---------- */

  function init() {
    el = {
      stage: $('csStage'),
      plate: $('csPlate'),
      art: $('csArt'),
      artImg: $('csArtImg'),
      stageEmpty: $('csStageEmpty'),
      scale: $('csScale'),
      rot: $('csRot'),
      reset: $('csReset'),
      designs: $('csDesigns'),
      more: $('csMore'),
      search: $('csSearch'),
      pickErr: $('csPickErr')
    };
    if (!el.stage || !el.plate || !el.art) return;

    apply();
    bindDrag();
    bindSliders();
    bindSource();
    bindBoxes();
    bindMarket();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window, document);
