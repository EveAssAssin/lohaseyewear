/* ============================================================
   樂活管理後台 · 生日眼鏡布活動連結 (cm-cloth-share)
   ------------------------------------------------------------
   客人做完生日眼鏡布,完成畫面上「去活動貼文留言」要開哪一篇 Threads 貼文。
   存在 site_settings (key = 'cloth_share', value = { threads_url })。
   前台 js/cloth.js 的 loadShareUrl() 讀這個 key;沒設定時用它自己寫死的備用值。

   🚨 只收貼文的【完整網址】(threads.com/@帳號/post/貼文代碼)。
     share/xxx 短連結在手機裝了 Threads App 時常常只打開 App 首頁、
     不會跳到那篇貼文(2026-10-01 門市回報)。前台也用同一個格式檢查,
     格式不對就不採用 —— 所以這裡一定要擋下來講清楚,不然存了等於沒換。
   ============================================================ */

(function () {
  'use strict';

  const STORAGE_KEY = 'cloth_share';
  const URL_OK = /^https:\/\/www\.threads\.(com|net)\/@[A-Za-z0-9_.]+\/post\/[A-Za-z0-9_-]+$/;

  let loaded = false;

  function getSb() {
    return window.LohasSupabase && window.LohasSupabase.getClient && window.LohasSupabase.getClient();
  }

  function root() {
    return document.querySelector('.content-page[data-page="cm-cloth-share"]');
  }

  function $(id) { return document.getElementById(id); }

  /* 去掉 ?xmt=… 這類追蹤參數與結尾斜線;threads.net 一律換成 threads.com。 */
  function normalize(raw) {
    let s = String(raw || '').trim();
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    try {
      const u = new URL(s);
      let host = u.hostname.toLowerCase();
      if (host === 'threads.com' || host === 'threads.net' || host === 'www.threads.net') host = 'www.threads.com';
      return 'https://' + host + u.pathname.replace(/\/+$/, '');
    } catch (e) { return s; }
  }

  function setMsg(text, tone) {
    const m = $('clothShareMsg');
    if (!m) return;
    m.textContent = text || '';
    m.style.color = tone === 'bad' ? '#c0392b' : tone === 'good' ? '#2e7d32' : '#888';
  }

  function check() {
    const url = normalize($('clothShareInput').value);
    const test = $('clothShareTest');
    if (!url) {
      setMsg('請貼上 Threads 貼文網址', 'bad');
      if (test) test.removeAttribute('href');
      return null;
    }
    if (/\/share\//.test(url)) {
      setMsg('這是「分享短連結」,不能直接用。請先用電腦瀏覽器打開它,等網址列變成「threads.com/@lohas_eyewears/post/…」之後,把網址列那一串複製貼上。', 'bad');
      if (test) test.href = url;
      return null;
    }
    if (!URL_OK.test(url)) {
      setMsg('格式不對。要長得像:https://www.threads.com/@lohas_eyewears/post/貼文代碼', 'bad');
      if (test) test.removeAttribute('href');
      return null;
    }
    setMsg('格式正確。可以先按「打開看看」確認是不是這個月的活動貼文,再按儲存。', 'good');
    if (test) test.href = url;
    return url;
  }

  async function load() {
    const sb = getSb();
    if (!sb) return;
    try {
      const { data, error } = await sb
        .from('site_settings')
        .select('value, updated_at')
        .eq('key', STORAGE_KEY)
        .maybeSingle();
      if (error) throw error;
      const url = (data && data.value && data.value.threads_url) || '';
      $('clothShareInput').value = url;
      const cur = $('clothShareCurrent');
      if (cur) {
        cur.textContent = url
          ? '目前前台使用:' + url + (data.updated_at ? '(' + new Date(data.updated_at).toLocaleString('zh-TW') + ' 更新)' : '')
          : '後台還沒設定過,前台目前用程式裡的預設連結。';
      }
      if (url) check(); else setMsg('');
      loaded = true;
    } catch (e) {
      console.warn('[cm-cloth-share] load failed:', e);
      setMsg('讀取失敗,請重新整理再試', 'bad');
    }
  }

  async function save() {
    const url = check();
    if (!url) return;
    const btn = $('clothShareSave');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>儲存中...</span>'; }
    try {
      /* 走 admin-write,不直接打表(site_settings 的 anon 政策只剩 SELECT)。 */
      if (!window.LohasAdminWrite) throw new Error('後台寫入模組未載入,請重新整理');
      await window.LohasAdminWrite('site_settings', 'upsert',
        { key: STORAGE_KEY, value: { threads_url: url }, updated_at: new Date().toISOString() });
      $('clothShareInput').value = url;
      await load();
      setMsg('已儲存。客人下一次做完眼鏡布,「去活動貼文留言」就會開這一篇。', 'good');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-check"></i><span>已儲存</span>';
        setTimeout(() => { btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i><span>儲存</span>'; }, 2000);
      }
    } catch (e) {
      alert('儲存失敗:' + (e.message || '未知錯誤'));
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i><span>儲存</span>';
      }
    }
  }

  function bind() {
    const r = root();
    if (!r || r.dataset.clothShareBound) return;
    r.dataset.clothShareBound = '1';
    $('clothShareInput').addEventListener('input', check);
    $('clothShareSave').addEventListener('click', save);
  }

  async function init() {
    if (!root()) return;
    bind();
    if (!loaded) await load();
  }

  // 切換到 cm-cloth-share 時初始化
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('.nav-link[data-page="cm-cloth-share"], .drawer-item[data-page="cm-cloth-share"]');
    if (!btn) return;
    setTimeout(init, 50);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
