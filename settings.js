// ============================================================
// PAWSITIVE CARE — Administrator "Settings" page
//
// UI/rendering layer only. All persistence, defaults, and
// missing-field fallback logic lives in settings-data-store.js
// (PCSettings). This file never touches localStorage directly and
// never reimplements the default values.
// ============================================================

(function () {
  // True once the admin has changed something in the form since it was
  // last loaded/saved. Used to avoid clobbering in-progress edits if a
  // PCSettings.onChange() fires in the background (e.g. Settings open
  // in another tab) — the same guard staff-users.js uses around its
  // modal.
  var dirty = false;

  function $(sel, root) { return (root || document).querySelector(sel); }

  // ------------------------------------------------------------------
  // feedback banner
  // ------------------------------------------------------------------

  var feedbackTimer = null;

  function showFeedback(message, type) {
    var el = $('#settings-feedback');
    if (!el) return;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.textContent = message;
    el.className = 'settings-feedback settings-feedback--' + (type === 'error' ? 'error' : 'success');
    el.style.display = 'flex';

    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(function () {
      el.style.display = 'none';
    }, 4000);
  }

  function markDirty() {
    dirty = true;
  }

  // ------------------------------------------------------------------
  // section navigation (in-page, no reloads)
  // ------------------------------------------------------------------

  var SECTIONS = ['clinic', 'scheduling', 'inventory', 'billing', 'notifications', 'appearance', 'privacy', 'system'];

  function showSection(key, updateHash) {
    if (SECTIONS.indexOf(key) === -1) key = 'clinic';
    var placeholder = false;
    SECTIONS.forEach(function (k) {
      var panel = $('#set-panel-' + k);
      var btn = $('.set-nav-btn[data-section="' + k + '"]');
      var active = k === key;
      panel.hidden = !active;
      if (active) {
        btn.setAttribute('aria-current', 'true');
        placeholder = panel.getAttribute('data-placeholder') === 'true';
      } else {
        btn.removeAttribute('aria-current');
      }
    });
    // Save/Reset have nothing to act on in an unbuilt section.
    $('#settings-actions').hidden = placeholder;
    if (updateHash && window.history && history.replaceState) {
      history.replaceState(null, '', '#' + key);
    }
  }

  function sectionFromHash() {
    return window.location.hash.replace('#', '');
  }

  // ------------------------------------------------------------------
  // per-field validation messages
  // ------------------------------------------------------------------

  function clearFieldErrors() {
    document.querySelectorAll('.set-field .set-error').forEach(function (el) { el.remove(); });
    document.querySelectorAll('.set-field input[aria-invalid]').forEach(function (inp) {
      inp.removeAttribute('aria-invalid');
      var ids = (inp.getAttribute('aria-describedby') || '').split(' ').filter(function (x) {
        return x && x !== inp.id + '-error';
      });
      if (ids.length) inp.setAttribute('aria-describedby', ids.join(' '));
      else inp.removeAttribute('aria-describedby');
    });
  }

  function setFieldError(id, message) {
    var inp = document.getElementById(id);
    if (!inp) return;
    var err = document.createElement('div');
    err.className = 'set-error';
    err.id = id + '-error';
    err.textContent = message;
    inp.closest('.set-field').appendChild(err);
    inp.setAttribute('aria-invalid', 'true');
    var ids = (inp.getAttribute('aria-describedby') || '').split(' ').filter(Boolean);
    ids.push(err.id);
    inp.setAttribute('aria-describedby', ids.join(' '));
  }

  // ------------------------------------------------------------------
  // load settings into the form
  // ------------------------------------------------------------------

  function loadForm() {
    var s = window.PCSettings.getSettings();

    $('#set-clinic-name').value = s.clinic.name;
    $('#set-clinic-address').value = s.clinic.address;
    $('#set-clinic-phone').value = s.clinic.phone;
    $('#set-clinic-email').value = s.clinic.email;
    $('#set-clinic-website').value = s.clinic.website;

    $('#set-appt-duration').value = s.appointments.defaultDuration;
    $('#set-appt-open').value = s.appointments.openingTime;
    $('#set-appt-close').value = s.appointments.closingTime;
    $('#set-appt-allow-booking').checked = !!s.appointments.allowClientBooking;

    $('#set-queue-prefix').value = s.queue.prefix;
    $('#set-queue-start').value = s.queue.startingNumber;
    $('#set-queue-autoreset').checked = !!s.queue.autoResetDaily;

    $('#set-notif-lowstock').checked = !!s.notifications.lowStockAlerts;
    $('#set-notif-expired').checked = !!s.notifications.expiredMedicineAlerts;
    $('#set-notif-vaccination').checked = !!s.notifications.vaccinationDueAlerts;
    $('#set-notif-appointment').checked = !!s.notifications.appointmentAlerts;
    $('#set-notif-predictive').checked = !!s.notifications.predictiveAnalyticsAlerts;

    clearFieldErrors();
    dirty = false;
  }

  // ------------------------------------------------------------------
  // read + validate the form
  // ------------------------------------------------------------------

  // Strict whole-number read. A number input hands back '' for text the
  // browser can't parse (e.g. "30abc") and flags it with validity.badInput;
  // anything that is not plain digits (30.5, 1e2, -5) is rejected too.
  // Returns NaN instead of silently truncating like parseInt() would.
  function strictInt(inp) {
    if (inp.validity && inp.validity.badInput) return NaN;
    var s = inp.value.trim();
    if (!/^\d+$/.test(s)) return NaN;
    var n = Number(s);
    return Number.isSafeInteger(n) ? n : NaN;
  }

  // Prefix is normalised to uppercase only when it is purely A-Z/a-z/0-9, so
  // invalid text (spaces, symbols, non-ASCII such as "ß") is left as typed
  // and rejected by validate() instead of being quietly rewritten.
  function readPrefix(raw) {
    return /^[A-Za-z0-9]+$/.test(raw) ? raw.toUpperCase() : raw;
  }

  function readForm() {
    return {
      clinic: {
        name: $('#set-clinic-name').value.trim(),
        address: $('#set-clinic-address').value.trim(),
        phone: $('#set-clinic-phone').value.trim(),
        email: $('#set-clinic-email').value.trim(),
        website: $('#set-clinic-website').value.trim()
      },
      appointments: {
        defaultDuration: strictInt($('#set-appt-duration')),
        openingTime: $('#set-appt-open').value,
        closingTime: $('#set-appt-close').value,
        allowClientBooking: $('#set-appt-allow-booking').checked
      },
      queue: {
        prefix: readPrefix($('#set-queue-prefix').value),
        startingNumber: strictInt($('#set-queue-start')),
        autoResetDaily: $('#set-queue-autoreset').checked
      },
      notifications: {
        lowStockAlerts: $('#set-notif-lowstock').checked,
        expiredMedicineAlerts: $('#set-notif-expired').checked,
        vaccinationDueAlerts: $('#set-notif-vaccination').checked,
        appointmentAlerts: $('#set-notif-appointment').checked,
        predictiveAnalyticsAlerts: $('#set-notif-predictive').checked
      }
    };
  }

  // Website is optional. Accepts http(s) URLs, with or without the scheme
  // (e.g. "www.example.com"). Other schemes (javascript:, mailto:, ftp:) and
  // anything without a real-looking host are rejected.
  function isValidWebsite(value) {
    if (/\s/.test(value)) return false;
    var withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : 'https://' + value;
    try {
      var u = new URL(withScheme);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
      return u.hostname === 'localhost' || /^[^.]+(\.[^.]+)+$/.test(u.hostname);
    } catch (e) {
      return false;
    }
  }

  function validate(v) {
    var errors = [];
    function add(id, message) { errors.push({ id: id, message: message }); }

    if (!v.clinic.name) {
      add('set-clinic-name', 'Clinic Name is required.');
    }
    if (v.clinic.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.clinic.email)) {
      add('set-clinic-email', 'Clinic Email is not a valid email address.');
    }
    if (v.clinic.website && !isValidWebsite(v.clinic.website)) {
      add('set-clinic-website', 'Website is not a valid web address (for example https://www.example.com).');
    }

    if (!Number.isInteger(v.appointments.defaultDuration) || v.appointments.defaultDuration < 5 || v.appointments.defaultDuration > 240) {
      add('set-appt-duration', 'Default Appointment Duration must be a whole number between 5 and 240 minutes.');
    }
    if (!v.appointments.openingTime) {
      add('set-appt-open', 'Opening Time is required.');
    }
    if (!v.appointments.closingTime) {
      add('set-appt-close', 'Closing Time is required.');
    }
    if (v.appointments.openingTime && v.appointments.closingTime && v.appointments.openingTime >= v.appointments.closingTime) {
      add('set-appt-close', 'Opening Time must be earlier than Closing Time.');
    }

    if (!v.queue.prefix) {
      add('set-queue-prefix', 'Queue Prefix is required.');
    } else if (!/^[A-Z0-9]+$/.test(v.queue.prefix)) {
      add('set-queue-prefix', 'Queue Prefix may only contain letters A\u2013Z and digits 0\u20139 (no spaces or symbols).');
    } else if (v.queue.prefix.length > 3) {
      add('set-queue-prefix', 'Queue Prefix should be 3 characters or fewer.');
    }
    if (!Number.isInteger(v.queue.startingNumber) || v.queue.startingNumber < 1) {
      add('set-queue-start', 'Starting Queue Number must be a whole number of at least 1 (no decimals).');
    }

    return errors;
  }

  // ------------------------------------------------------------------
  // actions
  // ------------------------------------------------------------------

  var STORAGE_ERROR = 'Could not save: this browser would not store the settings (storage may be full or blocked). Your changes are still on this page.';

  function handleSave() {
    clearFieldErrors();
    var values = readForm();
    var errors = validate(values);
    if (errors.length) {
      errors.forEach(function (e) { setFieldError(e.id, e.message); });
      var first = document.getElementById(errors[0].id);
      showSection(first.closest('.set-panel').id.replace('set-panel-', ''), true);
      showFeedback(errors[0].message, 'error');
      first.focus();
      return;
    }
    // Section-level save: only the sections this page edits are patched,
    // so sections that are not built yet are never reset.
    var result = window.PCSettings.updateSettings(values);
    if (!result.ok) {
      showFeedback(STORAGE_ERROR, 'error'); // form values and dirty flag stay as they are
      return;
    }
    dirty = false;
    showFeedback('Settings saved successfully.', 'success');
  }

  function handleReset() {
    if (!window.confirm('Reset all settings to their defaults? This cannot be undone.')) return;
    var result = window.PCSettings.resetSettings();
    if (!result.ok) {
      showFeedback(STORAGE_ERROR, 'error');
      return;
    }
    loadForm();
    showFeedback('Settings restored to defaults.', 'success');
  }

  // ------------------------------------------------------------------
  // clinic logo — TEMPORARY PREVIEW ONLY
  //
  // The selected image is held in memory as a blob: object URL. It is
  // never read into a data URL, never written to localStorage, and never
  // passed to PCSettings, so it is NOT part of the saved settings and is
  // gone on reload. Real storage arrives with the backend phase.
  // ------------------------------------------------------------------

  var LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
  var LOGO_MAX_BYTES = 1024 * 1024; // 1 MB
  var logoUrl = null; // current valid preview (object URL), or null

  function clearLogoError() {
    var err = document.getElementById('set-logo-error');
    if (err) err.remove();
    var input = $('#set-logo-input');
    input.removeAttribute('aria-invalid');
    input.setAttribute('aria-describedby', 'set-logo-hint set-logo-status');
  }

  function setLogoError(message) {
    clearLogoError();
    var err = document.createElement('div');
    err.className = 'set-error';
    err.id = 'set-logo-error';
    err.textContent = message;
    $('#set-logo-status').parentNode.appendChild(err);
    var input = $('#set-logo-input');
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', 'set-logo-hint set-logo-status set-logo-error');
    showFeedback(message, 'error');
  }

  function renderLogo(name, size) {
    var img = $('#set-logo-img');
    var has = !!logoUrl;
    if (has) img.src = logoUrl; else img.removeAttribute('src');
    img.hidden = !has;
    $('#set-logo-placeholder').hidden = has;
    $('#set-logo-preview').classList.toggle('has-logo', has);
    $('#set-logo-remove').hidden = !has;
    $('#set-logo-status').textContent = has
      ? name + ' (' + Math.max(1, Math.round(size / 1024)) + ' KB), preview only'
      : 'No logo selected.';
  }

  function handleLogoSelected(file) {
    clearLogoError();
    if (LOGO_TYPES.indexOf(file.type) === -1) {
      setLogoError('Logo must be a PNG, JPG or WebP image.');
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setLogoError('Logo is too large. Please choose an image of 1 MB or less.');
      return;
    }
    var url = URL.createObjectURL(file);
    var probe = new Image();
    probe.onload = function () {
      if (logoUrl) URL.revokeObjectURL(logoUrl);
      logoUrl = url;
      renderLogo(file.name, file.size);
    };
    probe.onerror = function () {
      URL.revokeObjectURL(url); // previous valid logo stays as it was
      setLogoError('That file could not be read as an image. Please choose a different one.');
    };
    probe.src = url;
  }

  function removeLogo() {
    clearLogoError();
    if (logoUrl) URL.revokeObjectURL(logoUrl);
    logoUrl = null;
    renderLogo();
    $('#set-logo-input').focus(); // the Remove button just hid; keep focus in the logo controls
  }

  function wireLogo() {
    var input = $('#set-logo-input');
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      input.value = ''; // allow re-selecting the same file later
      if (file) handleLogoSelected(file);
    });
    $('#set-logo-remove').addEventListener('click', removeLogo);
    window.addEventListener('pagehide', function () {
      if (logoUrl) URL.revokeObjectURL(logoUrl);
    });
    renderLogo();
  }

  // ------------------------------------------------------------------
  // wiring
  // ------------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    loadForm();

    document.querySelectorAll('.set-nav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        showSection(btn.getAttribute('data-section'), true);
      });
    });
    window.addEventListener('hashchange', function () { showSection(sectionFromHash(), false); });
    showSection(sectionFromHash(), false);

    var form = $('#settings-form');
    // The logo is a temporary preview and is not saved, so it never marks the form dirty.
    function onFormEdit(e) { if (e.target.id !== 'set-logo-input') markDirty(); }
    form.addEventListener('input', onFormEdit);
    form.addEventListener('change', onFormEdit);
    wireLogo();

    $('#settings-save-btn').addEventListener('click', function (e) {
      e.preventDefault();
      handleSave();
    });
    $('#settings-reset-btn').addEventListener('click', function (e) {
      e.preventDefault();
      handleReset();
    });

    // Cross-tab / same-tab settings changes (e.g. Settings open in
    // another tab) refresh this form automatically — but only while
    // nothing here is unsaved, so we never overwrite in-progress edits.
    window.PCSettings.onChange(function () {
      if (dirty) return;
      loadForm();
    });
  });
})();