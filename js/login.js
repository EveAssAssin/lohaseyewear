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
      // ── 路徑 A(優先):伺服器端驗證,取得 session token ──
      // 金鑰留在 Edge Function,前端不持有;token 供票券等需驗身分的功能使用。
      let member = null;
      let erpid = '';
      let loginName = '';

      try {
        const s = await Auth.loginViaSession(account, password);
        Auth.saveToken(s.token);
        member = s.member || {};
        erpid = member.client_id || '';
        loginName = member.name || '';
      } catch (sessionError) {
        // 帳密確實錯誤 → 直接報錯,不要用舊路徑再試一次
        if (sessionError.serverRejected) throw sessionError;
        // 其他情況(函式未部署/連線失敗)→ 回退舊路徑,確保登入不中斷
        console.warn('[login] 伺服器端登入不可用,回退既有流程:', sessionError.message);
      }

      // ── 路徑 B(回退):既有前端流程 ──
      if (!erpid) {
        const loginResult = await Auth.loginWithAccount(account, password);
        erpid = loginResult.data?.erpid;
        loginName = getLoginName(loginResult);

        if (!erpid) {
          throw new Error('登入成功，但未取得會員編號');
        }

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
