// ============================================================
// PAWSITIVE CARE — Client Profile page (frontend prototype)
// Reads the selected client from ?id=CL-002 (clinic display ID)
// or a raw client id, using the existing PCData frontend store.
// Read-only: this page never writes to any store.
// Medical Records / Billing rows are demo content only — to be
// replaced by real data in the React rebuild.
// ============================================================

(function () {
  var D = window.PCData;
  var root = document.getElementById('pp-content');
  var PETS_PER_PAGE = 4;
  var state = { clientId: null, tab: 'appointments', petPage: 0 };

  // ------------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------------

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function parseIso(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null;
  }
  function fmtShort(iso) { var p = parseIso(iso); return p ? MONTHS[p.m] + ' ' + p.d + ', ' + p.y : '—'; }
  function fmtLong(iso) { var p = parseIso(iso); return p ? MONTHS_LONG[p.m] + ' ' + p.d + ', ' + p.y : '—'; }

  function isoFromMs(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function isNone(v) { return /^\s*(none|none known|none recorded|n\/a|—|-)?\s*$/i.test(v || ''); }

  // Clinic display IDs: CL-001, CL-002… = position in the client list
  // (the same stable order the Clients page uses to number cards).
  function clientDisplayId(c) {
    var raw = String(c.id || '');
    if (/^CL-\d+$/i.test(raw)) return raw.toUpperCase();
    var idx = D.getClients().findIndex(function (x) { return x.id === c.id; });
    return 'CL-' + String(idx + 1).padStart(3, '0');
  }

  function findClient(param) {
    if (!param) return null;
    var all = D.getClients();
    var byRaw = all.find(function (c) { return c.id === param; });
    if (byRaw) return byRaw;
    var m = /^CL-(\d+)$/i.exec(param.trim());
    if (m) return all[parseInt(m[1], 10) - 1] || null;
    return null;
  }

  // Patient display ID (PT-###) — same numbering Patients/Patient Profile use.
  function patientDisplayId(p) {
    var raw = String(p.id || '');
    if (/^PT-\d+$/i.test(raw)) return raw.toUpperCase();
    var idx = D.getPatients().findIndex(function (x) { return x.id === p.id; });
    return 'PT-' + String(idx + 1).padStart(3, '0');
  }

  function vaxBadgeClass(status) {
    return status === 'Up to date' ? 'status-confirmed'
      : status === 'Overdue' ? 'status-cancelled'
      : status === 'Due soon' ? 'status-pending'
      : 'status-completed';
  }

  function petPhotoStyle(p) {
    var url = p.photo || p.photoUrl || '';
    return url ? ' style="background-image:url(\'' + esc(url) + '\')"' : '';
  }
  function petIcon(p) {
    return (p.photo || p.photoUrl) ? '' : ((D.SPECIES_ICON && D.SPECIES_ICON[p.species]) || '<i class="fa-solid fa-paw"></i>');
  }

  // ------------------------------------------------------------------
  // data for this client
  // ------------------------------------------------------------------

  function petsOf(c) { return D.getPatientsForClient(c); }

  // Demo medical history, generated from the client's real pets.
  function demoMedical(pets) {
    var dateSets = [['2026-09-03', '2026-07-12'], ['2026-08-20', '2026-06-05'], ['2026-08-02', '2026-05-18']];
    var vets = ['Dr. Santos', 'Dr. Reyes'];
    var rows = [];
    pets.forEach(function (p, i) {
      var dates = dateSets[i % dateSets.length];
      rows.push({ date: dates[0], pet: p, dx: 'Annual Vaccination', tx: 'Vaccination', vet: vets[i % 2], kind: 'vaccination', amount: 650 });
      rows.push({
        date: dates[1], pet: p, dx: isNone(p.conditions) ? 'General Check-up' : p.conditions,
        tx: isNone(p.conditions) ? 'Consultation' : 'Treatment', vet: vets[(i + 1) % 2],
        kind: isNone(p.conditions) ? 'consultation' : 'treatment', amount: isNone(p.conditions) ? 500 : 1250
      });
    });
    return rows.sort(function (a, b) { return b.date.localeCompare(a.date); });
  }

  function demoBilling(pets) {
    var rows = demoMedical(pets);
    return rows.map(function (r, i) {
      return {
        date: r.date, ref: 'INV-' + (1042 - i * 23), pet: r.pet, desc: r.dx,
        amount: r.amount, status: (i === rows.length - 1 && rows.length > 2) ? 'Pending' : 'Paid'
      };
    });
  }

  function peso(n) { return '₱' + Number(n).toLocaleString('en-PH'); }

  // ------------------------------------------------------------------
  // render: sections
  // ------------------------------------------------------------------

  function field(icon, label, value) {
    return '<div class="pp-field"><i class="fa-solid ' + icon + '"></i><div>' +
      '<div class="pp-flabel">' + label + '</div><div class="pp-fvalue">' + esc(value || '—') + '</div></div></div>';
  }

  function headerHtml(c) {
    var active = c.status === 'active';
    return '<section class="pp-panel pp-header">' +
      '<div class="pp-identity">' +
        '<div class="pp-photo" aria-hidden="true"><i class="fa-solid fa-user"></i></div>' +
        '<div class="pp-id-text">' +
          '<div class="pp-name-row"><span class="pp-name">' + esc(c.name) + '</span></div>' +
          '<div class="pp-badges"><span class="pp-pid">' + esc(clientDisplayId(c)) + '</span>' +
          '<span class="status-badge status-' + (active ? 'active' : 'inactive') + '">' + (active ? 'Active' : 'Inactive') + '</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="pp-actions">' +
        '<button class="btn btn-primary btn-sm" data-act="book"><i class="fa-solid fa-calendar-plus"></i> Book Appointment</button>' +
        '<button class="btn btn-primary btn-sm" data-act="add-pet"><i class="fa-solid fa-plus"></i> Add Pet</button>' +
      '</div>' +
    '</section>';
  }

  function detailsHtml(c) {
    return '<section class="pp-panel"><div class="pp-panel-title"><i class="fa-solid fa-address-card"></i> Client Details</div>' +
      '<div class="cl-details">' +
        '<div class="cl-col">' + field('fa-user', 'Full Name', c.name) + field('fa-phone', 'Contact Number', c.phone) + '</div>' +
        '<div class="cl-col">' + field('fa-envelope', 'Email Address', c.email) + field('fa-house', 'Home Address', c.address) + '</div>' +
        '<div class="cl-col">' + field('fa-calendar', 'Registration Date', fmtLong(isoFromMs(c.createdAt))) +
          field('fa-phone-volume', 'Emergency Contact', c.emergencyContact) + '</div>' +
      '</div>' +
    '</section>';
  }

  function petsHtml(c) {
    var pets = petsOf(c);
    var pages = Math.max(1, Math.ceil(pets.length / PETS_PER_PAGE));
    state.petPage = Math.min(Math.max(state.petPage, 0), pages - 1);
    var shown = pets.slice(state.petPage * PETS_PER_PAGE, (state.petPage + 1) * PETS_PER_PAGE);
    var cards = !pets.length
      ? '<div class="cl-pets-empty">No pets registered under this client yet.</div>'
      : shown.map(function (p) {
          return '<div class="cl-pet">' +
            '<div class="cl-pet-photo"' + petPhotoStyle(p) + ' aria-hidden="true">' + petIcon(p) + '</div>' +
            '<div class="cl-pet-body">' +
              '<div class="cl-pet-head">' +
                '<div class="cl-pet-name">' + esc(p.pet) + '</div>' +
                '<span class="cl-pet-tag">' + esc(p.species) + '</span>' +
              '</div>' +
              '<div class="cl-pet-line">Breed: <b>' + esc(p.breed || '—') + '</b></div>' +
              '<div class="cl-pet-line">Age: <b>' + esc(D.calcAge(p.dob)) + '</b></div>' +
              '<div class="cl-pet-line cl-pet-gender">' +
                '<span>Gender: <b>' + esc(p.sex || '—') + '</b></span>' +
                '<a class="btn btn-primary btn-sm cl-pet-btn" href="patient-profile.html?id=' + encodeURIComponent(patientDisplayId(p)) + '"><i class="fa-solid fa-id-card"></i> View Pet Profile</a>' +
              '</div>' +
            '</div>' +
          '</div>';
        }).join('');
    var pager = pages > 1
      ? '<div class="cl-pager" role="navigation" aria-label="Registered pets pages">' +
          '<button type="button" class="btn btn-sm btn-plain" data-pet-page="-1"' + (state.petPage === 0 ? ' disabled' : '') + '><i class="fa-solid fa-chevron-left"></i> Previous</button>' +
          '<span class="cl-pager-info" aria-live="polite">' + (state.petPage + 1) + ' / ' + pages + '</span>' +
          '<button type="button" class="btn btn-sm btn-plain" data-pet-page="1"' + (state.petPage >= pages - 1 ? ' disabled' : '') + '>Next <i class="fa-solid fa-chevron-right"></i></button>' +
        '</div>'
      : '';
    return '<div class="pp-section-title">REGISTERED PETS</div><div class="cl-pets">' + cards + '</div>' + pager;
  }

  var TABS = [
    { id: 'appointments', label: 'Appointments', icon: 'fa-calendar-days' },
    { id: 'medical', label: 'Medical Records', icon: 'fa-file-medical' },
    { id: 'vaccinations', label: 'Vaccinations', icon: 'fa-shield-halved' },
    { id: 'billing', label: 'Billing History', icon: 'fa-receipt' }
  ];

  function tabsHtml() {
    return '<div class="pp-tabs" role="tablist" aria-label="Client history">' + TABS.map(function (t) {
      return '<button class="pp-tab' + (t.id === state.tab ? ' active' : '') + '" role="tab" aria-selected="' + (t.id === state.tab) + '" data-tab="' + t.id + '">' +
        '<i class="fa-solid ' + t.icon + '"></i>' + t.label + '</button>';
    }).join('') + '</div>';
  }

  function table(headers, rowsHtml) {
    return '<div class="pp-table-wrap"><table class="pp-table stackable"><thead><tr>' +
      headers.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>';
  }
  function cell(label, html) { return '<td data-label="' + label + '">' + html + '</td>'; }

  function petCell(p) {
    return '<span class="cl-petcell"><span class="cl-petdot"' + petPhotoStyle(p) + '>' + petIcon(p) + '</span>' + esc(p.pet) + '</span>';
  }

  function petByName(pets, name) {
    var n = (name || '').trim().toLowerCase();
    return pets.filter(function (p) { return (p.pet || '').trim().toLowerCase() === n; })[0] || { pet: name || '—', species: 'Other' };
  }

  function appointmentsHtml(c) {
    var pets = petsOf(c);
    var history = D.getAppointmentsForClient(c).slice(0, 10);
    if (!history.length) return '<div class="pp-empty">No appointment history yet.</div>';
    var rows = history.map(function (a) {
      var label = (D.STATUS_LABELS && D.STATUS_LABELS[a.status]) || a.status;
      return '<tr>' + cell('Date', fmtShort(a.date)) + cell('Pet', petCell(petByName(pets, a.pet))) +
        cell('Service', esc(a.reason || 'General visit')) +
        cell('Status', '<span class="status-badge status-' + esc(a.status) + '">' + esc(label) + '</span>') + '</tr>';
    }).join('');
    return table(['Date', 'Pet', 'Service', 'Status'], rows);
  }

  function medicalHtml(c) {
    var recs = demoMedical(petsOf(c));
    if (!recs.length) return '<div class="pp-empty">No medical records yet.</div>';
    var rows = recs.map(function (r) {
      return '<tr>' + cell('Date', fmtShort(r.date)) + cell('Pet', petCell(r.pet)) + cell('Diagnosis', esc(r.dx)) +
        cell('Treatment', esc(r.tx)) + cell('Veterinarian', esc(r.vet)) + '</tr>';
    }).join('');
    return table(['Date', 'Pet', 'Diagnosis', 'Treatment', 'Veterinarian'], rows);
  }

  function vaccinationsHtml(c) {
    var pets = petsOf(c);
    if (!pets.length) return '<div class="pp-empty">No vaccination records yet.</div>';
    var rows = '';
    pets.forEach(function (p) {
      var recs = D.getVaccinationsForPatientId(p.id);
      if (recs.length) {
        recs.forEach(function (v) {
          var st = D.computeVaccinationStatus(v.nextDue);
          rows += '<tr>' + cell('Pet', petCell(p)) + cell('Vaccine', esc(v.vaccineName || 'Vaccine')) + cell('Date Given', fmtShort(v.dateGiven)) +
            cell('Next Due', fmtShort(v.nextDue)) + cell('Status', '<span class="status-badge ' + vaxBadgeClass(st) + '">' + esc(st) + '</span>') + '</tr>';
        });
      } else {
        var gs = p.vaccinationStatus || 'Unknown';
        rows += '<tr>' + cell('Pet', petCell(p)) + cell('Vaccine', 'General status on file') + cell('Date Given', '—') +
          cell('Next Due', '—') + cell('Status', '<span class="status-badge ' + vaxBadgeClass(gs) + '">' + esc(gs) + '</span>') + '</tr>';
      }
    });
    return table(['Pet', 'Vaccine', 'Date Given', 'Next Due', 'Status'], rows);
  }

  function billingHtml(c) {
    var bills = demoBilling(petsOf(c));
    if (!bills.length) return '<div class="pp-empty">No billing history yet.</div>';
    var rows = bills.map(function (b) {
      var cls = b.status === 'Paid' ? 'status-confirmed' : 'status-pending';
      return '<tr>' + cell('Date', fmtShort(b.date)) + cell('Invoice', esc(b.ref)) + cell('Pet', petCell(b.pet)) +
        cell('Description', esc(b.desc)) + cell('Amount', peso(b.amount)) +
        cell('Status', '<span class="status-badge ' + cls + '">' + b.status + '</span>') + '</tr>';
    }).join('');
    return table(['Date', 'Invoice', 'Pet', 'Description', 'Amount', 'Status'], rows);
  }

  function sectionContent(c) {
    switch (state.tab) {
      case 'medical': return medicalHtml(c);
      case 'vaccinations': return vaccinationsHtml(c);
      case 'billing': return billingHtml(c);
      default: return appointmentsHtml(c);
    }
  }

  // Recent Activity: real completed appointments + the demo clinical /
  // billing events, newest first.
  function toneFor(text) {
    return /vaccin/i.test(text) ? 'vaccination'
      : /treat|ear|skin|infect|limp|dental/i.test(text) ? 'treatment'
      : /consult|check/i.test(text) ? 'consultation' : 'other';
  }
  var TAGS = { vaccination: 'Vaccination', treatment: 'Treatment', consultation: 'Consultation', other: 'Billing' };

  function activityItems(c) {
    var pets = petsOf(c);
    var items = [];
    D.getAppointmentsForClient(c).filter(function (a) { return a.status === 'completed'; }).slice(0, 4).forEach(function (a) {
      var reason = a.reason || 'General visit';
      var tone = toneFor(reason);
      items.push({ date: a.date, text: a.pet + ' — ' + reason + ' completed', tone: tone, tag: TAGS[tone] === 'Billing' ? 'Visit' : TAGS[tone] });
    });
    demoMedical(pets).slice(0, 4).forEach(function (r, i) {
      if (r.kind === 'vaccination') {
        items.push({ date: r.date, text: r.pet.pet + ' received ' + r.dx, tone: 'vaccination', tag: 'Vaccination' });
        items.push({ date: r.date, text: 'Invoice paid for ' + r.pet.pet + ' — ' + r.dx, tone: 'other', tag: 'Invoice Paid' });
      } else {
        items.push({ date: r.date, text: r.pet.pet + ' ' + r.dx.toLowerCase() + ' completed', tone: r.kind, tag: TAGS[r.kind] });
      }
    });
    items.sort(function (a, b) { return b.date.localeCompare(a.date); });
    return items.slice(0, 4);
  }

  function activityHtml(c) {
    var items = activityItems(c);
    var body = items.length ? items.map(function (r) {
      return '<div class="pp-tl-item tone-' + r.tone + '-dot"><span class="pp-tl-dot"></span>' +
        '<div class="pp-tl-date">' + fmtLong(r.date) + '</div>' +
        '<div class="pp-tl-text">' + esc(r.text) + '</div>' +
        '<span class="pp-tag tone-' + r.tone + '">' + esc(r.tag) + '</span></div>';
    }).join('') : '<div class="pp-empty">No recent activity yet.</div>';
    return '<aside class="pp-panel"><div class="pp-panel-title"><i class="fa-solid fa-clock-rotate-left"></i> Recent Activity</div>' +
      '<div class="pp-timeline">' + body + '</div></aside>';
  }

  function mainHtml(c) {
    var cur = TABS.filter(function (t) { return t.id === state.tab; })[0];
    return '<section class="pp-panel"><div class="pp-panel-title"><i class="fa-solid ' + cur.icon + '"></i> ' + cur.label + '</div>' +
      sectionContent(c) + '</section>' + activityHtml(c);
  }

  // ------------------------------------------------------------------
  // render: page
  // ------------------------------------------------------------------

  function renderMissing() {
    root.innerHTML = '<div class="pp-panel pp-missing"><h2>Client not found</h2>' +
      '<p>We couldn\'t find a client for this link.</p>' +
      '<a class="btn btn-primary" href="clients.html"><i class="fa-solid fa-arrow-left"></i> Back to Clients</a></div>';
  }

  function renderMain() {
    var c = D.getClientById(state.clientId);
    if (!c) return;
    document.getElementById('pp-main').innerHTML = mainHtml(c);
    document.getElementById('pp-tabs-host').innerHTML = tabsHtml();
    wireTabs();
  }

  function render() {
    var c = D.getClientById(state.clientId);
    if (!c) { renderMissing(); return; }
    document.title = c.name + ' · Client Profile · Pawsitive Care';
    root.innerHTML =
      headerHtml(c) + detailsHtml(c) + '<div id="cl-pets-host">' + petsHtml(c) + '</div>' +
      '<div id="pp-tabs-host">' + tabsHtml() + '</div>' +
      '<div class="pp-main" id="pp-main">' + mainHtml(c) + '</div>';
    wire(c);
  }

  function wireTabs() {
    root.querySelectorAll('[data-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () { state.tab = btn.getAttribute('data-tab'); renderMain(); });
    });
  }

  function wirePets(c) {
    root.querySelectorAll('[data-pet-page]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.petPage += parseInt(btn.getAttribute('data-pet-page'), 10);
        document.getElementById('cl-pets-host').innerHTML = petsHtml(c);
        wirePets(c);
      });
    });
  }

  function wire(c) {
    wireTabs();
    wirePets(c);
    root.querySelectorAll('[data-act]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var act = btn.getAttribute('data-act');
        if (act === 'add-pet') {
          window.location.href = 'patients.html';
        } else if (act === 'book') {
          window.location.href = 'appointments.html?q=' + encodeURIComponent(c.name);
        }
      });
    });
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

    var c = findClient(new URLSearchParams(window.location.search).get('id'));
    state.clientId = c ? c.id : null;

    // Keep the Clients item highlighted in the shared sidebar.
    var nav = document.querySelector('.nav-item[data-page="clients.html"]');
    if (nav) nav.classList.add('active');

    if (D.onChange) D.onChange(function () { if (state.clientId) render(); });
    render();
  });
})();