/* =============================================================
   樂活管理後台 · admin-portal.js
   -------------------------------------------------------------
   依賴 (HTML 中需先載入):
   - LohasUtils    (utils.js)
   - LohasAuth     (auth.js)
   - LohasSupabase (supabase.js)
   - window.supabase (Supabase JS SDK from CDN)
   ============================================================= */

(function (window) {
  'use strict';

  const Utils = window.LohasUtils;
  const Auth = window.LohasAuth;
  const Supabase = window.LohasSupabase;

  if (!Utils || !Auth || !Supabase) {
    console.error('[admin-portal] 缺少依賴,請先載入 utils.js / auth.js / supabase.js');
    return;
  }

  const root = document.getElementById('ad');
  if (!root) return;


  /* =============================================================
     全域 State
     ============================================================= */

  const State = {
    member: null,        // 當前登入會員 (從 Auth.getStoredMember())
    isAdmin: false,      // 是否為 admin
    adminInfo: null,     // admins table 紀錄
    users: [],           // 會員列表 (cache)
    creatorIds: new Set(),    // 是 Creator 的 erpid set
    suspendedIds: new Set(),  // 被停權的 erpid set
    adminIds: new Set()       // 是 Admin 的 erpid set
  };

  function getSb() {
    if (!Supabase || !Supabase.getClient) return null;
    return Supabase.getClient();
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // 從 File / Blob 拿副檔名 (Cropper.js 回傳的 Blob 沒有 name 屬性)
  function getExt(fileOrBlob) {
    if (!fileOrBlob) return 'jpg';
    if (fileOrBlob.name) {
      const e = fileOrBlob.name.split('.').pop()?.toLowerCase();
      if (e) return e;
    }
    // 從 mime type 取
    const mime = fileOrBlob.type || '';
    if (mime.includes('png')) return 'png';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('gif')) return 'gif';
    return 'jpg';
  }


  /* =============================================================
     1. Admin 身份檢查
     ============================================================= */

  async function verifyAdmin() {
    const member = Auth.getStoredMember();

    if (!member || !member.erpid) {
      // 沒登入 → 導 login
      Auth.requireLogin('admin-portal.html');
      return false;
    }

    // 強制把 erpid 轉成字串
    // (ERP API 可能回 number, 但 Supabase 的 member_id 欄位是 TEXT 型別)
    member.erpid = String(member.erpid);

    State.member = member;

    // 查 Supabase admins table
    const sb = getSb();
    if (!sb) {
      alert('Supabase 設定錯誤,無法驗證 admin 身份');
      return false;
    }

    try {
      const { data, error } = await sb
        .from('admins')
        .select('member_id, display_name, role, status')
        .eq('member_id', member.erpid)
        .eq('status', 'active')
        .maybeSingle();

      if (error) {
        console.error('[admin 身份查詢失敗]', error);
        alert('admin 身份驗證失敗');
        return false;
      }

      if (!data) {
        // 不是 admin → 導回會員平台
        alert('您沒有後台管理權限,即將返回會員中心');
        window.location.href = 'member-portal.html';
        return false;
      }

      State.isAdmin = true;
      State.adminInfo = data;
      return true;

    } catch (err) {
      console.error('[verifyAdmin 例外]', err);
      alert('身份驗證過程出錯');
      return false;
    }
  }

  function applyAdminUI() {
    const m = State.member;
    const ai = State.adminInfo;

    // sidebar admin user 區
    const adminAvatar = root.querySelector('.admin-avatar');
    const adminName = root.querySelector('.admin-name');
    const adminRole = root.querySelector('.admin-role');

    if (adminAvatar && m.name) {
      adminAvatar.textContent = m.name.slice(0, 1);
    }
    if (adminName) adminName.textContent = ai.display_name || m.name || '管理員';
    if (adminRole) adminRole.textContent = ai.role === 'super_admin' ? '超級管理員' : '管理員';
  }


  /* =============================================================
     2. Nav 切換 + Breadcrumb
     ============================================================= */

  const pageTitles = {
    'dashboard': '首頁',
    'review-designs': '刻圖審核',
    'review-uploads': '上傳審核',
    'cm-banner': '首頁與分頁 Banner',
    'cm-news': '最新消息',
    'admin-upload': '樂活官方上傳',
    'manage-designs': '刻圖管理',
    'manage-shares': '分享牆管理',
    'users': '會員列表',
    'creators': '創作者管理',
    'ip': 'IP 合作'
  };

  function goTo(page, opts) {
    opts = opts || {};

    // 「新增創作者個人頁」改成: 跳到 creators 頁 + 打開 Modal
    if (page === 'admin-grant-creator') {
      goTo('creators');  // 點亮創作者管理 + 顯示列表
      setTimeout(() => openCreatorModal(null), 100);  // 開新增 Modal
      return;
    }

    root.querySelectorAll('.nav-link').forEach(x => x.classList.remove('on'));
    const navLink = root.querySelector(`.nav-link[data-page="${page}"]`);
    if (navLink) navLink.classList.add('on');

    root.querySelectorAll('.content-page').forEach(p => {
      p.classList.toggle('on', p.dataset.page === page);
    });

    // 同步手機版 drawer active
    syncDrawerActive(page);

    Utils.setText('#breadcrumbCurrent', pageTitles[page] || '');

    // 進入頁面時觸發載入
    if (page === 'dashboard') { loadDashboard(); refreshReviewCounts(); }
    if (page === 'users') loadUsers();
    if (page === 'review-designs') { loadDesignReview(); refreshReviewCounts(); }
    if (page === 'review-uploads') { loadReviewUploads(); refreshReviewCounts(); }
    if (page === 'cm-news') loadNews();
    if (page === 'admin-upload') { initAdminUpload(); loadAdminUploadHistory(); }
    if (page === 'creators') loadCreatorsList();
    if (page === 'manage-designs') loadManageDesigns();
    if (page === 'manage-shares') loadManageShares();

    root.querySelector('.main').scrollTop = 0;
  }

  function bindNav() {
    root.querySelectorAll('.nav-link[data-page]').forEach(n => {
      n.addEventListener('click', () => goTo(n.dataset.page));
    });
    root.querySelectorAll('[data-jump]').forEach(a => {
      a.addEventListener('click', () => goTo(a.dataset.jump));
    });
    // 麵包屑「樂活管理後台」點擊跳首頁
    document.getElementById('adBcHome')?.addEventListener('click', e => {
      e.preventDefault();
      goTo('dashboard');
    });
  }


  /* =============================================================
     3. 儀表板 KPI (從 Supabase 統計)
     ============================================================= */

  async function loadDashboard() {
    const sb = getSb();
    if (!sb) return;

    // 待審核項目 (engraving_designs + gallery_posts 拆 photo/story)
    try {
      const [designs, photos, stories] = await Promise.all([
        sb.from('engraving_designs').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        sb.from('gallery_posts').select('id', { count: 'exact', head: true }).eq('status', 'pending').eq('type', 'photo'),
        sb.from('gallery_posts').select('id', { count: 'exact', head: true }).eq('status', 'pending').eq('type', 'story')
      ]);

      const dCount = designs.count || 0;
      const pCount = photos.count || 0;
      const sCount = stories.count || 0;
      const total = dCount + pCount + sCount;

      // 套到 KPI (用 ID 選擇器更穩)
      Utils.setText('#kpiReviewTotal', total);
      Utils.setText('#kpiReviewBreakdown', `${dCount} 設計 · ${pCount} 照片 · ${sCount} 故事`);

      // 側邊欄 badge 也更新
      updateBadge('review-designs', dCount);
      updateBadge('review-uploads', pCount + sCount);

    } catch (err) {
      console.error('[儀表板 KPI 載入失敗]', err);
    }

    // 本月新刻圖上架 (vs 上月)
    try {
      const { thisMonth, lastMonth, lastMonthEnd } = monthRanges();

      const [thisM, lastM] = await Promise.all([
        sb.from('engraving_designs').select('type').eq('status', 'approved').gte('listed_at', thisMonth.toISOString()),
        sb.from('engraving_designs').select('id', { count: 'exact', head: true }).eq('status', 'approved').gte('listed_at', lastMonth.toISOString()).lt('listed_at', lastMonthEnd.toISOString())
      ]);

      const arr = thisM.data || [];
      const creatorCount = arr.filter(d => d.type === 'creator').length;
      const collabCount = arr.filter(d => d.type === 'collab').length;
      const memberCount = arr.filter(d => d.type === 'member' || !d.type).length;
      const totalDesigns = arr.length;
      const lastCount = lastM.count || 0;

      Utils.setText('#kpiNewDesigns', totalDesigns);
      Utils.setText('#kpiNewDesignsBreakdown', formatTrend(totalDesigns, lastCount, `Creator ${creatorCount} · Collab ${collabCount} · Member ${memberCount}`));
    } catch (err) {
      console.error('[本月新刻圖統計失敗]', err);
    }

    // 本月上傳照片 (gallery_posts created_at 在本月)
    try {
      const { thisMonth, lastMonth, lastMonthEnd } = monthRanges();

      const [thisM, lastM] = await Promise.all([
        sb.from('gallery_posts').select('id', { count: 'exact', head: true }).gte('created_at', thisMonth.toISOString()),
        sb.from('gallery_posts').select('id', { count: 'exact', head: true }).gte('created_at', lastMonth.toISOString()).lt('created_at', lastMonthEnd.toISOString())
      ]);

      const thisCount = thisM.count || 0;
      const lastCount = lastM.count || 0;

      Utils.setText('#kpiNewPhotos', thisCount);
      Utils.setText('#kpiNewPhotosTrend', formatTrend(thisCount, lastCount));
    } catch (err) {
      console.error('[本月上傳照片統計失敗]', err);
    }

    // 本月雷刻預約 (engraving_orders created_at 在本月)
    try {
      const { thisMonth, lastMonth, lastMonthEnd } = monthRanges();

      const [thisM, lastM] = await Promise.all([
        sb.from('engraving_orders').select('id', { count: 'exact', head: true }).gte('created_at', thisMonth.toISOString()),
        sb.from('engraving_orders').select('id', { count: 'exact', head: true }).gte('created_at', lastMonth.toISOString()).lt('created_at', lastMonthEnd.toISOString())
      ]);

      const thisCount = thisM.count || 0;
      const lastCount = lastM.count || 0;

      Utils.setText('#kpiNewOrders', thisCount);
      Utils.setText('#kpiNewOrdersTrend', formatTrend(thisCount, lastCount));
    } catch (err) {
      console.error('[本月雷刻統計失敗]', err);
    }

    // 載入 Dashboard 待審核小列表 (最早送審的前 4 筆)
    loadDashboardReviewList();

    // 載入最近活動 (#2)
    loadDashboardActivity();
  }

  // 本月 / 上月 / 上月底 時間區間
  function monthRanges() {
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = thisMonth; // 本月開頭 = 上月結束
    return { thisMonth, lastMonth, lastMonthEnd };
  }

  // 格式化趨勢字串: 與上月比較
  function formatTrend(thisN, lastN, suffix) {
    let trend;
    if (lastN === 0 && thisN === 0) {
      trend = '— 與上月持平';
    } else if (lastN === 0) {
      trend = `↑ 上月 0 → 本月 ${thisN}`;
    } else if (thisN === 0) {
      trend = `↓ 上月 ${lastN} → 本月 0`;
    } else {
      const pct = Math.round(((thisN - lastN) / lastN) * 100);
      const sign = pct >= 0 ? '↑' : '↓';
      trend = `${sign} 比上月 ${pct >= 0 ? '+' : ''}${pct}%`;
    }
    return suffix ? `${trend} · ${suffix}` : trend;
  }

  function updateBadge(page, count) {
    const link = root.querySelector(`.nav-link[data-page="${page}"]`);
    if (!link) return;
    const badge = link.querySelector('.badge');
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
    // 同步手機版 drawer
    syncDrawerBadge(page, count);
  }

  // 精準刷新所有審核相關計數 (sidebar badges + page-sub + review-tabs)
  async function refreshReviewCounts() {
    const sb = getSb();
    if (!sb) return;

    try {
      const [designs, photos, stories] = await Promise.all([
        sb.from('engraving_designs').select('id, type', { count: 'exact' }).eq('status', 'pending'),
        sb.from('gallery_posts').select('id', { count: 'exact', head: true }).eq('status', 'pending').eq('type', 'photo'),
        sb.from('gallery_posts').select('id', { count: 'exact', head: true }).eq('status', 'pending').eq('type', 'story')
      ]);

      const dCount = designs.count || 0;
      const pCount = photos.count || 0;
      const sCount = stories.count || 0;

      // sidebar 兩個 badge (上傳合併)
      updateBadge('review-designs', dCount);
      updateBadge('review-uploads', pCount + sCount);

      // page-sub 文字
      const designsSub = root.querySelector('#reviewDesignsSub');
      if (designsSub) designsSub.textContent = `${dCount} 件待審核 · 通過後自動上架創作者市集`;

      const uploadsSub = root.querySelector('#reviewUploadsSub');
      if (uploadsSub) uploadsSub.textContent = `${pCount + sCount} 件待審核 · 通過後將出現在靈感牆`;

      // 刻圖審核 review-tabs (按 type 分類)
      const designsByType = (designs.data || []).reduce((acc, d) => {
        const t = d.type || 'member';
        acc[t] = (acc[t] || 0) + 1;
        return acc;
      }, {});

      const tabsEl = root.querySelector('#designReviewTabs');
      if (tabsEl) {
        const allCount = dCount;
        const creatorCount = designsByType.creator || 0;
        const collabCount = designsByType.collab || 0;
        const memberCount = designsByType.member || 0;

        const setCount = (filter, n) => {
          const tab = tabsEl.querySelector(`.rtab[data-filter="${filter}"] .count`);
          if (tab) tab.textContent = n;
        };
        setCount('all', allCount);
        setCount('creator', creatorCount);
        setCount('collab', collabCount);
        setCount('member', memberCount);
      }

    } catch (err) {
      console.error('[計數刷新失敗]', err);
    }
  }

  async function loadDashboardReviewList() {
    const sb = getSb();
    if (!sb) return;

    const list = root.querySelector('.content-page[data-page="dashboard"] .review-list');
    if (!list) return;

    try {
      const [designsRes, uploadsRes] = await Promise.all([
        sb.from('engraving_designs').select('id, name, creator_id, type, created_at').eq('status', 'pending').order('created_at', { ascending: true }).limit(3),
        sb.from('gallery_posts').select('id, title, customer_name, member_id, type, created_at').eq('status', 'pending').order('created_at', { ascending: true }).limit(3)
      ]);

      const items = [];
      (designsRes.data || []).forEach(d => items.push({
        type: 'design', id: d.id, title: d.name, by: d.creator_id, role: d.type, time: d.created_at
      }));
      (uploadsRes.data || []).forEach(p => items.push({
        type: p.type === 'story' ? 'story' : 'photo',
        id: p.id,
        title: p.title || '未命名',
        by: p.customer_name || p.member_id,
        role: 'member',
        time: p.created_at
      }));

      // 按時間升序 (最舊的優先)
      items.sort((a, b) => new Date(a.time) - new Date(b.time));

      if (items.length === 0) {
        list.innerHTML = '<p style="text-align:center;padding:40px 0;color:var(--lohas-mute);font-size:12px">目前沒有待審核項目</p>';
        return;
      }

      const typeLabels = { design: '設 計', photo: '照 片', story: '故 事' };
      const grads = ['', 'g2', 'g3'];

      list.innerHTML = items.slice(0, 5).map((it, i) => {
        const grad = grads[i % grads.length];
        const rolePill = it.role === 'creator'
          ? '<span class="role-pill creator"><i class="fa-solid fa-star"></i>Creator</span>'
          : it.role === 'collab' || it.role === 'ip'
            ? '<span class="role-pill ip"><i class="fa-solid fa-crown"></i>Collab</span>'
            : '<span class="role-pill member">Member</span>';

        return `
          <div class="review-item" data-type="${it.type}" data-id="${it.id}">
            <div class="review-thumb ${grad}">${typeLabels[it.type]}</div>
            <div class="review-body">
              <div class="review-title">${escapeHtml(it.title)} ${rolePill}</div>
              <div class="review-meta">by <b>${escapeHtml(it.by)}</b> · ${formatTime(it.time)}</div>
            </div>
            <div class="review-actions">
              <button class="approve" data-act="approve"><i class="fa-solid fa-check"></i></button>
              <button class="reject" data-act="reject"><i class="fa-solid fa-xmark"></i></button>
            </div>
          </div>`;
      }).join('');

      // 綁定按鈕
      list.querySelectorAll('.review-item').forEach(item => {
        const type = item.dataset.type;
        const id = item.dataset.id;
        item.querySelector('[data-act="approve"]').addEventListener('click', e => {
          e.stopPropagation();
          quickApprove(type, id);
        });
        item.querySelector('[data-act="reject"]').addEventListener('click', e => {
          e.stopPropagation();
          openRejectModal(type, id);
        });
      });

    } catch (err) {
      console.error('[Dashboard 待審核列表載入失敗]', err);
    }
  }

  /**
   * #2 最近活動 - 混合 上傳 / 通過 / 升級 / 駁回 等真實事件
   * 從 engraving_designs / gallery_posts / creator_info 拼接
   */
  async function loadDashboardActivity() {
    const sb = getSb();
    if (!sb) return;
    const list = document.getElementById('activityList');
    if (!list) return;

    try {
      const [designs, gallery, creators] = await Promise.all([
        sb.from('engraving_designs')
          .select('id, name, creator_id, status, created_at')
          .order('created_at', { ascending: false })
          .limit(10),
        sb.from('gallery_posts')
          .select('id, title, customer_name, type, status, created_at')
          .order('created_at', { ascending: false })
          .limit(10),
        sb.from('creator_info')
          .select('member_id, display_name, status, created_at')
          .order('created_at', { ascending: false })
          .limit(5)
      ]);

      const events = [];

      // 刻圖事件
      (designs.data || []).forEach(d => {
        let type, text;
        if (d.status === 'pending') {
          type = 'upload';
          text = `<b>${maskName(d.name || '匿名')}</b> 上傳了刻圖設計`;
        } else if (d.status === 'approved') {
          type = 'approve';
          text = `<b>${maskName(d.name || '設計')}</b> 通過刻圖審核`;
        } else if (d.status === 'rejected') {
          type = 'reject';
          text = `<b>${maskName(d.name || '設計')}</b> 刻圖被駁回`;
        } else {
          return;
        }
        events.push({ type, time: d.created_at, text });
      });

      // 上傳事件
      (gallery.data || []).forEach(g => {
        const typeLabel = g.type === 'story' ? '故事' : '照片';
        let type, text;
        if (g.status === 'pending') {
          type = 'upload';
          text = `<b>${maskName(g.customer_name || '會員')}</b> 上傳了${typeLabel}`;
        } else if (g.status === 'approved') {
          type = 'approve';
          text = `<b>${maskName(g.customer_name || '會員')}</b> 的${typeLabel}通過審核`;
        } else if (g.status === 'rejected') {
          type = 'reject';
          text = `<b>${maskName(g.customer_name || '會員')}</b> 的${typeLabel}被駁回`;
        } else {
          return;
        }
        events.push({ type, time: g.created_at, text });
      });

      // 創作者事件
      (creators.data || []).forEach(c => {
        if (c.status === 'active' && c.created_at) {
          events.push({
            type: 'upgrade',
            time: c.created_at,
            text: `<b>${maskName(c.display_name || '會員')}</b> 升級為 Creator`
          });
        }
      });

      events.sort((a, b) => new Date(b.time) - new Date(a.time));
      const top = events.slice(0, 5);

      if (top.length === 0) {
        list.innerHTML = '<p class="empty-text" style="text-align:center;padding:40px 0;color:var(--lohas-mute);font-size:12px">尚無活動紀錄</p>';
        return;
      }

      const iconMap = {
        upload: '<i class="fa-solid fa-upload"></i>',
        approve: '<i class="fa-solid fa-check"></i>',
        reject: '<i class="fa-solid fa-xmark"></i>',
        upgrade: '<i class="fa-solid fa-star"></i>'
      };

      list.innerHTML = top.map(e => `
        <div class="activity-item">
          <div class="activity-icon ${e.type === 'upgrade' ? 'upload' : e.type}">${iconMap[e.type] || iconMap.upload}</div>
          <div class="activity-body">
            <div class="activity-text">${e.text}</div>
            <div class="activity-time">${formatTime(e.time)}</div>
          </div>
        </div>`).join('');

    } catch (err) {
      console.error('[最近活動載入失敗]', err);
      list.innerHTML = `<p class="empty-text" style="text-align:center;padding:40px 0;color:var(--lohas-mute);font-size:12px">載入失敗: ${err.message || ''}</p>`;
    }
  }

  function formatTime(timestamp) {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    const diffH = (Date.now() - d) / 3600000;
    if (diffH < 1) return Math.max(1, Math.floor((Date.now() - d) / 60000)) + ' 分鐘前';
    if (diffH < 24) return Math.floor(diffH) + ' 小時前';
    const diffD = diffH / 24;
    if (diffD < 2) return '昨天';
    if (diffD < 7) return Math.floor(diffD) + ' 天前';
    return d.toISOString().slice(0, 10).replace(/-/g, '.');
  }


  /* =============================================================
     4. 會員列表
     ============================================================= */

  async function loadUsers() {
    const tbody = document.getElementById('usersTbody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--lohas-mute)">載入中...</td></tr>';

    try {
      const sb = getSb();

      // 1. 從 Supabase 多個表撈所有有資料的會員 ID
      const [creatorsRes, statusRes, adminsRes, postsRes] = await Promise.all([
        sb.from('creator_info').select('member_id, display_name, avatar_url, social_links, status'),
        sb.from('member_status').select('member_id, status'),
        sb.from('admins').select('member_id'),
        sb.from('gallery_posts').select('member_id')
      ]);

      State.creatorIds = new Set(
        (creatorsRes.data || []).filter(c => c.status === 'active').map(c => c.member_id)
      );
      State.suspendedIds = new Set(
        (statusRes.data || []).filter(s => s.status === 'suspended').map(s => s.member_id)
      );
      State.adminIds = new Set(
        (adminsRes.data || []).map(a => a.member_id)
      );

      // 統計每個會員的照片數
      const photoCount = {};
      (postsRes.data || []).forEach(p => {
        if (p.member_id) {
          photoCount[p.member_id] = (photoCount[p.member_id] || 0) + 1;
        }
      });

      // 蒐集所有 member_id (creator + status + admin + 上傳者)
      const allIds = new Set();
      (creatorsRes.data || []).forEach(c => c.member_id && allIds.add(c.member_id));
      (statusRes.data || []).forEach(s => s.member_id && allIds.add(s.member_id));
      (adminsRes.data || []).forEach(a => a.member_id && allIds.add(a.member_id));
      (postsRes.data || []).forEach(p => p.member_id && p.member_id !== 'OFFICIAL' && allIds.add(p.member_id));

      // 創作者 display_name 對應
      const creatorMap = {};
      (creatorsRes.data || []).forEach(c => {
        creatorMap[c.member_id] = c;
      });

      // 2. 整合 (對每個 id 從 creator_info 拿名字, 沒有的話顯示 ID)
      const merged = [...allIds].map(erpid => {
        const isAdmin = State.adminIds.has(erpid);
        const isCreator = State.creatorIds.has(erpid);
        const isSuspended = State.suspendedIds.has(erpid);
        const isVirt = erpid.startsWith('virt-');

        let role = 'member';
        if (isAdmin) role = 'admin';
        else if (isCreator) role = 'creator';
        if (isVirt) role = 'ip';  // virt- 創作者顯示成 ip/collab

        const photos = photoCount[erpid] || 0;
        const creatorInfo = creatorMap[erpid];
        const name = creatorInfo?.display_name || erpid;

        return {
          erpid,
          name,
          email: creatorInfo?.social_links?.email || '',
          mobile: '',
          avatar: name.slice(0, 1).toUpperCase(),
          avatar_url: creatorInfo?.avatar_url || '',
          role,
          status: isSuspended ? 'suspended' : 'active',
          uploads: photos > 0 ? `${photos} 張照片` : '—'
        };
      });

      State.users = merged;

      // 更新 KPI
      const total = merged.length;
      const creators = State.creatorIds.size;
      const official = merged.filter(u => u.erpid.startsWith('virt-')).length;
      const suspended = State.suspendedIds.size;

      const setKpi = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
      };
      setKpi('usersKpiTotal', total);
      setKpi('usersKpiTotalSub', `Member + Creator + Admin`);
      setKpi('usersKpiCreator', creators);
      setKpi('usersKpiCreatorSub', `含官方 ${official} 位`);
      setKpi('usersKpiOfficial', official);
      setKpi('usersKpiOfficialSub', `virt- 帳號`);
      setKpi('usersKpiSuspended', suspended);
      setKpi('usersKpiSuspendedSub', suspended === 0 ? '無' : '已停權');

      applyFilters();

    } catch (err) {
      console.error('[載入會員列表失敗]', err);
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--status-rejected)">載入失敗: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function rolePillHtml(role) {
    const map = {
      member: '<span class="row-role-pill member">Member</span>',
      creator: '<span class="row-role-pill creator"><i class="fa-solid fa-star"></i>Creator</span>',
      ip: '<span class="row-role-pill ip"><i class="fa-solid fa-crown"></i>Collab</span>',
      admin: '<span class="row-role-pill admin"><i class="fa-solid fa-shield-halved"></i>Admin</span>'
    };
    return map[role] || map.member;
  }

  function statusPillHtml(status) {
    if (status === 'suspended') {
      return '<span class="row-status suspended"><i class="fa-solid fa-ban"></i>已停權</span>';
    }
    return '<span class="row-status active"><i class="fa-solid fa-circle"></i>正常</span>';
  }

  function actionsHtml(user) {
    if (user.status === 'suspended') {
      return `
        <button data-act="view" data-erpid="${escapeHtml(user.erpid)}"><i class="fa-regular fa-eye"></i>查看</button>
        <button data-act="restore" data-erpid="${escapeHtml(user.erpid)}"><i class="fa-solid fa-rotate-left"></i>恢復</button>`;
    }
    if (user.role === 'member') {
      return `
        <button data-act="view" data-erpid="${escapeHtml(user.erpid)}"><i class="fa-regular fa-eye"></i>查看</button>
        <button class="promote" data-act="promote" data-erpid="${escapeHtml(user.erpid)}" data-name="${escapeHtml(user.name)}"><i class="fa-solid fa-star"></i>升級為 Creator</button>`;
    }
    return `
      <button data-act="view" data-erpid="${escapeHtml(user.erpid)}"><i class="fa-regular fa-eye"></i>查看</button>
      <button data-act="suspend" data-erpid="${escapeHtml(user.erpid)}" data-name="${escapeHtml(user.name)}"><i class="fa-regular fa-circle-pause"></i>停權</button>`;
  }

  // 分頁狀態
  const PAGE_SIZE = 5;
  let UsersDisplayCount = PAGE_SIZE;
  let UsersFiltered = [];

  function renderUsers(users) {
    const tbody = document.getElementById('usersTbody');
    if (!tbody) return;

    UsersFiltered = users || [];

    if (UsersFiltered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--lohas-mute)">查無會員</td></tr>';
      updateUsersKPI();
      return;
    }

    // 切片: 只顯示前 N 位 (PAGE_SIZE 倍數)
    const visible = UsersFiltered.slice(0, UsersDisplayCount);

    tbody.innerHTML = visible.map(u => {
      const meta = [];
      if (u.erpid) meta.push(u.erpid);
      if (u.email) meta.push(u.email);
      if (u.mobile) meta.push(u.mobile);
      const metaText = meta.join(' · ');

      return `
        <tr>
          <td>
            <div class="user-cell">
              <div class="user-avatar ${u.role}">${escapeHtml(u.avatar)}</div>
              <div>
                <div class="user-info-name">${escapeHtml(u.name)}</div>
                <div class="user-info-id">${escapeHtml(metaText)}</div>
              </div>
            </div>
          </td>
          <td>${rolePillHtml(u.role)}</td>
          <td>${statusPillHtml(u.status)}</td>
          <td>${escapeHtml(u.uploads)}</td>
          <td><div class="row-actions">${actionsHtml(u)}</div></td>
        </tr>`;
    }).join('');

    // 加「顯示更多」row
    const remaining = UsersFiltered.length - UsersDisplayCount;
    if (remaining > 0) {
      tbody.innerHTML += `
        <tr class="users-load-more-row">
          <td colspan="5" style="text-align:center;padding:18px;background:var(--lohas-soft)">
            <button class="btn-load-more" id="usersLoadMoreBtn" type="button">
              <i class="fa-solid fa-chevron-down"></i>
              <span>顯示更多 (還有 ${remaining} 位)</span>
            </button>
          </td>
        </tr>`;
      document.getElementById('usersLoadMoreBtn')?.addEventListener('click', () => {
        UsersDisplayCount += PAGE_SIZE;
        renderUsers(UsersFiltered);
      });
    } else if (UsersFiltered.length > PAGE_SIZE) {
      // 已全部顯示, 顯示「收合」按鈕
      tbody.innerHTML += `
        <tr class="users-load-more-row">
          <td colspan="5" style="text-align:center;padding:18px;background:var(--lohas-soft)">
            <button class="btn-load-more" id="usersCollapseBtn" type="button">
              <i class="fa-solid fa-chevron-up"></i>
              <span>收合到前 ${PAGE_SIZE} 位</span>
            </button>
          </td>
        </tr>`;
      document.getElementById('usersCollapseBtn')?.addEventListener('click', () => {
        UsersDisplayCount = PAGE_SIZE;
        renderUsers(UsersFiltered);
        // 滾回會員列表頂部
        document.querySelector('.content-page[data-page="users"]')?.scrollIntoView({ behavior: 'smooth' });
      });
    }

    tbody.querySelectorAll('button[data-act]').forEach(btn => {
      btn.addEventListener('click', () => {
        handleUserAction(btn.dataset.act, btn.dataset.erpid, btn.dataset.name);
      });
    });

    // 更新 KPI
    updateUsersKPI();
  }

  function updateUsersKPI() {
    const cards = root.querySelectorAll('.content-page[data-page="users"] .kpi-card .kpi-value');
    if (cards.length < 4) return;

    cards[0].textContent = State.users.length.toLocaleString(); // 總會員
    cards[1].textContent = State.creatorIds.size; // Creator 總數

    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
    // 本月升級的數字目前無法精準算 (需要看 creators.created_at), 顯示總數
    // TODO: 之後用 creators.created_at >= monthStart 算

    cards[3].textContent = State.suspendedIds.size; // 停權數
  }

  function applyFilters() {
    const q = (document.getElementById('userSearchInput')?.value || '').toLowerCase().trim();
    const roleFilter = document.getElementById('filterRole')?.value || '';
    const statusFilter = document.getElementById('filterStatus')?.value || '';

    let filtered = State.users;

    if (q) {
      filtered = filtered.filter(u =>
        (u.name || '').toLowerCase().includes(q) ||
        (u.erpid || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.mobile || '').toLowerCase().includes(q)
      );
    }
    if (roleFilter) filtered = filtered.filter(u => u.role === roleFilter);
    if (statusFilter) filtered = filtered.filter(u => u.status === statusFilter);

    // filter 變動時重置分頁回前 5 位
    UsersDisplayCount = PAGE_SIZE;
    renderUsers(filtered);
  }

  function bindUserFilters() {
    document.getElementById('userSearchInput')?.addEventListener('input', applyFilters);
    document.getElementById('filterRole')?.addEventListener('change', applyFilters);
    document.getElementById('filterStatus')?.addEventListener('change', applyFilters);
  }


  /* =============================================================
     5. 會員操作 (升級 / 停權 / 恢復)
     ============================================================= */

  async function handleUserAction(action, erpid, name) {
    if (action === 'promote') {
      await promoteToCreator(erpid, name);
    } else if (action === 'suspend') {
      await suspendUser(erpid, name);
    } else if (action === 'restore') {
      await restoreUser(erpid);
    } else if (action === 'view') {
      alert(`查看會員: ${erpid}\n\n(個人頁待開發)`);
    }
  }

  async function promoteToCreator(erpid, name) {
    if (!confirm(`確定將「${name}」升級為 Creator?\n\n升級後可以:\n· 上架刻圖設計\n· 享 $100/次 分潤\n· 編輯創作者個人頁`)) return;

    const sb = getSb();
    if (!sb) return alert('Supabase 連線失敗');

    try {
      const { error } = await sb.from('creator_info').upsert({
        member_id: erpid,
        display_name: name,
        status: 'active'
      }, { onConflict: 'member_id' });

      if (error) {
        console.error('[升級失敗]', error);
        alert('升級失敗: ' + error.message);
        return;
      }

      alert(`「${name}」已升級為 Creator`);
      loadUsers(); // 重新載入

    } catch (err) {
      alert('升級失敗: ' + err.message);
    }
  }

  async function suspendUser(erpid, name) {
    const reason = prompt(`停權「${name}」的原因:`);
    if (reason === null) return; // 取消
    if (!reason.trim()) return alert('請輸入停權原因');

    const sb = getSb();
    if (!sb) return;

    try {
      const { error } = await sb.from('member_status').upsert({
        member_id: erpid,
        status: 'suspended',
        reason: reason.trim(),
        suspended_at: new Date().toISOString(),
        suspended_by: State.member.erpid
      }, { onConflict: 'member_id' });

      if (error) return alert('停權失敗: ' + error.message);

      alert(`「${name}」已停權`);
      loadUsers();
    } catch (err) {
      alert('停權失敗: ' + err.message);
    }
  }

  async function restoreUser(erpid) {
    if (!confirm('確定恢復這個帳號?')) return;

    const sb = getSb();
    if (!sb) return;

    try {
      const { error } = await sb.from('member_status')
        .update({ status: 'active' })
        .eq('member_id', erpid);

      if (error) return alert('恢復失敗: ' + error.message);

      alert('已恢復');
      loadUsers();
    } catch (err) {
      alert('恢復失敗: ' + err.message);
    }
  }


  /* =============================================================
     6. 刻圖審核
     ============================================================= */

  async function loadDesignReview(statusFilter, sortOrder) {
    const grid = root.querySelector('.content-page[data-page="review-designs"] .review-grid');
    if (!grid) return;

    // 從 UI 抓篩選 (如果沒帶參數)
    const statusSelect = document.getElementById('reviewDesignsStatus');
    const sortSelect   = document.getElementById('reviewDesignsSort');
    const status = statusFilter || statusSelect?.value || 'pending';
    const sort   = sortOrder    || sortSelect?.value   || 'oldest';

    // 第一次載入時綁 listener
    if (statusSelect && !statusSelect._bound) {
      statusSelect._bound = true;
      statusSelect.addEventListener('change', () => loadDesignReview());
    }
    if (sortSelect && !sortSelect._bound) {
      sortSelect._bound = true;
      sortSelect.addEventListener('change', () => loadDesignReview());
    }

    grid.innerHTML = '<p class="empty-text" style="grid-column:1/-1;text-align:center;padding:60px;color:var(--lohas-mute)">載入中...</p>';

    const sb = getSb();
    if (!sb) return;

    try {
      const { data, error } = await sb
        .from('engraving_designs')
        .select('id, name, slogan, description, category, image_url, image_url_png, image_url_svg, type, creator_id, designer_name, reject_reason, reviewed_at, created_at')
        .eq('status', status)
        .order('created_at', { ascending: sort === 'oldest' });

      if (error) {
        grid.innerHTML = `<p class="empty-text" style="grid-column:1/-1">載入失敗: ${escapeHtml(error.message)}</p>`;
        return;
      }

      const designs = data || [];

      // 更新「共 N 件」資訊
      const infoEl = root.querySelector('#reviewDesignsFilterInfo');
      if (infoEl) {
        infoEl.innerHTML = designs.length > 0
          ? `顯示 <b>1-${designs.length}</b> 共 ${designs.length} 件`
          : '共 0 件';
      }

      if (designs.length === 0) {
        const emptyText = status === 'rejected'
          ? '目前沒有已駁回的設計'
          : '目前沒有待審核設計';
        grid.innerHTML = '<p class="empty-text" style="grid-column:1/-1;text-align:center;padding:60px;color:var(--lohas-mute)">' + emptyText + '</p>';
        return;
      }

      const grads = ['', 'g2', 'g3', 'g4', 'g5', 'g6'];
      const isRejectedView = status === 'rejected';

      grid.innerHTML = designs.map((d, i) => {
        const grad = grads[i % grads.length];
        const typeLabel = d.type === 'collab' ? '<i class="fa-solid fa-crown" style="color:#9D7E3F"></i>Collab'
          : d.type === 'creator' ? '<i class="fa-solid fa-star" style="color:#9D7E3F"></i>Creator'
          : 'Member';
        const rolePillCls = d.type === 'collab' ? 'ip' : d.type === 'creator' ? 'creator' : 'member';
        const rolePillContent = d.type === 'collab' ? '<i class="fa-solid fa-crown"></i>Collab'
          : d.type === 'creator' ? '<i class="fa-solid fa-star"></i>Creator'
          : 'Member';

        const imgStyle = d.image_url
          ? `style="background-image:url('${escapeHtml(d.image_url)}');background-size:cover;background-position:center"`
          : '';

        // 根據狀態切換按鈕
        const actions = isRejectedView
          ? `<div class="rcard-actions">
               <button class="approve" data-act="reopen" data-id="${d.id}">
                 <i class="fa-solid fa-rotate-left"></i>重 新 開 放
               </button>
               <button class="reject" data-act="delete" data-id="${d.id}" data-name="${escapeHtml(d.name)}"><i class="fa-solid fa-trash"></i>永 久 刪 除</button>
             </div>`
          : `<div class="rcard-actions">
               <button class="approve" data-act="approve"
                       data-id="${d.id}"
                       data-name="${escapeHtml(d.name)}"
                       data-category="${escapeHtml(d.category || '')}"
                       data-creator-id="${escapeHtml(d.creator_id || '')}">
                 <i class="fa-solid fa-pen-to-square"></i>開 始 審 核
               </button>
               <button class="reject" data-act="reject" data-id="${d.id}" data-name="${escapeHtml(d.name)}" data-by="${escapeHtml(d.creator_id)}"><i class="fa-solid fa-xmark"></i>駁 回</button>
             </div>`;

        // 駁回理由顯示
        const rejectInfo = isRejectedView && d.reject_reason
          ? `<div class="rcard-quote" style="color:#B05050;background:#FBEEEE;padding:6px 10px;border-radius:6px;margin-top:6px">
               <i class="fa-solid fa-circle-exclamation"></i> 駁回原因:${escapeHtml(d.reject_reason)}
             </div>`
          : '';

        return `
          <div class="rcard" data-id="${d.id}">
            <div class="rcard-img ${grad}" ${imgStyle}>
              <span class="rcard-pill">${typeLabel}</span>
            </div>
            <div class="rcard-info">
              <div class="rcard-title">${escapeHtml(d.name)}</div>
              <div class="rcard-by">by <b>${escapeHtml(d.creator_id)}</b> <span class="role-pill ${rolePillCls}">${rolePillContent}</span></div>
              ${d.description ? `<div class="rcard-quote">${escapeHtml(d.description)}</div>` : ''}
              ${rejectInfo}
              <div class="rcard-meta"><i class="fa-regular fa-clock"></i>${isRejectedView ? '駁回於 ' + formatTime(d.reviewed_at || d.created_at) : '送審 ' + formatTime(d.created_at)}</div>
              ${actions}
            </div>
          </div>`;
      }).join('');

      // 綁定 開始審核 / 駁回
      grid.querySelectorAll('[data-act="approve"]').forEach(b => {
        b.addEventListener('click', () => openApproveModal({
          id:        b.dataset.id,
          name:      b.dataset.name,
          category:  b.dataset.category,
          creatorId: b.dataset.creatorId,
        }));
      });
      grid.querySelectorAll('[data-act="reject"]').forEach(b => {
        b.addEventListener('click', () => openRejectModal('design', b.dataset.id, { name: b.dataset.name, by: b.dataset.by }));
      });
      // 駁回模式: 重新開放 / 永久刪除
      grid.querySelectorAll('[data-act="reopen"]').forEach(b => {
        b.addEventListener('click', async () => {
          if (!confirm('確定要把這筆刻圖重新開放審核?\n(狀態改回「待審核」,清空駁回原因)')) return;
          const sb = getSb();
          if (!sb) return;
          try {
            const { error } = await sb.from('engraving_designs')
              .update({ status: 'pending', reject_reason: null, reviewed_at: null, reviewed_by: null })
              .eq('id', b.dataset.id);
            if (error) throw error;
            loadDesignReview();
            refreshReviewCounts && refreshReviewCounts();
          } catch (err) {
            alert('重新開放失敗:' + err.message);
          }
        });
      });
      grid.querySelectorAll('[data-act="delete"]').forEach(b => {
        b.addEventListener('click', async () => {
          if (!confirm(`確定要永久刪除「${b.dataset.name}」?\n\n⚠️ 無法復原`)) return;
          const sb = getSb();
          if (!sb) return;
          try {
            const { error } = await sb.from('engraving_designs')
              .delete()
              .eq('id', b.dataset.id);
            if (error) throw error;
            loadDesignReview();
          } catch (err) {
            alert('刪除失敗:' + err.message);
          }
        });
      });

    } catch (err) {
      console.error('[刻圖審核載入失敗]', err);
    }
  }

  /* =============================================================
     刻圖審核 Modal - 填 erp_number + price + 編輯分類/名稱
     ============================================================= */
  function openApproveModal({ id, name, category, creatorId }) {
    const modal = document.getElementById('approveDesignModal');
    if (!modal) {
      alert('審核 Modal 未載入');
      return;
    }

    document.getElementById('apDesignId').value     = id || '';
    document.getElementById('apName').value         = name || '';
    document.getElementById('apCategory').value     = category || '';
    document.getElementById('apErpNumber').value    = '';
    document.getElementById('apPrice').value        = '';
    document.getElementById('apCreatorIdLabel').textContent = creatorId || '匿名';

    modal.hidden = false;
    setTimeout(() => document.getElementById('apErpNumber').focus(), 50);
  }

  function closeApproveModal() {
    const modal = document.getElementById('approveDesignModal');
    if (modal) modal.hidden = true;
  }

  async function submitApproval() {
    const id         = document.getElementById('apDesignId').value;
    const name       = document.getElementById('apName').value.trim();
    const category   = document.getElementById('apCategory').value.trim();
    const erpNumber  = document.getElementById('apErpNumber').value.trim();
    const priceRaw   = document.getElementById('apPrice').value.trim();

    if (!id) return alert('找不到設計 ID');
    if (!name) return alert('名稱不可為空');
    if (!erpNumber) return alert('請填寫 ErpNumber');
    if (!priceRaw) return alert('請填寫 Price');

    const price = parseFloat(priceRaw);
    if (isNaN(price) || price < 0) return alert('Price 必須是 >= 0 的數字');

    const submitBtn = document.getElementById('apSubmit');
    submitBtn.disabled = true;
    submitBtn.textContent = '送出中...';

    const sb = getSb();
    if (!sb) { submitBtn.disabled = false; submitBtn.textContent = '完成審核'; return; }

    try {
      const { error } = await sb.from('engraving_designs')
        .update({
          name:        name,
          category:    category || null,
          erp_number:  erpNumber,
          price:       price,
          is_show:     '上架',
          status:      'approved',
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (error) throw error;

      alert('已通過審核');
      closeApproveModal();
      loadDesignReview();
      loadDashboard();
      refreshReviewCounts?.();

    } catch (err) {
      console.error('[審核失敗]', err);
      alert('審核失敗: ' + err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '完成審核';
    }
  }

  // 綁 modal 內按鈕 (只綁一次)
  (function bindApproveModalOnce(){
    if (window.__approveModalBound) return;
    window.__approveModalBound = true;

    document.addEventListener('DOMContentLoaded', () => {
      document.getElementById('apSubmit')?.addEventListener('click', submitApproval);
      document.getElementById('apCancel')?.addEventListener('click', closeApproveModal);
      document.getElementById('apClose')?.addEventListener('click', closeApproveModal);
      document.getElementById('approveDesignModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'approveDesignModal') closeApproveModal();
      });
      // 售價快捷按鈕
      document.querySelectorAll('#approveDesignModal .md-quick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const p = btn.dataset.price;
          const input = document.getElementById('apPrice');
          if (input) {
            input.value = p;
            input.focus();
          }
        });
      });
    });
  })();


  /* =============================================================
     7. 照片 / 故事審核
     ============================================================= */

  async function loadPhotoReview(statusFilter) {
    return loadGalleryReview('photo', statusFilter);
  }

  async function loadStoryReview(statusFilter) {
    return loadGalleryReview('story', statusFilter);
  }

  /**
   * 合併版上傳審核 (#1) - 取代分開的 loadPhotoReview / loadStoryReview
   * 用 type filter (all/photo/story) + status filter (pending/approved/rejected)
   */
  async function loadReviewUploads(opts) {
    const page = root.querySelector(`.content-page[data-page="review-uploads"]`);
    if (!page) return;

    const grid = document.getElementById('reviewUploadsGrid');
    const subEl = document.getElementById('reviewUploadsSub');
    const statusSelect = document.getElementById('reviewUploadsStatus');
    const typeSelect = document.getElementById('reviewUploadsType');
    const refreshBtn = document.getElementById('reviewUploadsRefresh');

    // 第一次綁事件
    if (!page.dataset.bound) {
      page.dataset.bound = '1';
      statusSelect?.addEventListener('change', () => loadReviewUploads());
      typeSelect?.addEventListener('change', () => loadReviewUploads());
      refreshBtn?.addEventListener('click', () => loadReviewUploads());
    }

    const status = (opts && opts.status) || statusSelect?.value || 'pending';
    const typeF = (opts && opts.type) || typeSelect?.value || 'all';

    grid.innerHTML = '<p class="empty-text" style="grid-column:1/-1;text-align:center;padding:60px;color:var(--lohas-mute)">載入中...</p>';

    const sb = getSb();
    if (!sb) {
      grid.innerHTML = '<p class="empty-text" style="grid-column:1/-1">Supabase 未連線</p>';
      return;
    }

    try {
      let query = sb.from('gallery_posts')
        .select('id, title, topic, carrier, story, type, customer_name, member_id, image_urls, main_image_url, created_at, status')
        .eq('status', status);

      // 類型篩選
      if (typeF === 'photo') {
        // 只有照片 = type='photo' 或 type IS NULL (舊資料)
        query = query.or('type.eq.photo,type.is.null');
      } else if (typeF === 'story') {
        query = query.eq('type', 'story');
      }
      // typeF === 'all' 不篩

      query = query.order('created_at', { ascending: status === 'pending' });

      const { data, error } = await query;

      if (error) {
        grid.innerHTML = `<p class="empty-text" style="grid-column:1/-1">載入失敗: ${escapeHtml(error.message)}</p>`;
        return;
      }

      const posts = data || [];
      const statusLabel = status === 'pending' ? '待審核' : status === 'approved' ? '已通過' : '已駁回';
      const typeLabel = typeF === 'photo' ? '照片' : typeF === 'story' ? '故事' : '上傳';
      if (subEl) subEl.textContent = `${posts.length} 件${statusLabel} · ${typeLabel}`;

      if (posts.length === 0) {
        const emptyMsg = status === 'pending'
          ? `目前沒有待審核${typeLabel}`
          : `沒有${statusLabel}的${typeLabel}`;
        grid.innerHTML = `<p class="empty-text" style="grid-column:1/-1;text-align:center;padding:60px;color:var(--lohas-mute)">${emptyMsg}</p>`;
        return;
      }

      grid.innerHTML = posts.map(p => {
        const imgUrl = p.main_image_url || (p.image_urls && p.image_urls[0]) || '';
        const imgStyle = imgUrl
          ? `style="background-image:url('${escapeHtml(imgUrl)}');background-size:cover;background-position:center"`
          : '';
        const customerLabel = maskName(p.customer_name || '顧客');
        const meta = [p.topic, p.carrier].filter(Boolean).join(' · ');
        const isStory = p.type === 'story';

        let actionsHtml = '';
        if (status === 'pending') {
          actionsHtml = `
            <button class="approve" data-act="approve" data-id="${p.id}" data-type="${p.type || 'photo'}"><i class="fa-solid fa-check"></i>通 過</button>
            <button class="reject" data-act="reject" data-id="${p.id}" data-type="${p.type || 'photo'}" data-title="${escapeHtml(p.title || '')}" data-by="${escapeHtml(customerLabel)}"><i class="fa-solid fa-xmark"></i>駁 回</button>`;
        } else if (status === 'approved') {
          actionsHtml = `<button class="reject" data-act="revoke" data-id="${p.id}" data-type="${p.type || 'photo'}"><i class="fa-solid fa-undo"></i>取消通過</button>`;
        } else {
          actionsHtml = `<button class="approve" data-act="approve" data-id="${p.id}" data-type="${p.type || 'photo'}"><i class="fa-solid fa-check"></i>重新通過</button>`;
        }

        return `
          <div class="rcard" data-id="${p.id}">
            <div class="rcard-img" ${imgStyle}>
              <span class="rcard-pill">${isStory ? '<i class="fa-solid fa-book-open"></i>故事' : '<i class="fa-solid fa-camera"></i>照片'}</span>
              ${imgUrl ? '' : escapeHtml(p.title || '無圖')}
            </div>
            <div class="rcard-info">
              <div class="rcard-title">${escapeHtml(p.title || '未命名')}</div>
              <div class="rcard-by">by <b>${escapeHtml(customerLabel)}</b> <span class="role-pill member">Member</span></div>
              ${p.story ? `<div class="rcard-quote">${escapeHtml(p.story)}</div>` : ''}
              ${(status === 'rejected' && p.reject_reason) ? `<div class="rcard-quote" style="color:#B05050;background:#FBEEEE;padding:6px 10px;border-radius:6px;margin-top:6px"><i class="fa-solid fa-circle-exclamation"></i> 駁回原因:${escapeHtml(p.reject_reason)}</div>` : ''}
              <div class="rcard-meta">
                <i class="fa-regular fa-clock"></i>送審 ${formatTime(p.created_at)}
                ${meta ? ` · <i class="fa-regular fa-folder"></i> ${escapeHtml(meta)}` : ''}
              </div>
              <div class="rcard-actions">${actionsHtml}</div>
            </div>
          </div>`;
      }).join('');

      // 綁按鈕
      grid.querySelectorAll('[data-act="approve"]').forEach(b => {
        b.addEventListener('click', () => approveGalleryPost(b.dataset.id, b.dataset.type));
      });
      grid.querySelectorAll('[data-act="reject"]').forEach(b => {
        b.addEventListener('click', () => rejectGalleryPost(b.dataset.id, b.dataset.type, { title: b.dataset.title, by: b.dataset.by }));
      });
      grid.querySelectorAll('[data-act="revoke"]').forEach(b => {
        b.addEventListener('click', () => revokeGalleryPost(b.dataset.id, b.dataset.type));
      });

    } catch (err) {
      console.error(`[上傳審核載入失敗]`, err);
      grid.innerHTML = `<p class="empty-text" style="grid-column:1/-1">載入失敗: ${escapeHtml(err.message || err)}</p>`;
    }
  }

  async function loadGalleryReview(typeFilter, statusFilter) {
    const isStory = typeFilter === 'story';
    const pageKey = isStory ? 'review-stories' : 'review-photos';
    const tableLabel = isStory ? '故事' : '照片';
    const page = root.querySelector(`.content-page[data-page="${pageKey}"]`);
    if (!page) return;

    const grid = page.querySelector('.review-grid');
    const subEl = page.querySelector('.page-sub');
    const statusSelect = page.querySelector('select');
    const refreshBtn = page.querySelector(`#${isStory ? 'reviewStoriesRefresh' : 'reviewPhotosRefresh'}`);

    // 第一次載入時綁事件 (用 dataset 防重綁)
    if (!page.dataset.bound) {
      page.dataset.bound = '1';
      statusSelect?.addEventListener('change', () => loadGalleryReview(typeFilter, statusSelect.value));
      refreshBtn?.addEventListener('click', () => loadGalleryReview(typeFilter, statusSelect?.value));
    }

    const status = statusFilter || statusSelect?.value || 'pending';

    grid.innerHTML = '<p class="empty-text" style="grid-column:1/-1;text-align:center;padding:60px;color:var(--lohas-mute)">載入中...</p>';

    const sb = getSb();
    if (!sb) {
      grid.innerHTML = '<p class="empty-text" style="grid-column:1/-1">Supabase 未連線</p>';
      return;
    }

    try {
      const { data, error } = await sb
        .from('gallery_posts')
        .select('id, title, topic, carrier, story, type, customer_name, member_id, image_urls, main_image_url, created_at, status')
        .eq('type', typeFilter)
        .eq('status', status)
        .order('created_at', { ascending: status === 'pending' });

      if (error) {
        grid.innerHTML = `<p class="empty-text" style="grid-column:1/-1">載入失敗: ${escapeHtml(error.message)}</p>`;
        return;
      }

      const posts = data || [];
      const statusLabel = status === 'pending' ? '待審核' : status === 'approved' ? '已通過' : '已駁回';
      if (subEl) subEl.textContent = `${posts.length} 件${statusLabel} · ${tableLabel}`;

      if (posts.length === 0) {
        const emptyMsg = status === 'pending'
          ? `目前沒有待審核${tableLabel}`
          : `沒有${statusLabel}的${tableLabel}`;
        grid.innerHTML = `<p class="empty-text" style="grid-column:1/-1;text-align:center;padding:60px;color:var(--lohas-mute)">${emptyMsg}</p>`;
        return;
      }

      grid.innerHTML = posts.map(p => {
        const imgUrl = p.main_image_url || (p.image_urls && p.image_urls[0]) || '';
        const imgStyle = imgUrl
          ? `style="background-image:url('${escapeHtml(imgUrl)}');background-size:cover;background-position:center"`
          : '';
        const customerLabel = maskName(p.customer_name || '顧客');
        const meta = [p.topic, p.carrier].filter(Boolean).join(' · ');
        const isPending = p.status === 'pending';

        // 操作按鈕 (依狀態不同)
        let actionsHtml = '';
        if (status === 'pending') {
          actionsHtml = `
            <button class="approve" data-act="approve" data-id="${p.id}"><i class="fa-solid fa-check"></i>通 過</button>
            <button class="reject" data-act="reject" data-id="${p.id}" data-title="${escapeHtml(p.title || '')}" data-by="${escapeHtml(customerLabel)}"><i class="fa-solid fa-xmark"></i>駁 回</button>`;
        } else if (status === 'approved') {
          actionsHtml = `<button class="reject" data-act="revoke" data-id="${p.id}"><i class="fa-solid fa-undo"></i>取消通過</button>`;
        } else {
          actionsHtml = `<button class="approve" data-act="approve" data-id="${p.id}"><i class="fa-solid fa-check"></i>重新通過</button>`;
        }

        return `
          <div class="rcard" data-id="${p.id}">
            <div class="rcard-img" ${imgStyle}>
              <span class="rcard-pill">${isStory ? '<i class="fa-solid fa-book-open"></i>故事' : '<i class="fa-solid fa-camera"></i>照片'}</span>
              ${imgUrl ? '' : escapeHtml(p.title || '無圖')}
            </div>
            <div class="rcard-info">
              <div class="rcard-title">${escapeHtml(p.title || '未命名')}</div>
              <div class="rcard-by">by <b>${escapeHtml(customerLabel)}</b> <span class="role-pill member">Member</span></div>
              ${p.story ? `<div class="rcard-quote">${escapeHtml(p.story)}</div>` : ''}
              ${(status === 'rejected' && p.reject_reason) ? `<div class="rcard-quote" style="color:#B05050;background:#FBEEEE;padding:6px 10px;border-radius:6px;margin-top:6px"><i class="fa-solid fa-circle-exclamation"></i> 駁回原因:${escapeHtml(p.reject_reason)}</div>` : ''}
              <div class="rcard-meta">
                <i class="fa-regular fa-clock"></i>送審 ${formatTime(p.created_at)}
                ${meta ? ` · <i class="fa-regular fa-folder"></i> ${escapeHtml(meta)}` : ''}
              </div>
              <div class="rcard-actions">${actionsHtml}</div>
            </div>
          </div>`;
      }).join('');

      // 綁按鈕
      grid.querySelectorAll('[data-act="approve"]').forEach(b => {
        b.addEventListener('click', () => approveGalleryPost(b.dataset.id, typeFilter));
      });
      grid.querySelectorAll('[data-act="reject"]').forEach(b => {
        b.addEventListener('click', () => rejectGalleryPost(b.dataset.id, typeFilter, { title: b.dataset.title, by: b.dataset.by }));
      });
      grid.querySelectorAll('[data-act="revoke"]').forEach(b => {
        b.addEventListener('click', () => revokeGalleryPost(b.dataset.id, typeFilter));
      });

    } catch (err) {
      console.error(`[${tableLabel}審核載入失敗]`, err);
      grid.innerHTML = `<p class="empty-text" style="grid-column:1/-1">載入失敗: ${escapeHtml(err.message || err)}</p>`;
    }
  }

  async function approveGalleryPost(id, typeFilter) {
    if (!confirm('確定通過? 通過後將立即顯示在靈感牆')) return;
    const sb = getSb();
    if (!sb) return;

    const { error } = await sb.from('gallery_posts')
      .update({ status: 'approved' })
      .eq('id', id);

    if (error) return alert('通過失敗: ' + error.message);

    // 立刻從 DOM 移除這張卡
    removeReviewCardFromDOM(id);
    setTimeout(() => {
      loadReviewUploads();
      loadDashboard?.(); refreshReviewCounts?.();
    }, 250);
  }

  async function rejectGalleryPost(id, typeFilter, info) {
    // 改用公版 #rejectModal (跟 design 駁回一致)
    openRejectModal(typeFilter, id, { name: info.title, by: info.by });
  }

  async function revokeGalleryPost(id, typeFilter) {
    if (!confirm('取消通過? 此貼文將從靈感牆消失,變回待審核')) return;
    const sb = getSb();
    if (!sb) return;

    const { error } = await sb.from('gallery_posts')
      .update({ status: 'pending' })
      .eq('id', id);

    if (error) return alert('取消失敗: ' + error.message);

    removeReviewCardFromDOM(id);
    setTimeout(() => {
      loadReviewUploads();
      loadDashboard?.(); refreshReviewCounts?.();
    }, 250);
  }

  // 從 DOM 立刻移除卡片 (動畫消失) - 避免使用者按完按鈕還看到
  function removeReviewCardFromDOM(id) {
    const sels = [
      `.rcard[data-id="${id}"]`,
      `.review-item[data-id="${id}"]`
    ];
    sels.forEach(sel => {
      root.querySelectorAll(sel).forEach(el => {
        el.style.transition = 'opacity .2s, transform .2s';
        el.style.opacity = '0';
        el.style.transform = 'scale(0.95)';
        setTimeout(() => el.remove(), 200);
      });
    });
  }

  function maskName(name) {
    if (!name || name.length <= 1) return name;
    if (name.length === 2) return name[0] + '*';
    return name[0] + '*' + name.slice(-1);
  }

  async function quickApprove(type, id) {
    if (!confirm('快速通過?')) return;
    const sb = getSb();
    if (!sb) return;

    const tableMap = {
      design: 'engraving_designs',
      photo: 'gallery_posts',
      story: 'gallery_posts'
    };
    const table = tableMap[type];
    if (!table) return;

    const { error } = await sb.from(table)
      .update({ status: 'approved', reviewed_at: new Date().toISOString() })
      .eq('id', id);

    if (error) return alert('通過失敗: ' + error.message);
    alert('已通過');
    loadDashboard(); refreshReviewCounts?.();
  }


  /* =============================================================
     8. 駁回 modal (整合所有審核類型)
     ============================================================= */

  let currentRejectTarget = null;

  function openRejectModal(type, id, info) {
    currentRejectTarget = { type, id };
    const modal = document.getElementById('rejectModal');
    if (info) {
      modal.querySelector('.info-t').textContent = info.name || '';
      const typeLabel = { design: '創作者作品', photo: '會員照片', story: '會員故事' }[type] || '';
      modal.querySelector('.info-m').textContent = `by ${info.by || ''} · ${typeLabel}`;
    }
    document.getElementById('reasonText').value = '';
    document.querySelectorAll('.preset').forEach(x => x.classList.remove('on'));
    modal.classList.add('show');
  }

  function closeReject() {
    document.getElementById('rejectModal').classList.remove('show');
    currentRejectTarget = null;
  }

  async function confirmReject() {
    if (!currentRejectTarget) return;
    const reason = document.getElementById('reasonText').value.trim();
    if (!reason) return alert('請輸入駁回原因');

    const sb = getSb();
    if (!sb) return;

    // photo 跟 story 都寫到 gallery_posts
    const tableMap = {
      design: 'engraving_designs',
      photo: 'gallery_posts',
      story: 'gallery_posts'
    };
    const table = tableMap[currentRejectTarget.type];
    if (!table) return;

    const targetId = currentRejectTarget.id;
    const targetType = currentRejectTarget.type;

    const { error } = await sb.from(table)
      .update({
        status: 'rejected',
        reject_reason: reason,
        reviewed_at: new Date().toISOString()
      })
      .eq('id', targetId);

    if (error) return alert('駁回失敗: ' + error.message);

    // 立刻從 DOM 移除這張卡 (避免使用者覺得駁回沒反應)
    const cardSelectors = [
      `.rcard[data-id="${targetId}"]`,
      `.review-item[data-id="${targetId}"]`
    ];
    cardSelectors.forEach(sel => {
      root.querySelectorAll(sel).forEach(el => {
        el.style.transition = 'opacity .2s, transform .2s';
        el.style.opacity = '0';
        el.style.transform = 'scale(0.95)';
        setTimeout(() => el.remove(), 200);
      });
    });

    closeReject();

    // 後台重新整理 (補完整資料)
    setTimeout(() => {
      if (targetType === 'design') loadDesignReview();
      if (targetType === 'photo' || targetType === 'story') loadReviewUploads();
      loadDashboard(); refreshReviewCounts?.();
    }, 250);
  }


  /* =============================================================
     9. 最新消息 (CRUD)
     ============================================================= */

  async function loadNews() {
    const tbody = root.querySelector('.content-page[data-page="cm-news"] .news-table tbody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:40px">載入中...</td></tr>';

    const sb = getSb();
    if (!sb) return;

    try {
      const { data, error } = await sb
        .from('news')
        .select('id, title, category, status, published_at, scheduled_at, created_at')
        .order('created_at', { ascending: false });

      if (error) {
        tbody.innerHTML = `<tr><td colspan="5">載入失敗: ${escapeHtml(error.message)}</td></tr>`;
        return;
      }

      const items = data || [];

      // 更新「共 N 篇」
      const infoEl = root.querySelector('#newsFilterInfo');
      if (infoEl) infoEl.innerHTML = `共 <b>${items.length}</b> 篇`;
      const filterInfo = root.querySelector('.content-page[data-page="cm-news"] .filter-info b');
      if (filterInfo) filterInfo.textContent = items.length;

      if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--lohas-mute)">尚未建立任何消息</td></tr>';
        return;
      }

      const categoryLabels = {
        announcement: '系統公告',
        event: '活動優惠',
        creator: '創作者公告'
      };

      tbody.innerHTML = items.map(n => {
        const status = n.status;
        let statusHtml;
        if (status === 'published') {
          statusHtml = '<span class="news-status published"><i class="fa-solid fa-circle-check"></i>已發布</span>';
        } else if (status === 'scheduled') {
          const sd = n.scheduled_at ? new Date(n.scheduled_at).toLocaleDateString('zh-TW') : '';
          statusHtml = `<span class="news-status scheduled"><i class="fa-regular fa-clock"></i>已排程 ${sd}</span>`;
        } else {
          statusHtml = '<span class="news-status draft">草稿</span>';
        }

        const dateStr = n.published_at
          ? new Date(n.published_at).toLocaleDateString('zh-TW').replace(/\//g, '.')
          : '—';

        return `
          <tr>
            <td>${escapeHtml(n.title)}</td>
            <td>${escapeHtml(categoryLabels[n.category] || n.category)}</td>
            <td>${statusHtml}</td>
            <td>${dateStr}</td>
            <td>
              <div class="news-actions">
                <button data-act="edit-news" data-id="${n.id}" title="編輯"><i class="fa-regular fa-pen-to-square"></i></button>
                <button data-act="view-news" data-id="${n.id}" title="預覽"><i class="fa-regular fa-eye"></i></button>
                <button data-act="delete-news" data-id="${n.id}" title="刪除"><i class="fa-regular fa-trash-can"></i></button>
              </div>
            </td>
          </tr>`;
      }).join('');

      // 綁定按鈕
      tbody.querySelectorAll('[data-act="delete-news"]').forEach(btn => {
        btn.addEventListener('click', () => deleteNews(btn.dataset.id));
      });
      tbody.querySelectorAll('[data-act="edit-news"]').forEach(btn => {
        btn.addEventListener('click', () => alert('編輯消息 (待實作 modal)'));
      });
      tbody.querySelectorAll('[data-act="view-news"]').forEach(btn => {
        btn.addEventListener('click', () => alert('預覽消息 (待實作)'));
      });

    } catch (err) {
      console.error('[載入消息失敗]', err);
    }
  }

  async function deleteNews(id) {
    if (!confirm('確定刪除這則消息?')) return;
    const sb = getSb();
    if (!sb) return;
    const { error } = await sb.from('news').delete().eq('id', id);
    if (error) return alert('刪除失敗: ' + error.message);
    loadNews();
  }

  async function createNews() {
    const title = prompt('消息標題:');
    if (!title) return;
    const category = prompt('分類 (announcement / event / creator):', 'announcement');
    if (!category) return;

    const sb = getSb();
    if (!sb) return;

    const { error } = await sb.from('news').insert({
      title: title.trim(),
      category: category.trim(),
      status: 'draft',
      author_id: State.member.erpid
    });

    if (error) return alert('建立失敗: ' + error.message);
    alert('已建立草稿');
    loadNews();
  }


  /* =============================================================
     10. 審核 tabs / preset / Modal 操作
     ============================================================= */

  function bindReviewTabs() {
    root.querySelectorAll('.rtab').forEach(t => {
      t.addEventListener('click', () => {
        root.querySelectorAll('.rtab').forEach(x => x.classList.remove('on'));
        t.classList.add('on');
      });
    });
  }

  function bindRejectModal() {
    document.getElementById('cancelReject')?.addEventListener('click', closeReject);
    document.getElementById('closeRejectX')?.addEventListener('click', closeReject);
    document.getElementById('confirmReject')?.addEventListener('click', confirmReject);

    const modal = document.getElementById('rejectModal');
    // 點背景不關閉 (避免誤觸,只能點 X 或 ESC)

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && modal?.classList.contains('show')) closeReject();
    });

    document.querySelectorAll('.preset').forEach(p => {
      p.addEventListener('click', () => {
        document.querySelectorAll('.preset').forEach(x => x.classList.remove('on'));
        p.classList.add('on');
        document.getElementById('reasonText').value = p.dataset.text;
      });
    });
  }


  /* =============================================================
     11. 登出
     ============================================================= */

  function bindLogout() {
    document.getElementById('logout-btn')?.addEventListener('click', () => {
      if (!confirm('確定要登出?')) return;
      Auth.logout();
    });

    // 新增消息按鈕
    document.getElementById('btnCreateNews')?.addEventListener('click', createNews);
  }


  /* =============================================================
     12. Init
     ============================================================= */

  async function init() {
    const isAdmin = await verifyAdmin();
    if (!isAdmin) return;

    applyAdminUI();
    bindNav();
    bindReviewTabs();
    bindRejectModal();
    bindUserFilters();
    bindLogout();

    // 填入今天日期
    fillDashboardDate();

    // 漢堡選單
    bindMobileMenu();

    // 預設開 dashboard
    loadDashboard(); refreshReviewCounts?.();
  }

  function bindMobileMenu() {
    // 1. 從 sidebar 動態複製 nav 結構到 drawer-body
    syncDrawerFromSidebar();

    // 2. 綁開關
    const burger = document.getElementById('adMobileBurger');
    const closeBtn = document.getElementById('adDrawerClose');
    const overlay = document.getElementById('adDrawerOverlay');
    const drawer = document.getElementById('adDrawer');

    if (burger && drawer && overlay) {
      burger.addEventListener('click', () => {
        drawer.classList.add('is-open');
        overlay.classList.add('is-open');
        document.body.style.overflow = 'hidden';
      });
      const closeIt = () => {
        drawer.classList.remove('is-open');
        overlay.classList.remove('is-open');
        document.body.style.overflow = '';
      };
      closeBtn?.addEventListener('click', closeIt);
      overlay.addEventListener('click', closeIt);

      // 點 drawer 內 nav 也關
      drawer.querySelectorAll('.drawer-item[data-page]').forEach(item => {
        item.addEventListener('click', () => {
          goTo(item.dataset.page);
          closeIt();
        });
      });
    }
  }

  // 把 sidebar 的 nav-section 動態 mirror 到 drawer-body
  function syncDrawerFromSidebar() {
    const drawerBody = document.getElementById('adDrawerBody');
    const sidebar = root.querySelector('.sidebar');
    if (!drawerBody || !sidebar) return;

    let html = '';
    sidebar.querySelectorAll('.nav-section').forEach(sec => {
      const label = sec.querySelector('.nav-section-label')?.textContent?.trim() || '';
      let groupHtml = `<div class="drawer-group">`;
      if (label) groupHtml += `<div class="drawer-group-label">${escapeHtml(label)}</div>`;

      sec.querySelectorAll('.nav-link[data-page]').forEach(link => {
        const page = link.dataset.page;
        const isOn = link.classList.contains('on');
        const iconEl = link.querySelector('i');
        const iconCls = iconEl?.className || 'fa-regular fa-circle';
        const text = link.querySelector('span')?.textContent?.trim() || '';
        const badge = link.querySelector('.badge');
        const badgeHtml = badge
          ? `<span class="drawer-badge" data-page-badge="${page}" data-count="${badge.textContent || '0'}">${escapeHtml(badge.textContent || '0')}</span>`
          : '';

        groupHtml += `
          <button class="drawer-item ${isOn ? 'on' : ''}" data-page="${page}">
            <i class="${iconCls}"></i>
            <span>${escapeHtml(text)}</span>
            ${badgeHtml}
            <i class="fa-solid fa-chevron-right drawer-arrow"></i>
          </button>`;
      });

      groupHtml += '</div>';
      html += groupHtml;
    });

    // 加最後一組: 登出
    html += `
      <div class="drawer-group">
        <button class="drawer-item drawer-logout" data-action="logout">
          <i class="fa-solid fa-arrow-right-from-bracket"></i>
          <span>登出</span>
          <i class="fa-solid fa-chevron-right drawer-arrow"></i>
        </button>
      </div>`;

    drawerBody.innerHTML = html;

    // 綁登出事件
    drawerBody.querySelector('[data-action="logout"]')?.addEventListener('click', () => {
      if (!confirm('確定要登出?')) return;
      if (window.LohasAuth?.logout) window.LohasAuth.logout();
      window.location.href = 'index.html';
    });
  }

  // 同步 active 狀態 (goTo 時呼叫)
  function syncDrawerActive(page) {
    const drawer = document.getElementById('adDrawer');
    if (!drawer) return;
    drawer.querySelectorAll('.drawer-item').forEach(item => {
      item.classList.toggle('on', item.dataset.page === page);
    });
  }

  // 同步 badge 數字 (refreshReviewCounts 後呼叫)
  function syncDrawerBadge(page, count) {
    const el = document.querySelector(`[data-page-badge="${page}"]`);
    if (!el) return;
    el.textContent = String(count);
    el.dataset.count = String(count);
  }

  function fillDashboardDate() {
    const el = document.getElementById('dashboardDate');
    if (!el) return;
    const now = new Date();
    const weekdays = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];
    el.textContent = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 · ${weekdays[now.getDay()]}`;
  }

  document.addEventListener('DOMContentLoaded', init);


  /* =============================================================
     Export
     ============================================================= */

  window.LohasAdmin = {
    State,
    goTo,
    loadUsers,
    loadDashboard,
    loadDesignReview,
    loadNews,
    promoteToCreator,
    suspendUser,
    restoreUser,
    createNews,
    applyFilters,
    initAdminUpload,
    loadAdminUploadHistory,
    initGrantCreator
  };


  /* =============================================================
     #4 樂活官方上傳照片 (用靈感牆 3-slot 模組 + Supabase Storage)
     ============================================================= */

  const AdminUploadState = {
    images: [null, null, null],   // base64 預覽
    files: [null, null, null]     // 真檔
  };

  function initAdminUpload() {
    const submitBtn = document.getElementById('adminUploadSubmit');
    const resetBtn = document.getElementById('adminUploadReset');
    const fileInput = document.getElementById('adminUploadFileInput');
    const boxes = root.querySelectorAll('[data-admin-slot]');

    if (submitBtn && !submitBtn.dataset.bound) {
      submitBtn.dataset.bound = '1';
      submitBtn.addEventListener('click', adminUploadSubmit);
    }
    if (resetBtn && !resetBtn.dataset.bound) {
      resetBtn.dataset.bound = '1';
      resetBtn.addEventListener('click', adminUploadReset);
    }

    let activeSlot = null;

    boxes.forEach(box => {
      if (box.dataset.bound) return;
      box.dataset.bound = '1';
      box.addEventListener('click', () => {
        activeSlot = parseInt(box.dataset.adminSlot);
        fileInput?.click();
      });
    });

    if (fileInput && !fileInput.dataset.bound) {
      fileInput.dataset.bound = '1';
      fileInput.addEventListener('change', async e => {
        const file = e.target.files?.[0];
        if (!file || activeSlot === null) return;

        // 開裁切 (1:1 跟靈感牆統一)
        let finalFile = file;
        if (window.LohasCropper) {
          const cropped = await window.LohasCropper.crop(file, {
            aspectRatio: 1,
            title: '裁切照片 · 1:1'
          });
          if (!cropped) {
            // 使用者取消
            fileInput.value = '';
            return;
          }
          finalFile = cropped;
        }

        const reader = new FileReader();
        reader.onload = ev => {
          AdminUploadState.images[activeSlot] = ev.target.result;
          AdminUploadState.files[activeSlot] = finalFile;
          renderAdminUploadSlot(activeSlot);
        };
        reader.readAsDataURL(finalFile);
        fileInput.value = '';
      });
    }
  }

  function renderAdminUploadSlot(slot) {
    const box = root.querySelector(`[data-admin-slot="${slot}"]`);
    if (!box) return;
    const dataUrl = AdminUploadState.images[slot];
    if (!dataUrl) return;

    box.classList.add('has-image');
    box.style.backgroundImage = `url('${dataUrl}')`;
    box.style.backgroundSize = 'cover';
    box.style.backgroundPosition = 'center';
    // 替換內容為「移除」按鈕
    box.innerHTML = `
      ${slot === 0 ? '<span class="badge-main">首圖</span>' : ''}
      <button type="button" class="upload-remove-btn" data-remove-slot="${slot}" title="移除">
        <i class="fa-solid fa-xmark"></i>
      </button>`;

    box.querySelector('.upload-remove-btn')?.addEventListener('click', e => {
      e.stopPropagation();
      AdminUploadState.images[slot] = null;
      AdminUploadState.files[slot] = null;
      box.classList.remove('has-image');
      box.style.backgroundImage = '';
      const isMain = slot === 0;
      box.innerHTML = `
        ${isMain ? '<span class="badge-main">首圖</span>' : ''}
        <div class="upload-placeholder">
          <i class="fa-regular fa-image"></i>
          <p>${isMain ? '上傳首圖' : '上傳圖片'}</p>
          <span class="upload-hint">${isMain ? '點擊或拖曳圖片到這裡' : (slot === 1 ? '副圖二（選填）' : '副圖三（選填）')}</span>
        </div>`;
    });
  }

  function adminUploadReset() {
    ['adminUploadTitle', 'adminUploadStory'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.getElementById('adminUploadName').value = 'LOHAS 企劃部';
    document.getElementById('adminUploadTopic').selectedIndex = 0;
    document.getElementById('adminUploadCarrier').selectedIndex = 0;
    document.getElementById('adminUploadHint').textContent = '';

    AdminUploadState.images = [null, null, null];
    AdminUploadState.files = [null, null, null];

    // 重置 3 個 slot 視覺
    [0, 1, 2].forEach(slot => {
      const box = root.querySelector(`[data-admin-slot="${slot}"]`);
      if (!box) return;
      box.classList.remove('has-image');
      box.style.backgroundImage = '';
      const isMain = slot === 0;
      box.innerHTML = `
        ${isMain ? '<span class="badge-main">首圖</span>' : ''}
        <div class="upload-placeholder">
          <i class="fa-regular fa-image"></i>
          <p>${isMain ? '上傳首圖' : '上傳圖片'}</p>
          <span class="upload-hint">${isMain ? '點擊或拖曳圖片到這裡' : (slot === 1 ? '副圖二（選填）' : '副圖三（選填）')}</span>
        </div>`;
    });
  }

  async function adminUploadSubmit() {
    const sb = getSb();
    if (!sb) return alert('Supabase 未連線');

    const customer_name = document.getElementById('adminUploadName').value.trim() || 'LOHAS 企劃部';
    const title = document.getElementById('adminUploadTitle').value.trim();
    const topic = document.getElementById('adminUploadTopic').value;
    const carrier = document.getElementById('adminUploadCarrier').value;
    const story = document.getElementById('adminUploadStory').value.trim();
    const hint = document.getElementById('adminUploadHint');

    if (!title) {
      hint.style.color = 'var(--status-rejected)';
      hint.textContent = '請填寫標題';
      return;
    }

    const files = AdminUploadState.files.filter(Boolean);
    if (files.length === 0) {
      hint.style.color = 'var(--status-rejected)';
      hint.textContent = '請至少上傳一張圖片';
      return;
    }

    hint.style.color = 'var(--lohas-mute)';
    hint.textContent = '上傳圖片中...';

    try {
      const SUPABASE_BUCKET = window.LohasSupabase?.CONFIG?.STORAGE_BUCKET || 'gallery-uploads';
      const uploadedUrls = [];

      for (const file of files) {
        const ext = getExt(file);
        const filePath = `public/${Date.now()}-${crypto.randomUUID()}.${ext}`;

        const { error: uploadError } = await sb.storage
          .from(SUPABASE_BUCKET)
          .upload(filePath, file, { cacheControl: '3600', upsert: false });

        if (uploadError) throw uploadError;

        const { data } = sb.storage.from(SUPABASE_BUCKET).getPublicUrl(filePath);
        uploadedUrls.push(data.publicUrl);
      }

      // 寫入 gallery_posts
      const type = story.length >= 50 ? 'story' : 'photo';
      const payload = {
        title,
        topic: topic || null,
        carrier: carrier || null,
        story: story || null,
        type,
        customer_name,
        member_id: 'OFFICIAL',     // 官方標記 (gallery_posts.member_id NOT NULL)
        image_urls: uploadedUrls,
        main_image_url: uploadedUrls[0],
        status: 'approved'
      };

      hint.textContent = '寫入資料庫中...';

      const { error: insertError } = await sb.from('gallery_posts').insert(payload);
      if (insertError) throw insertError;

      hint.style.color = 'var(--status-approved)';
      hint.textContent = `✓ 已上傳並自動通過 (${uploadedUrls.length} 張圖片 · 類型: ${type === 'story' ? '故事' : '照片'})`;

      adminUploadReset();
      loadAdminUploadHistory();

    } catch (err) {
      hint.style.color = 'var(--status-rejected)';
      hint.textContent = '上傳失敗: ' + (err.message || err);
      console.error('[官方上傳失敗]', err);
    }
  }

  async function loadAdminUploadHistory() {
    const sb = getSb();
    const list = document.getElementById('adminUploadHistory');
    if (!sb || !list) return;

    list.innerHTML = '<p class="empty-text">載入中...</p>';

    const { data, error } = await sb
      .from('gallery_posts')
      .select('id, title, customer_name, type, main_image_url, image_urls, created_at')
      .eq('member_id', 'OFFICIAL')
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) {
      list.innerHTML = `<p class="empty-text">載入失敗: ${escapeHtml(error.message)}</p>`;
      return;
    }

    if (!data || data.length === 0) {
      list.innerHTML = '<p class="empty-text" style="text-align:center;padding:30px 0;color:var(--lohas-mute)">尚無官方上傳紀錄</p>';
      return;
    }

    list.innerHTML = data.map(p => {
      const img = p.main_image_url || (p.image_urls && p.image_urls[0]) || '';
      const imgStyle = img ? `style="background-image:url('${escapeHtml(img)}')"` : '';
      const typeLabel = p.type === 'story' ? '故事' : '照片';
      return `
        <div class="admin-upload-row">
          <div class="admin-upload-thumb" ${imgStyle}></div>
          <div class="admin-upload-info">
            <div class="admin-upload-title">${escapeHtml(p.title || '未命名')}</div>
            <div class="admin-upload-meta">
              <i class="fa-regular fa-clock"></i> ${formatTime(p.created_at)}
              · ${typeLabel}
              · 由 ${escapeHtml(p.customer_name || '官方')} 上傳
            </div>
          </div>
        </div>`;
    }).join('');
  }


  /* =============================================================
     #3 新增創作者個人頁 (整套 copy 自會員平台 creator-page)
        - 介面跟會員平台 creator-page 一樣 (頭像/名稱/標籤/簡介/緣分/影片/聯絡)
        - 不綁會員: 用虛擬 member_id (virt-...) 占位
        - 預設名稱 LOHAS 企劃部
        - 可重複新增, 儲存後表單清空
     ============================================================= */

  const AGState = {
    avatarBase64: null,         // 頭像預覽 (base64)
    avatarFile: null,           // 頭像檔
    joiningPhotoBase64: null,   // 緣分照片預覽
    joiningPhotoFile: null,     // 緣分照片檔
    editMemberId: null,         // 編輯模式: 既有的 member_id
    existingAvatarUrl: null,    // 編輯模式: 原有頭像 URL (沒換才用)
    existingJoiningPhotoUrl: null  // 編輯模式: 原有緣分照片 URL
  };

  function initGrantCreator() {
    const saveBtn = document.getElementById('agSaveBtn');
    const resetBtn = document.getElementById('agResetBtn');

    // 頭像上傳
    const avatarBtn = document.getElementById('agAvatarUploadBtn');
    const avatarInput = document.getElementById('agAvatarInput');

    if (avatarBtn && !avatarBtn.dataset.bound) {
      avatarBtn.dataset.bound = '1';
      avatarBtn.addEventListener('click', () => avatarInput?.click());
    }
    if (avatarInput && !avatarInput.dataset.bound) {
      avatarInput.dataset.bound = '1';
      avatarInput.addEventListener('change', async e => {
        const file = e.target.files?.[0];
        if (!file) return;

        // 1:1 裁切
        let finalFile = file;
        if (window.LohasCropper) {
          const cropped = await window.LohasCropper.crop(file, {
            aspectRatio: 1,
            title: '裁切頭像 · 1:1'
          });
          if (!cropped) { avatarInput.value = ''; return; }
          finalFile = cropped;
        }

        AGState.avatarFile = finalFile;
        const reader = new FileReader();
        reader.onload = ev => {
          AGState.avatarBase64 = ev.target.result;
          const ed = document.getElementById('agAvatar');
          if (ed) ed.innerHTML = `<img src="${ev.target.result}" alt="">`;
        };
        reader.readAsDataURL(finalFile);
        avatarInput.value = '';
      });
    }

    // 緣分照片上傳
    const joiningBtn = document.getElementById('agJoiningPhotoBtn');
    const joiningInput = document.getElementById('agJoiningPhotoInput');

    if (joiningBtn && !joiningBtn.dataset.bound) {
      joiningBtn.dataset.bound = '1';
      joiningBtn.addEventListener('click', () => joiningInput?.click());
    }
    if (joiningInput && !joiningInput.dataset.bound) {
      joiningInput.dataset.bound = '1';
      joiningInput.addEventListener('change', async e => {
        const file = e.target.files?.[0];
        if (!file) return;

        // 3:4 裁切
        let finalFile = file;
        if (window.LohasCropper) {
          const cropped = await window.LohasCropper.crop(file, {
            aspectRatio: 3 / 4,
            title: '裁切緣分照片 · 3:4 直式'
          });
          if (!cropped) { joiningInput.value = ''; return; }
          finalFile = cropped;
        }

        AGState.joiningPhotoFile = finalFile;
        const reader = new FileReader();
        reader.onload = ev => {
          AGState.joiningPhotoBase64 = ev.target.result;
          const preview = document.getElementById('agJoiningPhotoPreview');
          if (preview) {
            preview.style.backgroundImage = `url('${ev.target.result}')`;
            preview.classList.add('has-image');
          }
          // 顯示 ✕ 按鈕
          const clearBtn = document.getElementById('agJoiningPhotoClear');
          if (clearBtn) clearBtn.style.display = 'flex';
        };
        reader.readAsDataURL(finalFile);
        joiningInput.value = '';
      });
    }

    // 緣分照片預覽框點擊也觸發上傳
    const joiningPreview = document.getElementById('agJoiningPhotoPreview');
    if (joiningPreview && !joiningPreview.dataset.bound) {
      joiningPreview.dataset.bound = '1';
      joiningPreview.addEventListener('click', () => joiningInput?.click());
    }

    // 緣分照片 ✕ 移除按鈕
    const joiningClear = document.getElementById('agJoiningPhotoClear');
    if (joiningClear && !joiningClear.dataset.bound) {
      joiningClear.dataset.bound = '1';
      joiningClear.addEventListener('click', e => {
        e.stopPropagation();
        AGState.joiningPhotoFile = null;
        AGState.joiningPhotoBase64 = null;
        AGState.existingJoiningPhotoUrl = null;  // 清掉編輯模式的原圖
        const preview = document.getElementById('agJoiningPhotoPreview');
        if (preview) {
          preview.style.backgroundImage = '';
          preview.classList.remove('has-image');
        }
        joiningClear.style.display = 'none';
        if (joiningInput) joiningInput.value = '';
      });
    }

    // 顯示名稱變動時更新頭像 fallback initials
    const displayName = document.getElementById('agDisplayName');
    if (displayName && !displayName.dataset.bound) {
      displayName.dataset.bound = '1';
      displayName.addEventListener('input', () => {
        if (!AGState.avatarBase64) {
          const ed = document.getElementById('agAvatar');
          if (ed) ed.textContent = (displayName.value.trim().slice(0, 2) || 'LO').toUpperCase();
        }
      });
    }

    if (saveBtn && !saveBtn.dataset.bound) {
      saveBtn.dataset.bound = '1';
      saveBtn.addEventListener('click', agSubmit);
    }
    if (resetBtn && !resetBtn.dataset.bound) {
      resetBtn.dataset.bound = '1';
      resetBtn.addEventListener('click', agReset);
    }

    // 自訂區塊「新增區塊」按鈕
    const addCbBtn = document.getElementById('agAddCustomBlockBtn');
    if (addCbBtn && !addCbBtn.dataset.bound) {
      addCbBtn.dataset.bound = '1';
      addCbBtn.addEventListener('click', agAddCustomBlock);
    }

    // 第一次 init 時更新 fallback
    if (displayName) {
      const ed = document.getElementById('agAvatar');
      if (ed && !AGState.avatarBase64) {
        ed.textContent = (displayName.value.trim().slice(0, 2) || 'LO').toUpperCase();
      }
    }
  }

  function agReset() {
    document.getElementById('agDisplayName').value = 'LOHAS 企劃部';
    ['agTagline','agBio','agJoiningStory','agVideoUrl','agVideoTitle','agIg','agFb','agLine','agEmail'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.getElementById('agJoiningPhoto').value = '';

    // 重置頭像
    AGState.avatarBase64 = null;
    AGState.avatarFile = null;
    AGState.editMemberId = null;
    AGState.existingAvatarUrl = null;
    AGState.existingJoiningPhotoUrl = null;
    const ed = document.getElementById('agAvatar');
    if (ed) ed.textContent = 'LO';

    // 重置緣分照片
    AGState.joiningPhotoBase64 = null;
    AGState.joiningPhotoFile = null;
    const preview = document.getElementById('agJoiningPhotoPreview');
    if (preview) {
      preview.style.backgroundImage = '';
      preview.classList.remove('has-image');
    }
    const joiningClear = document.getElementById('agJoiningPhotoClear');
    if (joiningClear) joiningClear.style.display = 'none';

    document.getElementById('agAvatarInput').value = '';
    document.getElementById('agJoiningPhotoInput').value = '';

    // 清自訂區塊
    const cbList = document.getElementById('agCustomBlocksList');
    if (cbList) {
      cbList.innerHTML = '<p class="empty-text" style="padding:30px 20px;font-size:12px">點上方「新增區塊」加入自訂的圖文段落</p>';
    }

    // 還原 Modal 標題 (編輯/新增切換)
    const modalTitle = document.getElementById('agModalTitle');
    if (modalTitle) modalTitle.textContent = '新增創作者個人頁';

    const saveBtn = document.getElementById('agSaveBtn');
    if (saveBtn) saveBtn.innerHTML = '<i class="fa-solid fa-user-plus"></i><span>建立創作者</span>';

    const hint = document.getElementById('agHint');
    if (hint) hint.textContent = '';
  }

  async function agSubmit() {
    const sb = getSb();
    if (!sb) return alert('Supabase 未連線');

    const display_name = document.getElementById('agDisplayName').value.trim();
    const tagline = document.getElementById('agTagline').value.trim();
    const bio = document.getElementById('agBio').value.trim();
    const joining_story = document.getElementById('agJoiningStory').value.trim();
    const video_url = document.getElementById('agVideoUrl').value.trim();
    const video_title = document.getElementById('agVideoTitle').value.trim();
    const ig = document.getElementById('agIg').value.trim();
    const fb = document.getElementById('agFb').value.trim();
    const line = document.getElementById('agLine').value.trim();
    const email = document.getElementById('agEmail').value.trim();

    const hint = document.getElementById('agHint');

    if (!display_name) {
      hint.style.color = 'var(--status-rejected)';
      hint.textContent = '請填寫顯示名稱';
      return;
    }

    const isEdit = !!AGState.editMemberId;
    const confirmMsg = isEdit
      ? `確定要儲存對「${display_name}」的變更?`
      : `確定建立創作者「${display_name}」?`;
    if (!confirm(confirmMsg)) return;

    hint.style.color = 'var(--lohas-mute)';
    hint.textContent = '處理中...';

    try {
      const SUPABASE_BUCKET = window.LohasSupabase?.CONFIG?.STORAGE_BUCKET || 'gallery-uploads';
      let avatar_url = AGState.existingAvatarUrl || null;          // 編輯模式: 沒換則保留
      let joining_photo_url = AGState.existingJoiningPhotoUrl || null;

      // 上傳頭像 (有新檔才上傳)
      if (AGState.avatarFile) {
        hint.textContent = '上傳頭像中...';
        const ext = getExt(AGState.avatarFile);
        const filePath = `creator-avatars/${Date.now()}-${crypto.randomUUID()}.${ext}`;
        const { error } = await sb.storage.from(SUPABASE_BUCKET).upload(filePath, AGState.avatarFile, { cacheControl: '3600', upsert: false });
        if (error) throw error;
        const { data } = sb.storage.from(SUPABASE_BUCKET).getPublicUrl(filePath);
        avatar_url = data.publicUrl;
      }

      // 上傳緣分照片 (有新檔才上傳)
      if (AGState.joiningPhotoFile) {
        hint.textContent = '上傳緣分照片中...';
        const ext = getExt(AGState.joiningPhotoFile);
        const filePath = `creator-joining/${Date.now()}-${crypto.randomUUID()}.${ext}`;
        const { error } = await sb.storage.from(SUPABASE_BUCKET).upload(filePath, AGState.joiningPhotoFile, { cacheControl: '3600', upsert: false });
        if (error) throw error;
        const { data } = sb.storage.from(SUPABASE_BUCKET).getPublicUrl(filePath);
        joining_photo_url = data.publicUrl;
      }

      // 對齊會員平台 saveCreatorInfo 的欄位 (social_links 是 JSONB)
      const social_links = {};
      if (ig) social_links.instagram = ig;
      if (fb) social_links.facebook = fb;
      if (line) social_links.line = line;
      if (email) social_links.email = email;

      // 收集自訂區塊 (內含上傳圖片到 Storage)
      hint.textContent = '處理自訂區塊圖片...';
      const customBlocks = await agCollectCustomBlocks(sb, SUPABASE_BUCKET);

      const memberId = isEdit ? AGState.editMemberId : ('virt-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8));

      const payload = {
        display_name,
        tagline: tagline || null,
        bio: bio || null,
        avatar_url: avatar_url,
        joining_photo_url: joining_photo_url,
        joining_story: joining_story || null,
        video_url: video_url || null,
        video_title: video_title || null,
        social_links: social_links,
        custom_blocks: customBlocks,
        status: 'active'
      };

      hint.textContent = '寫入資料庫中...';

      let error;
      if (isEdit) {
        // 編輯模式: UPDATE
        const res = await sb.from('creator_info')
          .update(payload)
          .eq('member_id', AGState.editMemberId);
        error = res.error;
      } else {
        // 新建模式: INSERT (補 member_id)
        payload.member_id = memberId;
        const res = await sb.from('creator_info').insert(payload);
        error = res.error;
      }

      if (error) {
        hint.style.color = 'var(--status-rejected)';
        hint.textContent = (isEdit ? '儲存失敗: ' : '建立失敗: ') + error.message;
        console.error('[建立/編輯創作者失敗]', error);
        return;
      }

      // 用 memberId (新建) 或 AGState.editMemberId (編輯)
      const finalId = isEdit ? AGState.editMemberId : memberId;

      hint.style.color = 'var(--status-approved)';
      // 顯示成功訊息 + 創作者網址
      const creatorUrl = `${window.location.origin}${window.location.pathname.replace('admin-portal.html', 'creator-public.html')}?id=${finalId}`;
      const successPrefix = isEdit ? '✓ 已儲存「' : '✓ 已建立創作者「';

      // 跳出 alert 提示 (手機 alert 太長會卡, 用簡短版)
      const alertMsg = isEdit
        ? `已儲存對「${display_name}」的變更`
        : `已建立創作者「${display_name}」\n\n網址已顯示在下方,可複製或開啟`;
      alert(alertMsg);
      hint.innerHTML = `
        ${successPrefix}<b>${escapeHtml(display_name)}</b>」<br>
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
          <div class="ag-success-hint">創作者 ID: <code>${escapeHtml(finalId)}</code></div>
        </div>`;

      // 綁定「複製」按鈕
      hint.querySelector('.ag-copy-btn[data-url]')?.addEventListener('click', function() {
        const url = this.dataset.url;
        navigator.clipboard?.writeText(url).then(() => {
          const orig = this.innerHTML;
          this.innerHTML = '<i class="fa-solid fa-check"></i>已複製';
          setTimeout(() => { this.innerHTML = orig; }, 2000);
        }).catch(() => {
          // fallback
          const ta = document.createElement('textarea');
          ta.value = url;
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand('copy'); } catch (e) {}
          document.body.removeChild(ta);
          alert('已複製: ' + url);
        });
      });

      // 儲存成功後 Modal 保持開啟 (使用者可看網址 / 繼續調)
      // 但背景列表要重新載入 (才會看到剛新增/編輯的項目)
      loadCreatorsList();

      // 滾到 hint 位置 (手機板 modal scroll 才看得到網址卡)
      setTimeout(() => {
        hint.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);

    } catch (err) {
      hint.style.color = 'var(--status-rejected)';
      hint.textContent = '失敗: ' + (err.message || err);
      console.error('[建立創作者失敗]', err);
    }
  }

  /* =============================================================
     創作者管理 · 列表 + 編輯 + 刪除
     ============================================================= */

  let CreatorsState = { items: [], filtered: [] };

  async function loadCreatorsList() {
    const sb = getSb();
    if (!sb) return;
    const list = document.getElementById('creatorsList');
    if (!list) return;

    list.innerHTML = '<p class="empty-text" style="text-align:center;padding:60px;color:var(--lohas-mute)">載入中...</p>';

    // 綁 filter (一次)
    const page = root.querySelector('.content-page[data-page="creators"]');
    if (page && !page.dataset.bound) {
      page.dataset.bound = '1';
      document.getElementById('creatorsSearchInput')?.addEventListener('input', applyCreatorsFilter);
      document.getElementById('creatorsFilterType')?.addEventListener('change', applyCreatorsFilter);
      document.getElementById('creatorsFilterStatus')?.addEventListener('change', applyCreatorsFilter);
      document.getElementById('creatorsAddBtn')?.addEventListener('click', () => openCreatorModal(null));
    }

    const { data, error } = await sb
      .from('creator_info')
      .select('member_id, display_name, tagline, bio, avatar_url, status, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      list.innerHTML = `<p class="empty-text" style="padding:40px">載入失敗: ${escapeHtml(error.message)}</p>`;
      return;
    }

    CreatorsState.items = data || [];

    // 載入本月精選
    await loadFeaturedCreator();

    applyCreatorsFilter();
  }


  // 本月精選 creator_id (放 state)
  let featuredCreatorId = null;

  async function loadFeaturedCreator() {
    const sb = getSb();
    if (!sb) return;
    const month = currentMonth();
    const { data } = await sb.from('featured_creators')
      .select('creator_id')
      .eq('featured_month', month)
      .maybeSingle();
    featuredCreatorId = data?.creator_id || null;
  }

  function currentMonth() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }


  async function toggleFeaturedCreator(creatorId) {
    const sb = getSb();
    if (!sb) return;
    const month = currentMonth();

    // 如果已經是本月精選 → 取消
    if (featuredCreatorId === creatorId) {
      if (!confirm(`取消本月精選「${creatorId}」?`)) return;
      const { error } = await sb.from('featured_creators')
        .delete()
        .eq('featured_month', month);
      if (error) return alert('取消失敗:' + error.message);
      featuredCreatorId = null;
      alert('已取消本月精選');
      applyCreatorsFilter();
      return;
    }

    // 否則:設成本月精選(若該月已有人,先刪掉)
    if (!confirm(`設定為本月 (${month}) 精選創作者?\n\n本月只能選一位,如已有其他精選會被取代`)) return;

    // 先刪除本月已有的(若存在)
    await sb.from('featured_creators').delete().eq('featured_month', month);

    // 取得當前管理員 id (簡化:從現有 admin session 拿,或寫死)
    var adminMember = (window.LohasAuth?.getStoredMember?.()) || {};
    var adminId = adminMember.erpid || 'admin';

    const { error } = await sb.from('featured_creators').insert({
      creator_id: creatorId,
      featured_month: month,
      featured_by: adminId,
    });

    if (error) return alert('設定失敗:' + error.message);

    featuredCreatorId = creatorId;
    alert('已設為本月精選,將出現在創作者市集首頁');
    applyCreatorsFilter();
  }

  function applyCreatorsFilter() {
    const list = document.getElementById('creatorsList');
    const sub = document.getElementById('creatorsListSub');
    if (!list) return;

    const q = (document.getElementById('creatorsSearchInput')?.value || '').trim().toLowerCase();
    const typeF = document.getElementById('creatorsFilterType')?.value || 'all';
    const statusF = document.getElementById('creatorsFilterStatus')?.value || 'all';

    let filtered = CreatorsState.items;

    if (q) {
      filtered = filtered.filter(c =>
        (c.display_name || '').toLowerCase().includes(q) ||
        (c.member_id || '').toLowerCase().includes(q)
      );
    }
    if (typeF === 'virt') {
      filtered = filtered.filter(c => (c.member_id || '').startsWith('virt-'));
    } else if (typeF === 'member') {
      filtered = filtered.filter(c => !(c.member_id || '').startsWith('virt-'));
    }
    if (statusF !== 'all') {
      filtered = filtered.filter(c => c.status === statusF);
    }

    CreatorsState.filtered = filtered;

    if (sub) sub.textContent = `共 ${filtered.length} 位${q || typeF !== 'all' || statusF !== 'all' ? ` (篩選自 ${CreatorsState.items.length} 位)` : '創作者'}`;

    if (filtered.length === 0) {
      list.innerHTML = '<p class="empty-text" style="text-align:center;padding:60px;color:var(--lohas-mute)">沒有符合的創作者</p>';
      return;
    }

    list.innerHTML = filtered.map(c => {
      const isVirt = (c.member_id || '').startsWith('virt-');
      const initials = (c.display_name || '?').slice(0, 2);
      const avatarHtml = c.avatar_url
        ? `<div class="creator-card-avatar" style="background-image:url('${escapeHtml(c.avatar_url)}')"></div>`
        : `<div class="creator-card-avatar">${escapeHtml(initials)}</div>`;
      const isSuspended = c.status !== 'active';
      const isFeatured = featuredCreatorId === c.member_id;

      const publicUrl = `${window.location.origin}${window.location.pathname.replace('admin-portal.html', 'creator-public.html')}?id=${c.member_id}`;

      return `
        <div class="creator-card ${isFeatured ? 'is-featured' : ''}" data-id="${escapeHtml(c.member_id)}">
          ${avatarHtml}
          <div class="creator-card-body">
            <div class="creator-card-name-row">
              <span class="creator-card-name">${escapeHtml(c.display_name || '未命名')}</span>
              ${isFeatured ? '<span class="creator-card-tag featured"><i class="fa-solid fa-star"></i>本月精選</span>' : ''}
              ${isVirt ? '<span class="creator-card-tag virt">樂活官方</span>' : '<span class="creator-card-tag">會員</span>'}
              ${isSuspended ? '<span class="creator-card-tag suspended">已隱藏</span>' : ''}
            </div>
            <div class="creator-card-meta">
              <code>${escapeHtml(c.member_id)}</code>
              ${c.tagline ? ` · ${escapeHtml(c.tagline)}` : ''}
              ${c.created_at ? ` · 建立 ${formatTime(c.created_at)}` : ''}
            </div>
          </div>
          <div class="creator-card-actions">
            <a class="btn" href="${publicUrl}" target="_blank" rel="noopener" title="開啟個人頁">
              <i class="fa-solid fa-arrow-up-right-from-square"></i>查看
            </a>
            <button class="btn ${isFeatured ? 'featured-on' : 'featured-off'}" data-act="toggle-featured" data-id="${escapeHtml(c.member_id)}" title="${isFeatured ? '本月精選 (點擊取消)' : '設為本月精選'}">
              <i class="fa-solid fa-star"></i>${isFeatured ? '取消精選' : '本月精選'}
            </button>
            <button class="btn" data-act="edit" data-id="${escapeHtml(c.member_id)}">
              <i class="fa-regular fa-pen-to-square"></i>編輯
            </button>
            <button class="btn ${isSuspended ? '' : 'warn'}" data-act="toggle-status" data-id="${escapeHtml(c.member_id)}" data-current="${c.status}">
              <i class="fa-solid ${isSuspended ? 'fa-eye' : 'fa-eye-slash'}"></i>${isSuspended ? '顯示' : '隱藏'}
            </button>
            <button class="btn danger" data-act="delete" data-id="${escapeHtml(c.member_id)}" data-name="${escapeHtml(c.display_name || '')}">
              <i class="fa-regular fa-trash-can"></i>刪除
            </button>
          </div>
        </div>`;
    }).join('');

    // 綁按鈕
    list.querySelectorAll('[data-act="edit"]').forEach(b => {
      b.addEventListener('click', () => editCreator(b.dataset.id));
    });
    list.querySelectorAll('[data-act="delete"]').forEach(b => {
      b.addEventListener('click', () => deleteCreator(b.dataset.id, b.dataset.name));
    });
    list.querySelectorAll('[data-act="toggle-status"]').forEach(b => {
      b.addEventListener('click', () => toggleCreatorStatus(b.dataset.id, b.dataset.current));
    });
    list.querySelectorAll('[data-act="toggle-featured"]').forEach(b => {
      b.addEventListener('click', () => toggleFeaturedCreator(b.dataset.id));
    });
  }

  async function deleteCreator(memberId, name) {
    if (!confirm(`確定要刪除創作者「${name || memberId}」?\n\n此操作無法復原。`)) return;

    const sb = getSb();
    if (!sb) return;

    // 加 select() 才能拿到刪除後的 rows
    const { data, error } = await sb.from('creator_info')
      .delete()
      .eq('member_id', memberId)
      .select();

    if (error) return alert('刪除失敗: ' + error.message);

    // RLS 擋了會 silently 回 0 rows
    if (!data || data.length === 0) {
      alert('刪除失敗: 沒有任何資料被刪除\n\n可能原因: Supabase RLS policy 沒給 DELETE 權限\n請聯繫管理員');
      return;
    }

    alert(`已刪除創作者「${name || memberId}」`);

    // 動畫消失
    const card = document.querySelector(`.creator-card[data-id="${memberId}"]`);
    if (card) {
      card.style.transition = 'opacity .2s, transform .2s';
      card.style.opacity = '0';
      card.style.transform = 'scale(0.95)';
      setTimeout(() => loadCreatorsList(), 250);
    } else {
      loadCreatorsList();
    }
  }

  async function toggleCreatorStatus(memberId, current) {
    const isHiding = current === 'active';
    const newStatus = isHiding ? 'inactive' : 'active';
    const action = isHiding ? '隱藏' : '顯示';
    const tip = isHiding
      ? '隱藏後創作者個人頁網址將自動導向刻圖市集'
      : '顯示後將恢復公開可見';
    if (!confirm(`確定要${action}此創作者?\n\n${tip}`)) return;

    const sb = getSb();
    if (!sb) return;

    const { error } = await sb.from('creator_info')
      .update({ status: newStatus })
      .eq('member_id', memberId);

    if (error) return alert('更新失敗: ' + error.message);

    loadCreatorsList();
  }

  async function editCreator(memberId) {
    const sb = getSb();
    if (!sb) return;

    try {
      const { data, error } = await sb
        .from('creator_info')
        .select('*')
        .eq('member_id', memberId)
        .single();

      if (error || !data) {
        alert('載入失敗: ' + (error?.message || '找不到資料'));
        return;
      }

      // 直接打開 Modal 並預填
      openCreatorModal(data);

    } catch (err) {
      console.error('[編輯創作者失敗]', err);
      alert('載入失敗: ' + (err.message || err));
    }
  }

  // 統一的開 Modal 函式 (新增 + 編輯共用)
  function openCreatorModal(creatorData) {
    const overlay = document.getElementById('agModalOverlay');
    const title = document.getElementById('agModalTitle');
    if (!overlay || !title) return;

    // 確保事件已綁
    initGrantCreator();
    initAgModalHandlers();

    // 重置 + 預填
    agReset();
    if (creatorData) {
      // 編輯模式
      title.textContent = `編輯創作者:${creatorData.display_name || creatorData.member_id}`;
      prefillCreatorForm(creatorData);
    } else {
      // 新增模式
      title.textContent = '新增創作者個人頁';
    }

    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function closeCreatorModal() {
    const overlay = document.getElementById('agModalOverlay');
    if (overlay) overlay.style.display = 'none';
    document.body.style.overflow = '';
    agReset();
  }

  function initAgModalHandlers() {
    const overlay = document.getElementById('agModalOverlay');
    const closeBtn = document.getElementById('agModalClose');
    if (overlay && !overlay.dataset.bound) {
      overlay.dataset.bound = '1';
      // 點背景不關閉 (避免誤觸,只能點 X / ESC / 底部關閉)
    }
    if (closeBtn && !closeBtn.dataset.bound) {
      closeBtn.dataset.bound = '1';
      closeBtn.addEventListener('click', closeCreatorModal);
    }
    // 底部右下「關閉」按鈕
    const closeBottom = document.getElementById('agModalCloseBottom');
    if (closeBottom && !closeBottom.dataset.bound) {
      closeBottom.dataset.bound = '1';
      closeBottom.addEventListener('click', closeCreatorModal);
    }
  }

  function prefillCreatorForm(c) {
    // 切換成編輯模式 (state)
    AGState.editMemberId = c.member_id;

    // 預填基本欄位
    document.getElementById('agDisplayName').value = c.display_name || '';
    document.getElementById('agTagline').value = c.tagline || '';
    document.getElementById('agBio').value = c.bio || '';
    document.getElementById('agJoiningStory').value = c.joining_story || '';
    document.getElementById('agVideoUrl').value = c.video_url || '';
    document.getElementById('agVideoTitle').value = c.video_title || '';

    // 社群連結
    const sl = c.social_links || {};
    document.getElementById('agIg').value = sl.instagram || '';
    document.getElementById('agFb').value = sl.facebook || '';
    document.getElementById('agLine').value = sl.line || '';
    document.getElementById('agEmail').value = sl.email || '';

    // 頭像
    if (c.avatar_url) {
      const ed = document.getElementById('agAvatar');
      if (ed) ed.innerHTML = `<img src="${escapeHtml(c.avatar_url)}" alt="">`;
      AGState.avatarBase64 = c.avatar_url;
      AGState.existingAvatarUrl = c.avatar_url;
    }

    // 緣分照片
    if (c.joining_photo_url) {
      const preview = document.getElementById('agJoiningPhotoPreview');
      if (preview) {
        preview.style.backgroundImage = `url('${escapeHtml(c.joining_photo_url)}')`;
        preview.classList.add('has-image');
      }
      const clearBtn = document.getElementById('agJoiningPhotoClear');
      if (clearBtn) clearBtn.style.display = 'flex';
      AGState.existingJoiningPhotoUrl = c.joining_photo_url;
    }

    // 自訂區塊
    const cbList = document.getElementById('agCustomBlocksList');
    if (cbList && Array.isArray(c.custom_blocks) && c.custom_blocks.length > 0) {
      cbList.innerHTML = '';
      c.custom_blocks.forEach((data, i) => {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = agRenderCustomBlock(i, data);
        const blockEl = wrapper.firstElementChild;
        cbList.appendChild(blockEl);
        agBindCustomBlockEvents(blockEl);
      });
    }

    // 編輯模式: 改按鈕文字
    const saveBtn = document.getElementById('agSaveBtn');
    if (saveBtn) saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i><span>儲存變更</span>';
  }


  function agAddCustomBlock() {
    const list = document.getElementById('agCustomBlocksList');
    if (!list) return;
    const empty = list.querySelector('.empty-text');
    if (empty) empty.remove();

    const idx = list.querySelectorAll('.custom-block').length;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = agRenderCustomBlock(idx);
    const blockEl = wrapper.firstElementChild;
    list.appendChild(blockEl);
    agBindCustomBlockEvents(blockEl);
  }

  function agRenderCustomBlock(index, data) {
    data = data || {};
    const hasImage = !!data.image;
    return `
      <div class="custom-block" data-index="${index}">
        <div class="custom-block-h">
          <span class="custom-block-num">區塊 ${index + 1}</span>
          <button class="custom-block-remove" type="button" title="刪除此區塊">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
        <div class="editor-row">
          <div class="editor-label">標題</div>
          <div><input class="editor-input cb-title" placeholder="請輸入區塊標題" value="${escapeHtml(data.title || '')}"/></div>
        </div>
        <div class="editor-row">
          <div class="editor-label">圖片</div>
          <div>
            <div class="creator-photo-wrap">
              <div class="creator-photo-preview cb-photo-preview ${hasImage ? 'has-image' : ''}" ${hasImage ? `style="background-image:url('${escapeHtml(data.image)}')"` : ''}>
                <i class="fa-regular fa-image"></i>
                <span>選填 3:4</span>
              </div>
              <button class="creator-photo-clear cb-photo-clear" type="button" aria-label="移除圖片" style="${hasImage ? 'display:flex' : 'display:none'}">
                <i class="fa-solid fa-xmark"></i>
              </button>
              <input type="file" class="visually-hidden cb-photo-input" accept="image/*">
              <input type="hidden" class="cb-image" value="${escapeHtml(data.image || '')}"/>
              <input type="hidden" class="cb-image-base64" value=""/>
            </div>
            <div style="font-size:11px;color:var(--lohas-mute);margin-top:6px;letter-spacing:0.3px">建議比例 3:4 · 建議尺寸 600 × 800 px</div>
          </div>
        </div>
        <div class="editor-row">
          <div class="editor-label">內文</div>
          <div><textarea class="editor-area cb-text" placeholder="請輸入區塊內文(可空一行分段)">${escapeHtml(data.text || '')}</textarea></div>
        </div>
      </div>
    `;
  }

  function agBindCustomBlockEvents(blockEl) {
    // 刪除整個區塊
    blockEl.querySelector('.custom-block-remove')?.addEventListener('click', () => {
      if (confirm('確定要刪除此區塊?')) {
        blockEl.remove();
        agRenumberBlocks();
      }
    });

    // 圖片上傳 (3:4 裁切)
    const photoPreview = blockEl.querySelector('.cb-photo-preview');
    const photoInput = blockEl.querySelector('.cb-photo-input');
    const photoHidden = blockEl.querySelector('.cb-image');
    const photoBase64Hidden = blockEl.querySelector('.cb-image-base64');
    const photoClear = blockEl.querySelector('.cb-photo-clear');

    if (photoPreview && photoInput) {
      photoPreview.addEventListener('click', () => photoInput.click());
      photoInput.addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file || !file.type.startsWith('image/')) return;

        // 3:4 裁切
        let finalFile = file;
        if (window.LohasCropper) {
          const cropped = await window.LohasCropper.crop(file, {
            aspectRatio: 3 / 4,
            title: '裁切自訂區塊圖 · 3:4'
          });
          if (!cropped) { photoInput.value = ''; return; }
          finalFile = cropped;
        }

        const reader = new FileReader();
        reader.onload = ev => {
          photoPreview.style.backgroundImage = `url('${ev.target.result}')`;
          photoPreview.classList.add('has-image');
          if (photoBase64Hidden) photoBase64Hidden.value = ev.target.result;
          // 顯示 ✕
          if (photoClear) photoClear.style.display = 'flex';
          photoInput._cbFile = finalFile;
        };
        reader.readAsDataURL(finalFile);
        photoInput.value = '';
      });
    }

    // ✕ 移除圖片 (但區塊保留)
    if (photoClear) {
      photoClear.addEventListener('click', e => {
        e.stopPropagation();
        photoPreview.style.backgroundImage = '';
        photoPreview.classList.remove('has-image');
        if (photoHidden) photoHidden.value = '';
        if (photoBase64Hidden) photoBase64Hidden.value = '';
        if (photoInput) {
          photoInput.value = '';
          photoInput._cbFile = null;
        }
        photoClear.style.display = 'none';
      });
    }
  }

  function agRenumberBlocks() {
    document.querySelectorAll('#agCustomBlocksList .custom-block').forEach((el, i) => {
      const num = el.querySelector('.custom-block-num');
      if (num) num.textContent = `區塊 ${i + 1}`;
    });
  }

  // 收集自訂區塊資料 (含上傳圖片到 Storage)
  async function agCollectCustomBlocks(sb, SUPABASE_BUCKET) {
    const blocks = [];
    const els = document.querySelectorAll('#agCustomBlocksList .custom-block');

    for (const el of els) {
      const title = el.querySelector('.cb-title')?.value || '';
      const text = el.querySelector('.cb-text')?.value || '';
      const photoInput = el.querySelector('.cb-photo-input');
      let image = el.querySelector('.cb-image')?.value || '';

      // 有新圖檔, 上傳到 Storage
      if (photoInput && photoInput._cbFile) {
        const file = photoInput._cbFile;
        const ext = getExt(file);
        const filePath = `creator-blocks/${Date.now()}-${crypto.randomUUID()}.${ext}`;
        const { error } = await sb.storage.from(SUPABASE_BUCKET).upload(filePath, file, { cacheControl: '3600', upsert: false });
        if (error) throw error;
        const { data } = sb.storage.from(SUPABASE_BUCKET).getPublicUrl(filePath);
        image = data.publicUrl;
      }

      if (title || text || image) {
        blocks.push({ title, image, text });
      }
    }

    return blocks;
  }


  /* =============================================================
     刻圖管理 (manage-designs)
     - 全表列出 + 過濾 + 編輯 + 硬刪除
     ============================================================= */

  var mdState = {
    designs:        [],
    filtered:       [],
    editId:         null,
  };

  async function loadManageDesigns() {
    const sb = getSb();
    if (!sb) return;

    const grid = document.getElementById('mdGrid');
    if (!grid) return;
    grid.innerHTML = '<div class="md-empty">載入中...</div>';

    try {
      const { data, error } = await sb.from('engraving_designs')
        .select('id, icons_id, legacy_id, name, slogan, keywords, designer_name, category, image_url, image_url_png, image_url_svg, status, type, creator_id, erp_number, price, is_show, like_count, share_count, collect_count, created_at')
        .order('created_at', { ascending: false })
        .limit(2000);

      if (error) throw error;

      mdState.designs = data || [];
      mdBindToolbar();
      mdApplyFilters();

    } catch (err) {
      console.error('[manage-designs] 載入失敗:', err);
      grid.innerHTML = '<div class="md-empty">載入失敗:' + err.message + '</div>';
    }
  }

  // 工具列只綁一次
  let mdToolbarBound = false;
  function mdBindToolbar() {
    if (mdToolbarBound) return;
    mdToolbarBound = true;

    document.getElementById('mdFilterStatus')?.addEventListener('change', mdApplyFilters);
    document.getElementById('mdFilterType')?.addEventListener('change', mdApplyFilters);
    document.getElementById('mdSearch')?.addEventListener('input', debounce(mdApplyFilters, 200));

    // 批次改價
    document.getElementById('mdBulkPriceBtn')?.addEventListener('click', mdBulkUpdatePrice);

    // 編輯 Modal
    document.getElementById('mdModalClose')?.addEventListener('click', mdCloseEditModal);
    document.getElementById('mdEditCancel')?.addEventListener('click', mdCloseEditModal);
    document.getElementById('mdEditSave')?.addEventListener('click', mdSaveEdit);
    document.getElementById('mdModalOverlay')?.addEventListener('click', e => {
      if (e.target.id === 'mdModalOverlay') mdCloseEditModal();
    });
  }

  function debounce(fn, ms) {
    let t;
    return function() { clearTimeout(t); t = setTimeout(() => fn.apply(this, arguments), ms); };
  }

  function mdApplyFilters() {
    const status = document.getElementById('mdFilterStatus')?.value || '';
    const type   = document.getElementById('mdFilterType')?.value || '';
    const q      = (document.getElementById('mdSearch')?.value || '').toLowerCase().trim();

    mdState.filtered = mdState.designs.filter(d => {
      if (status && d.status !== status) return false;
      if (type && d.type !== type) return false;
      if (q) {
        const hay = [d.name, d.slogan, d.designer_name, d.category, d.keywords]
          .map(s => (s || '').toString().toLowerCase())
          .join(' ');
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });

    mdRenderTable();
    document.getElementById('mdCount').textContent =
      `共 ${mdState.filtered.length} / ${mdState.designs.length} 件`;
  }

  function mdRenderTable() {
    const container = document.getElementById('mdGrid');
    if (!container) return;

    if (!mdState.filtered.length) {
      container.innerHTML = '<div class="md-empty">沒有符合條件的設計</div>';
      return;
    }

    container.innerHTML = mdState.filtered.map(d => {
      const imgUrl = mdValidUrl(d.image_url_svg) || mdValidUrl(d.image_url_png) || mdValidUrl(d.image_url) || '';
      const statusLabel = { approved:'已通過', pending:'待審核', rejected:'已駁回' }[d.status] || d.status || '--';
      const typeLabel = { legacy:'舊官網', member:'會員' }[d.type] || d.type || '--';
      const designer = d.designer_name || '匿名';
      const isShow = d.is_show || '上架';
      const showOn = isShow === '上架';
      // 只有「已通過」的圖才能切上下架,改用滑桿
      const showToggle = d.status === 'approved'
        ? '<button class="md-switch ' + (showOn ? 'on' : 'off') + '" data-act="toggle-show" title="' + (showOn ? '點擊下架' : '點擊上架') + '">' +
            '<span class="md-switch-label">' + (showOn ? '上架' : '下架') + '</span>' +
            '<span class="md-switch-track"><span class="md-switch-thumb"></span></span>' +
          '</button>'
        : '<span class="md-switch disabled">—</span>';
      // 售價顯示
      const priceText = (d.price && Number(d.price) > 0)
        ? '<span class="md-card-price">$' + Number(d.price) + '</span>'
        : '<span class="md-card-price unset">未定價</span>';
      return (
        '<div class="md-card" data-id="' + escapeHtml(d.id) + '">' +
          // 頂部:狀態 pill + type + 上下架 toggle
          '<div class="md-card-top">' +
            '<div class="md-card-pills">' +
              '<span class="md-pill s-' + (d.status || 'pending') + '">' + statusLabel + '</span>' +
              '<span class="md-pill t-' + (d.type || 'member') + '">' + typeLabel + '</span>' +
            '</div>' +
            showToggle +
          '</div>' +
          // 圖片
          '<div class="md-card-cover" ' + (imgUrl ? 'style="background-image:url(\'' + escapeHtml(imgUrl) + '\')"' : '') + '></div>' +
          // 內文 (name + 售價 / by + 愛心)
          '<div class="md-card-body">' +
            '<div class="md-card-row">' +
              '<div class="md-card-name">' + escapeHtml(d.name || '(未命名)') + '</div>' +
              priceText +
            '</div>' +
            '<div class="md-card-row sub">' +
              '<div class="md-card-by">by ' + escapeHtml(designer) + (d.category ? ' · ' + escapeHtml(d.category) : '') + '</div>' +
              '<div class="md-card-likes"><i class="fa-regular fa-heart"></i>' + (d.like_count || 0) + '</div>' +
            '</div>' +
          '</div>' +
          // 底部按鈕 (icon+文字,常駐)
          '<div class="md-card-actions">' +
            '<button class="md-act-btn" data-act="edit"><i class="fa-solid fa-pen"></i> 編輯</button>' +
            (d.image_url_svg ? '<button class="md-act-btn" data-act="download-svg"><i class="fa-solid fa-file-arrow-down"></i> SVG</button>' : '') +
            '<button class="md-act-btn danger" data-act="delete"><i class="fa-solid fa-trash"></i> 刪除</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    // 點卡片
    container.querySelectorAll('.md-card').forEach(card => {
      card.addEventListener('click', e => {
        const act = e.target.closest('[data-act]')?.dataset?.act;
        const id  = card.dataset.id;
        if (act === 'edit')         { mdOpenEditModal(id); return; }
        if (act === 'delete')       { mdDeleteDesign(id); return; }
        if (act === 'toggle-show')  { mdToggleShow(id); return; }
        if (act === 'download-svg') { mdDownloadSvg(id); return; }
        // 點卡片其他地方 → 直接開編輯 Modal
        mdOpenEditModal(id);
      });
    });
  }


  async function mdDownloadSvg(id) {
    const d = mdState.designs.find(x => String(x.id) === String(id));
    if (!d || !d.image_url_svg) {
      alert('此刻圖沒有 SVG 檔');
      return;
    }
    try {
      const res = await fetch(d.image_url_svg);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      const safeName = (d.name || 'engraving').replace(/[\\/:*?"<>|]/g, '_').slice(0, 50);
      const filename = safeName + '.svg';

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[mdDownloadSvg]', err);
      alert('下載失敗:' + (err.message || err));
    }
  }


  async function mdBulkUpdatePrice() {
    const targetCount = mdState.filtered.length;
    if (targetCount === 0) {
      alert('目前篩選結果為 0 筆,無可改價的對象');
      return;
    }

    const input = prompt(
      '批次修改售價\n\n' +
      '⚠️ 將套用到目前篩選結果共 ' + targetCount + ' 筆刻圖\n' +
      '(請先用上方的狀態 / 來源 / 搜尋篩出要改的範圍)\n\n' +
      '請輸入售價(元):\n' +
      '  輸入 0 = 全部設為「未定價」\n' +
      '  其他 = 全部設為該數字',
      '500'
    );
    if (input === null) return;
    const priceNum = parseInt(input.trim(), 10);
    if (isNaN(priceNum) || priceNum < 0) {
      alert('請輸入有效的非負整數');
      return;
    }

    const finalPrice = priceNum === 0 ? null : priceNum;
    const displayPrice = priceNum === 0 ? '未定價' : '$' + priceNum;

    if (!confirm('確定要把這 ' + targetCount + ' 筆刻圖售價全部設成「' + displayPrice + '」?')) return;

    const sb = getSb();
    if (!sb) return;

    const btn = document.getElementById('mdBulkPriceBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 處理中...'; }

    try {
      const ids = mdState.filtered.map(d => d.id);
      // 一次 update 多個 (用 in)
      const { error } = await sb.from('engraving_designs')
        .update({ price: finalPrice })
        .in('id', ids);

      if (error) throw error;

      // 同步本地
      mdState.designs.forEach(d => {
        if (ids.includes(d.id)) d.price = finalPrice;
      });

      alert('已成功將 ' + targetCount + ' 筆刻圖售價設為「' + displayPrice + '」');
      mdApplyFilters();

    } catch (err) {
      console.error('[mdBulkUpdatePrice]', err);
      alert('批次改價失敗:' + (err.message || err));
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-tag"></i> 批次改價'; }
    }
  }


  async function mdToggleShow(id) {
    const d = mdState.designs.find(x => String(x.id) === String(id));
    if (!d) return;

    const currentShow = d.is_show || '上架';
    const newShow = currentShow === '上架' ? '下架' : '上架';

    const sb = getSb();
    if (!sb) return;

    try {
      const { error } = await sb.from('engraving_designs')
        .update({ is_show: newShow })
        .eq('id', id);
      if (error) throw error;

      d.is_show = newShow;
      mdApplyFilters();

    } catch (err) {
      console.error('[manage-designs] 切換上架失敗:', err);
      alert('切換失敗:' + err.message);
    }
  }

  function mdValidUrl(u) {
    return (u && typeof u === 'string' && u.trim() !== '' && /^https?:\/\//.test(u)) ? u : '';
  }
  function mdOpenEditModal(id) {
    const d = mdState.designs.find(x => String(x.id) === String(id));
    if (!d) return;
    mdState.editId = id;

    document.getElementById('mdEditName').value     = d.name || '';
    document.getElementById('mdEditSlogan').value   = d.slogan || '';
    document.getElementById('mdEditCategory').value = d.category || '';
    document.getElementById('mdEditKeywords').value = d.keywords || '';
    document.getElementById('mdEditDesigner').value = d.designer_name || '';
    document.getElementById('mdEditPrice').value    = d.price || '';

    document.getElementById('mdModalOverlay').hidden = false;
    setTimeout(() => document.getElementById('mdEditName').focus(), 50);
  }

  function mdCloseEditModal() {
    document.getElementById('mdModalOverlay').hidden = true;
    mdState.editId = null;
  }

  async function mdSaveEdit() {
    if (!mdState.editId) return;
    const sb = getSb();
    if (!sb) return;

    const saveBtn = document.getElementById('mdEditSave');
    saveBtn.disabled = true;
    saveBtn.textContent = '儲存中...';

    try {
      const priceRaw = document.getElementById('mdEditPrice').value.trim();
      const priceNum = priceRaw ? Math.max(0, parseInt(priceRaw, 10) || 0) : null;

      const payload = {
        name:          document.getElementById('mdEditName').value.trim(),
        slogan:        document.getElementById('mdEditSlogan').value.trim(),
        category:      document.getElementById('mdEditCategory').value.trim(),
        keywords:      document.getElementById('mdEditKeywords').value.trim(),
        designer_name: document.getElementById('mdEditDesigner').value.trim(),
        price:         priceNum,
      };

      if (!payload.name) {
        alert('名稱不可為空');
        return;
      }

      const { error } = await sb.from('engraving_designs')
        .update(payload)
        .eq('id', mdState.editId);

      if (error) throw error;

      // 同步本地資料
      const idx = mdState.designs.findIndex(x => String(x.id) === String(mdState.editId));
      if (idx >= 0) {
        Object.assign(mdState.designs[idx], payload);
      }

      alert('已儲存');
      mdCloseEditModal();
      mdApplyFilters();

    } catch (err) {
      console.error('[manage-designs] 儲存失敗:', err);
      alert('儲存失敗:' + err.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = '儲存';
    }
  }

  async function mdDeleteDesign(id) {
    const d = mdState.designs.find(x => String(x.id) === String(id));
    if (!d) return;

    if (!confirm(`確定刪除「${d.name || '(未命名)'}」?\n\n⚠️ 這個動作會永久刪除:\n· 資料庫紀錄\n· Storage 內的圖檔(PNG + SVG)\n\n無法復原`)) return;

    const sb = getSb();
    if (!sb) return;

    try {
      // 1. 先刪 Storage 檔案 (從 URL 抓 path)
      const filesToDelete = [];
      [d.image_url, d.image_url_png, d.image_url_svg].forEach(url => {
        const path = mdExtractStoragePath(url);
        if (path) filesToDelete.push(path);
      });

      if (filesToDelete.length) {
        const { error: storageErr } = await sb.storage
          .from('engraving-uploads')
          .remove(filesToDelete);
        if (storageErr) {
          console.warn('[manage-designs] Storage 刪除部分失敗(資料庫照刪):', storageErr);
        }
      }

      // 2. 刪資料庫紀錄
      const { error } = await sb.from('engraving_designs')
        .delete()
        .eq('id', id);

      if (error) throw error;

      // 3. 同步本地狀態
      mdState.designs = mdState.designs.filter(x => String(x.id) !== String(id));
      mdApplyFilters();
      alert('已刪除');

    } catch (err) {
      console.error('[manage-designs] 刪除失敗:', err);
      alert('刪除失敗:' + err.message);
    }
  }

  // 從完整 publicUrl 抓出 bucket 內的 path
  // 例如: https://xxx.supabase.co/storage/v1/object/public/engraving-uploads/designs/123/abc.png
  //   → designs/123/abc.png
  function mdExtractStoragePath(url) {
    if (!url || typeof url !== 'string') return null;
    const m = url.match(/\/engraving-uploads\/(.+)$/);
    return m ? m[1] : null;
  }


  /* =============================================================
     分享牆管理 (manage-shares)
     - 抓 gallery_posts (photo + story)
     - 編輯標題/故事/主題/承載物
     - 硬刪除 (Storage 圖檔也刪)
     ============================================================= */

  var msState = {
    posts:    [],
    filtered: [],
    editId:   null,
  };

  async function loadManageShares() {
    const sb = getSb();
    if (!sb) return;

    const grid = document.getElementById('msGrid');
    if (!grid) return;
    grid.innerHTML = '<div class="md-empty">載入中...</div>';

    try {
      const { data, error } = await sb.from('gallery_posts')
        .select('id, title, topic, carrier, story, type, image_urls, main_image_url, status, customer_name, member_id, reject_reason, created_at')
        .order('created_at', { ascending: false })
        .limit(2000);

      if (error) throw error;

      msState.posts = data || [];
      msBindToolbar();
      msApplyFilters();

    } catch (err) {
      console.error('[manage-shares] 載入失敗:', err);
      grid.innerHTML = '<div class="md-empty">載入失敗:' + err.message + '</div>';
    }
  }

  let msToolbarBound = false;
  function msBindToolbar() {
    if (msToolbarBound) return;
    msToolbarBound = true;

    document.getElementById('msFilterStatus')?.addEventListener('change', msApplyFilters);
    document.getElementById('msFilterType')?.addEventListener('change', msApplyFilters);
    document.getElementById('msSearch')?.addEventListener('input', debounce(msApplyFilters, 200));

    document.getElementById('msModalClose')?.addEventListener('click', msCloseEditModal);
    document.getElementById('msEditCancel')?.addEventListener('click', msCloseEditModal);
    document.getElementById('msEditSave')?.addEventListener('click', msSaveEdit);
    document.getElementById('msModalOverlay')?.addEventListener('click', e => {
      if (e.target.id === 'msModalOverlay') msCloseEditModal();
    });
  }

  function msApplyFilters() {
    const status = document.getElementById('msFilterStatus')?.value || '';
    const type   = document.getElementById('msFilterType')?.value || '';
    const q      = (document.getElementById('msSearch')?.value || '').toLowerCase().trim();

    msState.filtered = msState.posts.filter(p => {
      if (status && p.status !== status) return false;
      if (type && p.type !== type) return false;
      if (q) {
        const hay = [p.title, p.customer_name, p.story, p.topic]
          .map(s => (s || '').toString().toLowerCase())
          .join(' ');
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });

    msRenderGrid();
    document.getElementById('msCount').textContent =
      `共 ${msState.filtered.length} / ${msState.posts.length} 則`;
  }

  function msRenderGrid() {
    const container = document.getElementById('msGrid');
    if (!container) return;

    if (!msState.filtered.length) {
      container.innerHTML = '<div class="md-empty">沒有符合條件的分享</div>';
      return;
    }

    container.innerHTML = msState.filtered.map(p => {
      const imgUrl = mdValidUrl(p.main_image_url) || mdValidUrl((p.image_urls || [])[0]) || '';
      const statusLabel = { approved:'已通過', pending:'待審核', rejected:'已駁回' }[p.status] || p.status || '--';
      const typeLabel = { photo:'照片', story:'故事' }[p.type] || p.type || '--';
      const name = p.customer_name || '匿名';
      const excerpt = (p.story || '').replace(/\s+/g, ' ').trim().slice(0, 50);
      return (
        '<div class="md-card" data-id="' + escapeHtml(p.id) + '">' +
          '<div class="md-card-cover" ' + (imgUrl ? 'style="background-image:url(\'' + escapeHtml(imgUrl) + '\');background-size:cover"' : '') + '>' +
            '<span class="md-card-status md-pill s-' + (p.status || 'pending') + '">' + statusLabel + '</span>' +
            '<span class="md-card-type md-pill t-' + (p.type || 'photo') + '">' + typeLabel + '</span>' +
          '</div>' +
          '<div class="md-card-body">' +
            '<div class="md-card-name">' + escapeHtml(p.title || '(未命名)') + '</div>' +
            (excerpt ? '<div class="md-card-slogan">' + escapeHtml(excerpt) + '</div>' : '') +
            '<div class="md-card-by">by ' + escapeHtml(name) + (p.topic ? ' · ' + escapeHtml(p.topic) : '') + '</div>' +
          '</div>' +
          '<div class="md-card-actions">' +
            '<button class="md-icon-btn" data-act="edit" title="編輯"><i class="fa-solid fa-pen"></i></button>' +
            '<button class="md-icon-btn danger" data-act="delete" title="刪除"><i class="fa-solid fa-trash"></i></button>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    container.querySelectorAll('.md-card').forEach(card => {
      card.addEventListener('click', e => {
        const act = e.target.closest('[data-act]')?.dataset?.act;
        const id  = card.dataset.id;
        if (act === 'edit')   { msOpenEditModal(id); return; }
        if (act === 'delete') { msDeletePost(id); return; }
        msOpenEditModal(id);
      });
    });
  }

  function msOpenEditModal(id) {
    const p = msState.posts.find(x => String(x.id) === String(id));
    if (!p) return;
    msState.editId = id;

    document.getElementById('msEditTitle').value   = p.title || '';
    document.getElementById('msEditStory').value   = p.story || '';
    document.getElementById('msEditTopic').value   = p.topic || '';
    document.getElementById('msEditCarrier').value = p.carrier || '';

    document.getElementById('msModalOverlay').hidden = false;
    setTimeout(() => document.getElementById('msEditTitle').focus(), 50);
  }

  function msCloseEditModal() {
    document.getElementById('msModalOverlay').hidden = true;
    msState.editId = null;
  }

  async function msSaveEdit() {
    if (!msState.editId) return;
    const sb = getSb();
    if (!sb) return;

    const saveBtn = document.getElementById('msEditSave');
    saveBtn.disabled = true;
    saveBtn.textContent = '儲存中...';

    try {
      const payload = {
        title:   document.getElementById('msEditTitle').value.trim(),
        story:   document.getElementById('msEditStory').value.trim(),
        topic:   document.getElementById('msEditTopic').value.trim(),
        carrier: document.getElementById('msEditCarrier').value.trim(),
      };

      if (!payload.title) { alert('標題不可為空'); return; }

      const { error } = await sb.from('gallery_posts')
        .update(payload)
        .eq('id', msState.editId);

      if (error) throw error;

      const idx = msState.posts.findIndex(x => String(x.id) === String(msState.editId));
      if (idx >= 0) Object.assign(msState.posts[idx], payload);

      alert('已儲存');
      msCloseEditModal();
      msApplyFilters();

    } catch (err) {
      console.error('[manage-shares] 儲存失敗:', err);
      alert('儲存失敗:' + err.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = '儲存';
    }
  }

  async function msDeletePost(id) {
    const p = msState.posts.find(x => String(x.id) === String(id));
    if (!p) return;

    if (!confirm(`確定刪除「${p.title || '(未命名)'}」?\n\n⚠️ 這個動作會永久刪除:\n· 資料庫紀錄\n· Storage 內所有圖檔\n\n無法復原`)) return;

    const sb = getSb();
    if (!sb) return;

    try {
      // 1. 刪 Storage 檔案 (image_urls 是 array)
      const allImages = [p.main_image_url, ...(p.image_urls || [])].filter(Boolean);
      const filesToDelete = allImages
        .map(url => msExtractStoragePath(url))
        .filter(Boolean);

      if (filesToDelete.length) {
        // gallery_posts 用的 bucket 名稱(可能是 gallery-uploads,猜測)
        const { error: storageErr } = await sb.storage
          .from('gallery-uploads')
          .remove(filesToDelete);
        if (storageErr) {
          console.warn('[manage-shares] Storage 刪除部分失敗(資料庫照刪):', storageErr);
        }
      }

      // 2. 刪資料庫紀錄
      const { error } = await sb.from('gallery_posts')
        .delete()
        .eq('id', id);

      if (error) throw error;

      msState.posts = msState.posts.filter(x => String(x.id) !== String(id));
      msApplyFilters();
      alert('已刪除');

    } catch (err) {
      console.error('[manage-shares] 刪除失敗:', err);
      alert('刪除失敗:' + err.message);
    }
  }

  function msExtractStoragePath(url) {
    if (!url || typeof url !== 'string') return null;
    const m = url.match(/\/gallery-uploads\/(.+)$/);
    return m ? m[1] : null;
  }


  // ================================================================
  // 聯名活動 (IP 合作) 管理 - v2 (對齊 ag-modal + cropper + storage)
  // ================================================================
  (function initCollabManager(){
    const sb = function(){
      return window.LohasSupabase && window.LohasSupabase.getClient && window.LohasSupabase.getClient();
    };
    const SUPABASE_BUCKET = window.LohasSupabase?.CONFIG?.STORAGE_BUCKET || 'gallery-uploads';

    const $ = id => document.getElementById(id);
    const list = $('collabList');
    const modal = $('collabEditModal');
    if(!list || !modal) return;

    // ====== 編輯狀態 ======
    let currentCollab = null;
    let currentPackages = [];
    let currentDesigns = [];
    let currentPhotos = [];

    // 圖檔暫存 (新檔)
    const pendingFiles = {
      hero_image_url: null,
      story_image_url: null,
      creator_avatar_url: null,
      // 子表的圖檔用 row 內 _pendingFile 屬性
    };

    // 篩選狀態
    let filterText = '';
    let filterStatus = '';
    let filterCategory = '';
    let allCollabs = [];

    // ====== 工具 ======
    function toast(msg){
      if(window.toast) window.toast(msg);
      else alert(msg);
    }
    function esc(s){
      return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }
    function val(id){
      const el = $(id);
      if(!el) return null;
      if(el.type === 'checkbox') return el.checked;
      if(el.type === 'number') return el.value === '' ? null : Number(el.value);
      if(el.type === 'datetime-local') return el.value ? new Date(el.value).toISOString() : null;
      return el.value || null;
    }
    function setVal(id, v){
      const el = $(id);
      if(!el) return;
      if(el.type === 'checkbox'){ el.checked = !!v; return; }
      if(el.type === 'datetime-local' && v){
        try { el.value = new Date(v).toISOString().slice(0, 16); } catch(e){ el.value = ''; }
        return;
      }
      el.value = v == null ? '' : v;
    }
    function getExt(file){
      if(!file) return 'jpg';
      const n = file.name || '';
      const m = n.match(/\.([a-z0-9]+)$/i);
      return m ? m[1].toLowerCase() : 'jpg';
    }

    // ====== Cropper + Storage upload ======
    async function cropImage(file, aspectStr){
      if(!window.LohasCropper) return file;
      let ratio = NaN;
      if(aspectStr){
        const parts = aspectStr.split(':');
        if(parts.length === 2){
          ratio = Number(parts[0]) / Number(parts[1]);
        }
      }
      const cropped = await window.LohasCropper.crop(file, {
        aspectRatio: isFinite(ratio) ? ratio : 1,
        title: '裁切圖片 · ' + (aspectStr || '1:1')
      });
      return cropped || null;
    }

    async function uploadFile(file, folder){
      if(!file) return null;
      const client = sb();
      if(!client) throw new Error('Supabase 未配置');
      const ext = getExt(file);
      const filePath = `${folder}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
      const { error } = await client.storage.from(SUPABASE_BUCKET).upload(filePath, file, { cacheControl: '3600', upsert: false });
      if(error) throw error;
      const { data } = client.storage.from(SUPABASE_BUCKET).getPublicUrl(filePath);
      return data.publicUrl;
    }

    // ====== 載入列表 ======
    async function loadList(){
      const client = sb();
      if(!client){ list.innerHTML = '<div class="empty-state">Supabase 未配置</div>'; return; }

      list.innerHTML = '<div class="empty-state">載入中...</div>';
      const { data, error } = await client
        .from('collabs')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false });

      if(error){
        list.innerHTML = '<div class="empty-state">載入失敗: ' + esc(error.message) + '</div>';
        return;
      }
      allCollabs = data || [];
      renderList();
    }

    function renderList(){
      // 更新副標計數
      const subEl = $('collabListSub');
      if(subEl) subEl.textContent = allCollabs.length + ' 個聯名活動';

      let arr = allCollabs;
      if(filterText){
        const q = filterText.toLowerCase();
        arr = arr.filter(c =>
          (c.brand_name || '').toLowerCase().includes(q) ||
          (c.slug || '').toLowerCase().includes(q) ||
          (c.hero_title || '').toLowerCase().includes(q)
        );
      }
      if(filterStatus) arr = arr.filter(c => c.status === filterStatus);
      if(filterCategory) arr = arr.filter(c => c.category === filterCategory);

      if(!arr.length){
        list.innerHTML = '<div class="empty-state">' + (allCollabs.length ? '沒有符合篩選的聯名' : '還沒有任何聯名活動,點右上「+ 新增聯名」開始建立') + '</div>';
        return;
      }

      const STATUS_LABEL = {
        draft: '草稿', upcoming: '即將推出', active: '進行中',
        ended: '已結束', archived: '封存'
      };
      const CAT_LABEL = {
        fashion: 'FASHION', character: 'CHARACTER', anime: 'ANIME'
      };

      list.innerHTML = arr.map(c => {
        const initials = (c.brand_name || '?').slice(0, 2);
        const avatarHtml = c.hero_image_url
          ? `<div class="creator-card-avatar" style="background-image:url('${esc(c.hero_image_url)}')"></div>`
          : `<div class="creator-card-avatar" style="background:${esc(c.theme_accent || '#F4F1EC')};color:${esc(c.theme_primary || '#50422D')}">${esc(initials)}</div>`;

        return `
          <div class="creator-card" data-id="${esc(c.id)}">
            ${avatarHtml}
            <div class="creator-card-body">
              <div class="creator-card-name-row">
                <span class="creator-card-name">${esc(c.brand_name || '未命名')}</span>
                <span class="creator-card-tag">${esc(CAT_LABEL[c.category] || c.category || '—')}</span>
                <span class="creator-card-tag ${c.status === 'active' ? 'featured' : c.status === 'draft' ? 'suspended' : ''}">${esc(STATUS_LABEL[c.status] || c.status)}</span>
              </div>
              <div class="creator-card-meta">
                <code>/collab.html?id=${esc(c.slug)}</code>
                ${c.hero_title ? ` · ${esc(c.hero_title)}` : ''}
                ${c.show_limit && c.limit_total ? ` · 限量 ${c.limit_total} 套` : ''}
              </div>
            </div>
            <div class="creator-card-actions">
              <a class="btn" href="collab.html?id=${esc(c.slug)}" target="_blank" rel="noopener" title="開啟前台">
                <i class="fa-solid fa-arrow-up-right-from-square"></i>查看
              </a>
              <button class="btn" data-act="edit-collab" data-id="${esc(c.id)}">
                <i class="fa-regular fa-pen-to-square"></i>編輯
              </button>
            </div>
          </div>
        `;
      }).join('');

      list.querySelectorAll('[data-act="edit-collab"]').forEach(btn => {
        btn.addEventListener('click', () => openEdit(btn.dataset.id));
      });
    }

    // ====== 新增 ======
    function openNew(){
      currentCollab = null;
      currentPackages = []; currentDesigns = []; currentPhotos = [];
      pendingFiles.hero_image_url = null;
      pendingFiles.story_image_url = null;
      pendingFiles.creator_avatar_url = null;

      $('collabModalTitle').textContent = '新增聯名';
      $('collabDeleteBtn').style.display = 'none';
      $('collabPreviewBtn').style.display = 'none';

      // 清空 所有欄位
      ['cm_slug','cm_brand_name','cm_hero_title','cm_hero_subtitle','cm_hero_eyebrow',
       'cm_date_range_text','cm_launch_date_text','cm_available_stores',
       'cm_creator_name','cm_creator_subtitle','cm_interview_title','cm_interview_quote','cm_interview_full_link',
       'cm_start_date','cm_end_date','cm_story_paragraphs'].forEach(id => setVal(id, ''));

      setVal('cm_status', 'draft');
      setVal('cm_lifecycle_status', 'preorder');
      setVal('cm_category', 'character');
      setVal('cm_sort_order', 0);
      setVal('cm_show_countdown', false);
      setVal('cm_show_limit', false);
      setVal('cm_limit_total', '');
      setVal('cm_preorder_count', 0);
      setVal('cm_story_paragraphs', '');
      setVal('cm_theme_primary', '#7A2754');
      setVal('cm_theme_primary_picker', '#7A2754');
      setVal('cm_theme_accent', '#F8E4ED');
      setVal('cm_theme_accent_picker', '#F8E4ED');
      setVal('cm_theme_bg', '#FAF7F2');
      setVal('cm_theme_bg_picker', '#FAF7F2');

      updateSlugPreview();
      updateThemePreview();
      resetImagePreview('cm_hero_image_preview');
      resetImagePreview('cm_story_image_preview');
      resetImagePreview('cm_creator_avatar_preview', true);
      renderSubtables();

      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    }

    // ====== 編輯 ======
    async function openEdit(id){
      const client = sb();
      if(!client) return;

      const { data: c, error } = await client.from('collabs').select('*').eq('id', id).maybeSingle();
      if(error || !c){ toast('載入失敗'); return; }

      currentCollab = c;
      pendingFiles.hero_image_url = null;
      pendingFiles.story_image_url = null;
      pendingFiles.creator_avatar_url = null;

      $('collabModalTitle').textContent = '編輯:' + (c.brand_name || c.slug);
      $('collabDeleteBtn').style.display = '';

      setVal('cm_slug', c.slug);
      setVal('cm_status', c.status);
      setVal('cm_lifecycle_status', c.lifecycle_status || 'preorder');
      setVal('cm_category', c.category || 'character');
      setVal('cm_brand_name', c.brand_name);
      setVal('cm_sort_order', c.sort_order);
      setVal('cm_hero_title', c.hero_title);
      setVal('cm_hero_subtitle', c.hero_subtitle);
      setVal('cm_hero_eyebrow', c.hero_eyebrow);
      setVal('cm_show_countdown', c.show_countdown);
      setVal('cm_show_limit', c.show_limit);
      setVal('cm_start_date', c.start_date);
      setVal('cm_end_date', c.end_date);
      setVal('cm_date_range_text', c.date_range_text);
      setVal('cm_limit_total', c.limit_total);
      setVal('cm_preorder_count', c.preorder_count);
      setVal('cm_launch_date_text', c.launch_date_text);
      setVal('cm_available_stores', c.available_stores);
      // 把 story_paragraphs (JSON array) 轉回純文字格式
      const paragraphsTxt = (c.story_paragraphs || [])
        .map(p => {
          if (p.type === 'quote') return '> ' + (p.text || '');
          return p.text || '';
        })
        .join('\n\n');
      setVal('cm_story_paragraphs', paragraphsTxt);
      setVal('cm_creator_name', c.creator_name);
      setVal('cm_creator_subtitle', c.creator_subtitle);
      setVal('cm_interview_title', c.interview_title);
      setVal('cm_interview_quote', c.interview_quote);
      setVal('cm_interview_full_link', c.interview_full_link);
      setVal('cm_theme_primary', c.theme_primary || '#7A2754');
      setVal('cm_theme_primary_picker', c.theme_primary || '#7A2754');
      setVal('cm_theme_accent', c.theme_accent || '#F8E4ED');
      setVal('cm_theme_accent_picker', c.theme_accent || '#F8E4ED');
      setVal('cm_theme_bg', c.theme_bg || '#FAF7F2');
      setVal('cm_theme_bg_picker', c.theme_bg || '#FAF7F2');

      updateSlugPreview();
      updateThemePreview();
      setImagePreview('cm_hero_image_preview', c.hero_image_url);
      setImagePreview('cm_story_image_preview', c.story_image_url);
      setImagePreview('cm_creator_avatar_preview', c.creator_avatar_url, true);

      // 子表
      const [pkgRes, designRes, photoRes] = await Promise.all([
        client.from('collab_packages').select('*').eq('collab_id', id).order('sort_order'),
        client.from('collab_designs').select('*').eq('collab_id', id).order('sort_order'),
        client.from('collab_customer_photos').select('*').eq('collab_id', id).order('sort_order')
      ]);
      currentPackages = pkgRes.data || [];
      currentDesigns = designRes.data || [];
      currentPhotos = photoRes.data || [];
      renderSubtables();

      const preview = $('collabPreviewBtn');
      preview.style.display = '';
      preview.href = 'collab.html?id=' + encodeURIComponent(c.slug);

      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    }

    function closeModal(){
      modal.style.display = 'none';
      document.body.style.overflow = '';
    }

    // ====== Slug preview ======
    function updateSlugPreview(){
      const preview = $('cm_slug_preview');
      const slug = val('cm_slug');
      if(preview) preview.textContent = slug || 'xxx';
    }

    // ====== Image upload (Hero/Story/Avatar) ======
    function resetImagePreview(previewId, isCircle){
      const el = $(previewId);
      if(!el) return;
      const icon = isCircle ? 'fa-user' : 'fa-image';
      const txt = isCircle ? '' : ' 點擊上傳';
      el.innerHTML = `<span class="img-upload-placeholder"><i class="fa-solid ${icon}"></i>${txt}</span>`;
    }
    function setImagePreview(previewId, url){
      const el = $(previewId);
      if(!el) return;
      if(url){
        el.innerHTML = `<img src="${esc(url)}" alt="" />`;
      } else {
        el.innerHTML = `<span class="img-upload-placeholder"><i class="fa-solid fa-image"></i> 點擊上傳</span>`;
      }
    }

    function bindMainImageUploads(){
      modal.querySelectorAll('.img-upload-wrap[data-field]').forEach(wrap => {
        if(wrap.dataset.bound) return;
        wrap.dataset.bound = '1';

        const field = wrap.dataset.field;
        const aspect = wrap.dataset.aspect || '1:1';
        const input = wrap.querySelector('.img-upload-input');
        const preview = wrap.querySelector('.img-upload-preview');

        if(!input || !preview) return;

        preview.addEventListener('click', () => input.click());

        input.addEventListener('change', async e => {
          const file = e.target.files?.[0];
          if(!file) return;

          const cropped = await cropImage(file, aspect);
          if(!cropped){ input.value = ''; return; }

          pendingFiles[field] = cropped;
          const reader = new FileReader();
          reader.onload = ev => {
            preview.innerHTML = `<img src="${ev.target.result}" alt="" />`;
          };
          reader.readAsDataURL(cropped);
          input.value = '';
        });
      });
    }

    // ====== Theme preview ======
    function bindColorSync(textId, pickerId){
      const text = $(textId), picker = $(pickerId);
      if(!text || !picker) return;
      text.addEventListener('input', () => {
        if(/^#[0-9a-f]{6}$/i.test(text.value)){
          picker.value = text.value;
          updateThemePreview();
        }
      });
      picker.addEventListener('input', () => {
        text.value = picker.value.toUpperCase();
        updateThemePreview();
      });
    }
    function updateThemePreview(){
      const p = val('cm_theme_primary') || '#7A2754';
      const a = val('cm_theme_accent') || '#F8E4ED';
      const b = val('cm_theme_bg') || '#FAF7F2';
      const preview = $('themePreview');
      if(!preview) return;
      const hero = preview.querySelector('.tp-hero');
      if(hero){
        hero.style.background = `linear-gradient(180deg, ${a}, ${b})`;
        hero.style.color = p;
        hero.style.borderColor = p;
      }
    }

    // ====== 子表渲染 (含圖片上傳) ======
    function renderSubtables(){
      renderPkgList();
      renderDesignList();
      renderPhotoList();
    }

    function renderSubtableRow(item, idx, fields, type){
      const hasNew = !!item._pendingFile;
      const imgUrl = hasNew ? item._previewBase64 : (item.image_url || item.preview_image_url || '');
      const imgHtml = imgUrl
        ? `<img src="${esc(imgUrl)}" alt="" />`
        : `<span class="img-upload-placeholder"><i class="fa-solid fa-image"></i></span>`;

      const canUpload = !!currentCollab;
      const uploadBlocked = !canUpload ? ' subtable-img-disabled' : '';

      const inputs = fields.map(f => `
        <input type="text" class="st-input" placeholder="${esc(f.placeholder)}"
          data-field="${f.key}" value="${esc(item[f.key] || '')}" />
      `).join('');

      return `
        <div class="subtable-row-v2" data-idx="${idx}" data-type="${type}">
          <div class="subtable-img${uploadBlocked}" data-aspect="${type === 'photo' ? '1:1' : type === 'package' ? '1:1' : '1:1'}">
            ${imgHtml}
            <input type="file" accept="image/*" class="subtable-file-input" ${canUpload ? '' : 'disabled'} />
            ${!canUpload ? '<span class="subtable-img-hint">先存基本資料</span>' : ''}
          </div>
          <div class="subtable-fields">${inputs}</div>
          <button class="st-del" data-action="del">✕</button>
        </div>
      `;
    }

    function renderPkgList(){
      const wrap = $('cm_pkgList');
      if(!currentPackages.length){
        wrap.innerHTML = '<div class="subtable-empty">尚未新增套餐</div>';
        return;
      }
      const fields = [
        { key: 'name', placeholder: '套餐名稱' },
        { key: 'meta', placeholder: '說明 / meta' }
      ];
      wrap.innerHTML = currentPackages.filter(p => !p._deleted).map((p, i) =>
        renderSubtableRow(p, i, fields, 'package')
      ).join('');
      bindSubtable(wrap, currentPackages, 'package-images');
    }

    function renderDesignList(){
      const wrap = $('cm_designList');
      if(!currentDesigns.length){
        wrap.innerHTML = '<div class="subtable-empty">尚未新增設計</div>';
        return;
      }
      const fields = [
        { key: 'label', placeholder: '設計標籤 (例: 坐著 · 招牌)' }
      ];
      // 設計用 preview_image_url 不是 image_url,要特別處理
      const adjusted = currentDesigns.filter(d => !d._deleted).map((d, i) => {
        const fakeItem = { ...d, image_url: d.preview_image_url };
        return renderSubtableRow(fakeItem, i, fields, 'design');
      });
      wrap.innerHTML = adjusted.join('');
      bindSubtable(wrap, currentDesigns, 'design-images');
    }

    function renderPhotoList(){
      const wrap = $('cm_photoList');
      if(!currentPhotos.length){
        wrap.innerHTML = '<div class="subtable-empty">尚未新增客人照</div>';
        return;
      }
      const fields = [
        { key: 'caption', placeholder: 'caption (可選)' }
      ];
      wrap.innerHTML = currentPhotos.filter(p => !p._deleted).map((p, i) =>
        renderSubtableRow(p, i, fields, 'photo')
      ).join('');
      bindSubtable(wrap, currentPhotos, 'photo-images');
    }

    function bindSubtable(wrap, arr, folder){
      // 文字 input 變化
      wrap.querySelectorAll('.st-input').forEach(inp => {
        inp.addEventListener('input', () => {
          const row = inp.closest('.subtable-row-v2');
          const idx = Number(row.dataset.idx);
          const liveArr = arr.filter(x => !x._deleted);
          const item = liveArr[idx];
          if(item) item[inp.dataset.field] = inp.value;
        });
      });

      // 刪除
      wrap.querySelectorAll('[data-action="del"]').forEach(btn => {
        btn.addEventListener('click', () => {
          const row = btn.closest('.subtable-row-v2');
          const idx = Number(row.dataset.idx);
          const liveArr = arr.filter(x => !x._deleted);
          const item = liveArr[idx];
          if(!item) return;
          if(item.id){ item._deleted = true; }
          else {
            const realIdx = arr.indexOf(item);
            if(realIdx > -1) arr.splice(realIdx, 1);
          }
          renderSubtables();
        });
      });

      // 圖片上傳
      wrap.querySelectorAll('.subtable-img').forEach(imgWrap => {
        if(imgWrap.dataset.bound) return;
        imgWrap.dataset.bound = '1';
        const input = imgWrap.querySelector('.subtable-file-input');
        const aspect = imgWrap.dataset.aspect || '1:1';

        imgWrap.addEventListener('click', e => {
          if(e.target.classList.contains('subtable-file-input')) return;
          if(input.disabled) return;
          input.click();
        });

        input.addEventListener('change', async e => {
          const file = e.target.files?.[0];
          if(!file) return;

          const cropped = await cropImage(file, aspect);
          if(!cropped){ input.value = ''; return; }

          const row = imgWrap.closest('.subtable-row-v2');
          const idx = Number(row.dataset.idx);
          const liveArr = arr.filter(x => !x._deleted);
          const item = liveArr[idx];
          if(!item) return;

          item._pendingFile = cropped;
          item._uploadFolder = folder;

          const reader = new FileReader();
          reader.onload = ev => {
            item._previewBase64 = ev.target.result;
            renderSubtables();
          };
          reader.readAsDataURL(cropped);
          input.value = '';
        });
      });
    }

    // ====== 儲存 ======
    async function save(){
      const client = sb();
      if(!client){ toast('Supabase 未配置'); return; }

      let slug = val('cm_slug');
      if(!val('cm_brand_name')){ toast('品牌名稱必填'); return; }
      // 沒 slug 就自動生成
      if(!slug){
        slug = 'collab-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
      }
      if(!/^[a-z0-9_-]+$/i.test(slug)){ toast('Slug 格式錯誤'); return; }

      // 解析 story paragraphs (純文字格式)
      // 規則: 空一行 = 段落分隔;以 > 開頭 = 引用樣式
      const storyTxt = val('cm_story_paragraphs') || '';
      const paragraphs = storyTxt
        .split(/\n\s*\n/)
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => {
          if (s.startsWith('> ')) return { type: 'quote', text: s.slice(2).trim() };
          if (s.startsWith('>')) return { type: 'quote', text: s.slice(1).trim() };
          return { type: 'p', text: s };
        });

      // 處理主圖上傳
      let heroUrl = currentCollab?.hero_image_url || null;
      let storyUrl = currentCollab?.story_image_url || null;
      let avatarUrl = currentCollab?.creator_avatar_url || null;

      const saveBtn = $('collabSaveBtn');
      saveBtn.disabled = true;
      saveBtn.textContent = '上傳圖片中...';

      try {
        if(pendingFiles.hero_image_url){
          heroUrl = await uploadFile(pendingFiles.hero_image_url, 'collab-hero');
        }
        if(pendingFiles.story_image_url){
          storyUrl = await uploadFile(pendingFiles.story_image_url, 'collab-story');
        }
        if(pendingFiles.creator_avatar_url){
          avatarUrl = await uploadFile(pendingFiles.creator_avatar_url, 'collab-avatar');
        }

        saveBtn.textContent = '儲存中...';

        const payload = {
          slug,
          status: val('cm_status') || 'draft',
          lifecycle_status: val('cm_lifecycle_status') || 'preorder',
          category: val('cm_category') || 'character',
          sort_order: val('cm_sort_order') || 0,
          brand_name: val('cm_brand_name'),
          hero_title: val('cm_hero_title'),
          hero_subtitle: val('cm_hero_subtitle'),
          hero_eyebrow: val('cm_hero_eyebrow'),
          hero_image_url: heroUrl,
          show_countdown: val('cm_show_countdown'),
          show_limit: val('cm_show_limit'),
          start_date: val('cm_start_date'),
          end_date: val('cm_end_date'),
          date_range_text: val('cm_date_range_text'),
          limit_total: val('cm_limit_total'),
          preorder_count: val('cm_preorder_count') || 0,
          launch_date_text: val('cm_launch_date_text'),
          available_stores: val('cm_available_stores'),
          story_image_url: storyUrl,
          story_paragraphs: paragraphs,
          creator_name: val('cm_creator_name'),
          creator_subtitle: val('cm_creator_subtitle'),
          creator_avatar_url: avatarUrl,
          interview_title: val('cm_interview_title'),
          interview_quote: val('cm_interview_quote'),
          interview_full_link: val('cm_interview_full_link'),
          theme_primary: val('cm_theme_primary'),
          theme_accent: val('cm_theme_accent'),
          theme_bg: val('cm_theme_bg'),
          updated_at: new Date().toISOString()
        };

        let collabId = currentCollab && currentCollab.id;
        if(collabId){
          const { error } = await client.from('collabs').update(payload).eq('id', collabId);
          if(error) throw error;
        } else {
          const { data, error } = await client.from('collabs').insert(payload).select('*').single();
          if(error) throw error;
          collabId = data.id;
          currentCollab = data;
        }

        // 子表上傳 + 儲存
        await saveSubtable(client, 'collab_packages', collabId, currentPackages,
          ['name', 'meta', 'image_url', 'sort_order'], 'collab-pkg');
        await saveSubtable(client, 'collab_designs', collabId, currentDesigns,
          ['label', 'preview_image_url', 'sort_order'], 'collab-design');
        await saveSubtable(client, 'collab_customer_photos', collabId, currentPhotos,
          ['image_url', 'caption', 'sort_order'], 'collab-photo');

        toast('已儲存');
        closeModal();
        loadList();
      } catch(err){
        console.error(err);
        toast('儲存失敗:' + (err.message || err));
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = '儲存';
      }
    }

    async function saveSubtable(client, table, collabId, arr, allowedFields, uploadFolder){
      // 上傳新檔
      for(const row of arr){
        if(row._deleted) continue;
        if(row._pendingFile){
          const url = await uploadFile(row._pendingFile, uploadFolder);
          if(table === 'collab_designs'){
            row.preview_image_url = url;
          } else {
            row.image_url = url;
          }
          delete row._pendingFile;
          delete row._previewBase64;
          delete row._uploadFolder;
        }
      }

      // 刪除標記
      const toDelete = arr.filter(x => x._deleted && x.id).map(x => x.id);
      if(toDelete.length){
        await client.from(table).delete().in('id', toDelete);
      }

      // upsert
      const live = arr.filter(x => !x._deleted);
      const rows = live.map((row, i) => {
        const out = { collab_id: collabId, sort_order: i };
        allowedFields.forEach(f => { if(row[f] !== undefined) out[f] = row[f]; });
        if(row.id) out.id = row.id;
        return out;
      }).filter(r => {
        return allowedFields.some(f => r[f]);
      });

      if(rows.length){
        const { error } = await client.from(table).upsert(rows);
        if(error) throw error;
      }
    }

    // ====== 刪除 ======
    async function deleteCollab(){
      if(!currentCollab) return;
      if(!confirm('確定刪除「' + currentCollab.brand_name + '」?\n所有套餐 / 設計 / 客人照都會一起刪除,無法復原。')) return;

      const client = sb();
      const { error } = await client.from('collabs').delete().eq('id', currentCollab.id);
      if(error){ toast('刪除失敗:' + error.message); return; }
      toast('已刪除');
      closeModal();
      loadList();
    }

    // ====== 事件 ======
    $('collabNewBtn').addEventListener('click', openNew);
    $('collabModalClose').addEventListener('click', closeModal);
    $('collabCancelBtn').addEventListener('click', closeModal);
    $('collabSaveBtn').addEventListener('click', save);
    $('collabDeleteBtn').addEventListener('click', deleteCollab);

    // Slug 即時 preview
    $('cm_slug').addEventListener('input', updateSlugPreview);

    bindColorSync('cm_theme_primary', 'cm_theme_primary_picker');
    bindColorSync('cm_theme_accent', 'cm_theme_accent_picker');
    bindColorSync('cm_theme_bg', 'cm_theme_bg_picker');

    // 主圖上傳綁定 (modal 內,做 1 次)
    bindMainImageUploads();

    // 子表新增
    $('cm_addPkg').addEventListener('click', () => {
      currentPackages.push({ name:'', meta:'', image_url:'' });
      renderPkgList();
    });
    $('cm_addDesign').addEventListener('click', () => {
      currentDesigns.push({ label:'', preview_image_url:'' });
      renderDesignList();
    });
    $('cm_addPhoto').addEventListener('click', () => {
      currentPhotos.push({ image_url:'', caption:'' });
      renderPhotoList();
    });

    // ESC 關閉
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && modal.style.display === 'flex') {
        closeModal();
      }
    });

    // 篩選綁定
    const searchInput = $('collabSearchInput');
    const filterStatusEl = $('collabFilterStatus');
    const filterCatEl = $('collabFilterCategory');
    if(searchInput){
      searchInput.addEventListener('input', () => {
        filterText = searchInput.value.trim();
        renderList();
      });
    }
    if(filterStatusEl){
      filterStatusEl.addEventListener('change', () => {
        filterStatus = filterStatusEl.value;
        renderList();
      });
    }
    if(filterCatEl){
      filterCatEl.addEventListener('change', () => {
        filterCategory = filterCatEl.value;
        renderList();
      });
    }

    // 切到這個 tab 時載入
    document.querySelectorAll('.nav-link[data-page="ip"]').forEach(btn => {
      btn.addEventListener('click', () => {
        setTimeout(loadList, 100);
      });
    });

    // 初次載入
    if(document.querySelector('.content-page[data-page="ip"]')?.classList.contains('active')){
      loadList();
    }
  })();

  // ================================================================
  // 最新消息管理 v2
  // ================================================================
  (function initNewsManager(){
    const sb = function(){
      return window.LohasSupabase && window.LohasSupabase.getClient && window.LohasSupabase.getClient();
    };
    const SUPABASE_BUCKET = window.LohasSupabase?.CONFIG?.STORAGE_BUCKET || 'gallery-uploads';

    const $ = id => document.getElementById(id);
    const list = $('newsList');
    const modal = $('newsEditModal');
    if(!list || !modal) return;

    let currentNews = null;
    const pendingFiles = { cover_image_url: null, homepage_image_url: null };

    let filterText = '', filterStatus = '', filterCategory = '';
    let allNews = [];

    const CAT_LABEL = {
      story: '品牌故事', event: '活動優惠', engraving: '雷刻服務',
      people: '人物誌', member: '會員專區', official: '官方公告'
    };
    const STATUS_LABEL = {
      draft: '草稿', published: '已發佈', scheduled: '已排程', archived: '已下架'
    };

    function toast(msg){ if(window.toast) window.toast(msg); else alert(msg); }
    function esc(s){
      return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }
    function val(id){
      const el = $(id);
      if(!el) return null;
      if(el.type === 'checkbox') return el.checked;
      if(el.type === 'number') return el.value === '' ? null : Number(el.value);
      if(el.type === 'datetime-local') return el.value ? new Date(el.value).toISOString() : null;
      return el.value || null;
    }
    function setVal(id, v){
      const el = $(id);
      if(!el) return;
      if(el.type === 'checkbox'){ el.checked = !!v; return; }
      if(el.type === 'datetime-local' && v){
        try { el.value = new Date(v).toISOString().slice(0, 16); } catch(e){ el.value = ''; }
        return;
      }
      el.value = v == null ? '' : v;
    }
    function getExt(file){
      const m = (file.name || '').match(/\.([a-z0-9]+)$/i);
      return m ? m[1].toLowerCase() : 'jpg';
    }

    async function cropImage(file, aspectStr){
      if(!window.LohasCropper) return file;
      let ratio = NaN;
      if(aspectStr){
        const parts = aspectStr.split(':');
        if(parts.length === 2) ratio = Number(parts[0]) / Number(parts[1]);
      }
      const cropped = await window.LohasCropper.crop(file, {
        aspectRatio: isFinite(ratio) ? ratio : 1,
        title: '裁切圖片 · ' + (aspectStr || '1:1')
      });
      return cropped || null;
    }

    async function uploadFile(file, folder){
      if(!file) return null;
      const client = sb();
      if(!client) throw new Error('Supabase 未配置');
      const filePath = folder + '/' + Date.now() + '-' + crypto.randomUUID() + '.' + getExt(file);
      const { error } = await client.storage.from(SUPABASE_BUCKET).upload(filePath, file, { cacheControl: '3600', upsert: false });
      if(error) throw error;
      const { data } = client.storage.from(SUPABASE_BUCKET).getPublicUrl(filePath);
      return data.publicUrl;
    }

    function resetImagePreview(previewId){
      const el = $(previewId);
      if(!el) return;
      el.innerHTML = '<span class="img-upload-placeholder"><i class="fa-solid fa-image"></i> 點擊上傳</span>';
    }
    function setImagePreview(previewId, url){
      const el = $(previewId);
      if(!el) return;
      if(url){
        el.innerHTML = '<img src="' + esc(url) + '" alt="" />';
      } else {
        resetImagePreview(previewId);
      }
    }

    async function loadList(){
      const client = sb();
      if(!client){ list.innerHTML = '<div class="empty-state">Supabase 未配置</div>'; return; }

      list.innerHTML = '<div class="empty-state">載入中...</div>';
      const { data, error } = await client
        .from('news')
        .select('*')
        .order('published_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });

      if(error){
        list.innerHTML = '<div class="empty-state">載入失敗: ' + esc(error.message) + '</div>';
        return;
      }
      allNews = data || [];
      renderList();
    }

    function renderList(){
      const subEl = $('newsListSub');
      if(subEl) subEl.textContent = allNews.length + ' 篇';

      let arr = allNews;
      if(filterText){
        const q = filterText.toLowerCase();
        arr = arr.filter(n =>
          (n.title || '').toLowerCase().includes(q) ||
          (n.slug || '').toLowerCase().includes(q)
        );
      }
      if(filterStatus) arr = arr.filter(n => n.status === filterStatus);
      if(filterCategory) arr = arr.filter(n => n.category === filterCategory);

      if(!arr.length){
        list.innerHTML = '<div class="empty-state">' + (allNews.length ? '沒有符合篩選的消息' : '還沒有任何消息,點右上「+ 新增消息」開始建立') + '</div>';
        return;
      }

      list.innerHTML = arr.map(n => {
        const cover = n.cover_image_url || n.homepage_image_url;
        const avatarHtml = cover
          ? '<div class="creator-card-avatar" style="background-image:url(\'' + esc(cover) + '\');background-size:cover;background-position:center"></div>'
          : '<div class="creator-card-avatar" style="background:#F4F1EC;color:#9D7E3F"><i class="fa-regular fa-newspaper"></i></div>';

        const homeTag = n.show_in_homepage
          ? '<span class="creator-card-tag featured"><i class="fa-solid fa-house"></i> 首頁</span>' : '';

        const dateStr = n.published_at ? new Date(n.published_at).toISOString().slice(0,10).replace(/-/g, '.') : '—';

        return '<div class="creator-card" data-id="' + esc(n.id) + '">' +
          avatarHtml +
          '<div class="creator-card-body">' +
            '<div class="creator-card-name-row">' +
              '<span class="creator-card-name">' + esc(n.title || '未命名') + '</span>' +
              '<span class="creator-card-tag">' + esc(CAT_LABEL[n.category] || n.category) + '</span>' +
              (function(){
                let cls = '', label = STATUS_LABEL[n.status] || n.status;
                if(n.status === 'published') cls = 'featured';
                else if(n.status === 'draft') cls = 'suspended';
                else if(n.status === 'scheduled'){
                  cls = 'scheduled';
                  if(n.published_at){
                    const t = new Date(n.published_at);
                    const now = new Date();
                    if(t > now){
                      label = '已排程 ' + (t.getMonth()+1) + '/' + t.getDate();
                    } else {
                      label = '已發佈 (排程到時)';
                      cls = 'featured';
                    }
                  }
                }
                return '<span class="creator-card-tag ' + cls + '">' + esc(label) + '</span>';
              })() +
              homeTag +
            '</div>' +
            '<div class="creator-card-meta">' +
              '<code>/news-detail.html?id=' + esc(n.slug) + '</code>' +
              ' · ' + esc(dateStr) +
              (n.view_count ? ' · ' + n.view_count + ' 次瀏覽' : '') +
            '</div>' +
          '</div>' +
          '<div class="creator-card-actions">' +
            '<a class="btn" href="news-detail.html?id=' + esc(n.slug) + '" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i>查看</a>' +
            '<button class="btn" data-act="edit-news" data-id="' + esc(n.id) + '"><i class="fa-regular fa-pen-to-square"></i>編輯</button>' +
          '</div>' +
        '</div>';
      }).join('');

      list.querySelectorAll('[data-act="edit-news"]').forEach(btn => {
        btn.addEventListener('click', () => openEdit(btn.dataset.id));
      });
    }

    function openNew(){
      currentNews = null;
      pendingFiles.cover_image_url = null;
      pendingFiles.homepage_image_url = null;

      $('newsModalTitle').textContent = '新增消息';
      $('newsDeleteBtn').style.display = 'none';
      $('newsPreviewBtn').style.display = 'none';

      ['news_slug','news_title','news_excerpt','news_homepage_tag','news_homepage_subtitle',
       'news_author','news_published_at','news_content','news_homepage_link_url'].forEach(id => setVal(id, ''));
      setVal('news_status', 'draft');
      setVal('news_category', 'story');
      setVal('news_show_in_homepage', false);
      setVal('news_sort_order', 0);
      setVal('news_homepage_link_type', 'news_detail');
      updateLinkUrlVisibility();

      resetImagePreview('news_cover_preview');
      resetImagePreview('news_homepage_image_preview');
      updateSlugPreview();

      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
      bindImageUploads();
    }

    async function openEdit(id){
      const client = sb();
      if(!client) return;

      const { data: n, error } = await client.from('news').select('*').eq('id', id).maybeSingle();
      if(error || !n){ toast('載入失敗'); return; }

      currentNews = n;
      pendingFiles.cover_image_url = null;
      pendingFiles.homepage_image_url = null;

      $('newsModalTitle').textContent = '編輯:' + (n.title || n.slug);
      $('newsDeleteBtn').style.display = '';
      const preview = $('newsPreviewBtn');
      preview.style.display = '';
      preview.href = 'news-detail.html?id=' + encodeURIComponent(n.slug);

      setVal('news_slug', n.slug);
      setVal('news_status', n.status);
      setVal('news_category', n.category);
      setVal('news_title', n.title);
      setVal('news_excerpt', n.excerpt);
      setVal('news_published_at', n.published_at);
      setVal('news_author', n.author);
      setVal('news_show_in_homepage', n.show_in_homepage);
      setVal('news_homepage_tag', n.homepage_tag);
      setVal('news_homepage_subtitle', n.homepage_subtitle);
      setVal('news_sort_order', n.sort_order);
      setVal('news_content', n.content);
      setVal('news_homepage_link_type', n.homepage_link_type || 'news_detail');
      setVal('news_homepage_link_url', n.homepage_link_url);
      updateLinkUrlVisibility();

      setImagePreview('news_cover_preview', n.cover_image_url);
      setImagePreview('news_homepage_image_preview', n.homepage_image_url);
      updateSlugPreview();

      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
      bindImageUploads();
    }

    function closeModal(){
      modal.style.display = 'none';
      document.body.style.overflow = '';
    }

    function updateSlugPreview(){
      const preview = $('news_slug_preview');
      if(preview) preview.textContent = val('news_slug') || 'xxx';
    }

    function updateLinkUrlVisibility(){
      const type = val('news_homepage_link_type');
      const row = $('news_homepage_link_url_row');
      if(row) row.style.display = (type === 'custom') ? '' : 'none';
    }

    function bindImageUploads(){
      const wraps = modal.querySelectorAll('.img-upload-wrap[data-field]');
      console.log('[news] bindImageUploads 找到 wrap 數:', wraps.length, 'modal:', modal?.id);
      wraps.forEach(wrap => {
        if(wrap.dataset.newsBound) return;
        wrap.dataset.newsBound = '1';

        const field = wrap.dataset.field;
        const aspect = wrap.dataset.aspect || '16:9';
        const input = wrap.querySelector('.img-upload-input');
        const preview = wrap.querySelector('.img-upload-preview');
        if(!input || !preview) return;

        console.log('[news] 綁定圖片上傳:', field);

        preview.addEventListener('click', () => {
          console.log('[news] 點預覽,觸發 file input', field);
          input.click();
        });

        input.addEventListener('change', async e => {
          const file = e.target.files?.[0];
          console.log('[news] file change:', field, file?.name, file?.size);
          if(!file) return;

          if(!window.LohasCropper){
            console.error('[news] LohasCropper 沒載入!');
            toast('裁切工具未載入,請重整頁面');
            return;
          }

          console.log('[news] 開始裁切, aspect:', aspect);
          const cropped = await cropImage(file, aspect);
          console.log('[news] 裁切完成:', !!cropped, cropped?.size);
          if(!cropped){ input.value = ''; return; }

          pendingFiles[field] = cropped;
          console.log('[news] pendingFiles 已設定:', field, pendingFiles);

          const reader = new FileReader();
          reader.onload = ev => {
            preview.innerHTML = '<img src="' + ev.target.result + '" alt="" />';
          };
          reader.readAsDataURL(cropped);
          input.value = '';
        });
      });
    }

    async function save(){
      const client = sb();
      if(!client){ toast('Supabase 未配置'); return; }

      let slug = val('news_slug');
      if(!val('news_title')){ toast('標題必填'); return; }
      const status = val('news_status') || 'draft';
      if(status === 'scheduled' && !val('news_published_at')){
        toast('已排程狀態必須填發佈時間');
        return;
      }
      // 沒 slug 就自動生成 (timestamp + 隨機)
      if(!slug){
        slug = 'news-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
      }
      if(!/^[a-z0-9_-]+$/i.test(slug)){ toast('Slug 格式錯誤'); return; }

      let coverUrl = currentNews?.cover_image_url || null;
      let homepageImgUrl = currentNews?.homepage_image_url || null;

      const saveBtn = $('newsSaveBtn');
      saveBtn.disabled = true;
      const saveBtnSpan = saveBtn.querySelector('span');
      if(saveBtnSpan) saveBtnSpan.textContent = '儲存中...';

      try {
        console.log('[news save] pendingFiles:', pendingFiles);
        console.log('[news save] currentNews:', currentNews);

        if(pendingFiles.cover_image_url){
          console.log('[news save] 上傳 cover 圖中...', pendingFiles.cover_image_url.size, 'bytes');
          coverUrl = await uploadFile(pendingFiles.cover_image_url, 'news-cover');
          console.log('[news save] cover 上傳成功:', coverUrl);
        } else {
          console.log('[news save] 沒有新的 cover 檔,沿用:', coverUrl);
        }
        if(pendingFiles.homepage_image_url){
          console.log('[news save] 上傳 homepage 圖中...');
          homepageImgUrl = await uploadFile(pendingFiles.homepage_image_url, 'news-homepage');
          console.log('[news save] homepage 上傳成功:', homepageImgUrl);
        }

        const payload = {
          slug,
          status: status,
          category: val('news_category') || 'story',
          title: val('news_title'),
          excerpt: val('news_excerpt'),
          cover_image_url: coverUrl,
          content: val('news_content'),
          show_in_homepage: val('news_show_in_homepage'),
          homepage_tag: val('news_homepage_tag'),
          homepage_subtitle: val('news_homepage_subtitle'),
          homepage_image_url: homepageImgUrl,
          homepage_link_type: val('news_homepage_link_type') || 'news_detail',
          homepage_link_url: val('news_homepage_link_url'),
          sort_order: val('news_sort_order') || 0,
          published_at: val('news_published_at'),
          author: val('news_author'),
          updated_at: new Date().toISOString()
        };

        if(currentNews && currentNews.id){
          const { error } = await client.from('news').update(payload).eq('id', currentNews.id);
          if(error) throw error;
        } else {
          const { error } = await client.from('news').insert(payload);
          if(error) throw error;
        }

        toast('已儲存');
        closeModal();
        loadList();
      } catch(err){
        console.error(err);
        toast('儲存失敗:' + (err.message || err));
      } finally {
        saveBtn.disabled = false;
        if(saveBtnSpan) saveBtnSpan.textContent = '儲存';
      }
    }

    async function deleteNews(){
      if(!currentNews) return;
      if(!confirm('確定刪除「' + currentNews.title + '」?\n此操作無法復原。')) return;

      const client = sb();
      const { error } = await client.from('news').delete().eq('id', currentNews.id);
      if(error){ toast('刪除失敗:' + error.message); return; }
      toast('已刪除');
      closeModal();
      loadList();
    }

    $('newsAddBtn').addEventListener('click', openNew);
    $('newsModalClose').addEventListener('click', closeModal);
    $('newsCancelBtn').addEventListener('click', closeModal);
    $('newsSaveBtn').addEventListener('click', save);
    $('newsDeleteBtn').addEventListener('click', deleteNews);
    $('news_slug').addEventListener('input', updateSlugPreview);
    $('news_homepage_link_type').addEventListener('change', updateLinkUrlVisibility);

    bindImageUploads();

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && modal.style.display === 'flex') closeModal();
    });

    const searchInput = $('newsSearchInput');
    const filterStatusEl = $('newsFilterStatus');
    const filterCatEl = $('newsFilterCategory');
    if(searchInput){
      searchInput.addEventListener('input', () => {
        filterText = searchInput.value.trim();
        renderList();
      });
    }
    if(filterStatusEl){
      filterStatusEl.addEventListener('change', () => {
        filterStatus = filterStatusEl.value;
        renderList();
      });
    }
    if(filterCatEl){
      filterCatEl.addEventListener('change', () => {
        filterCategory = filterCatEl.value;
        renderList();
      });
    }

    document.querySelectorAll('.nav-link[data-page="cm-news"]').forEach(btn => {
      btn.addEventListener('click', () => setTimeout(loadList, 100));
    });

    if(document.querySelector('.content-page[data-page="cm-news"]')?.classList.contains('active')){
      loadList();
    }
  })();

})(window);
