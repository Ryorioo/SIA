// ============================================================
// PAWSITIVE CARE — shared login page (Administrator + Client)
// Thin DOM wiring only — all actual authentication/session logic
// lives in client-session.js (PCClientAuth), so it stays reusable
// and testable without a form on the page.
//
// There is no role selector — the same login + password fields work
// for both an Administrator and a Pet Owner (Client) account. The
// role is read back from result.role (sourced from the account's own
// `role` field in data-store.js) and used only to pick the redirect
// destination after a successful login.
// ============================================================

(function () {
  // Where each role lands after a successful login.
  var DASHBOARD_BY_ROLE = {
    administrator: 'dashboard.html',
    client: 'client-dashboard.html'
  };

  function showError(msg) {
    var el = document.getElementById('login-error');
    if (!el) return;
    el.textContent = msg;
    el.style.display = msg ? 'block' : 'none';
  }

  function handleSubmit(e) {
    e.preventDefault();
    showError('');

    var login = document.getElementById('login-input').value;
    var password = document.getElementById('password-input').value;

    var result = window.PCClientAuth.authenticate(login, password);

    if (!result.ok) {
      showError(result.error);
      return;
    }

    window.PCClientAuth.setSession(result.account.id, result.role, result.client ? result.client.id : null);
    window.location.href = DASHBOARD_BY_ROLE[result.role] || 'client-dashboard.html';
  }

  document.addEventListener('DOMContentLoaded', function () {
    // Already logged in for this tab — skip straight to the right
    // portal instead of showing the login form again.
    var session = window.PCClientAuth.getCurrentSession();
    if (session) {
      window.location.href = DASHBOARD_BY_ROLE[session.role] || 'client-dashboard.html';
      return;
    }

    var form = document.getElementById('login-form');
    form.addEventListener('submit', handleSubmit);
  });
})();