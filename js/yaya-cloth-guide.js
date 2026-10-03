/* 芽芽教你做客製眼鏡布（2026-10-03 樂活營運）
 * 只在樂活 App 裡（app-mode.js 的 html.in-app）出現；一般瀏覽器完全不會有。
 * 第一次打開 cloth.html 自動帶一遍；之後左下角有一隻小芽芽，點了再帶一次。
 * 步驟跟著「圖案從哪裡來」切換：刻圖市集／自己畫／打字／上傳圖，各有自己的教學。
 * 不改 cloth.js 的任何東西：只框出畫面上的元素、在下面講話（點框起來的東西會自動進下一步）。
 * 芽芽的名字：App 若有帶（?yname=… 或 window.YAYA_NAME）就用客人取的名字，沒有就叫「芽芽」。
 * ⚠ 不用 alert／confirm（App 內建瀏覽器沒有 JS 對話框）。
 * 對應：樂活 lohas-pet 寵物服務的圖（/art/），樂活主後端合約系統 public/frontend/js/yaya-guide.js 同一套外觀。 */
(function () {
  'use strict';
  if (!document.documentElement.classList.contains('in-app')) return;

  var ART = 'https://lohas-pet.onrender.com/art/';
  var SEEN = 'yaya_cloth_seen_v1';
  var name = '芽芽';
  try {
    var m = location.search.match(/[?&]yname=([^&]+)/);
    if (m) sessionStorage.setItem('yaya_name', decodeURIComponent(m[1]).slice(0, 12));
    name = (window.YAYA_NAME || sessionStorage.getItem('yaya_name') || '芽芽').replace(/[<>&"]/g, '');
  } catch (e) { /* 拿不到就叫芽芽 */ }

  function mode() {
    var b = document.querySelector('#clSource .cl-seg-btn.on[data-src]');
    return (b && b.getAttribute('data-src')) || 'market';
  }

  // auto：客人按了框起來的東西就自動下一步（ms 後）
  var HEAD = [
    { t: '嗨！我是' + name + '～我來教你做一條專屬的眼鏡布！跟著我一步一步來，隨時可以按 ✕ 收起來。' },
    { sel: '#clSource', t: '先決定圖案從哪裡來：<b>刻圖市集</b>挑別人設計好的、<b>自己畫</b>用手指畫、<b>打字</b>刻一段字、<b>上傳圖</b>用手機裡的照片。按一個試試看！', auto: 900 },
    { sel: '#clStage', t: '這是眼鏡布的預覽，放上去的圖案會出現在這裡，之後還可以調大小和位置。' },
  ];
  var BY_MODE = {
    market: [
      { sel: '#clSearch', t: '可以打刻圖名稱或創作者的名字來找。' },
      { sel: '#clDesigns', t: '點一張喜歡的刻圖，它就會放到眼鏡布上！', auto: 900 },
    ],
    draw: [
      { sel: '#clCanvas', t: '用手指在這張白色畫布上畫，黑色線條就是會刻出來的樣子。<b>畫粗一點、線條清楚</b>效果最好！' },
      { sel: '#clBrush', t: '這條可以調筆畫粗細，往右拉比較粗。' },
      { sel: '.cl-draw-btns', t: '畫錯了按「上一步」，想重來就「全部清掉」。' },
      { sel: '#clApply', t: '畫好了按「把這張放上去」，會自動轉成刻印用的線稿。', auto: 1200 },
    ],
    text: [
      { sel: '#clTextInput', t: '打想刻的字，最多 24 個字，可以換行。例如「生日快樂」。' },
      { sel: '#clTextFont', t: '選一個字型。畫面上看到的樣子，就是刻出來的樣子喔！' },
      { sel: '#clTextApply', t: '好了按「把這段字放上去」。', auto: 1200 },
    ],
  };
  var UPLOAD = [{ sel: '#clUpload', t: '也可以上傳手機裡的圖，系統會自動轉成線稿。<b>簡單、黑白分明</b>的圖效果最好；照片會比較糊喔。' }];
  var TAIL = [
    { sel: '#clPlaceCard', t: '拉這三條調整<b>大小、左右、上下</b>，上面的預覽會跟著動。弄亂了可以按「重設」。' },
    { sel: '#clStoreCard', t: '選要到哪一家門市拿眼鏡布（一定要選）。做好會送到那家店。' },
    { sel: '#clCampaignNote', t: '這是免費服務！領取的時候要給門市看你在 THREADS 分享作品的貼文喔。' },
    { sel: '#clSubmit', t: '都弄好了就按「確認製作並儲存」！按不下去的話，下面那行小字會告訴你還差什麼。' },
  ];
  function steps() {
    var md = mode();
    return HEAD.concat(BY_MODE[md] || BY_MODE.market, md === 'market' ? UPLOAD : [], TAIL);
  }

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
    if (fab) return;
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
    var seg = e.target.closest && e.target.closest('#clSource .cl-seg-btn[data-src]');
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
