/* =========================================================
   LOHAS Eyewear - Site event detection (dataLayer only)
   GA4 + Meta Pixel base codes are managed by GTM (GTM-MSNPQ36L),
   installed directly in each page's <head>/<body>.
   This file ONLY detects site events and pushes them to dataLayer.
   GTM custom-event triggers pick them up and forward to GA4/Pixel.
   Include once per page in <head>:
     <script src="js/analytics.js?v=20260610-gtm"></script>

   Events pushed (event name / parameters):
   - line_click           { link_url }
   - phone_click          { phone }
   - map_click            { link_url }
   - booking_button_click { label, link_url }   <- booking CTA (secondary conversion)
   - booking_complete     { reservation_id }    <- pushed by booking-modal.js on success (primary conversion)
   - campaign_click       { label }
   - form_submit          { form_id }
   ========================================================= */
(function () {
  'use strict';

  window.dataLayer = window.dataLayer || [];

  function push(eventName, params) {
    var data = { event: eventName };
    if (params) { for (var k in params) { if (params.hasOwnProperty(k)) data[k] = params[k]; } }
    window.dataLayer.push(data);
  }
  // Public API: window.lohasTrack('event_name', { ...params })
  window.lohasTrack = push;

  // Auto event detection (event delegation by link pattern)
  function classify(el) {
    var a = el.closest('a, button');
    if (!a) return null;
    var href = (a.getAttribute('href') || '').toLowerCase();
    var text = (a.textContent || '').trim();

    if (href.indexOf('line.me') > -1 || href.indexOf('line.naver') > -1 || href.indexOf('@585ryopc') > -1) {
      return { ev: 'line_click', p: { link_url: href } };
    }
    if (href.indexOf('tel:') === 0) {
      return { ev: 'phone_click', p: { phone: href.replace('tel:', '') } };
    }
    if (href.indexOf('maps.google') > -1 || href.indexOf('google.com/maps') > -1 ||
        href.indexOf('goo.gl/maps') > -1 || href.indexOf('maps.app') > -1 ||
        a.hasAttribute('data-map')) {
      return { ev: 'map_click', p: { link_url: href } };
    }
    // Booking CTA: reservation buttons, store-locator links, store booking
    // \u9810\u7d04 = "yu-yue" (booking), \u9580\u5e02\u64da\u9ede = "store locations"
    if (a.hasAttribute('data-reservation') || a.hasAttribute('data-booking') ||
        a.getAttribute('data-action') === 'book' ||
        href.indexOf('reservation') > -1 || href.indexOf('booking') > -1 ||
        href.indexOf('allstore') > -1 ||
        text.indexOf('\u9810\u7d04') > -1 || text.indexOf('\u9580\u5e02\u64da\u9ede') > -1) {
      return { ev: 'booking_button_click', p: { label: text, link_url: href } };
    }
    if (a.hasAttribute('data-campaign') || a.closest('[data-campaign]') ||
        a.closest('.hero-banner, .campaign-banner, .banner')) {
      return { ev: 'campaign_click', p: { label: text || 'banner' } };
    }
    return null;
  }

  document.addEventListener('click', function (e) {
    var hit = classify(e.target);
    if (hit) push(hit.ev, hit.p);
  }, true);

  // Form submit -> form_submit
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || form.tagName !== 'FORM') return;
    var fid = form.id || form.getAttribute('name') || 'form';
    push('form_submit', { form_id: fid });
  }, true);

  // Manual page_view for SPA / dynamic pages (GTM History trigger also works)
  window.lohasPageView = function (path, title) {
    push('virtual_page_view', {
      page_path: path || location.pathname,
      page_title: title || document.title
    });
  };

})();
