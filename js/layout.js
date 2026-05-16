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
      if (window.innerWidth <= 768) {
        e.preventDefault();
        parent.parentElement.classList.toggle("active");
      }
    });
  });
}

/* 電腦版 Mega Menu 開啟時禁止背景捲動 */
function initMegaMenuScrollLock() {
  const megaMenuParent = document.querySelector(".mega-menu-parent");

  if (!megaMenuParent) return;

  megaMenuParent.addEventListener("mouseenter", () => {
    if (window.innerWidth > 768) {
      document.body.classList.add("no-scroll");
    }
  });

  megaMenuParent.addEventListener("mouseleave", () => {
    if (window.innerWidth > 768) {
      document.body.classList.remove("no-scroll");
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

  if (!localStorage.getItem("lohas_cookies_accepted")) {
    setTimeout(() => {
      cookieBanner.classList.add("show");
    }, 1500);
  }

  acceptBtn.addEventListener("click", () => {
    cookieBanner.classList.remove("show");
    cookieBanner.classList.add("is-hide");

    localStorage.setItem("lohas_cookies_accepted", "true");
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
