// ============================================================
// PAWSITIVE CARE — Administrator "Staff & Users" page
//
// UI/rendering layer only. All account-management logic (role/status
// constants, row/filter/summary queries, create/edit/toggle mutations,
// Administrator safeguards) lives in staff-users-data-store.js
// (PCStaffUsers), which in turn uses the shared PCData Account
// functions in data-store.js. This file never talks to PCData
// directly and never reimplements business rules.
//
// Add User modal: the Staff branch creates real accounts through
// PCStaffUsers.createStaffAccount() (Phase 5C). The Client branch is
// still FRONTEND ONLY — it validates and shows a toast but never
// writes to PCData / localStorage.
// ============================================================

(function () {
  var state = {
    search: '',
    role: 'all',
    status: 'all',
    type: 'all', // account-type tab: 'all' | 'staff' | 'client'
    modal: null, // { mode: 'add' | 'view' | 'edit', accountId? }
    triggerSel: null // selector of the control that opened the modal (for focus return)
  };
  var modalIsOpen = false;

  // Add User form state (Phase 4A, UI only). Reset every time the modal opens.
  var addState = { type: 'staff', client: null, comboActive: -1, comboOpen: false };
  var toastTimer = null;
  var submitting = false; // guards against duplicate Create User handling

  // ------------------------------------------------------------------
  // TEMPORARY FRONTEND-ONLY DEMO DATA (Phase 4A) — neutral placeholders,
  // never written to PCData/localStorage. Remove when the real client
  // lookup is integrated in a later phase.
  // ------------------------------------------------------------------
  var SU_DEMO_CLIENTS = [
    { name: 'Sample Client A', email: 'sample.a@example.com', phone: '09XX XXX XXXX', address: 'Sample address' },
    { name: 'Sample Client B', email: 'sample.b@example.com', phone: '09XX XXX XXXX' },
    { name: 'Sample Client C', email: 'sample.c@example.com' }
  ];

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Up to two initials from a display name; skips honorifics ("Dr.") and
  // non-letter tokens such as "(linked client not found)".
  function initialsOf(name) {
    var words = String(name || '').split(/\s+/).filter(function (w) { return /[A-Za-z]/.test(w); });
    var plain = words.filter(function (w) { return !/^(dr|mr|mrs|ms)\.?$/i.test(w); });
    if (plain.length) words = plain;
    var letters = words.slice(0, 2).map(function (w) { return w.replace(/[^A-Za-z]/g, '').charAt(0).toUpperCase(); });
    return letters.join('') || '?';
  }

  function currentFilters() {
    return { search: state.search, role: state.role, status: state.status, type: state.type };
  }

  // ------------------------------------------------------------------
  // render — summary cards, filters, table, modal
  // ------------------------------------------------------------------

  function render() {
    var rows = window.PCStaffUsers.getRows();
    renderSummary(rows); // always the overall collection, never filtered
    renderTabs();
    renderFilterOptions();
    renderTable(window.PCStaffUsers.filterRows(rows, currentFilters()), rows.length);
    renderModal();
  }

  function renderSummary(rows) {
    var summary = window.PCStaffUsers.getSummary(rows);
    var sep = ' <span class="su-count-sep" aria-hidden="true">\u00b7</span> ';
    $('#su-summary-grid').innerHTML =
      summary.total + (summary.total === 1 ? ' user' : ' users') + sep +
      summary.staff + ' staff' + sep +
      summary.clients + (summary.clients === 1 ? ' client' : ' clients');
  }

  function renderTabs() {
    $all('#su-type-tabs .view-tab').forEach(function (tab) {
      var active = tab.dataset.type === state.type;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  // Roles offered by the Role filter for the current type tab, so a tab
  // and a role filter can't contradict each other (e.g. Staff + Client).
  function rolesForType(type) {
    var U = window.PCStaffUsers;
    if (type === 'staff') return U.STAFF_ROLES;
    if (type === 'client') return ['client'];
    return U.ROLES;
  }

  function renderFilterOptions() {
    var roleSelect = $('#su-role-filter');
    if (roleSelect.dataset.built !== state.type) {
      var roles = rolesForType(state.type);
      if (state.role !== 'all' && roles.indexOf(state.role) === -1) state.role = 'all';
      roleSelect.innerHTML = '<option value="all">All Roles</option>' + roles.map(function (r) {
        return '<option value="' + r + '">' + window.PCStaffUsers.ROLE_LABELS[r] + '</option>';
      }).join('');
      roleSelect.value = state.role;
      roleSelect.dataset.built = state.type;
    }

    var statusSelect = $('#su-status-filter');
    if (!statusSelect.dataset.built) {
      statusSelect.innerHTML = '<option value="all">All Status</option>' + window.PCStaffUsers.ACCOUNT_STATUSES.map(function (s) {
        return '<option value="' + s + '">' + window.PCStaffUsers.ACCOUNT_STATUS_LABELS[s] + '</option>';
      }).join('');
      statusSelect.dataset.built = '1';
    }
  }

  // Re-reads the accounts and redraws only the table (used by search,
  // filters and tabs, so typing never rebuilds the whole page).
  function refreshTable() {
    var all = window.PCStaffUsers.getRows();
    renderTable(window.PCStaffUsers.filterRows(all, currentFilters()), all.length);
  }

  // totalCount = every account that exists, so the empty state can tell
  // "no users yet" apart from "nothing matches the current filters".
  function renderTable(rows, totalCount) {
    var tbody = $('#su-table-body');
    var empty = $('#su-empty-state');
    var card = $('#su-table-card');

    if (!rows.length) {
      tbody.innerHTML = '';
      card.style.display = 'none';
      if (!totalCount) {
        $('#su-empty-title').textContent = 'No users yet';
        $('#su-empty-sub').textContent = 'Accounts will show up here once they are added.';
      } else {
        $('#su-empty-title').textContent = 'No users match your filters';
        $('#su-empty-sub').textContent = 'Try another tab, search, role, or status.';
      }
      empty.style.display = 'block';
      return;
    }
    card.style.display = '';
    empty.style.display = 'none';

    // Most recently created first.
    rows.sort(function (a, b) { return (b.account.createdAt || 0) - (a.account.createdAt || 0); });

    tbody.innerHTML = rows.map(function (row) {
      var a = row.account;
      var isClient = window.PCStaffUsers.isClientRole(a.role);
      var isActive = a.status === 'active';
      var roleLabel = window.PCStaffUsers.ROLE_LABELS[a.role] || a.role;
      var statusLabel = window.PCStaffUsers.ACCOUNT_STATUS_LABELS[a.status] || a.status;

      var avatarClass = 'su-avatar' + (isClient ? ' su-avatar-client' : '') + (isActive ? '' : ' su-avatar-inactive');
      var typeClass = 'su-type' + (isClient ? ' su-type-client' : '');
      var statusClass = 'status-badge su-status ' + (isActive ? 'su-status-active' : 'su-status-inactive');

      // Edit and Activate/Deactivate now live inside the View Account modal.
      var actions = '<button class="btn btn-sm" data-action="view" data-id="' + escapeHtml(a.id) + '">View</button>';

      return (
        '<tr>' +
          '<td><div class="su-user">' +
            '<div class="' + avatarClass + '">' + escapeHtml(initialsOf(row.displayName)) + '</div>' +
            '<div class="su-user-text">' +
              '<div class="su-user-name">' + escapeHtml(row.displayName) + '</div>' +
              '<div class="su-user-sub">' + escapeHtml(a.login) + '</div>' +
            '</div>' +
          '</div></td>' +
          '<td><span class="' + typeClass + '">' + (isClient ? 'Client' : 'Staff') + '</span></td>' +
          '<td>' + escapeHtml(roleLabel) + '</td>' +
          '<td><span class="' + statusClass + '">' + escapeHtml(statusLabel) + '</span></td>' +
          '<td class="su-muted">\u2014</td>' +
          '<td><div class="su-actions">' + actions + '</div></td>' +
        '</tr>'
      );
    }).join('');
  }

  // ------------------------------------------------------------------
  // modal — add staff / view / edit
  // ------------------------------------------------------------------

  function closeModal() {
    var triggerSel = state.triggerSel;
    state.modal = null;
    state.triggerSel = null;
    resetAddState();
    render();
    // The table is rebuilt by render(), so find the trigger again by its
    // selector (e.g. the same row's View button) and give focus back to it.
    if (triggerSel) {
      var trigger = $(triggerSel);
      if (trigger) trigger.focus();
    }
  }

  function openModal(modal, triggerSel) {
    state.modal = modal;
    state.triggerSel = triggerSel || null;
    if (modal && modal.mode === 'add') resetAddState();
    render();
  }

  function renderModal() {
    var overlay = $('#su-modal-overlay');
    var box = $('#su-modal');
    var shell = $('.app-shell');

    if (!state.modal) {
      overlay.classList.remove('open');
      box.classList.remove('su-modal-add', 'su-modal-view');
      box.innerHTML = '';
      document.body.classList.remove('su-modal-open');
      if (shell) shell.removeAttribute('inert');
      modalIsOpen = false;
      return;
    }
    overlay.classList.add('open');
    // Background can't be tabbed to or clicked while a modal is open,
    // and the page behind it doesn't scroll.
    document.body.classList.add('su-modal-open');
    if (shell) shell.setAttribute('inert', '');

    box.classList.toggle('su-modal-add', state.modal.mode === 'add');
    box.classList.toggle('su-modal-view', state.modal.mode === 'view');
    if (state.modal.mode === 'add') {
      box.innerHTML = addUserModalHtml();
      wireAddUserModal();
    } else if (state.modal.mode === 'view') {
      box.innerHTML = viewModalHtml(state.modal.accountId);
      wireViewModal(state.modal.accountId);
    } else if (state.modal.mode === 'edit') {
      box.innerHTML = editModalHtml(state.modal.accountId);
      wireEditModal(state.modal.accountId);
    }

    if (!modalIsOpen) {
      modalIsOpen = true;
      // Move focus into the dialog: first form field if there is one,
      // otherwise the close (X) button.
      var first = $('input, select', box) || $('.modal-close', box);
      if (first) first.focus();
    }
  }

  // Escape closes; Tab stays inside the open dialog.
  function handleModalKeydown(e) {
    if (!state.modal) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
      return;
    }
    if (e.key === 'Tab') {
      var items = $all('button, input, select, textarea, a[href]', $('#su-modal')).filter(function (el) {
        return !el.disabled && el.offsetParent !== null;
      });
      if (!items.length) return;
      var first = items[0];
      var last = items[items.length - 1];
      var active = document.activeElement;
      if (!$('#su-modal').contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  // ------------------------------------------------------------------
  // Add User modal — FRONTEND ONLY (Phase 4A)
  // ------------------------------------------------------------------

  function resetAddState() {
    addState = { type: 'staff', client: null, comboActive: -1, comboOpen: false };
    submitting = false;
  }

  function reqMark() { return ' <span class="su-req" aria-hidden="true">*</span>'; }

  function errBox(id) {
    return '<div class="su-field-error" id="' + id + '-msg" aria-live="polite" hidden></div>';
  }

  function textField(id, label, opts) {
    opts = opts || {};
    return '<div class="form-field' + (opts.full ? ' full' : '') + '">' +
      '<label for="' + id + '">' + escapeHtml(label) + reqMark() + '</label>' +
      '<input type="text" id="' + id + '" autocomplete="off" aria-required="true" aria-describedby="' + id + '-msg"' +
        (opts.inputmode ? ' inputmode="' + opts.inputmode + '"' : '') +
        (opts.placeholder ? ' placeholder="' + escapeHtml(opts.placeholder) + '"' : '') + '>' +
      errBox(id) + '</div>';
  }

  function roleField(id) {
    var opts = '<option value="">Select role</option>' + window.PCStaffUsers.STAFF_ROLES.map(function (r) {
      return '<option value="' + r + '">' + escapeHtml(window.PCStaffUsers.ROLE_LABELS[r]) + '</option>';
    }).join('');
    return '<div class="form-field"><label for="' + id + '">Role' + reqMark() + '</label>' +
      '<select id="' + id + '" aria-required="true" aria-describedby="' + id + '-msg">' + opts + '</select>' + errBox(id) + '</div>';
  }

  function statusField(id) {
    var U = window.PCStaffUsers;
    var opts = U.ACCOUNT_STATUSES.map(function (s) {
      return '<option value="' + s + '"' + (s === 'active' ? ' selected' : '') + '>' + escapeHtml(U.ACCOUNT_STATUS_LABELS[s]) + '</option>';
    }).join('');
    return '<div class="form-field full"><label for="' + id + '">Account Status' + reqMark() + '</label>' +
      '<div class="su-select-wrap"><span class="su-status-dot su-dot-active" aria-hidden="true"></span>' +
      '<select id="' + id + '" class="su-status-select" aria-required="true" aria-describedby="' + id + '-msg">' + opts + '</select></div>' +
      errBox(id) + '</div>';
  }

  function passwordField(id, label) {
    return '<div class="form-field"><label for="' + id + '">' + escapeHtml(label) + reqMark() + '</label>' +
      '<div class="su-pw-wrap"><input type="password" id="' + id + '" autocomplete="new-password" aria-required="true" aria-describedby="' + id + '-msg">' +
      '<button type="button" class="su-pw-toggle" data-pw-target="' + id + '" aria-label="Show ' + escapeHtml(label.toLowerCase()) + '" aria-pressed="false" title="Show password">' +
      '<i class="fa-solid fa-eye" aria-hidden="true"></i></button></div>' + errBox(id) + '</div>';
  }

  function securityHtml(prefix) {
    return '<div class="su-sec-title">Security</div>' +
      '<div class="form-grid">' +
        passwordField(prefix + '-password', 'Password') +
        passwordField(prefix + '-confirm', 'Confirm Password') +
      '</div>';
  }

  function clientSelectorHtml() {
    return '<div class="form-field full">' +
      '<label for="su-c-client">Client' + reqMark() + '</label>' +
      '<div class="su-combo">' +
        '<span class="su-combo-icon" aria-hidden="true"><i class="fa-solid fa-magnifying-glass"></i></span>' +
        '<input type="text" id="su-c-client" class="su-combo-input" role="combobox" aria-expanded="false" aria-controls="su-c-client-list" ' +
          'aria-autocomplete="list" aria-required="true" aria-describedby="su-c-client-msg" autocomplete="off" placeholder="Search existing client...">' +
        '<button type="button" class="su-combo-clear" id="su-c-client-clear" aria-label="Clear selected client" title="Clear selection" hidden><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>' +
        '<ul class="su-combo-list" id="su-c-client-list" role="listbox" aria-label="Clients" hidden></ul>' +
      '</div>' +
      errBox('su-c-client') +
      '<p class="su-modal-note">Temporary sample clients shown for layout only. Real client lookup is not connected yet.</p>' +
    '</div>' +
    '<div class="su-preview" id="su-client-preview" aria-live="polite">' + clientPreviewHtml() + '</div>';
  }

  function clientPreviewHtml() {
    var c = addState.client;
    var html = '<div class="su-preview-title">Client Record</div>';
    if (!c) return html + '<div class="su-preview-empty">No client selected</div>';
    [['Name', c.name], ['Email', c.email], ['Phone', c.phone], ['Address', c.address]].forEach(function (f) {
      var text = valueText(f[1]);
      if (text) html += infoRow(f[0], text);
    });
    return html;
  }

  function addUserModalHtml() {
    var isStaff = addState.type === 'staff';
    function typeBtn(type, icon, label) {
      var on = addState.type === type;
      return '<button type="button" class="view-tab' + (on ? ' active' : '') + '" role="radio" aria-checked="' + (on ? 'true' : 'false') + '" ' +
        'tabindex="' + (on ? '0' : '-1') + '" data-add-type="' + type + '"><i class="fa-solid ' + icon + '" aria-hidden="true"></i> ' + label + '</button>';
    }

    var staffPanel =
      '<div id="su-panel-staff"' + (isStaff ? '' : ' hidden') + '>' +
        '<div class="su-sec-title">Staff Information</div>' +
        '<div class="form-grid">' +
          textField('su-s-name', 'Full Name', { full: true }) +
          textField('su-s-email', 'Email', { inputmode: 'email' }) +
          roleField('su-s-role') +
        '</div>' +
        '<div class="su-sec-title">Account</div>' +
        '<div class="form-grid">' + statusField('su-s-status') + '</div>' +
        securityHtml('su-s') +
      '</div>';

    var clientPanel =
      '<div id="su-panel-client"' + (isStaff ? ' hidden' : '') + '>' +
        '<div class="su-sec-title">Client Information</div>' +
        '<div class="form-grid">' + clientSelectorHtml() + '</div>' +
        '<div class="su-sec-title">Account</div>' +
        '<div class="form-grid">' + statusField('su-c-status') + '</div>' +
        securityHtml('su-c') +
      '</div>';

    return (
      modalHead('Add User') +
      '<form id="su-add-form" class="su-add-form" novalidate>' +
        '<div class="su-add-body">' +
          '<div class="su-sec-title su-sec-first" id="su-type-label">Account Type</div>' +
          '<div class="view-tabs su-type-switch" role="radiogroup" aria-labelledby="su-type-label">' +
            typeBtn('staff', 'fa-id-badge', 'Staff') + typeBtn('client', 'fa-user', 'Client') +
          '</div>' +
          staffPanel + clientPanel +
        '</div>' +
        '<div id="su-add-form-error" class="su-form-error" role="alert" style="flex-shrink:0;margin:12px 0 0;" hidden></div>' +
        '<div class="modal-footer">' +
          '<button type="button" class="btn" data-action="close">Cancel</button>' +
          '<button type="submit" class="btn btn-primary">Create User</button>' +
        '</div>' +
      '</form>'
    );
  }

  function modalHead(title) {
    return '<div class="modal-head"><h3 class="modal-title" id="su-modal-title">' + escapeHtml(title) + '</h3>' +
      '<button class="modal-close" data-action="close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div>';
  }

  // ------------------------------------------------------------------
  // View modal — read-only. Uses the row from PCStaffUsers.getRows()
  // (account + linked client + display name), so nothing here reads the
  // data store directly and nothing is made up: a field with no value
  // simply isn't shown.
  // ------------------------------------------------------------------

  // Plain text from a stored value, or '' when there's nothing to show.
  function valueText(v) {
    if (v == null) return '';
    if (typeof v === 'string' || typeof v === 'number') return String(v).trim();
    if (Array.isArray(v)) return v.map(valueText).filter(Boolean).join(', ');
    if (typeof v === 'object') return Object.keys(v).map(function (k) { return valueText(v[k]); }).filter(Boolean).join(' \u00b7 ');
    return '';
  }

  function formatCreated(ts) {
    if (!ts) return '\u2014';
    var d = new Date(ts);
    return isNaN(d.getTime()) ? '\u2014' : d.toLocaleString();
  }

  function statusBadgeHtml(account) {
    var isActive = account.status === 'active';
    var label = window.PCStaffUsers.ACCOUNT_STATUS_LABELS[account.status] || account.status || '\u2014';
    return '<span class="status-badge su-status ' + (isActive ? 'su-status-active' : 'su-status-inactive') + '">' + escapeHtml(label) + '</span>';
  }

  function viewModalHtml(accountId) {
    var row = window.PCStaffUsers.getRows().filter(function (r) { return r.account.id === accountId; })[0];
    if (!row) {
      return modalHead('Account Details') + '<div>Account not found.</div>' +
        '<div class="modal-footer"><button class="btn" data-action="close">Close</button></div>';
    }

    var U = window.PCStaffUsers;
    var a = row.account;
    var client = row.client;
    var isClient = U.isClientRole(a.role);
    var isActive = a.status === 'active';
    var dash = '\u2014';
    var roleLabel = U.ROLE_LABELS[a.role] || a.role || dash;
    var typeLabel = isClient ? 'Client' : 'Staff';
    var loginText = valueText(a.login);
    var avatarClass = 'su-avatar su-avatar-lg' + (isClient ? ' su-avatar-client' : '') + (isActive ? '' : ' su-avatar-inactive');

    // ---- header: profile ----
    var head =
      '<div class="su-view-top">' +
        '<div class="su-view-eyebrow">' + typeLabel + ' Account</div>' +
        '<button class="modal-close" data-action="close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>' +
      '</div>' +
      '<div class="su-view-profile">' +
        '<div class="' + avatarClass + '">' + escapeHtml(initialsOf(row.displayName)) + '</div>' +
        '<div class="su-view-id-text">' +
          '<h3 class="modal-title" id="su-modal-title">' + escapeHtml(row.displayName) + '</h3>' +
          (loginText ? '<div class="su-view-sub">' + escapeHtml(loginText) + '</div>' : '') +
          '<div class="su-view-meta"><span class="su-view-role">' + escapeHtml(isClient ? 'Client' : roleLabel) + '</span>' + statusBadgeHtml(a) + '</div>' +
        '</div>' +
      '</div>';

    // ---- contact information (only values that really exist) ----
    var contact = [];
    if (isClient) {
      if (client) {
        contact.push(['Email', valueText(client.email)], ['Phone', valueText(client.phone)], ['Address', valueText(client.address), true]);
      }
    } else if (/@/.test(loginText)) {
      // Staff accounts store no separate email/phone; the login is an email address here.
      contact.push(['Email', loginText]);
    }
    contact = contact.filter(function (f) { return f[1]; });
    var contactHtml = '';
    if (!isClient || client) {
      contactHtml = '<div class="su-view-section"><div class="su-view-section-title">Contact Information</div>' +
        (contact.length
          ? '<div class="su-kv-grid">' + contact.map(function (f) { return kv(f[0], escapeHtml(f[1]), f[2]); }).join('') + '</div>'
          : '<div class="su-view-note">No contact details on file.</div>') +
        '</div>';
    }

    // ---- account information ----
    var accountHtml =
      '<div class="su-view-section"><div class="su-view-section-title">Account Information</div>' +
        '<div class="su-kv-grid">' +
          kv('Login', escapeHtml(loginText || dash)) +
          kv('Account Type', escapeHtml(typeLabel)) +
          kv('Role', escapeHtml(roleLabel)) +
          kv('Status', statusBadgeHtml(a)) +
          kv('Created', escapeHtml(formatCreated(a.createdAt))) +
          kv('Last Active', dash) +
        '</div>' +
      '</div>';

    // ---- account status + activate/deactivate ----
    var statusHtml =
      '<div class="su-view-section"><div class="su-view-section-title">Account Status</div>' +
        '<div class="su-status-panel">' +
          '<div class="su-status-panel-text">' +
            '<div class="su-status-panel-title"><span class="su-status-dot-inline ' + (isActive ? 'su-dot-active' : 'su-dot-inactive') + '" aria-hidden="true"></span>' +
              (isActive ? 'Active' : 'Inactive') + '</div>' +
            '<div class="su-status-panel-desc">' + (isActive
              ? 'This account currently has access to the Pawsitive Care system.'
              : 'The account currently does not have active access.') + '</div>' +
          '</div>' +
          '<button type="button" class="btn btn-sm" data-action="toggle-account">' + (isActive ? 'Deactivate Account' : 'Activate Account') + '</button>' +
        '</div>' +
      '</div>';

    // ---- client record (extra linked-record details, Phase 3 behavior) ----
    var clientHtml = '';
    if (isClient) {
      clientHtml = '<div class="su-view-section"><div class="su-view-section-title">Client Record</div>';
      if (!client) {
        clientHtml += '<div class="su-view-note">Client record not linked.</div>';
      } else {
        var shown = '';
        [['Emergency Contact', client.emergencyContact], ['Notes', client.notes, true], ['Client Status', client.status]].forEach(function (f) {
          var text = valueText(f[1]);
          if (!text) return;
          if (f[0] === 'Client Status') text = text.charAt(0).toUpperCase() + text.slice(1);
          shown += infoRow(f[0], text, f[2]);
        });
        clientHtml += shown || '<div class="su-view-note">No other client details on file.</div>';
      }
      clientHtml += '</div>';
    }

    return (
      head +
      '<div class="su-view-body">' + contactHtml + accountHtml + statusHtml + clientHtml + '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn" data-action="close">Close</button>' +
        (isClient ? '' : '<button class="btn btn-primary" data-action="edit-from-view"><i class="fa-solid fa-pen" aria-hidden="true"></i> Edit User</button>') +
      '</div>'
    );
  }

  // Label-over-value cell for the two-column View grids. valueHtml must already be safe.
  function kv(label, valueHtml, full) {
    return '<div class="su-kv' + (full ? ' su-kv-full' : '') + '"><div class="su-kv-label">' + escapeHtml(label) + '</div>' +
      '<div class="su-kv-value">' + valueHtml + '</div></div>';
  }

  function wireViewModal(accountId) {
    wireCloseOnly();
    var toggleBtn = $('[data-action="toggle-account"]', $('#su-modal'));
    if (toggleBtn) toggleBtn.addEventListener('click', function () { toggleStatus(accountId); });
    var editBtn = $('[data-action="edit-from-view"]', $('#su-modal'));
    if (editBtn) editBtn.addEventListener('click', function () {
      // Hand over to the existing Edit modal; focus return still goes to the
      // table's View button that originally opened this dialog.
      state.modal = { mode: 'edit', accountId: accountId };
      modalIsOpen = false; // let renderModal move focus into the new dialog
      render();
    });
  }

  // value is plain text and always escaped here; multiline keeps line breaks.
  function infoRow(label, value, multiline) {
    return infoRowHtml(label, escapeHtml(value), multiline);
  }

  // valueHtml must already be safe (built from escapeHtml'd parts).
  function infoRowHtml(label, valueHtml, multiline) {
    return '<div class="su-info-row"><div class="su-info-label">' + escapeHtml(label) + '</div>' +
      '<div class="su-info-value' + (multiline ? ' su-pre' : '') + '">' + valueHtml + '</div></div>';
  }

  function editModalHtml(accountId) {
    var a = window.PCStaffUsers.getAccount(accountId);
    if (!a) return modalHead('Account Details') + '<div>Account not found.</div>' + '<div class="modal-footer"><button class="btn" data-action="close">Close</button></div>';
    // Client accounts are never edited here (the store rejects them too).
    if (!window.PCStaffUsers.canEditStaffAccount(a)) return modalHead('Account Details') + '<div>Client accounts can\u2019t be edited here.</div>' + '<div class="modal-footer"><button class="btn" data-action="close">Close</button></div>';
    var roleOpts = window.PCStaffUsers.STAFF_ROLES.map(function (r) {
      return '<option value="' + r + '"' + (r === a.role ? ' selected' : '') + '>' + window.PCStaffUsers.ROLE_LABELS[r] + '</option>';
    }).join('');
    // An existing role that isn't a staff role (legacy/unknown) gets its own
    // selected option so the select can't silently fall back to Administrator.
    var legacyRole = window.PCStaffUsers.STAFF_ROLES.indexOf(a.role) === -1;
    if (legacyRole) {
      roleOpts = '<option value="' + escapeHtml(a.role || '') + '" selected>Unrecognized role: ' + escapeHtml(a.role || 'none set') + ' (kept)</option>' + roleOpts;
    }

    return (
      modalHead('Edit Staff User') +
      '<div id="su-form-error" class="su-form-error" style="display:none;"></div>' +
      '<div class="form-grid">' +
        '<div class="form-field full"><label for="su-edit-name">Full Name</label><input type="text" id="su-edit-name" value="' + escapeHtml(a.name || '') + '"></div>' +
        '<div class="form-field full"><label for="su-edit-login">Email or Login</label><input type="text" id="su-edit-login" value="' + escapeHtml(a.login || '') + '"></div>' +
        '<div class="form-field full"><label for="su-edit-role">Role</label><select id="su-edit-role">' + roleOpts + '</select></div>' +
        (legacyRole ? '<p class="su-modal-note full" style="grid-column:1/-1;">This account has an unrecognized role. It will be kept as-is unless you choose a new one.</p>' : '') +
        '<p class="su-modal-note full" style="grid-column:1/-1;">Passwords aren\u2019t shown or editable here.</p>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn" data-action="close">Cancel</button>' +
        '<button class="btn btn-primary" data-action="submit-edit" data-id="' + escapeHtml(a.id) + '">Save Changes</button>' +
      '</div>'
    );
  }

  function showFormError(msg) {
    var el = $('#su-form-error');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
  }

  function wireCloseOnly() {
    $all('[data-action="close"]', $('#su-modal')).forEach(function (btn) {
      btn.addEventListener('click', closeModal);
    });
  }

  // ---- Add User: validation helpers (UI only) ----

  function setMsg(id, msg, kind) {
    var input = $('#' + id);
    var box = $('#' + id + '-msg');
    if (!box) return;
    box.textContent = msg || '';
    box.hidden = !msg;
    box.classList.toggle('su-field-ok', kind === 'ok');
    if (input) {
      if (kind === 'error') input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }

  // Returns true when the field is valid; shows the inline message otherwise.
  function validateField(id) {
    var el = $('#' + id);
    if (!el) return true;
    var v = el.value;
    var isPw = /-password$/.test(id);
    var isConfirm = /-confirm$/.test(id);
    var msg = '';

    if (id === 'su-c-client') {
      if (!addState.client) msg = 'Please select a client.';
    } else if (isPw || isConfirm) {
      if (!v) msg = 'This field is required.';
      else if (isConfirm) {
        var pwVal = $('#' + id.replace('-confirm', '-password')).value;
        if (pwVal && v !== pwVal) msg = 'Passwords do not match.';
      }
    } else if (!v.trim()) {
      msg = 'This field is required.';
    } else if (/-email$/.test(id) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) {
      msg = 'Enter a valid email address.';
    }

    if (msg) { setMsg(id, msg, 'error'); return false; }
    if (isConfirm && v && $('#' + id.replace('-confirm', '-password')).value) setMsg(id, 'Passwords match.', 'ok'); else setMsg(id, '');
    return true;
  }

  // Live password confirmation for one panel prefix ('su-s' | 'su-c').
  // Shows a match/mismatch message only while BOTH fields have a value.
  function updatePasswordMatch(prefix) {
    var pw = $('#' + prefix + '-password');
    var cf = $('#' + prefix + '-confirm');
    if (!pw || !cf) return;
    if (pw.value && cf.value) {
      validateField(cf.id);
    } else if (!cf.getAttribute('aria-invalid') || cf.value) {
      setMsg(cf.id, ''); // never a misleading match/mismatch with an empty field
    }
  }

  function validateAddUserForm(form) {
    var firstBad = null;
    fieldIdsFor(addState.type).forEach(function (id) {
      if (!validateField(id) && !firstBad) firstBad = $('#' + id);
    });
    return firstBad; // null when valid
  }

  // Returns every control in a panel to its default: empty values, no
  // messages, hidden passwords, default status, no selected client.
  function resetAddUserForm(panel) {
    if (!panel) return;
    $all('input, select', panel).forEach(function (el) {
      if (el.tagName === 'SELECT') {
        el.value = el.classList.contains('su-status-select') ? 'active' : '';
      } else {
        el.value = '';
        if (el.type === 'text' && /^su-.-(password|confirm)$/.test(el.id)) el.type = 'password';
      }
      el.removeAttribute('aria-invalid');
      el.removeAttribute('aria-activedescendant');
    });
    $all('.su-field-error', panel).forEach(function (m) { m.textContent = ''; m.hidden = true; m.classList.remove('su-field-ok'); });
    $all('.su-pw-toggle', panel).forEach(function (b) {
      var isConfirm = /-confirm$/.test(b.dataset.pwTarget);
      b.setAttribute('aria-label', 'Show ' + (isConfirm ? 'confirm password' : 'password'));
      b.setAttribute('aria-pressed', 'false');
      b.title = 'Show password';
      b.firstElementChild.className = 'fa-solid fa-eye';
    });
    $all('.su-status-dot', panel).forEach(function (d) { d.className = 'su-status-dot su-dot-active'; });
    if ($('#su-c-client', panel)) {
      addState.client = null;
      addState.comboOpen = false;
      addState.comboActive = -1;
      $('#su-c-client-clear').hidden = true;
      $('#su-c-client-list').hidden = true;
      $('#su-c-client').setAttribute('aria-expanded', 'false');
      $('#su-client-preview').innerHTML = clientPreviewHtml();
    }
  }

  function fieldIdsFor(type) {
    return type === 'client'
      ? ['su-c-client', 'su-c-status', 'su-c-password', 'su-c-confirm']
      : ['su-s-name', 'su-s-email', 'su-s-role', 'su-s-status', 'su-s-password', 'su-s-confirm'];
  }

  function showToast(msg) {
    var t = $('#su-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'su-toast';
      t.className = 'toast';
      t.setAttribute('role', 'status');
      t.setAttribute('aria-live', 'polite');
      document.body.appendChild(t);
    }
    t.textContent = msg;
    void t.offsetWidth;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 3600);
  }

  // ---- Add User: client selector (demo data, local to the UI) ----

  function filterDemoClients() {
    var q = ($('#su-c-client').value || '').trim().toLowerCase();
    return SU_DEMO_CLIENTS.filter(function (c) {
      return !q || (c.name + ' ' + (c.email || '')).toLowerCase().indexOf(q) !== -1;
    });
  }

  function renderCombo() {
    var input = $('#su-c-client');
    var list = $('#su-c-client-list');
    if (!input || !list) return;
    var matches = filterDemoClients();
    if (addState.comboActive >= matches.length) addState.comboActive = matches.length - 1;
    list.innerHTML = matches.length
      ? matches.map(function (c, i) {
          var idx = SU_DEMO_CLIENTS.indexOf(c);
          return '<li role="option" id="su-c-client-opt-' + idx + '" data-idx="' + idx + '" aria-selected="' + (i === addState.comboActive ? 'true' : 'false') + '"' +
            (i === addState.comboActive ? ' class="active"' : '') + '>' +
            '<span class="su-opt-name">' + escapeHtml(c.name) + '</span>' +
            (c.email ? '<span class="su-opt-sub">' + escapeHtml(c.email) + '</span>' : '') + '</li>';
        }).join('')
      : '<li class="su-combo-none" role="presentation">No clients found.</li>';
    list.hidden = !addState.comboOpen;
    input.setAttribute('aria-expanded', addState.comboOpen ? 'true' : 'false');
    var activeEl = addState.comboOpen && addState.comboActive >= 0 ? $('.active', list) : null;
    if (activeEl) input.setAttribute('aria-activedescendant', activeEl.id); else input.removeAttribute('aria-activedescendant');
    if (activeEl && activeEl.scrollIntoView) activeEl.scrollIntoView({ block: 'nearest' });
  }

  function openCombo() { addState.comboOpen = true; renderCombo(); }
  function closeCombo() { addState.comboOpen = false; addState.comboActive = -1; renderCombo(); }

  function selectDemoClient(idx) {
    var c = SU_DEMO_CLIENTS[idx];
    if (!c) return;
    addState.client = c;
    $('#su-c-client').value = c.name;
    $('#su-c-client-clear').hidden = false;
    closeCombo();
    setMsg('su-c-client', '');
    $('#su-client-preview').innerHTML = clientPreviewHtml();
  }

  function clearSelectedClient() {
    addState.client = null;
    $('#su-c-client').value = '';
    $('#su-c-client-clear').hidden = true;
    $('#su-client-preview').innerHTML = clientPreviewHtml();
  }

  function setAddUserType(form, type, focusBtn) {
    if (type !== addState.type) {
      // Leaving a form: wipe its values/errors so nothing stale stays hidden.
      resetAddUserForm($(addState.type === 'staff' ? '#su-panel-staff' : '#su-panel-client', form));
    }
    addState.type = type;
    $all('[data-add-type]', form).forEach(function (b) {
      var on = b.dataset.addType === type;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
      if (on && focusBtn) b.focus();
    });
    $('#su-panel-staff', form).hidden = type !== 'staff';
    $('#su-panel-client', form).hidden = type !== 'client';
    if (type !== 'client') closeCombo();
  }

  // Form-level (not tied to one field) error for the Add User modal.
  function setAddFormError(msg) {
    var box = $('#su-add-form-error');
    if (!box) return;
    box.textContent = msg || '';
    box.hidden = !msg;
  }

  // Store error `field` -> Add User (Staff) input id.
  var STAFF_ERROR_FIELDS = {
    name: 'su-s-name',
    login: 'su-s-email',
    role: 'su-s-role',
    password: 'su-s-password',
    status: 'su-s-status'
  };

  // Staff branch: creates a real account via PCStaffUsers.createStaffAccount().
  // On any failure the modal stays open and `submitting` is reset.
  function submitStaffAdd() {
    submitting = true;
    setAddFormError('');
    var result;
    try {
      result = window.PCStaffUsers.createStaffAccount({
        name: $('#su-s-name').value,
        login: $('#su-s-email').value,
        role: $('#su-s-role').value,
        password: $('#su-s-password').value,
        status: $('#su-s-status').value
      });
    } catch (err) {
      submitting = false;
      setAddFormError('Something went wrong while creating the account. Please try again.');
      return;
    }

    if (!result || !result.ok) {
      submitting = false;
      var msg = (result && result.error) || 'Could not create the account. Please try again.';
      var fieldId = STAFF_ERROR_FIELDS[result && result.field];
      if (fieldId && $('#' + fieldId)) {
        setMsg(fieldId, msg, 'error');
        $('#' + fieldId).focus();
      } else {
        setAddFormError(msg);
      }
      return;
    }

    closeModal(); // clears add state (incl. `submitting`) and re-renders the directory
    showToast('Staff account created.');
  }

  function wireAddUserModal() {
    wireCloseOnly();
    var form = $('#su-add-form');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (submitting) return;
      var firstBad = validateAddUserForm(form);
      if (firstBad) { firstBad.focus(); return; }

      if (addState.type === 'staff') {
        submitStaffAdd();
        return;
      }

      // Client branch: unchanged — frontend-only, nothing is created or stored.
      submitting = true;
      closeModal(); // resets all Add User state (also clears `submitting`)
      showToast('Form validated. Account creation will be connected later.');
    });

    form.addEventListener('click', function (e) {
      var typeBtn = e.target.closest('[data-add-type]');
      if (typeBtn) { setAddUserType(form, typeBtn.dataset.addType, false); return; }

      var pw = e.target.closest('.su-pw-toggle');
      if (pw) {
        var input = $('#' + pw.dataset.pwTarget);
        var show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        var label = (show ? 'Hide ' : 'Show ') + (/-confirm$/.test(input.id) ? 'confirm password' : 'password');
        pw.setAttribute('aria-label', label);
        pw.setAttribute('aria-pressed', show ? 'true' : 'false');
        pw.title = show ? 'Hide password' : 'Show password';
        pw.firstElementChild.className = 'fa-solid ' + (show ? 'fa-eye-slash' : 'fa-eye');
        return;
      }

      var opt = e.target.closest('#su-c-client-list [data-idx]');
      if (opt) { selectDemoClient(parseInt(opt.dataset.idx, 10)); return; }

      if (e.target.closest('#su-c-client-clear')) {
        clearSelectedClient();
        $('#su-c-client').focus();
      }
    });

    // Keep focus in the search box while picking with the mouse.
    form.addEventListener('mousedown', function (e) {
      if (e.target.closest('#su-c-client-list')) e.preventDefault();
    });

    form.addEventListener('input', function (e) {
      var el = e.target;
      if (el.id === 'su-c-client') {
        if (addState.client) {
          addState.client = null;
          $('#su-c-client-clear').hidden = true;
          $('#su-client-preview').innerHTML = clientPreviewHtml();
        }
        addState.comboActive = -1;
        openCombo();
        return;
      }
      if (/-password$/.test(el.id)) {
        if (el.getAttribute('aria-invalid')) validateField(el.id);
        updatePasswordMatch(el.id.replace('-password', ''));
        return;
      }
      if (/-confirm$/.test(el.id)) {
        if (el.value) updatePasswordMatch(el.id.replace('-confirm', ''));
        else setMsg(el.id, '');
        return;
      }
      if (el.getAttribute('aria-invalid')) validateField(el.id);
    });

    form.addEventListener('change', function (e) {
      var el = e.target;
      if (el.classList.contains('su-status-select')) {
        var dot = el.parentNode.querySelector('.su-status-dot');
        dot.className = 'su-status-dot ' + (el.value === 'active' ? 'su-dot-active' : 'su-dot-inactive');
      }
      if (el.getAttribute && el.getAttribute('aria-invalid')) validateField(el.id);
    });

    form.addEventListener('focusin', function (e) {
      if (e.target.id === 'su-c-client' && !addState.client) openCombo();
    });

    form.addEventListener('focusout', function (e) {
      if (!e.target || e.target.id !== 'su-c-client') return;
      var to = e.relatedTarget;
      if (to && to.closest && to.closest('.su-combo')) return;
      if (addState.comboOpen) closeCombo();
    });

    form.addEventListener('keydown', function (e) {
      var el = e.target;

      // Account Type radio group: arrows move between the two options.
      if (el.dataset && el.dataset.addType && /^Arrow/.test(e.key)) {
        e.preventDefault();
        setAddUserType(form, el.dataset.addType === 'staff' ? 'client' : 'staff', true);
        return;
      }

      if (el.id === 'su-c-client') {
        var matches = filterDemoClients();
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (!addState.comboOpen) { addState.comboOpen = true; }
          if (matches.length) {
            var step = e.key === 'ArrowDown' ? 1 : -1;
            addState.comboActive = (addState.comboActive + step + matches.length) % matches.length;
          }
          renderCombo();
        } else if (e.key === 'Enter' && addState.comboOpen) {
          e.preventDefault();
          var pick = matches[addState.comboActive];
          if (pick) selectDemoClient(SU_DEMO_CLIENTS.indexOf(pick));
        } else if (e.key === 'Escape' && addState.comboOpen) {
          // Close just the list; a second Escape closes the modal.
          e.preventDefault();
          e.stopPropagation();
          closeCombo();
        }
      }
    });
  }

  function wireEditModal(accountId) {
    wireCloseOnly();
    var submitBtn = $('[data-action="submit-edit"]');
    if (!submitBtn) return; // account missing / not editable: only Close is shown
    submitBtn.addEventListener('click', function () {
      var result;
      try {
        result = window.PCStaffUsers.updateStaffAccount(accountId, {
          name: $('#su-edit-name').value,
          login: $('#su-edit-login').value,
          role: $('#su-edit-role').value
        });
      } catch (err) {
        result = null;
      }
      // Failed update: stay open with the error, no success path.
      if (!result || !result.ok) return showFormError((result && result.error) || 'Could not save changes. Please try again.');
      closeModal();
    });
  }

  // ------------------------------------------------------------------
  // row actions — view / edit / activate-deactivate
  // ------------------------------------------------------------------

  function handleTableClick(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.dataset.action;
    var id = btn.dataset.id;

    if (action === 'view') {
      openModal({ mode: 'view', accountId: id }, '[data-action="view"][data-id="' + id + '"]');
    }
  }

  function toggleStatus(id) {
    var account = window.PCStaffUsers.getAccount(id);
    if (!account) return;
    var goingInactive = account.status === 'active';
    var confirmMsg = goingInactive
      ? 'Deactivate this account? They will no longer be able to sign in.'
      : 'Reactivate this account?';
    if (!window.confirm(confirmMsg)) return;

    var result;
    try {
      result = window.PCStaffUsers.toggleAccountStatus(id);
    } catch (err) {
      result = null;
    }
    // Thrown error or failed result: show the error, no success path and
    // no refresh as if the change had gone through.
    if (!result || !result.ok) {
      window.alert((result && result.error) || 'Could not update the account status. Please try again.');
      return;
    }
    render(); // refreshes the table behind and the open View modal
    if (state.modal && state.modal.mode === 'view') {
      var again = $('[data-action="toggle-account"]', $('#su-modal'));
      if (again) again.focus();
    }
  }

  // ------------------------------------------------------------------
  // wiring
  // ------------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    // Access guard — must stay the first thing that runs. Administrator
    // session required (PCClientAuth.requireAdminLogin(), client-session.js).
    // requireAdminLogin() redirects to the login page when there is no
    // Administrator session but does NOT stop this script, so initialization
    // stops here explicitly. If the helper itself is missing, fail closed:
    // nothing is initialized or rendered.
    var admin = null;
    try {
      admin = (window.PCClientAuth && typeof window.PCClientAuth.requireAdminLogin === 'function')
        ? window.PCClientAuth.requireAdminLogin()
        : null;
    } catch (err) {
      admin = null;
    }
    if (!admin) {
      document.body.style.visibility = 'hidden'; // no empty admin shell while redirecting
      return;
    }

    $('#su-search-input').addEventListener('input', function (e) {
      state.search = e.target.value;
      refreshTable();
    });
    $('#su-role-filter').addEventListener('change', function (e) {
      state.role = e.target.value;
      refreshTable();
    });
    $('#su-status-filter').addEventListener('change', function (e) {
      state.status = e.target.value;
      refreshTable();
    });
    $('#su-type-tabs').addEventListener('click', function (e) {
      var tab = e.target.closest('.view-tab');
      if (!tab || tab.dataset.type === state.type) return;
      state.type = tab.dataset.type;
      renderTabs();
      renderFilterOptions(); // narrows the Role list for the tab
      refreshTable();
    });
    $('#su-add-staff-btn').addEventListener('click', function () {
      openModal({ mode: 'add' }, '#su-add-staff-btn');
    });
    document.addEventListener('keydown', handleModalKeydown);
    // Clicking anywhere outside the client combobox closes its dropdown.
    document.addEventListener('mousedown', function (e) {
      if (state.modal && state.modal.mode === 'add' && addState.comboOpen && !e.target.closest('.su-combo')) closeCombo();
    });
    $('#su-table-body').addEventListener('click', handleTableClick);
    $('#su-modal-overlay').addEventListener('click', function (e) {
      if (e.target === $('#su-modal-overlay')) closeModal();
    });

    render();

    // Cross-tab / other-page account changes (e.g. a Client account
    // created elsewhere) refresh this view automatically — but only
    // when no modal is open. render() rebuilds the modal's innerHTML
    // via renderModal(), which would destroy in-progress Add/Edit
    // input elements (and their typed values) every time PCData's
    // polling safety net fires. Skipping the refresh while a modal is
    // open avoids that; the view catches up via render() the next time
    // the modal closes anyway.
    window.PCStaffUsers.onChange(function () {
      if (state.modal) return;
      render();
    });
  });
})();