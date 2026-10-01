// ============================================================
// PAWSITIVE CARE — Client (Pet Owner) Billing
//
// Every invoice shown here is resolved from the single Client
// record returned by PCClientAuth.requireClientLogin() — never by
// matching a name/email typed anywhere. No new billing schema, no
// fake/demo data: this reads the EXISTING PCData.getInvoices() /
// getPayments() (billing-data-store.js) and only ever writes
// through the EXISTING PCData.submitPayment() — the same function
// billing.js (Administrator/Front Desk) calls. It never calls
// verifyPayment()/rejectPayment() and never sets an invoice's
// status to 'paid' directly; a submitted payment always lands on
// 'pending-verification' until an Administrator reviews it.
//
// OWNERSHIP: an invoice belongs to the logged-in client if any of
// the following (re-checked against fresh data on every render,
// never cached) is true:
//   - invoice.clientId === client.id          (how billing.js
//     stamps every new invoice, copied from the source appointment)
//   - invoice.patientId is one of this client's own pets, from the
//     EXISTING PCData.getPatientsForClient(client)
//   - invoice.appointmentId is one of this client's own
//     appointments, from the EXISTING PCData.getAppointmentsForClient(client)
// This mirrors the same ownership chain client-dashboard.js /
// client-appointments.js / client-notifications.js already use
// (Client -> that client's real Patients/Appointments) — nothing
// here is matched by owner name or email text.
// ============================================================

