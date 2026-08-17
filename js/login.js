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
      const mid = member.mid || '';

      /* 不再因為 erpid 為空就擋下來。
         官網註冊只建立 App 會員,客編要到門市消費時才由店員建立與綁定
         (見票券文件附錄三)。那種會員的 client_id 是空的,但有 mid ——
         他應該登得進來,只是票券、禮物、預約這類需要客編的功能不可用。

         兩個都沒有才是真的異常:代表上游回了成功卻沒給任何識別。 */
      if (!erpid && !mid) {
        throw new Error('登入成功，但未取得會員識別，請聯繫客服');
      }

      Auth.saveMember({
        erpid: erpid,
        mid: mid,
        // 未綁定時 erpid 為空,前端據此顯示「綁定門市會員後即可使用」
        isErpBound: member.is_erp_bound === undefined ? !!erpid : !!member.is_erp_bound,
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
