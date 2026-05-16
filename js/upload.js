document.addEventListener("DOMContentLoaded", () => {
  const Supabase = window.LohasSupabase;
  const supabaseClient = Supabase?.getClient?.() || null;

  const SUPABASE_BUCKET = Supabase?.CONFIG?.STORAGE_BUCKET || "gallery-uploads";
  const SUPABASE_TABLE = Supabase?.CONFIG?.POSTS_TABLE || "gallery_posts";

  const state = {
    selectedSlot: null,
    draggedSlot: null,
    images: [null, null, null],
    files: [null, null, null],
    isPreviewMode: false,
    editId: null,                  // 編輯模式: 已存在的 post id (null = 新建)
    existingImageUrls: [null, null, null]  // 編輯模式: 原本已上傳的 URL (沒換才用)
  };

  const openUploadBtns = document.querySelectorAll(".js-open-upload");
  const uploadModal = document.getElementById("uploadModal");
  const detailModal = document.getElementById("detailModal");
  const detailBody = document.getElementById("detailBody");
  const closeUpload = document.getElementById("closeUpload");
  const fileInput = document.getElementById("fileInput");
  const uploadBoxes = document.querySelectorAll(".upload-box");
  const shareText = document.getElementById("shareText");
  const currentChar = document.getElementById("currentChar");
  const workTitle = document.getElementById("workTitle");
  const workTitleError = document.getElementById("workTitleError");
  const workCategory = document.getElementById("workCategory");
  const carrierCategory = document.getElementById("carrierCategory");
  const subtagChips = document.getElementById("tagChipCloud");
  const subtagRow   = document.getElementById("tagRow");
  const subtagCount = document.getElementById("tagCount");
  const previewBtn = document.getElementById("previewBtn");
  const submitBtn = document.getElementById("submitBtn");

  // 已選的細部標籤 (Set)
  const selectedSubtags = new Set();

  let cropper = null;
  let cropTargetSlot = null;

  function showToast(message) {
    if (window.LohasGallery?.showToast) {
      window.LohasGallery.showToast(message);
      return;
    }

    const toast = document.getElementById("toast");
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

  /* ============== 子標籤 chip 渲染 (按主類切換) ============== */
  function renderSubtags(topic) {
    if (!subtagChips) return;
    const tags = (window.LohasSubcategories || {})[topic] || [];

    if (!tags.length) {
      if (subtagRow) subtagRow.style.display = 'none';
      subtagChips.innerHTML = '';
      return;
    }

    // 確保 row 顯示 (gallery 預設 display:none)
    if (subtagRow) subtagRow.style.display = '';

    subtagChips.innerHTML = tags.map(t => {
      const active = selectedSubtags.has(t);
      return `<button type="button" class="tag-chip ${active ? 'is-active' : ''}" data-tag="${escapeAttr(t)}">${escapeHtml(t)}</button>`;
    }).join('');

    subtagChips.querySelectorAll('.tag-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const tag = chip.dataset.tag;
        if (selectedSubtags.has(tag)) {
          selectedSubtags.delete(tag);
          chip.classList.remove('is-active');
        } else {
          selectedSubtags.add(tag);
          chip.classList.add('is-active');
        }
        if (subtagCount) subtagCount.textContent = selectedSubtags.size;
      });
    });

    if (subtagCount) subtagCount.textContent = selectedSubtags.size;
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
      ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])
    );
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/`/g, '&#96;');
  }

  function openModal() {
    if (!uploadModal) return;

    uploadModal.classList.add("is-open");
    uploadModal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    if (!uploadModal) return;

    uploadModal.classList.remove("is-open");
    uploadModal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function backToUploadModal() {
    state.isPreviewMode = false;

    uploadModal?.classList.add("is-open");
    uploadModal?.setAttribute("aria-hidden", "false");

    document.body.style.overflow = "hidden";
  }

  function closeCropModal() {
    const cropModal = document.getElementById("cropModal");

    if (cropModal) {
      cropModal.classList.remove("is-open");
      cropModal.setAttribute("aria-hidden", "true");
    }

    if (cropper) cropper.destroy();

    cropper = null;
    cropTargetSlot = null;
  }

  function resetBox(slot) {
    const box = document.querySelector(`.upload-box[data-slot="${slot}"]`);
    if (!box) return;

    const isMain = box.classList.contains("main-upload");

    box.classList.remove("has-image");
    box.setAttribute("draggable", "false");

    box.innerHTML = `
      ${isMain ? '<span class="badge-main">首圖</span>' : ''}
      <div class="upload-placeholder">
        <i class="fa-regular fa-image"></i>
        <p>新增圖片</p>
        <span class="upload-hint">${isMain ? "點擊選擇，或拖曳圖片到這裡" : "副圖"}</span>
      </div>
    `;
  }

  function renderBox(slot) {
    const box = document.querySelector(`.upload-box[data-slot="${slot}"]`);
    if (!box) return;

    const image = state.images[slot];

    if (!image) {
      resetBox(slot);
      return;
    }

    const isMain = box.classList.contains("main-upload");

    box.classList.add("has-image");
    box.setAttribute("draggable", "true");

    box.innerHTML = `
      ${isMain ? '<span class="badge-main">首圖</span>' : ''}
      <img class="preview-image" src="${image}" alt="上傳預覽圖片" />
      <button class="delete-btn" type="button" data-delete-slot="${slot}" aria-label="刪除圖片">
        <i class="fas fa-times"></i>
      </button>
    `;
  }

  function openFilePicker(slot) {
    if (!fileInput) return;

    state.selectedSlot = Number(slot);
    fileInput.value = "";
    fileInput.click();
  }

  function readImageFile(file, slot) {
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      showToast("請上傳圖片格式");
      return;
    }

    cropTargetSlot = slot;

    const reader = new FileReader();

    reader.onload = event => {
      const cropModal = document.getElementById("cropModal");
      const cropImage = document.getElementById("cropImage");

      if (!cropModal || !cropImage) return;

      cropImage.src = event.target.result;
      cropModal.classList.add("is-open");
      cropModal.setAttribute("aria-hidden", "false");

      if (cropper) cropper.destroy();

      cropper = new Cropper(cropImage, {
        aspectRatio: 1,          // 1:1 正方 (跟卡片瀑布流統一)
        viewMode: 1,
        dragMode: "move",
        autoCropArea: 1,
        responsive: true,
        background: false,
        movable: true,
        zoomable: true,
        scalable: false,
        rotatable: false
      });
    };

    reader.readAsDataURL(file);
  }

  function base64ToFile(base64, filename) {
    const arr = base64.split(",");
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);

    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }

    return new File([u8arr], filename, { type: mime });
  }

  function swapImages(fromSlot, toSlot) {
    const tempImage = state.images[fromSlot];
    state.images[fromSlot] = state.images[toSlot];
    state.images[toSlot] = tempImage;

    const tempFile = state.files[fromSlot];
    state.files[fromSlot] = state.files[toSlot];
    state.files[toSlot] = tempFile;

    renderBox(fromSlot);
    renderBox(toSlot);
  }

  function getMainImage() {
    return state.images[0];
  }

  function getTitle() {
    return workTitle?.value.trim() || "未命名作品";
  }

  function validateForm() {
    if (workTitleError) {
      workTitleError.textContent = "";
      workTitleError.classList.remove("show");
    }

    if (!getMainImage()) {
      showToast("請至少上傳一張首圖");
      return false;
    }

    if (!workTitle?.value.trim()) {
      if (workTitleError) {
        workTitleError.textContent = "請輸入刻圖照片名稱";
        workTitleError.classList.add("show");
      }

      workTitle?.focus();
      return false;
    }

    return true;
  }

  // 從 File / Blob 拿副檔名 (Cropper.js 回傳的 Blob 沒有 name 屬性)
  function getExt(fileOrBlob) {
    if (!fileOrBlob) return 'jpg';
    if (fileOrBlob.name) {
      const e = fileOrBlob.name.split('.').pop()?.toLowerCase();
      if (e) return e;
    }
    const mime = fileOrBlob.type || '';
    if (mime.includes('png')) return 'png';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('gif')) return 'gif';
    return 'jpg';
  }

  async function uploadImagesToSupabase() {
    if (!supabaseClient) {
      throw new Error("Supabase 尚未設定");
    }

    const uploadedUrls = [];
    const files = state.files.filter(Boolean);

    for (const file of files) {
      const ext = getExt(file);
      const filePath = `public/${Date.now()}-${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabaseClient.storage
        .from(SUPABASE_BUCKET)
        .upload(filePath, file, { cacheControl: "3600", upsert: false });

      if (uploadError) throw uploadError;

      const { data } = supabaseClient.storage
        .from(SUPABASE_BUCKET)
        .getPublicUrl(filePath);

      uploadedUrls.push(data.publicUrl);
    }

    return uploadedUrls;
  }

  async function submitPostToSupabase() {
    if (!supabaseClient) {
      throw new Error("Supabase 尚未設定");
    }

    const member = JSON.parse(localStorage.getItem("lohasMember") || "null");

    if (!member || !member.erpid) {
      throw new Error("請先登入會員後再分享照片");
    }

    // 編輯模式: 只上傳「換新的」, 沒換的圖用 existingImageUrls
    let imageUrls;
    if (state.editId) {
      const newUploaded = [];
      // 上傳每個 slot, 換新的就上傳, 沒換的用 existing
      for (let i = 0; i < 3; i++) {
        if (state.files[i]) {
          // 有新檔, 上傳
          const file = state.files[i];
          const ext = getExt(file);
          const filePath = `public/${Date.now()}-${crypto.randomUUID()}.${ext}`;
          const { error: uploadError } = await supabaseClient.storage
            .from(SUPABASE_BUCKET)
            .upload(filePath, file, { cacheControl: "3600", upsert: false });
          if (uploadError) throw uploadError;
          const { data } = supabaseClient.storage.from(SUPABASE_BUCKET).getPublicUrl(filePath);
          newUploaded.push(data.publicUrl);
        } else if (state.existingImageUrls[i]) {
          // 沒換, 用原本的
          newUploaded.push(state.existingImageUrls[i]);
        }
      }
      imageUrls = newUploaded.filter(Boolean);
    } else {
      imageUrls = await uploadImagesToSupabase();
    }

    // 自動分流: 故事文字 >= 50 字 = story 卡, 否則 = photo 卡
    const storyText = shareText.value.trim();
    const cardType = storyText.length >= 50 ? "story" : "photo";

    const postPayload = {
      title: getTitle(),
      topic: workCategory.value,
      carrier: carrierCategory.value,
      story: storyText,
      type: cardType,
      customer_name: member.name || "顧客",
      member_id: member.erpid,
      image_urls: imageUrls,
      main_image_url: imageUrls[0],
      is_public: true,
      status: "pending"   // 重新送審
    };

    if (state.editId) {
      // 編輯模式: update (重新送審, 清掉 reject_reason)
      postPayload.reject_reason = null;
      const { data, error } = await supabaseClient
        .from(SUPABASE_TABLE)
        .update(postPayload)
        .eq("id", state.editId)
        .select("id,title,topic,carrier,story,type,customer_name,member_id,image_urls,main_image_url,created_at,is_public,status")
        .single();
      if (error) throw error;
      return data;
    }

    // 新建模式
    const { data, error } = await supabaseClient
      .from(SUPABASE_TABLE)
      .insert(postPayload)
      .select("id,title,topic,carrier,story,type,customer_name,member_id,image_urls,main_image_url,created_at,is_public,status")
      .single();

    if (error) throw error;

    return data;
  }

  function clearForm() {
    state.images = [null, null, null];
    state.files = [null, null, null];
    state.editId = null;
    state.existingImageUrls = [null, null, null];

    uploadBoxes.forEach(box => resetBox(Number(box.dataset.slot)));

    // 還原 modal 標題與按鈕文字
    const titleEl = document.getElementById('uploadModalTitle');
    if (titleEl) titleEl.firstChild.textContent = '分享你的照片 ';
    if (submitBtn) submitBtn.textContent = '送出分享';

    if (workTitle) workTitle.value = "";
    if (shareText) shareText.value = "";
    if (currentChar) currentChar.textContent = "0";
    if (workCategory) workCategory.selectedIndex = 0;
    if (carrierCategory) carrierCategory.selectedIndex = 0;
  }

  function bindUploadEvents() {
    openUploadBtns.forEach(btn => {
      btn.addEventListener("click", event => {
        event.preventDefault();

        const member = JSON.parse(localStorage.getItem("lohasMember") || "null");

        if (!member || !member.erpid) {
          localStorage.setItem("redirectAfterLogin", "gallery.html#upload-area");
          window.location.href = "login.html";
          return;
        }

        openModal();
      });
    });

    closeUpload?.addEventListener("click", closeModal);

    uploadModal?.addEventListener("click", event => {
      if (event.target === uploadModal) closeModal();
    });

    fileInput?.addEventListener("change", event => {
      const file = event.target.files[0];

      if (state.selectedSlot !== null) {
        readImageFile(file, state.selectedSlot);
      }
    });

    uploadBoxes.forEach(box => {
      const slot = Number(box.dataset.slot);
      resetBox(slot);

      box.addEventListener("click", event => {
        const deleteBtn = event.target.closest("[data-delete-slot]");

        if (deleteBtn) {
          event.stopPropagation();

          const deleteSlot = Number(deleteBtn.dataset.deleteSlot);
          state.files[deleteSlot] = null;
          state.images[deleteSlot] = null;

          renderBox(deleteSlot);
          return;
        }

        openFilePicker(slot);
      });

      box.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openFilePicker(slot);
        }
      });

      box.addEventListener("dragover", event => {
        event.preventDefault();
        box.classList.add("drag-enter");
      });

      box.addEventListener("dragleave", () => {
        box.classList.remove("drag-enter");
      });

      box.addEventListener("drop", event => {
        event.preventDefault();

        document.querySelectorAll(".upload-box").forEach(item => {
          item.classList.remove("dragging", "drag-enter");
          item.style.opacity = "";
        });

        // 內部拖曳 (盒子之間互換) 優先處理 - 不再走裁切流程
        if (state.draggedSlot !== null) {
          if (state.draggedSlot !== slot) {
            swapImages(state.draggedSlot, slot);
          }
          state.draggedSlot = null;
          return;
        }

        // 外部拖入新檔案才開啟裁切
        const file = event.dataTransfer.files[0];
        if (file) {
          readImageFile(file, slot);
        }
      });

      box.addEventListener("dragstart", event => {
        if (!state.images[slot]) {
          event.preventDefault();
          return;
        }

        state.draggedSlot = slot;
        box.classList.add("dragging");
        event.dataTransfer.setData("text/plain", String(slot));
      });

      box.addEventListener("dragend", () => {
        state.draggedSlot = null;

        document.querySelectorAll(".upload-box").forEach(item => {
          item.classList.remove("dragging", "drag-enter");
          item.style.opacity = "";
        });
      });
    });

    shareText?.addEventListener("input", () => {
      const len = shareText.value.length;
      currentChar.textContent = len;

      // 達 50 字 → 視覺提示這篇會被收進故事牆
      const counter = document.querySelector(".char-counter");
      if (counter) {
        counter.classList.toggle("is-story", len >= 50);
      }
    });

    // 靈感主題切換 → 刷子標籤
    workCategory?.addEventListener("change", () => {
      selectedSubtags.clear();
      renderSubtags(workCategory.value);
    });

    // 初次 render (預設主題)
    if (workCategory) renderSubtags(workCategory.value);

    workTitle?.addEventListener("input", () => {
      if (workTitleError) {
        workTitleError.textContent = "";
        workTitleError.classList.remove("show");
      }
    });

    previewBtn?.addEventListener("click", () => {
      if (!validateForm()) return;

      const member = JSON.parse(localStorage.getItem("lohasMember") || "null");
      const previewName = maskName(member?.name || "顧客");
      const images = state.images.filter(Boolean);
      const mainImage = images[0];
      const subImages = images.slice(1, 3);

      detailBody.innerHTML = `
        <div class="detail-gallery">
          <div class="detail-main-image">
            <img src="${mainImage}" alt="${getTitle()}" />
          </div>

          <div class="detail-sub-list">
            ${subImages.map(src => `
              <div class="detail-sub-image">
                <img src="${src}" alt="${getTitle()}" />
              </div>
            `).join("")}
          </div>
        </div>

        <div class="detail-title-row">
          <h3 class="detail-title">${getTitle()}</h3>
          <span class="detail-user">${previewName}</span>
        </div>

        <div class="detail-meta">
          <span class="detail-chip">${workCategory.value}</span>
          <span class="detail-chip">${carrierCategory.value}</span>
        </div>

        <p class="detail-story">
          ${shareText.value.trim() || "這是一份來自顧客的真實刻圖照片分享。"}
        </p>
      `;

      state.isPreviewMode = true;

      detailModal.classList.add("is-open");
      detailModal.setAttribute("aria-hidden", "false");
      uploadModal.classList.remove("is-open");
      uploadModal.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "hidden";
    });

    submitBtn?.addEventListener("click", async () => {
      if (!validateForm()) return;

      try {
        submitBtn.disabled = true;
        submitBtn.textContent = "上傳中...";

        const newPost = await submitPostToSupabase();

        // 待審核中的貼文不立刻插進 grid (防止用戶以為已公開)
        // window.LohasGallery?.renderGalleryCard?.(newPost, true);
        // window.LohasGallery?.applyFilters?.();
        // window.LohasGallery?.loadMyFavoriteStates?.();

        // 如果在會員平台 (有 LohasMember), 重新載入該頁清單
        if (window.LohasMember?.reloadAfterUpload) {
          window.LohasMember.reloadAfterUpload(newPost);
        }

        closeModal();
        clearForm();

        showToast("已送出 · 審核通過後將會顯示在靈感牆");
      } catch (error) {
        console.error(error);
        showToast(error.message || "上傳失敗，請檢查 Supabase 權限設定");
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "送出分享";
      }
    });

    document.getElementById("applyCrop")?.addEventListener("click", () => {
      if (!cropper || cropTargetSlot === null) return;

      const canvas = cropper.getCroppedCanvas({
        width: 1200,
        height: 1200,
        imageSmoothingQuality: "high"
      });

      const croppedBase64 = canvas.toDataURL("image/jpeg", 0.9);

      state.images[cropTargetSlot] = croppedBase64;
      state.files[cropTargetSlot] = base64ToFile(
        croppedBase64,
        `gallery_${Date.now()}_${cropTargetSlot}.jpg`
      );

      renderBox(cropTargetSlot);
      closeCropModal();
    });

    document.getElementById("cancelCrop")?.addEventListener("click", closeCropModal);
    document.getElementById("closeCrop")?.addEventListener("click", closeCropModal);
  }

  bindUploadEvents();

  // 登入後從 login.html 帶回來的: hash = #upload-area 或 #open-upload → 自動開 modal
  function maybeAutoOpenUpload() {
    const hash = window.location.hash;
    if (hash === "#upload-area" || hash === "#open-upload") {
      const member = JSON.parse(localStorage.getItem("lohasMember") || "null");
      if (member && member.erpid) {
        openModal();
        // 清掉 hash 避免重新整理又開一次
        history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    }
  }
  maybeAutoOpenUpload();

  window.LohasUpload = {
    openModal,
    openModalForEdit,
    closeModal,
    clearForm,
    isPreviewMode() {
      return state.isPreviewMode;
    },
    backToUploadModal
  };

  /**
   * 編輯已上傳的照片 (例如駁回後重新上傳)
   * @param {Object} post - { id, title, topic, carrier, story, image_urls, main_image_url }
   */
  function openModalForEdit(post) {
    if (!post || !post.id) return openModal();

    // 設定編輯模式
    state.editId = post.id;
    state.images = [null, null, null];
    state.files = [null, null, null];
    state.existingImageUrls = [null, null, null];

    // 預填欄位
    if (workTitle) workTitle.value = post.title || '';
    if (workCategory) workCategory.value = post.topic || '';
    if (carrierCategory) carrierCategory.value = post.carrier || '';
    if (shareText) {
      shareText.value = post.story || '';
      // 觸發字數計算
      shareText.dispatchEvent(new Event('input'));
    }

    // 預填照片 (顯示 + 記下原 URL)
    const urls = Array.isArray(post.image_urls) ? post.image_urls : [];
    urls.slice(0, 3).forEach((url, i) => {
      state.existingImageUrls[i] = url;
      state.images[i] = url;
      // 渲染到 upload-box (顯示原圖)
      const box = document.querySelector(`.upload-box[data-slot="${i}"]`);
      if (box) {
        box.classList.add('has-image');
        box.style.backgroundImage = `url('${url}')`;
        box.style.backgroundSize = 'cover';
        box.style.backgroundPosition = 'center';
        // 換成「移除」按鈕內容
        const isMain = i === 0;
        box.innerHTML = `
          ${isMain ? '<span class="badge-main">首圖</span>' : ''}
          <button type="button" class="upload-remove-btn" data-remove-slot="${i}" aria-label="移除">
            <i class="fa-solid fa-xmark"></i>
          </button>`;
        box.querySelector('.upload-remove-btn')?.addEventListener('click', e => {
          e.stopPropagation();
          state.images[i] = null;
          state.files[i] = null;
          state.existingImageUrls[i] = null;
          box.classList.remove('has-image');
          box.style.backgroundImage = '';
          // 還原 placeholder
          box.innerHTML = `
            ${isMain ? '<span class="badge-main">首圖</span>' : ''}
            <div class="upload-placeholder">
              <i class="fa-regular fa-image"></i>
              <p>${isMain ? '上傳首圖' : '上傳圖片'}</p>
              <span class="upload-hint">${isMain ? '點擊或拖曳圖片到這裡' : '副圖（選填）'}</span>
            </div>`;
        });
      }
    });

    // 換 modal 標題顯示是「編輯」
    const titleEl = document.getElementById('uploadModalTitle');
    if (titleEl) titleEl.firstChild.textContent = '重新編輯照片 ';

    // 換送出按鈕文字
    if (submitBtn) submitBtn.textContent = '重新送出';

    openModal();
  }
});
