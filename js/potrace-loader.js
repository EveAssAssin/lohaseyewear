/* =============================================================
   LohasPotrace - esm-potrace-wasm 的全域 wrapper
   把 ESM module 包成 window.LohasPotrace 給 upload-design.js 用
   ============================================================= */
(function(){
  'use strict';

  window.LohasPotrace = {
    ready:   false,
    trace:   null,
    _initPromise: null,
  };

  // 動態載入 esm-potrace-wasm (用 ESM dynamic import)
  window.LohasPotrace._initPromise = (async function(){
    try {
      var mod = await import('https://cdn.jsdelivr.net/npm/esm-potrace-wasm@0.4.1/dist/index.js');
      await mod.init();

      // 包成同步接口
      window.LohasPotrace.trace = async function(imgData, opts){
        return await mod.potrace(imgData, opts || {});
      };
      window.LohasPotrace.ready = true;
      console.log('[LohasPotrace] WASM 就緒');
    } catch(e){
      console.warn('[LohasPotrace] 載入失敗,upload-design 會 fallback 用 imagetracerjs:', e);
      window.LohasPotrace.ready = false;
    }
  })();

})();
