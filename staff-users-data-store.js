// ============================================================
// PAWSITIVE CARE — Staff & Users domain layer
//
// Sits between the shared data-store (PCData, which owns the ONE
// Accounts persistence mechanism — used by both Client authentication
// and this module) and the Staff & Users UI (staff-users.js).
//
//   data-store.js  --owns storage-->  PCData.getAccounts() / addAccount()
//                                       / updateAccount() / getAccountById()
//         |
//         v
//   staff-users-data-store.js  --domain logic-->  PCStaffUsers.*
//         |
//         v
//   staff-users.js  --DOM/rendering-->  staff-users.html
//
// This file holds NO storage of its own — no localStorage key, no
// separate account array. Every function here reads/writes Accounts
// exclusively through PCData's existing functions, so Client accounts
// (used by client-session.js for Pet Owner login) and Staff accounts
// remain the same single Account system.
//
// What lives here vs. data-store.js:
//   - Role/status constants, labels: Staff & Users presentation
//     concepts. data-store.js's own account logic (mkAccount,
//     normalizeAccount, seeding) works fine with raw string literals
//     and doesn't need these lists, so they belong here, not there.
//   - Row-building, filtering, summary counts: purely about how Staff
//     & Users displays accounts. No other module needs them.
//   - Administrator safeguard (countOtherActiveAdmins) and the
//     create/update/toggle helpers: business rules specific to
//     managing accounts from this page. Client authentication in
//     client-session.js never calls these.
// ============================================================

