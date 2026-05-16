(function (window) {
  'use strict';

  const Utils = window.LohasUtils;

  const CONFIG = {
    PROXY_URL: 'https://lohas-proxy.onrender.com/api',
    API_KEY: 'bfjY2jssj9dDajq0',
    API_VER: '0.1.0',
    STORAGE_KEY: 'lohasMember',
    REDIRECT_KEY: 'redirectAfterLogin'
  };

  function getStoredMember() {
    return Utils.safeJsonParse(localStorage.getItem(CONFIG.STORAGE_KEY), null);
  }

  function saveMember(member) {
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(member));
  }

  function clearMember() {
    localStorage.removeItem(CONFIG.STORAGE_KEY);
  }

  function isLogin() {
    return !!getStoredMember();
  }

  function getRedirect(defaultPath) {
    const redirect = localStorage.getItem(CONFIG.REDIRECT_KEY) || defaultPath || 'login.html';
    localStorage.removeItem(CONFIG.REDIRECT_KEY);
    return redirect;
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
    logout
  };
})(window);
