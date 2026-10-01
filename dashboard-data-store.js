// ============================================================
// PAWSITIVE CARE — dashboard-specific derived data
//
// Read-only aggregations built strictly on top of the existing
// PCData API defined in data-store.js. This file owns NO
// localStorage key and duplicates NO CRUD/persistence logic — it
// only computes summaries/derived views for the Administrator
// Dashboard, exposed as PCData.Dashboard.
//
// SCOPE NOTE: Patients, Medical Records, and Billing/Invoices each
// live in their own data-store file (patient-data-store.js,
// medical-records-data-store.js, billing-data-store.js) that
// attaches onto this same PCData object at runtime. Of those, only
// getPatients() is used below — it's called directly inside
// data-store.js itself (getPatientsForClient), so its existence and
// shape are confirmed. It's read defensively anyway (typeof check)
// so this file — and the dashboard — still works if
// patient-data-store.js isn't loaded on this page.
//
// Medical Records and Billing/Invoices are NOT touched here. Their
// real field shapes haven't been inspected, so nothing in this file
// (or dashboard.js) reads from them — Recent Activity is derived
// from appointment data only, per current scope.
//
// Load order: data-store.js -> (patient-data-store.js) ->
// dashboard-data-store.js -> dashboard.js
// ============================================================

(function (global) {
  function requireCore() {
    if (!global.PCData) {
      throw new Error('PCData (data-store.js) must be loaded before dashboard-data-store.js');
    }
  }

  // ------------------------------------------------------------------
  // Today's appointments, sorted by time (uses real PCData.getAppointments
  // + PCData.todayStr — both confirmed in data-store.js)
  // ------------------------------------------------------------------
  function getTodayAppointments() {
    requireCore();
    var today = global.PCData.todayStr();
    return global.PCData.getAppointments()
      .filter(function (a) { return a.date === today; })
      .sort(function (a, b) { return (a.time || '').localeCompare(b.time || ''); });
  }

  // ------------------------------------------------------------------
  // Summary card counts.
  // totalPatients is null (not 0) when patient-data-store.js isn't
  // loaded, so the UI can show a clear "unavailable" state rather
  // than an incorrect zero.
  // ------------------------------------------------------------------
  function getSummaryCounts() {
    requireCore();
    var totalPatients = null;
    if (typeof global.PCData.getPatients === 'function') {
      totalPatients = global.PCData.getPatients().length;
    }
    return {
      todayAppointments: getTodayAppointments().length,
      waitingQueue: global.PCData.getWaitingList().length,
      totalPatients: totalPatients,
      lowStockItems: global.PCData.getLowStockItems().length
    };
  }

  // ------------------------------------------------------------------
  // Queue status snapshot — who's being served now, who's waiting.
  // Uses PCData.getServingEntry / getWaitingList / getQueueDisplayInfo,
  // all confirmed in data-store.js.
  // ------------------------------------------------------------------
  function getQueueSnapshot() {
    requireCore();
    var serving = global.PCData.getServingEntry();
    var waiting = global.PCData.getWaitingList();
    return {
      serving: serving ? global.PCData.getQueueDisplayInfo(serving) : null,
      waiting: waiting.map(function (a) { return global.PCData.getQueueDisplayInfo(a); })
    };
  }

  // ------------------------------------------------------------------
  // Inventory alerts — low stock + expired, via PCData's own
  // isLowStock/isExpired-backed getters (confirmed in data-store.js).
  // ------------------------------------------------------------------
  function getInventoryAlerts() {
    requireCore();
    return {
      lowStock: global.PCData.getLowStockItems(),
      expired: global.PCData.getExpiredItems()
    };
  }

  // ------------------------------------------------------------------
  // Recent activity — derived strictly from appointment data.
  //
  // The only genuine timestamp on an appointment record is
  // `arrivedAt` (set by markArrived; preserved through
  // startConsultation/completeConsultation; cleared by
  // cancelAppointment/removeFromQueue). Appointments have no
  // createdAt/updatedAt field. So activity here is limited to
  // appointments that have actually checked in — nothing is
  // backfilled or invented.
  // ------------------------------------------------------------------
  function getRecentActivity(limit) {
    requireCore();
    var max = limit || 8;
    return global.PCData.getAppointments()
      .filter(function (a) { return !!a.arrivedAt; })
      .sort(function (a, b) { return (b.arrivedAt || 0) - (a.arrivedAt || 0); })
      .slice(0, max)
      .map(function (a) {
        var info = global.PCData.getQueueDisplayInfo(a);
        return {
          id: a.id,
          time: a.arrivedAt,
          pet: info.pet,
          species: info.species,
          owner: info.owner,
          status: a.status,
          queueStatus: a.queueStatus,
          queueCode: a.queueCode
        };
      });
  }

  global.PCData = global.PCData || {};
  global.PCData.Dashboard = {
    getTodayAppointments: getTodayAppointments,
    getSummaryCounts: getSummaryCounts,
    getQueueSnapshot: getQueueSnapshot,
    getInventoryAlerts: getInventoryAlerts,
    getRecentActivity: getRecentActivity
  };
})(window);