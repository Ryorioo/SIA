// ============================================================
// PAWSITIVE CARE — Medical Records page logic
// ============================================================

(function () {
  var D = window.PCData;

  var state = {
    search: '',
    filterDate: '',
    filterVet: '',
    filterType: '',
    filterStatus: '',
    page: 1,           // current Medical History page (1-based)
    patientId: null,   // set when opened as medical-records.html?patient=<id>
    appointmentId: null, // set when opened as medical-records.html?appointment=<id> (e.g. linked from a completed queue consultation)
    editingId: null,
    viewingId: null
  };

  // ------------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------------

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function showToast(msg) {
    var toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toast.classList.remove('show'); }, 2200);
  }

  function formatDateShort(iso) {
    if (!iso) return '—';
    var d = D.parseDate(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function matchesFilters(r) {
    var q = state.search.trim().toLowerCase();
    if (q) {
      var hay = (r.pet + ' ' + r.owner + ' ' + r.vet + ' ' + r.diagnosis + ' ' + r.treatment).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    if (state.filterDate && r.date !== state.filterDate) return false;
    if (state.filterVet && r.vet !== state.filterVet) return false;
    if (state.filterType && r.visitType !== state.filterType) return false;
    if (state.filterStatus && r.status !== state.filterStatus) return false;
    return true;
  }

  function badge(status) {
    var cls = D.MED_STATUS_BADGE_CLASS[status] || 'status-completed';
    var label = D.MED_STATUS_LABELS[status] || status;
    return '<span class="status-badge ' + cls + '">' + esc(label) + '</span>';
  }

  // Resolve the real Client behind a Patient (Medical Record -> Patient -> Client),
  // so owner name/contact always come from the Client record instead of being
  // manually entered or trusted from a possibly-stale copy. Patients added before
  // clientId existed (or otherwise unlinked) fall back to matching by owner name —
  // the same convention data-store.js already uses for getPatientsForClient().
  function resolveOwner(patient) {
    if (!patient) return { name: '', phone: '' };
    var client = patient.clientId ? D.getClientById(patient.clientId) : null;
    if (!client) {
      var name = (patient.owner || '').trim().toLowerCase();
      if (name) {
        client = D.getClients().find(function (c) { return (c.name || '').trim().toLowerCase() === name; }) || null;
      }
    }
    return {
      name: (client && client.name) || patient.owner || '',
      phone: (client && client.phone) || patient.ownerPhone || ''
    };
  }

  // ------------------------------------------------------------------
  // static option lists (filters + form selects)
  // ------------------------------------------------------------------

  function fillStaticOptions() {
    var vetFilter = document.getElementById('filter-vet');
    D.VETS.forEach(function (v) {
      vetFilter.appendChild(new Option(v, v));
    });

    var typeFilter = document.getElementById('filter-type');
    D.MED_VISIT_TYPES.forEach(function (t) {
      typeFilter.appendChild(new Option(t, t));
    });

    var statusFilter = document.getElementById('filter-status');
    D.MED_STATUSES.forEach(function (s) {
      statusFilter.appendChild(new Option(D.MED_STATUS_LABELS[s], s));
    });

    var fVet = document.getElementById('f-vet');
    D.VETS.forEach(function (v) { fVet.appendChild(new Option(v, v)); });

    var fStatus = document.getElementById('f-status');
    D.MED_STATUSES.forEach(function (s) { fStatus.appendChild(new Option(D.MED_STATUS_LABELS[s], s)); });

    var typeSuggestions = document.getElementById('type-suggestions');
    typeSuggestions.innerHTML = D.MED_VISIT_TYPES.map(function (t) { return '<option value="' + esc(t) + '"></option>'; }).join('');
  }

  function fillPatientSelect(selectedId) {
    var sel = document.getElementById('f-patient');
    var patients = D.getPatients().slice().sort(function (a, b) { return a.pet.localeCompare(b.pet); });
    sel.innerHTML = '<option value="">Select a patient…</option>' + patients.map(function (p) {
      return '<option value="' + p.id + '">' + esc(p.pet) + ' — ' + esc(resolveOwner(p).name) + '</option>';
    }).join('');
    if (selectedId) sel.value = selectedId;
  }

  // ------------------------------------------------------------------
  // patient context bar (medical-records.html?patient=<id>)
  // ------------------------------------------------------------------

  function renderPatientContext() {
    var el = document.getElementById('patient-context');
    if (!state.patientId) { el.innerHTML = ''; return; }
    var patient = D.getPatientById(state.patientId);
    if (!patient) { state.patientId = null; el.innerHTML = ''; return; }

    var linkedAppt = state.appointmentId && D.getById ? D.getById(state.appointmentId) : null;
    var linkedNote = linkedAppt ? ' — new records will link to the ' + esc(formatDateShort(linkedAppt.date)) + ' appointment' : '';

    el.innerHTML =
      '<div class="patient-context-bar">' +
        '<div class="patient-context-left">' +
          '<div class="patient-context-text">' +
            '<div class="patient-context-title">Showing medical records for <b>' + esc(patient.pet) + '</b></div>' +
            '<div class="patient-context-sub">Owner: ' + esc(resolveOwner(patient).name || '—') + linkedNote + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="patient-context-actions">' +
          '<a class="btn btn-sm" href="patients.html?open=' + encodeURIComponent(patient.id) + '"><i class="fa-solid fa-user"></i> View Patient Profile</a>' +
          '<button class="patient-context-close" id="clear-patient-context" title="Show all records" aria-label="Show all records"><i class="fa-solid fa-xmark"></i></button>' +
        '</div>' +
      '</div>';

    document.getElementById('clear-patient-context').addEventListener('click', function () {
      state.patientId = null;
      state.appointmentId = null;
      state.page = 1;
      history.replaceState(null, '', 'medical-records.html');
      renderAll();
    });
  }

  // Switches the page into single-patient mode (reuses the same
  // state.patientId scoping that renderPatientContext/renderList already
  // apply) — the "View History" action on a Recent Patients card.
  function viewPatientHistory(patientId) {
    state.patientId = patientId;
    state.appointmentId = null;
    state.page = 1;
    history.replaceState(null, '', 'medical-records.html?patient=' + encodeURIComponent(patientId));
    renderAll();
  }

  // ------------------------------------------------------------------
  // RECENT PATIENTS (quick-access cards above the timeline)
  // ------------------------------------------------------------------

  function renderRecentPatients() {
    var container = document.getElementById('recent-patients');
    // Redundant once a single patient's history is already being shown
    // via the patient-context bar, so hide it in that mode.
    if (state.patientId) { container.innerHTML = ''; return; }

    var all = D.getMedicalRecords();

    // Group real records by patientId to find each linked patient's most
    // recent visit date and total record count — no invented/demo data,
    // just an aggregation of what's already in the store.
    var byPatient = {};
    all.forEach(function (r) {
      if (!r.patientId) return;
      var entry = byPatient[r.patientId] || (byPatient[r.patientId] = { count: 0, lastDate: '' });
      entry.count++;
      if (!entry.lastDate || (r.date || '') > entry.lastDate) entry.lastDate = r.date;
    });

    var recentIds = Object.keys(byPatient)
      .sort(function (a, b) { return byPatient[b].lastDate.localeCompare(byPatient[a].lastDate); })
      .slice(0, 6);

    if (!recentIds.length) { container.innerHTML = ''; return; }

    // Clean display-only Patient IDs (PT-001 style) — the same helper the
    // Medical History cards use; the raw id is never shown.
    var displayIds = patientDisplayIds();

    var cardsHtml = recentIds.map(function (pid) {
      var patient = D.getPatientById(pid);
      if (!patient) return '';
      var displayId = displayIds[patient.id] || '';
      var owner = resolveOwner(patient);
      var info = byPatient[pid];
      var avatarHtml = patient.photo ? '<img src="' + esc(patient.photo) + '" alt="">' : '';
      return (
        '<div class="mr-patient-card">' +
          '<div class="mr-pc-identity-row">' +
            '<div class="mr-pc-avatar">' + avatarHtml + '</div>' +
            '<div class="mr-pc-identity">' +
              (displayId ? '<span class="mr-pc-id">' + esc(displayId) + '</span>' : '') +
              '<span class="mr-pc-name">' + esc(patient.pet) + '</span>' +
              '<span class="mr-pc-breed">' + esc(patient.breed || '—') + '</span>' +
            '</div>' +
          '</div>' +
          '<hr class="mr-pc-hr">' +
          '<div class="mr-pc-meta">' +
            '<div class="mr-pc-col">' +
              '<span class="mr-pc-label"><i class="fa-solid fa-user"></i>Owner</span>' +
              '<span class="mr-pc-value">' + esc(owner.name || '—') + '</span>' +
            '</div>' +
            '<div class="mr-pc-col">' +
              '<span class="mr-pc-label"><i class="fa-solid fa-calendar-days"></i>Last Visit</span>' +
              '<span class="mr-pc-value">' + formatDateShort(info.lastDate) + '</span>' +
            '</div>' +
          '</div>' +
          '<hr class="mr-pc-hr">' +
          '<div class="mr-pc-action">' +
            '<span class="mr-pc-count"><i class="fa-solid fa-notes-medical"></i> <b>' + info.count + '</b> medical record' + (info.count === 1 ? '' : 's') + '</span>' +
            '<button class="btn btn-primary btn-sm" data-view-history="' + patient.id + '"><i class="fa-solid fa-clock-rotate-left"></i> View History</button>' +
          '</div>' +
        '</div>'
      );
    }).filter(Boolean).join('');

    if (!cardsHtml) { container.innerHTML = ''; return; }

    container.innerHTML =
      '<div class="mr-recent-patients">' +
        '<div class="mr-section-heading"><i class="fa-solid fa-star"></i> Recent Patients</div>' +
        '<div class="mr-patient-cards">' + cardsHtml + '</div>' +
      '</div>';

    container.querySelectorAll('[data-view-history]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        viewPatientHistory(btn.getAttribute('data-view-history'));
      });
    });
  }

  // ------------------------------------------------------------------
  // LIST VIEW
  // ------------------------------------------------------------------

  // Patient ID as shown in the UI (PT-001 style). DISPLAY ONLY: the raw
  // database id (e.g. pt_mtk5m7fb_2u287y) stays on the patient record and is
  // still what every lookup / data-id / link uses; nothing here is written back.
  //   1. If the patient already carries a clean PT-### value in any string field
  //      (seed data, or a stored display code), that value is used as-is.
  //   2. Otherwise it's the patient's position in the patient list, zero-padded
  //      (1st -> PT-001). Stable while the list is unchanged.
  // Built once per render as { rawId: 'PT-###' }.
  function patientDisplayIds() {
    var map = {};
    D.getPatients().forEach(function (p, i) {
      var stored = '';
      Object.keys(p).some(function (k) {
        var v = p[k];
        if (typeof v === 'string' && /^PT-\d+$/i.test(v.trim())) { stored = v.trim().toUpperCase(); return true; }
        return false;
      });
      var n = String(i + 1);
      while (n.length < 3) n = '0' + n;
      map[p.id] = stored || 'PT-' + n;
    });
    return map;
  }

  // Patient age for the card's meta line. The patient store's schema isn't
  // defined anywhere in this file, so this reads whichever age-like field the
  // record actually carries — a stored age (age / ageYears / petAge) or, failing
  // that, a birth date (dob / birthdate / dateOfBirth / birthday) it computes the
  // age from. Nothing is assumed or invented: if neither exists, returns ''
  // and the age is simply left out of the line.
  function patientAgeText(patient) {
    if (!patient) return '';
    var ageKey = null, dobKey = null;
    Object.keys(patient).forEach(function (k) {
      var n = k.toLowerCase().replace(/[\s_-]/g, '');
      if (!ageKey && (n === 'age' || n === 'ageyears' || n === 'petage')) ageKey = k;
      if (!dobKey && (n === 'dob' || n === 'birthdate' || n === 'dateofbirth' || n === 'birthday')) dobKey = k;
    });

    var age = ageKey && patient[ageKey] != null ? String(patient[ageKey]).trim() : '';
    if (age) return /^\d+(\.\d+)?$/.test(age) ? age + (Number(age) === 1 ? ' yr' : ' yrs') : age;

    if (dobKey && patient[dobKey]) {
      var born = D.parseDate(patient[dobKey]);
      if (!isNaN(born.getTime())) {
        var now = new Date();
        var months = (now.getFullYear() - born.getFullYear()) * 12 + (now.getMonth() - born.getMonth()) -
                     (now.getDate() < born.getDate() ? 1 : 0);
        if (months < 0) return '';
        if (months < 12) return months + (months === 1 ? ' mo' : ' mos');
        var yrs = Math.floor(months / 12);
        return yrs + (yrs === 1 ? ' yr' : ' yrs');
      }
    }
    return '';
  }

  // "Cat · 3 yrs · 3.9 kg" — species, age and weight, skipping any part that
  // isn't on file. Weight prefers the value recorded at that visit (r.weight,
  // the same field the View Record modal shows) and falls back to the
  // patient's own weight. Bare numbers get their unit appended; values that
  // already carry a unit are shown as entered.
  function patientMetaLine(patient, r) {
    var parts = [];
    if (patient && patient.species) parts.push(patient.species);

    var age = patientAgeText(patient);
    if (age) parts.push(age);

    var w = r && r.weight != null && String(r.weight).trim() !== '' ? r.weight
          : (patient && patient.weight != null ? patient.weight : '');
    w = String(w).trim();
    if (w) parts.push(/^\d+(\.\d+)?$/.test(w) ? w + ' kg' : w);

    return parts.join(' · ');
  }

  // Recent Patients is a default/discovery section: hidden while a search
  // term or any filter is active (the same state matchesFilters() reads),
  // shown again once they're all cleared. Only toggles the existing
  // #recent-patients container — its markup isn't rebuilt here — and a
  // hidden container leaves no gap, so Medical History moves up. Runs from
  // renderList(), which every search/filter/clear path already calls.
  function syncRecentPatientsVisibility() {
    var container = document.getElementById('recent-patients');
    if (!container) return;
    container.hidden = !!(state.search.trim() || state.filterDate || state.filterVet || state.filterType || state.filterStatus);
  }

  // Medical History pagination (mirrors Inventory Items). The list is
  // filtered, sorted newest-first (on a filtered copy) and sliced into pages
  // of PAGE_SIZE. This is a DISPLAY limit only: every matching record stays
  // reachable through the pager, and stored records are never trimmed,
  // deleted or modified.
  var PAGE_SIZE = 5;
  var lastPagerSig = '';

  // Page numbers to show: all of them up to 7 pages, otherwise first/last,
  // the current page and its neighbours, with '…' for the gaps.
  function pageList(cur, total) {
    if (total <= 7) {
      var all = [];
      for (var n = 1; n <= total; n++) all.push(n);
      return all;
    }
    if (cur <= 4) return [1, 2, 3, 4, 5, '…', total];
    if (cur >= total - 3) return [1, '…', total - 4, total - 3, total - 2, total - 1, total];
    return [1, '…', cur - 1, cur, cur + 1, '…', total];
  }

  function pageButtons(cur, total) {
    return pageList(cur, total).map(function (p) {
      if (p === '…') return '<span class="mr-ellipsis" aria-hidden="true">…</span>';
      var active = p === cur;
      return '<button type="button" class="btn btn-sm mr-page' + (active ? ' btn-primary' : '') + '" data-page="' + p + '"' +
        (active ? ' aria-current="page"' : '') + ' aria-label="Page ' + p + '">' + p + '</button>';
    }).join('');
  }

  // The pager is rebuilt on every page change, so put keyboard focus back on
  // the current page number if the clicked control was replaced or disabled.
  function keepPagerFocus() {
    var pager = document.getElementById('mr-pager');
    if (pager.contains(document.activeElement) && !document.activeElement.disabled) return;
    var cur = document.getElementById('mr-pages').querySelector('[aria-current="page"]');
    if (cur) cur.focus();
  }

  // Footer: "Showing 1–5 of 11 records" on the left; Previous / numbers / Next
  // on the right. Pager is hidden when nothing matches or everything fits on
  // one page (same as Inventory Items).
  function renderFooter(total, start, shownCount, pages) {
    var countText = !total ? 'No records to show' :
      'Showing ' + (shownCount === total ? total : shownCount === 1 ? (start + 1) : (start + 1) + '\u2013' + (start + shownCount)) +
      ' of ' + total + (total === 1 ? ' record' : ' records');
    document.getElementById('mr-count').textContent = countText;

    var pager = document.getElementById('mr-pager');
    pager.hidden = !total || pages <= 1;
    // Only rebuild the number buttons when something changed (PCData.onChange
    // can fire repeatedly) so keyboard focus isn't dropped needlessly.
    var sig = state.page + '/' + pages;
    if (sig !== lastPagerSig || !document.getElementById('mr-pages').children.length) {
      lastPagerSig = sig;
      document.getElementById('mr-pages').innerHTML = pageButtons(state.page, pages);
    }
    document.getElementById('mr-prev').disabled = state.page <= 1;
    document.getElementById('mr-next').disabled = state.page >= pages;
  }

  function renderList() {
    syncRecentPatientsVisibility();
    var root = document.getElementById('view-root');
    var all = D.getMedicalRecords();
    var scoped = state.patientId ? all.filter(function (r) { return r.patientId === state.patientId; }) : all;
    var filtered = scoped.filter(matchesFilters);

    if (!filtered.length) {
      state.page = 1;
      root.innerHTML = '<div class="mr-table-wrap"><div class="no-results">No medical records match your search or filters.</div></div>';
      renderFooter(0, 0, 0, 1);
      return;
    }

    filtered.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });

    var pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (state.page > pages) state.page = pages;   // e.g. after records were removed elsewhere
    if (state.page < 1) state.page = 1;
    var start = (state.page - 1) * PAGE_SIZE;
    var shown = filtered.slice(start, start + PAGE_SIZE);
    renderFooter(filtered.length, start, shown.length, pages);

    var displayIds = patientDisplayIds();

    var html = '<div class="mr-timeline">' + shown.map(function (r) {
      var patient = r.patientId ? D.getPatientById(r.patientId) : null;
      var avatarHtml = patient && patient.photo ? '<img src="' + esc(patient.photo) + '" alt="">' : '';
      var metaLine = patientMetaLine(patient, r);
      var visitDate = formatDateShort(r.date);
      var displayId = patient ? (displayIds[patient.id] || '') : '';
      var d = D.parseDate(r.date);
      var dayNum = isNaN(d.getTime()) ? '—' : d.getDate();
      var monthYear = isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
      return (
        '<div class="mr-timeline-item">' +
          '<div class="mr-timeline-date-col"><div class="mtd-day">' + dayNum + '</div><div class="mtd-month">' + monthYear + '</div></div>' +
          '<div class="mr-timeline-rail"><span class="mr-timeline-dot"></span><span class="mr-timeline-line"></span></div>' +
          '<div class="mr-timeline-content">' +
            '<div class="mh-card">' +
              // PATIENT
              '<div class="mh-area mh-patient">' +
                '<div class="mh-avatar">' + avatarHtml + '</div>' +
                '<div class="mh-patient-text">' +
                  (displayId ? '<span class="mh-pid">' + esc(displayId) + '</span>' : '') +
                  '<span class="mh-pname">' + esc(r.pet) + '</span>' +
                  (metaLine ? '<span class="mh-pmeta">' + esc(metaLine) + '</span>' : '') +
                '</div>' +
              '</div>' +
              // VISIT (its date is contextual info; the timeline date column is separate and untouched)
              '<div class="mh-area mh-visit">' +
                '<span class="mh-visit-type">' + esc(r.visitType) + '</span>' +
                '<span class="mh-visit-vet"><i class="fa-solid fa-user-doctor"></i><span>' + esc(r.vet) + '</span></span>' +
                (visitDate !== '—' ? '<span class="mh-visit-date"><i class="fa-solid fa-calendar-days"></i><span>' + esc(visitDate) + '</span></span>' : '') +
              '</div>' +
              // CLINICAL — status top-right, diagnosis/treatment, actions bottom-right
              '<div class="mh-area mh-clinical">' +
                '<div class="mh-status">' + badge(r.status) + '</div>' +
                '<div class="mh-clinical-fields">' +
                  '<div class="profile-field"><span class="pf-label">Diagnosis</span><span class="pf-value">' + esc(r.diagnosis || '—') + '</span></div>' +
                  '<div class="profile-field"><span class="pf-label">Treatment</span><span class="pf-value">' + esc(r.treatment || '—') + '</span></div>' +
                '</div>' +
                '<div class="mh-actions">' +
                  '<button class="icon-btn" data-action="edit" data-id="' + r.id + '" title="Edit record"><i class="fa-solid fa-pen"></i></button>' +
                  '<button class="btn btn-sm btn-primary" data-action="view" data-id="' + r.id + '"><i class="fa-solid fa-eye"></i> View Record</button>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join('') + '</div>';

    root.innerHTML = html;

    root.querySelectorAll('[data-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-id');
        var action = btn.getAttribute('data-action');
        if (action === 'view') openView(id);
        if (action === 'edit') openModal(id);
      });
    });
  }

  // ------------------------------------------------------------------
  // ADD / EDIT MODAL
  // ------------------------------------------------------------------

  function updateOwnerFromPatient() {
    var patientId = document.getElementById('f-patient').value;
    var patient = patientId ? D.getPatientById(patientId) : null;
    document.getElementById('f-owner').value = patient ? resolveOwner(patient).name : '';
  }

  function openModal(id) {
    state.editingId = id || null;
    var r = id ? D.getMedRecordById(id) : null;

    fillPatientSelect(r ? r.patientId : state.patientId);
    updateOwnerFromPatient();

    document.getElementById('modal-title').textContent = r ? 'Edit Medical Record' : 'Add Medical Record';
    document.getElementById('f-date').value = r ? r.date : D.todayStr();
    document.getElementById('f-vet').value = r ? r.vet : D.VETS[0];
    document.getElementById('f-type').value = r ? r.visitType : '';
    document.getElementById('f-status').value = r ? r.status : 'completed';
    document.getElementById('f-complaint').value = r ? r.chiefComplaint : '';
    document.getElementById('f-symptoms').value = r ? r.symptoms : '';
    document.getElementById('f-exam').value = r ? r.examFindings : '';
    document.getElementById('f-diagnosis').value = r ? r.diagnosis : '';
    document.getElementById('f-treatment').value = r ? r.treatment : '';
    document.getElementById('f-prescription').value = r ? r.prescription : '';
    document.getElementById('f-vaccination').value = r ? r.vaccination : '';
    document.getElementById('f-weight').value = r ? r.weight : '';
    document.getElementById('f-followup').value = r ? r.followUpDate : '';
    document.getElementById('f-notes').value = r ? r.vetNotes : '';

    document.getElementById('modal-overlay').classList.add('open');
  }

  function closeModal() {
    document.getElementById('modal-overlay').classList.remove('open');
    state.editingId = null;
  }

  function saveModal() {
    var patientId = document.getElementById('f-patient').value;
    var patient = patientId ? D.getPatientById(patientId) : null;
    var visitType = document.getElementById('f-type').value.trim();
    var date = document.getElementById('f-date').value;

    if (!patient) {
      showToast('Please select a pet / patient');
      return;
    }
    if (!date) {
      showToast('Please set the record date');
      return;
    }
    if (!visitType) {
      showToast('Please enter a visit type / service');
      return;
    }

    var fields = {
      patientId: patient.id,
      pet: patient.pet,
      owner: resolveOwner(patient).name,
      date: date,
      vet: document.getElementById('f-vet').value,
      visitType: visitType,
      status: document.getElementById('f-status').value,
      chiefComplaint: document.getElementById('f-complaint').value.trim(),
      symptoms: document.getElementById('f-symptoms').value.trim(),
      examFindings: document.getElementById('f-exam').value.trim(),
      diagnosis: document.getElementById('f-diagnosis').value.trim(),
      treatment: document.getElementById('f-treatment').value.trim(),
      prescription: document.getElementById('f-prescription').value.trim(),
      vaccination: document.getElementById('f-vaccination').value.trim(),
      weight: document.getElementById('f-weight').value.trim(),
      followUpDate: document.getElementById('f-followup').value,
      vetNotes: document.getElementById('f-notes').value.trim()
    };

    // Only stamp appointmentId onto brand-new records created while a
    // ?appointment=<id> context is active. Never touch it on an edit —
    // omitting the key here means updateMedicalRecord's Object.assign
    // patch leaves whatever appointmentId the record already had intact.
    if (!state.editingId && state.appointmentId) {
      fields.appointmentId = state.appointmentId;
    }

    if (state.editingId) {
      D.updateMedicalRecord(state.editingId, fields);
      showToast('Medical record updated');
    } else {
      D.addMedicalRecord(fields);
      showToast('Medical record added');
    }

    closeModal();
    renderAll();
  }

  // ------------------------------------------------------------------
  // VIEW MODAL
  // ------------------------------------------------------------------

  function openView(id) {
    state.viewingId = id;
    renderView();
    document.getElementById('view-overlay').classList.add('open');
  }

  function closeView() {
    document.getElementById('view-overlay').classList.remove('open');
    state.viewingId = null;
  }

  function renderView() {
    var r = D.getMedRecordById(state.viewingId);
    var box = document.getElementById('view-box');
    if (!r) { closeView(); return; }

    var patient = r.patientId ? D.getPatientById(r.patientId) : null;
    var icon = patient ? (D.SPECIES_ICON[patient.species] || '<i class="fa-solid fa-paw"></i>') : '<i class="fa-solid fa-paw"></i>';
    var ownerInfo = patient ? resolveOwner(patient) : { name: r.owner, phone: '' };
    var linkedAppt = r.appointmentId && D.getById ? D.getById(r.appointmentId) : null;

    // Header sub-line: species/breed (when known) + owner name, so the
    // patient header reads as identity (who/whose pet) rather than visit
    // metadata — visit date/type/vet now live in their own section below.
    var speciesBreed = patient ? esc(patient.species) + (patient.breed ? ' · ' + esc(patient.breed) : '') : '';
    var ownerName = esc(ownerInfo.name || r.owner || '—');
    var headerSub = (speciesBreed ? speciesBreed + ' · ' : '') + 'Owner: ' + ownerName;

    box.innerHTML =
      '<div class="modal-head">' +
        '<div class="modal-title">Medical Record Details</div>' +
        '<button class="modal-close" id="view-close"><i class="fa-solid fa-xmark"></i></button>' +
      '</div>' +

      '<div class="profile-head">' +
        '<div class="profile-avatar">' + icon + '</div>' +
        '<div>' +
          '<div class="profile-name">' + esc(r.pet) + '</div>' +
          '<div class="profile-sub">' + headerSub + '</div>' +
        '</div>' +
        '<span style="margin-left:auto;">' + badge(r.status) + '</span>' +
      '</div>' +

      '<div class="profile-section">' +
        '<div class="profile-section-title">Visit information</div>' +
        '<div class="profile-grid">' +
          '<div class="profile-field"><span class="pf-label">Record date</span><span class="pf-value">' + formatDateShort(r.date) + '</span></div>' +
          '<div class="profile-field"><span class="pf-label">Veterinarian</span><span class="pf-value">' + esc(r.vet) + '</span></div>' +
          '<div class="profile-field"><span class="pf-label">Visit type / service</span><span class="pf-value">' + esc(r.visitType) + '</span></div>' +
          '<div class="profile-field"><span class="pf-label">Contact number</span><span class="pf-value">' + esc(ownerInfo.phone || '—') + '</span></div>' +
          '<div class="profile-field" style="grid-column:1/-1;"><span class="pf-label">Linked appointment</span><span class="pf-value">' + (linkedAppt ? formatDateShort(linkedAppt.date) + ' · ' + esc(linkedAppt.reason || linkedAppt.time || '') : 'Not linked to an appointment') + '</span></div>' +
        '</div>' +
      '</div>' +

      '<div class="profile-section">' +
        '<div class="profile-section-title">Clinical assessment</div>' +
        '<div class="profile-grid">' +
          '<div class="profile-field" style="grid-column:1/-1;"><span class="pf-label">Chief complaint</span><span class="pf-value">' + esc(r.chiefComplaint || '—') + '</span></div>' +
          '<div class="profile-field" style="grid-column:1/-1;"><span class="pf-label">Symptoms</span><span class="pf-value">' + esc(r.symptoms || 'None recorded') + '</span></div>' +
          '<div class="profile-field" style="grid-column:1/-1;"><span class="pf-label">Examination findings</span><span class="pf-value">' + esc(r.examFindings || 'None recorded') + '</span></div>' +
          '<div class="profile-field" style="grid-column:1/-1;"><span class="pf-label">Diagnosis</span><span class="pf-value">' + esc(r.diagnosis || 'None recorded') + '</span></div>' +
          '<div class="profile-field" style="grid-column:1/-1;"><span class="pf-label">Treatment</span><span class="pf-value">' + esc(r.treatment || 'None recorded') + '</span></div>' +
          '<div class="profile-field"><span class="pf-label">Weight recorded</span><span class="pf-value">' + (r.weight ? esc(r.weight) + ' kg' : 'Not recorded') + '</span></div>' +
        '</div>' +
      '</div>' +

      '<div class="profile-section">' +
        '<div class="profile-section-title">Medications &amp; vaccination</div>' +
        '<div class="profile-grid">' +
          '<div class="profile-field" style="grid-column:1/-1;"><span class="pf-label">Prescription / medications</span><span class="pf-value">' + esc(r.prescription || 'None recorded') + '</span></div>' +
          '<div class="profile-field"><span class="pf-label">Vaccination given</span><span class="pf-value">' + esc(r.vaccination || 'None') + '</span></div>' +
        '</div>' +
      '</div>' +

      '<div class="profile-section">' +
        '<div class="profile-section-title">Follow-up &amp; notes</div>' +
        '<div class="profile-grid">' +
          '<div class="profile-field"><span class="pf-label">Follow-up date</span><span class="pf-value">' + (r.followUpDate ? formatDateShort(r.followUpDate) : 'None scheduled') + '</span></div>' +
        '</div>' +
        '<div class="profile-field" style="margin-top:10px;"><span class="pf-label">Veterinarian notes</span><span class="pf-value">' + esc(r.vetNotes || 'No notes recorded.') + '</span></div>' +
      '</div>' +

      '<div class="modal-footer">' +
        '<button class="btn" id="view-close-btn">Close</button>' +
        '<button class="btn btn-primary" id="view-edit-btn"><i class="fa-solid fa-pen"></i> Edit record</button>' +
      '</div>';

    document.getElementById('view-close').addEventListener('click', closeView);
    document.getElementById('view-close-btn').addEventListener('click', closeView);
    document.getElementById('view-edit-btn').addEventListener('click', function () {
      closeView();
      openModal(r.id);
    });
  }

  // ------------------------------------------------------------------
  // top-level render / wiring
  // ------------------------------------------------------------------

  function renderAll() {
    renderPatientContext();
    renderRecentPatients();
    renderList();
    if (state.viewingId && document.getElementById('view-overlay').classList.contains('open')) {
      renderView();
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    // ACCESS GUARD — must stay the first operation in this handler.
    // Only a valid Administrator session may use this page. Fails closed:
    // if PCClientAuth or requireAdminLogin is missing, throws, or returns
    // a falsy result (logged out, Client session, inactive/deleted
    // account), the page body is hidden and nothing below runs — no
    // render, no data listeners, no interaction wiring.
    // requireAdminLogin() redirects to the login page when there is no
    // Administrator session.
    var admin = null;
    try {
      if (window.PCClientAuth && typeof window.PCClientAuth.requireAdminLogin === 'function') {
        admin = window.PCClientAuth.requireAdminLogin('client-login.html');
      }
    } catch (err) {
      admin = null;
    }
    if (!admin) {
      if (document.body) document.body.style.display = 'none';
      return;
    }

    fillStaticOptions();

    var urlParams = new URLSearchParams(window.location.search);
    var urlPatientId = urlParams.get('patient');
    var urlAppointmentId = urlParams.get('appointment');

    // Supports linking straight from an appointment (e.g. medical-records.html?appointment=<id>)
    // without requiring the caller to also pass ?patient=<id> — the patient is resolved from
    // the appointment's own patientId, the same relationship Queue already relies on.
    if (urlAppointmentId && D.getById && D.getById(urlAppointmentId)) {
      state.appointmentId = urlAppointmentId;
      if (!urlPatientId) {
        var linkedPatient = D.getPatientForAppointment ? D.getPatientForAppointment(D.getById(urlAppointmentId)) : null;
        if (linkedPatient) urlPatientId = linkedPatient.id;
      }
    }
    if (urlPatientId && D.getPatientById(urlPatientId)) {
      state.patientId = urlPatientId;
    }

    document.getElementById('search-input').addEventListener('input', function (e) {
      state.search = e.target.value;
      state.page = 1;
      renderList();
    });
    document.getElementById('filter-date').addEventListener('change', function (e) {
      state.filterDate = e.target.value;
      state.page = 1;
      renderList();
    });
    document.getElementById('filter-vet').addEventListener('change', function (e) {
      state.filterVet = e.target.value;
      state.page = 1;
      renderList();
    });
    document.getElementById('filter-type').addEventListener('change', function (e) {
      state.filterType = e.target.value;
      state.page = 1;
      renderList();
    });
    document.getElementById('filter-status').addEventListener('change', function (e) {
      state.filterStatus = e.target.value;
      state.page = 1;
      renderList();
    });
    document.getElementById('clear-filters').addEventListener('click', function () {
      state.search = ''; state.filterDate = ''; state.filterVet = ''; state.filterType = ''; state.filterStatus = '';
      state.page = 1;
      document.getElementById('search-input').value = '';
      document.getElementById('filter-date').value = '';
      document.getElementById('filter-vet').value = '';
      document.getElementById('filter-type').value = '';
      document.getElementById('filter-status').value = '';
      renderList();
    });

    document.getElementById('mr-prev').addEventListener('click', function () {
      if (state.page > 1) { state.page--; renderList(); keepPagerFocus(); }
    });
    document.getElementById('mr-next').addEventListener('click', function () {
      state.page++; renderList(); keepPagerFocus();   // renderList clamps to the last page
    });
    document.getElementById('mr-pages').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-page]') : null;
      if (!btn) return;
      var n = parseInt(btn.getAttribute('data-page'), 10);
      if (n && n !== state.page) { state.page = n; renderList(); keepPagerFocus(); }
    });

    document.getElementById('f-patient').addEventListener('change', updateOwnerFromPatient);

    document.getElementById('add-record-btn').addEventListener('click', function () { openModal(null); });
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-save').addEventListener('click', saveModal);
    document.getElementById('modal-overlay').addEventListener('click', function (e) {
      if (e.target.id === 'modal-overlay') closeModal();
    });
    document.getElementById('view-overlay').addEventListener('click', function (e) {
      if (e.target.id === 'view-overlay') closeView();
    });

    D.onChange(renderAll);
    renderAll();
  });
})();