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

  function getLoginName(loginResult) {
    return loginResult.data?.erpname ||
      loginResult.data?.erpName ||
      loginResult.data?.name ||
      '';
  }

  async function fetchProfileByClientId(erpid) {
    const result = await Auth.apiPost('/proxy/member/list', {
      client_id: Number(erpid)
    });

    if (Utils.normalizeApiCode(result.code) !== '200' || !result.data) {
      throw new Error('登入成功，但查無完整會員資料');
    }

    return result.data;
  }

  async function handleLogin() {
    const account = accountInput?.value.trim() || '';
    const password = passwordInput?.value.trim() || '';

    if (!account || !password) {
      showError('請輸入 APP帳號與密碼');
      return;
    }

    clearError();
    setLoading(true);

    try {
      const loginResult = await Auth.loginWithAccount(account, password);
      const erpid = loginResult.data?.erpid;
      const loginName = getLoginName(loginResult);

      if (!erpid) {
        throw new Error('登入成功，但未取得會員編號');
      }

      let member;

      try {
        member = await fetchProfileByClientId(erpid);
      } catch (profileError) {
        console.warn('[會員資料讀取失敗，改用登入資料]', profileError);

        member = {
          client_id: erpid,
          name: loginName,
          mobile: '',
          email: '',
          birthday: ''
        };
      }

      Auth.saveMember({
        erpid: member.client_id || erpid,
        name: member.name || loginName || '',
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
