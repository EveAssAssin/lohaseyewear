/* =============================================================
   客製眼鏡布分享牆(cloth.html 最下方那一區)
   -------------------------------------------------------------
   資料來自 cloth-wall Edge Function。

   ⚠ 姓名遮罩是在【伺服器端】做的,不在這裡。
     前端遮罩等於把完整姓名送到每一個訪客的瀏覽器再請它別顯示 ——
     看 network 面板就拿得到。這裡收到的 nickname 已經是「王**」。

   ⚠ 只顯示 status = done 的,那也是伺服器決定的。
     還在製作中的放上來,客人會問「別人的都好了我的怎麼還沒」。

   ⚠ 這一區【失敗就整區收起來】,不要顯示錯誤訊息。
     它是錦上添花,不是功能;為了它在客製眼鏡布主流程上放一塊
     紅色錯誤,會讓人以為自己的設計出問題了。
   ============================================================= */
(function () {
  'use strict';

  var CONFIG = {
    ENDPOINT: 'https://hqdmyxxrskvllkcedybl.supabase.co/functions/v1/cloth-wall',
    PAGE: 12,
    TIMEOUT_MS: 8000,
  };

  /* seed:這一次瀏覽的亂數種子。
     -----------------------------------------------------------------
     分享牆是隨機排序的,但【分頁必須接得起來】——
     每一頁各自隨機的話,同一張會出現在第 1 頁也出現在第 2 頁,
     而另一些永遠輪不到。種子固定,伺服器每次都洗出同一個順序,
     切頁才對得上。

     每次載入頁面換一個新的 → 每個訪客、每次重新整理都看到不同的排法。 */
  var State = {
    offset: 0, total: 0, loading: false, done: false,
    seed: (Math.floor(Math.random() * 2147483647) || 1)
  };
  var el = {};

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* 日期只給到「月」。
     給到日的話,配上一張照片與半個名字,等於多一個可以對上的線索;
     而客人要的資訊只是「最近有人做」。 */
  function fmtMonth(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月';
  }

  function cardHtml(it) {
    if (!it.image_url) return '';
    return '' +
      '<article class="cw-card">' +
        '<div class="cw-media">' +
          '<img src="' + esc(it.image_url) + '" alt="" loading="lazy" decoding="async">' +
        '</div>' +
        '<div class="cw-body">' +
          '<span class="cw-name">' + esc(it.nickname || '樂活客人') + '</span>' +
          '<span class="cw-date">' + esc(fmtMonth(it.done_at)) + '</span>' +
        '</div>' +
      '</article>';
  }

  function load() {
    if (State.loading || State.done) return;
    State.loading = true;
    if (el.more) el.more.textContent = '載 入 中...';

    var ctrl = new AbortController();
    var to = setTimeout(function () { ctrl.abort(); }, CONFIG.TIMEOUT_MS);

    fetch(CONFIG.ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        limit: CONFIG.PAGE, offset: State.offset, seed: State.seed
      }),
      signal: ctrl.signal,
    })
      .then(function (r) { clearTimeout(to); return r.json(); })
      .then(function (j) {
        if (String(j.code) !== '200') throw new Error(j.message || '載入失敗');
        var d = j.data || {};
        var items = d.items || [];
        State.total = Number(d.total) || 0;

        /* 一張都沒有就整區收起來 —— 空的分享牆比沒有分享牆難看,
           而且會讓人以為「沒有人做過」。 */
        if (!items.length && State.offset === 0) {
          if (el.sec) el.sec.hidden = true;
          State.done = true;
          return;
        }

        var html = items.map(cardHtml).join('');
        if (el.wall) el.wall.insertAdjacentHTML('beforeend', html);
        State.offset += items.length;

        if (State.offset >= State.total || !items.length) {
          State.done = true;
          if (el.more) el.more.hidden = true;
          if (el.end) el.end.hidden = false;
        } else if (el.more) {
          el.more.textContent = '看 更 多';
        }
      })
      .catch(function (e) {
        clearTimeout(to);
        console.warn('[cloth-wall] 載入失敗,整區收起來:', e && e.message);
        if (el.sec) el.sec.hidden = true;      // 理由見檔頭
        State.done = true;
      })
      .finally(function () { State.loading = false; });
  }

  document.addEventListener('DOMContentLoaded', function () {
    el.sec  = document.getElementById('clWallSec');
    el.wall = document.getElementById('clWall');
    el.more = document.getElementById('clWallMore');
    el.end  = document.getElementById('clWallEnd');
    if (!el.sec || !el.wall) return;

    if (el.more) el.more.addEventListener('click', load);
    load();
  });
})();
