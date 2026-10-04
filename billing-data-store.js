// ============================================================
// PAWSITIVE CARE — Billing data store (Invoices + Payments)
//
// Extracted from data-store.js. This file does NOT create its
// own data object — it attaches Billing functionality onto the
// existing window.PCData object created by data-store.js.
//
// Load order (required):
//   1) data-store.js            (creates window.PCData)
//   2) billing-data-store.js    (this file — extends PCData)
//   3) billing.js               (uses PCData.getInvoices(), etc.)
//
// Dependencies on shared/core PCData functionality (NOT duplicated
// here, just used):
//   - PCData.todayStr()
//   - PCData.getAppointments()
//   - PCData.getById()                  (appointment lookup)
//   - PCData.getPatientForAppointment()
//   - PCData.getClientForAppointment()
//   - PCData.getPatientById()
//   - PCData.getClientById()
//   - PCData.__readRaw() / PCData.__writeRaw()
//       Low-level localStorage read/write helpers, exposed by
//       data-store.js specifically so Billing (and any other
//       future module) can persist its own keys through the same
//       storage + cross-tab 'pcv1:change' sync mechanism that
//       Appointments/Patients/Clients/etc. already use, without
//       duplicating that persistence logic here.
//
// Behavior is unchanged from the original data-store.js — this is
// a straight extraction, not a rewrite.
// ============================================================

