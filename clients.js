// ============================================================
// PAWSITIVE CARE — Clients page logic
// Manages pet owners. Registered pets, appointment history, and
// billing are pulled live from the existing Patients/Appointments/
// Billing data (matched by owner name) rather than duplicated here.
// ============================================================

(function () {
  var D = window.PCData;

  var PAGE_SIZE = 9;

  var state = {
    search: '',
    filterStatus: '',
    page: 1,
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

  function matchesFilters(c) {
    var q = state.search.trim().toLowerCase();
    if (q) {
      var hay = (c.name + ' ' + c.phone + ' ' + c.email).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    if (state.filterStatus && c.status !== state.filterStatus) return false;
    return true;
  }

  function formatDateShort(iso) {
    if (!iso) return 'No visits yet';
    var d = D.parseDate(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function initials(name) {
    var parts = (name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    var first = parts[0][0] || '';
    var last = parts.length > 1 ? (parts[parts.length - 1][0] || '') : '';
    return (first + last).toUpperCase();
  }

  // ------------------------------------------------------------------
  // Clinic-friendly Client ID display (CL-001, CL-002, ...)
  // ------------------------------------------------------------------
  // Same display-only pattern as Patients' displayPatientId/PT-### —
  // layered on top of the real client.id, never written back to the
  // client record or persisted anywhere. Cached for the rest of the
  // session so the same client always shows the same CL-### number
  // no matter how the list is sorted/filtered or how many times it
  // re-renders.
  var clientDisplayIdCache = Object.create(null);
  var clientDisplayIdCounter = 0;

  function displayClientId(c) {
    var raw = String((c && c.id) || '');
    if (/^CL-\d+$/i.test(raw)) return raw.toUpperCase();
    if (!clientDisplayIdCache[raw]) {
      clientDisplayIdCounter += 1;
      clientDisplayIdCache[raw] = 'CL-' + String(clientDisplayIdCounter).padStart(3, '0');
    }
    return clientDisplayIdCache[raw];
  }

  // Assigns display IDs in the clients' original (unsorted) data order,
  // the first time the list is available, so numbering reflects a
  // stable underlying order rather than whatever sort/filter happens
  // to be active on first render.
  var clientDisplayIdsSeeded = false;
  function seedClientDisplayIds() {
    if (clientDisplayIdsSeeded) return;
    clientDisplayIdsSeeded = true;
    D.getClients().forEach(displayClientId);
  }

  // Most recent COMPLETED appointment for a client, exactly as
  // D.getLastVisitForClient() selects it internally (first entry in
  // the already-sorted-descending list with status === 'completed'),
  // except this keeps the full appointment object (so its .pet is
  // available) instead of just the date string. D.getLastVisitForClient
  // itself is left untouched since other code may rely on its
  // date-only contract.
  function lastCompletedVisit(c) {
    var history = D.getAppointmentsForClient(c);
    return history.find(function (a) { return a.status === 'completed'; }) || null;
  }

  // ------------------------------------------------------------------
  // PAGINATION (9 cards per page)
  // ------------------------------------------------------------------
  // The pager is created here, inside the existing .cl-footer, so
  // clients.html needs no changes. Its few style rules are injected
  // once and scoped to #clients-body (mirrors the Items pager).

  var pagerEls = null;

  function buildPager() {
    var footer = document.querySelector('#clients-body .cl-footer');
    if (!footer || pagerEls) return;

    var style = document.createElement('style');
    style.textContent =
      '#clients-body .cl-pager { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-left: auto; min-width: 0; max-width: 100%; }' +
      '#clients-body .cl-pager[hidden] { display: none; }' +
      '#clients-body .cl-pager .btn[disabled] { opacity: .45; cursor: not-allowed; box-shadow: none; pointer-events: none; }' +
      '#clients-body .cl-pages { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 6px; min-width: 0; }' +
      '#clients-body .cl-page { min-width: 32px; padding-left: 6px; padding-right: 6px; font-variant-numeric: tabular-nums; }' +
      '#clients-body .cl-ellipsis { min-width: 20px; text-align: center; font-size: 12.5px; font-weight: 700; color: var(--ink-soft); user-select: none; }' +
      '@media (max-width: 640px) {' +
        '#clients-body .cl-pager { margin-left: 0; justify-content: center; }' +
        '#clients-body .cl-pager #cl-prev, #clients-body .cl-pager #cl-next { flex: 1 1 0; }' +
        '#clients-body .cl-pager #cl-prev { order: 1; }' +
        '#clients-body .cl-pager #cl-next { order: 2; }' +
        '#clients-body .cl-pager .cl-pages { order: 3; flex: 1 1 100%; }' +
      '}';
    document.head.appendChild(style);

    var pager = document.createElement('div');
    pager.className = 'cl-pager';
    pager.id = 'cl-pager';
    pager.hidden = true;
    pager.innerHTML =
      '<button type="button" class="btn btn-sm" id="cl-prev">Previous</button>' +
      '<div class="cl-pages" id="cl-pages" role="group" aria-label="Pagination"></div>' +
      '<button type="button" class="btn btn-sm" id="cl-next">Next</button>';
    footer.appendChild(pager);

    pagerEls = {
      pager: pager,
      prev: pager.querySelector('#cl-prev'),
      next: pager.querySelector('#cl-next'),
      pages: pager.querySelector('#cl-pages')
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
    if (!pagerEls) return;
    pagerEls.pager.hidden = pages <= 1; // 9 or fewer matches: no pager needed
    pagerEls.pages.innerHTML = pageList(cur, pages).map(function (p) {
      if (p === '…') return '<span class="cl-ellipsis" aria-hidden="true">…</span>';
      var active = p === cur;
      return '<button type="button" class="btn btn-sm cl-page' + (active ? ' btn-primary' : '') + '" data-page="' + p + '"' +
        (active ? ' aria-current="page"' : '') + ' aria-label="Page ' + p + '">' + p + '</button>';
    }).join('');
    pagerEls.prev.disabled = cur <= 1;
    pagerEls.next.disabled = cur >= pages;
  }

  // The pager is rebuilt on every render, so put keyboard focus back on the
  // current page number if the clicked control was replaced or disabled.
  function keepPagerFocus() {
    if (!pagerEls) return;
    if (pagerEls.pager.contains(document.activeElement) && !document.activeElement.disabled) return;
    var cur = pagerEls.pages.querySelector('[aria-current="page"]');
    if (cur) cur.focus();
  }

  // ------------------------------------------------------------------
  // LIST VIEW
  // ------------------------------------------------------------------

  function renderList() {
    var root = document.getElementById('view-root');
    var all = D.getClients();
    seedClientDisplayIds();
    var filtered = all.filter(matchesFilters);

    if (!filtered.length) {
      document.getElementById('clients-count').textContent = 'No clients to show';
      updatePager(1, 1);
      root.innerHTML = '<div class="clients-empty"><div class="no-results">No clients match your search or filters.</div></div>';
      return;
    }

    filtered.sort(function (a, b) { return a.name.localeCompare(b.name); });

    // Pagination: sort first, then slice, so pages follow the sorted order.
    var total = filtered.length;
    var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (state.page > pages) state.page = pages; // e.g. last client on the last page was removed
    if (state.page < 1) state.page = 1;
    var start = (state.page - 1) * PAGE_SIZE;
    var pageItems = filtered.slice(start, start + PAGE_SIZE);
    var first = start + 1;
    var last = start + pageItems.length;

    document.getElementById('clients-count').textContent =
      'Showing ' + (first === last ? first : first + '\u2013' + last) +
      ' of ' + total + ' client' + (total === 1 ? '' : 's');
    updatePager(state.page, pages);

    var html = '<div class="clients-grid">';

    html += pageItems.map(function (c) {
      var pets = D.getPatientsForClient(c);
      var visiblePets = pets.slice(0, 2);
      var extraPetCount = Math.max(0, pets.length - 2);

      var petsHtml = !pets.length
        ? '<div class="cc-pets-empty">No pets registered</div>'
        : '<div class="cc-pets-row">' +
            visiblePets.map(function (p) {
              // No pet photo is persisted anywhere yet (confirmed in the
              // audit — Add Patient's photo picker is frontend-only and
              // never saved), so this always falls back to the muted
              // placeholder circle today. Checking for a photo field
              // defensively means real photos would start appearing
              // automatically here if persistence is added later, with
              // no further changes to this file.
              var photoUrl = p.photo || p.photoUrl || '';
              var photoStyle = photoUrl ? ' style="background-image:url(\'' + esc(photoUrl) + '\')"' : '';
              return (
                '<div class="cc-pet">' +
                  '<div class="cc-pet-photo"' + photoStyle + '></div>' +
                  '<div class="cc-pet-name" title="' + esc(p.pet) + '">' + esc(p.pet) + '</div>' +
                '</div>'
              );
            }).join('') +
            (extraPetCount > 0
              ? '<div class="cc-pet cc-pet-more"><div class="cc-pet-photo">+' + extraPetCount + '</div></div>'
              : '') +
          '</div>';

      var visit = lastCompletedVisit(c);
      var visitPetLine = visit
        ? esc(visit.pet) + (visit.reason ? ' · ' + esc(visit.reason) : '')
        : '';

      return (
        '<div class="client-card" data-id="' + c.id + '">' +
          '<div class="cc-top">' +
            '<div class="client-avatar">' + esc(initials(c.name)) + '</div>' +
            '<div class="cc-id">' +
              '<span class="cc-clientid">' + esc(displayClientId(c)) + '</span>' +
              '<span class="cc-name" title="' + esc(c.name) + '">' + esc(c.name) + '</span>' +
            '</div>' +
            '<span class="status-badge status-' + c.status + '">' + (c.status === 'active' ? 'Active' : 'Inactive') + '</span>' +
          '</div>' +

          '<div class="cc-contact">' +
            '<div class="cc-row" title="' + esc(c.phone || '') + '"><i class="fa-solid fa-phone"></i>' + esc(c.phone || 'No contact number') + '</div>' +
            '<div class="cc-row" title="' + esc(c.email || '') + '"><i class="fa-solid fa-envelope"></i>' + esc(c.email || 'No email on file') + '</div>' +
          '</div>' +

          '<hr class="client-card-hr">' +

          '<div class="cc-petsvisit">' +
            '<div class="ccpv-col">' +
              '<span class="ccpv-label">Pets</span>' +
              petsHtml +
            '</div>' +
            '<div class="ccpv-col">' +
              '<span class="ccpv-label">Last visit</span>' +
              (visit
                ? '<span class="ccpv-value">' + esc(formatDateShort(visit.date)) + '</span>' +
                  '<span class="ccpv-sub">' + visitPetLine + '</span>'
                : '<span class="ccpv-value">No visits yet</span>') +
            '</div>' +
          '</div>' +

          '<div class="cc-actions">' +
            '<button class="btn btn-primary btn-sm" data-action="view" data-id="' + c.id + '"><i class="fa-solid fa-id-card"></i> View Profile</button>' +
            '<button class="icon-btn" data-action="edit" data-id="' + c.id + '" title="Edit client"><i class="fa-solid fa-pen"></i></button>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    html += '</div>';
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

  var petBlockSeq = 0; // unique data-pet-block key per block (titles come from position, not this)

  // ------------------------------------------------------------------
  // PET FORM — same structure as the finalized Add Patient modal
  // (patients.html / patients.js): Patient Information (with photo),
  // Medical Information, and Pet Notes. Field names map 1:1 onto the
  // existing patient record (pet, species, breed, sex, dob, color,
  // weight, status, allergies, conditions, medications,
  // vaccinationStatus, notes), so nothing new is added to the data
  // model. Each block keeps its own state (including its own photo).
  // ------------------------------------------------------------------

  function optionsHtml(list) {
    return list.map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('');
  }

  function petBlockHtml(seq, removable) {
    return (
      '<div class="pet-block" data-pet-block="' + seq + '">' +
        '<div class="pet-block-head">' +
          '<span class="pet-block-title"></span>' +
          (removable ? '<button type="button" class="icon-btn remove-pet-btn" title="Remove this pet"><i class="fa-solid fa-trash"></i></button>' : '') +
        '</div>' +
        '<div class="form-grid">' +

          '<div class="form-section-title">Patient Information</div>' +
          '<div class="patient-identity-row">' +
            '<div class="pet-photo-field">' +
              '<input type="file" class="pet-photo-input" accept="image/*" hidden>' +
              '<div class="pet-photo-wrap">' +
                '<button type="button" class="pet-photo-drop" aria-label="Add pet photo">' +
                  '<span class="pet-photo-empty">Add Photo</span>' +
                  '<img class="pet-photo-img" alt="Selected pet photo preview" hidden>' +
                '</button>' +
                '<button type="button" class="pet-photo-remove" aria-label="Remove photo" title="Remove photo" hidden>' +
                  '<i class="fa-solid fa-xmark"></i>' +
                '</button>' +
              '</div>' +
              '<button type="button" class="pet-photo-change" hidden>Change photo</button>' +
            '</div>' +
            '<div class="form-field"><label>Pet name *</label><input type="text" data-field="pet" placeholder="e.g. Max"></div>' +
            '<div class="form-field"><label>Species</label><select data-field="species" class="pc-select">' + optionsHtml(D.SPECIES) + '</select></div>' +
            '<div class="form-field"><label>Breed</label><select data-field="breed" class="pc-select"></select></div>' +
            '<div class="form-field"><label>Sex</label><select data-field="sex" class="pc-select">' + optionsHtml(D.SEX_OPTIONS) + '</select></div>' +
          '</div>' +
          '<div class="form-field"><label>Date of birth</label><input type="date" data-field="dob"></div>' +
          '<div class="form-field"><label>Color</label><input type="text" data-field="color" placeholder="e.g. Golden"></div>' +
          '<div class="form-field"><label>Weight (kg)</label><input type="text" data-field="weight" inputmode="decimal" placeholder="e.g. 12.5"></div>' +
          '<div class="form-field"><label>Status</label><select data-field="status" class="pc-select">' +
            '<option value="active">Active</option><option value="inactive">Inactive</option>' +
          '</select></div>' +

          '<div class="form-section-title">Medical Information</div>' +
          '<div class="form-field full"><label>Allergies</label><input type="text" data-field="allergies" placeholder="e.g. None known"></div>' +
          '<div class="form-field full"><label>Existing medical conditions</label><input type="text" data-field="conditions" placeholder="e.g. None"></div>' +
          '<div class="form-field full"><label>Current medications</label><input type="text" data-field="medications" placeholder="e.g. None"></div>' +
          '<div class="form-field full"><label>Vaccination status</label><select data-field="vaccinationStatus" class="pc-select">' + optionsHtml(D.VACCINATION_STATUSES) + '</select></div>' +

          '<div class="form-section-title">Pet Notes</div>' +
          '<div class="form-field full"><label>Pet notes</label><textarea data-field="notes" placeholder="Optional notes about this pet..."></textarea></div>' +

        '</div>' +
      '</div>'
    );
  }

  // Breed is a native <select> fed by D.BREED_SUGGESTIONS per species plus
  // an always-available "Unknown" — same behavior as patients.js's
  // populateBreedSuggestions, scoped to one pet block.
  function populatePetBreeds(block, species, currentValue) {
    var sel = block.querySelector('[data-field="breed"]');
    var breeds = (D.BREED_SUGGESTIONS[species] || []).slice();
    if (breeds.indexOf('Unknown') === -1) breeds.push('Unknown');

    var preserved = (currentValue || '').trim();
    if (preserved && breeds.indexOf(preserved) === -1) breeds.unshift(preserved);

    sel.innerHTML = breeds.map(function (b) {
      return '<option value="' + esc(b) + '">' + esc(b) + '</option>';
    }).join('');
    sel.value = preserved || 'Unknown';
  }

  // ---- Pet photo (per block) ----------------------------------------
  // Same behavior as Add Patient's picker: native image chooser (no
  // capture attribute), preview via a temporary object URL, change and
  // remove. Frontend-only — nothing is uploaded or persisted. State is
  // kept on each block (block._photo) so pets never share a photo.

  var PHOTO_MAX_BYTES = 15 * 1024 * 1024;
  var PHOTO_EXT_RE = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i;

  function isAcceptablePhoto(file) {
    var type = (file.type || '').toLowerCase();
    if (type) return type.indexOf('image/') === 0 && type !== 'image/svg+xml';
    return PHOTO_EXT_RE.test(file.name || '');
  }

  function renderPetPhoto(block) {
    var ph = block._photo;
    var has = !!ph.url;
    var drop = block.querySelector('.pet-photo-drop');
    var img = block.querySelector('.pet-photo-img');
    drop.classList.toggle('has-photo', has);
    drop.setAttribute('aria-label', has ? 'Change pet photo' : 'Add pet photo');
    if (has) img.src = ph.url; else img.removeAttribute('src');
    img.hidden = !has;
    block.querySelector('.pet-photo-empty').hidden = has;
    block.querySelector('.pet-photo-remove').hidden = !has;
    block.querySelector('.pet-photo-change').hidden = !has;
  }

  function clearPetPhoto(block) {
    var ph = block._photo;
    if (!ph) return;
    ph.ticket += 1; // also discards any image still being decoded
    if (ph.url) URL.revokeObjectURL(ph.url);
    ph.file = null;
    ph.url = null;
    if (document.body.contains(block)) renderPetPhoto(block);
  }

  function handlePetPhotoFile(block, file) {
    if (!file) return; // picker cancelled — keep whatever is showing
    var ph = block._photo;

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

    // Confirm the browser can decode it before replacing the current
    // preview, so a bad file never blanks an existing photo.
    ph.ticket += 1;
    var ticket = ph.ticket;
    var probe = new Image();
    probe.onload = function () {
      if (ticket !== ph.ticket) { URL.revokeObjectURL(url); return; }
      if (ph.url && ph.url !== url) URL.revokeObjectURL(ph.url);
      ph.file = file;
      ph.url = url;
      renderPetPhoto(block);
    };
    probe.onerror = function () {
      URL.revokeObjectURL(url);
      if (ticket !== ph.ticket) return;
      showToast('That image could not be read. Try a JPG, PNG, or WEBP');
    };
    probe.src = url;
  }

  function addPetBlock(removable) {
    var container = document.getElementById('pets-container');
    var seq = petBlockSeq++;
    container.insertAdjacentHTML('beforeend', petBlockHtml(seq, removable));
    var block = container.querySelector('[data-pet-block="' + seq + '"]');
    block._photo = { file: null, url: null, ticket: 0 };

    // Same defaults as a fresh Add Patient form.
    block.querySelector('[data-field="species"]').value = 'Dog';
    block.querySelector('[data-field="sex"]').value = 'Unknown';
    block.querySelector('[data-field="vaccinationStatus"]').value = 'Unknown';
    populatePetBreeds(block, 'Dog', '');

    block.querySelector('[data-field="species"]').addEventListener('change', function (e) {
      // Carry the selected breed over to the new species' list, as Add Patient does.
      populatePetBreeds(block, e.target.value, block.querySelector('[data-field="breed"]').value);
    });

    var photoInput = block.querySelector('.pet-photo-input');
    block.querySelector('.pet-photo-drop').addEventListener('click', function () { photoInput.click(); });
    block.querySelector('.pet-photo-change').addEventListener('click', function () { photoInput.click(); });
    block.querySelector('.pet-photo-remove').addEventListener('click', function () { clearPetPhoto(block); });
    photoInput.addEventListener('change', function () {
      var file = photoInput.files && photoInput.files[0];
      photoInput.value = ''; // lets the same file be picked again after a remove
      handlePetPhotoFile(block, file);
    });

    if (removable) {
      block.querySelector('.remove-pet-btn').addEventListener('click', function () {
        clearPetPhoto(block);
        block.remove();
        renumberPetBlocks();
      });
    }

    renumberPetBlocks();
  }

  // Titles come from each block's position: Pet 1 (required), Pet 2, Pet 3…
  function renumberPetBlocks() {
    var blocks = document.querySelectorAll('#pets-container .pet-block');
    blocks.forEach(function (block, i) {
      block.querySelector('.pet-block-title').textContent = 'Pet ' + (i + 1) + (i === 0 ? ' (required)' : '');
    });
  }

  function clearAllPetPhotos() {
    document.querySelectorAll('#pets-container .pet-block').forEach(clearPetPhoto);
  }

  function resetPetsContainer() {
    clearAllPetPhotos();
    document.getElementById('pets-container').innerHTML = '';
    petBlockSeq = 0;
    addPetBlock(false); // first pet block — required, not removable
  }

  function readPetBlock(block) {
    function val(field) {
      var el = block.querySelector('[data-field="' + field + '"]');
      return el ? el.value.trim() : '';
    }
    return {
      pet: val('pet'),
      species: val('species'),
      breed: val('breed'),
      sex: val('sex'),
      dob: val('dob'),
      color: val('color'),
      weight: val('weight'),
      status: val('status'),
      allergies: val('allergies'),
      conditions: val('conditions'),
      medications: val('medications'),
      vaccinationStatus: val('vaccinationStatus'),
      notes: val('notes')
    };
  }

  // An extra pet block that was added but never filled in is ignored on
  // save (as before). Anything typed or picked in it makes it a real pet
  // that has to be completed.
  function isPetBlockUntouched(block, pet) {
    return !pet.pet && !pet.dob && !pet.color && !pet.weight &&
      !pet.allergies && !pet.conditions && !pet.medications && !pet.notes &&
      !(block._photo && block._photo.url);
  }

  function openModal(id) {
    state.editingId = id || null;
    var c = id ? D.getClientById(id) : null;

    document.getElementById('modal-title').textContent = c ? 'Edit Client' : 'Add Client';
    document.getElementById('f-name').value = c ? c.name : '';
    document.getElementById('f-phone').value = c ? c.phone : '';
    document.getElementById('f-email').value = c ? c.email : '';
    document.getElementById('f-status').value = c ? c.status : 'active';
    document.getElementById('f-address').value = c ? c.address : '';
    document.getElementById('f-emergency').value = c ? c.emergencyContact : '';
    document.getElementById('f-notes').value = c ? c.notes : '';

    // Pet registration only applies to brand-new clients — editing an
    // existing client keeps the original, client-fields-only form.
    var petSection = document.getElementById('pet-section');
    if (c) {
      petSection.style.display = 'none';
    } else {
      petSection.style.display = '';
      resetPetsContainer();
    }

    document.getElementById('modal-overlay').classList.add('open');
  }

  function closeModal() {
    document.getElementById('modal-overlay').classList.remove('open');
    state.editingId = null;
    clearAllPetPhotos(); // release the temporary photo previews
  }

  function saveModal() {
    var fields = {
      name: document.getElementById('f-name').value.trim(),
      phone: document.getElementById('f-phone').value.trim(),
      email: document.getElementById('f-email').value.trim(),
      status: document.getElementById('f-status').value,
      address: document.getElementById('f-address').value.trim(),
      emergencyContact: document.getElementById('f-emergency').value.trim(),
      notes: document.getElementById('f-notes').value.trim()
    };

    if (!fields.name || !fields.phone) {
      showToast('Please fill in at least full name and contact number');
      return;
    }

    // Editing an existing client — unchanged behavior, no pet requirement.
    if (state.editingId) {
      D.updateClient(state.editingId, fields);
      showToast('Client updated');
      closeModal();
      renderAll();
      return;
    }

    // Adding a new client — the first pet is required.
    var blocks = Array.prototype.slice.call(document.querySelectorAll('#pets-container .pet-block'));
    var firstPet = blocks.length ? readPetBlock(blocks[0]) : null;

    if (!firstPet || !firstPet.pet) {
      showToast('Please fill in the pet name');
      return;
    }

    var additionalPets = [];
    for (var i = 1; i < blocks.length; i++) {
      var extra = readPetBlock(blocks[i]);
      if (isPetBlockUntouched(blocks[i], extra)) continue; // added but left blank
      if (!extra.pet) {
        showToast('Pet ' + (i + 1) + ': please fill in the pet name, or remove this pet');
        return;
      }
      additionalPets.push(extra);
    }
    var allPets = [firstPet].concat(additionalPets);

    var login = (fields.email || fields.phone).trim();
    if (D.accountExists(login)) {
      showToast('This email/contact number is already registered to another account');
      return;
    }

    var client = D.addClient(fields);

    allPets.forEach(function (p) {
      D.addPatient(Object.assign({}, p, {
        clientId: client.id,
        owner: client.name,
        ownerPhone: client.phone
      }));
    });

    var password = D.buildInitialPassword(firstPet.pet, client.name);
    D.addAccount({ login: login, password: password, role: 'client', clientId: client.id });

    showToast('Client added — ' + allPets.length + ' pet' + (allPets.length === 1 ? '' : 's') + ' registered and a client account was created');

    closeModal();
    renderAll();
  }

  // ------------------------------------------------------------------
  // CLIENT PROFILE
  // ------------------------------------------------------------------

  // Client Profile is now a dedicated page (client-profile.html), opened
  // with the clinic display ID (e.g. ?id=CL-002). The old modal markup and
  // renderProfile() below are intentionally left in place, now unused, so
  // they can be removed in a separate cleanup step.
  function openProfile(id) {
    var c = D.getClientById(id);
    if (!c) return;
    seedClientDisplayIds();
    window.location.href = 'client-profile.html?id=' + encodeURIComponent(displayClientId(c));
  }

  function closeProfile() {
    document.getElementById('profile-overlay').classList.remove('open');
    state.viewingId = null;
  }

  function renderProfile() {
    var c = D.getClientById(state.viewingId);
    var box = document.getElementById('profile-box');
    if (!c) { closeProfile(); return; }

    var pets = D.getPatientsForClient(c);
    var history = D.getAppointmentsForClient(c);
    var lastVisit = D.getLastVisitForClient(c);
    var apptSearchTerm = encodeURIComponent(c.name);

    var petsHtml = !pets.length
      ? '<div class="empty-note">No pets registered under this client yet. Add a patient on the Patients page with this owner\'s name to link them here.</div>'
      : pets.map(function (p) {
          var icon = D.SPECIES_ICON[p.species] || '<i class="fa-solid fa-paw"></i>';
          return '<div class="pet-row">' +
            '<div class="pet-row-main"><div class="pet-row-avatar">' + icon + '</div>' +
              '<div><div class="pet-row-name">' + esc(p.pet) + '</div>' +
              '<div class="pet-row-meta">' + esc(p.species) + (p.breed ? ' · ' + esc(p.breed) : '') + '</div></div></div>' +
            '<div class="pet-row-actions">' +
              '<span class="status-badge status-' + p.status + '">' + (p.status === 'active' ? 'Active' : 'Inactive') + '</span>' +
              '<a class="btn btn-sm" href="patients.html?open=' + encodeURIComponent(p.id) + '"><i class="fa-solid fa-paw"></i> View Patient</a>' +
            '</div>' +
          '</div>';
        }).join('');

    var historyHtml = !history.length
      ? '<div class="empty-note">No appointment history yet.</div>'
      : history.slice(0, 6).map(function (a) {
          return '<div class="history-row">' +
            '<div class="history-main"><span class="h-reason">' + esc(a.pet) + ' — ' + esc(a.reason || 'General visit') + '</span>' +
            '<span class="h-meta">' + D.formatDateLabel(a.date) + ' · ' + D.formatTimeLabel(a.time) + ' · ' + esc(a.vet) + '</span></div>' +
            '<span class="status-badge status-' + a.status + '">' + D.STATUS_LABELS[a.status] + '</span>' +
          '</div>';
        }).join('');

    box.innerHTML =
      '<div class="modal-head">' +
        '<div class="modal-title">Client Profile</div>' +
        '<button class="modal-close" id="profile-close"><i class="fa-solid fa-xmark"></i></button>' +
      '</div>' +

      '<div class="profile-head">' +
        '<div class="profile-avatar">' + esc(initials(c.name)) + '</div>' +
        '<div>' +
          '<div class="profile-name">' + esc(c.name) + '</div>' +
          '<div class="profile-sub">' + pets.length + ' pet' + (pets.length === 1 ? '' : 's') + ' registered · Last visit ' + formatDateShort(lastVisit) + '</div>' +
        '</div>' +
        '<span class="status-badge status-' + c.status + '" style="margin-left:auto;">' + (c.status === 'active' ? 'Active' : 'Inactive') + '</span>' +
      '</div>' +

      '<div class="profile-links">' +
        '<a class="btn btn-sm" href="appointments.html?q=' + apptSearchTerm + '"><i class="fa-solid fa-calendar-days"></i> Appointments</a>' +
        '<a class="btn btn-sm" href="patients.html"><i class="fa-solid fa-paw"></i> Patients</a>' +
        '<a class="btn btn-sm" href="billing.html"><i class="fa-solid fa-credit-card"></i> Billing</a>' +
      '</div>' +

      '<div class="profile-section">' +
        '<div class="profile-section-title"><i class="fa-solid fa-address-card"></i> Contact information</div>' +
        '<div class="profile-grid">' +
          '<div class="profile-field"><span class="pf-label">Contact number</span><span class="pf-value">' + esc(c.phone || '—') + '</span></div>' +
          '<div class="profile-field"><span class="pf-label">Email</span><span class="pf-value">' + esc(c.email || '—') + '</span></div>' +
          '<div class="profile-field" style="grid-column:1/-1;"><span class="pf-label">Address</span><span class="pf-value">' + esc(c.address || '—') + '</span></div>' +
          '<div class="profile-field" style="grid-column:1/-1;"><span class="pf-label">Emergency contact</span><span class="pf-value">' + esc(c.emergencyContact || '—') + '</span></div>' +
        '</div>' +
      '</div>' +

      '<div class="profile-section">' +
        '<div class="profile-section-title"><i class="fa-solid fa-paw"></i> Registered pets</div>' +
        petsHtml +
      '</div>' +

      '<div class="profile-section">' +
        '<div class="profile-section-title"><i class="fa-solid fa-clock-rotate-left"></i> Appointment history</div>' +
        historyHtml +
      '</div>' +

      '<div class="profile-section">' +
        '<div class="profile-section-title"><i class="fa-solid fa-credit-card"></i> Billing / payment history</div>' +
        '<div class="empty-note">Billing records aren\'t tracked yet for this client — that will populate automatically once the Billing module is set up. <a href="billing.html" style="color:var(--teal-600); font-weight:800;">Go to Billing</a>.</div>' +
      '</div>' +

      '<div class="profile-section">' +
        '<div class="profile-section-title"><i class="fa-solid fa-note-sticky"></i> Notes</div>' +
        '<div class="pf-value">' + esc(c.notes || 'No notes yet.') + '</div>' +
      '</div>' +

      '<div class="modal-footer">' +
        '<button class="btn" id="profile-close-btn">Close</button>' +
        '<button class="btn btn-primary" id="profile-edit-btn"><i class="fa-solid fa-pen"></i> Edit client</button>' +
      '</div>';

    document.getElementById('profile-close').addEventListener('click', closeProfile);
    document.getElementById('profile-close-btn').addEventListener('click', closeProfile);
    document.getElementById('profile-edit-btn').addEventListener('click', function () {
      closeProfile();
      openModal(c.id);
    });
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
    document.getElementById('search-input').addEventListener('input', function (e) {
      state.search = e.target.value;
      state.page = 1;
      renderList();
    });
    document.getElementById('filter-status').addEventListener('change', function (e) {
      state.filterStatus = e.target.value;
      state.page = 1;
      renderList();
    });
    document.getElementById('clear-filters').addEventListener('click', function () {
      state.search = ''; state.filterStatus = ''; state.page = 1;
      document.getElementById('search-input').value = '';
      document.getElementById('filter-status').value = '';
      renderList();
    });

    document.getElementById('add-client-btn').addEventListener('click', function () { openModal(null); });
    document.getElementById('add-pet-btn').addEventListener('click', function () { addPetBlock(true); });
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-save').addEventListener('click', saveModal);
    document.getElementById('modal-overlay').addEventListener('click', function (e) {
      if (e.target.id === 'modal-overlay') closeModal();
    });
    document.getElementById('profile-overlay').addEventListener('click', function (e) {
      if (e.target.id === 'profile-overlay') closeProfile();
    });

    // Escape closes the Add/Edit Client modal — same approach as the
    // Add/Edit Patient modal on patients.html: the key press is forwarded
    // to the modal's existing Close button, so it runs exactly the same
    // closeModal() path as clicking it (no separate closing mechanism).
    // Ignored when the modal isn't open, while the client profile modal
    // is open on top, or if something else already handled the key
    // (e.g. a native dropdown or date picker) or an IME is composing.
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
      if (!document.getElementById('modal-overlay').classList.contains('open')) return;
      if (document.getElementById('profile-overlay').classList.contains('open')) return;
      document.getElementById('modal-cancel').click();
    });

    buildPager();
    D.onChange(renderAll);
    renderAll();
  });
})();