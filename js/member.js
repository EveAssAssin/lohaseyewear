(function (window) {
  'use strict';

  const Utils = window.LohasUtils;
  const Auth = window.LohasAuth;
  const Supabase = window.LohasSupabase;

  function getSupabaseClient() {
    if (!Supabase || !Supabase.getClient) return null;
    return Supabase.getClient();
  }

  function renderProfile(member) {
    Utils.setText('#profile-name', member.name || '-');
    Utils.setText('#profile-mobile', member.mobile || '-');
    Utils.setText('#profile-email', member.email || '-');
    Utils.setText('#profile-birthday', member.birthday || '-');

    Utils.setText('#dashboard-name', member.name || '-');
    // 未綁定時「-」看起來像資料掉了,講清楚是還沒有
    Utils.setText('#dashboard-id',
      member.erpid ? `樂活會員編號：${member.erpid}` : '尚未綁定門市會員');

    loadMyPhotos();
    loadMyFavorites();

    const savedAvatar = localStorage.getItem('lohasMemberAvatar');
const avatarPreview = document.getElementById('avatarPreview');

if (savedAvatar && avatarPreview) {
  avatarPreview.innerHTML = `<img src="${savedAvatar}" alt="會員頭像">`;
}
  }

  async function loadMyPhotos() {
    const member = Auth.getStoredMember();
    const list = document.getElementById('myPhotoList');

    if (!list) return;

    // 已登入但沒綁門市:不要說「請先登入」,那句話是錯的而且他無從改起
    if (!member || !member.erpid) {
      list.innerHTML = '<p class="empty-text">' + Auth.erpRequiredNote() + '</p>';
      return;
    }

    const supabaseClient = getSupabaseClient();

    if (!supabaseClient) {
      list.innerHTML = '<p class="empty-text">尚未設定 Supabase</p>';
      return;
    }

    const postsTable = Supabase.CONFIG.POSTS_TABLE || 'gallery_posts';

    const { data, error } = await supabaseClient
      .from(postsTable)
      .select('id,title,topic,carrier,image_urls,main_image_url,created_at')
      .eq('member_id', member.erpid)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[讀取我的分享照片失敗]', error);
      list.innerHTML = '<p class="empty-text">讀取分享照片失敗</p>';
      return;
    }

    if (!data || data.length === 0) {
      list.innerHTML = '<p class="empty-text">尚未上傳分享照片</p>';
      return;
    }

    list.innerHTML = data.map(function (post) {
      const imageUrl =
        post.main_image_url ||
        (Array.isArray(post.image_urls) ? post.image_urls[0] : '') ||
        'images/lens-01.jpg';

      return `
        <div class="my-photo-card" data-id="${post.id}">
          <img src="${imageUrl}" alt="${post.title || '分享照片'}">

          <div class="my-photo-info">
            <h3>${post.title || '未命名照片'}</h3>
            <p>${post.topic || ''}・${post.carrier || ''}</p>
          </div>

          <button class="delete-my-photo" data-id="${post.id}" type="button">
            刪除
          </button>
        </div>
      `;
    }).join('');
  }

  async function loadMyFavorites() {
    const member = Auth.getStoredMember();
    const list = document.getElementById('myFavoriteList');

    if (!list) return;

    // 已登入但沒綁門市:不要說「請先登入」,那句話是錯的而且他無從改起
    if (!member || !member.erpid) {
      list.innerHTML = '<p class="empty-text">' + Auth.erpRequiredNote() + '</p>';
      return;
    }

    const supabaseClient = getSupabaseClient();

    if (!supabaseClient) {
      list.innerHTML = '<p class="empty-text">尚未設定 Supabase</p>';
      return;
    }

    const favoritesTable = Supabase.CONFIG.FAVORITES_TABLE || 'gallery_favorites';

    const { data, error } = await supabaseClient
      .from(favoritesTable)
      .select(`
        post_id,
        gallery_posts (
          id,
          title,
          topic,
          carrier,
          image_urls,
          main_image_url
        )
      `)
      .eq('member_id', member.erpid);

    if (error) {
      console.error('[讀取我的收藏失敗]', error);
      list.innerHTML = '<p class="empty-text">讀取收藏失敗</p>';
      return;
    }

    const posts = (data || [])
      .map(item => item.gallery_posts)
      .filter(Boolean);

    if (posts.length === 0) {
      list.innerHTML = '<p class="empty-text">尚未收藏照片</p>';
      return;
    }

    list.innerHTML = posts.map(function (post) {
      const imageUrl =
        post.main_image_url ||
        (Array.isArray(post.image_urls) ? post.image_urls[0] : '') ||
        'images/lens-01.jpg';

      return `
        <div class="my-photo-card">
          <img src="${imageUrl}" alt="${post.title || '收藏照片'}">

          <div class="my-photo-info">
            <h3>${post.title || '未命名照片'}</h3>
            <p>${post.topic || ''}・${post.carrier || ''}</p>
          </div>
        </div>
      `;
    }).join('');
  }

  async function deleteMyPhoto(postId) {
    if (!postId) return;

    const confirmed = window.confirm('確定要刪除這張分享照片嗎？');
    if (!confirmed) return;

    const supabaseClient = getSupabaseClient();

    if (!supabaseClient) {
      window.alert('尚未設定 Supabase');
      return;
    }

    const postsTable = Supabase.CONFIG.POSTS_TABLE || 'gallery_posts';

    const { data, error } = await supabaseClient
      .from(postsTable)
      .delete()
      .eq('id', postId)
      .select('id');

    if (error) {
      console.error('[刪除分享照片失敗]', error);
      window.alert('刪除失敗，請確認 Supabase 權限設定');
      return;
    }

    if (!data || data.length === 0) {
      window.alert('刪除失敗：找不到這筆照片，或目前會員沒有刪除權限');
      return;
    }

    loadMyPhotos();
  }

  function bindEvents() {
    document
      .querySelectorAll('#logout-btn-sidebar, #mobile-logout-btn')
      .forEach(function (btn) {
        btn.addEventListener('click', Auth.logout);
      });

    document.addEventListener('click', function (event) {
      const btn = event.target.closest('.delete-my-photo');
      if (!btn) return;

      deleteMyPhoto(btn.dataset.id);
    });
    const avatarBtn = document.getElementById('avatarUploadBtn');
const avatarInput = document.getElementById('avatarInput');
const avatarPreview = document.getElementById('avatarPreview');

avatarBtn?.addEventListener('click', function () {
  avatarInput?.click();
});

avatarInput?.addEventListener('change', function (event) {
  const file = event.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    window.alert('請選擇圖片檔案');
    return;
  }

  const reader = new FileReader();

  reader.onload = function (e) {
    avatarPreview.innerHTML = `<img src="${e.target.result}" alt="會員頭像">`;
    localStorage.setItem('lohasMemberAvatar', e.target.result);
  };

  reader.readAsDataURL(file);
});
  }

  function initMemberPage() {
    const storedMember = Auth.getStoredMember();

    /* 判斷「有沒有登入」,不是「有沒有 erpid」——
       官網註冊的會員 erpid 是空的,用 erpid 判斷會把已登入的人踢回登入頁。 */
    if (!Auth.isLogin()) {
      // 改成直接寫 redirectAfterLogin,target 改成 member-portal.html (member.html 不存在)
      localStorage.setItem('redirectAfterLogin', 'member-portal.html');
      window.location.href = 'login.html';
      return;
    }

    bindEvents();
    renderProfile(storedMember);
  }

  document.addEventListener('DOMContentLoaded', initMemberPage);

  window.LohasMember = {
    renderProfile,
    loadMyPhotos,
    loadMyFavorites,
    deleteMyPhoto
  };
})(window);
