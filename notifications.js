// ============================================================
// PAWSITIVE CARE — Notifications page controller
// Reads/writes only through PCData (see notifications-data-store.js).
//
// Phase 1D: filter tabs (with counts), search, and Category /
// Priority dropdowns. All filtering happens here, in the view, on
// the array PCData.getNotifications() already returns — nothing is
// written to storage by any filter, and the data store is untouched.
//
// Final audit polish: accessible row structure (title is the real
// button, no nested interactive), live-region announcements, focus
// kept after mark-as-read, and wrap-safe date/time metadata.
// No storage, ids, filters or modal behavior changed.
//
// Phase 1H: the single list is split into grouped sections (Requires
// Attention / Upcoming / Recent Activity), each sorted unread-first
// then High > Medium > Low. Timestamps show an exact date and time.
// This is purely a view concern: grouping and sorting run on the
// filtered copy of PCData.getNotifications(); nothing is written to
// storage and no notification fields are added or changed.
//
// Phase 1K: all three sections are always rendered, even when empty.
// An empty section keeps its header + 0 count pill and shows its own
// empty state inside the card. Counts follow the filtered results.
// UI only: grouping rules, sorting, filters and storage are unchanged.
//
// Phase 2: each section shows at most 10 notifications per page with its
// own Previous / numbered / Next pager (view-only; nothing is deleted or
// hidden). The page resets to 1 when the search, tab or dropdowns change.
// ============================================================

