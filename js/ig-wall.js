/* ============================================================
   Lohas IG Wall · embed.js 載入器
   ------------------------------------------------------------
   功能：
   1. 用 IntersectionObserver 懶載入：使用者捲到附近才載 IG embed.js
      （embed.js 約 200KB+，又會再要求每則貼文的 oembed 資料，
        放在首頁底部太重，懶載入可改善 LCP）
   2. 若 embed.js 已在頁面其他處載過，會自動呼叫 instgrm.Process()
      讓本區塊的 blockquote 重新渲染
   3. 暴露 window.lohasIgWall 提供手動觸發 API
   ============================================================ */

(function () {
  'use strict';

  const ROOT_ID = 'lohas-ig-wall';
  const EMBED_SRC = 'https://www.instagram.com/embed.js';
  let loaded = false;
  let observer = null;

  function processEmbeds() {
    if (window.instgrm && window.instgrm.Embeds && typeof window.instgrm.Embeds.process === 'function') {
      try {
        window.instgrm.Embeds.process();
      } catch (e) {
        console.warn('[lohas-ig-wall] instgrm.Embeds.process 失敗:', e);
      }
    }
  }

  function loadEmbedScript() {
    if (loaded) {
      processEmbeds();
      return;
    }
    loaded = true;

    // 若頁面其他地方已經載過 embed.js，直接 process 即可
    const exist = document.querySelector('script[src*="instagram.com/embed.js"]');
    if (exist && window.instgrm && window.instgrm.Embeds) {
      processEmbeds();
      return;
    }

    const s = document.createElement('script');
    s.async = true;
    s.src = EMBED_SRC;
    s.onload = function () {
      // embed.js 載入後會自動掃描 DOM 一次。但如果 blockquote 後來才插入
      // （像 layout.js fetch 注入），保險起見再呼叫一次。
      setTimeout(processEmbeds, 50);
    };
    s.onerror = function () {
      console.warn('[lohas-ig-wall] embed.js 載入失敗，IG 貼文無法顯示。');
      const root = document.getElementById(ROOT_ID);
      if (root) root.classList.add('lohas-ig-wall--load-failed');
    };
    document.head.appendChild(s);
  }

  function init() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;

    // 不支援 IntersectionObserver 的舊瀏覽器 → 直接載
    if (!('IntersectionObserver' in window)) {
      loadEmbedScript();
      return;
    }

    observer = new IntersectionObserver(function (entries) {
      for (const ent of entries) {
        if (ent.isIntersecting) {
          loadEmbedScript();
          observer.disconnect();
          observer = null;
          break;
        }
      }
    }, {
      // 提前 400px 觸發，讓使用者捲到時 embed 大致已準備好
      rootMargin: '400px 0px',
      threshold: 0.01
    });

    observer.observe(root);
  }

  // 對外 API：當外部 JS 動態新增 blockquote 時可手動重 process
  window.lohasIgWall = {
    process: processEmbeds,
    forceLoad: loadEmbedScript
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
