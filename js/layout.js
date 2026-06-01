document.addEventListener("DOMContentLoaded", async () => {
  ensureLegalAssets();
  await loadLayout();

  initMobileMenu();
  initMobileDropdown();
  initMegaMenuScrollLock();
  initFooterAccordion();
  initCookieBanner();
  initMemberLink();

  // 啟動：嘗試從 Supabase 拿動態頁尾資料覆蓋
  applyDynamicFooter();
});

/* 自動載入 legal-modal.js + legal.css (隱私權 / 服務條款 modal)
   全站只要載入 layout.js,任何 data-legal="privacy|terms" 元素都能觸發 modal */
function ensureLegalAssets() {
  // CSS
  if (!document.querySelector('link[data-legal-css]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'css/legal.css?v=20260519';
    link.setAttribute('data-legal-css', '1');
    document.head.appendChild(link);
  }
  // JS
  if (!document.querySelector('script[data-legal-js]')) {
    const s = document.createElement('script');
    s.src = 'js/legal-modal.js?v=20260519';
    s.defer = true;
    s.setAttribute('data-legal-js', '1');
    document.head.appendChild(s);
  }
}

async function loadLayout() {
  const headerTarget = document.getElementById("site-header");
  const footerTarget = document.getElementById("site-footer");

  if (headerTarget) {
    const header = await fetch("components/header.html").then(res => res.text());
    headerTarget.innerHTML = header;
  }

  if (footerTarget) {
    const footer = await fetch("components/footer.html").then(res => res.text());
    footerTarget.innerHTML = footer;
  }
}

/* === 動態頁尾：fetch footer.html 後從 Supabase site_settings 撈最新資料覆蓋 === */
async function applyDynamicFooter() {
  // 1. 確認 Supabase SDK 跟 client 都載好
  const sb = window.LohasSupabase
    && window.LohasSupabase.getClient
    && window.LohasSupabase.getClient();
  if (!sb) return; // 沒 supabase 就用 footer.html 的靜態內容

  try {
    const { data, error } = await sb
      .from('site_settings')
      .select('value')
      .eq('key', 'footer')
      .maybeSingle();
    if (error || !data || !data.value) return;
    renderFooter(data.value);
  } catch (e) {
    console.warn('[layout] 動態頁尾載入失敗:', e);
  }
}

function renderFooter(cfg) {
  const wrap = document.querySelector('.main-footer .footer-container');
  if (!wrap) return;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function isExternal(url) {
    return /^https?:\/\//i.test(url) && !/lohasglasses\.com/i.test(url);
  }

  // 社群
  const socialHtml = (cfg.social || [])
    .filter(s => s && s.enabled !== false && s.url && s.url !== '#')
    .map(s => {
      const ext = isExternal(s.url);
      const target = ext ? ' target="_blank" rel="noopener"' : '';
      return `<a href="${esc(s.url)}" class="social-link"${target}>
        <i class="${esc(s.icon || 'fas fa-link')}"></i> ${esc(s.label)}
      </a>`;
    }).join('');

  // 欄位
  const columnsHtml = (cfg.columns || [])
    .filter(col => col && (col.title || (col.links || []).some(l => l && (l.label || l.url))))
    .map(col => {
    const links = (col.links || [])
      .filter(l => l && (l.label || l.url))
      .map(l => {
        const url = l.url || '#';
        const ext = isExternal(url);
        const target = ext ? ' target="_blank" rel="noopener"' : '';
        return `<li><a href="${esc(url)}"${target}>${esc(l.label || l.url)}</a></li>`;
      }).join('');
    return `<div class="footer-column">
      <h3>${esc(col.title)}</h3>
      <ul>${links}</ul>
    </div>`;
  }).join('');

  // 法規連結
  const legalLinks = cfg.legal || [];
  const legalHtml = legalLinks.map((l, i) => {
    const dataAttr = l.data_legal ? ` data-legal="${esc(l.data_legal)}"` : '';
    const sep = i < legalLinks.length - 1 ? '<span class="footer-legal-sep">·</span>' : '';
    return `<a href="${esc(l.url || '#')}"${dataAttr}>${esc(l.label)}</a>${sep}`;
  }).join('');

  wrap.innerHTML = `
    <div class="footer-links">
      <div class="footer-social-wrap">${socialHtml}</div>
      <div class="footer-columns-wrap">${columnsHtml}</div>
    </div>
    <div class="footer-bottom">
      <div class="footer-legal-links">${legalHtml}</div>
      <p>${esc(cfg.copyright || '')}</p>
    </div>
  `;

  // footer 內容換掉了，原本綁的手機 accordion 失效，重新綁
  initFooterAccordion();
}

/* 會員專區：已登入進 member.html，未登入進 login.html */
function initMemberLink() {
  document.addEventListener("click", event => {
    const memberLink = event.target.closest("[data-member-link]");
    if (!memberLink) return;

    event.preventDefault();

    const member = JSON.parse(localStorage.getItem("lohasMember") || "null");

    if (member && member.erpid) {
      window.location.href = "member-portal.html";
      return;
    }

    localStorage.setItem("redirectAfterLogin", "member-portal.html");
    window.location.href = "login.html";
  });
}

/* 手機版選單 */
function initMobileMenu() {
  const menu = document.getElementById("mobile-menu");
  const navList = document.getElementById("nav-list");

  if (!menu || !navList) return;

  menu.addEventListener("click", () => {
    menu.classList.toggle("active");
    navList.classList.toggle("active");

    document.body.style.overflow = navList.classList.contains("active")
      ? "hidden"
      : "auto";
  });
}

/* 手機版 Mega Menu 點擊展開 */
function initMobileDropdown() {
  const dropdownParents = document.querySelectorAll(".dropdown-parent > a");

  dropdownParents.forEach(parent => {
    parent.addEventListener("click", e => {
      // 手機版且不是「直接外連」才展開下拉
      if (window.innerWidth <= 768 && !parent.dataset.mobileDirect) {
        e.preventDefault();
        parent.parentElement.classList.toggle("active");
      }
    });
  });
}

/* 電腦版 Mega Menu - 用 JS 控制 .open class (避免純 CSS hover 抖動) */
function initMegaMenuScrollLock() {
  const megaMenuParents = document.querySelectorAll(".mega-menu-parent");

  if (!megaMenuParents.length) return;

  megaMenuParents.forEach(parent => {
    let closeTimer = null;

    function open() {
      if (window.innerWidth <= 768) return;
      clearTimeout(closeTimer);
      // 關掉其他開著的 mega menu
      megaMenuParents.forEach(p => { if (p !== parent) p.classList.remove("open"); });
      parent.classList.add("open");
    }

    function scheduleClose() {
      if (window.innerWidth <= 768) return;
      clearTimeout(closeTimer);
      // 100ms 延遲關閉,讓滑鼠有時間移到 mega-menu 區域
      closeTimer = setTimeout(() => {
        parent.classList.remove("open");
      }, 120);
    }

    parent.addEventListener("mouseenter", open);
    parent.addEventListener("mouseleave", scheduleClose);

    // 內部 mega-menu 也綁定,防止滑鼠進入子選單後關閉
    const megaMenu = parent.querySelector(".mega-menu");
    if (megaMenu) {
      megaMenu.addEventListener("mouseenter", open);
      megaMenu.addEventListener("mouseleave", scheduleClose);
    }
  });
}

/* 手機版 Footer 折疊 */
function initFooterAccordion() {
  const footerHeaders = document.querySelectorAll(".footer-column h3");

  footerHeaders.forEach(header => {
    // 避免重複綁
    if (header.dataset.accordionBound) return;
    header.dataset.accordionBound = "1";

    header.addEventListener("click", function () {
      if (window.innerWidth <= 768) {
        this.parentElement.classList.toggle("active");
      }
    });
  });
}

/* Cookie Banner */
function initCookieBanner() {
  const cookieBanner = document.getElementById("cookie-banner");
  const acceptBtn = document.getElementById("accept-cookies");

  if (!cookieBanner || !acceptBtn) return;

  // 防止重複 init (例如某些頁面 layout 重 render)
  if (cookieBanner.dataset.bound) return;
  cookieBanner.dataset.bound = "1";

  // 已同意過 → 直接從 DOM 拿掉 (永遠不會閃出來)
  if (localStorage.getItem("lohas_cookies_accepted")) {
    cookieBanner.remove();
    return;
  }

  // 1.5 秒後滑上來
  setTimeout(() => {
    // 二次保險:萬一同時其他地方寫了 localStorage,這時候也不顯示
    if (localStorage.getItem("lohas_cookies_accepted")) return;
    cookieBanner.classList.add("show");
  }, 1500);

  acceptBtn.addEventListener("click", () => {
    localStorage.setItem("lohas_cookies_accepted", "true");
    cookieBanner.classList.remove("show");
    // 等動畫跑完後完全 remove
    setTimeout(() => cookieBanner.remove(), 700);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const currentPage = location.pathname.split("/").pop() || "index.html";
  const navLinks = document.querySelectorAll(".nav-links a");

  navLinks.forEach((link) => {
    const linkHref = link.getAttribute("href");

    if (linkHref === currentPage) {
      link.classList.add("active");
    }
  });
});
