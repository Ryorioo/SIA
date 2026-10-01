// ============================================================
// PAWSITIVE CARE — Predictive Analytics page
// Renders into the #pa-root placeholder in predictive-analytics.html.
// All Patients/Medical Records/Inventory access goes through PCData
// (data-store.js + patient-data-store.js + medical-records-data-store.js).
// All Predictive-Analytics-specific calculation logic lives in
// predictive-analytics-data-store.js (PCData.Predictive) — this file
// only fetches weather, calls that logic, and renders the result.
//
// Weather comes from Open-Meteo (free, no API key). If it fails, the
// rest of the dashboard still renders from PCData.Predictive using
// whatever real Medical Records / Inventory data exists.
// ============================================================

(function () {
  'use strict';

  // NOTE: the system has no stored clinic address/coordinates yet, so
  // this is a placeholder location (Metro Manila) rather than real
  // clinic data — update to the clinic's actual coordinates once that
  // exists somewhere in Settings/PCData.
  var WEATHER_LAT = 14.5995;
  var WEATHER_LON = 120.9842;
  var WEATHER_URL =
    'https://api.open-meteo.com/v1/forecast?latitude=' + WEATHER_LAT +
    '&longitude=' + WEATHER_LON +
    '&current=temperature_2m,precipitation,relative_humidity_2m,weather_code&timezone=auto';

  var WMO_LABELS = {
    0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Fog', 48: 'Depositing rime fog',
    51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
    61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
    71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow',
    80: 'Rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',
    95: 'Thunderstorm', 96: 'Thunderstorm w/ hail', 99: 'Thunderstorm w/ heavy hail'
  };

  // Analysis Controls (Phase 6 — additive). NOTE: the current prediction
  // engine (PCData.Predictive) does not yet support arbitrary analysis
  // windows, so this selector is frontend-only for now — changing it does
  // NOT recalculate disease/medicine predictions. It exists so the
  // structure is in place; wiring it to PCData.Predictive's date-window
  // logic is a later backend/engine phase.
  var ANALYSIS_PERIOD_OPTIONS = [
    ['7d', 'Last 7 Days'],
    ['30d', 'Last 30 Days'],
    ['90d', 'Last 90 Days'],
    ['6m', 'Last 6 Months'],
    ['12m', 'Last 12 Months']
  ];

  var state = {
    weather: { status: 'loading', data: null, error: null }, // status: loading | ok | error
    // Medicine Demand Forecast filters (frontend-only; kept here so they
    // survive the full re-render that PCData.onChange / weather triggers)
    medicine: { search: '', category: 'all', risk: 'all', stock: 'all' },
    // Analysis Controls state — also frontend-only/page-session (see NOTE
    // above and on renderControls()); lastAnalyzed starts null and is set
    // once the initial analysis has rendered, then again after each
    // Refresh Analysis completes.
    controls: { period: '30d', lastAnalyzed: null, refreshing: false }
  };

  // Most recent getMedicineDemandAnalysis() result, so the medicine
  // filters can re-filter it without recomputing or re-rendering the page.
  var lastMedicine = null;

  document.addEventListener('DOMContentLoaded', function () {
    if (!window.PCData || !PCData.getMedicalRecords || !PCData.getInventory) {
      console.error('predictive-analytics.js: PCData not fully loaded — make sure data-store.js, patient-data-store.js and medical-records-data-store.js load before this file.');
      var root = document.getElementById('pa-root');
      if (root) root.innerHTML = '<div class="pa-empty">Predictive Analytics could not load: required data modules are missing.</div>';
      return;
    }
    if (!PCData.Predictive) {
      console.error('predictive-analytics.js: PCData.Predictive not found — make sure predictive-analytics-data-store.js loads before this file.');
      var root2 = document.getElementById('pa-root');
      if (root2) root2.innerHTML = '<div class="pa-empty">Predictive Analytics could not load: its calculation module is missing.</div>';
      return;
    }

    // Disease/medicine analysis is computed synchronously inside
    // renderAll() (PCData.Predictive), so the initial analysis is
    // considered "done" here — weather is a separate, best-effort
    // enrichment that renders on its own once fetchWeather() resolves.
    state.controls.lastAnalyzed = new Date();
    renderAll();
    fetchWeather();
    PCData.onChange(renderAll);
  });

  // ------------------------------------------------------------------
  // weather fetch (isolated from the rest of the page — a failure
  // here only affects the Weather card, per the "still works if
  // weather is unavailable" requirement)
  // ------------------------------------------------------------------

  // `done`, if given, is called exactly once after the weather flow
  // settles (success or failure) — used by Refresh Analysis (Analysis
  // Controls) to know when it's safe to clear its loading state, without
  // this function's own loading/ok/error logic changing at all.
  function fetchWeather(done) {
    state.weather = { status: 'loading', data: null, error: null };
    renderAll();

    if (!window.fetch) {
      state.weather = { status: 'error', data: null, error: 'Weather requires a browser fetch API that is not available.' };
      renderAll();
      if (done) done();
      return;
    }

    fetch(WEATHER_URL)
      .then(function (res) {
        if (!res.ok) throw new Error('Weather service returned an error (' + res.status + ').');
        return res.json();
      })
      .then(function (json) {
        var c = json && json.current;
        if (!c || typeof c.temperature_2m !== 'number') throw new Error('Unexpected weather response.');
        state.weather = {
          status: 'ok',
          data: {
            temperature: c.temperature_2m,
            precipitation: c.precipitation || 0,
            humidity: c.relative_humidity_2m,
            weatherCode: c.weather_code,
            fetchedAt: Date.now()
          },
          error: null
        };
        renderAll();
        if (done) done();
      })
      .catch(function (err) {
        state.weather = { status: 'error', data: null, error: (err && err.message) || 'Weather is currently unavailable.' };
        renderAll();
        if (done) done();
      });
  }

  // ------------------------------------------------------------------
  // Analysis Controls — Refresh Analysis (Phase 6, additive)
  //
  // Reuses the existing renderAll() / fetchWeather() flow rather than
  // reloading the page or duplicating any calculation logic:
  //   1. Flip the button into its "Refreshing…" state (renderAll() —
  //      existing sections stay visible, nothing is blanked).
  //   2. Re-run fetchWeather(), which itself re-reads the latest
  //      PCData.Predictive results via its own renderAll() calls and
  //      refreshes weather.
  //   3. Once fetchWeather() settles (success OR error — the existing
  //      "rest of the page still works" behavior is preserved), clear
  //      the loading state and stamp Last analyzed.
  // ------------------------------------------------------------------
  function refreshAnalysis() {
    if (state.controls.refreshing) return; // guards against duplicate/overlapping clicks
    state.controls.refreshing = true;
    renderAll();
    fetchWeather(function () {
      state.controls.refreshing = false;
      state.controls.lastAnalyzed = new Date();
      renderAll();
    });
  }

  // ------------------------------------------------------------------
  // render
  // ------------------------------------------------------------------

  function renderAll() {
    var root = document.getElementById('pa-root');
    if (!root) return;

    var P = PCData.Predictive;
    var disease = P.getDiseaseRiskAnalysis();
    var medicine = P.getMedicineDemandAnalysis();
    lastMedicine = medicine;
    var weatherFactors = state.weather.status === 'ok' ? P.getWeatherFactors(state.weather.data) : [];
    var adjustedDisease = P.applyWeatherAdjustments(disease, weatherFactors);
    var recommendations = P.getRecommendations(adjustedDisease, medicine, weatherFactors);

    // Phase 1: the Overview renders compact snapshots/previews of each
    // area (reusing the same disease/medicine/weather/recommendations
    // result objects computed above) instead of the full detail
    // sections. The full detail renderers (renderDiseaseSection,
    // renderMedicineSection, medicineFiltersHtml, medicineResults,
    // renderMedicineRow, bindMedicineControls, renderRecommendations,
    // etc.) are left defined further down this file, unused for now,
    // so Phase 2's dedicated pages can reuse them as-is — so there are
    // no medicine filter inputs or a full medicine table on this page
    // to preserve focus/scroll position for anymore.
    root.innerHTML =
      renderControls() +
      renderSummary(adjustedDisease, medicine, state.weather) +
      renderDiseaseSnapshot(adjustedDisease) +
      '<div class="pa-lower-grid">' +
        renderMedicinePreview(medicine) +
        renderWeatherSection(state.weather, weatherFactors) +
      '</div>' +
      renderRecommendationsPreview(recommendations) +
      renderFooter();

    var retryBtn = document.getElementById('pa-weather-retry');
    if (retryBtn) retryBtn.addEventListener('click', function () { fetchWeather(); });

    bindControls();
  }

  // ------------------------------------------------------------------
  // Shared "View X" preview header (Phase 1) — used by Current Risk
  // Snapshot, Medicine & Inventory Pressure preview, Weather & Health
  // Context, and Recommendations preview.
  // ------------------------------------------------------------------
  function previewHeader(headingId, title, targetKey, linkLabel) {
    return (
      '<div class="pa-preview-head">' +
        '<div class="pa-preview-headtext">' +
          '<h2 class="pa-preview-heading" id="' + headingId + '">' + esc(title) + '</h2>' +
        '</div>' +
        '<a class="pa-view-link" href="' + escAttr(PA_VIEW_PAGES[targetKey] || 'predictive-analytics.html') + '">' +
          esc(linkLabel) + ' <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>' +
        '</a>' +
      '</div>'
    );
  }

  // Destination page for each "View X" link (plain same-tab navigation).
  var PA_VIEW_PAGES = {
    'disease-risk': 'disease-risk.html',
    'medicine-demand': 'medicine-demand.html',
    'weather-health': 'weather-health.html',
    'recommendations': 'recommendations.html'
  };

  // ------------------------------------------------------------------
  // CURRENT RISK SNAPSHOT (Phase 1) — compact table reusing the same
  // disease.categories result renderDiseaseCard() used; the full
  // detail cards (recent/baseline counts, reason, weather note) are
  // NOT shown here, only Condition / Risk / Trend / Confidence.
  // ------------------------------------------------------------------
  function renderDiseaseSnapshot(disease) {
    var body;
    if (!disease.hasAnyRecords) {
      body = '<div class="pa-disease-empty">' +
        emptyState('No medical records exist yet, so disease risk trends can\u2019t be calculated.') +
      '</div>';
    } else {
      var rows = disease.categories.map(renderSnapshotRow).join('');
      body =
        '<div class="pa-snapshot-table-wrap">' +
          '<table class="pa-snapshot-table">' +
            '<caption class="pa-sr-only">Current disease risk snapshot</caption>' +
            '<thead><tr>' +
              '<th scope="col">Condition</th>' +
              '<th scope="col">Risk</th>' +
              '<th scope="col">Trend</th>' +
              '<th scope="col">Confidence</th>' +
            '</tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>';
    }

    return (
      '<section class="pa-disease" aria-labelledby="pa-disease-heading">' +
        previewHeader('pa-disease-heading', 'CURRENT RISK SNAPSHOT',
          'disease-risk', 'View Disease Risk') +
        body +
      '</section>'
    );
  }

  function renderSnapshotRow(c) {
    if (!c.hasEnoughData) {
      return (
        '<tr>' +
          '<td>' + esc(c.label) + '</td>' +
          '<td><span class="status-badge pa-badge-nodata">Insufficient Data</span></td>' +
          '<td class="pa-snapshot-cell-none">\u2014</td>' +
          '<td><span class="status-badge pa-badge-nodata">Insufficient</span></td>' +
        '</tr>'
      );
    }
    return (
      '<tr>' +
        '<td>' + esc(c.label) + '</td>' +
        '<td><span class="status-badge ' + riskBadgeClass(c.risk) + '">' + esc(c.risk) + '</span></td>' +
        '<td><span class="pa-snapshot-cell-trend"><i class="fa-solid ' + trendIcon(c.trend) + '" aria-hidden="true"></i>' + esc(c.trend) + '</span></td>' +
        '<td>' + esc(shortConfidence(c.confidence)) + '</td>' +
      '</tr>'
    );
  }

  // Display-only shortening of the existing confidence string for the
  // snapshot table cell (e.g. "Moderate confidence" -> "Moderate",
  // "Low confidence (small sample)" -> "Low") — does not change the
  // value PCData.Predictive computed, only how it's displayed here.
  function shortConfidence(text) {
    var s = String(text || '');
    var paren = s.indexOf('(');
    if (paren !== -1) s = s.slice(0, paren);
    s = s.replace(/confidence/i, '').trim();
    return s || String(text || '');
  }

  // ------------------------------------------------------------------
  // MEDICINE & INVENTORY PRESSURE preview (Phase 1) — compact table of
  // the items most likely to need attention, reusing the same
  // medicine.items result the full table used. No search/filter
  // controls and no Recommendation column here.
  // ------------------------------------------------------------------
  function renderMedicinePreview(medicine) {
    var body;
    if (!medicine.hasInventory) {
      body = '<div class="pa-med-empty">' +
        emptyState('No active medicine or vaccine items in Inventory yet.') +
      '</div>';
    } else {
      var picks = pickMedicinePreviewItems(medicine.items, 3);
      if (!picks.length) {
        body = '<div class="pa-med-empty">' + emptyState('No medicines currently need attention.') + '</div>';
      } else {
        var rows = picks.map(renderMedicinePreviewRow).join('');
        body =
          '<div class="pa-snapshot-table-wrap">' +
            '<table class="pa-snapshot-table">' +
              '<caption class="pa-sr-only">Medicine and inventory pressure preview</caption>' +
              '<thead><tr>' +
                '<th scope="col">Medicine</th>' +
                '<th scope="col">Current Stock</th>' +
                '<th scope="col">Risk</th>' +
              '</tr></thead>' +
              '<tbody>' + rows + '</tbody>' +
            '</table>' +
          '</div>';
      }
    }

    return (
      '<section class="pa-med" aria-labelledby="pa-med-heading">' +
        previewHeader('pa-med-heading', 'MEDICINE & INVENTORY PRESSURE',
          'medicine-demand', 'View Medicine Demand') +
        body +
      '</section>'
    );
  }

  // Display-only priority ordering for which items the Overview preview
  // shows (expired > out of stock > low stock > high demand > other) —
  // reads the existing expired/lowStock/demand/currentStock fields as-is,
  // does not compute anything new. Not used by the full Medicine Demand
  // table, which still shows every item.
  function pickMedicinePreviewItems(items, limit) {
    function score(i) {
      if (i.expired) return 4;
      if (Number(i.currentStock) === 0) return 3;
      if (i.lowStock) return 2;
      if (i.hasEnoughData && i.demand === 'HIGH') return 1;
      return 0;
    }
    return items.slice()
      .sort(function (a, b) { return score(b) - score(a); })
      .slice(0, limit);
  }

  function renderMedicinePreviewRow(i) {
    var out = Number(i.currentStock) === 0;
    var flags = '';
    if (out) flags += medPill('out', 'OUT OF STOCK');
    else if (i.lowStock) flags += medPill('low', 'LOW STOCK');
    if (i.expired) flags += medPill('expired', 'EXPIRED');

    // Stock-driven state takes priority for this compact column (matches
    // the target screenshot); falls back to the demand-forecast badge
    // when nothing else is flagged. Both are existing engine values.
    var riskCell;
    if (out) riskCell = '<span class="status-badge status-cancelled">Out of Stock</span>';
    else if (i.expired) riskCell = '<span class="status-badge status-cancelled">Expired</span>';
    else if (i.lowStock) riskCell = '<span class="status-badge status-pending">Low Stock</span>';
    else if (!i.hasEnoughData) riskCell = '<span class="status-badge pa-badge-nodata">Insufficient Data</span>';
    else riskCell = '<span class="status-badge ' + riskBadgeClass(i.demand) + '">' + esc(i.demand) + '</span>';

    return (
      '<tr>' +
        '<td class="pa-snapshot-med-name">' + esc(i.name) + '</td>' +
        '<td><div class="pa-snapshot-med-stock"><span class="pa-med-qty">' + esc(String(i.currentStock)) + '</span>' +
          (i.unit ? '<span class="pa-med-unit">' + esc(i.unit) + '</span>' : '') + flags + '</div></td>' +
        '<td>' + riskCell + '</td>' +
      '</tr>'
    );
  }

  // ------------------------------------------------------------------
  // RECOMMENDATIONS preview (Phase 1) — first 2-3 of the same recs
  // array getRecommendations() returned; no new fields, no reordering
  // beyond the array's existing order.
  // ------------------------------------------------------------------
  function renderRecommendationsPreview(recs) {
    var preview = (recs || []).slice(0, 3);
    var body = preview.length
      ? '<div class="pa-rec-panel"><ul class="pa-rec-list">' + preview.map(renderRecommendationItem).join('') + '</ul></div>'
      : '<div class="pa-rec-empty">' + emptyState('No recommendations at this time.') + '</div>';

    return (
      '<section class="pa-rec" aria-labelledby="pa-rec-heading">' +
        previewHeader('pa-rec-heading', 'RECOMMENDATIONS',
          'recommendations', 'View All Recommendations') +
        body +
      '</section>'
    );
  }

  // ANALYSIS CONTROLS — Analysis Period selector + Refresh Analysis +
  // Last analyzed. Standalone section above Analysis Overview. The period selector is
  // a real <select> that only preserves its chosen value across
  // re-renders for now (see the ANALYSIS_PERIOD_OPTIONS NOTE above) —
  // it does not affect PCData.Predictive's date-window logic yet.
  // While refreshing, the "Last analyzed" line doubles as the
  // aria-live status announcement so refresh state is announced
  // without adding a second, separate loading indicator.
  function renderControls() {
    var c = state.controls;

    var periodOptions = ANALYSIS_PERIOD_OPTIONS.map(function (o) {
      return '<option value="' + escAttr(o[0]) + '"' + (o[0] === c.period ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('');

    var refreshContent = c.refreshing
      ? '<i class="fa-solid fa-arrows-rotate fa-spin" aria-hidden="true"></i> Refreshing\u2026'
      : '<i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i> Refresh Analysis';

    var statusValue = c.refreshing
      ? 'Refreshing analysis\u2026'
      : (c.lastAnalyzed ? formatLastAnalyzed(c.lastAnalyzed) : 'Not yet analyzed');

    return (
      '<section class="pa-controls" aria-labelledby="pa-controls-heading">' +
        '<h2 class="pa-controls-heading" id="pa-controls-heading">ANALYSIS CONTROLS</h2>' +
        '<div class="pa-controls-panel">' +
          '<div class="pa-controls-field">' +
            '<label class="pa-controls-label" for="pa-period">Analysis Period</label>' +
            '<select id="pa-period" class="pc-select pa-controls-select">' + periodOptions + '</select>' +
          '</div>' +
          '<div class="pa-controls-actions">' +
            '<div class="pa-controls-status" role="status" aria-live="polite">' +
              '<span class="pa-controls-label">Last analyzed</span>' +
              '<span class="pa-controls-value">' + esc(statusValue) + '</span>' +
            '</div>' +
            '<button type="button" id="pa-refresh-btn" class="btn btn-primary pa-controls-refresh"' +
              (c.refreshing ? ' disabled aria-disabled="true"' : '') +
              ' aria-label="' + (c.refreshing ? 'Refreshing analysis' : 'Refresh analysis') + '">' +
              refreshContent +
            '</button>' +
          '</div>' +
        '</div>' +
      '</section>'
    );
  }

  // Formats a Date for the "Last analyzed" line, e.g. "Sep 24, 2026 · 10:42 AM".
  function formatLastAnalyzed(d) {
    try {
      return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) +
        ' \u00B7 ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch (e) {
      return d.toLocaleString();
    }
  }

  // ANALYSIS OVERVIEW — four high-level metrics derived ONLY from the
  // existing PCData.Predictive result objects (no second data source).
  // The third argument (weather) is no longer needed here; the call
  // site is unchanged for compatibility.
  function renderSummary(disease, medicine) {
    var cats = disease.categories || [];
    var rated = cats.filter(function (c) { return c.hasEnoughData; });
    var increasing = rated.filter(function (c) { return c.trend === 'Increasing'; }).length;
    var moderateConf = rated.filter(function (c) { return /^moderate/i.test(c.confidence || ''); }).length;

    // "Needs attention" uses the same test getRecommendations() uses for
    // medicine items: high demand (with real data) or low stock.
    var items = medicine.items || [];
    var highDemand = 0, lowStock = 0, expired = 0, attention = 0;
    items.forEach(function (i) {
      var isHigh = !!i.hasEnoughData && i.demand === 'HIGH';
      if (isHigh) highDemand++;
      if (i.lowStock) lowStock++;
      if (i.expired) expired++;
      if (isHigh || i.lowStock) attention++;
    });

    var conditionsDesc = disease.hasAnyRecords
      ? rated.length + ' of ' + cats.length + ' have enough records to rate'
      : 'No medical records yet';

    var increasingDesc = !rated.length
      ? 'Not enough data to show trends'
      : (increasing ? 'Cases rising vs. the prior period' : 'No rising case trends');

    var medicineDesc;
    if (!medicine.hasInventory) {
      medicineDesc = 'No active medicine or vaccine items in Inventory';
    } else {
      var parts = [];
      if (highDemand) parts.push(highDemand + ' high demand');
      if (lowStock) parts.push(lowStock + ' low stock');
      if (expired) parts.push(expired + ' expired batch' + (expired === 1 ? '' : 'es'));
      medicineDesc = parts.length ? parts.join(', ') : 'No items need attention';
    }

    var confidence, confidenceDesc;
    if (!rated.length) {
      confidence = 'Insufficient';
      confidenceDesc = disease.hasAnyRecords ? 'No condition has enough records to rate yet' : 'No medical records yet';
    } else if (moderateConf === rated.length) {
      confidence = 'Moderate';
      confidenceDesc = 'Sample sizes support all ' + rated.length + ' rated estimate' + (rated.length === 1 ? '' : 's');
    } else {
      confidence = 'Low';
      confidenceDesc = rated.length === 1
        ? '1 rated estimate rests on a small sample'
        : (rated.length - moderateConf) + ' of ' + rated.length + ' rated estimates rest on small samples';
    }

    return (
      '<section class="pa-overview" aria-labelledby="pa-overview-heading">' +
        '<h2 class="pa-overview-heading" id="pa-overview-heading">ANALYSIS OVERVIEW</h2>' +
        '<ul class="pa-overview-grid">' +
          overviewCard('Conditions Monitored', cats.length, conditionsDesc, true) +
          overviewCard('Increasing Risks', increasing, increasingDesc) +
          overviewCard('Medicine Risks', attention, medicineDesc) +
          overviewCard('Overall Data Confidence', confidence, confidenceDesc) +
        '</ul>' +
      '</section>'
    );
  }

  function overviewCard(label, value, desc, primary) {
    return (
      '<li class="pa-overview-card' + (primary ? ' pa-overview-card-primary' : '') + '">' +
        '<div class="pa-overview-head">' +
          '<span class="pa-overview-label">' + esc(label) + '</span>' +
          (primary ? '<i class="fa-solid fa-chart-line pa-overview-icon" aria-hidden="true"></i>' : '') +
        '</div>' +
        '<div class="pa-overview-value">' + esc(String(value)) + '</div>' +
        '<div class="pa-overview-desc">' + esc(desc) + '</div>' +
      '</li>'
    );
  }

  function renderDiseaseSection(disease) {
    var body;
    if (!disease.hasAnyRecords) {
      body = '<div class="pa-disease-empty">' +
        emptyState('No medical records exist yet, so disease risk trends can\u2019t be calculated.') +
      '</div>';
    } else {
      var cards = disease.categories.map(function (c) { return renderDiseaseCard(c, disease.windowDays); }).join('');
      body = '<ul class="pa-disease-grid">' + cards + '</ul>';
    }

    return (
      '<section class="pa-disease" aria-labelledby="pa-disease-heading">' +
        '<h2 class="pa-disease-heading" id="pa-disease-heading">DISEASE RISK PREDICTIONS</h2>' +
        '<p class="pa-disease-sub">Rule-based patterns from existing Medical Records \u2014 estimates only, not a diagnosis.</p>' +
        body +
      '</section>'
    );
  }

  // One clinical decision-support card per category. Every value shown
  // (risk, trend, counts, confidence, reason, message, weatherNote) is
  // taken as-is from the existing result object; nothing is recalculated.
  function renderDiseaseCard(c, windowDays) {
    if (!c.hasEnoughData) {
      return (
        '<li class="pa-dcard pa-dcard-nodata">' +
          '<h3 class="pa-dcard-title">' + esc(c.label) + '</h3>' +
          '<div class="pa-dcard-meta">' +
            '<span class="status-badge pa-badge-nodata">INSUFFICIENT DATA</span>' +
          '</div>' +
          '<p class="pa-dcard-message">' + esc(c.message) + '</p>' +
          (c.totalCount == null ? '' : '<div class="pa-dcard-records">Records matched so far: ' + esc(String(c.totalCount)) + '</div>') +
        '</li>'
      );
    }

    var recentSub = windowDays ? 'Last ' + windowDays + ' days' : 'Recent period';
    var prevSub = windowDays ? 'Prior ' + windowDays + ' days' : 'Earlier period';

    return (
      '<li class="pa-dcard">' +
        '<h3 class="pa-dcard-title">' + esc(c.label) + '</h3>' +
        '<div class="pa-dcard-meta">' +
          '<span class="status-badge ' + riskBadgeClass(c.risk) + '"><span class="pa-sr-only">Risk level: </span>' + esc(c.risk) + '</span>' +
          '<span class="pa-dcard-trend"><i class="fa-solid ' + trendIcon(c.trend) + '" aria-hidden="true"></i><span class="pa-sr-only">Trend: </span>' + esc(c.trend) + '</span>' +
        '</div>' +
        '<dl class="pa-dcard-cases">' +
          '<div class="pa-dcase pa-dcase-recent">' +
            '<dt>Recent cases</dt><dd class="pa-dcase-value">' + esc(String(c.recentCount)) + '</dd><dd class="pa-dcase-sub">' + esc(recentSub) + '</dd>' +
          '</div>' +
          '<div class="pa-dcase">' +
            '<dt>Previous period</dt><dd class="pa-dcase-value">' + esc(String(c.baselineCount)) + '</dd><dd class="pa-dcase-sub">' + esc(prevSub) + '</dd>' +
          '</div>' +
        '</dl>' +
        '<div class="pa-dcard-confidence">' + esc(c.confidence) + '</div>' +
        '<p class="pa-dcard-reason">' + esc(c.reason) + '</p>' +
        (c.weatherNote
          ? '<div class="pa-dcard-env"><div class="pa-dcard-env-label"><i class="fa-solid fa-cloud" aria-hidden="true"></i> Environmental context</div><p>' + esc(c.weatherNote) + '</p></div>'
          : '') +
      '</li>'
    );
  }

  // ------------------------------------------------------------------
  // MEDICINE DEMAND FORECAST — Inventory-style filter bar + data table.
  // Every value shown comes from the existing getMedicineDemandAnalysis()
  // result; filters only narrow that array in the browser. Category is the
  // one extra lookup: it is not part of the result contract, so it is read
  // (read-only) from PCData.getInventory() by item id.
  // ------------------------------------------------------------------

  var MED_RISK_OPTIONS = [
    ['all', 'All Risk'], ['HIGH', 'High'], ['MODERATE', 'Moderate'], ['LOW', 'Low'], ['INSUFFICIENT', 'Insufficient Data']
  ];
  var MED_STOCK_OPTIONS = [
    ['all', 'All Stock'], ['in', 'In Stock'], ['low', 'Low Stock'], ['out', 'Out of Stock'], ['expired', 'Expired']
  ];
  var MED_CATEGORY_OPTIONS = [['all', 'All Categories'], ['Medicine', 'Medicine'], ['Vaccine', 'Vaccine']];

  function renderMedicineSection(medicine) {
    var body;
    if (!medicine.hasInventory) {
      body = '<div class="pa-med-empty">' +
        emptyState('No active medicine or vaccine items in Inventory yet.') +
      '</div>';
    } else {
      var r = medicineResults(medicine);
      body =
        medicineFiltersHtml() +
        '<div class="pa-med-count" id="pa-med-count" role="status">' + esc(r.count) + '</div>' +
        '<div id="pa-med-results">' + r.html + '</div>';
    }

    return (
      '<section class="pa-med" aria-labelledby="pa-med-heading">' +
        '<h2 class="pa-med-heading" id="pa-med-heading">MEDICINE DEMAND FORECAST</h2>' +
        '<p class="pa-med-sub">Based on current Inventory stock and real mentions in Medical Records \u2014 not invented usage history.</p>' +
        body +
      '</section>'
    );
  }

  function medOptions(options, selected) {
    return options.map(function (o) {
      return '<option value="' + escAttr(o[0]) + '"' + (o[0] === selected ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('');
  }

  function medicineFiltersHtml() {
    var f = state.medicine;
    return (
      '<div class="filter-bar pa-med-filters">' +
        '<div class="search-field">' +
          '<label class="pa-sr-only" for="pa-med-search">Search medicine</label>' +
          '<span aria-hidden="true"><i class="fa-solid fa-magnifying-glass"></i></span>' +
          '<input type="text" id="pa-med-search" placeholder="Search by medicine name\u2026" autocomplete="off" value="' + escAttr(f.search) + '">' +
        '</div>' +
        '<div class="filter-controls">' +
          '<label class="pa-sr-only" for="pa-med-category">Category</label>' +
          '<select id="pa-med-category" class="filter-select pc-select">' + medOptions(MED_CATEGORY_OPTIONS, f.category) + '</select>' +
          '<label class="pa-sr-only" for="pa-med-risk">Risk</label>' +
          '<select id="pa-med-risk" class="filter-select pc-select">' + medOptions(MED_RISK_OPTIONS, f.risk) + '</select>' +
          '<label class="pa-sr-only" for="pa-med-stock">Stock</label>' +
          '<select id="pa-med-stock" class="filter-select pc-select">' + medOptions(MED_STOCK_OPTIONS, f.stock) + '</select>' +
        '</div>' +
      '</div>'
    );
  }

  // Binds the Analysis Controls toolbar. The period select only stores
  // its value (see ANALYSIS_PERIOD_OPTIONS NOTE) — it deliberately does
  // not trigger a recompute. The refresh button hands off to
  // refreshAnalysis(), which itself guards against duplicate clicks.
  function bindControls() {
    var periodSel = document.getElementById('pa-period');
    if (periodSel) {
      periodSel.addEventListener('change', function () {
        state.controls.period = periodSel.value;
      });
    }
    var refreshBtn = document.getElementById('pa-refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', refreshAnalysis);
    }
  }

  function bindMedicineControls() {
    var search = document.getElementById('pa-med-search');
    if (search) {
      search.addEventListener('input', function () {
        state.medicine.search = search.value;
        renderMedicineResults();
      });
    }
    [['pa-med-category', 'category'], ['pa-med-risk', 'risk'], ['pa-med-stock', 'stock']].forEach(function (pair) {
      var el = document.getElementById(pair[0]);
      if (el) {
        el.addEventListener('change', function () {
          state.medicine[pair[1]] = el.value;
          renderMedicineResults();
        });
      }
    });
  }

  // Re-renders only the count + table area, so the search box keeps focus
  // while typing.
  function renderMedicineResults() {
    var box = document.getElementById('pa-med-results');
    var count = document.getElementById('pa-med-count');
    if (!box || !count || !lastMedicine) return;
    var r = medicineResults(lastMedicine);
    box.innerHTML = r.html;
    count.textContent = r.count;
  }

  // Stock filter states mirror exactly what the row flags show: Out = quantity 0,
  // Low = engine lowStock flag (and not out), Expired = engine expired flag,
  // In = none of those flags.
  function medStockState(i) {
    var out = Number(i.currentStock) === 0;
    return { out: out, low: !out && !!i.lowStock, expired: !!i.expired };
  }

  function medicineMatches(i, category, f) {
    var q = f.search.trim().toLowerCase();
    if (q && String(i.name || '').toLowerCase().indexOf(q) === -1) return false;
    if (f.category !== 'all' && category !== f.category) return false;
    if (f.risk !== 'all') {
      if (f.risk === 'INSUFFICIENT') { if (i.hasEnoughData) return false; }
      else if (!i.hasEnoughData || i.demand !== f.risk) return false;
    }
    if (f.stock !== 'all') {
      var st = medStockState(i);
      if (f.stock === 'out' && !st.out) return false;
      if (f.stock === 'low' && !st.low) return false;
      if (f.stock === 'expired' && !st.expired) return false;
      if (f.stock === 'in' && (st.out || st.low || st.expired)) return false;
    }
    return true;
  }

  var MED_TABLE_HEAD =
    '<thead><tr>' +
      '<th scope="col">Medicine</th>' +
      '<th scope="col">Current Stock</th>' +
      '<th scope="col">Forecast Demand</th>' +
      '<th scope="col">Trend</th>' +
      '<th scope="col">Risk</th>' +
      '<th scope="col">Recommendation</th>' +
    '</tr></thead>';

  function medicineResults(medicine) {
    var categories = {};
    try {
      PCData.getInventory().forEach(function (inv) { categories[inv.id] = inv.category; });
    } catch (e) { /* category filter simply won't match */ }

    var items = (medicine.items || []).filter(function (i) {
      return medicineMatches(i, categories[i.id], state.medicine);
    });
    var count = items.length + ' medicine' + (items.length === 1 ? '' : 's');

    var rows = items.length
      ? items.map(function (i) { return renderMedicineRow(i, categories[i.id]); }).join('')
      : '<tr class="pa-med-empty-row"><td colspan="6">No medicines match the current filters.</td></tr>';

    var html =
      '<div class="pa-med-table-wrap" role="region" aria-label="Medicine demand forecast table" tabindex="0">' +
        '<table class="pa-med-table">' +
          '<caption class="pa-sr-only">Medicine demand forecast</caption>' +
          MED_TABLE_HEAD +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>';
    return { html: html, count: count };
  }

  function medPill(kind, text) {
    return '<span class="pa-pill ' + kind + '">' + text + '</span>';
  }

  function renderMedicineRow(i, category) {
    // Current Stock is the real inventory quantity + engine stock flags;
    // it is deliberately separate from the demand/risk columns.
    var out = Number(i.currentStock) === 0;
    var flags = '';
    if (out) flags += medPill('out', 'OUT OF STOCK');
    else if (i.lowStock) flags += medPill('low', 'LOW STOCK');
    if (i.expired) flags += medPill('expired', 'EXPIRED');

    var stockCell =
      '<div class="pa-med-stock">' +
        '<span class="pa-med-qty">' + esc(String(i.currentStock)) + '</span>' +
        (i.unit ? '<span class="pa-med-unit">' + esc(i.unit) + '</span>' : '') +
        flags +
      '</div>';

    var demandCell, trendCell, riskCell;
    if (!i.hasEnoughData) {
      demandCell =
        '<div class="pa-med-nodata-label">INSUFFICIENT DATA</div>' +
        (i.message ? '<div class="pa-med-support">' + esc(i.message) + '</div>' : '');
      trendCell = '<span aria-hidden="true">\u2014</span><span class="pa-sr-only">No trend available</span>';
      riskCell = '<span class="status-badge pa-badge-nodata">INSUFFICIENT DATA</span>';
    } else {
      var level = String(i.demand || '');
      demandCell =
        '<div class="pa-med-demand">' + esc(level.charAt(0) + level.slice(1).toLowerCase()) + '</div>' +
        '<div class="pa-med-support">' + esc(i.reason) + '</div>';
      trendCell = '<span class="pa-med-trend"><i class="fa-solid ' + trendIcon(i.trend) + '" aria-hidden="true"></i>' + esc(i.trend) + '</span>';
      riskCell = '<span class="status-badge ' + riskBadgeClass(i.demand) + '"><span class="pa-sr-only">Risk level: </span>' + esc(i.demand) + '</span>';
    }

    return (
      '<tr>' +
        '<th scope="row" class="pa-med-name-cell">' +
          '<span class="pa-med-name">' + esc(i.name) + '</span>' +
          (category ? '<span class="pa-med-cat">' + esc(category) + '</span>' : '') +
        '</th>' +
        '<td>' + stockCell + '</td>' +
        '<td>' + demandCell + '</td>' +
        '<td>' + trendCell + '</td>' +
        '<td>' + riskCell + '</td>' +
        '<td class="pa-med-rec">' + esc(i.recommendation) + '</td>' +
      '</tr>'
    );
  }

  // Two clinical-context panels (Current Conditions / Environmental
  // Factors) matching the heading hierarchy Analysis Overview, Disease
  // Risk Predictions and Medicine Demand Forecast already use, rather
  // than the generic .pa-section wrapper Recommendations still uses.
  // Every value shown is read as-is from the existing weather payload
  // and factor objects — nothing here recalculates or invents data.
  function renderWeatherSection(weather, factors) {
    var grid;
    if (weather.status === 'loading') {
      grid =
        '<div class="pa-weather-error">' +
          '<div class="pa-weather-loading"><i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> Loading current conditions\u2026</div>' +
        '</div>';
    } else if (weather.status === 'error') {
      grid =
        '<div class="pa-weather-error">' +
          '<p class="pa-weather-error-text">Current conditions are unavailable (' + esc(weather.error) + '). The rest of Predictive Analytics is unaffected.</p>' +
          '<button type="button" class="btn btn-sm" id="pa-weather-retry"><i class="fa-solid fa-rotate"></i> Retry</button>' +
        '</div>';
    } else {
      var d = weather.data;
      var updated = (typeof d.fetchedAt === 'number')
        ? '<div class="pa-weather-updated">Updated ' + esc(formatFetchedTime(d.fetchedAt)) + '</div>'
        : '';

      var factorsHtml = factors.length
        ? '<ul class="pa-weather-factor-list">' + factors.map(renderWeatherFactor).join('') + '</ul>'
        : '<div class="pa-weather-empty">No significant environmental factors detected right now.</div>';

      grid =
        '<div class="pa-weather-panel pa-weather-current">' +
          '<h3 class="pa-weather-panel-title">Current Conditions</h3>' +
          '<dl class="pa-weather-vitals">' +
            weatherVital('Temperature', Math.round(d.temperature) + '\u00B0C') +
            weatherVital('Humidity', typeof d.humidity === 'number' ? Math.round(d.humidity) + '%' : '\u2014') +
            weatherVital('Precipitation', d.precipitation + ' mm') +
            weatherVital('Condition', weatherLabel(d.weatherCode)) +
          '</dl>' +
          updated +
        '</div>' +
        '<div class="pa-weather-panel pa-weather-factors">' +
          '<h3 class="pa-weather-panel-title">Environmental Factors</h3>' +
          factorsHtml +
        '</div>';
    }

    return (
      '<section class="pa-weather" aria-labelledby="pa-weather-heading">' +
        previewHeader('pa-weather-heading', 'WEATHER & HEALTH CONTEXT',
          'weather-health', 'View Weather & Health') +
        '<div class="pa-weather-grid">' + grid + '</div>' +
      '</section>'
    );
  }

  function weatherVital(label, value) {
    return (
      '<div class="pa-vital">' +
        '<dt class="pa-vital-label">' + esc(label) + '</dt>' +
        '<dd class="pa-vital-value">' + esc(String(value)) + '</dd>' +
      '</div>'
    );
  }

  function renderWeatherFactor(f) {
    var affects = (f.affects || []).map(function (a) { return '<span class="pa-weather-tag">' + esc(a) + '</span>'; }).join('');
    return (
      '<li class="pa-weather-factor">' +
        '<p class="pa-weather-factor-text">' + esc(f.text) + '</p>' +
        (affects
          ? '<div class="pa-weather-affects"><span class="pa-weather-affects-label">May contribute to</span>' + affects + '</div>'
          : '') +
      '</li>'
    );
  }

  // Formats the actual fetchedAt timestamp from the weather payload
  // (never a fresh new Date() at render time) into a short local time.
  function formatFetchedTime(fetchedAt) {
    var d = new Date(fetchedAt);
    if (isNaN(d.getTime())) return '';
    try {
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch (e) {
      return d.toLocaleTimeString();
    }
  }

  // Same heading hierarchy as the four sections above. getRecommendations()
  // returns an array of plain strings (no category/priority fields), so
  // none are invented here — every item gets the same neutral action
  // treatment, including the engine's own insufficient-data fallback
  // string, which is rendered exactly as returned like any other item.
  function renderRecommendations(recs) {
    var body = (recs && recs.length)
      ? '<div class="pa-rec-panel"><ul class="pa-rec-list">' + recs.map(renderRecommendationItem).join('') + '</ul></div>'
      : '<div class="pa-rec-empty">' + emptyState('No recommendations at this time.') + '</div>';

    return (
      '<section class="pa-rec" aria-labelledby="pa-rec-heading">' +
        '<h2 class="pa-rec-heading" id="pa-rec-heading">RECOMMENDATIONS</h2>' +
        '<p class="pa-rec-sub">Suggested next actions from the disease, medicine and weather analysis above.</p>' +
        body +
      '</section>'
    );
  }

  function renderRecommendationItem(text) {
    return (
      '<li class="pa-rec-item">' +
        '<span class="pa-rec-marker" aria-hidden="true"><i class="fa-solid fa-check"></i></span>' +
        '<p class="pa-rec-text">' + esc(text) + '</p>' +
      '</li>'
    );
  }

  function renderFooter() {
    return '<div class="pa-updated"><i class="fa-solid fa-clock"></i> Last updated: ' + new Date().toLocaleString() + '</div>';
  }

  // ------------------------------------------------------------------
  // small shared render helpers
  // ------------------------------------------------------------------

  function emptyState(msg) {
    return '<div class="pa-empty">' + esc(msg) + '</div>';
  }

  function riskBadgeClass(level) {
    if (level === 'HIGH') return 'status-cancelled';
    if (level === 'MODERATE') return 'status-pending';
    return 'status-completed';
  }

  function trendIcon(trend) {
    if (trend === 'Increasing') return 'fa-arrow-trend-up';
    if (trend === 'Decreasing') return 'fa-arrow-trend-down';
    return 'fa-arrows-left-right';
  }

  function weatherLabel(code) {
    return WMO_LABELS[code] || 'Unknown conditions';
  }

  function escAttr(str) {
    return esc(str).replace(/"/g, '&quot;');
  }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
})();