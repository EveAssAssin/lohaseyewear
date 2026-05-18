/* =============================================================
   創作者公開頁 · creator-public.js
   ============================================================= */

(function () {
  'use strict';

  const grads = ['', 'g2', 'g3', 'g4'];
  const photoGrads = ['', 'g2', 'g3'];

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function getAvatarText(name) {
    if (!name) return '--';
    return name.length > 2 ? name.slice(-2) : name;
  }

  function showError(msg) {
    document.getElementById('cpLoading').innerHTML = `<i class="fa-solid fa-circle-exclamation" style="font-size:24px;color:#C97B5C;margin-bottom:12px;display:block"></i>${escapeHtml(msg)}`;
  }

  async function loadCreatorPage() {
    const params = new URLSearchParams(window.location.search);
    const erpid = params.get('id');

    if (!erpid) { showError('沒有指定創作者'); return; }

    const sb = window.LohasSupabase?.getClient();
    if (!sb) { showError('系統暫時無法使用'); return; }

    // 抓創作者資料 (creator_info 是主要來源, members 表不在 Supabase 內)
    const { data: creatorInfo } = await sb
      .from('creator_info')
      .select('display_name, bio, avatar_url, social_links, joining_story, joining_photo_url, video_url, video_title, tagline, custom_blocks, status')
      .eq('member_id', erpid)
      .maybeSingle();

    if (!creatorInfo) { showError('此會員尚未開通創作者'); return; }

    // 隱藏狀態 (status != 'active') → 自動 redirect 到刻圖市集
    if (creatorInfo.status && creatorInfo.status !== 'active') {
      window.location.replace('market.html');
      return;
    }

    // member 直接用 erpid 跟 creator_info.display_name 組成
    const member = { erpid, name: creatorInfo.display_name || erpid };

    // 記錄一次瀏覽
    try {
      const stored = window.LohasAuth?.getStoredMember?.();
      await sb.from('creator_views').insert({
        creator_id: erpid,
        viewer_id: stored ? stored.erpid : null,
        user_agent: navigator.userAgent.slice(0, 200),
        referrer: document.referrer.slice(0, 200) || null
      });
    } catch (e) { console.warn('[計數失敗]', e); }

    // 抓上架設計
    const { data: designs } = await sb
      .from('engraving_designs')
      .select('id, name, image_url, design_type')
      .eq('creator_id', erpid)
      .eq('status', 'approved')
      .order('created_at', { ascending: false });

    // 抓累計使用次數
    let totalUsed = 0;
    if (designs && designs.length > 0) {
      const { count } = await sb
        .from('royalty_records')
        .select('id', { count: 'exact', head: true })
        .in('design_id', designs.map(d => d.id));
      totalUsed = count || 0;
    }

    // 抓總瀏覽數
    const { count: totalViews } = await sb
      .from('creator_views')
      .select('id', { count: 'exact', head: true })
      .eq('creator_id', erpid);

    // 抓照片
    const postsTable = (window.LohasSupabase.CONFIG && window.LohasSupabase.CONFIG.POSTS_TABLE) || 'gallery_posts';
    const { data: photos } = await sb
      .from(postsTable)
      .select('id, title, main_image_url, image_urls, type, status')
      .eq('member_id', erpid)
      .eq('status', 'approved');

    // 合併:照片卡 + 故事卡 都顯示在「刻圖分享照片」區
    const allPhotos = (photos || []).slice(0, 12);

    // 渲染
    const dn = creatorInfo.display_name || member.name || '創作者';
    const bio = creatorInfo.bio || '';
    const tagline = creatorInfo.tagline || '';
    const social = creatorInfo.social_links || {};
    const joiningStory = creatorInfo.joining_story || '';
    const joiningPhoto = creatorInfo.joining_photo_url || '';
    const videoUrl = creatorInfo.video_url || '';
    const videoTitle = creatorInfo.video_title || '';
    const customBlocks = Array.isArray(creatorInfo.custom_blocks) ? creatorInfo.custom_blocks : [];

    const avatarHtml = creatorInfo.avatar_url
      ? `<img src="${escapeHtml(creatorInfo.avatar_url)}" alt="${escapeHtml(dn)}">`
      : escapeHtml(getAvatarText(dn));

    // 社群
    const socialItems = [];
    if (social.instagram) socialItems.push(`<a class="social-link ig" href="${escapeHtml(social.instagram)}" target="_blank"><i class="fa-brands fa-instagram"></i>Instagram</a>`);
    if (social.facebook) socialItems.push(`<a class="social-link fb" href="${escapeHtml(social.facebook)}" target="_blank"><i class="fa-brands fa-facebook"></i>Facebook</a>`);
    if (social.website) socialItems.push(`<a class="social-link web" href="${escapeHtml(social.website)}" target="_blank"><i class="fa-solid fa-globe"></i>網站</a>`);
    if (social.line) socialItems.push(`<a class="social-link line" href="https://line.me/ti/p/${escapeHtml(social.line)}" target="_blank"><i class="fa-brands fa-line"></i>LINE</a>`);
    if (social.email) socialItems.push(`<a class="social-link email" href="mailto:${escapeHtml(social.email)}"><i class="fa-regular fa-envelope"></i>${escapeHtml(social.email)}</a>`);

    // 設計卡
    const designsHtml = (designs && designs.length > 0)
      ? designs.slice(0, 8).map((d, i) => {
          const grad = grads[i % grads.length];
          return `
            <div class="pf-design">
              <div class="pf-design-img ${grad}" ${d.image_url ? `style="background-image:url('${escapeHtml(d.image_url)}')"` : ''}>
                ${d.image_url ? '' : escapeHtml(d.name || '')}
              </div>
              <div class="pf-design-name">${escapeHtml(d.name || '未命名')}</div>
              <div class="pf-design-meta">${escapeHtml(d.design_type || '圖案')}</div>
            </div>`;
        }).join('')
      : '<p class="empty-text" style="grid-column:1/-1">還沒上架任何設計</p>';

    // 刻圖分享照片 (合併 photo + story 卡)
    const photosHtml = allPhotos.length > 0
      ? allPhotos.map((p, i) => {
          const cover = p.main_image_url || (Array.isArray(p.image_urls) && p.image_urls[0]) || '';
          const grad = photoGrads[i % photoGrads.length];
          return `<div class="photo ${grad}" ${cover ? `style="background-image:url('${escapeHtml(cover)}')"` : ''}></div>`;
        }).join('')
      : '<p class="empty-text" style="grid-column:1/-1">還沒上傳照片</p>';

    // 影片 (從 YouTube URL 抓 video ID)
    const videoSection = videoUrl ? renderVideoSection(videoUrl, videoTitle) : '';

    // 緣分區 (joining story) — 若有自訂區跟在後面則無分隔線
    const joiningNoDivider = customBlocks.length > 0 ? ' no-divider' : '';
    const joiningSection = (joiningStory || joiningPhoto) ? `
      <div class="pf-section${joiningNoDivider}" id="sec-joining">
        <div class="pf-section-eb">STORY OF JOINING</div>
        <h2 class="pf-section-h">與樂活的緣分</h2>
        <div class="pf-section-sub">${escapeHtml(dn)} 是怎麼成為樂活的合作創作者的</div>
        <div class="joining-content">
          <div class="joining-photo" ${joiningPhoto ? `style="background-image:url('${escapeHtml(joiningPhoto)}')"` : ''}>
            ${joiningPhoto ? '' : '[ 配 鏡 照 片 ]'}
          </div>
          <div class="joining-text">${escapeHtml(joiningStory)}</div>
        </div>
      </div>
    ` : '';

    // 自訂區塊
    const customBlocksHtml = customBlocks.length > 0
      ? customBlocks.map((b, i) => {
          const hasTitle = b.title && b.title.trim();
          const titleBlock = hasTitle
            ? `<div class="pf-section-eb">SECTION · 0${i + 1}</div>
               <h2 class="pf-section-h">${escapeHtml(b.title)}</h2>`
            : '';
          // 除最後一個自訂區外都 no-divider (跟前一個自訂區之間無線)
          const isLast = (i === customBlocks.length - 1);
          const ndClass = isLast ? '' : ' no-divider';

          return `
            <div class="pf-section${ndClass}">
              ${titleBlock}
              <div class="joining-content">
                ${b.image
                  ? `<div class="joining-photo" style="background-image:url('${escapeHtml(b.image)}')"></div>`
                  : '<div></div>'}
                <div class="joining-text">${escapeHtml(b.text || '')}</div>
              </div>
            </div>
          `;
        }).join('')
      : '';

    document.getElementById('cpLoading').style.display = 'none';
    const cp = document.getElementById('cp');
    cp.style.display = '';
    cp.innerHTML = `
      <div class="pf-topnav">
        <div class="crumb">
          <a href="index.html">LOHAS 首頁</a> &nbsp;›&nbsp;
          <a href="market.html">創作刻圖市集</a> &nbsp;›&nbsp;
          <b>${escapeHtml(dn)}</b>
        </div>
        <div class="actions">
          <button id="shareBtn"><i class="fa-solid fa-arrow-up-from-bracket"></i>分享</button>
        </div>
      </div>

      <div class="pf-hero">
        <div class="pf-avatar">${avatarHtml}</div>
        <div class="pf-body">
          <div class="pf-eb">L O H A S &nbsp; C R E A T O R</div>
          <div class="pf-name-row">
            <h1 class="pf-name">${escapeHtml(dn)}</h1>
            <span class="id-pill"><i class="fa-solid fa-star"></i>創作者</span>
          </div>
          ${tagline ? `<div class="pf-tag">${escapeHtml(tagline)}</div>` : ''}
          ${bio ? `<p class="pf-bio">${escapeHtml(bio)}</p>` : ''}
          <div class="pf-social">${socialItems.join('') || '<span style="font-size:12px;color:var(--lohas-mute)">尚未設定聯絡方式</span>'}</div>
        </div>
      </div>

      <div class="anchor-nav">
        ${joiningStory ? '<button class="anchor on" data-target="sec-joining">與樂活的緣分</button><span class="anchor-divider"></span>' : ''}
        <button class="anchor ${joiningStory ? '' : 'on'}" data-target="sec-designs">我的刻圖設計</button>
        <span class="anchor-divider"></span>
        <button class="anchor" data-target="sec-photos">刻圖分享照片</button>
      </div>

      ${joiningSection}
      ${customBlocksHtml}
      ${videoSection}

      <div class="pf-section" id="sec-designs">
        <div class="pf-section-eb">DESIGNS</div>
        <h2 class="pf-section-h">我的刻圖設計</h2>
        <div class="pf-section-sub">${(designs || []).length} 件已上架</div>
        <div class="pf-designs">${designsHtml}</div>
      </div>

      <div class="pf-section" id="sec-photos">
        <div class="pf-section-eb">PHOTOS</div>
        <h2 class="pf-section-h">刻圖分享照片</h2>
        <div class="pf-section-sub">${allPhotos.length} 張公開照片</div>
        <div class="photos-grid">${photosHtml}</div>
      </div>

      <div class="pf-footer-cta">
        <h3>想看更多創作者?</h3>
        <p>樂活的創作者,每個人都有自己的位置。</p>
        <div class="btns">
          <button class="primary" onclick="location.href='market.html'"><i class="fa-solid fa-arrow-left"></i>回 到 創 作 者 市 集</button>
          <button class="ghost" onclick="location.href='gallery.html'">逛 靈 感 分 享 牆<i class="fa-solid fa-arrow-right"></i></button>
        </div>
      </div>
    `;

    bindAnchors();
    bindShareFollow(dn);
  }

  function extractIgHandle(url) {
    const m = url.match(/instagram\.com\/([^/?#]+)/);
    return m ? '@' + m[1] : null;
  }

  function extractYoutubeId(url) {
    if (!url) return null;
    const patterns = [
      /youtube\.com\/watch\?v=([^&]+)/,
      /youtu\.be\/([^?&]+)/,
      /youtube\.com\/embed\/([^?&]+)/
    ];
    for (const p of patterns) {
      const m = url.match(p);
      if (m) return m[1];
    }
    return null;
  }

  function renderVideoSection(url, title) {
    const videoId = extractYoutubeId(url);
    if (videoId) {
      // 是真實影片 - 嵌入 YouTube
      return `
        <div class="video-section">
          <div class="video-eb">— V I D E O</div>
          <h2 class="video-h">${escapeHtml(title || '創作者影片')}</h2>
          <div class="video-frame-wrap">
            <div class="yt-frame">
              <iframe src="https://www.youtube.com/embed/${videoId}" title="${escapeHtml(title || '')}" allowfullscreen></iframe>
            </div>
            <div class="video-caption"><i class="fa-brands fa-youtube"></i>創作者影片</div>
          </div>
        </div>`;
    }

    // 不是影片網址 (例如 YouTube 頻道) - 顯示連結卡片
    return `
      <div class="video-section">
        <div class="video-eb">— V I D E O</div>
        <h2 class="video-h">${escapeHtml(title || '創作者頻道')}</h2>
        <div class="video-frame-wrap" style="text-align:center">
          <a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:10px;padding:16px 28px;background:#fff;border:1px solid var(--lohas-line);border-radius:999px;color:var(--lohas-brown);text-decoration:none;font-size:13px;letter-spacing:1px;font-weight:600;transition:all .2s">
            <i class="fa-brands fa-youtube" style="color:#FF0000;font-size:18px"></i>
            前往 YouTube 頻道
            <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:10px;opacity:0.5"></i>
          </a>
        </div>
      </div>`;
  }

  function bindAnchors() {
    document.querySelectorAll('.anchor').forEach(a => {
      a.addEventListener('click', () => {
        document.querySelectorAll('.anchor').forEach(x => x.classList.remove('on'));
        a.classList.add('on');
        const target = document.getElementById(a.dataset.target);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  function bindShareFollow(name) {
    document.getElementById('followBtn')?.addEventListener('click', () => {
      alert('追蹤功能即將推出');
    });
    document.getElementById('shareBtn')?.addEventListener('click', () => {
      const url = window.location.href;
      if (navigator.share) {
        navigator.share({ title: name + ' · LOHAS 創作者', url }).catch(() => {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(() => alert('連結已複製到剪貼簿'));
      } else {
        prompt('請複製連結:', url);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', loadCreatorPage);
})();
