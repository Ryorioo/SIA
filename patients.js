// ============================================================
// PAWSITIVE CARE — Patients page logic
// ============================================================

(function () {
  var D = window.PCData;

  var PAGE_SIZE = 9;

  var state = {
    search: '',
    filterSpecies: '',
    filterStatus: '',
    page: 1,
    editingId: null,
    viewingId: null,
    selectedClient: null,
    vaccinationPatientId: null,
    editingVaccinationId: null,
    // Add Patient pet photo — frontend-only, lives only while the modal
    // is open (never sent anywhere or persisted). photoUrl is a temporary
    // blob: URL used for the preview; photoFile keeps the original File
    // so a later step can upload it without re-asking the user.
    photoFile: null,
    photoUrl: null,
    photoTicket: 0
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

  // Owner display info always comes from the linked Client when a patient
  // has a clientId; only legacy/unlinked patients fall back to the
  // denormalized owner/ownerPhone fields stored directly on the patient.
  function ownerInfo(p) {
    var client = p && p.clientId ? D.getClientById(p.clientId) : null;
    if (client) return { name: client.name, phone: client.phone };
    return { name: (p && p.owner) || '', phone: (p && p.ownerPhone) || '' };
  }

  function matchesFilters(p) {
    var q = state.search.trim().toLowerCase();
    if (q) {
      var owner = ownerInfo(p);
      var hay = (p.pet + ' ' + owner.name + ' ' + owner.phone).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    if (state.filterSpecies) {
      if (state.filterSpecies === 'Other') {
        if (p.species === 'Dog' || p.species === 'Cat') return false;
      } else if (p.species !== state.filterSpecies) {
        return false;
      }
    }
    if (state.filterStatus && p.status !== state.filterStatus) return false;
    return true;
  }

  function formatDateShort(iso) {
    if (!iso) return 'No visits yet';
    var d = D.parseDate(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // Same short date formatting as formatDateShort, but with a plain '—'
  // for an empty date instead of the "No visits yet" wording that only
  // makes sense for last-visit fields.
  function formatVaxDate(iso) {
    if (!iso) return '—';
    var d = D.parseDate(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // Same status -> badge-class mapping already used for the legacy
  // Patient.vaccinationStatus badge, reused here for per-record status.
  function vaccinationStatusBadgeClass(status) {
    return status === 'Up to date' ? 'status-confirmed'
      : status === 'Overdue' ? 'status-cancelled'
      : status === 'Due soon' ? 'status-pending'
      : 'status-completed';
  }

  function initials(name) {
    var parts = (name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0][0] || '').toUpperCase();
  }

  // Picks the specific gender glyph when the sex is unambiguously
  // Male/Female, falling back to the combined icon for anything else
  // (unknown, "Unknown", etc.) so the icon never claims a sex the data
  // doesn't state.
  function sexIcon(sex) {
    var s = (sex || '').trim().toLowerCase();
    if (s === 'female') return 'fa-venus';
    if (s === 'male') return 'fa-mars';
    return 'fa-venus-mars';
  }

  // ------------------------------------------------------------------
  // Clinic-friendly Patient ID display (PT-001, PT-002, ...)
  // ------------------------------------------------------------------
  // Display-only mapping layered on top of the real patient.id — never
  // written back to the patient record. If a patient's underlying id
  // already looks like a PT-### clinic id, that's reused as-is; otherwise
  // one is assigned the first time that patient is rendered and cached
  // here for the rest of the session, so the same patient always shows
  // the same PT-### number no matter how the list is sorted/filtered or
  // how many times it re-renders.
  var patientDisplayIdCache = Object.create(null);
  var patientDisplayIdCounter = 0;

  function displayPatientId(p) {
    var raw = String((p && p.id) || '');
    if (/^PT-\d+$/i.test(raw)) return raw.toUpperCase();
    if (!patientDisplayIdCache[raw]) {
      patientDisplayIdCounter += 1;
      patientDisplayIdCache[raw] = 'PT-' + String(patientDisplayIdCounter).padStart(3, '0');
    }
    return patientDisplayIdCache[raw];
  }

  // Assigns display IDs in the patients' original (unsorted) data order,
  // the first time the list is available, so numbering reflects a stable
  // underlying order rather than whatever sort/filter happens to be
  // active on first render.
  var patientDisplayIdsSeeded = false;
  function seedPatientDisplayIds() {
    if (patientDisplayIdsSeeded) return;
    patientDisplayIdsSeeded = true;
    D.getPatients().forEach(displayPatientId);
  }

  // ------------------------------------------------------------------
  // PAGINATION (9 cards per page)
  // ------------------------------------------------------------------
  // The pager markup lives in patients.html (#pt-pager inside the
  // footer); this section only fills it and wires its buttons.

  var pagerEls = null;

  function getPager() {
    if (pagerEls) return pagerEls;
    var pager = document.getElementById('pt-pager');
    if (!pager) return null;
    pagerEls = {
      pager: pager,
      prev: document.getElementById('pt-prev'),
      next: document.getElementById('pt-next'),
      pages: document.getElementById('pt-pages')
    };
    pagerEls.prev.addEventListener('click', function () {
      if (state.page > 1) { state.page--; renderList(); keepPagerFocus(); }
    });
    pagerEls.next.addEventListener('click', function () {
      state.page++; renderList(); keepPagerFocus(); // renderList clamps to the last page
    });
    pagerEls.pages.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-page]') : null;
      if (!btn) return;
      var n = parseInt(btn.getAttribute('data-page'), 10);
      if (n && n !== state.page) { state.page = n; renderList(); keepPagerFocus(); }
    });
    return pagerEls;
  }

  // Page numbers to show: all of them up to 7 pages, otherwise first/last,
  // the current page and its neighbours, with '…' for the gaps.
  function pageList(cur, total) {
    var out = [], n;
    if (total <= 7) {
      for (n = 1; n <= total; n++) out.push(n);
      return out;
    }
    if (cur <= 4) return [1, 2, 3, 4, 5, '…', total];
    if (cur >= total - 3) return [1, '…', total - 4, total - 3, total - 2, total - 1, total];
    return [1, '…', cur - 1, cur, cur + 1, '…', total];
  }

  function updatePager(cur, pages) {
    var el = getPager();
    if (!el) return;
    el.pager.hidden = pages <= 1; // 9 or fewer matches: no pager needed
    el.pages.innerHTML = pageList(cur, pages).map(function (p) {
      if (p === '…') return '<span class="pt-ellipsis" aria-hidden="true">…</span>';
      var active = p === cur;
      return '<button type="button" class="btn btn-sm pt-page' + (active ? ' btn-primary' : '') + '" data-page="' + p + '"' +
        (active ? ' aria-current="page"' : '') + ' aria-label="Page ' + p + '">' + p + '</button>';
    }).join('');
    el.prev.disabled = cur <= 1;
    el.next.disabled = cur >= pages;
  }

  // The pager is rebuilt on every render, so put keyboard focus back on the
  // current page number if the clicked control was replaced or disabled.
  function keepPagerFocus() {
    var el = getPager();
    if (!el) return;
    if (el.pager.contains(document.activeElement) && !document.activeElement.disabled) return;
    var cur = el.pages.querySelector('[aria-current="page"]');
    if (cur) cur.focus();
  }

  // ------------------------------------------------------------------
  // LIST VIEW
  // ------------------------------------------------------------------

  function renderList() {
    var root = document.getElementById('view-root');
    var all = D.getPatients();
    seedPatientDisplayIds();
    var filtered = all.filter(matchesFilters);

    if (!filtered.length) {
      document.getElementById('patients-count').textContent = 'No patients to show';
      updatePager(1, 1);
      root.innerHTML = '<div class="patients-table-wrap"><div class="no-results">No patients match your search or filters.</div></div>';
      return;
    }

    filtered.sort(function (a, b) { return a.pet.localeCompare(b.pet); });

    // Pagination: sort first, then slice, so pages follow the sorted order.
    var total = filtered.length;
    var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (state.page > pages) state.page = pages; // e.g. the last card on the last page was removed
    if (state.page < 1) state.page = 1;
    var start = (state.page - 1) * PAGE_SIZE;
    var pageItems = filtered.slice(start, start + PAGE_SIZE);
    var first = start + 1;
    var last = start + pageItems.length;

    document.getElementById('patients-count').textContent =
      'Showing ' + (first === last ? first : first + '\u2013' + last) +
      ' of ' + total + ' patient' + (total === 1 ? '' : 's');
    updatePager(state.page, pages);

    var html = '<div class="patients-grid">' + pageItems.map(function (p) {
      var lastVisit = D.getLastVisit(p);
      var owner = ownerInfo(p);
      var speciesLine = esc(p.species) + (p.breed ? ' · ' + esc(p.breed) : '');
      // Most recent appointment (if any) supplies the service label shown
      // under the Last Visit date — same history data already used by the
      // Patient Profile modal, just reading its first (most recent) entry.
      var recentVisit = D.getAppointmentsForPatient(p)[0];
      var lastVisitService = recentVisit ? (recentVisit.reason || '') : '';
      var quickInfo =
        '<span class="pqi-item"><i class="fa-solid ' + sexIcon(p.sex) + '"></i>' + esc(p.sex) + '</span>' +
        '<span class="pqi-divider"></span>' +
        '<span class="pqi-item"><i class="fa-solid fa-calendar"></i>' + esc(D.calcAge(p.dob)) + '</span>' +
        '<span class="pqi-divider"></span>' +
        '<span class="pqi-item"><i class="fa-solid fa-scale-balanced"></i>' + (p.weight ? esc(p.weight) + ' kg' : '—') + '</span>';
      return (
        '<div class="patient-card">' +
          '<div class="patient-card-identity">' +
            '<div class="patient-photo-placeholder"></div>' +
            '<div class="patient-identity-text">' +
              '<span class="ppid">' + esc(displayPatientId(p)) + '</span>' +
              '<span class="pname">' + esc(p.pet) + '</span>' +
              '<span class="pspecies">' + speciesLine + '</span>' +
            '</div>' +
            '<span class="status-badge status-' + p.status + ' patient-card-status">' + (p.status === 'active' ? 'Active' : 'Inactive') + '</span>' +
          '</div>' +

          '<hr class="patient-card-hr">' +

          '<div class="patient-card-quickinfo">' + quickInfo + '</div>' +

          '<hr class="patient-card-hr">' +

          '<div class="patient-card-ownervisit">' +
            '<div class="pcov-col">' +
              '<span class="pf-label"><i class="fa-solid fa-user"></i>Owner</span>' +
              '<span class="pf-value">' + esc(owner.name || '—') + '</span>' +
              (owner.phone ? '<span class="pf-sub"><i class="fa-solid fa-phone"></i>' + esc(owner.phone) + '</span>' : '') +
            '</div>' +
            '<div class="pcov-col">' +
              '<span class="pf-label"><i class="fa-solid fa-calendar-days"></i>Last Visit</span>' +
              '<span class="pf-value">' + formatDateShort(lastVisit) + '</span>' +
              (lastVisitService ? '<span class="pf-sub">' + esc(lastVisitService) + '</span>' : '') +
            '</div>' +
          '</div>' +

          '<div class="patient-card-footer">' +
            '<button class="btn btn-primary btn-sm" data-action="view" data-id="' + p.id + '"><i class="fa-solid fa-user"></i> View Profile</button>' +
            '<button class="icon-btn" data-action="edit" data-id="' + p.id + '" title="Edit patient"><i class="fa-solid fa-pen"></i></button>' +
          '</div>' +
        '</div>'
      );
    }).join('') + '</div>';

    root.innerHTML = html;

    root.querySelectorAll('[data-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-id');
        var action = btn.getAttribute('data-action');
        if (action === 'view') openProfile(id);
        if (action === 'edit') openModal(id);
      });
    });
  }

  // ------------------------------------------------------------------
  // ADD / EDIT MODAL
  // ------------------------------------------------------------------

  // Breed is a native <select> (was a text input + datalist). Options are
  // still sourced from D.BREED_SUGGESTIONS per species — that data is
  // untouched — plus a always-available "Unknown" entry. currentValue (the
  // field's value before repopulating, or the patient's saved breed on
  // modal open) is preserved even when it isn't in that species' list, so
  // switching species or opening an older/legacy record never silently
  // drops or overwrites a breed that's already on file.
  function populateBreedSuggestions(species, currentValue) {
    var sel = document.getElementById('f-breed');
    var breeds = (D.BREED_SUGGESTIONS[species] || []).slice();

    if (breeds.indexOf('Unknown') === -1) breeds.push('Unknown');

    var preserved = (currentValue || '').trim();
    if (preserved && breeds.indexOf(preserved) === -1) {
      breeds.unshift(preserved);
    }

    sel.innerHTML = breeds.map(function (b) {
      return '<option value="' + esc(b) + '">' + esc(b) + '</option>';
    }).join('');
    sel.value = preserved || 'Unknown';
  }

  // Legacy fallback: patients added before the client-picker existed have
  // no clientId, only a plain owner name. Matches them to a real client
  // by name so editing them pre-selects the right client instead of
  // forcing the user to re-pick someone they'd already chosen.
  function findClientForOwnerName(name) {
    var n = (name || '').trim().toLowerCase();
    if (!n) return null;
    return D.getClients().find(function (c) { return (c.name || '').trim().toLowerCase() === n; }) || null;
  }

  function renderClientResults(query) {
    var box = document.getElementById('client-search-results');
    var q = (query || '').trim().toLowerCase();
    var all = D.getClients().slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    var list = !q ? all : all.filter(function (c) {
      return (c.name + ' ' + c.phone + ' ' + c.email).toLowerCase().indexOf(q) !== -1;
    });

    if (!list.length) {
      box.innerHTML = '<div class="client-search-empty">No matching client. <a href="clients.html" style="color:var(--teal-600); font-weight:800;">Add them on the Clients page</a>.</div>';
      return;
    }

    box.innerHTML = list.slice(0, 8).map(function (c) {
      return '<div class="client-result-row" data-client-id="' + c.id + '">' +
        '<span class="crn">' + esc(c.name) + '</span>' +
        '<span class="crm">' + esc(c.phone || '—') + (c.email ? ' · ' + esc(c.email) : '') + '</span>' +
      '</div>';
    }).join('');

    box.querySelectorAll('[data-client-id]').forEach(function (row) {
      row.addEventListener('click', function () {
        var client = D.getClientById(row.getAttribute('data-client-id'));
        if (client) selectClient(client);
      });
    });
  }

  function selectClient(client) {
    state.selectedClient = client;
    document.getElementById('f-client-id').value = client.id;
    document.getElementById('csc-name').textContent = client.name;
    document.getElementById('csc-meta').textContent = (client.phone || '—') + (client.email ? ' · ' + client.email : '');
    document.getElementById('client-selected-view').style.display = 'flex';
    document.getElementById('client-search-view').style.display = 'none';
  }

  function showClientSearchView(prefillQuery) {
    document.getElementById('client-selected-view').style.display = 'none';
    document.getElementById('client-search-view').style.display = 'block';
    var input = document.getElementById('f-client-search');
    input.value = prefillQuery || '';
    renderClientResults(prefillQuery || '');
  }

  // ------------------------------------------------------------------
  // PET PHOTO (Add Patient modal — select + preview only)
  // ------------------------------------------------------------------
  // No upload, no storage: the chosen File is held in `state` and shown
  // through a temporary object URL. It is released when the photo is
  // changed/removed or the modal closes.

  var PHOTO_MAX_BYTES = 15 * 1024 * 1024; // guard against huge originals
  var PHOTO_EXT_RE = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i;

  function isAcceptablePhoto(file) {
    var type = (file.type || '').toLowerCase();
    if (type) return type.indexOf('image/') === 0 && type !== 'image/svg+xml';
    // Some devices report an empty MIME type; fall back to the extension.
    return PHOTO_EXT_RE.test(file.name || '');
  }

  function renderPhoto() {
    var has = !!state.photoUrl;
    var drop = document.getElementById('pet-photo-btn');
    var img = document.getElementById('pet-photo-img');
    var empty = document.getElementById('pet-photo-empty');

    drop.classList.toggle('has-photo', has);
    drop.setAttribute('aria-label', has ? 'Change pet photo' : 'Add pet photo');
    if (has) {
      img.src = state.photoUrl;
    } else {
      img.removeAttribute('src');
    }
    img.hidden = !has;
    empty.hidden = has;
    document.getElementById('pet-photo-remove').hidden = !has;
    document.getElementById('pet-photo-change').hidden = !has;
  }

  function clearPhoto() {
    // Bumping the ticket also discards any image still being decoded.
    state.photoTicket += 1;
    if (state.photoUrl) URL.revokeObjectURL(state.photoUrl);
    state.photoFile = null;
    state.photoUrl = null;
    renderPhoto();
  }

  function applyPhoto(file, url) {
    if (state.photoUrl && state.photoUrl !== url) URL.revokeObjectURL(state.photoUrl);
    state.photoFile = file;
    state.photoUrl = url;
    renderPhoto();
  }

  function handlePhotoFile(file) {
    if (!file) return; // picker cancelled — keep whatever is showing

    if (!isAcceptablePhoto(file)) {
      showToast('Please choose an image file (JPG, PNG, or WEBP)');
      return;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      showToast('That image is too large (max 15 MB)');
      return;
    }

    var url;
    try {
      url = URL.createObjectURL(file);
    } catch (err) {
      showToast('That image could not be read');
      return;
    }

    // Confirm the browser can actually decode it before replacing the
    // current preview, so a corrupt/unsupported file never blanks the
    // existing photo.
    state.photoTicket += 1;
    var ticket = state.photoTicket;
    var probe = new Image();
    probe.onload = function () {
      if (ticket !== state.photoTicket) { URL.revokeObjectURL(url); return; }
      applyPhoto(file, url);
    };
    probe.onerror = function () {
      URL.revokeObjectURL(url);
      if (ticket !== state.photoTicket) return;
      showToast('That image could not be read. Try a JPG, PNG, or WEBP');
    };
    probe.src = url;
  }

  function openModal(id) {
    state.editingId = id || null;
    var p = id ? D.getPatientById(id) : null;

    document.getElementById('modal-title').textContent = p ? 'Edit Patient' : 'Add Patient';

    // Pet photo is only offered when adding a patient (nothing is stored
    // for it yet, so Edit keeps its original layout). Every open starts
    // from the empty state.
    clearPhoto();
    document.getElementById('pet-photo-field').hidden = !!p;
    document.getElementById('patient-identity-row').classList.toggle('no-photo', !!p);
    document.getElementById('f-pet').value = p ? p.pet : '';
    document.getElementById('f-species').value = p ? p.species : 'Dog';
    // Falls back to "Unknown" for a new patient, and for an existing one
    // whose breed is blank/null/undefined — never leaves the select on an
    // empty value.
    populateBreedSuggestions(p ? p.species : 'Dog', p ? p.breed : '');
    document.getElementById('f-sex').value = p ? p.sex : 'Unknown';
    document.getElementById('f-dob').value = p ? p.dob : '';
    document.getElementById('f-color').value = p ? p.color : '';
    document.getElementById('f-weight').value = p ? p.weight : '';
    document.getElementById('f-status').value = p ? p.status : 'active';

    var linkedClient = p ? (p.clientId ? D.getClientById(p.clientId) : findClientForOwnerName(p.owner)) : null;
    if (linkedClient) {
      selectClient(linkedClient);
    } else {
      state.selectedClient = null;
      document.getElementById('f-client-id').value = '';
      showClientSearchView(p ? p.owner : '');
    }

    document.getElementById('f-allergies').value = p ? p.allergies : '';
    document.getElementById('f-conditions').value = p ? p.conditions : '';
    document.getElementById('f-medications').value = p ? p.medications : '';
    document.getElementById('f-vaccination').value = p ? p.vaccinationStatus : 'Unknown';
    document.getElementById('f-notes').value = p ? p.notes : '';

    document.getElementById('modal-overlay').classList.add('open');
  }

  function closeModal() {
    document.getElementById('modal-overlay').classList.remove('open');
    state.editingId = null;
    state.selectedClient = null;
    clearPhoto();
  }

  function saveModal() {
    var client = state.selectedClient;

    var fields = {
      pet: document.getElementById('f-pet').value.trim(),
      species: document.getElementById('f-species').value,
      breed: document.getElementById('f-breed').value.trim(),
      sex: document.getElementById('f-sex').value,
      dob: document.getElementById('f-dob').value,
      color: document.getElementById('f-color').value.trim(),
      weight: document.getElementById('f-weight').value.trim(),
      status: document.getElementById('f-status').value,
      clientId: client ? client.id : null,
      owner: client ? client.name : '',
      ownerPhone: client ? client.phone : '',
      allergies: document.getElementById('f-allergies').value.trim(),
      conditions: document.getElementById('f-conditions').value.trim(),
      medications: document.getElementById('f-medications').value.trim(),
      vaccinationStatus: document.getElementById('f-vaccination').value,
      notes: document.getElementById('f-notes').value.trim()
    };

    // Future hook: when photo storage exists, the selected image is
    // available here as state.photoFile (a File). Intentionally NOT added
    // to `fields` yet so the patient data structure is unchanged.

    if (!fields.pet) {
      showToast('Please fill in the pet name');
      return;
    }
    if (!client) {
      showToast('Please select an existing client (owner)');
      return;
    }

    if (state.editingId) {
      D.updatePatient(state.editingId, fields);
      showToast('Patient updated');
    } else {
      D.addPatient(fields);
      showToast('Patient added');
    }

    closeModal();
    renderAll();
  }

  // ------------------------------------------------------------------
  // PATIENT PROFILE
  // ------------------------------------------------------------------

  // Patient Profile is now a dedicated page (patient-profile.html), opened
  // with the clinic display ID (e.g. ?id=PT-002). The old modal markup and
  // renderProfile() below are intentionally left in place, now unused, so
  // they can be removed in a separate cleanup step. `replace` is used for
  // the ?open= deep link so the Back button doesn't bounce back into it.
  function openProfile(id, replace) {
    var p = D.getPatientById(id);
    if (!p) return;
    seedPatientDisplayIds();
    var url = 'patient-profile.html?id=' + encodeURIComponent(displayPatientId(p));
    if (replace) window.location.replace(url);
    else window.location.href = url;
  }

  function closeProfile() {
    document.getElementById('profile-overlay').classList.remove('open');
    state.viewingId = null;
  }

  function renderProfile() {
    var p = D.getPatientById(state.viewingId);
    var box = document.getElementById('profile-box');
    if (!p) { closeProfile(); return; }

    var history = D.getAppointmentsForPatient(p);
    var lastVisit = D.getLastVisit(p);
    var owner = ownerInfo(p);
    var searchTerm = encodeURIComponent(p.pet + ' ' + owner.name);

    var vaccinations = D.getVaccinationsForPatientId(p.id);
    var vaccinationsHtml;
    if (vaccinations.length) {
      vaccinationsHtml = vaccinations.map(function (v) {
        var status = D.computeVaccinationStatus(v.nextDue);
        return '<div class="history-row" data-vax-id="' + esc(v.id) + '">' +
          '<div class="history-main"><span class="h-reason">' + esc(v.vaccineName || 'Vaccine') + '</span>' +
            '<span class="h-meta">Date given: ' + formatVaxDate(v.dateGiven) + ' · Next due: ' + formatVaxDate(v.nextDue) +
              (v.notes ? ' · ' + esc(v.notes) : '') + '</span></div>' +
          '<span class="status-badge ' + vaccinationStatusBadgeClass(status) + '">' + esc(status) + '</span>' +
          '<button class="btn btn-sm edit-vaccination-btn" data-vax-id="' + esc(v.id) + '" style="margin-left:8px;"><i class="fa-solid fa-pen"></i></button>' +
        '</div>';
      }).join('') +
      // Older patients may still only have the general status field from
      // before per-record tracking existed; keep showing it here as extra
      // context alongside the real records, rather than dropping it.
      (p.vaccinationStatus && p.vaccinationStatus !== 'Unknown'
        ? '<div style="margin-top:8px; font-size:11.5px; color:var(--ink-faint); font-weight:600;">General status on file: ' +
            '<span class="status-badge ' + vaccinationStatusBadgeClass(p.vaccinationStatus) + '" style="margin-left:4px;">' + esc(p.vaccinationStatus) + '</span></div>'
        : '');
    } else {
      vaccinationsHtml = '<div class="no-results" style="padding:20px 0;">No vaccination records yet.</div>' +
        '<div style="font-size:11.5px; color:var(--ink-faint); font-weight:600;">General status on file: ' +
          '<span class="status-badge ' + vaccinationStatusBadgeClass(p.vaccinationStatus) + '" style="margin-left:4px;">' + esc(p.vaccinationStatus || 'Unknown') + '</span></div>';
    }

    var historyHtml = !history.length
      ? '<div class="no-results" style="padding:20px 0;">No appointment history yet.</div>'
      : history.slice(0, 6).map(function (a) {
          return '<div class="history-row">' +
            '<div class="history-main"><span class="h-reason">' + esc(a.reason || 'General visit') + '</span>' +
            '<span class="h-meta">' + D.formatDateLabel(a.date) + ' · ' + D.formatTimeLabel(a.time) + ' · ' + esc(a.vet) + '</span></div>' +
            '<span class="status-badge status-' + a.status + '">' + D.STATUS_LABELS[a.status] + '</span>' +
          '</div>';
        }).join('');

    box.innerHTML =
      '<div class="modal-head">' +
        '<div class="modal-title">Patient Profile</div>' +
        '<button class="modal-close" id="profile-close"><i class="fa-solid fa-xmark"></i></button>' +
      '</div>' +

      '<div class="profile-head">' +
        '<div class="profile-avatar">' + (D.SPECIES_ICON[p.species] || '<i class="fa-solid fa-paw"></i>') + '</div>' +
        '<div>' +
          '<div class="profile-name">' + esc(p.pet) + '</div>' +
          '<div class="profile-sub">' + esc(p.species) + (p.breed ? ' · ' + esc(p.breed) : '') + ' · ' + esc(p.sex) + ' · ' + D.calcAge(p.dob) + '</div>' +
        '</div>' +
        '<span class="status-badge status-' + p.status + '" style="margin-left:auto;">' + (p.status === 'active' ? 'Active' : 'Inactive') + '</span>' +
      '</div>' +

      '<div class="profile-links">' +
        '<a class="btn btn-sm" href="appointments.html?q=' + searchTerm + '"><i class="fa-solid fa-calendar-days"></i> Appointments</a>' +
        '<a class="btn btn-sm" href="queue.html"><i class="fa-solid fa-hourglass-half"></i> Queue</a>' +
        '<a class="btn btn-sm" href="medical-records.html?patient=' + encodeURIComponent(p.id) + '"><i class="fa-solid fa-notes-medical"></i> Medical Records</a>' +
        '<a class="btn btn-sm" href="billing.html?patient=' + encodeURIComponent(p.id) + '"><i class="fa-solid fa-credit-card"></i> Billing</a>' +
      '</div>' +

      '<div class="profile-section">' +
        '<div class="profile-section-title"><i class="fa-solid fa-paw"></i> Pet information</div>' +
        '<div class="profile-grid">' +
          '<div class="profile-field"><span class="pf-label">Color</span><span class="pf-value">' + esc(p.color || '—') + '</span></div>' +
          '<div class="profile-field"><span class="pf-label">Weight</span><span class="pf-value">' + (p.weight ? esc(p.weight) + ' kg' : '—') + '</span></div>' +
          '<div class="profile-field"><span class="pf-label">Date of birth</span><span class="pf-value">' + (p.dob ? formatDateShort(p.dob) : '—') + '</span></div>' +
          '<div class="profile-field"><span class="pf-label">Last visit</span><span class="pf-value">' + formatDateShort(lastVisit) + '</span></div>' +
        '</div>' +
      '</div>' +

      '<div class="profile-section">' +
        '<div class="profile-section-title"><i class="fa-solid fa-user"></i> Owner information</div>' +
        '<div class="profile-grid">' +
          '<div class="profile-field"><span class="pf-label">Owner name</span><span class="pf-value">' + esc(owner.name || '—') + '</span></div>' +
          '<div class="profile-field"><span class="pf-label">Contact number</span><span class="pf-value">' + esc(owner.phone || '—') + '</span></div>' +
        '</div>' +
      '</div>' +

      '<div class="profile-section">' +
        '<div class="profile-section-title" style="display:flex; align-items:center; justify-content:space-between; gap:8px;">' +
          '<span><i class="fa-solid fa-syringe"></i> Vaccinations</span>' +
          '<button class="btn btn-sm" id="add-vaccination-btn"><i class="fa-solid fa-plus"></i> Add vaccination</button>' +
        '</div>' +
        vaccinationsHtml +
      '</div>' +

      '<div class="profile-section">' +
        '<div class="profile-section-title"><i class="fa-solid fa-clock-rotate-left"></i> Appointment history</div>' +
        historyHtml +
      '</div>' +

      '<div class="profile-section">' +
        '<div class="profile-section-title"><i class="fa-solid fa-file-waveform"></i> Medical history summary</div>' +
        '<div class="profile-grid">' +
          '<div class="profile-field" style="grid-column:1/-1;"><span class="pf-label">Existing medical conditions</span><span class="pf-value">' + esc(p.conditions || 'None recorded') + '</span></div>' +
          '<div class="profile-field" style="grid-column:1/-1;"><span class="pf-label">Current medications</span><span class="pf-value">' + esc(p.medications || 'None recorded') + '</span></div>' +
          '<div class="profile-field" style="grid-column:1/-1;"><span class="pf-label">Allergies</span><span class="pf-value">' + esc(p.allergies || 'None recorded') + '</span></div>' +
        '</div>' +
        '<div style="margin-top:10px; font-size:11.5px; color:var(--ink-faint); font-weight:600;">' +
          'For full diagnoses, lab results, and treatment history, see <a href="medical-records.html?patient=' + encodeURIComponent(p.id) + '" style="color:var(--teal-600); font-weight:800;">Medical Records</a>.' +
        '</div>' +
      '</div>' +

      '<div class="profile-section">' +
        '<div class="profile-section-title"><i class="fa-solid fa-note-sticky"></i> Notes</div>' +
        '<div class="pf-value">' + esc(p.notes || 'No notes yet.') + '</div>' +
      '</div>' +

      '<div class="modal-footer">' +
        '<button class="btn" id="profile-close-btn">Close</button>' +
        '<button class="btn btn-primary" id="profile-edit-btn"><i class="fa-solid fa-pen"></i> Edit patient</button>' +
      '</div>';

    document.getElementById('profile-close').addEventListener('click', closeProfile);
    document.getElementById('profile-close-btn').addEventListener('click', closeProfile);
    document.getElementById('profile-edit-btn').addEventListener('click', function () {
      closeProfile();
      openModal(p.id);
    });

    document.getElementById('add-vaccination-btn').addEventListener('click', function () {
      openVaccinationModal(p.id, null);
    });
    box.querySelectorAll('.edit-vaccination-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openVaccinationModal(p.id, btn.getAttribute('data-vax-id'));
      });
    });
  }

  // ------------------------------------------------------------------
  // VACCINATION RECORDS (add / edit modal, scoped to one patient)
  // ------------------------------------------------------------------

  function openVaccinationModal(patientId, vaccinationId) {
    state.vaccinationPatientId = patientId;
    state.editingVaccinationId = vaccinationId || null;
    var v = vaccinationId ? D.getVaccinationById(vaccinationId) : null;

    document.getElementById('vaccination-modal-title').textContent = v ? 'Edit Vaccination' : 'Add Vaccination';
    document.getElementById('vf-vaccine-name').value = v ? v.vaccineName : '';
    document.getElementById('vf-date-given').value = v ? v.dateGiven : '';
    document.getElementById('vf-next-due').value = v ? v.nextDue : '';
    document.getElementById('vf-notes').value = v ? v.notes : '';

    document.getElementById('vaccination-modal-overlay').classList.add('open');
  }

  function closeVaccinationModal() {
    document.getElementById('vaccination-modal-overlay').classList.remove('open');
    state.vaccinationPatientId = null;
    state.editingVaccinationId = null;
  }

  function saveVaccinationModal() {
    var fields = {
      patientId: state.vaccinationPatientId,
      vaccineName: document.getElementById('vf-vaccine-name').value.trim(),
      dateGiven: document.getElementById('vf-date-given').value,
      nextDue: document.getElementById('vf-next-due').value,
      notes: document.getElementById('vf-notes').value.trim()
    };

    if (!fields.vaccineName) {
      showToast('Please fill in the vaccine name');
      return;
    }

    if (state.editingVaccinationId) {
      D.updateVaccination(state.editingVaccinationId, fields);
      showToast('Vaccination updated');
    } else {
      D.addVaccination(fields);
      showToast('Vaccination added');
    }

    closeVaccinationModal();
    renderAll();
  }

  // ------------------------------------------------------------------
  // top-level render / wiring
  // ------------------------------------------------------------------

  function renderAll() {
    renderList();
    if (state.viewingId && document.getElementById('profile-overlay').classList.contains('open')) {
      renderProfile();
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

    document.getElementById('search-input').addEventListener('input', function (e) {
      state.search = e.target.value;
      state.page = 1;
      renderList();
    });
    document.getElementById('filter-species').addEventListener('change', function (e) {
      state.filterSpecies = e.target.value;
      state.page = 1;
      renderList();
    });
    document.getElementById('filter-status').addEventListener('change', function (e) {
      state.filterStatus = e.target.value;
      state.page = 1;
      renderList();
    });
    document.getElementById('clear-filters').addEventListener('click', function () {
      state.search = ''; state.filterSpecies = ''; state.filterStatus = ''; state.page = 1;
      document.getElementById('search-input').value = '';
      document.getElementById('filter-species').value = '';
      document.getElementById('filter-status').value = '';
      renderList();
    });

    document.getElementById('f-species').addEventListener('change', function (e) {
      // Carry the currently-selected breed over to the new species' list
      // (populateBreedSuggestions keeps it as an extra option if the new
      // species' suggestions don't include it) instead of resetting it.
      populateBreedSuggestions(e.target.value, document.getElementById('f-breed').value);
    });

    document.getElementById('f-client-search').addEventListener('input', function (e) {
      renderClientResults(e.target.value);
    });
    document.getElementById('client-change-btn').addEventListener('click', function () {
      showClientSearchView(state.selectedClient ? state.selectedClient.name : '');
    });

    var photoInput = document.getElementById('f-photo');
    document.getElementById('pet-photo-btn').addEventListener('click', function () { photoInput.click(); });
    document.getElementById('pet-photo-change').addEventListener('click', function () { photoInput.click(); });
    document.getElementById('pet-photo-remove').addEventListener('click', clearPhoto);
    photoInput.addEventListener('change', function () {
      var file = photoInput.files && photoInput.files[0];
      // Reset so picking the same file again still fires `change`; the
      // File object stays valid after this.
      photoInput.value = '';
      handlePhotoFile(file);
    });

    document.getElementById('add-patient-btn').addEventListener('click', function () { openModal(null); });
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-save').addEventListener('click', saveModal);
    document.getElementById('modal-overlay').addEventListener('click', function (e) {
      if (e.target.id === 'modal-overlay') closeModal();
    });
    document.getElementById('profile-overlay').addEventListener('click', function (e) {
      if (e.target.id === 'profile-overlay') closeProfile();
    });

    document.getElementById('vaccination-modal-close').addEventListener('click', closeVaccinationModal);
    document.getElementById('vaccination-modal-cancel').addEventListener('click', closeVaccinationModal);
    document.getElementById('vaccination-modal-save').addEventListener('click', saveVaccinationModal);
    document.getElementById('vaccination-modal-overlay').addEventListener('click', function (e) {
      if (e.target.id === 'vaccination-modal-overlay') closeVaccinationModal();
    });

    D.onChange(renderAll);
    renderAll();

    // Optional deep-link: patients.html?open=<patientId> opens that
    // patient's profile directly. Used by the Clients page's
    // "View Patient" action; harmless no-op when the param is absent.
    var deepLinkId = new URLSearchParams(window.location.search).get('open');
    if (deepLinkId && D.getPatientById(deepLinkId)) {
      openProfile(deepLinkId, true);
    }
  });
})();