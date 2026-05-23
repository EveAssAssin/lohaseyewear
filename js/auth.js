(function (window) {
  'use strict';

  const Utils = window.LohasUtils;

  const CONFIG = {
    PROXY_URL: 'https://lohas-proxy-nwad.onrender.com/api',
    API_KEY: 'bfjY2jssj9dDajq0',
    API_VER: '0.1.0',
    STORAGE_KEY: 'lohasMember',
    REDIRECT_KEY: 'redirectAfterLogin',
    EXPIRE_DAYS: 7   // 登入 7 天未操作自動登出
  };

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

  async function apiPost(path, payloadData) {
    const response = await fetch(`${CONFIG.PROXY_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          apikey: CONFIG.API_KEY,
          apiver: CONFIG.API_VER,
          data: payloadData
        }
      })
    });

    return response.json();
  }

  async function loginWithAccount(account, password) {
    const result = await apiPost('/proxy/officialWed/login', { account, password });

    if (Utils.normalizeApiCode(result.code) !== '200') {
      throw new Error(result.message || result.errmessage || '帳號或密碼錯誤');
    }

    return result;
  }

  function logout() {
    clearMember();
    window.location.href = 'login.html';
  }

  window.LohasAuth = {
    CONFIG,
    apiPost,
    loginWithAccount,
    getStoredMember,
    saveMember,
    clearMember,
    isLogin,
    requireLogin,
    getRedirect,
    setRedirect,
    logout
  };
})(window);
