// ============================================================
// PAWSITIVE CARE — Settings data store
//
// Handles persistence for clinic/system configuration only.
// Deliberately self-contained: it does NOT attach onto PCData and
// does NOT read/write any of PCData's keys. It follows the same
// low-level persistence conventions as data-store.js (readRaw/
// writeRaw, a dedicated change event, cross-tab 'storage' sync,
// safety-net poll) but under its own localStorage key and its own
// namespace, since Settings is not yet wired into Appointments,
// Queue, Notifications, or any other module.
//
// localStorage key: pcv1_settings
// Namespace: window.PCSettings
// ============================================================

(function (global) {
  var SETTINGS_KEY = 'pcv1_settings';
  var CHANGE_EVENT = 'pcv1:settings-change';

  // ------------------------------------------------------------------
  // defaults — centralized here so they're easy to change later
  // ------------------------------------------------------------------

  function getDefaultSettings() {
    return {
      clinic: {
        name: 'Pawsitive Care Veterinary Clinic',
        address: '',
        phone: '',
        email: '',
        website: '' // optional
        // NOTE: the old free-text `clinic.hours` was retired in Phase 2B.
        // Operating hours now live ONLY in appointments.openingTime /
        // appointments.closingTime. A legacy `hours` value that is still in
        // localStorage is left untouched (withDefaults/updateSettings carry
        // unknown keys through) and is simply ignored by the UI.
      },
      appointments: {
        defaultDuration: 30, // minutes
        openingTime: '08:00',
        closingTime: '18:00',
        allowClientBooking: true
      },
      queue: {
        prefix: 'A',
        startingNumber: 1,
        autoResetDaily: true
      },
      notifications: {
        lowStockAlerts: true,
        expiredMedicineAlerts: true,
        vaccinationDueAlerts: true,
        appointmentAlerts: true,
        predictiveAnalyticsAlerts: true
      },
      // Structural placeholders for sections that are not built yet.
      // They are empty on purpose; they only exist so these sections
      // are kept (not dropped) whenever settings are saved.
      inventory: {},
      billing: {},
      appearance: {},
      dataPrivacy: {},
      system: {}
    };
  }

  // ------------------------------------------------------------------
  // low-level persistence (mirrors data-store.js's readRaw/writeRaw)
  // ------------------------------------------------------------------

  function readRaw() {
    try {
      var v = localStorage.getItem(SETTINGS_KEY);
      return v ? JSON.parse(v) : null;
    } catch (e) {
      return null;
    }
  }

  // Returns true if the write worked, false if the browser refused it
  // (storage full, blocked, private mode...). Never throws.
  function writeRaw(value) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
    } catch (e) {
      return false;
    }
    // Fires 'storage' in OTHER tabs automatically. Also notify listeners
    // in THIS tab/page, since the storage event does not fire locally.
    global.dispatchEvent(new CustomEvent(CHANGE_EVENT));
    return true;
  }

  // Merge stored settings over the defaults, section by section, so any
  // field missing from an older/partial stored object (e.g. a settings
  // key added after some users already saved settings) safely falls
  // back to its default instead of being undefined. An entire missing
  // or corrupt section falls back the same way.
  function withDefaults(stored) {
    var defaults = getDefaultSettings();
    if (!stored || typeof stored !== 'object') return defaults;

    var merged = {};
    Object.keys(defaults).forEach(function (section) {
      var storedSection = stored[section];
      merged[section] = Object.assign(
        {},
        defaults[section],
        (storedSection && typeof storedSection === 'object') ? storedSection : {}
      );
    });
    return merged;
  }

  // ------------------------------------------------------------------
  // public API
  // ------------------------------------------------------------------

  function getSettings() {
    return withDefaults(readRaw());
  }

  // The three write functions below return { ok, settings }.
  // ok is false when the browser could not store the data; settings is
  // then what we tried to save, so the caller can keep it on screen.

  // Persists a FULL settings object. Any section missing from it is
  // replaced with defaults, so prefer updateSettings() for section saves.
  function saveSettings(settings) {
    var safe = withDefaults(settings);
    return { ok: writeRaw(safe), settings: safe };
  }

  // Shallow-patches one or more sections without requiring the full
  // object; sections not in the patch are left untouched, e.g. updateSettings({ queue: { prefix: 'B' } }).
  function updateSettings(patch) {
    var current = getSettings();
    var next = {};
    Object.keys(current).forEach(function (section) {
      var patchSection = patch && patch[section];
      next[section] = Object.assign(
        {},
        current[section],
        (patchSection && typeof patchSection === 'object') ? patchSection : {}
      );
    });
    return { ok: writeRaw(next), settings: next };
  }

  function resetSettings() {
    var defaults = getDefaultSettings();
    return { ok: writeRaw(defaults), settings: defaults };
  }

  // ------------------------------------------------------------------
  // live sync — same cross-tab/same-tab pattern as PCData.onChange
  // ------------------------------------------------------------------

  function onChange(cb) {
    global.addEventListener('storage', function (e) {
      if (!e.key || e.key === SETTINGS_KEY) cb();
    });
    global.addEventListener(CHANGE_EVENT, cb);
    // Safety-net poll in case a storage event is missed/throttled by the browser.
    setInterval(cb, 1500);
  }

  global.PCSettings = {
    getDefaultSettings: getDefaultSettings,
    getSettings: getSettings,
    saveSettings: saveSettings,
    updateSettings: updateSettings,
    resetSettings: resetSettings,
    onChange: onChange
  };
})(window);