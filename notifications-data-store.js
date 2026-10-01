// ============================================================
// PAWSITIVE CARE — Notifications data store
// Attaches onto the shared PCData object (same pattern as
// billing-data-store.js) so it reuses PCData's persistence +
// cross-tab sync (__readRaw/__writeRaw, 'pcv1:change') instead of
// building a parallel storage mechanism.
//
// Source of truth for notification *content* stays Inventory
// (PCData.getInventory / isLowStock / isExpired) — this file does
// NOT store its own copy of inventory data. It only stores the
// notification records themselves (id, read state, timestamps)
// under 'pcv1_notifications'.
// ============================================================

(function (global) {
  // data-store.js (PCData) is the base this file attaches onto. If it
  // isn't loaded (e.g. a misordered <script> tag), do nothing instead of
  // throwing — the same guard predictive-analytics-data-store.js uses.
  if (!global.PCData) return;

  var NOTIF_KEY = 'pcv1_notifications';

  function readRaw(key) { return global.PCData.__readRaw(key); }
  function writeRaw(key, value) { global.PCData.__writeRaw(key, value); }

  function getStored() {
    var v = readRaw(NOTIF_KEY);
    if (!Array.isArray(v)) return [];
    return v.filter(function (n) { return n && typeof n === 'object'; });
  }

  function saveStored(list) {
    writeRaw(NOTIF_KEY, list);
  }

  // Stable id: source type + source id + condition. This IS the
  // dedupe key — regenerating notifications never creates a second
  // entry for the same (item, condition) pair.
  function buildId(sourceType, sourceId, condition) {
    return 'notif_' + sourceType + '_' + sourceId + '_' + condition;
  }

  function mkNotification(fields) {
    var now = Date.now();
    return Object.assign({
      id: '',
      sourceType: 'inventory',
      sourceId: null,
      condition: '',
      category: 'inventory',
      priority: 'medium', // 'high' | 'medium' | 'low'
      title: '',
      message: '',
      read: false,
      createdAt: now
    }, fields);
  }

  // Derive the current set of inventory-driven notifications from
  // live inventory data. Out-of-stock and expired are high priority;
  // low-stock (not yet zero) is medium.
  function deriveInventoryNotifications() {
    var items = global.PCData.getInventory();
    var out = [];

    items.forEach(function (item) {
      if (item.quantity <= 0) {
        out.push(mkNotification({
          id: buildId('inventory', item.id, 'out_of_stock'),
          sourceId: item.id,
          condition: 'out_of_stock',
          priority: 'high',
          title: 'Out of stock',
          message: item.name + ' is out of stock.'
        }));
      } else if (global.PCData.isLowStock(item)) {
        out.push(mkNotification({
          id: buildId('inventory', item.id, 'low_stock'),
          sourceId: item.id,
          condition: 'low_stock',
          priority: 'medium',
          title: 'Low stock',
          message: item.name + ' is low on stock (' + item.quantity + ' ' + (item.unit || '') + ' left, threshold ' + item.lowStockThreshold + ').'
        }));
      }

      if (global.PCData.isExpired(item)) {
        out.push(mkNotification({
          id: buildId('inventory', item.id, 'expired'),
          sourceId: item.id,
          condition: 'expired',
          priority: 'high',
          title: 'Expired inventory',
          message: item.name + ' expired on ' + item.expirationDate + '.'
        }));
      }
    });

    return out;
  }

  // Derive vaccination-driven notifications from live vaccination
  // records (owned by patient-data-store.js). Status comes from
  // PCData.computeVaccinationStatus(), the same due-soon/overdue
  // logic already used on the Patients/Vaccinations UI, so this
  // never re-implements or drifts from that date math. Only records
  // with a Next Due date that resolves to 'Due soon' or 'Overdue'
  // produce a notification; 'Up to date', 'N/A', and 'Unknown' do not.
  function deriveVaccinationNotifications() {
    // Vaccination records live in patient-data-store.js. Whether that
    // file is loaded is checked by sync() (see SOURCES below): a missing
    // dependency means "skip this source", never "no vaccination
    // notifications" — returning [] here would read as "all resolved".

    var records = global.PCData.getVaccinations();
    var out = [];

    records.forEach(function (v) {
      if (!v.nextDue) return;
      var status = global.PCData.computeVaccinationStatus(v.nextDue);
      if (status !== 'Due soon' && status !== 'Overdue') return;

      var patient = global.PCData.getPatientById(v.patientId);
      var petLabel = patient ? (patient.pet + (patient.owner ? ' (' + patient.owner + ')' : '')) : 'A patient';
      var vaccineLabel = v.vaccineName || 'vaccination';

      if (status === 'Overdue') {
        out.push(mkNotification({
          id: buildId('vaccination', v.id, 'overdue'),
          sourceType: 'vaccination',
          sourceId: v.id,
          condition: 'overdue',
          category: 'vaccination',
          priority: 'high',
          title: 'Vaccination overdue',
          message: petLabel + ' is overdue for ' + vaccineLabel + ' (was due ' + v.nextDue + ').'
        }));
      } else {
        out.push(mkNotification({
          id: buildId('vaccination', v.id, 'due_soon'),
          sourceType: 'vaccination',
          sourceId: v.id,
          condition: 'due_soon',
          category: 'vaccination',
          priority: 'medium',
          title: 'Vaccination due soon',
          message: petLabel + ' has ' + vaccineLabel + ' due soon (' + v.nextDue + ').'
        }));
      }
    });

    return out;
  }

  // Statuses that still represent a real, upcoming/active booking.
  // 'cancelled' and 'completed' appointments aren't something staff
  // need to be reminded is "today"/"tomorrow".
  var ACTIVE_APPT_STATUSES = { pending: true, confirmed: true, arrived: true };

  // Derive appointment-driven notifications from live appointment data
  // (PCData.getAppointments). Uses the same date fields/status values
  // and the same todayStr()/dateStr() helpers already used throughout
  // data-store.js — no new date math or thresholds invented here.
  function deriveAppointmentNotifications() {
    var appts = global.PCData.getAppointments();
    var today = global.PCData.todayStr();
    var tomorrow = global.PCData.dateStr(1);
    var out = [];

    appts.forEach(function (a) {
      var petLabel = a.pet + (a.owner ? ' (' + a.owner + ')' : '');
      var timeLabel = global.PCData.formatTimeLabel(a.time);

      if (ACTIVE_APPT_STATUSES[a.status] && a.date === today) {
        out.push(mkNotification({
          id: buildId('appointment', a.id, 'today'),
          sourceType: 'appointment',
          sourceId: a.id,
          condition: 'today',
          category: 'appointment',
          priority: 'high',
          title: 'Appointment today',
          message: petLabel + ' has an appointment today at ' + timeLabel + '.'
        }));
      } else if (ACTIVE_APPT_STATUSES[a.status] && a.date === tomorrow) {
        out.push(mkNotification({
          id: buildId('appointment', a.id, 'tomorrow'),
          sourceType: 'appointment',
          sourceId: a.id,
          condition: 'tomorrow',
          category: 'appointment',
          priority: 'medium',
          title: 'Appointment tomorrow',
          message: petLabel + ' has an appointment tomorrow at ' + timeLabel + '.'
        }));
      }

      // Cancelled, but only while it was still today-or-later — a
      // cancellation of a past appointment isn't actionable, and
      // appointments carry no cancelledAt timestamp to otherwise age
      // this out.
      if (a.status === 'cancelled' && a.date >= today) {
        out.push(mkNotification({
          id: buildId('appointment', a.id, 'cancelled'),
          sourceType: 'appointment',
          sourceId: a.id,
          condition: 'cancelled',
          category: 'appointment',
          priority: 'medium',
          title: 'Appointment cancelled',
          message: petLabel + '\u2019s appointment on ' + a.date + ' at ' + timeLabel + ' was cancelled.'
        }));
      }
    });

    return out;
  }

  // Derive predictive-analytics-driven notifications from
  // PCData.Predictive (predictive-analytics-data-store.js). Only the
  // HIGH-alert-level outputs of that module's own rule-based analysis
  // are turned into notifications — no thresholds, keyword rules, or
  // trend math are reimplemented here, and no weather-adjusted risk
  // bumps are used (those only exist transiently on the Predictive
  // Analytics page once live weather has been fetched there).
  //
  // PCData.Predictive is only attached when
  // predictive-analytics-data-store.js has loaded on the current
  // page, so this is optional the same way vaccination notifications
  // are optional above — a missing module here must never take down
  // inventory/vaccination/appointment notifications.
  function derivePredictiveNotifications() {
    // Availability of PCData.Predictive is checked by sync() (see SOURCES
    // below); this function assumes it is present.
    var out = [];

    var disease = global.PCData.Predictive.getDiseaseRiskAnalysis();
    (disease && disease.categories || []).forEach(function (c) {
      if (!c.hasEnoughData || c.risk !== 'HIGH') return;
      out.push(mkNotification({
        id: buildId('predictive', c.key, 'disease_risk_high'),
        sourceType: 'predictive',
        sourceId: c.key,
        condition: 'disease_risk_high',
        category: 'predictive',
        priority: 'high',
        title: 'Elevated disease risk',
        message: c.label + ': ' + c.reason
      }));
    });

    var medicine = global.PCData.Predictive.getMedicineDemandAnalysis();
    (medicine && medicine.items || []).forEach(function (i) {
      if (!i.hasEnoughData || i.demand !== 'HIGH') return;
      out.push(mkNotification({
        id: buildId('predictive', i.id, 'medicine_demand_high'),
        sourceType: 'predictive',
        sourceId: i.id,
        condition: 'medicine_demand_high',
        category: 'predictive',
        priority: 'high',
        title: 'High medicine demand forecast',
        message: i.name + ': ' + i.reason
      }));
    });

    return out;
  }

  // ------------------------------------------------------------------
  // Settings integration — Settings > Notifications preferences gate
  // which categories of automatic notifications are generated. Read
  // fresh every time (never cached) so a Settings change takes effect
  // on the next sync() without needing a page reload. Falls back to
  // PCSettings' own defaults (all alerts on) if PCSettings is missing,
  // corrupt, or a field is the wrong type.
  // ------------------------------------------------------------------

  function getNotificationPreferences() {
    var fallback = {
      lowStockAlerts: true,
      expiredMedicineAlerts: true,
      vaccinationDueAlerts: true,
      appointmentAlerts: true,
      predictiveAnalyticsAlerts: true
    };

    var section = null;

    // 1) The Settings module, when it is loaded on this page.
    if (global.PCSettings && typeof global.PCSettings.getSettings === 'function') {
      try {
        section = (global.PCSettings.getSettings() || {}).notifications || null;
      } catch (e) {
        section = null;
      }
    }

    // 2) Settings isn't loaded on this page (or failed): read what it
    // already persisted, so a page without settings-data-store.js still
    // honors the saved toggles instead of silently switching every
    // category back on (which would resurrect notifications the user
    // turned off). Read-only; nothing is written to the settings key.
    if (!section) {
      try {
        var raw = global.PCData.__readRaw('pcv1_settings');
        section = (raw && typeof raw === 'object' && raw.notifications && typeof raw.notifications === 'object')
          ? raw.notifications
          : null;
      } catch (e) {
        section = null;
      }
    }

    // 3) Nothing saved / nothing readable: PCSettings' own defaults
    // (all alerts on), applied per field.
    var stored = section || {};
    var prefs = {};
    Object.keys(fallback).forEach(function (key) {
      prefs[key] = (typeof stored[key] === 'boolean') ? stored[key] : fallback[key];
    });
    return prefs;
  }

  // ------------------------------------------------------------------
  // Merge freshly-derived notifications into stored state
  // ------------------------------------------------------------------

  // Source tracking. Each auto-generated source declares the PCData
  // functions it needs and how its Settings toggle gates it. A source
  // only takes part in cleanup (pruning) when it actually ran this pass:
  //   - toggle off in Settings        -> ran, nothing to report (prune)
  //   - a dependency isn't loaded     -> skipped (stored records kept)
  //   - derivation threw              -> skipped (stored records kept)
  //   - derivation completed          -> ran (prune whatever it no
  //                                      longer reports)
  // Skipped sources are never treated as "empty", so read state and
  // createdAt of their existing notifications survive pages that don't
  // load that module.

  function hasFns(obj, names) {
    return names.every(function (n) { return typeof obj[n] === 'function'; });
  }

  var SOURCES = [
    {
      type: 'inventory',
      // Two toggles: "Low Stock Alerts" (low_stock + out_of_stock — both
      // are stock-level concerns, and there's no separate out-of-stock
      // toggle in Settings) and "Expired Medicine Alerts" (expired).
      // Filtering the derived output by condition, rather than touching
      // deriveInventoryNotifications() itself, keeps its detection logic
      // (quantity/threshold/expiration-date math) untouched.
      enabled: function (prefs) { return prefs.lowStockAlerts || prefs.expiredMedicineAlerts; },
      available: function (P) { return hasFns(P, ['getInventory', 'isLowStock', 'isExpired']); },
      derive: function (prefs) {
        return deriveInventoryNotifications().filter(function (n) {
          return n.condition === 'expired' ? prefs.expiredMedicineAlerts : prefs.lowStockAlerts;
        });
      }
    },
    {
      type: 'vaccination',
      enabled: function (prefs) { return prefs.vaccinationDueAlerts; },
      available: function (P) { return hasFns(P, ['getVaccinations', 'computeVaccinationStatus', 'getPatientById']); },
      derive: deriveVaccinationNotifications
    },
    {
      type: 'appointment',
      enabled: function (prefs) { return prefs.appointmentAlerts; },
      available: function (P) { return hasFns(P, ['getAppointments', 'todayStr', 'dateStr', 'formatTimeLabel']); },
      derive: deriveAppointmentNotifications
    },
    {
      type: 'predictive',
      enabled: function (prefs) { return prefs.predictiveAnalyticsAlerts; },
      available: function (P) {
        return !!P.Predictive && hasFns(P.Predictive, ['getDiseaseRiskAnalysis', 'getMedicineDemandAnalysis']);
      },
      derive: derivePredictiveNotifications
    }
  ];

  // One warning per source per page load — enough to notice a real
  // failure (e.g. Predictive loaded without the Medical Records store)
  // without flooding the console on every sync.
  var warnedSources = {};
  function warnOnce(type, err) {
    if (warnedSources[type]) return;
    warnedSources[type] = true;
    if (global.console && typeof global.console.warn === 'function') {
      global.console.warn('[notifications] "' + type + '" notifications skipped; existing ones kept:', err);
    }
  }

  // Runs one source in isolation. Returns the derived notifications when
  // the source ran to completion (an empty array means "ran, nothing to
  // report"), or null when it was skipped.
  function runSource(source, prefs) {
    if (!source.enabled(prefs)) return [];
    try {
      if (!source.available(global.PCData)) return null;
      var result = source.derive(prefs);
      return Array.isArray(result) ? result : null;
    } catch (e) {
      warnOnce(source.type, e);
      return null;
    }
  }

  function sync() {
    var prefs = getNotificationPreferences();

    var derived = [];
    var ranTypes = {};
    SOURCES.forEach(function (source) {
      var items = runSource(source, prefs);
      if (items === null) return; // skipped: leave its stored records alone
      ranTypes[source.type] = true;
      derived = derived.concat(items);
    });

    var derivedById = {};
    derived.forEach(function (n) { derivedById[n.id] = n; });

    // Build the new list in the stored order so a skipped source never
    // reshuffles records (which would rewrite storage and broadcast a
    // change event every time the user moves between pages that load
    // different modules).
    //  - still reported by a source that ran: keep read state + original
    //    createdAt, refresh title/message/priority
    //  - stored record whose source did NOT run (skipped source, or a
    //    sourceType that isn't auto-generated): kept untouched
    //  - stored record whose source ran and no longer reports it: dropped
    //    (e.g. item restocked, vaccination given / next-due date pushed
    //    out, appointment rescheduled away from today/tomorrow, a
    //    prediction that dropped out of HIGH, or its whole category
    //    switched off in Settings > Notifications)
    var stored = getStored();
    var handled = {};
    var finalList = [];

    stored.forEach(function (n) {
      var fresh = derivedById[n.id];
      if (fresh) {
        if (handled[n.id]) return;
        handled[n.id] = true;
        finalList.push(Object.assign({}, n, { message: fresh.message, title: fresh.title, priority: fresh.priority }));
      } else if (!ranTypes[n.sourceType]) {
        finalList.push(n);
      }
    });

    // newly derived notifications not stored yet
    derived.forEach(function (n) {
      if (handled[n.id]) return;
      handled[n.id] = true;
      finalList.push(n);
    });

    // Only persist (and only fire pcv1:change) when something actually
    // changed. sync() runs on every render, and render runs on every
    // onChange tick (1.5s poll) — writing unconditionally would rewrite
    // localStorage and broadcast a change event every cycle even when
    // idle, which is wasted work for every listener on the page.
    if (JSON.stringify(finalList) !== JSON.stringify(stored)) {
      saveStored(finalList);
    }

    return finalList;
  }

  function getNotifications() {
    return sync().sort(function (a, b) { return b.createdAt - a.createdAt; });
  }

  function getUnreadNotifications() {
    return getNotifications().filter(function (n) { return !n.read; });
  }

  function getNotificationCounts() {
    var list = getNotifications();
    var unread = 0, highPriority = 0;
    list.forEach(function (n) {
      if (!n.read) unread++;
      if (n.priority === 'high') highPriority++;
    });
    return { total: list.length, unread: unread, highPriority: highPriority };
  }

  function markAsRead(id) {
    var list = getStored();
    var idx = list.findIndex(function (n) { return n.id === id; });
    if (idx === -1) return null;
    list[idx].read = true;
    saveStored(list);
    return list[idx];
  }

  function markAllAsRead() {
    var list = getStored();
    list.forEach(function (n) { n.read = true; });
    saveStored(list);
    return list;
  }

  global.PCData.getNotifications = getNotifications;
  global.PCData.getUnreadNotifications = getUnreadNotifications;
  global.PCData.getNotificationCounts = getNotificationCounts;
  global.PCData.markAsRead = markAsRead;
  global.PCData.markAllAsRead = markAllAsRead;
})(window);