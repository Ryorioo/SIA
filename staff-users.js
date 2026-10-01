// ============================================================
// PAWSITIVE CARE — Administrator "Staff & Users" page
//
// UI/rendering layer only. All account-management logic (role/status
// constants, row/filter/summary queries, create/edit/toggle mutations,
// Administrator safeguards) lives in staff-users-data-store.js
// (PCStaffUsers), which in turn uses the shared PCData Account
// functions in data-store.js. This file never talks to PCData
// directly and never reimplements business rules.
// ============================================================

(function () {
  var state = {
    search: '',
    role: 'all',
    status: 'all',
    modal: null // { mode: 'add' | 'view' | 'edit', accountId? }
  };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function currentFilters() {
    return { search: state.search, role: state.role, status: state.status };
  }

  // ------------------------------------------------------------------
  // render — summary cards, filters, table, modal
  // ------------------------------------------------------------------

  function render() {
    var rows = window.PCStaffUsers.getRows();
    renderSummary(rows);
    renderFilterOptions();
    renderTable(window.PCStaffUsers.filterRows(rows, currentFilters()));
    renderModal();
  }

  function renderSummary(rows) {
    var summary = window.PCStaffUsers.getSummary(rows);
    var cards = [
      { label: 'Total Users', value: summary.total, icon: 'fa-users' },
      { label: 'Active Users', value: summary.active, icon: 'fa-user-check' },
      { label: 'Staff', value: summary.staff, icon: 'fa-user-tie' },
      { label: 'Clients', value: summary.clients, icon: 'fa-user' }
    ];

    $('#su-summary-grid').innerHTML = cards.map(function (c) {
      return (
        '<div class="su-card">' +
          '<div class="su-card-icon"><i class="fa-solid ' + c.icon + '"></i></div>' +
          '<div>' +
            '<div class="su-card-value">' + c.value + '</div>' +
            '<div class="su-card-label">' + c.label + '</div>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function renderFilterOptions() {
    var roleSelect = $('#su-role-filter');
    if (!roleSelect.dataset.built) {
      roleSelect.innerHTML = '<option value="all">All Roles</option>' + window.PCStaffUsers.ROLES.map(function (r) {
        return '<option value="' + r + '">' + window.PCStaffUsers.ROLE_LABELS[r] + '</option>';
      }).join('');
      roleSelect.dataset.built = '1';
    }

    var statusSelect = $('#su-status-filter');
    if (!statusSelect.dataset.built) {
      statusSelect.innerHTML = '<option value="all">All Status</option>' + window.PCStaffUsers.ACCOUNT_STATUSES.map(function (s) {
        return '<option value="' + s + '">' + window.PCStaffUsers.ACCOUNT_STATUS_LABELS[s] + '</option>';
      }).join('');
      statusSelect.dataset.built = '1';
    }
  }

  function renderTable(rows) {
    var tbody = $('#su-table-body');
    var empty = $('#su-empty-state');

    if (!rows.length) {
      tbody.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    // Most recently created first.
    rows.sort(function (a, b) { return (b.account.createdAt || 0) - (a.account.createdAt || 0); });

    tbody.innerHTML = rows.map(function (row) {
      var a = row.account;
      var isClient = a.role === 'client';
      var created = a.createdAt ? new Date(a.createdAt).toLocaleDateString() : '—';
      var statusClass = a.status === 'active' ? 'su-badge-active' : 'su-badge-inactive';
      var roleLabel = window.PCStaffUsers.ROLE_LABELS[a.role] || a.role;
      var statusLabel = window.PCStaffUsers.ACCOUNT_STATUS_LABELS[a.status] || a.status;
      var toggleLabel = a.status === 'active' ? 'Deactivate' : 'Activate';

      var actions = '<button class="su-link-btn" data-action="view" data-id="' + a.id + '">View</button>';
      if (!isClient) {
        actions += '<button class="su-link-btn" data-action="edit" data-id="' + a.id + '">Edit</button>';
      }
      actions += '<button class="su-link-btn' + (a.status === 'active' ? ' su-link-danger' : '') + '" data-action="toggle" data-id="' + a.id + '">' + toggleLabel + '</button>';

      return (
        '<tr>' +
          '<td>' + escapeHtml(row.displayName) + (isClient ? ' <span class="su-tag">Client</span>' : '') + '</td>' +
          '<td>' + escapeHtml(a.login) + '</td>' +
          '<td>' + escapeHtml(roleLabel) + '</td>' +
          '<td><span class="su-badge ' + statusClass + '">' + statusLabel + '</span></td>' +
          '<td>' + created + '</td>' +
          '<td class="su-actions">' + actions + '</td>' +
        '</tr>'
      );
    }).join('');
  }

  // ------------------------------------------------------------------
  // modal — add staff / view / edit
  // ------------------------------------------------------------------

  function closeModal() {
    state.modal = null;
    render();
  }

  function renderModal() {
    var overlay = $('#su-modal-overlay');
    var box = $('#su-modal');

    if (!state.modal) {
      overlay.style.display = 'none';
      box.innerHTML = '';
      return;
    }
    overlay.style.display = 'flex';

    if (state.modal.mode === 'add') {
      box.innerHTML = addStaffModalHtml();
      wireAddStaffModal();
    } else if (state.modal.mode === 'view') {
      box.innerHTML = viewModalHtml(state.modal.accountId);
      wireCloseOnly();
    } else if (state.modal.mode === 'edit') {
      box.innerHTML = editModalHtml(state.modal.accountId);
      wireEditModal(state.modal.accountId);
    }
  }

  function addStaffModalHtml() {
    var roleOpts = window.PCStaffUsers.STAFF_ROLES.map(function (r) {
      return '<option value="' + r + '">' + window.PCStaffUsers.ROLE_LABELS[r] + '</option>';
    }).join('');

    return (
      '<div class="su-modal-header"><h3>Add Staff User</h3><button class="su-modal-close" data-action="close">&times;</button></div>' +
      '<div class="su-modal-body">' +
        '<div id="su-form-error" class="su-form-error" style="display:none;"></div>' +
        '<div class="su-field"><label>Full Name</label><input type="text" id="su-add-name" placeholder="e.g. Dr. Santos"></div>' +
        '<div class="su-field"><label>Email or Login</label><input type="text" id="su-add-login" placeholder="name@pawsitivecare.com"></div>' +
        '<div class="su-field"><label>Role</label><select id="su-add-role">' + roleOpts + '</select></div>' +
        '<div class="su-field"><label>Temporary Password</label><input type="text" id="su-add-password" placeholder="Set an initial password"></div>' +
      '</div>' +
      '<div class="su-modal-footer">' +
        '<button class="su-btn su-btn-ghost" data-action="close">Cancel</button>' +
        '<button class="su-btn su-btn-primary" data-action="submit-add">Create Account</button>' +
      '</div>'
    );
  }

  function viewModalHtml(accountId) {
    var a = window.PCStaffUsers.getAccount(accountId);
    if (!a) return '<div class="su-modal-body">Account not found.</div>';
    var isClient = a.role === 'client';
    var client = isClient ? window.PCData.getClientById(a.clientId) : null;
    var displayName = isClient ? (client ? client.name : '(linked client not found)') : (a.name || a.login);

    var rowsHtml =
      infoRow('Name', displayName) +
      infoRow('Login', a.login) +
      infoRow('Role', window.PCStaffUsers.ROLE_LABELS[a.role] || a.role) +
      infoRow('Status', window.PCStaffUsers.ACCOUNT_STATUS_LABELS[a.status] || a.status) +
      infoRow('Created', a.createdAt ? new Date(a.createdAt).toLocaleString() : '—');

    if (isClient && client) {
      rowsHtml += infoRow('Client Email', client.email || '—') + infoRow('Client Phone', client.phone || '—');
    }

    return (
      '<div class="su-modal-header"><h3>Account Details</h3><button class="su-modal-close" data-action="close">&times;</button></div>' +
      '<div class="su-modal-body">' + rowsHtml + '</div>' +
      '<div class="su-modal-footer"><button class="su-btn su-btn-ghost" data-action="close">Close</button></div>'
    );
  }

  function infoRow(label, value) {
    return '<div class="su-info-row"><div class="su-info-label">' + escapeHtml(label) + '</div><div class="su-info-value">' + escapeHtml(value) + '</div></div>';
  }

  function editModalHtml(accountId) {
    var a = window.PCStaffUsers.getAccount(accountId);
    if (!a) return '<div class="su-modal-body">Account not found.</div>';
    var roleOpts = window.PCStaffUsers.STAFF_ROLES.map(function (r) {
      return '<option value="' + r + '"' + (r === a.role ? ' selected' : '') + '>' + window.PCStaffUsers.ROLE_LABELS[r] + '</option>';
    }).join('');

    return (
      '<div class="su-modal-header"><h3>Edit Staff User</h3><button class="su-modal-close" data-action="close">&times;</button></div>' +
      '<div class="su-modal-body">' +
        '<div id="su-form-error" class="su-form-error" style="display:none;"></div>' +
        '<div class="su-field"><label>Full Name</label><input type="text" id="su-edit-name" value="' + escapeHtml(a.name || '') + '"></div>' +
        '<div class="su-field"><label>Email or Login</label><input type="text" id="su-edit-login" value="' + escapeHtml(a.login || '') + '"></div>' +
        '<div class="su-field"><label>Role</label><select id="su-edit-role">' + roleOpts + '</select></div>' +
        '<p class="su-modal-note">Passwords aren\u2019t shown or editable here.</p>' +
      '</div>' +
      '<div class="su-modal-footer">' +
        '<button class="su-btn su-btn-ghost" data-action="close">Cancel</button>' +
        '<button class="su-btn su-btn-primary" data-action="submit-edit" data-id="' + a.id + '">Save Changes</button>' +
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

  function wireAddStaffModal() {
    wireCloseOnly();
    $('[data-action="submit-add"]').addEventListener('click', function () {
      var result = window.PCStaffUsers.createStaffAccount({
        name: $('#su-add-name').value,
        login: $('#su-add-login').value,
        role: $('#su-add-role').value,
        password: $('#su-add-password').value
      });
      if (!result.ok) return showFormError(result.error);
      closeModal();
    });
  }

  function wireEditModal(accountId) {
    wireCloseOnly();
    $('[data-action="submit-edit"]').addEventListener('click', function () {
      var result = window.PCStaffUsers.updateStaffAccount(accountId, {
        name: $('#su-edit-name').value,
        login: $('#su-edit-login').value,
        role: $('#su-edit-role').value
      });
      if (!result.ok) return showFormError(result.error);
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
      state.modal = { mode: 'view', accountId: id };
      render();
    } else if (action === 'edit') {
      state.modal = { mode: 'edit', accountId: id };
      render();
    } else if (action === 'toggle') {
      toggleStatus(id);
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

    var result = window.PCStaffUsers.toggleAccountStatus(id);
    if (!result.ok) {
      window.alert(result.error);
      return;
    }
    render();
  }

  // ------------------------------------------------------------------
  // wiring
  // ------------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    $('#su-search-input').addEventListener('input', function (e) {
      state.search = e.target.value;
      renderTable(window.PCStaffUsers.filterRows(window.PCStaffUsers.getRows(), currentFilters()));
    });
    $('#su-role-filter').addEventListener('change', function (e) {
      state.role = e.target.value;
      renderTable(window.PCStaffUsers.filterRows(window.PCStaffUsers.getRows(), currentFilters()));
    });
    $('#su-status-filter').addEventListener('change', function (e) {
      state.status = e.target.value;
      renderTable(window.PCStaffUsers.filterRows(window.PCStaffUsers.getRows(), currentFilters()));
    });
    $('#su-add-staff-btn').addEventListener('click', function () {
      state.modal = { mode: 'add' };
      render();
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