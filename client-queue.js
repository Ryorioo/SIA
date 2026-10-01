// ============================================================
// PAWSITIVE CARE — Client (Pet Owner) Queue
//
// READ-ONLY. This page does not create a queue, generate queue
// codes, or write to any queue field. Every value shown here comes
// straight from the EXISTING Administrator Queue data/functions in
// data-store.js — the same getTodayQueue() / getWaitingList() /
// getServingEntry() / getQueueDisplayInfo() that queue.js (the
// Administrator Queue page) itself uses — filtered down to the
// pet(s) belonging to whichever Client PCClientAuth.requireClientLogin()
// resolves. No client/pet/appointment is ever looked up by name or
// hardcoded; swap which account logs in and this page follows
// automatically, exactly like client-dashboard.js / client-pets.js.
//
// Never called from this file: markArrived, callNext,
// startConsultation, completeConsultation, removeFromQueue, or any
// other PCData write function — a logged-in Pet Owner can only ever
// read their own place in line here.
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

  // Same "minutes since" formatting queue.js (Administrator Queue) uses,
  // so a client's own "waiting X mins" always matches what the front
  // desk sees for that same entry.
  function fmtWait(ts) {
    if (!ts) return '';
    var mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (mins < 1) return 'less than a minute';
    return mins + ' minute' + (mins === 1 ? '' : 's');
  }

  function renderSidebarFooter(client) {
    document.getElementById('footer-avatar').textContent = initials(client.name);
    document.getElementById('footer-name').textContent = client.name;
  }

  function renderDate() {
    var d = new Date();
    document.getElementById('queue-date').textContent =
      d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }

  // ------------------------------------------------------------------
  // resolve which of TODAY'S queue entries belong to this client
  // ------------------------------------------------------------------

  // Reuses D.getAppointmentsForClient(client) — the same function
  // client-dashboard.js and client-appointments.js already use, which
  // itself resolves this client's own pets via D.getPatientsForClient()
  // (matching by clientId, falling back to owner-name for legacy
  // records with no clientId — the same fallback already relied on
  // everywhere else in this app). Filtering that down to "arrived +
  // today" gives exactly this client's own live queue entries, in the
  // same arrival order as D.getTodayQueue().
  function getClientQueueEntries(D, client) {
    var today = D.todayStr();
    return D.getAppointmentsForClient(client)
      .filter(function (a) { return a.status === 'arrived' && a.date === today; })
      .sort(function (a, b) { return (a.arrivedAt || 0) - (b.arrivedAt || 0); });
  }

  // Number of patients ahead of this specific entry: 0 once it's been
  // called or started, otherwise its position within the shared
  // waiting list (same list/order D.callNext() itself calls next from).
  function computeAhead(D, appt) {
    if (appt.queueStatus === 'called' || appt.queueStatus === 'in-consultation') return 0;
    var waiting = D.getWaitingList();
    var idx = waiting.findIndex(function (a) { return a.id === appt.id; });
    return idx === -1 ? 0 : idx;
  }

  // ------------------------------------------------------------------
  // rendering
  // ------------------------------------------------------------------

  // Context strip only — the shared queue's current serving CODE, no
  // other client's pet/owner name, so a Pet Owner's own portal never
  // surfaces another family's identifying details.
  function renderNowServingMini(D) {
    var box = document.getElementById('now-serving-mini');
    var serving = D.getServingEntry();
    if (!serving) {
      box.innerHTML =
        '<div class="now-serving-mini">' +
          '<span class="now-serving-mini-label">Now Serving</span>' +
          '<span class="now-serving-mini-empty">No one is being served right now.</span>' +
        '</div>';
      return;
    }
    box.innerHTML =
      '<div class="now-serving-mini">' +
        '<span class="now-serving-mini-label">Now Serving</span>' +
        '<span class="now-serving-mini-code">' + esc(serving.queueCode) + '</span>' +
      '</div>';
  }

  function renderEmptyState() {
    document.getElementById('queue-content').innerHTML =
      '<div class="queue-empty-state">' +
        '<div class="queue-empty-icon"><i class="fa-solid fa-hourglass-half"></i></div>' +
        '<div class="queue-empty-title">You\u2019re not currently in the queue.</div>' +
        '<div class="queue-empty-sub">Once the clinic checks in one of your pets for today\u2019s visit, it will appear here automatically.</div>' +
      '</div>';
  }

  function renderQueueCard(D, appt) {
    var info = D.getQueueDisplayInfo(appt);
    var icon = D.SPECIES_ICON[info.species] || '<i class="fa-solid fa-paw"></i>';

    var statusLabel =
      info.queueStatus === 'waiting' ? 'Waiting' :
      info.queueStatus === 'called' ? 'Called' :
      info.queueStatus === 'in-consultation' ? 'In Consultation' : '\u2014';

    var badgeClass =
      info.queueStatus === 'in-consultation' ? 'status-confirmed' :
      info.queueStatus === 'called' ? 'status-arrived' : 'status-pending';

    var body = '';
    if (info.queueStatus === 'called') {
      body =
        '<div class="turn-banner">' +
          '<div class="turn-banner-title">It\u2019s your turn!</div>' +
          '<div class="turn-banner-sub">Please proceed to the consultation area.</div>' +
        '</div>';
    } else if (info.queueStatus === 'in-consultation') {
      body =
        '<div class="turn-banner">' +
          '<div class="turn-banner-title">Consultation in progress</div>' +
          '<div class="turn-banner-sub">' + esc(info.vet) + ' is currently seeing ' + esc(info.pet) + '.</div>' +
        '</div>';
    } else {
      var ahead = computeAhead(D, appt);
      body =
        '<div class="yq-waiting-line">' +
          (ahead === 0 ? 'You\u2019re next in line.' : ahead + ' patient' + (ahead === 1 ? '' : 's') + ' ahead of you.') +
        '</div>' +
        '<div class="yq-waiting-sub">Waiting for ' + fmtWait(info.arrivedAt) + '.</div>';
    }

    return (
      '<div class="your-queue-card' + (info.queueStatus === 'called' ? ' is-called' : '') + '">' +
        '<div class="yq-code">' + esc(info.queueCode || '\u2014') + '</div>' +
        '<div class="yq-pet">' + icon + ' ' + esc(info.pet) + '</div>' +
        '<div class="yq-meta"><i class="fa-solid fa-notes-medical"></i> ' + esc(info.vet) + '</div>' +
        '<div class="yq-status-row"><span class="status-badge ' + badgeClass + '">' + statusLabel + '</span></div>' +
        body +
      '</div>'
    );
  }

  function renderQueueContent(D, entries) {
    if (!entries.length) {
      renderEmptyState();
      return;
    }
    document.getElementById('queue-content').innerHTML =
      '<div class="your-queue-heading"><i class="fa-solid fa-hourglass-half"></i> YOUR QUEUE</div>' +
      '<div class="queue-cards-grid">' +
        entries.map(function (a) { return renderQueueCard(D, a); }).join('') +
      '</div>';
  }

  // ------------------------------------------------------------------
  // wiring
  // ------------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    // Bounces to client-login.html automatically if there's no valid
    // session — everything below only runs for an authenticated Client.
    var client = window.PCClientAuth.requireClientLogin();
    if (!client) return;

    var D = window.PCData;

    function renderDynamic() {
      renderNowServingMini(D);
      renderQueueContent(D, getClientQueueEntries(D, client));
    }

    renderSidebarFooter(client);
    renderDate();
    renderDynamic();

    document.getElementById('logout-btn').addEventListener('click', function (e) {
      e.preventDefault();
      window.PCClientAuth.logoutClient();
    });

    // Live updates — D.onChange() already fires on the 'pcv1:change'
    // event (same-tab writes), the native 'storage' event (other
    // tabs/windows — e.g. the Administrator marking a patient arrived
    // or calling next), and a 1.5s safety-net poll, so this page picks
    // up Administrator-side queue changes exactly like queue.html does.
    D.onChange(renderDynamic);
    // Keep "waiting X minutes" fresh even with no underlying data change.
    setInterval(renderDynamic, 30000);
  });
})();