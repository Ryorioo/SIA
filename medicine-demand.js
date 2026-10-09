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
// as one focused analysis page (no summary cards, no analysis
// controls) matching the cleaned Disease Risk page.
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

  // Same >= 8 total-records threshold predictive-analytics-data-
  // store.js's getDiseaseRiskAnalysis() already uses to call a rated
  // estimate "Moderate confidence" vs. "Low confidence (small
  // sample)" — reused here, unchanged, for medicines.
  var CONFIDENCE_SAMPLE_THRESHOLD = 8;

  document.addEventListener('DOMContentLoaded', function () {
    if (!window.PCData || !PCData.getInventory || !PCData.getMedicalRecords) {
      renderFatal('Medicine Demand Forecast could not load: required data modules are missing.');
      return;
    }
    if (!PCData.Predictive || !PCData.Predictive.getMedicineDemandAnalysis) {
      renderFatal('Medicine Demand Forecast could not load: its calculation module (predictive-analytics-data-store.js) is missing.');
      return;
    }

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
      renderPageHeader() +
      renderAnalysisSection(analysis) +
      renderTrendsSection(analysis) +
      renderPressureSection(analysis) +
      renderConfidenceSection(analysis) +
      renderForecastNote();
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
  // so every section (the main table, trends,
  // pressure, confidence) reads the exact same values instead of
  // re-deriving them slightly differently in five places.
  // ------------------------------------------------------------------

  function buildDisplayModel(medicine, categories) {
    var items = (medicine.items || []).map(function (i) {
      var out = Number(i.currentStock) === 0;
      var low = !out && !!i.lowStock; // isLowStock() already covers qty===0 too; "low" here means "low but not zero" so it doesn't double-count against Out of Stock
      var stockState = out ? 'out' : (low ? 'low' : 'in');

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
        confidence: confidence // 'insufficient' | 'low' | 'medium' (never 'high')
      };
    });

    var counts = { confMedium: 0, confLow: 0, confInsufficient: 0 };
    items.forEach(function (i) {
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
  // Page header
  // ------------------------------------------------------------------

  function renderPageHeader() {
    return (
      '<div class="page-toolbar md-page-header">' +
        '<div>' +
          '<h1 class="md-page-title">MEDICINE DEMAND</h1>' +
        '</div>' +
      '</div>'
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
      '<section class="md-section md-section-surface" aria-labelledby="md-analysis-heading">' +
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
      '<section class="md-section md-section-surface" aria-labelledby="md-trends-heading">' +
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
      '<section class="md-section md-section-surface" aria-labelledby="md-pressure-heading">' +
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
      '<section class="md-section md-section-surface" aria-labelledby="md-conf-heading">' +
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
  // analytics.js's own riskBadgeClass/trendIcon/esc)
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

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
})();