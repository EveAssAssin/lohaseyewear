document.addEventListener("DOMContentLoaded", () => {
  initNewsFilter();
  initLoadMore();
  initNewsSearch();
});

/* =========================
   分類篩選
========================= */

function initNewsFilter() {
  const filterButtons = document.querySelectorAll(".filter-btn");
  const cards = document.querySelectorAll(".news-card");
  const loadMoreBtn = document.getElementById("loadMoreBtn");

  if (!filterButtons.length || !cards.length) return;

  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const filter = button.dataset.filter;

      filterButtons.forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");

      cards.forEach((card) => {
        const category = card.dataset.category;
        const isMatch = filter === "all" || category === filter;

        card.classList.remove("is-filter-hidden");

        if (!isMatch) {
          card.classList.add("is-filter-hidden");
        }

        if (filter !== "all") {
          card.classList.remove("is-hidden-card");
        }
      });

      if (loadMoreBtn) {
        if (filter === "all") {
          const hiddenCards = document.querySelectorAll(".news-card.is-hidden-card");
          loadMoreBtn.classList.toggle("is-hidden", hiddenCards.length === 0);
        } else {
          loadMoreBtn.classList.add("is-hidden");
        }
      }
    });
  });
}

/* =========================
   更多文章
========================= */

function initLoadMore() {
  const loadMoreBtn = document.getElementById("loadMoreBtn");

  if (!loadMoreBtn) return;

  loadMoreBtn.addEventListener("click", () => {
    const hiddenCards = document.querySelectorAll(".news-card.is-hidden-card");

    hiddenCards.forEach((card) => {
      card.classList.remove("is-hidden-card");
    });

    loadMoreBtn.classList.add("is-hidden");
  });
}

/* =========================
   搜尋文章
========================= */

function initNewsSearch() {
  const searchInput = document.getElementById("newsSearchInput");
  const cards = document.querySelectorAll(".news-card");
  const filterButtons = document.querySelectorAll(".filter-btn");
  const loadMoreBtn = document.getElementById("loadMoreBtn");

  if (!searchInput || !cards.length) return;

  searchInput.addEventListener("input", () => {
    const keyword = searchInput.value.trim().toLowerCase();

    filterButtons.forEach((btn) => btn.classList.remove("active"));

    const allButton = document.querySelector('.filter-btn[data-filter="all"]');
    if (allButton) allButton.classList.add("active");

    cards.forEach((card) => {
      card.classList.remove("is-hidden-card");

      const text = card.innerText.toLowerCase();
      const isMatch = text.includes(keyword);

      if (!keyword || isMatch) {
        card.classList.remove("is-filter-hidden");
      } else {
        card.classList.add("is-filter-hidden");
      }
    });

    if (loadMoreBtn) {
      loadMoreBtn.classList.add("is-hidden");
    }
  });
}
