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
  var NOTIF_KEY = 'pcv1_notifications';

  function readRaw(key) { return global.PCData.__readRaw(key); }
  function writeRaw(key, value) { global.PCData.__writeRaw(key, value); }

  function getStored() {
    return readRaw(NOTIF_KEY) || [];
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
    // Vaccination records live in patient-data-store.js. If that file
    // isn't loaded on a given page, skip vaccination notifications
    // rather than throwing — a missing optional dependency should
    // never take down inventory notifications, which don't need it.
    if (typeof global.PCData.getVaccinations !== 'function') return [];

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
    if (!global.PCData.Predictive) return [];

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

  // Merge freshly-derived notifications into stored state:
  // - keep existing read/createdAt for ids that still apply
  // - add new notifications for newly-triggered conditions
  // - drop stored auto-generated notifications whose condition no
  //   longer applies (e.g. item was restocked)
  function sync() {
    var derived = deriveInventoryNotifications().concat(deriveVaccinationNotifications()).concat(deriveAppointmentNotifications()).concat(derivePredictiveNotifications());
    var derivedIds = {};
    derived.forEach(function (n) { derivedIds[n.id] = true; });

    var stored = getStored();
    var storedById = {};
    stored.forEach(function (n) { storedById[n.id] = n; });

    var merged = derived.map(function (n) {
      var existing = storedById[n.id];
      if (existing) {
        // preserve read state + original createdAt + latest message
        return Object.assign({}, existing, { message: n.message, title: n.title, priority: n.priority });
      }
      return n;
    });

    // keep any stored notifications that are NOT auto-generated
    // (future-proofing for other sourceTypes) plus drop stale ones
    // for auto-generated sourceTypes ('inventory', 'vaccination',
    // 'appointment', 'predictive') no longer in derivedIds (e.g. item
    // restocked, vaccination given / next-due date pushed out so it's
    // no longer due soon/overdue, an appointment rescheduled away
    // from today/tomorrow, or a disease-risk/medicine-demand
    // prediction that has dropped out of HIGH)
    var AUTO_SOURCE_TYPES = { inventory: true, vaccination: true, appointment: true, predictive: true };
    var others = stored.filter(function (n) {
      return !AUTO_SOURCE_TYPES[n.sourceType] || derivedIds[n.id];
    }).filter(function (n) {
      // avoid double-adding ones already included in merged
      return !derivedIds[n.id];
    });

    var finalList = merged.concat(others);

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

  // ============================================================
  // Client (Pet Owner) scoping — added for client-notifications.js.
  //
  // Does NOT add any new notification-generation logic and does NOT
  // introduce a second notification store: it reads the exact same
  // sync()/getNotifications() output derived above and filters it
  // down to the records that actually belong to one Client.
  //
  // Ownership is resolved through real, stable relationships already
  // in the data model — never by matching on title/message text:
  //   - 'appointment' notifications: sourceId is an Appointment id
  //     (see deriveAppointmentNotifications above). An appointment
  //     belongs to a client when it shows up in
  //     PCData.getAppointmentsForClient(client) (data-store.js),
  //     which itself resolves a client's pets via getPatientsForClient
  //     (clientId match, with legacy owner-name fallback) and then
  //     that pet's appointments via getAppointmentsForPatient — the
  //     same resolution chain client-appointments.js / client-queue.js
  //     already trust.
  //   - 'vaccination' notifications: sourceId is a vaccination record
  //     id (see deriveVaccinationNotifications above). A vaccination
  //     record belongs to a client when it appears in
  //     getVaccinationsForPatientId(p.id) for one of that client's own
  //     patients (patient-data-store.js) — the same function
  //     client-vaccinations.js already uses.
  //
  // 'inventory' and 'predictive' notifications are staff-only
  // operational signals (stock levels, disease/demand forecasts) with
  // no per-client owner at all — they are categorically excluded
  // below regardless of sourceId, so a Client can never see them no
  // matter what.
  // ============================================================

  // Categories a Client is ever allowed to see. Kept as an explicit
  // allowlist (rather than "everything except inventory/predictive")
  // so that any future auto-generated category defaults to hidden
  // from Clients until someone deliberately decides otherwise.
  var CLIENT_VISIBLE_CATEGORIES = { appointment: true, vaccination: true };

  // Fresh set of this client's own appointment ids + vaccination
  // record ids, recomputed on every call (never cached) so it always
  // reflects the client's CURRENT pets/appointments — e.g. a pet
  // transferred to another client, or a new pet just registered,
  // is picked up immediately with no stale ownership window.
  function getClientSourceIds(client) {
    var apptIds = {};
    var vaccIds = {};
    if (!client) return { apptIds: apptIds, vaccIds: vaccIds };

    if (typeof global.PCData.getAppointmentsForClient === 'function') {
      global.PCData.getAppointmentsForClient(client).forEach(function (a) {
        apptIds[a.id] = true;
      });
    }

    if (typeof global.PCData.getPatientsForClient === 'function' && typeof global.PCData.getVaccinationsForPatientId === 'function') {
      global.PCData.getPatientsForClient(client).forEach(function (p) {
        global.PCData.getVaccinationsForPatientId(p.id).forEach(function (v) {
          vaccIds[v.id] = true;
        });
      });
    }

    return { apptIds: apptIds, vaccIds: vaccIds };
  }

  function belongsToClient(n, sourceIds) {
    if (!CLIENT_VISIBLE_CATEGORIES[n.category]) return false;
    if (n.sourceType === 'appointment') return !!sourceIds.apptIds[n.sourceId];
    if (n.sourceType === 'vaccination') return !!sourceIds.vaccIds[n.sourceId];
    return false;
  }

  function getNotificationsForClient(client) {
    var sourceIds = getClientSourceIds(client);
    return getNotifications().filter(function (n) { return belongsToClient(n, sourceIds); });
  }

  function getUnreadNotificationsForClient(client) {
    return getNotificationsForClient(client).filter(function (n) { return !n.read; });
  }

  function getNotificationCountsForClient(client) {
    var list = getNotificationsForClient(client);
    var unread = 0, highPriority = 0;
    list.forEach(function (n) {
      if (!n.read) unread++;
      if (n.priority === 'high') highPriority++;
    });
    return { total: list.length, unread: unread, highPriority: highPriority };
  }

  // Defense-in-depth (same spirit as client-appointments.js re-verifying
  // a pet belongs to the logged-in client before booking): re-checks
  // ownership against fresh source ids before flipping read state, so
  // a forged/stale id passed from the page can never mark another
  // client's notification read.
  function markAsReadForClient(client, id) {
    var sourceIds = getClientSourceIds(client);
    var list = getStored();
    var idx = list.findIndex(function (n) { return n.id === id; });
    if (idx === -1) return null;
    if (!belongsToClient(list[idx], sourceIds)) return null;
    list[idx].read = true;
    saveStored(list);
    return list[idx];
  }

  // Marks only THIS client's own visible notifications as read —
  // never touches inventory/predictive notifications or another
  // client's appointment/vaccination notifications, even though they
  // all live in the same shared 'pcv1_notifications' list.
  function markAllAsReadForClient(client) {
    var sourceIds = getClientSourceIds(client);
    var list = getStored();
    list.forEach(function (n) {
      if (belongsToClient(n, sourceIds)) n.read = true;
    });
    saveStored(list);
    return getNotificationsForClient(client);
  }

  global.PCData.getNotificationsForClient = getNotificationsForClient;
  global.PCData.getUnreadNotificationsForClient = getUnreadNotificationsForClient;
  global.PCData.getNotificationCountsForClient = getNotificationCountsForClient;
  global.PCData.markAsReadForClient = markAsReadForClient;
  global.PCData.markAllAsReadForClient = markAllAsReadForClient;
})(window);