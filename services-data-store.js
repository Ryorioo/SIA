// ============================================================
// PAWSITIVE CARE — services data store
// All Services-specific data logic lives here, in its own
// localStorage key ('pcv1_services'), completely separate from
// data-store.js.
//
// This follows the same pattern already used by
// billing-data-store.js: it does NOT create a competing global
// store. It waits for data-store.js to create window.PCData,
// then attaches its own Services functions onto that same
// object (using PCData.__readRaw / __writeRaw so it shares the
// exact same localStorage + cross-tab sync mechanism as every
// other module) so callers keep using PCData.getServices(),
// PCData.addService(), etc.
//
// LOAD ORDER: data-store.js -> services-data-store.js -> services.js
// data-store.js itself is never read from or written to here.
// ============================================================

(function (global) {
  var SERVICES_KEY = 'pcv1_services';

  var STATUSES = ['Active', 'Inactive'];

  // Known categories offered as suggestions (via the <datalist> in the
  // Add/Edit form). This is not a hard whitelist — addService/updateService
  // accept any category text, and getServiceCategories() below always
  // reflects the categories actually present in stored services.
  var DEFAULT_CATEGORIES = [
    'Consultation',
    'Preventive Care',
    'Grooming',
    'Laboratory',
    'Surgery',
    'Dental Care'
  ];

  function requireStore() {
    if (!global.PCData || typeof global.PCData.__readRaw !== 'function') {
      throw new Error('services-data-store.js requires data-store.js to be loaded first.');
    }
    return global.PCData;
  }

  function readRaw() {
    return requireStore().__readRaw(SERVICES_KEY);
  }

  function writeRaw(value) {
    requireStore().__writeRaw(SERVICES_KEY, value);
  }

  function uid() {
    return 'svc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function mk(fields) {
    var now = Date.now();
    return Object.assign({
      id: uid(),
      name: '',
      category: '',
      price: 0,
      duration: 0,
      description: '',
      status: 'Active',
      createdAt: now,
      updatedAt: now
    }, fields);
  }

  // ------------------------------------------------------------------
  // seed — runs once, only when pcv1_services is empty/missing.
  // Never overwrites or duplicates existing Services.
  // ------------------------------------------------------------------

  function seedIfEmpty() {
    var existing = readRaw();
    if (existing && existing.length) return;

    var defaults = [
      { name: 'General Consultation', category: 'Consultation', price: 500, duration: 30, description: '' },
      { name: 'Vaccination', category: 'Preventive Care', price: 800, duration: 20, description: '' },
      { name: 'Deworming', category: 'Preventive Care', price: 300, duration: 15, description: '' },
      { name: 'Grooming', category: 'Grooming', price: 600, duration: 60, description: '' },
      { name: 'Blood Test', category: 'Laboratory', price: 700, duration: 30, description: '' },
      { name: 'Spay', category: 'Surgery', price: 3500, duration: 90, description: '' },
      { name: 'Neuter', category: 'Surgery', price: 3000, duration: 60, description: '' },
      { name: 'Dental Cleaning', category: 'Dental Care', price: 1500, duration: 60, description: '' }
    ];

    var seed = defaults.map(function (d) {
      return mk(Object.assign({ status: 'Active' }, d));
    });

    writeRaw(seed);
  }

  // ------------------------------------------------------------------
  // public API
  // ------------------------------------------------------------------

  function getServices() {
    seedIfEmpty();
    return readRaw() || [];
  }

  function saveServices(list) {
    writeRaw(list);
  }

  function getServiceById(id) {
    return getServices().find(function (s) { return s.id === id; }) || null;
  }

  function getActiveServices() {
    return getServices().filter(function (s) { return s.status === 'Active'; });
  }

  // Categories actually present in stored services, merged with the
  // known defaults, alphabetized, deduplicated. Always reflects live data.
  function getServiceCategories() {
    var fromData = getServices().map(function (s) { return s.category; }).filter(Boolean);
    var all = DEFAULT_CATEGORIES.concat(fromData);
    var unique = all.filter(function (cat, idx) { return all.indexOf(cat) === idx; });
    return unique.sort(function (a, b) { return a.localeCompare(b); });
  }

  function addService(data) {
    var list = getServices();
    var service = mk(data);
    list.push(service);
    saveServices(list);
    return service;
  }

  function updateService(id, data) {
    var list = getServices();
    var idx = list.findIndex(function (s) { return s.id === id; });
    if (idx === -1) return null;
    Object.assign(list[idx], data, { updatedAt: Date.now() });
    saveServices(list);
    return list[idx];
  }

  // Services are never permanently deleted — only Active/Inactive toggled.
  function setServiceStatus(id, status) {
    if (STATUSES.indexOf(status) === -1) return null;
    return updateService(id, { status: status });
  }

  // ------------------------------------------------------------------
  // Billing helper — lets Billing pull the CURRENT price of an active
  // Service to use as an invoice line item's unit price at the moment
  // the invoice is created. Billing must copy this value onto its own
  // invoice item (not store a live reference), so a later Service price
  // change never retroactively changes an already-created invoice.
  // This intentionally lives here, not in data-store.js or billing's
  // own file, since it's Services-specific lookup logic.
  // ------------------------------------------------------------------

  function getServicePriceSnapshot(id) {
    var svc = getServiceById(id);
    if (!svc) return null;
    return {
      serviceId: svc.id,
      name: svc.name,
      price: svc.price,
      duration: svc.duration
    };
  }

  // ------------------------------------------------------------------
  // Appointments helper — Appointments only needs to list which
  // Services are selectable (Active ones) and resolve a serviceId back
  // to a display-friendly service. This is Services-specific lookup
  // logic, so it lives here rather than in data-store.js.
  // ------------------------------------------------------------------

  function getServiceForAppointment(appt) {
    if (!appt || !appt.serviceId) return null;
    return getServiceById(appt.serviceId);
  }

  global.PCData = global.PCData || {};
  Object.assign(global.PCData, {
    SERVICE_STATUSES: STATUSES,
    SERVICE_DEFAULT_CATEGORIES: DEFAULT_CATEGORIES,
    getServices: getServices,
    saveServices: saveServices,
    getServiceById: getServiceById,
    getActiveServices: getActiveServices,
    getServiceCategories: getServiceCategories,
    addService: addService,
    updateService: updateService,
    setServiceStatus: setServiceStatus,
    getServicePriceSnapshot: getServicePriceSnapshot,
    getServiceForAppointment: getServiceForAppointment
  });
})(window);