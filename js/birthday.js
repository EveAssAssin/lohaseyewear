/* =============================================================
   LOHAS · 生日活動頁 —— 卡片詳細說明的彈窗
   -------------------------------------------------------------
   頁面上三組格子(壽星專屬的三件事、怎麼參加、在哪裡拿)的每一張卡
   裡面都放著一個 hidden 的 .bd-detail。點卡片就把那一段搬進彈窗。

   為什麼內容放在卡片裡,不是集中在這支檔案的一張表:
   改文案的人看到的是卡片,他會在卡片那裡找。內容藏在 js 裡的話,
   卡片上寫著一句、彈窗裡寫著另一句,而改的人只會找到其中一句。

   ⚠ 沒有 .bd-detail 的卡片【完全不會有任何互動】——
   不加游標、不加提示、按了也沒事。半套的可點外觀比不能點更糟:
   人會以為壞了。
   ============================================================= */

(function (window, document) {
  'use strict';

  var el = {};
  var lastFocus = null;   // 關閉後要把焦點還回去的那張卡

  function $(id) { return document.getElementById(id); }

  /* ---------- 開關 ---------- */

  function open(card) {
    var src = card.querySelector('.bd-detail');
    if (!src) return;

    var titleNode = card.querySelector('h3, b');
    el.title.textContent = titleNode ? titleNode.textContent.trim() : '詳細說明';
    /* 用複製的,不要搬走節點 —— 原本那一份要留在卡片裡,
       關掉之後還要能再開一次。
       內容是這一頁自己寫死的 HTML,不是外部來的,所以 innerHTML 沒有風險。 */
    el.body.innerHTML = src.innerHTML;

    lastFocus = card;
    el.modal.hidden = false;
    /* 背後不要跟著捲。手機上尤其明顯 —— 手指在彈窗上滑,
       底下那一頁會一起動,關掉之後就不知道自己在哪裡了。 */
    document.body.style.overflow = 'hidden';
    el.close.focus();
  }

  function close() {
    if (el.modal.hidden) return;
    el.modal.hidden = true;
    document.body.style.overflow = '';
    el.body.innerHTML = '';
    // 焦點還給原本那張卡,鍵盤使用者才不會被丟回頁首
    if (lastFocus) { try { lastFocus.focus(); } catch (e) { /* 已不在畫面上 */ } }
    lastFocus = null;
  }

  /* ---------- 啟動 ---------- */

  function init() {
    el = {
      modal: $('bdModal'), title: $('bdModalTitle'),
      body: $('bdModalBody'), close: $('bdModalX')
    };
    if (!el.modal) return;

    /* 只有真的有詳細內容的卡片才變成可點的。
       .bd-pick 的標題是 <b> 不是 <h3>,所以兩種都收。 */
    var cards = [].slice.call(
      document.querySelectorAll('.bd-perk, .bd-step, .bd-pick'));

    cards.forEach(function (card) {
      if (!card.querySelector('.bd-detail')) return;

      card.classList.add('is-clickable');
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');

      /* 看得見的提示。沒有這個,沒有人知道卡片可以點。
         ⚠ .bd-pick 是橫向 flex(icon + 文字區),直接掛在卡片上
         會變成第三個並排元素、跑到文字右邊並把卡片撐寬。
         有內層容器就塞進去,讓它跟著文字走。 */
      var hint = document.createElement('span');
      hint.className = 'bd-more';
      hint.innerHTML = '詳細說明 <i class="fa-solid fa-chevron-right"></i>';
      (card.querySelector(':scope > div') || card).appendChild(hint);

      card.addEventListener('click', function () { open(card); });
      card.addEventListener('keydown', function (e) {
        // 空白鍵預設會捲頁,要擋掉
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(card); }
      });
    });

    el.modal.addEventListener('click', function (e) {
      if (e.target.closest('[data-bd-close]')) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window, document);
