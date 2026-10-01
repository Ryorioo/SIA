// ============================================================
// PAWSITIVE CARE — Patient + Vaccination data store
// Extracted from data-store.js so the Patients module owns its own
// storage file, following the same pattern billing-data-store.js
// already established: this file attaches its functions onto the
// SAME window.PCData object that data-store.js creates, at load
// time, so every existing call site (D.getPatients(), D.addPatient(),
// D.getVaccinationsForPatientId(), etc.) keeps working unchanged —
// it just now requires this file to be loaded (after data-store.js,
// before patients.js).
//
// This file does NOT duplicate the low-level localStorage +
// cross-tab sync plumbing — it reuses PCData.__readRaw / __writeRaw
// (exposed by data-store.js for exactly this purpose), and reuses
// PCData.parseDate / dateStr / todayStr / getAppointments for date
// handling and appointment lookups, so Patients stays in sync with
// Appointments/Queue without re-implementing any of that logic here.
// ============================================================

(function (global) {
  var PCData = global.PCData;

  function readRaw(key) { return PCData.__readRaw(key); }
  function writeRaw(key, value) { return PCData.__writeRaw(key, value); }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  // ============================================================
  // PATIENTS — pet profiles, separate store from Appointments but
  // cross-referenced by pet + owner name so a patient's profile can
  // show its real appointment history without duplicating data.
  // ============================================================

  var PATIENTS_KEY = 'pcv1_patients';

  var SEX_OPTIONS = ['Male', 'Female', 'Unknown'];
  var PATIENT_STATUSES = ['active', 'inactive'];
  var VACCINATION_STATUSES = ['Up to date', 'Due soon', 'Overdue', 'N/A', 'Unknown'];

  var BREED_SUGGESTIONS = {
    Dog: ['Aspin (Askal)', 'Shih Tzu', 'Labrador Retriever', 'Golden Retriever', 'German Shepherd', 'Beagle', 'Poodle', 'Rottweiler', 'Chihuahua', 'Siberian Husky'],
    Cat: ['Puspin (Pusang Pinoy)', 'Domestic Shorthair', 'Persian', 'British Shorthair', 'Ragdoll', 'Siamese', 'Maine Coon'],
    Rabbit: ['Holland Lop', 'Netherland Dwarf', 'Rex', 'Mixed breed'],
    Bird: ['Cockatiel', 'Budgerigar', 'Lovebird', 'Parrot'],
    Other: []
  };

  function ptUid() {
    return 'pt_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function mkPatient(fields) {
    return Object.assign({
      id: ptUid(),
      clientId: null,   // set when the pet is registered through the Clients page; legacy/manually-added patients leave this null and stay matched by owner name
      pet: '',
      species: 'Dog',
      breed: '',
      sex: 'Unknown',
      dob: '',
      color: '',
      weight: '',
      spayed: 'Unknown',
      owner: '',
      ownerPhone: '',
      allergies: '',
      conditions: '',
      medications: '',
      vaccinationStatus: 'Unknown',
      notes: '',
      status: 'active',
      createdAt: Date.now()
    }, fields);
  }

  function isoDaysAgo(years, months) {
    var d = new Date();
    d.setFullYear(d.getFullYear() - (years || 0));
    d.setMonth(d.getMonth() - (months || 0));
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function seedPatientsIfEmpty() {
    var existing = readRaw(PATIENTS_KEY);
    if (existing && existing.length) return;

    var seed = [
      mkPatient({ pet: 'Max', species: 'Dog', breed: 'Golden Retriever', sex: 'Male', dob: isoDaysAgo(4, 1), color: 'Golden', weight: '28.5', owner: 'Renz Villanueva', ownerPhone: '0917 220 4481', allergies: 'None known', conditions: 'None', medications: 'None', vaccinationStatus: 'Up to date', notes: 'Friendly, gets a little anxious during nail trims.', status: 'active' }),
      mkPatient({ pet: 'Bella', species: 'Dog', breed: 'Shih Tzu', sex: 'Female', dob: isoDaysAgo(2, 3), color: 'White & Brown', weight: '6.2', owner: 'Ana Marasigan', ownerPhone: '0918 552 3390', allergies: 'Chicken-based treats', conditions: 'None', medications: 'None', vaccinationStatus: 'Due soon', notes: 'Due for annual vaccination booster.', status: 'active' }),
      mkPatient({ pet: 'Luna', species: 'Cat', breed: 'Domestic Shorthair', sex: 'Female', dob: isoDaysAgo(3, 0), color: 'Black', weight: '3.8', owner: 'Kyle Domingo', ownerPhone: '0919 004 7712', allergies: 'None known', conditions: 'Mild skin allergy', medications: 'Apoquel (as needed)', vaccinationStatus: 'Up to date', notes: 'Being monitored for recurring skin irritation.', status: 'active' }),
      mkPatient({ pet: 'Milo', species: 'Cat', breed: 'British Shorthair', sex: 'Male', dob: isoDaysAgo(1, 2), color: 'Gray', weight: '4.1', owner: 'Grace Panganiban', ownerPhone: '0920 771 5528', allergies: 'None known', conditions: 'None', medications: 'None', vaccinationStatus: 'Up to date', notes: 'Recently dewormed.', status: 'active' }),
      mkPatient({ pet: 'Coco', species: 'Rabbit', breed: 'Holland Lop', sex: 'Female', dob: isoDaysAgo(1, 4), color: 'White', weight: '1.6', owner: 'Miguel Torres', ownerPhone: '0917 004 2261', allergies: 'None known', conditions: 'None', medications: 'None', vaccinationStatus: 'N/A', notes: 'Nail trims scheduled every 6 weeks.', status: 'active' }),
      mkPatient({ pet: 'Simba', species: 'Dog', breed: 'Labrador Mix', sex: 'Male', dob: isoDaysAgo(6, 0), color: 'Brown', weight: '24', owner: 'Patricia Uy', ownerPhone: '0928 441 0932', allergies: 'None known', conditions: 'Mild hip dysplasia', medications: 'Joint supplement (daily)', vaccinationStatus: 'Up to date', notes: 'Follow-up checkup for mobility.', status: 'active' }),
      mkPatient({ pet: 'Kiko', species: 'Bird', breed: 'Cockatiel', sex: 'Male', dob: isoDaysAgo(2, 0), color: 'Yellow & Gray', weight: '0.09', owner: 'Ella Santiago', ownerPhone: '0917 883 0045', allergies: 'None known', conditions: 'None', medications: 'None', vaccinationStatus: 'N/A', notes: 'Wing check came back normal.', status: 'active' }),
      mkPatient({ pet: 'Chichi', species: 'Cat', breed: 'Persian', sex: 'Female', dob: isoDaysAgo(5, 0), color: 'Cream', weight: '4.5', owner: 'Ramon Aquino', ownerPhone: '0919 223 6604', allergies: 'None known', conditions: 'Sensitive stomach', medications: 'None', vaccinationStatus: 'Overdue', notes: 'History of vomiting and lethargy — monitor diet closely.', status: 'inactive' }),
      mkPatient({ pet: 'Rocky', species: 'Dog', breed: 'German Shepherd', sex: 'Male', dob: isoDaysAgo(3, 0), color: 'Black & Tan', weight: '32', owner: 'Bea Lozada', ownerPhone: '0921 330 8845', allergies: 'None known', conditions: 'None', medications: 'None', vaccinationStatus: 'Due soon', notes: 'Annual vaccination coming up.', status: 'active' }),
      mkPatient({ pet: 'Snowy', species: 'Cat', breed: 'Ragdoll', sex: 'Female', dob: isoDaysAgo(2, 6), color: 'White', weight: '4.0', owner: 'Ivan Custodio', ownerPhone: '0917 660 1123', allergies: 'None known', conditions: 'Mild dental tartar', medications: 'None', vaccinationStatus: 'Up to date', notes: 'Scheduled for dental cleaning.', status: 'active' }),
      mkPatient({ pet: 'Zeus', species: 'Dog', breed: 'Rottweiler', sex: 'Male', dob: isoDaysAgo(4, 0), color: 'Black & Tan', weight: '40', owner: 'Carlo Beltran', ownerPhone: '0920 118 4432', allergies: 'None known', conditions: 'Recent limping, right leg', medications: 'Pain reliever (short course)', vaccinationStatus: 'Up to date', notes: 'Being evaluated for limping.', status: 'active' }),
      mkPatient({ pet: 'Bruno', species: 'Dog', breed: 'Beagle', sex: 'Male', dob: isoDaysAgo(7, 0), color: 'Tricolor', weight: '12', owner: 'Dennis Ocampo', ownerPhone: '0919 448 3320', allergies: 'None known', conditions: 'Chronic ear infections', medications: 'Ear drops (as needed)', vaccinationStatus: 'Up to date', notes: 'Ears cleaned regularly at home.', status: 'inactive' })
    ];

    writeRaw(PATIENTS_KEY, seed);
  }

  function getPatients() {
    seedPatientsIfEmpty();
    return readRaw(PATIENTS_KEY) || [];
  }

  function savePatients(list) {
    writeRaw(PATIENTS_KEY, list);
  }

  function getPatientById(id) {
    return getPatients().find(function (p) { return p.id === id; });
  }

  function addPatient(fields) {
    var list = getPatients();
    var patient = mkPatient(fields);
    list.push(patient);
    savePatients(list);
    return patient;
  }

  function updatePatient(id, patch) {
    var list = getPatients();
    var idx = list.findIndex(function (p) { return p.id === id; });
    if (idx === -1) return;
    Object.assign(list[idx], patch);
    savePatients(list);
  }

  function calcAge(dobIso) {
    if (!dobIso) return '—';
    var dob = PCData.parseDate(dobIso);
    if (isNaN(dob.getTime())) return '—';
    var now = new Date();
    var months = (now.getFullYear() - dob.getFullYear()) * 12 + (now.getMonth() - dob.getMonth());
    if (now.getDate() < dob.getDate()) months -= 1;
    if (months < 0) months = 0;
    if (months < 12) return months + (months === 1 ? ' mo' : ' mos');
    var years = Math.floor(months / 12);
    var remMonths = months % 12;
    return years + (years === 1 ? ' yr' : ' yrs') + (remMonths ? ' ' + remMonths + 'mo' : '');
  }

  // A patient isn't formally linked to appointment rows by id (they're two
  // independently-editable stores), so history is matched by pet + owner
  // name — the same identity the Appointments page already keys off of.
  // Uses PCData.getAppointments() (owned by data-store.js) rather than its
  // own copy of the Appointments store.
  function getAppointmentsForPatient(patient) {
    if (!patient) return [];
    var pet = (patient.pet || '').trim().toLowerCase();
    var owner = (patient.owner || '').trim().toLowerCase();
    if (!pet || !owner) return [];
    return PCData.getAppointments()
      .filter(function (a) { return (a.pet || '').trim().toLowerCase() === pet && (a.owner || '').trim().toLowerCase() === owner; })
      .sort(function (a, b) { return (b.date + b.time).localeCompare(a.date + a.time); });
  }

  function getLastVisit(patient) {
    var history = getAppointmentsForPatient(patient);
    var visited = history.find(function (a) { return a.status === 'completed'; });
    return visited ? visited.date : null;
  }

  // ============================================================
  // VACCINATION RECORDS — individual vaccination entries, one per
  // shot given, linked to Patients by patientId (the same real
  // identity Medical Records already uses). Separate from the older
  // Patient.vaccinationStatus field: that single general status is
  // left in place on the patient record untouched, and still used
  // as a fallback wherever a patient has no vaccination records yet
  // (e.g. patients added before this feature existed).
  // ============================================================

  var VACCINATIONS_KEY = 'pcv1_vaccinations';

  // "Due soon" window: a record's Next Due date within this many days
  // of today (and not yet past) is considered due soon rather than
  // up to date.
  var VACCINATION_DUE_SOON_DAYS = 30;

  function vaxUid() {
    return 'vax_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function mkVaccination(fields) {
    return Object.assign({
      id: vaxUid(),
      patientId: null,
      vaccineName: '',
      dateGiven: '',
      nextDue: '',
      notes: '',
      createdAt: Date.now()
    }, fields);
  }

  // Status is always derived from the Next Due date rather than stored,
  // so it can never drift out of sync with the dates on the record.
  // Reuses the same VACCINATION_STATUSES vocabulary (and therefore the
  // same status-badge classes) the legacy Patient.vaccinationStatus
  // field already established.
  function computeVaccinationStatus(nextDueIso) {
    if (!nextDueIso) return 'Unknown';
    var due = PCData.parseDate(nextDueIso);
    if (isNaN(due.getTime())) return 'Unknown';
    var today = PCData.parseDate(PCData.todayStr());
    var soonCutoff = PCData.parseDate(PCData.dateStr(VACCINATION_DUE_SOON_DAYS));
    if (due < today) return 'Overdue';
    if (due <= soonCutoff) return 'Due soon';
    return 'Up to date';
  }

  function getVaccinations() {
    return readRaw(VACCINATIONS_KEY) || [];
  }

  function saveVaccinations(list) {
    writeRaw(VACCINATIONS_KEY, list);
  }

  function getVaccinationById(id) {
    return getVaccinations().find(function (v) { return v.id === id; });
  }

  // Every vaccination record for a given patient id, most recently
  // given first.
  function getVaccinationsForPatientId(patientId) {
    if (!patientId) return [];
    return getVaccinations()
      .filter(function (v) { return v.patientId === patientId; })
      .sort(function (a, b) { return (b.dateGiven || '').localeCompare(a.dateGiven || ''); });
  }

  function addVaccination(fields) {
    var list = getVaccinations();
    var rec = mkVaccination(fields);
    list.push(rec);
    saveVaccinations(list);
    return rec;
  }

  function updateVaccination(id, patch) {
    var list = getVaccinations();
    var idx = list.findIndex(function (v) { return v.id === id; });
    if (idx === -1) return;
    Object.assign(list[idx], patch);
    saveVaccinations(list);
  }

  // ------------------------------------------------------------------
  // attach onto the shared PCData object — same approach
  // billing-data-store.js uses, so every existing D.getPatients(),
  // D.addPatient(), D.getVaccinationsForPatientId(), etc. call site
  // across the app keeps working unchanged.
  // ------------------------------------------------------------------

  Object.assign(PCData, {
    // patients
    SEX_OPTIONS: SEX_OPTIONS,
    PATIENT_STATUSES: PATIENT_STATUSES,
    VACCINATION_STATUSES: VACCINATION_STATUSES,
    BREED_SUGGESTIONS: BREED_SUGGESTIONS,
    getPatients: getPatients,
    savePatients: savePatients,
    getPatientById: getPatientById,
    addPatient: addPatient,
    updatePatient: updatePatient,
    calcAge: calcAge,
    getAppointmentsForPatient: getAppointmentsForPatient,
    getLastVisit: getLastVisit,

    // vaccination records
    VACCINATION_DUE_SOON_DAYS: VACCINATION_DUE_SOON_DAYS,
    computeVaccinationStatus: computeVaccinationStatus,
    getVaccinations: getVaccinations,
    saveVaccinations: saveVaccinations,
    getVaccinationById: getVaccinationById,
    getVaccinationsForPatientId: getVaccinationsForPatientId,
    addVaccination: addVaccination,
    updateVaccination: updateVaccination
  });
})(window);