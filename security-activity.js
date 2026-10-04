// ============================================================
// PAWSITIVE CARE — Staff & Users › "Security & Activity" page
//
// FRONTEND ONLY. Nothing here reads or writes PCData, localStorage, or
// any Account. All records come from SA_MOCK below, accessed only through
// the small SAData object, so a later backend phase replaces SAData's
// function bodies and leaves the filtering and rendering code untouched.
//
// The sample records exist only on this page. They are not Accounts, are
// not stored anywhere, and never appear in Staff & Users.
// ============================================================

(function () {
  // ------------------------------------------------------------------
  // MOCK DATA (isolated) — replace with real data in the backend phase.
  //
  // One flat list. Each record is either an 'activity' entry (normal
  // clinic/account work) or a 'security' entry (sign-in failures and
  // account/access changes). A record lives in exactly one category, so
  // nothing is duplicated across the two tabs.
  //
  // Timestamps are generated relative to today so the sample list always
  // looks recent. A real backend would simply send the stored time.
  // ------------------------------------------------------------------
  function ago(days, hour, minute) {
    var d = new Date();
    d.setDate(d.getDate() - days);
    d.setHours(hour, minute, 0, 0);
    return d.getTime();
  }

  // DEMO-ONLY optional fields a backend will populate later (all optional;
  // the modal shows an explicit placeholder when one is absent):
  //   userRole, ipAddress, device, record, relatedAccount, changes, reason, notes
  //   changes = [{ field, from, to }]
  // Security-event-only optional fields (also demo-only):
  //   severity ('low' | 'medium' | 'high' — explicit, never computed),
  //   securityType, failedAttempts (number), accountStatus, location,
  //   timeline = [{ time, event }] in chronological order
  // The values below are sample/demo values (private-range example IPs),
  // present on a few records only, to show how the modal looks when filled.
  var SA_MOCK = {
    events: [
      // ---- Activity ----
      { id: 'ev-a01', category: 'activity', event: 'Signed In', user: 'Dr. Maria Santos', area: 'Sign-in',
        at: ago(1, 9, 12), description: 'Signed in to the clinic system.' },
      { id: 'ev-a02', category: 'activity', event: 'Updated Appointment', user: 'Carla Mendoza', area: 'Appointments',
        at: ago(1, 9, 48), description: 'Rescheduled an appointment to a different time slot.' },
      { id: 'ev-a03', category: 'activity', event: 'Updated Medical Record', user: 'Dr. Maria Santos', area: 'Medical Records',
        at: ago(1, 10, 25), description: 'Added consultation notes to a patient\u2019s medical record.' },
      { id: 'ev-a04', category: 'activity', event: 'Updated Client Information', user: 'Leah Navarro', area: 'Clients',
        target: 'Sample Client A', at: ago(1, 13, 5), description: 'Updated the contact details of a client.',
        ipAddress: '192.168.1.42', device: 'Chrome \u00b7 Windows', record: 'Client: Sample Client A',
        changes: [{ field: 'Contact number', from: '0917 000 0001', to: '0917 000 0002' }],
        reason: 'Client requested a new contact number', notes: 'Demo record.' },
      { id: 'ev-a05', category: 'activity', event: 'Signed In', user: 'Clinic Administrator', area: 'Sign-in',
        at: ago(2, 8, 30), description: 'Signed in to the clinic system.' },
      { id: 'ev-a06', category: 'activity', event: 'Added User', user: 'Clinic Administrator', area: 'Staff & Users',
        target: 'Ramon Villanueva', at: ago(2, 11, 15), description: 'Added a new staff account.' },
      { id: 'ev-a07', category: 'activity', event: 'Updated User', user: 'Clinic Administrator', area: 'Staff & Users',
        target: 'Carla Mendoza', at: ago(3, 14, 40), description: 'Updated a staff member\u2019s name and login details.',
        userRole: 'Administrator', record: 'Staff account: Carla Mendoza', relatedAccount: 'Carla Mendoza' },
      { id: 'ev-a08', category: 'activity', event: 'Viewed Account', user: 'Clinic Administrator', area: 'Staff & Users',
        target: 'Anna Reyes', at: ago(3, 15, 2), description: 'Opened the account details.' },
      { id: 'ev-a09', category: 'activity', event: 'Updated Profile', user: 'Anna Reyes', area: 'Profile',
        at: ago(4, 16, 20), description: 'Updated their own profile details.' },
      { id: 'ev-a10', category: 'activity', event: 'Signed In', user: 'Ramon Villanueva', area: 'Sign-in',
        at: ago(5, 9, 5), description: 'Signed in to the clinic system.' },

      // ---- Security events ----
      { id: 'ev-s01', category: 'security', event: 'Failed Login', user: 'Ramon Villanueva', area: 'Sign-in', status: 'failed',
        at: ago(1, 7, 58), description: 'A sign-in attempt was unsuccessful because the password entered did not match.',
        ipAddress: '192.168.1.25', device: 'Chrome \u00b7 Windows', reason: 'Incorrect password entered',
        severity: 'medium', securityType: 'Authentication', failedAttempts: 3, accountStatus: 'Active',
        timeline: [
          { time: '7:56 AM', event: 'Failed login attempt' },
          { time: '7:57 AM', event: 'Failed login attempt' },
          { time: '7:58 AM', event: 'Failed login attempt' }
        ] },
      { id: 'ev-s02', category: 'security', event: 'Password Changed', user: 'Anna Reyes', area: 'Account', status: 'completed',
        at: ago(2, 17, 35), description: 'Changed the password for their own account.',
        severity: 'low', securityType: 'Account' },
      { id: 'ev-s03', category: 'security', event: 'Role Changed', user: 'Clinic Administrator', area: 'Access', status: 'completed',
        target: 'Anna Reyes', at: ago(3, 10, 10), description: 'Role changed from Receptionist to Veterinarian.',
        userRole: 'Administrator', relatedAccount: 'Anna Reyes', severity: 'high', securityType: 'Access',
        changes: [{ field: 'Role', from: 'Receptionist', to: 'Veterinarian' }] },
      { id: 'ev-s04', category: 'security', event: 'Permission Changed', user: 'Clinic Administrator', area: 'Access', status: 'completed',
        target: 'Receptionist role', at: ago(4, 9, 40), description: 'Billing permissions were updated for the Receptionist role.' },
      { id: 'ev-s05', category: 'security', event: 'Account Deactivated', user: 'Clinic Administrator', area: 'Account', status: 'completed',
        target: 'Joy Castillo', at: ago(6, 12, 15), description: 'The account was set to inactive and can no longer sign in.' },
      { id: 'ev-s06', category: 'security', event: 'Failed Login', user: 'Leah Navarro', area: 'Sign-in', status: 'failed',
        at: ago(8, 8, 50), description: 'A sign-in attempt was unsuccessful because the password entered did not match.',
        severity: 'low', securityType: 'Authentication', failedAttempts: 1,
        timeline: [{ time: '8:50 AM', event: 'Failed login attempt' }] },
      { id: 'ev-s07', category: 'security', event: 'Account Activated', user: 'Clinic Administrator', area: 'Account', status: 'completed',
        target: 'Leah Navarro', at: ago(10, 10, 30), description: 'The account was set to active and can sign in again.' }
    ]
  };

  // ------------------------------------------------------------------
  // Presentation lookups (not data): display order for the event-type
  // filter, and one icon per event. Unknown events fall back to a plain
  // icon so new backend event names never break the list.
  // ------------------------------------------------------------------
  var EVENT_ORDER = {
    activity: ['Signed In', 'Updated Appointment', 'Updated Medical Record', 'Updated Profile',
               'Added User', 'Updated User', 'Viewed Account', 'Updated Client Information'],
    security: ['Failed Login', 'Password Changed', 'Account Activated', 'Account Deactivated',
               'Role Changed', 'Permission Changed']
  };
  var EVENT_ICONS = {
    'Signed In': 'right-to-bracket',
    'Updated Appointment': 'calendar-check',
    'Updated Medical Record': 'notes-medical',
    'Updated Profile': 'user-pen',
    'Added User': 'user-plus',
    'Updated User': 'user-pen',
    'Viewed Account': 'eye',
    'Updated Client Information': 'address-book',
    'Failed Login': 'lock',
    'Password Changed': 'key',
    'Account Activated': 'user-check',
    'Account Deactivated': 'user-slash',
    'Role Changed': 'user-tag',
    'Permission Changed': 'sliders'
  };
  var STATUS_LABELS = { completed: 'Completed', failed: 'Failed' };
  var MISSING = {
    ip: 'Not available', device: 'Not recorded', record: 'Not available', account: 'Not linked',
    reason: 'Not provided', notes: 'No additional notes available.', changes: 'No specific changes recorded.',
    role: 'Role not recorded'
  };
  var SEVERITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High' };
  var CATEGORY_LABELS = { activity: 'Activity', security: 'Security Event' };

  // ------------------------------------------------------------------
  // SAData — the only place that touches SA_MOCK. A backend phase swaps
  // these bodies for real calls; callers do not change.
  // ------------------------------------------------------------------
  var SAData = {
    getEvents: function (category) {
      return SA_MOCK.events.filter(function (e) { return e.category === category; });
    },
    getEvent: function (id) {
      return SA_MOCK.events.filter(function (e) { return e.id === id; })[0] || null;
    }
  };

  // ------------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------------
  var state = { tab: 'activity', search: '', user: 'all', event: 'all', date: '', modalId: null, triggerSel: null };

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

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dateKey(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function fmtDate(ts) {
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function fmtDateLong(ts) {
    return new Date(ts).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }
  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function iconFor(ev) {
    var name = EVENT_ICONS[ev.event] || 'circle-info';
    var cls = 'sa-ev-icon' + (ev.category === 'security' ? ' sa-ev-icon-security' : '') +
      (ev.status === 'failed' ? ' sa-ev-icon-failed' : '');
    return '<span class="' + cls + '" aria-hidden="true"><i class="fa-solid fa-' + name + '"></i></span>';
  }

  // ------------------------------------------------------------------
  // filtering
  // ------------------------------------------------------------------
  function filtersActive() {
    return !!(state.search.trim() || state.user !== 'all' || state.event !== 'all' || state.date);
  }

  function applyFilters(events) {
    var q = state.search.trim().toLowerCase();
    return events.filter(function (e) {
      if (state.user !== 'all' && e.user !== state.user) return false;
      if (state.event !== 'all' && e.event !== state.event) return false;
      if (state.date && dateKey(e.at) !== state.date) return false;
      if (q) {
        var hay = [e.user, e.event, e.target, e.area, e.description].join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  // ------------------------------------------------------------------
  // rendering
  // ------------------------------------------------------------------
  function renderFilterOptions() {
    var events = SAData.getEvents(state.tab);

    var users = [];
    events.forEach(function (e) { if (users.indexOf(e.user) === -1) users.push(e.user); });
    users.sort(function (a, b) { return a.localeCompare(b); });
    if (state.user !== 'all' && users.indexOf(state.user) === -1) state.user = 'all';

    var present = events.map(function (e) { return e.event; });
    var order = EVENT_ORDER[state.tab].filter(function (n) { return present.indexOf(n) !== -1; });
    present.forEach(function (n) { if (order.indexOf(n) === -1) order.push(n); }); // unknown names still listed
    if (state.event !== 'all' && order.indexOf(state.event) === -1) state.event = 'all';

    var userSel = $('#sa-user-filter');
    userSel.innerHTML = '<option value="all">All Users</option>' + users.map(function (u) {
      return '<option value="' + escapeHtml(u) + '">' + escapeHtml(u) + '</option>';
    }).join('');
    userSel.value = state.user;

    var evSel = $('#sa-event-filter');
    var allLabel = state.tab === 'security' ? 'All Security Events' : 'All Activity';
    evSel.innerHTML = '<option value="all">' + allLabel + '</option>' + order.map(function (n) {
      return '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + '</option>';
    }).join('');
    evSel.value = state.event;

    $('#sa-search').placeholder = state.tab === 'security' ? 'Search security events...' : 'Search activity...';
    $('#sa-search').setAttribute('aria-label', $('#sa-search').placeholder.replace('...', ''));
  }

  function renderTabs() {
    $all('#sa-tabs .view-tab').forEach(function (tab) {
      var on = tab.dataset.tab === state.tab;
      tab.classList.toggle('active', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.setAttribute('tabindex', on ? '0' : '-1');
    });
    $('#sa-panel').setAttribute('aria-labelledby', 'sa-tab-' + state.tab);
  }

  function renderHead() {
    var cols = state.tab === 'security'
      ? ['User', 'Event', 'Type', 'Severity', 'IP Address', 'Device', 'Date & Time', 'Action']
      : ['User', 'Activity', 'Date & Time', 'Module', 'Action'];
    var cls = { 'User': 'sa-c-user', 'Event': 'sa-c-event', 'Activity': 'sa-c-event', 'Date & Time': 'sa-c-when',
                'Type': 'sa-c-type', 'Module': 'sa-c-type', 'Status': 'sa-c-status', 'Action': 'sa-c-action',
                'Severity': 'sa-c-sev', 'IP Address': 'sa-c-ip', 'Device': 'sa-c-dev' };
    $('#sa-table-card').classList.toggle('sa-evt', state.tab === 'security');
    $('#sa-thead').innerHTML = '<tr role="row">' + cols.map(function (c) {
      return '<th scope="col" role="columnheader" class="' + cls[c] + '">' + escapeHtml(c) + '</th>';
    }).join('') + '</tr>';
  }

  // Security Events row: User | Event | Type | Severity | IP Address | Device | Date & Time | Action
  function securityRowHtml(ev) {
    var type = ev.securityType
      ? '<span class="sa-tag sa-tag-security">' + escapeHtml(ev.securityType) + '</span>'
      : '<span class="sa-missing">Not recorded</span>';
    return (
      '<tr role="row">' +
        '<td class="sa-c-user" role="cell"><div class="sa-user">' +
          '<div class="sa-avatar" aria-hidden="true">' + escapeHtml(initialsOf(ev.user)) + '</div>' +
          '<div class="sa-user-name">' + escapeHtml(ev.user) + '</div>' +
        '</div></td>' +
        '<td class="sa-c-event" role="cell"><div class="sa-event">' + iconFor(ev) +
          '<div class="sa-ev-text">' +
            '<div class="sa-ev-name">' + escapeHtml(ev.event) + '</div>' +
            (ev.target ? '<div class="sa-ev-sub">' + escapeHtml(ev.target) + '</div>' : '') +
          '</div></div></td>' +
        '<td class="sa-c-type" role="cell">' + type + '</td>' +
        '<td class="sa-c-sev" role="cell">' + severityBadge(ev) + '</td>' +
        '<td class="sa-c-ip" role="cell">' + val(ev.ipAddress, MISSING.ip) + '</td>' +
        '<td class="sa-c-dev" role="cell">' + val(ev.device, MISSING.device) + '</td>' +
        '<td class="sa-c-when" role="cell"><span class="sa-date">' + escapeHtml(fmtDate(ev.at)) + '</span> ' +
          '<span class="sa-time">' + escapeHtml(fmtTime(ev.at)) + '</span></td>' +
        '<td class="sa-c-action" role="cell"><button type="button" class="btn btn-sm" data-action="view" data-id="' + escapeHtml(ev.id) + '" ' +
          'aria-label="View details: ' + escapeHtml(ev.event) + ' by ' + escapeHtml(ev.user) + '">View</button></td>' +
      '</tr>'
    );
  }

  function rowHtml(ev) {
    if (ev.category === 'security') return securityRowHtml(ev);
    var isSecurity = false;
    var status = isSecurity && ev.status
      ? '<td class="sa-c-status" role="cell"><span class="status-badge sa-status sa-status-' + escapeHtml(ev.status) + '">' +
          escapeHtml(STATUS_LABELS[ev.status] || ev.status) + '</span></td>'
      : '';
    var typeTag = '<span class="sa-tag' + (isSecurity ? ' sa-tag-security' : '') + '">' + escapeHtml(ev.area) + '</span>';

    return (
      '<tr role="row">' +
        '<td class="sa-c-user" role="cell"><div class="sa-user">' +
          '<div class="sa-avatar" aria-hidden="true">' + escapeHtml(initialsOf(ev.user)) + '</div>' +
          '<div class="sa-user-name">' + escapeHtml(ev.user) + '</div>' +
        '</div></td>' +
        '<td class="sa-c-event" role="cell"><div class="sa-event">' + iconFor(ev) +
          '<div class="sa-ev-text">' +
            '<div class="sa-ev-name">' + escapeHtml(ev.event) + '</div>' +
            (ev.target ? '<div class="sa-ev-sub">' + escapeHtml(ev.target) + '</div>' : '') +
          '</div></div></td>' +
        '<td class="sa-c-when" role="cell"><span class="sa-date">' + escapeHtml(fmtDate(ev.at)) + '</span> ' +
          '<span class="sa-time">' + escapeHtml(fmtTime(ev.at)) + '</span></td>' +
        '<td class="sa-c-type" role="cell">' + typeTag + '</td>' +
        status +
        '<td class="sa-c-action" role="cell"><button type="button" class="btn btn-sm" data-action="view" data-id="' + escapeHtml(ev.id) + '" ' +
          'aria-label="View details: ' + escapeHtml(ev.event) + ' by ' + escapeHtml(ev.user) + '">View</button></td>' +
      '</tr>'
    );
  }

  function renderList() {
    var all = SAData.getEvents(state.tab);
    var rows = applyFilters(all).sort(function (a, b) { return b.at - a.at; }); // newest first
    var noun = state.tab === 'security' ? 'security events' : 'activity records';

    var count = $('#sa-count');
    count.innerHTML = '<span>Showing ' + rows.length + ' of ' + all.length + ' ' + noun + '</span>' +
      (filtersActive() ? '<button type="button" class="sa-clear" id="sa-clear">Clear filters</button>' : '');

    var card = $('#sa-table-card');
    var empty = $('#sa-empty');
    if (!rows.length) {
      $('#sa-tbody').innerHTML = '';
      card.style.display = 'none';
      if (!all.length) {
        $('#sa-empty-title').textContent = state.tab === 'security' ? 'No security events yet' : 'No activity yet';
        $('#sa-empty-sub').textContent = 'Records will show up here as they happen.';
      } else {
        $('#sa-empty-title').textContent = 'Nothing matches your filters';
        $('#sa-empty-sub').textContent = 'Try a different search, user, event, or date.';
      }
      empty.style.display = 'block';
      return;
    }
    card.style.display = '';
    empty.style.display = 'none';
    $('#sa-tbody').innerHTML = rows.map(rowHtml).join('');
  }

  function renderAll() {
    renderTabs();
    renderFilterOptions();
    renderHead();
    renderList();
  }

  function setTab(tab, focusTab) {
    if (tab === state.tab) return;
    state.tab = tab;
    state.event = 'all';   // event names differ between the two tabs
    renderAll();
    if (focusTab) $('#sa-tab-' + tab).focus();
  }

  // ------------------------------------------------------------------
  // detail modal — read-only. Same open/close/inert/focus pattern as
  // Staff & Users and Access Management.
  // ------------------------------------------------------------------
  // Severity pill from the explicit event.severity value (never computed).
  function severityBadge(ev) {
    return ev.severity
      ? '<span class="status-badge sa-status sa-sev sa-sev-' + escapeHtml(ev.severity) + '">' + escapeHtml(SEVERITY_LABELS[ev.severity] || ev.severity) + '</span>'
      : '<span class="sa-missing">Not recorded</span>';
  }

  // A value, or the explicit placeholder (muted) when the record has none.
  function val(v, placeholder) {
    var has = v != null && String(v).trim() !== '';
    return has ? escapeHtml(v) : '<span class="sa-missing">' + escapeHtml(placeholder) + '</span>';
  }

  function infoRow(label, valueHtml, cls) {
    return '<div class="sa-info-row"><div class="sa-info-label">' + escapeHtml(label) + '</div>' +
      '<div class="sa-info-value' + (cls ? ' ' + cls : '') + '">' + valueHtml + '</div></div>';
  }

  function section(title, innerHtml) {
    return '<section class="sa-sec"><h4 class="sa-sec-title">' + escapeHtml(title) + '</h4>' + innerHtml + '</section>';
  }

  function changesHtml(ev) {
    var list = Array.isArray(ev.changes) ? ev.changes : [];
    if (!list.length) return '<div class="sa-missing sa-missing-block">' + escapeHtml(MISSING.changes) + '</div>';
    return list.map(function (c) {
      return '<div class="sa-change">' +
        '<div class="sa-change-field">' + escapeHtml(c.field) + '</div>' +
        '<div class="sa-change-pair">' +
          '<div class="sa-change-cell sa-change-from"><span class="sa-change-cap">Previous Value</span>' + val(c.from, 'Empty') + '</div>' +
          '<span class="sa-change-arrow" aria-hidden="true"><i class="fa-solid fa-arrow-right"></i></span>' +
          '<div class="sa-change-cell sa-change-to"><span class="sa-change-cap">New Value</span>' + val(c.to, 'Empty') + '</div>' +
        '</div></div>';
    }).join('');
  }

  // Security Event Details only. Activity Details (detailHtml below) is unchanged.
  function timelineHtml(ev) {
    var list = Array.isArray(ev.timeline) ? ev.timeline : [];
    if (!list.length) return '<div class="sa-missing sa-missing-block">No timeline information available.</div>';
    return '<ol class="sa-timeline">' + list.map(function (t) {
      return '<li class="sa-tl-item"><span class="sa-tl-time">' + val(t.time, 'Time not recorded') + '</span>' +
        '<span class="sa-tl-text">' + val(t.event, 'Not recorded') + '</span></li>';
    }).join('') + '</ol>';
  }

  function securityDetailHtml(ev) {
    var userInfo =
      '<div class="sa-person">' +
        '<div class="sa-avatar sa-avatar-lg" aria-hidden="true">' + escapeHtml(initialsOf(ev.user)) + '</div>' +
        '<div class="sa-person-text"><div class="sa-person-name">' + escapeHtml(ev.user) + '</div>' +
        '<div class="sa-person-role">' + val(ev.userRole, MISSING.role) + '</div></div>' +
      '</div>' +
      '<div class="sa-pair">' +
        '<div><div class="sa-info-label">IP Address</div><div class="sa-info-value">' + val(ev.ipAddress, MISSING.ip) + '</div></div>' +
        '<div><div class="sa-info-label">Device</div><div class="sa-info-value">' + val(ev.device, MISSING.device) + '</div></div>' +
      '</div>';


    var summary =
      infoRow('Event', escapeHtml(ev.event) + (ev.description ? '<div class="sa-desc-sub">' + escapeHtml(ev.description) + '</div>' : '')) +
      infoRow('Date & Time', escapeHtml(fmtDate(ev.at) + ' \u00b7 ' + fmtTime(ev.at))) +
      infoRow('Type', val(ev.securityType, 'Not recorded')) +
      infoRow('Severity', severityBadge(ev));
 
    var details =
      infoRow('Failed Attempts', val(ev.failedAttempts, 'Not recorded')) +
      infoRow('Account Status', val(ev.accountStatus, 'Not recorded')) +
      infoRow('Reason', val(ev.reason, MISSING.reason));

    var additional =
      infoRow('Related Account', val(ev.relatedAccount || ev.target, MISSING.account)) +
      infoRow('Location', val(ev.location, 'Not recorded')) +
      infoRow('Notes', val(ev.notes, MISSING.notes));

    var hasChanges = Array.isArray(ev.changes) && ev.changes.length;
    return (
      '<div class="sa-modal-top">' +
        '<h3 class="modal-title" id="sa-modal-title"><span class="sa-title-icon" aria-hidden="true"><i class="fa-solid fa-user-shield"></i></span>Security Event Details</h3>' +
        '<button type="button" class="modal-close" data-action="close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>' +
      '</div>' +
      '<div class="sa-modal-body">' +
        section('User Information', userInfo) +
        section('Security Summary', summary) +
        section('Security Details', details) +
        section('Event Timeline', timelineHtml(ev)) +
        (hasChanges ? section('Changes Made', changesHtml(ev)) : '') +
        section('Location', additional) +
      '</div>' +
      '<div class="modal-footer"><button type="button" class="btn" data-action="close">Close</button></div>'
    );
  }

  function detailHtml(ev) {
    if (ev.category === 'security') return securityDetailHtml(ev);
    var isSecurity = false;
    var title = isSecurity ? 'Security Event Details' : 'Activity Details';

    var userInfo =
      '<div class="sa-person">' +
        '<div class="sa-avatar sa-avatar-lg" aria-hidden="true">' + escapeHtml(initialsOf(ev.user)) + '</div>' +
        '<div class="sa-person-text"><div class="sa-person-name">' + escapeHtml(ev.user) + '</div>' +
        '<div class="sa-person-role">' + val(ev.userRole, MISSING.role) + '</div></div>' +
      '</div>' +
      '<div class="sa-pair">' +
        '<div><div class="sa-info-label">IP Address</div><div class="sa-info-value">' + val(ev.ipAddress, MISSING.ip) + '</div></div>' +
        '<div><div class="sa-info-label">Device</div><div class="sa-info-value">' + val(ev.device, MISSING.device) + '</div></div>' +
      '</div>';

    var summary = [];
    summary.push(infoRow(isSecurity ? 'Event' : 'Activity',
      escapeHtml(ev.event) + (ev.description ? '<div class="sa-desc-sub">' + escapeHtml(ev.description) + '</div>' : '')));
    summary.push(infoRow('Date & Time', escapeHtml(fmtDate(ev.at) + ' \u00b7 ' + fmtTime(ev.at))));
    summary.push(infoRow(isSecurity ? 'Area' : 'Module', val(ev.area, 'Not available')));
    if (isSecurity) {
      summary.push(infoRow('Status', ev.status
        ? '<span class="status-badge sa-status sa-status-' + escapeHtml(ev.status) + '">' + escapeHtml(STATUS_LABELS[ev.status] || ev.status) + '</span>'
        : val('', 'Not available')));
    } else {
      summary.push(infoRow('Record', val(ev.record, MISSING.record)));
    }

    var details = [
      infoRow('Reason', val(ev.reason, MISSING.reason)),
      infoRow('Related Account', val(ev.relatedAccount || ev.target, MISSING.account)),
      infoRow('Notes', val(ev.notes, MISSING.notes))
    ];

    var hasChanges = Array.isArray(ev.changes) && ev.changes.length;
    return (
      '<div class="sa-modal-top">' +
        '<h3 class="modal-title" id="sa-modal-title"><span class="sa-title-icon" aria-hidden="true"><i class="fa-solid fa-' + (isSecurity ? 'user-shield' : 'clock-rotate-left') + '"></i></span>' + title + '</h3>' +
        '<button type="button" class="modal-close" data-action="close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>' +
      '</div>' +
      '<div class="sa-modal-body">' +
        section('User Information', userInfo) +
        section(isSecurity ? 'Event Summary' : 'Activity Summary', summary.join('')) +
        (!isSecurity || hasChanges ? section('Changes Made', changesHtml(ev)) : '') +
        section('Additional Details', details.join('')) +
      '</div>' +
      '<div class="modal-footer"><button type="button" class="btn" data-action="close">Close</button></div>'
    );
  }

  function openModal(id, triggerSel) {
    var ev = SAData.getEvent(id);
    if (!ev) return;
    state.modalId = id;
    state.triggerSel = triggerSel || null;

    $('#sa-modal').innerHTML = detailHtml(ev);
    $('#sa-modal-overlay').classList.add('open');
    document.body.classList.add('sa-modal-open');
    var shell = $('.app-shell');
    if (shell) shell.setAttribute('inert', '');

    var close = $('.modal-close', $('#sa-modal'));
    if (close) close.focus();
  }

  function closeModal() {
    var triggerSel = state.triggerSel;
    state.modalId = null;
    state.triggerSel = null;

    $('#sa-modal-overlay').classList.remove('open');
    $('#sa-modal').innerHTML = '';
    document.body.classList.remove('sa-modal-open');
    var shell = $('.app-shell');
    if (shell) shell.removeAttribute('inert');

    // The list is not rebuilt while the modal is open, so the same row's
    // View button is still there to take focus back.
    if (triggerSel) {
      var trigger = $(triggerSel);
      if (trigger) trigger.focus();
    }
  }

  // Escape closes; Tab stays inside the open dialog.
  function handleModalKeydown(e) {
    if (!state.modalId) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
      return;
    }
    if (e.key === 'Tab') {
      var items = $all('button, input, select, textarea, a[href]', $('#sa-modal')).filter(function (el) {
        return !el.disabled && el.offsetParent !== null;
      });
      if (!items.length) return;
      var first = items[0];
      var last = items[items.length - 1];
      var active = document.activeElement;
      if (!$('#sa-modal').contains(active)) {
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
  // wiring
  // ------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', function () {
    renderAll();

    var tabs = $('#sa-tabs');
    tabs.addEventListener('click', function (e) {
      var tab = e.target.closest('.view-tab');
      if (tab) setTab(tab.dataset.tab, false);
    });
    tabs.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
      var ids = $all('.view-tab', tabs).map(function (t) { return t.dataset.tab; });
      var i = ids.indexOf(state.tab);
      var next = e.key === 'Home' ? 0 : e.key === 'End' ? ids.length - 1
        : (i + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
      e.preventDefault();
      if (state.tab === ids[next]) $('#sa-tab-' + ids[next]).focus();
      else setTab(ids[next], true);
    });

    $('#sa-search').addEventListener('input', function (e) { state.search = e.target.value; renderList(); });
    $('#sa-user-filter').addEventListener('change', function (e) { state.user = e.target.value; renderList(); });
    $('#sa-event-filter').addEventListener('change', function (e) { state.event = e.target.value; renderList(); });
    $('#sa-date-filter').addEventListener('change', function (e) { state.date = e.target.value; renderList(); });

    $('#sa-count').addEventListener('click', function (e) {
      if (!e.target.closest('#sa-clear')) return;
      state.search = ''; state.user = 'all'; state.event = 'all'; state.date = '';
      $('#sa-search').value = '';
      $('#sa-date-filter').value = '';
      renderFilterOptions();
      renderList();
      $('#sa-search').focus();
    });

    $('#sa-tbody').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action="view"]');
      if (!btn) return;
      openModal(btn.dataset.id, '[data-action="view"][data-id="' + btn.dataset.id + '"]');
    });

    $('#sa-modal').addEventListener('click', function (e) {
      if (e.target.closest('[data-action="close"]')) closeModal();
    });
    $('#sa-modal-overlay').addEventListener('click', function (e) {
      if (e.target === $('#sa-modal-overlay')) closeModal();
    });
    document.addEventListener('keydown', handleModalKeydown);
  });
})();