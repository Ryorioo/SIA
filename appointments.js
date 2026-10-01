// ============================================================
// PAWSITIVE CARE — Appointments page logic
// ============================================================

(function () {
  var D = window.PCData;

  // Calendar is the only Appointments view now — there is no separate
  // list view/state to track, so `state` only carries calendar
  // granularity, navigation, filters, and selection.
  var state = {
    calSubView: 'day',     // 'day' | 'week' | 'month'
    calDate: D.todayStr(),
    search: '',
    filterVet: '',
    filterStatus: '',      // '' = all statuses, otherwise one of D.STATUS_LABELS' keys
    filterType: '',        // '' = all appointment types, otherwise one of D.APPOINTMENT_TYPES
    editingId: null,
    selectedApptId: null,  // appointment shown in the Appointment Details panel
    selectedClient: null   // Client object currently chosen in the Add/Edit modal
  };

  // ------------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------------

  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Resolves the pet/species/owner/phone to show for an appointment.
  // If the appointment is linked to a real Patient (patientId), the
  // Patient's own data (and its Client's data) always wins, so renamed
  // pets/updated contact info stay in sync instead of relying on the
  // denormalized text saved at booking time. Legacy/unlinked
  // appointments fall back to whatever was typed on them directly.
  function apptInfo(a) {
    var patient = a.patientId ? D.getPatientById(a.patientId) : null;
    var clientId = patient ? patient.clientId : a.clientId;
    var client = clientId ? D.getClientById(clientId) : null;
    return {
      pet: patient ? patient.pet : a.pet,
      species: patient ? patient.species : a.species,
      owner: client ? client.name : a.owner,
      phone: client ? client.phone : a.phone,
      email: client ? client.email : (a.email || null)
    };
  }

  // Sentinel used in state.filterVet / <select> option values to mean
  // "no veterinarian assigned" — distinct from '' (which means "all
  // veterinarians"), and never a value a real vet name could collide
  // with.
  var UNASSIGNED_VET = '__unassigned__';

  function matchesFilters(a) {
    var info = apptInfo(a);
    var q = state.search.trim().toLowerCase();
    if (q) {
      var hay = (info.pet + ' ' + info.owner + ' ' + (a.vet || '') + ' ' + a.reason).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    if (state.filterVet === UNASSIGNED_VET) {
      if (a.vet) return false;
    } else if (state.filterVet && a.vet !== state.filterVet) {
      return false;
    }
    if (state.filterStatus && a.status !== state.filterStatus) return false;
    if (state.filterType && a.appointmentType !== state.filterType) return false;
    return true;
  }

  function showToast(msg) {
    var toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toast.classList.remove('show'); }, 2200);
  }

  // ------------------------------------------------------------------
  // clinic booking window (Settings integration)
  //
  // Reads Opening Time / Closing Time / Default Appointment Duration
  // from PCSettings live, every time it's needed — nothing here is
  // cached in `state`, so a Settings change is picked up the next
  // time the modal is opened or saved (and always after a refresh),
  // without this page needing to know how Settings persists anything.
  //
  // The existing appointment schema has no duration/end-time field
  // (see data-store.js's mk()), so `duration` below is used only for
  // the closing-time boundary math — it is never written onto an
  // appointment record.
  // ------------------------------------------------------------------

  function timeToMinutes(hhmm) {
    if (!hhmm || typeof hhmm !== 'string') return null;
    var parts = hhmm.split(':');
    var h = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
  }

  function minutesToTime(total) {
    var h = Math.floor(total / 60);
    var m = total % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  // Returns the current booking window, guarding against corrupt or
  // missing Settings values (falls back to PCSettings' own defaults
  // for just the pieces that are unusable — never touches what's
  // actually stored in Settings).
  function getApptWindow() {
    var defaults = (window.PCSettings ? window.PCSettings.getDefaultSettings().appointments : null) ||
      { openingTime: '08:00', closingTime: '17:00', defaultDuration: 30 };
    var s = (window.PCSettings ? window.PCSettings.getSettings().appointments : null) || defaults;

    var opening = s.openingTime;
    var closing = s.closingTime;
    var duration = Number(s.defaultDuration);

    var openMin = timeToMinutes(opening);
    var closeMin = timeToMinutes(closing);

    // Opening must be strictly before closing; fall back to defaults
    // if either time is missing/unparsable or the window is inverted.
    if (openMin == null || closeMin == null || openMin >= closeMin) {
      opening = defaults.openingTime;
      closing = defaults.closingTime;
      openMin = timeToMinutes(opening);
      closeMin = timeToMinutes(closing);
    }
    if (!duration || isNaN(duration) || duration <= 0) {
      duration = defaults.defaultDuration;
    }

    return { openingTime: opening, closingTime: closing, openMin: openMin, closeMin: closeMin, duration: duration };
  }

  // Returns an error message if `timeStr` falls outside the configured
  // clinic booking window, or null if it's valid. A start exactly at
  // opening time is allowed; a start exactly at closing time is only
  // allowed if it (plus the default duration) still fits by closing —
  // which in practice means times starting exactly at closing are
  // rejected, since any positive duration would run past it.
  function validateApptWindow(timeStr) {
    var w = getApptWindow();
    var startMin = timeToMinutes(timeStr);
    if (startMin == null) return 'Please enter a valid time.';

    if (startMin < w.openMin) {
      return 'Appointments cannot be booked before opening time (' + D.formatTimeLabel(w.openingTime) + ').';
    }
    var endMin = startMin + w.duration;
    if (endMin > w.closeMin) {
      var latestStart = minutesToTime(Math.max(w.openMin, w.closeMin - w.duration));
      return 'Appointments must end by closing time (' + D.formatTimeLabel(w.closingTime) + '). ' +
        'Based on the default appointment duration (' + w.duration + ' min), the latest start time is ' + D.formatTimeLabel(latestStart) + '.';
    }
    return null;
  }

  // Reflects the current clinic hours under the Time field, and
  // constrains the native time picker to that window as a UX hint
  // (validateApptWindow() at save time remains the authoritative check).
  function applyApptWindowToForm() {
    var w = getApptWindow();
    var timeInput = document.getElementById('f-time');
    if (timeInput) {
      timeInput.min = w.openingTime;
      timeInput.max = w.closingTime;
    }
    var hint = document.getElementById('f-time-hint');
    if (hint) {
      hint.textContent = 'Clinic hours: ' + D.formatTimeLabel(w.openingTime) + ' \u2013 ' + D.formatTimeLabel(w.closingTime);
    }
  }

  // ------------------------------------------------------------------
  // CALENDAR — DAY VIEW
  // ------------------------------------------------------------------

  // Pixel scale for the day schedule: minutes-since-opening * this = top offset.
  // Raised from 1.8, then from 3.2, so that a default 30-min appointment's
  // natural height (durationMin * this rate) reaches CARD_MIN_HEIGHT_PX on
  // its own. At 3.2px/min a 30-min slot only produced 96px, well under the
  // 124px content floor below — so cardHeightPx() silently stretched every
  // standard-length card ~28px past its real time slot, and a card starting
  // exactly when the previous one ended (e.g. 8:30/9:00, back to back) would
  // visually overlap even though the two appointments never actually
  // overlap in time. 4.2px/min makes 30 * 4.2 = 126px, just clearing the
  // 124px floor, so the enforced minimum no longer pushes a card past the
  // start of the next sequential appointment. This keeps card height exactly
  // proportional to duration (per cardHeightPx) for any appointment at or
  // above the clinic's default length; only appointments shorter than that
  // still hit the content floor, same as before.
  var SCHED_PX_PER_MIN = 4.2;

  // Vertical breathing room above the opening-time slot and below the
  // closing-time slot, and the minimum scrollable space kept after the
  // last card so the day never feels like it ends flush against the
  // container edge.
  //
  // SCHED_PAD_TOP no longer needs to reserve room for the "8:00 AM"
  // label above the grid: .sched-time-mark now sits just below its
  // gridline instead of being vertically centered on it (see the
  // removed translateY in the page's <style> block), so the label
  // can't be clipped no matter how small this value is. That's what
  // lets 8:00 AM read as the grid's true first boundary with no
  // leftover blank band above it, while this tiny value just keeps
  // the very first gridline from sitting flush against the
  // container's top border.
  var SCHED_PAD_TOP = 2;
  var SCHED_PAD_BOTTOM = 28;

  // Shared top-offset / height math for a scheduled card, used both when
  // drawing each card and when sizing the grid itself (see renderDay) —
  // keeping this in one place is what guarantees the grid is always at
  // least as tall as the cards it has to contain.
  function cardTopPx(startMin, openMin) {
    return SCHED_PAD_TOP + Math.round((startMin - openMin) * SCHED_PX_PER_MIN);
  }
  // Cards scale their height at the same px-per-minute rate used for TOP
  // position, so a longer appointment gets proportionally more room
  // instead of an arbitrarily gentler rate. This constant does not touch
  // SCHED_PX_PER_MIN itself or how TOP position is computed — it just
  // reuses that rate for height.
  var SCHED_HEIGHT_PX_PER_MIN = SCHED_PX_PER_MIN;

  // Cards must always have room for their full content stack: the pet
  // name + status badge row, the species/breed line beneath it, and the
  // time + service line below that (which can itself wrap to two lines,
  // since .sched-reason clamps at 2 lines), plus the card's own
  // top/bottom padding. 124px covers that stack's real rendered height
  // — measured against both a single-line and a worst-case two-line
  // reason — with a little breathing room; anything shorter is what was
  // clipping the bottom line. Short appointments enforce this floor;
  // longer appointments grow past it based on their duration.
  var CARD_MIN_HEIGHT_PX = 124;

  function cardHeightPx(durationMin) {
    return Math.max(Math.round(durationMin * SCHED_HEIGHT_PX_PER_MIN), CARD_MIN_HEIGHT_PX);
  }

  // Assigns each appointment in a single vet's column to a horizontal
  // "lane" so overlapping bookings sit side-by-side instead of on top
  // of each other, and reports how many lanes are in play at each
  // event's time slot (so cards can size themselves to divide the
  // column width evenly). Appointments never carry a stored duration,
  // so the clinic's configured default appointment length is used for
  // every event's extent — consistent with validateApptWindow().
  function layoutDayEvents(appts, durationMin) {
    var events = appts.map(function (a) {
      var start = timeToMinutes(a.time);
      return { a: a, start: start, end: (start == null ? 0 : start) + durationMin, lane: 0, totalLanes: 1 };
    }).sort(function (x, y) { return x.start - y.start; });

    var active = [];
    events.forEach(function (e) {
      active = active.filter(function (x) { return x.end > e.start; });
      var used = active.map(function (x) { return x.lane; });
      var lane = 0;
      while (used.indexOf(lane) !== -1) lane++;
      e.lane = lane;
      active.push(e);
      var lanesNow = active.length;
      active.forEach(function (x) { x.totalLanes = Math.max(x.totalLanes, lanesNow); });
    });
    return events;
  }

  function scheduleCard(entry, openMin, durationMin) {
    var a = entry.a;
    var info = apptInfo(a);
    var patient = a.patientId ? D.getPatientById(a.patientId) : null;
    var service = (typeof D.getServiceForAppointment === 'function') ? D.getServiceForAppointment(a) : null;
    var top = cardTopPx(entry.start, openMin);
    var height = cardHeightPx(durationMin);
    var widthPct = 100 / entry.totalLanes;
    var leftPct = entry.lane * widthPct;
    var selectedCls = a.id === state.selectedApptId ? ' is-selected' : '';

    // Identity meta line: Species · Age only (breed intentionally left
    // off this card — it's still shown in the Appointment Details panel).
    var metaBits = [];
    if (info.species) metaBits.push(esc(info.species));
    if (patient && patient.age !== undefined && patient.age !== null && patient.age !== '') {
      metaBits.push(esc(patient.age) + (typeof patient.age === 'number' ? ' yrs' : ''));
    }
    var metaLine = metaBits.length
      ? '<div class="sched-card-meta">' + metaBits.join(' &middot; ') + '</div>'
      : '';

    return '<div class="sched-card status-' + a.status + selectedCls + '" data-id="' + a.id + '" draggable="' + (a.status === 'pending' ? 'true' : 'false') + '" ' +
      'style="top:' + top + 'px; height:' + height + 'px; width:calc(' + widthPct + '% - 6px); left:calc(' + leftPct + '% + 3px);">' +
        '<div class="sched-card-body">' +
          // Row 1 (header): identity (name + species·age, left) and
          // status (right), on independent grid columns so the badge
          // always renders at full size and the name only ever
          // shrinks into ellipsis as a last resort — never because
          // the badge took its space, never because of the rows below.
          '<div class="sched-card-header">' +
            '<div class="sched-card-identity">' +
              '<span class="sched-pet-name">' + esc(info.pet) + '</span>' +
              metaLine +
            '</div>' +
            '<span class="status-badge status-' + a.status + '">' + D.STATUS_LABELS[a.status] + '</span>' +
          '</div>' +
          // Rows 2 & 3: time and reason each get their own line — no
          // avatar/icon on this card anymore, and no shared row for
          // time+reason. Reason truncates with an ellipsis (single
          // line) rather than wrapping or pushing further content
          // down; title carries the untruncated text for hover.
          '<div class="sched-card-time">' + D.formatTimeLabel(a.time) + '</div>' +
          '<div class="sched-card-reason" title="' + esc(a.appointmentType || a.reason || (service ? service.name : 'Visit')) + '">' +
            esc(a.appointmentType || a.reason || (service ? service.name : 'Visit')) +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function renderDay() {
    var root = document.getElementById('view-root');

    // renderDay() fully rebuilds .schedule-body-scroll via innerHTML
    // below (and this fires again on every background data refresh via
    // D.onChange(renderCurrentView), not just on user actions), so a
    // fresh element with scrollTop 0 replaces the one the user was
    // scrolled through. Save the outgoing element's scroll position
    // here and reapply it to its replacement once the new markup is in
    // the DOM, so an in-progress scroll survives a background re-render
    // instead of jumping back to the top.
    var prevScheduleScroll = root.querySelector('.schedule-body-scroll');
    var savedScrollTop = prevScheduleScroll ? prevScheduleScroll.scrollTop : 0;

    var all = D.getAppointments().filter(matchesFilters);
    var dayAppts = all.filter(function (a) { return a.date === state.calDate; })
      .sort(function (a, b) { return a.time.localeCompare(b.time); });

    var w = getApptWindow();
    // "Unassigned" is appended as an extra column, alongside the real
    // veterinarian columns, so appointments with no vet assigned still
    // have somewhere to render instead of disappearing from the day
    // view. It's represented here as `null` (not a real vet name) and
    // handled specially wherever `vets` is used below.
    var vets = D.VETS.slice();
    vets.unshift(null);

    // Lay out every vet's column (including Unassigned) up front. The
    // grid must be at least as tall as the true rendered bottom edge of
    // the latest card in any column — a short appointment near closing
    // time still gets the card's enforced minimum height (see
    // cardHeightPx), so its bottom edge can sit slightly past the
    // nominal closing-time offset. Sizing the grid from the real
    // layout, rather than from opening/closing time alone, is what
    // stops the last appointment(s) of the day from being clipped.
    var laidOutByVet = vets.map(function (vet) {
      var vetAppts = dayAppts.filter(function (a) { return vet === null ? !a.vet : a.vet === vet; });
      return { vet: vet, events: layoutDayEvents(vetAppts, w.duration) };
    });

    // Base height ends exactly at the closing-time gridline — it no
    // longer adds SCHED_PAD_BOTTOM unconditionally, since that padding
    // was rendering as blank space past 5:00 PM even on days with no
    // late appointments. A real appointment that runs close to closing
    // still gets its breathing room below, via cardBottom just below.
    var gridHeight = Math.max(Math.round((w.closeMin - w.openMin) * SCHED_PX_PER_MIN), 120) + SCHED_PAD_TOP;
    laidOutByVet.forEach(function (col) {
      col.events.forEach(function (entry) {
        var cardBottom = cardTopPx(entry.start, w.openMin) + cardHeightPx(w.duration) + SCHED_PAD_BOTTOM;
        gridHeight = Math.max(gridHeight, cardBottom);
      });
    });

    // Always include the exact closing-time mark, even if the clinic's
    // closing time doesn't land on an hour boundary, so operating hours
    // are shown fully inclusive of both endpoints.
    var hourMarks = [];
    for (var m = Math.ceil(w.openMin / 60) * 60; m <= w.closeMin; m += 60) hourMarks.push(m);
    if (!hourMarks.length || hourMarks[hourMarks.length - 1] !== w.closeMin) hourMarks.push(w.closeMin);

    var timeMarksHtml = hourMarks.map(function (m) {
      var top = SCHED_PAD_TOP + Math.round((m - w.openMin) * SCHED_PX_PER_MIN);
      return '<div class="sched-time-mark" style="top:' + top + 'px">' + D.formatTimeLabel(minutesToTime(m)) + '</div>';
    }).join('');

    var gridLinesHtml = hourMarks.map(function (m) {
      var top = SCHED_PAD_TOP + Math.round((m - w.openMin) * SCHED_PX_PER_MIN);
      return '<div class="sched-gridline" style="top:' + top + 'px"></div>';
    }).join('');

    var html = '<div class="schedule-wrap">';

    // Only the real veterinarian list gates the "no veterinarians
    // configured" empty state — the Unassigned column always exists
    // structurally, but showing just it with no vets configured
    // would be a confusing, effectively-empty calendar.
    if (!D.VETS.length) {
      html += '<div class="empty-state">No veterinarians configured yet.</div></div>';
      root.innerHTML = html;
      return;
    }

    html += '<div class="schedule-vet-head"><div class="schedule-time-head"></div>' +
      vets.map(function (vet) {
        return '<div class="schedule-vet-col-head"><i class="fa-solid fa-notes-medical"></i>' + esc(vet === null ? 'Unassigned' : vet) + '</div>';
      }).join('') + '</div>';

    html += '<div class="schedule-body-scroll"><div class="schedule-body" style="height:' + gridHeight + 'px;">' +
      '<div class="schedule-time-col" style="height:' + gridHeight + 'px;">' + timeMarksHtml + '</div>';

    // A per-column "No appointments / Available" note only makes sense
    // once we know at least one column *does* have an appointment today
    // (dayAppts.length > 0) — when the whole day is empty, or the whole
    // day is only empty because of the active filters, that's handled
    // once for the full schedule body below instead of repeating the
    // same message in every column.
    var showPerColumnEmpty = dayAppts.length > 0;

    vets.forEach(function (vet, vi) {
      var laidOut = laidOutByVet[vi].events;
      var colEmptyHtml = (showPerColumnEmpty && !laidOut.length)
        ? '<div class="sched-col-empty"><div class="sce-title">No appointments</div><div class="sce-sub">Available</div></div>'
        : '';
      // data-vet identifies this column as a drop target for Step 7B
      // rescheduling: '' means Unassigned (see bindDayDropTargets),
      // anything else is a real vet name from the existing D.VETS list.
      html += '<div class="sched-vet-col" data-vet="' + (vet === null ? '' : esc(vet)) + '" style="height:' + gridHeight + 'px;">' + gridLinesHtml +
        colEmptyHtml +
        laidOut.map(function (entry) { return scheduleCard(entry, w.openMin, w.duration); }).join('') +
        '</div>';
    });

    html += '</div></div></div>';

    root.innerHTML = html;

    // Reapply the scroll position saved above to the newly-built
    // element, so a background refresh mid-scroll leaves the user
    // exactly where they were instead of snapping to the top.
    var newScheduleScroll = root.querySelector('.schedule-body-scroll');
    if (newScheduleScroll) newScheduleScroll.scrollTop = savedScrollTop;

    if (!dayAppts.length) {
      // Distinguish "the clinic genuinely has nothing booked today" from
      // "there are appointments today, but the active search/vet/status/
      // type filters are hiding all of them" — the two need different
      // messages so filters never falsely read as an empty schedule.
      var dayHasAnyUnfiltered = D.getAppointments().some(function (a) { return a.date === state.calDate; });
      var note = dayHasAnyUnfiltered
        ? el('<div class="sched-empty-note is-filtered"><div class="sen-title">No appointments match your filters</div></div>')
        : el('<div class="sched-empty-note"><div class="sen-title">No appointments scheduled for today</div><div class="sen-sub">New bookings will show up here automatically.</div></div>');
      root.querySelector('.schedule-body').appendChild(note);
    }

    root.querySelectorAll('.sched-card').forEach(function (card) {
      card.addEventListener('click', function () {
        if (dragJustHappened) return;
        state.selectedApptId = card.getAttribute('data-id');
        renderCurrentView();
      });
    });
    bindCardDragHandlers(root, '.sched-card');
    // Fallback: any drop that lands outside an actual vet column (time
    // rail, header row, empty-state note, etc.) is swallowed harmlessly
    // here so the browser doesn't attempt its own default drop
    // behavior. Bound to the whole .schedule-wrap (not just
    // .schedule-body) so that a native "not-allowed"/default cursor
    // never flashes while the pointer briefly crosses the vet-name
    // header row directly above the columns — e.g. reaching toward the
    // day's earliest time slot — which is outside .schedule-body but
    // still squarely inside the calendar. Real rescheduling is handled
    // per-column by bindDayDropTargets below, whose listeners run first
    // for drops that land on a column.
    var scheduleWrap = root.querySelector('.schedule-wrap');
    if (scheduleWrap) bindDropNoOp(scheduleWrap);
    bindDayDropTargets(root, w);
  }

  function shiftCalDate(days) {
    var d = D.parseDate(state.calDate);
    d.setDate(d.getDate() + days);
    state.calDate = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    renderCurrentView();
  }

  // ------------------------------------------------------------------
  // CALENDAR — WEEK VIEW
  // ------------------------------------------------------------------

  function startOfWeek(iso) {
    var d = D.parseDate(iso);
    var day = d.getDay(); // 0 = Sun
    d.setDate(d.getDate() - day);
    return d;
  }

  function renderWeek() {
    var root = document.getElementById('view-root');
    var all = D.getAppointments().filter(matchesFilters);
    var start = startOfWeek(state.calDate);
    var today = D.todayStr();

    var days = [];
    for (var i = 0; i < 7; i++) {
      var d = new Date(start);
      d.setDate(start.getDate() + i);
      var iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      days.push({ iso: iso, date: d });
    }

    var html = '<div class="week-grid">';
    days.forEach(function (day) {
      var dayAppts = all.filter(function (a) { return a.date === day.iso; }).sort(function (a, b) { return a.time.localeCompare(b.time); });
      var isToday = day.iso === today;
      html += '<div class="week-day-col">' +
        '<div class="week-day-head' + (isToday ? ' is-today' : '') + '">' +
          '<div class="wd-name">' + day.date.toLocaleDateString(undefined, { weekday: 'short' }) + '</div>' +
          '<div class="wd-num">' + day.date.getDate() + '</div>' +
        '</div>' +
        '<div class="week-day-body">' +
        (dayAppts.length ? dayAppts.map(function (a) {
          var info = apptInfo(a);
          var selectedCls = a.id === state.selectedApptId ? ' is-selected' : '';
          return '<div class="week-chip st-' + a.status + selectedCls + '" data-id="' + a.id + '" draggable="' + (a.status === 'pending' ? 'true' : 'false') + '">' +
            '<span class="wc-pet">' + esc(info.pet) + '</span>' +
            '<span class="wc-meta">' +
              '<span class="wc-time">' + D.formatTimeLabel(a.time) + '</span>' +
              '<span class="wc-dot">&middot;</span>' +
              '<span class="wc-reason">' + esc(a.reason || 'General visit') + '</span>' +
            '</span>' +
            '</div>';
        }).join('') : '') +
        '</div></div>';
    });
    html += '</div>';

    root.innerHTML = html;

    root.querySelectorAll('.week-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        if (dragJustHappened) return;
        state.selectedApptId = chip.getAttribute('data-id');
        renderCurrentView();
      });
    });
    bindCardDragHandlers(root, '.week-chip');
    var weekGrid = root.querySelector('.week-grid');
    if (weekGrid) bindDropNoOp(weekGrid);
  }

  // ------------------------------------------------------------------
  // CALENDAR — MONTH VIEW
  // ------------------------------------------------------------------

  function renderMonth() {
    var root = document.getElementById('view-root');
    var all = D.getAppointments().filter(matchesFilters);
    var focus = D.parseDate(state.calDate);
    var year = focus.getFullYear();
    var month = focus.getMonth();
    var today = D.todayStr();

    var firstOfMonth = new Date(year, month, 1);
    var startOffset = firstOfMonth.getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();

    var html = '<div class="month-grid">';
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(function (w) {
      html += '<div class="month-weekday-label">' + w + '</div>';
    });

    for (var i = 0; i < startOffset; i++) {
      html += '<div class="month-cell is-empty"></div>';
    }

    for (var day = 1; day <= daysInMonth; day++) {
      var iso = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      var dayAppts = all.filter(function (a) { return a.date === iso; });
      var isToday = iso === today;
      html += '<div class="month-cell' + (isToday ? ' is-today' : '') + '" data-date="' + iso + '">' +
        '<div class="month-cell-num">' + day + '</div>' +
        '<div class="month-dot-row">' +
        dayAppts.slice(0, 8).map(function (a) { return '<span class="month-dot st-' + a.status + '"></span>'; }).join('') +
        '</div>' +
        (dayAppts.length ? '<div class="month-more">' + dayAppts.length + ' appt' + (dayAppts.length > 1 ? 's' : '') + '</div>' : '') +
        '</div>';
    }

    html += '</div>';
    root.innerHTML = html;

    root.querySelectorAll('.month-cell[data-date]').forEach(function (cell) {
      cell.addEventListener('click', function () {
        state.calDate = cell.getAttribute('data-date');
        state.calSubView = 'day';
        syncCalSubTabs();
        renderCurrentView();
      });
    });
  }

  function shiftMonth(delta) {
    var d = D.parseDate(state.calDate);
    d.setMonth(d.getMonth() + delta, 1);
    state.calDate = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    renderCurrentView();
  }

  // ------------------------------------------------------------------
  // draggable appointment cards (Step 7A)
  //
  // Visual-only dragging: every appointment card (Unassigned and every
  // vet column, plus the Week view's chips) can be picked up and given
  // a clear "being dragged" state, but nothing is dropped anywhere yet
  // — no vet reassignment, no date/time change, no queue integration.
  // That's deliberately left for a later step.
  // ------------------------------------------------------------------

  // Sets a short-lived flag after a drag ends so a stray click event
  // some browsers fire on the same element right after a drag can't be
  // mistaken for the user clicking the card to select it. Native
  // HTML5 drag/drop already suppresses the click in most browsers, but
  // this is a small, cheap belt-and-suspenders guard.
  var dragJustHappened = false;

  // Only readable during dragover via this — dataTransfer.getData() is
  // spec'd to return '' outside of dragstart/drop, so the live conflict
  // check in bindDayDropTargets (which needs to know which appointment
  // is being dragged, to read its vet/duration) can't rely on it.
  var draggedApptId = null;

  // Distance (px) from the top of the card down to the exact point the
  // user grabbed it, captured once at dragstart. This is a plain JS
  // number kept for our own hit-testing math — separate from the value
  // handed to setDragImage() below, which only controls the *visual*
  // ghost and isn't readable back out of dataTransfer during dragover
  // (getData() is spec'd to return '' until drop). bindDayDropTargets
  // uses this so the column math lines up with the same grab point the
  // ghost is anchored to, instead of assuming the pointer marks the
  // card's top edge.
  var draggedGrabOffsetY = 0;

  function bindCardDragHandlers(root, selector) {
    root.querySelectorAll(selector).forEach(function (card) {
      card.addEventListener('dragstart', function (e) {
        draggedApptId = card.getAttribute('data-id') || null;
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          // Identifies the card only; nothing reads this yet since drop
          // handling is intentionally a no-op in this step.
          e.dataTransfer.setData('text/plain', card.getAttribute('data-id') || '');

          // Without this, each browser falls back to its own default
          // drag-image placement, and those defaults don't agree on
          // where the snapshot anchors under the cursor for a
          // `position: absolute` card like this one — which is what
          // made the drag feel detached/"cursor-like" instead of like
          // picking the card up from wherever it was grabbed. Explicitly
          // computing the offset from the real bounding rect fixes the
          // anchor at the exact pixel the user grabbed: the middle stays
          // centered under the pointer, the top stays top-anchored, etc.
          // — no large invisible offset, no forced top-edge attachment.
          var rect = card.getBoundingClientRect();
          draggedGrabOffsetY = e.clientY - rect.top;
          if (e.dataTransfer.setDragImage) {
            e.dataTransfer.setDragImage(card, e.clientX - rect.left, draggedGrabOffsetY);
          }
        }
        // Deferred by one tick on purpose: Chromium-family browsers
        // build the default drag-image snapshot from the card's DOM
        // state right after dragstart's handlers finish (not before),
        // so adding is-dragging synchronously here — with its 2px
        // lift and opacity/shadow change — got baked into the ghost
        // image itself, making the dragged visual feel a couple of
        // pixels off from the actual grab point under the pointer.
        // Applying the class one tick later lets the browser capture
        // its snapshot from the normal, unlifted card first; the
        // source element still gets is-dragging immediately after,
        // so the visual state and timing of everything else (lift,
        // shadow, cursor) is unchanged.
        setTimeout(function () { card.classList.add('is-dragging'); }, 0);
      });
      card.addEventListener('dragend', function () {
        card.classList.remove('is-dragging');
        dragJustHappened = true;
        draggedApptId = null;
        draggedGrabOffsetY = 0;
        setTimeout(function () { dragJustHappened = false; }, 50);
        // Safety net only — normal drags already clear their own
        // column's highlight/indicator via dragleave/drop. This just
        // catches a drag that ends without either firing on a column
        // (dropped outside any column, or cancelled with Escape) so
        // no stray highlight/indicator is left on screen.
        document.querySelectorAll('.sched-vet-col.is-drop-target, .sched-vet-col.is-drop-invalid').forEach(function (c) {
          c.classList.remove('is-drop-target', 'is-drop-invalid');
        });
        document.querySelectorAll('.sched-drop-indicator').forEach(function (i) {
          if (i.parentNode) i.parentNode.removeChild(i);
        });
      });
    });
  }

  // Lets a card be dragged over/dropped anywhere within `root` without
  // the browser showing a "not allowed" cursor or attempting its own
  // default drop behavior — but the drop itself is a no-op, so the
  // appointment always stays exactly where it was and nothing is
  // created, moved, or reassigned.
  function bindDropNoOp(root) {
    root.addEventListener('dragover', function (e) { e.preventDefault(); });
    root.addEventListener('drop', function (e) { e.preventDefault(); });
  }

  // ------------------------------------------------------------------
  // Day-view rescheduling (Step 7B)
  //
  // Turns the Step 7A drag state into an actual reschedule: dropping a
  // card onto a .sched-vet-col reassigns the appointment's vet (from
  // the column's data-vet) and, using the same pixel-per-minute scale
  // the grid already draws cards with (cardTopPx/SCHED_PX_PER_MIN),
  // its time — snapped to the clinic's existing default-appointment-
  // duration increment, the same increment the grid's own hour marks
  // and card heights already use. No parallel time system is created.
  // ------------------------------------------------------------------

  // Inverse of cardTopPx: given a pointer offset (px from the top of a
  // .sched-vet-col) snap it to the nearest slot, where a "slot" is the
  // clinic's configured default appointment duration (e.g. 30 min).
  // Clamped to the clinic's booking window so a drop can't push an
  // appointment to a nonsensical time before opening or after closing.
  function snapOffsetToMinutes(offsetY, w) {
    var rawMin = w.openMin + (offsetY - SCHED_PAD_TOP) / SCHED_PX_PER_MIN;
    var slot = w.duration;
    var snapped = Math.round(rawMin / slot) * slot;
    if (snapped < w.openMin) snapped = w.openMin;
    if (snapped > w.closeMin) snapped = w.closeMin;
    return snapped;
  }

  // A dragover/drop's e.clientY marks wherever within the card the user
  // originally grabbed it — not the card's top edge — since the drag
  // ghost (via setDragImage above) keeps following the pointer at that
  // same grabbed point. Subtracting draggedGrabOffsetY converts that
  // back into "where would this card's top edge be", which is what the
  // snapped time actually needs: grab the card's middle and hover over
  // 2:00 PM, and the card's top (hence its start time) should land at
  // 2:00 PM minus half the card's height, matching where the ghost is
  // visibly sitting — not at 2:00 PM itself, which would require
  // dragging noticeably past the intended slot to compensate.
  function cardTopOffsetFromEvent(e, colRect) {
    return (e.clientY - colRect.top) - draggedGrabOffsetY;
  }

  function bindDayDropTargets(root, w) {
    root.querySelectorAll('.sched-vet-col').forEach(function (col) {
      var indicator = null;
      // Fixed for this column's lifetime (columns are rebuilt on every
      // render), so this is read once rather than on every dragover.
      var vetAttr = col.getAttribute('data-vet');
      var targetVet = vetAttr ? vetAttr : null;

      function showIndicatorAt(offsetY) {
        var snapped = snapOffsetToMinutes(offsetY, w);
        if (!indicator) {
          indicator = document.createElement('div');
          indicator.className = 'sched-drop-indicator';
          col.appendChild(indicator);
        }
        indicator.style.top = cardTopPx(snapped, w.openMin) + 'px';

        // Live vet-availability check, reusing the same
        // D.findApptConflict rule the drop handler below (and the
        // Add/Edit modal) enforce. draggedApptId is set in
        // bindCardDragHandlers' dragstart — dataTransfer.getData()
        // isn't readable during dragover, so it can't come from
        // there. Unassigned (targetVet falsy) has no capacity to
        // double-book, so it's never flagged invalid.
        var conflict = targetVet
          ? D.findApptConflict(targetVet, state.calDate, snapped, w.duration, draggedApptId)
          : null;

        // Same snapped value the drop handler below will actually
        // save — reusing the existing minutesToTime/formatTimeLabel
        // helpers (no new time-formatting logic) keeps the label and
        // the eventual saved time guaranteed to match.
        var label = D.formatTimeLabel(minutesToTime(snapped));
        if (conflict) label += ' \u00b7 Unavailable';
        indicator.setAttribute('data-time-label', label);
        indicator.classList.toggle('is-invalid', !!conflict);
        col.classList.toggle('is-drop-invalid', !!conflict);

        return { snapped: snapped, conflict: conflict };
      }

      function clearIndicator() {
        if (indicator && indicator.parentNode) indicator.parentNode.removeChild(indicator);
        indicator = null;
      }

      col.addEventListener('dragover', function (e) {
        e.preventDefault();
        col.classList.add('is-drop-target');
        var rect = col.getBoundingClientRect();
        var result = showIndicatorAt(cardTopOffsetFromEvent(e, rect));
        // The browser's own "not-allowed" cursor, as a free extra cue
        // on top of (not instead of) the indicator's own color/label —
        // same drop, just reflecting whether it would actually land.
        if (e.dataTransfer) e.dataTransfer.dropEffect = result.conflict ? 'none' : 'move';
      });

      col.addEventListener('dragleave', function (e) {
        // Moving between child elements (e.g. onto a card, or the
        // indicator itself) fires dragleave too; only treat it as
        // actually leaving the column when the pointer truly left it.
        if (e.relatedTarget && col.contains(e.relatedTarget)) return;
        col.classList.remove('is-drop-target', 'is-drop-invalid');
        clearIndicator();
      });

      col.addEventListener('drop', function (e) {
        e.preventDefault();
        col.classList.remove('is-drop-target', 'is-drop-invalid');
        var rect = col.getBoundingClientRect();
        var snappedMin = snapOffsetToMinutes(cardTopOffsetFromEvent(e, rect), w);
        clearIndicator();

        var id = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
        if (!id) return;
        var appt = D.getAppointments().find(function (a) { return a.id === id; });
        if (!appt) return;

        // Re-checked fresh at drop time (not just trusted from the
        // last dragover) using the same rule/helper as above and the
        // Add/Edit modal — if the destination is occupied, the drop
        // is rejected: no D.updateAppointment call, appointment left
        // exactly as it was.
        var conflict = targetVet ? D.findApptConflict(targetVet, state.calDate, snappedMin, w.duration, id) : null;
        if (conflict) {
          showToast((targetVet || 'This veterinarian') + ' already has an appointment at ' + D.formatTimeLabel(conflict.time) + ' \u2014 drop cancelled.');
          return;
        }

        // Only touch the two fields the drag actually controls — the
        // existing updateAppointment() patch-merges, so id, date,
        // status, appointmentType, reason, pet/client info, queueCode,
        // etc. are all preserved untouched.
        D.updateAppointment(id, { vet: targetVet, time: minutesToTime(snappedMin) });
      });
    });
  }

  // ------------------------------------------------------------------
  // shared actions (confirm / cancel / edit / mark arrived)
  // ------------------------------------------------------------------

  function bindCardActions(root) {
    root.querySelectorAll('[data-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-id');
        var action = btn.getAttribute('data-action');
        if (action === 'confirm') {
          D.confirmAppointment(id);
          showToast('Appointment confirmed');
        } else if (action === 'cancel') {
          if (confirm('Cancel this appointment?')) {
            D.cancelAppointment(id);
            showToast('Appointment cancelled');
          }
        } else if (action === 'arrive') {
          var code = D.markArrived(id);
          showToast(a_name(id) + ' checked in — queue code ' + code);
        } else if (action === 'start-consultation') {
          D.startAppointmentConsultation(id);
          showToast(a_name(id) + ' moved to In Consultation');
        } else if (action === 'complete-consultation') {
          D.completeAppointmentConsultation(id);
          showToast(a_name(id) + '\u2019s consultation completed');
        } else if (action === 'edit' || action === 'edit-notes') {
          openModal(id);
        }
        renderCurrentView();
      });
    });
  }

  function a_name(id) {
    var a = D.getById(id);
    return a ? apptInfo(a).pet : 'Patient';
  }

  // ------------------------------------------------------------------
  // client / patient picker (Add/Edit modal)
  // Mirrors the same Client → Patient linking pattern used on the
  // Patients page: pick an existing Client, then only that Client's
  // Patients are selectable — nothing is free-typed.
  // ------------------------------------------------------------------

  // Legacy fallback: appointments saved before the picker existed only
  // have a typed owner/pet name, no clientId/patientId. Matches them to
  // a real Client/Patient by name so editing one pre-selects the right
  // record instead of forcing a blind re-pick.
  function findClientForOwnerName(name) {
    var n = (name || '').trim().toLowerCase();
    if (!n) return null;
    return D.getClients().find(function (c) { return (c.name || '').trim().toLowerCase() === n; }) || null;
  }

  function findPatientForClient(clientId, petName) {
    var n = (petName || '').trim().toLowerCase();
    if (!n || !clientId) return null;
    return D.getPatients().find(function (p) {
      return p.clientId === clientId && (p.pet || '').trim().toLowerCase() === n;
    }) || null;
  }

  function renderClientResults(query) {
    var box = document.getElementById('client-search-results');
    var q = (query || '').trim().toLowerCase();
    var all = D.getClients().slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    var list = !q ? all : all.filter(function (c) {
      return (c.name + ' ' + c.phone + ' ' + c.email).toLowerCase().indexOf(q) !== -1;
    });

    if (!list.length) {
      box.innerHTML = '<div class="client-search-empty">No matching client. <a href="clients.html" style="color:var(--teal-600); font-weight:800;">Add them on the Clients page</a>.</div>';
      return;
    }

    box.innerHTML = list.slice(0, 8).map(function (c) {
      return '<div class="client-result-row" data-client-id="' + c.id + '">' +
        '<span class="crn">' + esc(c.name) + '</span>' +
        '<span class="crm">' + esc(c.phone || '—') + (c.email ? ' · ' + esc(c.email) : '') + '</span>' +
      '</div>';
    }).join('');

    box.querySelectorAll('[data-client-id]').forEach(function (row) {
      row.addEventListener('click', function () {
        var client = D.getClientById(row.getAttribute('data-client-id'));
        if (client) selectClient(client);
      });
    });
  }

  function selectClient(client, preselectPatientId) {
    state.selectedClient = client;
    document.getElementById('f-client-id').value = client.id;
    document.getElementById('csc-name').textContent = client.name;
    document.getElementById('csc-meta').textContent = (client.phone || '—') + (client.email ? ' · ' + client.email : '');
    document.getElementById('client-selected-view').style.display = 'flex';
    document.getElementById('client-search-view').style.display = 'none';
    document.getElementById('f-phone').value = client.phone || '';
    refreshPatientOptions(preselectPatientId);
  }

  function showClientSearchView(prefillQuery) {
    document.getElementById('client-selected-view').style.display = 'none';
    document.getElementById('client-search-view').style.display = 'block';
    var input = document.getElementById('f-client-search');
    input.value = prefillQuery || '';
    renderClientResults(prefillQuery || '');
  }

  // Populates the Patient/pet <select> with only the pets belonging to
  // state.selectedClient, per the required Client → Patient relationship.
  function refreshPatientOptions(preselectPatientId) {
    var sel = document.getElementById('f-patient');
    var client = state.selectedClient;

    if (!client) {
      sel.innerHTML = '<option value="">Select a client first…</option>';
      sel.disabled = true;
      return;
    }

    var pets = D.getPatients().filter(function (p) { return p.clientId === client.id; })
      .sort(function (a, b) { return a.pet.localeCompare(b.pet); });

    if (!pets.length) {
      sel.innerHTML = '<option value="">No pets found for this client</option>';
      sel.disabled = true;
      applySpeciesFromPatient(null);
      return;
    }

    sel.disabled = false;
    sel.innerHTML = '<option value="">Select a pet…</option>' + pets.map(function (p) {
      return '<option value="' + p.id + '">' + esc(p.pet) + ' (' + esc(p.species) + ')</option>';
    }).join('');

    if (preselectPatientId && pets.some(function (p) { return p.id === preselectPatientId; })) {
      sel.value = preselectPatientId;
    }
    applySpeciesFromPatient(sel.value ? D.getPatientById(sel.value) : null);
  }

  function applySpeciesFromPatient(patient) {
    if (patient && patient.species) {
      document.getElementById('f-species').value = patient.species;
    }
  }

  // ------------------------------------------------------------------
  // add/edit modal
  // ------------------------------------------------------------------

  function openModal(id) {
    state.editingId = id || null;
    var a = id ? D.getById(id) : null;

    document.getElementById('modal-title').textContent = a ? 'Edit Appointment' : 'Add Appointment';

    // Status is only manually editable when editing an existing
    // appointment (status-change actions for a *new* appointment live
    // elsewhere, e.g. the Appointment Details panel / queue flow, once
    // it exists). New appointments always start at 'pending', which is
    // still set below via `document.getElementById('f-status').value`.
    var statusField = document.getElementById('f-status-field');
    if (statusField) statusField.style.display = a ? '' : 'none';

    document.getElementById('modal-cancel').textContent = a ? 'Close' : 'Cancel';
    document.getElementById('modal-save').textContent = a ? 'Save appointment' : 'Create Appointment';

    document.getElementById('f-species').value = a ? a.species : 'Dog';
    document.getElementById('f-vet').value = a ? a.vet : D.VETS[0];
    document.getElementById('f-date').value = a ? a.date : state.calDate || D.todayStr();
    document.getElementById('f-time').value = a ? a.time : '09:00';
    document.getElementById('f-reason').value = a ? a.reason : '';
    document.getElementById('f-appointment-type').value = (a && a.appointmentType) ? a.appointmentType : '';
    document.getElementById('f-status').value = a ? a.status : 'pending';
    document.getElementById('f-notes').value = a ? a.notes : '';
    populateServiceOptions(a ? a.serviceId : null);

    // Resolve the Client/Patient to preselect. Prefer real links
    // (patientId/clientId); fall back to matching legacy typed
    // owner/pet text so older appointments can still be edited.
    var patient = a && a.patientId ? D.getPatientById(a.patientId) : null;
    var client = null;
    if (patient && patient.clientId) {
      client = D.getClientById(patient.clientId);
    } else if (a && a.clientId) {
      client = D.getClientById(a.clientId);
      if (client && !patient) patient = findPatientForClient(client.id, a.pet);
    } else if (a) {
      client = findClientForOwnerName(a.owner);
      if (client) patient = findPatientForClient(client.id, a.pet);
    }

    if (client) {
      selectClient(client, patient ? patient.id : null);
    } else {
      state.selectedClient = null;
      document.getElementById('f-client-id').value = '';
      document.getElementById('f-phone').value = a ? a.phone : '';
      refreshPatientOptions(null);
      showClientSearchView(a ? a.owner : '');
    }

    document.getElementById('modal-delete').style.display = a ? 'inline-flex' : 'none';
    applyApptWindowToForm();
    document.getElementById('modal-overlay').classList.add('open');
  }

  function closeModal() {
    document.getElementById('modal-overlay').classList.remove('open');
    state.editingId = null;
    state.selectedClient = null;
  }

  function saveModal() {
    var client = state.selectedClient;
    var patientId = document.getElementById('f-patient').value;
    var patient = patientId ? D.getPatientById(patientId) : null;

    var fields = {
      pet: patient ? patient.pet : '',
      species: document.getElementById('f-species').value,
      owner: client ? client.name : '',
      phone: document.getElementById('f-phone').value.trim(),
      clientId: client ? client.id : null,
      patientId: patient ? patient.id : null,
      serviceId: document.getElementById('f-service').value || null,
      vet: document.getElementById('f-vet').value,
      date: document.getElementById('f-date').value,
      time: document.getElementById('f-time').value,
      reason: document.getElementById('f-reason').value.trim(),
      appointmentType: document.getElementById('f-appointment-type').value || null,
      status: document.getElementById('f-status').value,
      notes: document.getElementById('f-notes').value.trim()
    };

    if (!client) {
      showToast('Please select an existing client (owner)');
      return;
    }
    if (!patient) {
      showToast('Please select the client\u2019s pet');
      return;
    }
    if (!fields.date || !fields.time) {
      showToast('Please fill in date and time');
      return;
    }
    if (!fields.serviceId) {
      showToast('Please select a clinic service');
      return;
    }

    var windowError = validateApptWindow(fields.time);
    if (windowError) {
      showToast(windowError);
      return;
    }

    // Same vet-availability rule the calendar's drag-and-drop enforces
    // (D.findApptConflict, shared in data-store.js) — Unassigned has no
    // capacity to double-book, so it's skipped here too.
    if (fields.vet) {
      var w = getApptWindow();
      var startMin = timeToMinutes(fields.time);
      var conflict = D.findApptConflict(fields.vet, fields.date, startMin, w.duration, state.editingId || null);
      if (conflict) {
        showToast(fields.vet + ' already has an appointment at ' + D.formatTimeLabel(conflict.time) + ' that overlaps this time.');
        return;
      }
    }

    if (state.editingId) {
      var prev = D.getById(state.editingId);
      if (fields.status === 'arrived' && prev && prev.status !== 'arrived') {
        // moving into "arrived" through the edit form should also enter the queue
        D.updateAppointment(state.editingId, fields);
        D.markArrived(state.editingId);
      } else if (fields.status !== 'arrived' && prev && prev.queueCode) {
        // moving out of "arrived" clears any queue position
        fields.queueCode = null;
        fields.queueStatus = null;
        fields.arrivedAt = null;
        D.updateAppointment(state.editingId, fields);
      } else {
        D.updateAppointment(state.editingId, fields);
      }
      showToast('Appointment updated');
    } else {
      D.addAppointment(fields);
      showToast('Appointment added');
    }

    closeModal();
    renderCurrentView();
  }

  // ------------------------------------------------------------------
  // top-level render / wiring
  // ------------------------------------------------------------------

  function syncCalSubTabs() {
    ['day', 'week', 'month'].forEach(function (v) {
      document.getElementById('cal-' + v).classList.toggle('active', state.calSubView === v);
    });
  }

  // Keeps the single calendar-toolbar date label in sync with whichever
  // calendar sub-view (day/week/month) is currently active.
  function updateCalToolbarLabel() {
    var label;
    if (state.calSubView === 'week') {
      var start = startOfWeek(state.calDate);
      var end = new Date(start);
      end.setDate(start.getDate() + 6);
      label = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
        ' \u2013 ' + end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } else if (state.calSubView === 'month') {
      label = D.parseDate(state.calDate).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    } else {
      label = D.parseDate(state.calDate).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    }
    var labelEl = document.getElementById('cal-date-label');
    if (labelEl) labelEl.textContent = label;
  }

  // ------------------------------------------------------------------
  // appointment summary strip (Calendar view only)
  //
  // Operational snapshot of TODAY's clinic activity for the front-desk
  // admin: how many appointments are on today's schedule, and where
  // they currently stand in the visit workflow (Confirmed / Arrived /
  // In Consultation). This is intentionally always scoped to the
  // actual calendar day ("today"), not to whichever day/week/month the
  // calendar toolbar happens to be showing, and not to the schedule's
  // search/vet/status filters — it's meant to always reflect the real
  // state of today's clinic, independent of what's currently on screen.
  // ------------------------------------------------------------------

  function getTodaysAppts() {
    var todayIso = D.todayStr();
    return D.getAppointments().filter(function (a) { return a.date === todayIso; });
  }

  // One individual status card: a label on the left and a small
  // bare Font Awesome icon at the far right of the header, then a
  // restrained value and a muted description underneath. `primary`
  // marks the lead ("Today's Appointments") card for its slightly
  // stronger emphasis (faint teal card tint + teal icon/label).
  function summaryMetric(icon, label, value, desc, primary) {
    return '<div class="summary-metric' + (primary ? ' summary-metric-primary' : '') + '">' +
        '<div class="summary-metric-head">' +
          '<div class="summary-metric-label">' + label + '</div>' +
          '<i class="fa-solid ' + icon + ' summary-metric-icon"></i>' +
        '</div>' +
        '<div class="summary-metric-value">' + value + '</div>' +
        '<div class="summary-metric-desc">' + desc + '</div>' +
    '</div>';
  }

  function renderSummaryStrip() {
    var strip = document.getElementById('summary-strip');
    if (!strip) return;
    var list = getTodaysAppts();
    var total = list.length;
    // Cancelled appointments scheduled for today stay in `total`
    // (they were, and remain, part of today's schedule) but don't
    // map to any of the four workflow buckets below.
    var counts = { confirmed: 0, arrived: 0, consultation: 0, 'no-show': 0 };
    list.forEach(function (a) { if (counts.hasOwnProperty(a.status)) counts[a.status]++; });

    strip.innerHTML =
      summaryMetric('fa-calendar-days', "Today's Appointments", total, 'scheduled today', true) +
      summaryMetric('fa-circle-check', 'Confirmed', counts.confirmed, 'confirmed appointments') +
      summaryMetric('fa-user-check', 'Arrived', counts.arrived, 'patients arrived') +
      summaryMetric('fa-stethoscope', 'In Consultation', counts.consultation, 'currently being seen') +
      summaryMetric('fa-calendar-xmark', 'No-shows', counts['no-show'], 'missed appointments');
  }

  // ------------------------------------------------------------------
  // appointment details panel (Calendar view only)
  // ------------------------------------------------------------------

  function detailsRow(icon, label, value, isEmpty) {
    return '<div class="details-row"><i class="fa-solid ' + icon + '"></i>' +
      '<div><span class="details-sr-only">' + label + ': </span><div class="details-row-value' + (isEmpty ? ' is-empty' : '') + '">' + value + '</div></div></div>';
  }

  // Owner Information reads as a compact personal profile summary
  // rather than a form: an identity row for the owner's name (larger,
  // more prominent), then plain icon+value rows for everyday contact
  // fields (no visible caption — the icon carries the meaning, the
  // original caption is kept for screen readers via
  // .details-sr-only). Nothing here is ever invented: `value` must
  // already be a real (and already-escaped) string pulled from the
  // client record, or this falls back to the placeholder text.
  function detailsIdentityRow(icon, label, value, emptyText) {
    var hasValue = value !== undefined && value !== null && value !== '';
    return '<div class="details-identity-row"><i class="fa-solid ' + icon + '"></i>' +
      '<span class="details-field-label">' + label + '</span>' +
      '<span class="details-identity-value' + (hasValue ? '' : ' is-empty') + '">' +
      (hasValue ? value : (emptyText || 'Not recorded')) + '</span></div>';
  }
  function detailsPlainRow(icon, label, value, emptyText) {
    var hasValue = value !== undefined && value !== null && value !== '';
    return '<div class="details-plain-row"><i class="fa-solid ' + icon + '"></i>' +
      '<span class="details-field-label">' + label + '</span>' +
      '<span class="details-plain-value' + (hasValue ? '' : ' is-empty') + '">' +
      (hasValue ? value : (emptyText || 'Not recorded')) + '</span></div>';
  }

  // Picks up a spayed/neutered value under whatever key name the
  // patient record actually uses (schema not visible from this
  // module) without guessing a value when none of them are set.
  // Still used by the pet header's meta line in renderDetailsPanel().
  function detailsSpayNeuterValue(patient) {
    if (!patient) return '';
    var raw = patient.spayedNeutered;
    if (raw === undefined) raw = patient.neutered;
    if (raw === undefined) raw = patient.altered;
    if (raw === undefined) raw = patient.sterilized;
    if (raw === undefined || raw === null || raw === '') return '';
    return typeof raw === 'boolean' ? (raw ? 'Yes' : 'No') : esc(raw);
  }

  function detailsInfoGroupsHtml(info) {
    // Owner: name leads as the identity row, phone/email follow as
    // plain icon+value rows — matches the reference's flat contact list.
    var ownerFields =
      detailsIdentityRow('fa-user', 'Name', info.owner ? esc(info.owner) : '', 'Not provided') +
      detailsPlainRow('fa-phone', 'Contact', info.phone ? esc(info.phone) : '', 'Not provided') +
      detailsPlainRow('fa-envelope', 'Email', info.email ? esc(info.email) : '', 'Not provided');

    // Pet Information no longer has its own section here for any
    // status — the pet's identity/species/age/sex/owner is already
    // shown in the pet header above. Owner Information is the only
    // column now; .details-columns' grid-template-columns:
    // repeat(auto-fit, minmax(150px, 1fr)) naturally stretches a
    // single .details-column to fill the row, so no CSS change is
    // needed for this single-column case.
    var ownerColumnHtml =
      '<div class="details-column">' +
        '<div class="details-column-title"><i class="fa-solid fa-user"></i>Owner Information</div>' +
        '<div class="details-fields">' + ownerFields + '</div>' +
      '</div>';

    return '<div class="details-columns">' + ownerColumnHtml + '</div>';
  }

  // Panel actions follow the real workflow stage (a.status), rendered as
  // full-width panel buttons:
  //   Scheduled ('pending')  -> Confirm, Edit/Reschedule, Cancel
  //   Confirmed              -> Mark as Arrived (today only), Edit/Reschedule, Cancel
  //   Arrived                -> Start Consultation, Edit/Reschedule, Cancel
  //   In Consultation        -> Complete Consultation only
  //   Completed / Cancelled / No-show -> no workflow action
  function detailsActionsHtml(a) {
    var actions = '';
    if (a.status === 'pending') {
      actions += '<button class="btn" data-action="confirm" data-id="' + a.id + '"><i class="fa-solid fa-check"></i> Confirm Appointment</button>';
    }
    if (a.status === 'confirmed' && a.date === D.todayStr()) {
      actions += '<button class="btn btn-primary" data-action="arrive" data-id="' + a.id + '"><i class="fa-solid fa-paw"></i> Mark as Arrived</button>';
    }
    if (a.status === 'arrived' && !D.isInConsultation(a)) {
      actions += '<button class="btn btn-primary" data-action="start-consultation" data-id="' + a.id + '"><i class="fa-solid fa-stethoscope"></i> Start Consultation</button>';
    }
    if (D.isInConsultation(a)) {
      actions += '<button class="btn btn-primary" data-action="complete-consultation" data-id="' + a.id + '"><i class="fa-solid fa-check"></i> Complete Consultation</button>';
    }
    if ((a.status === 'pending' || a.status === 'confirmed' || a.status === 'arrived') && !D.isInConsultation(a)) {
      actions += '<button class="btn" data-action="edit" data-id="' + a.id + '"><i class="fa-solid fa-pen"></i> Edit / Reschedule</button>';
      actions += '<button class="btn btn-danger" data-action="cancel" data-id="' + a.id + '"><i class="fa-solid fa-xmark"></i> Cancel Appointment</button>';
    }
    return actions;
  }

  // Progress timeline for the "Appointment Status" section. Reads the
  // appointment's real, stored status and maps it onto 5 display
  // stages — "In Consultation" is now a real stored status (see
  // startAppointmentConsultation()/completeAppointmentConsultation() in
  // data-store.js), so its position here always matches what's actually
  // saved, the same as every other stage.
  var STATUS_TIMELINE_STAGES = [
    { key: 'pending', label: 'Scheduled' },
    { key: 'confirmed', label: 'Confirmed' },
    { key: 'arrived', label: 'Arrived' },
    { key: 'consultation', label: 'In Consultation' },
    { key: 'completed', label: 'Completed' }
  ];
  var STATUS_TIMELINE_INDEX = { pending: 0, confirmed: 1, arrived: 2, consultation: 3, completed: 4 };

  function detailsStatusTimelineHtml(a) {
    // Cancelled/No-show are end states that don't fit the forward
    // progression, so they get their own box instead of being squeezed
    // into one of the 5 stages.
    if (a.status === 'cancelled') {
      return '<div class="status-timeline-cancelled">' +
        '<i class="fa-solid fa-ban"></i>' +
        '<div><div class="stc-title">Appointment Cancelled</div>' +
        '<div class="stc-sub">This appointment will not proceed through the usual stages.</div></div>' +
        '</div>';
    }
    if (a.status === 'no-show') {
      return '<div class="status-timeline-cancelled">' +
        '<i class="fa-solid fa-user-slash"></i>' +
        '<div><div class="stc-title">No-show</div>' +
        '<div class="stc-sub">The client/pet did not arrive for this appointment.</div></div>' +
        '</div>';
    }

    var currentIdx = STATUS_TIMELINE_INDEX.hasOwnProperty(a.status) ? STATUS_TIMELINE_INDEX[a.status] : 0;

    return '<div class="status-stepper">' +
      STATUS_TIMELINE_STAGES.map(function (stage, i) {
        var state = i < currentIdx ? 'is-done' : (i === currentIdx ? 'is-current' : 'is-upcoming');
        var dot = (state === 'is-done' || state === 'is-current')
          ? '<i class="fa-solid fa-check"></i>'
          : '';
        return '<div class="status-stepper-step ' + state + '">' +
          '<span class="status-stepper-dot">' + dot + '</span>' +
          '<span class="status-stepper-label">' + esc(stage.label) + '</span>' +
          '</div>';
      }).join('') +
      '</div>';
  }

  function renderDetailsPanel() {
    var pane = document.getElementById('details-panel');
    if (!pane) return;

    var a = state.selectedApptId ? D.getById(state.selectedApptId) : null;
    if (!a) {
      pane.innerHTML = '<div class="details-empty"><i class="fa-solid fa-calendar-check"></i>Select an appointment to view details.</div>';
      return;
    }

    var info = apptInfo(a);
    var patient = a.patientId ? D.getPatientById(a.patientId) : null;
    var service = (typeof D.getServiceForAppointment === 'function') ? D.getServiceForAppointment(a) : null;

    // Pet header meta line — species, age, sex, spay/neuter status.
    // Only ever shows fields that actually exist on the patient
    // record; nothing here is invented if the data isn't present.
    var subBits = [];
    if (info.species) subBits.push(esc(info.species));
    if (patient && patient.age !== undefined && patient.age !== null && patient.age !== '') {
      subBits.push(esc(patient.age) + (typeof patient.age === 'number' ? ' yrs' : ''));
    }
    if (patient && patient.sex) subBits.push(esc(patient.sex));
    var spayVal = detailsSpayNeuterValue(patient);
    if (spayVal) subBits.push(spayVal);

    // Appointment Information — time, veterinarian, reason/service —
    // as one flat list of rows (time leads, per the requested
    // hierarchy). No end time is invented; the schema only stores a
    // start time.
    var rows = detailsRow('fa-clock', 'Time', esc(D.formatTimeLabel(a.time)) + ' &middot; ' + esc(D.formatDateLabel(a.date)));
    rows += detailsRow('fa-notes-medical', 'Veterinarian', a.vet ? esc(a.vet) : 'Unassigned', !a.vet);
    rows += detailsRow('fa-briefcase-medical', 'Clinic Service', service ? esc(service.name) : 'Not specified', !service);
    rows += detailsRow('fa-file-lines', 'Reason for Visit', a.reason ? esc(a.reason) : 'Not specified', !a.reason);

    var statusStepperHtml = detailsStatusTimelineHtml(a);
    var hasQueue = !!a.queueCode;
    var queueLineHtml = '<div class="details-queue-line"><span>Queue Number</span>' +
      (hasQueue ? '<span class="details-queue-number">' + esc(a.queueCode) + '</span>' : '<span class="details-queue-empty">Not yet in queue</span>') +
      '</div>';

    var actionsHtml = detailsActionsHtml(a);

    var notesHtml = a.notes
      ? '<div class="details-notes">' + esc(a.notes) + '</div>'
      : '<div class="details-notes-empty"><i class="fa-solid fa-note-sticky"></i><span>No notes added yet.</span></div>';
    notesHtml += '<button class="btn btn-sm details-add-note-btn" data-action="edit-notes" data-id="' + a.id + '">' +
      '<i class="fa-solid ' + (a.notes ? 'fa-pen' : 'fa-plus') + '"></i> ' + (a.notes ? 'Edit Note' : 'Add Note') +
      '</button>';

    pane.innerHTML =
      // 1. Pet header — empty avatar circle (reserved for a future pet
      // photo; no icon), name + status close together, then the
      // species/age/sex/spay meta line and owner line underneath, and
      // a small close button pinned to the far right of the header.
      '<div class="details-header">' +
        '<div class="details-avatar"></div>' +
        '<div style="min-width:0; flex:1;">' +
          '<div class="details-title-row"><span class="details-pet-name">' + esc(info.pet) + '</span>' +
            '<span class="status-badge status-' + a.status + '">' + D.STATUS_LABELS[a.status] + '</span></div>' +
          (subBits.length ? '<div class="details-pet-sub">' + subBits.join(' \u00b7 ') + '</div>' : '') +
          (info.owner ? '<div class="details-pet-owner"><i class="fa-solid fa-user"></i>Owner: <strong>' + esc(info.owner) + '</strong></div>' : '') +
        '</div>' +
        '<button class="modal-close" id="details-close-btn" aria-label="Close appointment details"><i class="fa-solid fa-xmark"></i></button>' +
      '</div>' +
      // 2. Appointment information — plain icon+value rows directly
      // under the pet header, no section heading (removed per
      // feedback — kept only the rows themselves).
      '<div class="details-section">' +
        '<div class="details-rows">' + rows + '</div></div>' +
      // 3. Appointment Status (horizontal stepper) + queue number
      '<div class="details-section"><div class="details-section-title"><i class="fa-solid fa-timeline"></i>Appointment Status</div>' +
        statusStepperHtml + queueLineHtml + '</div>' +
      // 4. Owner Information
      '<div class="details-section">' + detailsInfoGroupsHtml(info) + '</div>' +
      // 5. Notes
      '<div class="details-section"><div class="details-section-title"><i class="fa-solid fa-file-lines"></i>Notes</div>' + notesHtml + '</div>' +
      // 6. Quick Actions
      (actionsHtml ? '<div class="details-section"><div class="details-section-title">Quick Actions</div><div class="details-actions">' + actionsHtml + '</div></div>' : '');

    // Close button: reuses the existing deselect pattern (clearing
    // state.selectedApptId and re-rendering) already used by the
    // day/week/month tab switches above — no new selection/deselect
    // logic introduced.
    var closeBtn = pane.querySelector('#details-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        state.selectedApptId = null;
        renderCurrentView();
      });
    }

    bindCardActions(pane);
  }

  function renderCurrentView() {
    syncCalSubTabs();
    updateCalToolbarLabel();
    renderSummaryStrip();
    renderDetailsPanel();
    if (state.calSubView === 'day') {
      renderDay();
    } else if (state.calSubView === 'week') {
      renderWeek();
    } else {
      renderMonth();
    }
  }

  function populateVetFilter() {
    var sel = document.getElementById('filter-vet');
    D.VETS.forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      sel.appendChild(opt);
    });
    // "Unassigned" is filterable alongside the real veterinarians —
    // added only to this filter select, not to the Add/Edit form's
    // vet picker (assigning a vet stays out of scope for this step).
    var unassignedOpt = document.createElement('option');
    unassignedOpt.value = UNASSIGNED_VET;
    unassignedOpt.textContent = 'Unassigned';
    sel.appendChild(unassignedOpt);
    var fSel = document.getElementById('f-vet');
    D.VETS.forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      fSel.appendChild(opt);
    });
  }

  // Populates the required "Clinic Service" picker from the Services
  // module (Active services only). Re-run each time the modal opens so
  // a service added/deactivated on the Services page mid-session is
  // reflected without needing a page reload.
  function populateServiceOptions(selectedServiceId) {
    var sel = document.getElementById('f-service');
    if (typeof D.getActiveServices !== 'function') {
      sel.innerHTML = '<option value="">No services available</option>';
      sel.value = '';
      return;
    }
    var services = D.getActiveServices().slice().sort(function (a, b) { return a.name.localeCompare(b.name); });

    sel.innerHTML = '<option value="">Select a service…</option>' + services.map(function (s) {
      return '<option value="' + s.id + '">' + esc(s.name) + '</option>';
    }).join('');

    // Preserve a previously-selected service even if it's now Inactive
    // (e.g. editing an older appointment), so it isn't silently dropped.
    if (selectedServiceId && !services.some(function (s) { return s.id === selectedServiceId; })) {
      var inactive = D.getServiceById(selectedServiceId);
      if (inactive) {
        sel.insertAdjacentHTML('beforeend', '<option value="' + inactive.id + '">' + esc(inactive.name) + ' (Inactive)</option>');
      }
    }

    sel.value = selectedServiceId || '';
  }

  // Allows other pages (e.g. a patient profile's "Appointments" link) to
  // deep-link into a pre-filtered Calendar via ?q=search+terms, without
  // altering any existing behavior when the param is absent.
  function applyIncomingSearchParam() {
    var params = new URLSearchParams(window.location.search);
    var q = params.get('q');
    if (!q) return;
    state.search = q;
    document.getElementById('search-input').value = q;
  }

  document.addEventListener('DOMContentLoaded', function () {
    populateVetFilter();
    applyIncomingSearchParam();

    document.getElementById('cal-day').addEventListener('click', function () { state.calSubView = 'day'; state.selectedApptId = null; renderCurrentView(); });
    document.getElementById('cal-week').addEventListener('click', function () { state.calSubView = 'week'; state.selectedApptId = null; renderCurrentView(); });
    document.getElementById('cal-month').addEventListener('click', function () { state.calSubView = 'month'; state.selectedApptId = null; renderCurrentView(); });

    document.getElementById('cal-prev').addEventListener('click', function () {
      if (state.calSubView === 'day') shiftCalDate(-1);
      else if (state.calSubView === 'week') shiftCalDate(-7);
      else shiftMonth(-1);
    });
    document.getElementById('cal-next').addEventListener('click', function () {
      if (state.calSubView === 'day') shiftCalDate(1);
      else if (state.calSubView === 'week') shiftCalDate(7);
      else shiftMonth(1);
    });
    document.getElementById('cal-today').addEventListener('click', function () {
      state.calDate = D.todayStr();
      renderCurrentView();
    });

    document.getElementById('search-input').addEventListener('input', function (e) {
      state.search = e.target.value;
      renderCurrentView();
    });
    document.getElementById('filter-vet').addEventListener('change', function (e) {
      state.filterVet = e.target.value;
      renderCurrentView();
    });
    document.getElementById('filter-status').addEventListener('change', function (e) {
      state.filterStatus = e.target.value;
      renderCurrentView();
    });
    document.getElementById('filter-appointment-type').addEventListener('change', function (e) {
      state.filterType = e.target.value;
      renderCurrentView();
    });
    document.getElementById('clear-filters').addEventListener('click', function () {
      state.search = ''; state.filterVet = ''; state.filterStatus = ''; state.filterType = '';
      document.getElementById('search-input').value = '';
      document.getElementById('filter-vet').value = '';
      document.getElementById('filter-status').value = '';
      document.getElementById('filter-appointment-type').value = '';
      renderCurrentView();
    });

    document.getElementById('f-client-search').addEventListener('input', function (e) {
      renderClientResults(e.target.value);
    });
    document.getElementById('client-change-btn').addEventListener('click', function () {
      showClientSearchView(state.selectedClient ? state.selectedClient.name : '');
    });
    document.getElementById('f-patient').addEventListener('change', function (e) {
      applySpeciesFromPatient(e.target.value ? D.getPatientById(e.target.value) : null);
    });

    document.getElementById('add-appt-btn').addEventListener('click', function () { openModal(null); });
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-save').addEventListener('click', saveModal);
    document.getElementById('modal-delete').addEventListener('click', function () {
      if (state.editingId && confirm('Cancel this appointment?')) {
        D.cancelAppointment(state.editingId);
        showToast('Appointment cancelled');
        closeModal();
        renderCurrentView();
      }
    });
    document.getElementById('modal-overlay').addEventListener('click', function (e) {
      if (e.target.id === 'modal-overlay') closeModal();
    });

    D.onChange(renderCurrentView);
    renderCurrentView();
  });
})();