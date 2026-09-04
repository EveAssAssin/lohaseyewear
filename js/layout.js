document.addEventListener("DOMContentLoaded", async () => {
  ensureLegalAssets();
  await loadLayout();

  initMobileMenu();
  initMobileDropdown();
  initMegaMenuScrollLock();
  initFooterAccordion();
  initCookieBanner();
  initMemberLink();
  applyMemberPill();

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
  // 等 Supabase ready (最多重試 20 次,每次 100ms = 2 秒)
  let sb = null;
  for (let i = 0; i < 20; i++) {
    sb = window.LohasSupabase
      && window.LohasSupabase.getClient
      && window.LohasSupabase.getClient();
    if (sb) break;
    await new Promise(r => setTimeout(r, 100));
  }
  if (!sb) {
    console.warn('[layout] Supabase 未 ready,使用 footer.html 靜態內容');
    return;
  }

  try {
    const { data, error } = await sb
      .from('site_settings')
      .select('value')
      .eq('key', 'footer')
      .maybeSingle();
    if (error || !data || !data.value) return;
    window._lohasFooterCfg = data.value;
    renderFooter(data.value);
    // 同步更新全站 LINE CTA (有 data-line-cta 屬性的 a)
    syncLineCtas(data.value);
  } catch (e) {
    console.warn('[layout] 動態頁尾載入失敗:', e);
  }
}

/* 把 footer 設定裡的 LINE URL 套到所有 [data-line-cta] 元素 */
function syncLineCtas(cfg) {
  if (!cfg || !cfg.social) return;
  const lineCfg = cfg.social.find(s => s && (s.id === 'line' || /line/i.test(s.label || '')));
  if (!lineCfg || !lineCfg.url || lineCfg.url === '#') return;
  document.querySelectorAll('[data-line-cta]').forEach(el => {
    el.setAttribute('href', lineCfg.url);
  });
}
// 暴露給其他 JS (例如 vipstore 動態 render 後手動觸發)
window.syncLineCtas = syncLineCtas;

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

    /* ⚠ 判斷「有沒有登入」,不是「有沒有 erpid」。
       官網註冊的會員 erpid 是空的(要到門市才綁定),
       用 erpid 判斷的話,他已經登入了卻會被這個連結送回登入頁。

       這裡優先走 LohasAuth.isLogin()(還會處理 7 天過期),
       layout.js 在某些頁面比 auth.js 早載入,所以留一條直讀的退路。 */
    const Auth = window.LohasAuth;
    const member = JSON.parse(localStorage.getItem("lohasMember") || "null");
    const loggedIn = Auth && Auth.isLogin ? Auth.isLogin() : !!member;

    if (loggedIn) {
      window.location.href = "member-portal.html";
      return;
    }

    localStorage.setItem("redirectAfterLogin", "member-portal.html");
    window.location.href = "login.html";
  });
}

/* 右上角的會員區:登入後改成「歡迎，某某」＋一顆登出。
   =================================================================
   未登入   維持原本那顆 CTA 按鈕「會員專區」,完全不動
   已登入   歡迎，某某 ⟨登出⟩ —— 名字不再是 CTA 樣式,
            因為 CTA 是給「還沒登入、快來登入」用的

   ⚠ 一定要用 textContent,不可以用 innerHTML。
     名字來自登入回應(ERP 建檔的資料),對前端而言是【外部輸入】。
     用 innerHTML 的話,一個叫 <img onerror=...> 的名字就是一個 XSS,
     而且它會出現在【每一頁的頁首】—— 影響面是全站,不是一頁。
     (實測過:名字設成 <img src=x onerror=alert(1)> 時畫面上是純文字,
      元素裡沒有產生任何 img。)

   ⚠ 名字要截短。這一整串跟導覽列擠在同一行,長名字擠壞的是全站頁首。
     截掉的部分放進 title,滑過去仍看得到全名;沒截到就不要給 title,
     不然每次滑過去都跳一個沒有用的提示。 */
const NAV_LOGGED_OUT = '會員專區';
/* 有名字就「歡迎，某某」;沒有名字時【不要】變成「歡迎，會員中心」——
   那句話讀起來像在跟一個叫「會員中心」的人打招呼。
   官網註冊、還沒到門市綁定的會員 name 是空的(姓名來自 ERP 建檔),
   對他們講「歡迎回來」一樣看得出已登入,而且是通順的中文。 */
const NAV_GREET      = '歡迎，';
const NAV_NO_NAME    = '歡迎回來';
/* 前面多了「歡迎，」三個字,所以名字要短一點 ——
   這一整串跟導覽列擠在同一行,而擠壞的是全站頁首。 */
const NAV_MAX_CHARS  = 6;

/* 樣式用注入的,不寫進 css/lohas-base.css。
   ⚠ 理由是版本號:全站 lohas-base.css 有九種不同的 ?v=,
     改它就要一頁一頁對照著改,漏一頁那頁的頁首就是壞的 ——
     而且壞掉的樣子是「名字和登出擠成一團」,不會有錯誤訊息。
     這裡沿用 ensureLegalAssets() 已經在用的注入模式,
     版本只有一個、由這支自己控制。 */
