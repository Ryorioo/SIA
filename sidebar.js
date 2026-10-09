// ============================================================
// PAWSITIVE CARE — sidebar navigation behavior
// Shared across every page. Handles:
//   1. Highlighting the nav item for the current page
//   2. Mobile sidebar open/close toggle
// ============================================================

document.addEventListener('DOMContentLoaded', function () {
  highlightActiveNavItem();
  setupInventoryMenu();
  setupPredictiveMenu();
  setupMobileToggle();
  setBrandSubtitle();
});

function highlightActiveNavItem() {
  // Current file name, e.g. "dashboard.html". Falls back to
  // dashboard.html when opened as "/" or "index.html".
  var path = window.location.pathname.split('/').pop();
  if (path === '' || path === 'index.html') {
    path = 'dashboard.html';
  }

  var navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(function (item) {
    var target = item.getAttribute('data-page');
    if (target === path) {
      item.classList.add('active');
      item.setAttribute('aria-current', 'page');
    } else {
      item.classList.remove('active');
      item.removeAttribute('aria-current');
    }
  });
}

function setupMobileToggle() {
  var toggle = document.querySelector('.menu-toggle');
  var sidebar = document.querySelector('.sidebar');
  if (!toggle || !sidebar) return;

  toggle.addEventListener('click', function () {
    sidebar.classList.toggle('open');
  });

  // Close the sidebar after choosing a page (mobile only)
  sidebar.querySelectorAll('.nav-item:not(.nav-parent), .nav-subitem').forEach(function (link) {
    link.addEventListener('click', function () {
      sidebar.classList.remove('open');
    });
  });
}

// Inventory becomes an expandable parent (under CLINIC) with a submenu.
// The existing Inventory nav item (and its icon) is reused as the parent,
// so no page markup needs to change.
var INVENTORY_SUBMENU = [
  { label: 'Overview',         page: 'inventory.html' },
  { label: 'Items',            page: 'inventory-items.html' },
  { label: 'Stock Management', page: 'inventory-stock-management.html' },
  { label: 'Procurement',      page: 'inventory-procurement.html' },
  { label: 'Inventory History', page: 'inventory-history.html' }
];

function setupInventoryMenu() {
  var parent = document.querySelector('.sidebar .nav-item[data-page="inventory.html"]');
  if (!parent || !parent.parentNode) return;

  var current = window.location.pathname.split('/').pop();
  var hasActiveChild = false;

  var submenu = document.createElement('div');
  submenu.className = 'nav-submenu';
  submenu.id = 'inventory-submenu';

  INVENTORY_SUBMENU.forEach(function (entry) {
    var link = document.createElement('a');
    link.className = 'nav-subitem';
    link.href = entry.page;
    link.setAttribute('data-page', entry.page);
    link.textContent = entry.label;
    if (entry.page === current) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
      hasActiveChild = true;
    }
    submenu.appendChild(link);
  });

  var chevron = document.createElement('span');
  chevron.className = 'nav-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  parent.appendChild(chevron);

  parent.classList.add('nav-parent');
  parent.setAttribute('role', 'button');
  parent.setAttribute('aria-controls', submenu.id);
  parent.parentNode.insertBefore(submenu, parent.nextSibling);

  // Parent is highlighted whenever any Inventory page is active.
  parent.removeAttribute('aria-current');
  parent.classList.toggle('active', hasActiveChild);

  function setExpanded(open) {
    parent.classList.toggle('expanded', open);
    parent.setAttribute('aria-expanded', open ? 'true' : 'false');
    submenu.hidden = !open;
  }
  setExpanded(hasActiveChild); // open by default on Inventory pages

  parent.addEventListener('click', function (e) {
    e.preventDefault();
    setExpanded(submenu.hidden);
  });
  parent.addEventListener('keydown', function (e) {
    if (e.key === ' ') {
      e.preventDefault();
      setExpanded(submenu.hidden);
    }
  });
}

// Predictive Analytics becomes an expandable parent (under INSIGHTS), using
// the same pattern as Inventory. The existing nav item is reused as the parent.
var PREDICTIVE_SUBMENU = [
  { label: 'Overview',         page: 'predictive-analytics.html' },
  { label: 'Disease Risk',     page: 'disease-risk.html' },
  { label: 'Medicine Demand',  page: 'medicine-demand.html' },
  { label: 'Weather & Health', page: 'weather-health.html' },
  { label: 'Recommendations',  page: 'recommendations.html' }
];

// Normalizes a path/URL to a bare lowercase page name:
// ignores query strings, hashes, case and trailing slashes, and adds ".html"
// for extensionless (clean) URLs.
function normalizePageName(value) {
  var page = String(value || '').split('#')[0].split('?')[0];
  page = page.replace(/\/+$/, '');
  page = page.split('/').pop().toLowerCase();
  if (page && page.indexOf('.') === -1) page += '.html';
  return page;
}

function setupPredictiveMenu() {
  var current = normalizePageName(window.location.pathname);
  var pages = PREDICTIVE_SUBMENU.map(function (entry) { return entry.page; });
  var onPredictivePage = pages.indexOf(current) !== -1;

  // The parent represents the whole section. Prefer the Overview link, but
  // fall back to any sidebar item pointing at one of the five section pages.
  var parent = document.querySelector('.sidebar .nav-item[data-page="predictive-analytics.html"]');
  if (!parent) {
    var items = document.querySelectorAll('.sidebar .nav-item');
    for (var i = 0; i < items.length && !parent; i++) {
      var key = normalizePageName(items[i].getAttribute('data-page') || items[i].getAttribute('href'));
      if (pages.indexOf(key) !== -1) parent = items[i];
    }
  }
  if (!parent || !parent.parentNode) return;
  if (document.getElementById('predictive-submenu')) return; // already set up

  var submenu = document.createElement('div');
  submenu.className = 'nav-submenu';
  submenu.id = 'predictive-submenu';

  PREDICTIVE_SUBMENU.forEach(function (entry) {
    var link = document.createElement('a');
    link.className = 'nav-subitem';
    link.href = entry.page;
    link.setAttribute('data-page', entry.page);
    link.textContent = entry.label;
    if (entry.page === current) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    }
    submenu.appendChild(link);
  });

  var chevron = document.createElement('span');
  chevron.className = 'nav-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  parent.appendChild(chevron);

  parent.classList.add('nav-parent');
  parent.setAttribute('role', 'button');
  parent.setAttribute('aria-controls', submenu.id);
  parent.parentNode.insertBefore(submenu, parent.nextSibling);

  // Parent is the section parent: active (not aria-current) on any of the five pages.
  parent.removeAttribute('aria-current');
  parent.classList.toggle('active', onPredictivePage);

  function setExpanded(open) {
    parent.classList.toggle('expanded', open);
    parent.setAttribute('aria-expanded', open ? 'true' : 'false');
    submenu.hidden = !open;
  }
  setExpanded(onPredictivePage); // always open on all five Predictive Analytics pages

  parent.addEventListener('click', function (e) {
    e.preventDefault();
    setExpanded(submenu.hidden);
  });
  parent.addEventListener('keydown', function (e) {
    if (e.key === ' ') {
      e.preventDefault();
      setExpanded(submenu.hidden);
    }
  });
}

// Sidebar branding subtitle (top of the sidebar only; the profile section
// at the bottom uses .footer-role and is not touched).
function setBrandSubtitle() {
  var role = document.querySelector('.sidebar-brand .brand-role');
  if (role) role.textContent = 'Veterinary Clinic';
}