// ============================================================
// PAWSITIVE CARE — shared data store
// Single source of truth for Appointments + Queue, persisted to
// localStorage so the Appointments page and the Queue display
// stay in sync — including across separate browser tabs/windows,
// which is what lets a waiting-room screen update in real time
// as front-desk staff make changes.
//
// NOTE: Billing (Invoices + Payments) used to live in this file
// and has been extracted into billing-data-store.js. That file
// attaches its functions onto this same PCData object at runtime,
// so every existing PCData.getInvoices()/addInvoice()/etc. call
// keeps working — it just requires billing-data-store.js to be
// loaded (after this file, before billing.js). See __readRaw /
// __writeRaw below, which are exposed specifically so that file
// can persist its own keys through the same storage + cross-tab
// sync mechanism used everywhere else in this store.
// ============================================================

(function (global) {
  var APPTS_KEY = 'pcv1_appointments';
  var COUNTER_KEY = 'pcv1_queue_counter';

  // Dedicated marker for the Queue's own demo/test data (see the
  // "QUEUE DEMO DATA" section below, near removeFromQueue). Kept as
  // its own localStorage key — separate from APPTS_KEY/COUNTER_KEY —
  // so the demo appointments it creates can always be found and
  // removed precisely by id, without touching anything real the user
  // has entered.
  var QUEUE_DEMO_KEY = 'pcv1_queue_demo_meta';

  // 'pending' is kept as the internal key for the first workflow stage —
  // only its UI label changed to "Scheduled" (see STATUS_LABELS below) —
  // so every appointment already saved under the old status system keeps
  // working with no migration needed. 'consultation' and 'no-show' are
  // new, real stored statuses (previously "In Consultation" was only a
  // visual timeline waypoint with no backing status value; see
  // detailsStatusTimelineHtml() in appointments.js).
  var STATUSES = ['pending', 'confirmed', 'arrived', 'consultation', 'completed', 'cancelled', 'no-show'];

  var STATUS_LABELS = {
    pending: 'Scheduled',
    confirmed: 'Confirmed',
    arrived: 'Arrived',
    consultation: 'In Consultation',
    completed: 'Completed',
    cancelled: 'Cancelled',
    'no-show': 'No-show'
  };

  var VETS = ['Dr. Santos', 'Dr. Reyes', 'Dr. Cruz'];

  // Dedicated appointment-type classification, stored on the appointment
  // itself (appointmentType) rather than inferred from the free-text
  // `reason` field. Legacy appointments saved before this field existed
  // simply don't have it — see mk() below, which leaves it unset (null)
  // rather than guessing a value, and every place that reads it must
  // treat null/undefined as "unspecified".
  var APPOINTMENT_TYPES = ['Consultation', 'Vaccination', 'Follow-up', 'Grooming', 'Surgery', 'Diagnostic', 'Emergency'];

  var SPECIES = ['Dog', 'Cat', 'Rabbit', 'Bird', 'Other'];

  var SPECIES_ICON = {
    Dog: '<i class="fa-solid fa-dog"></i>',
    Cat: '<i class="fa-solid fa-cat"></i>',
    Rabbit: '<i class="fa-solid fa-paw"></i>',
    Bird: '<i class="fa-solid fa-dove"></i>',
    Other: '<i class="fa-solid fa-paw"></i>'
  };

  // ------------------------------------------------------------------
  // date helpers (local time, no timezone drift)
  // ------------------------------------------------------------------

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function dateStr(offsetDays) {
    var d = new Date();
    d.setDate(d.getDate() + (offsetDays || 0));
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function todayStr() {
    return dateStr(0);
  }

  function formatDateLabel(iso) {
    var d = parseDate(iso);
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function parseDate(iso) {
    var parts = iso.split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function formatTimeLabel(hhmm) {
    var parts = hhmm.split(':');
    var h = parseInt(parts[0], 10);
    var m = parts[1];
    var ampm = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12;
    if (h12 === 0) h12 = 12;
    return h12 + ':' + m + ' ' + ampm;
  }

  function uid() {
    return 'apt_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  // ------------------------------------------------------------------
  // persistence
  // ------------------------------------------------------------------

  function readRaw(key) {
    try {
      var v = localStorage.getItem(key);
      return v ? JSON.parse(v) : null;
    } catch (e) {
      return null;
    }
  }

  function writeRaw(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
    // Fires 'storage' in OTHER tabs automatically. Also notify listeners
    // in THIS tab/page, since the storage event does not fire locally.
    global.dispatchEvent(new CustomEvent('pcv1:change'));
  }

  function seedIfEmpty() {
    var existing = readRaw(APPTS_KEY);
    if (existing && existing.length) return;

    var seed = [
      // --- today: already checked in, live in the queue ---
      mk({ pet: 'Max', species: 'Dog', owner: 'Renz Villanueva', phone: '0917 220 4481', vet: 'Dr. Santos', date: dateStr(0), time: '09:00', reason: 'Consultation', status: 'arrived', queueCode: 'A-05', queueStatus: 'in-consultation', arrivedAt: Date.now() - 1000 * 60 * 18 }),
      mk({ pet: 'Bella', species: 'Dog', owner: 'Ana Marasigan', phone: '0918 552 3390', vet: 'Dr. Reyes', date: dateStr(0), time: '09:15', reason: 'Vaccination', status: 'arrived', queueCode: 'A-06', queueStatus: 'waiting', arrivedAt: Date.now() - 1000 * 60 * 12 }),
      mk({ pet: 'Luna', species: 'Cat', owner: 'Kyle Domingo', phone: '0919 004 7712', vet: 'Dr. Cruz', date: dateStr(0), time: '09:30', reason: 'Skin check-up', status: 'arrived', queueCode: 'A-07', queueStatus: 'waiting', arrivedAt: Date.now() - 1000 * 60 * 7 }),
      mk({ pet: 'Milo', species: 'Cat', owner: 'Grace Panganiban', phone: '0920 771 5528', vet: 'Dr. Santos', date: dateStr(0), time: '09:45', reason: 'Deworming', status: 'arrived', queueCode: 'A-08', queueStatus: 'waiting', arrivedAt: Date.now() - 1000 * 60 * 3 }),

      // --- today: not yet arrived ---
      mk({ pet: 'Coco', species: 'Rabbit', owner: 'Miguel Torres', phone: '0917 004 2261', vet: 'Dr. Reyes', date: dateStr(0), time: '10:30', reason: 'Nail trim', status: 'confirmed' }),
      mk({ pet: 'Simba', species: 'Dog', owner: 'Patricia Uy', phone: '0928 441 0932', vet: 'Dr. Cruz', date: dateStr(0), time: '11:00', reason: 'Follow-up checkup', status: 'pending' }),
      mk({ pet: 'Daisy', species: 'Dog', owner: 'Noel Ferrer', phone: '0915 662 8871', vet: 'Dr. Santos', date: dateStr(0), time: '13:30', reason: 'Grooming', status: 'confirmed' }),

      // --- today: already finished / called off ---
      mk({ pet: 'Kiko', species: 'Bird', owner: 'Ella Santiago', phone: '0917 883 0045', vet: 'Dr. Reyes', date: dateStr(0), time: '08:00', reason: 'Wing check', status: 'completed' }),
      mk({ pet: 'Chichi', species: 'Cat', owner: 'Ramon Aquino', phone: '0919 223 6604', vet: 'Dr. Cruz', date: dateStr(0), time: '08:30', reason: 'Vomiting, lethargy', status: 'cancelled' }),

      // --- tomorrow ---
      mk({ pet: 'Rocky', species: 'Dog', owner: 'Bea Lozada', phone: '0921 330 8845', vet: 'Dr. Santos', date: dateStr(1), time: '09:00', reason: 'Annual vaccination', status: 'confirmed' }),
      mk({ pet: 'Snowy', species: 'Cat', owner: 'Ivan Custodio', phone: '0917 660 1123', vet: 'Dr. Cruz', date: dateStr(1), time: '10:00', reason: 'Dental cleaning', status: 'pending' }),
      mk({ pet: 'Ollie', species: 'Rabbit', owner: 'Faith Manalo', phone: '0918 774 2290', vet: 'Dr. Reyes', date: dateStr(1), time: '14:00', reason: 'Weight check', status: 'confirmed' }),

      // --- day after tomorrow ---
      mk({ pet: 'Zeus', species: 'Dog', owner: 'Carlo Beltran', phone: '0920 118 4432', vet: 'Dr. Santos', date: dateStr(2), time: '11:30', reason: 'Limping, right leg', status: 'pending' }),

      // --- yesterday (history) ---
      mk({ pet: 'Mochi', species: 'Cat', owner: 'Trisha Ramos', phone: '0917 552 9081', vet: 'Dr. Reyes', date: dateStr(-1), time: '15:00', reason: 'Spay surgery follow-up', status: 'completed' }),
      mk({ pet: 'Bruno', species: 'Dog', owner: 'Dennis Ocampo', phone: '0919 448 3320', vet: 'Dr. Cruz', date: dateStr(-1), time: '16:00', reason: 'Ear infection', status: 'completed' })
    ];

    writeRaw(APPTS_KEY, seed);
    writeRaw(COUNTER_KEY, { date: dateStr(0), n: 8 });
  }

  function mk(fields) {
    return Object.assign({
      id: uid(),
      patientId: null,  // set by the Appointments flow when booked against a real Patient; legacy rows leave this null and fall back to the fields below
      clientId: null,   // set by the Appointments flow when booked against a real Client; legacy rows leave this null and fall back to the fields below
      pet: '',
      species: 'Dog',
      owner: '',
      phone: '',
      vet: VETS[0],
      date: todayStr(),
      time: '09:00',
      reason: '',
      appointmentType: null, // unset until explicitly chosen — never inferred from `reason`; see APPOINTMENT_TYPES note above
      status: 'pending',
      notes: '',
      queueCode: null,
      queueStatus: null,
      arrivedAt: null
    }, fields);
  }

  // ------------------------------------------------------------------
  // public API
  // ------------------------------------------------------------------

  // One-time repair (per page load) for rows already saved under the old
  // Appointments-page model, where an active consultation was stored as
  // status = 'consultation'. That status is no longer used for an active
  // consultation, so such a row would otherwise be stranded: invisible to
  // getTodayQueue() and no longer completable. The row still carries the
  // queueCode/arrivedAt it got at check-in, so it only has to be put back
  // into the Queue model. The old model had no one-active-patient guard,
  // so at most one such row becomes the active consultation; any others
  // go back to 'waiting' rather than producing a second serving entry.
  var legacyConsultationChecked = false;
  function repairLegacyConsultationStatus() {
    if (legacyConsultationChecked) return;
    legacyConsultationChecked = true;
    var list = readRaw(APPTS_KEY) || [];
    var legacy = list.filter(function (a) { return a.status === 'consultation'; });
    if (!legacy.length) return;
    legacy.sort(function (a, b) { return (a.arrivedAt || 0) - (b.arrivedAt || 0); });
    var activeId = getServingEntry() ? null : legacy[0].id;
    legacy.forEach(function (a) {
      a.status = 'arrived';
      a.queueStatus = (a.id === activeId) ? 'in-consultation' : 'waiting';
    });
    saveAppointments(list);
  }

  function getAppointments() {
    seedIfEmpty();
    repairLegacyConsultationStatus();
    maybeAutoSeedQueueDemo();
    return readRaw(APPTS_KEY) || [];
  }

  function saveAppointments(list) {
    writeRaw(APPTS_KEY, list);
  }

  function getById(id) {
    return getAppointments().find(function (a) { return a.id === id; });
  }

  function addAppointment(fields) {
    var list = getAppointments();
    list.push(mk(fields));
    saveAppointments(list);
  }

  function updateAppointment(id, patch) {
    var list = getAppointments();
    var idx = list.findIndex(function (a) { return a.id === id; });
    if (idx === -1) return;
    Object.assign(list[idx], patch);
    saveAppointments(list);
  }

  function confirmAppointment(id) {
    updateAppointment(id, { status: 'confirmed' });
  }

  function cancelAppointment(id) {
    updateAppointment(id, { status: 'cancelled', queueCode: null, queueStatus: null, arrivedAt: null });
  }

  // ------------------------------------------------------------------
  // Vet scheduling conflict check — centralized here so the calendar's
  // drag-and-drop reschedule AND the Add/Edit Appointment modal can
  // both use the same "same vet, same date, overlapping time range"
  // rule instead of each growing its own copy.
  //
  // Appointments never carry their own stored duration (see the note
  // on layoutDayEvents in appointments.js) — every appointment uses
  // the clinic's single configured duration from Settings. That means
  // overlap is just two equal-length ranges intersecting, and
  // durationMin is passed in by the caller (already resolved from
  // Settings via getApptWindow()) rather than re-read here, so this
  // stays a small, pure, Settings-independent function.
  //
  // Cancelled and no-show appointments no longer hold the vet's time
  // and are excluded from the check; pending, confirmed, arrived,
  // consultation, and completed all still count as occupying their
  // slot. This only decides which *existing* appointments block a
  // new placement — it doesn't change which statuses can themselves
  // be dragged or edited (that's unchanged, decided elsewhere).
  function hhmmToMinutes(hhmm) {
    if (!hhmm || typeof hhmm !== 'string') return null;
    var parts = hhmm.split(':');
    var h = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
  }

  // Returns the first conflicting appointment (or null). id, if given,
  // is the appointment being moved/edited and is excluded from its own
  // conflict check.
  function findApptConflict(vet, date, startMin, durationMin, id) {
    if (!vet || !date || startMin == null || !durationMin) return null;
    var endMin = startMin + durationMin;
    var list = getAppointments();
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (a.id === id) continue;
      if (a.vet !== vet || a.date !== date) continue;
      if (a.status === 'cancelled' || a.status === 'no-show') continue;
      var aStart = hhmmToMinutes(a.time);
      if (aStart == null) continue;
      var aEnd = aStart + durationMin;
      if (startMin < aEnd && aStart < endMin) return a;
    }
    return null;
  }

  // Reads the Queue section of PCSettings, sanitized against — and
  // falling back to — PCSettings' own defaults for any value that's
  // missing, the wrong type, or out of range. Also falls back safely
  // if PCSettings itself isn't loaded on this page.
  function getQueueNumberingSettings() {
    var fallback = { prefix: 'A', startingNumber: 1, autoResetDaily: true };
    if (!global.PCSettings || typeof global.PCSettings.getSettings !== 'function') {
      return fallback;
    }
    try {
      var stored = (global.PCSettings.getSettings() || {}).queue || {};
      var prefix = (typeof stored.prefix === 'string' && stored.prefix.trim() !== '')
        ? stored.prefix.trim()
        : fallback.prefix;
      var startingNumber = Number(stored.startingNumber);
      if (!isFinite(startingNumber) || startingNumber < 1) startingNumber = fallback.startingNumber;
      startingNumber = Math.floor(startingNumber);
      var autoResetDaily = (typeof stored.autoResetDaily === 'boolean') ? stored.autoResetDaily : fallback.autoResetDaily;
      return { prefix: prefix, startingNumber: startingNumber, autoResetDaily: autoResetDaily };
    } catch (e) {
      return fallback;
    }
  }

  function nextQueueCode() {
    var cfg = getQueueNumberingSettings();
    var baseline = cfg.startingNumber - 1; // first code issued will be n+1 = startingNumber

    var counter = readRaw(COUNTER_KEY);
    if (!counter || typeof counter.n !== 'number' || !counter.date) {
      // No counter yet (first run / corrupt data) — start fresh at the
      // configured starting number.
      counter = { date: todayStr(), n: baseline };
    } else if (counter.date !== todayStr()) {
      if (cfg.autoResetDaily) {
        // New calendar day + auto-reset enabled -> start over at the
        // configured starting number.
        counter = { date: todayStr(), n: baseline };
      } else {
        // New calendar day but auto-reset disabled -> keep numbering
        // running from where it left off; just stamp today's date.
        counter = { date: todayStr(), n: counter.n };
      }
    }
    // else: same day, same running counter -> just keep incrementing.

    counter.n += 1;
    writeRaw(COUNTER_KEY, counter);
    return cfg.prefix + '-' + pad2(counter.n);
  }

  // Front desk marks a scheduled appointment as arrived -> enters the queue
  function markArrived(id) {
    var appt = getById(id);
    if (!appt) return null;
    // Cancelled/completed appointments can't (re-)enter the active queue.
    if (appt.status === 'cancelled' || appt.status === 'completed') return null;
    // Already arrived and still active in today's queue (waiting/called/
    // in-consultation) — return the existing code instead of generating a
    // new one and resetting arrivedAt, which would create a duplicate-in-
    // effect entry and unfairly bump the patient's place in line.
    if (appt.status === 'arrived' && (appt.queueStatus === 'waiting' || appt.queueStatus === 'called' || appt.queueStatus === 'in-consultation')) {
      return appt.queueCode;
    }
    var code = nextQueueCode();
    updateAppointment(id, {
      status: 'arrived',
      queueCode: code,
      queueStatus: 'waiting',
      arrivedAt: Date.now()
    });
    return code;
  }

  // Arrived -> In Consultation, from the Appointments page.
  //
  // This used to be a separate appointment-status transition
  // (status = 'consultation') which took the appointment out of the
  // Queue entirely, because getTodayQueue() only recognizes
  // status === 'arrived'. Both pages now share ONE state model — the
  // Queue's — so this is just an entry point into beginConsultation()
  // below. Kept as a named function so existing appointments.js calls
  // (and any other caller) keep working unchanged.
  function startAppointmentConsultation(id) {
    return beginConsultation(id);
  }

  // In Consultation -> Completed, from the Appointments page. Same
  // deal: a thin wrapper around the Queue's completeConsultation(), so
  // there is only one completion implementation.
  function completeAppointmentConsultation(id) {
    return completeConsultation(id);
  }

  // --- queue derived from today's arrived appointments ---

  function getTodayQueue() {
    return getAppointments()
      .filter(function (a) { return a.status === 'arrived' && a.date === todayStr(); })
      .sort(function (a, b) { return (a.arrivedAt || 0) - (b.arrivedAt || 0); });
  }

  function getServingEntry() {
    return getTodayQueue().find(function (a) {
      return a.queueStatus === 'called' || a.queueStatus === 'in-consultation';
    }) || null;
  }

  function getWaitingList() {
    return getTodayQueue().filter(function (a) { return a.queueStatus === 'waiting'; });
  }

  function callNext() {
    if (getServingEntry()) return false; // someone is already up — only one active patient at a time
    var waiting = getWaitingList();
    if (!waiting.length) return false;
    var next = waiting[0]; // preserves arrival order — first in line, first called
    // Defense-in-depth: only ever call an entry that's actually still
    // waiting in today's active queue (guards against stale reads/races).
    if (next.status !== 'arrived' || next.queueStatus !== 'waiting') return false;
    updateAppointment(next.id, { queueStatus: 'called' });
    return true;
  }

  // Single test for "this appointment is in consultation right now",
  // expressed in the Queue state model so no page has to test for the
  // retired status === 'consultation' value.
  function isInConsultation(appt) {
    return !!appt && appt.status === 'arrived' && appt.queueStatus === 'in-consultation';
  }

  // --- shared consultation transition (Queue page AND Appointments page) ---
  //
  // The single implementation of "this patient's consultation starts
  // now". The Queue state model is the source of truth: an active
  // consultation is status 'arrived' + queueStatus 'in-consultation',
  // so the patient stays in getTodayQueue() and shows as the serving
  // entry, keeping queueCode/arrivedAt (no second queue record is ever
  // created — this only flips queueStatus on the same appointment).
  //
  // Enforces the same one-active-patient rule as callNext(): if anyone
  // else is already called or in consultation, this is refused.
  function beginConsultation(id) {
    var appt = getById(id);
    if (!appt) return false;
    // Must be a checked-in patient still sitting in the active queue.
    if (appt.status !== 'arrived') return false;
    if (appt.queueStatus !== 'waiting' && appt.queueStatus !== 'called') return false;
    // One active patient at a time — the only entry allowed through
    // while someone is up is that same entry (i.e. the one that was
    // just called, going called -> in-consultation).
    var serving = getServingEntry();
    if (serving && serving.id !== id) return false;
    updateAppointment(id, { queueStatus: 'in-consultation' });
    return true;
  }

  // Called -> In Consultation. The Queue page's entry point, which keeps
  // its stricter precondition: only the entry that is currently "called"
  // can be started from here — this is what keeps a patient from being
  // started twice or jumping straight from "waiting" to
  // "in-consultation" on the Queue screen. The transition itself is
  // beginConsultation() above, shared with the Appointments page.
  function startConsultation(id) {
    var appt = getById(id);
    if (!appt) return false;
    if (appt.queueStatus !== 'called') return false;
    return beginConsultation(id);
  }

  // In Consultation -> Completed. Only valid once a consultation has
  // actually started — prevents completing a patient who was only
  // "called" or is still "waiting", and prevents completing twice.
  function completeConsultation(id) {
    var appt = getById(id);
    if (!appt) return false;
    if (appt.status !== 'arrived' || appt.queueStatus !== 'in-consultation') return false;
    updateAppointment(id, {
      status: 'completed',
      queueStatus: null,
      queueCode: null
    });
    return true;
  }

  // remove someone from the queue without completing them (sent back / no-show)
  function removeFromQueue(id) {
    updateAppointment(id, { queueStatus: null, queueCode: null, arrivedAt: null, status: 'confirmed' });
  }

  // ------------------------------------------------------------------
  // QUEUE DEMO DATA (development/testing only)
  //
  // Populates today's Queue with a handful of realistic, clearly-
  // tagged demo appointments so the Queue UI (Now Serving, Next Up,
  // the queue table, Queue Details, Call Next / Start Consultation /
  // Complete Consultation) can be exercised even on a clinic day that
  // otherwise has nothing checked in yet.
  //
  // Every appointment this creates is stamped `demoSeed: true`, which
  // is the ONLY thing that identifies it as demo data — that tag is
  // what clearQueueDemoData() filters on, so it can always find and
  // remove exactly (and only) these rows, never anything the user
  // entered themselves. Nothing here reads or writes the queue any
  // differently than a real front-desk action would: it goes through
  // the exact same markArrived() / callNext() / startConsultation() /
  // completeConsultation() functions the Appointments and Queue pages
  // already call, so getTodayQueue()/getWaitingList()/getServingEntry()
  // see these rows exactly as they'd see any real checked-in patient.
  // The only thing patched directly afterward is arrivedAt, backdated
  // a few minutes so "waiting X mins" has something real to show
  // immediately — that's a plain data timestamp, not a queue-state
  // transition, so patching it doesn't bypass any queue rule.
  //
  // Dates are never hardcoded — every seeded row uses todayStr() /
  // Date.now() at the moment seedQueueDemoData() actually runs, so
  // the data is just as valid whenever that happens to be.
  // ------------------------------------------------------------------

  function pushDemoAppointment(fields) {
    var list = getAppointments();
    var appt = mk(Object.assign({ demoSeed: true, status: 'confirmed' }, fields));
    list.push(appt);
    saveAppointments(list);
    return appt;
  }

  // Builds one in-consultation patient + three waiting patients.
  //
  // NOTE on "Called": the app enforces one active patient at a time —
  // getServingEntry() (and therefore callNext()/beginConsultation())
  // only ever allows a single row to be 'called' OR 'in-consultation'
  // at once. That makes an initial 'called' row impossible to seed
  // *alongside* an initial 'in-consultation' row, so this seeds the
  // in-consultation patient instead (it's the more informative state
  // to land on: Now Serving, Complete Consultation, and — once
  // patient-data-store.js/services-data-store.js are wired into a
  // page — the linked-record lookups all have something to show).
  // 'Called' is one click away: complete that consultation, then hit
  // Call Next.
  function seedQueueDemoData() {
    // Idempotent: drop any previous demo rows first so re-running this
    // (e.g. from the browser console while developing) replaces the
    // old demo set instead of piling up duplicates.
    var list = getAppointments().filter(function (a) { return !a.demoSeed; });
    saveAppointments(list);

    var vets = VETS; // ['Dr. Santos', 'Dr. Reyes', 'Dr. Cruz']

    // 1) In consultation — checked in first, called, and started.
    var a1 = pushDemoAppointment({
      pet: 'Bantay', species: 'Dog', owner: 'Marites Aguilar', phone: '0917 402 6618',
      vet: vets[0], date: todayStr(), time: '08:45', reason: 'Skin allergy follow-up',
      appointmentType: 'Follow-up', notes: 'Continue prescribed antihistamine; recheck ears.'
    });
    markArrived(a1.id);
    callNext();              // only entry in the queue so far -> becomes 'called'
    startConsultation(a1.id); // 'called' -> 'in-consultation'
    updateAppointment(a1.id, { arrivedAt: Date.now() - 22 * 60000 });

    // 2) Waiting — 1st in line
    var a2 = pushDemoAppointment({
      pet: 'Mimi', species: 'Cat', owner: 'Joseph Villaflor', phone: '0918 733 0947',
      vet: vets[1], date: todayStr(), time: '09:15', reason: 'Annual vaccination',
      appointmentType: 'Vaccination'
    });
    markArrived(a2.id);
    updateAppointment(a2.id, { arrivedAt: Date.now() - 14 * 60000 });

    // 3) Waiting — 2nd in line
    var a3 = pushDemoAppointment({
      pet: 'Buddy', species: 'Dog', owner: 'Cathy Manalastas', phone: '0919 285 1103',
      vet: vets[2], date: todayStr(), time: '09:30', reason: 'Limping on hind leg',
      appointmentType: 'Diagnostic', notes: 'Owner reports limping started after a walk yesterday.'
    });
    markArrived(a3.id);
    updateAppointment(a3.id, { arrivedAt: Date.now() - 9 * 60000 });

    // 4) Waiting — 3rd in line
    var a4 = pushDemoAppointment({
      pet: 'Nala', species: 'Cat', owner: 'Erwin Salcedo', phone: '0920 617 4482',
      vet: vets[0], date: todayStr(), time: '09:40', reason: 'Loss of appetite',
      appointmentType: 'Consultation'
    });
    markArrived(a4.id);
    updateAppointment(a4.id, { arrivedAt: Date.now() - 4 * 60000 });

    writeRaw(QUEUE_DEMO_KEY, { seeded: true, date: todayStr(), seededAt: Date.now(), count: 4 });
    return { count: 4, ids: [a1.id, a2.id, a3.id, a4.id] };
  }

  // Removes every demo-tagged appointment (and only those), leaving
  // anything real completely untouched.
  function clearQueueDemoData() {
    var before = getAppointments();
    var after = before.filter(function (a) { return !a.demoSeed; });
    saveAppointments(after);
    writeRaw(QUEUE_DEMO_KEY, { seeded: false, clearedAt: Date.now() });
    return { removed: before.length - after.length };
  }

  function isQueueDemoSeeded() {
    var list = readRaw(APPTS_KEY) || [];
    return list.some(function (a) { return a.demoSeed; });
  }

  // One automatic, one-time convenience seed: if the Queue has never
  // been seeded with demo data before (no QUEUE_DEMO_KEY at all — this
  // is the very first load) AND today's queue is genuinely empty, seed
  // it so the Queue page isn't blank on first look. QUEUE_DEMO_KEY is
  // written on both seed AND clear, so this never fires again after
  // that — later, an empty queue (e.g. because every demo patient was
  // completed, or the user cleared demo data on purpose) is left
  // alone. Use PCData.seedQueueDemoData() any time to seed on purpose.
  var queueDemoAutoChecked = false;
  function maybeAutoSeedQueueDemo() {
    if (queueDemoAutoChecked) return;
    queueDemoAutoChecked = true;
    if (readRaw(QUEUE_DEMO_KEY)) return;
    var list = readRaw(APPTS_KEY) || [];
    var queueHasEntriesToday = list.some(function (a) { return a.status === 'arrived' && a.date === todayStr(); });
    if (queueHasEntriesToday) return;
    seedQueueDemoData();
  }

  // ------------------------------------------------------------------
  // queue <-> patient/client resolution — appointments booked through
  // the current Appointments flow carry a real patientId/clientId.
  // Queue prefers those to look up the live Patient/Client record
  // instead of relying only on the appointment's own denormalized
  // pet/owner/phone text. Older/legacy queue entries with no
  // patientId/clientId simply fall back to that stored text, so
  // nothing already in the queue stops working.
  // ------------------------------------------------------------------

  function getPatientForAppointment(appt) {
    if (!appt || !appt.patientId) return null;
    // getPatientById now lives in patient-data-store.js, attached onto
    // this same PCData object — called via global.PCData rather than
    // as a local function since it's no longer defined in this closure.
    // Guarded in case a page loads this file without also loading
    // patient-data-store.js: falls back to no linked Patient instead
    // of throwing, so that page's own (non-Patient) features keep working.
    if (!global.PCData.getPatientById) return null;
    return global.PCData.getPatientById(appt.patientId) || null;
  }

  function getClientForAppointment(appt) {
    if (!appt || !appt.clientId) return null;
    return getClientById(appt.clientId) || null;
  }

  // Display-ready view of a queue entry: real, current Patient/Client
  // data where the appointment is linked to one, the appointment's own
  // stored text as a fallback otherwise (legacy rows, or a linked id
  // that no longer resolves to an existing record).
  function getQueueDisplayInfo(appt) {
    if (!appt) return null;
    var patient = getPatientForAppointment(appt);
    var client = getClientForAppointment(appt);
    return {
      id: appt.id,
      patientId: patient ? patient.id : (appt.patientId || null),
      clientId: client ? client.id : (appt.clientId || null),
      pet: (patient && patient.pet) || appt.pet,
      species: (patient && patient.species) || appt.species,
      owner: (client && client.name) || appt.owner,
      ownerPhone: (client && client.phone) || (patient && patient.ownerPhone) || appt.phone,
      vet: appt.vet,
      reason: appt.reason,
      queueCode: appt.queueCode,
      queueStatus: appt.queueStatus,
      arrivedAt: appt.arrivedAt
    };
  }

  // NOTE: Patients (pet profiles) and Vaccination records used to live
  // in this file and have been extracted into patient-data-store.js.
  // That file attaches its functions onto this same PCData object at
  // runtime, so every existing PCData.getPatients()/addPatient()/
  // getVaccinationsForPatientId()/etc. call keeps working — it just
  // requires patient-data-store.js to be loaded (after this file,
  // before patients.js). See __readRaw / __writeRaw below, which are
  // exposed specifically so that file can persist its own keys
  // ('pcv1_patients' / 'pcv1_vaccinations') through the same storage +
  // cross-tab sync mechanism used everywhere else in this store.

  // ============================================================
  // CLIENTS — pet owner profiles. Cross-referenced to Patients by
  // owner name, the same identity Patients already uses to link
  // itself to Appointments, so a client's registered pets and visit
  // history come from the real Patients/Appointments data instead of
  // a duplicated copy.
  // ============================================================

  var CLIENTS_KEY = 'pcv1_clients';
  var CLIENT_STATUSES = ['active', 'inactive'];

  function clUid() {
    return 'cl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function mkClient(fields) {
    return Object.assign({
      id: clUid(),
      name: '',
      phone: '',
      email: '',
      address: '',
      emergencyContact: '',
      notes: '',
      status: 'active',
      createdAt: Date.now()
    }, fields);
  }

  function seedClientsIfEmpty() {
    var existing = readRaw(CLIENTS_KEY);
    if (existing && existing.length) return;

    // Matches the owners already seeded in Patients, so pet counts and
    // visit history show real data immediately instead of zeros.
    var seed = [
      mkClient({ name: 'Renz Villanueva', phone: '0917 220 4481', email: 'renz.villanueva@example.com', address: 'Blk 4 Lot 12, Sto. Niño St., Baliuag, Bulacan', emergencyContact: 'Liza Villanueva · 0917 220 9981', notes: 'Prefers morning appointments.', status: 'active' }),
      mkClient({ name: 'Ana Marasigan', phone: '0918 552 3390', email: 'ana.marasigan@example.com', address: '25 Rizal St., Baliuag, Bulacan', emergencyContact: 'Paolo Marasigan · 0918 552 1120', notes: "Bella is due for her annual booster.", status: 'active' }),
      mkClient({ name: 'Kyle Domingo', phone: '0919 004 7712', email: 'kyle.domingo@example.com', address: '8 Mabini St., Baliuag, Bulacan', emergencyContact: 'Rina Domingo · 0919 004 0091', notes: "Monitoring Luna's skin allergy.", status: 'active' }),
      mkClient({ name: 'Grace Panganiban', phone: '0920 771 5528', email: 'grace.panganiban@example.com', address: '112 Burgos St., Baliuag, Bulacan', emergencyContact: 'Tonyo Panganiban · 0920 771 8842', notes: '', status: 'active' }),
      mkClient({ name: 'Miguel Torres', phone: '0917 004 2261', email: 'miguel.torres@example.com', address: '3 Del Pilar St., Baliuag, Bulacan', emergencyContact: 'Carmen Torres · 0917 004 5567', notes: 'Books nail trims every 6 weeks.', status: 'active' }),
      mkClient({ name: 'Patricia Uy', phone: '0928 441 0932', email: 'patricia.uy@example.com', address: '77 Luna St., Baliuag, Bulacan', emergencyContact: 'Marco Uy · 0928 441 7710', notes: '', status: 'active' }),
      mkClient({ name: 'Ella Santiago', phone: '0917 883 0045', email: 'ella.santiago@example.com', address: '19 Aguinaldo St., Baliuag, Bulacan', emergencyContact: 'Ben Santiago · 0917 883 2291', notes: '', status: 'active' }),
      mkClient({ name: 'Ramon Aquino', phone: '0919 223 6604', email: 'ramon.aquino@example.com', address: '41 Bonifacio St., Baliuag, Bulacan', emergencyContact: 'Nora Aquino · 0919 223 1187', notes: 'Chichi has a sensitive stomach — keep on prescribed diet.', status: 'inactive' }),
      mkClient({ name: 'Bea Lozada', phone: '0921 330 8845', email: 'bea.lozada@example.com', address: '6 Quezon St., Baliuag, Bulacan', emergencyContact: 'Jun Lozada · 0921 330 2214', notes: '', status: 'active' }),
      mkClient({ name: 'Ivan Custodio', phone: '0917 660 1123', email: 'ivan.custodio@example.com', address: '58 Malvar St., Baliuag, Bulacan', emergencyContact: 'Wena Custodio · 0917 660 9932', notes: '', status: 'active' }),
      mkClient({ name: 'Carlo Beltran', phone: '0920 118 4432', email: 'carlo.beltran@example.com', address: '14 Osmeña St., Baliuag, Bulacan', emergencyContact: 'Divine Beltran · 0920 118 7761', notes: 'Zeus is being evaluated for limping — follow up in 2 weeks.', status: 'active' }),
      mkClient({ name: 'Dennis Ocampo', phone: '0919 448 3320', email: 'dennis.ocampo@example.com', address: '30 Roxas St., Baliuag, Bulacan', emergencyContact: 'Fe Ocampo · 0919 448 6675', notes: '', status: 'inactive' })
    ];

    writeRaw(CLIENTS_KEY, seed);
  }

  function getClients() {
    seedClientsIfEmpty();
    return readRaw(CLIENTS_KEY) || [];
  }

  function saveClients(list) {
    writeRaw(CLIENTS_KEY, list);
  }

  function getClientById(id) {
    return getClients().find(function (c) { return c.id === id; });
  }

  function addClient(fields) {
    var list = getClients();
    var client = mkClient(fields);
    list.push(client);
    saveClients(list);
    return client;
  }

  function updateClient(id, patch) {
    var list = getClients();
    var idx = list.findIndex(function (c) { return c.id === id; });
    if (idx === -1) return;
    Object.assign(list[idx], patch);
    saveClients(list);
  }

  // Pets registered under this client. Pets created through the Clients
  // page's "Add Client" flow carry a real clientId and are matched by
  // that id; older/legacy patients (added directly on the Patients page,
  // with no clientId) still fall back to matching by owner name, so
  // nothing already in the system stops showing up here.
  function getPatientsForClient(client) {
    if (!client) return [];
    var name = (client.name || '').trim().toLowerCase();
    if (!name) return [];
    // getPatients now lives in patient-data-store.js — called via
    // global.PCData rather than as a local function. Guarded in case a
    // page loads this file without also loading patient-data-store.js:
    // falls back to no linked Patients instead of throwing, so that
    // page's own (non-Patient) features keep working.
    if (!global.PCData.getPatients) return [];
    return global.PCData.getPatients().filter(function (p) {
      if (p.clientId) return p.clientId === client.id;
      return (p.owner || '').trim().toLowerCase() === name;
    });
  }

  // Combined appointment history across every pet this client owns.
  function getAppointmentsForClient(client) {
    var pets = getPatientsForClient(client);
    var all = [];
    pets.forEach(function (p) {
      // getAppointmentsForPatient now lives in patient-data-store.js —
      // called via global.PCData rather than as a local function.
      if (!global.PCData.getAppointmentsForPatient) return;
      all = all.concat(global.PCData.getAppointmentsForPatient(p));
    });
    return all.sort(function (a, b) { return (b.date + b.time).localeCompare(a.date + a.time); });
  }

  function getLastVisitForClient(client) {
    var history = getAppointmentsForClient(client);
    var visited = history.find(function (a) { return a.status === 'completed'; });
    return visited ? visited.date : null;
  }

  // NOTE: Medical Records (visit-level clinical history) used to live
  // in this file and has been extracted into medical-records-data-store.js.
  // That file attaches its functions onto this same PCData object at
  // runtime, so every existing PCData.getMedicalRecords()/addMedicalRecord()/
  // getMedicalRecordsForPatientId()/etc. call keeps working — it just
  // requires medical-records-data-store.js to be loaded (after this
  // file, before medical-records.js). See __readRaw / __writeRaw below,
  // which are exposed specifically so that file can persist its own
  // 'pcv1_medrecords' key through the same storage + cross-tab sync
  // mechanism used everywhere else in this store.

  // ============================================================
  // ACCOUNTS — login accounts, auto-created for clients so this mock
  // data layer already holds what a future PHP/MySQL "users" table
  // would need (login, initial password, role, and the id of the
  // client the account belongs to). Nothing else in the app reads
  // this yet — it's created here so it's ready when Staff & Users
  // is built out.
  // ============================================================

  var ACCOUNTS_KEY = 'pcv1_accounts';

  function acUid() {
    return 'ac_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function mkAccount(fields) {
    return Object.assign({
      id: acUid(),
      login: '',
      password: '',
      // Display name for staff-side accounts (Administrator/Veterinarian/
      // Receptionist/Staff) — those roles have no linked Client record to
      // pull a name from the way Client accounts do via clientId ->
      // getClientById(). Client accounts leave this blank; their display
      // name always comes from the linked Client.
      name: '',
      role: 'client',
      clientId: null,
      status: 'active',
      createdAt: Date.now()
    }, fields);
  }

  // Legacy accounts created before `status`/`name` existed won't have
  // those keys in localStorage. Default them at read time the same way
  // other legacy fields already get defensive fallbacks elsewhere in
  // this file (e.g. getQueueDisplayInfo), rather than treating a missing
  // status as falsy/inactive wherever it's checked.
  function normalizeAccount(a) {
    if (a.status !== 'active' && a.status !== 'inactive') a.status = 'active';
    if (typeof a.name !== 'string') a.name = '';
    return a;
  }

  // Seeds exactly one Administrator account the first time the Accounts
  // store is used, so the system is never left with zero Administrators
  // and no way to reach Staff & Users. Mirrors the seedIfEmpty()/
  // seedClientsIfEmpty()/seedInventoryIfEmpty() pattern above — only
  // fires when the store is completely empty, and never overwrites
  // accounts that already exist (including Client accounts already
  // created through the Client login flow).
  //
  // Mock/dev credential only, consistent with how this whole layer
  // already stores plain-text passwords (see client-session.js) —
  // change it before any real deployment.
  function seedAccountsIfEmpty() {
    var existing = readRaw(ACCOUNTS_KEY);
    if (existing && existing.length) return;
    var seed = [mkAccount({
      login: 'admin@pawsitivecare.com',
      password: 'Admin_2026',
      name: 'System Administrator',
      role: 'administrator',
      status: 'active'
    })];
    writeRaw(ACCOUNTS_KEY, seed);
  }

  function getAccounts() {
    seedAccountsIfEmpty();
    return (readRaw(ACCOUNTS_KEY) || []).map(normalizeAccount);
  }

  function saveAccounts(list) {
    writeRaw(ACCOUNTS_KEY, list);
  }

  function normalizeLogin(login) {
    return (login || '').trim().toLowerCase();
  }

  function accountExists(login) {
    var norm = normalizeLogin(login);
    if (!norm) return false;
    return getAccounts().some(function (a) { return normalizeLogin(a.login) === norm; });
  }

  function addAccount(fields) {
    var list = getAccounts();
    var account = mkAccount(fields);
    list.push(account);
    saveAccounts(list);
    return account;
  }

  function getAccountById(id) {
    return getAccounts().find(function (a) { return a.id === id; });
  }

  // Resolves the real Account record by id before applying the patch —
  // never updates based on name/login. Used by Staff & Users for edits,
  // Activate/Deactivate, etc.
  function updateAccount(id, patch) {
    var list = getAccounts();
    var idx = list.findIndex(function (a) { return a.id === id; });
    if (idx === -1) return null;
    Object.assign(list[idx], patch);
    saveAccounts(list);
    return list[idx];
  }

  // "PetName_TheirName" with all whitespace stripped from each part,
  // e.g. buildInitialPassword('Mochi', 'Maria Santos') -> 'Mochi_MariaSantos'.
  function buildInitialPassword(petName, clientName) {
    var stripSpaces = function (s) { return (s || '').replace(/\s+/g, ''); };
    return stripSpaces(petName) + '_' + stripSpaces(clientName);
  }

  // ============================================================
  // INVENTORY — medicine & supply stock. Lives directly in this file
  // for now (per current build step) rather than in its own
  // inventory-data-store.js, using its own localStorage key so it
  // never mixes with Patients/Clients/Appointments/Medical Records/
  // Billing data. Item ids are stable strings so Billing, Medical
  // Records, Predictive Analytics, and Notifications can reference an
  // inventory item by id once those connections are built.
  // ============================================================

  var INV_KEY = 'pcv1_inventory';

  var INV_CATEGORIES = ['Medicine', 'Vaccine', 'Supply', 'Consumable', 'Equipment', 'Food'];
  var INV_STATUSES = ['active', 'inactive'];

  function invUid() {
    return 'inv_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function mkInventoryItem(fields) {
    var now = Date.now();
    return Object.assign({
      id: invUid(),
      name: '',
      category: INV_CATEGORIES[0],
      quantity: 0,
      unit: '',
      unitPrice: 0,
      expirationDate: '',       // '' = does not expire / not tracked
      lowStockThreshold: 0,
      status: 'active',
      createdAt: now,
      updatedAt: now
    }, fields);
  }

  function seedInventoryIfEmpty() {
    var existing = readRaw(INV_KEY);
    if (existing && existing.length) return;

    var seed = [
      mkInventoryItem({ name: 'Amoxicillin 500mg', category: 'Medicine', quantity: 8, unit: 'capsules', unitPrice: 5.50, expirationDate: dateStr(60), lowStockThreshold: 20, status: 'active' }),
      mkInventoryItem({ name: 'Rabies Vaccine', category: 'Vaccine', quantity: 15, unit: 'vials', unitPrice: 250, expirationDate: dateStr(-10), lowStockThreshold: 10, status: 'active' }),
      mkInventoryItem({ name: 'Amoxil Oral Suspension', category: 'Medicine', quantity: 40, unit: 'bottles', unitPrice: 180, expirationDate: dateStr(180), lowStockThreshold: 10, status: 'active' }),
      mkInventoryItem({ name: 'Surgical Gloves (Medium)', category: 'Supply', quantity: 500, unit: 'pieces', unitPrice: 3, expirationDate: '', lowStockThreshold: 100, status: 'active' }),
      mkInventoryItem({ name: 'Deworming Tablets', category: 'Medicine', quantity: 5, unit: 'tablets', unitPrice: 8, expirationDate: dateStr(90), lowStockThreshold: 15, status: 'active' }),
      mkInventoryItem({ name: 'Flea & Tick Spray', category: 'Supply', quantity: 12, unit: 'bottles', unitPrice: 220, expirationDate: dateStr(-5), lowStockThreshold: 5, status: 'active' }),
      mkInventoryItem({ name: 'IV Fluid (NSS) 500ml', category: 'Consumable', quantity: 30, unit: 'bags', unitPrice: 65, expirationDate: dateStr(200), lowStockThreshold: 10, status: 'active' }),
      mkInventoryItem({ name: 'Syringes 5ml', category: 'Supply', quantity: 3, unit: 'boxes', unitPrice: 45, expirationDate: '', lowStockThreshold: 10, status: 'active' }),
      mkInventoryItem({ name: 'Multivitamin Syrup', category: 'Medicine', quantity: 25, unit: 'bottles', unitPrice: 95, expirationDate: dateStr(15), lowStockThreshold: 8, status: 'active' }),
      mkInventoryItem({ name: 'Ketamine Injectable', category: 'Medicine', quantity: 6, unit: 'vials', unitPrice: 320, expirationDate: dateStr(120), lowStockThreshold: 5, status: 'active' }),
      mkInventoryItem({ name: 'Feline Vaccine (FVRCP)', category: 'Vaccine', quantity: 0, unit: 'vials', unitPrice: 260, expirationDate: dateStr(150), lowStockThreshold: 5, status: 'active' }),
      mkInventoryItem({ name: 'Gauze Bandage Rolls', category: 'Supply', quantity: 100, unit: 'rolls', unitPrice: 12, expirationDate: '', lowStockThreshold: 20, status: 'inactive' })
    ];

    writeRaw(INV_KEY, seed);
  }

  function getInventory() {
    seedInventoryIfEmpty();
    return readRaw(INV_KEY) || [];
  }

  function saveInventory(list) {
    writeRaw(INV_KEY, list);
  }

  function getInventoryById(id) {
    return getInventory().find(function (i) { return i.id === id; });
  }

  function addInventoryItem(fields) {
    var list = getInventory();
    var item = mkInventoryItem(fields);
    list.push(item);
    saveInventory(list);
    return item;
  }

  function updateInventoryItem(id, patch) {
    var list = getInventory();
    var idx = list.findIndex(function (i) { return i.id === id; });
    if (idx === -1) return null;
    Object.assign(list[idx], patch, { updatedAt: Date.now() });
    saveInventory(list);
    return list[idx];
  }

  // Increase/decrease stock by delta (negative to decrease). Clamped so
  // quantity can never go below 0 — returns { ok, item } where ok is
  // false if the adjustment was rejected (would go negative) or the
  // item doesn't exist; the item is returned either way when found so
  // callers can show the current quantity even on a rejected decrease.
  function adjustStock(id, delta) {
    var list = getInventory();
    var idx = list.findIndex(function (i) { return i.id === id; });
    if (idx === -1) return { ok: false, item: null };
    var next = (list[idx].quantity || 0) + delta;
    if (next < 0) return { ok: false, item: list[idx] };
    list[idx].quantity = next;
    list[idx].updatedAt = Date.now();
    saveInventory(list);
    return { ok: true, item: list[idx] };
  }

  function isLowStock(item) {
    if (!item) return false;
    return item.quantity <= (item.lowStockThreshold || 0);
  }

  function isExpired(item) {
    if (!item || !item.expirationDate) return false;
    return item.expirationDate < todayStr();
  }

  function getLowStockItems() {
    return getInventory().filter(isLowStock);
  }

  function getExpiredItems() {
    return getInventory().filter(isExpired);
  }

  // ------------------------------------------------------------------
  // live sync — real-time across tabs/windows (e.g. a waiting-room
  // display open alongside the front-desk view)
  //
  // NOTE: this listens for the storage keys owned by this file, plus
  // the keys owned by the files that attach onto this same PCData
  // object — Billing ('pcv1_invoices' / 'pcv1_invoice_counter' /
  // 'pcv1_payments', owned by billing-data-store.js) and Patients
  // ('pcv1_patients' / 'pcv1_vaccinations', owned by
  // patient-data-store.js) — by their literal key names. Those files
  // may load after this function is defined, so their keys are
  // intentionally not referenced as variables here.
  // ------------------------------------------------------------------

  var ONCHANGE_WATCHED_KEYS = [APPTS_KEY, COUNTER_KEY, CLIENTS_KEY, ACCOUNTS_KEY, INV_KEY, 'pcv1_patients', 'pcv1_vaccinations', 'pcv1_medrecords', 'pcv1_invoices', 'pcv1_invoice_counter', 'pcv1_payments'];

  function onChangeSnapshot() {
    return ONCHANGE_WATCHED_KEYS.map(function (k) { return localStorage.getItem(k); }).join('\u241F');
  }

  function onChange(cb) {
    global.addEventListener('storage', function (e) {
      if (!e.key || ONCHANGE_WATCHED_KEYS.indexOf(e.key) !== -1) cb();
    });
    global.addEventListener('pcv1:change', cb);
    // Safety-net poll in case a storage event is missed/throttled by the
    // browser. Only calls cb when the watched data has actually changed
    // since the last tick (instead of unconditionally every 1.5s) — an
    // unconditional poll forces every listener (e.g. the Appointments
    // calendar) to fully rebuild its DOM on every tick even when nothing
    // changed, which was tearing the dragged card's DOM node out from
    // under an in-progress drag and silently aborting the browser's
    // native drag-and-drop operation whenever a drag lasted longer than
    // 1.5s (i.e. essentially every real drag).
    var lastSnapshot = onChangeSnapshot();
    setInterval(function () {
      var snapshot = onChangeSnapshot();
      if (snapshot !== lastSnapshot) {
        lastSnapshot = snapshot;
        cb();
      }
    }, 1500);
  }

  global.PCData = {
    // low-level storage helpers — exposed so other same-origin modules
    // (currently billing-data-store.js) can persist their own keys
    // through the same localStorage + cross-tab sync mechanism, without
    // duplicating that persistence logic in their own file.
    __readRaw: readRaw,
    __writeRaw: writeRaw,

    STATUSES: STATUSES,
    STATUS_LABELS: STATUS_LABELS,
    VETS: VETS,
    APPOINTMENT_TYPES: APPOINTMENT_TYPES,
    SPECIES: SPECIES,
    SPECIES_ICON: SPECIES_ICON,
    todayStr: todayStr,
    dateStr: dateStr,
    parseDate: parseDate,
    formatDateLabel: formatDateLabel,
    formatTimeLabel: formatTimeLabel,
    getAppointments: getAppointments,
    saveAppointments: saveAppointments,
    getById: getById,
    addAppointment: addAppointment,
    updateAppointment: updateAppointment,
    confirmAppointment: confirmAppointment,
    cancelAppointment: cancelAppointment,
    findApptConflict: findApptConflict,
    markArrived: markArrived,
    startAppointmentConsultation: startAppointmentConsultation,
    completeAppointmentConsultation: completeAppointmentConsultation,
    // "Is this appointment currently in consultation?" under the shared
    // Queue state model. Any page that used to test for
    // status === 'consultation' should use this instead.
    isInConsultation: isInConsultation,
    getTodayQueue: getTodayQueue,
    getServingEntry: getServingEntry,
    getWaitingList: getWaitingList,
    callNext: callNext,
    startConsultation: startConsultation,
    completeConsultation: completeConsultation,
    removeFromQueue: removeFromQueue,
    // Queue demo/test data (development only) — see the "QUEUE DEMO
    // DATA" section above removeFromQueue for how this behaves.
    seedQueueDemoData: seedQueueDemoData,
    clearQueueDemoData: clearQueueDemoData,
    isQueueDemoSeeded: isQueueDemoSeeded,
    getPatientForAppointment: getPatientForAppointment,
    getClientForAppointment: getClientForAppointment,
    getQueueDisplayInfo: getQueueDisplayInfo,
    onChange: onChange,

    // NOTE: Patients (pet profiles) and Vaccination records are no
    // longer added here — patient-data-store.js attaches them onto
    // this same PCData object at load time. See that file for
    // getPatients/addPatient/getVaccinationsForPatientId/etc.

    // clients
    CLIENT_STATUSES: CLIENT_STATUSES,
    getClients: getClients,
    saveClients: saveClients,
    getClientById: getClientById,
    addClient: addClient,
    updateClient: updateClient,
    getPatientsForClient: getPatientsForClient,
    getAppointmentsForClient: getAppointmentsForClient,
    getLastVisitForClient: getLastVisitForClient,

    // NOTE: medical records (MED_VISIT_TYPES, getMedicalRecords,
    // addMedicalRecord, etc.) are no longer added here — see the NOTE
    // above getLastVisitForClient; medical-records-data-store.js
    // attaches them onto this same PCData object at load time.

    // accounts — shared core, used by Client authentication (client-session.js)
    // AND by Staff & Users (via staff-users-data-store.js). Role/status
    // constants and Staff & Users-specific queries live in
    // staff-users-data-store.js, not here.
    getAccounts: getAccounts,
    saveAccounts: saveAccounts,
    getAccountById: getAccountById,
    accountExists: accountExists,
    addAccount: addAccount,
    updateAccount: updateAccount,
    buildInitialPassword: buildInitialPassword,

    // inventory
    INV_CATEGORIES: INV_CATEGORIES,
    INV_STATUSES: INV_STATUSES,
    getInventory: getInventory,
    saveInventory: saveInventory,
    getInventoryById: getInventoryById,
    addInventoryItem: addInventoryItem,
    updateInventoryItem: updateInventoryItem,
    adjustStock: adjustStock,
    isLowStock: isLowStock,
    isExpired: isExpired,
    getLowStockItems: getLowStockItems,
    getExpiredItems: getExpiredItems

    // NOTE: Billing (invoices/payments) functions and constants are no
    // longer added here — billing-data-store.js attaches them onto this
    // same PCData object at load time. See that file for
    // getInvoices/addInvoice/getPayments/submitPayment/etc.
  };
})(window);