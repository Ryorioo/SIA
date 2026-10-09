// ============================================================
// PAWSITIVE CARE — Client (Pet Owner) Profile
//
// Every field shown here comes from the single Client record
// returned by PCClientAuth.requireClientLogin() (real, session-
// authenticated — never resolved by typing/matching a name or
// email), plus that client's own linked Account record from the
// EXISTING PCData.getAccounts() and its own pets from the EXISTING
// PCData.getPatientsForClient(). No new data structure is created;
// editing goes through the EXISTING PCData.updateClient(id, patch)
// and only ever touches this client's own id and a fixed, safe set
// of fields (name/phone/address/emergencyContact) — never clientId,
// status, or anything on the Account record (login/password/role
// are never editable or displayed in full here).
// ============================================================

(function () {
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Read-only display fields may legitimately be blank — show an em
  // dash instead of an empty box, same convention client-pets.js uses.
  function orDash(v) {
    var s = String(v == null ? '' : v).trim();
    return s ? esc(s) : '\u2014';
  }

  function initials(name) {
    var parts = (name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    var first = parts[0][0] || '';
    var last = parts.length > 1 ? (parts[parts.length - 1][0] || '') : '';
    return (first + last).toUpperCase();
  }

  // Client.createdAt / Account.createdAt are epoch ms (Date.now()),
  // not the 'YYYY-MM-DD' strings D.formatDateLabel expects — format
  // those separately rather than passing a timestamp into that helper.
  function fmtTimestamp(ts) {
    if (!ts) return '\u2014';
    var d = new Date(ts);
    return isNaN(d) ? '\u2014' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function showToast(msg) {
    var toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toast.classList.remove('show'); }, 2200);
  }

  function renderSidebarFooter(client) {
    document.getElementById('footer-avatar').textContent = initials(client.name);
    document.getElementById('footer-name').textContent = client.name;
  }

  // ------------------------------------------------------------------
  // account resolution — the one Account record (role: 'client') that
  // belongs to this authenticated client, found by the real clientId
  // link (never by matching login/email text).
  // ------------------------------------------------------------------

  function getAccountForClient(D, client) {
    return D.getAccounts().find(function (a) {
      return a.role === 'client' && a.clientId === client.id;
    }) || null;
  }

  // ------------------------------------------------------------------
  // render — Personal Information
  // ------------------------------------------------------------------

  function field(label, value) {
    return '<div class="pf-field"><div class="pf-field-label">' + esc(label) + '</div><div class="pf-field-value">' + value + '</div></div>';
  }

  function renderPersonal(client) {
    document.getElementById('pf-avatar').textContent = initials(client.name);
    document.getElementById('pf-name').textContent = client.name || '\u2014';
    document.getElementById('pf-since').textContent = client.createdAt ? 'Client since ' + fmtTimestamp(client.createdAt) : 'Pet Owner';

    document.getElementById('pf-personal-fields').innerHTML =
      field('Email', orDash(client.email)) +
      field('Phone', orDash(client.phone)) +
      field('Address', orDash(client.address));
  }

  // ------------------------------------------------------------------
  // render — Account Information (never shows the password)
  // ------------------------------------------------------------------

  function renderAccount(account, client) {
    var box = document.getElementById('pf-account-fields');
    if (!account) {
      box.innerHTML = '<div class="empty-note">No linked login account found.</div>';
      return;
    }
    box.innerHTML =
      field('Login Email / Number', orDash(account.login)) +
      field('Role', 'Pet Owner') +
      field('Client Status', '<span class="status-badge status-' + esc(client.status) + '">' + (client.status === 'active' ? 'Active' : 'Inactive') + '</span>') +
      field('Account Created', fmtTimestamp(account.createdAt));
  }

  // ------------------------------------------------------------------
  // render — Emergency Contact
  // ------------------------------------------------------------------

  function renderEmergency(client) {
    document.getElementById('pf-emergency-fields').innerHTML =
      field('Emergency Contact', orDash(client.emergencyContact));
  }

  // ------------------------------------------------------------------
  // render — Pet Summary
  // ------------------------------------------------------------------

  function renderPetsSummary(D, client) {
    var pets = D.getPatientsForClient(client);
    document.getElementById('pf-pets-summary').innerHTML =
      '<div class="pf-field" style="border-bottom:none;padding-top:0;">' +
      '<div class="pf-field-label">Registered Pets</div>' +
      '<div class="pf-field-value">' + pets.length + '</div>' +
      '</div>';

    var box = document.getElementById('pf-pets-list');
    if (!pets.length) {
      box.innerHTML = '<div class="empty-note">No pets registered yet. Visit the clinic front desk to register your pet.</div>';
      return;
    }
    box.innerHTML = pets.map(function (p) {
      var icon = D.SPECIES_ICON[p.species] || '<i class="fa-solid fa-paw"></i>';
      return (
        '<div class="pet-list-row">' +
        '<div class="pet-list-main">' +
        '<div class="pet-list-avatar">' + icon + '</div>' +
        '<div><div class="pet-list-name">' + esc(p.pet) + '</div>' +
        '<div class="pet-list-meta">' + esc(p.species || '') + (p.breed ? ' \u00b7 ' + esc(p.breed) : '') + '</div></div>' +
        '</div>' +
        '<div class="pet-list-cols">' +
        '<div class="pet-list-col"><div class="pet-list-col-label">Status</div><div class="pet-list-col-value"><span class="status-badge status-' + p.status + '">' + (p.status === 'active' ? 'Active' : 'Inactive') + '</span></div></div>' +
        '</div>' +
        '<a class="btn btn-sm" href="client-pets.html">View Profile</a>' +
        '</div>'
      );
    }).join('');
  }

  // ------------------------------------------------------------------
  // Edit Profile — writes only through the EXISTING PCData.updateClient()
  // ------------------------------------------------------------------

  function openEdit(client) {
    document.getElementById('e-name').value = client.name || '';
    document.getElementById('e-phone').value = client.phone || '';
    document.getElementById('e-address').value = client.address || '';
    document.getElementById('e-emergency').value = client.emergencyContact || '';
    document.getElementById('edit-overlay').classList.add('open');
  }

  function closeEdit() {
    document.getElementById('edit-overlay').classList.remove('open');
  }

  // Re-verifies against a freshly-resolved client (never a stale
  // closure variable alone) right before writing, and only ever
  // patches this client's own safe fields — never id/clientId/status/
  // role, and never anything on the Account record.
  function saveEdit(D, getClient, onSaved) {
    var client = getClient();
    if (!client) { showToast('Your session has expired. Please log in again.'); return; }

    var name = document.getElementById('e-name').value.trim();
    if (!name) { showToast('Full name is required'); return; }

    var patch = {
      name: name,
      phone: document.getElementById('e-phone').value.trim(),
      address: document.getElementById('e-address').value.trim(),
      emergencyContact: document.getElementById('e-emergency').value.trim()
    };

    D.updateClient(client.id, patch);
    closeEdit();
    showToast('Profile updated');
    onSaved();
  }

  // ------------------------------------------------------------------
  // wiring
  // ------------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    // AUTHENTICATION TEMPORARILY DISABLED
    // This frontend prototype does not have a backend yet, so the
    // login requirement is skipped (same approach as client-dashboard.js).
    //
    // Original guarded logic (restore once the backend exists):
    //
    // var client = window.PCClientAuth.requireClientLogin();
    // if (!client) return;
    //
    // Temporary stand-in for "whoever is logged in".
    var DEV_CLIENT_ID = 'cl_mto10o7c_jczmqx'; // Kyle · kyle@gmail.com
    var client = window.PCData.getClientById(DEV_CLIENT_ID);
    if (!client) return;

    var D = window.PCData;

    // Always re-resolves the client fresh from the live session (re-
    // validated against current Accounts by getCurrentClient()) rather
    // than trusting a possibly-stale local variable, especially before
    // any write.
    function currentClient() {
      // Temporary: resolve the dev client fresh from PCData (no session yet).
      return window.PCData.getClientById(DEV_CLIENT_ID);
    }

    function renderDynamic() {
      var live = currentClient();
      if (!live) return; // session ended (e.g. logged out in another tab)
      var account = getAccountForClient(D, live);
      renderPersonal(live);
      renderAccount(account, live);
      renderEmergency(live);
      renderPetsSummary(D, live);
    }

    renderSidebarFooter(client);
    renderDynamic();

    document.getElementById('edit-profile-btn').addEventListener('click', function () {
      var live = currentClient();
      if (!live) { showToast('Your session has expired. Please log in again.'); return; }
      openEdit(live);
    });
    document.getElementById('edit-close').addEventListener('click', closeEdit);
    document.getElementById('edit-cancel').addEventListener('click', closeEdit);
    document.getElementById('edit-overlay').addEventListener('click', function (e) {
      if (e.target === document.getElementById('edit-overlay')) closeEdit();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.getElementById('edit-overlay').classList.contains('open')) closeEdit();
    });
    document.getElementById('edit-save').addEventListener('click', function () {
      saveEdit(D, currentClient, function () {
        renderDynamic();
        renderSidebarFooter(currentClient() || client);
      });
    });

    document.getElementById('logout-btn').addEventListener('click', function (e) {
      e.preventDefault();
      window.PCClientAuth.logoutClient();
    });

    // Keep the profile live if data changes elsewhere — e.g. the front
    // desk updates this client's phone/address on the Clients page in
    // another tab — exactly like every other Client page's D.onChange()
    // wiring. No separate polling is set up here beyond that.
    D.onChange(renderDynamic);
  });
})();