// ============================================================
// PAWSITIVE CARE — Medicine Demand Forecast (dedicated page)
// Renders into the #md-root placeholder in medicine-demand.html.
//
// This file does NOT implement a second prediction engine. Every
// number shown comes from the existing PCData.Predictive.
// getMedicineDemandAnalysis() result (predictive-analytics-data-
// store.js) plus the existing PCData.getInventory() / isLowStock()
// helpers (data-store.js) — the exact same source predictive-
// analytics.js's own (currently unused-by-the-Overview) full medicine
// table renderer already reads. Nothing here recalculates demand,
// trend, or risk; this file only re-presents those existing values
// in the page structure/composition shown in the Phase 2B screenshot
// (MEDICINE DEMAND FORECAST.png).
//
// Two small display rules go beyond what predictive-analytics.js's
// own renderMedicineRow()/renderMedicinePreviewRow() already do, both
// directly requested by the Phase 2B spec and both derived only from
// fields the engine already returns (never invented):
//
//   1. Risk column: an item at zero quantity shows "Out of Stock" in
//      the Risk column even when there isn't enough history for a
//      demand figure — current inventory status is real data and can
//      stand on its own. A merely LOW stock item does NOT get this
//      treatment (only actual zero stock) — Low Stock is already
//      visible in the Current Stock column, and demand risk stays
//      "Insufficient Data" until the engine actually has enough
//      history to rate it, per the spec's explicit "do not assign
//      risk just because stock is low" rule.
//   2. Demand Confidence tiers: the engine has no per-medicine
//      "confidence" field of its own, so this reuses the exact
//      sample-size threshold predictive-analytics-data-store.js
//      already established for Disease Risk confidence (>= 8 total
//      matched records = a sturdier estimate, otherwise a small-
//      sample one) and applies it to each medicine's existing
//      totalMentions count. The engine has no notion of a "High"
//      confidence tier at all, so that bucket is always 0 — not a
//      bug, a faithful reflection of the current engine's ceiling.
// ============================================================