(function () {
  var CATEGORIES = ['inventory', 'appointment', 'vaccination', 'predictive'];

  // Filter state.
  //   view     'all' | 'unread'
  //   category '' or one of CATEGORIES   (shared by the category tabs and the dropdown)
  //   priority '' | 'high' | 'medium' | 'low'
  //   search   free text, matched against title, message and category
  // The highlighted tab is derived from view + category (see activeTab()),
  // so the tabs and the Category dropdown can never disagree.
  var state = { view: 'all', category: '', priority: '', search: '' };

  var lastSignature = null; // skip re-render when nothing changed

  // Phase 2: pagination. Each section pages independently (10 per page), so
  // the Requires attention / Recent activity / Upcoming lists never affect
  // one another. View-only: nothing is stored, deleted or hidden — every
  // notification stays reachable through its section's pager.
  var PAGE_SIZE = 10;
  var pages = { attention: 1, recent: 1, upcoming: 1 };
  var lastFilteredCount = 0;

  // A different search / filter / tab means a different list: start over.
  function resetPages() { pages = { attention: 1, recent: 1, upcoming: 1 }; }

  var els = {};

  function cacheEls() {
    els.list = document.getElementById('notifList');
    els.empty = document.getElementById('notifEmpty');
    els.emptyIcon = document.getElementById('notifEmptyIcon');
    els.emptyTitle = document.getElementById('notifEmptyTitle');
    els.emptyHint = document.getElementById('notifEmptyHint');
    els.markAllBtn = document.getElementById('markAllReadBtn');
    els.live = document.getElementById('notifLive');
    els.tabs = document.querySelectorAll('#notifTabs .sub-tab');
    els.search = document.getElementById('notif-search');
    els.searchClear = document.getElementById('notif-search-clear');
    els.categorySelect = document.getElementById('notif-category-filter');
    els.prioritySelect = document.getElementById('notif-priority-filter');
    els.modal = {
      overlay: document.getElementById('notifModalOverlay'),
      box: document.getElementById('notifModalBox'),
      icon: document.getElementById('notifModalIcon'),
      title: document.getElementById('notifModalTitle'),
      message: document.getElementById('notifModalMessage'),
      source: document.getElementById('notifModalSource'),
      priority: document.getElementById('notifModalPriority'),
      created: document.getElementById('notifModalCreated'),
      close: document.getElementById('notifModalClose'),
      dismiss: document.getElementById('notifModalDismiss'),
      action: document.getElementById('notifModalAction')
    };
    els.tabCounts = {
      all: document.getElementById('tabCountAll'),
      unread: document.getElementById('tabCountUnread'),
      inventory: document.getElementById('tabCountInventory'),
      appointment: document.getElementById('tabCountAppointment'),
      vaccination: document.getElementById('tabCountVaccination'),
      predictive: document.getElementById('tabCountPredictive')
    };
  }

  // Polite screen-reader announcements (the visible UI already updates;
  // this only tells assistive tech what changed). Clearing first makes a
  // repeated identical message announce again.
  var announceTimer = null;
  function announce(msg, delay) {
    if (!els.live) return;
    clearTimeout(announceTimer);
    announceTimer = setTimeout(function () {
      els.live.textContent = '';
      setTimeout(function () { els.live.textContent = msg; }, 30);
    }, delay || 0);
  }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  function timeAgo(ts) {
    var diff = Date.now() - ts;
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    var days = Math.floor(hrs / 24);
    return days + 'd ago';
  }

  function priorityIcon(priority) {
    if (priority === 'high') return '<i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>';
    if (priority === 'medium') return '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>';
    return '<i class="fa-solid fa-circle-info" aria-hidden="true"></i>';
  }

  // One icon per category (matches the sidebar icons where one exists).
  function categoryIcon(category) {
    if (category === 'inventory') return '<i class="fa-solid fa-boxes-stacked" aria-hidden="true"></i>';
    if (category === 'appointment') return '<i class="fa-solid fa-calendar-days" aria-hidden="true"></i>';
    if (category === 'vaccination') return '<i class="fa-solid fa-syringe" aria-hidden="true"></i>';
    if (category === 'predictive') return '<i class="fa-solid fa-chart-line" aria-hidden="true"></i>';
    return '<i class="fa-solid fa-bell" aria-hidden="true"></i>';
  }

  // Source label shown in the card metadata line.
  function sourceLabel(category) {
    if (category === 'predictive') return 'Predictive Analytics';
    return categoryLabel(category) || 'General';
  }

  function categoryLabel(cat) {
    return cat ? cat.charAt(0).toUpperCase() + cat.slice(1) : '';
  }

  // ------------------------------------------------------------------
  // filtering
  // ------------------------------------------------------------------

  function activeTab() {
    if (state.view === 'unread') return 'unread';
    return state.category || 'all';
  }

  function matchesSearch(n, term) {
    if (!term) return true;
    var hay = [n.title, n.message, n.category, categoryLabel(n.category)].join(' ').toLowerCase();
    return hay.indexOf(term) !== -1;
  }

  function applyFilters(all) {
    var term = state.search.trim().toLowerCase();
    return all.filter(function (n) {
      if (state.view === 'unread' && n.read) return false;
      if (state.category && n.category !== state.category) return false;
      if (state.priority && n.priority !== state.priority) return false;
      return matchesSearch(n, term);
    });
  }

  // Tab counts are totals for the whole notification set, independent of
  // the search/dropdown filters (same as the Reports category counts).
  function computeTabCounts(all) {
    var counts = { all: all.length, unread: 0, inventory: 0, appointment: 0, vaccination: 0, predictive: 0 };
    all.forEach(function (n) {
      if (!n.read) counts.unread++;
      if (CATEGORIES.indexOf(n.category) !== -1) counts[n.category]++;
    });
    return counts;
  }

  // ------------------------------------------------------------------
  // per-section empty states (Phase 1K)
  // Every section is always on the page, so an empty one explains itself
  // inside its own card. When a search / dropdown / tab is narrowing the
  // list, the message says so instead of implying nothing exists.
  // ------------------------------------------------------------------

  var SECTION_EMPTY = {
    attention: { icon: 'fa-regular fa-circle-check', title: 'Nothing needs attention', hint: 'Unread high-priority alerts will appear here.' },
    recent:    { icon: 'fa-regular fa-bell-slash',   title: 'No recent activity',      hint: 'New alerts will appear here.' },
    upcoming:  { icon: 'fa-regular fa-calendar',     title: 'No upcoming items',       hint: 'Appointments for tomorrow and vaccinations due soon will appear here.' }
  };

  function filtersActive() {
    return state.search.trim() !== '' || state.priority !== '' || state.category !== '' || state.view === 'unread';
  }

  function sectionEmptyMessage(key) {
    if (filtersActive()) {
      return { icon: 'fa-solid fa-magnifying-glass', title: 'No matching notifications', hint: 'Try a different search or clear your filters.' };
    }
    return SECTION_EMPTY[key];
  }

  // ------------------------------------------------------------------
  // detail modal (Phase 1G)
  // Display-only: nothing here writes to storage. The action button is
  // derived from the category; a notification may override it with the
  // optional fields link / actionLabel / sourceLabel if a record ever
  // carries them (none of the required fields are touched).
  // ------------------------------------------------------------------

  var ACTIONS = {
    inventory:   { label: 'View Inventory',   href: 'inventory.html',            icon: 'fa-boxes-stacked' },
    appointment: { label: 'View Appointment', href: 'appointments.html',         icon: 'fa-calendar-days' },
    vaccination: { label: 'View Patient',     href: 'patients.html',             icon: 'fa-paw' },
    predictive:  { label: 'View Analysis',    href: 'predictive-analytics.html', icon: 'fa-chart-line' }
  };

  var modalState = { open: false, id: null, returnFocus: null };

  // Only same-site / http(s) links; anything with another scheme
  // (javascript:, data:, ...) is ignored and the default is used.
  function safeLink(href) {
    if (typeof href !== 'string') return '';
    var h = href.trim();
    if (!h) return '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(h) && !/^https?:/i.test(h)) return '';
    return h;
  }

  // Fixed en-US output so the format never depends on the browser locale:
  //   date  'Sep 30, 2026'
  //   time  '3:30 PM'   (12-hour clock, minutes always two digits, AM/PM)
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function formatDate(ts) {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return 'Unknown date';
    return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  function formatTime(ts) {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return 'Unknown time';
    var h = d.getHours();
    var m = d.getMinutes();
    var suffix = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12;
    if (h12 === 0) h12 = 12;
    return h12 + ':' + (m < 10 ? '0' : '') + m + ' ' + suffix;
  }

  function formatCreated(ts) {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return 'Unknown';
    return formatDate(ts) + ' \u00b7 ' + formatTime(ts);
  }

  function priorityBadgeHtml(priority) {
    var p = (priority === 'high' || priority === 'medium' || priority === 'low') ? priority : 'low';
    return '<span class="notif-badge notif-badge-' + p + '">' + priorityIcon(p) + ' ' + escapeHtml(String(priority || p)) + '</span>';
  }

  function modalFocusables() {
    return Array.prototype.filter.call(
      els.modal.overlay.querySelectorAll('button, a[href]'),
      function (e) { return !e.hidden && e.offsetParent !== null; }
    );
  }

  function openDetail(n, triggerEl) {
    var m = els.modal;
    var action = ACTIONS[n.category] || null;
    var actionLabel = (typeof n.actionLabel === 'string' && n.actionLabel.trim()) ? n.actionLabel.trim() : (action && action.label);
    var actionHref = safeLink(n.link) || (action && action.href) || '';

    m.icon.innerHTML = categoryIcon(n.category);
    m.title.textContent = n.title;
    m.message.textContent = n.message;
    m.source.textContent = (typeof n.sourceLabel === 'string' && n.sourceLabel.trim()) ? n.sourceLabel.trim() : sourceLabel(n.category);
    m.priority.innerHTML = priorityBadgeHtml(n.priority);
    m.created.textContent = formatCreated(n.createdAt) + ' (' + timeAgo(n.createdAt) + ')';

    if (actionLabel && actionHref) {
      m.action.innerHTML = (action ? '<i class="fa-solid ' + action.icon + '"></i> ' : '') + escapeHtml(actionLabel);
      m.action.setAttribute('href', actionHref);
      m.action.hidden = false;
    } else {
      m.action.hidden = true;
      m.action.removeAttribute('href');
    }

    modalState.open = true;
    modalState.id = n.id;
    modalState.returnFocus = triggerEl || document.activeElement;
    m.overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    m.box.scrollTop = 0;
    m.close.focus();
  }

  function closeDetail() {
    if (!modalState.open) return;
    modalState.open = false;
    els.modal.overlay.classList.remove('open');
    document.body.style.overflow = '';

    // The list may have been re-rendered while the modal was open, so look
    // the row up again by id; fall back to the element that opened it.
    var target = modalState.returnFocus;
    if (modalState.id && window.CSS && CSS.escape) {
      var again = els.list.querySelector('.notif-item[data-id="' + CSS.escape(modalState.id) + '"] .notif-item-open');
      if (again) target = again;
    }
    modalState.id = null;
    modalState.returnFocus = null;
    if (target && typeof target.focus === 'function' && document.contains(target)) target.focus();
  }

  function wireModal() {
    var m = els.modal;
    m.close.addEventListener('click', closeDetail);
    m.dismiss.addEventListener('click', closeDetail);
    m.overlay.addEventListener('click', function (e) {
      if (e.target === m.overlay) closeDetail();
    });
    document.addEventListener('keydown', function (e) {
      if (!modalState.open) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeDetail();
        return;
      }
      if (e.key === 'Tab') {
        // keep keyboard focus inside the dialog
        var f = modalFocusables();
        if (!f.length) { e.preventDefault(); return; }
        var first = f[0], last = f[f.length - 1];
        if (!m.overlay.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }

  // ------------------------------------------------------------------
  // sections + sorting (Phase 1H)
  // ------------------------------------------------------------------

  // Every notification lands in exactly one section; the first rule that
  // matches (top to bottom) wins:
  //   attention  unread AND high priority         (a READ notification never
  //                                                qualifies, however urgent)
  //   upcoming   appointment 'tomorrow' / vaccination 'due_soon' (read or unread)
  //   recent     everything else
  // Page order (top to bottom) is the SECTIONS order below.
  var SECTIONS = [
    // Sentence case in the DOM (screen readers can spell out ALL-CAPS
    // words); the uppercase look comes from CSS text-transform.
    { key: 'attention', title: 'Requires attention' },
    { key: 'recent',    title: 'Recent activity' },
    { key: 'upcoming',  title: 'Upcoming' }
  ];

  var UPCOMING_CONDITIONS = {
    appointment: { tomorrow: true },
    vaccination: { due_soon: true }
  };

  // Normalised reads of the fields the rules depend on, so a stored record
  // with different casing or a missing field still groups correctly:
  //   priority   'High' / ' high ' -> 'high'
  //   condition  falls back to the tail of the id (notif_<type>_<id>_<condition>)
  //              when the stored record has no condition field
  function normPriority(n) {
    return String(n && n.priority != null ? n.priority : '').trim().toLowerCase();
  }

  function conditionOf(n) {
    if (n && typeof n.condition === 'string' && n.condition) return n.condition;
    var id = String(n && n.id != null ? n.id : '');
    var byCategory = UPCOMING_CONDITIONS[n && n.category];
    if (byCategory) {
      for (var c in byCategory) {
        if (Object.prototype.hasOwnProperty.call(byCategory, c) && id.slice(-(c.length + 1)) === '_' + c) return c;
      }
    }
    return '';
  }

  function isUpcoming(n) {
    var byCategory = UPCOMING_CONDITIONS[n.category];
    return !!(byCategory && byCategory[conditionOf(n)]);
  }

  function sectionOf(n) {
    if (!n.read && normPriority(n) === 'high') return 'attention';
    if (isUpcoming(n)) return 'upcoming';
    return 'recent';
  }

  var PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

  function priorityRank(p) {
    p = String(p == null ? '' : p).trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(PRIORITY_RANK, p) ? PRIORITY_RANK[p] : 3;
  }

  // Unread before read, then High > Medium > Low, then newest first.
  // The id comparison only makes ties deterministic.
  function compareNotifications(a, b) {
    var ua = a.read ? 1 : 0, ub = b.read ? 1 : 0;
    if (ua !== ub) return ua - ub;
    var pa = priorityRank(a.priority), pb = priorityRank(b.priority);
    if (pa !== pb) return pa - pb;
    var ta = Number(a.createdAt) || 0, tb = Number(b.createdAt) || 0;
    if (ta !== tb) return tb - ta;
    return String(a.id) < String(b.id) ? -1 : (String(a.id) > String(b.id) ? 1 : 0);
  }

  function groupNotifications(list) {
    var buckets = { attention: [], upcoming: [], recent: [] };
    list.forEach(function (n) { buckets[sectionOf(n)].push(n); });
    return SECTIONS.map(function (s) {
      return { key: s.key, title: s.title, items: buckets[s.key].slice().sort(compareNotifications) };
    });
  }

  // ------------------------------------------------------------------
  // render
  // ------------------------------------------------------------------

  function syncControls(counts) {
    var tab = activeTab();
    els.tabs.forEach(function (t) {
      var on = t.getAttribute('data-tab') === tab;
      t.classList.toggle('active', on);
      t.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    Object.keys(els.tabCounts).forEach(function (k) {
      if (els.tabCounts[k]) els.tabCounts[k].textContent = counts[k] || 0;
    });
    if (els.categorySelect.value !== state.category) els.categorySelect.value = state.category;
    if (els.prioritySelect.value !== state.priority) els.prioritySelect.value = state.priority;
    els.searchClear.hidden = state.search === '';
  }

  function buildRow(n, seq) {
    var row = document.createElement('div');
    row.className = 'notif-item priority-' + n.priority + (n.read ? ' is-read' : ' is-unread');
    var msgId = 'notifMsg-' + seq;
    var prio = escapeHtml(String(n.priority || ''));

    // The title is the row's real <button> (Enter / Space open the detail
    // modal natively). The row itself is not focusable, so there is no
    // interactive element nested inside another one; mouse users can still
    // click anywhere on the row (handler below).
    row.innerHTML =
      '<div class="notif-item-tile" aria-hidden="true">' + categoryIcon(n.category) + '</div>' +
      '<div class="notif-item-body">' +
        '<div class="notif-item-top">' +
          (n.read ? '' : '<span class="notif-item-dot" aria-hidden="true"></span>') +
          '<button type="button" class="notif-item-open" aria-haspopup="dialog">' +
            (n.read ? '' : '<span class="sr-only">Unread: </span>') +
            escapeHtml(n.title) +
          '</button>' +
        '</div>' +
        '<div class="notif-item-message" id="' + msgId + '">' + escapeHtml(n.message) + '</div>' +
        '<div class="notif-item-meta">' +
          '<span class="notif-item-source">' + escapeHtml(sourceLabel(n.category)) + '</span>' +
          '<span class="notif-item-sep" aria-hidden="true">&bull;</span>' +
          // date + time are one unbreakable unit: they wrap together or not at all
          '<span class="notif-item-when" title="' + escapeHtml(timeAgo(n.createdAt)) + '">' +
            '<span class="notif-item-date">' + escapeHtml(formatDate(n.createdAt)) + '</span>' +
            '<span aria-hidden="true">&bull;</span>' +
            '<span class="notif-item-time">' + escapeHtml(formatTime(n.createdAt)) + '</span>' +
          '</span>' +
        '</div>' +
      '</div>' +
      '<div class="notif-item-side">' +
        '<span class="notif-badge notif-badge-' + prio + '">' + priorityIcon(n.priority) + ' ' + prio + '<span class="sr-only"> priority</span></span>' +
        (n.read ? '' : '<button type="button" class="notif-item-mark" data-id="' + escapeHtml(String(n.id)) + '" title="Mark as read" aria-label="Mark as read: ' + escapeHtml(n.title) + '" aria-describedby="' + msgId + '"><i class="fa-solid fa-check" aria-hidden="true"></i></button>') +
      '</div>';

    row.setAttribute('data-id', n.id);
    // Row click opens the detail modal; the mark-as-read button is excluded
    // (its own handler marks the notification read without opening it).
    row.addEventListener('click', function (e) {
      if (e.target.closest('.notif-item-mark')) return;
      openDetail(n, row.querySelector('.notif-item-open'));
    });
    return row;
  }

  // Number of notifications matching the current filters (all pages), for
  // the filter announcement.
  function shownCount() { return lastFilteredCount; }

  // Page numbers to show: all of them up to 7 pages, otherwise first/last,
  // the current page and its neighbours, with '…' for the gaps (same as
  // Inventory Items).
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
      if (p === '\u2026') return '<span class="notif-ellipsis" aria-hidden="true">\u2026</span>';
      var active = p === cur;
      return '<button type="button" class="btn btn-sm notif-pg' + (active ? ' btn-primary' : '') + '" data-pg="' + p + '"' +
        (active ? ' aria-current="page"' : '') + ' aria-label="Page ' + p + '">' + p + '</button>';
    }).join('');
  }

  // "Showing 1\u201310 of 23 notifications" on the left; Previous / numbers /
  // Next on the right. Only built for sections with more than PAGE_SIZE items.
  function buildFooter(group, cur, pageCount, start, shown) {
    var total = group.items.length;
    var range = shown === 1 ? String(start + 1) : (start + 1) + '\u2013' + (start + shown);
    var foot = document.createElement('div');
    foot.className = 'notif-foot';
    foot.innerHTML =
      '<p class="notif-foot-count" aria-live="polite">Showing ' + range + ' of ' + total + ' notification' + (total === 1 ? '' : 's') + '</p>' +
      '<div class="notif-pager" role="group" aria-label="' + escapeHtml(group.title) + ' pagination">' +
        '<button type="button" class="btn btn-sm notif-prev" data-pg="prev"' + (cur <= 1 ? ' disabled' : '') + '>Previous</button>' +
        '<div class="notif-pages">' + pageButtons(cur, pageCount) + '</div>' +
        '<button type="button" class="btn btn-sm notif-next" data-pg="next"' + (cur >= pageCount ? ' disabled' : '') + '>Next</button>' +
      '</div>';
    return foot;
  }

  function render(force) {
    var all = PCData.getNotifications();
    var counts = computeTabCounts(all);
    var filtered = applyFilters(all);
    lastFilteredCount = filtered.length;
    var groups = groupNotifications(filtered);

    // Keep each section's page inside its range (e.g. after notifications
    // were marked read and moved to another section). Done before the
    // signature so the clamped pages are what get compared.
    groups.forEach(function (g) {
      var pageCount = Math.max(1, Math.ceil(g.items.length / PAGE_SIZE));
      if (pages[g.key] > pageCount) pages[g.key] = pageCount;
      if (!(pages[g.key] >= 1)) pages[g.key] = 1;
    });

    // The 1.5s safety-net poll calls render() constantly; skip the
    // DOM rebuild when nothing has actually changed since last time.
    var signature = JSON.stringify(state) + '|' + JSON.stringify(pages) + '|' + all.map(function (n) { return n.id + ':' + n.read + ':' + n.priority; }).join(',');
    if (!force && signature === lastSignature) return;
    lastSignature = signature;

    syncControls(counts);

    els.list.innerHTML = '';

    // The page-level empty block is no longer used: the three sections are
    // always shown and each one renders its own empty state.
    els.empty.style.display = 'none';
    els.list.style.display = 'flex';

    var rowSeq = 0;
    groups.forEach(function (group) {
      var section = document.createElement('section');
      section.className = 'notif-section notif-section-' + group.key;
      section.setAttribute('data-section', group.key);
      section.setAttribute('data-pages', String(Math.max(1, Math.ceil(group.items.length / PAGE_SIZE))));
      var titleId = 'notifSectionTitle-' + group.key;
      section.setAttribute('aria-labelledby', titleId);

      var head = document.createElement('div');
      head.className = 'notif-section-head';
      head.innerHTML =
        '<h2 class="notif-section-title" id="' + titleId + '">' + group.title +
          '<span class="sr-only"> (' + plural(group.items.length, 'notification') + ')</span></h2>' +
        '<span class="notif-section-count" aria-hidden="true">' + group.items.length + '</span>';
      section.appendChild(head);

      var rows = document.createElement('div');
      rows.className = 'notif-group';
      var pageCount = Math.max(1, Math.ceil(group.items.length / PAGE_SIZE));
      var cur = pages[group.key];
      var start = (cur - 1) * PAGE_SIZE;
      var pageItems = group.items.slice(start, start + PAGE_SIZE);
      if (group.items.length) {
        pageItems.forEach(function (n) { rows.appendChild(buildRow(n, rowSeq++)); });
      } else {
        var msg = sectionEmptyMessage(group.key);
        var empty = document.createElement('div');
        empty.className = 'notif-section-empty';
        empty.innerHTML =
          '<i class="' + msg.icon + '" aria-hidden="true"></i>' +
          '<div class="notif-section-empty-title">' + escapeHtml(msg.title) + '</div>' +
          '<div class="notif-section-empty-hint">' + escapeHtml(msg.hint) + '</div>';
        rows.appendChild(empty);
      }
      section.appendChild(rows);
      if (group.items.length > PAGE_SIZE) section.appendChild(buildFooter(group, cur, pageCount, start, pageItems.length));

      els.list.appendChild(section);
    });

    els.list.querySelectorAll('.notif-item-mark').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        // The button disappears when the list re-renders, which would drop
        // keyboard focus to the top of the page. Remember where it was and
        // put focus on the row now in that position (or the last one).
        var wasKeyboard = document.activeElement === btn;
        var openers = Array.prototype.slice.call(els.list.querySelectorAll('.notif-item-open'));
        var idx = openers.indexOf(btn.closest('.notif-item').querySelector('.notif-item-open'));
        var title = btn.closest('.notif-item').querySelector('.notif-item-open').textContent.replace(/^Unread: /, '');
        PCData.markAsRead(btn.getAttribute('data-id'));
        render(true);
        announce('Marked as read: ' + title + '.');
        if (wasKeyboard) {
          var next = els.list.querySelectorAll('.notif-item-open');
          var target = next[Math.min(idx, next.length - 1)];
          if (target) target.focus();
          else if (els.markAllBtn) els.markAllBtn.focus();
        }
      });
    });
  }

  function escapeHtml(str) {
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ------------------------------------------------------------------
  // wiring
  // ------------------------------------------------------------------

  // One delegated handler for all three sections' pagers; the section is
  // read from the clicked control, so each list pages on its own.
  function wirePagers() {
    els.list.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-pg]') : null;
      if (!btn || btn.disabled) return;
      var section = btn.closest('.notif-section');
      if (!section) return;
      var key = section.getAttribute('data-section');
      var cur = pages[key];
      var v = btn.getAttribute('data-pg');
      var n = v === 'prev' ? cur - 1 : v === 'next' ? cur + 1 : parseInt(v, 10);
      if (!n || n < 1 || n === cur) return;
      pages[key] = n;
      render(true);

      // The pager is rebuilt, so put keyboard focus back on the current page
      // number; and if the section's top has scrolled out of view, bring it
      // back so the new page starts at its first row.
      var again = els.list.querySelector('.notif-section[data-section="' + key + '"]');
      if (!again) return;
      var cr = again.querySelector('.notif-pg[aria-current="page"]');
      if (cr) cr.focus();
      if (again.getBoundingClientRect().top < 0 && again.scrollIntoView) again.scrollIntoView({ block: 'start' });
      var title = again.querySelector('.notif-section-title');
      announce((title ? title.firstChild.textContent : 'Section') + ': page ' + pages[key] + ' of ' + again.getAttribute('data-pages') + '.');
    });
  }

  function wireTabs() {
    els.tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var t = tab.getAttribute('data-tab');
        if (t === 'all') {
          state.view = 'all';
          state.category = '';
        } else if (t === 'unread') {
          // keeps the current category, so Unread + a category is reachable
          state.view = 'unread';
        } else {
          state.view = 'all';
          state.category = t;
        }
        resetPages();
        render(true);
        announce(plural(shownCount(), 'notification') + ' shown.');
      });
    });
  }

  function wireSearch() {
    els.search.addEventListener('input', function () {
      state.search = els.search.value;
      resetPages();
      render(true);
      announce(plural(shownCount(), 'notification') + ' shown.', 600);
    });
    els.searchClear.addEventListener('click', function () {
      els.search.value = '';
      state.search = '';
      resetPages();
      render(true);
      els.search.focus();
      announce(plural(shownCount(), 'notification') + ' shown.');
    });
  }

  function wireDropdowns() {
    els.categorySelect.addEventListener('change', function () {
      state.category = els.categorySelect.value;
      resetPages();
      render(true);
      announce(plural(shownCount(), 'notification') + ' shown.');
    });
    els.prioritySelect.addEventListener('change', function () {
      state.priority = els.prioritySelect.value;
      resetPages();
      render(true);
      announce(plural(shownCount(), 'notification') + ' shown.');
    });
  }

  function wireMarkAll() {
    els.markAllBtn.addEventListener('click', function () {
      var hadUnread = PCData.getNotifications().some(function (n) { return !n.read; });
      PCData.markAllAsRead();
      render();
      announce(hadUnread ? 'All notifications marked as read.' : 'No unread notifications.');
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    cacheEls();
    wireTabs();
    wireSearch();
    wireDropdowns();
    wireMarkAll();
    wirePagers();
    wireModal();
    render();
    PCData.onChange(render);
  });
})();