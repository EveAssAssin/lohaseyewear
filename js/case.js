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

  var el = {};

  function $(id) { return document.getElementById(id); }

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
         範圍框是斜的(CSS 有 skew),所以這個換算是近似值 ——
         在這個角度下誤差看不出來,但真的要精準定位時
         要改成把游標座標反投影回平面。 */
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
        if (el.scale) el.scale.value = String(Math.round(DEFAULT.scale * 100));
        if (el.rot) el.rot.value = String(DEFAULT.rot);
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
      scale: $('csScale'),
      rot: $('csRot'),
      reset: $('csReset')
    };
    if (!el.stage || !el.plate || !el.art) return;

    apply();
    bindDrag();
    bindSliders();
    bindSource();
    bindBoxes();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window, document);
