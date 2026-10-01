// ============================================================
// PAWSITIVE CARE — shared account session helper
//
// This is the ONLY file that knows how a logged-in account (either
// role) is identified. It does not create a new account/database
// system — it authenticates against the existing PCData.getAccounts()
// / PCData.getClientById() (see data-store.js), and simply remembers
// which account is "logged in" for this browser tab via
// sessionStorage.
//
// Originally this file only handled the Client (Pet Owner) role —
// PCClientAuth.authenticateClient()/getCurrentClient()/
// requireClientLogin() are kept working exactly as before so no
// existing Client-portal page needs to change. The login/session
// logic underneath has been generalized so the SAME login form
// (client-login.html) can also authenticate Administrator accounts —
// there is still no role selector; the role is read from the
// account's own `role` field (see data-store.js) after login.
//
// Every Client-portal page (client-dashboard.html, My Pets,
// Appointments, etc.) still calls PCClientAuth.requireClientLogin()
// to get the current Client record, or bounce back to
// client-login.html if there isn't one. Administrator pages (e.g.
// dashboard.html) call the new PCClientAuth.requireAdminLogin()
// instead, so a Client session can't reach an Administrator page and
// vice versa.
//
// NOTE: like the rest of this mock/localStorage-based system, this
// is client-side session *scoping*, not real server-side security —
// passwords and session data are plainly inspectable in devtools.
// That matches the trust model already used elsewhere in the app.
// ============================================================

