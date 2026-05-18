/*
 * engraving.js
 * 雷刻頁 KOL 配鏡分享區 動態載入
 *
 * 從 creator_info 表抓有 engraving_quote 的創作者
 * 置頂的排最前,其餘隨機排序
 */

(function(){
  'use strict';

  const SECTION_ID = 'kolSection';
  const FALLBACK_DETAIL_IMG = 'images/market-collab-05.jpg';

  document.addEventListener('DOMContentLoaded', loadKOL);

  async function loadKOL() {
    const section = document.getElementById(SECTION_ID);
    if(!section) {
      console.warn('[engraving KOL] 找不到 #kolSection');
      return;
    }

    const sb = window.LohasSupabase && window.LohasSupabase.getClient && window.LohasSupabase.getClient();
    if(!sb){
      console.warn('[engraving KOL] Supabase 未配置,保留靜態卡片');
      return;
    }
    console.log('[engraving KOL] Supabase ready, querying creator_info...');

    try {
      // 抓所有 active 創作者(含必要欄位)
      const { data, error } = await sb
        .from('creator_info')
        .select('member_id, display_name, tagline, avatar_url, kol_main_image_url, engraving_quote, status')
        .eq('status', 'active')
        .not('engraving_quote', 'is', null)
        .neq('engraving_quote', '');

      if(error){
        console.error('[engraving KOL] 載入失敗,保留靜態卡片', error);
        return;
      }
      console.log('[engraving KOL] 抓到', data?.length || 0, '位有 engraving_quote 的創作者', data);

      const creators = data || [];
      if(creators.length === 0){
        console.log('[engraving KOL] 沒有真實資料,保留靜態 8 張假卡');
        return;
      }

      // 全部隨機排序
      shuffle(creators);

      // 計算現有 .split-item 數量,讓新卡片接續 inverse 規則
      const existingCount = section.querySelectorAll('.split-item').length;

      // 在現有 HTML 8 張之後 append
      const newHtml = creators.map((c, i) => renderKolCard(c, existingCount + i)).join('');
      console.log('[engraving KOL] 既有', existingCount, '張 + 新增', creators.length, '張');
      section.insertAdjacentHTML('beforeend', newHtml);

    } catch (err) {
      console.error('[engraving KOL] err,保留靜態卡片', err);
    }
  }

  function renderKolCard(c, idx) {
    const inverse = (idx % 2 === 1) ? ' inverse' : '';
    const portrait = escAttr(c.avatar_url || 'images/kol-placeholder.jpg');
    const detail = escAttr(c.kol_main_image_url || FALLBACK_DETAIL_IMG);
    const name = escHtml(c.display_name || '創作者');
    const tag = escHtml((c.tagline || 'DESIGNER').toUpperCase());
    const quote = escHtml(c.engraving_quote || '');
    const link = 'creator-public.html?id=' + encodeURIComponent(c.member_id || '');

    return (
      '<div class="split-item' + inverse + '">' +
        '<div class="split-img-group">' +
          '<div class="main-portrait">' +
            '<img src="' + portrait + '" alt="' + name + '" loading="lazy">' +
          '</div>' +
          '<div class="detail-shot">' +
            '<img src="' + detail + '" alt="刻圖照片" loading="lazy">' +
          '</div>' +
        '</div>' +
        '<div class="split-text">' +
          '<span class="tag">' + tag + '</span>' +
          '<h3>' + name + '</h3>' +
          '<p>「' + quote + '」</p>' +
          '<a href="' + link + '" class="btn-more-simple">查看完整分享</a>' +
        '</div>' +
      '</div>'
    );
  }

  function shuffle(arr) {
    for(let i = arr.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  function escHtml(s) {
    if(!s) return '';
    return String(s).replace(/[&<>"']/g, ch => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[ch]));
  }
  function escAttr(s) {
    return escHtml(s);
  }
})();
