// ============================================================
// PAWSITIVE CARE — Inventory Items page
// Renders into #inventory-items-root in inventory-items.html.
// All data goes through PCData (data-store.js), which owns the
// 'pcv1_inventory' key. No new data model, no duplicate demo data.
// The data store has no delete function, so Delete uses the exported
// PCData.getInventory() + PCData.saveInventory() pair.
// ============================================================
(function () {
  'use strict';

  var PAGE_SIZE = 10;
  var state = { q: '', category: 'all', status: 'all', page: 1 };
  var els = {};
  var lastRowsHtml = '';
  var lastCatKey = '';

  // One document-level Escape + focus-trap handler for whichever modal is open.
  var closeActiveModal = null;
  document.addEventListener('keydown', function (e) {
    if (!closeActiveModal || e.isComposing) return;
    if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); closeActiveModal(); return; }
    if (e.key !== 'Tab') return;
    var box = document.querySelector('#ii-modal-overlay .ii-modal');
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
    if (!window.PCData || !PCData.getInventory) {
      console.error('inventory-items.js: PCData.getInventory not found — load data-store.js first.');
      return;
    }
    buildShell();
    render();
    PCData.onChange(render);
  });

  // ------------------------------------------------------------------
  // status — calculated, never stored
  // ------------------------------------------------------------------
  var STATUS = {
    in:      { label: 'In Stock',     cls: 'in' },
    low:     { label: 'Low Stock',    cls: 'low' },
    out:     { label: 'Out of Stock', cls: 'out' },
    expired: { label: 'Expired',      cls: 'expired' }
  };

  function stockStatus(item) {
    if (Number(item.quantity) === 0) return 'out';
    if (PCData.isExpired(item)) return 'expired';
    if (Number(item.quantity) <= (Number(item.lowStockThreshold) || 0)) return 'low';
    return 'in';
  }

  // ------------------------------------------------------------------
  // shell (built once, so typing in search never loses focus)
  // ------------------------------------------------------------------
  function buildShell() {
    var root = document.getElementById('inventory-items-root');
    if (!root) return;
    root.innerHTML =
      '<div class="page-toolbar ii-header">' +
        '<div class="ii-header-text"><h1 class="ii-title">ITEMS</h1></div>' +
        '<div class="ii-header-actions">' +
          '<button type="button" id="ii-add" class="btn btn-sm btn-primary ii-add"><i class="fa-solid fa-plus" aria-hidden="true"></i> Add Item</button>' +
        '</div>' +
      '</div>' +
      '<section class="ii-panel">' +
        '<div class="filter-bar ii-filters">' +
          '<div class="search-field"><span><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i></span>' +
            '<input type="search" id="ii-search" placeholder="Search items..." aria-label="Search items by name" autocomplete="off"></div>' +
          '<select id="ii-filter-category" class="ii-select" aria-label="Filter by category"></select>' +
          '<select id="ii-filter-status" class="ii-select" aria-label="Filter by stock status">' +
            '<option value="all">All Stock Status</option><option value="in">In Stock</option><option value="low">Low Stock</option>' +
            '<option value="out">Out of Stock</option><option value="expired">Expired</option></select>' +
        '</div>' +
        '<div class="ii-scroll"><table class="ii-table"><thead><tr>' +
          '<th>Item</th><th>Category</th><th>Stock</th><th>Minimum Level</th><th>Unit</th><th>Expiration</th><th>Stock Status</th><th>Actions</th>' +
        '</tr></thead><tbody id="ii-tbody"></tbody></table></div>' +
        '<div class="ii-footer">' +
          '<p class="ii-count" id="ii-count" aria-live="polite"></p>' +
          '<div class="ii-pager" id="ii-pager" hidden>' +
            '<button type="button" class="btn btn-sm" id="ii-prev">Previous</button>' +
            '<div class="ii-pages" id="ii-pages" role="group" aria-label="Pagination"></div>' +
            '<button type="button" class="btn btn-sm" id="ii-next">Next</button>' +
          '</div>' +
        '</div>' +
      '</section>';

    els.search = document.getElementById('ii-search');
    els.cat = document.getElementById('ii-filter-category');
    els.status = document.getElementById('ii-filter-status');
    els.tbody = document.getElementById('ii-tbody');
    els.count = document.getElementById('ii-count');
    els.pager = document.getElementById('ii-pager');
    els.prev = document.getElementById('ii-prev');
    els.next = document.getElementById('ii-next');
    els.pages = document.getElementById('ii-pages');

    els.search.addEventListener('input', function () { state.q = els.search.value; state.page = 1; render(); });
    els.cat.addEventListener('change', function () { state.category = els.cat.value; state.page = 1; render(); });
    els.status.addEventListener('change', function () { state.status = els.status.value; state.page = 1; render(); });
    els.prev.addEventListener('click', function () { if (state.page > 1) { state.page--; render(); keepPagerFocus(); } });
    els.next.addEventListener('click', function () { state.page++; render(); keepPagerFocus(); });
    els.pages.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-page]') : null;
      if (!btn) return;
      var n = parseInt(btn.getAttribute('data-page'), 10);
      if (n && n !== state.page) { state.page = n; render(); keepPagerFocus(); }
    });
    document.getElementById('ii-add').addEventListener('click', function () { openItemModal(null); });

    els.tbody.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-action]') : null;
      if (!btn) return;
      var item = PCData.getInventoryById(btn.getAttribute('data-id'));
      if (!item) return;
      var act = btn.getAttribute('data-action');
      if (act === 'edit') openItemModal(item);
      else if (act === 'delete') openDeleteModal(item);
    });
  }

  // ------------------------------------------------------------------
  // render
  // ------------------------------------------------------------------
  function categoriesInData(all) {
    var seen = {}, list = [];
    all.forEach(function (i) { if (i.category && !seen[i.category]) { seen[i.category] = 1; list.push(i.category); } });
    var order = PCData.INV_CATEGORIES || [];
    list.sort(function (a, b) {
      var ia = order.indexOf(a), ib = order.indexOf(b);
      if (ia === -1) ia = 999; if (ib === -1) ib = 999;
      return ia - ib || (a < b ? -1 : 1);
    });
    return list;
  }

  function syncCategoryOptions(all) {
    var cats = categoriesInData(all);
    var key = cats.join('\u241F');
    if (key === lastCatKey) return;
    lastCatKey = key;
    els.cat.innerHTML = '<option value="all">All Categories</option>' + cats.map(function (c) {
      return '<option value="' + escapeAttr(c) + '">' + escapeHtml(c) + '</option>';
    }).join('');
    if (state.category !== 'all' && cats.indexOf(state.category) === -1) state.category = 'all';
    els.cat.value = state.category;
  }

  function filtered(all) {
    var q = state.q.trim().toLowerCase();
    return all.filter(function (i) {
      if (q && String(i.name || '').toLowerCase().indexOf(q) === -1) return false;
      if (state.category !== 'all' && i.category !== state.category) return false;
      if (state.status !== 'all' && stockStatus(i) !== state.status) return false;
      return true;
    }).sort(function (a, b) {
      return String(a.name || '').toLowerCase() < String(b.name || '').toLowerCase() ? -1 : 1;
    });
  }

  function render() {
    if (!els.tbody) return;
    var all = PCData.getInventory();
    syncCategoryOptions(all);
    var list = filtered(all);
    var pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (state.page > pages) state.page = pages;
    var start = (state.page - 1) * PAGE_SIZE;
    var shown = list.slice(start, start + PAGE_SIZE);

    var rows = shown.map(rowHtml).join('') ||
      '<tr class="ii-empty"><td colspan="8">' + (all.length ? 'No items match your search or filters.' : 'No inventory items yet.') + '</td></tr>';
    // "Showing 1–10 of 12 items": current page range vs. everything matching
    // the active search/filters.
    var total = list.length;
    var countText = !total ? 'No items to show' :
      'Showing ' + (shown.length === total ? total : (start + 1) + '\u2013' + (start + shown.length)) +
      ' of ' + total + (total === 1 ? ' item' : ' items');

    // PCData.onChange also fires on a poll; only touch the DOM when output changed.
    var sig = rows + '|' + countText + '|' + state.page + '/' + pages;
    if (sig !== lastRowsHtml) {
      lastRowsHtml = sig;
      els.tbody.innerHTML = rows;
      els.count.textContent = countText;
      els.pager.hidden = pages <= 1;
      els.pages.innerHTML = pageButtons(state.page, pages);
      els.prev.disabled = state.page <= 1;
      els.next.disabled = state.page >= pages;
    }
  }

  // Page numbers to show: all of them up to 7 pages, otherwise first/last,
  // the current page and its neighbours, with '…' for the gaps.
  function pageList(cur, total) {
    if (total <= 7) {
      var all = [];
      for (var n = 1; n <= total; n++) all.push(n);
      return all;
    }
    if (cur <= 4) return [1, 2, 3, 4, 5, '…', total];
    if (cur >= total - 3) return [1, '…', total - 4, total - 3, total - 2, total - 1, total];
    return [1, '…', cur - 1, cur, cur + 1, '…', total];
  }

  function pageButtons(cur, total) {
    return pageList(cur, total).map(function (p) {
      if (p === '…') return '<span class="ii-ellipsis" aria-hidden="true">…</span>';
      var active = p === cur;
      return '<button type="button" class="btn btn-sm ii-page' + (active ? ' btn-primary' : '') + '" data-page="' + p + '"' +
        (active ? ' aria-current="page"' : '') + ' aria-label="Page ' + p + '">' + p + '</button>';
    }).join('');
  }

  // The pager is rebuilt on every page change, so put keyboard focus back on
  // the current page number if the clicked control was replaced or disabled.
  function keepPagerFocus() {
    if (els.pager.contains(document.activeElement) && !document.activeElement.disabled) return;
    var cur = els.pages.querySelector('[aria-current="page"]');
    if (cur) cur.focus();
  }

  function rowHtml(i) {
    var s = STATUS[stockStatus(i)];
    var id = escapeAttr(i.id), nm = escapeAttr(i.name);
    return '<tr>' +
      '<td class="ii-c-item"><span class="ii-name">' + escapeHtml(i.name) + '</span>' +
        (i.status === 'inactive' ? '<span class="ii-inactive">Inactive</span>' : '') + '</td>' +
      '<td class="ii-c-cat ii-soft">' + escapeHtml(i.category) + '</td>' +
      '<td data-label="Stock" class="ii-num"><span class="ii-qty">' + escapeHtml(i.quantity) + '</span></td>' +
      '<td data-label="Minimum Level" class="ii-soft ii-num">' + escapeHtml(i.lowStockThreshold || 0) + '</td>' +
      '<td data-label="Unit" class="ii-soft">' + (escapeHtml(i.unit) || '—') + '</td>' +
      '<td data-label="Expiration" class="ii-soft ii-num ii-nowrap">' + formatDate(i.expirationDate) + '</td>' +
      '<td data-label="Stock Status"><span class="ii-pill ' + s.cls + '">' + s.label + '</span></td>' +
      '<td class="ii-c-act"><div class="ii-actions">' +
        '<button type="button" class="icon-btn" data-action="edit" data-id="' + id + '" aria-label="Edit ' + nm + '" title="Edit"><i class="fa-solid fa-pen" aria-hidden="true"></i><span class="act-txt">Edit</span></button>' +
        '<button type="button" class="icon-btn danger" data-action="delete" data-id="' + id + '" aria-label="Delete ' + nm + '" title="Delete"><i class="fa-solid fa-trash" aria-hidden="true"></i><span class="act-txt">Delete</span></button>' +
      '</div></td>' +
    '</tr>';
  }

  // ------------------------------------------------------------------
  // modal plumbing
  // ------------------------------------------------------------------
  function openOverlay(boxClass, labelId, innerHtml) {
    var opener = document.activeElement;
    var overlay = document.createElement('div');
    overlay.id = 'ii-modal-overlay';
    overlay.className = 'modal-overlay open';
    var box = document.createElement('div');
    box.className = 'modal-box ii-modal ' + boxClass;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', labelId);
    box.innerHTML = innerHtml;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    function close() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (closeActiveModal === close) closeActiveModal = null;
      var target = opener && opener.isConnected ? opener : null;
      if (target && target.focus) target.focus();
    }
    closeActiveModal = close;
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });
    return { overlay: overlay, box: box, close: close };
  }

  function head(title, id, closeId) {
    return '<div class="modal-head"><h3 class="modal-title" id="' + id + '">' + title + '</h3>' +
      '<button type="button" id="' + closeId + '" class="modal-close" aria-label="Close"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>';
  }

  function field(label, forId, inputHtml, helper, full) {
    return '<div class="ii-field' + (full ? ' full' : '') + '"><label for="' + forId + '">' + label + '</label>' + inputHtml +
      (helper ? '<div class="ii-help" id="' + forId + '-help">' + helper + '</div>' : '') + '</div>';
  }

  // ------------------------------------------------------------------
  // add / edit (Edit changes item information only, never quantity)
  // ------------------------------------------------------------------
  function openItemModal(existing) {
    var isEdit = !!existing;
    var cats = (PCData.INV_CATEGORIES || []).slice();
    if (isEdit && existing.category && cats.indexOf(existing.category) === -1) cats.push(existing.category);
    var catOptions = cats.map(function (c) {
      return '<option value="' + escapeAttr(c) + '"' + (existing && existing.category === c ? ' selected' : '') + '>' + escapeHtml(c) + '</option>';
    }).join('');

    var m = openOverlay('', 'ii-item-title',
      head(isEdit ? 'Edit Item' : 'Add Inventory Item', 'ii-item-title', 'ii-item-close') +
      '<form id="ii-item-form" novalidate>' +
        '<div class="form-grid ii-body">' +
          field('Item Name', 'f-name', '<input type="text" id="f-name" required value="' + (existing ? escapeAttr(existing.name) : '') + '">', '', true) +
          field('Category', 'f-category', '<select id="f-category">' + catOptions + '</select>') +
          (isEdit ? '' : field('Quantity', 'f-quantity', '<input type="number" id="f-quantity" min="0" step="1" required value="0">')) +
          field('Unit', 'f-unit', '<input type="text" id="f-unit" placeholder="e.g. bottles, vials, boxes" value="' + (existing ? escapeAttr(existing.unit) : '') + '">') +
          field('Unit Price', 'f-price', '<input type="number" id="f-price" min="0" step="0.01" required value="' + (existing ? existing.unitPrice : 0) + '">') +
          field('Expiration Date (optional)', 'f-expiration', '<input type="date" id="f-expiration" value="' + (existing ? escapeAttr(existing.expirationDate) : '') + '">') +
          field('Low-Stock Threshold', 'f-threshold', '<input type="number" id="f-threshold" aria-describedby="f-threshold-help" min="0" step="1" required value="' + (existing ? existing.lowStockThreshold : 0) + '">', 'Alert when available stock reaches this level.') +
          field('Status', 'f-status', '<select id="f-status"><option value="active"' + (!existing || existing.status === 'active' ? ' selected' : '') + '>Active</option>' +
            '<option value="inactive"' + (existing && existing.status === 'inactive' ? ' selected' : '') + '>Inactive</option></select>') +
        '</div>' +
        '<div id="ii-item-error" class="ii-error" role="alert"></div>' +
        '<div class="modal-footer"><button type="button" id="ii-item-cancel" class="btn">Cancel</button>' +
          '<button type="submit" class="btn btn-primary">' + (isEdit ? 'Save Changes' : 'Add Item') + '</button></div>' +
      '</form>');

    document.getElementById('f-name').focus();
    document.getElementById('ii-item-close').addEventListener('click', m.close);
    document.getElementById('ii-item-cancel').addEventListener('click', m.close);

    document.getElementById('ii-item-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var errBox = document.getElementById('ii-item-error');
      var name = document.getElementById('f-name').value.trim();
      var quantity = isEdit ? null : parseWhole(document.getElementById('f-quantity').value);
      var unitPrice = parseFloat(document.getElementById('f-price').value);
      var threshold = parseWhole(document.getElementById('f-threshold').value);
      var errors = [];
      if (!name) errors.push('Item name is required.');
      if (!isEdit) {
        if (isNaN(quantity) || quantity < 0) errors.push('Quantity must be 0 or greater.');
        else if (!Number.isInteger(quantity)) errors.push('Quantity must be a whole number.');
      }
      if (isNaN(unitPrice) || unitPrice < 0) errors.push('Unit price must be 0 or greater.');
      if (isNaN(threshold) || threshold < 0) errors.push('Low-stock threshold must be 0 or greater.');
      else if (!Number.isInteger(threshold)) errors.push('Low-stock threshold must be a whole number.');
      if (errors.length) { errBox.textContent = errors.join(' '); errBox.style.display = 'block'; return; }

      var fields = {
        name: name,
        category: document.getElementById('f-category').value,
        unit: document.getElementById('f-unit').value.trim(),
        unitPrice: unitPrice,
        expirationDate: document.getElementById('f-expiration').value,
        lowStockThreshold: threshold,
        status: document.getElementById('f-status').value
      };
      if (isEdit) {
        // Item information only — quantity is never part of an Edit.
        PCData.updateInventoryItem(existing.id, fields);
      } else {
        fields.quantity = quantity; // opening stock for a new item
        PCData.addInventoryItem(fields);
      }
      m.close();
      render();
    });
  }

  // ------------------------------------------------------------------
  // delete (confirmation required)
  // ------------------------------------------------------------------
  function openDeleteModal(item) {
    var m = openOverlay('narrow', 'ii-del-title',
      head('Delete Item', 'ii-del-title', 'ii-del-close') +
      '<div class="ii-body"><p>Delete <strong>' + escapeHtml(item.name) + '</strong> from inventory? This permanently removes the item and cannot be undone.</p></div>' +
      '<div class="modal-footer"><button type="button" id="ii-del-cancel" class="btn">Cancel</button>' +
        '<button type="button" id="ii-del-confirm" class="btn btn-danger">Delete Item</button></div>');
    document.getElementById('ii-del-cancel').focus();
    document.getElementById('ii-del-close').addEventListener('click', m.close);
    document.getElementById('ii-del-cancel').addEventListener('click', m.close);
    document.getElementById('ii-del-confirm').addEventListener('click', function () {
      var rest = PCData.getInventory().filter(function (i) { return i.id !== item.id; });
      PCData.saveInventory(rest);
      m.close();
      render();
    });
  }

  // ------------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------------
  function parseWhole(raw) {
    var s = String(raw == null ? '' : raw).trim();
    return s === '' ? NaN : Number(s);
  }

  function formatDate(iso) {
    var p = String(iso || '').split('-').map(Number);
    if (p.length !== 3 || isNaN(p[0])) return '—';
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }
})();