(function (global) {
  // Key name kept as-is (not renamed to something role-neutral like
  // 'pcv1_session') so a tab that already has an old-shape Client
  // session ({ accountId, clientId, loggedInAt }, no `role`) still
  // reads back correctly — see normalizeSession() below — instead of
  // being silently logged out the first time this file is updated.
  var SESSION_KEY = 'pcv1_client_session';

  function hasPCData() {
    return !!(global.PCData && global.PCData.getAccounts && global.PCData.getClientById);
  }

  function normalizeLogin(login) {
    return (login || '').trim().toLowerCase();
  }

  // ------------------------------------------------------------------
  // authentication — pure functions, no DOM/session side effects, so
  // they're easy to call from client-login.js AND to unit test directly.
  // ------------------------------------------------------------------

  // General-purpose login: works for ANY account role. Returns one of:
  //   { ok: true, role, account, client }   // client is set only when role === 'client'
  //   { ok: false, errorCode, error }
  // errorCode is one of:
  //   'no_data_store' | 'not_found' | 'bad_password' | 'inactive' |
  //   'no_client' | 'unsupported_role'
  function authenticate(login, password) {
    if (!hasPCData()) {
      return { ok: false, errorCode: 'no_data_store', error: 'The system is not ready yet — please reload the page.' };
    }

    var norm = normalizeLogin(login);
    if (!norm) {
      return { ok: false, errorCode: 'not_found', error: 'Please enter your email or contact number.' };
    }

    var account = global.PCData.getAccounts().find(function (a) {
      return normalizeLogin(a.login) === norm;
    });

    if (!account) {
      return { ok: false, errorCode: 'not_found', error: 'No account found with that login.' };
    }
    if (account.password !== password) {
      return { ok: false, errorCode: 'bad_password', error: 'Incorrect password.' };
    }
    // Account.status is separate from Client.status — this account's
    // login has been disabled (e.g. via Staff & Users) even though the
    // Client record itself may still be active. Checked before the
    // role branch below so a deactivated account of either role is
    // rejected the same way.
    if (account.status === 'inactive') {
      return { ok: false, errorCode: 'inactive', error: 'This account has been deactivated. Please contact the clinic.' };
    }

    if (account.role === 'client') {
      var client = global.PCData.getClientById(account.clientId);
      if (!client) {
        return { ok: false, errorCode: 'no_client', error: 'This account is not linked to a client record. Please contact the clinic.' };
      }
      return { ok: true, role: 'client', account: account, client: client };
    }

    if (account.role === 'administrator') {
      return { ok: true, role: 'administrator', account: account, client: null };
    }

    // Other staff roles (veterinarian/receptionist/staff, etc. — see
    // staff-users-data-store.js) exist in the Accounts store but this
    // shared login only knows how to route Administrator and Client
    // accounts so far; reject explicitly rather than silently letting
    // an unhandled role fall through with no destination page.
    return { ok: false, errorCode: 'unsupported_role', error: 'This account type cannot sign in here yet.' };
  }

  // Backward-compatible wrapper: same behavior as before this change
  // (rejects any non-client role with 'wrong_role'). Kept for any
  // existing caller that still wants Client-only login semantics.
  function authenticateClient(login, password) {
    var result = authenticate(login, password);
    if (result.ok && result.role !== 'client') {
      return { ok: false, errorCode: 'wrong_role', error: 'This login is not a Pet Owner account.' };
    }
    return result;
  }

  // ------------------------------------------------------------------
  // session storage — sessionStorage (not localStorage) so a logged-in
  // session naturally ends when the browser tab is closed, and never
  // mixes into the pcv1_* localStorage keys PCData owns.
  // ------------------------------------------------------------------

  function readSessionRaw() {
    try {
      var v = global.sessionStorage.getItem(SESSION_KEY);
      return v ? JSON.parse(v) : null;
    } catch (e) {
      return null;
    }
  }

  // Backfills `role` on a session written before this change existed —
  // those sessions are always Client sessions (this file only ever
  // wrote Client sessions before), so a missing `role` defaults to
  // 'client' rather than being treated as invalid.
  function normalizeSession(session) {
    if (!session) return null;
    if (!session.role) session.role = 'client';
    return session;
  }

  // General-purpose session writer. clientId is only meaningful (and
  // only stored) for role === 'client'.
  function setSession(accountId, role, clientId) {
    try {
      global.sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        accountId: accountId,
        role: role,
        clientId: role === 'client' ? clientId : null,
        loggedInAt: Date.now()
      }));
      return true;
    } catch (e) {
      return false;
    }
  }

  // Backward-compatible wrapper — unchanged signature/behavior.
  function setClientSession(accountId, clientId) {
    return setSession(accountId, 'client', clientId);
  }

  function clearSession() {
    try {
      global.sessionStorage.removeItem(SESSION_KEY);
    } catch (e) {
      // ignore — nothing to clear
    }
  }

  // Backward-compatible alias.
  function clearClientSession() {
    clearSession();
  }

  // Resolves the stored session back to a live { account, role, client }
  // record, re-checking against current Accounts each time (not just
  // trusting the cached session) so a since-deleted/edited account
  // can't leave a stale, dangling session pointing at the wrong
  // account/client. Returns null (and clears the session) if anything
  // no longer lines up.
  function getCurrentSession() {
    if (!hasPCData()) return null;

    var session = normalizeSession(readSessionRaw());
    if (!session || !session.accountId || !session.role) return null;

    if (session.role === 'client') {
      if (!session.clientId) return null;
      var clientAccount = global.PCData.getAccounts().find(function (a) {
        return a.id === session.accountId && a.role === 'client' && a.clientId === session.clientId && a.status !== 'inactive';
      });
      if (!clientAccount) {
        clearSession();
        return null;
      }
      var client = global.PCData.getClientById(session.clientId);
      if (!client) {
        clearSession();
        return null;
      }
      return { account: clientAccount, role: 'client', client: client };
    }

    if (session.role === 'administrator') {
      var adminAccount = global.PCData.getAccounts().find(function (a) {
        return a.id === session.accountId && a.role === 'administrator' && a.status !== 'inactive';
      });
      if (!adminAccount) {
        clearSession();
        return null;
      }
      return { account: adminAccount, role: 'administrator', client: null };
    }

    // Unknown/unsupported role stored somehow — treat as no session.
    clearSession();
    return null;
  }

  // Backward-compatible: returns the live Client record ONLY when the
  // current session is a Client session — an Administrator session
  // (or no session) returns null here, exactly as before this change,
  // so existing Client-portal guards/pages keep working unmodified.
  function getCurrentClient() {
    var session = getCurrentSession();
    return (session && session.role === 'client') ? session.client : null;
  }

  // New: returns the live Administrator account when the current
  // session is an Administrator session, else null.
  function getCurrentAdmin() {
    var session = getCurrentSession();
    return (session && session.role === 'administrator') ? session.account : null;
  }

  // ------------------------------------------------------------------
  // guards — for portal pages to call on load.
  // ------------------------------------------------------------------
  function requireClientLogin(loginPageUrl) {
    var client = getCurrentClient();
    if (!client) {
      global.location.href = loginPageUrl || 'client-login.html';
      return null;
    }
    return client;
  }

  // New: guard for Administrator pages (e.g. dashboard.html). Mirrors
  // requireClientLogin() exactly, just checking for an Administrator
  // session instead of a Client one.
  function requireAdminLogin(loginPageUrl) {
    var admin = getCurrentAdmin();
    if (!admin) {
      global.location.href = loginPageUrl || 'client-login.html';
      return null;
    }
    return admin;
  }

  // ------------------------------------------------------------------
  // logout — clears the session, regardless of role, and redirects
  // back to the shared login page by default.
  // ------------------------------------------------------------------
  function logoutClient(redirectUrl) {
    clearSession();
    global.location.href = redirectUrl || 'client-login.html';
  }

  global.PCClientAuth = {
    // generalized (new)
    authenticate: authenticate,
    setSession: setSession,
    getCurrentSession: getCurrentSession,
    getCurrentAdmin: getCurrentAdmin,
    requireAdminLogin: requireAdminLogin,
    clearSession: clearSession,

    // backward-compatible (unchanged names/behavior)
    authenticateClient: authenticateClient,
    setClientSession: setClientSession,
    getCurrentClient: getCurrentClient,
    clearClientSession: clearClientSession,
    requireClientLogin: requireClientLogin,
    logoutClient: logoutClient
  };
})(window);