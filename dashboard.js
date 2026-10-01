// ============================================================
// PAWSITIVE CARE — Administrator Dashboard
//
// DOM rendering, UI interactions and event handling only. All data
// comes from PCData (data-store.js) and PCData.Dashboard
// (dashboard-data-store.js) — nothing here reads or writes
// localStorage directly, and nothing here mutates core records.
//
// Requires: data-store.js, dashboard-data-store.js loaded first.
// ============================================================

(function () {
  function $(selector, ctx) {
    return (ctx || document).querySelector(selector);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function speciesIcon(species) {
    if (window.PCData && PCData.SPECIES_ICON && PCData.SPECIES_ICON[species]) {
      return PCData.SPECIES_ICON[species];
    }
    return '<i class="fa-solid fa-paw"></i>';
  }

  var QUEUE_STATUS_LABELS = {
    waiting: 'Waiting',
    called: 'Called',
    'in-consultation': 'In Consultation'
  };

  var STATUS_BADGE_CLASS = {
    pending: 'dash-badge-pending',
    confirmed: 'dash-badge-confirmed',
    arrived: 'dash-badge-arrived',
    completed: 'dash-badge-completed',
    cancelled: 'dash-badge-cancelled'
  };

  // Badge color for the "Now Serving" patient's queueStatus (waiting
  // patients always render with the fixed "Waiting" badge below, since
  // that's the only status a waiting-list entry can have).
  var QUEUE_BADGE_CLASS = {
    waiting: 'dash-badge-pending',
    called: 'dash-badge-arrived',
    'in-consultation': 'dash-badge-confirmed'
  };

  // Optional "checked in Xm ago" suffix for a queue row's meta line.
  // Purely additive: if the record has no arrival timestamp,
  // formatRelativeTime returns '' and this contributes nothing, so
  // rows render exactly as before when that data isn't present.
  function checkedInSuffix(ts) {
    var rel = formatRelativeTime(ts);
    if (!rel) return '';
    return ' · checked in ' + (rel === 'Just now' ? 'just now' : rel);
  }

  // Optional "~N min wait" suffix, read defensively from whichever
  // estimated-wait field a queue record may carry. Renders nothing if
  // the record doesn't have one, per "estimated wait when available".
  function estimatedWaitSuffix(q) {
    var mins = q.estimatedWaitMinutes != null ? q.estimatedWaitMinutes :
      (q.estimatedWait != null ? q.estimatedWait :
      (q.waitMinutes != null ? q.waitMinutes : null));
    if (mins == null || isNaN(mins)) return '';
    return ' · ~' + Math.round(mins) + ' min wait';
  }

  // Formatting only (no data derivation) — relative time for
  // Recent Activity timestamps, which are real PCData arrivedAt values.
  function formatRelativeTime(ts) {
    if (!ts) return '';
    var diffMs = Date.now() - ts;
    if (diffMs < 0) diffMs = 0;
    var mins = Math.round(diffMs / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return mins + (mins === 1 ? ' minute ago' : ' minutes ago');
    var hours = Math.round(mins / 60);
    if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
    var days = Math.round(hours / 24);
    return days + (days === 1 ? ' day ago' : ' days ago');
  }

  function statusLabel(status) {
    if (window.PCData && PCData.STATUS_LABELS && PCData.STATUS_LABELS[status]) {
      return PCData.STATUS_LABELS[status];
    }
    return status || '';
  }

  // ------------------------------------------------------------------
  // Welcome strip — today's real date (formatDateLabel/todayStr are
  // both confirmed PCData functions), not a hardcoded string.
  // ------------------------------------------------------------------
  function renderWelcome() {
    var sub = $('#dash-welcome-sub');
    if (!sub || !window.PCData || typeof PCData.formatDateLabel !== 'function') return;
    sub.textContent = "Here's what's happening at the clinic today — " + PCData.formatDateLabel(PCData.todayStr()) + '.';
  }

  // ------------------------------------------------------------------
  // Today's Appointments (larger card)
  // ------------------------------------------------------------------
  function renderTodayAppointments() {
    var wrap = $('#dash-appointments-list');
    if (!wrap) return;
    var list = PCData.Dashboard.getTodayAppointments();

    if (!list.length) {
      wrap.innerHTML =
        '<div class="empty-state">' +
          '<img class="empty-state-illustration" src="img/appointments.png" alt="">' +
          '<div class="empty-state-text">No appointments scheduled for today</div>' +
          '<div class="empty-state-sub">New bookings will show up here automatically.</div>' +
        '</div>';
      return;
    }

    wrap.innerHTML = list.map(function (a) {
      var badgeClass = STATUS_BADGE_CLASS[a.status] || 'dash-badge-pending';
      var timeLabel = PCData.formatTimeLabel ? PCData.formatTimeLabel(a.time) : a.time;
      return (
        '<div class="appt-row">' +
          '<div class="appt-row-main">' +
            '<span class="appt-row-icon">' + speciesIcon(a.species) + '</span>' +
            '<div class="appt-row-text">' +
              '<div class="appt-row-name">' + escapeHtml(a.pet) + ' <span>· ' + escapeHtml(a.owner) + '</span></div>' +
              '<div class="appt-row-meta">' + escapeHtml(a.reason || 'No reason given') + ' · ' + escapeHtml(a.vet) + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="appt-row-time">' + escapeHtml(timeLabel) + '</div>' +
          '<span class="dash-badge ' + badgeClass + '">' + escapeHtml(statusLabel(a.status)) + '</span>' +
        '</div>'
      );
    }).join('');
  }

  // ------------------------------------------------------------------
  // Queue Status (smaller card)
  // ------------------------------------------------------------------
  function renderQueueStatus() {
    var nowWrap = $('#dash-queue-now');
    var waitWrap = $('#dash-queue-waiting');
    var nowLabel = $('#dash-queue-now-label');
    var waitingSection = $('#dash-queue-waiting-section');
    var bodyEl = $('#dash-queue-body');
    var livePill = $('#dash-queue-live-pill');
    if (!nowWrap && !waitWrap) return;

    var snap = PCData.Dashboard.getQueueSnapshot();
    // When there's genuinely no one being served AND no one waiting,
    // show ONE compact empty state for the whole card instead of two
    // separate labeled empty sentences ("Now Serving" / "Waiting"
    // each with their own "No X" line), and center it in the card's
    // full (now equal-to-Today's-Appointments) height via .is-empty.
    var isFullyEmpty = !snap.serving && !snap.waiting.length;

    if (nowLabel) nowLabel.style.display = isFullyEmpty ? 'none' : '';
    if (waitingSection) waitingSection.style.display = isFullyEmpty ? 'none' : '';
    if (bodyEl) bodyEl.classList.toggle('is-empty', isFullyEmpty);

    // Live status pill in the card head: hidden while the queue is
    // fully empty (the empty state already says as much), otherwise
    // shows the current waiting count so "how busy is the queue right
    // now" is readable without scanning the whole list.
    if (livePill) {
      if (isFullyEmpty) {
        livePill.style.display = 'none';
      } else {
        var waitingCount = snap.waiting.length;
        livePill.style.display = '';
        livePill.classList.toggle('is-clear', waitingCount === 0);
        livePill.textContent = waitingCount === 0 ? 'Queue clear' :
          waitingCount + (waitingCount === 1 ? ' patient waiting' : ' patients waiting');
      }
    }

    if (isFullyEmpty) {
      if (nowWrap) {
        nowWrap.innerHTML =
          '<div class="empty-state">' +
            '<img class="empty-state-illustration" src="img/queue.png" alt="">' +
            '<div class="empty-state-text">No patients in the queue right now</div>' +
            '<div class="empty-state-sub">New patients will appear here once they check in.</div>' +
          '</div>';
      }
      if (waitWrap) waitWrap.innerHTML = '';
      return;
    }

    if (nowWrap) {
      if (snap.serving) {
        var s = snap.serving;
        var sStatusLabel = QUEUE_STATUS_LABELS[s.queueStatus] || s.queueStatus || '';
        var sBadgeClass = QUEUE_BADGE_CLASS[s.queueStatus] || 'dash-badge-arrived';
        nowWrap.innerHTML =
          '<div class="queue-now-card">' +
            '<div class="queue-now-main">' +
              '<div class="queue-code">' + escapeHtml(s.queueCode || '—') + '</div>' +
              '<div class="appt-row-text">' +
                '<div class="appt-row-name">' + escapeHtml(s.pet) + ' <span>· ' + escapeHtml(s.owner) + '</span></div>' +
                '<div class="appt-row-meta">' + escapeHtml(s.vet) + checkedInSuffix(s.arrivedAt) + '</div>' +
              '</div>' +
            '</div>' +
            '<span class="dash-badge ' + sBadgeClass + '">' + escapeHtml(sStatusLabel) + '</span>' +
          '</div>';
      } else {
        nowWrap.innerHTML = '<div class="empty-note">No patient currently being served.</div>';
      }
    }

    if (waitWrap) {
      if (!snap.waiting.length) {
        waitWrap.innerHTML = '<div class="empty-note">No one waiting in the queue.</div>';
      } else {
        waitWrap.innerHTML = snap.waiting.map(function (q, i) {
          var posClass = i === 0 ? 'queue-pos is-next' : 'queue-pos';
          return (
            '<div class="appt-row">' +
              '<div class="appt-row-main">' +
                '<span class="' + posClass + '">' + (i + 1) + '</span>' +
                '<span class="appt-row-icon">' + speciesIcon(q.species) + '</span>' +
                '<div class="appt-row-text">' +
                  '<div class="appt-row-name">' + escapeHtml(q.pet) + ' <span>· ' + escapeHtml(q.owner) + '</span></div>' +
                  '<div class="appt-row-meta">' + escapeHtml(q.reason || '') + ' · ' + escapeHtml(q.vet) +
                    checkedInSuffix(q.arrivedAt) + estimatedWaitSuffix(q) + '</div>' +
                '</div>' +
              '</div>' +
              '<div class="appt-row-time">' + escapeHtml(q.queueCode || '—') + '</div>' +
              '<span class="dash-badge dash-badge-arrived">Waiting</span>' +
            '</div>'
          );
        }).join('');
      }
    }
  }

  // ------------------------------------------------------------------
  // Inventory Alerts
  // ------------------------------------------------------------------
  function renderInventoryAlerts() {
    var wrap = $('#dash-inventory-list');
    if (!wrap) return;

    var alerts = PCData.Dashboard.getInventoryAlerts();
    var rows = [];

    alerts.expired.forEach(function (item) {
      rows.push({ item: item, badge: 'Expired', badgeClass: 'dash-badge-cancelled' });
    });
    alerts.lowStock.forEach(function (item) {
      // an item can be both expired and low stock — list it once, as Expired
      var alreadyListed = alerts.expired.some(function (e) { return e.id === item.id; });
      if (alreadyListed) return;
      rows.push({ item: item, badge: 'Low Stock', badgeClass: 'dash-badge-pending' });
    });

    if (!rows.length) {
      wrap.innerHTML =
        '<div class="empty-state">' +
          '<span class="empty-state-icon"><i class="fa-solid fa-boxes-stacked"></i></span>' +
          '<div class="empty-state-text">All inventory levels look healthy</div>' +
          '<div class="empty-state-sub">Nothing needs attention right now.</div>' +
        '</div>';
      return;
    }

    wrap.innerHTML = rows.map(function (r) {
      var item = r.item;
      var expiryText = item.expirationDate ? ' · expires ' + escapeHtml(item.expirationDate) : '';
      var severityClass = r.badge === 'Expired' ? 'is-expired' : 'is-low';
      return (
        '<div class="appt-row ' + severityClass + '">' +
          '<div class="appt-row-main">' +
            '<span class="appt-row-icon"><i class="fa-solid fa-box"></i></span>' +
            '<div class="appt-row-text">' +
              '<div class="appt-row-name">' + escapeHtml(item.name) + '</div>' +
              '<div class="appt-row-meta">' + escapeHtml(item.quantity) + ' ' + escapeHtml(item.unit) +
                ' in stock' + expiryText + '</div>' +
            '</div>' +
          '</div>' +
          '<span class="dash-badge ' + r.badgeClass + '">' + r.badge + '</span>' +
        '</div>'
      );
    }).join('');
  }

  // ------------------------------------------------------------------
  // Recent Activity (appointments only, per current scope)
  // ------------------------------------------------------------------
  function renderRecentActivity() {
    var wrap = $('#dash-activity-list');
    if (!wrap) return;

    var activity = PCData.Dashboard.getRecentActivity(8);

    if (!activity.length) {
      wrap.innerHTML =
        '<div class="empty-state">' +
          '<span class="empty-state-icon"><i class="fa-solid fa-clock-rotate-left"></i></span>' +
          '<div class="empty-state-text">No queue activity yet today</div>' +
          '<div class="empty-state-sub">Check-ins will appear here as they happen.</div>' +
        '</div>';
      return;
    }

    wrap.innerHTML = activity.map(function (a) {
      var statusText;
      if (a.status === 'completed') {
        statusText = 'Consultation completed';
      } else if (a.queueStatus === 'in-consultation') {
        statusText = 'In consultation';
      } else if (a.queueStatus === 'called') {
        statusText = 'Called to consultation';
      } else {
        statusText = 'Checked in to queue';
      }
      return (
        '<div class="activity-row">' +
          '<span class="activity-icon">' + speciesIcon(a.species) + '</span>' +
          '<div class="activity-body">' +
            '<div class="activity-text"><strong>' + escapeHtml(a.pet) + '</strong>' +
              ' (' + escapeHtml(a.owner) + ') — ' + escapeHtml(statusText) + '</div>' +
            '<div class="activity-time">' + escapeHtml(formatRelativeTime(a.time)) + '</div>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  // ------------------------------------------------------------------
  // Orchestration
  // ------------------------------------------------------------------
  function renderDashboard() {
    if (!window.PCData || !PCData.Dashboard) return;
    renderWelcome();
    renderTodayAppointments();
    renderQueueStatus();
    renderInventoryAlerts();
    renderRecentActivity();
  }

  document.addEventListener('DOMContentLoaded', function () {
    renderDashboard();
    if (window.PCData && typeof PCData.onChange === 'function') {
      PCData.onChange(renderDashboard);
    }
  });

  // Exposed for debugging / manual re-render if ever needed elsewhere.
  window.PCDashboardUI = { renderDashboard: renderDashboard };
})();