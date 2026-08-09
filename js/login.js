(function (window) {
  'use strict';

  const Utils = window.LohasUtils;
  const Auth = window.LohasAuth;

  const loginBtn = Utils.$('#login-btn');
  const errorMsg = Utils.$('#error-msg');
  const accountInput = Utils.$('#account');
  const passwordInput = Utils.$('#password');

  function showError(message) {
    if (!errorMsg) return;
    errorMsg.innerText = message;
    Utils.show(errorMsg);
  }

  function clearError() {
    if (!errorMsg) return;
    errorMsg.innerText = '';
    Utils.hide(errorMsg);
  }

  function setLoading(status) {
    if (!loginBtn) return;
    loginBtn.disabled = status;
    loginBtn.innerText = status ? '登入中...' : '登入';
  }

  async function handleLogin() {
    if (loginBtn?.disabled) return;   // 防連按 / Enter 連送

    const account = accountInput?.value.trim() || '';
    // 密碼不 trim — 使用者若密碼前後有空白,trim 後永遠登不進來
    const password = passwordInput?.value || '';

    if (!account || !password) {
      showError('請輸入 APP 帳號與密碼');
      return;
    }

    clearError();
    setLoading(true);

    try {
      // 只有一條路徑:伺服器端驗證並簽發 session token。
      //
      // 原本還有一條「前端直接打代理」的回退路徑,已於 2026-08-09 移除。
      // 那條路徑必須在瀏覽器裡持有 ERP apikey,而本站是公開 repo,
      // 等於把金鑰公開。安全性優先於「auth-session 掛掉時還能登入」。
      const s = await Auth.loginViaSession(account, password);
      Auth.saveToken(s.token);

      const member = s.member || {};
      const erpid = member.client_id || '';
      if (!erpid) throw new Error('登入成功，但未取得會員編號，請聯繫客服');

      Auth.saveMember({
        erpid: erpid,
        name: member.name || '',
        mobile: member.mobile || '',
        email: member.email || '',
        birthday: member.birthday || ''
      });

      const redirect = Auth.getRedirect('member-portal.html');
      window.location.href = redirect && redirect !== 'login.html' ? redirect : 'member-portal.html';
    } catch (error) {
      console.error('[登入錯誤]', error);
      showError(error.message || '連線失敗，請稍後再試');
    } finally {
      setLoading(false);
    }
  }

  loginBtn?.addEventListener('click', handleLogin);

  passwordInput?.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') handleLogin();
  });
})(window);