function ensureMemberNavStyles() {
  if (document.getElementById('lh-user-style')) return;
  const s = document.createElement('style');
  s.id = 'lh-user-style';
  s.textContent =
    '.lh-user-name{font-weight:600;text-decoration:none;color:inherit;' +
      'max-width:12em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
      'display:inline-block;vertical-align:middle}' +
    '.lh-user-name:hover{text-decoration:underline}' +
    '.lh-logout{margin-left:.6rem;padding:.25rem .7rem;font:inherit;font-size:.85em;' +
      'line-height:1.6;color:inherit;background:transparent;cursor:pointer;' +
      'border:1px solid currentColor;border-radius:999px;opacity:.7;' +
      'vertical-align:middle}' +
    '.lh-logout:hover{opacity:1}';
  document.head.appendChild(s);
}

function applyMemberPill() {
  ensureMemberNavStyles();
  const pills = document.querySelectorAll('[data-member-link]');
  if (!pills.length) return;

  /* 判斷登入與否的寫法與 initMemberLink 保持一致 ——
     兩處若用不同標準,會出現「pill 顯示名字但點下去被送回登入頁」。 */
  const Auth = window.LohasAuth;
  let member = null;
  try {
    member = Auth && Auth.getStoredMember
      ? Auth.getStoredMember()
      : JSON.parse(localStorage.getItem('lohasMember') || 'null');
  } catch (e) {
    member = null;      // localStorage 壞掉或被關閉:當成未登入,不要讓頁首整個掛掉
  }
  const loggedIn = Auth && Auth.isLogin ? Auth.isLogin() : !!member;

  let label = NAV_LOGGED_OUT;
  let full = '';
  let truncated = false;      // 只有真的截短才給 title,不然每次滑過去都跳一個沒用的提示
  if (loggedIn) {
    full = String((member && member.name) || '').trim();
    if (full) {
      truncated = full.length > NAV_MAX_CHARS;
      label = NAV_GREET + (truncated ? full.slice(0, NAV_MAX_CHARS) + '…' : full);
    } else {
      label = NAV_NO_NAME;
    }
  }

  pills.forEach(pill => {
    /* 先移除上一次加的登出鍵。
       ⚠ 這個函式會被重複呼叫(storage 事件、其他分頁登入登出),
         不清掉的話每呼叫一次就多一顆「登出」。 */
    const stale = pill.parentNode &&
      pill.parentNode.querySelector('[data-member-logout]');
    if (stale) stale.remove();

    pill.textContent = label;                 // ⚠ 不是 innerHTML,理由見上面
    if (truncated) pill.title = full;
    else pill.removeAttribute('title');

    if (!loggedIn) {
      /* 未登入維持原本那顆 CTA 按鈕,完全不動 —— 這個改動只影響登入之後。 */
      pill.className = 'btn-primary';
      return;
    }

    /* 已登入:名字不再是一顆 CTA 按鈕(那是給「還沒登入、快來登入」用的),
       改成純文字連結,旁邊擺登出 —— 就是一般網站的作法。
       ⚠ 這個元素仍然帶著 data-member-link,所以點名字進會員中心
         那段路由沿用 initMemberLink(),沒有第二份實作。 */
    pill.className = 'lh-user-name';

    const out = document.createElement('button');
    out.type = 'button';
    out.className = 'lh-logout';
    out.setAttribute('data-member-logout', '1');
    out.textContent = '登出';
    if (pill.parentNode) pill.parentNode.insertBefore(out, pill.nextSibling);
  });
}

/* 登出:一律走 LohasAuth.logout(),不要自己清 localStorage ——
   那支會同時清掉 member 與 token 並導回登入頁,
   自己清一半的話會留下「有 token 沒 member」這種半登入狀態。 */
document.addEventListener('click', event => {
  if (!event.target.closest('[data-member-logout]')) return;
  event.preventDefault();
  if (window.LohasAuth && window.LohasAuth.logout) {
    window.LohasAuth.logout();
  } else {
    // auth.js 沒載到時的退路:至少要真的登出,不能什麼都不做
    localStorage.removeItem('lohasMember');
    localStorage.removeItem('lohasSessionToken');
    window.location.href = 'login.html';
  }
});

/* 在別的分頁登出(或登入)時,這一頁的 pill 也要跟著改 ——
   不然會出現「這頁顯示著名字,點下去卻要求登入」。 */
window.addEventListener('storage', event => {
  /* ⚠ key 名向 LohasAuth.CONFIG 要,不要在這裡再抄一份字串。
     我第一版寫死成 'lohasToken',而實際上是 'lohasSessionToken' ——
     那種錯誤不會報錯,只會讓這個監聽【安靜地永遠不觸發】。
     auth.js 還沒載到時才退回字面值。 */
  const C = (window.LohasAuth && window.LohasAuth.CONFIG) || {};
  const memberKey = C.STORAGE_KEY || 'lohasMember';
  const tokenKey  = C.TOKEN_KEY   || 'lohasSessionToken';
  if (event.key === memberKey || event.key === tokenKey) applyMemberPill();
});

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
