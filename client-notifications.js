// ============================================================
// PAWSITIVE CARE — Client (Pet Owner) Notifications
//
// READ-ONLY with respect to appointment/vaccination/queue data —
// this page never writes an appointment, patient, or vaccination
// record. The only writes it makes are read-state flips on
// notification records themselves, and only through
// PCData.markAsReadForClient / PCData.markAllAsReadForClient
// (notifications-data-store.js), which re-verify ownership before
// touching anything.
//
// No second notification-generation system is created here. All
// notifications still come from the single shared
// PCData.getNotifications()/sync() pipeline in
// notifications-data-store.js (same source Administrator
// Notifications uses) — this page only asks that file for the
// CLIENT-SCOPED view of it: getNotificationsForClient(client) /
// getNotificationCountsForClient(client) / markAsReadForClient(...) /
// markAllAsReadForClient(...). See that file for exactly how
// ownership is resolved (real appointment/vaccination ids tied back
// to this client's own pets — never by matching notification text).
// ============================================================

(function () {
  var currentFilter = 'all'; // 'all' | 'unread' | 'appointment' | 'vaccination'
  var lastSignature = null; // skip re-render when nothing changed

  var els = {};

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function initials(name) {
    var parts = (name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    var first = parts[0][0] || '';
    var last = parts.length > 1 ? (parts[parts.length - 1][0] || '') : '';
    return (first + last).toUpperCase();
  }

  function renderSidebarFooter(client) {
    document.getElementById('footer-avatar').textContent = initials(client.name);
    document.getElementById('footer-name').textContent = client.name;
  }

  function cacheEls() {
    els.statTotal = document.getElementById('statTotal');
    els.statUnread = document.getElementById('statUnread');
    els.statHigh = document.getElementById('statHigh');
    els.statRecent = document.getElementById('statRecent');
    els.list = document.getElementById('notifList');
    els.empty = document.getElementById('notifEmpty');
    els.emptyText = document.getElementById('notifEmptyText');
    els.filterTabs = document.querySelectorAll('.notif-filter-tab');
    els.markAllBtn = document.getElementById('markAllReadBtn');
  }

  function timeAgo(ts) {
    var diff = Date.now() - ts;
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    var days = Math.floor(hrs / 24);
    return days + 'd ago';
  }

  function priorityIcon(priority) {
    if (priority === 'high') return '<i class="fa-solid fa-circle-exclamation"></i>';
    if (priority === 'medium') return '<i class="fa-solid fa-triangle-exclamation"></i>';
    return '<i class="fa-solid fa-circle-info"></i>';
  }

  // Only appointment/vaccination conditions ever reach a client (see
  // CLIENT_VISIBLE_CATEGORIES in notifications-data-store.js) — icons
  // cover exactly those conditions, plus a generic fallback.
  function conditionIcon(n) {
    if (n.category === 'appointment') {
      if (n.condition === 'cancelled') return '<i class="fa-solid fa-calendar-xmark"></i>';
      if (n.condition === 'tomorrow') return '<i class="fa-solid fa-calendar-days"></i>';
      return '<i class="fa-solid fa-calendar-day"></i>'; // 'today'
    }
    if (n.category === 'vaccination') {
      return n.condition === 'overdue'
        ? '<i class="fa-solid fa-triangle-exclamation"></i>'
        : '<i class="fa-solid fa-syringe"></i>';
    }
    return '<i class="fa-solid fa-bell"></i>';
  }

  function render(D, client, force) {
    var counts = D.getNotificationCountsForClient(client);
    var all = D.getNotificationsForClient(client);

    // Same idle-skip guard as the Administrator Notifications page —
    // D.onChange() fires this on every 1.5s safety-net poll too, so
    // skip the DOM rebuild when nothing actually changed.
    var signature = currentFilter + '|' + JSON.stringify(counts) + '|' + all.map(function (n) { return n.id + ':' + n.read; }).join(',');
    if (!force && signature === lastSignature) return;
    lastSignature = signature;

    els.statTotal.textContent = counts.total;
    els.statUnread.textContent = counts.unread;
    els.statHigh.textContent = counts.highPriority;
    els.statRecent.textContent = all.filter(function (n) { return Date.now() - n.createdAt < 24 * 60 * 60 * 1000; }).length;

    var filtered = all.filter(function (n) {
      if (currentFilter === 'unread') return !n.read;
      if (currentFilter === 'appointment') return n.category === 'appointment';
      if (currentFilter === 'vaccination') return n.category === 'vaccination';
      return true;
    });

    els.list.innerHTML = '';

    if (!filtered.length) {
      els.emptyText.textContent = currentFilter === 'unread' ? 'No unread notifications.' : 'No notifications yet.';
      els.empty.style.display = 'flex';
      els.list.style.display = 'none';
      return;
    }
    els.empty.style.display = 'none';
    els.list.style.display = 'flex';

    filtered.forEach(function (n) {
      var row = document.createElement('div');
      row.className = 'notif-item priority-' + n.priority + (n.read ? ' is-read' : ' is-unread');

      row.innerHTML =
        '<div class="notif-item-icon">' + conditionIcon(n) + '</div>' +
        '<div class="notif-item-body">' +
        '<div class="notif-item-top">' +
        '<span class="notif-item-title">' + esc(n.title) + '</span>' +
        '<span class="notif-badge notif-badge-' + n.priority + '">' + priorityIcon(n.priority) + ' ' + n.priority + '</span>' +
        '</div>' +
        '<div class="notif-item-message">' + esc(n.message) + '</div>' +
        '<div class="notif-item-time">' + timeAgo(n.createdAt) + '</div>' +
        '</div>' +
        (n.read ? '' : '<button class="notif-item-mark" data-id="' + esc(n.id) + '" title="Mark as read"><i class="fa-solid fa-check"></i></button>');

      els.list.appendChild(row);
    });

    els.list.querySelectorAll('.notif-item-mark').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        D.markAsReadForClient(client, btn.getAttribute('data-id'));
        render(D, client, true);
      });
    });
  }

  function wireFilters(D, client) {
    els.filterTabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        currentFilter = tab.getAttribute('data-filter');
        els.filterTabs.forEach(function (t) { t.classList.remove('is-active'); });
        tab.classList.add('is-active');
        render(D, client, true);
      });
    });
  }

  function wireMarkAll(D, client) {
    els.markAllBtn.addEventListener('click', function () {
      D.markAllAsReadForClient(client);
      render(D, client, true);
    });
  }

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

    cacheEls();
    renderSidebarFooter(client);
    wireFilters(D, client);
    wireMarkAll(D, client);
    render(D, client, true);

    document.getElementById('logout-btn').addEventListener('click', function (e) {
      e.preventDefault();
      window.PCClientAuth.logoutClient();
    });

    // Live updates — picks up e.g. the Administrator confirming/
    // cancelling this client's appointment, or a vaccination rolling
    // into "Due soon"/"Overdue" as today's date advances, exactly like
    // every other Client page's D.onChange() wiring.
    D.onChange(function () { render(D, client); });
  });
})();