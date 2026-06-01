document.addEventListener("DOMContentLoaded", () => {
  const Supabase = window.LohasSupabase;
  const Auth = window.LohasAuth;
  const supabaseClient = Supabase?.getClient?.() || null;

  const SUPABASE_TABLE = Supabase?.CONFIG?.POSTS_TABLE || "gallery_posts";
  const FAVORITES_TABLE = Supabase?.CONFIG?.FAVORITES_TABLE || "gallery_favorites";

  const galleryGrid = document.getElementById("galleryGrid");
  const detailModal = document.getElementById("detailModal");
  const closeDetail = document.getElementById("closeDetail");
  const detailBody = document.getElementById("detailBody");
  const toast = document.getElementById("toast");

  const mobileFilterBtn = document.getElementById("mobileFilterBtn");
  const mobileTopicFilter = document.getElementById("mobileTopicFilter");
  const mobileCarrierFilter = document.getElementById("mobileCarrierFilter");
  const filterDrawer = document.getElementById("filterDrawer");
  const drawerClose = document.getElementById("drawerClose");
  const drawerApply = document.getElementById("drawerApply");
  const drawerReset = document.getElementById("drawerReset");

  const desktopTopicFilter = document.getElementById("desktopTopicFilter");
  const desktopCarrierFilter = document.getElementById("desktopCarrierFilter");
  const desktopSearchInput = document.getElementById("desktopSearchInput");
  const mobileSearchInput = document.getElementById("mobileSearchInput");

  // === [subtag] === 子類 chip 容器 (主類聯動)
  const subtagBar = document.getElementById("subtagBar");
  const subtagChipsEl = document.getElementById("subtagChips");

  const filterState = {
    topic: "全部作品",
    carrier: "全部位置",
    keyword: "",
    cardType: "all", // "all" | "photo" | "story"
    subtag: ""
  };

  function getMember() {
    return Auth?.getStoredMember?.()
      ?? JSON.parse(localStorage.getItem("lohasMember") || "null");
  }

  function showToast(message) {
    if (!toast) return;

    toast.textContent = message;
    toast.classList.add("is-show");

    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
      toast.classList.remove("is-show");
    }, 1800);
  }

  function maskName(name) {
    const cleanName = (name || "顧客").trim();

    if (cleanName.length <= 1) return `${cleanName}＊`;

    const first = cleanName.slice(0, 1);
    const suffix = cleanName.includes("先生")
      ? "生"
      : cleanName.includes("小姐")
        ? "姐"
        : cleanName.slice(-1);

    return `${first}＊${suffix}`;
  }

  // === [subtag] === 主類聯動: 渲染對應的子類 chip
  function renderSubtagBar(topic) {
    if (!subtagBar || !subtagChipsEl) return;

    // 主類是「全部照片」/「想刻什麼？」/ 任何非已知主類 → 隱藏
    const subtags = (window.LohasSubcategories || {})[topic] || null;

    if (!subtags) {
      subtagBar.style.display = "none";
      subtagChipsEl.innerHTML = "";
      filterState.subtag = "";
      return;
    }

    subtagBar.style.display = "";

    // 第一個固定是「全部」
    const allItems = ["全部", ...subtags];

    subtagChipsEl.innerHTML = allItems
      .map(tag => {
        const isActive = (tag === "全部" && !filterState.subtag) || tag === filterState.subtag;
        return `<button type="button" class="subtag-chip${isActive ? " is-active" : ""}" data-subtag="${tag === "全部" ? "" : tag}">${tag}</button>`;
      })
      .join("");
  }

  function openDetailModal(card) {
    if (!detailModal || !detailBody) return;

    const images = (card.dataset.images || card.querySelector("img")?.src || "")
      .split(",")
      .map(item => item.trim())
      .filter(Boolean);

    const title = card.querySelector(".title")?.textContent || "未命名作品";
    const topic = card.dataset.topic || "未分類主題";
    const carrier = card.dataset.carrier || "未分類位置";
    const name = card.dataset.name || card.querySelector(".desc")?.textContent || "顧客";
    const story = card.dataset.story || "這是一份來自顧客的真實刻圖分享。";
    const mainImage = images[0] || "images/lens-01.jpg";
    const subImages = images.slice(1, 3);

    const tags = (card.dataset.subcategories || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);

    const tagsHTML = tags.length
      ? `<div class="detail-tags">${tags
          .map(t => `<span class="detail-tag">${t}</span>`)
          .join("")}</div>`
      : "";

    detailBody.innerHTML = `
      <div class="detail-gallery">
        <div class="detail-main-image">
          <img src="${mainImage}" alt="${title}" />
        </div>

        <div class="detail-sub-list">
          ${subImages.map(src => `
            <div class="detail-sub-image">
              <img src="${src}" alt="${title}" />
            </div>
          `).join("")}
        </div>
      </div>

      <div class="detail-title-row">
        <h3 class="detail-title">${title}</h3>
        <span class="detail-user">${name}</span>
      </div>

      <div class="detail-meta">
        <span class="detail-chip">${topic}</span>
        <span class="detail-chip">${carrier}</span>
      </div>

      ${tagsHTML}

      <p class="detail-story">${story}</p>
    `;

    detailModal.classList.add("is-open");
    detailModal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeDetailModal() {
    if (!detailModal) return;

    detailModal.classList.remove("is-open");
    detailModal.setAttribute("aria-hidden", "true");

    if (window.LohasUpload?.isPreviewMode?.()) {
      window.LohasUpload.backToUploadModal();
      return;
    }

    document.body.style.overflow = "";
  }

  function renderGalleryCard(post, prepend = false) {
    if (!galleryGrid) return;

    const imageUrl =
      post.image_urls?.[0] ||
      post.main_image_url ||
      "images/lens-01.jpg";

    // 樂活官方上傳的 (member_id='OFFICIAL') 不遮罩,直接顯示完整名字
    const isOfficial = post.member_id === 'OFFICIAL';
    const displayName = isOfficial
      ? (post.customer_name || 'LOHAS 樂活眼鏡')
      : maskName(post.customer_name || "顧客");

    const storyText = post.story || "";
    const cardType = post.type || (storyText.length >= 50 ? "story" : "photo");
    const isStory = cardType === "story";

    let storyQuote = "";
    if (isStory) {
      const firstLine = storyText.split(/[。\n\r]/)[0].trim();
      storyQuote = firstLine.length > 30
        ? firstLine.slice(0, 30) + "..."
        : firstLine;
    }

    const card = document.createElement("a");
    card.href = "#";
    card.className = isStory ? "plan1-card is-story" : "plan1-card";
    card.dataset.topic = post.topic || "";
    card.dataset.carrier = post.carrier || "";
    card.dataset.name = displayName;
    card.dataset.story = storyText || "這是一份來自顧客的真實刻圖照片分享。";
    card.dataset.images = (post.image_urls || [imageUrl]).join(",");
    card.dataset.type = cardType;
    card.dataset.subcategories = (post.subcategories || []).join(",");

    const iconClass = isStory ? "fa-solid fa-book-open" : "fa-solid fa-camera";
    const quoteHTML = isStory
      ? `<p class="card-quote">「${storyQuote}」</p>`
      : "";

    card.innerHTML = `
      <div class="img-box">
        <span class="icon-badge"><i class="${iconClass}"></i></span>
        <img src="${imageUrl}" alt="${post.title || "刻圖照片"}" />

        <button class="favorite-btn" type="button" data-post-id="${post.id}" aria-label="收藏照片">
          <i class="fa-regular fa-heart"></i>
        </button>
      </div>

      <div class="info">
        <div>
          ${quoteHTML}
          <div class="topic-pill">${post.topic || "靈感主題"}</div>
          <div class="title">${post.title || "未命名作品"}</div>
          <div class="desc">${displayName}</div>
        </div>
      </div>
    `;

    if (prepend) galleryGrid.prepend(card);
    else galleryGrid.appendChild(card);
  }

  async function loadPostsFromSupabase() {
    if (!supabaseClient) {
      applyFilters();
      showToast("Supabase 尚未設定");
      return;
    }

    const { data, error } = await supabaseClient
      .from(SUPABASE_TABLE)
      .select("id,title,topic,carrier,story,type,customer_name,member_id,image_urls,main_image_url,subcategories,created_at,status")
      .eq("is_public", true)
      .eq("status", "approved")
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      showToast("讀取照片失敗,請檢查 Supabase 設定");
      return;
    }

    data.forEach(post => renderGalleryCard(post, true));
    applyFilters();
    loadMyFavoriteStates();
  }

  function applyFilters() {
    const cards = Array.from(document.querySelectorAll(".plan1-card"));
    let visibleCount = 0;

    cards.forEach(card => {
      const topic = card.dataset.topic || "";
      const carrier = card.dataset.carrier || "";

      const normalizedTopic =
        filterState.topic === "想刻什麼？" ||
        filterState.topic === "全部照片"
          ? "全部作品"
          : filterState.topic;

      const normalizedCarrier =
        filterState.carrier === "刻在哪裡？"
          ? "全部位置"
          : filterState.carrier;

      const keyword = (filterState.keyword || "").toLowerCase().trim();
      const title = card.querySelector(".title")?.textContent.toLowerCase() || "";
      const desc = card.querySelector(".desc")?.textContent.toLowerCase() || "";
      const tags = `${topic} ${carrier} ${title} ${desc}`.toLowerCase();

      const matchTopic =
        normalizedTopic === "全部作品" ||
        normalizedTopic === "全部照片" ||
        topic === normalizedTopic;

      const matchCarrier =
        normalizedCarrier === "全部位置" ||
        carrier === normalizedCarrier;

      const matchKeyword = !keyword || tags.includes(keyword);

      const matchCardType =
        filterState.cardType === "all" ||
        card.dataset.type === filterState.cardType;

      // === [subtag] === 子類比對 (有選才比對, 沒選 = 全部)
      const cardSubtags = (card.dataset.subcategories || "").split(",").map(s => s.trim());
      const matchSubtag = !filterState.subtag || cardSubtags.includes(filterState.subtag);

      const shouldShow = matchTopic && matchCarrier && matchKeyword && matchCardType && matchSubtag;

      card.style.display = shouldShow ? "block" : "none";
      if (shouldShow) visibleCount += 1;
    });
  }

  function syncDesktopFilters() {
    if (desktopTopicFilter) filterState.topic = desktopTopicFilter.value;
    if (desktopCarrierFilter) filterState.carrier = desktopCarrierFilter.value;
    if (desktopSearchInput) filterState.keyword = desktopSearchInput.value;

    // === [subtag] === 主類變了 → 重渲染子類 chip + 清空已選子類
    filterState.subtag = "";
    renderSubtagBar(filterState.topic);

    applyFilters();
  }

  async function toggleFavorite(postId, btn) {
    if (Auth?.requireLogin) {
      if (!Auth.requireLogin("gallery.html")) return;
    } else {
      const fallbackMember = JSON.parse(localStorage.getItem("lohasMember") || "null");
      if (!fallbackMember || !fallbackMember.erpid) {
        localStorage.setItem("redirectAfterLogin", "gallery.html");
        window.location.href = "login.html";
        return;
      }
    }

    const member = getMember();
    if (!member?.erpid) return;

    if (!supabaseClient) {
      showToast("Supabase 尚未設定");
      return;
    }

    const { data: existed, error: checkError } = await supabaseClient
      .from(FAVORITES_TABLE)
      .select("id")
      .eq("member_id", member.erpid)
      .eq("post_id", postId)
      .maybeSingle();

    if (checkError) {
      console.error(checkError);
      showToast("收藏狀態讀取失敗");
      return;
    }

    if (existed) {
      const { error: deleteError } = await supabaseClient
        .from(FAVORITES_TABLE)
        .delete()
        .eq("id", existed.id);

      if (deleteError) {
        console.error(deleteError);
        showToast("取消收藏失敗");
        return;
      }

      btn.classList.remove("is-active");
      btn.innerHTML = '<i class="fa-regular fa-heart"></i>';
      showToast("已取消收藏");
      return;
    }

    const { error: insertError } = await supabaseClient
      .from(FAVORITES_TABLE)
      .insert({
        member_id: member.erpid,
        post_id: postId
      });

    if (insertError) {
      console.error(insertError);
      showToast("加入收藏失敗");
      return;
    }

    btn.classList.add("is-active");
    btn.innerHTML = '<i class="fa-solid fa-heart"></i>';
    showToast("已加入收藏");
  }

  async function loadMyFavoriteStates() {
    const member = getMember();
    if (!member?.erpid || !supabaseClient) return;

    const { data, error } = await supabaseClient
      .from(FAVORITES_TABLE)
      .select("post_id")
      .eq("member_id", member.erpid);

    if (error) {
      console.error(error);
      return;
    }

    const favoriteIds = new Set(data.map(item => String(item.post_id)));

    document.querySelectorAll(".favorite-btn").forEach(btn => {
      const postId = String(btn.dataset.postId);

      if (favoriteIds.has(postId)) {
        btn.classList.add("is-active");
        btn.innerHTML = '<i class="fa-solid fa-heart"></i>';
      } else {
        btn.classList.remove("is-active");
        btn.innerHTML = '<i class="fa-regular fa-heart"></i>';
      }
    });
  }

  function openFilterDrawer() {
    if (!filterDrawer) return;
    filterDrawer.classList.add("is-open");
    filterDrawer.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeFilterDrawer() {
    if (!filterDrawer) return;
    filterDrawer.classList.remove("is-open");
    filterDrawer.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  closeDetail?.addEventListener("click", closeDetailModal);

  detailModal?.addEventListener("click", event => {
    if (event.target === detailModal) closeDetailModal();
  });

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    if (detailModal?.classList.contains("is-open")) closeDetailModal();
    if (filterDrawer?.classList.contains("is-open")) closeFilterDrawer();
  });

  if (mobileFilterBtn && filterDrawer) {
    mobileFilterBtn.addEventListener("click", openFilterDrawer);
    drawerClose?.addEventListener("click", closeFilterDrawer);

    drawerApply?.addEventListener("click", () => {
      closeFilterDrawer();
      // === [subtag] === drawer 套用後也要重渲染子類 chip
      renderSubtagBar(filterState.topic);
      applyFilters();
      showToast("已套用篩選條件");
    });

    drawerReset?.addEventListener("click", () => {
      filterState.topic = "全部作品";
      filterState.carrier = "全部位置";
      filterState.keyword = "";
      filterState.subtag = "";

      if (desktopTopicFilter) desktopTopicFilter.value = "全部照片";
      if (desktopCarrierFilter) desktopCarrierFilter.value = "全部位置";
      if (desktopSearchInput) desktopSearchInput.value = "";
      if (mobileTopicFilter) mobileTopicFilter.value = "想刻什麼？";
      if (mobileCarrierFilter) mobileCarrierFilter.value = "刻在哪裡？";
      if (mobileSearchInput) mobileSearchInput.value = "";

      document.querySelectorAll(".drawer-chip-grid").forEach(group => {
        group.querySelectorAll(".chip").forEach(item => item.classList.remove("active"));
        const firstChip = group.querySelector(".chip");
        if (firstChip) firstChip.classList.add("active");
      });

      // === [subtag] === reset 也要清子類 bar
      renderSubtagBar(filterState.topic);
      applyFilters();
      showToast("已重設篩選");
    });

    filterDrawer.addEventListener("click", event => {
      if (event.target === filterDrawer) closeFilterDrawer();
    });
  }

  document.querySelectorAll(".chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const group = chip.parentElement;
      const value = chip.textContent.trim();

      group.querySelectorAll(".chip").forEach(item => item.classList.remove("active"));
      chip.classList.add("active");

      const sectionTitle =
        group.closest(".drawer-section")?.querySelector(".drawer-section-title")?.textContent || "";

      if (sectionTitle.includes("靈感")) filterState.topic = value;
      if (sectionTitle.includes("刻圖")) filterState.carrier = value;
    });
  });

  [desktopTopicFilter, desktopCarrierFilter, mobileTopicFilter, mobileCarrierFilter].forEach(select => {
    if (!select) return;

    select.addEventListener("change", () => {
      if (select === mobileTopicFilter) {
        filterState.topic = mobileTopicFilter.value;
        // === [subtag] === 手機 select 改了主類也要重渲染
        filterState.subtag = "";
        renderSubtagBar(filterState.topic);
      } else if (select === mobileCarrierFilter) {
        filterState.carrier = mobileCarrierFilter.value;
      } else {
        syncDesktopFilters();
      }

      applyFilters();
    });
  });

  // === [subtag] === 子類 chip 點擊 (event delegation)
  subtagChipsEl?.addEventListener("click", event => {
    const chip = event.target.closest(".subtag-chip");
    if (!chip) return;

    const tag = chip.dataset.subtag || "";
    filterState.subtag = tag;

    // 切 active 狀態
    subtagChipsEl.querySelectorAll(".subtag-chip").forEach(item => {
      item.classList.toggle("is-active", (item.dataset.subtag || "") === tag);
    });

    applyFilters();
  });

  // 三 tab 切換 (照片 / 故事 / 全部, 桌機 + 手機同步)
  const allCardTabs = document.querySelectorAll(".card-tab");

  allCardTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const type = tab.dataset.cardType || "all";
      filterState.cardType = type;

      allCardTabs.forEach(t => {
        const active = t.dataset.cardType === type;
        t.classList.toggle("is-active", active);
        t.setAttribute("aria-selected", String(active));
      });

      applyFilters();
    });
  });

  [desktopSearchInput, mobileSearchInput].forEach(input => {
    if (!input) return;

    input.addEventListener("input", () => {
      filterState.keyword = input.value;

      if (input === desktopSearchInput && mobileSearchInput) {
        mobileSearchInput.value = input.value;
      }

      if (input === mobileSearchInput && desktopSearchInput) {
        desktopSearchInput.value = input.value;
      }

      applyFilters();
    });
  });

  galleryGrid?.addEventListener("click", event => {
    const favoriteBtn = event.target.closest(".favorite-btn");

    if (favoriteBtn) {
      event.preventDefault();
      event.stopPropagation();
      toggleFavorite(favoriteBtn.dataset.postId, favoriteBtn);
      return;
    }

    const card = event.target.closest(".plan1-card");
    if (!card) return;

    event.preventDefault();
    openDetailModal(card);
  });

  window.LohasGallery = {
    showToast,
    renderGalleryCard,
    applyFilters,
    loadMyFavoriteStates
  };

  // === [subtag] === 初始化: 預設「全部照片」沒對應子類, 會自動隱藏
  renderSubtagBar(filterState.topic);

  applyFilters();
  loadPostsFromSupabase();
});
