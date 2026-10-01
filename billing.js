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

  var state = {
    search: '',
    statusFilter: '',
    tab: 'invoices'
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

  function statusBadge(status) {
    return '<span class="bl-badge bl-badge--' + status + '">' + esc(INVOICE_STATUS_LABELS[status] || status) + '</span>';
  }

  function paymentStatusBadge(status) {
    return '<span class="bl-badge bl-badge--pay-' + status + '">' + esc(PAYMENT_STATUS_LABELS[status] || status) + '</span>';
  }

  // ------------------------------------------------------------------
  // render
  // ------------------------------------------------------------------

  function render() {
    renderSummary();
    renderTabs();
    if (state.tab === 'invoices') renderInvoiceTable();
    else renderVerificationList();
  }

  // Phase 3F-visual-correction: matches Appointments' summaryMetric()
  // markup/classes (label + small right-aligned icon on top, then a
  // large value, then a muted description) — see appointments.js —
  // just under the bl-prefixed names since these styles live in
  // billing.html, not style.css. `primary` marks Outstanding as the
  // lead card (dark-teal treatment, matching Appointments' "Today's
  // Appointments" lead card) — visual only, same as before.
  function summaryCard(icon, label, value, desc, primary) {
    return '<div class="bl-metric' + (primary ? ' bl-metric-primary' : '') + '">' +
      '<div class="bl-metric-head">' +
      '<div class="bl-metric-label">' + esc(label) + '</div>' +
      '<i class="fa-solid ' + icon + ' bl-metric-icon"></i>' +
      '</div>' +
      '<div class="bl-metric-value">' + value + '</div>' +
      '<div class="bl-metric-desc">' + esc(desc) + '</div>' +
      '</div>';
  }

  // Exactly the four Billing summary cards, in this order: Outstanding
  // (now the primary/lead card, visually), Pending Verification, Total
  // Revenue, Paid Invoices. Each card's supporting text is derived from
  // the same number as its main value (see getBillingSummary's comment
  // in billing-data-store.js). Data/calculations unchanged.
  function renderSummary() {
    var s = D.getBillingSummary();
    document.getElementById('bl-summary-grid').innerHTML =
      summaryCard('fa-file-invoice-dollar', 'Outstanding', money(s.outstanding),
        s.outstandingCount + ' invoice' + (s.outstandingCount === 1 ? '' : 's'), true) +
      summaryCard('fa-hourglass-half', 'Pending Verification', money(s.pendingVerification),
        s.pendingVerificationCount + ' awaiting review') +
      summaryCard('fa-sack-dollar', 'Total Revenue', money(s.totalRevenue),
        s.totalRevenueCount + ' paid invoice' + (s.totalRevenueCount === 1 ? '' : 's')) +
      summaryCard('fa-circle-check', 'Paid Invoices', String(s.paidCount),
        money(s.paidTotal) + ' collected');
  }

  function renderTabs() {
    document.querySelectorAll('.bl-tab').forEach(function (t) {
      var isActive = t.getAttribute('data-tab') === state.tab;
      t.classList.toggle('active', isActive);
      t.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    document.getElementById('bl-panel-invoices').style.display = state.tab === 'invoices' ? '' : 'none';
    document.getElementById('bl-panel-verification').style.display = state.tab === 'verification' ? '' : 'none';
    var pendingCount = D.getPendingVerifications().length;
    document.getElementById('bl-pending-count').textContent = pendingCount ? String(pendingCount) : '';
  }

  function matchesFilters(invoice, info) {
    if (state.statusFilter && invoice.status !== state.statusFilter) return false;
    if (!state.search) return true;
    var q = state.search.trim().toLowerCase();
    if (!q) return true;
    return (invoice.invoiceNumber || '').toLowerCase().indexOf(q) > -1 ||
      (info.owner || '').toLowerCase().indexOf(q) > -1 ||
      (info.pet || '').toLowerCase().indexOf(q) > -1;
  }

  function renderInvoiceTable() {
    var tbody = document.getElementById('bl-invoice-tbody');
    var invoices = D.getInvoices().slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
    var matchCount = 0;

    var rows = invoices.map(function (inv) {
      var info = D.getInvoiceDisplayInfo(inv);
      if (!matchesFilters(inv, info)) return '';
      matchCount++;
      var canRecordPayment = inv.status !== 'paid' && inv.status !== 'pending-verification';
      return '<tr>' +
        '<td class="bl-mono">' + esc(inv.invoiceNumber) + '</td>' +
        '<td>' + esc(info.owner) + '</td>' +
        '<td>' + esc(info.pet) + '</td>' +
        '<td>' + esc(info.appointmentReason || '\u2014') + (info.appointmentDate ? ' <span class="bl-dim">(' + esc(fmtDate(info.appointmentDate)) + ')</span>' : '') + '</td>' +
        '<td>' + money(inv.totalAmount) + '</td>' +
        '<td>' + statusBadge(inv.status) + '</td>' +
        '<td>' + esc(fmtDate(inv.date)) + '</td>' +
        '<td class="bl-actions">' +
        '<button class="bl-icon-btn" data-action="view" data-id="' + inv.id + '" title="View Invoice"><i class="fa-solid fa-eye"></i></button>' +
        (canRecordPayment ? '<button class="bl-icon-btn" data-action="pay" data-id="' + inv.id + '" title="Record Payment"><i class="fa-solid fa-money-check-dollar"></i></button>' : '') +
        '</td>' +
        '</tr>';
    }).filter(Boolean).join('');

    tbody.innerHTML = rows || '<tr><td colspan="8" class="bl-empty">No invoices match.</td></tr>';

    var countEl = document.getElementById('bl-count');
    if (countEl) countEl.textContent = matchCount + ' invoice' + (matchCount === 1 ? '' : 's');
  }

  // Phase 3E: one labeled field per value (Invoice #, Client, Pet,
  // Method, Amount, Submitted) instead of two freeform lines. `value`
  // is inserted as-is (callers pass already-esc()'d/formatted markup),
  // matching the money()/esc() calls at each call site below.
  function verifyField(label, value, extraClass) {
    return '<div class="bl-verify-field' + (extraClass ? ' ' + extraClass : '') + '">' +
      '<div class="bl-verify-field-label">' + esc(label) + '</div>' +
      '<div class="bl-verify-field-value">' + value + '</div>' +
      '</div>';
  }

  function renderVerificationList() {
    var wrap = document.getElementById('bl-verify-list');
    var pending = D.getPendingVerifications();
    if (!pending.length) {
      wrap.innerHTML = '<p class="bl-empty-note">No payments are awaiting verification.</p>';
      return;
    }
    wrap.innerHTML = pending.map(function (p) {
      var inv = D.getInvoiceById(p.invoiceId);
      var info = inv ? D.getInvoiceDisplayInfo(inv) : null;
      // Amount is the PAYMENT record's own amount (p.amount), never the
      // invoice's totalAmount — a payment can be partial, and this list
      // operates on payment records (see Phase 3E spec item 8).
      return '<div class="bl-verify-row">' +
        '<div class="bl-verify-fields">' +
        verifyField('Invoice #', esc(inv ? inv.invoiceNumber : '\u2014')) +
        verifyField('Client', esc(info ? info.owner : '\u2014')) +
        verifyField('Pet', esc(info ? info.pet : '\u2014')) +
        verifyField('Method', esc(PAYMENT_METHOD_LABELS[p.method] || p.method)) +
        verifyField('Amount', money(p.amount), 'bl-verify-field--amount') +
        verifyField('Submitted', esc(fmtDate(p.paymentDate))) +
        '</div>' +
        '<div class="bl-verify-action"><button class="btn" data-action="review" data-id="' + p.id + '">Review</button></div>' +
        '</div>';
    }).join('');
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
    document.getElementById('bl-modal-body').innerHTML = '';
    var appShell = document.querySelector('.app-shell');
    if (appShell) appShell.removeAttribute('aria-hidden');
    if (lastFocusedEl && typeof lastFocusedEl.focus === 'function') lastFocusedEl.focus();
    lastFocusedEl = null;
  }

  // ------------------------------------------------------------------
  // New Invoice
  // ------------------------------------------------------------------

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

    var html = '' +
      '<div class="bl-form-row"><label for="bl-inv-appt">Appointment</label><select id="bl-inv-appt" class="pc-select">' + options + '</select></div>' +
      '<div class="bl-appt-preview" id="bl-inv-appt-preview"></div>' +
      '<div class="bl-items-head"><label>Line items</label>' +
      '<div class="bl-items-head-actions">' +
      '<select class="bl-service-picker pc-select" id="bl-inv-service-picker"></select>' +
      '<button type="button" class="bl-link-btn" id="bl-inv-add-service"><i class="fa-solid fa-briefcase-medical"></i> Add from service</button>' +
      '<select class="bl-service-picker pc-select" id="bl-inv-inventory-picker"></select>' +
      '<button type="button" class="bl-link-btn" id="bl-inv-add-inventory"><i class="fa-solid fa-pills"></i> Add from inventory</button>' +
      '</div></div>' +
      '<div class="bl-items-scroll" tabindex="0" role="region" aria-label="Line items, scrollable horizontally if needed">' +
      '<div class="bl-items-cols"><span>Type</span><span>Name</span><span>Qty</span><span>Unit Price</span><span class="bl-items-col-amount">Amount</span><span></span></div>' +
      '<div id="bl-inv-items"></div>' +
      '</div>' +
      '<div class="bl-form-row bl-notes-row"><label for="bl-inv-notes">Notes (optional)</label><textarea id="bl-inv-notes" rows="2"></textarea></div>' +
      '<div class="bl-form-row bl-discount-row">' +
      '<label for="bl-inv-discount">Discount</label>' +
      '<input type="number" min="0" step="0.01" id="bl-inv-discount" value="0">' +
      '<div class="bl-discount-error" id="bl-inv-discount-error" role="alert" style="display:none;"></div>' +
      '</div>' +
      '<div class="bl-inv-totals">' +
      '<div class="bl-inv-totals-row"><span>Subtotal</span><span id="bl-inv-subtotal-val">' + money(0) + '</span></div>' +
      '<div class="bl-inv-totals-row bl-inv-totals-discount" id="bl-inv-discount-row"><span>Discount</span><span id="bl-inv-discount-val">-' + money(0) + '</span></div>' +
      '<div class="bl-inv-totals-row bl-inv-totals-total"><span>Total</span><span id="bl-inv-total-val">' + money(0) + '</span></div>' +
      '</div>' +
      '<div class="bl-modal-actions"><button class="btn" id="bl-inv-cancel">Cancel</button><button class="btn btn-primary" id="bl-inv-save">Create Invoice</button></div>';

    openModal('New Invoice', html);

    var itemsState = [newItemRow()];

    function newItemRow() { return { type: 'service', name: '', qty: 1, unitPrice: 0, serviceId: null, inventoryItemId: null }; }

    // Single source of truth for "which active Services/Medicines exist
    // right now" — used by BOTH the header quick-add pickers below and
    // each row's own Name dropdown, so there is only one place reading
    // D.getActiveServices()/D.getInventory() rather than two copies of
    // the same filter/sort.
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

    // Lets the invoice pull a Service's CURRENT price as a starting line
    // item. getServicePriceSnapshot() copies the value at add-time onto
    // the item (serviceId is kept only for reference) — a later change to
    // the Service's price never retroactively changes this invoice.
    function populateServicePicker() {
      var picker = document.getElementById('bl-inv-service-picker');
      var addBtn = document.getElementById('bl-inv-add-service');
      if (typeof D.getActiveServices !== 'function') {
        picker.innerHTML = '';
        picker.style.display = 'none';
        addBtn.style.display = 'none';
        return;
      }
      var services = getServiceOptionsList();
      if (!services.length) {
        picker.innerHTML = '<option value="">No services available</option>';
        addBtn.disabled = true;
        return;
      }
      picker.innerHTML = services.map(function (s) {
        return '<option value="' + s.id + '">' + esc(s.name) + ' \u2014 ' + money(s.price) + '</option>';
      }).join('');
      addBtn.disabled = false;
    }

    // Lets the invoice pull an Inventory item's CURRENT unit price as a
    // starting line item. data-store.js has no getActiveInventory()/
    // snapshot helper (unlike Services), so the active-only filter and
    // the name/price copy happen here. The copy is at add-time only —
    // inventoryItemId is kept just for reference, and no stock quantity
    // is touched by adding or saving an invoice.
    function populateInventoryPicker() {
      var picker = document.getElementById('bl-inv-inventory-picker');
      var addBtn = document.getElementById('bl-inv-add-inventory');
      if (typeof D.getInventory !== 'function') {
        picker.innerHTML = '';
        picker.style.display = 'none';
        addBtn.style.display = 'none';
        return;
      }
      var items = getMedicineOptionsList();
      if (!items.length) {
        picker.innerHTML = '<option value="">No inventory items available</option>';
        addBtn.disabled = true;
        return;
      }
      picker.innerHTML = items.map(function (i) {
        return '<option value="' + i.id + '">' + esc(i.name) + ' \u2014 ' + money(i.unitPrice) + '</option>';
      }).join('');
      addBtn.disabled = false;
    }

    // Line items on the New Invoice modal now come from exactly two
    // sources — Service and Medicine — so the Type dropdown here is
    // scoped to just those two, independent of billing-data-store.js's
    // own INVOICE_ITEM_TYPES (which still includes the legacy 'other'
    // value; that file is read-only and untouched, and any already-saved
    // invoice with an 'other' item still displays exactly as before in
    // View Invoice/Print Invoice — this only affects what a NEW invoice
    // can be built from).
    var NEW_ITEM_TYPES = ['service', 'medicine'];

    // Name is the primary field of a line item. The workflow bills an
    // EXISTING clinic service/inventory item — not an arbitrary typed
    // string — so Name is always a dropdown of the current Type's active
    // items (same data getServiceOptionsList()/getMedicineOptionsList()
    // already expose to the header quick-add pickers, not a second copy
    // of it). It's a plain .pc-select — same component as Type, the
    // Appointment selector, and the "All Statuses" filter dropdown.
    function nameFieldHtml(it) {
      if (it.type === 'service') {
        var services = getServiceOptionsList();
        if (!services.length) {
          return '<select class="bl-item-name-select pc-select" disabled><option value="">No services available</option></select>';
        }
        var svcOpts = '<option value=""' + (it.serviceId ? '' : ' selected') + ' disabled>Select service\u2026</option>' +
          services.map(function (s) {
            return '<option value="' + s.id + '"' + (it.serviceId === s.id ? ' selected' : '') + '>' + esc(s.name) + ' \u2014 ' + money(s.price) + '</option>';
          }).join('');
        return '<select class="bl-item-name-select pc-select">' + svcOpts + '</select>';
      }
      var meds = getMedicineOptionsList();
      if (!meds.length) {
        return '<select class="bl-item-name-select pc-select" disabled><option value="">No medicines available</option></select>';
      }
      var medOpts = '<option value=""' + (it.inventoryItemId ? '' : ' selected') + ' disabled>Select medicine\u2026</option>' +
        meds.map(function (i) {
          return '<option value="' + i.id + '"' + (it.inventoryItemId === i.id ? ' selected' : '') + '>' + esc(i.name) + ' \u2014 ' + money(i.unitPrice) + '</option>';
        }).join('');
      return '<select class="bl-item-name-select pc-select">' + medOpts + '</select>';
    }

    // Unit Price always comes from the selected Service/Medicine now (no
    // free-text item type left to type a price into), so it's always
    // shown read-only rather than as an editable-looking field.
    function priceFieldHtml(it) {
      return '<input type="number" min="0" step="0.01" class="bl-item-price bl-item-price--readonly" value="' + it.unitPrice + '" readonly aria-readonly="true">';
    }

    function renderItemRows() {
      var wrap = document.getElementById('bl-inv-items');
      wrap.innerHTML = itemsState.map(function (it, idx) {
        return '<div class="bl-item-row" data-idx="' + idx + '">' +
          '<select class="bl-item-type pc-select">' + NEW_ITEM_TYPES.map(function (t) {
            return '<option value="' + t + '"' + (t === it.type ? ' selected' : '') + '>' + t.charAt(0).toUpperCase() + t.slice(1) + '</option>';
          }).join('') + '</select>' +
          nameFieldHtml(it) +
          '<input type="number" min="0" step="1" class="bl-item-qty" value="' + it.qty + '">' +
          priceFieldHtml(it) +
          '<div class="bl-item-subtotal">' + money(it.qty * it.unitPrice) + '</div>' +
          '<button type="button" class="bl-icon-btn bl-item-remove" title="Remove item"><i class="fa-solid fa-trash"></i></button>' +
          '</div>';
      }).join('');

      wrap.querySelectorAll('.bl-item-row').forEach(function (row) {
        var idx = Number(row.getAttribute('data-idx'));

        // Changing Type invalidates whatever was selected/typed for Name
        // under the old type (a Service id means nothing once Type is
        // Medicine, and vice versa), so Name/price/reference ids reset
        // and the row re-renders with the new type's own Name options.
        // Quantity is left as-is — it isn't tied to which type is billed.
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

        // Name is always the type-scoped dropdown now (Service or
        // Medicine); selecting an option copies that item's current
        // name/price onto the row, same as the header quick-add buttons.
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
        // Unit Price is read-only (populated from the selected Service/
        // Medicine only) — no input listener needed for it anymore.
        row.querySelector('.bl-item-remove').addEventListener('click', function () {
          if (itemsState.length === 1) return; // always keep at least one row
          itemsState.splice(idx, 1);
          renderItemRows();
          updateTotals();
        });
      });
    }

    // Reads/validates the discount input in place (doesn't re-render the
    // field itself) and toggles the inline error + Save button together,
    // so a live keystroke can't leave a bad discount silently accepted.
    // An empty field is treated as 0 (valid), matching "Default: 0."
    function readDiscountInput() {
      var input = document.getElementById('bl-inv-discount');
      var errorEl = document.getElementById('bl-inv-discount-error');
      var saveBtn = document.getElementById('bl-inv-save');
      var raw = input.value.trim();

      if (raw === '') {
        errorEl.style.display = 'none';
        saveBtn.disabled = false;
        return { value: 0, valid: true };
      }
      var num = Number(raw);
      if (isNaN(num) || num < 0) {
        errorEl.textContent = 'Enter a discount amount of \u20B10.00 or more.';
        errorEl.style.display = '';
        saveBtn.disabled = true;
        return { value: 0, valid: false };
      }
      errorEl.style.display = 'none';
      saveBtn.disabled = false;
      return { value: num, valid: true };
    }

    // Subtotal/total math is delegated to the same PCData helpers Phase
    // 3B added (calcInvoiceSubtotal/calcFinalTotal) rather than
    // reimplementing the sum-and-floor logic here a second time.
    // Phase 3J: zero discount now displays as a neutral ₱0.00 (no leading
    // "-", no red styling), matching View Invoice's same treatment --
    // discountState.value / the calculation itself is untouched, this
    // only toggles the row's display class and text.
    function updateTotals() {
      var subtotal = D.calcInvoiceSubtotal(itemsState);
      var discountState = readDiscountInput();
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

    function renderApptPreview() {
      var apptId = document.getElementById('bl-inv-appt').value;
      var appt = D.getById(apptId);
      if (!appt) return;
      var info = getApptInfo(appt);
      document.getElementById('bl-inv-appt-preview').innerHTML =
        '<div class="bl-inv-detail-grid">' +
        '<div><div class="bl-dim">Client</div><div>' + esc(info.owner) + '</div></div>' +
        '<div><div class="bl-dim">Pet</div><div>' + esc(info.pet) + (info.species ? ' <span class="bl-dim">(' + esc(info.species) + ')</span>' : '') + '</div></div>' +
        '<div><div class="bl-dim">Veterinarian</div><div>' + esc(info.vet || '\u2014') + '</div></div>' +
        '<div><div class="bl-dim">Reason for visit</div><div>' + esc(info.reason || '\u2014') + '</div></div>' +
        '</div>';
    }

    renderItemRows();
    updateTotals();
    renderApptPreview();
    populateServicePicker();
    populateInventoryPicker();

    document.getElementById('bl-inv-appt').addEventListener('change', renderApptPreview);
    document.getElementById('bl-inv-discount').addEventListener('input', updateTotals);
    document.getElementById('bl-inv-add-service').addEventListener('click', function () {
      var serviceId = document.getElementById('bl-inv-service-picker').value;
      if (!serviceId) return;
      var snap = D.getServicePriceSnapshot(serviceId);
      if (!snap) return;
      // Replace a still-blank first row instead of leaving an empty one above it.
      if (itemsState.length === 1 && !itemsState[0].name.trim() && itemsState[0].unitPrice === 0) {
        itemsState[0] = { type: 'service', name: snap.name, qty: 1, unitPrice: snap.price, serviceId: snap.serviceId, inventoryItemId: null };
      } else {
        itemsState.push({ type: 'service', name: snap.name, qty: 1, unitPrice: snap.price, serviceId: snap.serviceId, inventoryItemId: null });
      }
      renderItemRows();
      updateTotals();
    });
    document.getElementById('bl-inv-add-inventory').addEventListener('click', function () {
      var inventoryItemId = document.getElementById('bl-inv-inventory-picker').value;
      if (!inventoryItemId) return;
      var item = D.getInventoryById(inventoryItemId);
      if (!item) return;
      // Copy name/price at add-time only, same as the Services picker —
      // this never reads or changes item.quantity (no stock deduction here).
      var newRow = { type: 'medicine', name: item.name, qty: 1, unitPrice: item.unitPrice, serviceId: null, inventoryItemId: item.id };
      if (itemsState.length === 1 && !itemsState[0].name.trim() && itemsState[0].unitPrice === 0) {
        itemsState[0] = newRow;
      } else {
        itemsState.push(newRow);
      }
      renderItemRows();
      updateTotals();
    });
    document.getElementById('bl-inv-cancel').addEventListener('click', closeModal);
    document.getElementById('bl-inv-save').addEventListener('click', function () {
      var apptId = document.getElementById('bl-inv-appt').value;
      var appt = D.getById(apptId);
      if (!appt) { closeModal(); return; }
      // Guard against a race where this appointment got invoiced from
      // another tab while this modal was open.
      if (D.getInvoiceForAppointment(appt.id)) {
        alert('This appointment already has an invoice.');
        closeModal();
        render();
        return;
      }
      var discountState = readDiscountInput();
      if (!discountState.valid) return; // inline error already shown, Save is disabled too

      var cleanItems = itemsState
        .filter(function (it) { return it.name.trim() && it.qty > 0; })
        .map(function (it, i) { return { id: 'i' + (i + 1), type: it.type, name: it.name.trim(), qty: it.qty, unitPrice: it.unitPrice, serviceId: it.serviceId || null, inventoryItemId: it.inventoryItemId || null }; });
      if (!cleanItems.length) { alert('Add at least one line item with a name and quantity.'); return; }

      // appointmentId/patientId/clientId/items/notes flow through exactly
      // as before; discount is the only new field passed in — vet is
      // resolved from the appointment inside D.addInvoice() itself
      // (Phase 3B), never invented here.
      D.addInvoice({
        appointmentId: appt.id,
        patientId: appt.patientId,
        clientId: appt.clientId,
        items: cleanItems,
        discount: discountState.value,
        notes: document.getElementById('bl-inv-notes').value
      });
      closeModal();
      state.tab = 'invoices';
      render();
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

  function openViewInvoiceModal(id) {
    var inv = D.getInvoiceById(id);
    if (!inv) return;
    var info = D.getInvoiceDisplayInfo(inv);
    var payments = D.getPaymentsForInvoice(id);

    var itemsHtml = (inv.items || []).map(function (it) {
      return '<tr><td>' + esc(it.type) + '</td><td>' + esc(it.name) + '</td><td>' + it.qty + '</td><td>' + money(it.unitPrice) + '</td><td>' + money(it.qty * it.unitPrice) + '</td></tr>';
    }).join('');

    var paymentsHtml = payments.length ? payments.map(function (p) {
      return '<div class="bl-payment-hist-row">' +
        '<div class="bl-payment-hist-head">' + paymentStatusBadge(p.status) + '<span class="bl-payment-hist-amount">' + money(p.amount) + '</span></div>' +
        '<div class="bl-payment-hist-line">' + esc(PAYMENT_METHOD_LABELS[p.method] || p.method) + '</div>' +
        '<div class="bl-payment-hist-line bl-dim">' + esc(fmtDate(p.paymentDate)) + '</div>' +
        '<div class="bl-payment-hist-line bl-dim">' + 'Reference No.: ' + esc(p.referenceNumber || 'No reference') + '</div>' +
        '</div>';
    }).join('') : '<p class="bl-empty-note">No payments submitted yet.</p>';

    // Appointment date/time as one line; falls back gracefully when either
    // half is missing (e.g. an invoice whose appointment no longer resolves).
    var apptWhen = [fmtDate(info.appointmentDate), info.appointmentTime].filter(Boolean).join(' \u00b7 ') || '\u2014';
    // Vet: Phase 3B/3D already resolve this from the live appointment or
    // the invoice's own denormalized snapshot; if genuinely neither exists,
    // show a neutral placeholder rather than inventing one.
    var vetDisplay = info.vet || 'Not assigned';

    var html = '' +
      '<div class="bl-inv-detail-head">' +
      '<div><div class="bl-dim" style="color:var(--ink-soft)">Invoice #</div><div class="bl-strong">' + esc(inv.invoiceNumber) + '</div></div>' +
      '<div><div class="bl-dim">Status</div>' + statusBadge(inv.status) + '</div>' +
      '<div><div class="bl-dim" style="color:var(--ink-soft)">Invoice Date</div><div>' + esc(fmtDate(inv.date)) + '</div></div>' +
      '</div>' +
      '<div class="bl-section-label">' + viewIco('user') + 'Client &amp; Pet</div>' +
      '<div class="bl-inv-detail-grid">' +
      '<div><div class="bl-dim" style="color:var(--ink-soft)">Client</div><div>' + esc(info.owner) + '</div></div>' +
      '<div><div class="bl-dim" style="color:var(--ink-soft)">Pet</div><div>' + esc(info.pet) + (info.species ? ' <span class="bl-dim">(' + esc(info.species) + ')</span>' : '') + '</div></div>' +
      '</div>' +
      '<div class="bl-section-label">' + viewIco('calendar-days') + 'Appointment</div>' +
      '<div class="bl-inv-detail-grid">' +
      '<div><div class="bl-dim" style="color:var(--ink-soft)">Date / Time</div><div>' + esc(apptWhen) + '</div></div>' +
      '<div><div class="bl-dim" style="color:var(--ink-soft)">Reason for visit</div><div>' + esc(info.appointmentReason || '\u2014') + '</div></div>' +
      '<div><div class="bl-dim" style="color:var(--ink-soft)">Veterinarian</div><div>' + esc(vetDisplay) + '</div></div>' +
      '</div>' +
      '<div class="bl-section-label">' + viewIco('briefcase-medical') + 'Line items</div>' +
      '<div class="bl-items-scroll" tabindex="0" role="region" aria-label="Line items, scrollable horizontally if needed">' +
      '<table class="bl-mini-table"><thead><tr><th>Type</th><th>Item</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead><tbody>' + itemsHtml + '</tbody></table>' +
      '</div>' +
      '<div class="bl-inv-totals">' +
      '<div class="bl-inv-totals-row"><span>Subtotal</span><span>' + money(info.subtotal) + '</span></div>' +
      // Zero discount reads as a neutral ₱0.00 (no leading "-", no red
      // styling) rather than "-₱0.00" -- info.discount itself is untouched,
      // this only changes how the View Invoice modal displays it.
      (info.discount > 0 ?
        '<div class="bl-inv-totals-row bl-inv-totals-discount"><span>Discount</span><span>-' + money(info.discount) + '</span></div>' :
        '<div class="bl-inv-totals-row"><span>Discount</span><span>' + money(0) + '</span></div>') +
      '<div class="bl-inv-totals-row bl-inv-totals-total"><span>Total</span><span>' + money(inv.totalAmount) + '</span></div>' +
      '</div>' +
      (inv.notes ? '<div class="bl-form-row"><label>Notes</label><div>' + esc(inv.notes) + '</div></div>' : '') +
      '<div class="bl-section-label" style="margin-top:22px">' + viewIco('credit-card') + 'Payment history</div>' + paymentsHtml +
      // Phase 3H: sole entry point into the print/receipt flow -- prints
      // whichever invoice is currently open, so there's never a manual
      // invoice-number step. Reuses the existing .bl-modal-actions/.btn
      // btn-primary styling (same as New Invoice) rather than introducing
      // a new button treatment.
      '<div class="bl-modal-actions"><button class="btn btn-primary" id="bl-inv-print-btn"><i class="fa-solid fa-print"></i> Print Invoice</button></div>';

    openModal('Invoice ' + inv.invoiceNumber, html);
    document.getElementById('bl-inv-print-btn').addEventListener('click', function () {
      printInvoice(inv.id);
    });
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
          printField('Method', esc(PAYMENT_METHOD_LABELS[p.method] || p.method)) +
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
    container.innerHTML = buildPrintInvoiceHtml(inv);
    window.print();
  }

  // ------------------------------------------------------------------
  // Record Payment
  // ------------------------------------------------------------------

  function openRecordPaymentModal(id) {
    var inv = D.getInvoiceById(id);
    if (!inv) return;
    if (inv.status === 'paid') { openModal('Record Payment', '<p class="bl-empty-note">This invoice is already paid.</p>'); return; }
    if (inv.status === 'pending-verification') { openModal('Record Payment', '<p class="bl-empty-note">A payment for this invoice is already awaiting verification.</p>'); return; }

    var info = D.getInvoiceDisplayInfo(inv);

    var html = '' +
      '<div class="bl-appt-preview">' +
      '<div class="bl-preview-line"><i class="fa-solid fa-file-invoice"></i> ' + esc(inv.invoiceNumber) + ' \u00b7 ' + esc(info.owner) + ' \u00b7 ' + esc(info.pet) + '</div>' +
      '<div class="bl-preview-line"><i class="fa-solid fa-sack-dollar"></i> Amount due: ' + money(inv.totalAmount) + '</div>' +
      '</div>' +
      '<div class="bl-form-row"><label for="bl-pay-method">Payment method</label><select id="bl-pay-method">' +
      D.PAYMENT_METHODS.map(function (m) { return '<option value="' + m + '">' + esc(PAYMENT_METHOD_LABELS[m]) + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="bl-form-row"><label for="bl-pay-amount">Amount</label><input type="number" min="0" step="0.01" id="bl-pay-amount" value="' + inv.totalAmount + '"></div>' +
      '<div class="bl-form-row" id="bl-pay-ref-row"><label for="bl-pay-ref">Reference / transaction number</label><input type="text" id="bl-pay-ref" placeholder="e.g. GC-2093871"></div>' +
      '<div class="bl-form-row"><label for="bl-pay-date">Payment date</label><input type="date" id="bl-pay-date" value="' + D.todayStr() + '"></div>' +
      '<div class="bl-form-row" id="bl-pay-proof-row">' +
      '<label for="bl-pay-proof">Payment proof / receipt</label>' +
      '<input type="file" id="bl-pay-proof" accept="image/*,.pdf">' +
      '<div class="bl-proof-preview" id="bl-pay-proof-preview" style="display:none;">' +
      '<img id="bl-pay-proof-preview-img" src="" alt="Selected payment proof preview">' +
      '<div class="bl-proof-preview-meta">' +
      '<span class="bl-proof-preview-name" id="bl-pay-proof-preview-name"></span>' +
      '<button type="button" class="bl-link-btn" id="bl-pay-proof-remove">Remove</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="bl-form-row"><label for="bl-pay-notes">Notes (optional)</label><textarea id="bl-pay-notes" rows="2"></textarea></div>' +
      '<p class="bl-hint"><i class="fa-solid fa-circle-info"></i> Submitting sends this for Administrator verification \u2014 the invoice will show <strong>Pending Verification</strong> until it\u2019s reviewed, not Paid.</p>' +
      '<div class="bl-modal-actions"><button class="btn" id="bl-pay-cancel">Cancel</button><button class="btn btn-primary" id="bl-pay-save">Submit Payment</button></div>';

    openModal('Record Payment', html);

    function syncFieldsForMethod() {
      var method = document.getElementById('bl-pay-method').value;
      document.getElementById('bl-pay-ref-row').style.display = method !== 'cash' ? '' : 'none';
      document.getElementById('bl-pay-proof-row').style.display = method !== 'cash' ? '' : 'none';
    }
    syncFieldsForMethod();
    document.getElementById('bl-pay-method').addEventListener('change', syncFieldsForMethod);

    // ------------------------------------------------------------
    // Payment proof preview (Phase 3I.1)
    //
    // pendingProofDataUrl holds the base64 data: URL for a selected
    // image (jpg/png/webp only) so it can be shown immediately here
    // AND handed to submitPayment() below, so Review Payment can later
    // display that exact same image — see the file header note on why
    // this is stored at all. Non-image files (e.g. a PDF receipt) fall
    // through to the existing filename-only behavior; proofName is
    // still captured from the input at submit time either way.
    // ------------------------------------------------------------
    var PROOF_PREVIEW_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    var pendingProofDataUrl = '';
    var proofFileInput = document.getElementById('bl-pay-proof');
    var proofPreviewWrap = document.getElementById('bl-pay-proof-preview');
    var proofPreviewImg = document.getElementById('bl-pay-proof-preview-img');
    var proofPreviewName = document.getElementById('bl-pay-proof-preview-name');

    function clearProofPreview() {
      pendingProofDataUrl = '';
      proofFileInput.value = '';
      proofPreviewImg.src = '';
      proofPreviewWrap.style.display = 'none';
    }

    proofFileInput.addEventListener('change', function () {
      var file = proofFileInput.files && proofFileInput.files[0];
      if (!file) { clearProofPreview(); return; }
      if (PROOF_PREVIEW_TYPES.indexOf(file.type) === -1) {
        // Selected, but not a previewable image type — keep the current
        // empty-preview state; the filename alone still gets submitted.
        pendingProofDataUrl = '';
        proofPreviewWrap.style.display = 'none';
        return;
      }
      var reader = new FileReader();
      reader.onload = function (e) {
        pendingProofDataUrl = String(e.target.result || '');
        proofPreviewImg.src = pendingProofDataUrl;
        proofPreviewImg.alt = 'Preview of ' + file.name;
        proofPreviewName.textContent = file.name;
        proofPreviewWrap.style.display = '';
      };
      reader.readAsDataURL(file);
    });

    document.getElementById('bl-pay-proof-remove').addEventListener('click', clearProofPreview);

    document.getElementById('bl-pay-cancel').addEventListener('click', closeModal);
    document.getElementById('bl-pay-save').addEventListener('click', function () {
      var method = document.getElementById('bl-pay-method').value;
      var amount = Number(document.getElementById('bl-pay-amount').value) || 0;
      var ref = document.getElementById('bl-pay-ref').value.trim();
      var date = document.getElementById('bl-pay-date').value || D.todayStr();
      var notes = document.getElementById('bl-pay-notes').value;
      var proofName = proofFileInput.files && proofFileInput.files[0] ? proofFileInput.files[0].name : '';

      if (amount <= 0) { alert('Enter a valid amount.'); return; }
      if (method !== 'cash' && !ref) { alert('Enter a reference / transaction number.'); return; }

      var payment = D.submitPayment(inv.id, {
        method: method,
        amount: amount,
        referenceNumber: ref,
        paymentDate: date,
        proofName: proofName,
        // Phase 3I.1: same viewable image Review Payment will show later;
        // empty string for no-proof or non-previewable (e.g. PDF) proof.
        proofDataUrl: pendingProofDataUrl,
        notes: notes,
        submittedBy: isAdmin() ? 'Administrator' : 'Front Desk'
      });

      closeModal();
      if (!payment) {
        alert('This invoice can no longer accept a new payment submission — it may already be paid or already awaiting verification.');
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

  // Phase 3E: same fields as before, regrouped into PAYMENT INFORMATION /
  // SUBMISSION INFORMATION / CLIENT & PET with the amount pulled out and
  // visually emphasized above the Payment Information grid. No fields
  // added or removed, and the amount is still p.amount (the payment
  // record), never the invoice total.
  function buildProofPreviewHtml(p) {
    if (p.proofDataUrl) {
      return (
        '<button type="button" class="bl-proof-thumb-btn" id="bl-verify-proof-open" aria-label="View full-size payment proof image">' +
        '<img class="bl-proof-thumb" src="' + p.proofDataUrl + '" alt="Payment proof' + (p.proofName ? ': ' + esc(p.proofName) : '') + '">' +
        '</button>' +
        '<div class="bl-proof-filename">' + esc(p.proofName || 'Payment proof') + '</div>'
      );
    }
    if (p.proofName) {
      return '<div class="bl-proof-filename">' + esc(p.proofName) + ' <span class="bl-proof-note">(preview not available for this file type)</span></div>';
    }
    return '<p class="bl-proof-note">No payment proof attached.</p>';
  }

  // ------------------------------------------------------------
  // Payment-proof lightbox (Phase 3I.1)
  //
  // A single overlay, reused for whichever payment's proof is opened.
  // proofLightboxOpen lets setupModalShell()'s Escape/Tab handling (for
  // the Review Payment modal underneath) step aside while this is open,
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

  function openVerifyModal(paymentId) {
    var p = D.getPaymentById(paymentId);
    if (!p) return;
    var inv = D.getInvoiceById(p.invoiceId);
    var info = inv ? D.getInvoiceDisplayInfo(inv) : null;

    var html = '' +
      '<div class="bl-section-label bl-section-label--first">Payment Information</div>' +
      '<div class="bl-verify-amount-emphasis">' + money(p.amount) + '</div>' +
      '<div class="bl-inv-detail-grid">' +
      detailField('Invoice #', esc(inv ? inv.invoiceNumber : '\u2014')) +
      detailField('Payment Method', esc(PAYMENT_METHOD_LABELS[p.method] || p.method)) +
      detailField('Payment Date', esc(fmtDate(p.paymentDate))) +
      detailField('Reference #', esc(p.referenceNumber || '\u2014')) +
      '</div>' +

      '<div class="bl-section-label">Submission Information</div>' +
      '<div class="bl-inv-detail-grid">' +
      detailField('Submitted By', esc(p.submittedBy || '\u2014')) +
      '</div>' +
      '<div class="bl-proof-block">' + buildProofPreviewHtml(p) + '</div>' +
      (p.notes ? '<div class="bl-form-row"><label>Notes</label><div>' + esc(p.notes) + '</div></div>' : '') +

      '<div class="bl-section-label">Client / Pet</div>' +
      '<div class="bl-inv-detail-grid">' +
      detailField('Client', esc(info ? info.owner : '\u2014')) +
      detailField('Pet', esc(info ? info.pet : '\u2014')) +
      '</div>' +

      (isAdmin()
        ? ('<div class="bl-form-row" style="margin-top:16px;"><label for="bl-verify-notes">Review notes (optional \u2014 shown if rejected)</label><textarea id="bl-verify-notes" rows="2"></textarea></div>' +
          // Phase 3F: reuses the global .btn-danger (style.css) instead of
          // the removed page-scoped .bl-btn-danger duplicate — same red
          // treatment, one fewer place for Billing to drift out of sync.
          '<div class="bl-modal-actions"><button class="btn btn-danger" id="bl-verify-reject">Reject Payment</button><button class="btn btn-primary" id="bl-verify-accept">Verify Payment</button></div>')
        : '<p class="bl-hint"><i class="fa-solid fa-lock"></i> Only an Administrator can verify or reject this payment.</p>');

    openModal('Review Payment', html);

    var proofOpenBtn = document.getElementById('bl-verify-proof-open');
    if (proofOpenBtn) {
      proofOpenBtn.addEventListener('click', function () {
        openProofLightbox(p.proofDataUrl, 'Payment proof' + (p.proofName ? ': ' + p.proofName : '') + ', full size', proofOpenBtn);
      });
    }

    if (isAdmin()) {
      var acceptBtn = document.getElementById('bl-verify-accept');
      var rejectBtn = document.getElementById('bl-verify-reject');

      // Disable both buttons for the moment the store call takes, so a
      // fast double-click/double-tap can't fire verify/reject twice.
      // Re-enabled only on the (already-existing) already-reviewed
      // failure path — success closes the modal, so there's nothing to
      // re-enable there.
      function setProcessing(processing) {
        acceptBtn.disabled = processing;
        rejectBtn.disabled = processing;
      }

      acceptBtn.addEventListener('click', function () {
        setProcessing(true);
        var ok = D.verifyPayment(p.id, 'Administrator');
        if (!ok) {
          setProcessing(false);
          alert('This payment could not be verified — it may have already been reviewed.');
          return;
        }
        closeModal();
        render();
      });
      rejectBtn.addEventListener('click', function () {
        var reason = document.getElementById('bl-verify-notes').value;
        setProcessing(true);
        var ok = D.rejectPayment(p.id, 'Administrator', reason);
        if (!ok) {
          setProcessing(false);
          alert('This payment could not be rejected — it may have already been reviewed.');
          return;
        }
        closeModal();
        render();
      });
    }
  }

  // ------------------------------------------------------------------
  // wiring
  // ------------------------------------------------------------------

  function setupToolbar() {
    document.getElementById('bl-search').addEventListener('input', function (e) {
      state.search = e.target.value;
      renderInvoiceTable();
    });
    document.getElementById('bl-status-filter').innerHTML = '<option value="">All statuses</option>' +
      D.INVOICE_STATUSES.map(function (s) { return '<option value="' + s + '">' + esc(INVOICE_STATUS_LABELS[s]) + '</option>'; }).join('');
    document.getElementById('bl-status-filter').addEventListener('change', function (e) {
      state.statusFilter = e.target.value;
      renderInvoiceTable();
    });
    document.getElementById('bl-new-invoice-btn').addEventListener('click', openNewInvoiceModal);

    document.querySelectorAll('.bl-tab').forEach(function (t) {
      t.addEventListener('click', function () {
        state.tab = t.getAttribute('data-tab');
        render();
      });
    });
  }

  function setupTableDelegation() {
    document.getElementById('bl-invoice-tbody').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-action]');
      if (!btn) return;
      var id = btn.getAttribute('data-id');
      if (btn.getAttribute('data-action') === 'view') openViewInvoiceModal(id);
      else if (btn.getAttribute('data-action') === 'pay') openRecordPaymentModal(id);
    });

    document.getElementById('bl-verify-list').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-action="review"]');
      if (!btn) return;
      openVerifyModal(btn.getAttribute('data-id'));
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