(function (global) {
  function hasPCData() {
    return !!(global.PCData && global.PCData.getAccounts && global.PCData.getClientById);
  }

  // ------------------------------------------------------------------
  // role / status constants — the single source of truth for these
  // strings within the Staff & Users module. (Client authentication
  // in client-session.js only ever compares against the literal
  // 'client' role, so it has no dependency on this list.)
  // ------------------------------------------------------------------
  var STAFF_ROLES = ['administrator', 'veterinarian', 'receptionist', 'staff'];
  var ROLES = STAFF_ROLES.concat(['client']);
  var ROLE_LABELS = {
    administrator: 'Administrator',
    veterinarian: 'Veterinarian',
    receptionist: 'Receptionist',
    staff: 'Staff',
    client: 'Client'
  };

  var ACCOUNT_STATUSES = ['active', 'inactive'];
  var ACCOUNT_STATUS_LABELS = { active: 'Active', inactive: 'Inactive' };

  function normalizeLogin(login) {
    return (login || '').trim().toLowerCase();
  }

  // ------------------------------------------------------------------
  // rows — one view row per Account, with the display name and (for
  // Client accounts) the linked Client resolved via clientId.
  // ------------------------------------------------------------------
  function getRows() {
    if (!hasPCData()) return [];
    return global.PCData.getAccounts().map(function (account) {
      var client = account.role === 'client' ? global.PCData.getClientById(account.clientId) : null;
      var displayName = account.role === 'client'
        ? (client ? client.name : '(linked client not found)')
        : (account.name || account.login);
      return { account: account, client: client, displayName: displayName };
    });
  }

  // filters: { search, role, status } — role/status of 'all' means no filter.
  function filterRows(rows, filters) {
    filters = filters || {};
    var role = filters.role || 'all';
    var status = filters.status || 'all';
    var search = (filters.search || '').trim().toLowerCase();

    return rows.filter(function (row) {
      if (role !== 'all' && row.account.role !== role) return false;
      if (status !== 'all' && row.account.status !== status) return false;
      if (search) {
        var hay = (row.displayName + ' ' + row.account.login).toLowerCase();
        if (hay.indexOf(search) === -1) return false;
      }
      return true;
    });
  }

  // ------------------------------------------------------------------
  // summary counts
  // ------------------------------------------------------------------
  function getSummary(rows) {
    rows = rows || getRows();
    return {
      total: rows.length,
      active: rows.filter(function (r) { return r.account.status === 'active'; }).length,
      staff: rows.filter(function (r) { return STAFF_ROLES.indexOf(r.account.role) !== -1; }).length,
      clients: rows.filter(function (r) { return r.account.role === 'client'; }).length
    };
  }

  // ------------------------------------------------------------------
  // Administrator safeguard — how many OTHER active Administrator
  // accounts exist besides excludeId. Callers block a deactivation or
  // a role-change-away-from-administrator whenever this returns 0, so
  // the system is never left without an Administrator.
  // ------------------------------------------------------------------
  function countOtherActiveAdmins(excludeId) {
    return global.PCData.getAccounts().filter(function (a) {
      return a.role === 'administrator' && a.status === 'active' && a.id !== excludeId;
    }).length;
  }

  function getAccount(id) {
    return global.PCData.getAccountById(id);
  }

  // ------------------------------------------------------------------
  // mutations — every one resolves the real Account by id (never by
  // name/login) before touching it, and every one goes through
  // PCData's existing addAccount()/updateAccount() so there is still
  // only one place Accounts are actually written.
  // ------------------------------------------------------------------

  // Creates a STAFF-side account only (never a Client account — those
  // stay owned by the Client workflow). Returns { ok: true, account }
  // or { ok: false, error }.
  function createStaffAccount(fields) {
    var name = (fields.name || '').trim();
    var login = (fields.login || '').trim();
    var role = fields.role;
    var password = fields.password || '';

    if (!name) return { ok: false, error: 'Please enter a name.' };
    if (!login) return { ok: false, error: 'Please enter an email or login.' };
    if (STAFF_ROLES.indexOf(role) === -1) return { ok: false, error: 'Please choose a valid staff role.' };
    if (!password) return { ok: false, error: 'Please set a temporary password.' };
    if (global.PCData.accountExists(login)) return { ok: false, error: 'An account with that login already exists.' };

    var account = global.PCData.addAccount({
      name: name,
      login: login,
      password: password,
      role: role,
      clientId: null,
      status: 'active'
    });
    return { ok: true, account: account };
  }

  // Edits a STAFF-side account's name/login/role. Client accounts are
  // never edited through this function — Staff & Users only offers
  // View/Activate-Deactivate for Client accounts. Returns
  // { ok: true, account } or { ok: false, error }.
  function updateStaffAccount(id, fields) {
    var account = getAccount(id);
    if (!account) return { ok: false, error: 'Account not found.' };

    var name = (fields.name || '').trim();
    var login = (fields.login || '').trim();
    var role = fields.role;

    if (!name) return { ok: false, error: 'Please enter a name.' };
    if (!login) return { ok: false, error: 'Please enter an email or login.' };
    if (STAFF_ROLES.indexOf(role) === -1) return { ok: false, error: 'Please choose a valid staff role.' };

    var loginTaken = global.PCData.getAccounts().some(function (a) {
      return a.id !== account.id && normalizeLogin(a.login) === normalizeLogin(login);
    });
    if (loginTaken) return { ok: false, error: 'Another account already uses that login.' };

    var wasActiveAdmin = account.role === 'administrator' && account.status === 'active';
    var willBeAdmin = role === 'administrator';
    if (wasActiveAdmin && !willBeAdmin && countOtherActiveAdmins(account.id) === 0) {
      return { ok: false, error: 'Cannot change role: at least one active Administrator is required.' };
    }

    var updated = global.PCData.updateAccount(account.id, { name: name, login: login, role: role });
    return { ok: true, account: updated };
  }

  // Flips an account's status, enforcing the last-Administrator
  // safeguard. Returns { ok: true, account } or { ok: false, error }.
  function toggleAccountStatus(id) {
    var account = getAccount(id);
    if (!account) return { ok: false, error: 'Account not found.' };

    var goingInactive = account.status === 'active';
    if (account.role === 'administrator' && goingInactive && countOtherActiveAdmins(id) === 0) {
      return { ok: false, error: 'Cannot deactivate: at least one active Administrator is required.' };
    }

    var updated = global.PCData.updateAccount(id, { status: goingInactive ? 'inactive' : 'active' });
    return { ok: true, account: updated };
  }

  function onChange(cb) {
    if (global.PCData && global.PCData.onChange) global.PCData.onChange(cb);
  }

  global.PCStaffUsers = {
    ROLES: ROLES,
    STAFF_ROLES: STAFF_ROLES,
    ROLE_LABELS: ROLE_LABELS,
    ACCOUNT_STATUSES: ACCOUNT_STATUSES,
    ACCOUNT_STATUS_LABELS: ACCOUNT_STATUS_LABELS,
    getRows: getRows,
    filterRows: filterRows,
    getSummary: getSummary,
    getAccount: getAccount,
    countOtherActiveAdmins: countOtherActiveAdmins,
    createStaffAccount: createStaffAccount,
    updateStaffAccount: updateStaffAccount,
    toggleAccountStatus: toggleAccountStatus,
    onChange: onChange
  };
})(window);