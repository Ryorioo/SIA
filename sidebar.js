// ============================================================
// PAWSITIVE CARE — sidebar navigation behavior
// Shared across every page. Handles:
//   1. Highlighting the nav item for the current page
//   2. Mobile sidebar open/close toggle
// ============================================================

document.addEventListener('DOMContentLoaded', function () {
  removeSettingsNavItem(); // first, so no later step sees the removed link
  removeSystemLogoutNavItem();
  highlightActiveNavItem();
  setupInventoryMenu();
  setupPredictiveMenu();
  setupMobileToggle();
  setupProfileMenu(); // after setupMobileToggle on purpose: Log out is visual-only for now
  setBrandSubtitle();
});

// TEMPORARY workaround: the Settings link is written directly into each admin
// page's HTML, so it is removed from the DOM here at load time. It is still in
// the original page source. Matches the link's target (data-page / href), not
// its text, and only inside the sidebar. settings.html itself is untouched and
// stays reachable by direct URL.
function removeSettingsNavItem() {
  document.querySelectorAll('.sidebar .nav-item').forEach(function (item) {
    var target = normalizePageName(item.getAttribute('data-page') || item.getAttribute('href'));
    if (target !== 'settings.html') return;

    var group = item.closest('.nav-group');
    item.remove();
    // Don't leave an orphaned section label behind if Settings was alone in its group.
    if (group && !group.querySelector('.nav-item')) group.remove();
  });
}

// TEMPORARY workaround (same idea as removeSettingsNavItem): removes the extra
// "Logout" navigation item from the SYSTEM section at load time. It is still in
// each page's HTML source. Scoped on purpose: only a .nav-item inside the
// .nav-group labelled "System" whose label or target is logout/log out/sign out.
// The Admin profile's Log out lives in .sidebar-footer-submenu (not a .nav-group
// item), and a Logout link in any other group, is left alone.
function removeSystemLogoutNavItem() {
  var LOGOUT = /^(log-?out|sign-?out)$/;
  function squash(value) { return String(value || '').replace(/\s+/g, '').toLowerCase(); }

  document.querySelectorAll('.sidebar .nav-group').forEach(function (group) {
    var label = group.querySelector('.nav-group-label');
    if (!label || squash(label.textContent) !== 'system') return;

    group.querySelectorAll('.nav-item').forEach(function (item) {
      var byText = LOGOUT.test(squash(item.textContent));
      var byTarget = LOGOUT.test(squash(normalizePageName(item.getAttribute('data-page') || item.getAttribute('href'))).replace(/\.html$/, ''));
      if (byText || byTarget) item.remove();
    });
  });
}

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
  { label: 'Overview',         page: 'inventory.html',                  icon: 'fa-table-cells-large' },
  { label: 'Items',            page: 'inventory-items.html',            icon: 'fa-boxes-stacked' },
  { label: 'Stock Management', page: 'inventory-stock-management.html', icon: 'fa-warehouse' },
  { label: 'Procurement',      page: 'inventory-procurement.html',      icon: 'fa-cart-shopping' },
  { label: 'Inventory History', page: 'inventory-history.html',         icon: 'fa-clock-rotate-left' }
];

// Fills a submenu link: optional Font Awesome icon (same .nav-icon class the
// main nav items use) followed by the exact label text.
function setSubitemContent(link, entry) {
  if (entry.icon) {
    var icon = document.createElement('i');
    icon.className = 'nav-icon fa-solid ' + entry.icon;
    icon.setAttribute('aria-hidden', 'true');
    link.classList.add('nav-subitem-icon');
    link.appendChild(icon);
  }
  link.appendChild(document.createTextNode(entry.label));
}

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
    setSubitemContent(link, entry);
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
  { label: 'Overview',         page: 'predictive-analytics.html', icon: 'fa-table-cells-large' },
  { label: 'Disease Risk',     page: 'disease-risk.html',         icon: 'fa-heart-pulse' },
  { label: 'Medicine Demand',  page: 'medicine-demand.html',      icon: 'fa-pills' },
  { label: 'Weather & Health', page: 'weather-health.html',       icon: 'fa-cloud-sun' },
  { label: 'Recommendations',  page: 'recommendations.html',      icon: 'fa-lightbulb' }
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
    setSubitemContent(link, entry);
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

// The existing Admin profile section at the bottom of the sidebar
// (.sidebar-footer: avatar, name, role) becomes the expandable parent, same
// pattern as Inventory / Predictive Analytics. Its markup and text are reused
// as-is; only a chevron is added. Frontend only: "Log out" is a visual submenu
// item and intentionally does nothing yet.
function setupProfileMenu() {
  var parent = document.querySelector('.sidebar .sidebar-footer');
  if (!parent || !parent.parentNode) return;
  if (document.getElementById('profile-submenu')) return; // already set up

  var submenu = document.createElement('div');
  submenu.className = 'nav-submenu sidebar-footer-submenu';
  submenu.id = 'profile-submenu';

  var logout = document.createElement('a');
  logout.className = 'nav-subitem nav-subitem-danger';
  logout.href = '#';
  logout.textContent = 'Log out';
  // Visual only: no action yet; just stop the "#" jump.
  logout.addEventListener('click', function (e) { e.preventDefault(); });
  submenu.appendChild(logout);

  var chevron = document.createElement('span');
  chevron.className = 'nav-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  parent.appendChild(chevron);

  parent.classList.add('nav-parent');
  parent.setAttribute('role', 'button');
  parent.setAttribute('tabindex', '0');
  parent.setAttribute('aria-controls', submenu.id);
  parent.parentNode.insertBefore(submenu, parent.nextSibling);

  function setExpanded(open) {
    parent.classList.toggle('expanded', open);
    parent.setAttribute('aria-expanded', open ? 'true' : 'false');
    submenu.hidden = !open;
  }
  setExpanded(false); // collapsed by default

  parent.addEventListener('click', function (e) {
    e.preventDefault();
    setExpanded(submenu.hidden);
  });
  parent.addEventListener('keydown', function (e) {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      setExpanded(submenu.hidden);
    }
  });

  // Collapse when the user picks a real navigation link (Dashboard etc.), even
  // if the click doesn't reload the page. One delegated listener on the
  // sidebar; same link selector as setupMobileToggle. Log out and the
  // Inventory / Predictive parent toggles are excluded.
  var sidebar = parent.closest('.sidebar');
  if (sidebar) {
    sidebar.addEventListener('click', function (e) {
      var link = e.target.closest('.nav-item:not(.nav-parent), .nav-subitem');
      if (!link || submenu.contains(link)) return;
      setExpanded(false);
    });
  }

  // Back/forward can restore this page from the browser cache with the
  // submenu still open; always show it collapsed again.
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) setExpanded(false);
  });
}

// Sidebar branding subtitle (top of the sidebar only; the profile section
// at the bottom uses .footer-role and is not touched).
function setBrandSubtitle() {
  var role = document.querySelector('.sidebar-brand .brand-role');
  if (role) role.textContent = 'Veterinary Clinic';
}