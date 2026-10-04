/* 芽芽帶你看客製中心（2026-10-04 樂活營運）：custom.html 一頁帶完（兩個商品、我的作品、圖從哪裡來）
 * 只在樂活 App 裡出現；第一次打開自動帶，之後左下角小芽芽點了再帶一次。外觀與 js/yaya-cloth-guide.js 同一套。 */
(function () {
  'use strict';
  if (!document.documentElement.classList.contains('in-app')) return;

  var ART = 'https://lohas-pet.onrender.com/art/';
  var SEEN = 'yaya_custom_seen_v1';
  var name = '芽芽';
  try {
    var m = location.search.match(/[?&]yname=([^&]+)/);
    if (m) sessionStorage.setItem('yaya_name', decodeURIComponent(m[1]).slice(0, 12));
    name = (window.YAYA_NAME || sessionStorage.getItem('yaya_name') || '芽芽').replace(/[<>&"]/g, '');
  } catch (e) { /* 拿不到就叫芽芽 */ }

  function mode() { return 'hub'; }
  var HEAD = [
    { t: '嗨！我是' + name + '～這裡是<b>客製中心</b>，可以把喜歡的圖做成只有你有的東西。我帶你看一下這頁有什麼！' },
    { sel: '.cc-card[href="cloth.html"]', t: '<b>客製眼鏡布</b>：自己挑圖、畫圖或上傳圖，印成一條專屬的眼鏡布，做好送到你選的門市。生日當月的壽星免費（每人每年一條）。' },
    { sel: '.cc-card[href="case.html"]', t: '<b>客製眼鏡盒</b>：把圖雷刻在眼鏡盒上，線上刷卡付款，做好也是送到門市。送禮自用都適合！' },
    { sel: '#ccMineSec', t: '<b>我的客製作品</b>：做過的每一件都在這裡，看得到製作進度和取貨門市。做好了記得先聯絡門市再去拿喔。' },
    { sel: '.cc-note', t: '圖可以從三個地方來：<b>刻圖市集</b>挑創作者的圖、<b>上傳自己的圖</b>、或<b>直接畫一個</b>。' },
    { t: '想做哪一個就點那張卡片，進去之後我會再一步一步教你！' },
  ];
  var BY_MODE = { hub: [] }, UPLOAD = [], TAIL = [];
  function steps() { return HEAD; }

  var css = document.createElement('style');
  css.textContent = '.yy-ring{outline:3px solid #F2A07B!important;outline-offset:3px;border-radius:6px;box-shadow:0 0 0 9999px rgba(40,30,15,.18)!important;position:relative;z-index:1000}'
    + '.yy-box{position:fixed;left:8px;right:8px;bottom:10px;z-index:2000;display:flex;gap:8px;align-items:flex-end;pointer-events:none;font-family:inherit}'
    + '.yy-pet{position:relative;width:70px;height:70px;flex:0 0 70px;animation:yyB 2.4s ease-in-out infinite}.yy-pet img{position:absolute;inset:0;width:100%;height:100%}'
    + '@keyframes yyB{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}'
    + '.yy-b{pointer-events:auto;flex:1;background:#fffbf0;border:2px solid #d4c5a7;border-radius:16px;padding:10px 12px;box-shadow:0 4px 14px rgba(0,0,0,.18);color:#463a28;font-size:15px;line-height:1.5}'
    + '.yy-b .yy-n{display:flex;justify-content:space-between;align-items:center;margin-top:8px;gap:6px}.yy-b button{border:0;border-radius:12px;padding:6px 12px;font-size:14px;background:#f4e7c8;color:#463a28}'
    + '.yy-b button.go{background:#6b8f71;color:#fff}.yy-b .yy-x{background:none;color:#9a9a9a;padding:0 4px}.yy-b small{color:#9a9a9a}'
    + '.yy-fab{position:fixed;left:10px;bottom:12px;z-index:2000;width:58px;height:58px;border:0;background:none;padding:0}.yy-fab img{position:absolute;inset:0;width:100%;height:100%}';
  document.head.appendChild(css);

  var PET = '<img src="' + ART + 'body.png" alt=""><img src="' + ART + 'eyes_happy.svg" alt=""><img src="' + ART + 'mouth.svg" alt="">';
  var box = null, fab = null, ringed = null, idx = 0;

  function visible(el) { if (!el) return false; var r = el.getBoundingClientRect(); return (r.width > 0 || r.height > 0) && getComputedStyle(el).visibility !== 'hidden'; }
  function target(s) {
    if (!s.sel) return null;
    var list = document.querySelectorAll(s.sel);
    for (var i = 0; i < list.length; i++) if (visible(list[i])) return list[i];
    return null;
  }
  function unring() { if (ringed) { ringed.classList.remove('yy-ring'); ringed = null; } }

  function show() {
    unring();
    var st = steps(), tries = 0;
    while (idx < st.length && st[idx].sel && !target(st[idx]) && tries++ < st.length) idx++; // 看不到的跳過
    if (idx >= st.length) idx = st.length - 1;
    if (idx < 0) idx = 0;
    var s = st[idx], el = target(s);
    if (el) { el.classList.add('yy-ring'); ringed = el; el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    if (fab) { fab.remove(); fab = null; }
    if (!box) { box = document.createElement('div'); box.className = 'yy-box'; document.body.appendChild(box); }
    box.innerHTML = '<div class="yy-pet">' + PET + '</div><div class="yy-b"><div>' + s.t + '</div>'
      + '<div class="yy-n"><small>' + (idx + 1) + '／' + st.length + '</small><span>'
      + (idx > 0 ? '<button type="button" data-a="prev">‹ 上一步</button> ' : '')
      + (idx < st.length - 1 ? '<button type="button" class="go" data-a="next">下一步 ›</button>' : '<button type="button" class="go" data-a="done">知道了</button>')
      + '</span><button type="button" class="yy-x" data-a="close" aria-label="收起">✕</button></div></div>';
  }
  function close() {
    unring(); if (box) { box.remove(); box = null; }
    try { localStorage.setItem(SEEN, '1'); } catch (e) { /* 存不了就算了 */ }
    return; // 客製中心是 App 的分頁：不放常駐小芽芽（App 裡的芽芽點兩下就有「這頁怎麼用」）
    fab = document.createElement('button'); fab.type = 'button'; fab.className = 'yy-fab'; fab.setAttribute('aria-label', '叫' + name + '教我'); fab.innerHTML = PET;
    fab.onclick = function () { idx = 0; show(); }; document.body.appendChild(fab);
  }

  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-a]') : null;
    if (!t || !box || !box.contains(t)) return;
    e.preventDefault(); e.stopPropagation();
    var a = t.getAttribute('data-a'), st = steps();
    if (a === 'next') { idx = Math.min(st.length - 1, idx + 1); show(); }
    else if (a === 'prev') { var j = idx - 1; while (j > 0 && st[j].sel && !target(st[j])) j--; idx = Math.max(0, j); show(); }
    else if (a === 'done' || a === 'close') close();
  }, true);

  // 客人點了框起來的東西 → 等畫面變好再下一步；換了「圖案從哪裡來」→ 跳到那個模式的第一步
  document.addEventListener('click', function (e) {
    if (!box || box.contains(e.target)) return;
    var seg = null;
    if (seg) { setTimeout(function () { if (box) { idx = HEAD.length; show(); } }, 500); return; }
    var s = steps()[idx];
    if (!s || !s.auto || !ringed || !ringed.contains(e.target)) return;
    var at = idx;
    setTimeout(function () { if (idx === at && box) { idx = at + 1; show(); } }, s.auto);
  });

  function start() {
    var seen = false;
    try { seen = localStorage.getItem(SEEN) === '1'; } catch (e) { seen = false; }
    if (seen) close(); else setTimeout(show, 900);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
