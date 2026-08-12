/* ============================================================
   legacy-redirect.js — 舊站轉址
   ------------------------------------------------------------
   背景
   ------------------------------------------------------------
   本網域有以下兩項限制，使一般轉址手法全部失效：

     1. repo 內有 .nojekyll，GitHub Pages 為純靜態原檔服務，
        不做「無副檔名對應」→ /page/1/471 不會自動找 471.html
     2. 上游（代理/CDN）會把所有非 200 回應（含 404 與 301）
        替換成 index.html → 404.html 與目錄補斜線 301 都被吃掉

   結論：任何未命中實體檔案的路徑（舊站 QR、舊 .aspx 網址等）
        一律被服務成 index.html，故轉址判斷必須掛在 index.html
        才收得到請求。

   ※ GitHub Pages 無法發出真正的 HTTP 301。
     本檔以 location.replace + meta refresh 達成等效使用者體驗，
     且不留下歷史紀錄（返回鍵不會卡在轉址頁）。

   ------------------------------------------------------------
   規則
   ------------------------------------------------------------
   A. 舊站 QR（實體已印製、無法回收重印）
        /page/{語系}/{ID}  ->  /frame.html?f={ID}
        ID->新代碼 對照表位於 js/frames-data.js 的 LEGACY_ID_MAP，
        本檔只負責轉址，不維護對照關係。
        備註：capture group 僅取 [\w-]，可濾除 QR#8 結尾多餘的單引號。

   B. 舊版 ASP.NET 網址（仍有外部連結／Meta 再行銷流量導入）
        /Store/Visitor/Store_List.aspx  ->  /allstore.html
        比對不分大小寫，忽略查詢字串、hash 與結尾斜線。
        日後新增舊網址，只要在 LEGACY_PATHS 陣列加一筆即可。

   備註：首頁本身（/ 或 /index.html）不符任何規則，完全不受影響。

   ------------------------------------------------------------
   載入方式（index.html 的 <head> 最前面，charset 之後）
   ------------------------------------------------------------
   <script src="/js/legacy-redirect.js"></script>

   ※ 必須用絕對路徑 /js/，因為此腳本會在 /page/1/xxx 這類
     深層路徑下被執行，相對路徑會解析錯誤。
   ※ 必須置於所有其他資源之前，才能在載入任何圖片/CSS 前轉走。
============================================================ */
(function () {
  'use strict';

  var path = location.pathname || '';

  /* --------------------------------------------------------
     共用：執行轉址
     meta refresh 作為保險：JS 若被中斷仍能轉址
     location.replace：不留下歷史紀錄
  -------------------------------------------------------- */
  function go(target) {
    document.write('<meta http-equiv="refresh" content="0; url=' + target + '">');
    location.replace(target);
  }

  /* --------------------------------------------------------
     規則 B：舊版 ASP.NET 固定路徑對照
     location.pathname 本就不含 ? 與 #，故查詢字串自動被忽略
     統一轉小寫 -> 大小寫不敏感
     去除結尾斜線 -> 有無結尾斜線皆可比對
  -------------------------------------------------------- */
  var LEGACY_PATHS = [
    { from: '/store/visitor/store_list.aspx', to: '/allstore.html' }
    /* 日後新增舊網址時，在此比照格式加一筆即可，例如：
       ,{ from: '/store/visitor/store_detail.aspx', to: '/allstore.html' }
    */
  ];

  var lower = path.toLowerCase().replace(/\/+$/, '');
  for (var i = 0; i < LEGACY_PATHS.length; i++) {
    if (lower === LEGACY_PATHS[i].from) {
      go(LEGACY_PATHS[i].to);
      return;
    }
  }

  /* --------------------------------------------------------
     規則 A：舊站 QR
  -------------------------------------------------------- */
  var m = path.match(/^\/page\/\d+\/([\w-]+)/);
  if (!m) return;                       // 非舊站路徑，放行

  go('/frame.html?f=' + encodeURIComponent(m[1]));
})();
