/* ============================================================
   樂活眼鏡 · 前台 Footer 動態載入器
   ------------------------------------------------------------
   從 Supabase site_settings 表抓 key='footer' 的 JSON，
   動態渲染 footer 區塊（社群、欄位連結、法規連結、版權）。
   ------------------------------------------------------------
   使用方式：
   <footer id="site-footer-root"></footer>
   <script src="js/supabase.js"></script>
   <script src="js/footer-loader.js"></script>
   ============================================================ */

(function () {
  'use strict';

  // === 預設值（萬一 Supabase 抓不到或還沒建表，至少有東西可看） ===
  const FALLBACK = {
    social: [
      { id: 'facebook', label: 'Facebook', icon: 'fab fa-facebook-f', url: '#', enabled: true },
      { id: 'instagram', label: 'Instagram', icon: 'fab fa-instagram', url: '#', enabled: true },
      { id: 'threads', label: 'Threads', icon: 'fa-brands fa-threads', url: '#', enabled: true },
      { id: 'youtube', label: 'YouTube', icon: 'fab fa-youtube', url: '#', enabled: true },
      { id: 'line', label: 'LINE', icon: 'fab fa-line', url: '#', enabled: true }
    ],
    columns: [],
    legal: [
      { label: '隱私權政策', url: 'privacy.html', data_legal: 'privacy' },
      { label: '服務條款', url: 'terms.html', data_legal: 'terms' }
    ],
    copyright: '© 2026 Lohas 樂活眼鏡 All Rights Reserved.'
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function isExternal(url) {
    return /^https?:\/\//i.test(url) && !/lohasglasses\.com/i.test(url);
  }

  function render(footer) {
    footer = footer || FALLBACK;

    // 社群連結
    const socialHtml = (footer.social || [])
      .filter(s => s && s.enabled !== false && s.url && s.url !== '#')
      .map(s => `
        <a href="${esc(s.url)}" class="social-link" target="_blank" rel="noopener">
          <i class="${esc(s.icon || 'fas fa-link')}"></i> ${esc(s.label)}
        </a>
      `).join('');

    // 欄位區塊
    const columnsHtml = (footer.columns || []).map(col => {
      const links = (col.links || [])
        .filter(l => l && l.label)
        .map(l => {
          const ext = isExternal(l.url);
          const target = ext ? ' target="_blank" rel="noopener"' : '';
          return `<li><a href="${esc(l.url || '#')}"${target}>${esc(l.label)}</a></li>`;
        }).join('');
      return `
        <div class="footer-column">
          <h3>${esc(col.title)}</h3>
          <ul>${links}</ul>
        </div>
      `;
    }).join('');

    // 法規連結
    const legalLinks = footer.legal || [];
    const legalHtml = legalLinks.map((l, i) => {
      const dataAttr = l.data_legal ? ` data-legal="${esc(l.data_legal)}"` : '';
      const sep = i < legalLinks.length - 1 ? '<span class="footer-legal-sep">·</span>' : '';
      return `<a href="${esc(l.url || '#')}"${dataAttr}>${esc(l.label)}</a>${sep}`;
    }).join('');

    return `
      <footer class="main-footer">
        <div class="footer-container">
          <div class="footer-links">

            <div class="footer-social-wrap">${socialHtml}</div>

            <div class="footer-columns-wrap">${columnsHtml}</div>

          </div>

          <div class="footer-bottom">
            <div class="footer-legal-links">${legalHtml}</div>
            <p>${esc(footer.copyright || '')}</p>
          </div>
        </div>
      </footer>
    `;
  }

  async function fetchFooter() {
    const sb = window.LohasSupabase && window.LohasSupabase.getClient && window.LohasSupabase.getClient();
    if (!sb) return null;
    try {
      const { data, error } = await sb
        .from('site_settings')
        .select('value')
        .eq('key', 'footer')
        .maybeSingle();
      if (error) {
        console.warn('[footer-loader] supabase error:', error.message);
        return null;
      }
      return data ? data.value : null;
    } catch (e) {
      console.warn('[footer-loader] fetch failed:', e);
      return null;
    }
  }

  async function init() {
    // 找掛載點：優先 #site-footer，相容舊版（footer.html 已掛載的 .main-footer 也直接取代）
    let mount = document.getElementById('site-footer');
    if (!mount) {
      mount = document.querySelector('.main-footer');
    }
    if (!mount) {
      // 沒掛載點：建立一個附在 body 末
      mount = document.createElement('div');
      mount.id = 'site-footer';
      document.body.appendChild(mount);
    }

    // 先用 fallback 渲染（避免 layout shift）
    mount.outerHTML = render(FALLBACK);

    // 再嘗試從 Supabase 抓正式資料
    const footer = await fetchFooter();
    if (footer) {
      const cur = document.querySelector('.main-footer');
      if (cur) cur.outerHTML = render(footer);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
