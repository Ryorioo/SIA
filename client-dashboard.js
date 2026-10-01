// ============================================================
// PAWSITIVE CARE — Client (Pet Owner) Dashboard
// Every section below is derived from the single Client record
// returned by PCClientAuth.requireClientLogin(). No client, pet,
// or appointment is ever looked up by name or hardcoded — swap
// which account logs in and every section follows automatically.
// ============================================================

(function () {
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

  // ------------------------------------------------------------------
  // sections
  // ------------------------------------------------------------------

  function renderSidebarFooter(client) {
    document.getElementById('footer-avatar').textContent = initials(client.name);
    document.getElementById('footer-name').textContent = client.name;
  }

  function renderWelcome(client) {
    var firstName = (client.name || '').trim().split(/\s+/)[0] || client.name;
    document.getElementById('dash-welcome').innerHTML =
      '<div class="welcome-title">Welcome back, ' + esc(firstName) + '!</div>' +
      '<div class="welcome-sub">Here\u2019s what\u2019s happening with your pets today.</div>';
  }

  function renderPets(D, client) {
    var pets = D.getPatientsForClient(client);
    var box = document.getElementById('pets-list');
    if (!pets.length) {
      box.innerHTML = '<div class="empty-note">No pets registered yet. Visit the clinic front desk to register your pet.</div>';
      return;
    }
    box.innerHTML = pets.map(function (p) {
      var icon = D.SPECIES_ICON[p.species] || '<i class="fa-solid fa-paw"></i>';
      return (
        '<div class="pet-row">' +
          '<div class="pet-row-main"><div class="pet-row-avatar">' + icon + '</div>' +
            '<div><div class="pet-row-name">' + esc(p.pet) + '</div>' +
            '<div class="pet-row-meta">' + esc(p.species) + (p.breed ? ' \u00b7 ' + esc(p.breed) : '') + '</div></div></div>' +
          '<span class="status-badge status-' + p.status + '">' + (p.status === 'active' ? 'Active' : 'Inactive') + '</span>' +
        '</div>'
      );
    }).join('');
  }

  // Next appointment that hasn't happened/checked in yet (pending or
  // confirmed, today or later). Already-arrived appointments surface
  // in the Queue Status card instead, not here.
  function renderUpcomingAppointment(D, client) {
    var today = D.todayStr();
    var all = D.getAppointmentsForClient(client);
    var upcoming = all
      .filter(function (a) { return (a.status === 'pending' || a.status === 'confirmed') && a.date >= today; })
      .sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); });

    var box = document.getElementById('appt-box');
    if (!upcoming.length) {
      box.innerHTML = '<div class="empty-note">No upcoming appointments scheduled.</div>';
      return;
    }

    var a = upcoming[0];
    box.innerHTML =
      '<div class="appt-highlight">' +
        '<div class="appt-date">' + D.formatDateLabel(a.date) + ' \u00b7 ' + D.formatTimeLabel(a.time) + '</div>' +
        '<div class="appt-pet">' + esc(a.pet) + ' \u2014 ' + esc(a.reason || 'General visit') + '</div>' +
        '<div class="appt-meta">' + esc(a.vet) + '</div>' +
        '<span class="status-badge status-' + a.status + '">' + D.STATUS_LABELS[a.status] + '</span>' +
      '</div>';
  }

  // Today's queue entry for this client, if any of their pets have
  // checked in. Reuses getQueueDisplayInfo so the label/format matches
  // the Administrator Queue view exactly.
  function renderQueueStatus(D, client) {
    var today = D.todayStr();
    var all = D.getAppointmentsForClient(client);
    var inQueue = all.find(function (a) { return a.status === 'arrived' && a.date === today; });

    var box = document.getElementById('queue-box');
    if (!inQueue) {
      box.innerHTML = '<div class="empty-note">You\u2019re not currently in the queue.</div>';
      return;
    }

    var info = D.getQueueDisplayInfo(inQueue);
    var label =
      info.queueStatus === 'waiting' ? 'Waiting' :
      info.queueStatus === 'called' ? 'Called \u2014 please proceed to the consultation room' :
      info.queueStatus === 'in-consultation' ? 'In consultation' : '\u2014';

    box.innerHTML =
      '<div class="queue-highlight">' +
        '<div class="queue-code">' + esc(info.queueCode || '\u2014') + '</div>' +
        '<div class="queue-pet">' + esc(info.pet) + '</div>' +
        '<div class="queue-status-label">' + label + '</div>' +
      '</div>';
  }

  // No notifications data store exists yet anywhere in PCData. Guarded
  // the same way this codebase already guards other not-yet-built
  // modules (see getPatientsForClient's own check for D.getPatients
  // before patient-data-store.js is loaded) — shows an honest empty
  // state instead of fabricated data, and will "just work" once a
  // notifications store is added later.
  function renderNotifications(D, client) {
    var box = document.getElementById('notifs-list');
    if (!D.getNotificationsForClient) {
      box.innerHTML = '<div class="empty-note">Notifications aren\u2019t available yet.</div>';
      return;
    }
    var notifs = D.getNotificationsForClient(client) || [];
    if (!notifs.length) {
      box.innerHTML = '<div class="empty-note">No notifications yet.</div>';
      return;
    }
    box.innerHTML = notifs.slice(0, 5).map(function (n) {
      return '<div class="notif-row">' + esc(n.message || '') + '</div>';
    }).join('');
  }

  function renderQuickActions() {
    document.getElementById('quick-actions').innerHTML =
      '<a class="quick-action" href="client-appointments.html"><i class="fa-solid fa-calendar-plus"></i><span>Book Appointment</span></a>' +
      '<a class="quick-action" href="client-pets.html"><i class="fa-solid fa-paw"></i><span>My Pets</span></a>' +
      '<a class="quick-action" href="client-medical-records.html"><i class="fa-solid fa-notes-medical"></i><span>Medical Records</span></a>' +
      '<a class="quick-action" href="client-billing.html"><i class="fa-solid fa-credit-card"></i><span>Billing</span></a>';
  }

  // ------------------------------------------------------------------
  // wiring
  // ------------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    var D = window.PCData;

    // AUTHENTICATION TEMPORARILY DISABLED
    // This frontend prototype does not have a backend yet.
    // Administrator/Client authentication will be implemented later
    // after the PHP + MySQL backend is completed.
    //
    // Original guarded logic (restore once the backend exists):
    //
    // var client = window.PCClientAuth.requireClientLogin();
    // if (!client) return;
    //
    // Until then, every rendering function below still expects a real
    // client record (see file header), so we resolve one directly from
    // PCData using its existing getClientById() lookup instead of
    // inventing a fake client object. This is a temporary stand-in for
    // "whoever is logged in" and must be replaced with the real
    // authenticated client once login is implemented.
    var DEV_CLIENT_ID = 'cl_mto10o7c_jczmqx'; // Kyle · kyle@gmail.com
    var client = D.getClientById(DEV_CLIENT_ID);
    if (!client) return;

    function renderDynamic() {
      renderPets(D, client);
      renderUpcomingAppointment(D, client);
      renderQueueStatus(D, client);
      renderNotifications(D, client);
    }

    renderSidebarFooter(client);
    renderWelcome(client);
    renderQuickActions();
    renderDynamic();

    document.getElementById('logout-btn').addEventListener('click', function (e) {
      e.preventDefault();
      window.PCClientAuth.logoutClient();
    });

    // Keep the dashboard live if data changes elsewhere (e.g. front
    // desk marks this client's pet arrived in another tab).
    D.onChange(renderDynamic);
  });
})();