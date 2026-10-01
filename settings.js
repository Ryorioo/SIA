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
  // load settings into the form
  // ------------------------------------------------------------------

  function loadForm() {
    var s = window.PCSettings.getSettings();

    $('#set-clinic-name').value = s.clinic.name;
    $('#set-clinic-address').value = s.clinic.address;
    $('#set-clinic-phone').value = s.clinic.phone;
    $('#set-clinic-email').value = s.clinic.email;
    $('#set-clinic-hours').value = s.clinic.hours;

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

    dirty = false;
  }

  // ------------------------------------------------------------------
  // read + validate the form
  // ------------------------------------------------------------------

  function readForm() {
    return {
      clinic: {
        name: $('#set-clinic-name').value.trim(),
        address: $('#set-clinic-address').value.trim(),
        phone: $('#set-clinic-phone').value.trim(),
        email: $('#set-clinic-email').value.trim(),
        hours: $('#set-clinic-hours').value.trim()
      },
      appointments: {
        defaultDuration: parseInt($('#set-appt-duration').value, 10),
        openingTime: $('#set-appt-open').value,
        closingTime: $('#set-appt-close').value,
        allowClientBooking: $('#set-appt-allow-booking').checked
      },
      queue: {
        prefix: $('#set-queue-prefix').value.trim().toUpperCase(),
        startingNumber: parseInt($('#set-queue-start').value, 10),
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

  function validate(v) {
    var errors = [];

    if (!v.clinic.name) {
      errors.push('Clinic Name is required.');
    }
    if (v.clinic.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.clinic.email)) {
      errors.push('Clinic Email is not a valid email address.');
    }

    if (!Number.isInteger(v.appointments.defaultDuration) || v.appointments.defaultDuration < 5 || v.appointments.defaultDuration > 240) {
      errors.push('Default Appointment Duration must be a whole number between 5 and 240 minutes.');
    }
    if (!v.appointments.openingTime || !v.appointments.closingTime) {
      errors.push('Opening Time and Closing Time are both required.');
    } else if (v.appointments.openingTime >= v.appointments.closingTime) {
      errors.push('Opening Time must be earlier than Closing Time.');
    }

    if (!v.queue.prefix) {
      errors.push('Queue Prefix is required.');
    } else if (v.queue.prefix.length > 3) {
      errors.push('Queue Prefix should be 3 characters or fewer.');
    }
    if (!Number.isInteger(v.queue.startingNumber) || v.queue.startingNumber < 1) {
      errors.push('Starting Queue Number must be a whole number of at least 1.');
    }

    return errors;
  }

  // ------------------------------------------------------------------
  // actions
  // ------------------------------------------------------------------

  function handleSave() {
    var values = readForm();
    var errors = validate(values);
    if (errors.length) {
      showFeedback(errors[0], 'error');
      return;
    }
    window.PCSettings.saveSettings(values);
    dirty = false;
    showFeedback('Settings saved successfully.', 'success');
  }

  function handleReset() {
    if (!window.confirm('Reset all settings to their defaults? This cannot be undone.')) return;
    window.PCSettings.resetSettings();
    loadForm();
    showFeedback('Settings restored to defaults.', 'success');
  }

  // ------------------------------------------------------------------
  // wiring
  // ------------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    loadForm();

    var form = $('#settings-form');
    form.addEventListener('input', markDirty);
    form.addEventListener('change', markDirty);

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