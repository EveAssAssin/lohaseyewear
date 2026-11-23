/* =============================================
   LohasUI · 提示 / 確認 / 輸入框 / Toast
   --------------------------------------------
   取代瀏覽器原生的 alert / confirm / prompt。
   樣式:css/lohas-ui.css —— 這支載入時會自動加上 <link>(同一個 ?v=),頁面不必自己載。
   依賴:無。有載 lohas-tokens.css 就用 token,沒有就用 CSS 裡的備用值。

   用法(全部回傳 Promise):
     await LohasUI.alert('儲存失敗:' + err.message);
     if (!(await LohasUI.confirm('確定刪除?\n\n無法復原'))) return;
     const name = await LohasUI.prompt('輸入名稱:', '預設值');   // 取消 → null
     LohasUI.toast('已儲存');                // 不擋流程,2.6 秒後自己消失
     LohasUI.toast('上傳失敗', 'error');

   ⚠ 與原生不同的地方:原生是「同步」的,這裡是 Promise。
     原本  if (!confirm(x)) return;
     要改成 if (!(await LohasUI.confirm(x))) return;   ← 少了 await,
     Promise 永遠是 truthy,「取消」也會照樣執行下去。

   多個框同時被叫出來時會排隊,一次只顯示一個(跟原生一樣)。
   ============================================= */
