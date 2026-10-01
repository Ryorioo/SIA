// ============================================================
// PAWSITIVE CARE — Client (Pet Owner) My Pets
// Every pet shown here comes from PCData.getPatientsForClient(client),
// where `client` is whatever PCClientAuth.requireClientLogin() resolves
// from the real, logged-in session — never a hardcoded name. The pet
// profile view is assembled the same way: real Vaccinations,
// Appointments, and (where available) Medical Records looked up by
// the selected pet's own id. Everything rendered here is read-only;
// this module never writes to any PCData store.
// ============================================================

(function () {
  function esc(str) {
    return String(str == null || str === '' ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Small helper for profile fields that may legitimately be blank —
  // shows an em dash instead of an empty box so read-only fields never
  // look broken.
  function orDash(v) {
    var s = String(v == null ? '' : v).trim();
    return s ? esc(s) : '\u2014';
  }

  function initials(name) {
    var parts = (name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    var first = parts[0][0] || '';
    var last = parts.length > 1 ? (parts[parts.length - 1][0] || '') : '';
    return (first + last).toUpperCase();
  }

  // ------------------------------------------------------------------
  // sidebar footer (same as client-dashboard.js)
  // ------------------------------------------------------------------

  function renderSidebarFooter(client) {
    document.getElementById('footer-avatar').textContent = initials(client.name);
    document.getElementById('footer-name').textContent = client.name;
  }

  // ------------------------------------------------------------------
  // pet list
  // ------------------------------------------------------------------

  function renderPetsList(D, client) {
    var pets = D.getPatientsForClient(client);
    var box = document.getElementById('pets-list');

    if (!pets.length) {
      box.innerHTML = '<div class="empty-note">No pets registered yet. Visit the clinic front desk to register your pet.</div>';
      return pets;
    }

    box.innerHTML = pets.map(function (p) {
      var icon = D.SPECIES_ICON[p.species] || '<i class="fa-solid fa-paw"></i>';
      return (
        '<div class="pet-list-row">' +
          '<div class="pet-list-main">' +
            '<div class="pet-list-avatar">' + icon + '</div>' +
            '<div>' +
              '<div class="pet-list-name">' + esc(p.pet) + '</div>' +
              '<div class="pet-list-meta">' + (p.owner ? esc(p.owner) : esc(client.name)) + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="pet-list-cols">' +
            '<div class="pet-list-col"><div class="pet-list-col-label">Species</div><div class="pet-list-col-value">' + esc(p.species || '\u2014') + '</div></div>' +
            '<div class="pet-list-col"><div class="pet-list-col-label">Breed</div><div class="pet-list-col-value">' + (p.breed ? esc(p.breed) : '\u2014') + '</div></div>' +
            '<div class="pet-list-col"><div class="pet-list-col-label">Status</div><div class="pet-list-col-value"><span class="status-badge status-' + p.status + '">' + (p.status === 'active' ? 'Active' : 'Inactive') + '</span></div></div>' +
          '</div>' +
          '<button class="btn btn-sm view-profile-btn" data-id="' + esc(p.id) + '">View Profile</button>' +
        '</div>'
      );
    }).join('');

    return pets;
  }

  // ------------------------------------------------------------------
  // profile overlay
  // ------------------------------------------------------------------

  function renderBasicInfo(D, patient) {
    var age = D.calcAge ? D.calcAge(patient.dob) : '\u2014';
    var fields = [
      ['Species', patient.species],
      ['Breed', patient.breed],
      ['Sex', patient.sex],
      ['Age', age],
      ['Color', patient.color],
      ['Weight', patient.weight ? patient.weight + ' kg' : ''],
      ['Spayed / Neutered', patient.spayed],
      ['Status', patient.status === 'active' ? 'Active' : 'Inactive']
    ];
    return (
      '<div class="profile-section">' +
        '<div class="profile-section-title"><i class="fa-solid fa-paw"></i> Basic Information</div>' +
        '<div class="profile-grid">' +
          fields.map(function (f) {
            return '<div><div class="profile-field-label">' + esc(f[0]) + '</div><div class="profile-field-value">' + orDash(f[1]) + '</div></div>';
          }).join('') +
        '</div>' +
      '</div>'
    );
  }

  function renderOwnerInfo(patient, client) {
    var fields = [
      ['Owner', (client && client.name) || patient.owner],
      ['Phone', (client && client.phone) || patient.ownerPhone],
      ['Email', client && client.email],
      ['Address', client && client.address],
      ['Emergency Contact', client && client.emergencyContact]
    ];
    return (
      '<div class="profile-section">' +
        '<div class="profile-section-title"><i class="fa-solid fa-user"></i> Owner Information</div>' +
        '<div class="profile-grid">' +
          fields.map(function (f) {
            return '<div><div class="profile-field-label">' + esc(f[0]) + '</div><div class="profile-field-value">' + orDash(f[1]) + '</div></div>';
          }).join('') +
        '</div>' +
      '</div>'
    );
  }

  function renderHealthNotes(patient) {
    var fields = [
      ['Allergies', patient.allergies],
      ['Current Conditions', patient.conditions],
      ['Current Medications', patient.medications],
      ['Notes', patient.notes]
    ];
    return (
      '<div class="profile-section">' +
        '<div class="profile-section-title"><i class="fa-solid fa-notes-medical"></i> Health Notes</div>' +
        '<div class="profile-grid">' +
          fields.map(function (f) {
            return '<div><div class="profile-field-label">' + esc(f[0]) + '</div><div class="profile-field-value">' + orDash(f[1]) + '</div></div>';
          }).join('') +
        '</div>' +
      '</div>'
    );
  }

  // Vaccination History — real per-shot records if any exist for this
  // patient id; falls back to the patient's own general
  // vaccinationStatus (same fallback rule patient-data-store.js itself
  // documents) when no individual records have been logged yet.
  function renderVaccinations(D, patient) {
    var rows = '';
    var records = D.getVaccinationsForPatientId ? D.getVaccinationsForPatientId(patient.id) : [];
    if (records.length) {
      rows = records.map(function (v) {
        var status = D.computeVaccinationStatus ? D.computeVaccinationStatus(v.nextDue) : '';
        return (
          '<div class="profile-list-row">' +
            '<div><div class="profile-list-main">' + esc(v.vaccineName || 'Vaccination') + '</div>' +
            '<div class="profile-list-meta">Given ' + orDash(v.dateGiven) + (v.nextDue ? ' \u00b7 Next due ' + esc(v.nextDue) : '') + '</div></div>' +
            (status ? '<span class="status-badge">' + esc(status) + '</span>' : '') +
          '</div>'
        );
      }).join('');
    } else {
      rows = '<div class="empty-note">No individual vaccination records logged yet' + (patient.vaccinationStatus ? ' \u2014 general status: ' + esc(patient.vaccinationStatus) : '') + '.</div>';
    }
    return (
      '<div class="profile-section">' +
        '<div class="profile-section-title"><i class="fa-solid fa-syringe"></i> Vaccination History</div>' +
        rows +
      '</div>'
    );
  }

  // Medical Records — real schema per medical-records-data-store.js:
  // { date, vet, visitType, chiefComplaint, symptoms, examFindings,
  //   diagnosis, treatment, prescription, vaccination, weight,
  //   followUpDate, vetNotes, status } looked up via the real
  //   getMedicalRecordsForPatientId(patientId), most-recent-first.
  // Still guarded in case this file isn't loaded on some future page,
  // so a missing script tag degrades honestly instead of throwing.
  function renderMedicalRecords(D, patient) {
    if (!D.getMedicalRecordsForPatientId) {
      return (
        '<div class="profile-section">' +
          '<div class="profile-section-title"><i class="fa-solid fa-file-medical"></i> Medical Records</div>' +
          '<div class="empty-note">Medical records aren\u2019t available yet.</div>' +
        '</div>'
      );
    }
    var records = D.getMedicalRecordsForPatientId(patient.id) || [];
    var rows;
    if (!records.length) {
      rows = '<div class="empty-note">No medical records on file yet.</div>';
    } else {
      rows = records.map(function (r) {
        var badgeClass = (D.MED_STATUS_BADGE_CLASS && D.MED_STATUS_BADGE_CLASS[r.status]) || '';
        var statusLabel = (D.MED_STATUS_LABELS && D.MED_STATUS_LABELS[r.status]) || r.status;
        var details = [
          r.chiefComplaint ? 'Chief complaint: ' + esc(r.chiefComplaint) : '',
          r.diagnosis && r.diagnosis !== 'None' ? 'Diagnosis: ' + esc(r.diagnosis) : '',
          r.treatment && r.treatment !== 'None required' ? 'Treatment: ' + esc(r.treatment) : '',
          r.prescription && r.prescription !== 'None' ? 'Prescription: ' + esc(r.prescription) : '',
          r.vaccination && r.vaccination !== 'None' ? 'Vaccination: ' + esc(r.vaccination) : '',
          r.followUpDate ? 'Follow-up: ' + esc(r.followUpDate) : '',
          r.vetNotes ? 'Notes: ' + esc(r.vetNotes) : ''
        ].filter(Boolean);
        return (
          '<div class="profile-list-row">' +
            '<div>' +
              '<div class="profile-list-main">' + esc(r.visitType || 'Visit') + '</div>' +
              '<div class="profile-list-meta">' + orDash(r.date) + ' \u00b7 ' + esc(r.vet) + '</div>' +
              details.map(function (d) { return '<div class="profile-list-meta">' + d + '</div>'; }).join('') +
            '</div>' +
            (statusLabel ? '<span class="status-badge ' + badgeClass + '">' + esc(statusLabel) + '</span>' : '') +
          '</div>'
        );
      }).join('');
    }
    return (
      '<div class="profile-section">' +
        '<div class="profile-section-title"><i class="fa-solid fa-file-medical"></i> Medical Records</div>' +
        rows +
      '</div>'
    );
  }

  function renderAppointmentHistory(D, patient) {
    var appts = D.getAppointmentsForPatient(patient);
    var rows;
    if (!appts.length) {
      rows = '<div class="empty-note">No appointment history yet.</div>';
    } else {
      rows = appts.map(function (a) {
        return (
          '<div class="profile-list-row">' +
            '<div><div class="profile-list-main">' + D.formatDateLabel(a.date) + ' \u00b7 ' + D.formatTimeLabel(a.time) + '</div>' +
            '<div class="profile-list-meta">' + esc(a.reason || 'General visit') + ' \u00b7 ' + esc(a.vet) + '</div></div>' +
            '<span class="status-badge status-' + a.status + '">' + esc(D.STATUS_LABELS[a.status] || a.status) + '</span>' +
          '</div>'
        );
      }).join('');
    }
    return (
      '<div class="profile-section">' +
        '<div class="profile-section-title"><i class="fa-solid fa-calendar-days"></i> Appointment History</div>' +
        rows +
      '</div>'
    );
  }

  // Queue Status — only shown when this specific pet is actually
  // checked in today (status 'arrived'), reusing getQueueDisplayInfo
  // so the label/format matches the Administrator Queue view exactly.
  function renderQueueInfo(D, patient) {
    var today = D.todayStr();
    var appts = D.getAppointmentsForPatient(patient);
    var inQueue = appts.find(function (a) { return a.status === 'arrived' && a.date === today; });
    if (!inQueue) return '';

    var info = D.getQueueDisplayInfo(inQueue);
    var label =
      info.queueStatus === 'waiting' ? 'Waiting' :
      info.queueStatus === 'called' ? 'Called \u2014 please proceed to the consultation room' :
      info.queueStatus === 'in-consultation' ? 'In consultation' : '\u2014';

    return (
      '<div class="profile-section">' +
        '<div class="profile-section-title"><i class="fa-solid fa-hourglass-half"></i> Queue Status \u2014 Today</div>' +
        '<div class="queue-inline">' +
          '<div class="queue-inline-code">' + esc(info.queueCode || '\u2014') + '</div>' +
          '<div class="queue-inline-label">' + esc(label) + '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function openProfile(D, client, patient) {
    var icon = D.SPECIES_ICON[patient.species] || '<i class="fa-solid fa-paw"></i>';
    document.getElementById('profile-avatar').innerHTML = icon;
    document.getElementById('profile-name').textContent = patient.pet;
    document.getElementById('profile-sub').textContent =
      (patient.species || '') + (patient.breed ? ' \u00b7 ' + patient.breed : '');

    document.getElementById('profile-body').innerHTML =
      renderBasicInfo(D, patient) +
      renderOwnerInfo(patient, client) +
      renderHealthNotes(patient) +
      renderQueueInfo(D, patient) +
      renderVaccinations(D, patient) +
      renderMedicalRecords(D, patient) +
      renderAppointmentHistory(D, patient);

    document.getElementById('profile-overlay').classList.add('open');
  }

  function closeProfile() {
    document.getElementById('profile-overlay').classList.remove('open');
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
      renderPetsList(D, client);
    }

    renderSidebarFooter(client);
    renderDynamic();

    document.getElementById('pets-list').addEventListener('click', function (e) {
      var btn = e.target.closest('.view-profile-btn');
      if (!btn) return;
      var patient = D.getPatientById(btn.getAttribute('data-id'));
      if (!patient) return;
      openProfile(D, client, patient);
    });

    document.getElementById('profile-close').addEventListener('click', closeProfile);
    document.getElementById('profile-overlay').addEventListener('click', function (e) {
      if (e.target === document.getElementById('profile-overlay')) closeProfile();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeProfile();
    });

    document.getElementById('logout-btn').addEventListener('click', function (e) {
      e.preventDefault();
      window.PCClientAuth.logoutClient();
    });

    // Keep the list (and an open profile's Queue Status) live if data
    // changes elsewhere — e.g. front desk marks this client's pet
    // arrived in another tab. Re-renders the list; an already-open
    // profile is left as-is rather than yanked shut mid-read.
    D.onChange(renderDynamic);
  });
})();