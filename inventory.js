// ============================================================
// PAWSITIVE CARE — Inventory page
// Renders into the #inventory-root placeholder in inventory.html.
// All data access goes through PCData (see data-store.js), which
// owns the 'pcv1_inventory' localStorage key. This file has no
// storage logic of its own beyond what data-store.js exposes.
//
// The toolbar (search box + filters) is built once in buildShell()
// and never recreated — only the table body is rebuilt on every
// render. PCData.onChange() fires both on real data changes AND on
// a 1.5s safety-net poll, so rebuilding the whole page on every tick
// would keep stealing focus out of the search box while typing.
// ============================================================

(function () {
  'use strict';

  var state = {
    search: '',
    category: 'all',
    status: 'all',
    stock: 'all' // all | low | out | expired
  };

  var els = {};

  // Add/Edit modal only: set to that modal's closeModal() while it is open,
  // null otherwise. One document-level Escape listener (registered once)
  // reads it, so Escape does nothing when the modal is closed and never
  // touches the Adjust Stock modal.
  var itemModalCloser = null;
  document.addEventListener('keydown', function (e) {
    if (!itemModalCloser) return;
    if (e.key !== 'Escape' && e.key !== 'Esc') return;
    if (e.isComposing || e.keyCode === 229) return; // IME composition
    e.preventDefault();
    itemModalCloser();
  });

  // Adjust Stock modal only: same pattern as above, with its own closer, so
  // Escape closes whichever of the two modals is actually open and never
  // both. Registered once, not per open.
  var stockModalCloser = null;
  document.addEventListener('keydown', function (e) {
    if (!stockModalCloser) return;
    if (e.key !== 'Escape' && e.key !== 'Esc') return;
    if (e.isComposing || e.keyCode === 229) return; // IME composition
    e.preventDefault();
    stockModalCloser();
  });

  // Both modals declare aria-modal="true", so keyboard focus must stay inside
  // whichever one is open: Tab from the last control wraps to the first,
  // Shift+Tab from the first wraps to the last. Registered once; does nothing
  // when neither modal is open.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab' || e.isComposing) return;
    if (!itemModalCloser && !stockModalCloser) return;
    var box = document.querySelector('#inv-modal-overlay .inv-modal-box');
    if (!box) return;
    var all = box.querySelectorAll('button, input, select, textarea, a[href], [tabindex]');
    var items = [];
    for (var i = 0; i < all.length; i++) {
      if (!all[i].disabled && all[i].tabIndex >= 0 && all[i].offsetParent !== null) items.push(all[i]);
    }
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1], active = document.activeElement;
    if (e.shiftKey && (active === first || !box.contains(active))) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && (active === last || !box.contains(active))) {
      e.preventDefault(); first.focus();
    }
  });

  document.addEventListener('DOMContentLoaded', function () {
    if (!window.PCData || !PCData.getInventory) {
      console.error('inventory.js: PCData.getInventory not found — make sure data-store.js is loaded before inventory.js.');
      return;
    }
    buildShell();
    renderTable();
    PCData.onChange(renderTable);
  });

  // ------------------------------------------------------------------
  // shell (built once)
  // ------------------------------------------------------------------

  function buildShell() {
    var root = document.getElementById('inventory-root');
    if (!root) return;

    root.innerHTML =
      '<div class="page-toolbar">' +
        '<div>' +
          '<div style="font-size:20px; font-weight:800; margin-bottom:2px;">INVENTORY</div>' +
        '</div>' +
        '<button type="button" id="inv-add-btn" class="btn btn-sm btn-primary"><i class="fa-solid fa-plus"></i> Add Item</button>' +
      '</div>' +
      '<div id="inv-toolbar" class="filter-bar">' +
        '<div class="search-field">' +
          '<span><i class="fa-solid fa-magnifying-glass"></i></span>' +
          '<input type="text" id="inv-search" placeholder="Search by item name…">' +
        '</div>' +
        '<div class="filter-controls">' +
          '<select id="inv-filter-category" class="filter-select pc-select"></select>' +
          '<select id="inv-filter-status" class="filter-select pc-select">' +
            '<option value="all">All Statuses</option>' +
            '<option value="active">Active</option>' +
            '<option value="inactive">Inactive</option>' +
          '</select>' +
          '<select id="inv-filter-stock" class="filter-select pc-select">' +
            '<option value="all">All Stock</option>' +
            '<option value="in">In Stock</option>' +
            '<option value="low">Low Stock</option>' +
            '<option value="out">Out of Stock</option>' +
            '<option value="expired">Expired</option>' +
          '</select>' +
        '</div>' +
      '</div>' +
      '<div id="inv-count" class="inv-count"></div>' +
      '<div id="inv-table-wrap"></div>';

    els.search = document.getElementById('inv-search');
    els.filterCategory = document.getElementById('inv-filter-category');
    els.filterStatus = document.getElementById('inv-filter-status');
    els.filterStock = document.getElementById('inv-filter-stock');
    els.addBtn = document.getElementById('inv-add-btn');
    els.tableWrap = document.getElementById('inv-table-wrap');
    els.count = document.getElementById('inv-count');

    var catHtml = '<option value="all">All Categories</option>';
    (PCData.INV_CATEGORIES || []).forEach(function (c) {
      catHtml += '<option value="' + escapeAttr(c) + '">' + escapeHtml(c) + '</option>';
    });
    els.filterCategory.innerHTML = catHtml;

    els.search.addEventListener('input', function () {
      state.search = els.search.value;
      renderTable();
    });
    els.filterCategory.addEventListener('change', function () {
      state.category = els.filterCategory.value;
      renderTable();
    });
    els.filterStatus.addEventListener('change', function () {
      state.status = els.filterStatus.value;
      renderTable();
    });
    els.filterStock.addEventListener('change', function () {
      state.stock = els.filterStock.value;
      renderTable();
    });
    els.addBtn.addEventListener('click', function () {
      openItemModal(null);
    });

    // event delegation — table body is rebuilt on every render, so
    // listeners are attached once on the stable wrapper instead.
    els.tableWrap.addEventListener('click', function (e) {
      var editBtn = e.target.closest ? e.target.closest('[data-action="edit"]') : null;
      if (editBtn) {
        var item = PCData.getInventoryById(editBtn.getAttribute('data-id'));
        if (item) openItemModal(item);
        return;
      }
      var stockBtn = e.target.closest ? e.target.closest('[data-action="stock"]') : null;
      if (stockBtn) {
        var item2 = PCData.getInventoryById(stockBtn.getAttribute('data-id'));
        if (item2) openStockModal(item2);
      }
    });
  }

  // ------------------------------------------------------------------
  // table
  // ------------------------------------------------------------------

  // Stock-state filter (in | low | out | expired). Built on the store's own
  // PCData.isLowStock / PCData.isExpired so the threshold and date rules stay
  // owned by data-store.js. Note the store's isLowStock() is simply
  // quantity <= threshold, so it also returns true for zero-stock and expired
  // items; the exclusions below make Low / In / Out mutually exclusive.
  //   Out     = quantity === 0
  //   Expired = expiration date has passed
  //   Low     = quantity > 0, at/below threshold, not expired
  //   In      = quantity > 0, above threshold, not expired
  // These are stock ALERT states, so inactive items match none of them (they
  // still show under All Stock and the Status filter).
  function matchesStock(item, mode) {
    if (item.status !== 'active') return false;
    var expired = PCData.isExpired(item);
    if (mode === 'out') return item.quantity === 0;
    if (mode === 'expired') return expired;
    if (mode === 'low') return item.quantity > 0 && !expired && PCData.isLowStock(item);
    if (mode === 'in') return item.quantity > 0 && !expired && !PCData.isLowStock(item);
    return true;
  }

  function getFilteredItems() {
    var q = state.search.trim().toLowerCase();
    return PCData.getInventory().filter(function (item) {
      if (q && item.name.toLowerCase().indexOf(q) === -1) return false;
      if (state.category !== 'all' && item.category !== state.category) return false;
      if (state.status !== 'all' && item.status !== state.status) return false;
      if (state.stock !== 'all' && !matchesStock(item, state.stock)) return false;
      return true;
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  var TABLE_HEAD_HTML =
    '<thead><tr>' +
      '<th>Item</th>' +
      '<th>Category</th>' +
      '<th>Quantity</th>' +
      '<th>Unit</th>' +
      '<th>Unit Price</th>' +
      '<th>Expiration</th>' +
      '<th>Status</th>' +
      '<th>Actions</th>' +
    '</tr></thead>';

  function renderTable() {
    if (!els.tableWrap) return;
    var items = getFilteredItems();

    if (els.count) {
      els.count.textContent = items.length + ' item' + (items.length === 1 ? '' : 's');
    }

    if (!items.length) {
      // Keep the same table + header shell as the populated state (rather
      // than swapping in an unrelated empty-state block) so the layout
      // doesn't jump when filters return zero results.
      els.tableWrap.className = 'inv-table-wrap';
      els.tableWrap.innerHTML =
        '<table class="inv-table">' +
          TABLE_HEAD_HTML +
          '<tbody><tr class="inv-empty-row"><td colspan="8">No inventory items match your search/filters.</td></tr></tbody>' +
        '</table>';
      return;
    }

    var rows = items.map(function (item) {
      var low = PCData.isLowStock(item);
      var out = item.quantity === 0;
      var expired = PCData.isExpired(item);

      var qtyBadge = '';
      if (out) {
        qtyBadge = '<span class="inv-pill out">Out of Stock</span>';
      } else if (low) {
        qtyBadge = '<span class="inv-pill low">Low Stock</span>';
      }

      var expText = item.expirationDate ? formatExpiration(item.expirationDate) : '—';
      var expBadge = expired ? '<span class="inv-pill expired">Expired</span>' : '';

      return (
        '<tr>' +
          '<td><span class="inv-item-name">' + escapeHtml(item.name) + '</span></td>' +
          '<td class="inv-secondary">' + escapeHtml(item.category) + '</td>' +
          '<td>' +
            '<div class="inv-qty-stack">' +
              '<span class="inv-qty">' + item.quantity + '</span>' +
              qtyBadge +
            '</div>' +
          '</td>' +
          '<td class="inv-secondary">' + escapeHtml(item.unit || '—') + '</td>' +
          '<td class="inv-secondary inv-price-cell">' + formatPrice(item.unitPrice) + '</td>' +
          '<td>' +
            '<div class="inv-exp-stack">' +
              '<span class="inv-exp-date">' + expText + '</span>' +
              expBadge +
            '</div>' +
          '</td>' +
          '<td>' +
            '<span class="inv-status-badge ' + (item.status === 'active' ? 'active' : 'inactive') + '">' +
              (item.status === 'active' ? 'Active' : 'Inactive') +
            '</span>' +
          '</td>' +
          '<td>' +
            '<div class="inv-actions">' +
              '<button type="button" class="icon-btn" data-action="edit" data-id="' + item.id + '" aria-label="Edit ' + escapeAttr(item.name) + '" title="Edit ' + escapeAttr(item.name) + '"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>' +
              '<button type="button" class="btn btn-sm" data-action="stock" data-id="' + item.id + '" aria-label="Adjust stock for ' + escapeAttr(item.name) + '">Adjust Stock</button>' +
            '</div>' +
          '</td>' +
        '</tr>'
      );
    }).join('');

    els.tableWrap.className = 'inv-table-wrap';
    els.tableWrap.innerHTML =
      '<table class="inv-table">' +
        TABLE_HEAD_HTML +
        '<tbody>' + rows + '</tbody>' +
      '</table>';
  }

  // ------------------------------------------------------------------
  // add / edit modal
  // ------------------------------------------------------------------

  function openItemModal(existingItem) {
    var isEdit = !!existingItem;

    var overlay = document.createElement('div');
    overlay.id = 'inv-modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(31,42,42,0.45);' +
      'display:flex;align-items:center;justify-content:center;z-index:1000;';

    var box = document.createElement('div');
    box.className = 'inv-modal-box inv-item-modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'inv-modal-title');

    // Remember what opened the modal so focus can go back there on close.
    var opener = document.activeElement;
    if (!opener || opener === document.body) opener = isEdit ? null : els.addBtn;

    var categoryOptions = (PCData.INV_CATEGORIES || []).map(function (c) {
      var sel = existingItem && existingItem.category === c ? ' selected' : '';
      return '<option value="' + escapeAttr(c) + '"' + sel + '>' + escapeHtml(c) + '</option>';
    }).join('');

    box.innerHTML =
      '<div class="modal-head">' +
        '<h3 class="modal-title" id="inv-modal-title">' + (isEdit ? 'Edit Item' : 'Add Item') + '</h3>' +
        '<button type="button" id="inv-modal-close" class="modal-close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>' +
      '</div>' +
      '<form id="inv-item-form" novalidate>' +
        '<div class="form-grid">' +
        field('Item Name', 'f-name', '<input type="text" id="f-name" required value="' +
          (existingItem ? escapeAttr(existingItem.name) : '') + '">', '', true) +
        field('Category', 'f-category', '<select id="f-category">' + categoryOptions + '</select>') +
        field('Quantity', 'f-quantity', '<input type="number" id="f-quantity" min="0" step="1" required value="' +
          (existingItem ? existingItem.quantity : 0) + '">') +
        field('Unit', 'f-unit', '<input type="text" id="f-unit" placeholder="e.g. bottles, vials, boxes" value="' +
          (existingItem ? escapeAttr(existingItem.unit) : '') + '">') +
        field('Unit Price', 'f-price', '<input type="number" id="f-price" min="0" step="0.01" required value="' +
          (existingItem ? existingItem.unitPrice : 0) + '">') +
        field('Expiration Date (optional)', 'f-expiration', '<input type="date" id="f-expiration" value="' +
          (existingItem ? existingItem.expirationDate : '') + '">') +
        field('Low-Stock Threshold', 'f-threshold', '<input type="number" id="f-threshold" aria-describedby="f-threshold-help" min="0" step="1" required value="' +
          (existingItem ? existingItem.lowStockThreshold : 0) + '">',
          'Alert when available stock reaches this level.') +
        field('Status', 'f-status', '<select id="f-status">' +
          '<option value="active"' + (!existingItem || existingItem.status === 'active' ? ' selected' : '') + '>Active</option>' +
          '<option value="inactive"' + (existingItem && existingItem.status === 'inactive' ? ' selected' : '') + '>Inactive</option>' +
          '</select>') +
        '</div>' +
        '<div id="inv-form-error" class="inv-error" role="alert"></div>' +
        '<div class="modal-footer">' +
          '<button type="button" id="inv-cancel-btn" class="inv-btn-ghost">Cancel</button>' +
          '<button type="submit" class="inv-btn-primary">' + (isEdit ? 'Save Changes' : 'Add Item') + '</button>' +
        '</div>' +
      '</form>';

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    itemModalCloser = closeModal;
    document.getElementById('f-name').focus();

    document.getElementById('inv-cancel-btn').addEventListener('click', closeModal);
    document.getElementById('inv-modal-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeModal();
    });

    document.getElementById('inv-item-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var errBox = document.getElementById('inv-form-error');

      var name = document.getElementById('f-name').value.trim();
      var category = document.getElementById('f-category').value;
      var quantity = parseWholeCandidate(document.getElementById('f-quantity').value);
      var unit = document.getElementById('f-unit').value.trim();
      var unitPrice = parseFloat(document.getElementById('f-price').value);
      var expirationDate = document.getElementById('f-expiration').value; // '' if not set
      var lowStockThreshold = parseWholeCandidate(document.getElementById('f-threshold').value);
      var status = document.getElementById('f-status').value;

      var errors = [];
      if (!name) errors.push('Item name is required.');
      if (isNaN(quantity) || quantity < 0) errors.push('Quantity must be 0 or greater.');
      else if (!Number.isInteger(quantity)) errors.push('Quantity must be a whole number.');
      if (isNaN(unitPrice) || unitPrice < 0) errors.push('Unit price must be 0 or greater.');
      if (isNaN(lowStockThreshold) || lowStockThreshold < 0) errors.push('Low-stock threshold must be 0 or greater.');
      else if (!Number.isInteger(lowStockThreshold)) errors.push('Low-stock threshold must be a whole number.');

      if (errors.length) {
        errBox.textContent = errors.join(' ');
        errBox.style.display = 'block';
        return;
      }

      var fields = {
        name: name,
        category: category,
        quantity: quantity,
        unit: unit,
        unitPrice: unitPrice,
        expirationDate: expirationDate,
        lowStockThreshold: lowStockThreshold,
        status: status
      };

      if (isEdit) {
        // The form is pre-filled with the quantity as it was when the modal
        // opened. If it wasn't changed, don't send it: writing that old
        // value back would silently undo any stock adjustment made in the
        // meantime (e.g. from another tab). Only an intentional quantity
        // edit is saved.
        if (quantity === existingItem.quantity) delete fields.quantity;
        PCData.updateInventoryItem(existingItem.id, fields);
      } else {
        PCData.addInventoryItem(fields);
      }

      closeModal();
      renderTable();
      restoreFocus(); // the table was just rebuilt, so re-find the opener
    });

    function closeModal() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (itemModalCloser === closeModal) itemModalCloser = null;
      restoreFocus();
    }

    function restoreFocus() {
      var target = opener && opener.isConnected ? opener : null;
      if (!target && isEdit && els.tableWrap) {
        var btns = els.tableWrap.querySelectorAll('[data-action="edit"]');
        for (var i = 0; i < btns.length; i++) {
          if (btns[i].getAttribute('data-id') === String(existingItem.id)) { target = btns[i]; break; }
        }
      }
      if (target && target.focus) target.focus();
    }
  }

  // Quantity / threshold input: returns the exact number typed (NaN if blank
  // or not a number) so a fraction like 1.5 is rejected by the whole-number
  // check instead of being silently truncated the way parseInt would.
  function parseWholeCandidate(raw) {
    var s = String(raw == null ? '' : raw).trim();
    return s === '' ? NaN : Number(s);
  }

  function field(label, forId, inputHtml, helperText, isFull) {
    return '<div class="inv-field' + (isFull ? ' full' : '') + '">' +
      '<label for="' + forId + '">' + label + '</label>' +
      inputHtml +
      (helperText ? '<div class="inv-help" id="' + forId + '-help">' + helperText + '</div>' : '') +
      '</div>';
  }

  // ------------------------------------------------------------------
  // stock adjustment modal
  // ------------------------------------------------------------------

  function openStockModal(item) {
    var overlay = document.createElement('div');
    overlay.id = 'inv-modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(31,42,42,0.45);' +
      'display:flex;align-items:center;justify-content:center;z-index:1000;';

    var box = document.createElement('div');
    box.className = 'inv-modal-box inv-stock-modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'inv-stock-title');

    // Remember what opened the modal so focus can go back there on close.
    var opener = document.activeElement;
    if (!opener || opener === document.body) opener = null;
    var itemId = item.id;

    box.innerHTML =
      '<div class="modal-head">' +
        '<h3 class="modal-title" id="inv-stock-title">Adjust Stock</h3>' +
        '<button type="button" id="inv-stock-close" class="modal-close" aria-label="Close"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>' +
      '</div>' +
      '<div class="inv-stock-body">' +
        '<div class="inv-stock-info">' +
          '<div class="inv-stock-name">' + escapeHtml(item.name) + '</div>' +
          '<div class="inv-stock-current-line">Current stock: ' +
            '<strong id="inv-stock-current" aria-live="polite">' + item.quantity + '</strong> ' + escapeHtml(item.unit || '') + '</div>' +
        '</div>' +
        '<div class="inv-field">' +
          '<label for="inv-stock-amount">Amount</label>' +
          '<input type="number" id="inv-stock-amount" min="1" step="1" value="1">' +
        '</div>' +
      '</div>' +
      '<div id="inv-stock-error" class="inv-error" role="alert"></div>' +
      '<div class="modal-footer">' +
        '<button type="button" id="inv-stock-cancel" class="inv-btn-ghost" aria-label="Close Adjust Stock">Close</button>' +
        '<button type="button" id="inv-stock-decrease" class="inv-btn-ghost">– Decrease</button>' +
        '<button type="button" id="inv-stock-increase" class="inv-btn-primary">+ Increase</button>' +
      '</div>';

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    stockModalCloser = close;
    var amountInput = document.getElementById('inv-stock-amount');
    amountInput.focus();
    amountInput.select();

    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.getElementById('inv-stock-cancel').addEventListener('click', close);
    document.getElementById('inv-stock-close').addEventListener('click', close);
    document.getElementById('inv-stock-increase').addEventListener('click', function () { apply(1); });
    document.getElementById('inv-stock-decrease').addEventListener('click', function () { apply(-1); });

    function apply(sign) {
      var errBox = document.getElementById('inv-stock-error');
      var amtInput = document.getElementById('inv-stock-amount');
      var amt = parseWholeCandidate(amtInput.value);

      if (isNaN(amt) || amt <= 0) {
        errBox.textContent = 'Enter an amount greater than 0.';
        errBox.style.display = 'block';
        return;
      }
      if (!Number.isInteger(amt)) {
        errBox.textContent = 'Amount must be a whole number.';
        errBox.style.display = 'block';
        return;
      }

      var result = PCData.adjustStock(item.id, sign * amt);
      if (!result.ok) {
        errBox.textContent = 'Stock cannot go below 0. Current stock: ' +
          (result.item ? result.item.quantity : item.quantity) + '.';
        errBox.style.display = 'block';
        return;
      }

      errBox.style.display = 'none';
      item = result.item;
      document.getElementById('inv-stock-current').textContent = item.quantity;
      renderTable();
    }

    function close() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (stockModalCloser === close) stockModalCloser = null;
      restoreFocus();
    }

    // The table is rebuilt on every adjustment, so the original button is
    // usually detached by now — re-find this item's Adjust Stock button.
    function restoreFocus() {
      var target = opener && opener.isConnected ? opener : null;
      if (!target && els.tableWrap) {
        var btns = els.tableWrap.querySelectorAll('[data-action="stock"]');
        for (var i = 0; i < btns.length; i++) {
          if (btns[i].getAttribute('data-id') === String(itemId)) { target = btns[i]; break; }
        }
      }
      if (target && target.focus) target.focus();
    }
  }

  // ------------------------------------------------------------------
  // formatting / escaping helpers
  // ------------------------------------------------------------------

  function formatExpiration(iso) {
    if (PCData.formatDateLabel) {
      try { return PCData.formatDateLabel(iso); } catch (e) { return iso; }
    }
    return iso;
  }

  function formatPrice(n) {
    var num = Number(n) || 0;
    // Thousands-separated display only (e.g. ₱2,350.75) — the stored
    // value and currency behavior are unchanged.
    return '₱' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
  }
})();