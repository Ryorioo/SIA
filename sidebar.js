// ============================================================
// PAWSITIVE CARE — sidebar navigation behavior
// Shared across every page. Handles:
//   1. Highlighting the nav item for the current page
//   2. Mobile sidebar open/close toggle
// ============================================================

document.addEventListener('DOMContentLoaded', function () {
  highlightActiveNavItem();
  setupMobileToggle();
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
  sidebar.querySelectorAll('.nav-item').forEach(function (link) {
    link.addEventListener('click', function () {
      sidebar.classList.remove('open');
    });
  });
}
