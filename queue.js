// ============================================================
// PAWSITIVE CARE — Queue page logic
// Real-time waiting-room queue driven off today's "arrived"
// appointments. Stays in sync with the Appointments page (and
// with any other tab/window this page is open in) via PCData.
// ============================================================

(function () {
  var D = window.PCData;

  // Queue entry currently shown in the Queue Details panel.
  var state = { selectedId: null };

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function fmtWait(ts) {
    if (!ts) return '';
    var mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (mins < 1) return 'just now';
    return mins + ' min' + (mins === 1 ? '' : 's');
  }

  function fmtClock(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  // Same fallback chain appointments.js uses for a linked clinic
  // service: prefer the real Service record, then the appointment's
  // own type, then whatever's already in the reason line. Nothing
  // here is invented if none of those are present.
  function serviceLabel(a, info) {
    var svc = (typeof D.getServiceForAppointment === 'function') ? D.getServiceForAppointment(a) : null;
    if (svc && svc.name) return svc.name;
    if (a.appointmentType) return a.appointmentType;
    if (info && info.reason) return info.reason;
    return null;
  }

  // species · age · sex, pulled from the linked Patient record the
  // same way appointments.js does for the Appointment Details panel.
  // Legacy/unlinked entries just show whatever species text they
  // already have.
  function petMetaBits(info, patient) {
    var bits = [];
    if (info.species) bits.push(esc(info.species));
    if (patient && patient.age !== undefined && patient.age !== null && patient.age !== '') {
      bits.push(esc(patient.age) + (typeof patient.age === 'number' ? ' yrs' : ''));
    }
    if (patient && patient.sex) bits.push(esc(patient.sex));
    return bits;
  }

  function findInQueue(id, full) {
    for (var i = 0; i < full.length; i++) if (full[i].id === id) return full[i];
    return null;
  }

  function render() {
    var serving = D.getServingEntry();
    var waiting = D.getWaitingList();
    var full = D.getTodayQueue();

    // Drop a selection that no longer exists in today's queue (e.g.
    // the entry was completed and has since rolled off the list).
    if (state.selectedId && !findInQueue(state.selectedId, full)) {
      state.selectedId = null;
    }

    renderNowServing(serving);
    renderNextUp(waiting, serving);
    renderTable(full);
    renderDetailsPanel(full, serving, waiting);
    renderDate();
  }

  function renderDate() {
    var d = new Date();
    document.getElementById('queue-date').textContent = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }

  function selectEntry(id) {
    state.selectedId = id;
    render();
  }

  function renderNowServing(serving) {
    var box = document.getElementById('now-serving-box');

    if (!serving) {
      // No avatar in the empty state — there's no patient to show a
      // photo for; the card is otherwise unchanged.
      box.innerHTML =
        '<div class="qspot-body">' +
          '<div class="qspot-label">NOW SERVING</div>' +
          '<div class="qspot-empty">' +
            '<div class="qspot-empty-icon"><i class="fa-solid fa-hourglass-half"></i></div>' +
            '<p>The queue is empty.</p>' +
          '</div>' +
        '</div>';
      box.style.cursor = 'default';
      box.onclick = null;
      return;
    }

    // Prefer the linked Patient/Client record (via appointment.patientId /
    // clientId) over the appointment's own denormalized text; legacy
    // entries with no linked ids fall back to that text automatically.
    var info = D.getQueueDisplayInfo(serving);
    var patient = info.patientId ? D.getPatientById(info.patientId) : null;
    var statusLabel = serving.queueStatus === 'called' ? 'Called — waiting to start' : 'In Consultation';
    var metaBits = petMetaBits(info, patient);
    var service = serviceLabel(serving, info) || 'Consultation';

    // Empty pet-photo placeholder (same circle as Queue Details),
    // paired only with the queue code + patient name — the rest of
    // the existing content stack continues unchanged below it.
    box.innerHTML =
      '<div class="qspot-body">' +
        '<div class="qspot-label">NOW SERVING</div>' +
        '<div class="qspot-identity">' +
          '<div class="qspot-avatar" aria-hidden="true"></div>' +
          '<div class="qspot-identity-text">' +
            '<div class="qspot-code">' + esc(serving.queueCode) + '</div>' +
            '<div class="qspot-pet">' + esc(info.pet) + '</div>' +
          '</div>' +
        '</div>' +
        (metaBits.length ? '<div class="qspot-meta">' + metaBits.join(' &middot; ') + '</div>' : '') +
        '<div class="qspot-detail"><i class="fa-solid fa-notes-medical"></i> <span>' + esc(info.vet) + '</span></div>' +
        '<div class="qspot-service">' + esc(service) + '</div>' +
        '<div class="qspot-status-row"><span class="qspot-status">' + statusLabel + '</span></div>' +
      '</div>';

    box.style.cursor = 'pointer';
    box.onclick = function () { selectEntry(serving.id); };
  }

  function renderNextUp(waiting, serving) {
    var box = document.getElementById('next-up-box');

    if (!waiting.length) {
      box.innerHTML =
        '<div class="qspot-body">' +
          '<div class="qspot-label">NEXT UP</div>' +
          '<div class="qspot-empty">' +
            '<div class="qspot-empty-icon"><i class="fa-solid fa-hourglass-half"></i></div>' +
            '<p>No one else is waiting.</p>' +
          '</div>' +
        '</div>';
      box.style.cursor = 'default';
      box.onclick = null;
      return;
    }

    // Spotlight only the immediate next patient, with the same
    // species/age/sex/vet/service detail the Now Serving card shows —
    // the full remaining line-up still lives in the table below.
    var next = waiting[0];
    var info = D.getQueueDisplayInfo(next);
    var patient = info.patientId ? D.getPatientById(info.patientId) : null;
    var metaBits = petMetaBits(info, patient);
    var service = serviceLabel(next, info) || 'Consultation';
    var canCall = !serving;

    box.innerHTML =
      '<div class="qspot-body">' +
        '<div class="qspot-label">NEXT UP</div>' +
        '<div class="qspot-identity">' +
          '<div class="qspot-avatar" aria-hidden="true"></div>' +
          '<div class="qspot-identity-text">' +
            '<div class="qspot-code">' + esc(info.queueCode) + '</div>' +
            '<div class="qspot-pet">' + esc(info.pet) + '</div>' +
          '</div>' +
        '</div>' +
        (metaBits.length ? '<div class="qspot-meta">' + metaBits.join(' &middot; ') + '</div>' : '') +
        '<div class="qspot-detail"><i class="fa-solid fa-notes-medical"></i> <span>' + esc(info.vet) + '</span></div>' +
        '<div class="qspot-service">' + esc(service) + '</div>' +
        '<div class="qspot-status-row"><span class="qspot-status">Waiting &middot; ' + fmtWait(info.arrivedAt) + '</span></div>' +
        (canCall ? '<div class="qspot-actions"><button class="btn btn-primary" id="call-next-btn" style="width:100%;"><i class="fa-solid fa-bullhorn"></i> Call Next</button></div>' : '') +
      '</div>';

    box.style.cursor = 'pointer';
    box.onclick = function () { selectEntry(next.id); };

    var callBtn = document.getElementById('call-next-btn');
    if (callBtn) {
      callBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        D.callNext();
        render();
      });
    }
  }

  function renderTable(full) {
    var tbody = document.getElementById('queue-tbody');
    if (!full.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--ink-soft); padding:24px;">The queue is empty right now.</td></tr>';
      return;
    }
    tbody.innerHTML = full.map(function (a) {
      var info = D.getQueueDisplayInfo(a);
      // No species icon here — the patient name is the visual anchor.
      var statusText = a.queueStatus === 'in-consultation' ? 'In Consultation' : (a.queueStatus === 'called' ? 'Called' : (a.queueStatus === 'completed' ? 'Completed' : 'Waiting'));
      var badgeClass = a.queueStatus === 'in-consultation' ? 'status-confirmed' : (a.queueStatus === 'called' ? 'status-arrived' : (a.queueStatus === 'completed' ? 'status-completed' : 'status-pending'));
      var selectedClass = a.id === state.selectedId ? ' is-selected' : '';
      return '<tr class="queue-row' + selectedClass + '" data-id="' + esc(a.id) + '">' +
        '<td class="queue-code-cell">' + esc(info.queueCode) + '</td>' +
        '<td>' + esc(info.pet) + '</td>' +
        '<td>' + esc(info.owner) + '</td>' +
        '<td>' + esc(info.vet) + '</td>' +
        '<td><span class="status-badge ' + badgeClass + '">' + statusText + '</span></td>' +
        '<td>' + fmtWait(info.arrivedAt) + '</td>' +
      '</tr>';
    }).join('');

    Array.prototype.forEach.call(tbody.querySelectorAll('tr.queue-row'), function (row) {
      row.addEventListener('click', function () { selectEntry(row.getAttribute('data-id')); });
    });
  }

  // ------------------------------------------------------------------
  // Queue Details panel — same "inspector" layout/classes as the
  // Appointment Details panel on the Appointments page, populated
  // with queue-specific information instead of the appointment
  // status stepper.
  // ------------------------------------------------------------------

  function detailsRow(icon, label, value, isEmpty) {
    return '<div class="details-row"><i class="fa-solid ' + icon + '"></i>' +
      '<div><span class="details-sr-only">' + label + ': </span><div class="details-row-value' + (isEmpty ? ' is-empty' : '') + '">' + value + '</div></div></div>';
  }

  function queueInfoRow(label, value) {
    return '<div class="queue-info-row"><span>' + label + '</span><span class="qir-value">' + value + '</span></div>';
  }

  function detailsActionsHtml(a, waiting) {
    var actions = '';
    if (a.queueStatus === 'waiting' && waiting.length && waiting[0].id === a.id) {
      actions += '<button class="btn btn-primary" data-action="call-patient"><i class="fa-solid fa-bullhorn"></i> Call Patient</button>';
    }
    if (a.queueStatus === 'called') {
      actions += '<button class="btn btn-primary" data-action="start-consultation" data-id="' + esc(a.id) + '"><i class="fa-solid fa-play"></i> Start Consultation</button>';
    }
    if (a.queueStatus === 'in-consultation') {
      actions += '<button class="btn btn-primary" data-action="complete-consultation" data-id="' + esc(a.id) + '"><i class="fa-solid fa-check"></i> Complete Consultation</button>';
      var info = D.getQueueDisplayInfo(a);
      if (info.patientId) {
        actions += '<a class="btn" data-action="medrec" href="medical-records.html?patient=' + encodeURIComponent(info.patientId) + '"><i class="fa-solid fa-notes-medical"></i> Open Medical Record</a>';
      }
    }
    return actions;
  }

  function renderDetailsPanel(full, serving, waiting) {
    var pane = document.getElementById('details-panel');
    if (!pane) return;

    var a = state.selectedId ? findInQueue(state.selectedId, full) : null;
    if (!a) {
      pane.innerHTML = '<div class="details-empty"><i class="fa-solid fa-hourglass-half"></i>Select a queue entry to view details.</div>';
      return;
    }

    var info = D.getQueueDisplayInfo(a);
    var patient = info.patientId ? D.getPatientById(info.patientId) : null;
    var metaBits = petMetaBits(info, patient);

    var statusText = a.queueStatus === 'in-consultation' ? 'In Consultation' : (a.queueStatus === 'called' ? 'Called' : (a.queueStatus === 'completed' ? 'Completed' : 'Waiting'));
    var badgeClass = a.queueStatus === 'in-consultation' ? 'status-confirmed' : (a.queueStatus === 'called' ? 'status-arrived' : (a.queueStatus === 'completed' ? 'status-completed' : 'status-pending'));

    // Appointment — only the fields relevant while in the queue, no
    // full status stepper.
    var service = serviceLabel(a, info);
    var rows = detailsRow('fa-clock', 'Time', a.time ? esc(D.formatTimeLabel(a.time)) : 'Not specified', !a.time);
    rows += detailsRow('fa-notes-medical', 'Veterinarian', info.vet ? esc(info.vet) : 'Unassigned', !info.vet);
    rows += detailsRow('fa-briefcase-medical', 'Service', service ? esc(service) : 'Not specified', !service);
    rows += detailsRow('fa-file-lines', 'Reason for Visit', a.reason ? esc(a.reason) : 'Not specified', !a.reason);

    // Queue Information
    var position = '&mdash;';
    if (a.queueStatus === 'waiting') {
      var idx = -1;
      for (var i = 0; i < waiting.length; i++) if (waiting[i].id === a.id) { idx = i; break; }
      if (idx > -1) position = ordinal(idx + 1);
    } else if (a.queueStatus === 'called' || a.queueStatus === 'in-consultation') {
      position = 'Now serving';
    }

    var queueInfoHtml =
      queueInfoRow('Queue Code', esc(info.queueCode)) +
      queueInfoRow('Position', position) +
      queueInfoRow('Arrived', info.arrivedAt ? esc(fmtClock(info.arrivedAt)) : 'Not recorded') +
      queueInfoRow('Waiting Time', info.arrivedAt ? esc(fmtWait(info.arrivedAt)) : 'Not recorded') +
      queueInfoRow('Status', '<span class="status-badge ' + badgeClass + '">' + statusText + '</span>');

    var notesHtml = a.notes
      ? '<div class="details-notes">' + esc(a.notes) + '</div>'
      : '<div class="details-notes-empty"><i class="fa-solid fa-note-sticky"></i><span>No notes added yet.</span></div>';

    var actionsHtml = detailsActionsHtml(a, waiting);

    pane.innerHTML =
      '<div class="details-header">' +
        '<div class="details-avatar"></div>' +
        '<div style="min-width:0; flex:1;">' +
          '<div class="details-title-row"><span class="details-pet-name">' + esc(info.pet) + '</span>' +
            '<span class="status-badge ' + badgeClass + '">' + statusText + '</span></div>' +
          (metaBits.length ? '<div class="details-pet-sub">' + metaBits.join(' \u00b7 ') + '</div>' : '') +
          (info.owner ? '<div class="details-pet-owner"><i class="fa-solid fa-user"></i>Owner: <strong>' + esc(info.owner) + '</strong></div>' : '') +
        '</div>' +
        '<button class="modal-close" id="queue-details-close-btn" aria-label="Close queue details"><i class="fa-solid fa-xmark"></i></button>' +
      '</div>' +
      '<div class="details-section"><div class="details-section-title"><i class="fa-solid fa-calendar-days"></i>Appointment</div>' +
        '<div class="details-rows">' + rows + '</div></div>' +
      '<div class="details-section"><div class="details-section-title"><i class="fa-solid fa-hourglass-half"></i>Queue Information</div>' +
        '<div class="queue-info-rows">' + queueInfoHtml + '</div></div>' +
      '<div class="details-section"><div class="details-section-title"><i class="fa-solid fa-file-lines"></i>Notes</div>' + notesHtml + '</div>' +
      (actionsHtml ? '<div class="details-section"><div class="details-section-title">Quick Actions</div><div class="details-actions">' + actionsHtml + '</div></div>' : '');

    // Close button: reuses the same deselect pattern row/card
    // selection already uses (clear state.selectedId, re-render) —
    // the identical pattern appointments.js's Appointment Details
    // close button uses. Only clears the local selection; never
    // touches queue status, appointment data, or navigates away.
    var closeBtn = pane.querySelector('#queue-details-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        state.selectedId = null;
        render();
      });
    }

    var callBtn = pane.querySelector('[data-action="call-patient"]');
    if (callBtn) callBtn.addEventListener('click', function () { D.callNext(); render(); });

    var startBtn = pane.querySelector('[data-action="start-consultation"]');
    if (startBtn) startBtn.addEventListener('click', function () { D.startConsultation(a.id); render(); });

    var completeBtn = pane.querySelector('[data-action="complete-consultation"]');
    if (completeBtn) completeBtn.addEventListener('click', function () { D.completeConsultation(a.id); render(); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    D.onChange(render);
    render();
    // Keep "waiting X mins" labels fresh even with no data changes.
    setInterval(render, 30000);
  });
})();