// ============================================================
// PAWSITIVE CARE — Administrator "Access Management" page
//
// FRONTEND ONLY. Nothing here reads or writes PCData, localStorage, or
// any Account. All data comes from AM_MOCK below, accessed only through
// the small AMData object, so a later backend phase replaces AMData's
// function bodies and leaves the rendering code untouched.
//
// Mock users are placeholders that exist only on this page — they are
// not Accounts and never appear in Staff & Users.
// ============================================================

(function () {
  // ------------------------------------------------------------------
  // MOCK DATA (isolated) — replace with real data in the backend phase.
  // ------------------------------------------------------------------

  var ACTION_LABELS = { view: 'View', create: 'Create', edit: 'Edit', manage: 'Manage' };

  // Permission groups follow the clinic workflow. `actions` lists what can
  // be granted for that module. Staff & Users and Settings are intentionally
  // not part of this list.
  var GROUPS = [
    { id: 'patient-care', label: 'Patient Care', modules: [
      { id: 'patients', label: 'Patients', actions: ['view', 'create', 'edit'] },
      { id: 'medical-records', label: 'Medical Records', actions: ['view', 'edit'] }
    ] },
    { id: 'clinic-operations', label: 'Clinic Operations', modules: [
      { id: 'appointments', label: 'Appointments', actions: ['view', 'manage'] },
      { id: 'queue', label: 'Queue', actions: ['view', 'manage'] },
      { id: 'services', label: 'Services', actions: ['view', 'manage'] }
    ] },
    { id: 'clinic-resources', label: 'Clinic Resources', modules: [
      { id: 'inventory', label: 'Inventory', actions: ['view', 'manage'] },
      { id: 'billing', label: 'Billing', actions: ['view', 'manage'] }
    ] },
    { id: 'insights', label: 'Insights', modules: [
      { id: 'predictive-analytics', label: 'Predictive Analytics', actions: ['view'] },
      { id: 'reports', label: 'Reports', actions: ['view'] }
    ] }
  ];

  function fullAccess() {
    var all = {};
    GROUPS.forEach(function (g) {
      g.modules.forEach(function (m) { all[m.id] = m.actions.slice(); });
    });
    return all;
  }

  var AM_MOCK = {
    roles: [
      {
        id: 'administrator', name: 'Administrator', icon: 'shield-halved',
        description: 'Full clinic system access.',
        blurb: 'Oversees the clinic system and every part of the workflow.',
        accessLevel: 'Full Access',
        responsibility: 'Clinic-wide administration and oversight',
        locked: true
      },
      {
        id: 'veterinarian', name: 'Veterinarian', icon: 'stethoscope',
        description: 'Clinical and patient care access.',
        blurb: 'Responsible for patient care and medical records.',
        accessLevel: 'Clinical Access',
        responsibility: 'Patient and medical management'
      },
      {
        id: 'receptionist', name: 'Receptionist', icon: 'clipboard-user',
        description: 'Appointment and client management.',
        blurb: 'Runs the front desk: scheduling, check-in, the queue, and billing.',
        accessLevel: 'Front Desk Access',
        responsibility: 'Scheduling, check-in, and client service'
      },
      {
        id: 'staff', name: 'Staff', icon: 'user-nurse',
        description: 'Clinic support access.',
        blurb: 'Supports day-to-day clinic work such as patient handling and supplies.',
        accessLevel: 'Support Access',
        responsibility: 'Day-to-day clinic support'
      },
      {
        id: 'client', name: 'Client', icon: 'user',
        description: 'Pet owner account access.',
        blurb: 'Pet owners using their own account to follow their pets and appointments.',
        accessLevel: 'Pet Owner Access',
        responsibility: 'Own pets, appointments, and records',
        scopeNote: 'Clients only see information that belongs to their own pets and account.'
      }
    ],

    // role id -> module id -> granted actions
    permissions: {
      administrator: fullAccess(),
      veterinarian: {
        'patients': ['view', 'create', 'edit'],
        'medical-records': ['view', 'edit'],
        'appointments': ['view', 'manage'],
        'queue': ['view', 'manage'],
        'services': ['view'],
        'inventory': ['view'],
        'predictive-analytics': ['view'],
        'reports': ['view']
      },
      receptionist: {
        'patients': ['view', 'create', 'edit'],
        'appointments': ['view', 'manage'],
        'queue': ['view', 'manage'],
        'services': ['view'],
        'billing': ['view', 'manage']
      },
      staff: {
        'patients': ['view'],
        'appointments': ['view'],
        'queue': ['view', 'manage'],
        'services': ['view'],
        'inventory': ['view', 'manage']
      },
      client: {
        'patients': ['view'],
        'medical-records': ['view'],
        'appointments': ['view', 'manage'],
        'services': ['view'],
        'billing': ['view']
      }
    },

    users: [
      { id: 'u1', name: 'Clinic Administrator', role: 'administrator', status: 'active' },
      { id: 'u2', name: 'Dr. Maria Santos', role: 'veterinarian', status: 'active' },
      { id: 'u3', name: 'Anna Reyes', role: 'veterinarian', status: 'active' },
      { id: 'u4', name: 'Dr. Paolo Mendoza', role: 'veterinarian', status: 'inactive' },
      { id: 'u5', name: 'Carla Mendoza', role: 'receptionist', status: 'active' },
      { id: 'u6', name: 'Leah Navarro', role: 'receptionist', status: 'active' },
      { id: 'u7', name: 'Ramon Villanueva', role: 'staff', status: 'active' },
      { id: 'u8', name: 'Joy Castillo', role: 'staff', status: 'inactive' },
      { id: 'u9', name: 'Sample Client A', role: 'client', status: 'active' },
      { id: 'u10', name: 'Sample Client B', role: 'client', status: 'active' },
      { id: 'u11', name: 'Sample Client C', role: 'client', status: 'inactive' }
    ]
  };

  // ------------------------------------------------------------------
  // AMData — the only place that touches AM_MOCK. A backend phase swaps
  // these bodies for real calls; callers do not change.
  // ------------------------------------------------------------------
  var AMData = {
    getRoles: function () { return AM_MOCK.roles; },
    getRole: function (id) {
      return AM_MOCK.roles.filter(function (r) { return r.id === id; })[0] || null;
    },
    getGroups: function () { return GROUPS; },
    getPermissions: function (roleId) {
      var src = AM_MOCK.permissions[roleId] || {};
      var copy = {};
      Object.keys(src).forEach(function (k) { copy[k] = src[k].slice(); });
      return copy;
    },
    getUsersByRole: function (roleId) {
      return AM_MOCK.users.filter(function (u) { return u.role === roleId; });
    },
    // Session-only: updates the in-memory mock so the page reflects the change
    // until reload. Administrator is protected and never saved.
    savePermissions: function (roleId, perms) {
      var role = AMData.getRole(roleId);
      if (!role || role.locked) return { ok: false, error: 'Administrator permissions are protected.' };
      var copy = {};
      Object.keys(perms).forEach(function (k) { if (perms[k].length) copy[k] = perms[k].slice(); });
      AM_MOCK.permissions[roleId] = copy;
      return { ok: true };
    }
  };

  // ------------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------------
  var state = { roleId: 'administrator', modal: null, triggerSel: null };
  var draft = null;
  var modalIsOpen = false;
  var toastTimer = null;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function initialsOf(name) {
    var words = String(name || '').split(/\s+/).filter(function (w) { return /[A-Za-z]/.test(w); });
    var plain = words.filter(function (w) { return !/^(dr|mr|mrs|ms)\.?$/i.test(w); });
    if (plain.length) words = plain;
    var letters = words.slice(0, 2).map(function (w) { return w.replace(/[^A-Za-z]/g, '').charAt(0).toUpperCase(); });
    return letters.join('') || '?';
  }

  function roleLabel(id) {
    var r = AMData.getRole(id);
    return r ? r.name : id;
  }

  function showToast(msg) {
    var t = $('#am-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'am-toast';
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

  // ------------------------------------------------------------------
  // left panel — role list (built once; selection only toggles classes)
  // ------------------------------------------------------------------
  function renderRoleList() {
    $('#am-role-list').innerHTML = AMData.getRoles().map(function (r) {
      var count = AMData.getUsersByRole(r.id).length;
      return (
        '<button type="button" class="am-role" data-role="' + escapeHtml(r.id) + '">' +
          '<span class="am-icon" aria-hidden="true"><i class="fa-solid fa-' + r.icon + '"></i></span>' +
          '<span class="am-role-text">' +
            '<div class="am-role-name">' + escapeHtml(r.name) + '</div>' +
            '<div class="am-role-desc">' + escapeHtml(r.description) + '</div>' +
          '</span>' +
          '<span class="am-role-count" aria-label="' + count + (count === 1 ? ' user' : ' users') + '">' + count + '</span>' +
        '</button>'
      );
    }).join('');
    updateRoleSelection();
  }

  function updateRoleSelection() {
    $all('#am-role-list .am-role').forEach(function (btn) {
      var on = btn.dataset.role === state.roleId;
      btn.classList.toggle('active', on);
      if (on) btn.setAttribute('aria-current', 'true');
      else btn.removeAttribute('aria-current');
    });
  }

  function selectRole(id, focusBtn) {
    if (!AMData.getRole(id)) return;
    state.roleId = id;
    updateRoleSelection();
    renderDetail();
    if (focusBtn) {
      var btn = $('#am-role-list .am-role[data-role="' + id + '"]');
      if (btn) btn.focus();
    }
  }

  // ------------------------------------------------------------------
  // center column (role header + module permissions) and right column
  // (users with this role + access summary)
  // ------------------------------------------------------------------
  var TABLE_ACTIONS = ['view', 'create', 'edit', 'manage'];

  // Granted -> check mark; anything else -> dash. Screen readers get
  // "granted" / "not granted" / "not available" instead of the symbol.
  function cellHtml(module, granted, act) {
    var label = ACTION_LABELS[act];
    if (granted.indexOf(act) !== -1) {
      return '<td><i class="fa-solid fa-check am-yes" aria-hidden="true"></i><span class="am-sr">' + label + ' granted</span></td>';
    }
    var offered = module.actions.indexOf(act) !== -1;
    return '<td><span class="am-no" aria-hidden="true">\u2014</span><span class="am-sr">' +
      label + (offered ? ' not granted' : ' not available') + '</span></td>';
  }

  function permissionsTableHtml(role) {
    var perms = AMData.getPermissions(role.id);
    var head = '<thead><tr><th scope="col">Module</th>' + TABLE_ACTIONS.map(function (a) {
      return '<th scope="col">' + ACTION_LABELS[a] + '</th>';
    }).join('') + '</tr></thead>';

    var bodies = AMData.getGroups().map(function (g) {
      return '<tbody><tr><th scope="rowgroup" colspan="5">' + escapeHtml(g.label) + '</th></tr>' +
        g.modules.map(function (m) {
          var granted = perms[m.id] || [];
          return '<tr><th scope="row">' + escapeHtml(m.label) + '</th>' +
            TABLE_ACTIONS.map(function (a) { return cellHtml(m, granted, a); }).join('') + '</tr>';
        }).join('') + '</tbody>';
    }).join('');

    return '<div class="am-table-card"><div class="am-table-scroll">' +
      '<table class="am-table" aria-label="Module permissions for ' + escapeHtml(role.name) + '">' +
      '<colgroup><col><col class="am-col-act"><col class="am-col-act"><col class="am-col-act"><col class="am-col-act"></colgroup>' +
      head + bodies + '</table></div></div>';
  }

  function userRowHtml(u) {
    var isClient = u.role === 'client';
    var isActive = u.status === 'active';
    var avatarCls = 'am-avatar' + (isClient ? ' am-avatar-client' : '') + (isActive ? '' : ' am-avatar-inactive');
    var badgeCls = 'status-badge am-status ' + (isActive ? 'am-status-active' : 'am-status-inactive');
    return (
      '<li class="am-user">' +
        '<div class="' + avatarCls + '" aria-hidden="true">' + escapeHtml(initialsOf(u.name)) + '</div>' +
        '<div class="am-user-text">' +
          '<div class="am-user-name">' + escapeHtml(u.name) + '</div>' +
          '<div class="am-user-sub">' + escapeHtml(roleLabel(u.role)) + '</div>' +
        '</div>' +
        '<span class="' + badgeCls + '">' + (isActive ? 'Active' : 'Inactive') + '</span>' +
        '<button type="button" class="btn btn-sm" data-action="view-user" data-id="' + escapeHtml(u.id) + '">View</button>' +
      '</li>'
    );
  }

  function renderDetail() {
    var role = AMData.getRole(state.roleId);
    var users = AMData.getUsersByRole(role.id);

    var manageBtn = role.locked
      ? '<button type="button" class="btn btn-sm am-btn-locked" disabled aria-disabled="true" title="Administrator permissions are protected.">' +
          '<i class="fa-solid fa-lock"></i> Manage Permissions</button>'
      : '<button type="button" id="am-manage-btn" class="btn btn-primary btn-sm" data-action="manage">' +
          '<i class="fa-solid fa-sliders"></i> Manage Permissions</button>';

    var protectedHtml = role.locked
      ? '<div class="am-protected">' +
          '<div class="am-protected-icon" aria-hidden="true"><i class="fa-solid fa-lock"></i></div>' +
          '<div><div class="am-protected-title">Full system access</div>' +
          '<div class="am-protected-desc">Administrator permissions are protected.</div></div>' +
        '</div>'
      : '';
    var scopeHtml = role.scopeNote ? '<p class="am-section-note">' + escapeHtml(role.scopeNote) + '</p>' : '';

    // CENTER: role header, then module permissions directly beneath it.
    $('#am-main').innerHTML =
      '<div class="am-role-head">' +
        '<div class="am-icon am-icon-lg" aria-hidden="true"><i class="fa-solid fa-' + role.icon + '"></i></div>' +
        '<div class="am-role-head-text">' +
          '<div class="am-role-head-top">' +
            '<h2 class="am-role-title">' + escapeHtml(role.name) + '</h2>' +
            '<span class="am-level">' + escapeHtml(role.accessLevel) + '</span>' +
          '</div>' +
          '<p class="am-role-blurb">' + escapeHtml(role.blurb) + '</p>' +
        '</div>' +
        manageBtn +
      '</div>' +
      '<div class="am-perm">' +
        '<h3 class="am-eyebrow am-perm-title">Module Permissions</h3>' +
        protectedHtml + scopeHtml + permissionsTableHtml(role) +
      '</div>';

    // RIGHT: users with this role, then the access summary directly below.
    $('#am-side').innerHTML =
      '<section class="am-panel am-side-card">' +
        '<h3 class="am-eyebrow am-side-head">Users With This Role</h3>' +
        (users.length
          ? '<ul class="am-users">' + users.map(userRowHtml).join('') + '</ul>'
          : '<div class="am-empty">No users are assigned to this role.</div>') +
        '<div class="am-card-foot"><a class="am-link" href="staff-users.html">View All Users <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a></div>' +
      '</section>' +
      '<section class="am-panel am-side-card">' +
        '<h3 class="am-eyebrow am-side-head">Access Summary</h3>' +
        '<div class="am-sum-row"><div class="am-eyebrow">Assigned Users</div><div class="am-sum-value am-sum-num">' + users.length + '</div></div>' +
        '<div class="am-sum-row"><div class="am-eyebrow">Access Level</div><div class="am-sum-value">' + escapeHtml(role.accessLevel) + '</div></div>' +
        '<div class="am-sum-row"><div class="am-eyebrow">Main Responsibility</div><div class="am-sum-value">' + escapeHtml(role.responsibility) + '</div></div>' +
      '</section>';
  }

  // ------------------------------------------------------------------
  // modals — same open/close/inert/focus pattern as Staff & Users
  // ------------------------------------------------------------------
  function modalHead(title) {
    return '<div class="modal-head"><h3 class="modal-title" id="am-modal-title">' + escapeHtml(title) + '</h3>' +
      '<button type="button" class="modal-close" data-action="close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div>';
  }

  function openModal(kind, triggerSel, extra) {
    var box = $('#am-modal');
    var overlay = $('#am-modal-overlay');
    var shell = $('.app-shell');
    state.modal = kind;
    state.triggerSel = triggerSel || null;

    if (kind === 'permissions') {
      var role = AMData.getRole(state.roleId);
      if (!role || role.locked) { state.modal = null; return; }
      draft = AMData.getPermissions(role.id);
      box.classList.remove('am-modal-sm');
      box.innerHTML = permissionsModalHtml(role);
    } else if (kind === 'user') {
      box.classList.add('am-modal-sm');
      box.innerHTML = userModalHtml(extra);
    }

    overlay.classList.add('open');
    document.body.classList.add('am-modal-open');
    if (shell) shell.setAttribute('inert', '');
    modalIsOpen = true;

    var first = $('input', box) || $('.modal-close', box);
    if (first) first.focus();
  }

  function closeModal() {
    var triggerSel = state.triggerSel;
    state.modal = null;
    state.triggerSel = null;
    draft = null;
    modalIsOpen = false;

    $('#am-modal-overlay').classList.remove('open');
    $('#am-modal').innerHTML = '';
    document.body.classList.remove('am-modal-open');
    var shell = $('.app-shell');
    if (shell) shell.removeAttribute('inert');

    if (triggerSel) {
      var trigger = $(triggerSel);
      if (trigger) trigger.focus();
    }
  }

  function handleModalKeydown(e) {
    if (!state.modal) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
      return;
    }
    if (e.key === 'Tab') {
      var items = $all('button, input, select, textarea, a[href]', $('#am-modal')).filter(function (el) {
        return !el.disabled && el.offsetParent !== null;
      });
      if (!items.length) return;
      var first = items[0];
      var last = items[items.length - 1];
      var active = document.activeElement;
      if (!$('#am-modal').contains(active)) {
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

  // ---- Manage Permissions modal ----
  function permissionsModalHtml(role) {
    var groupsHtml = AMData.getGroups().map(function (g) {
      return (
        '<div class="am-modal-group">' +
          '<div class="am-group-title am-modal-group-title">' + escapeHtml(g.label) + '</div>' +
          g.modules.map(function (m) {
            var on = draft[m.id] || [];
            return (
              '<div class="am-modal-mod" data-module="' + m.id + '">' +
                '<div class="am-mod-name">' + escapeHtml(m.label) + '</div>' +
                '<div class="am-switches">' +
                  m.actions.map(function (a) {
                    return (
                      '<label class="am-switch">' +
                        '<span>' + ACTION_LABELS[a] + '</span>' +
                        '<input type="checkbox" role="switch" data-mod="' + m.id + '" data-act="' + a + '"' +
                          (on.indexOf(a) !== -1 ? ' checked' : '') + '>' +
                        '<span class="am-switch-track" aria-hidden="true"></span>' +
                      '</label>'
                    );
                  }).join('') +
                '</div>' +
              '</div>'
            );
          }).join('') +
        '</div>'
      );
    }).join('');

    return (
      modalHead('Manage Permissions') +
      '<div class="am-modal-body">' +
        '<div class="am-modal-role">' +
          '<div class="am-icon" aria-hidden="true"><i class="fa-solid fa-' + role.icon + '"></i></div>' +
          '<div><div class="am-modal-role-name">' + escapeHtml(role.name) + '</div>' +
          '<div class="am-modal-role-sub">' + escapeHtml(role.accessLevel) + ' &middot; applies to everyone with this role</div></div>' +
        '</div>' +
        groupsHtml +
      '</div>' +
      '<div class="modal-footer">' +
        '<button type="button" class="btn" data-action="close">Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-action="save">Save Changes</button>' +
      '</div>'
    );
  }

  // Editing rules: Edit/Create/Manage need View; turning View off clears the rest.
  function handlePermissionToggle(input) {
    var mod = input.dataset.mod;
    var act = input.dataset.act;
    var inputs = $all('input[data-mod="' + mod + '"]', $('#am-modal'));
    if (input.checked && act !== 'view') {
      inputs.forEach(function (i) { if (i.dataset.act === 'view') i.checked = true; });
    }
    if (!input.checked && act === 'view') {
      inputs.forEach(function (i) { i.checked = false; });
    }
    draft[mod] = inputs.filter(function (i) { return i.checked; }).map(function (i) { return i.dataset.act; });
  }

  function savePermissions() {
    var result = AMData.savePermissions(state.roleId, draft);
    if (!result.ok) { showToast(result.error); closeModal(); return; }
    renderDetail();      // refresh before closeModal so focus returns to the new button
    closeModal();
    showToast('Permissions updated successfully.');
  }

  // ---- View user modal (read-only) ----
  function userModalHtml(userId) {
    var u = AM_MOCK.users.filter(function (x) { return x.id === userId; })[0];
    if (!u) return modalHead('User') + '<p class="am-modal-note">User not found.</p>';
    var role = AMData.getRole(u.role);
    var isClient = u.role === 'client';
    var isActive = u.status === 'active';
    var avatarCls = 'am-avatar' + (isClient ? ' am-avatar-client' : '') + (isActive ? '' : ' am-avatar-inactive');
    var badgeCls = 'status-badge am-status ' + (isActive ? 'am-status-active' : 'am-status-inactive');
    return (
      modalHead('User Details') +
      '<div class="am-modal-body">' +
        '<div class="am-profile">' +
          '<div class="' + avatarCls + '" aria-hidden="true">' + escapeHtml(initialsOf(u.name)) + '</div>' +
          '<div><div class="am-modal-role-name">' + escapeHtml(u.name) + '</div>' +
          '<div class="am-modal-role-sub">' + escapeHtml(role.name) + '</div></div>' +
        '</div>' +
        '<div class="am-info-row"><div class="am-info-label">Role</div><div class="am-info-value">' + escapeHtml(role.name) + '</div></div>' +
        '<div class="am-info-row"><div class="am-info-label">Access Level</div><div class="am-info-value">' + escapeHtml(role.accessLevel) + '</div></div>' +
        '<div class="am-info-row"><div class="am-info-label">Status</div><div class="am-info-value"><span class="' + badgeCls + '">' + (isActive ? 'Active' : 'Inactive') + '</span></div></div>' +
        '<p class="am-modal-note">Accounts are created and edited in Staff &amp; Users.</p>' +
      '</div>' +
      '<div class="modal-footer"><button type="button" class="btn" data-action="close">Close</button></div>'
    );
  }

  // ------------------------------------------------------------------
  // wiring
  // ------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', function () {
    renderRoleList();
    renderDetail();

    var list = $('#am-role-list');
    list.addEventListener('click', function (e) {
      var btn = e.target.closest('.am-role');
      if (btn) selectRole(btn.dataset.role, false);
    });
    list.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      var ids = AMData.getRoles().map(function (r) { return r.id; });
      var i = ids.indexOf(state.roleId);
      var next = ids[(i + (e.key === 'ArrowDown' ? 1 : -1) + ids.length) % ids.length];
      e.preventDefault();
      selectRole(next, true);
    });

    function onDetailClick(e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'manage') {
        openModal('permissions', '#am-manage-btn');
      } else if (btn.dataset.action === 'view-user') {
        openModal('user', '[data-action="view-user"][data-id="' + btn.dataset.id + '"]', btn.dataset.id);
      }
    }
    $('#am-main').addEventListener('click', onDetailClick);
    $('#am-side').addEventListener('click', onDetailClick);

    var box = $('#am-modal');
    box.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'close') closeModal();
      else if (btn.dataset.action === 'save') savePermissions();
    });
    box.addEventListener('change', function (e) {
      if (e.target.dataset && e.target.dataset.mod) handlePermissionToggle(e.target);
    });

    $('#am-modal-overlay').addEventListener('click', function (e) {
      if (e.target === $('#am-modal-overlay')) closeModal();
    });
    document.addEventListener('keydown', handleModalKeydown);
  });
})();