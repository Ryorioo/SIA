// ============================================================
// PAWSITIVE CARE — Services page controller
// Reads/writes Services data exclusively through the
// services-data-store.js functions attached to PCData
// (getServices, addService, updateService, setServiceStatus, ...).
// No Service data is stored directly in this file.
// ============================================================

(function () {
  var state = {
    search: '',
    category: '',
    status: '',
    editingId: null, // null while adding, a service id while editing
    modalOpen: false,
    refreshPending: false // set when a background PCData change arrives while the modal is open
  };

  var els = {};

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    els.search = document.getElementById('services-search');
    els.categoryFilter = document.getElementById('services-category-filter');
    els.statusFilter = document.getElementById('services-status-filter');
    els.tableBody = document.getElementById('services-table-body');
    els.btnAdd = document.getElementById('btn-add-service');

    els.modalOverlay = document.getElementById('service-modal-overlay');
    els.modalTitle = document.getElementById('service-modal-title');
    els.modalSub = document.getElementById('service-modal-sub');
    els.modalClose = document.getElementById('service-modal-close');
    els.count = document.getElementById('services-count');
    els.form = document.getElementById('service-form');
    els.id = document.getElementById('service-id');
    els.name = document.getElementById('service-name');
    els.category = document.getElementById('service-category');
    els.categoryOptions = document.getElementById('service-category-options');
    els.status = document.getElementById('service-status');
    els.price = document.getElementById('service-price');
    els.duration = document.getElementById('service-duration');
    els.description = document.getElementById('service-description');
    els.btnCancel = document.getElementById('btn-cancel-service');

    bindEvents();
    populateCategoryFilter();
    render();

    // Keep this page in sync if Services data changes elsewhere
    // (another tab, or another module writing through PCData).
    // IMPORTANT: this must not touch the DOM while the Add/Edit modal is
    // open. populateCategoryFilter() rewrites the innerHTML of
    // #service-category-options — the exact <datalist> backing the
    // Category field's dropdown. If that fires while the user has just
    // clicked into Category and the browser is showing its suggestion
    // list, replacing the <option> elements out from under an open
    // popup is what makes the dropdown flash open and immediately close.
    // Deferring the refresh until the modal is closed keeps the page in
    // sync without ever mutating a control the user is mid-interaction
    // with.
    if (window.PCData && typeof window.PCData.onChange === 'function') {
      window.PCData.onChange(function () {
        if (state.modalOpen) {
          state.refreshPending = true;
          return;
        }
        populateCategoryFilter();
        render();
      });
    }
  }

  function bindEvents() {
    els.search.addEventListener('input', function () {
      state.search = els.search.value.trim().toLowerCase();
      render();
    });

    els.categoryFilter.addEventListener('change', function () {
      state.category = els.categoryFilter.value;
      render();
    });

    els.statusFilter.addEventListener('change', function () {
      state.status = els.statusFilter.value;
      render();
    });

    els.btnAdd.addEventListener('click', openAddModal);
    els.btnCancel.addEventListener('click', closeModal);
    if (els.modalClose) els.modalClose.addEventListener('click', closeModal);
    els.modalOverlay.addEventListener('click', function (e) {
      if (e.target === els.modalOverlay) closeModal();
    });

    els.form.addEventListener('submit', handleSubmit);
  }

  // ------------------------------------------------------------------
  // filters
  // ------------------------------------------------------------------

  function populateCategoryFilter() {
    var categories = window.PCData.getServiceCategories();
    var current = els.categoryFilter.value;

    els.categoryFilter.innerHTML = '<option value="">All Categories</option>' +
      categories.map(function (c) {
        return '<option value="' + escapeAttr(c) + '">' + escapeHtml(c) + '</option>';
      }).join('');

    els.categoryFilter.value = current;

    els.categoryOptions.innerHTML = categories.map(function (c) {
      return '<option value="' + escapeAttr(c) + '"></option>';
    }).join('');
  }

  function getFilteredServices() {
    return window.PCData.getServices().filter(function (s) {
      if (state.search && s.name.toLowerCase().indexOf(state.search) === -1) return false;
      if (state.category && s.category !== state.category) return false;
      if (state.status && s.status !== state.status) return false;
      return true;
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  // ------------------------------------------------------------------
  // render
  // ------------------------------------------------------------------

  function render() {
    var services = getFilteredServices();

    if (els.count) {
      els.count.textContent = services.length + (services.length === 1 ? ' service' : ' services');
    }

    if (!services.length) {
      els.tableBody.innerHTML = '<tr class="empty-row"><td colspan="6">No services match your filters.</td></tr>';
      return;
    }

    els.tableBody.innerHTML = services.map(renderRow).join('');

    // wire up row actions (delegation would also work, but the table is
    // re-rendered on every change anyway, so direct binding is simplest)
    services.forEach(function (s) {
      var editBtn = document.getElementById('edit-' + s.id);
      var toggleBtn = document.getElementById('toggle-' + s.id);
      if (editBtn) editBtn.addEventListener('click', function () { openEditModal(s.id); });
      if (toggleBtn) toggleBtn.addEventListener('click', function () { toggleStatus(s.id, s.status); });
    });
  }

  function renderRow(s) {
    var statusClass = s.status === 'Active' ? 'status-active' : 'status-inactive';
    var toggleLabel = s.status === 'Active' ? 'Deactivate' : 'Activate';
    var toggleClass = s.status === 'Active' ? 'btn btn-sm btn-danger' : 'btn btn-sm btn-primary';

    return '' +
      '<tr>' +
        '<td><span class="svc-name">' + escapeHtml(s.name) + '</span></td>' +
        '<td><span class="svc-category">' + escapeHtml(s.category) + '</span></td>' +
        '<td><span class="svc-price">' + formatPrice(s.price) + '</span></td>' +
        '<td><span class="svc-duration">' + formatDuration(s.duration) + '</span></td>' +
        '<td><span class="status-badge ' + statusClass + '">' + s.status + '</span></td>' +
        '<td class="row-actions">' +
          '<button type="button" class="icon-btn" id="edit-' + s.id + '" aria-label="Edit service" title="Edit service"><i class="fa-solid fa-pen"></i></button>' +
          '<button type="button" class="' + toggleClass + '" id="toggle-' + s.id + '">' + toggleLabel + '</button>' +
        '</td>' +
      '</tr>';
  }

  function formatPrice(price) {
    var n = Number(price) || 0;
    return '₱' + n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  // Guards against legacy/malformed records with no real duration set
  // (null/undefined/blank/NaN) by showing "—" instead of a misleading
  // "0 min". An explicitly-entered 0 is still shown as "0 min" — that
  // is real stored data, not something this formatter should hide or
  // replace with an invented number.
  function formatDuration(duration) {
    if (duration === null || duration === undefined || duration === '') return '—';
    var n = Number(duration);
    if (isNaN(n)) return '—';
    return n + ' min';
  }

  // ------------------------------------------------------------------
  // add / edit modal
  // ------------------------------------------------------------------

  function openAddModal() {
    state.editingId = null;
    els.modalTitle.textContent = 'Add Service';
    els.modalSub.textContent = '';
    els.form.reset();
    els.id.value = '';
    els.status.value = 'Active';
    clearErrors();
    openModal();
  }

  function openEditModal(id) {
    var s = window.PCData.getServiceById(id);
    if (!s) return;
    state.editingId = id;
    els.modalTitle.textContent = 'Edit Service';
    els.modalSub.textContent = '';
    els.id.value = s.id;
    els.name.value = s.name;
    els.category.value = s.category;
    els.status.value = s.status;
    els.price.value = s.price;
    els.duration.value = s.duration;
    els.description.value = s.description || '';
    clearErrors();
    openModal();
  }

  function openModal() {
    state.modalOpen = true;
    els.modalOverlay.classList.add('open');
  }

  function closeModal() {
    els.modalOverlay.classList.remove('open');
    state.editingId = null;
    state.modalOpen = false;
    if (state.refreshPending) {
      state.refreshPending = false;
      populateCategoryFilter();
      render();
    }
  }

  function clearErrors() {
    ['err-service-name', 'err-service-category', 'err-service-price', 'err-service-duration'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.remove('show');
    });
  }

  function validate(data) {
    var valid = true;
    clearErrors();

    if (!data.name) {
      document.getElementById('err-service-name').classList.add('show');
      valid = false;
    }
    if (!data.category) {
      document.getElementById('err-service-category').classList.add('show');
      valid = false;
    }
    if (isNaN(data.price) || data.price < 0) {
      document.getElementById('err-service-price').classList.add('show');
      valid = false;
    }
    if (isNaN(data.duration) || data.duration < 0) {
      document.getElementById('err-service-duration').classList.add('show');
      valid = false;
    }
    return valid;
  }

  function handleSubmit(e) {
    e.preventDefault();

    var data = {
      name: els.name.value.trim(),
      category: els.category.value.trim(),
      status: els.status.value,
      price: parseFloat(els.price.value),
      duration: parseInt(els.duration.value, 10),
      description: els.description.value.trim()
    };

    if (!validate(data)) return;

    if (state.editingId) {
      window.PCData.updateService(state.editingId, data);
    } else {
      window.PCData.addService(data);
    }

    closeModal();
    populateCategoryFilter();
    render();
  }

  function toggleStatus(id, currentStatus) {
    var next = currentStatus === 'Active' ? 'Inactive' : 'Active';
    window.PCData.setServiceStatus(id, next);
    render();
  }

  // ------------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------------

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function escapeAttr(str) {
    return escapeHtml(str);
  }
})();