// ============================================================
// PAWSITIVE CARE — Client (Pet Owner) Medical Records
//
// READ-ONLY. This page never calls addMedicalRecord/updateMedicalRecord
// (or anything else that writes to pcv1_medrecords) — it only reads,
// via the EXISTING D.getMedicalRecordsForPatientId(patientId), the
// same function the Administrator Medical Records page itself uses.
// The schema shown below (pet, date, vet, visitType, chiefComplaint,
// symptoms, examFindings, diagnosis, treatment, prescription,
// vaccination, weight, followUpDate, vetNotes, status) is copied
// straight from medical-records-data-store.js's mkMedRecord() — no
// field is invented or guessed.
//
// Every record shown here is scoped to the pet(s) belonging to
// whichever Client PCClientAuth.requireClientLogin() resolves (via
// D.getPatientsForClient(client), the same function
// client-dashboard.js / client-pets.js / client-appointments.js
// already use). No client/pet/record is ever looked up by name or
// hardcoded.
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

  // Same date formatting medical-records.js (Administrator) uses, so
  // dates read identically on both sides.
  function formatDateShort(D, iso) {
    if (!iso) return '\u2014';
    var d = D.parseDate(iso);
    if (isNaN(d.getTime())) return '\u2014';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // Same status badge helper as medical-records.js — reuses
  // D.MED_STATUS_BADGE_CLASS / D.MED_STATUS_LABELS rather than
  // introducing a second status vocabulary.
  function badge(D, status) {
    var cls = D.MED_STATUS_BADGE_CLASS[status] || 'status-completed';
    var label = D.MED_STATUS_LABELS[status] || status;
    return '<span class="status-badge ' + cls + '">' + esc(label) + '</span>';
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
        renderRecordsList(D, patients);
      });
    });
  }

  // ------------------------------------------------------------------
  // records list
  // ------------------------------------------------------------------

  // Records for the current filter: a specific pet via the existing
  // D.getMedicalRecordsForPatientId(patientId), or every record across
  // all of the client's own pets (merged, then re-sorted most-recent-
  // first the same way that function already sorts a single pet's list).
  function getRecordsForSelection(D, patients) {
    if (state.selectedPatientId) {
      return D.getMedicalRecordsForPatientId(state.selectedPatientId);
    }
    var all = [];
    patients.forEach(function (p) {
      all = all.concat(D.getMedicalRecordsForPatientId(p.id));
    });
    return all.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
  }

  function recordCard(D, r) {
    var patient = r.patientId ? D.getPatientById(r.patientId) : null;
    var icon = patient ? (D.SPECIES_ICON[patient.species] || '<i class="fa-solid fa-paw"></i>') : '<i class="fa-solid fa-paw"></i>';

    return (
      '<div class="record-card">' +
        '<div class="record-card-head">' +
          '<div class="record-card-left">' +
            '<div class="record-pet-avatar">' + icon + '</div>' +
            '<div>' +
              '<div class="record-pet-name">' + esc(r.pet) + '</div>' +
              '<div class="record-meta">' + formatDateShort(D, r.date) + ' \u00b7 ' + esc(r.visitType) + ' \u00b7 ' + esc(r.vet) + '</div>' +
            '</div>' +
          '</div>' +
          badge(D, r.status) +
        '</div>' +
        '<div class="record-preview"><b>Diagnosis:</b> ' + esc(r.diagnosis || 'None recorded') + '</div>' +
        '<div class="record-card-actions">' +
          '<button class="btn btn-sm" data-action="view" data-id="' + esc(r.id) + '"><i class="fa-solid fa-eye"></i> View full record</button>' +
        '</div>' +
      '</div>'
    );
  }

  function renderRecordsList(D, patients) {
    var box = document.getElementById('records-list');
    var countBox = document.getElementById('mr-count');

    if (!patients.length) {
      countBox.textContent = '';
      box.innerHTML = '<div class="empty-note">No pets registered yet. Visit the clinic front desk to register your pet.</div>';
      return;
    }

    var records = getRecordsForSelection(D, patients);

    countBox.textContent = records.length + ' record' + (records.length === 1 ? '' : 's');

    if (!records.length) {
      box.innerHTML = '<div class="no-results">No medical records available.</div>';
      return;
    }

    box.innerHTML = records.map(function (r) { return recordCard(D, r); }).join('');

    box.querySelectorAll('[data-action="view"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openView(D, btn.getAttribute('data-id'));
      });
    });
  }

  // ------------------------------------------------------------------
  // read-only "view full record" modal — same fields/labels/fallback
  // text as the Administrator Medical Records view modal
  // (medical-records.js renderView), minus the Edit button.
  // ------------------------------------------------------------------

  function openView(D, id) {
    var r = D.getMedRecordById(id);
    if (!r) return;

    var patient = r.patientId ? D.getPatientById(r.patientId) : null;
    var icon = patient ? (D.SPECIES_ICON[patient.species] || '<i class="fa-solid fa-paw"></i>') : '<i class="fa-solid fa-paw"></i>';
    var box = document.getElementById('view-box');

    box.innerHTML =
      '<div class="modal-head">' +
        '<div class="modal-title">Medical Record Details</div>' +
        '<button class="modal-close" id="view-close"><i class="fa-solid fa-xmark"></i></button>' +
      '</div>' +

      '<div class="profile-head">' +
        '<div class="profile-avatar">' + icon + '</div>' +
        '<div>' +
          '<div class="profile-name">' + esc(r.pet) + '</div>' +
          '<div class="profile-sub">' + formatDateShort(D, r.date) + ' \u00b7 ' + esc(r.visitType) + ' \u00b7 ' + esc(r.vet) + '</div>' +
        '</div>' +
        '<span style="margin-left:auto;">' + badge(D, r.status) + '</span>' +
      '</div>' +

      '<div class="profile-section">' +
        '<div class="profile-section-title"><i class="fa-solid fa-paw"></i> Pet information</div>' +
        '<div class="profile-grid">' +
          '<div class="profile-field"><span class="pf-label">Pet name</span><span class="pf-value">' + esc(r.pet) + '</span></div>' +
          '<div class="profile-field"><span class="pf-label">Species / breed</span><span class="pf-value">' + (patient ? esc(patient.species) + (patient.breed ? ' \u00b7 ' + esc(patient.breed) : '') : '\u2014') + '</span></div>' +
          '<div class="profile-field"><span class="pf-label">Weight recorded</span><span class="pf-value">' + (r.weight ? esc(r.weight) + ' kg' : '\u2014') + '</span></div>' +
        '</div>' +
      '</div>' +

      '<div class="profile-section">' +
        '<div class="profile-section-title"><i class="fa-solid fa-calendar-days"></i> Visit information</div>' +
        '<div class="profile-grid">' +
          '<div class="profile-field"><span class="pf-label">Record date</span><span class="pf-value">' + formatDateShort(D, r.date) + '</span></div>' +
          '<div class="profile-field"><span class="pf-label">Veterinarian</span><span class="pf-value">' + esc(r.vet) + '</span></div>' +
          '<div class="profile-field"><span class="pf-label">Visit type / service</span><span class="pf-value">' + esc(r.visitType) + '</span></div>' +
          '<div class="profile-field"><span class="pf-label">Follow-up date</span><span class="pf-value">' + (r.followUpDate ? formatDateShort(D, r.followUpDate) : 'None scheduled') + '</span></div>' +
          '<div class="profile-field" style="grid-column:1/-1;"><span class="pf-label">Chief complaint</span><span class="pf-value">' + esc(r.chiefComplaint || '\u2014') + '</span></div>' +
        '</div>' +
      '</div>' +

      '<div class="profile-section">' +
        '<div class="profile-section-title"><i class="fa-solid fa-notes-medical"></i> Clinical details</div>' +
        '<div class="profile-grid">' +
          '<div class="profile-field" style="grid-column:1/-1;"><span class="pf-label">Symptoms</span><span class="pf-value">' + esc(r.symptoms || 'None recorded') + '</span></div>' +
          '<div class="profile-field" style="grid-column:1/-1;"><span class="pf-label">Examination findings</span><span class="pf-value">' + esc(r.examFindings || 'None recorded') + '</span></div>' +
          '<div class="profile-field" style="grid-column:1/-1;"><span class="pf-label">Diagnosis</span><span class="pf-value">' + esc(r.diagnosis || 'None recorded') + '</span></div>' +
          '<div class="profile-field" style="grid-column:1/-1;"><span class="pf-label">Treatment</span><span class="pf-value">' + esc(r.treatment || 'None recorded') + '</span></div>' +
          '<div class="profile-field" style="grid-column:1/-1;"><span class="pf-label">Prescription / medications</span><span class="pf-value">' + esc(r.prescription || 'None recorded') + '</span></div>' +
          '<div class="profile-field"><span class="pf-label">Vaccination given</span><span class="pf-value">' + esc(r.vaccination || 'None') + '</span></div>' +
          '<div class="profile-field"><span class="pf-label">Weight</span><span class="pf-value">' + (r.weight ? esc(r.weight) + ' kg' : '\u2014') + '</span></div>' +
        '</div>' +
      '</div>' +

      '<div class="profile-section">' +
        '<div class="profile-section-title"><i class="fa-solid fa-note-sticky"></i> Veterinarian notes</div>' +
        '<div class="pf-value">' + esc(r.vetNotes || 'No notes recorded.') + '</div>' +
      '</div>' +

      '<div class="modal-footer">' +
        '<button class="btn" id="view-close-btn">Close</button>' +
      '</div>';

    document.getElementById('view-close').addEventListener('click', closeView);
    document.getElementById('view-close-btn').addEventListener('click', closeView);
    document.getElementById('view-overlay').classList.add('open');
  }

  function closeView() {
    document.getElementById('view-overlay').classList.remove('open');
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
      renderRecordsList(D, patients);
    }

    renderSidebarFooter(client);
    renderDynamic();

    document.getElementById('view-overlay').addEventListener('click', function (e) {
      if (e.target === document.getElementById('view-overlay')) closeView();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeView();
    });

    document.getElementById('logout-btn').addEventListener('click', function (e) {
      e.preventDefault();
      window.PCClientAuth.logoutClient();
    });

    // Keep the list live if the Administrator/Veterinarian adds or
    // updates a record (or a pet's registration changes) in another
    // tab — same D.onChange() mechanism every other Client page uses.
    D.onChange(renderDynamic);
  });
})();