(function () {
  var currentInvoiceId = null; // invoice currently open in the detail overlay

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function initials(name) {
    var parts = (name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    var first = parts[0][0] || '';
    var last = parts.length > 1 ? (parts[parts.length - 1][0] || '') : '';
    return (first + last).toUpperCase();
  }

  function money(n) {
    return '\u20B1' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtDate(D, iso) {
    if (!iso) return '\u2014';
    if (typeof D.formatDateLabel === 'function') return D.formatDateLabel(iso);
    var d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function showToast(msg) {
    var toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toast.classList.remove('show'); }, 2200);
  }

  function renderSidebarFooter(client) {
    document.getElementById('footer-avatar').textContent = initials(client.name);
    document.getElementById('footer-name').textContent = client.name;
  }

  var STATUS_LABELS = {
    'unpaid': 'Unpaid',
    'pending-verification': 'Pending Verification',
    'paid': 'Paid',
    'rejected': 'Rejected',
    'refunded': 'Refunded'
  };
  var PAYMENT_STATUS_LABELS = { 'pending-verification': 'Pending Verification', 'verified': 'Verified', 'rejected': 'Rejected' };

  function statusBadge(status) {
    var label = STATUS_LABELS[status] || status;
    return '<span class="status-badge bill-status-' + esc(status) + '">' + esc(label) + '</span>';
  }

  // ------------------------------------------------------------------
  // ownership resolution — see header comment
  // ------------------------------------------------------------------

  function getInvoicesForClient(D, client) {
    var pets = D.getPatientsForClient(client);
    var petIds = pets.map(function (p) { return p.id; });
    var appts = D.getAppointmentsForClient(client);
    var apptIds = appts.map(function (a) { return a.id; });

    return D.getInvoices().filter(function (inv) {
      if (inv.clientId && inv.clientId === client.id) return true;
      if (inv.patientId && petIds.indexOf(inv.patientId) > -1) return true;
      if (inv.appointmentId && apptIds.indexOf(inv.appointmentId) > -1) return true;
      return false;
    }).sort(function (a, b) { return b.createdAt - a.createdAt; });
  }

  // Defense-in-depth: re-verify a single invoice id is actually owned
  // by this client (against fresh data) before ever opening its detail
  // or letting a payment be submitted against it — mirrors the same
  // never-trust-the-caller-alone care client-appointments.js takes
  // before writing a booking against a selected pet.
  function findOwnedInvoice(D, client, invoiceId) {
    return getInvoicesForClient(D, client).find(function (inv) { return inv.id === invoiceId; }) || null;
  }

  // ------------------------------------------------------------------
  // summary strip
  // ------------------------------------------------------------------

  function renderSummary(D, invoices) {
    var outstanding = 0, pending = 0, paid = 0;
    invoices.forEach(function (inv) {
      if (inv.status === 'unpaid' || inv.status === 'rejected') outstanding += inv.totalAmount;
      else if (inv.status === 'pending-verification') pending += inv.totalAmount;
      else if (inv.status === 'paid') paid += inv.totalAmount;
    });
    document.getElementById('cb-summary-grid').innerHTML =
      '<div class="cb-summary-card"><div class="cb-summary-icon"><i class="fa-solid fa-file-invoice"></i></div>' +
        '<div><div class="cb-summary-label">Outstanding</div><div class="cb-summary-value">' + money(outstanding) + '</div></div></div>' +
      '<div class="cb-summary-card"><div class="cb-summary-icon"><i class="fa-solid fa-hourglass-half"></i></div>' +
        '<div><div class="cb-summary-label">Pending Verification</div><div class="cb-summary-value">' + money(pending) + '</div></div></div>' +
      '<div class="cb-summary-card"><div class="cb-summary-icon"><i class="fa-solid fa-circle-check"></i></div>' +
        '<div><div class="cb-summary-label">Total Paid</div><div class="cb-summary-value">' + money(paid) + '</div></div></div>';
  }

  // ------------------------------------------------------------------
  // invoice list
  // ------------------------------------------------------------------

  function invoiceRow(D, inv) {
    var info = D.getInvoiceDisplayInfo(inv);
    var icon = D.SPECIES_ICON[info.species] || '<i class="fa-solid fa-paw"></i>';
    return (
      '<div class="cb-inv-row" data-id="' + esc(inv.id) + '">' +
        '<div class="cb-inv-when">' +
          '<div class="cb-inv-number">' + esc(inv.invoiceNumber) + '</div>' +
          '<div class="cb-inv-date">' + fmtDate(D, inv.date) + '</div>' +
        '</div>' +
        '<div class="cb-inv-main">' +
          '<div class="cb-inv-pet"><span class="species-icon">' + icon + '</span>' + esc(info.pet) + '</div>' +
          '<div class="cb-inv-meta">' +
            (info.appointmentReason ? '<span><i class="fa-solid fa-file-lines"></i> ' + esc(info.appointmentReason) + '</span>' : '') +
            '<span><i class="fa-solid fa-list"></i> ' + (inv.items || []).length + ' item' + ((inv.items || []).length === 1 ? '' : 's') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="cb-inv-right">' +
          '<div class="cb-inv-amount">' + money(inv.totalAmount) + '</div>' +
          statusBadge(inv.status) +
        '</div>' +
      '</div>'
    );
  }

  function renderInvoiceList(D, invoices) {
    var box = document.getElementById('invoice-list');
    box.innerHTML = invoices.length
      ? invoices.map(function (inv) { return invoiceRow(D, inv); }).join('')
      : '<div class="empty-note">No billing records yet. Invoices appear here once the clinic bills a completed appointment.</div>';
  }

  // ------------------------------------------------------------------
  // invoice detail overlay
  // ------------------------------------------------------------------

  function itemsTable(items) {
    var rows = (items || []).map(function (it) {
      var subtotal = (Number(it.qty) || 0) * (Number(it.unitPrice) || 0);
      return '<tr>' +
        '<td>' + esc(it.name) + '<div class="cb-item-type">' + esc(it.type) + '</div></td>' +
        '<td>' + esc(it.qty) + '</td>' +
        '<td>' + money(it.unitPrice) + '</td>' +
        '<td>' + money(subtotal) + '</td>' +
        '</tr>';
    }).join('');
    return '<table class="cb-items-table"><thead><tr><th>Item</th><th>Qty</th><th>Unit Price</th><th>Subtotal</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function paymentHistoryHtml(D, payments) {
    if (!payments.length) return '<div class="empty-note">No payments submitted yet.</div>';
    var labels = D.PAYMENT_METHOD_LABELS || {};
    return payments.map(function (p) {
      return '<div class="cb-pay-hist-row">' +
        '<div><strong>' + esc(labels[p.method] || p.method) + '</strong> \u00b7 ' + money(p.amount) + ' \u00b7 ' + fmtDate(D, p.paymentDate) + '</div>' +
        '<div class="cb-dim">Ref: ' + esc(p.referenceNumber || '\u2014') + ' \u00b7 ' + esc(PAYMENT_STATUS_LABELS[p.status] || p.status) +
          (p.status === 'rejected' && p.reviewNotes ? ' \u2014 ' + esc(p.reviewNotes) : '') +
        '</div>' +
      '</div>';
    }).join('');
  }

  function openDetailOverlay(D, client, invoiceId) {
    var inv = findOwnedInvoice(D, client, invoiceId);
    if (!inv) { showToast('That invoice could not be found for this account'); return; }
    currentInvoiceId = inv.id;

    var info = D.getInvoiceDisplayInfo(inv);
    var payments = D.getPaymentsForInvoice(inv.id);

    document.getElementById('detail-title').textContent = 'Invoice ' + inv.invoiceNumber;
    document.getElementById('detail-body').innerHTML =
      '<div class="cb-detail-grid">' +
        '<div><div class="cb-detail-label">Status</div><div class="cb-detail-value">' + statusBadge(inv.status) + '</div></div>' +
        '<div><div class="cb-detail-label">Invoice Date</div><div class="cb-detail-value">' + fmtDate(D, inv.date) + '</div></div>' +
        '<div><div class="cb-detail-label">Pet</div><div class="cb-detail-value">' + esc(info.pet) + '</div></div>' +
        '<div><div class="cb-detail-label">Related Appointment</div><div class="cb-detail-value">' + esc(info.appointmentReason || '\u2014') + (info.appointmentDate ? ' (' + fmtDate(D, info.appointmentDate) + ')' : '') + '</div></div>' +
      '</div>' +
      itemsTable(inv.items) +
      '<div class="cb-total-row">Total: <span>' + money(inv.totalAmount) + '</span></div>' +
      (inv.notes ? '<div class="cb-detail-label" style="margin-top:10px;">Notes</div><div class="cb-detail-value" style="font-weight:600;">' + esc(inv.notes) + '</div>' : '') +
      '<div class="cb-section-label">Payment History</div>' +
      paymentHistoryHtml(D, payments);

    var canPay = inv.status !== 'paid' && inv.status !== 'pending-verification' && !D.getPendingPaymentForInvoice(inv.id);
    var footer = document.getElementById('detail-footer');
    if (canPay) {
      footer.innerHTML = '<button class="btn" id="detail-close-btn">Close</button><button class="btn btn-primary" id="detail-pay-btn"><i class="fa-solid fa-money-check-dollar"></i> Submit Payment</button>';
      document.getElementById('detail-pay-btn').addEventListener('click', function () {
        closeDetailOverlay();
        openPayOverlay(D, client, inv.id);
      });
    } else if (inv.status === 'pending-verification') {
      footer.innerHTML = '<div class="cb-hint" style="margin:0;"><i class="fa-solid fa-circle-info"></i> A payment for this invoice is awaiting Administrator verification.</div><button class="btn" id="detail-close-btn">Close</button>';
    } else if (inv.status === 'paid') {
      footer.innerHTML = '<div class="cb-hint" style="margin:0;"><i class="fa-solid fa-circle-check"></i> This invoice has been paid in full.</div><button class="btn" id="detail-close-btn">Close</button>';
    } else {
      footer.innerHTML = '<button class="btn" id="detail-close-btn">Close</button>';
    }
    document.getElementById('detail-close-btn').addEventListener('click', closeDetailOverlay);

    document.getElementById('detail-overlay').classList.add('open');
  }

  function closeDetailOverlay() {
    document.getElementById('detail-overlay').classList.remove('open');
    currentInvoiceId = null;
  }

  // ------------------------------------------------------------------
  // submit payment overlay — always goes through PCData.submitPayment(),
  // which always lands the payment (and the invoice) on
  // 'pending-verification'. This file never calls verifyPayment() /
  // rejectPayment() and never writes status: 'paid' itself.
  // ------------------------------------------------------------------

  function syncPayFieldsForMethod() {
    var method = document.getElementById('p-method').value;
    var showExtra = method !== 'cash';
    document.getElementById('p-ref-row').style.display = showExtra ? '' : 'none';
    document.getElementById('p-proof-row').style.display = showExtra ? '' : 'none';
  }

  function openPayOverlay(D, client, invoiceId) {
    var inv = findOwnedInvoice(D, client, invoiceId);
    if (!inv) { showToast('That invoice could not be found for this account'); return; }
    if (inv.status === 'paid') { showToast('This invoice is already paid'); return; }
    if (inv.status === 'pending-verification' || D.getPendingPaymentForInvoice(inv.id)) {
      showToast('A payment for this invoice is already awaiting verification');
      return;
    }

    var info = D.getInvoiceDisplayInfo(inv);
    document.getElementById('pay-invoice-preview').innerHTML =
      '<div class="book-field-hint" style="margin-bottom:8px;font-size:12.6px;">' +
      '<i class="fa-solid fa-file-invoice"></i> ' + esc(inv.invoiceNumber) + ' \u00b7 ' + esc(info.pet) + ' \u00b7 Amount due: <strong>' + money(inv.totalAmount) + '</strong>' +
      '</div>';

    var methodLabels = D.PAYMENT_METHOD_LABELS || {};
    var methodSel = document.getElementById('p-method');
    methodSel.innerHTML = (D.PAYMENT_METHODS || []).map(function (m) {
      return '<option value="' + esc(m) + '">' + esc(methodLabels[m] || m) + '</option>';
    }).join('');

    document.getElementById('p-amount').value = inv.totalAmount;
    document.getElementById('p-ref').value = '';
    document.getElementById('p-date').value = D.todayStr();
    document.getElementById('p-date').max = D.todayStr();
    document.getElementById('p-proof').value = '';
    document.getElementById('p-notes').value = '';
    syncPayFieldsForMethod();

    document.getElementById('pay-overlay').dataset.invoiceId = inv.id;
    document.getElementById('pay-overlay').classList.add('open');
  }

  function closePayOverlay() {
    document.getElementById('pay-overlay').classList.remove('open');
    delete document.getElementById('pay-overlay').dataset.invoiceId;
  }

  function savePayment(D, client) {
    var invoiceId = document.getElementById('pay-overlay').dataset.invoiceId;
    // Defense-in-depth: re-verify ownership again right before writing,
    // not just when the modal was opened.
    var inv = findOwnedInvoice(D, client, invoiceId);
    if (!inv) { showToast('That invoice could not be found for this account'); closePayOverlay(); return; }

    var method = document.getElementById('p-method').value;
    var amount = Number(document.getElementById('p-amount').value) || 0;
    var ref = document.getElementById('p-ref').value.trim();
    var date = document.getElementById('p-date').value || D.todayStr();
    var notes = document.getElementById('p-notes').value;
    var fileInput = document.getElementById('p-proof');
    var proofName = fileInput && fileInput.files && fileInput.files[0] ? fileInput.files[0].name : '';

    if (amount <= 0) { showToast('Enter a valid amount'); return; }
    if (method !== 'cash' && !ref) { showToast('Enter a reference / transaction number'); return; }

    var payment = D.submitPayment(inv.id, {
      method: method,
      amount: amount,
      referenceNumber: ref,
      paymentDate: date,
      proofName: proofName,
      notes: notes,
      submittedBy: client.name || 'Pet Owner'
    });

    closePayOverlay();
    if (!payment) {
      showToast('This invoice can no longer accept a new payment submission');
    } else {
      showToast('Payment submitted \u2014 awaiting clinic verification');
    }
  }

  // ------------------------------------------------------------------
  // wiring
  // ------------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    // Bounces to client-login.html automatically if there's no valid
    // session — everything below only runs for an authenticated Client.
    var client = window.PCClientAuth.requireClientLogin();
    if (!client) return;

    var D = window.PCData;

    function renderDynamic() {
      var invoices = getInvoicesForClient(D, client);
      renderSummary(D, invoices);
      renderInvoiceList(D, invoices);

      // Keep an open detail overlay in sync (e.g. Administrator verifies
      // the payment in another tab while this client is looking at it).
      if (currentInvoiceId) {
        var still = findOwnedInvoice(D, client, currentInvoiceId);
        if (still) openDetailOverlay(D, client, currentInvoiceId);
        else closeDetailOverlay();
      }
    }

    renderSidebarFooter(client);
    renderDynamic();

    document.getElementById('invoice-list').addEventListener('click', function (e) {
      var row = e.target.closest('.cb-inv-row');
      if (!row) return;
      openDetailOverlay(D, client, row.getAttribute('data-id'));
    });

    document.getElementById('detail-close').addEventListener('click', closeDetailOverlay);
    document.getElementById('detail-overlay').addEventListener('click', function (e) {
      if (e.target === document.getElementById('detail-overlay')) closeDetailOverlay();
    });

    document.getElementById('pay-close').addEventListener('click', closePayOverlay);
    document.getElementById('pay-cancel').addEventListener('click', closePayOverlay);
    document.getElementById('pay-overlay').addEventListener('click', function (e) {
      if (e.target === document.getElementById('pay-overlay')) closePayOverlay();
    });
    document.getElementById('p-method').addEventListener('change', syncPayFieldsForMethod);
    document.getElementById('pay-save').addEventListener('click', function () { savePayment(D, client); });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (document.getElementById('pay-overlay').classList.contains('open')) closePayOverlay();
      else if (document.getElementById('detail-overlay').classList.contains('open')) closeDetailOverlay();
    });

    document.getElementById('logout-btn').addEventListener('click', function (e) {
      e.preventDefault();
      window.PCClientAuth.logoutClient();
    });

    // Keep billing live if data changes elsewhere — e.g. an
    // Administrator verifies/rejects a payment or creates a new
    // invoice on the admin Billing page in another tab, exactly like
    // every other Client page's D.onChange() wiring.
    D.onChange(renderDynamic);
  });
})();