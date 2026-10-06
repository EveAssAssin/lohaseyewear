/* =============================================================
   最新消息內頁 · news-detail.js
   ============================================================= */

(function () {
  'use strict';

  const CAT_LABEL = {
    story: '品牌故事',
    event: '活動優惠',
    engraving: '雷刻服務',
    people: '人物誌',
    member: '會員專區',
    official: '官方公告'
  };

  function $(id) { return document.getElementById(id); }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatDate(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return y + '.' + m + '.' + day;
    } catch { return ''; }
  }

  function showError(msg) {
    $('ndLoading').style.display = 'none';
    $('ndError').style.display = '';
    if (msg) $('ndErrorMsg').textContent = msg;
  }

  // ===== 內文 render (允許簡單 HTML / 段落) =====
  function renderContent(text) {
    if (!text) return '';
    // 判斷如果已經是 HTML (有 < 標籤),直接使用
    if (/^\s*<.+>/s.test(text)) {
      return text;
    }
    // 否則,把純文字按段落切分,每段包 <p>
    return text.split(/\n\s*\n/).map(p => {
      const trimmed = p.trim();
      if (!trimmed) return '';
      // 簡單的 markdown: ## 標題, > 引用
      if (trimmed.startsWith('## ')) {
        return '<h2>' + escapeHtml(trimmed.slice(3)) + '</h2>';
      }
      if (trimmed.startsWith('# ')) {
        return '<h2>' + escapeHtml(trimmed.slice(2)) + '</h2>';
      }
      if (trimmed.startsWith('> ')) {
        return '<blockquote>' + escapeHtml(trimmed.slice(2)) + '</blockquote>';
      }
      return '<p>' + escapeHtml(trimmed).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  /* 後台「預覽」(2026-10-06 修)。
     -----------------------------------------------------------------
     後台把編輯中的內容存進 sessionStorage('lohas_news_preview'),再開
     news-detail.html?preview=1。在這之前這一頁【從來不讀】那份資料 ——
     只認 ?id=,於是預覽一律顯示「沒有指定文章」,預覽按鈕等於壞的。
     ⚠ window.open 開的分頁會帶著一份 sessionStorage 的複本,所以讀得到;
       直接複製網址到別的分頁就讀不到(那是對的,預覽不該能分享)。
     ⚠ 預覽不累加瀏覽數、不碰資料庫。 */
  function loadPreview() {
    let data = null;
    try { data = JSON.parse(sessionStorage.getItem('lohas_news_preview') || 'null'); } catch (e) { data = null; }
    if (!data || !data.title) {
      showError('預覽資料不見了,請回後台再按一次「預覽」');
      return;
    }
    const bar = document.createElement('div');
    bar.textContent = '預覽模式 · 這是後台編輯中的內容,尚未存檔前只有你看得到';
    bar.style.cssText = 'position:sticky;top:70px;z-index:50;margin:0 0 16px;padding:10px 14px;' +
      'background:#fff4e5;color:#8a5a00;border:1px solid #f0d9a8;border-radius:10px;' +
      'font-size:13.5px;text-align:center';
    const art = $('ndArticle');
    if (art && art.parentNode) art.parentNode.insertBefore(bar, art);
    render(data);
    document.title = '[預覽] ' + document.title;
  }

  async function loadArticle() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('preview') === '1') { loadPreview(); return; }
    const id = params.get('id');

    if (!id) {
      showError('沒有指定文章');
      return;
    }

    const sb = window.LohasSupabase && window.LohasSupabase.getClient && window.LohasSupabase.getClient();
    if (!sb) {
      showError('系統暫時無法使用');
      return;
    }

    const { data, error } = await sb
      .from('news')
      .select('*')
      .eq('slug', id)
      .eq('status', 'published')
      .maybeSingle();

    if (error) {
      console.error('[載入失敗]', error);
      showError('載入失敗');
      return;
    }
    if (!data) {
      showError('找不到這篇文章,可能已下架');
      return;
    }

    /* 累加瀏覽數。失敗無關緊要,但【不要兩條路一起打】。
       -----------------------------------------------------------------
       🚨 原本這裡同時呼叫 RPC 與直接 update,註解寫著「沒寫 rpc 也沒關係,
         fallback 直接 update」—— 但那不是 fallback,是【兩條都會跑】。
         RPC 若存在,瀏覽數就會一次加二,而且沒有人會發現。

       改成只走 RPC:前端算好數字再 update 等於任何人都能把瀏覽數
       設成任意值,而 RPC 只收一個 id,沒有指定數字的入口。 */
    sb.rpc('news_view_inc', { p_id: data.id }).then(r => {
      if (r && r.error) console.warn('[news] view_count +1 失敗:', r.error.message);
    });

    render(data);
  }

  function render(n) {
    // 存全域給 renderCta / 追蹤歸因用
    window.__ndArticle = n;

    document.title = n.title + ' · LOHAS 樂活眼鏡';

    // meta description
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc && n.excerpt) metaDesc.setAttribute('content', n.excerpt);

    $('ndCrumbCat').textContent = CAT_LABEL[n.category] || n.category;
    $('ndCat').textContent = CAT_LABEL[n.category] || n.category;
    $('ndDate').textContent = formatDate(n.published_at || n.created_at);
    $('ndTitle').textContent = n.title;
    $('ndExcerpt').textContent = n.excerpt || '';
    $('ndAuthor').textContent = n.author || '';

    if (n.cover_image_url) {
      const coverWrap = $('ndCoverWrap');
      coverWrap.style.display = '';
      const img = $('ndCover');
      img.src = n.cover_image_url;
      img.alt = n.title;
    }

    $('ndContent').innerHTML = renderContent(n.content || '');

    // 渲染 CTA 按鈕
    renderCta(Array.isArray(n.cta_buttons) ? n.cta_buttons : []);

    $('ndLoading').style.display = 'none';
    $('ndArticle').style.display = '';

    bindShare(n);
  }

  /* 文章底部的按鈕,分兩區(2026-10-06):
     · 自訂按鈕(後台「自訂按鈕」)—— 緊接在【內文正下方】(#ndCustomCta)
     · 固定按鈕 門市預約 / 學生預約 —— 在分享列下面的 CTA 區塊(#ndCtaSection),
       那一區的標題寫死「想親自看看刻圖效果?」,自訂按鈕放進去文不對題。
     cta_buttons 陣列裡兩種混在一起:'store' / 'student' 是固定按鈕,
     自訂按鈕每顆是一段 JSON 文字 {"t":"custom","label":…,"url":…}(物件也認)。 */
  function parseCustomCta(list) {
    return list.map(function (el) {
      let o = el;
      if (typeof el === 'string') {
        if (el.charAt(0) !== '{') return null;
        try { o = JSON.parse(el); } catch (e) { return null; }
      }
      if (!o || typeof o !== 'object' || o.t !== 'custom') return null;
      const label = String(o.label || '').trim().slice(0, 20);
      const url = String(o.url || '').trim();
      /* ⚠ 網址規則與後台 newsCtaUrlOk 相同,這裡再擋一次:
           後台檢查只是介面,資料庫裡的值才是實際會被印成 <a href> 的東西。 */
      const okUrl = /^(https?:\/\/|tel:|mailto:)/i.test(url) ||
                    (url && !/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^\/\//.test(url));
      return (label && okUrl) ? { label: label, url: url } : null;
    }).filter(Boolean);
  }

  /* 點擊:把文章來源寫進 sessionStorage(跨頁帶到 allstore → 預約完成),並推追蹤事件 */
  function bindCtaClicks(wrap) {
    wrap.querySelectorAll('[data-news-cta]').forEach(a => {
      a.addEventListener('click', function () {
        const src = {
          news_id: this.getAttribute('data-news-id') || '',
          news_title: this.getAttribute('data-news-title') || '',
          cta_type: this.getAttribute('data-news-cta') || '',
          ts: Date.now()
        };
        try {
          sessionStorage.setItem('lohas_booking_source', JSON.stringify(src));
        } catch (e) {}

        // 推 dataLayer 事件（GTM 轉發 GA4/Pixel）
        if (window.lohasTrack) {
          window.lohasTrack('news_cta_click', {
            news_id: src.news_id,
            news_title: src.news_title,
            cta_type: src.cta_type
          });
        }
      });
    });
  }

  // 第一顆 solid、其餘 ghost
  function styleButtons(buttons) {
    return buttons.map((btn, i) => {
      const cls = i === 0 ? 'lohas-cta-btn--solid' : 'lohas-cta-btn--ghost';
      return btn.replace('class="lohas-cta-btn"', `class="lohas-cta-btn ${cls}"`);
    }).join('');
  }

  function renderCta(ctaList) {
    // 舊資料(null/undefined)相容: fallback 為門市
    const list = Array.isArray(ctaList) ? ctaList : ['store'];
    const showStore = list.includes('store');
    const showStudent = list.includes('student');
    const customs = parseCustomCta(list);

    // 當前文章來源資訊（給轉換歸因用）
    const article = window.__ndArticle || {};
    const sourceId = article.id || '';
    const sourceTitle = article.title || document.title || '';

    // ---- 自訂按鈕:內文正下方 ----
    const customWrap = document.getElementById('ndCustomCta');
    if (customWrap) {
      if (!customs.length) {
        customWrap.innerHTML = '';
        customWrap.style.display = 'none';
      } else {
        customWrap.innerHTML = styleButtons(customs.map(function (c) {
          // 外站開新分頁;本站與 tel: / mailto: 在原分頁
          const external = /^https?:\/\//i.test(c.url) && !/^https?:\/\/(www\.)?lohasglasses\.com(\/|$)/i.test(c.url);
          return `<a href="${escAttr(c.url)}"
            class="lohas-cta-btn"${external ? ' target="_blank" rel="noopener"' : ''}
            data-news-cta="custom:${escAttr(c.label)}"
            data-news-id="${escAttr(sourceId)}"
            data-news-title="${escAttr(sourceTitle)}">${escAttr(c.label)}</a>`;
        }));
        customWrap.style.display = '';
        bindCtaClicks(customWrap);
      }
    }

    // ---- 固定按鈕:分享列下面的 CTA 區塊 ----
    const section = document.getElementById('ndCtaSection');
    const btnWrap = document.getElementById('ndCtaBtns');
    if (!section || !btnWrap) return;

    // 沒勾任何固定按鈕就整個 section 隱藏
    if (!showStore && !showStudent) {
      btnWrap.innerHTML = '';
      section.style.display = 'none';
      return;
    }

    const buttons = [];
    if (showStore) {
      buttons.push(`<a href="allstore.html"
        class="lohas-cta-btn"
        data-news-cta="store"
        data-news-id="${escAttr(sourceId)}"
        data-news-title="${escAttr(sourceTitle)}">
        <i class="fa-solid fa-location-dot"></i>門市預約
      </a>`);
    }
    if (showStudent) {
      buttons.push(`<a href="https://student.lohasglasses.com/"
        class="lohas-cta-btn"
        target="_blank" rel="noopener"
        data-news-cta="student"
        data-news-id="${escAttr(sourceId)}"
        data-news-title="${escAttr(sourceTitle)}">
        <i class="fa-solid fa-graduation-cap"></i>學生預約
      </a>`);
    }

    btnWrap.innerHTML = styleButtons(buttons);
    section.style.display = '';
    bindCtaClicks(btnWrap);
  }

  // HTML attribute 轉義
  function escAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function bindShare(n) {
    const url = window.location.href;
    const title = n.title;
    const text = n.excerpt || n.title;

    document.querySelectorAll('.nd-share-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.share;
        if (type === 'facebook') {
          window.open('https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url),
            '_blank', 'width=600,height=500');
        } else if (type === 'line') {
          window.open('https://social-plugins.line.me/lineit/share?url=' + encodeURIComponent(url),
            '_blank', 'width=600,height=500');
        } else if (type === 'instagram') {
          // IG 沒有官方分享 web intent,複製連結 + 開 IG 讓使用者貼上
          copyToClipboard(url, btn);
          setTimeout(() => {
            window.open('https://www.instagram.com/', '_blank');
          }, 200);
        } else if (type === 'copy') {
          copyToClipboard(url, btn);
        }
      });
    });
  }

  async function copyToClipboard(text, btn) {
    const label = $('ndCopyLabel');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // fallback
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      if (label) label.textContent = '已複製!';
      btn.classList.add('copied');
      setTimeout(() => {
        if (label) label.textContent = '複製連結';
        btn.classList.remove('copied');
      }, 2000);
    } catch (e) {
      console.error('複製失敗', e);
      alert('複製失敗,請手動複製: ' + text);
    }
  }

  document.addEventListener('DOMContentLoaded', loadArticle);
})();
