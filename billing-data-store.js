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

  var PAYMENT_METHODS = ['gcash', 'bank-transfer', 'cash', 'cash-to-gcash', 'cash-to-bank'];
  var PAYMENT_METHOD_LABELS = {
    'gcash': 'GCash',
    'bank-transfer': 'Bank Transfer',
    'cash': 'Cash',
    'cash-to-gcash': "Cash \u2192 Clinic GCash",
    'cash-to-bank': "Cash \u2192 Clinic Bank Transfer"
  };

  var PAYMENT_STATUSES = ['pending-verification', 'verified', 'rejected'];

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
      paidAt: null
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
  function refundInvoice(id) {
    var invoice = getInvoiceById(id);
    if (!invoice || invoice.status !== 'paid') return false;
    updateInvoice(id, { status: 'refunded' });
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
    var patient = appt ? D.getPatientForAppointment(appt) : (invoice.patientId ? D.getPatientById(invoice.patientId) : null);
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
      notes: invoice.notes
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
    var invoice = getInvoiceById(invoiceId);
    if (!invoice) return null;
    if (invoice.status === 'paid') return null;
    if (invoice.status === 'pending-verification' || getPendingPaymentForInvoice(invoiceId)) return null;

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

  // Administrator-only in the UI (billing.js gates the buttons); the
  // guards here still hold even if called directly. A payment can only
  // be verified once, and only while it's still pending review.
  function verifyPayment(paymentId, reviewerName) {
    var payment = getPaymentById(paymentId);
    if (!payment || payment.status !== 'pending-verification') return false;
    var invoice = getInvoiceById(payment.invoiceId);
    if (!invoice || invoice.status === 'paid') return false;

    var list = getPayments();
    var idx = list.findIndex(function (p) { return p.id === paymentId; });
    list[idx].status = 'verified';
    list[idx].reviewedBy = reviewerName || 'Administrator';
    list[idx].reviewedAt = Date.now();
    savePayments(list);

    updateInvoice(invoice.id, { status: 'paid', paidAt: Date.now() });
    return true;
  }

  // Administrator-only in the UI. Rejecting a payment never marks the
  // invoice Paid — the invoice moves to 'rejected' (clearly unsettled)
  // so the front desk can correct the details and resubmit.
  function rejectPayment(paymentId, reviewerName, reason) {
    var payment = getPaymentById(paymentId);
    if (!payment || payment.status !== 'pending-verification') return false;
    var invoice = getInvoiceById(payment.invoiceId);
    if (!invoice) return false;

    var list = getPayments();
    var idx = list.findIndex(function (p) { return p.id === paymentId; });
    list[idx].status = 'rejected';
    list[idx].reviewedBy = reviewerName || 'Administrator';
    list[idx].reviewedAt = Date.now();
    list[idx].reviewNotes = reason || '';
    savePayments(list);

    updateInvoice(invoice.id, { status: 'rejected' });
    return true;
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
    PAYMENT_STATUSES: PAYMENT_STATUSES,
    getPayments: getPayments,
    savePayments: savePayments,
    getPaymentById: getPaymentById,
    getPaymentsForInvoice: getPaymentsForInvoice,
    getPendingPaymentForInvoice: getPendingPaymentForInvoice,
    getPendingVerifications: getPendingVerifications,
    submitPayment: submitPayment,
    verifyPayment: verifyPayment,
    rejectPayment: rejectPayment,
    getBillingSummary: getBillingSummary
  });
})(window);