/* =============================================
   LOHAS Legal Modal
   --------------------------------------------
   通用「隱私權政策 / 服務條款」彈窗模組。
   內容直接 fetch privacy.html / terms.html 的 main 區塊,
   一份內容兩處用,不需要維護兩份。

   依賴: 無 (不依賴 LohasUtils / Auth)
   使用方式:
     1) 在頁面引入: <script src="js/legal-modal.js" defer></script>
        (也可以放在 layout.js 之後)
     2) 任何元素加上 data-legal="privacy" 或 data-legal="terms" 即可觸發
        例如: <a href="privacy.html" data-legal="privacy">隱私權政策</a>
        (a tag 預設行為被攔截,改開 modal;按 cmd/ctrl+click 仍可開新分頁)
     3) JS 主動呼叫:
        window.LohasLegal.open('privacy')
        window.LohasLegal.open('terms')
   ============================================= */

(function (window, document) {
  'use strict';

  const CONFIG = {
    privacy: {
      url: 'privacy.html',
      title: '隱私權政策',
      cacheKey: '_privacyHtml'
    },
    terms: {
      url: 'terms.html',
      title: '服務條款',
      cacheKey: '_termsHtml'
    }
  };

  // 同 session 內快取,避免重複下載
  const cache = {};

  let overlayEl = null;
  let lastFocused = null;

  /* === 建立 modal DOM 容器(只做一次) === */
  function ensureOverlay() {
    if (overlayEl) return overlayEl;

    overlayEl = document.createElement('div');
    overlayEl.className = 'legal-modal-overlay';
    overlayEl.setAttribute('role', 'dialog');
    overlayEl.setAttribute('aria-modal', 'true');
    overlayEl.setAttribute('aria-labelledby', 'legalModalTitle');
    overlayEl.innerHTML = `
      <div class="legal-modal" role="document">
        <div class="legal-modal-head">
          <h2 class="legal-modal-title" id="legalModalTitle">—</h2>
          <button class="legal-modal-close" type="button" aria-label="關閉">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div class="legal-modal-body">
          <div class="legal-modal-loading">
            <i class="fa-solid fa-spinner fa-spin"></i>
            <p>載入中...</p>
          </div>
        </div>
        <div class="legal-modal-foot">
          <span class="legal-modal-foot-meta">© LOHAS 樂活眼鏡</span>
          <a class="legal-modal-foot-link" href="#" target="_blank" rel="noopener">
            <i class="fa-solid fa-up-right-from-square"></i>
            <span>開啟完整頁面</span>
          </a>
        </div>
      </div>
    `;

    document.body.appendChild(overlayEl);

    /* 事件綁定:關閉鈕 */
    overlayEl.querySelector('.legal-modal-close').addEventListener('click', close);

    /* 點背景關閉 */
    overlayEl.addEventListener('click', e => {
      if (e.target === overlayEl) close();
    });

    /* ESC 關閉 */
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && overlayEl.classList.contains('is-open')) {
        close();
      }
    });

    return overlayEl;
  }

  /* === 從 fetch 回來的整頁 HTML 抽出 #legalArticleSource === */
  function extractArticle(htmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');
    const article = doc.getElementById('legalArticleSource');
    if (!article) {
      throw new Error('找不到 #legalArticleSource 內容區塊');
    }
    return article.outerHTML;
  }

  /* === 開啟 modal === */
  async function open(type) {
    const cfg = CONFIG[type];
    if (!cfg) {
      console.warn('[LohasLegal] unknown type:', type);
      return;
    }

    ensureOverlay();
    lastFocused = document.activeElement;

    // 標題 + 「開啟完整頁面」連結
    overlayEl.querySelector('#legalModalTitle').textContent = cfg.title;
    const fullLink = overlayEl.querySelector('.legal-modal-foot-link');
    fullLink.setAttribute('href', cfg.url);

    const body = overlayEl.querySelector('.legal-modal-body');
    body.innerHTML = `
      <div class="legal-modal-loading">
        <i class="fa-solid fa-spinner fa-spin"></i>
        <p>載入中...</p>
      </div>
    `;

    // 顯示
    overlayEl.classList.add('is-open');
    document.body.classList.add('legal-modal-open');

    // 焦點移到關閉鈕(無障礙)
    setTimeout(() => {
      overlayEl.querySelector('.legal-modal-close')?.focus();
    }, 100);

    // 載入內容
    try {
      let html = cache[cfg.cacheKey];
      if (!html) {
        const res = await fetch(cfg.url, { credentials: 'same-origin' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const fullText = await res.text();
        html = extractArticle(fullText);
        cache[cfg.cacheKey] = html;
      }
      body.innerHTML = html;
      body.scrollTop = 0;
    } catch (err) {
      console.error('[LohasLegal] 載入失敗', err);
      body.innerHTML = `
        <div class="legal-modal-loading">
          <i class="fa-solid fa-circle-exclamation"></i>
          <p>內容載入失敗,請改至完整頁面查看。</p>
          <p style="margin-top:14px">
            <a href="${cfg.url}" style="color:var(--lohas-brand)">前往 ${cfg.title}</a>
          </p>
        </div>
      `;
    }
  }

  /* === 關閉 modal === */
  function close() {
    if (!overlayEl) return;
    overlayEl.classList.remove('is-open');
    document.body.classList.remove('legal-modal-open');
    if (lastFocused && typeof lastFocused.focus === 'function') {
      try { lastFocused.focus(); } catch (_) { /* ignore */ }
    }
  }

  /* === 全站 delegate:任何 data-legal="privacy|terms" 都自動接管 === */
  function bindDelegation() {
    document.addEventListener('click', e => {
      const trigger = e.target.closest('[data-legal]');
      if (!trigger) return;

      // 允許 cmd/ctrl+click / middle-click 走預設(開新分頁)
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;

      const type = trigger.getAttribute('data-legal');
      if (!CONFIG[type]) return;

      e.preventDefault();
      open(type);
    });
  }

  /* === 對外 namespace === */
  window.LohasLegal = {
    open,
    close,
    CONFIG
  };

  /* === 啟動 === */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindDelegation);
  } else {
    bindDelegation();
  }

})(window, document);
