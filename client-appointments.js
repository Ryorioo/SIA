// ============================================================
// PAWSITIVE CARE — Client (Pet Owner) Appointments
// Every appointment shown/booked here is resolved from the single
// Client record returned by PCClientAuth.requireClientLogin() — no
// client, pet, or appointment is ever looked up by name or
// hardcoded. Booking reuses the EXISTING appointment schema/fields
// (data-store.js's mk()) and the EXISTING PCData.addAppointment(),
// the same function the Administrator Appointments page itself
// calls — no separate client appointment store is created.
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

  function showToast(msg) {
    var toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toast.classList.remove('show'); }, 2200);
  }

  // ------------------------------------------------------------------
  // sidebar footer (same as client-dashboard.js / client-pets.js)
  // ------------------------------------------------------------------

  function renderSidebarFooter(client) {
    document.getElementById('footer-avatar').textContent = initials(client.name);
    document.getElementById('footer-name').textContent = client.name;
  }

  // ------------------------------------------------------------------
  // appointment row (shared by Upcoming + History)
  // ------------------------------------------------------------------

  function appointmentRow(D, a) {
    var icon = D.SPECIES_ICON[a.species] || '<i class="fa-solid fa-paw"></i>';
    var service = (typeof D.getServiceForAppointment === 'function') ? D.getServiceForAppointment(a) : null;
    return (
      '<div class="appt-row">' +
      '<div class="appt-row-when">' +
      '<div class="appt-row-date">' + D.formatDateLabel(a.date) + '</div>' +
      '<div class="appt-row-time">' + D.formatTimeLabel(a.time) + '</div>' +
      '</div>' +
      '<div class="appt-row-main">' +
      '<div class="appt-row-pet"><span class="species-icon">' + icon + '</span>' + esc(a.pet) +
      (a.queueCode ? ' <span class="status-badge status-arrived">' + esc(a.queueCode) + '</span>' : '') +
      '</div>' +
      '<div class="appt-row-meta">' +
      '<span><i class="fa-solid fa-notes-medical"></i> ' + esc(a.vet) + '</span>' +
      '<span><i class="fa-solid fa-file-lines"></i> ' + esc(a.reason || 'General visit') + '</span>' +
      (service ? '<span><i class="fa-solid fa-briefcase-medical"></i> ' + esc(service.name) + '</span>' : '') +
      '</div>' +
      '</div>' +
      '<span class="status-badge status-' + a.status + '">' + esc(D.STATUS_LABELS[a.status] || a.status) + '</span>' +
      '</div>'
    );
  }

  // Upcoming: still active (pending/confirmed/arrived) and today or
  // later. Past/History: completed, cancelled, or before today —
  // regardless of status, once the date has passed it's history.
  function splitAppointments(D, all) {
    var today = D.todayStr();
    var upcoming = [];
    var history = [];
    all.forEach(function (a) {
      var active = (a.status === 'pending' || a.status === 'confirmed' || a.status === 'arrived');
      if (active && a.date >= today) {
        upcoming.push(a);
      } else {
        history.push(a);
      }
    });
    upcoming.sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); });
    history.sort(function (a, b) { return (b.date + b.time).localeCompare(a.date + a.time); });
    return { upcoming: upcoming, history: history };
  }

  function renderLists(D, client) {
    var all = D.getAppointmentsForClient(client);
    var split = splitAppointments(D, all);

    var upcomingBox = document.getElementById('upcoming-list');
    upcomingBox.innerHTML = split.upcoming.length
      ? split.upcoming.map(function (a) { return appointmentRow(D, a); }).join('')
      : '<div class="empty-note">No upcoming appointments. Use "Book Appointment" to request one.</div>';

    var historyBox = document.getElementById('history-list');
    historyBox.innerHTML = split.history.length
      ? split.history.map(function (a) { return appointmentRow(D, a); }).join('')
      : '<div class="empty-note">No past appointments yet.</div>';
  }

  // ------------------------------------------------------------------
  // Book Appointment modal
  // ------------------------------------------------------------------

  // Only this client's own pets — never another client's patient
  // record — resolved fresh each time the modal opens via the same
  // PCData.getPatientsForClient(client) already used on the Dashboard
  // and My Pets pages.
  function populatePatientOptions(D, client) {
    var sel = document.getElementById('b-patient');
    var pets = D.getPatientsForClient(client);
    if (!pets.length) {
      sel.innerHTML = '<option value="">No pets registered yet</option>';
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    sel.innerHTML = '<option value="">Select a pet…</option>' + pets.map(function (p) {
      return '<option value="' + esc(p.id) + '">' + esc(p.pet) + ' (' + esc(p.species) + ')</option>';
    }).join('');
  }

  // Only Active services — matches Requirement 11 (no inactive
  // services bookable) and reuses the exact same
  // PCData.getActiveServices() the Administrator Appointments modal
  // already uses for its own (optional) service picker.
  function populateServiceOptions(D) {
    var sel = document.getElementById('b-service');
    if (typeof D.getActiveServices !== 'function') {
      sel.innerHTML = '<option value="">No services available</option>';
      sel.disabled = true;
      return;
    }
    var services = D.getActiveServices().slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    if (!services.length) {
      sel.innerHTML = '<option value="">No services available</option>';
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    sel.innerHTML = '<option value="">Select a service…</option>' + services.map(function (s) {
      return '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>';
    }).join('');
  }

  function openBookModal(D, client) {
    populatePatientOptions(D, client);
    populateServiceOptions(D);
    document.getElementById('b-date').value = '';
    document.getElementById('b-date').min = D.todayStr();
    document.getElementById('b-time').value = '';
    document.getElementById('b-reason').value = '';
    document.getElementById('b-notes').value = '';
    document.getElementById('book-overlay').classList.add('open');
  }

  function closeBookModal() {
    document.getElementById('book-overlay').classList.remove('open');
  }

  // Saves using the EXISTING appointment schema/defaults (data-store.js
  // mk()) via the EXISTING PCData.addAppointment() — the same function
  // the Administrator page itself calls. `vet` is intentionally left
  // unset here so mk()'s own default (D.VETS[0]) applies, since the
  // client isn't asked to choose a vet; the front desk can reassign one
  // when they review the pending request. Status is always 'pending'
  // (Requirement 9), so Administrator/Receptionist review/confirm it.
  function saveBooking(D, client) {
    var patientSel = document.getElementById('b-patient');
    var serviceSel = document.getElementById('b-service');
    var patientId = patientSel.value;
    var serviceId = serviceSel.value;
    var date = document.getElementById('b-date').value;
    var time = document.getElementById('b-time').value;
    var reason = document.getElementById('b-reason').value.trim();
    var notes = document.getElementById('b-notes').value.trim();

    if (!patientId) {
      showToast('Please select one of your pets');
      return;
    }
    // Defense-in-depth: re-verify (against fresh data, not just the
    // rendered <option> list) that this pet actually belongs to the
    // logged-in client before ever writing an appointment — mirrors
    // the same never-trust-the-DOM-alone care client-session.js takes
    // when resolving the session back to a live Client record.
    var patient = D.getPatientsForClient(client).find(function (p) { return p.id === patientId; });
    if (!patient) {
      showToast('That pet could not be verified for this account');
      return;
    }

    if (!serviceId) {
      showToast('Please select a service');
      return;
    }
    var activeServices = (typeof D.getActiveServices === 'function') ? D.getActiveServices() : [];
    var service = activeServices.find(function (s) { return s.id === serviceId; });
    if (!service) {
      showToast('That service is no longer available');
      return;
    }

    if (!date || !time) {
      showToast('Please select a preferred date and time');
      return;
    }
    if (!reason) {
      showToast('Please enter a reason for the visit');
      return;
    }

    D.addAppointment({
      pet: patient.pet,
      species: patient.species,
      owner: client.name,
      phone: client.phone,
      clientId: client.id,
      patientId: patient.id,
      serviceId: service.id,
      date: date,
      time: time,
      reason: reason,
      notes: notes,
      status: 'pending'
    });

    showToast('Appointment requested \u2014 pending clinic confirmation');
    closeBookModal();
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

    function renderDynamic() {
      renderLists(D, client);
    }

    renderSidebarFooter(client);
    renderDynamic();

    document.getElementById('book-appt-btn').addEventListener('click', function () {
      openBookModal(D, client);
    });
    document.getElementById('book-close').addEventListener('click', closeBookModal);
    document.getElementById('book-cancel').addEventListener('click', closeBookModal);
    document.getElementById('book-save').addEventListener('click', function () {
      saveBooking(D, client);
    });
    document.getElementById('book-overlay').addEventListener('click', function (e) {
      if (e.target === document.getElementById('book-overlay')) closeBookModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeBookModal();
    });

    document.getElementById('logout-btn').addEventListener('click', function (e) {
      e.preventDefault();
      window.PCClientAuth.logoutClient();
    });

    // Keep the lists live if data changes elsewhere — e.g. front desk
    // confirms/cancels/marks arrived on the Administrator Appointments
    // page in another tab, exactly like the Dashboard/My Pets pages
    // already do via D.onChange().
    D.onChange(renderDynamic);
  });
})();