(function () {
  'use strict';

  // Analysis Controls note: the current engine (PCData.Predictive)
  // computes a single fixed 30-day recent-window analysis — it has no
  // support for recalculating against a different period yet. The
  // selector below is left visible (per the Phase 2B screenshot) but
  // disabled, so it never implies that changing it recalculates the
  // forecast. Wiring real period-based analysis is a later phase.
  var ANALYSIS_PERIOD_OPTIONS = [
    ['7d', 'Last 7 Days'],
    ['30d', 'Last 30 Days'],
    ['90d', 'Last 90 Days'],
    ['6m', 'Last 6 Months'],
    ['12m', 'Last 12 Months']
  ];

  // Same >= 8 total-records threshold predictive-analytics-data-
  // store.js's getDiseaseRiskAnalysis() already uses to call a rated
  // estimate "Moderate confidence" vs. "Low confidence (small
  // sample)" — reused here, unchanged, for medicines.
  var CONFIDENCE_SAMPLE_THRESHOLD = 8;

  var state = {
    controls: { period: '30d', lastAnalyzed: null }
  };

  document.addEventListener('DOMContentLoaded', function () {
    if (!window.PCData || !PCData.getInventory || !PCData.getMedicalRecords) {
      renderFatal('Medicine Demand Forecast could not load: required data modules are missing.');
      return;
    }
    if (!PCData.Predictive || !PCData.Predictive.getMedicineDemandAnalysis) {
      renderFatal('Medicine Demand Forecast could not load: its calculation module (predictive-analytics-data-store.js) is missing.');
      return;
    }

    state.controls.lastAnalyzed = new Date();
    renderAll();
    // Keep the page in sync with Inventory/Medical Records edits made
    // elsewhere (another tab, another page) — same PCData.onChange
    // hook predictive-analytics.js already uses; no new sync logic.
    PCData.onChange(renderAll);
  });

  function renderFatal(msg) {
    var root = document.getElementById('md-root');
    if (root) root.innerHTML = '<div class="md-empty">' + esc(msg) + '</div>';
  }

  // ------------------------------------------------------------------
  // render
  // ------------------------------------------------------------------

  function renderAll() {
    var root = document.getElementById('md-root');
    if (!root) return;

    var medicine = PCData.Predictive.getMedicineDemandAnalysis();
    var categories = inventoryCategoryMap();
    var analysis = buildDisplayModel(medicine, categories);

    root.innerHTML =
      renderBackLink() +
      renderPageHeader() +
      renderControls() +
      renderSummary(analysis) +
      renderAnalysisSection(analysis) +
      '<div class="md-lower-grid">' +
        renderTrendsSection(analysis) +
        renderPressureSection(analysis) +
      '</div>' +
      renderConfidenceSection(analysis) +
      renderForecastNote();

    bindControls();
  }

  // Item id -> Inventory category, for the Category column. Read-only
  // lookup against the existing Inventory store; not part of the
  // getMedicineDemandAnalysis() result contract itself.
  function inventoryCategoryMap() {
    var map = {};
    try {
      PCData.getInventory().forEach(function (inv) { map[inv.id] = inv.category; });
    } catch (e) { /* Category column simply reads blank */ }
    return map;
  }

  // ------------------------------------------------------------------
  // Shared per-item display derivation — computed ONCE per render pass
  // so every section (summary counts, the main table, trends,
  // pressure, confidence) reads the exact same values instead of
  // re-deriving them slightly differently in five places.
  // ------------------------------------------------------------------

  function buildDisplayModel(medicine, categories) {
    var items = (medicine.items || []).map(function (i) {
      var out = Number(i.currentStock) === 0;
      var low = !out && !!i.lowStock; // isLowStock() already covers qty===0 too; "low" here means "low but not zero" so it doesn't double-count against Out of Stock
      var stockState = out ? 'out' : (low ? 'low' : 'in');

      var highDemand = !!i.hasEnoughData && i.demand === 'HIGH';

      // Confidence tier — see the file header comment: reuses the
      // existing >= 8 total-matched-records threshold from Disease
      // Risk confidence; never produces "High" (engine has no such
      // tier), never guesses a tier from a lowStock/out flag.
      var total = i.totalMentions || 0;
      var confidence = !i.hasEnoughData ? 'insufficient' : (total >= CONFIDENCE_SAMPLE_THRESHOLD ? 'medium' : 'low');

      return {
        raw: i,
        id: i.id,
        name: i.name,
        category: categories[i.id] || '',
        currentStock: i.currentStock,
        unit: i.unit,
        stockState: stockState, // 'in' | 'low' | 'out'
        hasEnoughData: !!i.hasEnoughData,
        demand: i.demand,
        trend: i.trend,
        recentMentions: i.recentMentions,
        baselineMentions: i.baselineMentions,
        totalMentions: total,
        recommendation: i.recommendation,
        expired: !!i.expired,
        highDemand: highDemand,
        confidence: confidence // 'insufficient' | 'low' | 'medium' (never 'high')
      };
    });

    var counts = { total: items.length, highDemand: 0, lowStock: 0, outOfStock: 0, confHigh: 0, confMedium: 0, confLow: 0, confInsufficient: 0 };
    items.forEach(function (i) {
      if (i.highDemand) counts.highDemand++;
      if (i.stockState === 'low') counts.lowStock++;
      if (i.stockState === 'out') counts.outOfStock++;
      if (i.confidence === 'medium') counts.confMedium++;
      else if (i.confidence === 'low') counts.confLow++;
      else counts.confInsufficient++;
    });

    return {
      hasInventory: !!medicine.hasInventory,
      windowDays: medicine.windowDays,
      items: items,
      counts: counts,
      // Inventory Pressure only surfaces medicines that actually have
      // stock pressure (low or out) — matches the Overview's existing
      // "Medicine & Inventory Pressure" preview concept, just shown in
      // full here rather than top-3. Sorted worst-first.
      pressureItems: items
        .filter(function (i) { return i.stockState !== 'in'; })
        .sort(function (a, b) {
          function score(i) { return i.stockState === 'out' ? 2 : 1; }
          return score(b) - score(a);
        })
    };
  }

  // ------------------------------------------------------------------
  // Back link + page header
  // ------------------------------------------------------------------

  function renderBackLink() {
    return (
      '<div class="pa-back-row">' +
        '<a class="pa-back-link" href="predictive-analytics.html">' +
          '<i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Back to Predictive Analytics' +
        '</a>' +
      '</div>'
    );
  }

  function renderPageHeader() {
    return (
      '<div class="page-toolbar">' +
        '<div>' +
          '<h1 class="md-page-title">MEDICINE DEMAND FORECAST</h1>' +
        '</div>' +
      '</div>'
    );
  }

  // ------------------------------------------------------------------
  // Analysis Controls
  // ------------------------------------------------------------------

  function renderControls() {
    var c = state.controls;
    var options = ANALYSIS_PERIOD_OPTIONS.map(function (o) {
      return '<option value="' + escAttr(o[0]) + '"' + (o[0] === c.period ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('');

    return (
      '<section class="pa-controls" aria-labelledby="md-controls-heading">' +
        '<h2 class="pa-controls-heading" id="md-controls-heading">ANALYSIS CONTROLS</h2>' +
        '<div class="pa-controls-panel">' +
          '<div class="pa-controls-field">' +
            '<label class="pa-controls-label" for="md-period">Analysis Period</label>' +
            '<select id="md-period" class="pc-select pa-controls-select" disabled ' +
              'title="The current predictive engine only supports a fixed last-30-days analysis window \u2014 changing this does not yet recalculate the forecast.">' + options + '</select>' +
          '</div>' +
          '<div class="pa-controls-actions">' +
            '<div class="pa-controls-status" role="status" aria-live="polite">' +
              '<span class="pa-controls-label">Last analyzed</span>' +
              '<span class="pa-controls-value">' + esc(c.lastAnalyzed ? formatLastAnalyzed(c.lastAnalyzed) : 'Not yet analyzed') + '</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</section>'
    );
  }

  function bindControls() {
    // The period select is intentionally disabled (see renderControls
    // comment) so there is nothing to wire up yet beyond preserving
    // the chosen value across re-renders, which the `selected`
    // attribute in renderControls() already does on its own.
  }

  function formatLastAnalyzed(d) {
    try {
      return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) +
        ' \u00B7 ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch (e) {
      return d.toLocaleString();
    }
  }

  // ------------------------------------------------------------------
  // Demand Summary
  // ------------------------------------------------------------------

  function renderSummary(a) {
    var c = a.counts;

    var monitoredDesc = c.total === 1 ? '1 medicine tracked for demand analysis' : c.total + ' medicines tracked for demand analysis';
    var highDesc = c.highDemand === 0
      ? 'No medicines identified with high demand risk'
      : c.highDemand + ' medicine' + (c.highDemand === 1 ? '' : 's') + ' identified with high demand risk';
    var lowDesc = c.lowStock === 0
      ? 'No medicines are at low stock levels'
      : c.lowStock + ' medicine' + (c.lowStock === 1 ? ' is' : 's are') + ' at low stock levels';
    var outDesc = c.outOfStock === 0
      ? 'No medicines are currently out of stock'
      : c.outOfStock + ' medicine' + (c.outOfStock === 1 ? ' is' : 's are') + ' currently out of stock';

    return (
      '<section class="md-summary" aria-labelledby="md-summary-heading">' +
        '<h2 class="md-summary-heading" id="md-summary-heading">DEMAND SUMMARY</h2>' +
        '<ul class="md-summary-grid">' +
          summaryCard('fa-chart-line', 'Medicines Monitored', c.total, monitoredDesc, true) +
          summaryCard('fa-triangle-exclamation', 'High Demand Risk', c.highDemand, highDesc, false) +
          summaryCard('fa-boxes-stacked', 'Low Stock Risks', c.lowStock, lowDesc, false) +
          summaryCard('fa-circle-minus', 'Out of Stock', c.outOfStock, outDesc, false) +
        '</ul>' +
      '</section>'
    );
  }

  function summaryCard(icon, label, value, desc, primary) {
    return (
      '<li class="md-scard' + (primary ? ' md-scard-primary' : '') + '">' +
        '<div class="md-scard-head">' +
          '<span class="md-scard-icon"><i class="fa-solid ' + icon + '" aria-hidden="true"></i></span>' +
        '</div>' +
        '<div class="md-scard-label">' + esc(label) + '</div>' +
        '<div class="md-scard-value">' + esc(String(value)) + '</div>' +
        '<div class="md-scard-desc">' + esc(desc) + '</div>' +
      '</li>'
    );
  }

  // ------------------------------------------------------------------
  // Medicine Demand Analysis (full-width table)
  // ------------------------------------------------------------------

  function renderAnalysisSection(a) {
    var body;
    if (!a.hasInventory) {
      body = '<div class="md-empty">No active medicine or vaccine items in Inventory yet.</div>';
    } else {
      var rows = a.items.map(renderAnalysisRow).join('');
      body =
        '<div class="md-table-wrap">' +
          '<table class="md-table">' +
            '<caption class="pa-sr-only">Medicine demand analysis</caption>' +
            '<thead><tr>' +
              '<th scope="col">Medicine</th>' +
              '<th scope="col">Category</th>' +
              '<th scope="col">Current Stock</th>' +
              '<th scope="col">Forecast Demand</th>' +
              '<th scope="col">Trend</th>' +
              '<th scope="col">Risk</th>' +
              '<th scope="col">Recommendation</th>' +
            '</tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>';
    }

    return (
      '<section class="md-section" aria-labelledby="md-analysis-heading">' +
        '<h2 class="md-section-heading" id="md-analysis-heading">MEDICINE DEMAND ANALYSIS</h2>' +
        body +
      '</section>'
    );
  }

  function stockBadge(state) {
    if (state === 'out') return '<span class="status-badge status-cancelled">OUT OF STOCK</span>';
    if (state === 'low') return '<span class="status-badge status-pending">LOW STOCK</span>';
    return '<span class="status-badge status-confirmed">IN STOCK</span>';
  }

  function renderAnalysisRow(i) {
    var stockCell =
      '<div class="md-stock-stack">' +
        stockBadge(i.stockState) +
        '<span class="md-qty">' + esc(String(i.currentStock)) + (i.unit ? ' ' + esc(i.unit) : '') + '</span>' +
      '</div>';

    var demandCell, trendCell;
    if (!i.hasEnoughData) {
      demandCell = '<span class="status-badge pa-badge-nodata">Insufficient Data</span>';
      trendCell = '<span class="md-trend-none" aria-hidden="true">\u2014</span><span class="pa-sr-only">No trend available</span>';
    } else {
      var level = String(i.demand || '');
      var levelLabel = level.charAt(0) + level.slice(1).toLowerCase();
      demandCell =
        '<div class="md-demand-level">' + esc(levelLabel) + '</div>' +
        '<div class="md-support">' + esc(i.raw.reason || '') + '</div>';
      trendCell = '<span class="md-trend"><i class="fa-solid ' + trendIcon(i.trend) + '" aria-hidden="true"></i>' + esc(i.trend) + '</span>';
    }

    // Risk column: current zero-stock status is real inventory data
    // and can be shown even without a demand figure; a merely low
    // (non-zero) stock level does not, on its own, justify a risk
    // rating — see the file header comment.
    var riskCell;
    if (i.stockState === 'out') {
      riskCell = '<span class="status-badge status-cancelled">Out of Stock</span>';
    } else if (!i.hasEnoughData) {
      riskCell = '<span class="status-badge pa-badge-nodata">Insufficient Data</span>';
    } else {
      riskCell = '<span class="status-badge ' + riskBadgeClass(i.demand) + '">' + esc(i.demand) + '</span>';
    }

    return (
      '<tr>' +
        '<th scope="row" class="md-name-cell">' +
          '<span class="md-name">' + esc(i.name) + '</span>' +
        '</th>' +
        '<td>' + esc(i.category || '\u2014') + '</td>' +
        '<td>' + stockCell + '</td>' +
        '<td>' + demandCell + '</td>' +
        '<td>' + trendCell + '</td>' +
        '<td>' + riskCell + '</td>' +
        '<td class="md-rec-cell">' + esc(i.recommendation || '') + '</td>' +
      '</tr>'
    );
  }

  // ------------------------------------------------------------------
  // Demand Trends
  // ------------------------------------------------------------------

  function renderTrendsSection(a) {
    var body;
    if (!a.hasInventory) {
      body = '<div class="md-empty">No active medicine or vaccine items in Inventory yet.</div>';
    } else {
      var rows = a.items.map(renderTrendRow).join('');
      body =
        '<div class="md-mini-table-wrap">' +
          '<table class="md-mini-table">' +
            '<caption class="pa-sr-only">Demand trends</caption>' +
            '<thead><tr>' +
              '<th scope="col">Medicine</th>' +
              '<th scope="col">Recent Usage</th>' +
              '<th scope="col">Previous Period</th>' +
              '<th scope="col">Trend</th>' +
              '<th scope="col">Confidence</th>' +
            '</tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>';
    }

    return (
      '<section class="md-section" aria-labelledby="md-trends-heading">' +
        '<h2 class="md-section-heading" id="md-trends-heading">DEMAND TRENDS</h2>' +
        body +
      '</section>'
    );
  }

  function confidenceCellHtml(i) {
    if (i.confidence === 'insufficient') return '<span class="status-badge pa-badge-nodata">Insufficient Data</span>';
    if (i.confidence === 'medium') return '<span>Medium confidence</span>';
    return '<span>Low confidence</span>';
  }

  function renderTrendRow(i) {
    var recentCell = i.hasEnoughData
      ? esc(String(i.recentMentions))
      : '<span class="status-badge pa-badge-nodata">Insufficient Data</span>';
    var prevCell = i.hasEnoughData
      ? esc(String(i.baselineMentions))
      : '<span class="status-badge pa-badge-nodata">Insufficient Data</span>';
    var trendCell = i.hasEnoughData
      ? '<span class="md-trend"><i class="fa-solid ' + trendIcon(i.trend) + '" aria-hidden="true"></i>' + esc(i.trend) + '</span>'
      : '<span class="md-trend-none" aria-hidden="true">\u2014</span>';

    return (
      '<tr>' +
        '<th scope="row" class="md-mini-name">' + esc(i.name) + '</th>' +
        '<td>' + recentCell + '</td>' +
        '<td>' + prevCell + '</td>' +
        '<td>' + trendCell + '</td>' +
        '<td>' + confidenceCellHtml(i) + '</td>' +
      '</tr>'
    );
  }

  // ------------------------------------------------------------------
  // Inventory Pressure
  // ------------------------------------------------------------------

  function renderPressureSection(a) {
    var body;
    if (!a.hasInventory) {
      body = '<div class="md-empty">No active medicine or vaccine items in Inventory yet.</div>';
    } else if (!a.pressureItems.length) {
      body = '<div class="md-empty">No inventory pressure detected \u2014 all monitored medicines are adequately stocked.</div>';
    } else {
      var rows = a.pressureItems.map(renderPressureRow).join('');
      body =
        '<div class="md-mini-table-wrap">' +
          '<table class="md-mini-table">' +
            '<caption class="pa-sr-only">Inventory pressure</caption>' +
            '<thead><tr>' +
              '<th scope="col">Medicine</th>' +
              '<th scope="col">Current Stock</th>' +
              '<th scope="col">Risk</th>' +
              '<th scope="col">Action</th>' +
            '</tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>';
    }

    return (
      '<section class="md-section" aria-labelledby="md-pressure-heading">' +
        '<h2 class="md-section-heading" id="md-pressure-heading">INVENTORY PRESSURE</h2>' +
        body +
      '</section>'
    );
  }

  function renderPressureRow(i) {
    // Action reuses exactly the same lowStock-driven branch the
    // engine's own recommendation text already takes (see
    // getMedicineDemandAnalysis() in predictive-analytics-data-
    // store.js: a lowStock item's recommendation always leads with
    // "consider restocking", regardless of demand data) — not a new
    // rule, just a one-word label for the same existing signal.
    var action = i.stockState === 'in' ? 'Monitor' : 'Restock';

    return (
      '<tr>' +
        '<th scope="row" class="md-mini-name">' + esc(i.name) + '</th>' +
        '<td>' + esc(String(i.currentStock)) + (i.unit ? ' ' + esc(i.unit) : '') + '</td>' +
        '<td>' + stockBadge(i.stockState) + '</td>' +
        '<td>' + esc(action) + '</td>' +
      '</tr>'
    );
  }

  // ------------------------------------------------------------------
  // Demand Confidence
  // ------------------------------------------------------------------

  function renderConfidenceSection(a) {
    var c = a.counts;
    return (
      '<section class="md-section" aria-labelledby="md-conf-heading">' +
        '<h2 class="md-section-heading" id="md-conf-heading">DEMAND CONFIDENCE</h2>' +
        '<ul class="md-conf-grid">' +
          confidenceCard('high', 'HIGH CONFIDENCE', 0) +
          confidenceCard('medium', 'MEDIUM CONFIDENCE', c.confMedium) +
          confidenceCard('low', 'LOW CONFIDENCE', c.confLow) +
          confidenceCard('none', 'INSUFFICIENT DATA', c.confInsufficient) +
        '</ul>' +
      '</section>'
    );
  }

  function confidenceCard(kind, label, count) {
    return (
      '<li class="md-conf-card">' +
        '<div class="md-conf-head">' +
          '<span class="md-conf-dot ' + kind + '" aria-hidden="true"></span>' +
          '<span class="md-conf-label">' + esc(label) + '</span>' +
        '</div>' +
        '<div class="md-conf-value">' + esc(String(count)) + '</div>' +
        '<div class="md-conf-sub">Medicines</div>' +
      '</li>'
    );
  }

  // ------------------------------------------------------------------
  // Forecast Note
  // ------------------------------------------------------------------

  function renderForecastNote() {
    return (
      '<div class="md-note">' +
        '<i class="fa-solid fa-circle-info" aria-hidden="true"></i>' +
        '<div>' +
          '<p class="md-note-title">FORECAST NOTE</p>' +
          '<p class="md-note-text">Demand forecasts are estimates based on observed historical patterns and available inventory information. They are not guaranteed future usage.</p>' +
        '</div>' +
      '</div>'
    );
  }

  // ------------------------------------------------------------------
  // small shared render helpers (same behavior as predictive-
  // analytics.js's own riskBadgeClass/trendIcon/esc/escAttr)
  // ------------------------------------------------------------------

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

  function escAttr(str) {
    return esc(str).replace(/"/g, '&quot;');
  }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
})();