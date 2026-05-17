/**
 * Lohas Cropper · 通用裁切工具 (基於 Cropper.js 1.6.2)
 *
 * 用法:
 *   const blob = await window.LohasCropper.crop(file, { aspectRatio: 1, title: '裁切頭像' });
 *   if (blob) {
 *     // blob 是裁切後的 Blob (跟原 file 同 mime)
 *     const url = URL.createObjectURL(blob);  // 預覽
 *     // 或 upload 給 Supabase
 *   }
 *
 * aspectRatio:
 *   1     = 1:1 (頭像)
 *   3/4   = 3:4 (緣份直式照)
 *   4/3   = 4:3
 *   16/9  = 16:9
 *
 * 第一次呼叫會自動 inject modal HTML 到 body
 */
(function (window) {
  let cropper = null;
  let modalEl = null;
  let resolveFn = null;
  let originalFileType = 'image/jpeg';

  function injectModal() {
    if (modalEl) return modalEl;
    const div = document.createElement('div');
    div.id = 'lohasCropModal';
    div.className = 'lohas-crop-modal';
    div.setAttribute('inert', '');
    div.innerHTML = `
      <div class="lohas-crop-bg"></div>
      <div class="lohas-crop-dialog">
        <div class="lohas-crop-head">
          <h3 id="lohasCropTitle">調整圖片裁切</h3>
          <button class="lohas-crop-close" type="button" aria-label="關閉">&times;</button>
        </div>
        <div class="lohas-crop-body">
          <img id="lohasCropImg" style="max-width:100%;display:block">
        </div>
        <div class="lohas-crop-foot">
          <button class="lohas-crop-btn lohas-crop-cancel" type="button">取消</button>
          <button class="lohas-crop-btn lohas-crop-apply" type="button">套用裁切</button>
        </div>
      </div>
    `;
    document.body.appendChild(div);
    modalEl = div;

    // 注入樣式 (一次性)
    if (!document.getElementById('lohasCropStyles')) {
      const s = document.createElement('style');
      s.id = 'lohasCropStyles';
      s.textContent = `
.lohas-crop-modal{position:fixed;inset:0;z-index:99999;display:none;align-items:center;justify-content:center}
.lohas-crop-modal.is-open{display:flex}
.lohas-crop-bg{position:absolute;inset:0;background:rgba(0,0,0,0.6)}
.lohas-crop-dialog{position:relative;background:#fff;border-radius:14px;width:min(720px,calc(100vw - 32px));max-height:calc(100vh - 60px);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,0.3)}
.lohas-crop-head{padding:14px 22px;border-bottom:1px solid #E8DFD0;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
.lohas-crop-head h3{font-size:14px;color:#50422D;font-weight:600;letter-spacing:1px;margin:0}
.lohas-crop-close{background:0;border:0;font-size:26px;color:#A8927A;cursor:pointer;line-height:1;padding:0 4px}
.lohas-crop-close:hover{color:#50422D}
.lohas-crop-body{flex:1;overflow:auto;padding:18px;background:#F9F6EE;min-height:300px;display:flex;align-items:center;justify-content:center}
.lohas-crop-foot{padding:12px 18px;border-top:1px solid #E8DFD0;display:flex;justify-content:flex-end;gap:8px;flex-shrink:0;background:#fff}
.lohas-crop-btn{padding:9px 18px;border-radius:8px;font-family:inherit;font-size:12.5px;letter-spacing:0.5px;font-weight:600;cursor:pointer;border:1px solid;transition:all .15s}
.lohas-crop-cancel{background:#fff;color:#7A6B5C;border-color:#E8DFD0}
.lohas-crop-cancel:hover{background:#F9F6EE}
.lohas-crop-apply{background:#50422D;color:#fff;border-color:#50422D}
.lohas-crop-apply:hover{background:#765F4A;border-color:#765F4A}
      `;
      document.head.appendChild(s);
    }

    // 綁定按鈕
    div.querySelector('.lohas-crop-close').addEventListener('click', () => closeModal(null));
    div.querySelector('.lohas-crop-cancel').addEventListener('click', () => closeModal(null));
    div.querySelector('.lohas-crop-bg').addEventListener('click', () => closeModal(null));
    div.querySelector('.lohas-crop-apply').addEventListener('click', applyCrop);

    return div;
  }

  function closeModal(result) {
    if (cropper) { cropper.destroy(); cropper = null; }
    if (modalEl) {
      modalEl.classList.remove('is-open');
      modalEl.setAttribute('inert', '');
    }
    document.body.style.overflow = '';
    if (resolveFn) {
      const r = resolveFn;
      resolveFn = null;
      r(result);
    }
  }

  function applyCrop() {
    if (!cropper) return closeModal(null);
    const canvas = cropper.getCroppedCanvas({
      maxWidth: 1600,
      maxHeight: 1600,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high'
    });
    if (!canvas) return closeModal(null);
    canvas.toBlob(blob => {
      closeModal(blob);
    }, originalFileType, 0.92);
  }

  /**
   * 開啟裁切 modal
   * @param {File|Blob} file - 來源圖檔
   * @param {Object} opts - { aspectRatio, title }
   * @returns {Promise<Blob|null>} - 裁切後的 Blob, 取消則 null
   */
  function crop(file, opts) {
    opts = opts || {};
    // 注意: aspectRatio 可能是 NaN (自由裁切), 不能用 || 1 fallback
    const aspectRatio = (opts.aspectRatio === undefined || opts.aspectRatio === null) ? 1 : opts.aspectRatio;
    const title = opts.title || '調整圖片裁切';

    return new Promise(resolve => {
      if (!window.Cropper) {
        console.error('[LohasCropper] Cropper.js 未載入, 略過裁切');
        resolve(file);
        return;
      }

      injectModal();
      resolveFn = resolve;
      originalFileType = file.type || 'image/jpeg';

      const titleEl = modalEl.querySelector('#lohasCropTitle');
      if (titleEl) titleEl.textContent = title;

      const img = modalEl.querySelector('#lohasCropImg');
      const reader = new FileReader();
      reader.onload = ev => {
        img.src = ev.target.result;

        modalEl.classList.add('is-open');
        modalEl.removeAttribute('inert');
        document.body.style.overflow = 'hidden';

        // 給瀏覽器時間 render 圖, 再初始化 cropper
        setTimeout(() => {
          if (cropper) { cropper.destroy(); cropper = null; }
          cropper = new window.Cropper(img, {
            aspectRatio,
            viewMode: 1,
            autoCropArea: 0.9,
            background: false,
            responsive: true,
            zoomable: true,
            movable: true,
            rotatable: false,
            scalable: false,
            modal: true
          });
        }, 50);
      };
      reader.readAsDataURL(file);
    });
  }

  window.LohasCropper = { crop };
})(window);
