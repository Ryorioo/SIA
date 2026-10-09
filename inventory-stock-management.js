// ============================================================
// PAWSITIVE CARE — Inventory › Stock Management
// The ONLY inventory page that changes quantities.
//   Stock In / Stock Out / Adjust Stock → change the item's quantity
//   through PCData.adjustStock() and record a stock movement.
//
// Inventory items come from the existing data store (PCData). The
// data store has no movement history, so movement records live in
// this file under their own localStorage key, saved with the same
// PCData.__readRaw / __writeRaw helpers the other modules use.
// Nothing here edits an item's other fields or duplicates items.
// ============================================================
(function () {
  'use strict';

  // ------------------------------------------------------------------
  // 1. stock movement data (local to this page — see header comment)
  // ------------------------------------------------------------------
  // Movement record:
  // { id:'SM-001', inventoryItemId, itemName, type:'Stock In'|'Stock Out'|'Adjustment',
  //   quantity, unit, date:'YYYY-MM-DD', reference, reason, notes, user }
  //   Stock In / Stock Out → quantity is positive (type says the direction)
  //   Adjustment           → quantity is the signed difference (+5 / -3)
  // itemName is a copy of the item's name at the time, so a record still
  // reads correctly if the item is later deleted from the Items page.
  var MOVEMENT_KEY = 'pcv1_stock_movements';
  var CURRENT_USER = 'Admin';
  var TYPE_IN = 'Stock In', TYPE_OUT = 'Stock Out', TYPE_ADJ = 'Adjustment';
  var TYPE_BADGE = {};
  TYPE_BADGE[TYPE_IN] = 'in'; TYPE_BADGE[TYPE_OUT] = 'out'; TYPE_BADGE[TYPE_ADJ] = 'adj';

  var PAGE_SIZE = 10;
  var state = { q: '', type: 'all', page: 1 };
  var els = {};
  var lastSig = '';

  function readStore(key) {
    if (PCData.__readRaw) return PCData.__readRaw(key);
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  function writeStore(key, value) {
    if (PCData.__writeRaw) return PCData.__writeRaw(key, value);
    localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent('pcv1:change'));
  }

  function loadMovements() { return readStore(MOVEMENT_KEY) || []; }
  function saveMovements(list) { writeStore(MOVEMENT_KEY, list); }

  function nextMovementId(list) {
    var max = 0;
    list.forEach(function (m) {
      var n = parseInt(String(m.id).replace('SM-', ''), 10);
      if (n > max) max = n;
    });
    return 'SM-' + String(max + 1).padStart(3, '0');
  }

  // Adds one movement record and returns it.
  function createMovement(item, type, quantity, fields) {
    var list = loadMovements();
    var movement = {
      id: nextMovementId(list),
      inventoryItemId: item.id,
      itemName: item.name,
      type: type,
      quantity: quantity,
      unit: item.unit || '',
      date: fields.date,
      reference: fields.reference || '',
      reason: fields.reason || '',
      notes: fields.notes || '',
      user: CURRENT_USER
    };
    list.push(movement);
    saveMovements(list);
    return movement;
  }

  // The ONLY place quantity changes. delta is +/-; the data store refuses
  // anything that would take stock below 0 and returns { ok, item }.
  function updateItemQuantity(itemId, delta) {
    return PCData.adjustStock(itemId, delta);
  }

  // Demo movements so the page isn't empty on first load. They point at
  // the real inventory items (found by name) and don't touch quantities.
  function seedDemoMovementsIfEmpty() {
    var existing = loadMovements();
    if (existing.length) return;
    var items = PCData.getInventory();
    function find(name) { return items.filter(function (i) { return i.name === name; })[0]; }
    function daysAgo(n) {
      var d = new Date(); d.setDate(d.getDate() - n);
      return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    }
    var demo = [
      ['Amoxicillin 500mg', TYPE_IN, 50, 21, 'PO-2026-014', 'New delivery'],
      ['Rabies Vaccine', TYPE_IN, 20, 14, 'PO-2026-015', 'New delivery'],
      ['Amoxicillin 500mg', TYPE_OUT, 12, 9, 'USE-0412', 'Clinic usage'],
      ['Syringes 5ml', TYPE_OUT, 4, 5, 'USE-0419', 'Clinic usage'],
      ['Deworming Tablets', TYPE_ADJ, -3, 3, '', 'Physical count correction'],
      ['Surgical Gloves (Medium)', TYPE_ADJ, 20, 2, '', 'Physical count correction']
    ];
    var list = [];
    demo.forEach(function (d) {
      var item = find(d[0]);
      if (!item) return;
      list.push({
        id: nextMovementId(list), inventoryItemId: item.id, itemName: item.name, type: d[1],
        quantity: d[2], unit: item.unit || '', date: daysAgo(d[3]), reference: d[4],
        reason: d[5], notes: '', user: CURRENT_USER
      });
    });
    if (list.length) saveMovements(list);
  }

  // ------------------------------------------------------------------
  // 2. start-up
  // ------------------------------------------------------------------
  // One Escape / focus-trap handler for whichever modal is open.
  var closeActiveModal = null;
  document.addEventListener('keydown', function (e) {
    if (!closeActiveModal || e.isComposing) return;
    if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); closeActiveModal(); return; }
    if (e.key !== 'Tab') return;
    var box = document.querySelector('#sm-modal-overlay .sm-modal');
    if (!box) return;
    var all = box.querySelectorAll('button, input, select, textarea, a[href]');
    var items = [];
    for (var i = 0; i < all.length; i++) {
      if (!all[i].disabled && all[i].offsetParent !== null) items.push(all[i]);
    }
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1], active = document.activeElement;
    if (e.shiftKey && (active === first || !box.contains(active))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (active === last || !box.contains(active))) { e.preventDefault(); first.focus(); }
  });

  document.addEventListener('DOMContentLoaded', function () {
    if (!window.PCData || !PCData.getInventory || !PCData.adjustStock) {
      console.error('inventory-stock-management.js: PCData inventory functions not found — load data-store.js first.');
      return;
    }
    seedDemoMovementsIfEmpty();
    buildShell();
    renderMovements();
    PCData.onChange(renderMovements);
    // movements saved from another tab (data-store only watches its own keys)
    window.addEventListener('storage', function (e) { if (e.key === MOVEMENT_KEY) renderMovements(); });
  });

  // ------------------------------------------------------------------
  // 3. page shell (built once, so typing in search keeps focus)
  // ------------------------------------------------------------------
  function buildShell() {
    var root = document.getElementById('inventory-stock-root');
    if (!root) return;
    root.innerHTML =
      '<div class="page-toolbar sm-header">' +
        '<div class="sm-header-text"><h1 class="sm-title">STOCK MANAGEMENT</h1></div>' +
        '<div class="sm-head-actions">' +
          '<button type="button" id="sm-btn-in" class="btn btn-sm btn-primary"><i class="fa-solid fa-plus" aria-hidden="true"></i> Stock In</button>' +
          '<button type="button" id="sm-btn-out" class="btn btn-sm"><i class="fa-solid fa-minus" aria-hidden="true"></i> Stock Out</button>' +
          '<button type="button" id="sm-btn-adjust" class="btn btn-sm"><i class="fa-solid fa-sliders" aria-hidden="true"></i> Adjust Stock</button>' +
        '</div>' +
      '</div>' +
      '<section class="sm-panel">' +
        '<div class="filter-bar sm-filters">' +
          '<div class="search-field"><span><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i></span>' +
            '<input type="search" id="sm-search" placeholder="Search by item or reference..." aria-label="Search movements by item name or reference" autocomplete="off"></div>' +
          '<select id="sm-filter-type" class="sm-select" aria-label="Filter by movement type">' +
            '<option value="all">All Movement Types</option><option value="' + TYPE_IN + '">Stock In</option>' +
            '<option value="' + TYPE_OUT + '">Stock Out</option><option value="' + TYPE_ADJ + '">Adjustment</option></select>' +
        '</div>' +
        '<div class="sm-scroll"><table class="sm-table"><thead><tr>' +
          '<th>Item</th><th>Movement</th><th>Quantity</th><th>Unit</th><th>Date</th><th>Reference</th><th>User</th><th>Actions</th>' +
        '</tr></thead><tbody id="sm-tbody"></tbody></table></div>' +
        '<div class="sm-footer">' +
          '<p class="sm-count" id="sm-count" aria-live="polite"></p>' +
          '<div class="sm-pager" id="sm-pager" hidden>' +
            '<button type="button" class="btn btn-sm" id="sm-prev">Previous</button>' +
            '<div class="sm-pages" id="sm-pages" role="group" aria-label="Pagination"></div>' +
            '<button type="button" class="btn btn-sm" id="sm-next">Next</button>' +
          '</div>' +
        '</div>' +
      '</section>';

    els.tbody = document.getElementById('sm-tbody');
    els.count = document.getElementById('sm-count');
    els.pager = document.getElementById('sm-pager');
    els.prev = document.getElementById('sm-prev');
    els.next = document.getElementById('sm-next');
    els.pages = document.getElementById('sm-pages');

    document.getElementById('sm-search').addEventListener('input', function (e) { state.q = e.target.value; state.page = 1; renderMovements(); });
    document.getElementById('sm-filter-type').addEventListener('change', function (e) { state.type = e.target.value; state.page = 1; renderMovements(); });
    els.prev.addEventListener('click', function () { if (state.page > 1) { state.page--; renderMovements(); keepPagerFocus(); } });
    els.next.addEventListener('click', function () { state.page++; renderMovements(); keepPagerFocus(); });
    els.pages.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-page]') : null;
      if (!btn) return;
      var n = parseInt(btn.getAttribute('data-page'), 10);
      if (n && n !== state.page) { state.page = n; renderMovements(); keepPagerFocus(); }
    });
    document.getElementById('sm-btn-in').addEventListener('click', openStockInModal);
    document.getElementById('sm-btn-out').addEventListener('click', openStockOutModal);
    document.getElementById('sm-btn-adjust').addEventListener('click', openAdjustStockModal);

    els.tbody.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-action="view"]') : null;
      if (!btn) return;
      var id = btn.getAttribute('data-id');
      var m = loadMovements().filter(function (x) { return x.id === id; })[0];
      if (m) openDetailsModal(m);
    });
  }

  // ------------------------------------------------------------------
  // 4. movements table
  // ------------------------------------------------------------------
  function filteredMovements() {
    var q = state.q.trim().toLowerCase();
    return loadMovements().filter(function (m) {
      if (state.type !== 'all' && m.type !== state.type) return false;
      if (q) {
        var name = itemNameFor(m).toLowerCase(), ref = String(m.reference || '').toLowerCase();
        if (name.indexOf(q) === -1 && ref.indexOf(q) === -1) return false;
      }
      return true;
    }).sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.id < b.id ? 1 : -1; // newest first
    });
  }

  function itemNameFor(m) {
    var item = PCData.getInventoryById(m.inventoryItemId);
    return item ? item.name : (m.itemName || 'Unknown item');
  }

  function renderMovements() {
    if (!els.tbody) return;
    var total = loadMovements().length;
    var list = filteredMovements();
    var pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (state.page > pages) state.page = pages;
    var start = (state.page - 1) * PAGE_SIZE;
    var shown = list.slice(start, start + PAGE_SIZE);

    var rows = shown.map(movementRowHtml).join('') ||
      '<tr class="sm-empty"><td colspan="8">No stock movements found.</td></tr>';
    // "Showing 1–10 of 12 movements": current page range vs. everything matching
    // the active search/filter.
    var matches = list.length;
    var countText = !matches ? 'No movements to show' :
      'Showing ' + (shown.length === matches ? matches : (start + 1) + '\u2013' + (start + shown.length)) +
      ' of ' + matches + (matches === 1 ? ' movement' : ' movements');

    // PCData.onChange also fires on a poll; only touch the DOM if something changed.
    var sig = rows + '|' + countText + '|' + state.page + '/' + pages;
    if (sig === lastSig) return;
    lastSig = sig;
    els.tbody.innerHTML = rows;
    els.count.textContent = countText;
    els.pager.hidden = pages <= 1;
    els.pages.innerHTML = pageButtons(state.page, pages);
    els.prev.disabled = state.page <= 1;
    els.next.disabled = state.page >= pages;
  }

  // Page numbers: all up to 7 pages, otherwise first/last + current and
  // neighbours with '…' for the gaps.
  function pageList(cur, total) {
    if (total <= 7) {
      var all = [];
      for (var n = 1; n <= total; n++) all.push(n);
      return all;
    }
    if (cur <= 4) return [1, 2, 3, 4, 5, '\u2026', total];
    if (cur >= total - 3) return [1, '\u2026', total - 4, total - 3, total - 2, total - 1, total];
    return [1, '\u2026', cur - 1, cur, cur + 1, '\u2026', total];
  }

  function pageButtons(cur, total) {
    return pageList(cur, total).map(function (p) {
      if (p === '\u2026') return '<span class="sm-ellipsis" aria-hidden="true">\u2026</span>';
      var active = p === cur;
      return '<button type="button" class="btn btn-sm sm-page' + (active ? ' btn-primary' : '') + '" data-page="' + p + '"' +
        (active ? ' aria-current="page"' : '') + ' aria-label="Page ' + p + '">' + p + '</button>';
    }).join('');
  }

  // The pager is rebuilt on every page change, so restore keyboard focus to the
  // current page number if the clicked control was replaced or disabled.
  function keepPagerFocus() {
    if (els.pager.contains(document.activeElement) && !document.activeElement.disabled) return;
    var cur = els.pages.querySelector('[aria-current="page"]');
    if (cur) cur.focus();
  }

  function signedQuantity(m) {
    var q = Number(m.quantity) || 0;
    if (m.type === TYPE_OUT) return -Math.abs(q);
    if (m.type === TYPE_IN) return Math.abs(q);
    return q; // Adjustment: already signed
  }
  function formatSigned(n) { return (n > 0 ? '+' : n < 0 ? '\u2212' : '') + Math.abs(n); }

  function movementRowHtml(m) {
    var exists = !!PCData.getInventoryById(m.inventoryItemId);
    var q = signedQuantity(m);
    var id = escapeAttr(m.id);
    return '<tr>' +
      '<td class="sm-c-item"><span class="sm-name">' + escapeHtml(itemNameFor(m)) + '</span>' + (exists ? '' : '<span class="sm-removed">Removed</span>') + '</td>' +
      '<td data-label="Movement"><span class="sm-pill ' + TYPE_BADGE[m.type] + '">' + escapeHtml(m.type) + '</span></td>' +
      '<td data-label="Quantity" class="sm-num"><span class="sm-qty ' + (q > 0 ? 'plus' : q < 0 ? 'minus' : '') + '">' + formatSigned(q) + '</span></td>' +
      '<td data-label="Unit" class="sm-soft">' + (escapeHtml(m.unit) || '\u2014') + '</td>' +
      '<td data-label="Date" class="sm-soft sm-num sm-nowrap">' + formatDate(m.date) + '</td>' +
      '<td data-label="Reference" class="sm-soft">' + (escapeHtml(m.reference) || '\u2014') + '</td>' +
      '<td data-label="User" class="sm-soft">' + escapeHtml(m.user) + '</td>' +
      '<td class="sm-c-act"><div class="sm-actions">' +
        '<button type="button" class="icon-btn" data-action="view" data-id="' + id + '" aria-label="View details of movement ' + id + '" title="View details"><i class="fa-solid fa-eye" aria-hidden="true"></i><span class="act-txt">View Details</span></button>' +
      '</div></td>' +
    '</tr>';
  }

  // ------------------------------------------------------------------
  // 5. modal plumbing + form helpers
  // ------------------------------------------------------------------
  function openOverlay(boxClass, labelId, innerHtml) {
    var opener = document.activeElement;
    var overlay = document.createElement('div');
    overlay.id = 'sm-modal-overlay';
    overlay.className = 'modal-overlay open';
    var box = document.createElement('div');
    box.className = 'modal-box sm-modal ' + boxClass;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', labelId);
    box.innerHTML = innerHtml;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    function close() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (closeActiveModal === close) closeActiveModal = null;
      if (opener && opener.isConnected && opener.focus) opener.focus();
    }
    closeActiveModal = close;
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });
    return { box: box, close: close };
  }

  function head(title, id, closeId) {
    return '<div class="modal-head"><h3 class="modal-title" id="' + id + '">' + title + '</h3>' +
      '<button type="button" id="' + closeId + '" class="modal-close" aria-label="Close"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>';
  }

  function field(label, forId, inputHtml, helper, full) {
    return '<div class="sm-field' + (full ? ' full' : '') + '"><label for="' + forId + '">' + label + '</label>' + inputHtml +
      (helper !== undefined ? '<div class="sm-help" id="' + forId + '-help">' + helper + '</div>' : '') + '</div>';
  }

  // Active inventory items from the existing data store, A–Z.
  function loadInventoryItems() {
    return PCData.getInventory().filter(function (i) { return i.status === 'active'; })
      .sort(function (a, b) { return String(a.name).toLowerCase() < String(b.name).toLowerCase() ? -1 : 1; });
  }

  function itemSelectHtml(id) {
    return '<select id="' + id + '" required><option value="">Select an item…</option>' +
      loadInventoryItems().map(function (i) {
        return '<option value="' + escapeAttr(i.id) + '">' + escapeHtml(i.name) + '</option>';
      }).join('') + '</select>';
  }

  function selectedItem(selectId) {
    var v = document.getElementById(selectId).value;
    return v ? PCData.getInventoryById(v) : null;
  }

  function showError(id, msg) {
    var box = document.getElementById(id);
    box.textContent = msg; box.style.display = msg ? 'block' : 'none';
  }

  function modalFooter(cancelId, submitLabel) {
    return '<div class="modal-footer"><button type="button" id="' + cancelId + '" class="btn">Cancel</button>' +
      '<button type="submit" class="btn btn-primary">' + submitLabel + '</button></div>';
  }

  function todayIso() { return PCData.todayStr ? PCData.todayStr() : new Date().toISOString().slice(0, 10); }

  function parseWhole(raw) {
    var s = String(raw == null ? '' : raw).trim();
    return s === '' ? NaN : Number(s);
  }
  function validDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00').getTime()); }

  function stockLine(item) { return 'Current stock: ' + item.quantity + (item.unit ? ' ' + escapeHtml(item.unit) : ''); }

  // ------------------------------------------------------------------
  // 6. Stock In
  // ------------------------------------------------------------------
  function openStockInModal() {
    var m = openOverlay('', 'sm-in-title',
      head('Stock In', 'sm-in-title', 'sm-in-close') +
      '<form id="sm-in-form" novalidate><div class="form-grid sm-body">' +
        field('Item', 'in-item', itemSelectHtml('in-item'), undefined, true) +
        field('Quantity', 'in-qty', '<input type="number" id="in-qty" min="1" step="1" required placeholder="0">', '') +
        field('Unit', 'in-unit', '<input type="text" id="in-unit" readonly tabindex="-1" placeholder="—">') +
        field('Date', 'in-date', '<input type="date" id="in-date" required value="' + todayIso() + '">') +
        field('Reference (optional)', 'in-ref', '<input type="text" id="in-ref" placeholder="e.g. PO-2026-016">') +
        field('Notes (optional)', 'in-notes', '<textarea id="in-notes" rows="2"></textarea>', undefined, true) +
      '</div><div id="sm-in-error" class="sm-error" role="alert"></div>' +
      modalFooter('sm-in-cancel', 'Save Stock In') + '</form>');

    document.getElementById('in-item').focus();
    document.getElementById('sm-in-close').addEventListener('click', m.close);
    document.getElementById('sm-in-cancel').addEventListener('click', m.close);
    document.getElementById('in-item').addEventListener('change', function () {
      var item = selectedItem('in-item');
      document.getElementById('in-unit').value = item ? (item.unit || '') : '';
      document.getElementById('in-qty-help').innerHTML = item ? stockLine(item) : '';
    });
    document.getElementById('sm-in-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var err = handleStockIn({
        itemId: document.getElementById('in-item').value,
        quantity: parseWhole(document.getElementById('in-qty').value),
        date: document.getElementById('in-date').value,
        reference: document.getElementById('in-ref').value.trim(),
        notes: document.getElementById('in-notes').value.trim()
      });
      if (err) { showError('sm-in-error', err); return; }
      m.close(); renderMovements();
    });
  }

  // Returns an error message, or '' when saved.
  function handleStockIn(v) {
    var item = v.itemId ? PCData.getInventoryById(v.itemId) : null;
    if (!item) return 'Select an item.';
    if (isNaN(v.quantity) || v.quantity <= 0) return 'Quantity must be greater than 0.';
    if (!Number.isInteger(v.quantity)) return 'Quantity must be a whole number.';
    if (!validDate(v.date)) return 'Enter a valid date.';
    var result = updateItemQuantity(item.id, v.quantity);
    if (!result.ok) return 'Could not update stock for this item.';
    createMovement(item, TYPE_IN, v.quantity, { date: v.date, reference: v.reference, reason: 'Stock received', notes: v.notes });
    return '';
  }

  // ------------------------------------------------------------------
  // 7. Stock Out
  // ------------------------------------------------------------------
  function openStockOutModal() {
    var m = openOverlay('', 'sm-out-title',
      head('Stock Out', 'sm-out-title', 'sm-out-close') +
      '<form id="sm-out-form" novalidate><div class="form-grid sm-body">' +
        field('Item', 'out-item', itemSelectHtml('out-item'), undefined, true) +
        field('Quantity', 'out-qty', '<input type="number" id="out-qty" min="1" step="1" required placeholder="0">', '') +
        field('Unit', 'out-unit', '<input type="text" id="out-unit" readonly tabindex="-1" placeholder="—">') +
        field('Date', 'out-date', '<input type="date" id="out-date" required value="' + todayIso() + '">') +
        field('Reference (optional)', 'out-ref', '<input type="text" id="out-ref" placeholder="e.g. USE-0420">') +
        field('Reason', 'out-reason', '<input type="text" id="out-reason" required placeholder="e.g. Clinic usage, damaged, expired">', undefined, true) +
      '</div><div id="sm-out-error" class="sm-error" role="alert"></div>' +
      modalFooter('sm-out-cancel', 'Save Stock Out') + '</form>');

    document.getElementById('out-item').focus();
    document.getElementById('sm-out-close').addEventListener('click', m.close);
    document.getElementById('sm-out-cancel').addEventListener('click', m.close);
    document.getElementById('out-item').addEventListener('change', function () {
      var item = selectedItem('out-item');
      document.getElementById('out-unit').value = item ? (item.unit || '') : '';
      document.getElementById('out-qty-help').innerHTML = item ? stockLine(item) : '';
    });
    document.getElementById('sm-out-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var err = handleStockOut({
        itemId: document.getElementById('out-item').value,
        quantity: parseWhole(document.getElementById('out-qty').value),
        date: document.getElementById('out-date').value,
        reference: document.getElementById('out-ref').value.trim(),
        reason: document.getElementById('out-reason').value.trim()
      });
      if (err) { showError('sm-out-error', err); return; }
      m.close(); renderMovements();
    });
  }

  function handleStockOut(v) {
    var item = v.itemId ? PCData.getInventoryById(v.itemId) : null; // fresh quantity
    if (!item) return 'Select an item.';
    if (isNaN(v.quantity) || v.quantity <= 0) return 'Quantity must be greater than 0.';
    if (!Number.isInteger(v.quantity)) return 'Quantity must be a whole number.';
    if (v.quantity > item.quantity) {
      return 'Not enough stock. Requested ' + v.quantity + ' but only ' + item.quantity + (item.unit ? ' ' + item.unit : '') + ' available.';
    }
    if (!validDate(v.date)) return 'Enter a valid date.';
    if (!v.reason) return 'Reason is required.';
    var result = updateItemQuantity(item.id, -v.quantity);
    if (!result.ok) return 'Not enough stock to remove that quantity.';
    createMovement(item, TYPE_OUT, v.quantity, { date: v.date, reference: v.reference, reason: v.reason });
    return '';
  }

  // ------------------------------------------------------------------
  // 8. Adjust Stock (a correction: set the recorded quantity)
  // ------------------------------------------------------------------
  function openAdjustStockModal() {
    var m = openOverlay('', 'sm-adj-title',
      head('Adjust Stock', 'sm-adj-title', 'sm-adj-close') +
      '<form id="sm-adj-form" novalidate><div class="form-grid sm-body">' +
        field('Item', 'adj-item', itemSelectHtml('adj-item'), undefined, true) +
        field('Current Stock', 'adj-current', '<input type="text" id="adj-current" readonly tabindex="-1" placeholder="—">') +
        field('New Stock', 'adj-new', '<input type="number" id="adj-new" min="0" step="1" required placeholder="0">') +
        field('Difference', 'adj-diff', '<input type="text" id="adj-diff" class="sm-diff" readonly tabindex="-1" value="—">') +
        field('Date', 'adj-date', '<input type="date" id="adj-date" required value="' + todayIso() + '">') +
        field('Reason', 'adj-reason', '<input type="text" id="adj-reason" required placeholder="e.g. Physical count correction">', undefined, true) +
      '</div><div id="sm-adj-error" class="sm-error" role="alert"></div>' +
      modalFooter('sm-adj-cancel', 'Save Adjustment') + '</form>');

    document.getElementById('adj-item').focus();
    document.getElementById('sm-adj-close').addEventListener('click', m.close);
    document.getElementById('sm-adj-cancel').addEventListener('click', m.close);

    function showCurrent() {
      var item = selectedItem('adj-item');
      document.getElementById('adj-current').value = item ? item.quantity : '';
      updateDiff();
    }
    function updateDiff() {
      var item = selectedItem('adj-item');
      var n = parseWhole(document.getElementById('adj-new').value);
      var out = document.getElementById('adj-diff');
      if (!item || isNaN(n)) { out.value = '—'; out.className = 'sm-diff'; return; }
      var diff = n - item.quantity;
      out.value = diff > 0 ? '+' + diff : diff < 0 ? '\u2212' + Math.abs(diff) : '0';
      out.className = 'sm-diff ' + (diff > 0 ? 'plus' : diff < 0 ? 'minus' : '');
    }
    document.getElementById('adj-item').addEventListener('change', showCurrent);
    document.getElementById('adj-new').addEventListener('input', updateDiff);

    document.getElementById('sm-adj-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var shownCurrent = document.getElementById('adj-current').value;
      var err = handleAdjustStock({
        itemId: document.getElementById('adj-item').value,
        shownCurrent: shownCurrent === '' ? null : Number(shownCurrent),
        newStock: parseWhole(document.getElementById('adj-new').value),
        date: document.getElementById('adj-date').value,
        reason: document.getElementById('adj-reason').value.trim()
      });
      if (err) { showError('sm-adj-error', err); showCurrent(); return; }
      m.close(); renderMovements();
    });
  }

  function handleAdjustStock(v) {
    var item = v.itemId ? PCData.getInventoryById(v.itemId) : null; // fresh quantity
    if (!item) return 'Select an item.';
    if (isNaN(v.newStock)) return 'Enter the new stock quantity.';
    if (v.newStock < 0) return 'New stock cannot be negative.';
    if (!Number.isInteger(v.newStock)) return 'New stock must be a whole number.';
    if (!validDate(v.date)) return 'Enter a valid date.';
    if (!v.reason) return 'Reason is required.';
    if (v.shownCurrent !== null && v.shownCurrent !== item.quantity) {
      return 'Stock for this item changed to ' + item.quantity + ' since you opened this form. Review the new difference and save again.';
    }
    var diff = v.newStock - item.quantity;
    if (diff === 0) return 'New stock is the same as current stock — nothing to adjust.';
    var result = updateItemQuantity(item.id, diff);
    if (!result.ok) return 'Could not update stock for this item.';
    createMovement(item, TYPE_ADJ, diff, { date: v.date, reason: v.reason });
    return '';
  }

  // ------------------------------------------------------------------
  // 9. movement details (read-only)
  // ------------------------------------------------------------------
  function openDetailsModal(mv) {
    var q = signedQuantity(mv);
    function row(label, value, full) { return '<div' + (full ? ' class="full"' : '') + '><dt>' + label + '</dt><dd>' + (value || '\u2014') + '</dd></div>'; }
    var m = openOverlay('', 'sm-det-title',
      head('Movement ' + escapeHtml(mv.id), 'sm-det-title', 'sm-det-close') +
      '<div class="sm-body"><dl class="sm-details">' +
        row('Item', escapeHtml(itemNameFor(mv)), true) +
        row('Movement', escapeHtml(mv.type)) +
        row('Quantity', formatSigned(q) + (mv.unit ? ' ' + escapeHtml(mv.unit) : '')) +
        row('Date', formatDate(mv.date)) +
        row('User', escapeHtml(mv.user)) +
        row('Reference', escapeHtml(mv.reference)) +
        row('Reason', escapeHtml(mv.reason)) +
        row('Notes', escapeHtml(mv.notes), true) +
      '</dl></div>' +
      '<div class="modal-footer"><button type="button" id="sm-det-done" class="btn">Close</button></div>');
    document.getElementById('sm-det-done').focus();
    document.getElementById('sm-det-close').addEventListener('click', m.close);
    document.getElementById('sm-det-done').addEventListener('click', m.close);
  }

  // ------------------------------------------------------------------
  // 10. helpers
  // ------------------------------------------------------------------
  function formatDate(iso) {
    var p = String(iso || '').split('-').map(Number);
    if (p.length !== 3 || isNaN(p[0])) return '\u2014';
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }
})();