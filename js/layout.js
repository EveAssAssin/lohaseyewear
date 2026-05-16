document.addEventListener("DOMContentLoaded", async () => {
  await loadLayout();

  initMobileMenu();
  initMobileDropdown();
  initMegaMenuScrollLock();
  initFooterAccordion();
  initCookieBanner();
  initMemberLink();
});

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
