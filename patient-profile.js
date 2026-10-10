// ============================================================
// PAWSITIVE CARE — Patient Profile page (frontend prototype)
// Reads the selected patient from ?id=PT-002 (clinic display ID)
// or a raw patient id, using the existing PCData frontend store.
// Medical records / prescriptions / billing rows below are demo
// content only — to be replaced by real data in the React rebuild.
// ============================================================

(function () {
  var D = window.PCData;
  var root = document.getElementById('pp-content');
  var state = { patientId: null, tab: 'medical' };

  // ------------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------------

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function showToast(msg) {
    var toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toast.classList.remove('show'); }, 2200);
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function parseIso(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null;
  }
  function fmtShort(iso) {
    var p = parseIso(iso);
    return p ? MONTHS[p.m] + ' ' + p.d + ', ' + p.y : '—';
  }
  function fmtLong(iso) {
    var p = parseIso(iso);
    return p ? MONTHS_LONG[p.m] + ' ' + p.d + ', ' + p.y : '—';
  }

  function isNone(v) {
    return /^\s*(none|none known|none recorded|n\/a|—|-)?\s*$/i.test(v || '');
  }
  function orNone(v) { return isNone(v) ? 'None' : v; }

  // Clinic display ID: PT-001, PT-002… = position in the patient list
  // (same stable order Patients page uses to number cards).
  function displayId(p) {
    var raw = String(p.id || '');
    if (/^PT-\d+$/i.test(raw)) return raw.toUpperCase();
    var idx = D.getPatients().findIndex(function (x) { return x.id === p.id; });
    return 'PT-' + String(idx + 1).padStart(3, '0');
  }

  function findPatient(param) {
    if (!param) return null;
    var all = D.getPatients();
    var byRaw = all.find(function (p) { return p.id === param; });
    if (byRaw) return byRaw;
    var m = /^PT-(\d+)$/i.exec(param.trim());
    if (m) return all[parseInt(m[1], 10) - 1] || null;
    return null;
  }

  function ownerInfo(p) {
    var client = p.clientId && D.getClientById ? D.getClientById(p.clientId) : null;
    if (client) return { name: client.name, phone: client.phone, email: client.email };
    return { name: p.owner || '', phone: p.ownerPhone || '', email: '' };
  }

  // Dedicated Client Profile URL for this patient's owner. Uses the real
  // clientId when the patient has one; legacy/seeded patients with no
  // clientId fall back to matching the owner name — the same rule
  // PCData.getPatientsForClient already uses. If no client can be found,
  // falls back to the Clients list (the previous behavior).
  function clientProfileHref(p) {
    var client = p.clientId && D.getClientById ? D.getClientById(p.clientId) : null;
    if (!client && D.getClients) {
      var name = (p.owner || '').trim().toLowerCase();
      if (name) {
        client = D.getClients().find(function (c) { return (c.name || '').trim().toLowerCase() === name; }) || null;
      }
    }
    return client ? 'client-profile.html?id=' + encodeURIComponent(client.id) : 'clients.html';
  }

  function sexIcon(sex) {
    var s = (sex || '').toLowerCase();
    return s === 'female' ? 'fa-venus' : s === 'male' ? 'fa-mars' : 'fa-venus-mars';
  }

  function vaxBadgeClass(status) {
    return status === 'Up to date' ? 'status-confirmed'
      : status === 'Overdue' ? 'status-cancelled'
      : status === 'Due soon' ? 'status-pending'
      : 'status-completed';
  }

  function healthStatus(p) {
    if (p.status === 'inactive') return { label: 'Inactive', cls: 'pp-health-off' };
    if (!isNone(p.conditions)) return { label: 'Under Care', cls: 'pp-health-care' };
    return { label: 'Healthy', cls: 'pp-health-ok' };
  }

  // Vaccination status shown in Health Summary: derived from real
  // vaccination records when there are any (worst status wins),
  // otherwise the general status already stored on the patient.
  function vaccinationSummary(p) {
    var recs = D.getVaccinationsForPatientId(p.id);
    if (!recs.length) return p.vaccinationStatus || 'Unknown';
    var order = ['Overdue', 'Due soon', 'Unknown', 'Up to date'];
    var statuses = recs.map(function (v) { return D.computeVaccinationStatus(v.nextDue); });
    for (var i = 0; i < order.length; i++) if (statuses.indexOf(order[i]) !== -1) return order[i];
    return 'Unknown';
  }

  // ------------------------------------------------------------------
  // demo content (frontend prototype only)
  // ------------------------------------------------------------------

  function demoRecords(p) {
    var cond = isNone(p.conditions) ? null : p.conditions;
    return [
      { date: '2026-09-03', diagnosis: 'Rabies Vaccination', treatment: 'Vaccination', vet: 'Dr. Santos', kind: 'vaccination', activity: 'Rabies Vaccination completed' },
      { date: '2026-08-20', diagnosis: 'General Check-up', treatment: 'Consultation', vet: 'Dr. Santos', kind: 'consultation', activity: 'General Consultation' },
      { date: '2026-07-12', diagnosis: cond || 'Ear Infection', treatment: 'Treatment', vet: 'Dr. Reyes', kind: 'treatment', activity: (cond || 'Ear Infection') + ' treatment' },
      { date: '2026-06-05', diagnosis: 'Skin Rash', treatment: 'Medication', vet: 'Dr. Santos', kind: 'consultation', activity: 'Skin Rash consultation' },
      { date: '2026-05-18', diagnosis: 'Dental Cleaning', treatment: 'Procedure', vet: 'Dr. Reyes', kind: 'other', activity: 'Dental Cleaning procedure' }
    ];
  }

  function demoPrescriptions(p) {
    var rows = [
      { date: '2026-08-20', drug: 'Amoxicillin 250 mg', dose: '1 tablet, twice daily · 7 days', vet: 'Dr. Santos', status: 'Completed' },
      { date: '2026-07-12', drug: 'Otic cleaner + ear drops', dose: '3 drops, once daily · 10 days', vet: 'Dr. Reyes', status: 'Completed' }
    ];
    if (!isNone(p.medications)) {
      rows.unshift({ date: '2026-09-03', drug: p.medications, dose: 'As directed by veterinarian', vet: 'Dr. Santos', status: 'Active' });
    }
    return rows;
  }

  function demoBilling() {
    return [
      { date: '2026-09-03', ref: 'INV-1042', desc: 'Rabies Vaccination', amount: 650, status: 'Paid' },
      { date: '2026-08-20', ref: 'INV-1019', desc: 'General Consultation', amount: 500, status: 'Paid' },
      { date: '2026-07-12', ref: 'INV-0987', desc: 'Ear Infection treatment', amount: 1250, status: 'Paid' },
      { date: '2026-06-05', ref: 'INV-0951', desc: 'Skin Rash consultation + medication', amount: 880, status: 'Pending' }
    ];
  }

  function peso(n) {
    return '₱' + Number(n).toLocaleString('en-PH');
  }

  // ------------------------------------------------------------------
  // render: sections
  // ------------------------------------------------------------------

  function field(icon, label, value) {
    return '<div class="pp-field"><i class="fa-solid ' + icon + '"></i><div>' +
      '<div class="pp-flabel">' + label + '</div><div class="pp-fvalue">' + esc(value) + '</div></div></div>';
  }

  // "+ Add Record" dropdown: groups the three record actions. Items keep
  // their original data-act values, so wire() routes them to the exact same
  // behavior the individual buttons had.
  function menuItem(act, icon, title, desc) {
    return '<button class="pp-menu-item" role="menuitem" data-act="' + act + '">' +
      '<span class="pp-menu-ico"><i class="fa-solid ' + icon + '"></i></span>' +
      '<span class="pp-menu-text"><span class="pp-menu-title">' + title + '</span>' +
      '<span class="pp-menu-desc">' + desc + '</span></span></button>';
  }

  function addRecordMenuHtml() {
    return '<div class="pp-menu">' +
      '<button class="btn btn-primary btn-sm pp-menu-toggle" id="pp-menu-toggle" aria-haspopup="menu" aria-expanded="false" aria-controls="pp-menu-panel">' +
        '<i class="fa-solid fa-plus"></i> Add Record <i class="fa-solid fa-chevron-down pp-chev"></i></button>' +
      '<div class="pp-menu-panel" id="pp-menu-panel" role="menu" aria-label="Add record">' +
        '<div class="pp-menu-heading">MEDICAL RECORDS</div>' +
        menuItem('record', 'fa-file-medical', 'Medical Record', 'Add a clinical record') +
        menuItem('vaccination', 'fa-shield-halved', 'Vaccination', 'Record a vaccination') +
        menuItem('prescription', 'fa-prescription-bottle-medical', 'Prescription', 'Add a prescription') +
      '</div></div>';
  }

  function menuEls() {
    return { toggle: document.getElementById('pp-menu-toggle'), panel: document.getElementById('pp-menu-panel') };
  }

  // Keep the panel inside the viewport (it is right-aligned to the button by
  // default; on narrow screens the button can sit near the left edge).
  function positionMenu() {
    var m = menuEls();
    if (!m.panel) return;
    m.panel.style.left = ''; m.panel.style.right = '';
    var pad = 8, vw = document.documentElement.clientWidth;
    var r = m.panel.getBoundingClientRect();
    if (r.left < pad) {
      var anchor = m.toggle.getBoundingClientRect();
      var left = Math.max(pad - anchor.left, -anchor.left + pad);
      m.panel.style.right = 'auto';
      m.panel.style.left = left + 'px';
      r = m.panel.getBoundingClientRect();
    }
    if (r.right > vw - pad) {
      var shift = r.right - (vw - pad);
      m.panel.style.right = 'auto';
      m.panel.style.left = (parseFloat(m.panel.style.left || (r.left - m.toggle.getBoundingClientRect().left)) - shift) + 'px';
    }
  }

  function openMenu() {
    var m = menuEls();
    if (!m.panel) return;
    m.panel.classList.add('open');
    m.toggle.setAttribute('aria-expanded', 'true');
    positionMenu();
  }
  function closeMenu(returnFocus) {
    var m = menuEls();
    if (!m.panel) return;
    m.panel.classList.remove('open');
    m.toggle.setAttribute('aria-expanded', 'false');
    if (returnFocus) m.toggle.focus();
  }
  function isMenuOpen() {
    var m = menuEls();
    return !!(m.panel && m.panel.classList.contains('open'));
  }

  function headerHtml(p) {
    var hs = healthStatus(p);
    var species = p.species + (p.breed ? ' · ' + p.breed : '');
    var icon = (D.SPECIES_ICON && D.SPECIES_ICON[p.species]) || '<i class="fa-solid fa-paw"></i>';
    return '<section class="pp-panel pp-header">' +
      '<div class="pp-identity">' +
        '<div class="pp-photo" aria-hidden="true">' + icon + '</div>' +
        '<div class="pp-id-text">' +
          '<div class="pp-name-row"><span class="pp-name">' + esc(p.pet) + '</span><span class="pp-pid">' + esc(displayId(p)) + '</span></div>' +
          '<div class="pp-species">' + esc(species) + '</div>' +
          '<span class="status-badge pp-health-badge ' + hs.cls + '">' + hs.label + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="pp-actions">' +
        '<button class="btn btn-primary btn-sm" data-act="appointment"><i class="fa-solid fa-plus"></i> New Appointment</button>' +
        addRecordMenuHtml() +
      '</div>' +
    '</section>';
  }

  function overviewHtml(p) {
    var owner = ownerInfo(p);
    var vax = vaccinationSummary(p);

    var patientCard =
      '<section class="pp-panel"><div class="pp-panel-title"><i class="fa-solid fa-paw"></i> Patient Information</div>' +
        '<div class="pp-subtitle">Patient Details</div>' +
        '<div class="pp-fields">' +
          field('fa-paw', 'Pet Name', p.pet) +
          field('fa-dna', 'Species', p.species) +
          field('fa-bone', 'Breed', p.breed || '—') +
          field(sexIcon(p.sex), 'Gender', p.sex || '—') +
          field('fa-calendar', 'Birth Date', fmtShort(p.dob)) +
          field('fa-hourglass-half', 'Age', D.calcAge(p.dob)) +
          field('fa-scale-balanced', 'Weight', p.weight ? p.weight + ' kg' : '—') +
        '</div></section>';

    var ownerCard =
      '<section class="pp-panel"><div class="pp-panel-title"><i class="fa-solid fa-user"></i> Owner Information</div>' +
        '<div class="pp-owner-top"><div class="pp-owner-avatar"><i class="fa-solid fa-user"></i></div>' +
          '<div><div class="pp-flabel">Owner</div><div class="pp-owner-name">' + esc(owner.name || '—') + '</div></div></div>' +
        '<div class="pp-owner-list">' +
          field('fa-phone', 'Phone', owner.phone || '—') +
          field('fa-envelope', 'Email', owner.email || '—') +
        '</div>' +
        '<a class="btn btn-primary btn-sm" href="' + esc(clientProfileHref(p)) + '"><i class="fa-solid fa-user"></i> View Client Profile <i class="fa-solid fa-arrow-up-right-from-square"></i></a>' +
      '</section>';

    function hrow(icon, label, valueHtml) {
      return '<div class="pp-hrow"><i class="fa-solid ' + icon + '"></i><span class="pp-hlabel">' + label + '</span><span class="pp-hvalue">' + valueHtml + '</span></div>';
    }
    var healthCard =
      '<section class="pp-panel"><div class="pp-panel-title"><i class="fa-solid fa-heart-pulse"></i> Health Summary</div>' +
        '<div class="pp-health-list">' +
          hrow('fa-shield-heart', 'Vaccination Status', '<span class="status-badge ' + vaxBadgeClass(vax) + '">' + esc(vax) + '</span>') +
          hrow('fa-triangle-exclamation', 'Allergies', esc(orNone(p.allergies))) +
          hrow('fa-notes-medical', 'Medical Conditions', esc(orNone(p.conditions))) +
          hrow('fa-pills', 'Current Medication', esc(orNone(p.medications))) +
          hrow('fa-note-sticky', 'Special Notes', esc(p.notes || '—')) +
        '</div></section>';

    return '<div class="pp-overview">' + patientCard + ownerCard + healthCard + '</div>';
  }

  var TABS = [
    { id: 'medical', label: 'Medical Records', icon: 'fa-file-medical' },
    { id: 'appointments', label: 'Appointments', icon: 'fa-calendar-days' },
    { id: 'vaccinations', label: 'Vaccinations', icon: 'fa-shield-halved' },
    { id: 'prescriptions', label: 'Prescriptions', icon: 'fa-prescription-bottle-medical' },
    { id: 'billing', label: 'Billing History', icon: 'fa-receipt' }
  ];

  function tabsHtml() {
    return '<div class="pp-tabs" role="tablist" aria-label="Patient history">' + TABS.map(function (t) {
      return '<button class="pp-tab' + (t.id === state.tab ? ' active' : '') + '" role="tab" aria-selected="' + (t.id === state.tab) + '" data-tab="' + t.id + '">' +
        '<i class="fa-solid ' + t.icon + '"></i>' + t.label + '</button>';
    }).join('') + '</div>';
  }

  function table(headers, rowsHtml, stackable) {
    return '<div class="pp-table-wrap"><table class="pp-table' + (stackable ? ' stackable' : '') + '"><thead><tr>' +
      headers.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>';
  }

  function cell(label, html) { return '<td data-label="' + label + '">' + html + '</td>'; }

  function medicalHtml(p) {
    var rows = demoRecords(p).map(function (r) {
      return '<tr>' + cell('Date', fmtShort(r.date)) + cell('Diagnosis', esc(r.diagnosis)) +
        cell('Treatment', esc(r.treatment)) + cell('Veterinarian', esc(r.vet)) + '</tr>';
    }).join('');
    return table(['Date', 'Diagnosis', 'Treatment', 'Veterinarian'], rows, true);
  }

  function appointmentsRows(p, limit) {
    var history = D.getAppointmentsForPatient(p);
    if (limit) history = history.slice(0, limit);
    return history;
  }

  function appointmentsHtml(p) {
    var history = appointmentsRows(p, 8);
    if (!history.length) return '<div class="pp-empty">No appointment history yet.</div>';
    var rows = history.map(function (a) {
      var when = (D.formatDateLabel ? D.formatDateLabel(a.date) : fmtShort(a.date)) + (D.formatTimeLabel && a.time ? ' · ' + D.formatTimeLabel(a.time) : '');
      var label = (D.STATUS_LABELS && D.STATUS_LABELS[a.status]) || a.status;
      return '<tr>' + cell('Date', esc(when)) + cell('Reason', esc(a.reason || 'General visit')) +
        cell('Veterinarian', esc(a.vet || '—')) + cell('Status', '<span class="status-badge status-' + esc(a.status) + '">' + esc(label) + '</span>') + '</tr>';
    }).join('');
    return table(['Date', 'Reason', 'Veterinarian', 'Status'], rows, true);
  }

  function vaccinationsHtml(p) {
    var recs = D.getVaccinationsForPatientId(p.id);
    if (!recs.length) {
      return '<div class="pp-empty">No vaccination records yet.<br>General status on file: <span class="status-badge ' + vaxBadgeClass(p.vaccinationStatus) + '">' + esc(p.vaccinationStatus || 'Unknown') + '</span></div>';
    }
    var rows = recs.map(function (v) {
      var st = D.computeVaccinationStatus(v.nextDue);
      return '<tr>' + cell('Vaccine', esc(v.vaccineName || 'Vaccine')) + cell('Date Given', fmtShort(v.dateGiven)) +
        cell('Next Due', fmtShort(v.nextDue)) + cell('Status', '<span class="status-badge ' + vaxBadgeClass(st) + '">' + esc(st) + '</span>') + '</tr>';
    }).join('');
    return table(['Vaccine', 'Date Given', 'Next Due', 'Status'], rows, true);
  }

  function prescriptionsHtml(p) {
    var rows = demoPrescriptions(p).map(function (r) {
      var cls = r.status === 'Active' ? 'status-confirmed' : 'status-completed';
      return '<tr>' + cell('Date', fmtShort(r.date)) + cell('Medication', esc(r.drug)) + cell('Instructions', esc(r.dose)) +
        cell('Veterinarian', esc(r.vet)) + cell('Status', '<span class="status-badge ' + cls + '">' + r.status + '</span>') + '</tr>';
    }).join('');
    return table(['Date', 'Medication', 'Instructions', 'Veterinarian', 'Status'], rows, true);
  }

  function billingHtml() {
    var rows = demoBilling().map(function (b) {
      var cls = b.status === 'Paid' ? 'status-confirmed' : 'status-pending';
      return '<tr>' + cell('Date', fmtShort(b.date)) + cell('Invoice', esc(b.ref)) + cell('Description', esc(b.desc)) +
        cell('Amount', peso(b.amount)) + cell('Status', '<span class="status-badge ' + cls + '">' + b.status + '</span>') + '</tr>';
    }).join('');
    return table(['Date', 'Invoice', 'Description', 'Amount', 'Status'], rows, true);
  }

  function sectionContent(p) {
    switch (state.tab) {
      case 'appointments': return appointmentsHtml(p);
      case 'vaccinations': return vaccinationsHtml(p);
      case 'prescriptions': return prescriptionsHtml(p);
      case 'billing': return billingHtml();
      default: return medicalHtml(p);
    }
  }

  function activityHtml(p) {
    var items = demoRecords(p).slice(0, 4).map(function (r) {
      var tone = r.kind === 'vaccination' ? 'vaccination' : r.kind === 'treatment' ? 'treatment' : r.kind === 'consultation' ? 'consultation' : 'other';
      var tag = r.kind === 'vaccination' ? 'Vaccination' : r.kind === 'treatment' ? 'Treatment' : r.kind === 'consultation' ? 'Consultation' : 'Procedure';
      return '<div class="pp-tl-item tone-' + tone + '-dot"><span class="pp-tl-dot"></span>' +
        '<div class="pp-tl-date">' + fmtLong(r.date) + '</div>' +
        '<div class="pp-tl-text">' + esc(r.activity) + '</div>' +
        '<span class="pp-tag tone-' + tone + '">' + tag + '</span></div>';
    }).join('');
    return '<aside class="pp-panel"><div class="pp-panel-title"><i class="fa-solid fa-clock-rotate-left"></i> Recent Activity</div>' +
      '<div class="pp-timeline">' + items + '</div></aside>';
  }

  function mainHtml(p) {
    var cur = TABS.filter(function (t) { return t.id === state.tab; })[0];
    return '<section class="pp-panel"><div class="pp-panel-title"><i class="fa-solid ' + cur.icon + '"></i> ' + cur.label + '</div>' +
      sectionContent(p) + '</section>' + activityHtml(p);
  }

  // ------------------------------------------------------------------
  // render: page
  // ------------------------------------------------------------------

  function renderMissing() {
    root.innerHTML = '<div class="pp-panel pp-missing"><h2>Patient not found</h2>' +
      '<p>We couldn\'t find a patient for this link.</p>' +
      '<a class="btn btn-primary" href="patients.html"><i class="fa-solid fa-arrow-left"></i> Back to Patients</a></div>';
  }

  function renderMain() {
    var p = D.getPatientById(state.patientId);
    if (!p) return;
    document.getElementById('pp-main').innerHTML = mainHtml(p);
    var tabs = document.getElementById('pp-tabs-host');
    tabs.innerHTML = tabsHtml();
    wireTabs();
  }

  function render() {
    var p = D.getPatientById(state.patientId);
    if (!p) { renderMissing(); return; }
    document.title = p.pet + ' · Patient Profile · Pawsitive Care';
    root.innerHTML =
      headerHtml(p) + overviewHtml(p) +
      '<div id="pp-tabs-host">' + tabsHtml() + '</div>' +
      '<div class="pp-main" id="pp-main">' + mainHtml(p) + '</div>';
    wire(p);
  }

  function selectTab(id) {
    state.tab = id;
    renderMain();
  }

  function wireTabs() {
    root.querySelectorAll('[data-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () { selectTab(btn.getAttribute('data-tab')); });
    });
  }

  function wire(p) {
    wireTabs();

    var menuToggle = document.getElementById('pp-menu-toggle');
    if (menuToggle) {
      menuToggle.addEventListener('click', function (e) {
        e.stopPropagation();
        if (isMenuOpen()) closeMenu(); else openMenu();
      });
    }

    root.querySelectorAll('[data-act]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var act = btn.getAttribute('data-act');
        closeMenu();
        var owner = ownerInfo(p);
        if (act === 'appointment') {
          window.location.href = 'appointments.html?q=' + encodeURIComponent(p.pet + ' ' + owner.name);
        } else if (act === 'record') {
          window.location.href = 'medical-records.html?patient=' + encodeURIComponent(p.id);
        } else if (act === 'vaccination') {
          openVaccinationModal();
        } else {
          showToast('Prescriptions are coming soon (prototype)');
        }
      });
    });
  }

  // ------------------------------------------------------------------
  // Add Vaccination modal (reuses existing frontend store function)
  // ------------------------------------------------------------------

  function openVaccinationModal() {
    ['vf-vaccine-name', 'vf-date-given', 'vf-next-due', 'vf-notes'].forEach(function (id) {
      document.getElementById(id).value = '';
    });
    document.getElementById('vaccination-modal-overlay').classList.add('open');
  }
  function closeVaccinationModal() {
    document.getElementById('vaccination-modal-overlay').classList.remove('open');
  }
  function saveVaccination() {
    var name = document.getElementById('vf-vaccine-name').value.trim();
    if (!name) { showToast('Please fill in the vaccine name'); return; }
    D.addVaccination({
      patientId: state.patientId,
      vaccineName: name,
      dateGiven: document.getElementById('vf-date-given').value,
      nextDue: document.getElementById('vf-next-due').value,
      notes: document.getElementById('vf-notes').value.trim()
    });
    closeVaccinationModal();
    showToast('Vaccination added');
    state.tab = 'vaccinations';
    render();
  }

  // ------------------------------------------------------------------
  // init
  // ------------------------------------------------------------------

  // ------------------------------------------------------------------
  // Administrator guard (Phase 5Q). Runs FIRST in the init handler below.
  // Fails closed: a missing helper, a throw, or a falsy result all count
  // as "not signed in as an active Administrator". On failure the browser
  // is sent to the login page and the caller returns before any profile
  // data is read or rendered and before any data listener is registered.
  // ------------------------------------------------------------------
  var LOGIN_PAGE = 'client-login.html';

  function adminGuardPasses() {
    var admin = null;
    try {
      var auth = window.PCClientAuth;
      if (!auth || typeof auth.requireAdminLogin !== 'function') {
        throw new Error('PCClientAuth.requireAdminLogin is not available');
      }
      admin = auth.requireAdminLogin(LOGIN_PAGE);
    } catch (err) {
      admin = null;
    }
    if (admin) return true;
    try { window.location.href = LOGIN_PAGE; } catch (err) { /* nothing more to do */ }
    return false;
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!adminGuardPasses()) return; // must stay the first operation

    var param = new URLSearchParams(window.location.search).get('id');
    var p = findPatient(param);
    state.patientId = p ? p.id : null;

    document.getElementById('vaccination-modal-close').addEventListener('click', closeVaccinationModal);
    document.getElementById('vaccination-modal-cancel').addEventListener('click', closeVaccinationModal);
    document.getElementById('vaccination-modal-save').addEventListener('click', saveVaccination);
    document.getElementById('vaccination-modal-overlay').addEventListener('click', function (e) {
      if (e.target.id === 'vaccination-modal-overlay') closeVaccinationModal();
    });

    // Keep the Patients item highlighted in the shared sidebar.
    var nav = document.querySelector('.nav-item[data-page="patients.html"]');
    if (nav) nav.classList.add('active');

    // Add Record dropdown: outside click / Escape / resize close it.
    document.addEventListener('click', function (e) {
      var m = menuEls();
      if (m.panel && isMenuOpen() && !m.panel.contains(e.target) && !m.toggle.contains(e.target)) closeMenu();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isMenuOpen()) closeMenu(true);
    });
    window.addEventListener('resize', function () { if (isMenuOpen()) positionMenu(); });

    if (D.onChange) D.onChange(function () { if (state.patientId) render(); });
    render();
  });
})();