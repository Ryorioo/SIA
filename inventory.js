// ============================================================
// PAWSITIVE CARE — Inventory page
// Renders into the #inventory-root placeholder in inventory.html.
// All data access goes through PCData (see data-store.js), which
// owns the 'pcv1_inventory' localStorage key. This file has no
// storage logic of its own beyond what data-store.js exposes.
//
// The header is built once in buildShell() and never recreated —
// only the overview body is rebuilt, and only when its output changes. PCData.onChange() fires both on real data changes AND on
// a 1.5s safety-net poll, so rebuilding the whole page on every tick
// would keep stealing focus out of the search box while typing.
// ============================================================

(function () {
  'use strict';

  var els = {};

  // Add/Edit modal only: set to that modal's closeModal() while it is open,
  // null otherwise. One document-level Escape listener (registered once)
  // reads it, so Escape does nothing when the modal is closed.
  var itemModalCloser = null;
  document.addEventListener('keydown', function (e) {
    if (!itemModalCloser) return;
    if (e.key !== 'Escape' && e.key !== 'Esc') return;
    if (e.isComposing || e.keyCode === 229) return; // IME composition
    e.preventDefault();
    itemModalCloser();
  });

  // The modal declares aria-modal="true", so keyboard focus must stay inside
  // it: Tab from the last control wraps to the first, Shift+Tab from the
  // first wraps to the last. Registered once; does nothing when it is closed.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab' || e.isComposing) return;
    if (!itemModalCloser) return;
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
    renderOverview();
    PCData.onChange(renderOverview);
  });

  // ------------------------------------------------------------------
  // overview shell (built once) + overview body (re-rendered on change)
  // ------------------------------------------------------------------

  // "Expiring soon" window. The data store has no such setting, so it is a
  // frontend constant here (not a new data model).
  var EXPIRY_WARN_DAYS = 30;
  var PANEL_ROW_LIMIT = 6;
  var ACTIVITY_LIMIT = 5;
  var lastHtml = '';

  function buildShell() {
    var root = document.getElementById('inventory-root');
    if (!root) return;

    root.innerHTML =
      '<div class="page-toolbar ov-header">' +
        '<div class="ov-header-text">' +
          '<h1 class="ov-title">INVENTORY</h1>' +
        '</div>' +
        '<div class="ov-header-actions">' +
          '<a class="btn btn-sm" href="inventory-items.html"><i class="fa-solid fa-boxes-stacked" aria-hidden="true"></i> View Items</a>' +
          '<a class="btn btn-sm btn-primary" href="inventory-stock-management.html"><i class="fa-solid fa-arrow-right-arrow-left" aria-hidden="true"></i> Manage Stock</a>' +
        '</div>' +
      '</div>' +
      '<div id="inv-overview"></div>';

    // The overview body container (rebuilt by renderOverview on change).
    els.tableWrap = document.getElementById('inv-overview');
  }

  function isoOffset(days) {
    var d = new Date();
    d.setDate(d.getDate() + days);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  function computeOverview() {
    var all = PCData.getInventory();
    var active = all.filter(function (i) { return i.status === 'active'; });
    var limit = isoOffset(EXPIRY_WARN_DAYS);

    var low = active.filter(function (i) { return PCData.isLowStock(i); })
      .sort(function (a, b) {
        return (a.quantity / (a.lowStockThreshold || 1)) - (b.quantity / (b.lowStockThreshold || 1));
      });

    var expired = active.filter(function (i) { return PCData.isExpired(i); });
    var soon = active.filter(function (i) {
      return i.expirationDate && !PCData.isExpired(i) && i.expirationDate <= limit;
    });
    var expiry = expired.concat(soon).sort(function (a, b) {
      return a.expirationDate < b.expirationDate ? -1 : 1;
    });

    var value = active.reduce(function (sum, i) {
      return sum + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0);
    }, 0);

    var activity = all.slice().sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); })
      .slice(0, ACTIVITY_LIMIT);

    return { active: active, low: low, expired: expired, soon: soon, expiry: expiry, value: value, activity: activity };
  }

  function renderOverview() {
    if (!els.tableWrap) return;
    var o = computeOverview();

    var html =
      '<ul class="ov-cards">' +
        card(true, 'fa-boxes-stacked', 'Items in Inventory', String(o.active.length), 'active inventory items') +
        card(false, 'fa-triangle-exclamation', 'Low Stock', String(o.low.length), 'items below minimum level') +
        card(false, 'fa-calendar-xmark', 'Expiring & Expired', String(o.soon.length + o.expired.length),
          o.soon.length + ' expiring soon · ' + o.expired.length + ' expired') +
        card(false, 'fa-peso-sign', 'Inventory Value', formatPesoWhole(o.value), 'estimated value of active stock') +
      '</ul>' +
      '<div class="ov-panels">' +
        lowStockPanel(o.low) +
        expiryPanel(o.expiry) +
      '</div>' +
      activityPanel(o.activity);

    // PCData.onChange also fires on a poll; only touch the DOM when the
    // output actually changed so buttons never lose focus for no reason.
    if (html === lastHtml) return;
    lastHtml = html;
    els.tableWrap.innerHTML = html;
  }

  function card(primary, icon, label, value, note) {
    return '<li class="ov-card' + (primary ? ' ov-card-primary' : '') + '">' +
      '<div class="ov-card-head"><span class="ov-label">' + escapeHtml(label) + '</span>' +
      '<i class="fa-solid ' + icon + ' ov-icon" aria-hidden="true"></i></div>' +
      '<div class="ov-num">' + escapeHtml(value) + '</div>' +
      '<div class="ov-note">' + escapeHtml(note) + '</div>' +
    '</li>';
  }

  function panel(extraClass, title, href, linkLabel, bodyHtml) {
    return '<section class="ov-panel ' + extraClass + '">' +
      '<div class="ov-panel-head"><div class="ov-panel-headtext">' +
        '<h2 class="ov-panel-title">' + title + '</h2></div>' +
        '<a class="ov-view-link" href="' + href + '">' + linkLabel + ' <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>' +
      '</div>' +
      bodyHtml +
    '</section>';
  }

  function tableHtml(heads, rowsHtml) {
    return '<div class="ov-scroll"><table class="inv-table ov-table"><thead><tr>' +
      heads.map(function (h) { return '<th>' + h + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>';
  }

  function emptyRow(cols, text) {
    return '<tr class="inv-empty-row"><td colspan="' + cols + '">' + text + '</td></tr>';
  }

  function moreNote(shown, total) {
    return total > shown ? '<div class="ov-more">Showing ' + shown + ' of ' + total + '</div>' : '';
  }

  function lowStockPanel(list) {
    var shown = list.slice(0, PANEL_ROW_LIMIT);
    var rows = shown.map(function (i) {
      var out = i.quantity === 0;
      return '<tr>' +
        '<td data-label="Item"><span class="inv-item-name">' + escapeHtml(i.name) + '</span></td>' +
        '<td data-label="Current Stock"><span class="inv-qty-stack"><span class="inv-qty">' + i.quantity + '</span>' +
          (out ? '<span class="inv-pill out">Out</span>' : '') + '</span></td>' +
        '<td data-label="Minimum Level" class="inv-secondary">' + (i.lowStockThreshold || 0) + '</td>' +
        '<td data-label="Action"><a class="btn btn-sm" href="inventory-stock-management.html"' +
          ' aria-label="Manage stock for ' + escapeAttr(i.name) + '">Manage Stock</a></td>' +
      '</tr>';
    }).join('');
    return panel('ov-low', 'LOW STOCK ITEMS',
      'inventory-stock-management.html', 'Manage Stock',
      tableHtml(['Item', 'Current Stock', 'Minimum Level', 'Action'], rows || emptyRow(4, 'No items are below their minimum level.')) +
      moreNote(shown.length, list.length));
  }

  function expiryPanel(list) {
    var shown = list.slice(0, PANEL_ROW_LIMIT);
    var rows = shown.map(function (i) {
      var expired = PCData.isExpired(i);
      return '<tr>' +
        '<td data-label="Item"><span class="inv-item-name">' + escapeHtml(i.name) + '</span></td>' +
        '<td data-label="Expiration Date" class="inv-secondary">' + formatLongDate(i.expirationDate) +
          '<span class="ov-sub-line">' + relativeDays(i.expirationDate) + '</span></td>' +
        '<td data-label="Quantity" class="inv-secondary">' + i.quantity + ' ' + escapeHtml(i.unit || '') + '</td>' +
        '<td data-label="Status"><span class="inv-pill ' + (expired ? 'expired' : 'low') + '">' +
          (expired ? 'Expired' : 'Expiring Soon') + '</span></td>' +
      '</tr>';
    }).join('');
    return panel('ov-exp', 'EXPIRING &amp; EXPIRED ITEMS',
      'inventory-items.html', 'View Items',
      tableHtml(['Item', 'Expiration Date', 'Quantity', 'Status'], rows || emptyRow(4, 'No items are expiring soon or expired.')) +
      moreNote(shown.length, list.length));
  }

  // Derived from the only movement-related fields the store has
  // (createdAt / updatedAt / quantity). No per-movement log exists.
  function activityPanel(list) {
    var rows = list.map(function (i) {
      var updated = (i.updatedAt || 0) - (i.createdAt || 0) > 1000;
      return '<tr>' +
        '<td data-label="Date &amp; Time" class="inv-secondary">' + formatDateTime(i.updatedAt || i.createdAt) + '</td>' +
        '<td data-label="Activity"><span class="inv-pill ' + (updated ? 'updated' : 'added') + '">' +
          (updated ? 'Item Updated' : 'Item Added') + '</span></td>' +
        '<td data-label="Item"><span class="inv-item-name">' + escapeHtml(i.name) + '</span></td>' +
        '<td data-label="Quantity" class="inv-secondary">' + i.quantity + ' ' + escapeHtml(i.unit || '') + '</td>' +
        '<td data-label="User" class="inv-secondary">Admin</td>' +
      '</tr>';
    }).join('');
    return panel('ov-act', 'RECENT INVENTORY ACTIVITY',
      'inventory-history.html', 'View History',
      tableHtml(['Date &amp; Time', 'Activity', 'Item', 'Quantity', 'User'], rows || emptyRow(5, 'No inventory activity yet.')));
  }

  // Whole days between today and an ISO date, as short text ("in 12 days").
  function relativeDays(iso) {
    var p = String(iso || '').split('-').map(Number);
    if (p.length !== 3 || isNaN(p[0])) return '';
    var t = new Date(); t.setHours(0, 0, 0, 0);
    var diff = Math.round((new Date(p[0], p[1] - 1, p[2]) - t) / 86400000);
    if (diff === 0) return 'Today';
    var n = Math.abs(diff);
    var label = n + (n === 1 ? ' day' : ' days');
    return diff > 0 ? 'in ' + label : label + ' ago';
  }

  function formatPesoWhole(n) {
    return '₱' + Math.round(Number(n) || 0).toLocaleString('en-US');
  }

  function formatLongDate(iso) {
    var p = String(iso || '').split('-').map(Number);
    if (p.length !== 3 || isNaN(p[0])) return '—';
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatDateTime(ts) {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' +
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
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
      renderOverview();
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