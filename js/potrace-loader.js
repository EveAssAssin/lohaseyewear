/* =============================================================
   LohasPotrace - esm-potrace-wasm 的全域 wrapper
   把 ESM module 包成 window.LohasPotrace 給 upload-design.js 用

   === 2026-09-03:為什麼多了重試與 whenReady() ===
   線上 492 張刻圖裡有 55 張是 imagetracer 描的(品質明顯較差 ——
   同一張原圖 potrace 出 134 條輪廓,imagetracer 只出 64 條,
   毛髮與細紋全部糊成黑塊)。

   原因不是「CDN 掛掉」,是【還沒載完就被判定為不可用】:
   這支是 WASM,從 CDN 動態載入要一兩秒;而 upload-design.js
   在客人按下上傳的【那一刻】才讀 .ready。客人動作快一點,
   ready 還是 false,就直接掉到 imagetracer —— 而且不會有任何提示。

   所以:
     1. 失敗重試一次(CDN 偶發性的失敗不該讓整張圖降級)
     2. 提供 whenReady(ms) 讓呼叫端【等】,而不是當下判生死
   ============================================================= */
(function(){
  'use strict';

  window.LohasPotrace = {
    ready:   false,
    trace:   null,
    _initPromise: null,
  };

  var SRC = 'https://cdn.jsdelivr.net/npm/esm-potrace-wasm@0.4.1/dist/index.js';
  var instance = 0;

  async function attempt(){
    /* 每次都帶一個不同的查詢字串,強制拿到全新的模組實例。
       理由見下面 trace() 的說明:壞掉的實例必須能被丟棄。 */
    var mod = await import(SRC + '?i=' + (++instance));
    await mod.init();

    window.LohasPotrace.trace = function(imgData, opts){
      return Promise.resolve()
        .then(function(){ return mod.potrace(imgData, opts || {}); })
        .catch(function(e){
          /* 🚨 這一支拋錯之後【整個 WASM 實例就毀了】。
             實測:先用 1251px 觸發 `offset is out of bounds`,
             接著同一頁再描 1000px(單獨跑明明會成功)也一樣失敗。
             不處理的話,一個客人上傳一張過大的圖之後,
             【他這一輪之後的每一次上傳】都會靜靜降級成 imagetracer。

             所以:出錯就把實例丟掉、重新載入一份,下一次是乾淨的。
             這一次仍然向上拋 —— 呼叫端該走 fallback 就走 fallback,
             不要在這裡假裝沒事。 */
          console.warn('[LohasPotrace] 描圖失敗,實例可能已損毀,重新載入一份:', e && e.message);
          window.LohasPotrace.ready = false;
          window.LohasPotrace._initPromise = boot();
          throw e;
        });
    };
    window.LohasPotrace.ready = true;
  }

  async function boot(){
    for (var i = 1; i <= 2; i++) {
      try {
        await attempt();
        console.log('[LohasPotrace] WASM 就緒' + (i > 1 ? '(第 ' + i + ' 次嘗試)' : ''));
        return true;
      } catch(e){
        console.warn('[LohasPotrace] 第 ' + i + ' 次載入失敗:', e && e.message);
        if (i < 2) await new Promise(function(r){ setTimeout(r, 800); });
      }
    }
    console.warn('[LohasPotrace] 兩次都失敗,upload-design 會 fallback 用 imagetracerjs');
    window.LohasPotrace.ready = false;
    return false;
  }

  window.LohasPotrace._initPromise = boot();

  /* 等到它就緒為止,最多等 ms 毫秒。
     ⚠ 呼叫端請用這個,不要直接讀 .ready —— 直接讀等於在問
     「這一刻好了沒」,而答案在剛進頁面時幾乎一定是「還沒」。 */
  window.LohasPotrace.whenReady = function(ms){
    var wait = new Promise(function(res){
      setTimeout(function(){ res(false); }, Number(ms) || 8000);
    });
    return Promise.race([
      window.LohasPotrace._initPromise.then(function(){ return !!window.LohasPotrace.ready; }),
      wait
    ]).then(function(ok){ return ok && !!window.LohasPotrace.ready; });
  };

})();
