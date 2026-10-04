// ============================================================
// PAWSITIVE CARE — Billing page logic
// Invoices are created against a completed Appointment (which
// carries the real patientId/clientId), payments are submitted
// against an invoice, and an Administrator verifies or rejects
// each payment before an invoice is marked Paid. All persistence
// goes through PCData (data-store.js) — this file only renders
// and wires up interactions.
//
// NOTE on roles: this project doesn't have real authentication
// yet, so the Administrator / Receptionist switch below is a
// front-end-only stand-in (stored in localStorage) that gates the
// Verify/Reject buttons in the UI. The data-store guards
// (verifyPayment/rejectPayment requiring a still-pending payment,
// submitPayment refusing a paid/already-pending invoice) hold
// regardless of this switch. Swap this for the real Staff & Users
// account role once that's wired up.
// ============================================================

(function () {
  var D = window.PCData;

  // ------------------------------------------------------------------
  // role (temporary, until backend auth exists)
  //
  // There is no login/session yet, so this frontend is being run as
  // the Administrator by default. This is intentionally a single
  // constant, not a user-facing switch: when backend authentication
  // lands, replace this line with the role the backend/session
  // provides (e.g. CURRENT_ROLE = session.user.role) — every isAdmin()
  // check below stays the same.
  // ------------------------------------------------------------------
  var CURRENT_ROLE = 'admin';

  // Phase 3: tab is session-only UI state (not persisted anywhere).
  var state = {
    search: '',
    tab: 'pending'
  };

  // ------------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------------

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function money(n) {
    return '\u20B1' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function isAdmin() {
    return CURRENT_ROLE === 'admin';
  }

  function fmtDate(iso) {
    if (!iso) return '\u2014';
    if (typeof D.formatDateLabel === 'function') return D.formatDateLabel(iso);
    // Fallback in case formatDateLabel isn't exposed on PCData in this build.
    var d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // Phase 3: Billing-specific date formatters. The shared
  // PCData.formatDateLabel() (weekday + month + day, no year) is left
  // untouched for every other page; payment dates in Billing need the
  // year, so they use this instead. Tolerates a missing/odd value
  // instead of throwing.
  function fmtDateFull(iso) {
    if (!iso || typeof iso !== 'string') return '\u2014';
    var d;
    try { d = typeof D.parseDate === 'function' ? D.parseDate(iso) : new Date(iso); } catch (err) { return iso; }
    if (!d || isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // Millisecond timestamp (e.g. refundedAt) -> "Sep 3, 2026, 2:15 PM".
  function fmtDateTime(ts) {
    var d = new Date(ts);
    if (!ts || isNaN(d.getTime())) return '\u2014';
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  // Appointment display info (pet/owner/species/vet/reason) for the New
  // Invoice picker. Prefers PCData.getQueueDisplayInfo (same helper Queue
  // uses) so labels stay identical across pages, but falls back to the
  // core Patient/Client lookups so this page still works even if that
  // helper isn't exposed on PCData.
  function getApptInfo(appt) {
    if (typeof D.getQueueDisplayInfo === 'function') return D.getQueueDisplayInfo(appt);
    var patient = typeof D.getPatientForAppointment === 'function' ? D.getPatientForAppointment(appt) : null;
    var client = typeof D.getClientForAppointment === 'function' ? D.getClientForAppointment(appt) : null;
    return {
      pet: (patient && patient.pet) || appt.pet || '\u2014',
      species: (patient && patient.species) || appt.species || null,
      owner: (client && client.name) || appt.owner || '\u2014',
      vet: appt.vet,
      reason: appt.reason
    };
  }

  // Phase 3H/3K: breed/sex/age/contact aren't part of getInvoiceDisplayInfo()'s
  // return (the on-screen views never needed them), so the print invoice
  // resolves the raw patient/client record itself the same way that
  // helper resolves them internally -- via the invoice's appointment when
  // it still exists, else the invoice's own patientId/clientId -- using
  // the same D.getPatientForAppointment/getPatientById/getClientForAppointment/
  // getClientById helpers already relied on elsewhere in this file.
  // Read-only: never invents or writes anything back onto the record.
  function getInvoicePatientRecord(inv) {
    var appt = inv.appointmentId ? D.getById(inv.appointmentId) : null;
    return appt
      ? (typeof D.getPatientForAppointment === 'function' ? D.getPatientForAppointment(appt) : null)
      : (inv.patientId && typeof D.getPatientById === 'function' ? D.getPatientById(inv.patientId) : null);
  }

  function getInvoiceClientRecord(inv) {
    var appt = inv.appointmentId ? D.getById(inv.appointmentId) : null;
    return appt
      ? (typeof D.getClientForAppointment === 'function' ? D.getClientForAppointment(appt) : null)
      : (inv.clientId && typeof D.getClientById === 'function' ? D.getClientById(inv.clientId) : null);
  }

  // A record can store the same kind of value under different field
  // names depending on how it was captured (e.g. a client's number as
  // .phone vs .contactNumber). This only ever surfaces a value the
  // record already has -- it never guesses or fabricates one, and an
  // unmatched field simply means that line is omitted from print.
  function firstField(record, names) {
    if (!record) return null;
    for (var i = 0; i < names.length; i++) {
      if (record[names[i]]) return record[names[i]];
    }
    return null;
  }

  var INVOICE_STATUS_LABELS = D.INVOICE_STATUS_LABELS;
  var PAYMENT_METHOD_LABELS = D.PAYMENT_METHOD_LABELS;
  var PAYMENT_STATUS_LABELS = { 'pending-verification': 'Pending Verification', 'verified': 'Verified', 'rejected': 'Rejected' };

  // ------------------------------------------------------------------
  // Clinic payment details shown in Record Payment's method panel.
  // DEVELOPMENT PLACEHOLDERS ONLY -- the project has no real clinic
  // payment account configured yet, so nothing here is a real GCash
  // number, bank account or QR code. To go live, edit this one object:
  //   - gcash.accountNumber / bdo|bpi|metrobank.accountNumber -> real details
  //   - *.qrImage -> path to that account's real QR image (set
  //     qrIsPlaceholder to false), or '' to show details with no QR
  // Until real images exist, every method reuses the SAME placeholder QR.
  // Keys are the supported payment-method values; Cash has no entry
  // (no QR, no account details).
  // ------------------------------------------------------------------
  var PLACEHOLDER_QR_IMAGE = 'assets/clinic-gcash-qr-placeholder.png';
  var CLINIC_ACCOUNT_NAME = 'Pawsitive Care Veterinary Clinic';
  var CLINIC_PAYMENT_CONFIG = {
    gcash:     { accountName: CLINIC_ACCOUNT_NAME, accountNumber: '09XX XXX XXXX', qrImage: PLACEHOLDER_QR_IMAGE, qrIsPlaceholder: true },
    bdo:       { accountName: CLINIC_ACCOUNT_NAME, bankName: 'BDO',       accountNumber: 'XXXX XXXX XXXX', qrImage: PLACEHOLDER_QR_IMAGE, qrIsPlaceholder: true },
    bpi:       { accountName: CLINIC_ACCOUNT_NAME, bankName: 'BPI',       accountNumber: 'XXXX XXXX XXXX', qrImage: PLACEHOLDER_QR_IMAGE, qrIsPlaceholder: true },
    metrobank: { accountName: CLINIC_ACCOUNT_NAME, bankName: 'MetroBank', accountNumber: 'XXXX XXXX XXXX', qrImage: PLACEHOLDER_QR_IMAGE, qrIsPlaceholder: true }
  };

  // Label for any stored method, including old unsupported ones (display only).
  function methodLabel(m) {
    return PAYMENT_METHOD_LABELS[m] || (D.PAYMENT_METHOD_LEGACY_LABELS || {})[m] || m;
  }

  // "Processed By" always reads "Admin" for the admin flow, including
  // payments stored earlier as "Demo Admin" / "Administrator".
  function processedByLabel(name) {
    var n = String(name == null ? '' : name).trim();
    if (!n) return '\u2014';
    return /^(demo\s+)?admin(istrator)?$/i.test(n) ? 'Admin' : n;
  }

  function statusBadge(status) {
    return '<span class="bl-badge bl-badge--' + status + '">' + esc(INVOICE_STATUS_LABELS[status] || status) + '</span>';
  }

  function paymentStatusBadge(status) {
    return '<span class="bl-badge bl-badge--pay-' + status + '">' + esc(PAYMENT_STATUS_LABELS[status] || status) + '</span>';
  }

  // ------------------------------------------------------------------
  // render
  //
  // Phase 3: Billing is organised around PAYMENT STATUS (Pending /
  // Completed / Refunded) instead of an Invoices tab plus a separate
  // Payment Verification tab. Every list and number below comes
  // straight from the Phase 2 selectors in billing-data-store.js
  // (getPendingPayments, getCompletedPayments, getRefundedPayments,
  // getTodaysCollections) -- nothing is re-filtered or re-summed here.
  // ------------------------------------------------------------------

  var TABS = ['pending', 'completed', 'refunded'];
  var TAB_LABELS = { pending: 'Pending payments', completed: 'Completed payments', refunded: 'Refunded payments' };

  function render() {
    renderSummary();
    renderTabs();
    renderPaymentTable();
  }

  // Same markup/classes as before (label + small icon on top, large value,
  // muted description); `primary` marks the lead card (dark-teal treatment).
  function summaryCard(icon, label, value, desc, primary) {
    return '<div class="bl-metric' + (primary ? ' bl-metric-primary' : '') + '">' +
      '<div class="bl-metric-head">' +
      '<div class="bl-metric-label">' + esc(label) + '</div>' +
      '<i class="fa-solid ' + icon + ' bl-metric-icon" aria-hidden="true"></i>' +
      '</div>' +
      '<div class="bl-metric-value">' + value + '</div>' +
      '<div class="bl-metric-desc">' + esc(desc) + '</div>' +
      '</div>';
  }

  function renderSummary() {
    var pendingCount = D.getPendingPayments().length;
    var todays = D.getTodaysCollections();
    var completedCount = D.getCompletedPayments().length;
    var refundedCount = D.getRefundedPayments().length;
    document.getElementById('bl-summary-grid').innerHTML =
      summaryCard('fa-hourglass-half', 'Pending Payments', String(pendingCount),
        pendingCount === 0 ? 'No payments require verification'
          : (pendingCount === 1 ? '1 payment requires verification' : pendingCount + ' payments require verification'), true) +
      summaryCard('fa-sack-dollar', "Today\u2019s Collections", money(todays.total),
        plural(todays.count, 'payment', 'payments') + ' verified today') +
      summaryCard('fa-circle-check', 'Completed Transactions', String(completedCount),
        'Verified payments') +
      summaryCard('fa-arrow-rotate-left', 'Refunded Payments', String(refundedCount),
        'Refunded transactions');
  }

  function renderTabs() {
    document.querySelectorAll('.bl-tab').forEach(function (t) {
      var isActive = t.getAttribute('data-tab') === state.tab;
      t.classList.toggle('active', isActive);
      t.setAttribute('aria-selected', isActive ? 'true' : 'false');
      t.setAttribute('tabindex', isActive ? '0' : '-1');
    });
    document.getElementById('bl-panel').setAttribute('aria-labelledby', 'bl-tab-' + state.tab);
    var pendingCount = D.getPendingPayments().length;
    document.getElementById('bl-pending-count').textContent = pendingCount ? String(pendingCount) : '';
  }

  function setTab(name, moveFocus) {
    if (TABS.indexOf(name) === -1) return;
    state.tab = name;
    render();
    if (moveFocus) focusActiveTab();
  }

  function focusActiveTab() {
    var el = document.getElementById('bl-tab-' + state.tab);
    if (el) el.focus();
  }

  // Polite status message for screen readers (verify/reject results).
  function announce(message) {
    var el = document.getElementById('bl-status-msg');
    if (!el) return;
    el.textContent = '';
    setTimeout(function () { el.textContent = message; }, 50);
  }

  // Search is the existing matcher minus the old invoice-status filter
  // (it no longer applies to payment-status views). Invoice #, client
  // and patient only. `invoice`/`info` may be empty objects when a
  // payment's invoice can't be resolved.
  function matchesFilters(invoice, info) {
    if (!state.search) return true;
    var q = state.search.trim().toLowerCase();
    if (!q) return true;
    return (invoice.invoiceNumber || '').toLowerCase().indexOf(q) > -1 ||
      (info.owner || '').toLowerCase().indexOf(q) > -1 ||
      (info.pet || '').toLowerCase().indexOf(q) > -1;
  }

  // One normalized row shape for all three views:
  //   { payment, invoice, refund }
  // pending/completed rows are payment records; refunded rows come from
  // getRefundedPayments() and carry the refund entry plus the invoice's
  // original (still 'verified') payment, which may be null for legacy data.
  function getTabRows(tab) {
    var invoices = {};
    D.getInvoices().forEach(function (inv) { invoices[inv.id] = inv; });
    if (tab === 'refunded') {
      return D.getRefundedPayments().map(function (r) {
        return { payment: r.payment, invoice: r.invoice, refund: r };
      });
    }
    var payments = tab === 'completed' ? D.getCompletedPayments() : D.getPendingPayments();
    return payments.map(function (p) {
      return { payment: p, invoice: invoices[p.invoiceId] || null, refund: null };
    });
  }

  function paymentRowStatus(tab) {
    if (tab === 'completed') return '<span class="bl-badge bl-badge--pay-verified">Completed</span>';
    if (tab === 'refunded') return '<span class="bl-badge bl-badge--refunded">Refunded</span>';
    return '<span class="bl-badge bl-badge--pay-pending-verification">Pending</span>';
  }

  function paymentRowActions(tab, row) {
    var inv = row.invoice;
    var invNo = inv ? inv.invoiceNumber : '';
    if (tab === 'pending') {
      var pid = esc(row.payment.id);
      // Both buttons open the unified payment modal -- nothing is verified
      // or rejected without the payment details on screen first. A
      // non-admin sees a single Review button (read-only modal).
      if (!isAdmin()) {
        return '<button type="button" class="btn btn-sm" data-action="review" data-intent="review" data-id="' + pid + '" aria-label="Review payment for ' + esc(invNo) + '">Review</button>';
      }
      return '<button type="button" class="btn btn-sm btn-primary" data-action="review" data-intent="verify" data-id="' + pid + '" aria-label="Verify payment for ' + esc(invNo) + '">Verify Payment</button>' +
        '<button type="button" class="btn btn-sm btn-danger" data-action="review" data-intent="reject" data-id="' + pid + '" aria-label="Reject payment for ' + esc(invNo) + '">Reject</button>';
    }
    if (!inv) return '<span class="bl-dim">\u2014</span>';
    return '<button type="button" class="btn btn-sm" data-action="view" data-id="' + esc(inv.id) + '" aria-label="View invoice ' + esc(invNo) + '"><i class="fa-solid fa-eye" aria-hidden="true"></i> View</button>';
  }

  function buildPaymentRow(tab, row, info) {
    var inv = row.invoice;
    var p = row.payment;
    var r = row.refund;
    // Amount/method/date come from the ORIGINAL payment. Only when a
    // refunded invoice has no payment record at all (legacy data) does the
    // amount fall back to the refund amount / invoice total (full refunds
    // only), and method/date show a dash rather than a guess.
    var amount = p ? p.amount : (r && r.refundAmount != null ? r.refundAmount : (inv ? inv.totalAmount : null));
    var method = p ? methodLabel(p.method) : '\u2014';
    var date = p ? fmtDateFull(p.paymentDate) : '\u2014';
    return '<tr>' +
      '<td class="bl-mono">' + esc(inv ? inv.invoiceNumber : '\u2014') + '</td>' +
      '<td>' + esc(info ? info.owner : '\u2014') + '</td>' +
      '<td>' + esc(info ? info.pet : '\u2014') + '</td>' +
      '<td class="bl-amount">' + (amount == null ? '\u2014' : money(amount)) + '</td>' +
      '<td>' + esc(method) + '</td>' +
      '<td class="bl-nowrap">' + esc(date) + '</td>' +
      '<td>' + paymentRowStatus(tab) + '</td>' +
      '<td><div class="bl-actions">' + paymentRowActions(tab, row) + '</div></td>' +
      '</tr>';
  }

  var EMPTY_STATES = {
    pending: ['No pending payments', 'Payments waiting for verification will show up here.'],
    completed: ['No completed payments', 'Verified payments will show up here.'],
    refunded: ['No refunded payments', 'Refunded transactions will show up here.']
  };

  function renderPaymentTable() {
    var tbody = document.getElementById('bl-payment-tbody');
    var tab = state.tab;
    var rows = getTabRows(tab);
    var shown = 0;

    var html = rows.map(function (row) {
      // getInvoiceDisplayInfo resolves client/patient through the existing
      // lookups and falls back to the appointment's own text, then to a
      // dash, so an older invoice with no patientId never throws.
      var info = row.invoice ? D.getInvoiceDisplayInfo(row.invoice) : null;
      if (!matchesFilters(row.invoice || {}, info || {})) return '';
      shown++;
      return buildPaymentRow(tab, row, info);
    }).join('');

    if (!html) {
      if (rows.length) {
        html = '<tr><td colspan="8" class="bl-empty"><div class="bl-empty-title">No payments match your search</div><div class="bl-empty-note">Try an invoice number, client or patient name.</div></td></tr>';
      } else {
        html = '<tr><td colspan="8" class="bl-empty"><div class="bl-empty-title">' + esc(EMPTY_STATES[tab][0]) + '</div><div class="bl-empty-note">' + esc(EMPTY_STATES[tab][1]) + '</div></td></tr>';
      }
    }
    tbody.innerHTML = html;

    var countEl = document.getElementById('bl-count');
    if (countEl) countEl.textContent = plural(shown, 'payment', 'payments');
    var caption = document.getElementById('bl-table-caption');
    if (caption) caption.textContent = TAB_LABELS[tab];
  }

  // ------------------------------------------------------------------
  // modal shell
  // ------------------------------------------------------------------

  // Phase 3G: focus management for the shared modal shell. lastFocusedEl
  // remembers what had focus before the modal opened (the button that
  // triggered it) so closeModal() can restore it. getFocusableEls() feeds
  // the Tab/Shift+Tab trap wired up in setupModalShell() below --- no
  // structural/visual change to the modal itself, keyboard behavior only.
  var lastFocusedEl = null;

  function getFocusableEls(container) {
    var sel = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.prototype.slice.call(container.querySelectorAll(sel)).filter(function (el) {
      return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    });
  }

  function openModal(title, bodyHtml) {
    lastFocusedEl = document.activeElement;
    document.getElementById('bl-modal-title').textContent = title;
    document.getElementById('bl-modal-body').innerHTML = bodyHtml;
    document.getElementById('bl-modal-overlay').classList.add('open');
    // Hide the rest of the app from assistive tech while the dialog is
    // open, and move focus inside it (the close button is always present
    // regardless of which modal body was just rendered).
    var appShell = document.querySelector('.app-shell');
    if (appShell) appShell.setAttribute('aria-hidden', 'true');
    document.getElementById('bl-modal-close').focus();
  }

  function closeModal() {
    var overlay = document.getElementById('bl-modal-overlay');
    if (!overlay.classList.contains('open')) return;
    overlay.classList.remove('open');
    var modalBox = overlay.querySelector('.bl-modal');
    if (modalBox) { modalBox.classList.remove('bl-modal--invoice'); modalBox.classList.remove('bl-modal--payment'); }
    document.getElementById('bl-modal-body').innerHTML = '';
    var appShell = document.querySelector('.app-shell');
    if (appShell) appShell.removeAttribute('aria-hidden');
    // If the trigger button was removed by a re-render (e.g. a verified
    // payment's row left the Pending list), land on the active tab
    // instead of dropping focus to the page body.
    if (lastFocusedEl && document.body.contains(lastFocusedEl) && typeof lastFocusedEl.focus === 'function') lastFocusedEl.focus();
    else focusActiveTab();
    lastFocusedEl = null;
  }

  // ------------------------------------------------------------------
  // New Invoice
  // ------------------------------------------------------------------

  // New Invoice form limits (UI only).
  var NOTES_MAX = 500;
  var DISCOUNT_REASON_MAX = 100;

  function openNewInvoiceModal() {
    var appts = D.getInvoiceableAppointments();
    if (!appts.length) {
      openModal('New Invoice', '<p class="bl-empty-note">No completed appointments are available to invoice right now. Complete a consultation in the Queue first, then create its invoice here.</p>');
      return;
    }

    var options = appts.map(function (a) {
      var info = getApptInfo(a);
      return '<option value="' + a.id + '">' + esc(info.pet) + ' \u2014 ' + esc(info.owner) + ' \u00b7 ' + esc(fmtDate(a.date)) + ' \u00b7 ' + esc(a.reason || '') + '</option>';
    }).join('');

    // Layout only: the same fields/ids/handlers as before, regrouped into
    // Appointment -> Client & Patient -> Line Items -> (Notes + Discount |
    // Summary) -> Actions.
    var html = '' +
      // 1. Appointment
      '<div class="bl-form-row bl-inv-appt-row"><label for="bl-inv-appt">Appointment</label><select id="bl-inv-appt" class="pc-select">' + options + '</select></div>' +
      '<div class="bl-appt-preview" id="bl-inv-appt-preview" aria-live="polite"></div>' +
      // 3. Client & patient (resolved from the selected appointment)
      '<div class="bl-section-label" id="bl-inv-cp-label">Client &amp; Patient Information</div>' +
      '<div class="bl-appt-preview bl-inv-cp" id="bl-inv-cp" role="group" aria-labelledby="bl-inv-cp-label"></div>' +
      // 4. Line items
      '<div class="bl-items-head"><label id="bl-inv-items-label">Line Items</label></div>' +
      '<div class="bl-items-scroll" tabindex="0" role="region" aria-label="Line items, scrollable horizontally if needed">' +
      '<div class="bl-items-cols"><span>Category</span><span>Item / Service</span><span>Qty</span><span>Unit Price</span><span class="bl-items-col-amount">Total</span><span class="bl-items-col-remove">Remove</span></div>' +
      '<div id="bl-inv-items"></div>' +
      '</div>' +
      '<div class="bl-items-add"><button type="button" class="bl-link-btn" id="bl-inv-add-item"><i class="fa-solid fa-plus" aria-hidden="true"></i> Add Service / Item</button></div>' +
      // 5. Bottom two-column area: notes + discount (left), summary (right)
      '<div class="bl-inv-bottom">' +
      '<div class="bl-inv-bottom-left">' +
      '<div class="bl-form-row bl-notes-row"><label for="bl-inv-notes">Billing Notes (optional)</label>' +
      '<div class="bl-inv-notes-wrap">' +
      '<textarea id="bl-inv-notes" rows="3" maxlength="' + NOTES_MAX + '" placeholder="For billing-related comments only." aria-describedby="bl-inv-notes-count"></textarea>' +
      '<div class="bl-inv-count" id="bl-inv-notes-count">0/' + NOTES_MAX + '</div></div></div>' +
      '<div class="bl-form-row bl-discount-row"><label for="bl-inv-discount">Discount</label>' +
      '<input type="number" min="0" step="0.01" id="bl-inv-discount" value="0" aria-describedby="bl-inv-discount-error">' +
      '<div class="bl-discount-error" id="bl-inv-discount-error" role="alert" style="display:none;"></div></div>' +
      '<div class="bl-form-row"><label for="bl-inv-discount-reason">Discount Reason (optional)</label>' +
      '<input type="text" id="bl-inv-discount-reason" maxlength="' + DISCOUNT_REASON_MAX + '" autocomplete="off"></div>' +
      '</div>' +
      '<div class="bl-inv-bottom-right">' +
      '<div class="bl-inv-totals bl-inv-summary" role="group" aria-label="Invoice summary">' +
      '<div class="bl-inv-summary-title">Invoice Summary</div>' +
      '<div class="bl-inv-totals-row"><span>Subtotal</span><span id="bl-inv-subtotal-val">' + money(0) + '</span></div>' +
      '<div class="bl-inv-totals-row bl-inv-totals-discount" id="bl-inv-discount-row"><span>Discount</span><span id="bl-inv-discount-val">' + money(0) + '</span></div>' +
      '<div class="bl-inv-totals-row bl-inv-totals-total"><span>Total Amount Due</span><span id="bl-inv-total-val">' + money(0) + '</span></div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      // 8. Actions
      '<div class="bl-discount-error bl-inv-form-error" id="bl-inv-form-error" role="alert" style="display:none;"></div>' +
      '<div class="bl-modal-actions"><button type="button" class="btn" id="bl-inv-cancel">Cancel</button><button type="button" class="btn btn-primary" id="bl-inv-save">Create Invoice</button></div>';

    openModal('New Invoice', html);
    // Wider shell for this modal only; closeModal() removes it again so
    // the other Billing modals keep their existing width.
    document.querySelector('#bl-modal-overlay .bl-modal').classList.add('bl-modal--invoice');

    var itemsState = [newItemRow()];

    function newItemRow() { return { type: 'service', name: '', qty: 1, unitPrice: 0, serviceId: null, inventoryItemId: null }; }

    // Single source of truth for "which active Services/Medicines exist
    // right now" — used by each row's own Item / Service dropdown, so
    // there is only one place reading D.getActiveServices()/D.getInventory().
    function getServiceOptionsList() {
      return typeof D.getActiveServices === 'function'
        ? D.getActiveServices().slice().sort(function (a, b) { return a.name.localeCompare(b.name); })
        : [];
    }
    function getMedicineOptionsList() {
      return typeof D.getInventory === 'function'
        ? D.getInventory().filter(function (i) { return i.status === 'active'; }).sort(function (a, b) { return a.name.localeCompare(b.name); })
        : [];
    }

    // Line items come from exactly two sources — Service and Medicine
    // (unchanged). Category is the Type of the line.
    var NEW_ITEM_TYPES = ['service', 'medicine'];

    function nameFieldHtml(it) {
      if (it.type === 'service') {
        var services = getServiceOptionsList();
        if (!services.length) {
          return '<select class="bl-item-name-select pc-select" aria-label="Item / Service" disabled><option value="">No services available</option></select>';
        }
        var svcOpts = '<option value=""' + (it.serviceId ? '' : ' selected') + ' disabled>Select service\u2026</option>' +
          services.map(function (s) {
            return '<option value="' + s.id + '"' + (it.serviceId === s.id ? ' selected' : '') + '>' + esc(s.name) + ' \u2014 ' + money(s.price) + '</option>';
          }).join('');
        return '<select class="bl-item-name-select pc-select" aria-label="Item / Service">' + svcOpts + '</select>';
      }
      var meds = getMedicineOptionsList();
      if (!meds.length) {
        return '<select class="bl-item-name-select pc-select" aria-label="Item / Service" disabled><option value="">No medicines available</option></select>';
      }
      var medOpts = '<option value=""' + (it.inventoryItemId ? '' : ' selected') + ' disabled>Select medicine\u2026</option>' +
        meds.map(function (i) {
          return '<option value="' + i.id + '"' + (it.inventoryItemId === i.id ? ' selected' : '') + '>' + esc(i.name) + ' \u2014 ' + money(i.unitPrice) + '</option>';
        }).join('');
      return '<select class="bl-item-name-select pc-select" aria-label="Item / Service">' + medOpts + '</select>';
    }

    // Unit Price always comes from the selected Service/Medicine, so it
    // stays read-only (unchanged).
    function priceFieldHtml(it) {
      return '<input type="number" min="0" step="0.01" class="bl-item-price bl-item-price--readonly" aria-label="Unit price" value="' + it.unitPrice + '" readonly aria-readonly="true">';
    }

    function isBlankOnly() {
      return itemsState.length === 1 && !itemsState[0].name.trim() && itemsState[0].unitPrice === 0;
    }

    // Replace a still-blank first row instead of leaving an empty one above it.
    function appendItem(row) {
      if (isBlankOnly()) itemsState[0] = row; else itemsState.push(row);
    }

    function renderItemRows() {
      var wrap = document.getElementById('bl-inv-items');
      wrap.innerHTML = itemsState.map(function (it, idx) {
        return '<div class="bl-item-row" data-idx="' + idx + '">' +
          '<select class="bl-item-type pc-select" aria-label="Category">' + NEW_ITEM_TYPES.map(function (t) {
            return '<option value="' + t + '"' + (t === it.type ? ' selected' : '') + '>' + t.charAt(0).toUpperCase() + t.slice(1) + '</option>';
          }).join('') + '</select>' +
          nameFieldHtml(it) +
          '<input type="number" min="0" step="1" class="bl-item-qty" aria-label="Quantity" value="' + it.qty + '">' +
          priceFieldHtml(it) +
          '<div class="bl-item-subtotal" aria-label="Line total">' + money(it.qty * it.unitPrice) + '</div>' +
          '<button type="button" class="bl-icon-btn bl-item-remove" title="Remove item" aria-label="Remove item"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>' +
          '</div>';
      }).join('');

      wrap.querySelectorAll('.bl-item-row').forEach(function (row) {
        var idx = Number(row.getAttribute('data-idx'));

        // Changing Category invalidates the old selection (unchanged).
        row.querySelector('.bl-item-type').addEventListener('change', function (e) {
          var it = itemsState[idx];
          it.type = e.target.value;
          it.name = '';
          it.unitPrice = 0;
          it.serviceId = null;
          it.inventoryItemId = null;
          renderItemRows();
          updateTotals();
        });

        row.querySelector('.bl-item-name-select').addEventListener('change', function (e) {
          var it = itemsState[idx];
          if (it.type === 'service') {
            var snap = D.getServicePriceSnapshot(e.target.value);
            if (!snap) return;
            it.name = snap.name; it.unitPrice = snap.price; it.serviceId = snap.serviceId; it.inventoryItemId = null;
          } else {
            var invItem = D.getInventoryById(e.target.value);
            if (!invItem) return;
            it.name = invItem.name; it.unitPrice = invItem.unitPrice; it.inventoryItemId = invItem.id; it.serviceId = null;
          }
          renderItemRows();
          updateTotals();
        });

        row.querySelector('.bl-item-qty').addEventListener('input', function (e) {
          itemsState[idx].qty = Number(e.target.value) || 0;
          row.querySelector('.bl-item-subtotal').textContent = money(itemsState[idx].qty * itemsState[idx].unitPrice);
          updateTotals();
        });
        row.querySelector('.bl-item-remove').addEventListener('click', function () {
          // Removing the only row clears it back to a blank row, so
          // there is always one row to work in.
          if (itemsState.length === 1) itemsState[0] = newItemRow(); else itemsState.splice(idx, 1);
          renderItemRows();
          updateTotals();
          var add = document.getElementById('bl-inv-add-item');
          if (add) add.focus();
        });
      });

    }

    function addBlankItem() {
      itemsState.push(newItemRow());
      renderItemRows();
      updateTotals();
      var rows = document.querySelectorAll('#bl-inv-items .bl-item-row');
      var last = rows[rows.length - 1];
      var focusEl = last && (last.querySelector('.bl-item-name-select:not([disabled])') || last.querySelector('.bl-item-type'));
      if (focusEl) {
        focusEl.focus();
        if (last.scrollIntoView) last.scrollIntoView({ block: 'nearest' });
      }
    }

    // ---- Discount / totals ----
    // Validates in place (doesn't re-render the field) and toggles the
    // inline error + Create button together. Empty = 0. A discount above
    // the subtotal is rejected here so the saved discount can never
    // exceed what it is taken from (calcFinalTotal still floors at 0).
    function readDiscountInput(subtotal) {
      var input = document.getElementById('bl-inv-discount');
      var errorEl = document.getElementById('bl-inv-discount-error');
      var saveBtn = document.getElementById('bl-inv-save');
      var raw = input.value.trim();

      function fail(msg) {
        errorEl.textContent = msg;
        errorEl.style.display = '';
        input.setAttribute('aria-invalid', 'true');
        saveBtn.disabled = true;
        return { value: 0, valid: false };
      }
      function ok(v) {
        errorEl.style.display = 'none';
        input.removeAttribute('aria-invalid');
        saveBtn.disabled = false;
        return { value: v, valid: true };
      }

      if (raw === '') return ok(0);
      var num = Number(raw);
      if (isNaN(num) || num < 0) return fail('Enter a discount amount of \u20B10.00 or more.');
      if (num - (Number(subtotal) || 0) > 0.005) return fail('Discount can\u2019t be more than the subtotal (' + money(subtotal) + ').');
      return ok(num);
    }

    // Subtotal/total math is delegated to the PCData helpers
    // (calcInvoiceSubtotal/calcFinalTotal) — not reimplemented here.
    function updateTotals() {
      var subtotal = D.calcInvoiceSubtotal(itemsState);
      var discountState = readDiscountInput(subtotal);
      var total = D.calcFinalTotal(subtotal, discountState.value);
      var discountRow = document.getElementById('bl-inv-discount-row');
      var discountVal = document.getElementById('bl-inv-discount-val');
      document.getElementById('bl-inv-subtotal-val').textContent = money(subtotal);
      if (discountState.value > 0) {
        discountRow.classList.add('bl-inv-totals-discount');
        discountVal.textContent = '-' + money(discountState.value);
      } else {
        discountRow.classList.remove('bl-inv-totals-discount');
        discountVal.textContent = money(0);
      }
      document.getElementById('bl-inv-total-val').textContent = money(total);
    }

    // ---- Appointment + Client & Patient (read-only, from real records) ----
    // Labeled cell (Appointment panel): small icon + label, value below.
    function infoCell(iconName, label, valueHtml) {
      return '<div class="bl-inv-info"><div class="bl-dim">' + viewIco(iconName) + esc(label) + '</div><div>' + valueHtml + '</div></div>';
    }
    // Icon + value row (Client & Patient): no visible field label. The
    // icon is decorative; a screen-reader-only label names the value.
    // lines[0] is the primary line, the rest are secondary lines.
    function iconRow(iconName, srLabel, lines) {
      return '<div class="bl-inv-iconrow"><i class="fa-solid fa-' + iconName + ' bl-ico" aria-hidden="true"></i>' +
        '<div class="bl-inv-iconrow-text"><span class="bl-sr-only">' + esc(srLabel) + ': </span>' +
        lines.map(function (l, i) { return '<div class="' + (i === 0 ? 'bl-inv-iconrow-main' : 'bl-inv-iconrow-sub') + '">' + l + '</div>'; }).join('') +
        '</div></div>';
    }

    function renderApptDetails() {
      var apptId = document.getElementById('bl-inv-appt').value;
      var appt = D.getById(apptId);
      if (!appt) return;
      var info = getApptInfo(appt);
      var patient = typeof D.getPatientForAppointment === 'function' ? D.getPatientForAppointment(appt) : null;
      var client = typeof D.getClientForAppointment === 'function' ? D.getClientForAppointment(appt) : null;
      // Older appointments may not carry a patientId. Patients are matched
      // to appointments by pet + owner name elsewhere in the app
      // (patient-data-store.js), so use that same read-only match here for
      // the breed/age/sex display only. Nothing is written.
      if (!patient && typeof D.getPatients === 'function') {
        var petKey = String(appt.pet || '').trim().toLowerCase();
        var ownerKey = String(appt.owner || '').trim().toLowerCase();
        if (petKey && ownerKey) {
          patient = D.getPatients().find(function (p) {
            return String(p.pet || '').trim().toLowerCase() === petKey && String(p.owner || '').trim().toLowerCase() === ownerKey;
          }) || null;
        }
      }

      var when = fmtDateFull(appt.date);
      if (appt.time && typeof D.formatTimeLabel === 'function') when += ' \u00b7 ' + D.formatTimeLabel(appt.time);

      document.getElementById('bl-inv-appt-preview').innerHTML =
        '<div class="bl-inv-detail-grid">' +
        // Main appointment value first (its type when one was chosen, else a
        // plain "Appointment" — no number exists in the data model), with
        // Date & Time directly below it.
        '<div class="bl-inv-info bl-inv-appt-main"><i class="fa-solid fa-calendar-check bl-ico" aria-hidden="true"></i>' +
        '<div><div class="bl-inv-iconrow-main">' + esc(appt.appointmentType || 'Appointment') + '</div>' +
        '<div class="bl-inv-iconrow-sub"><span class="bl-sr-only">Date and time: </span>' + esc(when) + '</div></div></div>' +
        infoCell('paw', 'Pet', esc(info.pet) + (info.species ? ' <span class="bl-dim">(' + esc(info.species) + ')</span>' : '')) +
        infoCell('clipboard-list', 'Reason for visit', esc(info.reason || '\u2014')) +
        infoCell('user-doctor', 'Veterinarian', esc(info.vet || '\u2014')) +
        '</div>';

      var phone = firstField(client, ['phone', 'contactNumber']) || (patient && patient.ownerPhone) || appt.phone || null;
      var age = patient && patient.dob && typeof D.calcAge === 'function' ? D.calcAge(patient.dob) : null;
      var sex = patient && patient.sex ? patient.sex : null;

      var metaParts = [age, sex].filter(Boolean);

      document.getElementById('bl-inv-cp').innerHTML =
        '<div class="bl-inv-detail-grid">' +
        '<div>' +
        '<div class="bl-inv-cp-title">Client</div>' +
        iconRow('user', 'Client name', [esc(info.owner || '\u2014')]) +
        iconRow('phone', 'Phone', [esc(phone || '\u2014')]) +
        '</div>' +
        '<div>' +
        '<div class="bl-inv-cp-title">Patient</div>' +
        iconRow('paw', 'Pet name', [esc(info.pet || '\u2014'), esc((patient && patient.breed) || '\u2014'), esc(metaParts.length ? metaParts.join(' \u00b7 ') : '\u2014')]) +
        '</div>' +
        '</div>';
    }

    // ---- inline form error (modal stays open; nothing is saved) ----
    function showFormError(msg) {
      var el = document.getElementById('bl-inv-form-error');
      el.textContent = msg;
      el.style.display = '';
    }
    function clearFormError() {
      var el = document.getElementById('bl-inv-form-error');
      el.textContent = '';
      el.style.display = 'none';
    }

    renderItemRows();
    updateTotals();
    renderApptDetails();

    document.getElementById('bl-inv-appt').addEventListener('change', renderApptDetails);
    document.getElementById('bl-inv-discount').addEventListener('input', function () { clearFormError(); updateTotals(); });
    document.getElementById('bl-inv-notes').addEventListener('input', function (e) {
      document.getElementById('bl-inv-notes-count').textContent = e.target.value.length + '/' + NOTES_MAX;
    });
    document.getElementById('bl-inv-add-item').addEventListener('click', addBlankItem);
    document.getElementById('bl-inv-cancel').addEventListener('click', closeModal);
    document.getElementById('bl-inv-save').addEventListener('click', function () {
      clearFormError();
      var saveBtn = document.getElementById('bl-inv-save');
      var apptId = document.getElementById('bl-inv-appt').value;
      var appt = D.getById(apptId);
      if (!appt) { showFormError('The selected appointment could not be found. Please choose another appointment.'); return; }
      // Guard against a race where this appointment got invoiced from
      // another tab while this modal was open (unchanged behavior).
      if (D.getInvoiceForAppointment(appt.id)) {
        alert('This appointment already has an invoice.');
        closeModal();
        render();
        return;
      }
      var discountState = readDiscountInput(D.calcInvoiceSubtotal(itemsState));
      if (!discountState.valid) return; // inline error already shown, Create is disabled too

      var cleanItems = itemsState
        .filter(function (it) { return it.name.trim() && it.qty > 0; })
        .map(function (it, i) { return { id: 'i' + (i + 1), type: it.type, name: it.name.trim(), qty: it.qty, unitPrice: it.unitPrice, serviceId: it.serviceId || null, inventoryItemId: it.inventoryItemId || null }; });
      if (!cleanItems.length) { showFormError('Add at least one line item with a name and a quantity of 1 or more.'); return; }

      var fields = {
        appointmentId: appt.id,
        patientId: appt.patientId,
        clientId: appt.clientId,
        items: cleanItems,
        discount: discountState.value,
        notes: document.getElementById('bl-inv-notes').value
      };
      // Discount reason: the invoice record has no dedicated field for it,
      // so it is stored as an extra optional property only when given.
      var reason = document.getElementById('bl-inv-discount-reason').value.trim();
      if (discountState.value > 0 && reason) fields.discountReason = reason;

      var created = null;
      saveBtn.disabled = true;
      try {
        created = D.addInvoice(fields);
      } catch (err) {
        if (window.console && console.error) console.error('Create invoice failed:', err);
        created = null;
      }
      if (!created) {
        saveBtn.disabled = false;
        showFormError('The invoice could not be created. Nothing was saved \u2014 please try again.');
        return;
      }
      closeModal();
      render();
      // Open the new invoice right away so it can be reviewed, printed,
      // or have its payment recorded (unchanged post-creation behavior).
      openViewInvoiceModal(created.id);
    });
  }

  // ------------------------------------------------------------------
  // View Invoice
  // ------------------------------------------------------------------

  // Display-only: reads inv/info/payments and builds markup. Nothing in
  // this function calls D.updateInvoice/saveInvoices/etc., so opening
  // View Invoice never mutates stored data — including for a legacy
  // invoice, whose missing subtotal/discount/vet are only ever filled
  // in on the *returned* getInvoiceDisplayInfo() copy (Phase 3D change
  // in billing-data-store.js), never written back to the invoice itself.
  // Small muted Font Awesome icon placed before a View Invoice label
  // (display-only; the Print Invoice has its own printIcon()).
  function viewIco(name) {
    return '<i class="fa-solid fa-' + name + ' bl-ico" aria-hidden="true"></i>';
  }

  // Demo presentation: ONLY the INV-0001 demo GCash payment (pay_mtlnkglq_4nnzn3)
  // shows the shipped demo proof image when it has no proof of its own. Every other
  // payment shows a proof only if its own record has one. Display-only: nothing
  // here reads or writes storage.
  function viProofFor(p) {
    if (p.proofName || p.proofDataUrl) return { name: p.proofName || '', url: p.proofDataUrl || '' };
    if (p.id === 'pay_mtlnkglq_4nnzn3' && p.invoiceId === 'inv_mtl9u5tq_fsodef' && p.method === 'gcash') return { name: 'gcash-proof.jpeg', url: 'assets/gcash-proof.jpeg' };
    return null;
  }

  // Layout for a payment entry that has a proof: row 1 = Payment Date | Reference No. |
  // Processed By, row 2 = Reviewed By on the left and Proof of Payment in the right-hand
  // column. Reflows to 2 columns, then 1, on narrow screens. Added once; no new colors.
  function ensureViProofLayout() {
    if (document.getElementById('bl-vi-proof-layout')) return;
    var st = document.createElement('style');
    st.id = 'bl-vi-proof-layout';
    st.textContent =
      // Two columns: Payment Information (left) | Payment Proof (right).
      '.bl-vi-pay-body--proof { display:grid; grid-template-columns:minmax(0,2.2fr) minmax(220px,1fr); gap:14px 20px; align-items:start; }' +
      '.bl-vi-pay-sec { font-size:11.5px; font-weight:700; color:var(--ink-soft); text-transform:uppercase; letter-spacing:.04em; margin-bottom:8px; }' +
      '.bl-vi-pay-info .bl-vi-pay-sec { margin-bottom:14px; }' +
      '.bl-vi-pay-info .bl-vi-pay-grid { grid-template-columns:repeat(2,minmax(0,1fr)); gap:36px 20px; }' +
      '.bl-vi-pay-info .bl-vi-label { margin-bottom:4px; }' +
      // Existing thumbnail look (line-soft border, same radius) without the raised shadow.
      '.bl-vi-pay-proofcol { min-width:0; }' +
      '.bl-vi-pay-proofcol .bl-proof-thumb-btn { padding:3px; box-shadow:none; background:transparent; }' +
      '.bl-vi-pay-proofcol .bl-proof-thumb { width:auto; height:auto; max-width:90px; max-height:180px; object-fit:contain; border-radius:4px; }' +
      '.bl-vi-pay-proofrow { display:flex; align-items:flex-start; gap:16px; }' +
      '.bl-vi-pay-proofrow .bl-proof-thumb-btn { flex:0 0 auto; }' +
      '.bl-vi-pay-proofmeta { min-width:0; }' +
      '.bl-vi-pay-proofcol .bl-proof-filename { margin-top:2px; word-break:normal; overflow-wrap:anywhere; }' +
      '.bl-vi-pay-proofcol .btn { margin-top:14px; white-space:nowrap; }' +
      // Narrow: Payment Information first, Payment Proof underneath.
      '@media (max-width:600px) { .bl-vi-pay-body--proof { grid-template-columns:minmax(0,1fr); } }' +
      '@media (max-width:360px) { .bl-vi-pay-info .bl-vi-pay-grid { grid-template-columns:minmax(0,1fr); } }';
    document.head.appendChild(st);
  }

  function openViewInvoiceModal(id) {
    ensureViProofLayout();
    var inv = D.getInvoiceById(id);
    if (!inv) return;
    var info = D.getInvoiceDisplayInfo(inv);
    if (!info) return;
    var payments = D.getPaymentsForInvoice(id) || [];

    // ---- payment state, from the real payment records only ----
    // Amount Paid counts VERIFIED payments only; a pending payment never
    // makes an invoice paid. A refunded invoice keeps its original verified
    // payment (the refund itself is shown separately), and owes nothing.
    var verified = payments.filter(function (p) { return p.status === 'verified'; });
    var pending = payments.filter(function (p) { return p.status === 'pending-verification'; });
    var amountPaid = verified.reduce(function (sum, p) { return sum + (Number(p.amount) || 0); }, 0);
    var total = Number(inv.totalAmount) || 0;
    var isRefunded = inv.status === 'refunded';
    var balanceDue = isRefunded ? 0 : Math.max(0, Math.round((total - amountPaid) * 100) / 100);
    var shownPayment = verified[verified.length - 1] || pending[pending.length - 1] || null;
    var methodText = shownPayment ? methodLabel(shownPayment.method) : 'Not Paid Yet';
    var methodIcon = shownPayment ? (shownPayment.method === 'cash' ? 'money-bill-wave' : (shownPayment.method === 'gcash' ? 'mobile-screen-button' : 'building-columns')) : 'credit-card';

    // Breed / sex come from the live patient record when it resolves.
    var patient = (info.patientId && typeof D.getPatientById === 'function') ? D.getPatientById(info.patientId) : null;
    var petLine = esc(info.pet) + (info.species ? ' <span class="bl-dim">(' + esc(info.species) + ')</span>' : '');
    var petSub = [patient && patient.breed, patient && patient.sex && patient.sex !== 'Unknown' ? patient.sex : ''].filter(Boolean).join(' \u00b7 ');

    var apptWhen = [fmtDate(info.appointmentDate), info.appointmentTime].filter(Boolean).join(' \u00b7 ') || '\u2014';

    function cell(label, valueHtml, extraCls) {
      return '<div class="bl-vi-cell' + (extraCls ? ' ' + extraCls : '') + '"><div class="bl-vi-label">' + esc(label) + '</div><div class="bl-vi-value">' + valueHtml + '</div></div>';
    }
    function secTitle(icon, text) {
      return '<div class="bl-vi-title">' + viewIco(icon) + esc(text) + '</div>';
    }
    function cap(t) { var x = String(t == null ? '' : t); return x ? x.charAt(0).toUpperCase() + x.slice(1) : '\u2014'; }

    var items = Array.isArray(inv.items) ? inv.items : [];
    var itemsHtml = items.length ? items.map(function (it) {
      var qty = Number(it.qty) || 0, unit = Number(it.unitPrice) || 0;
      return '<tr><td>' + esc(cap(it.type)) + '</td><td class="bl-vi-item">' + esc(it.name || '\u2014') + '</td><td class="bl-vi-num">' + qty + '</td><td class="bl-vi-num">' + money(unit) + '</td><td class="bl-vi-num">' + money(qty * unit) + '</td></tr>';
    }).join('') : '<tr><td colspan="5" class="bl-vi-none">No line items on this invoice.</td></tr>';

    var discount = Number(info.discount) || 0;

    // ---- payment history (view only: no proof upload/removal, no review controls) ----
    var historyHtml;
    if (!payments.length) {
      historyHtml = '<div class="bl-vi-empty"><i class="fa-regular fa-file-lines" aria-hidden="true"></i>' +
        '<div class="bl-vi-empty-main">No payments submitted yet.</div>' +
        '<div class="bl-vi-empty-sub">This invoice is still unpaid.</div></div>';
    } else {
      historyHtml = '<div class="bl-vi-history">' + payments.map(function (p) {
        var reviewed = p.reviewedBy ? processedByLabel(p.reviewedBy) : '';
        // A payment with a proof renders two columns in one record: Payment Information
        // (left) and Payment Proof (right). The proof comes from viProofFor(): the payment's
        // own record, or the INV-0001 demo proof. Payments without one keep the original grid.
        var pr = viProofFor(p);
        var metaCells =
          cell('Payment Date', esc(fmtDateFull(p.paymentDate) || '\u2014')) +
          (p.method !== 'cash' ? cell('Reference No.', esc(p.referenceNumber || 'No reference')) : '') +
          cell('Processed By', esc(processedByLabel(p.submittedBy))) +
          (reviewed ? cell('Reviewed By', esc(reviewed)) : '');
        var bodyHtml;
        if (pr) {
          var hasImg = !!pr.url;
          var isPdf = /\.pdf$/i.test(pr.name || '');
          var pthumb = hasImg
            ? '<button type="button" class="bl-proof-thumb-btn" data-vi-proof="' + esc(p.id) + '" aria-label="View full-size payment proof image"><img class="bl-proof-thumb" src="' + pr.url + '" alt="Payment proof' + (pr.name ? ': ' + esc(pr.name) : '') + '"></button>'
            : '<div class="bl-proof-card-thumb" aria-hidden="true"><i class="fa-solid ' + (isPdf ? 'fa-file-pdf' : 'fa-file-lines') + ' bl-proof-preview-pdf"></i></div>';
          bodyHtml = '<div class="bl-vi-pay-body--proof">' +
            '<div class="bl-vi-pay-info"><div class="bl-vi-pay-sec">Payment Information</div><div class="bl-vi-pay-grid">' + metaCells + '</div></div>' +
            '<div class="bl-vi-pay-proofcol"><div class="bl-vi-pay-sec">Payment Proof</div>' +
            '<div class="bl-vi-pay-proofrow">' + pthumb + '<div class="bl-vi-pay-proofmeta">' +
            (pr.name ? '<div class="bl-proof-filename">' + esc(pr.name) + '</div>' : '') +
            (hasImg ? '<button type="button" class="btn btn-sm" data-vi-proof="' + esc(p.id) + '">View Proof</button>' : '') +
            '</div></div></div></div>';
        } else {
          bodyHtml = '<div class="bl-vi-pay-grid">' + metaCells + '</div>';
        }
        return '<div class="bl-vi-pay">' +
          '<div class="bl-vi-pay-head"><span class="bl-vi-pay-method">' + esc(methodLabel(p.method)) + '</span>' + paymentStatusBadge(p.status) + '<span class="bl-vi-pay-amount">' + money(p.amount) + '</span></div>' +
          bodyHtml +
          (p.status === 'rejected' && p.reviewNotes ? '<div class="bl-vi-reject"><span class="bl-vi-label">Rejection reason</span> ' + esc(p.reviewNotes) + '</div>' : '') +
          '</div>';
      }).join('') + '</div>';
    }

    var html = '<div class="bl-vi">' +
      // summary row
      '<div class="bl-vi-summary">' +
      cell('Invoice #', '<strong>' + esc(inv.invoiceNumber) + '</strong>') +
      cell('Status', statusBadge(inv.status)) +
      cell('Payment Method', '<span class="bl-vi-method"><i class="fa-solid fa-' + methodIcon + '" aria-hidden="true"></i>' + esc(methodText) + '</span>') +
      cell('Invoice Date', esc(fmtDate(inv.date) || '\u2014')) +
      '</div>' +
      (isRefunded ? buildRefundSectionHtml(info) : '') +
      // client & pet / appointment
      '<div class="bl-vi-two">' +
      '<div class="bl-vi-block">' + secTitle('user', 'Client & Pet') +
      '<div class="bl-vi-strong">' + esc(info.owner) + '</div>' +
      '<div class="bl-vi-line">' + viewIco('paw') + petLine + '</div>' +
      (petSub ? '<div class="bl-vi-sub">' + esc(petSub) + '</div>' : '') +
      '</div>' +
      '<div class="bl-vi-block">' + secTitle('calendar-days', 'Appointment') +
      '<div class="bl-vi-label">Date / Time</div><div class="bl-vi-value">' + esc(apptWhen) + '</div>' +
      '<div class="bl-vi-label bl-vi-gap">Reason for Visit</div><div class="bl-vi-value">' + esc(info.appointmentReason || '\u2014') + '</div>' +
      '</div>' +
      '</div>' +
      // line items
      '<div class="bl-vi-block">' + secTitle('list', 'Line Items') +
      '<div class="bl-vi-table-wrap bl-items-scroll" tabindex="0" role="region" aria-label="Line items, scrollable horizontally if needed">' +
      '<table class="bl-vi-table"><thead><tr><th scope="col">Category</th><th scope="col">Item</th><th scope="col" class="bl-vi-num">Qty</th><th scope="col" class="bl-vi-num">Unit Price</th><th scope="col" class="bl-vi-num">Amount</th></tr></thead><tbody>' + itemsHtml + '</tbody></table>' +
      '</div>' +
      '<div class="bl-vi-totals">' +
      '<div class="bl-vi-totals-row"><span>Subtotal</span><span>' + money(info.subtotal) + '</span></div>' +
      '<div class="bl-vi-totals-row"><span>Discount</span><span>' + (discount > 0 ? '-' : '') + money(discount) + '</span></div>' +
      '<div class="bl-vi-totals-row bl-vi-totals-total"><span>Total</span><span>' + money(total) + '</span></div>' +
      '</div>' +
      '</div>' +
      // payment summary
      '<div class="bl-vi-paysum" role="group" aria-label="Payment summary">' + secTitle('wallet', 'Payment Summary') +
      '<div class="bl-vi-paysum-grid">' +
      cell('Subtotal', money(info.subtotal)) +
      cell('Discount', (discount > 0 ? '-' : '') + money(discount)) +
      cell('Total Amount', money(total)) +
      cell('Amount Paid', money(amountPaid)) +
      (isRefunded ? cell('Refunded', info.refundAmount != null ? '-' + money(info.refundAmount) : '\u2014') : '') +
      cell('Balance Due', money(balanceDue), 'bl-vi-balance') +
      '</div></div>' +
      (inv.notes ? '<div class="bl-vi-block"><div class="bl-vi-label">Notes</div><div class="bl-vi-value">' + esc(inv.notes) + '</div></div>' : '') +
      // payment history
      '<div class="bl-vi-block">' + secTitle('clock-rotate-left', 'Payment History') + historyHtml + '</div>' +
      '</div>' +
      '<div class="bl-modal-actions bl-vi-actions">' +
      '<button type="button" class="btn" id="bl-inv-close-btn">Close</button>' +
      '<button type="button" class="btn btn-primary" id="bl-inv-print-btn"><i class="fa-solid fa-print" aria-hidden="true"></i> Print Invoice</button></div>';

    openModal('Invoice ' + inv.invoiceNumber, html);
    document.querySelector('#bl-modal-overlay .bl-modal').classList.add('bl-modal--invoice');
    document.getElementById('bl-inv-print-btn').addEventListener('click', function () { printInvoice(inv.id); });
    document.getElementById('bl-inv-close-btn').addEventListener('click', closeModal);
    // View-only proof: reuses the existing lightbox; nothing here can change a payment.
    document.getElementById('bl-modal-body').addEventListener('click', function (e) {
      var t = e.target.closest('[data-vi-proof]');
      if (!t) return;
      var pay = payments.find(function (p) { return p.id === t.getAttribute('data-vi-proof'); });
      var vp = pay ? viProofFor(pay) : null;
      if (vp && vp.url) openProofLightbox(vp.url, 'Payment proof' + (vp.name ? ': ' + vp.name : '') + ', full size', t);
    });
  }

  // Phase 3: refund details shown in View Invoice for a refunded invoice.
  // Reads only the refund fields getInvoiceDisplayInfo() already exposes;
  // an invoice refunded before refund metadata existed gets a plain note
  // instead of invented values.
  function buildRefundSectionHtml(info) {
    var hasMeta = info.refundedAt || info.refundAmount != null || info.refundReason || info.refundedBy;
    var body = hasMeta
      ? ('<div class="bl-inv-detail-grid">' +
        detailField('Refunded On', esc(info.refundedAt ? fmtDateTime(info.refundedAt) : '\u2014')) +
        detailField('Refund Amount', info.refundAmount != null ? money(info.refundAmount) : '\u2014') +
        detailField('Refunded By', esc(info.refundedBy || '\u2014')) +
        detailField('Reason', esc(info.refundReason || 'No reason recorded')) +
        '</div>')
      : '<p class="bl-empty-note">Refund details were not recorded for this invoice.</p>';
    return '<div class="bl-section-label">' + viewIco('arrow-rotate-left') + 'Refund</div>' + body;
  }

  // ------------------------------------------------------------------
  // Print / Receipt (Phase 3H)
  //
  // buildPrintInvoiceHtml() reads the SAME getInvoiceDisplayInfo()/
  // getPaymentsForInvoice() data the View Invoice modal above already
  // renders -- no second invoice model, no recomputed subtotal/discount/
  // total. info.subtotal/info.discount already carry Phase 3D's legacy
  // fallback (missing subtotal -> totalAmount, missing discount -> 0)
  // from billing-data-store.js itself, computed on the returned copy
  // only -- nothing here writes a fallback value back to the invoice.
  // ------------------------------------------------------------------

  // Phase 3L: label / colon / value row (matches the reference's Payment
  // Information layout). `value` is already-escaped HTML.
  function printField(label, value) {
    return '<div class="bl-print-field-row"><span>' + esc(label) + '</span><span>:</span><span>' + value + '</span></div>';
  }

  // Print-only capitalization of the item Type column ("Service" not
  // "service") -- purely cosmetic string formatting of the existing
  // it.type value, never written back to the item and never used for
  // calculations.
  function printCap(s) {
    s = String(s || '');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // Phase 3L: display-only icon helpers for the print invoice. They only
  // pick a Font Awesome glyph from strings the record already has.
  function printIcon(name, extra) {
    return '<i class="fa-solid fa-' + name + ' bl-print-ico' + (extra ? ' ' + extra : '') + '" aria-hidden="true"></i>';
  }

  function printLine(iconName, text, strong) {
    return '<div class="bl-print-line">' + (iconName ? printIcon(iconName) : '<span class="bl-print-ico" aria-hidden="true"></span>') + '<span>' + (strong ? '<span class="bl-print-appt-label">' + esc(strong) + '</span> ' : '') + esc(text) + '</span></div>';
  }

  function printSexIcon(sex) {
    var s = String(sex || '').trim().toLowerCase();
    if (/^m/.test(s)) return 'mars';
    if (/^f/.test(s)) return 'venus';
    return sex ? 'venus-mars' : 'cake-candles';
  }

  // Semantic pill for a payment/invoice status (label text is the same
  // stored status label as before; only the styling is new).
  function printStatusPill(rawStatus, label) {
    var cls = 'bl-print-pill';
    if (rawStatus === 'verified' || rawStatus === 'paid') cls += '';
    else if (rawStatus === 'pending-verification' || rawStatus === 'partial') cls += ' bl-print-pill--warn';
    else if (rawStatus === 'rejected') cls += ' bl-print-pill--bad';
    else cls += ' bl-print-pill--neutral';
    return '<span class="' + cls + '">' + esc(label) + '</span>';
  }

  function buildPrintInvoiceHtml(inv) {
    var info = D.getInvoiceDisplayInfo(inv);
    var payments = D.getPaymentsForInvoice(inv.id); // newest first
    var patientRecord = getInvoicePatientRecord(inv);
    var clientRecord = getInvoiceClientRecord(inv);
    var breed = (patientRecord && patientRecord.breed) || null;
    // Sex/age/contact/address are shown only "if available" (per the
    // stored record) -- a record may not have every one of these fields,
    // and this never guesses at a value it doesn't find.
    var sex = firstField(patientRecord, ['sex', 'gender']);
    var age = firstField(patientRecord, ['age', 'ageLabel']);
    var clientContact = firstField(clientRecord, ['phone', 'contactNumber', 'mobile', 'contact', 'email']);
    var clientAddress = firstField(clientRecord, ['address', 'fullAddress', 'location']);
    if (typeof clientAddress !== 'string') clientAddress = null;
    var vetDisplay = info.vet || 'Not assigned';
    var apptWhen = [fmtDate(info.appointmentDate), info.appointmentTime].filter(Boolean).join(' \u00b7 ') || '\u2014';
    var patientSubline1 = [info.species, breed].filter(Boolean).join(' \u00b7 ');
    var patientSubline2 = [sex, age].filter(Boolean).join(' \u00b7 ');

    // Services & Treatments: no separate Type column -- a non-"service"
    // line item (medicine/other) keeps that distinction as a small
    // inline tag next to its name instead, so the existing item data
    // is still fully represented. Values/qty/amount are untouched.
    var itemsRows = (inv.items || []).map(function (it) {
      var typeTag = (it.type && it.type !== 'service') ? (' <span class="bl-print-item-tag">' + esc(printCap(it.type)) + '</span>') : '';
      return '<tr><td>' + esc(it.name) + typeTag + '</td><td>' + it.qty + '</td><td>' + money(it.unitPrice) + '</td><td>' + money(it.qty * it.unitPrice) + '</td></tr>';
    }).join('');

    // Zero discount reads as "\u2014" rather than "-\u20b10.00" -- calculation
    // itself (info.discount) is untouched, this only changes display.
    var discountDisplay = info.discount > 0 ? ('-' + money(info.discount)) : '\u2014';

    // Payment Information: never fabricate a status or a "no payments
    // recorded" placeholder. An invoice with no submitted payment simply
    // states its real status (Unpaid). An invoice with a payment record
    // (pending verification, verified/paid, or rejected) shows that
    // record's actual stored details, most recent first.
    var latestPayment = payments.length ? payments[0] : null;
    var paymentsHtml;
    if (!latestPayment) {
      paymentsHtml = '<div class="bl-print-payment-row">' +
        printField('Status', printStatusPill(inv.status, INVOICE_STATUS_LABELS[inv.status] || inv.status)) +
        '</div>';
    } else {
      paymentsHtml = payments.map(function (p) {
        return '<div class="bl-print-payment-row">' +
          printField('Status', printStatusPill(p.status, PAYMENT_STATUS_LABELS[p.status] || p.status)) +
          printField('Method', esc(methodLabel(p.method))) +
          printField('Amount', money(p.amount)) +
          printField('Payment Date', esc(fmtDate(p.paymentDate))) +
          printField('Reference No.', esc(p.referenceNumber || '\u2014')) +
          '</div>';
      }).join('');
    }

    var contactIcon = /@/.test(String(clientContact || '')) ? 'envelope' : 'phone';

    return '' +
      '<div class="bl-print-body">' +
      // 1. Clinic branding header -- LOGO.png + WORDMARK.png only. No
      // "INVOICE" title, no invoice/payment/client data in the header.
      '<div class="bl-print-header">' +
      '<div class="bl-print-logo-box"><img class="bl-print-logo" src="img/LOGO.png" alt="Pawsitive Care logo"></div>' +
      '<div class="bl-print-wordmark-box"><img class="bl-print-wordmark" src="img/WORDMARK.png" alt="Pawsitive Care Veterinary Clinic"></div>' +
      '</div>' +
      // 2. Invoice metadata -- below the header, pale-teal panel.
      '<div class="bl-print-sec bl-print-meta">' +
      '<div class="bl-print-meta-item">' + printIcon('file-lines') + '<div class="bl-print-meta-text"><span>Invoice #</span><strong>' + esc(inv.invoiceNumber) + '</strong></div></div>' +
      '<div class="bl-print-meta-item">' + printIcon('calendar-days') + '<div class="bl-print-meta-text"><span>Invoice Date</span><strong>' + esc(fmtDate(inv.date)) + '</strong></div></div>' +
      '</div>' +
      // 3. Client + Patient -- two columns with a vertical divider.
      '<div class="bl-print-sec bl-print-twocol">' +
      '<div class="bl-print-block">' +
      printIcon('user', 'bl-print-ico--lg') +
      '<div class="bl-print-block-body">' +
      '<div class="bl-print-label">Client</div>' +
      '<div class="bl-print-name">' + esc(info.owner) + '</div>' +
      (clientContact ? printLine(contactIcon, clientContact) : '') +
      (clientAddress ? printLine('location-dot', clientAddress) : '') +
      '</div></div>' +
      '<div class="bl-print-block">' +
      printIcon('paw', 'bl-print-ico--lg') +
      '<div class="bl-print-block-body">' +
      '<div class="bl-print-label">Patient</div>' +
      '<div class="bl-print-name">' + esc(info.pet) + '</div>' +
      (patientSubline1 ? printLine(null, patientSubline1) : '') +
      (patientSubline2 ? printLine(printSexIcon(sex), patientSubline2) : '') +
      '</div></div>' +
      '</div>' +
      // 4. Appointment -- its own panel, icon per line.
      '<div class="bl-print-sec">' +
      '<div class="bl-print-block">' +
      printIcon('calendar-days', 'bl-print-ico--lg') +
      '<div class="bl-print-block-body">' +
      '<div class="bl-print-label">Appointment</div>' +
      printLine('clock', apptWhen) +
      printLine('notes-medical', info.appointmentReason || '\u2014', 'Reason for Visit:') +
      printLine('user-doctor', vetDisplay, 'Veterinarian:') +
      '</div></div>' +
      '</div>' +
      // 5. Services & Treatments + 6. Financial summary.
      '<div class="bl-print-sec bl-print-sec--last">' +
      '<div class="bl-print-section-head">' + printIcon('paw') + '<div class="bl-print-label">Services &amp; Treatments</div></div>' +
      '<table class="bl-print-table"><thead><tr><th>Service / Treatment</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead><tbody>' + itemsRows + '</tbody></table>' +
      '<div class="bl-print-totals">' +
      '<div class="bl-print-totals-row"><span>Subtotal</span><span>' + money(info.subtotal) + '</span></div>' +
      '<div class="bl-print-totals-row bl-print-discount"><span>Discount</span><span>' + discountDisplay + '</span></div>' +
      '<div class="bl-print-totals-row bl-print-total"><span>Total</span><span>' + money(inv.totalAmount) + '</span></div>' +
      '</div>' +
      '</div>' +
      // 7. Payment information (payment-proof image is never printed).
      '<div class="bl-print-panel bl-print-pay">' +
      '<div class="bl-print-pay-main">' +
      '<div class="bl-print-section-head">' + printIcon('credit-card') + '<div class="bl-print-label">Payment Information</div></div>' +
      '<div class="bl-print-pay-rows">' + paymentsHtml + '</div>' +
      '</div>' +
      '<div class="bl-print-pay-art"><img class="bl-print-pay-img" src="img/PAYMENT%20INFORMATION.png" alt=""></div>' +
      '</div>' +
      '</div>' +
      // 8. Footer.
      '<div class="bl-print-footer"><span>Thank you for trusting Pawsitive Care with your pet\u2019s care.</span></div>';
  }

  // Prints whichever invoice is passed in -- always the one currently
  // open in View Invoice, never a manually-typed invoice number. Purely
  // reads D.getInvoiceById()/getInvoiceDisplayInfo()/getPaymentsForInvoice();
  // nothing here mutates the store, so printing can never change Billing
  // data.
  function printInvoice(id) {
    var inv = D.getInvoiceById(id);
    if (!inv) return;
    var container = document.getElementById('bl-print-invoice');
    if (!container) return;
    // Ignore a second click while a print is already waiting on its images.
    if (printPending) return;
    printPending = true;
    container.innerHTML = buildPrintInvoiceHtml(inv);
    // The print content is already in the document at this point, so look for its
    // images now and open the print dialog only after every one has settled.
    whenImagesSettled(container, function () {
      printPending = false;
      window.print();
    });
  }

  var printPending = false;
  var PRINT_IMAGE_TIMEOUT_MS = 5000;

  // Calls done() exactly once, after every <img> inside root has loaded or failed.
  // Images that are already complete (loaded or broken) are not waited on, and a
  // safety timeout means a stalled image can never leave the user waiting.
  function whenImagesSettled(root, done) {
    var imgs = Array.prototype.slice.call(root.querySelectorAll('img'));
    var remaining = 0, finished = false, timer = null;
    function finish() {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      done();
    }
    function settle() { remaining -= 1; if (remaining <= 0) finish(); }
    imgs.forEach(function (img) {
      if (img.complete) return;           // already loaded, or already failed
      remaining += 1;
      img.addEventListener('load', settle, { once: true });
      img.addEventListener('error', settle, { once: true });   // failed image: continue without it
    });
    if (!remaining) { finish(); return; }
    timer = setTimeout(finish, PRINT_IMAGE_TIMEOUT_MS);
  }

  // ------------------------------------------------------------------
  // Record Payment
  // ------------------------------------------------------------------

  // Unified payment interface. Two states share ONE modal:
  //   NEW      openRecordPaymentModal(invoiceId)            -> entry form + Submit for Verification
  //   PENDING  openRecordPaymentModal(null, paymentId, intent) -> same layout, populated from the
  //            existing pending payment, with Approve / Reject as the main actions.
  // Approve/Reject call the existing D.verifyPayment / D.rejectPayment.
  function openRecordPaymentModal(id, pendingPaymentId, intent) {
    var pendingPayment = null;
    if (pendingPaymentId) {
      pendingPayment = D.getPaymentById(pendingPaymentId);
      if (!pendingPayment) return;
      id = pendingPayment.invoiceId;
    }
    var isPending = !!pendingPayment;
    var inv = D.getInvoiceById(id);
    if (!inv) return;
    if (isPending && pendingPayment.status !== 'pending-verification') { openModal('Record Payment', '<p class="bl-empty-note">This payment has already been reviewed.</p>'); return; }
    if (!isPending && inv.status === 'paid') { openModal('Record Payment', '<p class="bl-empty-note">This invoice is already paid.</p>'); return; }
    if (!isPending && inv.status === 'pending-verification') { openModal('Record Payment', '<p class="bl-empty-note">A payment for this invoice is already awaiting verification.</p>'); return; }
    if (!isPending && inv.status === 'refunded') { openModal('Record Payment', '<p class="bl-empty-note">This invoice has been refunded and cannot receive a new payment.</p>'); return; }

    var info = D.getInvoiceDisplayInfo(inv);
    var processedBy = isPending ? processedByLabel(pendingPayment.submittedBy) : (isAdmin() ? 'Admin' : 'Front Desk');
    // A pending payment's entry details (method, amount, reference, date) are
    // editable by the Administrator only, and only while it is still pending
    // (a reviewed payment never opens this modal and the store refuses edits).
    var canEditPending = isPending && isAdmin();

    // Layout-only icons for the method panel. Clinic account details come
    // from CLINIC_PAYMENT_CONFIG (development placeholders, see top of file).
    var PAY_METHOD_ICONS = { 'gcash': 'mobile-screen-button', 'bdo': 'building-columns', 'bpi': 'building-columns', 'metrobank': 'building-columns', 'cash': 'money-bill-wave' };

    function sumLine(icon, label, valueHtml) {
      return '<div class="bl-pay-sumline"><i class="fa-solid fa-' + icon + '" aria-hidden="true"></i>' + esc(label) + ': <strong>' + valueHtml + '</strong></div>';
    }
    function vRow(label, id) {
      return '<div class="bl-pay-vrow"><span class="bl-pay-vlabel">' + esc(label) + '</span><span class="bl-pay-vvalue" id="' + id + '"></span></div>';
    }

    // Approve / Reject live inside the Payment Verification card. For a NEW
    // payment there is nothing to decide on yet, so they render disabled
    // (structure matches the pending state; nothing can bypass submission).
    var decisionHtml;
    if (!isAdmin()) {
      decisionHtml = '<p class="bl-hint bl-pay-decision-hint"><i class="fa-solid fa-lock" aria-hidden="true"></i>Only an Administrator can approve or reject a payment.</p>';
    } else {
      decisionHtml = '<div class="bl-pay-decision">' +
        '<div class="bl-form-row bl-pay-reason-row"><label for="bl-pay-reason">Review Notes</label>' +
        '<div class="bl-pay-reason-help" id="bl-pay-reason-help">Required when rejecting</div>' +
        '<textarea id="bl-pay-reason" class="bl-pay-reason-input" rows="3" maxlength="' + NOTES_MAX + '" placeholder="Enter rejection reason..." aria-describedby="bl-pay-reason-help bl-pay-reason-error"' + (isPending ? '' : ' disabled') + '></textarea>' +
        '<div class="bl-pay-reason-error" id="bl-pay-reason-error" role="alert"></div></div>' +
        '<button type="button" class="btn btn-primary bl-pay-decision-btn" id="bl-pay-approve"' + (isPending ? '' : ' disabled aria-describedby="bl-pay-decision-note"') + '><i class="fa-solid fa-check" aria-hidden="true"></i> Approve Payment</button>' +
        '<button type="button" class="btn btn-danger bl-pay-decision-btn" id="bl-pay-reject"' + (isPending ? '' : ' disabled aria-describedby="bl-pay-decision-note"') + '><i class="fa-solid fa-xmark" aria-hidden="true"></i> Reject Payment</button>' +
        (isPending ? '' : '<p class="bl-pay-card-note" id="bl-pay-decision-note">Submit the payment for verification before approving or rejecting it.</p>') +
        '</div>';
    }

    var html = '' +
      '<div class="bl-pay-layout' + (isPending ? ' bl-pay-layout--pending' : '') + '">' +

      // ---------------- LEFT: payment entry ----------------
      '<div class="bl-pay-main">' +
      '<div class="bl-pay-summary">' +
      '<div class="bl-pay-summary-list">' +
      sumLine('file-invoice', 'Invoice', esc(inv.invoiceNumber)) +
      sumLine('user', 'Client', esc(info.owner)) +
      sumLine('paw', 'Patient', esc(info.pet)) +
      '</div>' +
      '<div class="bl-pay-summary-side">' +
      '<div class="bl-pay-sumline">Amount Due: <strong>' + money(inv.totalAmount) + '</strong></div>' +
      '<div class="bl-pay-sumline">Payment Status: ' + paymentStatusBadge('pending-verification') + '</div>' +
      '</div>' +
      '</div>' +

      '<div class="bl-form-row bl-pay-method-row"><label for="bl-pay-method">Payment method</label><select id="bl-pay-method" class="pc-select">' +
      D.PAYMENT_METHODS.map(function (m) { return '<option value="' + m + '">' + esc(PAYMENT_METHOD_LABELS[m]) + '</option>'; }).join('') +
      '</select></div>' +
      // Method-specific clinic payment panel (QR beside account details).
      // Filled in by syncFieldsForMethod(); hidden for plain Cash.
      '<div class="bl-pay-method-panel" id="bl-pay-method-panel">' +
      '<div class="bl-pay-mp-head">' +
      '<span class="bl-pay-method-ico"><i class="fa-solid fa-mobile-screen-button" id="bl-pay-method-ico" aria-hidden="true"></i></span>' +
      '<div class="bl-pay-method-text"><div class="bl-pay-method-title" id="bl-pay-method-title"></div>' +
      '<div class="bl-pay-method-sub" id="bl-pay-method-sub"></div></div>' +
      '</div>' +
      '<div class="bl-pay-mp-body" id="bl-pay-mp-body">' +
      '<figure class="bl-pay-qr" id="bl-pay-qr-wrap">' +
      '<img id="bl-pay-qr-img" src="" alt="">' +
      '<figcaption class="bl-pay-qr-cap" id="bl-pay-qr-cap"></figcaption>' +
      '</figure>' +
      '<div class="bl-pay-mp-info">' +
      '<div class="bl-pay-mp-field"><div class="bl-pay-mp-label">Account Name</div><div class="bl-pay-mp-value" id="bl-pay-mp-name"></div></div>' +
      '<div class="bl-pay-mp-field" id="bl-pay-mp-bank-row"><div class="bl-pay-mp-label">Bank</div><div class="bl-pay-mp-value" id="bl-pay-mp-bank"></div></div>' +
      '<div class="bl-pay-mp-field"><div class="bl-pay-mp-label" id="bl-pay-mp-num-label"></div><div class="bl-pay-mp-value" id="bl-pay-mp-num"></div></div>' +
      '</div>' +
      '</div>' +
      '</div>' +

      // Payment Proof -- ONE real file input (#bl-pay-proof) behind the
      // drop zone, the Choose File button and the Replace button. Stores via
      // the existing proofName / proofDataUrl; feeds Payment Verification.
      '<div class="bl-section-label">Payment Proof</div>' +
      '<div class="bl-pay-proof-block" id="bl-pay-proof-row">' +
      '<div class="bl-dropzone" id="bl-pay-dropzone">' +
      '<i class="fa-solid fa-cloud-arrow-up bl-dropzone-ico" aria-hidden="true"></i>' +
      '<div class="bl-dropzone-text">Drag &amp; drop your file here</div>' +
      '<div class="bl-dropzone-or" aria-hidden="true">or</div>' +
      '<button type="button" class="btn" id="bl-pay-choose">Choose File</button>' +
      '<input type="file" id="bl-pay-proof" class="bl-sr-only" tabindex="-1" aria-label="Payment proof file (JPG, PNG or PDF, max 5MB)" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf">' +
      '</div>' +
      '<div class="bl-pay-help" id="bl-pay-proof-help">Accepted formats: JPG, PNG, PDF (Max 5MB)</div>' +
      '<div class="bl-pay-reason-error" id="bl-pay-proof-error" role="alert"></div>' +
      '<div class="bl-proof-preview" id="bl-pay-proof-preview" style="display:none;">' +
      '<div class="bl-proof-card-thumb">' +
      '<img id="bl-pay-proof-preview-img" src="" alt="Selected payment proof preview">' +
      '<i class="fa-solid fa-file-pdf bl-proof-preview-pdf" id="bl-pay-proof-preview-pdf" aria-hidden="true" style="display:none;"></i>' +
      '</div>' +
      '<div class="bl-proof-preview-meta">' +
      '<span class="bl-proof-preview-name" id="bl-pay-proof-preview-name"></span>' +
      '<span class="bl-proof-preview-type" id="bl-pay-proof-preview-type"></span>' +
      '</div>' +
      '<span class="bl-proof-preview-actions" id="bl-pay-proof-actions">' +
      '<button type="button" class="btn btn-sm" id="bl-pay-proof-remove">Remove Proof</button>' +
      '</span>' +
      // Removal confirmation lives INSIDE the proof card (a state of it, not a second box).
      '<div class="bl-proof-confirm" id="bl-pay-proof-confirm" role="group" aria-labelledby="bl-pay-proof-confirm-text" style="display:none;">' +
      '<div class="bl-proof-confirm-text" id="bl-pay-proof-confirm-text">Remove this payment proof?</div>' +
      '<div class="bl-proof-confirm-actions">' +
      '<button type="button" class="btn btn-sm" id="bl-pay-proof-confirm-cancel">Cancel</button>' +
      '<button type="button" class="btn btn-sm btn-danger" id="bl-pay-proof-confirm-ok">Remove Proof</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>' +

      '<div class="bl-section-label">Payment Information</div>' +
      '<div class="bl-pay-info-grid">' +
      '<div class="bl-form-row"><label for="bl-pay-due">Amount Due</label><input type="text" id="bl-pay-due" class="bl-pay-locked" readonly aria-readonly="true" value="' + esc(money(inv.totalAmount)) + '"></div>' +
      '<div class="bl-form-row" id="bl-pay-ref-row"><label for="bl-pay-ref">Reference Number</label><input type="text" id="bl-pay-ref" placeholder="e.g. GC123456789" autocomplete="off"></div>' +
      '<div class="bl-form-row"><label for="bl-pay-amount">Amount Received</label><input type="number" min="0" step="0.01" inputmode="decimal" id="bl-pay-amount" value="' + inv.totalAmount + '"></div>' +
      '<div class="bl-form-row"><label for="bl-pay-date">Payment Date</label><input type="date" id="bl-pay-date" value="' + D.todayStr() + '"></div>' +
      '<div class="bl-form-row"><label for="bl-pay-by">Processed By</label><input type="text" id="bl-pay-by" class="bl-pay-locked" readonly aria-readonly="true" value="' + esc(processedBy) + '"></div>' +
      '</div>' +

      '<div class="bl-form-row bl-pay-notes-row"><label for="bl-pay-notes">Billing Notes (Optional)</label>' +
      '<div class="bl-inv-notes-wrap">' +
      '<textarea id="bl-pay-notes" rows="3" maxlength="' + NOTES_MAX + '" placeholder="For billing-related comments only." aria-describedby="bl-pay-notes-count"></textarea>' +
      '<div class="bl-inv-count" id="bl-pay-notes-count">0/' + NOTES_MAX + '</div></div></div>' +
      '<div class="bl-pay-form-error" id="bl-pay-form-error" role="alert"></div>' +
      '<div class="bl-pay-form-note" id="bl-pay-form-note" role="status"></div>' +
      '</div>' +

      // ---------------- RIGHT: status / verification summary ----------------
      '<div class="bl-pay-side">' +
      '<div class="bl-pay-card">' +
      '<div class="bl-pay-card-title"><i class="fa-solid fa-shield-halved" aria-hidden="true"></i>Payment Status</div>' +
      '<div>' + paymentStatusBadge('pending-verification') + '</div>' +
      (isPending
        ? '<p class="bl-pay-card-note">This payment is awaiting Administrator review. The invoice stays <strong>Pending Verification</strong> until it is approved or rejected.</p>'
        : '<p class="bl-pay-card-note">Submitting sends this for Administrator verification \u2014 the invoice will show <strong>Pending Verification</strong> until it\u2019s reviewed, not Paid.</p>') +
      '</div>' +
      '<div class="bl-pay-card">' +
      '<div class="bl-pay-card-title"><i class="fa-solid fa-clipboard-check" aria-hidden="true"></i>Payment Verification</div>' +
      '<div class="bl-pay-vrow"><span class="bl-pay-vlabel">Invoice</span><span class="bl-pay-vvalue">' + esc(inv.invoiceNumber) + '</span></div>' +
      '<div class="bl-pay-vrow"><span class="bl-pay-vlabel">Client</span><span class="bl-pay-vvalue">' + esc(info.owner) + '</span></div>' +
      '<div class="bl-pay-vrow"><span class="bl-pay-vlabel">Patient</span><span class="bl-pay-vvalue">' + esc(info.pet) + '</span></div>' +
      vRow('Amount', 'bl-pv-amount') +
      vRow('Payment Method', 'bl-pv-method') +
      vRow('Reference Number', 'bl-pv-ref') +
      '<div class="bl-pay-vproof"><div class="bl-pay-vlabel">Payment Proof</div><div id="bl-pv-proof" class="bl-pay-vproof-body"></div></div>' +
      decisionHtml +
      '</div>' +
      '<div class="bl-pay-card bl-pay-card--muted">' +
      '<div class="bl-pay-card-title"><i class="fa-solid fa-receipt" aria-hidden="true"></i>Receipt</div>' +
      '<p class="bl-pay-card-note">Receipt will be available after approval.</p>' +
      '</div>' +
      '</div>' +
      '</div>' +

      '<div class="bl-modal-actions bl-pay-actions"><button type="button" class="btn" id="bl-pay-cancel">' + (isPending ? 'Close' : 'Cancel') + '</button>' +
      (isPending
        ? (canEditPending ? '<button type="button" class="btn btn-primary" id="bl-pay-save-changes">Save Changes</button>' : '')
        : '<button type="button" class="btn btn-primary" id="bl-pay-save">Submit for Verification</button>') + '</div>';

    openModal('Record Payment', html);
    document.querySelector('#bl-modal-overlay .bl-modal').classList.add('bl-modal--payment');

    // PENDING state: show the payment exactly as stored. For the
    // Administrator, Payment Method / Amount Received / Reference Number /
    // Payment Date stay editable while the payment is pending (Save Changes,
    // or Approve, stores them); everyone else sees them locked. Billing Notes
    // stay locked. The Payment Proof area is handled separately below.
    if (isPending) {
      var lockIds = canEditPending ? ['bl-pay-notes'] : ['bl-pay-method', 'bl-pay-amount', 'bl-pay-ref', 'bl-pay-date', 'bl-pay-notes'];
      document.getElementById('bl-pay-method').value = pendingPayment.method;
      document.getElementById('bl-pay-amount').value = pendingPayment.amount;
      document.getElementById('bl-pay-ref').value = pendingPayment.referenceNumber || '';
      document.getElementById('bl-pay-date').value = pendingPayment.paymentDate || '';
      document.getElementById('bl-pay-notes').value = pendingPayment.notes || '';
      document.getElementById('bl-pay-notes-count').textContent = String((pendingPayment.notes || '').length) + '/' + NOTES_MAX;
      lockIds.forEach(function (fid) { document.getElementById(fid).disabled = true; });
    }

    function syncFieldsForMethod() {
      var method = document.getElementById('bl-pay-method').value;
      var isCash = method === 'cash';
      var cfg = CLINIC_PAYMENT_CONFIG[method] || null;   // null for Cash
      var isGcash = method === 'gcash';
      var refEl = document.getElementById('bl-pay-ref');
      document.getElementById('bl-pay-ref-row').style.display = !isCash ? '' : 'none';
      refEl.setAttribute('aria-required', !isCash ? 'true' : 'false');
      refEl.placeholder = isGcash ? 'e.g. GC123456789' : 'e.g. bank reference number';
      document.getElementById('bl-pay-proof-row').style.display = isCash ? 'none' : '';
      document.getElementById('bl-pay-proof-row').previousElementSibling.style.display = isCash ? 'none' : '';

      // Clinic payment panel: same structure for GCash / BDO / BPI / MetroBank.
      // Cash keeps a compact header only -- no QR, no number, no bank details.
      var body = document.getElementById('bl-pay-mp-body');
      document.getElementById('bl-pay-method-panel').style.display = '';
      document.getElementById('bl-pay-method-ico').className = 'fa-solid fa-' + (PAY_METHOD_ICONS[method] || 'credit-card');
      document.getElementById('bl-pay-method-title').textContent = methodLabel(method) + ' Payment';
      if (!cfg) {
        document.getElementById('bl-pay-method-sub').textContent = 'Collect the payment in person at the clinic.';
        body.style.display = 'none';
      } else {
        body.style.display = '';
        document.getElementById('bl-pay-method-sub').textContent = isPending
          ? 'Payment details as submitted. Review the proof, then approve or reject.'
          : 'Scan QR Code to Pay';

        document.getElementById('bl-pay-mp-name').textContent = cfg.accountName;
        document.getElementById('bl-pay-mp-bank-row').style.display = isGcash ? 'none' : '';
        document.getElementById('bl-pay-mp-bank').textContent = isGcash ? '' : cfg.bankName;
        document.getElementById('bl-pay-mp-num-label').textContent = isGcash ? 'GCash Number' : 'Account Number';
        document.getElementById('bl-pay-mp-num').textContent = cfg.accountNumber;

        // QR: a real <img> element from the configured image path.
        var qrWrap = document.getElementById('bl-pay-qr-wrap');
        var qrImg = document.getElementById('bl-pay-qr-img');
        var qrCap = document.getElementById('bl-pay-qr-cap');
        if (cfg.qrImage) {
          qrWrap.style.display = '';
          qrImg.onerror = function () { qrImg.style.display = 'none'; qrCap.textContent = 'QR image not found (' + cfg.qrImage + ').'; };
          qrImg.onload = function () { qrImg.style.display = ''; qrCap.textContent = ''; };
          qrImg.style.display = '';
          qrImg.alt = methodLabel(method) + ' payment QR code for ' + cfg.accountName + (cfg.qrIsPlaceholder ? ' (placeholder image for development)' : '');
          qrCap.textContent = '';   // the placeholder image carries its own "demo only" label
          if (qrImg.getAttribute('src') !== cfg.qrImage) qrImg.setAttribute('src', cfg.qrImage);
        } else {
          qrWrap.style.display = 'none';
        }
        body.classList.toggle('bl-pay-mp-body--noqr', !cfg.qrImage);
      }
      refreshVerifySummary();
    }
    syncFieldsForMethod();
    document.getElementById('bl-pay-method').addEventListener('change', syncFieldsForMethod);

    function showPayError(msg, focusEl) {
      var el = document.getElementById('bl-pay-form-error');
      el.textContent = msg || '';
      if (msg && focusEl && typeof focusEl.focus === 'function') focusEl.focus();
    }
    ['bl-pay-amount', 'bl-pay-ref', 'bl-pay-date', 'bl-pay-method'].forEach(function (fid) {
      var el = document.getElementById(fid);
      el.addEventListener('input', function () { showPayError(''); });
      el.addEventListener('change', function () { showPayError(''); });
    });

    document.getElementById('bl-pay-notes').addEventListener('input', function (e) {
      document.getElementById('bl-pay-notes-count').textContent = e.target.value.length + '/' + NOTES_MAX;
    });

    // ------------------------------------------------------------
    // Entry values + validation, shared by "Submit for Verification"
    // (new payment) and "Save Changes" / Approve (pending payment) so the
    // same rules -- and the same messages -- apply to both.
    // ------------------------------------------------------------
    function isValidIsoDate(value) {
      var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
      if (!m) return false;
      var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
      var dt = new Date(y, mo - 1, d);
      return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
    }
    function readEntryValues() {
      return {
        method: document.getElementById('bl-pay-method').value,
        amount: Number(document.getElementById('bl-pay-amount').value) || 0,
        ref: document.getElementById('bl-pay-ref').value.trim(),
        date: document.getElementById('bl-pay-date').value
      };
    }
    // Returns { msg, el } for the first problem, or null when valid.
    function validateEntry(v, outcomeWord) {
      if (v.amount <= 0) return { msg: 'Enter a valid amount received.', el: document.getElementById('bl-pay-amount') };
      // There is no partial-payment concept, so the amount must equal the
      // invoice total (whole centavos). verifyPayment() enforces the same
      // rule on the store side; checking here stops a payment that could
      // never be verified from being submitted or saved.
      if (Math.round(v.amount * 100) !== Math.round(Number(inv.totalAmount) * 100)) {
        return { msg: 'Amount Received must match the invoice total of ' + money(inv.totalAmount) + '. Nothing was ' + outcomeWord + '.', el: document.getElementById('bl-pay-amount') };
      }
      if (v.method !== 'cash' && !v.ref) return { msg: 'Enter the reference number for this ' + methodLabel(v.method) + ' payment.', el: document.getElementById('bl-pay-ref') };
      if (!v.date) return { msg: 'Choose the payment date.', el: document.getElementById('bl-pay-date') };
      if (!isValidIsoDate(v.date)) return { msg: 'Enter a valid payment date.', el: document.getElementById('bl-pay-date') };
      return null;
    }
    document.getElementById('bl-pay-ref').setAttribute('aria-required', 'true');

    // ------------------------------------------------------------
    // Payment proof preview (Phase 3I.1)
    //
    // pendingProofDataUrl holds the base64 data: URL for a selected
    // image (jpg/png/webp only) so it can be shown immediately here
    // AND handed to submitPayment() below, so the pending-payment view can later
    // display that exact same image — see the file header note on why
    // this is stored at all. Non-image files (e.g. a PDF receipt) fall
    // through to the existing filename-only behavior; proofName is
    // still captured from the input at submit time either way.
    // ------------------------------------------------------------
    var PROOF_PREVIEW_TYPES = ['image/jpeg', 'image/jpg', 'image/png'];
    var PROOF_ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
    var PROOF_MAX_BYTES = 5 * 1024 * 1024;
    var pendingProofDataUrl = '';
    var proofFileInput = document.getElementById('bl-pay-proof');
    var proofPreviewWrap = document.getElementById('bl-pay-proof-preview');
    var proofPreviewImg = document.getElementById('bl-pay-proof-preview-img');
    var proofPreviewPdf = document.getElementById('bl-pay-proof-preview-pdf');
    var proofPreviewName = document.getElementById('bl-pay-proof-preview-name');
    var proofPreviewType = document.getElementById('bl-pay-proof-preview-type');
    var proofErrorEl = document.getElementById('bl-pay-proof-error');
    var proofHelpEl = document.getElementById('bl-pay-proof-help');
    var dropzone = document.getElementById('bl-pay-dropzone');

    // "PNG image" / "JPG image" / "PDF document" under the filename.
    function proofKindLabel(name) {
      var m = /\.([a-z0-9]+)$/i.exec(name || '');
      var ext = m ? m[1].toLowerCase() : '';
      if (ext === 'pdf') return 'PDF document';
      if (ext === 'png') return 'PNG image';
      if (ext === 'jpg' || ext === 'jpeg') return 'JPG image';
      return ext ? ext.toUpperCase() + ' file' : 'File';
    }

    // The proof area is either the uploader (drop zone + help text) or the
    // proof card (thumbnail / file icon, name, Remove Proof) -- never both.
    function showProofPreview(name, dataUrl) {
      proofPreviewName.textContent = name;
      proofPreviewType.textContent = proofKindLabel(name);
      if (dataUrl) {
        proofPreviewImg.src = dataUrl; proofPreviewImg.alt = 'Preview of ' + name;
        proofPreviewImg.style.display = ''; proofPreviewPdf.style.display = 'none';
      } else {
        proofPreviewImg.removeAttribute('src'); proofPreviewImg.style.display = 'none';
        proofPreviewPdf.className = 'fa-solid ' + (/\.pdf$/i.test(name || '') ? 'fa-file-pdf' : 'fa-file-lines') + ' bl-proof-preview-pdf';
        proofPreviewPdf.style.display = '';
      }
      proofPreviewWrap.style.display = '';
      dropzone.style.display = 'none';
      proofHelpEl.style.display = 'none';
    }

    function clearProofPreview(clearError) {
      pendingProofDataUrl = '';
      proofFileInput.value = '';
      if (clearError === true) proofErrorEl.textContent = '';
      proofPreviewImg.removeAttribute('src');
      proofPreviewWrap.style.display = 'none';
      dropzone.style.display = '';
      proofHelpEl.style.display = '';
      refreshVerifySummary();
    }

    // The single upload handler: the picker, the drop zone and Replace all
    // end up here by way of the one #bl-pay-proof input's change event.
    proofFileInput.addEventListener('change', function () {
      var file = proofFileInput.files && proofFileInput.files[0];
      proofErrorEl.textContent = '';
      if (!file) { clearProofPreview(); return; }
      var okType = PROOF_ALLOWED_TYPES.indexOf(file.type) !== -1 || /\.(jpe?g|png|pdf)$/i.test(file.name);
      if (!okType) { clearProofPreview(); proofErrorEl.textContent = 'Unsupported file. Choose a JPG, PNG or PDF.'; return; }
      if (file.size > PROOF_MAX_BYTES) { clearProofPreview(); proofErrorEl.textContent = 'File is too large. The maximum size is 5MB.'; return; }
      if (PROOF_PREVIEW_TYPES.indexOf(file.type) === -1) {
        // PDF: filename only (existing behavior); no data URL, no broken image.
        pendingProofDataUrl = '';
        showProofPreview(file.name, '');
        refreshVerifySummary();
        if (isPending) commitPendingProof(file.name, '');
        return;
      }
      var reader = new FileReader();
      reader.onload = function (e) {
        if (!proofFileInput.files || proofFileInput.files[0] !== file) return;   // replaced/removed meanwhile
        pendingProofDataUrl = String(e.target.result || '');
        showProofPreview(file.name, pendingProofDataUrl);
        refreshVerifySummary();
        if (isPending) commitPendingProof(file.name, pendingProofDataUrl);
      };
      reader.readAsDataURL(file);
    });

    // PENDING payment with no stored proof: the proof chosen through the
    // SAME uploader above is saved onto this payment's existing proofName /
    // proofDataUrl (D.updatePaymentProof touches nothing else; the payment
    // stays pending-verification). On success the proof becomes the stored,
    // read-only one; on failure the selection is cleared and the reason is
    // shown, so nothing is displayed that was not actually saved.
    function commitPendingProof(name, dataUrl) {
      var saved = D.updatePaymentProof(pendingPayment.id, name, dataUrl);
      if (!saved) {
        clearProofPreview();
        proofErrorEl.textContent = D.getLastBillingError() || 'The proof could not be saved. Please try again.';
        return;
      }
      pendingPayment = D.getPaymentById(pendingPayment.id) || pendingPayment;
      showStoredProof();
      announce('Payment proof added.');
    }

    function openProofPicker() { if (!proofFileInput.disabled) proofFileInput.click(); }
    document.getElementById('bl-pay-choose').addEventListener('click', function (e) { e.stopPropagation(); openProofPicker(); });
    document.getElementById('bl-pay-proof-remove').addEventListener('click', function () {
      if (isPending) { openRemoveProofConfirm(); return; }
      clearProofPreview(true);                       // not stored yet: just drop the selection
      document.getElementById('bl-pay-choose').focus();
    });
    // Whole drop area is clickable (the button handles its own click above).
    dropzone.addEventListener('click', function (e) { if (e.target === proofFileInput) return; openProofPicker(); });
    ['dragenter', 'dragover'].forEach(function (ev) {
      dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.add('is-dragover'); });
    });
    ['dragleave', 'dragend'].forEach(function (ev) {
      dropzone.addEventListener(ev, function (e) { if (!dropzone.contains(e.relatedTarget)) dropzone.classList.remove('is-dragover'); });
    });
    dropzone.addEventListener('drop', function (e) {
      e.preventDefault();
      dropzone.classList.remove('is-dragover');
      var files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      var dt = new DataTransfer();
      dt.items.add(files[0]);                 // one proof file
      proofFileInput.files = dt.files;
      proofFileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // A file dropped just outside the zone must not navigate the page away.
    ['dragover', 'drop'].forEach(function (ev) {
      document.getElementById('bl-modal-body').addEventListener(ev, function (e) { if (!dropzone.contains(e.target)) e.preventDefault(); });
    });

    // PENDING, two cases (the payment is still awaiting review in both):
    //  1) A proof is stored -- shown as a preview + filename with a single
    //     "Remove Proof" action (confirmed first). There is no Replace: the
    //     workflow is remove, then upload the correct file.
    //  2) No stored proof -- the SAME drop zone / Choose File uploader used
    //     by New Payment (already rendered and wired above).
    // Removal only exists here: once a payment is approved or rejected this
    // modal no longer opens (see the top of the function) and the store
    // refuses removePaymentProof(), so an approved proof stays read-only.
    var proofActionsEl = document.getElementById('bl-pay-proof-actions');
    var proofRemoveBtn = document.getElementById('bl-pay-proof-remove');
    var proofConfirmEl = document.getElementById('bl-pay-proof-confirm');

    function hideRemoveProofConfirm() {
      proofConfirmEl.style.display = 'none';
      proofActionsEl.style.display = '';
      proofPreviewWrap.classList.remove('is-confirming');
    }
    function showStoredProof() {
      hideRemoveProofConfirm();
      proofErrorEl.textContent = '';
      proofFileInput.value = '';
      proofFileInput.disabled = true;
      showProofPreview(pendingPayment.proofName || 'Payment proof', pendingPayment.proofDataUrl || '');
      refreshVerifySummary();
    }
    // Back to the empty state: the uploader returns, the preview goes, and
    // Payment Verification (which reads the stored payment) shows no proof.
    function showUploader() {
      hideRemoveProofConfirm();
      proofFileInput.disabled = false;
      clearProofPreview(true);
    }
    function openRemoveProofConfirm() {
      proofActionsEl.style.display = 'none';
      proofConfirmEl.style.display = '';
      proofPreviewWrap.classList.add('is-confirming');
      document.getElementById('bl-pay-proof-confirm-cancel').focus();
    }
    // Escape closes just the confirmation, not the whole payment modal.
    proofConfirmEl.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      hideRemoveProofConfirm();
      proofRemoveBtn.focus();
    });
    document.getElementById('bl-pay-proof-confirm-cancel').addEventListener('click', function () {
      hideRemoveProofConfirm();
      proofRemoveBtn.focus();
    });
    document.getElementById('bl-pay-proof-confirm-ok').addEventListener('click', function () {
      if (!isPending) return;
      if (!D.removePaymentProof(pendingPayment.id)) {
        hideRemoveProofConfirm();
        proofErrorEl.textContent = D.getLastBillingError() || 'The proof could not be removed. Please try again.';
        proofRemoveBtn.focus();
        return;
      }
      pendingPayment = D.getPaymentById(pendingPayment.id) || pendingPayment;
      showUploader();
      document.getElementById('bl-pay-choose').focus();
      announce('Payment proof removed.');
    });
    if (isPending && (pendingPayment.proofDataUrl || pendingPayment.proofName)) showStoredProof();

    // ------------------------------------------------------------
    // Payment Verification summary (right column). Display only: it
    // mirrors the values entered on the left (and the proof already
    // selected above) and never has its own input or uploader.
    // ------------------------------------------------------------
    var verifyProofEl = document.getElementById('bl-pv-proof');
    // Single source for "the proof being shown": the stored payment when
    // viewing a pending payment, otherwise the file just chosen above.
    function getProofView() {
      if (isPending) {
        return { dataUrl: pendingPayment.proofDataUrl || '', name: pendingPayment.proofName || '', hasFile: !!(pendingPayment.proofDataUrl || pendingPayment.proofName) };
      }
      var f = proofFileInput.files && proofFileInput.files[0];
      return { dataUrl: pendingProofDataUrl, name: f ? f.name : '', hasFile: !!f };
    }
    function refreshVerifySummary() {
      if (!proofFileInput || !verifyProofEl) return; // initial method sync runs before these exist
      var method = document.getElementById('bl-pay-method').value;
      var isCash = method === 'cash';
      var amt = Number(document.getElementById('bl-pay-amount').value) || 0;
      var ref = document.getElementById('bl-pay-ref').value.trim();
      var pv = getProofView();
      var file = pv.hasFile ? { name: pv.name } : null;
      document.getElementById('bl-pv-amount').textContent = money(amt);
      document.getElementById('bl-pv-method').textContent = methodLabel(method);
      document.getElementById('bl-pv-ref').textContent = (!isCash && ref) ? ref : '\u2014';
      if (isCash) {
        verifyProofEl.innerHTML = '<p class="bl-proof-note">Not required for cash payments.</p>';
      } else if (pv.dataUrl) {
        verifyProofEl.innerHTML =
          '<div class="bl-pay-vproof-row">' +
          '<button type="button" class="bl-proof-thumb-btn" id="bl-pv-proof-thumb" aria-label="View full-size payment proof image">' +
          '<img class="bl-proof-thumb" src="' + pv.dataUrl + '" alt="Payment proof' + (file && file.name ? ': ' + esc(file.name) : '') + '">' +
          '</button>' +
          '<button type="button" class="btn btn-primary" id="bl-pv-proof-open"><i class="fa-solid fa-eye" aria-hidden="true"></i> View Image</button>' +
          '</div>' +
          '<div class="bl-proof-filename">' + esc(file && file.name ? file.name : 'Payment proof') + '</div>';
      } else if (file && file.name) {
        verifyProofEl.innerHTML = '<div class="bl-proof-filename">' + esc(file.name) + ' <span class="bl-proof-note">(preview not available for this file type)</span></div>';
      } else {
        verifyProofEl.innerHTML = '<p class="bl-proof-note">No payment proof uploaded.</p>';
      }
    }
    // The one proof lightbox; src is the proof being shown (selected or stored).
    verifyProofEl.addEventListener('click', function (e) {
      var trigger = e.target.closest('#bl-pv-proof-open, #bl-pv-proof-thumb');
      var pv = getProofView();
      if (!trigger || !pv.dataUrl) return;
      openProofLightbox(pv.dataUrl, 'Payment proof' + (pv.name ? ': ' + pv.name : '') + ', full size', trigger);
    });
    document.getElementById('bl-pay-amount').addEventListener('input', refreshVerifySummary);
    document.getElementById('bl-pay-ref').addEventListener('input', refreshVerifySummary);
    refreshVerifySummary();

    document.getElementById('bl-pay-cancel').addEventListener('click', closeModal);

    // ------------------------------------------------------------
    // PENDING: edit + save the entry details (Administrator only).
    // Only fields that actually differ from the stored payment are sent to
    // D.updatePendingPayment(), which re-validates and writes just those.
    // ------------------------------------------------------------
    var noteEl = document.getElementById('bl-pay-form-note');
    function setPayNote(msg) { noteEl.textContent = msg || ''; }
    function pendingPatch(v) {
      var patch = {};
      if (v.method !== pendingPayment.method) patch.method = v.method;
      if (Math.round(v.amount * 100) !== Math.round((Number(pendingPayment.amount) || 0) * 100)) patch.amount = v.amount;
      var newRef = v.method === 'cash' ? '' : v.ref;
      if (newRef !== (pendingPayment.referenceNumber || '')) patch.referenceNumber = newRef;
      if (v.date !== (pendingPayment.paymentDate || '')) patch.paymentDate = v.date;
      return patch;
    }
    // true = nothing to save, or saved; false = refused (message shown).
    function savePendingEdits() {
      var v = readEntryValues();
      var patch = pendingPatch(v);
      if (!Object.keys(patch).length) return true;
      var problem = validateEntry(v, 'saved');
      if (problem) { showPayError(problem.msg, problem.el); return false; }
      if (!D.updatePendingPayment(pendingPayment.id, patch)) {
        showPayError(D.getLastBillingError() || 'The changes could not be saved. Please try again.', document.getElementById('bl-pay-method'));
        return false;
      }
      pendingPayment = D.getPaymentById(pendingPayment.id) || pendingPayment;
      // Show exactly what is now stored.
      document.getElementById('bl-pay-method').value = pendingPayment.method;
      document.getElementById('bl-pay-amount').value = pendingPayment.amount;
      document.getElementById('bl-pay-ref').value = pendingPayment.referenceNumber || '';
      document.getElementById('bl-pay-date').value = pendingPayment.paymentDate || '';
      syncFieldsForMethod();
      render();   // the Pending table row shows method / date / amount
      return true;
    }
    if (canEditPending) {
      var refreshDirty = function () {
        setPayNote(Object.keys(pendingPatch(readEntryValues())).length ? 'You have unsaved changes.' : '');
      };
      ['bl-pay-amount', 'bl-pay-ref', 'bl-pay-date', 'bl-pay-method'].forEach(function (fid) {
        var el = document.getElementById(fid);
        el.addEventListener('input', refreshDirty);
        el.addEventListener('change', refreshDirty);
      });
      document.getElementById('bl-pay-save-changes').addEventListener('click', function () {
        showPayError('');
        if (!Object.keys(pendingPatch(readEntryValues())).length) { setPayNote('No changes to save.'); return; }
        if (savePendingEdits()) { setPayNote('Changes saved.'); announce('Payment details saved.'); }
      });
    }

    if (isPending) {
      var approveBtn = document.getElementById('bl-pay-approve');
      var rejectBtn = document.getElementById('bl-pay-reject');
      var reasonEl = document.getElementById('bl-pay-reason');
      var reasonErr = document.getElementById('bl-pay-reason-error');
      if (approveBtn && rejectBtn && reasonEl) {
        var invNo = inv.invoiceNumber;
        // Both buttons are disabled while the store call runs so a fast
        // double-click can't fire verify/reject twice; re-enabled only on
        // the failure path (success closes the modal).
        var setProcessing = function (processing) { approveBtn.disabled = processing; rejectBtn.disabled = processing; };
        reasonEl.addEventListener('input', function () {
          reasonErr.textContent = '';
          reasonEl.removeAttribute('aria-invalid');
        });
        approveBtn.addEventListener('click', function () {
          setProcessing(true);
          showPayError('');
          // Unsaved edits are validated and stored first, so the payment that
          // gets approved is exactly what the form shows. A refused edit
          // (e.g. wrong amount) stops the approval.
          if (canEditPending && !savePendingEdits()) { setProcessing(false); return; }
          var ok = D.verifyPayment(pendingPayment.id, 'Administrator');
          if (!ok) {
            setProcessing(false);
            alert(D.getLastBillingError() || 'This payment could not be verified \u2014 it may have already been reviewed.');
            return;
          }
          closeModal();
          render();
          focusActiveTab();
          announce('Payment for ' + invNo + ' approved. It now appears under Completed.');
        });
        rejectBtn.addEventListener('click', function () {
          var reason = reasonEl.value.trim();
          if (!reason) {
            reasonErr.textContent = 'Enter a rejection reason before rejecting this payment.';
            reasonEl.setAttribute('aria-invalid', 'true');
            reasonEl.focus();
            return;
          }
          setProcessing(true);
          var ok = D.rejectPayment(pendingPayment.id, 'Administrator', reason);
          if (!ok) {
            setProcessing(false);
            alert(D.getLastBillingError() || 'This payment could not be rejected \u2014 it may have already been reviewed.');
            return;
          }
          closeModal();
          render();
          focusActiveTab();
          announce('Payment for ' + invNo + ' rejected.');
        });
        // Reject from the table row: land on the reason field.
        if (intent === 'reject') reasonEl.focus();
      }
      return; // pending payments are reviewed, never re-submitted
    }

    document.getElementById('bl-pay-save').addEventListener('click', function () {
      var v = readEntryValues();
      var method = v.method;
      var notes = document.getElementById('bl-pay-notes').value;
      // Cash takes no proof and no reference, even if a file was chosen or a
      // reference typed before switching the method to Cash.
      var isCashPay = method === 'cash';
      var proofName = !isCashPay && proofFileInput.files && proofFileInput.files[0] ? proofFileInput.files[0].name : '';

      showPayError('');
      var problem = validateEntry(v, 'submitted');
      if (problem) { showPayError(problem.msg, problem.el); return; }

      var payment = D.submitPayment(inv.id, {
        method: method,
        amount: v.amount,
        referenceNumber: isCashPay ? '' : v.ref,
        paymentDate: v.date,
        proofName: proofName,
        // Phase 3I.1: same viewable image the pending-payment view shows later;
        // empty string for no-proof or non-previewable (e.g. PDF) proof.
        proofDataUrl: isCashPay ? '' : pendingProofDataUrl,
        notes: notes,
        submittedBy: isAdmin() ? 'Admin' : 'Front Desk'
      });

      closeModal();
      if (!payment) {
        alert(D.getLastBillingError() || 'This invoice can no longer accept a new payment submission — it may already be paid or already awaiting verification.');
      } else {
        // The new payment is awaiting verification -- show it where that happens.
        state.tab = 'pending';
      }
      render();
    });
  }

  // ------------------------------------------------------------------
  // Payment Verification
  // ------------------------------------------------------------------

  // Small field-pair helper for the modal's detail grids — same markup
  // shape (.bl-dim label + value) the existing bl-inv-detail-grid usage
  // in View Invoice already uses, just factored out so each of the
  // three Phase 3E sections below can build its own grid the same way.
  function detailField(label, value) {
    return '<div><div class="bl-dim">' + esc(label) + '</div><div>' + value + '</div></div>';
  }

  // ------------------------------------------------------------
  // Payment-proof lightbox (Phase 3I.1)
  //
  // A single overlay, reused for whichever payment's proof is opened.
  // proofLightboxOpen lets setupModalShell()'s Escape/Tab handling (for
  // the payment modal underneath) step aside while this is open,
  // so Escape/Tab act on the lightbox only, never both at once.
  // ------------------------------------------------------------
  var proofLightboxOpen = false;
  var proofLightboxLastFocus = null;

  function openProofLightbox(src, alt, triggerEl) {
    var overlay = document.getElementById('bl-proof-lightbox');
    var img = document.getElementById('bl-proof-lightbox-img');
    if (!overlay || !img) return;
    img.src = src;
    img.alt = alt || 'Payment proof, full size';
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    proofLightboxOpen = true;
    proofLightboxLastFocus = triggerEl || document.activeElement;
    document.getElementById('bl-proof-lightbox-close').focus();
  }

  function closeProofLightbox() {
    var overlay = document.getElementById('bl-proof-lightbox');
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    document.getElementById('bl-proof-lightbox-img').src = '';
    proofLightboxOpen = false;
    if (proofLightboxLastFocus && typeof proofLightboxLastFocus.focus === 'function') {
      proofLightboxLastFocus.focus();
    }
    proofLightboxLastFocus = null;
  }

  function setupProofLightbox() {
    var overlay = document.getElementById('bl-proof-lightbox');
    if (!overlay) return;
    document.getElementById('bl-proof-lightbox-close').addEventListener('click', closeProofLightbox);
    overlay.addEventListener('click', function (e) {
      if (e.target.id === 'bl-proof-lightbox') closeProofLightbox();
    });
    document.addEventListener('keydown', function (e) {
      if (!proofLightboxOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeProofLightbox();
        return;
      }
      // Only one focusable control (the close button) — Tab/Shift+Tab
      // both just keep focus on it, matching the single-element case of
      // the existing modal focus trap.
      if (e.key === 'Tab') {
        e.preventDefault();
        document.getElementById('bl-proof-lightbox-close').focus();
      }
    });
  }

  // ------------------------------------------------------------------
  // wiring
  // ------------------------------------------------------------------

  function setupToolbar() {
    document.getElementById('bl-search').addEventListener('input', function (e) {
      state.search = e.target.value;
      renderPaymentTable();
    });
    document.getElementById('bl-new-invoice-btn').addEventListener('click', openNewInvoiceModal);

    var tabs = Array.prototype.slice.call(document.querySelectorAll('.bl-tab'));
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        setTab(t.getAttribute('data-tab'), false);
      });
    });
    // Arrow keys / Home / End move between tabs and activate them
    // (automatic activation -- switching only swaps which list is shown).
    document.getElementById('bl-tablist').addEventListener('keydown', function (e) {
      var idx = TABS.indexOf(state.tab);
      var next = -1;
      if (e.key === 'ArrowRight') next = (idx + 1) % TABS.length;
      else if (e.key === 'ArrowLeft') next = (idx - 1 + TABS.length) % TABS.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = TABS.length - 1;
      if (next === -1) return;
      e.preventDefault();
      setTab(TABS[next], true);
    });
  }

  function setupTableDelegation() {
    document.getElementById('bl-payment-tbody').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-action]');
      if (!btn) return;
      var id = btn.getAttribute('data-id');
      var action = btn.getAttribute('data-action');
      if (action === 'view') openViewInvoiceModal(id);
      else if (action === 'review') openRecordPaymentModal(null, id, btn.getAttribute('data-intent'));
    });
  }

  function setupModalShell() {
    var overlay = document.getElementById('bl-modal-overlay');
    document.getElementById('bl-modal-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', function (e) {
      if (e.target.id === 'bl-modal-overlay') closeModal();
    });
    // Phase 3G: Escape only closes when a modal is actually open (a bare
    // document-level listener otherwise fires on every Escape press app-
    // wide), and Tab/Shift+Tab are trapped to the modal's own focusable
    // elements so keyboard focus can't leave the open dialog and land on
    // the page behind it.
    document.addEventListener('keydown', function (e) {
      if (!overlay.classList.contains('open')) return;
      if (proofLightboxOpen) return; // the lightbox handles its own Escape/Tab while open
      if (e.key === 'Escape') {
        closeModal();
        return;
      }
      if (e.key === 'Tab') {
        var modal = overlay.querySelector('.bl-modal');
        var focusable = getFocusableEls(modal);
        if (!focusable.length) { e.preventDefault(); return; }
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        var current = document.activeElement;
        if (e.shiftKey) {
          if (current === first || !modal.contains(current)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (current === last || !modal.contains(current)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    setupToolbar();
    setupTableDelegation();
    setupModalShell();
    setupProofLightbox();

    // Live refresh when Appointments/Patients/etc. change in this tab or
    // another one. Prefer PCData's own subscribe API if it exposes one;
    // otherwise fall back to the storage event and the app's own
    // 'pcv1:change' custom event so a missing onChange() can't throw here
    // and block the very first render() call below.
    if (typeof D.onChange === 'function') {
      D.onChange(render);
    } else {
      window.addEventListener('storage', function (e) {
        if (!e.key || e.key.indexOf('pcv1') === 0) render();
      });
      document.addEventListener('pcv1:change', render);
    }

    render();
  });
})();