(function () {
  'use strict';
  if (window.LohasUI) return;

  /* 自動載入樣式:js/lohas-ui.js?v=X → css/lohas-ui.css?v=X(跟著 JS 的版號,換版不會拿到舊快取) */
  (function loadCss() {
    if (document.querySelector('link[data-lohas-ui]')) return;
    var me = document.currentScript;
    var src = me && me.src ? me.src : '';
    var href = src ? src.replace(/js\/lohas-ui\.js/, 'css/lohas-ui.css') : 'css/lohas-ui.css';
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute('data-lohas-ui', '');
    (document.head || document.documentElement).appendChild(link);
  })();

  // 訊息裡有這些字就當成「危險動作」,確定鈕變紅色
  var DANGER_RE = /刪除|無法復原|永久|停權|移至垃圾桶|覆蓋/;

  var queue = Promise.resolve();

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function normalize(opts) {
    if (opts == null) return {};
    if (typeof opts === 'string') return { title: opts };
    return opts;
  }

  // 排隊:前一個框關掉之後才開下一個
  function enqueue(fn) {
    var run = queue.then(fn, fn);
    queue = run.then(function () {}, function () {});
    return run;
  }

  function open(kind, message, opts) {
    return enqueue(function () {
      return new Promise(function (resolve) {
        var msg = message == null ? '' : String(message);
        var danger = opts.danger != null ? !!opts.danger
          : (kind === 'confirm' && DANGER_RE.test(msg));
        var tone = opts.tone || (danger ? 'danger' : '');

        var ovl = el('div', 'lohas-dlg-ovl');
        var dlg = el('div', 'lohas-dlg' + (tone ? ' lohas-dlg--' + tone : ''));
        dlg.setAttribute('role', kind === 'alert' ? 'alertdialog' : 'dialog');
        dlg.setAttribute('aria-modal', 'true');
        dlg.tabIndex = -1;

        var body = el('div', 'lohas-dlg-body');
        var title = opts.title || (kind === 'confirm' ? (danger ? '請再確認一次' : '確認')
          : kind === 'prompt' ? '請輸入' : '提示');
        var h = el('h2', 'lohas-dlg-title');
        var icon = el('i', null, danger ? '!' : (tone === 'ok' ? '✓' : (kind === 'prompt' ? '✎' : 'i')));
        icon.setAttribute('aria-hidden', 'true');
        h.appendChild(icon);
        h.appendChild(document.createTextNode(title));
        var id = 'lohasDlg' + Date.now();
        h.id = id + 't';
        dlg.setAttribute('aria-labelledby', h.id);
        body.appendChild(h);

        if (msg) {
          var p = el('p', 'lohas-dlg-msg', msg);
          p.id = id + 'm';
          dlg.setAttribute('aria-describedby', p.id);
          body.appendChild(p);
        }

        var input = null;
        if (kind === 'prompt') {
          input = el('input', 'lohas-dlg-input');
          input.type = 'text';
          input.value = opts.defaultValue == null ? '' : String(opts.defaultValue);
          if (opts.placeholder) input.placeholder = opts.placeholder;
          body.appendChild(input);
        }
        dlg.appendChild(body);

        var actions = el('div', 'lohas-dlg-actions');
        var cancelBtn = null;
        if (kind !== 'alert') {
          cancelBtn = el('button', 'lohas-dlg-btn lohas-dlg-btn--ghost', opts.cancelText || '取消');
          cancelBtn.type = 'button';
          actions.appendChild(cancelBtn);
        }
        var okBtn = el('button', 'lohas-dlg-btn ' + (danger ? 'lohas-dlg-btn--danger' : 'lohas-dlg-btn--pri'),
          opts.okText || '確定');
        okBtn.type = 'button';
        actions.appendChild(okBtn);
        dlg.appendChild(actions);
        ovl.appendChild(dlg);

        var lastFocus = document.activeElement;
        var done = false;

        function close(result) {
          if (done) return;
          done = true;
          document.removeEventListener('keydown', onKey, true);
          ovl.classList.remove('show');
          setTimeout(function () { if (ovl.parentNode) ovl.parentNode.removeChild(ovl); }, 260);
          if (lastFocus && typeof lastFocus.focus === 'function' && document.contains(lastFocus)) {
            try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* 舊瀏覽器 */ }
          }
          resolve(result);
        }
        function ok() {
          if (kind === 'confirm') close(true);
          else if (kind === 'prompt') close(input.value);
          else close(undefined);
        }
        function cancel() {
          if (kind === 'confirm') close(false);
          else if (kind === 'prompt') close(null);
          else close(undefined);
        }
        function onKey(e) {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); return; }
          if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
            // 中文輸入法選字時的 Enter 不算送出
            if (document.activeElement === cancelBtn) return;
            e.preventDefault(); e.stopPropagation(); ok(); return;
          }
          if (e.key === 'Tab') {
            // 焦點鎖在框內
            var f = [input, cancelBtn, okBtn].filter(Boolean);
            var i = f.indexOf(document.activeElement);
            e.preventDefault();
            f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus();
          }
        }

        okBtn.addEventListener('click', ok);
        if (cancelBtn) cancelBtn.addEventListener('click', cancel);
        // 點背景:確認/輸入當成取消;單純提示不關(避免誤觸漏看錯誤訊息)
        ovl.addEventListener('click', function (e) {
          if (e.target === ovl && kind !== 'alert') cancel();
        });
        document.addEventListener('keydown', onKey, true);

        document.body.appendChild(ovl);
        // 下一幀再加 show,才有淡入
        requestAnimationFrame(function () { ovl.classList.add('show'); });
        // 危險動作預設焦點放在「取消」,誤按 Enter 不會刪東西
        var first = input || (danger && cancelBtn) || okBtn;
        setTimeout(function () {
          first.focus();
          if (input) input.select();
        }, 30);
      });
    });
  }

  var toastTimer = null;
  function toast(message, type, ms) {
    var t = document.getElementById('lohasUiToast');
    if (!t) {
      t = el('div', 'lohas-ui-toast');
      t.id = 'lohasUiToast';
      t.setAttribute('role', 'status');
      t.setAttribute('aria-live', 'polite');
      document.body.appendChild(t);
    }
    t.classList.remove('toast-ok', 'toast-error');
    if (type === 'ok' || type === 'success') t.classList.add('toast-ok');
    else if (type === 'error' || type === 'err') t.classList.add('toast-error');
    t.textContent = message == null ? '' : String(message);
    // 先拿掉再加,連續觸發時也會重新淡入
    t.classList.remove('show');
    void t.offsetWidth;
    t.classList.add('show');
    clearTimeout(toastTimer);
    // 預設停留時間跟著字數走:短句 2.6 秒,長句最多 8 秒
    var auto = Math.min(8000, Math.max(2600, t.textContent.length * 90));
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms || auto);
  }

  window.LohasUI = {
    alert: function (message, opts) { return open('alert', message, normalize(opts)); },
    confirm: function (message, opts) { return open('confirm', message, normalize(opts)); },
    prompt: function (message, defaultValue, opts) {
      var o = normalize(opts);
      o.defaultValue = defaultValue;
      return open('prompt', message, o);
    },
    toast: toast
  };
})();
