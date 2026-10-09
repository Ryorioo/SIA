// ============================================================
// PAWSITIVE CARE — Inventory › Procurement
// Purchase orders and receiving.
//
//   Procurement          → what was ordered, from whom, and what arrived
//   Stock Management     → actual stock movements
//   Inventory History    → read-only record of those movements
//
// Data (all in localStorage, saved through PCData.__readRaw / __writeRaw
// like the other modules):
//   pcv1_suppliers        suppliers (owned by this page)
//   pcv1_purchase_orders  purchase orders (owned by this page)
//   pcv1_inventory        existing items — read through PCData only
//   pcv1_stock_movements  existing movements — Stock In records are
//                         appended here when a PO is received
//
// Creating a PO changes NO inventory. Only receiving does: it raises the
// item's quantity with PCData.adjustStock() and appends a 'Stock In'
// movement using the same record shape as Stock Management.
//
// Supplier:  { id, name, contactPerson, phone, email, address, status:'Active'|'Inactive', createdAt, updatedAt }
// PO:        { id, poNumber, supplierId, orderDate, expectedDate, status, notes,
//              items:[{ inventoryItemId, itemName, quantityOrdered, quantityReceived, unit, unitPrice, total }],
//              totalValue, createdAt, updatedAt }
// ============================================================
(function () {
  'use strict';

  var SUPPLIER_KEY = 'pcv1_suppliers';
  var PO_KEY = 'pcv1_purchase_orders';
  var MOVEMENT_KEY = 'pcv1_stock_movements';
  var CURRENT_USER = 'Admin';

  var S_DRAFT = 'Draft', S_PENDING = 'Pending', S_PARTIAL = 'Partially Received', S_RECEIVED = 'Received', S_CANCELLED = 'Cancelled';
  var STATUS_CLS = {};
  STATUS_CLS[S_DRAFT] = 'draft'; STATUS_CLS[S_PENDING] = 'pending'; STATUS_CLS[S_PARTIAL] = 'partial';
  STATUS_CLS[S_RECEIVED] = 'received'; STATUS_CLS[S_CANCELLED] = 'cancelled';

  var PAGE_SIZE = 10;
  var MAX_LINES = 3; // ordered-item lines shown in the table before "+ N more"
  var state = { q: '', supplier: 'all', status: 'all', range: 'all', page: 1, selectedId: null, mode: 'detail', flash: '' };
  var els = {};
  var sig = { cards: '', table: '', panel: '', suppliers: '' };

  // ------------------------------------------------------------------
  // storage
  // ------------------------------------------------------------------
  function readStore(key) { return PCData.__readRaw(key); }
  function writeStore(key, value) { PCData.__writeRaw(key, value); }

  function loadSuppliers() { var l = readStore(SUPPLIER_KEY); return Array.isArray(l) ? l : []; }
  function saveSuppliers(l) { writeStore(SUPPLIER_KEY, l); }
  function loadPOs() { var l = readStore(PO_KEY); return Array.isArray(l) ? l : []; }
  function savePOs(l) { writeStore(PO_KEY, l); }
  function loadMovements() { var l = readStore(MOVEMENT_KEY); return Array.isArray(l) ? l : []; }

  function uid(prefix) { return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }

  function nextPoNumber(list) {
    var max = 0;
    list.forEach(function (p) {
      var n = parseInt(String(p.poNumber).replace(/\D/g, ''), 10);
      if (n > max) max = n;
    });
    return 'PO-' + String(max + 1).padStart(3, '0');
  }
  function poNumberValue(p) { var n = parseInt(String(p.poNumber).replace(/\D/g, ''), 10); return isNaN(n) ? 0 : n; }

  function nextMovementId(list) {
    var max = 0;
    list.forEach(function (m) {
      var n = parseInt(String(m.id).replace('SM-', ''), 10);
      if (n > max) max = n;
    });
    return 'SM-' + String(max + 1).padStart(3, '0');
  }

  // Demo data so the page isn't empty on first load. Only suppliers and
  // purchase orders are created — never inventory quantities or movements.
  function seedIfEmpty() {
    if (readStore(SUPPLIER_KEY) === null) {
      var now = Date.now();
      function sup(name, person, phone, email, address, status) {
        return { id: uid('sup'), name: name, contactPerson: person, phone: phone, email: email, address: address, status: status, createdAt: now, updatedAt: now };
      }
      saveSuppliers([
        sup('ABC Vet Supplies', 'Maria Santos', '0917 555 0101', 'orders@abcvet.example', '12 Rizal Avenue, Angeles City, Pampanga', 'Active'),
        sup('PetMed Distributors', 'Jose Reyes', '0918 555 0142', 'sales@petmed.example', '88 MacArthur Highway, San Fernando, Pampanga', 'Active'),
        sup('Northstar Medical Supply', 'Ana Cruz', '0919 555 0177', 'ana@northstar.example', '5 Gil Puyat Street, Makati City', 'Active'),
        sup('Greenfield Pharma', 'Paolo Lim', '0920 555 0123', 'paolo@greenfield.example', '23 Commerce Road, Quezon City', 'Inactive')
      ]);
    }
    if (readStore(PO_KEY) === null) {
      var sups = loadSuppliers();
      var inv = PCData.getInventory();
      var sid = function (name) { var s = sups.filter(function (x) { return x.name === name; })[0]; return s ? s.id : ''; };
      var line = function (name, qty, price) {
        var it = inv.filter(function (i) { return i.name === name; })[0];
        if (!it) return null;
        return { inventoryItemId: it.id, itemName: it.name, quantityOrdered: qty, quantityReceived: 0, unit: it.unit || '', unitPrice: price, total: round2(qty * price) };
      };
      var demo = [
        ['ABC Vet Supplies', -12, -8, S_CANCELLED, 'Cancelled — supplier out of stock.', [['Ketamine Injectable', 5, 300]]],
        ['PetMed Distributors', -9, -4, S_PENDING, '', [['Flea & Tick Spray', 12, 190]]],
        ['PetMed Distributors', -5, 2, S_PENDING, 'Please deliver in the morning.', [['Deworming Tablets', 100, 6], ['Multivitamin Syrup', 20, 80]]],
        ['Northstar Medical Supply', -3, 3, S_PENDING, '', [['Surgical Gloves (Medium)', 300, 2.5], ['IV Fluid (NSS) 500ml', 20, 58], ['Feline Vaccine (FVRCP)', 15, 230]]],
        ['ABC Vet Supplies', -1, 2, S_PENDING, 'Monthly restock.', [['Amoxicillin 500mg', 20, 120], ['Rabies Vaccine', 10, 350], ['Syringes 5ml', 50, 52]]]
      ];
      var list = [];
      demo.forEach(function (d) {
        var items = d[5].map(function (l) { return line(l[0], l[1], l[2]); }).filter(Boolean);
        if (!items.length || !sid(d[0])) return;
        var t = Date.now();
        list.push({
          id: uid('po'), poNumber: nextPoNumber(list), supplierId: sid(d[0]),
          orderDate: PCData.dateStr(d[1]), expectedDate: PCData.dateStr(d[2]), status: d[3], notes: d[4],
          items: items, totalValue: sumTotals(items), createdAt: t, updatedAt: t
        });
      });
      savePOs(list);
    }
  }

  // ------------------------------------------------------------------
  // calculations
  // ------------------------------------------------------------------
  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function sumTotals(items) { return round2(items.reduce(function (s, i) { return s + (Number(i.total) || 0); }, 0)); }
  function remaining(it) { return Math.max(0, (Number(it.quantityOrdered) || 0) - (Number(it.quantityReceived) || 0)); }

  // Status from received quantities (Draft/Cancelled are never changed here).
  function statusFromReceived(po) {
    var ordered = 0, received = 0;
    po.items.forEach(function (i) { ordered += Number(i.quantityOrdered) || 0; received += Number(i.quantityReceived) || 0; });
    if (received <= 0) return S_PENDING;
    return received >= ordered ? S_RECEIVED : S_PARTIAL;
  }
  function canReceive(po) { return po.status === S_PENDING || po.status === S_PARTIAL; }
  function canCancel(po) {
    return po.status === S_PENDING && !po.items.some(function (i) { return Number(i.quantityReceived) > 0; });
  }

  function peso(n) {
    var r = round2(n);
    return '\u20b1' + (Number.isInteger(r) ? r.toLocaleString('en-US') : r.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  }

  function inventoryMap() {
    var map = {};
    PCData.getInventory().forEach(function (i) { map[i.id] = i; });
    return map;
  }
  function supplierMap() {
    var map = {};
    loadSuppliers().forEach(function (s) { map[s.id] = s; });
    return map;
  }
  function supplierName(po, sups) { return sups[po.supplierId] ? sups[po.supplierId].name : 'Unknown supplier'; }
  function itemDisplayName(it, inv) { return inv[it.inventoryItemId] ? inv[it.inventoryItemId].name : it.itemName; }

  // ------------------------------------------------------------------
  // receiving (the ONLY place inventory changes)
  // ------------------------------------------------------------------
  // qtys[i] = quantity being received now for po.items[i]. Returns an error
  // message, or '' when saved. Everything is validated BEFORE anything is changed.
  function receivePO(poId, qtys) {
    var list = loadPOs();
    var po = list.filter(function (p) { return p.id === poId; })[0];
    if (!po) return 'Purchase order not found.';
    if (!canReceive(po)) return 'This purchase order can no longer receive items.';

    var total = 0, i;
    for (i = 0; i < po.items.length; i++) {
      var q = qtys[i], it = po.items[i], left = remaining(it);
      if (typeof q !== 'number' || isNaN(q) || q < 0 || !Number.isInteger(q)) return 'Receiving quantities must be whole numbers, 0 or more.';
      if (q > left) return it.itemName + ': only ' + left + ' left to receive.';
      if (q > 0) {
        if (!PCData.getInventoryById(it.inventoryItemId)) return it.itemName + ' is no longer in inventory, so it cannot be received.';
        total += q;
      }
    }
    if (!total) return 'Enter a quantity to receive for at least one item.';

    var sups = supplierMap();
    var movements = loadMovements();
    var today = PCData.todayStr();
    var supName = supplierName(po, sups);

    for (i = 0; i < po.items.length; i++) {
      var qty = qtys[i];
      if (!(qty > 0)) continue;
      var line = po.items[i];
      var res = PCData.adjustStock(line.inventoryItemId, qty);   // existing mechanism — raises quantity
      if (!res.ok) return 'Could not update stock for ' + line.itemName + '.';
      movements.push({
        id: nextMovementId(movements),
        inventoryItemId: line.inventoryItemId,
        itemName: res.item.name,
        type: 'Stock In',
        quantity: qty,
        unit: res.item.unit || '',
        date: today,
        reference: po.poNumber,
        reason: 'Purchase order received',
        notes: 'Supplier: ' + supName,
        user: CURRENT_USER
      });
      line.quantityReceived = (Number(line.quantityReceived) || 0) + qty;
    }
    writeStore(MOVEMENT_KEY, movements);
    po.status = statusFromReceived(po);
    po.updatedAt = Date.now();
    savePOs(list);
    return '';
  }

  function cancelPO(poId) {
    var list = loadPOs();
    var po = list.filter(function (p) { return p.id === poId; })[0];
    if (!po || !canCancel(po)) return 'This purchase order cannot be cancelled.';
    po.status = S_CANCELLED;
    po.updatedAt = Date.now();
    savePOs(list);
    return '';
  }

  // ------------------------------------------------------------------
  // modal plumbing (one Escape / focus-trap handler for whichever modal is open)
  // ------------------------------------------------------------------
  var closeActiveModal = null;
  document.addEventListener('keydown', function (e) {
    if (!closeActiveModal || e.isComposing) return;
    if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); closeActiveModal(); return; }
    if (e.key !== 'Tab') return;
    var box = document.querySelector('#pr-modal-overlay .pr-modal');
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

  function openOverlay(boxClass, labelId, innerHtml) {
    var opener = document.activeElement;
    var overlay = document.createElement('div');
    overlay.id = 'pr-modal-overlay';
    overlay.className = 'modal-overlay open';
    var box = document.createElement('div');
    box.className = 'modal-box pr-modal ' + boxClass;
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
  function field(label, forId, inputHtml, full) {
    return '<div class="pr-field' + (full ? ' full' : '') + '"><label for="' + forId + '">' + label + '</label>' + inputHtml + '</div>';
  }
  function showError(id, msg) {
    var box = document.getElementById(id);
    if (!box) return;
    box.textContent = msg; box.style.display = msg ? 'block' : 'none';
  }

  // ------------------------------------------------------------------
  // start-up
  // ------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', function () {
    if (!window.PCData || !PCData.getInventory || !PCData.adjustStock || !PCData.__readRaw || !PCData.__writeRaw) {
      console.error('inventory-procurement.js: PCData inventory functions not found — load data-store.js first.');
      return;
    }
    seedIfEmpty();
    buildShell();
    render();
    PCData.onChange(render);
    window.addEventListener('storage', function (e) {
      if (e.key === SUPPLIER_KEY || e.key === PO_KEY || e.key === MOVEMENT_KEY) render();
    });
  });

  // ------------------------------------------------------------------
  // page shell (built once, so typing in search keeps focus)
  // ------------------------------------------------------------------
  function buildShell() {
    var root = document.getElementById('inventory-procurement-root');
    if (!root) return;
    root.innerHTML =
      '<div class="page-toolbar pr-header">' +
        '<div class="pr-header-text"><h1 class="pr-title">PROCUREMENT</h1></div>' +
        '<div class="pr-head-actions">' +
          '<button type="button" id="pr-btn-suppliers" class="btn btn-sm"><i class="fa-solid fa-truck-field" aria-hidden="true"></i> Suppliers</button>' +
          '<button type="button" id="pr-btn-new" class="btn btn-sm btn-primary"><i class="fa-solid fa-plus" aria-hidden="true"></i> New Purchase Order</button>' +
        '</div>' +
      '</div>' +
      '<div id="pr-cards"></div>' +
      '<div class="pr-layout">' +
        '<section class="pr-panel" aria-label="Purchase orders">' +
          '<div class="filter-bar pr-filters">' +
            '<div class="search-field"><span><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i></span>' +
              '<input type="search" id="pr-search" placeholder="Search purchase orders..." aria-label="Search purchase orders" autocomplete="off"></div>' +
            '<select id="pr-filter-supplier" class="pr-select" aria-label="Filter by supplier"></select>' +
            '<select id="pr-filter-status" class="pr-select" aria-label="Filter by status">' +
              '<option value="all">All Statuses</option><option>' + S_DRAFT + '</option><option>' + S_PENDING + '</option>' +
              '<option>' + S_PARTIAL + '</option><option>' + S_RECEIVED + '</option><option>' + S_CANCELLED + '</option></select>' +
            '<select id="pr-filter-date" class="pr-select" aria-label="Filter by order date">' +
              '<option value="all">All Dates</option><option value="today">Today</option>' +
              '<option value="7">Last 7 Days</option><option value="30">Last 30 Days</option></select>' +
          '</div>' +
          '<div class="pr-scroll"><table class="pr-table"><thead><tr>' +
            '<th>PO #</th><th>Supplier</th><th>Ordered Items</th><th>Total</th><th>Order Date</th><th>Expected Date</th><th>Status</th>' +
          '</tr></thead><tbody id="pr-tbody"></tbody></table></div>' +
          '<div class="pr-footer">' +
            '<p class="pr-count" id="pr-count" aria-live="polite"></p>' +
            '<div class="pr-pager" id="pr-pager" hidden>' +
              '<button type="button" class="btn btn-sm" id="pr-prev">Previous</button>' +
              '<div class="pr-pages" id="pr-pages" role="group" aria-label="Pagination"></div>' +
              '<button type="button" class="btn btn-sm" id="pr-next">Next</button>' +
            '</div>' +
          '</div>' +
        '</section>' +
        '<aside class="pr-panel" id="pr-detail-panel" aria-labelledby="pr-detail-title">' +
          '<div class="pr-panel-head"><h2 class="pr-panel-title" id="pr-detail-title">Purchase Order Details</h2></div>' +
          '<div id="pr-detail"></div>' +
        '</aside>' +
      '</div>';

    els.cards = document.getElementById('pr-cards');
    els.tbody = document.getElementById('pr-tbody');
    els.count = document.getElementById('pr-count');
    els.pager = document.getElementById('pr-pager');
    els.prev = document.getElementById('pr-prev');
    els.next = document.getElementById('pr-next');
    els.pages = document.getElementById('pr-pages');
    els.detail = document.getElementById('pr-detail');
    els.detailTitle = document.getElementById('pr-detail-title');
    els.detailPanel = document.getElementById('pr-detail-panel');
    els.supplierSel = document.getElementById('pr-filter-supplier');

    document.getElementById('pr-search').addEventListener('input', function (e) { state.q = e.target.value; state.page = 1; render(); });
    els.supplierSel.addEventListener('change', function (e) { state.supplier = e.target.value; state.page = 1; render(); });
    document.getElementById('pr-filter-status').addEventListener('change', function (e) { state.status = e.target.value; state.page = 1; render(); });
    document.getElementById('pr-filter-date').addEventListener('change', function (e) { state.range = e.target.value; state.page = 1; render(); });
    els.prev.addEventListener('click', function () { if (state.page > 1) { state.page--; render(); keepPagerFocus(); } });
    els.next.addEventListener('click', function () { state.page++; render(); keepPagerFocus(); });
    els.pages.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-page]') : null;
      if (!btn) return;
      var n = parseInt(btn.getAttribute('data-page'), 10);
      if (n && n !== state.page) { state.page = n; render(); keepPagerFocus(); }
    });
    document.getElementById('pr-btn-suppliers').addEventListener('click', openSuppliersModal);
    document.getElementById('pr-btn-new').addEventListener('click', openNewPoModal);

    // Select a purchase order (read-only, no navigation). Clicking a row or
    // pressing Enter/Space on a focused row runs the same logic.
    function selectOrder(id) {
      if (id !== state.selectedId) { state.selectedId = id; state.mode = 'detail'; state.flash = ''; }
      render();
      var again = els.tbody.querySelector('[data-view="' + id.replace(/"/g, '') + '"]');
      if (again && again.focus) again.focus();
      // stacked layout: the panel sits below the list — bring it into view
      if (els.detailPanel.getBoundingClientRect().top > window.innerHeight * 0.6 && els.detailPanel.scrollIntoView) {
        var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        els.detailPanel.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
      }
    }
    var INTERACTIVE = 'a, button, input, select, textarea, label';
    els.tbody.addEventListener('click', function (e) {
      var row = e.target.closest ? e.target.closest('[data-view]') : null;
      if (!row) return;
      var inner = e.target.closest(INTERACTIVE);
      if (inner && row.contains(inner)) return; // let controls inside a row do their own thing
      selectOrder(row.getAttribute('data-view'));
    });
    els.tbody.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      if (e.isComposing || e.target.closest(INTERACTIVE) || !e.target.hasAttribute('data-view')) return;
      e.preventDefault(); // stop Space from scrolling the page
      selectOrder(e.target.getAttribute('data-view'));
    });

    // detail panel actions
    els.detail.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'receive') { state.mode = 'receive'; state.flash = ''; render(); focusFirstReceiveInput(); }
      else if (act === 'recv-cancel') { state.mode = 'detail'; render(); }
      else if (act === 'recv-confirm') { confirmReceive(); }
      else if (act === 'cancel-order') { openCancelOrderModal(); }
    });
    els.detail.addEventListener('input', function (e) {
      if (e.target && e.target.getAttribute && e.target.hasAttribute('data-recv')) updateReceiveSummary();
    });
  }

  function focusFirstReceiveInput() {
    var f = els.detail.querySelector('input[data-recv]:not([disabled])');
    if (f) f.focus();
  }

  // ------------------------------------------------------------------
  // data → filtered list
  // ------------------------------------------------------------------
  function inDateRange(iso, range) {
    if (range === 'all') return true;
    var today = PCData.todayStr();
    var from = range === 'today' ? today : range === '7' ? PCData.dateStr(-6) : PCData.dateStr(-29);
    var d = String(iso || '');
    return d >= from && d <= today;
  }

  function newestFirst(a, b) {
    var da = String(a.orderDate || ''), db = String(b.orderDate || '');
    if (da !== db) return da < db ? 1 : -1;
    return poNumberValue(b) - poNumberValue(a);
  }

  function applyFilters(pos, sups, inv) {
    var q = state.q.trim().toLowerCase();
    return pos.filter(function (po) {
      if (state.supplier !== 'all' && po.supplierId !== state.supplier) return false;
      if (state.status !== 'all' && po.status !== state.status) return false;
      if (!inDateRange(po.orderDate, state.range)) return false;
      if (q) {
        var hay = [po.poNumber, supplierName(po, sups), po.notes || ''];
        po.items.forEach(function (i) { hay.push(itemDisplayName(i, inv)); });
        if (hay.join(' | ').toLowerCase().indexOf(q) === -1) return false;
      }
      return true;
    }).sort(newestFirst);
  }

  // ------------------------------------------------------------------
  // render
  // ------------------------------------------------------------------
  function render() {
    if (!els.tbody) return;
    var pos = loadPOs();
    var sups = supplierMap();
    var inv = inventoryMap();

    renderSupplierFilter();
    renderCards(pos);

    var filtered = applyFilters(pos, sups, inv);
    if (state.selectedId !== null && !filtered.some(function (p) { return p.id === state.selectedId; })) {
      state.selectedId = null; state.mode = 'detail'; state.flash = '';
    }
    var pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (state.page > pages) state.page = pages;
    var shown = filtered.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);

    renderTable(shown, filtered.length, pos.length, pages, sups, inv);
    var sel = state.selectedId ? pos.filter(function (p) { return p.id === state.selectedId; })[0] : null;
    renderPanel(sel, sups, inv);
  }

  function renderSupplierFilter() {
    var list = loadSuppliers().slice().sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
    var html = '<option value="all">All Suppliers</option>' + list.map(function (s) {
      return '<option value="' + escapeAttr(s.id) + '">' + escapeHtml(s.name) + '</option>';
    }).join('');
    if (html === sig.suppliers) return;
    sig.suppliers = html;
    els.supplierSel.innerHTML = html;
    if (!list.some(function (s) { return s.id === state.supplier; })) state.supplier = 'all';
    els.supplierSel.value = state.supplier;
  }

  function renderCards(pos) {
    var pending = 0, partial = 0, received = 0, value = 0;
    pos.forEach(function (p) {
      if (p.status === S_PENDING) pending++;
      else if (p.status === S_PARTIAL) partial++;
      else if (p.status === S_RECEIVED) received++;
      if (p.status !== S_CANCELLED) value += Number(p.totalValue) || 0;
    });
    var html = '<ul class="pr-cards">' +
      card(true, 'fa-file-invoice', 'Total Purchase Orders', String(pos.length), 'all purchase orders') +
      card(false, 'fa-clock', 'Pending Orders', String(pending), partial + ' partially received') +
      card(false, 'fa-circle-check', 'Received Orders', String(received), 'fully received') +
      card(false, 'fa-peso-sign', 'Total Purchase Value', peso(value), 'excludes cancelled orders') +
    '</ul>';
    if (html === sig.cards) return;
    sig.cards = html;
    els.cards.innerHTML = html;
  }

  function card(primary, icon, label, value, note) {
    return '<li class="pr-card' + (primary ? ' pr-card-primary' : '') + '">' +
      '<div class="pr-card-head"><span class="pr-label">' + escapeHtml(label) + '</span>' +
      '<i class="fa-solid ' + icon + ' pr-icon" aria-hidden="true"></i></div>' +
      '<div class="pr-num">' + escapeHtml(value) + '</div>' +
      '<div class="pr-note">' + escapeHtml(note) + '</div>' +
    '</li>';
  }

  function renderTable(shown, filteredCount, totalCount, pages, sups, inv) {
    var body;
    if (shown.length) {
      body = shown.map(function (po) { return rowHtml(po, sups, inv); }).join('');
    } else if (!totalCount) {
      body = '<tr class="pr-empty"><td colspan="7">No purchase orders yet.<br>Use New Purchase Order to create the first one.</td></tr>';
    } else {
      body = '<tr class="pr-empty"><td colspan="7">No purchase orders match your filters.</td></tr>';
    }
    // "Showing 1–10 of 12 orders": current page range vs. everything matching the filters.
    var start = (state.page - 1) * PAGE_SIZE;
    var countText = !filteredCount ? 'No orders to show' :
      'Showing ' + (shown.length === filteredCount ? filteredCount : (start + 1) + '\u2013' + (start + shown.length)) +
      ' of ' + filteredCount + (filteredCount === 1 ? ' order' : ' orders');
    var s = body + '|' + countText + '|' + state.page + '/' + pages;
    if (s === sig.table) return;
    sig.table = s;
    els.tbody.innerHTML = body;
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
      if (p === '\u2026') return '<span class="pr-ellipsis" aria-hidden="true">\u2026</span>';
      var active = p === cur;
      return '<button type="button" class="btn btn-sm pr-page' + (active ? ' btn-primary' : '') + '" data-page="' + p + '"' +
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

  function rowHtml(po, sups, inv) {
    var selected = po.id === state.selectedId;
    var lines = po.items.slice(0, MAX_LINES).map(function (i) {
      return '<div class="pr-line"><span class="pr-line-name">' + escapeHtml(itemDisplayName(i, inv)) + '</span> <span class="pr-line-qty">\u00d7' + escapeHtml(i.quantityOrdered) + '</span></div>';
    }).join('');
    if (po.items.length > MAX_LINES) lines += '<div class="pr-more">+ ' + (po.items.length - MAX_LINES) + ' more</div>';
    return '<tr' + (selected ? ' class="is-selected" aria-current="true"' : '') +
      ' tabindex="0" data-view="' + escapeAttr(po.id) + '" title="View details of ' + escapeAttr(po.poNumber) + '">' +
      '<td data-label="PO #" class="pr-c-po"><span class="pr-po">' + escapeHtml(po.poNumber) + '</span></td>' +
      '<td data-label="Supplier" class="pr-c-sup">' + escapeHtml(supplierName(po, sups)) + '</td>' +
      '<td data-label="Ordered Items" class="pr-c-items"><div class="pr-lines">' + lines + '</div></td>' +
      '<td data-label="Total" class="pr-num-cell pr-nowrap">' + peso(po.totalValue) + '</td>' +
      '<td data-label="Order Date" class="pr-soft pr-nowrap">' + formatShortDate(po.orderDate) + '</td>' +
      '<td data-label="Expected Date" class="pr-soft pr-nowrap">' + formatShortDate(po.expectedDate) + '</td>' +
      '<td data-label="Status">' + statusPill(po.status) + '</td>' +
    '</tr>';
  }

  function statusPill(status) {
    return '<span class="pr-pill ' + (STATUS_CLS[status] || 'draft') + '">' + escapeHtml(status) + '</span>';
  }

  // ------------------------------------------------------------------
  // right panel: details / receive
  // ------------------------------------------------------------------
  function renderPanel(po, sups, inv) {
    var html, title;
    if (!po) {
      title = 'Purchase Order Details';
      html = '<div class="pr-detail-empty">' +
        '<span class="pr-empty-icon" aria-hidden="true"><i class="fa-solid fa-file-invoice"></i></span>' +
        '<div class="pr-empty-title">Select a purchase order to view its details.</div>' +
        '<div class="pr-empty-text">Click View on a purchase order to see what was ordered and what has been received.</div></div>';
    } else if (state.mode === 'receive' && canReceive(po)) {
      title = 'Receive Items';
      html = receiveHtml(po, sups, inv);
    } else {
      state.mode = 'detail';
      title = 'Purchase Order';
      html = detailHtml(po, sups, inv);
    }
    var s = title + '|' + html;
    if (s === sig.panel) return;
    sig.panel = s;
    els.detailTitle.textContent = title;
    els.detail.innerHTML = html;
  }

  function dl(rows) {
    return '<dl class="pr-info">' + rows.map(function (r) {
      return '<div><dt>' + r[0] + '</dt><dd>' + r[1] + '</dd></div>';
    }).join('') + '</dl>';
  }

  function detailHtml(po, sups, inv) {
    var items = po.items.map(function (i) {
      var u = i.unit ? ' ' + escapeHtml(i.unit) : '';
      var rec = Number(i.quantityReceived) || 0, ord = Number(i.quantityOrdered) || 0;
      var recCls = rec >= ord ? 'full' : rec > 0 ? 'part' : '';
      var gone = inv[i.inventoryItemId] ? '' : '<span class="pr-removed">Removed</span>';
      return '<li class="pr-oi">' +
        '<div class="pr-oi-top"><span class="pr-oi-name">' + escapeHtml(itemDisplayName(i, inv)) + gone + '</span><span class="pr-oi-total">' + peso(i.total) + '</span></div>' +
        '<div class="pr-oi-grid">' +
          '<div><span>Ordered</span><b>' + ord + u + '</b></div>' +
          '<div><span>Received</span><b class="' + recCls + '">' + rec + u + '</b></div>' +
          '<div><span>Unit Price</span><b>' + peso(i.unitPrice) + '</b></div>' +
        '</div></li>';
    }).join('');

    var actions = '';
    if (canReceive(po)) actions += '<button type="button" class="btn btn-primary" data-act="receive">Receive Items</button>';
    if (canCancel(po)) actions += '<button type="button" class="btn" data-act="cancel-order">Cancel Order</button>';

    return '<div class="pr-detail">' +
      (state.flash ? '<div class="pr-flash" role="status">' + escapeHtml(state.flash) + '</div>' : '') +
      '<h3 class="pr-po-name">' + escapeHtml(po.poNumber) + '</h3>' +
      dl([
        ['Supplier', escapeHtml(supplierName(po, sups))],
        ['Status', statusPill(po.status)],
        ['Order Date', formatDate(po.orderDate)],
        ['Expected Date', formatDate(po.expectedDate)]
      ]) +
      '<div class="pr-sec-head"><h3 class="pr-sec-title">Ordered Items</h3><span class="pr-count">' + po.items.length + (po.items.length === 1 ? ' item' : ' items') + '</span></div>' +
      '<ul class="pr-oi-list">' + items + '</ul>' +
      dl([
        ['Subtotal', peso(po.totalValue)],
        ['<strong>Total Purchase Value</strong>', '<strong>' + peso(po.totalValue) + '</strong>']
      ]).replace('class="pr-info"', 'class="pr-info pr-totals"') +
      (po.notes ? '<div class="pr-sec-head"><h3 class="pr-sec-title">Purchase Notes</h3></div><p class="pr-notes">' + escapeHtml(po.notes) + '</p>' : '') +
      (actions ? '<div class="pr-actions">' + actions + '</div>' : '') +
    '</div>';
  }

  function receiveHtml(po, sups, inv) {
    var rows = po.items.map(function (i, idx) {
      var left = remaining(i);
      var u = i.unit ? ' ' + escapeHtml(i.unit) : '';
      var exists = !!inv[i.inventoryItemId];
      var disabled = left === 0 || !exists;
      var note = !exists ? '<div class="pr-recv-warn">No longer in inventory — cannot be received.</div>'
        : left === 0 ? '<div class="pr-recv-done">Fully received</div>' : '';
      return '<li class="pr-recv">' +
        '<div class="pr-oi-name">' + escapeHtml(itemDisplayName(i, inv)) + '</div>' +
        '<div class="pr-recv-meta"><span>Ordered: <b>' + i.quantityOrdered + u + '</b></span><span>Already Received: <b>' + (Number(i.quantityReceived) || 0) + u + '</b></span></div>' +
        note +
        '<div class="pr-recv-input"><label for="pr-recv-' + idx + '">Receive</label>' +
          '<input type="number" id="pr-recv-' + idx + '" data-recv="' + idx + '" data-max="' + left + '" min="0" max="' + left + '" step="1" value="0" inputmode="numeric"' + (disabled ? ' disabled' : '') + '>' +
          '<span class="pr-recv-left">of ' + left + ' remaining</span></div>' +
      '</li>';
    }).join('');
    return '<div class="pr-detail">' +
      '<h3 class="pr-po-name">' + escapeHtml(po.poNumber) + '</h3>' +
      dl([['Supplier', escapeHtml(supplierName(po, sups))]]) +
      '<ul class="pr-oi-list">' + rows + '</ul>' +
      '<div class="pr-sec-head"><h3 class="pr-sec-title">Receiving Summary</h3></div>' +
      dl([['Items to receive', '<span id="pr-sum-items">0</span>'], ['Total units to receive', '<span id="pr-sum-units">0</span>']]) +
      '<div id="pr-recv-error" class="pr-error" role="alert"></div>' +
      '<div class="pr-actions"><button type="button" class="btn" data-act="recv-cancel">Cancel</button>' +
        '<button type="button" class="btn btn-primary" data-act="recv-confirm">Receive Items</button></div>' +
    '</div>';
  }

  // Reads the receiving inputs. Returns { qtys:[…], bad:bool }.
  function readReceiveInputs() {
    var inputs = els.detail.querySelectorAll('input[data-recv]');
    var qtys = [], bad = false;
    for (var i = 0; i < inputs.length; i++) {
      var inp = inputs[i];
      var raw = String(inp.value).trim();
      var n = raw === '' ? 0 : Number(raw);
      var max = Number(inp.getAttribute('data-max'));
      var invalid = isNaN(n) || n < 0 || !Number.isInteger(n) || n > max;
      inp.classList.toggle('invalid', invalid);
      if (invalid) bad = true;
      qtys[Number(inp.getAttribute('data-recv'))] = invalid ? NaN : n;
    }
    return { qtys: qtys, bad: bad };
  }

  function updateReceiveSummary() {
    var r = readReceiveInputs();
    var items = 0, units = 0;
    r.qtys.forEach(function (q) { if (q > 0) { items++; units += q; } });
    var a = document.getElementById('pr-sum-items'), b = document.getElementById('pr-sum-units');
    if (a) a.textContent = items;
    if (b) b.textContent = units;
    if (!r.bad) showError('pr-recv-error', '');
  }

  function confirmReceive() {
    var po = loadPOs().filter(function (p) { return p.id === state.selectedId; })[0];
    if (!po) return;
    var r = readReceiveInputs();
    if (r.bad) { showError('pr-recv-error', 'Receiving quantities must be whole numbers from 0 up to the remaining quantity.'); return; }
    var err = receivePO(po.id, r.qtys);
    if (err) { showError('pr-recv-error', err); return; }
    var items = 0, units = 0;
    r.qtys.forEach(function (q) { if (q > 0) { items++; units += q; } });
    state.mode = 'detail';
    state.flash = 'Received ' + units + (units === 1 ? ' unit' : ' units') + ' across ' + items + (items === 1 ? ' item' : ' items') + '. Inventory and Stock In history updated.';
    render();
  }

  // ------------------------------------------------------------------
  // cancel order (small confirm)
  // ------------------------------------------------------------------
  function openCancelOrderModal() {
    var po = loadPOs().filter(function (p) { return p.id === state.selectedId; })[0];
    if (!po || !canCancel(po)) return;
    var m = openOverlay('narrow', 'pr-cx-title',
      head('Cancel Purchase Order', 'pr-cx-title', 'pr-cx-close') +
      '<div class="pr-body"><p>Cancel <strong>' + escapeHtml(po.poNumber) + '</strong>? A cancelled order cannot be received and does not affect inventory.</p></div>' +
      '<div id="pr-cx-error" class="pr-error pr-modal-error" role="alert"></div>' +
      '<div class="modal-footer"><button type="button" id="pr-cx-no" class="btn">Keep Order</button>' +
      '<button type="button" id="pr-cx-yes" class="btn btn-primary">Cancel Order</button></div>');
    document.getElementById('pr-cx-no').focus();
    document.getElementById('pr-cx-close').addEventListener('click', m.close);
    document.getElementById('pr-cx-no').addEventListener('click', m.close);
    document.getElementById('pr-cx-yes').addEventListener('click', function () {
      var err = cancelPO(po.id);
      if (err) { showError('pr-cx-error', err); return; }
      state.flash = po.poNumber + ' was cancelled.';
      m.close(); render();
    });
  }

  // ------------------------------------------------------------------
  // New Purchase Order
  // ------------------------------------------------------------------
  function activeInventoryItems() {
    return PCData.getInventory().filter(function (i) { return i.status === 'active'; })
      .sort(function (a, b) { return String(a.name).toLowerCase() < String(b.name).toLowerCase() ? -1 : 1; });
  }

  function openNewPoModal() {
    var suppliers = loadSuppliers().filter(function (s) { return s.status === 'Active'; })
      .sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
    var items = activeInventoryItems();
    var itemOptions = '<option value="">Select an item…</option>' + items.map(function (i) {
      return '<option value="' + escapeAttr(i.id) + '" data-unit="' + escapeAttr(i.unit || '') + '">' + escapeHtml(i.name) + '</option>';
    }).join('');
    var supplierOptions = '<option value="">Select a supplier…</option>' + suppliers.map(function (s) {
      return '<option value="' + escapeAttr(s.id) + '">' + escapeHtml(s.name) + '</option>';
    }).join('');
    var today = PCData.todayStr();

    var m = openOverlay('wide', 'pr-new-title',
      head('New Purchase Order', 'pr-new-title', 'pr-new-close') +
      '<form id="pr-new-form" novalidate><div class="pr-body">' +
        '<div class="pr-grid">' +
          field('Supplier', 'po-supplier', '<select id="po-supplier" required>' + supplierOptions + '</select>', true) +
          field('Order Date', 'po-order', '<input type="date" id="po-order" required value="' + today + '">') +
          field('Expected Date', 'po-expected', '<input type="date" id="po-expected" required>') +
          field('Purchase Notes (optional)', 'po-notes', '<textarea id="po-notes" rows="2"></textarea>', true) +
        '</div>' +
        '<div class="pr-sec-head pr-sec-gap"><h3 class="pr-sec-title">Ordered Items</h3></div>' +
        '<div class="pr-rows-head" aria-hidden="true"><span>Item</span><span>Quantity</span><span>Unit</span><span>Unit Price</span><span>Total</span><span></span></div>' +
        '<div id="po-rows"></div>' +
        '<button type="button" id="po-add-row" class="btn btn-sm pr-add-row">+ Add Item</button>' +
        '<div class="pr-order-total"><span>Order Total</span><strong id="po-grand">\u20b10</strong></div>' +
      '</div>' +
      '<div id="pr-new-error" class="pr-error pr-modal-error" role="alert"></div>' +
      '<div class="modal-footer"><button type="button" id="pr-new-cancel" class="btn">Cancel</button>' +
        '<button type="submit" class="btn btn-primary">Create Purchase Order</button></div></form>');

    var rowsEl = document.getElementById('po-rows');

    function rowHtml() {
      return '<div class="pr-row">' +
        '<div class="pr-rf pr-rf-item"><label>Item</label><select class="r-item">' + itemOptions + '</select></div>' +
        '<div class="pr-rf"><label>Quantity</label><input type="number" class="r-qty" min="1" step="1" placeholder="0" inputmode="numeric"></div>' +
        '<div class="pr-rf"><label>Unit</label><input type="text" class="r-unit" readonly tabindex="-1" placeholder="—"></div>' +
        '<div class="pr-rf"><label>Unit Price</label><input type="number" class="r-price" min="0" step="0.01" placeholder="0.00" inputmode="decimal"></div>' +
        '<div class="pr-rf"><label>Total</label><input type="text" class="r-total" readonly tabindex="-1" value="\u20b10"></div>' +
        '<button type="button" class="icon-btn r-remove" aria-label="Remove item"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>' +
      '</div>';
    }
    function addRow() {
      var wrap = document.createElement('div');
      wrap.innerHTML = rowHtml();
      rowsEl.appendChild(wrap.firstChild);
      syncRemove();
    }
    function syncRemove() {
      var rows = rowsEl.querySelectorAll('.pr-row');
      for (var i = 0; i < rows.length; i++) rows[i].querySelector('.r-remove').disabled = rows.length === 1;
    }
    function recalc() {
      var rows = rowsEl.querySelectorAll('.pr-row'), grand = 0;
      for (var i = 0; i < rows.length; i++) {
        var q = Number(rows[i].querySelector('.r-qty').value), p = Number(rows[i].querySelector('.r-price').value);
        var t = (q > 0 && p >= 0) ? round2(q * p) : 0;
        rows[i].querySelector('.r-total').value = peso(t);
        grand += t;
      }
      document.getElementById('po-grand').textContent = peso(grand);
    }
    addRow();

    document.getElementById('po-supplier').focus();
    document.getElementById('pr-new-close').addEventListener('click', m.close);
    document.getElementById('pr-new-cancel').addEventListener('click', m.close);
    document.getElementById('po-add-row').addEventListener('click', function () {
      addRow();
      var rows = rowsEl.querySelectorAll('.pr-row');
      rows[rows.length - 1].querySelector('.r-item').focus();
    });
    rowsEl.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.r-remove') : null;
      if (!b || b.disabled) return;
      rowsEl.removeChild(b.parentNode); syncRemove(); recalc();
    });
    rowsEl.addEventListener('change', function (e) {
      if (!e.target.classList.contains('r-item')) return;
      var opt = e.target.options[e.target.selectedIndex];
      e.target.parentNode.parentNode.querySelector('.r-unit').value = opt && opt.value ? (opt.getAttribute('data-unit') || '') : '';
    });
    rowsEl.addEventListener('input', recalc);

    document.getElementById('pr-new-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var lines = [], rows = rowsEl.querySelectorAll('.pr-row');
      for (var i = 0; i < rows.length; i++) {
        lines.push({
          itemId: rows[i].querySelector('.r-item').value,
          qtyRaw: rows[i].querySelector('.r-qty').value,
          priceRaw: rows[i].querySelector('.r-price').value
        });
      }
      var res = createPO({
        supplierId: document.getElementById('po-supplier').value,
        orderDate: document.getElementById('po-order').value,
        expectedDate: document.getElementById('po-expected').value,
        notes: document.getElementById('po-notes').value.trim(),
        lines: lines
      });
      if (res.error) { showError('pr-new-error', res.error); return; }
      m.close();
      // make sure the new order is visible: clear filters, show page 1, select it
      state.q = ''; state.supplier = 'all'; state.status = 'all'; state.range = 'all'; state.page = 1;
      document.getElementById('pr-search').value = '';
      document.getElementById('pr-filter-status').value = 'all';
      document.getElementById('pr-filter-date').value = 'all';
      els.supplierSel.value = 'all';
      state.selectedId = res.po.id; state.mode = 'detail';
      state.flash = res.po.poNumber + ' created. Inventory is unchanged until items are received.';
      render();
    });
  }

  // Creates a purchase order record ONLY — never touches inventory.
  function createPO(v) {
    var supplier = loadSuppliers().filter(function (s) { return s.id === v.supplierId; })[0];
    if (!supplier) return { error: 'Select a supplier.' };
    if (!validDate(v.orderDate)) return { error: 'Enter a valid order date.' };
    if (!validDate(v.expectedDate)) return { error: 'Enter a valid expected date.' };
    if (v.expectedDate < v.orderDate) return { error: 'Expected date cannot be before the order date.' };
    if (!v.lines.length) return { error: 'Add at least one ordered item.' };

    var items = [], seen = {};
    for (var i = 0; i < v.lines.length; i++) {
      var l = v.lines[i], n = i + 1;
      var inv = l.itemId ? PCData.getInventoryById(l.itemId) : null;
      if (!inv) return { error: 'Item ' + n + ': select an inventory item.' };
      if (seen[inv.id]) return { error: inv.name + ' is listed twice. Combine it into one line.' };
      seen[inv.id] = true;
      var qty = String(l.qtyRaw).trim() === '' ? NaN : Number(l.qtyRaw);
      if (isNaN(qty) || qty <= 0) return { error: inv.name + ': quantity must be greater than 0.' };
      if (!Number.isInteger(qty)) return { error: inv.name + ': quantity must be a whole number.' };
      var price = String(l.priceRaw).trim() === '' ? NaN : Number(l.priceRaw);
      if (isNaN(price) || price < 0) return { error: inv.name + ': enter a unit price of 0 or more.' };
      items.push({
        inventoryItemId: inv.id, itemName: inv.name, quantityOrdered: qty, quantityReceived: 0,
        unit: inv.unit || '', unitPrice: round2(price), total: round2(qty * price)
      });
    }
    var list = loadPOs();
    var now = Date.now();
    var po = {
      id: uid('po'), poNumber: nextPoNumber(list), supplierId: supplier.id,
      orderDate: v.orderDate, expectedDate: v.expectedDate, status: S_PENDING, notes: v.notes || '',
      items: items, totalValue: sumTotals(items), createdAt: now, updatedAt: now
    };
    list.push(po);
    savePOs(list);
    return { po: po };
  }

  // ------------------------------------------------------------------
  // Suppliers
  // ------------------------------------------------------------------
  function openSuppliersModal() {
    var m = openOverlay('wide', 'pr-sup-title', '');
    var q = '';

    function showList() {
      var pos = loadPOs();
      var counts = {};
      pos.forEach(function (p) { counts[p.supplierId] = (counts[p.supplierId] || 0) + 1; });
      var list = loadSuppliers().filter(function (s) {
        if (!q) return true;
        return [s.name, s.contactPerson, s.phone, s.email].join(' | ').toLowerCase().indexOf(q) !== -1;
      }).sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
      var rows = list.map(function (s) {
        return '<tr>' +
          '<td class="pr-c-sup2"><span class="pr-sup-name">' + escapeHtml(s.name) + '</span></td>' +
          '<td data-label="Contact">' + (escapeHtml(s.contactPerson) || '\u2014') + (s.phone ? '<div class="pr-soft-line">' + escapeHtml(s.phone) + '</div>' : '') + '</td>' +
          '<td data-label="Purchase Orders" class="pr-num-cell">' + (counts[s.id] || 0) + '</td>' +
          '<td data-label="Status"><span class="pr-pill ' + (s.status === 'Active' ? 'received' : 'draft') + '">' + escapeHtml(s.status) + '</span></td>' +
          '<td class="pr-c-act"><button type="button" class="btn btn-sm" data-edit="' + escapeAttr(s.id) + '" aria-label="Edit ' + escapeAttr(s.name) + '">Edit</button></td>' +
        '</tr>';
      }).join('') || '<tr class="pr-empty"><td colspan="5">' + (loadSuppliers().length ? 'No suppliers match your search.' : 'No suppliers yet.') + '</td></tr>';

      m.box.innerHTML =
        head('Suppliers', 'pr-sup-title', 'pr-sup-close') +
        '<div class="pr-body">' +
          '<div class="pr-sup-bar"><div class="search-field pr-sup-search"><span><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i></span>' +
            '<input type="search" id="pr-sup-q" placeholder="Search supplier..." aria-label="Search suppliers" autocomplete="off" value="' + escapeAttr(q) + '"></div>' +
            '<button type="button" id="pr-sup-add" class="btn btn-primary">+ Add Supplier</button></div>' +
          '<div class="pr-scroll"><table class="pr-table pr-sup-table"><thead><tr><th>Supplier</th><th>Contact</th><th>Purchase Orders</th><th>Status</th><th>Actions</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '</div>' +
        '<div class="modal-footer"><button type="button" id="pr-sup-done" class="btn">Close</button></div>';

      document.getElementById('pr-sup-close').addEventListener('click', m.close);
      document.getElementById('pr-sup-done').addEventListener('click', m.close);
      document.getElementById('pr-sup-add').addEventListener('click', function () { showForm(null); });
      var qi = document.getElementById('pr-sup-q');
      qi.addEventListener('input', function (e) {
        q = e.target.value.trim().toLowerCase();
        var pos = e.target.selectionStart;
        showList();
        var again = document.getElementById('pr-sup-q');
        again.focus(); try { again.setSelectionRange(pos, pos); } catch (x) { /* ignore */ }
      });
      m.box.querySelectorAll('[data-edit]').forEach(function (b) {
        b.addEventListener('click', function () {
          var s = loadSuppliers().filter(function (x) { return x.id === b.getAttribute('data-edit'); })[0];
          if (s) showForm(s);
        });
      });
    }

    function showForm(s) {
      var isEdit = !!s;
      s = s || { name: '', contactPerson: '', phone: '', email: '', address: '', status: 'Active' };
      m.box.innerHTML =
        head(isEdit ? 'Edit Supplier' : 'Add Supplier', 'pr-sup-title', 'pr-sf-close') +
        '<form id="pr-sf" novalidate><div class="pr-body"><div class="pr-grid">' +
          field('Supplier Name', 'sf-name', '<input type="text" id="sf-name" required value="' + escapeAttr(s.name) + '">', true) +
          field('Contact Person', 'sf-person', '<input type="text" id="sf-person" value="' + escapeAttr(s.contactPerson) + '">') +
          field('Phone', 'sf-phone', '<input type="text" id="sf-phone" value="' + escapeAttr(s.phone) + '">') +
          field('Email', 'sf-email', '<input type="email" id="sf-email" value="' + escapeAttr(s.email) + '">') +
          field('Status', 'sf-status', '<select id="sf-status"><option' + (s.status === 'Active' ? ' selected' : '') + '>Active</option><option' + (s.status === 'Inactive' ? ' selected' : '') + '>Inactive</option></select>') +
          field('Address', 'sf-address', '<textarea id="sf-address" rows="2">' + escapeHtml(s.address) + '</textarea>', true) +
        '</div></div>' +
        '<div id="pr-sf-error" class="pr-error pr-modal-error" role="alert"></div>' +
        '<div class="modal-footer"><button type="button" id="pr-sf-cancel" class="btn">Back</button>' +
          '<button type="submit" class="btn btn-primary">' + (isEdit ? 'Save Changes' : 'Add Supplier') + '</button></div></form>';
      document.getElementById('sf-name').focus();
      document.getElementById('pr-sf-close').addEventListener('click', m.close);
      document.getElementById('pr-sf-cancel').addEventListener('click', showList);
      document.getElementById('pr-sf').addEventListener('submit', function (e) {
        e.preventDefault();
        var err = saveSupplier(isEdit ? s.id : null, {
          name: document.getElementById('sf-name').value.trim(),
          contactPerson: document.getElementById('sf-person').value.trim(),
          phone: document.getElementById('sf-phone').value.trim(),
          email: document.getElementById('sf-email').value.trim(),
          address: document.getElementById('sf-address').value.trim(),
          status: document.getElementById('sf-status').value
        });
        if (err) { showError('pr-sf-error', err); return; }
        showList(); render();
      });
    }

    showList();
    var first = document.getElementById('pr-sup-q'); if (first) first.focus();
  }

  // Returns an error message, or '' when saved.
  function saveSupplier(id, v) {
    if (!v.name) return 'Supplier name is required.';
    if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) return 'Enter a valid email address.';
    var list = loadSuppliers();
    var dup = list.some(function (s) { return s.id !== id && s.name.toLowerCase() === v.name.toLowerCase(); });
    if (dup) return 'A supplier with this name already exists.';
    var now = Date.now();
    if (id) {
      var s = list.filter(function (x) { return x.id === id; })[0];
      if (!s) return 'Supplier not found.';
      Object.assign(s, v, { updatedAt: now });
    } else {
      list.push({ id: uid('sup'), name: v.name, contactPerson: v.contactPerson, phone: v.phone, email: v.email, address: v.address, status: v.status, createdAt: now, updatedAt: now });
    }
    saveSuppliers(list);
    return '';
  }

  // ------------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------------
  function validDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00').getTime()); }
  function parseIso(iso) {
    var p = String(iso || '').split('-').map(Number);
    if (p.length !== 3 || isNaN(p[0]) || isNaN(p[1]) || isNaN(p[2])) return null;
    return new Date(p[0], p[1] - 1, p[2]);
  }
  function formatDate(iso) {
    var d = parseIso(iso);
    return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '\u2014';
  }
  // "Oct 5" — the year is added only when it is not the current year
  function formatShortDate(iso) {
    var d = parseIso(iso);
    if (!d) return '\u2014';
    var opts = { month: 'short', day: 'numeric' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString('en-US', opts);
  }
  function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }
})();