(function (global) {
  'use strict';

  var D = global.PCData;
  if (!D) {
    throw new Error('billing-data-store.js requires data-store.js to be loaded first (window.PCData is missing).');
  }

  var readRaw = D.__readRaw;
  var writeRaw = D.__writeRaw;
  var todayStr = D.todayStr;

  // ------------------------------------------------------------------
  // storage keys (Billing-owned)
  // ------------------------------------------------------------------

  var INVOICES_KEY = 'pcv1_invoices';
  var INVOICE_COUNTER_KEY = 'pcv1_invoice_counter';
  var PAYMENTS_KEY = 'pcv1_payments';

  var INVOICE_STATUSES = ['unpaid', 'pending-verification', 'paid', 'rejected', 'refunded'];
  var INVOICE_STATUS_LABELS = {
    'unpaid': 'Unpaid',
    'pending-verification': 'Pending Verification',
    'paid': 'Paid',
    'rejected': 'Rejected',
    'refunded': 'Refunded'
  };

  var INVOICE_ITEM_TYPES = ['service', 'medicine', 'other'];

  // Supported payment methods (the ONLY ones selectable in the UI).
  var PAYMENT_METHODS = ['gcash', 'bdo', 'bpi', 'metrobank', 'cash'];
  var PAYMENT_METHOD_LABELS = {
    'gcash': 'GCash',
    'bdo': 'BDO',
    'bpi': 'BPI',
    'metrobank': 'MetroBank',
    'cash': 'Cash'
  };
  // Display-only labels for methods that are no longer supported. They are
  // never offered in a dropdown and never accepted by updatePendingPayment();
  // they only let an old stored record still read sensibly in history.
  var PAYMENT_METHOD_LEGACY_LABELS = {
    'bank-transfer': 'Bank Transfer',
    'cash-to-gcash': "Cash \u2192 Clinic GCash",
    'cash-to-bank': "Cash \u2192 Clinic Bank Transfer"
  };

  var PAYMENT_STATUSES = ['pending-verification', 'verified', 'rejected'];

  // Business-rule failures keep the store's existing contract (the
  // action returns false/null and changes nothing). Phase 2 adds the
  // reason behind that false/null: every action clears lastBillingError
  // when it starts and sets a short human-readable message when it
  // refuses, readable via PCData.getLastBillingError(). Existing callers
  // that only check the return value are unaffected.
  var lastBillingError = '';

  function setBillingError(message) {
    lastBillingError = message || '';
  }

  function getLastBillingError() {
    return lastBillingError;
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  // Local-time YYYY-MM-DD for a millisecond timestamp, in the same
  // local-date format PCData.todayStr() returns, so "was this verified
  // today" compares like with like.
  function localDateOf(ts) {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return null;
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function billingMoney(n) {
    return '\u20B1' + (Number(n) || 0).toFixed(2);
  }

  // Compare in whole centavos so ordinary floating-point noise (e.g.
  // 1550.1 * 3) never causes a false mismatch.
  function amountsMatch(a, b) {
    return Math.round((Number(a) || 0) * 100) === Math.round((Number(b) || 0) * 100);
  }

  function ivUid() {
    return 'inv_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function payUid() {
    return 'pay_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function nextInvoiceNumber() {
    var counter = readRaw(INVOICE_COUNTER_KEY) || { n: 0 };
    counter.n += 1;
    writeRaw(INVOICE_COUNTER_KEY, counter);
    return 'INV-' + String(counter.n).padStart(4, '0');
  }

  function calcInvoiceTotal(items) {
    return (items || []).reduce(function (sum, it) {
      var qty = Number(it.qty) || 0;
      var price = Number(it.unitPrice) || 0;
      return sum + (qty * price);
    }, 0);
  }

  // Subtotal is exactly the existing line-item sum above — Phase 3B
  // introduces the term "subtotal" (pre-discount) without duplicating
  // the accumulation logic. calcInvoiceTotal() is kept as-is (and still
  // used by any external caller that already depends on it) since it
  // has always meant "sum of items"; calcInvoiceSubtotal() is just the
  // Billing-facing name for that same number.
  function calcInvoiceSubtotal(items) {
    return calcInvoiceTotal(items);
  }

  // total = subtotal - discount, floored at 0. Discount itself is also
  // floored at 0 (no negative discounts) so it can never push the total
  // negative or above the subtotal.
  function calcFinalTotal(subtotal, discount) {
    var d = Math.max(0, Number(discount) || 0);
    return Math.max(0, (Number(subtotal) || 0) - d);
  }

  function mkInvoice(fields) {
    return Object.assign({
      id: ivUid(),
      invoiceNumber: '',
      appointmentId: null,
      patientId: null,   // denormalized from the appointment at creation time, same trade-off Medical Records already makes
      clientId: null,
      vet: null,          // denormalized from the appointment's veterinarian at creation time (Phase 3B) — never invented, left null if the appointment has none
      date: todayStr(),
      items: [],         // [{ id, type: 'service'|'medicine'|'other', name, qty, unitPrice, serviceId?, inventoryItemId? }]
                          // serviceId (optional) records which Services-module
                          // service a 'service' item was added from, via
                          // PCData.getServicePriceSnapshot(). It's a reference
                          // only — name/unitPrice are copied at add-time and
                          // never re-synced, so a later Service price change
                          // never retroactively changes an existing invoice.
                          // inventoryItemId (optional) is the same idea for a
                          // 'medicine' item added from Inventory (PCData.
                          // getInventoryById()) — name/unitPrice are copied at
                          // add-time, and adding/saving an invoice never reads
                          // or changes the Inventory item's quantity.
      subtotal: 0,        // Phase 3B: sum of items before discount (calcInvoiceSubtotal)
      discount: 0,         // Phase 3B: frontend/demo numeric amount, defaults to 0
      totalAmount: 0,      // subtotal - discount, floored at 0 — unchanged meaning for every existing caller
      status: 'unpaid',
      notes: '',
      createdAt: Date.now(),
      paidAt: null,
      // Phase 2 refund metadata. Only ever filled in by refundInvoice();
      // invoices stored before this phase simply don't have these keys
      // and are read through getInvoiceDisplayInfo()/getRefundedPayments(),
      // which resolve missing values to null/''.
      refundedAt: null,
      refundAmount: null,
      refundReason: '',
      refundedBy: null
    }, fields);
  }

  function getInvoices() {
    return readRaw(INVOICES_KEY) || [];
  }

  function saveInvoices(list) {
    writeRaw(INVOICES_KEY, list);
  }

  function getInvoiceById(id) {
    return getInvoices().find(function (i) { return i.id === id; });
  }

  // One invoice per appointment — surfaced so the "New Invoice" flow can
  // point back to an existing invoice instead of creating a second one.
  function getInvoiceForAppointment(appointmentId) {
    if (!appointmentId) return null;
    return getInvoices().find(function (i) { return i.appointmentId === appointmentId; }) || null;
  }

  // Completed appointments that don't already have an invoice — the
  // pool a new invoice can be created against, keeping Billing chained
  // to a real appointment instead of freeform client/pet entry.
  function getInvoiceableAppointments() {
    return D.getAppointments().filter(function (a) {
      return a.status === 'completed' && !getInvoiceForAppointment(a.id);
    }).sort(function (a, b) { return (b.date + b.time).localeCompare(a.date + a.time); });
  }

  function addInvoice(fields) {
    var list = getInvoices();
    var inv = mkInvoice(fields);
    inv.invoiceNumber = nextInvoiceNumber();
    inv.subtotal = calcInvoiceSubtotal(inv.items);
    inv.discount = Math.max(0, Number(fields.discount) || 0);
    inv.totalAmount = calcFinalTotal(inv.subtotal, inv.discount);
    // Veterinarian: reuse the appointment's own vet field if the caller
    // didn't already supply one explicitly. Never fabricated — stays
    // null if the appointment has no vet on it.
    if (!inv.vet && inv.appointmentId) {
      var appt = D.getById(inv.appointmentId);
      inv.vet = (appt && appt.vet) || null;
    }
    list.push(inv);
    saveInvoices(list);
    return inv;
  }

  function updateInvoice(id, patch) {
    var list = getInvoices();
    var idx = list.findIndex(function (i) { return i.id === id; });
    if (idx === -1) return;
    Object.assign(list[idx], patch);
    // Recompute subtotal/total whenever items and/or discount change.
    // A patch touching neither (e.g. {status:'paid'}, {status:'refunded'})
    // leaves subtotal/discount/totalAmount exactly as they were —
    // existing verify/reject/refund behavior is unchanged.
    if (patch.items || typeof patch.discount !== 'undefined') {
      list[idx].subtotal = calcInvoiceSubtotal(list[idx].items);
      list[idx].discount = Math.max(0, Number(list[idx].discount) || 0);
      list[idx].totalAmount = calcFinalTotal(list[idx].subtotal, list[idx].discount);
    }
    saveInvoices(list);
  }

  // Only a Paid invoice can be refunded — 'Refunded' is a terminal state
  // reached from 'paid', never from unpaid/pending/rejected.
  //
  // Phase 2: also records refund metadata on the INVOICE (the original
  // verified payment is left untouched, so nothing is duplicated and the
  // payment still shows what was actually received):
  //   refundedAt   - when the refund was performed (Date.now())
  //   refundAmount - the invoice's totalAmount (full refund only; there
  //                  is no partial-refund concept)
  //   refundReason - options.reason, trimmed ('' if none given)
  //   refundedBy   - options.refundedBy, default 'Administrator'
  // `options` is optional, so refundInvoice(id) keeps working exactly
  // as before for any existing caller. Returns true/false as before; the
  // reason for a false is in getLastBillingError().
  function refundInvoice(id, options) {
    setBillingError('');
    var invoice = getInvoiceById(id);
    if (!invoice) { setBillingError('Invoice not found.'); return false; }
    if (invoice.status === 'refunded') { setBillingError('This invoice has already been refunded.'); return false; }
    if (invoice.status !== 'paid') { setBillingError('Only a paid invoice can be refunded.'); return false; }
    var amount = Number(invoice.totalAmount);
    if (!isFinite(amount) || amount < 0) { setBillingError('This invoice has an invalid total and cannot be refunded.'); return false; }
    var opts = options || {};
    updateInvoice(id, {
      status: 'refunded',
      refundedAt: Date.now(),
      refundAmount: amount,
      refundReason: String(opts.reason == null ? '' : opts.reason).trim(),
      refundedBy: opts.refundedBy || 'Administrator'
    });
    return true;
  }

  // Display-ready view of an invoice: real, current Patient/Client data
  // where the linked appointment resolves to one, falling back to the
  // appointment's own stored pet/owner text otherwise — mirrors Queue's
  // getQueueDisplayInfo() so Billing never has to duplicate client/pet
  // records of its own.
  function getInvoiceDisplayInfo(invoice) {
    if (!invoice) return null;
    var appt = D.getById(invoice.appointmentId);
    // getPatientById lives in patient-data-store.js, so it's guarded the
    // same way billing.js and data-store.js already guard it: a page that
    // doesn't load that file gets "no linked patient" instead of a throw.
    var patient = appt ? D.getPatientForAppointment(appt) : (invoice.patientId && typeof D.getPatientById === 'function' ? D.getPatientById(invoice.patientId) : null);
    var client = appt ? D.getClientForAppointment(appt) : (invoice.clientId ? D.getClientById(invoice.clientId) : null);
    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      appointmentId: invoice.appointmentId,
      patientId: patient ? patient.id : invoice.patientId,
      clientId: client ? client.id : invoice.clientId,
      pet: (patient && patient.pet) || (appt && appt.pet) || '\u2014',
      species: (patient && patient.species) || (appt && appt.species) || null,
      owner: (client && client.name) || (appt && appt.owner) || '\u2014',
      // Prefer the live appointment's vet (stays current if it's ever
      // corrected there); fall back to the invoice's own denormalized
      // vet snapshot for an invoice whose appointment no longer resolves.
      vet: (appt && appt.vet) || invoice.vet || null,
      appointmentReason: appt && appt.reason,
      appointmentDate: appt && appt.date,
      appointmentTime: appt && appt.time,
      date: invoice.date,
      items: invoice.items,
      // Phase 3D display-only fallback for invoices created before Phase
      // 3B: a legacy invoice has no `subtotal`/`discount` of its own, but
      // its existing totalAmount already IS the pre-discount sum (there
      // was no discount concept yet), so that's the correct subtotal to
      // show and 0 is the correct discount — computed here on the return
      // value only, the stored `invoice` object itself is never touched.
      subtotal: (typeof invoice.subtotal === 'number') ? invoice.subtotal : invoice.totalAmount,
      discount: (typeof invoice.discount === 'number') ? invoice.discount : 0,
      totalAmount: invoice.totalAmount,
      status: invoice.status,
      notes: invoice.notes,
      // Phase 2: refund metadata, null/'' for invoices that were never
      // refunded or that were stored before these fields existed. Computed
      // on the returned copy only; the stored invoice is never touched.
      refundedAt: invoice.refundedAt || null,
      refundAmount: (typeof invoice.refundAmount === 'number') ? invoice.refundAmount : null,
      refundReason: invoice.refundReason || '',
      refundedBy: invoice.refundedBy || null
    };
  }

  function mkPayment(fields) {
    return Object.assign({
      id: payUid(),
      invoiceId: null,
      method: 'cash',
      amount: 0,
      referenceNumber: '',
      paymentDate: todayStr(),
      proofName: '',     // attached proof's filename (mock — no real file backend yet)
      notes: '',
      submittedBy: 'Front Desk',
      status: 'pending-verification',
      createdAt: Date.now(),
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: ''
    }, fields);
  }

  function getPayments() {
    return readRaw(PAYMENTS_KEY) || [];
  }

  function savePayments(list) {
    writeRaw(PAYMENTS_KEY, list);
  }

  function getPaymentById(id) {
    return getPayments().find(function (p) { return p.id === id; });
  }

  function getPaymentsForInvoice(invoiceId) {
    return getPayments()
      .filter(function (p) { return p.invoiceId === invoiceId; })
      .sort(function (a, b) { return b.createdAt - a.createdAt; });
  }

  function getPendingPaymentForInvoice(invoiceId) {
    return getPayments().find(function (p) { return p.invoiceId === invoiceId && p.status === 'pending-verification'; }) || null;
  }

  // Every payment currently awaiting an Administrator's review, oldest first.
  function getPendingVerifications() {
    return getPayments()
      .filter(function (p) { return p.status === 'pending-verification'; })
      .sort(function (a, b) { return a.createdAt - b.createdAt; });
  }

  // Receptionist-facing: submit a payment for an invoice. This only ever
  // creates a 'pending-verification' payment — it never marks an invoice
  // Paid by itself. Guards:
  //  - an already-Paid invoice cannot be paid again
  //  - an invoice already awaiting verification cannot get a second,
  //    competing submission (the pending one must be verified/rejected first)
  function submitPayment(invoiceId, fields) {
    setBillingError('');
    var invoice = getInvoiceById(invoiceId);
    if (!invoice) { setBillingError('Invoice not found.'); return null; }
    if (invoice.status === 'paid') { setBillingError('This invoice is already paid.'); return null; }
    // Phase 2: 'refunded' is terminal — a refunded invoice can't take a
    // new payment through the normal submission flow.
    if (invoice.status === 'refunded') { setBillingError('This invoice has been refunded and cannot receive a new payment.'); return null; }
    if (invoice.status === 'pending-verification' || getPendingPaymentForInvoice(invoiceId)) { setBillingError('A payment for this invoice is already awaiting verification.'); return null; }

    var list = getPayments();
    var payment = mkPayment(Object.assign({}, fields, {
      invoiceId: invoiceId,
      status: 'pending-verification',
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: ''
    }));
    list.push(payment);
    savePayments(list);

    updateInvoice(invoiceId, { status: 'pending-verification' });
    return payment;
  }

  // Attach a proof to an existing payment that is still awaiting review
  // and has none yet. Writes ONLY proofName / proofDataUrl -- amount,
  // reference, date, method, invoice, status, submittedBy and notes are
  // never touched, and the payment stays 'pending-verification'. A proof
  // that is already stored is never replaced. If the write fails (e.g.
  // browser storage is full) the previous list is restored.
  function updatePaymentProof(paymentId, proofName, proofDataUrl) {
    setBillingError('');
    var list = getPayments();
    var idx = list.findIndex(function (p) { return p.id === paymentId; });
    if (idx === -1) { setBillingError('Payment not found.'); return false; }
    if (list[idx].status !== 'pending-verification') { setBillingError('This payment has already been reviewed.'); return false; }
    if (list[idx].proofName || list[idx].proofDataUrl) { setBillingError('This payment already has a submitted proof.'); return false; }
    if (!proofName) { setBillingError('No payment proof was provided.'); return false; }
    var before = JSON.parse(JSON.stringify(list));
    list[idx].proofName = String(proofName);
    list[idx].proofDataUrl = proofDataUrl ? String(proofDataUrl) : '';
    try {
      savePayments(list);
    } catch (e) {
      try { savePayments(before); } catch (e2) { /* nothing more to do */ }
      setBillingError('The proof could not be saved \u2014 browser storage may be full. Try a smaller file.');
      return false;
    }
    return true;
  }

  // Remove the stored proof from a payment that is still awaiting review
  // (e.g. the wrong file was attached). Clears ONLY proofName / proofDataUrl;
  // the payment is kept, stays 'pending-verification', and every other
  // field and the invoice are untouched. Verified / rejected payments are
  // refused, so an approved proof can never be removed. If the write fails
  // (e.g. browser storage error) the previous list is restored.
  function removePaymentProof(paymentId) {
    setBillingError('');
    var list = getPayments();
    var idx = list.findIndex(function (p) { return p.id === paymentId; });
    if (idx === -1) { setBillingError('Payment not found.'); return false; }
    if (list[idx].status !== 'pending-verification') { setBillingError('This payment has already been reviewed. Its proof can no longer be removed.'); return false; }
    if (!list[idx].proofName && !list[idx].proofDataUrl) { setBillingError('This payment has no proof to remove.'); return false; }
    var before = JSON.parse(JSON.stringify(list));
    list[idx].proofName = '';
    list[idx].proofDataUrl = '';
    try {
      savePayments(list);
    } catch (e) {
      try { savePayments(before); } catch (e2) { /* nothing more to do */ }
      setBillingError('The proof could not be removed \u2014 browser storage returned an error. Please try again.');
      return false;
    }
    return true;
  }

  // Edit the entry details of a payment that is still awaiting review.
  // `patch` may contain ONLY method / amount / referenceNumber / paymentDate;
  // any other key is ignored, so id, invoiceId, proof, notes, submittedBy,
  // status, createdAt and the review fields can never be changed here, and
  // the invoice is never touched. Every rule submission relies on is
  // re-checked against the resulting values (same messages as the UI):
  //  - the payment must still be 'pending-verification'
  //  - method must be one of PAYMENT_METHODS
  //  - amount must be a number > 0 and equal the invoice total (centavos)
  //  - a non-cash method needs a reference number (cash stores none)
  //  - paymentDate must be a real YYYY-MM-DD date
  //  - a payment that already has a stored proof cannot be switched to Cash
  //    (Cash takes no proof; remove the proof first)
  // On any refusal nothing changes and getLastBillingError() says why. If
  // the write itself fails the previous list is restored.
  var EDITABLE_PENDING_FIELDS = ['method', 'amount', 'referenceNumber', 'paymentDate'];

  function isValidIsoDate(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!m) return false;
    var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    var dt = new Date(y, mo - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
  }

  function updatePendingPayment(paymentId, patch) {
    setBillingError('');
    var list = getPayments();
    var idx = list.findIndex(function (p) { return p.id === paymentId; });
    if (idx === -1) { setBillingError('Payment not found.'); return false; }
    var current = list[idx];
    if (current.status !== 'pending-verification') { setBillingError('This payment has already been reviewed and can no longer be edited.'); return false; }
    var invoice = getInvoiceById(current.invoiceId);
    if (!invoice) { setBillingError('The invoice for this payment could not be found.'); return false; }

    var touched = EDITABLE_PENDING_FIELDS.filter(function (k) {
      return patch && Object.prototype.hasOwnProperty.call(patch, k);
    });
    if (!touched.length) { setBillingError('There are no changes to save.'); return false; }

    var next = {
      method: current.method,
      amount: current.amount,
      referenceNumber: current.referenceNumber || '',
      paymentDate: current.paymentDate
    };
    touched.forEach(function (k) { next[k] = patch[k]; });

    if (PAYMENT_METHODS.indexOf(next.method) === -1) { setBillingError('Choose a valid payment method.'); return false; }
    var amount = Number(next.amount);
    if (!isFinite(amount) || amount <= 0) { setBillingError('Enter a valid amount received.'); return false; }
    var invoiceTotal = Number(invoice.totalAmount);
    if (!isFinite(invoiceTotal) || !amountsMatch(amount, invoiceTotal)) {
      setBillingError('Amount Received must match the invoice total of ' + billingMoney(invoiceTotal) + '.');
      return false;
    }
    var ref = String(next.referenceNumber == null ? '' : next.referenceNumber).trim();
    if (next.method === 'cash') ref = '';
    else if (!ref) { setBillingError('Enter the reference number for this ' + (PAYMENT_METHOD_LABELS[next.method] || next.method) + ' payment.'); return false; }
    if (!isValidIsoDate(next.paymentDate)) { setBillingError('Choose a valid payment date.'); return false; }
    if (next.method === 'cash' && current.method !== 'cash' && (current.proofName || current.proofDataUrl)) {
      setBillingError('Remove the payment proof before switching to Cash.');
      return false;
    }

    var before = JSON.parse(JSON.stringify(list));
    if (touched.indexOf('method') !== -1) current.method = next.method;
    if (touched.indexOf('amount') !== -1) current.amount = Math.round(amount * 100) / 100;   // whole centavos
    if (touched.indexOf('paymentDate') !== -1) current.paymentDate = next.paymentDate;
    // Reference follows the method: edited directly, or cleared when the
    // payment becomes Cash (which carries no reference).
    if (touched.indexOf('referenceNumber') !== -1 || (next.method === 'cash' && (current.referenceNumber || ''))) current.referenceNumber = ref;
    try {
      savePayments(list);
    } catch (e) {
      try { savePayments(before); } catch (e2) { /* nothing more to do */ }
      setBillingError('The changes could not be saved \u2014 browser storage returned an error. Please try again.');
      return false;
    }
    return true;
  }

  // Administrator-only in the UI (billing.js gates the buttons); the
  // guards here still hold even if called directly. A payment can only
  // be verified once, and only while it's still pending review.
  //
  // Phase 2: the payment amount must be a valid number and must equal the
  // invoice's totalAmount (compared in centavos). There is no partial-
  // payment concept, so a mismatch is refused — nothing is changed, the
  // invoice total is never adjusted, and the payment stays pending so it
  // can be rejected and resubmitted correctly.
  //
  // The verification time is stamped once and used for BOTH the payment's
  // reviewedAt and the invoice's paidAt, so they can never disagree.
  // reviewedAt is what getTodaysCollections() reads.
  function verifyPayment(paymentId, reviewerName) {
    setBillingError('');
    var payment = getPaymentById(paymentId);
    if (!payment) { setBillingError('Payment not found.'); return false; }
    if (payment.status !== 'pending-verification') { setBillingError('This payment has already been reviewed.'); return false; }
    var invoice = getInvoiceById(payment.invoiceId);
    if (!invoice) { setBillingError('The invoice for this payment could not be found.'); return false; }
    if (invoice.status === 'paid') { setBillingError('This invoice is already paid.'); return false; }
    if (invoice.status === 'refunded') { setBillingError('This invoice has been refunded and cannot be paid.'); return false; }

    var amount = Number(payment.amount);
    if (!isFinite(amount) || amount <= 0) { setBillingError('This payment has an invalid amount.'); return false; }
    var invoiceTotal = Number(invoice.totalAmount);
    if (!isFinite(invoiceTotal) || !amountsMatch(amount, invoiceTotal)) {
      setBillingError('The payment amount (' + billingMoney(amount) + ') does not match the invoice total (' + billingMoney(invoiceTotal) + '). Reject this payment so a corrected one can be submitted.');
      return false;
    }

    var now = Date.now();
    var list = getPayments();
    var idx = list.findIndex(function (p) { return p.id === paymentId; });
    list[idx].status = 'verified';
    list[idx].reviewedBy = reviewerName || 'Administrator';
    list[idx].reviewedAt = now;
    savePayments(list);

    updateInvoice(invoice.id, { status: 'paid', paidAt: now });
    return true;
  }

  // Administrator-only in the UI. Rejecting a payment never marks the
  // invoice Paid — the invoice moves to 'rejected' (clearly unsettled)
  // so the front desk can correct the details and resubmit.
  function rejectPayment(paymentId, reviewerName, reason) {
    setBillingError('');
    var payment = getPaymentById(paymentId);
    if (!payment) { setBillingError('Payment not found.'); return false; }
    if (payment.status !== 'pending-verification') { setBillingError('This payment has already been reviewed.'); return false; }
    var invoice = getInvoiceById(payment.invoiceId);
    if (!invoice) { setBillingError('The invoice for this payment could not be found.'); return false; }

    var list = getPayments();
    var idx = list.findIndex(function (p) { return p.id === paymentId; });
    list[idx].status = 'rejected';
    list[idx].reviewedBy = reviewerName || 'Administrator';
    list[idx].reviewedAt = Date.now();
    list[idx].reviewNotes = reason || '';
    savePayments(list);

    // Phase 2: rejecting a payment must never undo a settled invoice — an
    // invoice that is already 'paid' or 'refunded' keeps that status.
    if (invoice.status !== 'paid' && invoice.status !== 'refunded') {
      updateInvoice(invoice.id, { status: 'rejected' });
    }
    return true;
  }

  // ------------------------------------------------------------------
  // Phase 2 read-only selectors for the future payment-oriented Billing
  // tabs. They only read pcv1_invoices / pcv1_payments and derive their
  // result — nothing is written, copied or cached.
  // ------------------------------------------------------------------

  // When a payment was verified: its own reviewedAt (stamped by
  // verifyPayment), falling back to the invoice's paidAt for a record
  // that has none. Never the user-entered paymentDate. null if neither
  // exists, in which case the payment is simply not counted as "today".
  function getVerifiedAt(payment, invoice) {
    return (payment && payment.reviewedAt) || (invoice && invoice.paidAt) || null;
  }

  // Payments awaiting review, oldest first (same list the Payment
  // Verification tab already uses).
  function getPendingPayments() {
    return getPendingVerifications();
  }

  // Verified payments, most recently verified first. A payment whose
  // invoice has since been refunded is NOT listed here — that money is
  // returned and belongs to getRefundedPayments() instead, so a
  // transaction never appears under both Completed and Refunded.
  function getCompletedPayments() {
    var invoices = {};
    getInvoices().forEach(function (inv) { invoices[inv.id] = inv; });
    return getPayments()
      .filter(function (p) {
        if (p.status !== 'verified') return false;
        var inv = invoices[p.invoiceId];
        return !(inv && inv.status === 'refunded');
      })
      .sort(function (a, b) {
        return (getVerifiedAt(b, invoices[b.invoiceId]) || 0) - (getVerifiedAt(a, invoices[a.invoiceId]) || 0);
      });
  }

  // Refunded transactions, most recently refunded first. A refund lives on
  // the invoice (status 'refunded' + refund metadata), and the original
  // payment keeps status 'verified', so each entry pairs the two:
  //   { invoice, payment, refundedAt, refundAmount, refundReason, refundedBy }
  // `payment` is the invoice's most recent verified payment (null if the
  // invoice has none, e.g. legacy data). Refund fields are null/'' for a
  // refunded invoice stored before refund metadata existed.
  function getRefundedPayments() {
    return getInvoices()
      .filter(function (inv) { return inv.status === 'refunded'; })
      .map(function (inv) {
        var original = getPaymentsForInvoice(inv.id).find(function (p) { return p.status === 'verified'; }) || null;
        return {
          invoice: inv,
          payment: original,
          refundedAt: inv.refundedAt || null,
          refundAmount: (typeof inv.refundAmount === 'number') ? inv.refundAmount : null,
          refundReason: inv.refundReason || '',
          refundedBy: inv.refundedBy || null
        };
      })
      .sort(function (a, b) { return (b.refundedAt || 0) - (a.refundedAt || 0); });
  }

  // Payments verified today (local date of the verification time, not the
  // user-entered paymentDate): a payment submitted yesterday and verified
  // today counts today. Refunded payments are excluded (see
  // getCompletedPayments). The amount summed is each payment's own amount.
  //   { date, total, count, payments }
  function getTodaysCollections() {
    var today = todayStr();
    var invoices = {};
    getInvoices().forEach(function (inv) { invoices[inv.id] = inv; });
    var payments = getCompletedPayments().filter(function (p) {
      return localDateOf(getVerifiedAt(p, invoices[p.invoiceId])) === today;
    });
    var total = payments.reduce(function (sum, p) { return sum + (Number(p.amount) || 0); }, 0);
    return { date: today, total: total, count: payments.length, payments: payments };
  }

  // Overview totals for the four Billing summary cards (Phase 3B).
  //
  //  - outstanding:          sum of totalAmount for invoices still owed
  //                          (status 'unpaid' or 'rejected' — there is no
  //                          'cancelled' status in INVOICE_STATUSES, so
  //                          nothing else to exclude there). Never
  //                          includes 'paid' or 'pending-verification'
  //                          invoices.
  //  - pendingVerification:  sum of the *payment records'* own amount
  //                          (not the invoice's totalAmount) for every
  //                          payment still awaiting review, since a
  //                          submitted payment amount can differ from
  //                          the invoice total (e.g. a partial payment).
  //  - totalRevenue / paidTotal: same underlying number — money actually
  //                          collected, i.e. the totalAmount of every
  //                          'paid' invoice. Kept as two keys so the
  //                          Total Revenue card and the Paid Invoices
  //                          card can each read the number in their own
  //                          role (main value vs. supporting text)
  //                          without recomputing it twice.
  //  - paidCount / totalRevenueCount: same count (# of paid invoices),
  //                          same reasoning as above.
  function getBillingSummary() {
    var invoices = getInvoices();
    var summary = {
      outstanding: 0, outstandingCount: 0,
      pendingVerification: 0, pendingVerificationCount: 0,
      totalRevenue: 0, totalRevenueCount: 0,
      paidTotal: 0, paidCount: 0
    };
    invoices.forEach(function (inv) {
      if (inv.status === 'paid') {
        summary.totalRevenue += inv.totalAmount;
        summary.totalRevenueCount += 1;
        summary.paidTotal += inv.totalAmount;
        summary.paidCount += 1;
      } else if (inv.status === 'unpaid' || inv.status === 'rejected') {
        summary.outstanding += inv.totalAmount;
        summary.outstandingCount += 1;
      }
    });
    var pendingPayments = getPendingVerifications();
    pendingPayments.forEach(function (p) {
      summary.pendingVerification += Number(p.amount) || 0;
    });
    summary.pendingVerificationCount = pendingPayments.length;
    return summary;
  }

  // ------------------------------------------------------------------
  // BILLING DEMO / MOCK DATA (frontend testing only)
  //
  // Follows the same pattern data-store.js already uses for the Queue
  // (seedQueueDemoData / clearQueueDemoData / isQueueDemoSeeded + a
  // one-time auto-seed guarded by its own meta key):
  //   - every record created here carries demoSeed:true, so demo rows
  //     are always identifiable and removable without touching real data
  //   - a dedicated meta key (pcv1_billing_demo_meta) records that the
  //     seed has run, so it never re-runs on later page loads and never
  //     comes back after clearBillingDemoData()
  //   - nothing is overwritten or reset: pcv1_invoices, pcv1_payments,
  //     pcv1_clients and pcv1_patients are only appended to, and
  //     pcv1_invoice_counter is never read or written (demo invoices use
  //     fixed INV-DEMO-xxx numbers instead of nextInvoiceNumber())
  //   - payments use the normal 'pending-verification' status, so the
  //     existing getPendingPayments() selector returns them untouched
  //
  // All names, numbers and references below are fictional.
  // Console helpers: PCData.seedBillingDemoData() (re-seeds a fresh
  // pending set), PCData.clearBillingDemoData(), PCData.isBillingDemoSeeded().
  // ------------------------------------------------------------------

  var BILLING_DEMO_KEY = 'pcv1_billing_demo_meta';

  // Safe placeholder "payment proof": a generated SVG that says, in plain
  // text, that it is demo data. Not a real receipt or personal document,
  // and no image asset is added to the project.
  function demoProofDataUrl(label) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="440" viewBox="0 0 320 440">' +
      '<rect width="320" height="440" fill="#ffffff"/><rect x="10" y="10" width="300" height="420" fill="none" stroke="#b9c9c3" stroke-width="2" stroke-dasharray="8 6"/>' +
      '<text x="160" y="90" font-family="Arial,sans-serif" font-size="26" font-weight="700" fill="#0f6b5a" text-anchor="middle">DEMO</text>' +
      '<text x="160" y="125" font-family="Arial,sans-serif" font-size="16" fill="#44524d" text-anchor="middle">PAYMENT PROOF</text>' +
      '<text x="160" y="200" font-family="Arial,sans-serif" font-size="14" fill="#44524d" text-anchor="middle">' + label + '</text>' +
      '<text x="160" y="330" font-family="Arial,sans-serif" font-size="13" fill="#8a9792" text-anchor="middle">Sample image for testing only.</text>' +
      '<text x="160" y="352" font-family="Arial,sans-serif" font-size="13" fill="#8a9792" text-anchor="middle">Not a real receipt.</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function removeDemoRecords() {
    var removed = { invoices: 0, payments: 0, clients: 0, patients: 0 };
    var inv = getInvoices(), invKeep = inv.filter(function (i) { return !i.demoSeed; });
    if (invKeep.length !== inv.length) { removed.invoices = inv.length - invKeep.length; saveInvoices(invKeep); }
    var pay = getPayments(), payKeep = pay.filter(function (p) { return !p.demoSeed; });
    if (payKeep.length !== pay.length) { removed.payments = pay.length - payKeep.length; savePayments(payKeep); }
    if (typeof D.getClients === 'function') {
      var cl = D.getClients(), clKeep = cl.filter(function (c) { return !c.demoSeed; });
      if (clKeep.length !== cl.length) { removed.clients = cl.length - clKeep.length; D.saveClients(clKeep); }
    }
    if (typeof D.getPatients === 'function') {
      var pt = D.getPatients(), ptKeep = pt.filter(function (p) { return !p.demoSeed; });
      if (ptKeep.length !== pt.length) { removed.patients = pt.length - ptKeep.length; D.savePatients(ptKeep); }
    }
    return removed;
  }

  function seedBillingDemoData() {
    // Needs the Clients + Patients stores so each demo invoice resolves to
    // a real client/pet through the normal getInvoiceDisplayInfo() path.
    if (typeof D.getClients !== 'function' || typeof D.getPatients !== 'function' || typeof D.saveClients !== 'function' || typeof D.savePatients !== 'function') {
      return { count: 0, skipped: 'Clients/Patients stores are not loaded on this page.' };
    }

    // Idempotent: drop only previous demo-tagged records, then re-add the
    // set, so re-running replaces the demo rows instead of duplicating them.
    removeDemoRecords();

    var HOUR = 3600000;
    var now = Date.now();
    var DEMO = [
      { n: '001', client: 'Maria Santos', pet: 'Max', species: 'Dog', breed: 'Mixed breed', sex: 'Male', method: 'gcash', ref: 'DEMO-GCASH-001', daysAgo: 1, proof: null, notes: 'Demo payment for testing',
        items: [{ type: 'service', name: 'General Consultation (demo)', qty: 1, unitPrice: 500 }, { type: 'medicine', name: 'Demo Medication', qty: 1, unitPrice: 350 }] },
      { n: '002', client: 'Juan Reyes', pet: 'Luna', species: 'Cat', breed: 'Domestic Shorthair', sex: 'Female', method: 'bdo', ref: 'DEMO-BDO-002', daysAgo: 2, proof: 'BDO \u00b7 DEMO-BDO-002', notes: 'Demo payment for testing',
        items: [{ type: 'service', name: 'Blood Test (demo)', qty: 1, unitPrice: 700 }, { type: 'service', name: 'Consultation (demo)', qty: 1, unitPrice: 550 }] },
      { n: '003', client: 'Ana Cruz', pet: 'Coco', species: 'Rabbit', breed: 'Holland Lop', sex: 'Female', method: 'cash', ref: '', daysAgo: 0, proof: null, notes: 'Demo cash payment',
        items: [{ type: 'service', name: 'Grooming (demo)', qty: 1, unitPrice: 600 }] },
      { n: '004', client: 'Carlo Garcia', pet: 'Rocky', species: 'Dog', breed: 'German Shepherd', sex: 'Male', method: 'bpi', ref: 'DEMO-BPI-004', daysAgo: 3, proof: 'BPI \u00b7 DEMO-BPI-004', notes: 'Demo payment for testing',
        items: [{ type: 'service', name: 'Dental Cleaning (demo)', qty: 1, unitPrice: 1500 }, { type: 'medicine', name: 'Demo Medication', qty: 1, unitPrice: 300 }] }
    ];

    var clients = D.getClients();   // reading first lets the project's own
    var patients = D.getPatients(); // seed run, so it is never skipped
    var invoices = getInvoices();
    var payments = getPayments();

    DEMO.forEach(function (d, idx) {
      var clientId = 'cl_demo_' + d.n;
      var patientId = 'pt_demo_' + d.n;
      var invoiceId = 'inv_demo_' + d.n;
      var created = now - (DEMO.length - idx) * HOUR;   // keeps the oldest-first order stable
      var date = D.dateStr(-d.daysAgo);

      clients.push({
        id: clientId, name: d.client, phone: '0900 000 0' + d.n, email: 'demo.' + d.n + '@example.invalid',
        address: 'Demo address (test data)', emergencyContact: '', notes: 'Demo client for Billing testing',
        status: 'active', createdAt: created, demoSeed: true
      });
      patients.push({
        id: patientId, clientId: clientId, pet: d.pet, species: d.species, breed: d.breed, sex: d.sex,
        dob: '', color: '', weight: '', spayed: 'Unknown', owner: d.client, ownerPhone: '0900 000 0' + d.n,
        allergies: '', conditions: '', medications: '', vaccinationStatus: 'Unknown',
        notes: 'Demo patient for Billing testing', status: 'active', createdAt: created, demoSeed: true
      });

      var items = d.items.map(function (it, i) { return { id: 'i' + (i + 1), type: it.type, name: it.name, qty: it.qty, unitPrice: it.unitPrice, serviceId: null, inventoryItemId: null }; });
      var subtotal = calcInvoiceSubtotal(items);
      var total = calcFinalTotal(subtotal, 0);
      invoices.push(mkInvoice({
        id: invoiceId, invoiceNumber: 'INV-DEMO-' + d.n, appointmentId: null, patientId: patientId, clientId: clientId,
        date: date, items: items, subtotal: subtotal, discount: 0, totalAmount: total,
        status: 'pending-verification', notes: 'Demo invoice (test data)', createdAt: created, demoSeed: true
      }));

      payments.push(mkPayment({
        id: 'pay_demo_' + d.n, invoiceId: invoiceId, method: d.method, amount: total, referenceNumber: d.ref,
        paymentDate: date, proofName: d.proof ? 'demo-proof-' + d.n + '.svg' : '',
        proofDataUrl: d.proof ? demoProofDataUrl(d.proof) : '',
        notes: d.notes, submittedBy: 'Admin', status: 'pending-verification', createdAt: created,
        reviewedBy: null, reviewedAt: null, reviewNotes: '', demoSeed: true
      }));
    });

    D.saveClients(clients);
    D.savePatients(patients);
    saveInvoices(invoices);
    savePayments(payments);
    writeRaw(BILLING_DEMO_KEY, { seeded: true, seededAt: now, count: DEMO.length });
    return { count: DEMO.length };
  }

  // Removes every demo-tagged record (and only those). Real data is untouched.
  function clearBillingDemoData() {
    var removed = removeDemoRecords();
    writeRaw(BILLING_DEMO_KEY, { seeded: false, clearedAt: Date.now() });
    return removed;
  }

  function isBillingDemoSeeded() {
    return getInvoices().some(function (i) { return i.demoSeed; });
  }

  // One automatic, one-time convenience seed (same idea as the Queue's):
  // only if the seed has never run or been cleared (no meta key) AND there
  // are no payments awaiting review yet. The meta key is written on both
  // seed and clear, so it never fires again after the first time.
  // Payments seeded by an earlier version stored submittedBy 'Demo Admin'.
  // Relabel only those demo-tagged payments to 'Admin' (no other field, record
  // or counter is touched; a no-op once nothing matches).
  function normalizeDemoProcessedBy() {
    var list = getPayments(), changed = false;
    list.forEach(function (p) {
      if (p.demoSeed && p.submittedBy === 'Demo Admin') { p.submittedBy = 'Admin'; changed = true; }
    });
    if (changed) savePayments(list);
  }

  // Browsers seeded before this change still hold a stored proof on the Maria
  // Santos demo payment (pay_demo_001). Clear ONLY that payment's proofName /
  // proofDataUrl, only while it is still pending, and only when the stored
  // proof is the seeded placeholder (a generated .svg). A proof the user
  // uploads later is always JPG/PNG/PDF, so it is never mistaken for it and
  // survives a page refresh. Nothing else is touched.
  function isSeededDemoProof(p) {
    return /\.svg$/i.test(p.proofName || '') || /^data:image\/svg\+xml/i.test(p.proofDataUrl || '');
  }
  function clearDemo001Proof() {
    var list = getPayments(), changed = false;
    list.forEach(function (p) {
      if (p.id === 'pay_demo_001' && p.demoSeed && p.status === 'pending-verification' && (p.proofName || p.proofDataUrl) && isSeededDemoProof(p)) {
        p.proofName = ''; p.proofDataUrl = ''; changed = true;
      }
    });
    if (changed) savePayments(list);
  }

  // Browsers seeded before the payment-method change still hold demo payments
  // using unsupported methods. Re-point ONLY demo-tagged payments (never real
  // ones) to a supported method, and refresh the matching demo reference /
  // generated placeholder proof label. Idempotent: a no-op once nothing matches.
  var DEMO_METHOD_MIGRATION = {
    'bank-transfer': { method: 'bdo', fromRef: 'DEMO-BANK-002', toRef: 'DEMO-BDO-002', label: 'BDO \u00b7 DEMO-BDO-002' },
    'cash-to-gcash': { method: 'bpi', fromRef: 'DEMO-CASH-GCASH-004', toRef: 'DEMO-BPI-004', label: 'BPI \u00b7 DEMO-BPI-004' },
    'cash-to-bank': { method: 'metrobank', fromRef: '', toRef: '', label: '' }
  };
  function migrateDemoPaymentMethods() {
    var list = getPayments(), changed = false;
    list.forEach(function (p) {
      var m = p.demoSeed && DEMO_METHOD_MIGRATION[p.method];
      if (!m) return;
      p.method = m.method;
      if (m.fromRef && p.referenceNumber === m.fromRef) p.referenceNumber = m.toRef;
      if (m.label && isSeededDemoProof(p) && p.proofDataUrl) p.proofDataUrl = demoProofDataUrl(m.label);
      changed = true;
    });
    if (changed) savePayments(list);
  }

  function maybeAutoSeedBillingDemo() {
    normalizeDemoProcessedBy();
    migrateDemoPaymentMethods();
    clearDemo001Proof();
    if (readRaw(BILLING_DEMO_KEY)) return;
    if (getPendingVerifications().length) return;
    seedBillingDemoData();
  }

  // ------------------------------------------------------------------
  // attach onto the existing, shared PCData object
  // ------------------------------------------------------------------

  Object.assign(D, {
    // billing — invoices
    INVOICE_STATUSES: INVOICE_STATUSES,
    INVOICE_STATUS_LABELS: INVOICE_STATUS_LABELS,
    INVOICE_ITEM_TYPES: INVOICE_ITEM_TYPES,
    getInvoices: getInvoices,
    saveInvoices: saveInvoices,
    getInvoiceById: getInvoiceById,
    getInvoiceForAppointment: getInvoiceForAppointment,
    getInvoiceableAppointments: getInvoiceableAppointments,
    addInvoice: addInvoice,
    updateInvoice: updateInvoice,
    refundInvoice: refundInvoice,
    getInvoiceDisplayInfo: getInvoiceDisplayInfo,
    calcInvoiceTotal: calcInvoiceTotal,
    calcInvoiceSubtotal: calcInvoiceSubtotal,
    calcFinalTotal: calcFinalTotal,

    // billing — payments
    PAYMENT_METHODS: PAYMENT_METHODS,
    PAYMENT_METHOD_LABELS: PAYMENT_METHOD_LABELS,
    PAYMENT_METHOD_LEGACY_LABELS: PAYMENT_METHOD_LEGACY_LABELS,
    PAYMENT_STATUSES: PAYMENT_STATUSES,
    getPayments: getPayments,
    savePayments: savePayments,
    getPaymentById: getPaymentById,
    getPaymentsForInvoice: getPaymentsForInvoice,
    getPendingPaymentForInvoice: getPendingPaymentForInvoice,
    getPendingVerifications: getPendingVerifications,
    getPendingPayments: getPendingPayments,
    getCompletedPayments: getCompletedPayments,
    getRefundedPayments: getRefundedPayments,
    getTodaysCollections: getTodaysCollections,
    getLastBillingError: getLastBillingError,
    submitPayment: submitPayment,
    updatePaymentProof: updatePaymentProof,
    removePaymentProof: removePaymentProof,
    updatePendingPayment: updatePendingPayment,
    verifyPayment: verifyPayment,
    rejectPayment: rejectPayment,
    getBillingSummary: getBillingSummary,

    // billing — demo/test data (development only)
    seedBillingDemoData: seedBillingDemoData,
    clearBillingDemoData: clearBillingDemoData,
    isBillingDemoSeeded: isBillingDemoSeeded
  });

  // Runs once per browser (see maybeAutoSeedBillingDemo). Wrapped so a
  // seeding problem can never stop the Billing page itself from loading.
  try { maybeAutoSeedBillingDemo(); } catch (e) { if (global.console && console.error) console.error('Billing demo seed failed:', e); }
})(window);