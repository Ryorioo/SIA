// ============================================================
// PAWSITIVE CARE — Disease Risk Analysis page
// Renders into #dr-root in disease-risk.html.
// All calculation comes from PCData.Predictive (predictive-analytics-
// data-store.js) — this file only fetches weather, calls that logic,
// and renders the result. Nothing here invents disease predictions.
// ============================================================

(function () {
  'use strict';

  // Same placeholder location predictive-analytics.js uses (no clinic
  // coordinates are stored yet).
  var WEATHER_LAT = 14.5995;
  var WEATHER_LON = 120.9842;
  var WEATHER_URL =
    'https://api.open-meteo.com/v1/forecast?latitude=' + WEATHER_LAT +
    '&longitude=' + WEATHER_LON +
    '&current=temperature_2m,precipitation,relative_humidity_2m,weather_code&timezone=auto';

  var ANALYSIS_PERIOD_OPTIONS = [
    ['7d', 'Last 7 Days'],
    ['30d', 'Last 30 Days'],
    ['90d', 'Last 90 Days'],
    ['6m', 'Last 6 Months'],
    ['12m', 'Last 12 Months']
  ];

  // Display-only icon per category (presentation, not data).
  var CATEGORY_ICONS = {
    respiratory: 'fa-lungs',
    gastrointestinal: 'fa-bacteria',
    skin: 'fa-allergies',
    parasitic: 'fa-bug',
    other: 'fa-arrows-rotate'
  };

  // Static, cautious environmental wording shown when the engine has no
  // weather note for a category. Always framed as "may be associated
  // with" — supporting context, never a cause.
  var ENVIRONMENT_TEXT = {
    respiratory: 'May be associated with changes in humidity and temperature.',
    gastrointestinal: 'May be associated with changes in diet, water quality, or temperature.',
    skin: 'May be associated with humidity and seasonal changes.',
    parasitic: 'May be associated with warmer and wetter conditions.',
    other: 'May be associated with seasonal changes and humidity levels.'
  };

  var state = {
    weather: { status: 'loading', data: null }, // loading | ok | error
    lastAnalyzed: null
  };

  document.addEventListener('DOMContentLoaded', function () {
    var root = document.getElementById('dr-root');
    if (!window.PCData || !PCData.getMedicalRecords) {
      if (root) root.innerHTML = '<div class="dr-empty-panel">Disease Risk Analysis could not load: required data modules are missing.</div>';
      return;
    }
    if (!PCData.Predictive) {
      if (root) root.innerHTML = '<div class="dr-empty-panel">Disease Risk Analysis could not load: its calculation module is missing.</div>';
      return;
    }
    renderAll();
    fetchWeather();
    PCData.onChange(renderAll);
  });

  // ------------------------------------------------------------------
  // weather (best-effort; a failure only affects environmental notes)
  // ------------------------------------------------------------------

  function fetchWeather() {
    state.weather = { status: 'loading', data: null };
    renderAll();

    if (!window.fetch) {
      state.weather = { status: 'error', data: null };
      renderAll();
      return;
    }

    fetch(WEATHER_URL)
      .then(function (res) {
        if (!res.ok) throw new Error('Weather service returned an error.');
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
            humidity: c.relative_humidity_2m
          }
        };
        renderAll();
      })
      .catch(function () {
        state.weather = { status: 'error', data: null };
        renderAll();
      });
  }

  // ------------------------------------------------------------------
  // render
  // ------------------------------------------------------------------

  function renderAll() {
    var root = document.getElementById('dr-root');
    if (!root) return;
    var P = PCData.Predictive;
    var disease = P.getDiseaseRiskAnalysis();
    var weatherFactors = state.weather.status === 'ok' ? P.getWeatherFactors(state.weather.data) : [];
    var adjusted = P.applyWeatherAdjustments(disease, weatherFactors);
    state.lastAnalyzed = new Date();

    root.innerHTML =
      renderBack() +
      renderHeader() +
      renderControls() +
      renderSummary(adjusted) +
      renderDiseaseSection(adjusted) +
      '<div class="dr-bottom-grid">' +
        renderTrendTable(adjusted) +
        renderConfidence(adjusted) +
      '</div>' +
      renderNote();
  }

  function renderBack() {
    return (
      '<div class="pa-back-row">' +
        '<a class="pa-back-link" href="predictive-analytics.html">' +
          '<i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Back to Predictive Analytics' +
        '</a>' +
      '</div>'
    );
  }

  function renderHeader() {
    return (
      '<div class="page-toolbar">' +
        '<div>' +
          '<h1 class="dr-title">DISEASE RISK PREDICTIONS</h1>' +
        '</div>' +
      '</div>'
    );
  }

  // Analysis Period: the engine only supports its fixed 30-day window, so
  // the select is shown for structure but disabled. Nothing is recalculated.
  function renderControls() {
    var options = ANALYSIS_PERIOD_OPTIONS.map(function (o) {
      return '<option value="' + escAttr(o[0]) + '"' + (o[0] === '30d' ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('');
    return (
      '<section class="pa-controls" aria-labelledby="dr-controls-heading">' +
        '<h2 class="pa-controls-heading" id="dr-controls-heading">ANALYSIS CONTROLS</h2>' +
        '<div class="pa-controls-panel">' +
          '<div class="pa-controls-field">' +
            '<label class="pa-controls-label" for="dr-period">Analysis Period</label>' +
            '<select id="dr-period" class="pc-select pa-controls-select" disabled title="The analysis currently uses a fixed 30-day window.">' + options + '</select>' +
          '</div>' +
          '<div class="pa-controls-actions">' +
            '<div class="pa-controls-status" role="status" aria-live="polite">' +
              '<span class="pa-controls-label">Last analyzed</span>' +
              '<span class="pa-controls-value">' + esc(formatLastAnalyzed(state.lastAnalyzed)) + '</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</section>'
    );
  }

  function formatLastAnalyzed(d) {
    if (!d) return 'Not yet analyzed';
    try {
      return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) +
        ' \u00B7 ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch (e) {
      return d.toLocaleString();
    }
  }

  // RISK SUMMARY — derived only from the existing analysis result.
  // Overall confidence follows the same rule the Overview uses: Moderate
  // when every rated condition has moderate confidence, Low otherwise,
  // Insufficient when no condition has enough records.
  function renderSummary(disease) {
    var cats = disease.categories || [];
    var rated = cats.filter(function (c) { return c.hasEnoughData; });
    var increasing = rated.filter(function (c) { return c.trend === 'Increasing'; }).length;
    var moderateCount = rated.filter(function (c) { return /^moderate/i.test(c.confidence || ''); }).length;

    var overall, overallDesc;
    if (!rated.length) {
      overall = 'INSUFFICIENT';
      overallDesc = 'No condition has enough records to rate yet';
    } else if (moderateCount === rated.length) {
      overall = 'MODERATE';
      overallDesc = 'Sample sizes support all rated estimates';
    } else {
      overall = 'LOW';
      overallDesc = 'Predictions are based on limited data';
    }

    return (
      '<section class="dr-section" aria-labelledby="dr-summary-heading">' +
        '<h2 class="dr-section-heading" id="dr-summary-heading">RISK SUMMARY</h2>' +
        '<ul class="dr-summary-grid">' +
          summaryCard('Conditions Monitored', cats.length,
            rated.length + ' of ' + cats.length + ' have enough records to analyze', 'fa-shield-halved', true) +
          summaryCard('Conditions With Enough Data', rated.length,
            rated.length === 1 ? 'Only 1 condition has sufficient data' : rated.length + ' conditions have sufficient data', 'fa-database') +
          summaryCard('Increasing Risks', increasing,
            increasing === 1 ? '1 condition is showing an increasing trend' : increasing + ' conditions are showing an increasing trend', 'fa-arrow-trend-up') +
          summaryCard('Overall Data Confidence', overall, overallDesc, 'fa-shield') +
        '</ul>' +
      '</section>'
    );
  }

  function summaryCard(label, value, desc, icon, primary) {
    return (
      '<li class="dr-summary-card' + (primary ? ' dr-summary-card-primary' : '') + '">' +
        '<div class="dr-summary-head">' +
          '<span class="dr-summary-icon"><i class="fa-solid ' + icon + '" aria-hidden="true"></i></span>' +
          '<span class="dr-summary-label">' + esc(label) + '</span>' +
          (primary ? '<i class="fa-solid fa-chart-line dr-summary-corner" aria-hidden="true"></i>' : '') +
        '</div>' +
        '<span class="dr-summary-value">' + esc(String(value)) + '</span>' +
        '<span class="dr-summary-desc">' + esc(desc) + '</span>' +
      '</li>'
    );
  }

  // DISEASE RISK ANALYSIS — the four narrower categories form a two-column
  // grid; "Other Recurring Conditions" spans the full width.
  function renderDiseaseSection(disease) {
    var body;
    if (!disease.hasAnyRecords) {
      body = '<div class="dr-empty-panel">No medical records exist yet, so disease risk trends can\u2019t be calculated.</div>';
    } else {
      var otherKey = PCData.Predictive.OTHER_CATEGORY.key;
      var cards = disease.categories.map(function (c) {
        return renderCard(c, disease.windowDays, c.key === otherKey);
      }).join('');
      body = '<ul class="dr-card-grid">' + cards + '</ul>';
    }
    return (
      '<section class="dr-section" aria-labelledby="dr-disease-heading">' +
        '<h2 class="dr-section-heading" id="dr-disease-heading">DISEASE RISK ANALYSIS</h2>' +
        (state.weather.status === 'error'
          ? '<p class="dr-weather-note"><i class="fa-solid fa-cloud-slash" aria-hidden="true"></i> Weather context is unavailable right now. Environmental notes are still shown as general context.</p>'
          : '') +
        body +
      '</section>'
    );
  }

  function renderCard(c, windowDays, wide) {
    var rated = c.hasEnoughData;
    var icon = CATEGORY_ICONS[c.key] || 'fa-circle-dot';
    var totalCount = c.totalCount == null ? 0 : c.totalCount;

    var badge = rated
      ? '<span class="status-badge ' + riskBadgeClass(c.risk) + '">' + esc(c.risk) + '</span>'
      : '<span class="dr-badge-nodata">INSUFFICIENT DATA</span>';

    var headSide =
      (rated ? '<span class="dr-trend"><i class="fa-solid ' + trendIcon(c.trend) + '" aria-hidden="true"></i>' + esc(c.trend) + '</span>' : '') +
      '<span class="dr-records">Records matched so far: ' + esc(String(totalCount)) + '</span>';

    var metrics;
    if (rated && wide) {
      metrics =
        metric('Recent cases', '<span class="dr-metric-value">' + esc(String(c.recentCount)) + '</span><span class="dr-metric-sub">Last ' + esc(String(windowDays)) + ' days</span>') +
        metric('Previous period', '<span class="dr-metric-value">' + esc(String(c.baselineCount)) + '</span><span class="dr-metric-sub">Prior ' + esc(String(windowDays)) + ' days</span>') +
        metric('Confidence', confidenceBadge(c.confidence));
    } else {
      metrics =
        metric('Risk', rated ? '<span class="dr-metric-value">' + esc(c.risk) + '</span>' : '<span class="dr-none">\u2014</span>') +
        metric('Trend', rated ? '<span class="dr-metric-value">' + esc(c.trend) + '</span>' : '<span class="dr-none">\u2014</span>') +
        metric('Confidence', rated ? confidenceBadge(c.confidence) : '<span class="dr-badge-nodata">Insufficient</span>');
    }

    var explanation = rated ? c.reason : (c.message || 'Not enough historical data yet.');
    var envText = (rated && c.weatherNote) ? c.weatherNote : (ENVIRONMENT_TEXT[c.key] || ENVIRONMENT_TEXT.other);

    return (
      '<li class="dr-card' + (wide ? ' dr-card-wide' : '') + (rated ? '' : ' dr-card-nodata') + '">' +
        '<div class="dr-card-head">' +
          '<div class="dr-card-id">' +
            '<span class="dr-card-icon"><i class="fa-solid ' + icon + '" aria-hidden="true"></i></span>' +
            '<h3 class="dr-card-title">' + esc(c.label) + '</h3>' +
            badge +
          '</div>' +
          '<div class="dr-card-side">' + headSide + '</div>' +
        '</div>' +
        '<div class="dr-card-body">' +
          '<dl class="dr-metrics">' + metrics + '</dl>' +
          '<div class="dr-card-detail">' +
            '<p class="dr-card-reason">' + esc(explanation) + '</p>' +
            '<div class="dr-env">' +
              '<div class="dr-env-label">ENVIRONMENTAL CONTEXT</div>' +
              '<p>' + esc(envText) + '</p>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</li>'
    );
  }

  function metric(label, valueHtml) {
    return '<div class="dr-metric"><dt>' + esc(label) + '</dt><dd>' + valueHtml + '</dd></div>';
  }

  // Confidence pill: existing engine string shortened for display only.
  function confidenceBadge(text) {
    var short = shortConfidence(text);
    var cls = /^moderate/i.test(text || '') ? 'status-confirmed' : 'status-pending';
    return '<span class="status-badge ' + cls + '">' + esc(short) + '</span>';
  }

  function shortConfidence(text) {
    var s = String(text || '');
    var paren = s.indexOf('(');
    if (paren !== -1) s = s.slice(0, paren);
    s = s.replace(/confidence/i, '').trim();
    return s || String(text || '');
  }

  // TREND COMPARISON — recent vs. previous period, using existing counts.
  function renderTrendTable(disease) {
    var rows = disease.categories.map(function (c) {
      if (!c.hasEnoughData) {
        return (
          '<tr>' +
            '<td>' + esc(c.label) + '</td>' +
            '<td class="dr-none">\u2014</td>' +
            '<td class="dr-none">\u2014</td>' +
            '<td><span class="dr-nodata-pill">No data</span></td>' +
          '</tr>'
        );
      }
      return (
        '<tr>' +
          '<td>' + esc(c.label) + '</td>' +
          '<td>' + esc(String(c.recentCount)) + '</td>' +
          '<td>' + esc(String(c.baselineCount)) + '</td>' +
          '<td><span class="dr-trend"><i class="fa-solid ' + trendIcon(c.trend) + '" aria-hidden="true"></i>' + esc(c.trend) + '</span></td>' +
        '</tr>'
      );
    }).join('');

    return (
      '<section class="dr-panel" aria-labelledby="dr-trend-heading">' +
        '<h2 class="dr-panel-heading" id="dr-trend-heading">TREND COMPARISON</h2>' +
        '<div class="dr-table-wrap">' +
          '<table class="dr-table">' +
            '<caption class="dr-sr-only">Recent vs. previous period case counts by condition</caption>' +
            '<thead><tr>' +
              '<th scope="col">Condition</th>' +
              '<th scope="col">Recent Cases</th>' +
              '<th scope="col">Previous Period</th>' +
              '<th scope="col">Trend</th>' +
            '</tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>' +
      '</section>'
    );
  }

  // DATA CONFIDENCE — counts derived from each condition's existing
  // confidence string. The current engine never emits a "High" level, so
  // HIGH stays at 0 until the engine does.
  var CONFIDENCE_TIERS = [
    { level: 'HIGH', sub: 'Confidence', dot: 'dr-dot-high' },
    { level: 'MEDIUM', sub: 'Confidence', dot: 'dr-dot-medium' },
    { level: 'LOW', sub: 'Confidence', dot: 'dr-dot-low' },
    { level: 'INSUFFICIENT', sub: 'Data', dot: 'dr-dot-none' }
  ];

  function renderConfidence(disease) {
    var counts = { HIGH: 0, MEDIUM: 0, LOW: 0, INSUFFICIENT: 0 };
    disease.categories.forEach(function (c) {
      if (!c.hasEnoughData) counts.INSUFFICIENT++;
      else if (/^high/i.test(c.confidence || '')) counts.HIGH++;
      else if (/^moderate/i.test(c.confidence || '')) counts.MEDIUM++;
      else counts.LOW++;
    });
    var tiles = CONFIDENCE_TIERS.map(function (t) {
      return (
        '<li class="dr-conf-tile">' +
          '<div class="dr-conf-top"><span class="dr-dot ' + t.dot + '" aria-hidden="true"></span><span class="dr-conf-label">' + t.level + '</span></div>' +
          '<span class="dr-conf-sub">' + t.sub + '</span>' +
          '<span class="dr-conf-value">' + counts[t.level] + '</span>' +
        '</li>'
      );
    }).join('');

    return (
      '<section class="dr-panel" aria-labelledby="dr-confidence-heading">' +
        '<h2 class="dr-panel-heading" id="dr-confidence-heading">DATA CONFIDENCE</h2>' +
        '<ul class="dr-conf-grid">' + tiles + '</ul>' +
        '<p class="dr-panel-foot">Confidence reflects the amount of relevant historical data available for each condition.</p>' +
      '</section>'
    );
  }

  function renderNote() {
    return (
      '<section class="dr-note" aria-labelledby="dr-note-heading">' +
        '<h2 class="dr-note-heading" id="dr-note-heading"><i class="fa-solid fa-circle-info" aria-hidden="true"></i> ANALYSIS NOTE</h2>' +
        '<p>Risk estimates are based on observed historical patterns and supporting environmental factors. ' +
        'They are rule-based estimates, not a veterinary diagnosis, and should not be treated as a guarantee of any outcome.</p>' +
      '</section>'
    );
  }

  // ------------------------------------------------------------------
  // small helpers (mirrors the equivalents in predictive-analytics.js)
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

  function escAttr(str) {
    return esc(str).replace(/"/g, '&quot;');
  }
})();