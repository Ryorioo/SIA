// ============================================================
// PAWSITIVE CARE — Client (Pet Owner) Vaccinations
//
// READ-ONLY. This page never calls addVaccination/updateVaccination
// (or anything else that writes to pcv1_vaccinations) — it only reads,
// via the EXISTING D.getVaccinationsForPatientId(patientId) and
// D.computeVaccinationStatus(nextDue), the same functions the
// Administrator Patients page (patients.js) itself uses for a
// patient's Vaccinations section. The schema shown below
// (vaccineName, dateGiven, nextDue, notes) is copied straight from
// patient-data-store.js's mkVaccination() — no field is invented.
// Status is never computed here independently — it's always
// D.computeVaccinationStatus(nextDue), the exact same derivation the
// Administrator side uses, so a status can never drift out of sync
// between the two sides.
//
// Every record shown here is scoped to the pet(s) belonging to
// whichever Client PCClientAuth.requireClientLogin() resolves (via
// D.getPatientsForClient(client), the same function
// client-dashboard.js / client-pets.js / client-medical-records.js
// already use). No client/pet/vaccination is ever looked up by name
// or hardcoded.
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

  // Same date formatting patients.js (Administrator) uses for
  // vaccination dates, so dates read identically on both sides.
  function formatVaxDate(D, iso) {
    if (!iso) return '\u2014';
    var d = D.parseDate(iso);
    if (isNaN(d.getTime())) return '\u2014';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // Exact same status -> badge-class mapping as patients.js's
  // vaccinationStatusBadgeClass(), reused verbatim so a status never
  // renders in a different color here than it does for the Administrator.
  function vaccinationStatusBadgeClass(status) {
    return status === 'Up to date' ? 'status-confirmed'
      : status === 'Overdue' ? 'status-cancelled'
      : status === 'Due soon' ? 'status-pending'
      : 'status-completed';
  }

  function renderSidebarFooter(client) {
    document.getElementById('footer-avatar').textContent = initials(client.name);
    document.getElementById('footer-name').textContent = client.name;
  }

  var state = {
    selectedPatientId: null // null = "All Pets"
  };

  // ------------------------------------------------------------------
  // pet filter (requirement 4 — only shown when the client has more
  // than one pet; with a single pet there's nothing to filter between)
  // ------------------------------------------------------------------

  function renderPetFilter(D, patients) {
    var row = document.getElementById('pet-filter-row');
    if (patients.length < 2) {
      row.innerHTML = '';
      return;
    }

    var pills = [{ id: null, label: 'All Pets', icon: '<i class="fa-solid fa-paw"></i>' }].concat(
      patients.map(function (p) {
        return { id: p.id, label: p.pet, icon: D.SPECIES_ICON[p.species] || '<i class="fa-solid fa-paw"></i>' };
      })
    );

    row.innerHTML = '<div class="pet-filter-row">' +
      pills.map(function (p) {
        var active = (state.selectedPatientId === p.id);
        return '<button type="button" class="pet-filter-pill' + (active ? ' active' : '') + '" data-id="' + (p.id ? esc(p.id) : '') + '">' +
          p.icon + ' ' + esc(p.label) +
        '</button>';
      }).join('') +
    '</div>';

    row.querySelectorAll('.pet-filter-pill').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.selectedPatientId = btn.getAttribute('data-id') || null;
        renderPetFilter(D, patients);
        renderVaccinationsList(D, patients);
      });
    });
  }

  // ------------------------------------------------------------------
  // vaccination list — grouped by pet (matches patients.js's own
  // per-patient Vaccinations section: individual records via
  // getVaccinationsForPatientId, each with its live-computed status,
  // plus the legacy general Patient.vaccinationStatus shown as extra
  // context exactly the way the Administrator profile does).
  // ------------------------------------------------------------------

  function renderPetVaccinations(D, patient) {
    var icon = D.SPECIES_ICON[patient.species] || '<i class="fa-solid fa-paw"></i>';
    var records = D.getVaccinationsForPatientId(patient.id);

    var body;
    if (records.length) {
      body = records.map(function (v) {
        var status = D.computeVaccinationStatus(v.nextDue);
        return (
          '<div class="history-row">' +
            '<div class="history-main">' +
              '<span class="h-reason">' + esc(v.vaccineName || 'Vaccine') + '</span>' +
              '<span class="h-meta">Date given: ' + formatVaxDate(D, v.dateGiven) + ' \u00b7 Next due: ' + formatVaxDate(D, v.nextDue) +
                (v.notes ? ' \u00b7 ' + esc(v.notes) : '') + '</span>' +
            '</div>' +
            '<span class="status-badge ' + vaccinationStatusBadgeClass(status) + '">' + esc(status) + '</span>' +
          '</div>'
        );
      }).join('');
    } else {
      body = '<div class="no-results">No vaccination records available.</div>';
    }

    // Older patients may only have the general status field from before
    // per-record tracking existed — shown as extra context alongside the
    // real records, same as the Administrator Patient Profile does.
    var generalStatus = patient.vaccinationStatus && patient.vaccinationStatus !== 'Unknown'
      ? '<div class="vx-general-status">General status on file: ' +
          '<span class="status-badge ' + vaccinationStatusBadgeClass(patient.vaccinationStatus) + '" style="margin-left:4px;">' + esc(patient.vaccinationStatus) + '</span></div>'
      : '';

    return (
      '<div class="vx-pet-group">' +
        '<div class="vx-pet-group-head">' +
          '<div class="vx-pet-avatar">' + icon + '</div>' +
          '<div class="vx-pet-name">' + esc(patient.pet) + '</div>' +
        '</div>' +
        body +
        generalStatus +
      '</div>'
    );
  }

  function renderVaccinationsList(D, patients) {
    var box = document.getElementById('vaccinations-list');
    var countBox = document.getElementById('vx-count');

    if (!patients.length) {
      countBox.textContent = '';
      box.innerHTML = '<div class="empty-note">No pets registered yet. Visit the clinic front desk to register your pet.</div>';
      return;
    }

    var scoped = state.selectedPatientId
      ? patients.filter(function (p) { return p.id === state.selectedPatientId; })
      : patients;

    var totalRecords = 0;
    scoped.forEach(function (p) { totalRecords += D.getVaccinationsForPatientId(p.id).length; });
    countBox.textContent = totalRecords + ' vaccination record' + (totalRecords === 1 ? '' : 's') +
      (scoped.length > 1 ? ' across ' + scoped.length + ' pets' : '');

    if (!totalRecords && scoped.every(function (p) { return !p.vaccinationStatus || p.vaccinationStatus === 'Unknown'; })) {
      box.innerHTML = '<div class="no-results">No vaccination records available.</div>';
      return;
    }

    box.innerHTML = scoped.map(function (p) { return renderPetVaccinations(D, p); }).join('');
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
      var patients = D.getPatientsForClient(client);
      // If a previously-selected pet no longer belongs to this client
      // (or the list changed), fall back to "All Pets" rather than
      // silently showing a stale/empty filter.
      if (state.selectedPatientId && !patients.some(function (p) { return p.id === state.selectedPatientId; })) {
        state.selectedPatientId = null;
      }
      renderPetFilter(D, patients);
      renderVaccinationsList(D, patients);
    }

    renderSidebarFooter(client);
    renderDynamic();

    document.getElementById('logout-btn').addEventListener('click', function (e) {
      e.preventDefault();
      window.PCClientAuth.logoutClient();
    });

    // Keep the list live if the Administrator/Veterinarian adds or
    // updates a vaccination (or a pet's registration changes) in
    // another tab — same D.onChange() mechanism every other Client
    // page uses. Also keeps "Due soon"/"Overdue" statuses accurate as
    // today's date rolls forward without a manual refresh.
    D.onChange(renderDynamic);
    setInterval(renderDynamic, 60000);
  });
})();