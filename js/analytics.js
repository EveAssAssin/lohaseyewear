/* =========================================================
   LOHAS 樂活眼鏡 · 全站追蹤碼 (GA4 gtag + Meta Pixel)
   - GA4 測量 ID: G-GPP5W5S8V6
   - Meta Pixel ID: 2432158676817525
   每頁 <head> 引入一行即可:
     <script src="js/analytics.js?v=20260608"></script>
   事件用「連結特徵自動偵測」綁定,無需逐頁標記。
   ========================================================= */
(function () {
  'use strict';

  var GA4_ID = 'G-GPP5W5S8V6';
  var PIXEL_ID = '2432158676817525';

  // ---------- GA4 gtag base ----------
  var gaScript = document.createElement('script');
  gaScript.async = true;
  gaScript.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA4_ID;
  document.head.appendChild(gaScript);

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', GA4_ID); // 預設會送 page_view

  // ---------- Meta Pixel base ----------
  (function (f, b, e, v, n, t, s) {
    if (f.fbq) return;
    n = f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    if (!f._fbq) f._fbq = n;
    n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
    t = b.createElement(e); t.async = true;
    t.src = v;
    s = b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t, s);
  })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
  window.fbq('init', PIXEL_ID);
  window.fbq('track', 'PageView');

  // ---------- 統一事件送出 (同時送 GA4 + Pixel) ----------
  function sendEvent(ga4Name, gaParams, pixelName, pixelParams) {
    try { if (window.gtag) gtag('event', ga4Name, gaParams || {}); } catch (e) {}
    try { if (window.fbq && pixelName) fbq('track', pixelName, pixelParams || {}); } catch (e) {}
  }
  window.lohasTrack = sendEvent; // 對外:手動觸發用 window.lohasTrack('xxx', {...})

  // ---------- 自動事件偵測 (事件委派,動態元素也涵蓋) ----------
  function classify(el) {
    var a = el.closest('a, button');
    if (!a) return null;
    var href = (a.getAttribute('href') || '').toLowerCase();
    var text = (a.textContent || '').trim();

    // LINE 點擊
    if (href.indexOf('line.me') > -1 || href.indexOf('line.naver') > -1 || href.indexOf('@585ryopc') > -1) {
      return { ga: 'line_click', gp: { link_url: href }, px: 'Contact', pp: { method: 'line' } };
    }
    // 電話點擊
    if (href.indexOf('tel:') === 0) {
      return { ga: 'phone_click', gp: { phone: href.replace('tel:', '') }, px: 'Contact', pp: { method: 'phone' } };
    }
    // 地圖 / 門市導航
    if (href.indexOf('maps.google') > -1 || href.indexOf('google.com/maps') > -1 ||
        href.indexOf('goo.gl/maps') > -1 || href.indexOf('maps.app') > -1 ||
        a.hasAttribute('data-map') || /導航|門市地圖|map/i.test(text)) {
      return { ga: 'map_click', gp: { link_url: href }, px: 'FindLocation', pp: {} };
    }
    // 預約按鈕
    if (a.hasAttribute('data-reservation') || href.indexOf('reservation') > -1 ||
        /預約|立即預約|預約配鏡/.test(text)) {
      return { ga: 'reservation_click', gp: { label: text }, px: 'Schedule', pp: {} };
    }
    // 活動 Banner 點擊
    if (a.hasAttribute('data-campaign') || a.closest('[data-campaign]') ||
        a.closest('.hero-banner, .campaign-banner, .banner')) {
      return { ga: 'campaign_click', gp: { label: text || 'banner' }, px: 'ViewContent', pp: { content_type: 'campaign' } };
    }
    return null;
  }

  document.addEventListener('click', function (e) {
    var hit = classify(e.target);
    if (hit) sendEvent(hit.ga, hit.gp, hit.px, hit.pp);
  }, true);

  // ---------- 表單送出 form_submit + Lead ----------
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || form.tagName !== 'FORM') return;
    var fid = form.id || form.getAttribute('name') || 'form';
    sendEvent('form_submit', { form_id: fid }, 'Lead', { content_name: fid });
  }, true);

  // ---------- SPA / 動態載入頁:手動補 page_view 用 ----------
  // 若日後有前端路由,可呼叫 window.lohasPageView('/path','標題')
  window.lohasPageView = function (path, title) {
    try {
      gtag('event', 'page_view', {
        page_path: path || location.pathname,
        page_title: title || document.title
      });
    } catch (e) {}
    try { fbq('track', 'PageView'); } catch (e) {}
  };

})();
