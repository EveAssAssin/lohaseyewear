/* =============================================================
   LOHAS · APP WebView 模式
   -------------------------------------------------------------
   APP 用 WebView 開官網的頁面時,網站自己的導覽列與頁尾是多餘的
   —— APP 底下已經有一條原生導覽列,再疊一層會變成兩排導覽,
   而且「回上一頁」會有兩顆按鈕指向不同的地方。

   用法:網址帶 ?app=1。之後同一個 WebView 工作階段都維持這個模式,
        不必每一條連結都接參數(接漏一條就會突然冒出網站的導覽列)。
        要退出:?app=0。

   === 為什麼是 sessionStorage 不是 localStorage ===
   localStorage 會【永久】留著。一般客人在瀏覽器上不小心點到帶
   ?app=1 的分享連結,從此這台裝置上的官網就再也沒有導覽列了,
   而他不會知道發生什麼事,也不知道怎麼救。
   sessionStorage 關掉分頁就沒了,而 WebView 本來就是一個獨立的
   工作階段 —— 剛好是我們要的存活範圍。

   === 為什麼用 CSS 隱藏,不是不載入 layout.js ===
   不載入的話會分出「APP 版」與「網頁版」兩條路徑,而我方沒有
   測試環境,兩條路徑就是兩倍的沒被跑過的情況。
   現在是同一份 HTML、同一支 layout.js,只有一個 class 的差別;
   代價是 APP 裡會多抓一次 header/footer 的片段(幾 KB,而且有快取)。

   ⚠ 這支要放在 <head> 裡、【不要】加 defer ——
     class 必須在頁面畫出來之前就掛上去,否則導覽列會先閃一下
     才消失,那比一直顯示還難看。
   ============================================================= */

(function (window, document) {
  'use strict';

  var KEY = 'lohas_app_mode';
  var on = false;

  try {
    var q = String(window.location.search || '');
    if (/[?&]app=1(?:&|$)/.test(q)) {
      on = true;
      window.sessionStorage.setItem(KEY, '1');
    } else if (/[?&]app=0(?:&|$)/.test(q)) {
      on = false;
      window.sessionStorage.removeItem(KEY);
    } else {
      on = window.sessionStorage.getItem(KEY) === '1';
    }
  } catch (_e) {
    /* 無痕模式或被擋掉時 sessionStorage 會丟例外。
       這時只認網址上的參數 —— 功能退化成「每一頁都要帶參數」,
       但頁面照樣顯示得出來,不會整頁壞掉。 */
    on = /[?&]app=1(?:&|$)/.test(String(window.location.search || ''));
  }

  if (on) {
    document.documentElement.classList.add('in-app');
  }

  window.LohasAppMode = {
    isOn: function () { return on; },
    /* 給要跳出 WebView 的連結用(例如要開商城結帳)。
       目前沒有呼叫端,先留著介面,不要在各頁各寫一份判斷。 */
    key: KEY
  };

})(window, document);
