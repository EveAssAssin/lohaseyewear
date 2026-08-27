/*
 * page-banner.js
 * 通用頁面 banner 載入器
 *
 * 每個頁面只要在 <body> 加 data-banner-pos="engraving" (or market, gallery, home_hero)
 * 並在 hero 圖<img> 加 id="pageHeroImg"
 * 就會自動從 banners 表載入並覆蓋
 */

(function(){
  'use strict';

  document.addEventListener('DOMContentLoaded', loadPageBanner);

  async function loadPageBanner() {
    const pos = document.body.dataset.bannerPos;
    if (!pos) return;

    const sb = window.LohasSupabase && window.LohasSupabase.getClient && window.LohasSupabase.getClient();
    if (!sb) return;

    const { data, error } = await sb.from('banners')
      .select('*')
      .eq('position', pos)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .limit(1);

    if (error || !data || !data.length) return;
    const b = data[0];

    // 替換背景圖
    if (b.image_url) {
      const heroImg = document.getElementById('pageHeroImg');
      if (heroImg) heroImg.src = b.image_url;

      // 替換 <source> srcset (若有 picture)
      const heroImgParent = heroImg?.parentElement;
      if (heroImgParent?.tagName === 'PICTURE') {
        heroImgParent.querySelectorAll('source').forEach(s => {
          s.srcset = b.image_url;
        });
      }
    }

    // 替換文字 (可選)
    if (b.title) {
      const titleEl = document.querySelector('[data-banner-title]');
      if (titleEl) titleEl.textContent = b.title;
    }
    if (b.subtitle) {
      const subEl = document.querySelector('[data-banner-subtitle]');
      if (subEl) subEl.textContent = b.subtitle;
    }
    if (b.cta_text || b.link_url) {
      const ctaEl = document.querySelector('[data-banner-cta]');
      if (ctaEl) {
        if (b.cta_text) ctaEl.textContent = b.cta_text;
        if (b.link_url) ctaEl.href = b.link_url;
      }
    }

    applyBannerLink(b.link_url, b.title);
  }

  /* 讓 banner 圖可以點。
     -----------------------------------------------------------------
     ⚠ 這一段補的是一個沉默的坑:上面那三個 [data-banner-*] 掛鉤
     【整站沒有任何一頁有】,所以在首頁主打以外的位置,後台填的
     標題、副標、按鈕文字、連結全部不會有任何作用 —— 填了沒反應,
     而且沒有錯誤訊息。標題那幾項各頁本來就有自己的文案,先不動;
     但「連結」是後台明確要填的東西,不能填了沒用。

     做法:在圖片的容器裡疊一層鋪滿的透明 <a>,不去包裝原本的
     <img>/<picture> —— 包裝會改變版面,疊一層不會。
     hero 上的文字與按鈕是另一個容器、疊在更上面,不受影響。 */
  function applyBannerLink(url, title) {
    url = (url || '').trim();
    if (!url) return;

    const img = document.getElementById('pageHeroImg');
    if (!img) return;

    // <picture> 的話要往上一層,不然 <a> 會被塞進 <picture> 裡面
    let host = img.parentElement;
    if (host && host.tagName === 'PICTURE') host = host.parentElement;
    if (!host) return;

    // 容器沒有定位基準的話,absolute 會跑到更外層去
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

    const a = document.createElement('a');
    a.href = url;
    a.className = 'page-banner-cover';
    a.setAttribute('aria-label', title || '前往活動頁');
    let external = false;
    try {
      external = new URL(url, location.href).origin !== location.origin;
    } catch (e) { /* 解析不出來就當站內 */ }
    if (external) { a.target = '_blank'; a.rel = 'noopener'; }

    /* ⚠ pointer-events:auto 不能省。
       分享牆的 .hero-bg 自己是 pointer-events:none(它只是背景圖,
       不希望擋住上面的按鈕),而這個 <a> 放在裡面會【繼承】那個值 ——
       連結存在、看得到、卻一格都收不到點擊。
       其他頁沒有這個設定,所以只在分享牆會出事,最容易漏掉。 */
    a.style.cssText = 'position:absolute;inset:0;display:block;z-index:1;pointer-events:auto';
    host.appendChild(a);
  }
})();
