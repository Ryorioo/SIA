// ============================================================
// PAWSITIVE CARE — Inventory › Inventory History
// READ-ONLY audit page. It lists the stock movements that Stock
// Management records and shows one item's activity next to them.
//
// It never changes anything:
//   - movements are only READ from 'pcv1_stock_movements'
//   - items are only READ through PCData.getInventory()
//   - no stock-changing functions are called anywhere in this file
//
// Movement record (written by inventory-stock-management.js):
// { id:'SM-001', inventoryItemId, itemName, type:'Stock In'|'Stock Out'|'Adjustment',
//   quantity, unit, date:'YYYY-MM-DD', reference, reason, notes, user }
// Records do not store a category, so it is looked up from the
// current inventory item. If the item was deleted, the stored
// itemName is kept and the category shows as "—".
// ============================================================
(function () {
  'use strict';

  var MOVEMENT_KEY = 'pcv1_stock_movements';
  var TYPE_IN = 'Stock In', TYPE_OUT = 'Stock Out', TYPE_ADJ = 'Adjustment';
  var TYPE_BADGE = {};
  TYPE_BADGE[TYPE_IN] = 'in'; TYPE_BADGE[TYPE_OUT] = 'out'; TYPE_BADGE[TYPE_ADJ] = 'adj';

  var PAGE_SIZE = 10;
  var state = { q: '', category: 'all', type: 'all', range: 'all', page: 1, selectedRecordId: null, focusId: null };
  var els = {};
  var lastTableSig = '';
  var lastPanelSig = '';

  // ------------------------------------------------------------------
  // data (read only)
  // ------------------------------------------------------------------
  function loadMovements() {
    var list = null;
    try {
      list = (window.PCData && PCData.__readRaw)
        ? PCData.__readRaw(MOVEMENT_KEY)
        : JSON.parse(localStorage.getItem(MOVEMENT_KEY));
    } catch (e) { list = null; }
    return Array.isArray(list) ? list : [];
  }

  // itemKey() identifies the INVENTORY ITEM (used only to gather an item's
  // activity). It is never used to select or highlight a table row — rows are
  // selected by their own unique record id (see decorate()).
  // A record with no item id (should not happen) falls back to its stored name.
  function itemKey(m) {
    return m.inventoryItemId ? String(m.inventoryItemId) : 'name:' + String(m.itemName || '');
  }

  function inventoryMap() {
    var map = {};
    PCData.getInventory().forEach(function (i) { map[i.id] = i; });
    return map;
  }

  function idNumber(m) {
    var n = parseInt(String(m.id).replace(/\D/g, ''), 10);
    return isNaN(n) ? 0 : n;
  }

  // Newest first: later date first, then the later-recorded movement.
  function newestFirst(a, b) {
    var da = String(a.date || ''), db = String(b.date || '');
    if (da !== db) return da < db ? 1 : -1;
    return idNumber(b) - idNumber(a);
  }

  function signedQuantity(m) {
    var q = Number(m.quantity) || 0;
    if (m.type === TYPE_OUT) return -Math.abs(q);
    if (m.type === TYPE_IN) return Math.abs(q);
    return q; // Adjustment is already signed
  }

  function statusLabel(m) { return m.type === TYPE_ADJ ? 'Adjusted' : 'Completed'; }

  // Same rule the Items page uses (status is calculated, never stored).
  function stockStatus(item) {
    if (Number(item.quantity) === 0) return { label: 'Out of Stock', cls: 's-out' };
    if (PCData.isExpired && PCData.isExpired(item)) return { label: 'Expired', cls: 's-expired' };
    if (Number(item.quantity) <= (Number(item.lowStockThreshold) || 0)) return { label: 'Low Stock', cls: 's-low' };
    return { label: 'In Stock', cls: 's-in' };
  }

  // Adds the current inventory item / category to each record (copies — stored records are not touched).
  // Each row also gets `rid`, a unique history-record id that is separate from the
  // inventory item id. It is the movement's own id ('SM-001'); if a stored record has
  // no id, or repeats one already used, a unique one is derived from its position so
  // two records can never share an id.
  function decorate(movements, inv) {
    var seen = {};
    return movements.map(function (m, idx) {
      var item = m.inventoryItemId ? inv[m.inventoryItemId] : null;
      var rid = (m.id == null || m.id === '') ? 'rec-' + idx : String(m.id);
      if (seen[rid]) rid = rid + '#' + idx;
      seen[rid] = true;
      return {
        m: m,
        rid: rid,
        key: itemKey(m),
        item: item || null,
        name: item ? item.name : (m.itemName || 'Unknown item'),
        category: item ? (item.category || '\u2014') : '\u2014'
      };
    });
  }

  function inDateRange(iso, range) {
    if (range === 'all') return true;
    var today = PCData.todayStr();
    var from = range === 'today' ? today : range === '7' ? PCData.dateStr(-6) : PCData.dateStr(-29);
    var d = String(iso || '');
    return d >= from && d <= today; // ISO dates compare correctly as strings
  }

  function applyFilters(rows) {
    var q = state.q.trim().toLowerCase();
    return rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.type !== 'all' && r.m.type !== state.type) return false;
      if (!inDateRange(r.m.date, state.range)) return false;
      if (q) {
        var ref = String(r.m.reference || '').toLowerCase();
        if (r.name.toLowerCase().indexOf(q) === -1 && ref.indexOf(q) === -1) return false;
      }
      return true;
    }).sort(function (a, b) { return newestFirst(a.m, b.m); });
  }

  // ------------------------------------------------------------------
  // start-up
  // ------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', function () {
    if (!window.PCData || !PCData.getInventory || !PCData.__readRaw) {
      console.error('inventory-history.js: PCData not found — load data-store.js first.');
      return;
    }
    buildShell();
    render();
    if (PCData.onChange) PCData.onChange(render);
    // movements saved from another tab (data-store only watches its own keys)
    window.addEventListener('storage', function (e) { if (e.key === MOVEMENT_KEY) render(); });
  });

  // ------------------------------------------------------------------
  // page shell (built once, so typing in search keeps focus)
  // ------------------------------------------------------------------
  function buildShell() {
    var root = document.getElementById('inventory-history-root');
    if (!root) return;
    root.innerHTML =
      '<div class="page-toolbar ih-header">' +
        '<div class="ih-header-text"><h1 class="ih-title">INVENTORY HISTORY</h1></div>' +
      '</div>' +
      '<div class="ih-layout">' +
        '<section class="ih-panel" aria-label="Stock movement history">' +
          '<div class="filter-bar ih-filters">' +
            '<div class="search-field"><span><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i></span>' +
              '<input type="search" id="ih-search" placeholder="Search item or reference..." aria-label="Search by item name or reference" autocomplete="off"></div>' +
            '<select id="ih-filter-category" class="ih-select" aria-label="Filter by category">' +
              '<option value="all">All Categories</option><option value="Medicine">Medicine</option><option value="Vaccine">Vaccine</option>' +
              '<option value="Supply">Supply</option><option value="Consumable">Consumable</option></select>' +
            '<select id="ih-filter-type" class="ih-select" aria-label="Filter by movement type">' +
              '<option value="all">All Movement Types</option><option value="' + TYPE_IN + '">Stock In</option>' +
              '<option value="' + TYPE_OUT + '">Stock Out</option><option value="' + TYPE_ADJ + '">Adjustment</option></select>' +
            '<select id="ih-filter-date" class="ih-select" aria-label="Filter by date">' +
              '<option value="all">All Dates</option><option value="today">Today</option>' +
              '<option value="7">Last 7 Days</option><option value="30">Last 30 Days</option></select>' +
          '</div>' +
          '<div class="ih-scroll"><table class="ih-table"><thead><tr>' +
            '<th>Date</th><th>Item</th><th>Category</th><th>Movement</th><th>Quantity</th><th>Reference</th><th>User</th><th>Status</th>' +
          '</tr></thead><tbody id="ih-tbody"></tbody></table></div>' +
          '<div class="ih-footer">' +
            '<p class="ih-foot-count" id="ih-count" aria-live="polite"></p>' +
            '<div class="ih-pager" id="ih-pager" hidden>' +
              '<button type="button" class="btn btn-sm" id="ih-prev">Previous</button>' +
              '<div class="ih-pages" id="ih-pages" role="group" aria-label="Pagination"></div>' +
              '<button type="button" class="btn btn-sm" id="ih-next">Next</button>' +
            '</div>' +
          '</div>' +
        '</section>' +
        '<aside class="ih-side" id="ih-detail-panel" aria-labelledby="ih-detail-title">' +
          '<div class="ih-side-head"><h2 class="ih-side-title" id="ih-detail-title">Inventory Activity</h2></div>' +
          '<div id="ih-detail" aria-live="polite"></div>' +
        '</aside>' +
      '</div>';

    els.tbody = document.getElementById('ih-tbody');
    els.count = document.getElementById('ih-count');
    els.pager = document.getElementById('ih-pager');
    els.prev = document.getElementById('ih-prev');
    els.next = document.getElementById('ih-next');
    els.pages = document.getElementById('ih-pages');
    els.detail = document.getElementById('ih-detail');
    els.detailPanel = document.getElementById('ih-detail-panel');

    document.getElementById('ih-search').addEventListener('input', function (e) { state.q = e.target.value; state.page = 1; render(); });
    document.getElementById('ih-filter-category').addEventListener('change', function (e) { state.category = e.target.value; state.page = 1; render(); });
    document.getElementById('ih-filter-type').addEventListener('change', function (e) { state.type = e.target.value; state.page = 1; render(); });
    document.getElementById('ih-filter-date').addEventListener('change', function (e) { state.range = e.target.value; state.page = 1; render(); });
    els.prev.addEventListener('click', function () { if (state.page > 1) { state.page--; render(); keepPagerFocus(); } });
    els.next.addEventListener('click', function () { state.page++; render(); keepPagerFocus(); });
    els.pages.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-page]') : null;
      if (!btn) return;
      var n = parseInt(btn.getAttribute('data-page'), 10);
      if (n && n !== state.page) { state.page = n; render(); keepPagerFocus(); }
    });

    // clicking anywhere on a row (or pressing Enter / Space on it) selects that exact
    // record only (no navigation, nothing is saved)
    els.tbody.addEventListener('click', function (e) {
      var row = e.target.closest ? e.target.closest('tr[data-record-id]') : null;
      if (!row) return;
      selectRecord(row.getAttribute('data-record-id'));
    });
    els.tbody.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      var row = e.target.closest ? e.target.closest('tr[data-record-id]') : null;
      if (!row || e.target !== row) return;
      e.preventDefault(); // Space must not scroll the page
      selectRecord(row.getAttribute('data-record-id'));
    });
  }

  // The one selection function: selects a single history record by its unique record id.
  function selectRecord(recordId) {
    state.selectedRecordId = recordId;
    state.focusId = recordId;
    render();
    // when the page is stacked, the panel sits below the list — bring it into view
    if (window.matchMedia && els.detailPanel.getBoundingClientRect().top > window.innerHeight * 0.6 && els.detailPanel.scrollIntoView) {
      var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      els.detailPanel.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
    }
  }

  // ------------------------------------------------------------------
  // render
  // ------------------------------------------------------------------
  function render() {
    if (!els.tbody) return;
    var all = loadMovements();
    var inv = inventoryMap();
    var rows = decorate(all, inv);
    var filtered = applyFilters(rows);

    // the selected record must still be in the filtered list, otherwise clear it
    if (state.selectedRecordId !== null) {
      var stillThere = filtered.some(function (r) { return r.rid === state.selectedRecordId; });
      if (!stillThere) state.selectedRecordId = null;
    }

    var pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (state.page > pages) state.page = pages;
    var shown = filtered.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);

    renderTable(shown, filtered.length, all.length, pages);
    renderDetail(rows, inv);
  }

  function renderTable(shown, filteredCount, totalCount, pages) {
    var body;
    if (shown.length) {
      body = shown.map(rowHtml).join('');
    } else if (!totalCount) {
      body = '<tr class="ih-empty"><td colspan="8">No stock movements recorded yet.<br>Movements appear here once stock is received, used or adjusted in Stock Management.</td></tr>';
    } else {
      body = '<tr class="ih-empty"><td colspan="8">No stock movements match your filters.</td></tr>';
    }
    // "Showing 1\u201310 of 24 movements": current page range vs. everything matching the filters
    var start = (state.page - 1) * PAGE_SIZE;
    var countText = !filteredCount ? 'No movements to show' :
      'Showing ' + (shown.length === filteredCount ? filteredCount : (start + 1) + '\u2013' + (start + shown.length)) +
      ' of ' + filteredCount + (filteredCount === 1 ? ' movement' : ' movements') +
      (filteredCount !== totalCount ? ' (filtered from ' + totalCount + ')' : '');

    // PCData.onChange also fires on a poll; only touch the DOM if something changed.
    var sig = body + '|' + countText + '|' + state.page + '/' + pages;
    if (sig === lastTableSig) { state.focusId = null; return; }
    lastTableSig = sig;
    els.tbody.innerHTML = body;
    els.count.textContent = countText;
    els.pager.hidden = pages <= 1;
    els.pages.innerHTML = pageButtons(state.page, pages);
    els.prev.disabled = state.page <= 1;
    els.next.disabled = state.page >= pages;

    // keep keyboard focus on the row that was just selected (the table was re-drawn)
    if (state.focusId) {
      var again = els.tbody.querySelector('tr[data-record-id="' + cssEscape(state.focusId) + '"]');
      if (again && again.focus) again.focus();
      state.focusId = null;
    }
  }

  // Page numbers: all up to 7 pages, otherwise first/last + current and neighbours with gaps.
  function pageList(cur, total) {
    var n, all = [];
    if (total <= 7) { for (n = 1; n <= total; n++) all.push(n); return all; }
    if (cur <= 4) return [1, 2, 3, 4, 5, '\u2026', total];
    if (cur >= total - 3) return [1, '\u2026', total - 4, total - 3, total - 2, total - 1, total];
    return [1, '\u2026', cur - 1, cur, cur + 1, '\u2026', total];
  }

  function pageButtons(cur, total) {
    return pageList(cur, total).map(function (p) {
      if (p === '\u2026') return '<span class="ih-ellipsis" aria-hidden="true">\u2026</span>';
      var active = p === cur;
      return '<button type="button" class="btn btn-sm ih-page' + (active ? ' btn-primary' : '') + '" data-page="' + p + '"' +
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

  function rowHtml(r) {
    var m = r.m;
    var q = signedQuantity(m);
    var selected = state.selectedRecordId !== null && r.rid === state.selectedRecordId;
    var type = TYPE_BADGE[m.type] ? m.type : null;
    var unit = r.item ? (r.item.unit || m.unit || '') : (m.unit || '');
    return '<tr data-record-id="' + escapeAttr(r.rid) + '" tabindex="0"' + (selected ? ' class="is-selected" aria-current="true"' : '') + '>' +
      '<td data-label="Date" class="ih-soft ih-num ih-nowrap" title="' + escapeAttr(formatDate(m.date)) + '">' + formatShortDate(m.date) + '</td>' +
      '<td class="ih-c-item">' +
        '<span class="ih-item-btn" title="View activity for ' + escapeAttr(r.name) + '">' + escapeHtml(r.name) + '</span>' +
        (r.item ? '' : '<span class="ih-removed">Removed</span>') +
      '</td>' +
      '<td data-label="Category" class="ih-soft">' + escapeHtml(r.category) + '</td>' +
      '<td data-label="Movement">' + (type ? '<span class="ih-pill ' + TYPE_BADGE[type] + '">' + escapeHtml(type) + '</span>' : '\u2014') + '</td>' +
      '<td data-label="Quantity" class="ih-num"><span><span class="ih-qty ' + qtyClass(q) + '">' + formatSigned(q) + '</span>' + (unit ? '<span class="ih-unit">' + escapeHtml(unit) + '</span>' : '') + '</span></td>' +
      '<td data-label="Reference" class="ih-soft ih-nowrap">' + (escapeHtml(m.reference) || '\u2014') + '</td>' +
      '<td data-label="User" class="ih-soft">' + (escapeHtml(m.user) || '\u2014') + '</td>' +
      '<td data-label="Status"><span class="ih-status">' + statusLabel(m) + '</span></td>' +
    '</tr>';
  }

  // ------------------------------------------------------------------
  // right panel: Inventory Activity
  // ------------------------------------------------------------------
  function renderDetail(rows, inv) {
    var html;
    var chosen = null;
    if (state.selectedRecordId !== null) {
      for (var i = 0; i < rows.length; i++) { if (rows[i].rid === state.selectedRecordId) { chosen = rows[i]; break; } }
    }
    if (!chosen) {
      html =
        '<div class="ih-detail-empty">' +
          '<span class="ih-empty-icon" aria-hidden="true"><i class="fa-solid fa-clock-rotate-left"></i></span>' +
          '<div class="ih-empty-text">Click a record to view its inventory activity.</div>' +
        '</div>';
    } else {
      // the item's movements (not limited by the table filters), newest first;
      // only the exact selected record is marked as current
      var own = rows.filter(function (r) { return r.key === chosen.key; })
        .sort(function (a, b) { return newestFirst(a.m, b.m); });
      html = own.length ? detailHtml(own, chosen.rid) : '';
    }
    if (html === lastPanelSig) return;
    lastPanelSig = html;
    els.detail.innerHTML = html;
    // bring the selected record's activity into view inside the (scrollable) list
    var cur = els.detail.querySelector('.ih-act.is-current');
    var list = cur ? els.detail.querySelector('.ih-hist-list') : null;
    if (list) list.scrollTop = Math.max(0, cur.offsetTop - 8);
  }

  function detailHtml(own, currentId) {
    var latest = own[0];
    var item = latest.item;          // current inventory item, or null if it was deleted
    var unit = item ? (item.unit || '') : (latest.m.unit || '');
    var head, info;

    if (item) {
      var s = stockStatus(item);
      var u = unit ? ' ' + escapeHtml(unit) : '';
      head =
        '<h3 class="ih-item-name">' + escapeHtml(item.name) + '</h3>' +
        '<div class="ih-item-meta">' + escapeHtml(item.category || '\u2014') + (unit ? ' \u00b7 ' + escapeHtml(unit) : '') + '</div>';
      info =
        '<dl class="ih-info">' +
          '<div><dt>Current Stock</dt><dd>' + escapeHtml(item.quantity) + u + '</dd></div>' +
          '<div><dt>Minimum Level</dt><dd>' + escapeHtml(Number(item.lowStockThreshold) || 0) + u + '</dd></div>' +
          '<div><dt>Stock Status</dt><dd><span class="ih-pill ' + s.cls + '">' + s.label + '</span></dd></div>' +
        '</dl>';
    } else {
      head =
        '<h3 class="ih-item-name">' + escapeHtml(latest.name) + '</h3>' +
        '<div class="ih-item-meta">Removed item' + (unit ? ' \u00b7 ' + escapeHtml(unit) : '') + '</div>';
      info =
        '<div class="ih-notice"><strong>Item Removed</strong>' +
        '<p>This item is no longer in the current inventory, but its historical movements are retained.</p></div>';
    }

    return '<div class="ih-detail">' + head + info +
      '<div class="ih-hist-head"><h3 class="ih-hist-title">Activity History</h3>' +
        '<span class="ih-count">' + own.length + (own.length === 1 ? ' record' : ' records') + '</span></div>' +
      '<ul class="ih-hist-list">' + own.map(function (r) { return activityHtml(r, r.rid === currentId); }).join('') + '</ul>' +
    '</div>';
  }

  function activityHtml(r, isCurrent) {
    var m = r.m;
    var q = signedQuantity(m);
    var sub = [];
    sub.push('Ref: ' + (escapeHtml(m.reference) || '\u2014'));
    if (m.user) sub.push(escapeHtml(m.user));
    var note = [];
    if (m.reason) note.push(escapeHtml(m.reason));
    if (m.notes) note.push(escapeHtml(m.notes));
    return '<li class="ih-act' + (isCurrent ? ' is-current' : '') + '" data-record-id="' + escapeAttr(r.rid) + '"' + (isCurrent ? ' aria-current="true"' : '') + '>' +
      '<div class="ih-act-top">' +
        '<span class="ih-act-date" title="' + escapeAttr(formatDate(m.date)) + '">' + formatShortDate(m.date) + '</span>' +
        (TYPE_BADGE[m.type] ? '<span class="ih-pill ' + TYPE_BADGE[m.type] + '">' + escapeHtml(m.type) + '</span>' : '') +
        '<span class="ih-act-qty ' + qtyClass(q) + '">' + formatSigned(q) + '</span>' +
      '</div>' +
      '<div class="ih-act-sub">' + sub.join(' \u00b7 ') + '</div>' +
      (note.length ? '<div class="ih-act-note">' + note.join(' \u2014 ') + '</div>' : '') +
    '</li>';
  }

  // ------------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------------
  function qtyClass(q) { return q > 0 ? 'plus' : q < 0 ? 'minus' : ''; }
  function formatSigned(n) { return (n > 0 ? '+' : n < 0 ? '\u2212' : '') + Math.abs(n); }

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

  function cssEscape(s) { return String(s).replace(/["\\]/g, '\\$&'); }
  function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }
})();