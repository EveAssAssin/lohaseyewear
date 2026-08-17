(function (window) {
  'use strict';

  const Utils = window.LohasUtils;

  const CONFIG = {
    // 前端不再持有任何 API 金鑰。需要金鑰的呼叫一律經 Edge Function。
    STORAGE_KEY: 'lohasMember',
    TOKEN_KEY: 'lohasSessionToken',
    REDIRECT_KEY: 'redirectAfterLogin',
    EXPIRE_DAYS: 7,  // 登入 7 天未操作自動登出
    // 伺服器端登入/驗證端點(金鑰在後端,前端不持有)
    SESSION_FN: 'https://hqdmyxxrskvllkcedybl.supabase.co/functions/v1/auth-session'
  };

  /* -----------------------------------------------------------
     Session token
     -----------------------------------------------------------
     與既有 lohasMember 機制「並存」,不取代。
     現有頁面全部照舊運作;只有需要伺服器端驗證身分的功能
     (如票券 API)才使用此 token。
     ----------------------------------------------------------- */

  function getToken() {
    return localStorage.getItem(CONFIG.TOKEN_KEY) || '';
  }

  function saveToken(token) {
    if (token) localStorage.setItem(CONFIG.TOKEN_KEY, token);
  }

  function clearToken() {
    localStorage.removeItem(CONFIG.TOKEN_KEY);
  }

  /**
   * 伺服器端登入:由 Edge Function 驗證帳密並簽發 token。
   * 成功回傳 { token, member };失敗丟出錯誤由呼叫端決定是否回退舊流程。
   */
  async function loginViaSession(account, password) {
    const res = await fetch(CONFIG.SESSION_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', account: account, password: password })
    });
    const json = await res.json();
    if (String(json.code) !== '200' || !json.token) {
      const err = new Error(json.message || '登入失敗');
      err.serverRejected = res.status === 401;   // 401 = 帳密真的錯,不該回退
      throw err;
    }
    return json;
  }

  function getStoredMember() {
    return Utils.safeJsonParse(localStorage.getItem(CONFIG.STORAGE_KEY), null);
  }

  // 在現有 member 物件上加 loginAt 時間戳,
  // 注意: SSO 端 (ssologin.html) 也會自己寫 loginAt,這裡 fallback 也加上
  function saveMember(member) {
    const withTimestamp = Object.assign({}, member, {
      loginAt: member.loginAt || Date.now()
    });
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(withTimestamp));
  }

  function clearMember() {
    localStorage.removeItem(CONFIG.STORAGE_KEY);
    localStorage.removeItem(CONFIG.TOKEN_KEY);
  }

  /* 這個會員有沒有綁定門市(ERP 客編)。
     -----------------------------------------------------------
     官網註冊只建立 App 會員,客編是空的 —— 票券、禮物、門市預約這類
     需要客編的功能對他不可用,要到門市消費時由店員建立與綁定。

     判斷一律走這支,不要各頁自己讀 erpid 再判斷 ——
     舊資料沒有 isErpBound 欄位,那些頁面會全部誤判成未綁定。
     這裡以 erpid 有沒有值作為退路。 */
  function isErpBound() {
    const m = getStoredMember();
    if (!m) return false;
    if (m.isErpBound !== undefined) return !!m.isErpBound;
    return !!m.erpid;
  }

  /* 需要客編的功能統一用這句,措辭一致。
     刻意不寫「請先綁定」——客人自己綁不了,那是門市人員做的事,
     叫他去做一件他做不到的事只會讓人更困惑。 */
  function erpRequiredNote() {
    return '這項功能需要門市會員身分。第一次到樂活門市時,店員會協助你完成綁定,不需另外準備什麼。';
  }

  // 7 天未操作視為過期,自動清除登入狀態
  function isLogin() {
    const member = getStoredMember();
    if (!member) return false;

    // 若無 loginAt (舊資料),視為仍有效一次,並補上時間戳
    if (!member.loginAt) {
      saveMember(member);
      return true;
    }

    const ageMs    = Date.now() - Number(member.loginAt);
    const maxAgeMs = CONFIG.EXPIRE_DAYS * 24 * 60 * 60 * 1000;

    if (ageMs > maxAgeMs) {
      // 過期,自動清除
      clearMember();
      return false;
    }
    return true;
  }

  function getRedirect(defaultPath) {
    const redirect = localStorage.getItem(CONFIG.REDIRECT_KEY) || defaultPath || 'login.html';
    localStorage.removeItem(CONFIG.REDIRECT_KEY);
    return redirect;
  }

  // 設定登入後要跳轉的目標頁
  function setRedirect(path) {
    if (path) localStorage.setItem(CONFIG.REDIRECT_KEY, path);
  }

  function requireLogin(returnPath) {
    if (!isLogin()) {
      localStorage.setItem(CONFIG.REDIRECT_KEY, returnPath || window.location.pathname.split('/').pop() || 'gallery.html');
      window.location.href = 'login.html';
      return false;
    }
    return true;
  }

  /* 2026-08-09 移除 apiPost() 與 loginWithAccount()
     -----------------------------------------------------------
     這兩個函式會在瀏覽器裡直接帶著 ERP apikey 打代理,
     等於把金鑰印在公開 repo 上。登入已全面改走 loginViaSession()
     (金鑰留在 auth-session Edge Function),前端不再需要持有任何金鑰。

     管理後台的會員查詢原本也用 apiPost,已改走 member-lookup Edge Function。 */

  function logout() {
    clearMember();
    clearToken();
    window.location.href = 'login.html';
  }

  window.LohasAuth = {
    CONFIG,
    loginViaSession,
    getStoredMember,
    saveMember,
    clearMember,
    isErpBound,
    erpRequiredNote,
    getToken,
    saveToken,
    clearToken,
    isLogin,
    requireLogin,
    getRedirect,
    setRedirect,
    logout
  };
})(window);
