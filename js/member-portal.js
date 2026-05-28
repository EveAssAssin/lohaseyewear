/* =============================================================
   樂活會員中心 · member-portal.js
   -------------------------------------------------------------
   依賴 (需在這之前載入):
   - LohasUtils    (utils.js)     - $, setText, show, hide
   - LohasAuth     (auth.js)      - getStoredMember, logout, ...
   - LohasSupabase (supabase.js)  - getClient(), CONFIG.*
   ============================================================= */

(function (window) {
  'use strict';

  const Utils = window.LohasUtils;
  const Auth = window.LohasAuth;
  const Supabase = window.LohasSupabase;

  if (!Utils || !Auth) {
    console.error('[member-portal] 缺少 LohasUtils 或 LohasAuth,請先載入 utils.js / auth.js');
    return;
  }

  const root = document.getElementById('mp');
  if (!root) return;

  // 全域狀態
  const State = {
    member: null,       // 當前會員 (從 Auth.getStoredMember())
    isCreator: false,   // 是否創作者
    creatorInfo: null,  // 創作者主檔資料 (creators table)
    isAdmin: false      // 是否後台管理員 (admins table)
  };


  /* =============================================================
     Helpers
     ============================================================= */

  function getSupabase() {
    if (!Supabase || !Supabase.getClient) return null;
    return Supabase.getClient();
  }

  function getAvatarText(name) {
    if (!name) return '?';
    const trimmed = name.trim();
    if (/[\u4e00-\u9fff]/.test(trimmed)) return trimmed.slice(-2);
    return trimmed.slice(0, 2).toUpperCase();
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d)) return '';
    const now = new Date();
    const diffMs = now - d;
    const diffH = diffMs / (1000 * 60 * 60);
    if (diffH < 1) return Math.max(1, Math.floor(diffMs / 60000)) + ' 分鐘前';
    if (diffH < 24) return Math.floor(diffH) + ' 小時前';
    const diffD = diffH / 24;
    if (diffD < 2) return '昨天';
    if (diffD < 7) return Math.floor(diffD) + ' 天前';
    return d.toISOString().slice(0, 10).replace(/-/g, '.');
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function maskBankAccount(account) {
    if (!account) return '';
    const s = String(account);
    if (s.length <= 4) return '*'.repeat(s.length);
    return '**** **** **** ' + s.slice(-4);
  }


  /* =============================================================
     Identity · 載入會員 + Creator 判斷
     ============================================================= */

  async function loadIdentity() {
    const member = Auth.getStoredMember();

    if (!member || !member.erpid) {
      // 沒登入 → 導去登入頁
      Auth.setRedirect && Auth.setRedirect('member-portal.html');
      window.location.href = 'login.html';
      return false;
    }

    // 強制把 erpid 轉成字串
    // (ERP API 可能回 number, 但 Supabase 的 member_id 欄位是 TEXT 型別,
    //  型別不一致會查不到資料)
    member.erpid = String(member.erpid);

    State.member = member;

    const sb = getSupabase();
    if (sb) {
      // 平行查 Creator + Admin 身份
      try {
        const [creatorRes, adminRes] = await Promise.all([
          sb.from('creator_info')
            .select('member_id, display_name, bio, avatar_url, status, bank_name, bank_code, bank_branch, bank_account, account_holder, tagline, joining_story, joining_photo_url, video_url, video_title, social_links, custom_blocks')
            .eq('member_id', member.erpid)
            .eq('status', 'active')
            .maybeSingle(),
          sb.from('admins')
            .select('member_id, status')
            .eq('member_id', member.erpid)
            .eq('status', 'active')
            .maybeSingle()
        ]);

        if (!creatorRes.error && creatorRes.data) {
          State.isCreator = true;
          State.creatorInfo = creatorRes.data;
        }

        if (!adminRes.error && adminRes.data) {
          State.isAdmin = true;
        }

        // === 舊 designer 自動升級為 Creator ===
        // 條件:1) 還不是 creator  2) 有中文名
        // 來源順序:
        //   A. engraving_designs 已有但沒掛 creator_id 的孤兒作品
        //   B. icons.json (legacy 來源,即時匯入 → 變成 A)
        if (!State.isCreator && member.name) {
          try {
            // --- A. 先查 Supabase 既有孤兒作品 ---
            const orphanRes = await sb.from('engraving_designs')
              .select('id')
              .eq('designer_name', member.name)
              .is('creator_id', null)
              .limit(1);

            let hasOrphan = !orphanRes.error && orphanRes.data && orphanRes.data.length > 0;

            // --- B. 若 Supabase 沒有孤兒,改試 icons.json ---
            if (!hasOrphan && window.LohasLegacyIcons) {
              try {
                const importResult = await window.LohasLegacyIcons.importForMember(sb, member);
                if (importResult && importResult.imported > 0) {
                  console.log('[Auto-Creator] icons.json 匯入完成:', importResult);
                  hasOrphan = true; // 剛剛 insert 進去的 creator_id 已經是 erpid,不需要再 update
                } else if (importResult && importResult.skipped > 0) {
                  // 全都已存在 (應該不會走到這條,因為 A 沒查到)
                  // 但保險:重查一次看 creator_id 是否已被綁
                  const reCheck = await sb.from('engraving_designs')
                    .select('id, creator_id')
                    .eq('designer_name', member.name)
                    .limit(1);
                  if (!reCheck.error && reCheck.data && reCheck.data.length > 0) {
                    hasOrphan = true;
                  }
                }
              } catch (legacyErr) {
                console.warn('[Auto-Creator] icons.json fallback 失敗:', legacyErr);
              }
            }

            if (hasOrphan) {
              console.log('[Auto-Creator] 偵測到舊作品,自動建立 creator_info:', member.name);

              // 1. 補 engraving_designs.creator_id = erpid (所有同名 + 沒 creator_id 的)
              //    (icons.json 匯入時已直接帶 creator_id,但 Supabase 既有資料可能沒帶,一律 update 一次)
              await sb.from('engraving_designs')
                .update({ creator_id: member.erpid })
                .eq('designer_name', member.name)
                .is('creator_id', null);

              // 2. 插 creator_info (status=active)
              const { data: newCreator, error: insErr } = await sb.from('creator_info')
                .insert({
                  member_id: member.erpid,
                  display_name: member.name,
                  status: 'active'
                })
                .select()
                .maybeSingle();

              if (!insErr) {
                State.isCreator = true;
                State.creatorInfo = newCreator || { member_id: member.erpid, display_name: member.name, status: 'active' };
                console.log('[Auto-Creator] 升級成功');
              } else {
                console.warn('[Auto-Creator] creator_info insert 失敗:', insErr);
              }
            }
          } catch (autoErr) {
            console.warn('[Auto-Creator] 偵測失敗:', autoErr);
          }
        }
      } catch (err) {
        console.warn('[身份查詢失敗]', err);
      }
    }

    return true;
  }

  function applyIdentity() {
    const m = State.member;

    root.classList.toggle('is-creator', State.isCreator);

    // Hero 區
    Utils.setText('#dashboard-name', m.name || '-');
    Utils.setText('#dashboard-id', `樂活會員編號:${m.erpid || '-'}`);
    // 同步手機版個人資料卡
    Utils.setText('#mobile-dashboard-name', m.name || '-');
    Utils.setText('#mobile-dashboard-id', `會員編號:${m.erpid || '-'}`);

    const heroBadge = document.getElementById('heroBadge');
    if (heroBadge) heroBadge.style.display = State.isCreator ? 'inline-flex' : 'none';
    const mobileHeroBadge = document.getElementById('mobileHeroBadge');
    if (mobileHeroBadge) mobileHeroBadge.style.display = State.isCreator ? 'inline-flex' : 'none';

    // Admin badge + 進入後台按鈕
    const heroAdminBadge = document.getElementById('heroAdminBadge');
    if (heroAdminBadge) heroAdminBadge.style.display = State.isAdmin ? 'inline-flex' : 'none';
    const mobileHeroAdminBadge = document.getElementById('mobileHeroAdminBadge');
    if (mobileHeroAdminBadge) mobileHeroAdminBadge.style.display = State.isAdmin ? 'inline-flex' : 'none';

    const enterAdminBtn = document.getElementById('enterAdminBtn');
    const enterAdminBtnMobile = document.getElementById('enterAdminBtnMobile');
    if (enterAdminBtn) enterAdminBtn.style.display = State.isAdmin ? 'inline-flex' : 'none';
    if (enterAdminBtnMobile) enterAdminBtnMobile.style.display = State.isAdmin ? 'inline-flex' : 'none';

    // 抽屜內的進入管理後台 link
    const drawerAdminLink = document.getElementById('drawerAdminLink');
    if (drawerAdminLink) drawerAdminLink.style.display = State.isAdmin ? 'flex' : 'none';

    // 電腦版 sidebar 進入管理後台
    const sidebarAdminLink = document.getElementById('sidebarAdminLink');
    if (sidebarAdminLink) sidebarAdminLink.style.display = State.isAdmin ? 'flex' : 'none';

    const roleTag = document.getElementById('roleTag');
    const mobileRoleTag = document.getElementById('mobileRoleTag');
    if (roleTag) {
      // 顯示優先級: Admin > Creator > Member
      let roleText;
      if (State.isAdmin) roleText = 'Admin';
      else if (State.isCreator) roleText = 'Creator';
      else roleText = 'Member';
      roleTag.textContent = '會員中心';
      roleTag.classList.toggle('creator', State.isCreator && !State.isAdmin);
      // 新版 #4 head-title 用相同 id
      if (roleTag.classList.contains('head-title')) {
        // 已是新版, 沒事做
      }
      if (mobileRoleTag) {
        mobileRoleTag.textContent = '會員中心';
        mobileRoleTag.classList.toggle('creator', State.isCreator && !State.isAdmin);
      }
    }

    // 頭像
    const avatarEl = document.getElementById('avatarPreview');
    if (avatarEl) {
      avatarEl.classList.toggle('is-creator', State.isCreator);
      const saved = localStorage.getItem('lohasMemberAvatar');
      if (saved) {
        avatarEl.innerHTML = `<img src="${saved}" alt="會員頭像">`;
      } else {
        avatarEl.textContent = getAvatarText(m.name);
      }
    }

    // 同步手機版頭像
    const mobileAvatarEl = document.getElementById('mobileAvatar');
    if (mobileAvatarEl) {
      mobileAvatarEl.classList.toggle('is-creator', State.isCreator);
      const saved = localStorage.getItem('lohasMemberAvatar');
      if (saved) {
        mobileAvatarEl.innerHTML = `<img src="${saved}" alt="會員頭像">`;
      } else {
        mobileAvatarEl.textContent = getAvatarText(m.name);
      }
    }

    // 會員資料頁
    Utils.setText('#profile-name', m.name || '-');
    Utils.setText('#profile-mobile', m.mobile || '-');
    Utils.setText('#profile-email', m.email || '-');
    Utils.setText('#profile-birthday', m.birthday || '-');

    // 創作者個人頁(如果是 Creator,把 creators table 資料填進去)
    if (State.isCreator && State.creatorInfo) {
      const ci = State.creatorInfo;
      const creatorAvatar = document.getElementById('creatorAvatar');
      if (creatorAvatar) {
        const savedCreatorAvatar = localStorage.getItem('lohasCreatorAvatar');
        if (savedCreatorAvatar) {
          creatorAvatar.innerHTML = `<img src="${savedCreatorAvatar}" alt="創作者頭像">`;
        } else {
          creatorAvatar.textContent = getAvatarText(ci.display_name || m.name);
        }
      }

      const dn = document.getElementById('creatorDisplayName');
      if (dn) dn.value = ci.display_name || m.name || '';

      const bio = document.getElementById('creatorBio');
      if (bio) bio.value = ci.bio || '';

      // 載入新欄位
      const tagline = document.getElementById('creatorTagline');
      const joiningPhoto = document.getElementById('creatorJoiningPhoto');
      const joiningStory = document.getElementById('creatorJoiningStory');
      const videoUrl = document.getElementById('creatorVideoUrl');
      const videoTitle = document.getElementById('creatorVideoTitle');
      if (tagline) tagline.value = ci.tagline || '';
      if (joiningPhoto) joiningPhoto.value = ci.joining_photo_url || '';
      // 同步圖片到預覽框
      const joiningPhotoPreview = document.getElementById('creatorJoiningPhotoPreview');
      const joiningPhotoClear = document.getElementById('creatorJoiningPhotoClear');
      if (joiningPhotoPreview && ci.joining_photo_url) {
        joiningPhotoPreview.style.backgroundImage = `url('${ci.joining_photo_url}')`;
        joiningPhotoPreview.classList.add('has-image');
        if (joiningPhotoClear) joiningPhotoClear.style.display = 'flex';
      }
      if (joiningStory) joiningStory.value = ci.joining_story || '';
      if (videoUrl) videoUrl.value = ci.video_url || '';
      if (videoTitle) videoTitle.value = ci.video_title || '';

      // 載入社群連結
      const social = ci.social_links || {};
      const ig = document.getElementById('creatorIg');
      const fb = document.getElementById('creatorFb');
      const lineId = document.getElementById('creatorLine');
      const email = document.getElementById('creatorEmail');
      if (ig) ig.value = social.instagram || '';
      if (fb) fb.value = social.facebook || '';
      if (lineId) lineId.value = social.line || '';
      if (email) email.value = social.email || '';
    }
  }


  /* =============================================================
     Shares · 我的分享 (合併 photo + story)
     ============================================================= */

  // 全域 state: 當前 share 資料 + 選中的 tab
  const ShareState = {
    items: [],       // 所有 gallery_posts (含 type=photo 跟 type=story)
    activeTab: 'all' // all / story / photo
  };

  async function loadShares() {
    const grid = document.getElementById('myShareList');
    const banner = document.getElementById('photoRejectedBanner');
    const rejectBadge = document.getElementById('photoRejectBadge');
    const shareCount = document.getElementById('shareCount');

    if (!grid || !State.member) return;

    const sb = getSupabase();
    if (!sb) {
      grid.innerHTML = '<p class="empty-text">尚未設定 Supabase</p>';
      return;
    }

    const postsTable = (Supabase.CONFIG && Supabase.CONFIG.POSTS_TABLE) || 'gallery_posts';

    const { data, error } = await sb
      .from(postsTable)
      .select('id, title, topic, carrier, story, type, image_urls, main_image_url, status, reject_reason, created_at')
      .eq('member_id', State.member.erpid)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[讀取分享失敗]', error);
      grid.innerHTML = '<p class="empty-text">讀取失敗</p>';
      return;
    }

    const items = data || [];
    ShareState.items = items;
    if (shareCount) shareCount.textContent = items.length ? items.length + ' 則' : '';

    // 處理駁回 banner (沿用之前邏輯)
    const rejected = items.filter(p => p.status === 'rejected');
    const ackedKey = `lohasPhotoRejectAcked_${State.member.erpid}`;
    let ackedIds = [];
    try {
      ackedIds = JSON.parse(localStorage.getItem(ackedKey) || '[]');
    } catch (e) { ackedIds = []; }
    const unackedRejected = rejected.filter(r => !ackedIds.includes(r.id));

    if (unackedRejected.length > 0 && banner) {
      const first = unackedRejected[0];
      Utils.setText(
        '#photoRejectedTitle',
        unackedRejected.length === 1
          ? `您有 1 則分享「${first.title || '未命名'}」未通過審核`
          : `您有 ${unackedRejected.length} 則分享未通過審核`
      );
      const reasonEl = document.getElementById('photoRejectedReason');
      if (reasonEl) {
        reasonEl.innerHTML = '<b>駁回原因:</b>' + escapeHtml(first.reject_reason || '請聯繫客服了解詳情。');
      }
      banner.style.display = '';
      banner.dataset.unackedIds = JSON.stringify(unackedRejected.map(r => r.id));
    } else if (banner) {
      banner.style.display = 'none';
    }

    // 側邊欄紅標
    if (rejectBadge) {
      if (unackedRejected.length > 0) {
        rejectBadge.textContent = unackedRejected.length;
        rejectBadge.style.display = 'inline-flex';
      } else {
        rejectBadge.style.display = 'none';
      }
    }
    // 同步 drawer 紅標
    const drawerBadge = document.getElementById('photoRejectBadgeDrawer');
    if (drawerBadge) {
      if (unackedRejected.length > 0) {
        drawerBadge.textContent = unackedRejected.length;
        drawerBadge.style.display = 'inline-flex';
      } else {
        drawerBadge.style.display = 'none';
      }
    }

    // 更新 tab 計數
    updateShareTabCounts();
    // 渲染當前 tab
    renderShares();
    // 綁 tab 點擊 (只綁一次)
    bindShareTabsOnce();
  }

  function updateShareTabCounts() {
    const items = ShareState.items;
    const all = items.length;
    const stories = items.filter(p => p.type === 'story').length;
    const photos = items.filter(p => p.type === 'photo').length;

    document.getElementById('shareTabCountAll')?.replaceChildren(document.createTextNode(all));
    document.getElementById('shareTabCountStory')?.replaceChildren(document.createTextNode(stories));
    document.getElementById('shareTabCountPhoto')?.replaceChildren(document.createTextNode(photos));
  }

  function renderShares() {
    const grid = document.getElementById('myShareList');
    if (!grid) return;

    let items = ShareState.items;
    if (ShareState.activeTab === 'story') items = items.filter(p => p.type === 'story');
    else if (ShareState.activeTab === 'photo') items = items.filter(p => p.type === 'photo');

    if (items.length === 0) {
      const emptyMsg = ShareState.activeTab === 'story' ? '還沒有寫過故事'
        : ShareState.activeTab === 'photo' ? '還沒上傳純照片'
        : '尚未上傳任何分享';
      grid.innerHTML = `
        <p class="empty-text">${emptyMsg}</p>
        <button class="add-photo-card">
          <i class="fa-solid fa-plus"></i><span>上 傳 新 分 享</span>
        </button>`;
      return;
    }

    const grads = ['', 'g2', 'g3', 'g4', 'g5', 'g6'];

    const cards = items.map((p, i) => {
      const img = p.main_image_url
        || (Array.isArray(p.image_urls) ? p.image_urls[0] : '')
        || '';
      const status = p.status || 'pending';
      const grad = grads[i % grads.length];
      const date = formatDate(p.created_at);
      const isStory = p.type === 'story';

      // 故事卡: 含故事文字摘要
      if (isStory) {
        const excerpt = (p.story || '').replace(/\s+/g, ' ').trim();
        return `
          <div class="share-story-card" data-id="${p.id}">
            ${img ? `<div class="story-cover-img" style="background-image:url('${img}')"></div>` : ''}
            <span class="status-badge ${status}" style="position:absolute;top:10px;left:10px">
              <i class="fa-solid fa-${status === 'pending' ? 'clock' : status === 'approved' ? 'check' : 'xmark'}"></i>
              ${status === 'pending' ? '待審核' : status === 'approved' ? '已公開' : '未通過'}
            </span>
            <span class="has-story-tag"><i class="fa-solid fa-book-open"></i>有故事</span>
            <h3 class="story-card-title">${escapeHtml(p.title || '未命名')}</h3>
            <p class="story-card-excerpt">${escapeHtml(excerpt)}</p>
            <div class="story-card-meta">
              <span>${escapeHtml(date)}</span>
            </div>
          </div>`;
      }

      // 照片卡 (沿用原本)
      return `
        <div class="photo-card" data-id="${p.id}">
          <div class="photo-cover ${grad}"
               data-id="${p.id}"
               data-name="${escapeHtml(p.title || '未命名')}"
               data-date="${escapeHtml(date)}"
               data-status="${status}"
               data-fav="0"
               data-cover="${grad}"
               data-reason="${escapeHtml(p.reject_reason || '')}"
               ${img ? `style="background-image:url('${img}');background-size:cover;background-position:center"` : ''}>
            <span class="status-badge ${status}">
              <i class="fa-solid fa-${status === 'pending' ? 'clock' : status === 'approved' ? 'check' : 'xmark'}"></i>
              ${status === 'pending' ? '待審核' : status === 'approved' ? '已公開' : '未通過'}
            </span>
            <div class="photo-cover-dim"></div>
            <div class="photo-cover-text">詳 情</div>
          </div>
          <div class="photo-info">
            <div class="photo-name">${escapeHtml(p.title || '未命名')}</div>
            <div class="photo-date">${escapeHtml(date)}</div>
          </div>
        </div>`;
    }).join('');

    grid.innerHTML = cards + `
      <button class="add-photo-card">
        <i class="fa-solid fa-plus"></i><span>上 傳 新 分 享</span>
      </button>`;

    // 綁 photo-cover 點擊 → modal
    grid.querySelectorAll('.photo-cover').forEach(cover => {
      cover.addEventListener('click', () => openPhotoModal(cover));
    });
    // 綁 story-card 點擊 → modal (簡化版, 用 photo modal 顯示)
    grid.querySelectorAll('.share-story-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.id;
        const item = ShareState.items.find(p => p.id === id);
        if (!item) return;
        // 模擬一個 cover 給 openPhotoModal
        const fakeCover = {
          dataset: {
            id: item.id,
            name: item.title || '未命名',
            date: formatDate(item.created_at),
            status: item.status || 'pending',
            fav: '0',
            cover: '',
            reason: item.reject_reason || ''
          },
          style: {
            background: item.main_image_url ? `url('${item.main_image_url}')` : '',
            backgroundImage: item.main_image_url ? `url('${item.main_image_url}')` : ''
          }
        };
        openPhotoModal(fakeCover);
      });
    });
  }

  let _shareTabsBound = false;
  function bindShareTabsOnce() {
    if (_shareTabsBound) return;
    _shareTabsBound = true;

    document.querySelectorAll('.share-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.shareTab;
        if (!tabName) return;
        // 高亮 active
        document.querySelectorAll('.share-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        // 切換
        ShareState.activeTab = tabName;
        renderShares();
      });
    });
  }


  /* =============================================================
     Photos · 我的照片 (gallery_posts) [legacy]
     ============================================================= */

  // 輕量版: 只算駁回數量, 更新側邊欄紅圓圓 (init 時用)
  async function refreshPhotoRejectBadge() {
    const rejectBadge = document.getElementById('photoRejectBadge');
    if (!rejectBadge || !State.member) return;

    const sb = getSupabase();
    if (!sb) return;

    const postsTable = (Supabase.CONFIG && Supabase.CONFIG.POSTS_TABLE) || 'gallery_posts';

    try {
      const { data, error } = await sb
        .from(postsTable)
        .select('id, status')
        .eq('member_id', State.member.erpid)
        .eq('status', 'rejected');

      if (error) return;

      const rejected = data || [];
      const ackedKey = `lohasPhotoRejectAcked_${State.member.erpid}`;
      let ackedIds = [];
      try {
        ackedIds = JSON.parse(localStorage.getItem(ackedKey) || '[]');
      } catch (e) { ackedIds = []; }

      const unackedRejected = rejected.filter(r => !ackedIds.includes(r.id));

      if (unackedRejected.length > 0) {
        rejectBadge.textContent = unackedRejected.length;
        rejectBadge.style.display = 'inline-flex';
      } else {
        rejectBadge.style.display = 'none';
      }
      // 同步 drawer
      const drawerBadge = document.getElementById('photoRejectBadgeDrawer');
      if (drawerBadge) {
        if (unackedRejected.length > 0) {
          drawerBadge.textContent = unackedRejected.length;
          drawerBadge.style.display = 'inline-flex';
        } else {
          drawerBadge.style.display = 'none';
        }
      }
    } catch (err) {
      console.warn('[refreshPhotoRejectBadge]', err);
    }
  }

  async function loadPhotos() {
    const list = document.getElementById('myPhotoList');
    const banner = document.getElementById('photoRejectedBanner');
    const rejectBadge = document.getElementById('photoRejectBadge');
    const photoCount = document.getElementById('photoCount');

    if (!list || !State.member) return;

    const sb = getSupabase();
    if (!sb) {
      list.innerHTML = '<p class="empty-text">尚未設定 Supabase</p>';
      return;
    }

    const postsTable = (Supabase.CONFIG && Supabase.CONFIG.POSTS_TABLE) || 'gallery_posts';

    const { data, error } = await sb
      .from(postsTable)
      .select('id, title, topic, carrier, image_urls, main_image_url, status, reject_reason, created_at')
      .eq('member_id', State.member.erpid)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[讀取照片失敗]', error);
      list.innerHTML = '<p class="empty-text">讀取照片失敗</p>';
      return;
    }

    const photos = data || [];
    if (photoCount) photoCount.textContent = photos.length ? photos.length + ' 張' : '';

    // 處理駁回 banner (記憶使用者已 ack 的駁回 ID, 避免重複跳)
    const rejected = photos.filter(p => p.status === 'rejected');
    const ackedKey = `lohasPhotoRejectAcked_${State.member.erpid}`;
    let ackedIds = [];
    try {
      ackedIds = JSON.parse(localStorage.getItem(ackedKey) || '[]');
    } catch (e) { ackedIds = []; }
    // 過濾出「還沒按過我知道了」的駁回
    const unackedRejected = rejected.filter(r => !ackedIds.includes(r.id));

    if (unackedRejected.length > 0 && banner) {
      const first = unackedRejected[0];
      Utils.setText(
        '#photoRejectedTitle',
        unackedRejected.length === 1
          ? `您有 1 張照片「${first.title || '未命名'}」未通過審核`
          : `您有 ${unackedRejected.length} 張照片未通過審核`
      );
      const reasonEl = document.getElementById('photoRejectedReason');
      if (reasonEl) {
        reasonEl.innerHTML = '<b>駁回原因:</b>' + escapeHtml(first.reject_reason || '請聯繫客服了解詳情。');
      }
      banner.style.display = '';
      // 把目前未 ack 的 ID 存到 banner dataset, ack 時用得到
      banner.dataset.unackedIds = JSON.stringify(unackedRejected.map(r => r.id));
    } else if (banner) {
      banner.style.display = 'none';
    }

    // 側邊欄紅標 (用 unacked 數量, 不是全部 rejected 數量)
    if (rejectBadge) {
      if (unackedRejected.length > 0) {
        rejectBadge.textContent = unackedRejected.length;
        rejectBadge.style.display = 'inline-flex';
      } else {
        rejectBadge.style.display = 'none';
      }
    }

    // Render 卡片
    if (photos.length === 0) {
      list.innerHTML = `
        <p class="empty-text">尚未上傳分享照片</p>
        <button class="add-photo-card">
          <i class="fa-solid fa-plus"></i><span>上 傳 新 照 片</span>
        </button>`;
      return;
    }

    // 漸層背景輪流(g, g2, g3, g4, g5, g6)
    const grads = ['', 'g2', 'g3', 'g4', 'g5', 'g6'];

    const cards = photos.map((p, i) => {
      const img = p.main_image_url
        || (Array.isArray(p.image_urls) ? p.image_urls[0] : '')
        || '';
      const status = p.status || 'pending';
      const grad = grads[i % grads.length];
      const date = formatDate(p.created_at);

      return `
        <div class="photo-card" data-id="${p.id}">
          <div class="photo-cover ${grad}"
               data-id="${p.id}"
               data-name="${escapeHtml(p.title || '未命名')}"
               data-date="${escapeHtml(date)}"
               data-status="${status}"
               data-fav="0"
               data-cover="${grad}"
               data-reason="${escapeHtml(p.reject_reason || '')}"
               ${img ? `style="background-image:url('${img}');background-size:cover;background-position:center"` : ''}>
            <span class="status-badge ${status}">
              <i class="fa-solid fa-${status === 'pending' ? 'clock' : status === 'approved' ? 'check' : 'xmark'}"></i>
              ${status === 'pending' ? '待審核' : status === 'approved' ? '已公開' : '未通過'}
            </span>
            <div class="photo-cover-dim"></div>
            <div class="photo-cover-text">詳 情</div>
          </div>
          <div class="photo-info">
            <div class="photo-name">${escapeHtml(p.title || '未命名')}</div>
            <div class="photo-date">${escapeHtml(date)}</div>
          </div>
        </div>`;
    }).join('');

    list.innerHTML = cards + `
      <button class="add-photo-card">
        <i class="fa-solid fa-plus"></i><span>上 傳 新 照 片</span>
      </button>`;

    // 綁定 hover modal
    list.querySelectorAll('.photo-cover').forEach(cover => {
      cover.addEventListener('click', () => openPhotoModal(cover));
    });
  }

  async function deletePhoto(postId) {
    if (!postId) return;
    if (!window.confirm('確定要刪除這張照片嗎?')) return;

    const sb = getSupabase();
    if (!sb) {
      window.alert('尚未設定 Supabase');
      return;
    }

    const postsTable = (Supabase.CONFIG && Supabase.CONFIG.POSTS_TABLE) || 'gallery_posts';

    const { data, error } = await sb
      .from(postsTable)
      .delete()
      .eq('id', postId)
      .select('id');

    if (error) {
      console.error('[deletePhoto] 刪除失敗:', error);
      window.alert('刪除失敗:' + (error.message || '請確認權限'));
      return;
    }
    if (!data || data.length === 0) {
      console.warn('[deletePhoto] 沒有資料被刪除,可能是 RLS 阻擋或 ID 不存在', postId);
      window.alert('刪除失敗:沒有資料被刪除(RLS 權限不足或資料不存在)');
      return;
    }

    closeModal();
    // 重新載入 my-shares 列表 (而不是 legacy 的 loadPhotos)
    if (typeof loadShares === 'function') loadShares();
    else if (typeof loadPhotos === 'function') loadPhotos();
  }


  /* =============================================================
     Inspos · 我的靈感 (gallery_favorites)
     ============================================================= */

  async function loadInspos() {
    const list = document.getElementById('myFavoriteList');
    const countEl = document.getElementById('inspoCount');
    if (!list || !State.member) return;

    const sb = getSupabase();
    if (!sb) {
      list.innerHTML = '<p class="empty-text">尚未設定 Supabase</p>';
      return;
    }

    const favTable = (Supabase.CONFIG && Supabase.CONFIG.FAVORITES_TABLE) || 'gallery_favorites';

    const { data, error } = await sb
      .from(favTable)
      .select(`
        post_id,
        gallery_posts (
          id, title, topic, carrier, image_urls, main_image_url, member_id
        )
      `)
      .eq('member_id', State.member.erpid);

    if (error) {
      console.error('[讀取靈感失敗]', error);
      list.innerHTML = '<p class="empty-text">讀取靈感失敗</p>';
      return;
    }

    const posts = (data || []).map(item => item.gallery_posts).filter(Boolean);
    if (countEl) countEl.textContent = posts.length ? posts.length + ' 張' : '';

    if (posts.length === 0) {
      list.innerHTML = '<p class="empty-text">尚未收藏任何靈感</p>';
      return;
    }

    const grads = ['', 'g2', 'g3', 'g4', 'g5', 'g6'];
    list.innerHTML = posts.map((p, i) => {
      const img = p.main_image_url || (Array.isArray(p.image_urls) ? p.image_urls[0] : '') || '';
      const grad = grads[i % grads.length];
      const author = p.member_id ? `會員 ${String(p.member_id).slice(-3)}` : '會員';
      return `
        <div class="inspo-card">
          <div class="inspo-img ${grad}" ${img ? `style="background-image:url('${img}');background-size:cover;background-position:center"` : ''}>
            <button class="inspo-bookmark"><i class="fa-solid fa-bookmark"></i></button>
          </div>
          <div class="inspo-info">
            <div class="inspo-by">${escapeHtml(author)}</div>
            <div class="inspo-quote">${escapeHtml(p.title || '未命名')}</div>
          </div>
        </div>`;
    }).join('');
  }


  /* =============================================================
     Wishlist · 我的最愛刻圖 (engraving_wishlist + engraving_designs)
     ============================================================= */

  async function loadWishlist() {
    const list = document.getElementById('myWishList');
    const countEl = document.getElementById('wishCount');
    if (!list || !State.member) return;

    const sb = getSupabase();
    if (!sb) return;

    const { data, error } = await sb
      .from('engraving_wishlist')
      .select(`
        design_id, created_at,
        engraving_designs (
          id, name, image_url, image_url_png, image_url_svg, type, creator_id, designer_name, status
        )
      `)
      .eq('member_id', State.member.erpid)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[讀取我的最愛刻圖失敗]', error);
      list.innerHTML = '<p class="empty-text">讀取失敗</p>';
      return;
    }

    const designs = (data || [])
      .map(item => item.engraving_designs)
      .filter(d => d && d.status === 'approved');

    if (countEl) countEl.textContent = designs.length ? designs.length + ' 件' : '';

    if (designs.length === 0) {
      list.innerHTML = '<p class="empty-text">尚未加入任何最愛設計</p>';
      return;
    }

    list.innerHTML = designs.map(d => {
      // 三層 fallback: PNG (透明) → image_url (原始) → SVG
      let coverImg = '';
      const candidates = [d.image_url_png, d.image_url, d.image_url_svg];
      for (const u of candidates) {
        if (u && typeof u === 'string' && u.trim() !== '' && /^https?:\/\//.test(u)) {
          coverImg = u;
          break;
        }
      }

      const author = d.designer_name || (d.creator_id ? '創作者 ' + String(d.creator_id).slice(-3) : '匿名');

      return `
        <div class="inspo-card" data-design-id="${d.id}">
          <div class="inspo-img" ${coverImg ? `style="background-image:url('${coverImg}');background-size:contain;background-position:center;background-repeat:no-repeat;background-color:#fff"` : 'style="background:#FAF7F2"'}>
            <button class="inspo-bookmark" data-act="remove" data-design-id="${d.id}" title="從最愛移除"><i class="fa-solid fa-heart"></i></button>
          </div>
          <div class="inspo-info">
            <div class="inspo-by">by ${escapeHtml(author)}</div>
            <div class="inspo-quote">${escapeHtml(d.name || '(未命名)')}</div>
          </div>
        </div>`;
    }).join('');

    // 綁愛心按鈕(從最愛移除)
    list.querySelectorAll('[data-act="remove"]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const did = btn.dataset.designId;
        if (!window.confirm('從我的最愛刻圖中移除?')) return;
        const { error } = await sb
          .from('engraving_wishlist')
          .delete()
          .eq('member_id', State.member.erpid)
          .eq('design_id', did);
        if (!error) {
          // like_count -1
          try {
            const { data: cur } = await sb.from('engraving_designs')
              .select('like_count').eq('id', did).single();
            if (cur) {
              const newCount = Math.max(0, (cur.like_count || 0) - 1);
              await sb.from('engraving_designs')
                .update({ like_count: newCount }).eq('id', did);
            }
          } catch (e) { console.warn('[wishlist] like_count -1 失敗', e); }

          loadWishlist();
        }
      });
    });
  }


  /* =============================================================
     Stories · 我的故事 (gallery_posts type=story)
     ============================================================= */

  async function loadStories() {
    const list = document.getElementById('myStoryList');
    const countEl = document.getElementById('storyCount');
    if (!list || !State.member) return;

    const sb = getSupabase();
    if (!sb) return;

    // 全部從 gallery_posts 抓 (type=story)
    const { data, error } = await sb.from('gallery_posts')
      .select('id, title, story, status, reject_reason, created_at, image_urls, main_image_url')
      .eq('member_id', State.member.erpid)
      .eq('type', 'story')
      .order('created_at', { ascending: false });

    if (error) console.error('[讀取 gallery_posts 故事失敗]', error);

    const items = (data || []).map(p => ({
      id: p.id,
      title: p.title,
      content: p.story,
      status: p.status,
      reject_reason: p.reject_reason,
      created_at: p.created_at,
      image_url: p.main_image_url || (p.image_urls && p.image_urls[0]) || null,
    }));

    if (countEl) countEl.textContent = items.length ? items.length + ' 篇' : '';

    if (items.length === 0) {
      list.innerHTML = `
        <div class="empty">
          <i class="fa-regular fa-comment"></i>
          <div class="empty-title">還沒寫過故事</div>
          <div>分享你的眼鏡刻圖故事，讓設計被看見</div>
          <button class="action-btn add-story-card" style="margin-top:18px"><span>分享照片並寫下故事</span></button>
        </div>`;
      return;
    }

    list.innerHTML = items.map(s => `
      <div class="story-card" data-id="${s.id}">
        <div class="story-h">
          <h3 class="story-title">${escapeHtml(s.title || '未命名')}</h3>
          <div class="story-menu-wrap">
            <button class="story-menu-btn" data-story="${s.id}"><i class="fa-solid fa-ellipsis"></i></button>
            <div class="story-menu" data-menu="${s.id}">
              <button class="danger" data-action="delete" data-id="${s.id}"><i class="fa-regular fa-trash-can"></i>刪除故事</button>
            </div>
          </div>
        </div>
        <p class="story-content">${escapeHtml(s.content || '')}</p>
        <div class="story-meta">
          <span>發佈於 ${formatDate(s.created_at)} · ${s.status === 'approved' ? '已公開' : s.status === 'rejected' ? '未通過' : '審核中'}${s.image_url ? ' · 含照片' : ''}</span>
        </div>
      </div>
    `).join('') + `
      <button class="action-btn add-story-card" style="margin:14px 0 0"><span>分享照片並寫下故事</span></button>`;

    // 綁選單按鈕
    list.querySelectorAll('.story-menu-btn').forEach(b => {
      b.addEventListener('click', e => {
        e.stopPropagation();
        const key = b.dataset.story;
        const menu = list.querySelector(`.story-menu[data-menu="${key}"]`);
        const wasOn = menu && menu.classList.contains('on');
        list.querySelectorAll('.story-menu').forEach(m => m.classList.remove('on'));
        if (menu && !wasOn) menu.classList.add('on');
      });
    });

    list.querySelectorAll('.story-menu').forEach(m => {
      m.addEventListener('click', e => e.stopPropagation());
    });

    list.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', () => deleteStory(btn.dataset.id));
    });
  }

  async function deleteStory(id) {
    if (!id) return;
    if (!window.confirm('確定刪除這篇故事?')) return;
    const sb = getSupabase();
    const { error } = await sb.from('gallery_posts')
      .delete()
      .eq('id', id)
      .eq('member_id', State.member.erpid);
    if (error) {
      console.error('[deleteStory] 失敗:', error);
      window.alert('刪除失敗:' + (error.message || ''));
      return;
    }
    loadStories();
  }


  /* =============================================================
     Designs · 我的刻圖設計 (Creator only)
     ============================================================= */

  async function loadMyDesigns() {
    const list = document.getElementById('myDesignList');
    const designsBlock = document.getElementById('myDesignsBlock');
    const becomeBlock = document.getElementById('becomeCreatorBlock');

    if (!list || !State.member) return;

    // Member (非 Creator) 看到 onboard CTA
    if (!State.isCreator) {
      if (designsBlock) designsBlock.style.display = 'none';
      if (becomeBlock) becomeBlock.style.display = 'block';
      return;
    }

    if (designsBlock) designsBlock.style.display = 'block';
    if (becomeBlock) becomeBlock.style.display = 'none';

    const sb = getSupabase();
    if (!sb) return;

    const { data, error } = await sb
      .from('engraving_designs')
      .select('id, name, slogan, category, keywords, image_url, image_url_png, image_url_svg, status, is_show, reject_reason, created_at')
      .eq('creator_id', State.member.erpid)
      .order('created_at', { ascending: false });

    if (error) {
      list.innerHTML = '<p class="empty-text">讀取失敗</p>';
      return;
    }

    // 排除垃圾桶 (會員自己刪除的不顯示在清單)
    const designs = (data || []).filter(d => (d.is_show || '上架') !== '垃圾桶');

    // Creator 即使沒設計也顯示「+」上傳框 (不顯示 onboard CTA)
    if (designs.length === 0) {
      list.innerHTML = `
        <button class="add-tile" id="addDesignBtn"><i class="fa-solid fa-plus"></i><span>上 傳 新 設 計</span></button>`;
      bindAddDesign();
      return;
    }

    // 抓每個 design 被加入我的最愛刻圖的次數
    const wishCounts = {};
    for (const d of designs) {
      const { count } = await sb
        .from('engraving_wishlist')
        .select('design_id', { count: 'exact', head: true })
        .eq('design_id', d.id);
      wishCounts[d.id] = count || 0;
    }

    const grads = ['dg1', 'dg2', 'dg3'];
    list.innerHTML = designs.map((d, i) => {
      const grad = grads[i % grads.length];
      const isApproved = d.status === 'approved';
      const isPending = d.status === 'pending';
      const isOff = isApproved && (d.is_show || '上架') === '下架';  // 已通過但被下架
      // 優先 PNG (透明) → image_url(原始) → SVG
      var coverImg = '';
      var candidates = [d.image_url_png, d.image_url, d.image_url_svg];
      for (var k = 0; k < candidates.length; k++) {
        var u = candidates[k];
        if (u && typeof u === 'string' && u.trim() !== '' && /^https?:\/\//.test(u)) {
          coverImg = u;
          break;
        }
      }
      const statusLabel = isOff ? '已 下 架' : isApproved ? '已 上 架' : isPending ? '審 核 中' : '未 通 過';
      const statusIcon  = isOff ? 'eye-slash' : isApproved ? 'check' : isPending ? 'clock' : 'xmark';
      const badgeClass  = isOff ? 'archived' : d.status;
      const wishCount   = wishCounts[d.id] || 0;
      return `
        <div class="photo-card" data-design-id="${d.id}">
          <div class="photo-cover design-cover-img ${grad}"
               data-id="${d.id}"
               data-name="${escapeHtml(d.name || '')}"
               data-slogan="${escapeHtml(d.slogan || '')}"
               data-category="${escapeHtml(d.category || '')}"
               data-keywords="${escapeHtml(d.keywords || '')}"
               data-status="${d.status}"
               data-show="${escapeHtml(d.is_show || '上架')}"
               data-wish="${wishCount}"
               data-cover-img="${escapeHtml(coverImg || '')}"
               data-reason="${escapeHtml(d.reject_reason || '')}"
               data-created="${escapeHtml(formatDate(d.created_at))}"
               ${coverImg ? `style="background-image:url('${coverImg}');background-size:contain;background-position:center;background-repeat:no-repeat;background-color:#fff"` : ''}>
            <span class="status-badge ${badgeClass}">
              <i class="fa-solid fa-${statusIcon}"></i>${statusLabel}
            </span>
            <div class="photo-cover-dim"></div>
            <div class="photo-cover-text">詳 情</div>
          </div>
          <div class="photo-info">
            <div class="photo-name">${escapeHtml(d.name || '')}</div>
            <div class="photo-date">${isOff ? '已被管理員下架' : isApproved ? `<i class="fa-solid fa-pencil"></i>被加入我的最愛刻圖 ${wishCount} 次` : (isPending ? '審核通過後開放收藏' : '未通過審核')}</div>
          </div>
        </div>`;
    }).join('') + `
      <button class="add-tile" id="addDesignBtn"><i class="fa-solid fa-plus"></i><span>上 傳 新 設 計</span></button>`;

    bindAddDesign();

    // 綁卡片點擊 → 開 design modal
    list.querySelectorAll('.design-cover-img').forEach(cover => {
      cover.addEventListener('click', () => openDesignModal(cover));
    });
  }


  /* =============================================================
     我的刻圖 · 詳情 Modal (比照 photo modal 風格)
     ============================================================= */
  function openDesignModal(cover) {
    const id        = cover.dataset.id;
    const name      = cover.dataset.name || '(未命名)';
    const slogan    = cover.dataset.slogan || '';
    const status    = cover.dataset.status || 'pending';
    const showState = cover.dataset.show || '上架';   // 上架 / 下架 / 垃圾桶
    const wish      = parseInt(cover.dataset.wish, 10) || 0;
    const reason    = cover.dataset.reason || '';
    const created   = cover.dataset.created || '';
    const coverImg  = cover.dataset.coverImg || '';
    const isOff     = status === 'approved' && showState === '下架';  // 已通過但被下架

    // 共用 photo modal 的 DOM 元素
    const modalBg          = document.getElementById('modalBg');
    const modalTitle       = document.getElementById('modalTitle');
    const modalDate        = document.getElementById('modalDate');
    const modalImg         = document.getElementById('modalImg');
    const modalImgLabel    = document.getElementById('modalImgLabel');
    const modalStatus      = document.getElementById('modalStatus');
    const modalFav         = document.getElementById('modalFav');
    const modalReason      = document.getElementById('modalReason');
    const modalReasonText  = document.getElementById('modalReasonText');
    const modalActions     = document.getElementById('modalActions');

    if (!modalBg) { console.warn('[my-designs] photo modal 元素不存在'); return; }

    if (modalTitle)    modalTitle.textContent = name;
    if (modalDate)     modalDate.textContent  = created;
    if (modalImgLabel) modalImgLabel.textContent = slogan || name;

    // 大圖背景
    if (modalImg) {
      modalImg.style.background = coverImg ? `url('${coverImg}') center/contain no-repeat #fff` : '#FAF7F2';
    }

    // 狀態 pill
    const statusLabel = isOff ? '已 下 架' : ({ approved:'已 上 架', pending:'審 核 中', rejected:'未 通 過' }[status] || status);
    const statusIcon  = isOff ? 'eye-slash' : ({ approved:'check',   pending:'clock',     rejected:'xmark'    }[status] || 'circle-info');
    if (modalStatus) {
      modalStatus.className = 'modal-status ' + (isOff ? 'archived' : status);
      modalStatus.innerHTML = `<i class="fa-solid fa-${statusIcon}"></i>${statusLabel}`;
    }

    // 我的最愛刻圖統計 (只在已上架顯示)
    if (modalFav) {
      if (status === 'approved') {
        modalFav.style.display = 'inline-flex';
        modalFav.innerHTML = `<i class="fa-solid fa-pencil"></i>被加入我的最愛刻圖 <b>${wish}</b> 次`;
      } else {
        modalFav.style.display = 'none';
      }
    }

    // 駁回原因
    if (modalReason) {
      if (status === 'rejected' && reason) {
        modalReason.classList.add('on');
        if (modalReasonText) modalReasonText.textContent = reason;
      } else {
        modalReason.classList.remove('on');
      }
    }

    // 按鈕邏輯
    let html = '';
    if (status === 'rejected') {
      html += '<button class="btn warn" data-action="re-upload-design"><i class="fa-solid fa-rotate"></i> 重新上傳</button>';
    }
    // 編輯 (所有狀態都可)
    html += '<button class="btn" data-action="edit-design"><i class="fa-solid fa-pen"></i> 編輯</button>';
    // 上下架切換 (只有已通過可切)
    if (status === 'approved') {
      html += isOff
        ? '<button class="btn" data-action="toggle-show"><i class="fa-solid fa-eye"></i> 重新上架</button>'
        : '<button class="btn secondary" data-action="toggle-show"><i class="fa-solid fa-eye-slash"></i> 下架</button>';
    }
    // 刪除 (軟刪除到垃圾桶)
    html += '<button class="btn danger" data-action="trash-design"><i class="fa-solid fa-trash"></i> 刪除</button>';
    html += '<button class="btn secondary" id="designModalCloseBtn">關閉</button>';
    if (modalActions) modalActions.innerHTML = html;

    document.getElementById('designModalCloseBtn')?.addEventListener('click', () => modalBg.classList.remove('on'));
    // 全域 X 鈕也綁(只綁一次,避免重複)
    const modalCloseX = document.getElementById('modalClose');
    if (modalCloseX && !modalCloseX.dataset.designBound) {
      modalCloseX.dataset.designBound = '1';
      modalCloseX.addEventListener('click', () => modalBg.classList.remove('on'));
    }

    const reBtn = modalActions?.querySelector('[data-action="re-upload-design"]');
    if (reBtn) {
      reBtn.addEventListener('click', () => {
        const design = {
          id,
          name,
          slogan,
          category: cover.dataset.category || '',
          keywords: cover.dataset.keywords || '',
          image_url: coverImg,
          status,
          reject_reason: reason,
        };
        modalBg.classList.remove('on');

        if (!window.LohasUploadDesign) {
          alert('上傳模組未載入,請重新整理頁面再試');
          console.error('[my-designs] LohasUploadDesign 未載入。確認 member-portal.html 是否引用 js/upload-design.js');
          return;
        }

        if (window.LohasUploadDesign.openModalForEdit) {
          window.LohasUploadDesign.openModalForEdit(design);
        } else if (window.LohasUploadDesign.openModal) {
          window.LohasUploadDesign.openModal();
        }
      });
    }

    // 編輯 (沿用上傳模組的編輯模式)
    const editBtn = modalActions?.querySelector('[data-action="edit-design"]');
    if (editBtn) {
      editBtn.addEventListener('click', () => {
        const design = {
          id, name, slogan,
          category: cover.dataset.category || '',
          keywords: cover.dataset.keywords || '',
          image_url: coverImg,
          status,
          reject_reason: reason,
        };
        modalBg.classList.remove('on');
        if (!window.LohasUploadDesign) {
          alert('編輯模組未載入,請重新整理頁面再試');
          return;
        }
        if (window.LohasUploadDesign.openModalForEdit) {
          window.LohasUploadDesign.openModalForEdit(design);
        } else if (window.LohasUploadDesign.openModal) {
          window.LohasUploadDesign.openModal();
        }
      });
    }

    // 上下架切換
    const toggleBtn = modalActions?.querySelector('[data-action="toggle-show"]');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', async () => {
        const sb = getSupabase();
        if (!sb) return;
        const newShow = isOff ? '上架' : '下架';
        toggleBtn.disabled = true;
        try {
          const { error } = await sb.from('engraving_designs')
            .update({ is_show: newShow })
            .eq('id', id);
          if (error) throw error;
          modalBg.classList.remove('on');
          loadMyDesigns();
          if (typeof loadAnalytics === 'function') loadAnalytics();
        } catch (err) {
          console.error('[my-designs] 上下架失敗:', err);
          alert('操作失敗:' + err.message);
          toggleBtn.disabled = false;
        }
      });
    }

    // 刪除 (軟刪除 → 移到垃圾桶)
    const trashBtn = modalActions?.querySelector('[data-action="trash-design"]');
    if (trashBtn) {
      trashBtn.addEventListener('click', async () => {
        if (!confirm(`確定刪除「${name}」?\n\n· 會從市集下架\n· 移至垃圾桶 (保留資料)\n· 如需復原請聯繫管理員`)) return;
        const sb = getSupabase();
        if (!sb) return;
        trashBtn.disabled = true;
        try {
          const { error } = await sb.from('engraving_designs')
            .update({ is_show: '垃圾桶' })
            .eq('id', id);
          if (error) throw error;
          modalBg.classList.remove('on');
          loadMyDesigns();
          if (typeof loadAnalytics === 'function') loadAnalytics();
        } catch (err) {
          console.error('[my-designs] 刪除失敗:', err);
          alert('刪除失敗:' + err.message);
          trashBtn.disabled = false;
        }
      });
    }

    modalBg.classList.add('on');
  }

  function bindAddDesign() {
    const btn = document.getElementById('addDesignBtn');
    if (btn) {
      btn.addEventListener('click', () => {
        if (window.LohasUploadDesign && window.LohasUploadDesign.openModal) {
          window.LohasUploadDesign.openModal();
        } else {
          console.error('[addDesignBtn] LohasUploadDesign 未載入');
          alert('刻圖上傳模組未載入,請重新整理頁面');
        }
      });
    }
  }

  function bindPreviewCreator() {
    const link = document.getElementById('previewCreatorPage');
    if (link) {
      link.addEventListener('click', () => {
        if (!State.member) return;
        // 開創作者公開頁預覽 (新分頁開)
        const url = `creator-public.html?id=${encodeURIComponent(State.member.erpid)}`;
        window.open(url, '_blank');
      });
    }
  }

  // 創作者個人頁:儲存資料 (全欄位)
  async function saveCreatorInfo() {
    if (!State.isCreator || !State.member) return;
    const sb = getSupabase();
    if (!sb) return;

    const dn = document.getElementById('creatorDisplayName')?.value || '';
    const tagline = document.getElementById('creatorTagline')?.value || '';
    const bio = document.getElementById('creatorBio')?.value || '';
    const joiningPhoto = document.getElementById('creatorJoiningPhoto')?.value || '';
    const joiningStory = document.getElementById('creatorJoiningStory')?.value || '';
    const videoUrl = document.getElementById('creatorVideoUrl')?.value || '';
    const videoTitle = document.getElementById('creatorVideoTitle')?.value || '';
    const ig = document.getElementById('creatorIg')?.value || '';
    const fb = document.getElementById('creatorFb')?.value || '';
    const lineId = document.getElementById('creatorLine')?.value || '';
    const email = document.getElementById('creatorEmail')?.value || '';

    if (!dn.trim()) {
      alert('請填寫顯示名稱');
      return;
    }

    const social_links = {};
    if (ig) social_links.instagram = ig;
    if (fb) social_links.facebook = fb;
    if (lineId) social_links.line = lineId;
    if (email) social_links.email = email;

    const customBlocks = collectCustomBlocks();

    const { error } = await sb
      .from('creator_info')
      .update({
        display_name: dn,
        tagline: tagline,
        bio: bio,
        joining_photo_url: joiningPhoto,
        joining_story: joiningStory,
        video_url: videoUrl,
        video_title: videoTitle,
        social_links: social_links,
        custom_blocks: customBlocks
      })
      .eq('member_id', State.member.erpid);

    if (error) {
      console.error('[儲存失敗]', error);
      alert('儲存失敗:' + error.message);
      return;
    }

    // 更新本地 State
    if (State.creatorInfo) {
      State.creatorInfo.display_name = dn;
      State.creatorInfo.tagline = tagline;
      State.creatorInfo.bio = bio;
      State.creatorInfo.joining_photo_url = joiningPhoto;
      State.creatorInfo.joining_story = joiningStory;
      State.creatorInfo.video_url = videoUrl;
      State.creatorInfo.video_title = videoTitle;
      State.creatorInfo.social_links = social_links;
      State.creatorInfo.custom_blocks = customBlocks;
    }

    alert(`已儲存「${dn}」的創作者資料`);

    // 顯示底部 hint 卡 (網址 + 複製/開啟 + ID)
    const hint = document.getElementById('creatorSaveHint');
    const creatorUrl = `${window.location.origin}${window.location.pathname.replace('member-portal.html', 'creator-public.html')}?id=${State.member.erpid}`;
    if (hint) {
      hint.style.color = 'var(--status-approved)';
      hint.innerHTML = `
        ✓ 已儲存「<b>${escapeHtml(dn)}</b>」<br>
        <div class="ag-success-card">
          <div class="ag-success-label">創作者個人頁網址</div>
          <div class="ag-success-url-row">
            <a class="ag-success-url" href="${creatorUrl}" target="_blank" rel="noopener">${escapeHtml(creatorUrl)}</a>
            <div class="ag-success-btn-group">
              <button type="button" class="ag-copy-btn" data-url="${escapeHtml(creatorUrl)}">
                <i class="fa-regular fa-copy"></i>複製
              </button>
              <a class="ag-copy-btn" href="${creatorUrl}" target="_blank" rel="noopener" style="text-decoration:none">
                <i class="fa-solid fa-arrow-up-right-from-square"></i>開啟
              </a>
            </div>
          </div>
          <div class="ag-success-hint">創作者 ID: <code>${escapeHtml(State.member.erpid)}</code></div>
        </div>`;

      // 複製按鈕
      hint.querySelector('.ag-copy-btn[data-url]')?.addEventListener('click', function() {
        const url = this.dataset.url;
        navigator.clipboard?.writeText(url).then(() => {
          const orig = this.innerHTML;
          this.innerHTML = '<i class="fa-solid fa-check"></i>已複製';
          setTimeout(() => { this.innerHTML = orig; }, 2000);
        }).catch(() => {
          alert('已複製: ' + url);
        });
      });

      // scroll 到 hint
      setTimeout(() => {
        hint.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 200);
    }
  }

  function bindSaveCreatorInfo() {
    document.getElementById('saveCreatorInfo')?.addEventListener('click', saveCreatorInfo);
    document.getElementById('creatorResetBtn')?.addEventListener('click', () => {
      if (!confirm('確定要清空表單?\n\n所有未儲存的變更都會失去')) return;
      // 清所有欄位
      ['creatorDisplayName','creatorTagline','creatorBio','creatorJoiningStory','creatorVideoUrl','creatorVideoTitle','creatorIg','creatorFb','creatorLine','creatorEmail'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      // 清緣分照片
      const jp = document.getElementById('creatorJoiningPhoto');
      if (jp) jp.value = '';
      const preview = document.getElementById('creatorJoiningPhotoPreview');
      if (preview) {
        preview.style.backgroundImage = '';
        preview.classList.remove('has-image');
      }
      const clearBtn = document.getElementById('creatorJoiningPhotoClear');
      if (clearBtn) clearBtn.style.display = 'none';
      // 清自訂區塊
      const cbList = document.getElementById('customBlocksList');
      if (cbList) {
        cbList.innerHTML = '<p class="empty-text" style="padding:30px 20px;font-size:12px">點上方「新增區塊」加入自訂的圖文段落</p>';
      }
      // 清 hint
      const hint = document.getElementById('creatorSaveHint');
      if (hint) hint.innerHTML = '';
    });
    document.getElementById('creatorCloseBtn')?.addEventListener('click', () => {
      // 關閉 = 跳回首頁
      goTo('home');
    });
  }

  // 匯款資料 form 顯示 / 隱藏 / 儲存
  function showBankForm(account) {
    const form = document.getElementById('bankForm');
    const list = document.getElementById('bankInfoList');
    const editBtn = document.getElementById('bankEditBtn');

    if (form) {
      form.style.display = '';
      document.getElementById('bankName').value = account?.bank_name || '';
      document.getElementById('bankBranch').value = account?.branch || '';
      document.getElementById('bankAccount').value = account?.account_number || '';
      document.getElementById('bankRecipient').value = account?.recipient_name || '';
    }
    if (list) list.style.display = 'none';
    if (editBtn) editBtn.style.display = 'none';
    const deleteBtn = document.getElementById('bankDeleteBtn');
    if (deleteBtn) deleteBtn.style.display = 'none';
  }

  async function saveBankForm() {
    if (!State.member) return;
    const sb = getSupabase();
    if (!sb) return;

    const bank_name = document.getElementById('bankName')?.value?.trim();
    const branch = document.getElementById('bankBranch')?.value?.trim();
    const account_number = document.getElementById('bankAccount')?.value?.trim();
    const recipient_name = document.getElementById('bankRecipient')?.value?.trim();

    if (!bank_name || !branch || !account_number || !recipient_name) {
      alert('請填寫所有欄位');
      return;
    }
    if (!/^\d+$/.test(account_number)) {
      alert('帳號請輸入純數字');
      return;
    }

    // upsert (有就 update, 沒就 insert)
    const { error } = await sb
      .from('payout_accounts')
      .upsert({
        member_id: State.member.erpid,
        bank_name,
        branch,
        account_number,
        recipient_name,
        updated_at: new Date().toISOString()
      }, { onConflict: 'member_id' });

    if (error) {
      console.error('[儲存匯款失敗]', error);
      alert('儲存失敗:' + error.message);
      return;
    }

    alert('已儲存匯款資料');
    loadEarnings();
  }

  function bindBankForm() {
    const sb = getSupabase();
    document.getElementById('bankSaveBtn')?.addEventListener('click', saveBankForm);
    document.getElementById('bankCancelBtn')?.addEventListener('click', () => {
      document.getElementById('bankForm').style.display = 'none';
      loadEarnings();
    });
    document.getElementById('bankEditBtn')?.addEventListener('click', async () => {
      if (!sb || !State.member) return;
      const { data: account } = await sb
        .from('payout_accounts')
        .select('*')
        .eq('member_id', State.member.erpid)
        .maybeSingle();
      showBankForm(account);
    });
    document.getElementById('bankDeleteBtn')?.addEventListener('click', deleteBankAccount);
  }

  async function deleteBankAccount() {
    if (!State.member) return;
    if (!confirm('確定要刪除匯款資料?\n\n刪除後將無法領取分潤,需重新建立匯款資料才能繼續領取。')) return;

    const sb = getSupabase();
    if (!sb) {
      alert('Supabase 連線失敗');
      return;
    }

    const { error } = await sb
      .from('payout_accounts')
      .delete()
      .eq('member_id', State.member.erpid);

    if (error) {
      console.error('[刪除匯款失敗]', error);
      alert('刪除失敗: ' + error.message);
      return;
    }

    alert('匯款資料已刪除');
    loadEarnings();
  }


  /* =============================================================
     Analytics · 創作數據 (Creator only)
     ============================================================= */

  async function loadAnalytics() {
    if (!State.isCreator) return;
    const sb = getSupabase();
    if (!sb || !State.member) return;

    // 累計訂單(設計被使用次數 + 累計分潤)
    const { data: orders } = await sb
      .from('engraving_orders')
      .select('design_id, royalty_amount, ordered_at')
      .eq('creator_id', State.member.erpid);

    const totalUsed = (orders || []).length;
    const totalRoyalty = (orders || []).reduce((sum, o) => sum + Number(o.royalty_amount || 0), 0);

    // 上架設計數 (只算真正上架的:is_show 非「下架」;NULL 視為上架)
    const { data: listedRows } = await sb
      .from('engraving_designs')
      .select('id, is_show')
      .eq('creator_id', State.member.erpid)
      .eq('status', 'approved');
    const listedCount = (listedRows || []).filter(d => (d.is_show || '上架') === '上架').length;

    // 套到 KPI
    document.querySelectorAll('[data-stat="usedCount"]').forEach(el => el.textContent = totalUsed);
    document.querySelectorAll('[data-stat="listedCount"]').forEach(el => el.textContent = listedCount || 0);
    document.querySelectorAll('[data-stat="profileViews"]').forEach(el => el.textContent = '--'); // 需要另一個 table 紀錄
    document.querySelectorAll('[data-stat="totalRoyalty"]').forEach(el => el.textContent = '$' + totalRoyalty.toLocaleString());

    // 月柱狀圖(過去 10 個月)
    const monthly = {};
    const now = new Date();
    for (let i = 9; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0');
      monthly[key] = 0;
    }
    (orders || []).forEach(o => {
      const d = new Date(o.ordered_at);
      const key = d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0');
      if (monthly[key] !== undefined) monthly[key]++;
    });

    const max = Math.max(1, ...Object.values(monthly));
    const chart = document.getElementById('analyticsChart');
    const axis = document.getElementById('analyticsAxis');
    if (chart) {
      chart.innerHTML = Object.values(monthly).map((v, i) =>
        `<div class="bar ${i % 2 ? 'high' : ''}" style="height:${Math.max(4, v / max * 100)}%"></div>`
      ).join('');
    }
    if (axis) {
      const keys = Object.keys(monthly);
      axis.innerHTML = `<span>${keys[0]}</span><span>${keys[3]}</span><span>${keys[6]}</span><span>${keys[9]}</span>`;
    }

    // 各設計表現
    const designPerf = document.getElementById('analyticsDesignPerf');
    if (designPerf) {
      const { data: designs } = await sb
        .from('engraving_designs')
        .select('id, name, image_url, is_show, listed_at, created_at')
        .eq('creator_id', State.member.erpid)
        .eq('status', 'approved');

      if (!designs || designs.length === 0) {
        designPerf.innerHTML = '<p class="empty-text">還沒有上架設計</p>';
      } else {
        const designStats = {};
        designs.forEach(d => { designStats[d.id] = { used: 0, royalty: 0 }; });
        (orders || []).forEach(o => {
          if (designStats[o.design_id]) {
            designStats[o.design_id].used++;
            designStats[o.design_id].royalty += Number(o.royalty_amount || 0);
          }
        });

        // 抓每個 design 的 wishlist 數
        const wishCounts = {};
        for (const d of designs) {
          const { count } = await sb
            .from('engraving_wishlist')
            .select('design_id', { count: 'exact', head: true })
            .eq('design_id', d.id);
          wishCounts[d.id] = count || 0;
        }

        const thumbs = ['', 't2', 't3'];
        designPerf.innerHTML = designs.map((d, i) => {
          const stats = designStats[d.id];
          const isOff = (d.is_show || '上架') === '下架';
          const days = d.listed_at
            ? Math.floor((Date.now() - new Date(d.listed_at)) / (1000 * 60 * 60 * 24))
            : 0;
          const statusMeta = isOff
            ? '<span style="color:#c0392b">● 已下架</span>'
            : `已上架 ${days} 天`;
          return `
            <div class="design-perf-row"${isOff ? ' style="opacity:.6"' : ''}>
              <div class="perf-thumb ${thumbs[i % thumbs.length]}"></div>
              <div class="perf-info">
                <div class="perf-name">${escapeHtml(d.name)}</div>
                <div class="perf-meta">${statusMeta} · 被加入我的最愛刻圖 ${wishCounts[d.id]} 次</div>
              </div>
              <div class="perf-stats">
                <div><div class="perf-stat-num purple">${stats.used}</div><div class="perf-stat-lbl">被 使 用</div></div>
                <div><div class="perf-stat-num gold">$${stats.royalty.toLocaleString()}</div><div class="perf-stat-lbl">累 計 分 潤</div></div>
              </div>
            </div>`;
        }).join('');
      }
    }
  }


  /* =============================================================
     Earnings · 分潤紀錄 (Creator only)
     ============================================================= */

  async function loadEarnings() {
    if (!State.isCreator) return;
    const sb = getSupabase();
    if (!sb || !State.member) return;

    // 載入匯款資料
    const { data: account } = await sb
      .from('payout_accounts')
      .select('*')
      .eq('member_id', State.member.erpid)
      .maybeSingle();

    const bankInfo = document.getElementById('bankInfoList');
    const bankForm = document.getElementById('bankForm');
    const bankEditBtn = document.getElementById('bankEditBtn');
    const bankDeleteBtn = document.getElementById('bankDeleteBtn');
    const bankStatusBadge = document.getElementById('bankStatusBadge');

    if (account) {
      // 已有資料 - 顯示明細
      if (bankInfo) {
        bankInfo.innerHTML = `
          <div class="bank-info-row"><div class="bank-info-label">受 款 人</div><div class="bank-info-value">${escapeHtml(account.recipient_name || '-')}</div></div>
          <div class="bank-info-row"><div class="bank-info-label">銀 行</div><div class="bank-info-value">${escapeHtml(account.bank_name || '-')}</div></div>
          <div class="bank-info-row"><div class="bank-info-label">分 行</div><div class="bank-info-value">${escapeHtml(account.branch || '-')}</div></div>
          <div class="bank-info-row"><div class="bank-info-label">帳 號</div><div class="bank-info-value masked">${maskBankAccount(account.account_number)}</div></div>`;
        bankInfo.style.display = '';
      }
      if (bankForm) bankForm.style.display = 'none';
      if (bankEditBtn) bankEditBtn.style.display = '';
      if (bankDeleteBtn) bankDeleteBtn.style.display = '';
      // Badge: 已設定 (綠勾)
      if (bankStatusBadge) {
        bankStatusBadge.className = 'bank-status-pill set';
        bankStatusBadge.innerHTML = '<i class="fa-solid fa-circle-check"></i>已 設 定';
        bankStatusBadge.style.display = 'inline-flex';
      }
    } else {
      // 沒資料 - 顯示「未設定卡片」(Stripe 風)
      if (bankInfo) {
        bankInfo.innerHTML = `
          <div class="bank-empty-card">
            <div class="bank-empty-icon"><i class="fa-regular fa-credit-card"></i></div>
            <div class="bank-empty-info">
              <div class="bank-empty-title">完成設定即可領取分潤</div>
              <div class="bank-empty-desc">填寫銀行帳號讓樂活每月將分潤匯入你的帳戶</div>
            </div>
            <button class="action-btn-solid" id="bankCreateBtn"><i class="fa-solid fa-plus"></i><span>建立</span></button>
          </div>`;
        bankInfo.style.display = '';
        document.getElementById('bankCreateBtn')?.addEventListener('click', () => showBankForm(null));
      }
      if (bankForm) bankForm.style.display = 'none';
      if (bankEditBtn) bankEditBtn.style.display = 'none';
      if (bankDeleteBtn) bankDeleteBtn.style.display = 'none';
      // Badge: 未設定 (橘色)
      if (bankStatusBadge) {
        bankStatusBadge.className = 'bank-status-pill unset';
        bankStatusBadge.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>未 設 定';
        bankStatusBadge.style.display = 'inline-flex';
      }
    }

    // 累計分潤、本月、下次匯款
    const { data: records } = await sb
      .from('royalty_records')
      .select('amount, used_at, payout_status')
      .eq('creator_id', State.member.erpid);

    const total = (records || []).reduce((s, r) => s + Number(r.amount || 0), 0);
    const now = new Date();
    const thisMonth = (records || [])
      .filter(r => {
        const d = new Date(r.used_at);
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      })
      .reduce((s, r) => s + Number(r.amount || 0), 0);
    const pending = (records || [])
      .filter(r => r.payout_status === 'pending')
      .reduce((s, r) => s + Number(r.amount || 0), 0);

    document.querySelectorAll('[data-stat="thisMonth"]').forEach(el => el.textContent = '$' + thisMonth.toLocaleString());
    document.querySelectorAll('[data-stat="totalRoyalty"]').forEach(el => el.textContent = '$' + total.toLocaleString());
    document.querySelectorAll('[data-stat="nextPayout"]').forEach(el => el.textContent = '$' + pending.toLocaleString());

    // 匯款進度 - 顯示分潤明細
    const payoutList = document.getElementById('payoutList');
    if (payoutList) {
      if (!records || records.length === 0) {
        payoutList.innerHTML = '<p class="empty-text">尚無分潤紀錄,等待第一筆刻圖被使用!</p>';
      } else {
        // 抓詳細的 records 含 design_name
        const { data: detailed } = await sb
          .from('royalty_records')
          .select('id, amount, used_at, payout_status, design_name')
          .eq('creator_id', State.member.erpid)
          .order('used_at', { ascending: false })
          .limit(20);

        payoutList.innerHTML = (detailed || []).map(r => {
          const isPaid = r.payout_status === 'paid';
          const dt = new Date(r.used_at);
          const dateStr = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
          return `
            <div class="payout-row ${isPaid ? '' : 'upcoming'}">
              <div class="payout-icon ${isPaid ? 'paid-icon' : 'upcoming-icon'}">
                <i class="fa-solid fa-${isPaid ? 'check' : 'clock'}"></i>
              </div>
              <div class="payout-info">
                <div class="payout-date">${dateStr} · ${isPaid ? '已匯款' : '待匯款'}</div>
                <div class="payout-meta">${escapeHtml(r.design_name || '未命名設計')}</div>
              </div>
              <div class="payout-amt">$${Number(r.amount || 0).toLocaleString()}</div>
            </div>`;
        }).join('');
      }
    }
  }


  /* =============================================================
     Photo Modal
     ============================================================= */

  const modalBg = document.getElementById('modalBg');
  const modalTitle = document.getElementById('modalTitle');
  const modalDate = document.getElementById('modalDate');
  const modalFav = document.getElementById('modalFav');
  const modalStatus = document.getElementById('modalStatus');
  const modalImg = document.getElementById('modalImg');
  const modalImgLabel = document.getElementById('modalImgLabel');
  const modalReason = document.getElementById('modalReason');
  const modalReasonText = document.getElementById('modalReasonText');
  const modalActions = document.getElementById('modalActions');

  const statusLabels = { pending: '待審核', approved: '已公開', rejected: '未通過' };
  const statusIcons = { pending: 'clock', approved: 'check', rejected: 'xmark' };

  function openPhotoModal(cover) {
    const id = cover.dataset.id;
    const name = cover.dataset.name;
    const date = cover.dataset.date;
    const status = cover.dataset.status;
    const fav = parseInt(cover.dataset.fav, 10) || 0;
    const reason = cover.dataset.reason || '';

    modalTitle.textContent = name;
    modalDate.textContent = date;
    modalImgLabel.textContent = name;

    // 大圖背景跟原本卡片一樣
    modalImg.style.background = cover.style.background || cover.style.backgroundImage || '';
    modalImg.style.backgroundSize = 'cover';
    modalImg.style.backgroundPosition = 'center';

    modalStatus.className = 'modal-status ' + status;
    modalStatus.innerHTML = `<i class="fa-solid fa-${statusIcons[status]}"></i>${statusLabels[status]}`;

    if (status === 'approved') {
      modalFav.style.display = 'inline-flex';
      modalFav.innerHTML = `<i class="fa-solid fa-bookmark"></i>被加入收藏 <b>${fav}</b> 次`;
    } else {
      modalFav.style.display = 'none';
    }

    if (status === 'rejected' && reason) {
      modalReason.classList.add('on');
      modalReasonText.textContent = reason;
    } else {
      modalReason.classList.remove('on');
    }

    let html = '';
    if (status === 'rejected') {
      html += '<button class="btn warn" data-action="reupload"><i class="fa-solid fa-rotate"></i> 重新上傳</button>';
    }
    html += `<button class="btn danger" data-action="delete-photo" data-id="${id}"><i class="fa-regular fa-trash-can"></i> 刪除照片</button>`;
    html += '<button class="btn secondary" id="modalCloseBtn">關閉</button>';
    modalActions.innerHTML = html;

    document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
    const delBtn = modalActions.querySelector('[data-action="delete-photo"]');
    if (delBtn) delBtn.addEventListener('click', () => deletePhoto(delBtn.dataset.id));
    const reBtn = modalActions.querySelector('[data-action="reupload"]');
    if (reBtn) reBtn.addEventListener('click', () => {
      // 找原 post 資料 (傳給編輯模式)
      const post = ShareState.items?.find(p => p.id === id) || PhotoState.items?.find(p => p.id === id) || null;
      closeModal();
      if (window.LohasUpload && window.LohasUpload.openModalForEdit && post) {
        window.LohasUpload.openModalForEdit(post);
      } else if (window.LohasUpload && window.LohasUpload.openModal) {
        window.LohasUpload.openModal();
      } else {
        window.alert('上傳模組未載入');
      }
    });

    modalBg.classList.add('on');
  }

  function closeModal() { modalBg.classList.remove('on'); }


  /* =============================================================
     Avatar 上傳 (沿用現有 localStorage 邏輯)
     ============================================================= */

  function bindAvatar() {
    const btn = document.getElementById('avatarUploadBtn');
    const input = document.getElementById('avatarInput');
    const preview = document.getElementById('avatarPreview');

    if (btn && input) {
      btn.addEventListener('click', () => input.click());
    }

    if (input) {
      input.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
          window.alert('請選擇圖片檔案');
          return;
        }
        const reader = new FileReader();
        reader.onload = function (ev) {
          // 1:1 裁切
          openCropModal(ev.target.result, 1, (croppedDataUrl) => {
            if (preview) {
              preview.innerHTML = `<img src="${croppedDataUrl}" alt="會員頭像">`;
            }
            localStorage.setItem('lohasMemberAvatar', croppedDataUrl);
          });
        };
        reader.readAsDataURL(file);
        input.value = '';
      });
    }
  }

  function bindCreatorAvatar() {
    const btn = document.getElementById('creatorAvatarUploadBtn');
    const input = document.getElementById('creatorAvatarInput');
    const preview = document.getElementById('creatorAvatar');

    if (btn && input) {
      btn.addEventListener('click', () => input.click());
    }

    if (input) {
      input.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
          window.alert('請選擇圖片檔案');
          return;
        }
        const reader = new FileReader();
        reader.onload = function (ev) {
          // 1:1 裁切
          openCropModal(ev.target.result, 1, (croppedDataUrl) => {
            if (preview) {
              preview.innerHTML = `<img src="${croppedDataUrl}" alt="創作者頭像">`;
            }
            localStorage.setItem('lohasCreatorAvatar', croppedDataUrl);
          });
        };
        reader.readAsDataURL(file);
        input.value = '';
      });
    }
  }

  function bindCreatorJoiningPhoto() {
    const btn = document.getElementById('creatorJoiningPhotoBtn');
    const preview = document.getElementById('creatorJoiningPhotoPreview');
    const input = document.getElementById('creatorJoiningPhotoInput');
    const hidden = document.getElementById('creatorJoiningPhoto');
    const clearBtn = document.getElementById('creatorJoiningPhotoClear');

    if (preview && input) preview.addEventListener('click', () => input.click());
    if (btn && input) btn.addEventListener('click', () => input.click());

    // ✕ 移除按鈕
    if (clearBtn) {
      clearBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (preview) {
          preview.style.backgroundImage = '';
          preview.classList.remove('has-image');
        }
        if (hidden) hidden.value = '';
        if (input) input.value = '';
        clearBtn.style.display = 'none';
      });
    }

    if (input) {
      input.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
          window.alert('請選擇圖片檔案');
          return;
        }
        const reader = new FileReader();
        reader.onload = function (ev) {
          // 先開裁切 modal (3:4 比例)
          openCropModal(ev.target.result, 3 / 4, (croppedDataUrl) => {
            if (preview) {
              preview.style.backgroundImage = `url('${croppedDataUrl}')`;
              preview.classList.add('has-image');
            }
            if (hidden) hidden.value = croppedDataUrl;
            // 顯示 ✕
            if (clearBtn) clearBtn.style.display = 'flex';
          });
        };
        reader.readAsDataURL(file);
        // 清除 file input 讓同一張可以重複選
        input.value = '';
      });
    }
  }

  // 共用裁切 modal (3:4 直式 / 也可以傳其他 ratio)
  let _cropper = null;
  let _cropCallback = null;

  function openCropModal(dataUrl, aspectRatio, callback) {
    const modal = document.getElementById('cropModal');
    const img = document.getElementById('cropImage');
    if (!modal || !img) {
      // 沒 modal 直接 callback 原圖
      callback(dataUrl);
      return;
    }
    _cropCallback = callback;
    img.src = dataUrl;
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    // 等 modal 顯示後再初始化 Cropper
    setTimeout(() => {
      if (_cropper) { _cropper.destroy(); _cropper = null; }
      if (window.Cropper) {
        _cropper = new window.Cropper(img, {
          aspectRatio: aspectRatio,
          viewMode: 1,
          autoCropArea: 0.95,
          background: false,
          movable: true,
          zoomable: true,
          rotatable: false,
          scalable: false
        });
      }
    }, 50);

    // 綁套用 / 取消 (只綁一次, 用 once)
    const apply = document.getElementById('applyCrop');
    const cancel = document.getElementById('closeCrop');
    const cancelBtn = document.getElementById('cancelCrop');

    function doApply() {
      if (_cropper && _cropCallback) {
        const canvas = _cropper.getCroppedCanvas({ maxWidth: 1200, maxHeight: 1600 });
        const result = canvas.toDataURL('image/jpeg', 0.92);
        _cropCallback(result);
      }
      closeCrop();
    }
    function closeCrop() {
      if (_cropper) { _cropper.destroy(); _cropper = null; }
      _cropCallback = null;
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
    }
    apply?.addEventListener('click', doApply, { once: true });
    cancel?.addEventListener('click', closeCrop, { once: true });
    cancelBtn?.addEventListener('click', closeCrop, { once: true });
  }

  // 自訂內容區塊 (可新增 / 刪除多筆圖文)
  let customBlockCounter = 0;

  function renderCustomBlock(index, data = {}) {
    const id = `cb_${index}`;
    const hasImage = !!data.image;
    return `
      <div class="custom-block" data-index="${index}" id="${id}">
        <div class="custom-block-h">
          <span class="custom-block-num">區塊 ${index + 1}</span>
          <button class="custom-block-remove" data-index="${index}" type="button" title="刪除此區塊">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
        <div class="editor-row">
          <div class="editor-label">標題</div>
          <div><input class="editor-input cb-title" placeholder="例如:創作風格" value="${escapeHtml(data.title || '')}"/></div>
        </div>
        <div class="editor-row">
          <div class="editor-label">圖片</div>
          <div>
            <div class="creator-photo-wrap">
              <div class="creator-photo-preview cb-photo-preview ${hasImage ? 'has-image' : ''}" ${hasImage ? `style="background-image:url('${escapeHtml(data.image)}')"` : ''}>
                <i class="fa-regular fa-image"></i>
                <span>選填</span>
              </div>
              <button class="creator-photo-clear cb-photo-clear" type="button" aria-label="移除圖片" style="${hasImage ? 'display:flex' : 'display:none'}">
                <i class="fa-solid fa-xmark"></i>
              </button>
              <input type="file" class="visually-hidden cb-photo-input" accept="image/*">
              <input type="hidden" class="cb-image" value="${escapeHtml(data.image || '')}"/>
            </div>
          </div>
        </div>
        <div class="editor-row">
          <div class="editor-label">內文</div>
          <div><textarea class="editor-area cb-text" placeholder="輸入內文...">${escapeHtml(data.text || '')}</textarea></div>
        </div>
      </div>
    `;
  }

  function bindCustomBlockEvents(blockEl) {
    // 刪除
    blockEl.querySelector('.custom-block-remove')?.addEventListener('click', () => {
      if (confirm('確定要刪除此區塊?')) {
        blockEl.remove();
        renumberCustomBlocks();
      }
    });
    // 圖片上傳 (跟緣分區一樣加 3:4 裁切)
    const photoPreview = blockEl.querySelector('.cb-photo-preview');
    const photoInput = blockEl.querySelector('.cb-photo-input');
    const photoHidden = blockEl.querySelector('.cb-image');
    const photoClear = blockEl.querySelector('.cb-photo-clear');
    if (photoPreview && photoInput) {
      photoPreview.addEventListener('click', () => photoInput.click());
      photoInput.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file || !file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          // 開裁切 modal (3:4 比例, 跟緣分區一致)
          openCropModal(ev.target.result, 3 / 4, (croppedDataUrl) => {
            photoPreview.style.backgroundImage = `url('${croppedDataUrl}')`;
            photoPreview.classList.add('has-image');
            if (photoHidden) photoHidden.value = croppedDataUrl;
            if (photoClear) photoClear.style.display = 'flex';
          });
        };
        reader.readAsDataURL(file);
        photoInput.value = '';
      });
    }
    // ✕ 移除圖片
    if (photoClear) {
      photoClear.addEventListener('click', e => {
        e.stopPropagation();
        if (photoPreview) {
          photoPreview.style.backgroundImage = '';
          photoPreview.classList.remove('has-image');
        }
        if (photoHidden) photoHidden.value = '';
        if (photoInput) photoInput.value = '';
        photoClear.style.display = 'none';
      });
    }
  }

  function renumberCustomBlocks() {
    document.querySelectorAll('.custom-block').forEach((el, i) => {
      el.querySelector('.custom-block-num').textContent = `區塊 ${i + 1}`;
    });
  }

  function bindCustomBlocks() {
    const list = document.getElementById('customBlocksList');
    const addBtn = document.getElementById('addCustomBlockBtn');

    if (!list || !addBtn) return;

    addBtn.addEventListener('click', () => {
      // 移除空狀態提示
      const empty = list.querySelector('.empty-text');
      if (empty) empty.remove();

      const idx = list.querySelectorAll('.custom-block').length;
      const wrapper = document.createElement('div');
      wrapper.innerHTML = renderCustomBlock(idx);
      const blockEl = wrapper.firstElementChild;
      list.appendChild(blockEl);
      bindCustomBlockEvents(blockEl);
    });

    // 載入既有資料
    if (State.creatorInfo && Array.isArray(State.creatorInfo.custom_blocks)) {
      State.creatorInfo.custom_blocks.forEach((data, i) => {
        const empty = list.querySelector('.empty-text');
        if (empty) empty.remove();
        const wrapper = document.createElement('div');
        wrapper.innerHTML = renderCustomBlock(i, data);
        const blockEl = wrapper.firstElementChild;
        list.appendChild(blockEl);
        bindCustomBlockEvents(blockEl);
      });
    }
  }

  function collectCustomBlocks() {
    const blocks = [];
    document.querySelectorAll('.custom-block').forEach(el => {
      const title = el.querySelector('.cb-title')?.value || '';
      const image = el.querySelector('.cb-image')?.value || '';
      const text = el.querySelector('.cb-text')?.value || '';
      if (title || text || image) {
        blocks.push({ title, image, text });
      }
    });
    return blocks;
  }


  /* =============================================================
     Navigation · 頁面切換 + 登出
     ============================================================= */

  function bindNavigation() {
    // 側邊欄頁面切換
    root.querySelectorAll('.nav-link[data-page]').forEach(n => {
      n.addEventListener('click', () => goTo(n.dataset.page));
    });

    // 麵包屑「會員中心」點擊跳首頁
    document.querySelectorAll('[data-jump-page]').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        goTo(el.dataset.jumpPage);
      });
    });

    // 快捷功能跳轉
    root.querySelectorAll('.shortcut-card[data-jump]').forEach(c => {
      c.addEventListener('click', () => goTo(c.dataset.jump));
    });

    // 快捷功能特殊動作 (shortcut-card 與 creator-onboard 的 cta 共用)
    root.querySelectorAll('.shortcut-card[data-action], .creator-onboard [data-action]').forEach(c => {
      c.addEventListener('click', () => {
        const action = c.dataset.action;
        if (action === 'upload-photo') {
          // 開上傳照片 modal
          if (window.LohasUpload && window.LohasUpload.openModal) {
            window.LohasUpload.openModal();
          }
        } else if (action === 'upload-design') {
          // 開上傳刻圖設計 modal
          if (window.LohasUploadDesign && window.LohasUploadDesign.openModal) {
            window.LohasUploadDesign.openModal();
          } else {
            console.error('[upload-design] LohasUploadDesign 未載入,確認 member-portal.html 是否引用 js/upload-design.js');
            alert('刻圖上傳模組未載入,請重新整理頁面或聯絡客服');
          }
        }
      });
    });

    // 手機板底部 tab bar
    document.querySelectorAll('.mp-mobile-tabbar .tab-item').forEach(tab => {
      tab.addEventListener('click', (e) => {
        e.preventDefault();
        const action = tab.dataset.action;
        const page = tab.dataset.page;

        // 中央上傳鈕 → 直接開 modal
        if (action === 'upload-photo') {
          if (window.LohasUpload && window.LohasUpload.openModal) {
            window.LohasUpload.openModal();
          }
          return;
        }

        // 其他 tab → 切換到對應頁面 + 高亮自己
        if (page) {
          // 高亮 active
          document.querySelectorAll('.mp-mobile-tabbar .tab-item').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          // 切換頁
          goTo(page);
        }
      });
    });

    // 手機板抽屜選單
    const drawer = document.getElementById('mpDrawer');
    const drawerOverlay = document.getElementById('mpDrawerOverlay');
    const drawerOpen = document.getElementById('mpMobileBurger');
    const drawerClose = document.getElementById('mpDrawerClose');

    function openDrawer() {
      if (drawer) drawer.classList.add('is-open');
      if (drawerOverlay) drawerOverlay.classList.add('is-open');
      document.body.style.overflow = 'hidden';
    }
    function closeDrawer() {
      if (drawer) drawer.classList.remove('is-open');
      if (drawerOverlay) drawerOverlay.classList.remove('is-open');
      document.body.style.overflow = '';
    }
    drawerOpen?.addEventListener('click', openDrawer);
    drawerClose?.addEventListener('click', closeDrawer);
    drawerOverlay?.addEventListener('click', closeDrawer);

    // 抽屜內 item 點擊 → 切換頁 + 關抽屜
    document.querySelectorAll('.drawer-item[data-page]').forEach(item => {
      item.addEventListener('click', () => {
        const page = item.dataset.page;
        if (page) {
          goTo(page);
          closeDrawer();
        }
      });
    });

    // 抽屜內登出
    document.getElementById('mobile-logout-btn-drawer')?.addEventListener('click', () => {
      if (Auth.logout) Auth.logout();
    });

    // 登出
    document
      .querySelectorAll('#logout-btn-sidebar, #mobile-logout-btn')
      .forEach(b => b.addEventListener('click', () => Auth.logout && Auth.logout()));

    // Modal 關閉
    document.getElementById('modalClose').addEventListener('click', closeModal);
    modalBg.addEventListener('click', e => { if (e.target === modalBg) closeModal(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && modalBg.classList.contains('on')) closeModal();
    });

    // 點外面關閉故事選單
    document.addEventListener('click', () => {
      root.querySelectorAll('.story-menu').forEach(m => m.classList.remove('on'));
    });

    // 駁回 banner「我知道了」按鈕 → 隱藏 banner + 記憶 ack
    document.getElementById('photoRejectedAck')?.addEventListener('click', () => {
      const banner = document.getElementById('photoRejectedBanner');
      const badge = document.getElementById('photoRejectBadge');
      if (banner) {
        banner.style.display = 'none';
        // 把 unacked IDs 加入 ack 紀錄
        if (State.member && banner.dataset.unackedIds) {
          try {
            const ids = JSON.parse(banner.dataset.unackedIds);
            const ackedKey = `lohasPhotoRejectAcked_${State.member.erpid}`;
            const existing = JSON.parse(localStorage.getItem(ackedKey) || '[]');
            const merged = Array.from(new Set([...existing, ...ids]));
            localStorage.setItem(ackedKey, JSON.stringify(merged));
          } catch (e) {}
        }
      }
      if (badge) badge.style.display = 'none';
    });
    document.getElementById('storyRejectedAck')?.addEventListener('click', () => {
      const banner = document.getElementById('storyRejectedBanner');
      if (banner) banner.style.display = 'none';
    });

    // 上傳照片 / 上傳故事 → 彈出上傳 modal (不離開會員平台)
    root.addEventListener('click', (e) => {
      const photoBtn = e.target.closest('.add-photo-card');
      const storyBtn = e.target.closest('.add-story-card');
      const reuploadBtn = e.target.closest('.reupload-btn');
      if (photoBtn || storyBtn || reuploadBtn) {
        e.preventDefault();
        if (window.LohasUpload && window.LohasUpload.openModal) {
          window.LohasUpload.openModal();
        } else {
          window.alert('上傳模組尚未載入,請重整頁面');
        }
      }
    });
  }

  const pageTitles = {
    'home': '首頁',
    'inspo': '我的靈感',
    'wishlist': '我的最愛刻圖',
    'shares': '我的分享',
    'my-designs': '我的刻圖設計',
    'creator-page': '創作者個人頁',
    'analytics': '創作數據',
    'earnings': '分潤紀錄',
    'profile': '會員資料'
  };

  function goTo(page) {
    root.querySelectorAll('.nav-link').forEach(x => x.classList.remove('on'));
    const navLink = root.querySelector(`.nav-link[data-page="${page}"]`);
    if (navLink) navLink.classList.add('on');

    root.querySelectorAll('.content-page').forEach(p => {
      p.classList.toggle('on', p.dataset.page === page);
    });

    // 同步麵包屑 (電腦版 + 手機版)
    const bc = document.getElementById('mpBreadcrumbCurrent');
    if (bc) bc.textContent = pageTitles[page] || '';
    const bcM = document.getElementById('mpMobileBreadcrumbCurrent');
    if (bcM) bcM.textContent = pageTitles[page] || '';

    // 進入頁面時延遲載入該頁資料
    if (page === 'shares') {
      loadShares();  // 合併版: 一次載入照片 + 故事
    }
    if (page === 'inspo') loadInspos();
    if (page === 'wishlist') loadWishlist();
    if (page === 'my-designs') loadMyDesigns();
    if (page === 'analytics') loadAnalytics();
    if (page === 'earnings') loadEarnings();

    // 進入分享頁 → 隱藏 sidebar 紅標 (已看過)
    if (page === 'shares') {
      const badge = document.getElementById('photoRejectBadge');
      if (badge) badge.style.display = 'none';
      const badgeDrawer = document.getElementById('photoRejectBadgeDrawer');
      if (badgeDrawer) badgeDrawer.style.display = 'none';
    }

    root.querySelector('.main').scrollTop = 0;
  }


  /* =============================================================
     Init
     ============================================================= */

  async function init() {
    const ok = await loadIdentity();
    if (!ok) return;

    applyIdentity();
    bindAvatar();
    bindCreatorAvatar();
    bindCreatorJoiningPhoto();
    bindCustomBlocks();
    bindNavigation();
    bindPreviewCreator();
    bindSaveCreatorInfo();
    bindBankForm();

    // 一進來就先計算一次駁回數量, 顯示側邊欄紅圓圓
    refreshPhotoRejectBadge();

    // 預載入首頁需要的東西
    if (State.isCreator) loadAnalytics(); // 首頁累計數據
  }

  document.addEventListener('DOMContentLoaded', init);


  /* =============================================================
     Export
     ============================================================= */

  window.LohasMemberPortal = {
    State,
    loadPhotos,
    loadInspos,
    loadWishlist,
    loadStories,
    loadMyDesigns,
    loadAnalytics,
    loadEarnings,
    goTo,
    // upload.js 上傳成功後呼叫
    reloadAfterUpload(newPost) {
      const onPage = root.querySelector('.content-page.on')?.dataset.page;
      if (onPage === 'photos') loadPhotos();
      else if (onPage === 'stories') loadStories();
    }
  };
  window.LohasMember = window.LohasMemberPortal;

})(window);
