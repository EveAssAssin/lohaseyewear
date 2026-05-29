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

  async function loadArticle() {
    const params = new URLSearchParams(window.location.search);
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

    // 累加瀏覽數 (失敗無關緊要)
    try {
      sb.rpc('increment_news_view', { p_id: data.id }).catch(() => {});
      // 沒寫 rpc 也沒關係,fallback 直接 update
      sb.from('news').update({ view_count: (data.view_count || 0) + 1 }).eq('id', data.id).then(() => {});
    } catch (e) {}

    render(data);
  }

  function render(n) {
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

  function renderCta(ctaList) {
    const section = document.getElementById('ndCtaSection');
    const btnWrap = document.getElementById('ndCtaBtns');
    if (!section || !btnWrap) return;

    // 門市永遠顯示, 大學生依後台勾選決定
    const showStudent = Array.isArray(ctaList) && ctaList.includes('student');

    // 第一顆: 門市 (solid)
    let html = `<a href="allstore.html" class="lohas-cta-btn lohas-cta-btn--solid">
      <i class="fa-solid fa-location-dot"></i>門市據點
    </a>`;
    // 第二顆: 大學生 (ghost)
    if (showStudent) {
      html += `<a href="https://student.lohasglasses.com/" class="lohas-cta-btn lohas-cta-btn--ghost" target="_blank" rel="noopener">
        <i class="fa-solid fa-graduation-cap"></i>大學生入口
      </a>`;
    }

    btnWrap.innerHTML = html;
    section.style.display = '';
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
