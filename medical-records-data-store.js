// ============================================================
// PAWSITIVE CARE — Medical Records data store
// Extracted from data-store.js so Medical Records (visit-level
// clinical history) owns its own storage module, the same way
// Patients (patient-data-store.js) and Billing
// (billing-data-store.js) were already split out.
//
// This file attaches its functions onto the EXISTING window.PCData
// object at runtime instead of creating a second global, so every
// existing PCData.getMedicalRecords()/addMedicalRecord()/etc. call
// anywhere in the app — medical-records.js, and any other page that
// reads a patient's medical history (e.g. the Patient Profile) —
// keeps working completely unchanged.
//
// LOAD ORDER: this file must load AFTER data-store.js (it uses
// PCData.__readRaw/__writeRaw for persistence + cross-tab sync, and
// PCData.todayStr/dateStr/VETS), and before medical-records.js. It
// should also load after patient-data-store.js where possible, since
// seeding links records to real Patients via PCData.getPatients() —
// but that lookup is guarded below, so nothing throws even if this
// file loads before patient-data-store.js or that file is absent.
// ============================================================

(function (global) {
  var PCData = global.PCData;
  if (!PCData) {
    // data-store.js must load before this file. Bail out safely
    // instead of throwing, so a misordered <script> tag doesn't take
    // down the rest of the page.
    return;
  }

  var readRaw = PCData.__readRaw;
  var writeRaw = PCData.__writeRaw;

  var MEDREC_KEY = 'pcv1_medrecords';

  var MED_VISIT_TYPES = ['General Consultation', 'Vaccination', 'Skin Check-up', 'Deworming', 'Surgery', 'Dental Cleaning', 'Grooming', 'Follow-up Checkup', 'Nail Trim', 'Wing Check', 'Weight Check', 'Other'];

  var MED_STATUSES = ['completed', 'ongoing', 'follow-up', 'cancelled'];

  // Reuses the same badge colors Appointments already defines in style.css
  // (status-completed / status-confirmed / status-pending / status-cancelled)
  // instead of introducing a parallel color set.
  var MED_STATUS_LABELS = {
    completed: 'Completed',
    ongoing: 'Ongoing Treatment',
    'follow-up': 'Follow-up Required',
    cancelled: 'Cancelled'
  };
  var MED_STATUS_BADGE_CLASS = {
    completed: 'status-completed',
    ongoing: 'status-confirmed',
    'follow-up': 'status-pending',
    cancelled: 'status-cancelled'
  };

  function mrUid() {
    return 'mr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function mkMedRecord(fields) {
    return Object.assign({
      id: mrUid(),
      patientId: null,
      appointmentId: null,  // set when the record is created from a specific Appointment (e.g. completing a queue consultation); null for records added directly, same optional-link convention Appointments already uses for patientId/clientId
      pet: '',
      owner: '',
      date: PCData.todayStr(),
      vet: PCData.VETS[0],
      visitType: 'General Consultation',
      chiefComplaint: '',
      symptoms: '',
      examFindings: '',
      diagnosis: '',
      treatment: '',
      prescription: '',
      vaccination: '',
      weight: '',
      followUpDate: '',
      vetNotes: '',
      status: 'completed',
      createdAt: Date.now()
    }, fields);
  }

  // Looks up a seeded patient's real (already-persisted) id by pet name,
  // so seed records link to Patients the same way real Add/Edit ones will.
  // Guarded in case this file loads without patient-data-store.js also
  // being loaded: seed records simply link to no Patient (patientId
  // stays null) instead of throwing, so this page's own features keep
  // working either way.
  function findSeedPatientId(petName) {
    if (!PCData.getPatients) return null;
    var match = PCData.getPatients().find(function (p) { return p.pet === petName; });
    return match ? match.id : null;
  }

  function seedMedRecordsIfEmpty() {
    var existing = readRaw(MEDREC_KEY);
    if (existing && existing.length) return;

    function rec(petName, owner, fields) {
      return mkMedRecord(Object.assign({ patientId: findSeedPatientId(petName), pet: petName, owner: owner }, fields));
    }

    var seed = [
      rec('Luna', 'Kyle Domingo', { date: PCData.dateStr(0), vet: 'Dr. Cruz', visitType: 'Skin Check-up', chiefComplaint: 'Itching and scratching', symptoms: 'Redness, mild hair loss on lower back', examFindings: 'Mild dermatitis, no parasites found', diagnosis: 'Skin allergy', treatment: 'Antihistamine and medicated shampoo', prescription: 'Apoquel 5mg, once daily for 2 weeks', vaccination: 'None', weight: '3.9', followUpDate: PCData.dateStr(14), vetNotes: 'Monitor for improvement, recheck in 2 weeks.', status: 'follow-up' }),
      rec('Luna', 'Kyle Domingo', { date: PCData.dateStr(-18), vet: 'Dr. Reyes', visitType: 'Vaccination', chiefComplaint: 'Annual vaccination', symptoms: 'None', examFindings: 'Healthy, no abnormalities noted', diagnosis: 'None', treatment: 'Vaccination administered', prescription: 'None', vaccination: 'FVRCP booster', weight: '3.8', followUpDate: '', vetNotes: 'No adverse reaction observed on-site.', status: 'completed' }),
      rec('Luna', 'Kyle Domingo', { date: PCData.dateStr(-61), vet: 'Dr. Santos', visitType: 'General Consultation', chiefComplaint: 'Routine check-up', symptoms: 'None', examFindings: 'Normal on all counts', diagnosis: 'Healthy', treatment: 'None required', prescription: 'None', vaccination: 'None', weight: '3.7', followUpDate: '', vetNotes: 'Overall good health.', status: 'completed' }),
      rec('Max', 'Renz Villanueva', { date: PCData.dateStr(-3), vet: 'Dr. Santos', visitType: 'General Consultation', chiefComplaint: 'Annual wellness exam', symptoms: 'None', examFindings: 'Good body condition, healthy coat', diagnosis: 'Healthy', treatment: 'None required', prescription: 'None', vaccination: 'None', weight: '28.5', followUpDate: '', vetNotes: 'Continue current diet.', status: 'completed' }),
      rec('Bella', 'Ana Marasigan', { date: PCData.dateStr(-9), vet: 'Dr. Reyes', visitType: 'Vaccination', chiefComplaint: 'Booster due', symptoms: 'None', examFindings: 'Healthy', diagnosis: 'None', treatment: 'Vaccination administered', prescription: 'None', vaccination: 'Rabies booster', weight: '6.2', followUpDate: PCData.dateStr(365), vetNotes: 'Next booster due in one year.', status: 'completed' }),
      rec('Milo', 'Grace Panganiban', { date: PCData.dateStr(-2), vet: 'Dr. Santos', visitType: 'Deworming', chiefComplaint: 'Routine deworming', symptoms: 'None', examFindings: 'Normal', diagnosis: 'None', treatment: 'Deworming tablet administered', prescription: 'Drontal, single dose', vaccination: 'None', weight: '4.1', followUpDate: '', vetNotes: 'Repeat in 3 months.', status: 'completed' }),
      rec('Simba', 'Patricia Uy', { date: PCData.dateStr(-6), vet: 'Dr. Cruz', visitType: 'Follow-up Checkup', chiefComplaint: 'Mobility follow-up', symptoms: 'Slight stiffness after rest', examFindings: 'Mild hip discomfort on palpation', diagnosis: 'Mild hip dysplasia', treatment: 'Continue joint supplement, controlled exercise', prescription: 'Joint supplement, daily', vaccination: 'None', weight: '24', followUpDate: PCData.dateStr(30), vetNotes: 'Reassess gait in one month.', status: 'ongoing' }),
      rec('Chichi', 'Ramon Aquino', { date: PCData.dateStr(-15), vet: 'Dr. Cruz', visitType: 'General Consultation', chiefComplaint: 'Vomiting, lethargy', symptoms: 'Vomiting after meals, reduced appetite', examFindings: 'Mild abdominal sensitivity', diagnosis: 'Sensitive stomach / mild gastritis', treatment: 'Bland diet, anti-nausea medication', prescription: 'Cerenia, short course', vaccination: 'None', weight: '4.5', followUpDate: PCData.dateStr(-8), vetNotes: 'Owner advised to keep on prescribed diet.', status: 'follow-up' }),
      rec('Rocky', 'Bea Lozada', { date: PCData.dateStr(-4), vet: 'Dr. Santos', visitType: 'Vaccination', chiefComplaint: 'Annual vaccination due', symptoms: 'None', examFindings: 'Healthy', diagnosis: 'None', treatment: 'Vaccination administered', prescription: 'None', vaccination: 'DHPPi booster', weight: '32', followUpDate: '', vetNotes: 'No reaction observed.', status: 'completed' }),
      rec('Zeus', 'Carlo Beltran', { date: PCData.dateStr(-1), vet: 'Dr. Santos', visitType: 'General Consultation', chiefComplaint: 'Limping, right leg', symptoms: 'Favoring right hind leg, mild swelling', examFindings: 'Soft tissue swelling, no fracture on palpation', diagnosis: 'Suspected soft tissue strain', treatment: 'Rest, short course pain reliever', prescription: 'Carprofen, short course', vaccination: 'None', weight: '40', followUpDate: PCData.dateStr(13), vetNotes: 'Recheck in 2 weeks if limping persists.', status: 'ongoing' }),
      rec('Bruno', 'Dennis Ocampo', { date: PCData.dateStr(-30), vet: 'Dr. Cruz', visitType: 'General Consultation', chiefComplaint: 'Ear scratching', symptoms: 'Head shaking, odor from ear', examFindings: 'Inflamed ear canal, discharge present', diagnosis: 'Chronic ear infection', treatment: 'Ear cleaning, topical medication', prescription: 'Ear drops, twice daily for 10 days', vaccination: 'None', weight: '12', followUpDate: '', vetNotes: 'Owner cleaning ears regularly at home.', status: 'completed' })
    ];

    writeRaw(MEDREC_KEY, seed);
  }

  function getMedicalRecords() {
    seedMedRecordsIfEmpty();
    return readRaw(MEDREC_KEY) || [];
  }

  function saveMedicalRecords(list) {
    writeRaw(MEDREC_KEY, list);
  }

  function getMedRecordById(id) {
    return getMedicalRecords().find(function (r) { return r.id === id; });
  }

  function addMedicalRecord(fields) {
    var list = getMedicalRecords();
    var rec = mkMedRecord(fields);
    list.push(rec);
    saveMedicalRecords(list);
    return rec;
  }

  function updateMedicalRecord(id, patch) {
    var list = getMedicalRecords();
    var idx = list.findIndex(function (r) { return r.id === id; });
    if (idx === -1) return;
    Object.assign(list[idx], patch);
    saveMedicalRecords(list);
  }

  // Every medical record for a given patient id, most recent first.
  function getMedicalRecordsForPatientId(patientId) {
    if (!patientId) return [];
    return getMedicalRecords()
      .filter(function (r) { return r.patientId === patientId; })
      .sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
  }

  // The medical record(s), if any, created from a given appointment.
  function getMedicalRecordsForAppointmentId(appointmentId) {
    if (!appointmentId) return [];
    return getMedicalRecords().filter(function (r) { return r.appointmentId === appointmentId; });
  }

  // Attach onto the EXISTING PCData object (same pattern
  // patient-data-store.js / billing-data-store.js already use)
  // instead of creating a second global — every existing
  // PCData.getMedicalRecords()/addMedicalRecord()/etc. call anywhere
  // else in the app keeps working exactly as before.
  Object.assign(PCData, {
    MED_VISIT_TYPES: MED_VISIT_TYPES,
    MED_STATUSES: MED_STATUSES,
    MED_STATUS_LABELS: MED_STATUS_LABELS,
    MED_STATUS_BADGE_CLASS: MED_STATUS_BADGE_CLASS,
    getMedicalRecords: getMedicalRecords,
    saveMedicalRecords: saveMedicalRecords,
    getMedRecordById: getMedRecordById,
    addMedicalRecord: addMedicalRecord,
    updateMedicalRecord: updateMedicalRecord,
    getMedicalRecordsForPatientId: getMedicalRecordsForPatientId,
    getMedicalRecordsForAppointmentId: getMedicalRecordsForAppointmentId
  });
})(window);