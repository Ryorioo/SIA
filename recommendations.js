// ============================================================
// PAWSITIVE CARE — Recommendations page (Predictive Analytics,
// Phase 2D)
// Renders into the #rec-root placeholder in recommendations.html.
//
// This file does NOT implement a second recommendation engine. It
// reuses the exact same result objects PCData.Predictive already
// computes for the Overview (predictive-analytics.js):
//   - PCData.Predictive.getDiseaseRiskAnalysis()
//   - PCData.Predictive.getMedicineDemandAnalysis()
//   - PCData.Predictive.getWeatherFactors() / applyWeatherAdjustments()
// and reads the SAME fields those functions already produce
// (hasEnoughData, risk, trend, recentCount/baselineCount, demand,
// lowStock, expired, currentStock) to sort them into the three
// recommendation types this dedicated page's layout needs (Stock
// Actions / Monitoring Actions / Data Collection). The conditions
// used to decide what counts as a "recommendation" are the same
// conditions PCData.Predictive.getRecommendations() already uses —
// this file only reorganizes those results by type instead of
// flattening them into plain strings, and never introduces a new
// threshold, keyword rule, or priority calculation of its own.
//
// Weather is fetched only to feed applyWeatherAdjustments() (so a
// category's risk here matches what the rest of Predictive Analytics
// would show) — there is no visual weather section on this page.
// ============================================================

(function () {
  'use strict';

  // NOTE: same placeholder clinic location predictive-analytics.js
  // uses — there is no stored clinic address yet.
  var WEATHER_LAT = 14.5995;
  var WEATHER_LON = 120.9842;
  var WEATHER_URL =
    'https://api.open-meteo.com/v1/forecast?latitude=' + WEATHER_LAT +
    '&longitude=' + WEATHER_LON +
    '&current=temperature_2m,precipitation,relative_humidity_2m,weather_code&timezone=auto';

  var state = {
    weather: { status: 'loading', data: null }
  };

  document.addEventListener('DOMContentLoaded', function () {
    if (!window.PCData || !PCData.getMedicalRecords || !PCData.getInventory) {
      console.error('recommendations.js: PCData not fully loaded — make sure data-store.js, patient-data-store.js and medical-records-data-store.js load before this file.');
      var root = document.getElementById('rec-root');
      if (root) root.innerHTML = '<div class="pa-empty">Recommendations could not load: required data modules are missing.</div>';
      return;
    }
    if (!PCData.Predictive) {
      console.error('recommendations.js: PCData.Predictive not found — make sure predictive-analytics-data-store.js loads before this file.');
      var root2 = document.getElementById('rec-root');
      if (root2) root2.innerHTML = '<div class="pa-empty">Recommendations could not load: its calculation module is missing.</div>';
      return;
    }

    renderAll();
    fetchWeather();
    PCData.onChange(renderAll);
  });

  // ------------------------------------------------------------------
  // weather (adjustments only — no visual section on this page). A
  // failure here just means recommendations render without weather
  // adjustments, same "rest of the page still works" behavior the
  // Overview uses.
  // ------------------------------------------------------------------
  function fetchWeather() {
    if (!window.fetch) { state.weather = { status: 'error', data: null }; return; }
    fetch(WEATHER_URL)
      .then(function (res) {
        if (!res.ok) throw new Error('weather error');
        return res.json();
      })
      .then(function (json) {
        var c = json && json.current;
        if (!c || typeof c.temperature_2m !== 'number') throw new Error('unexpected weather response');
        state.weather = {
          status: 'ok',
          data: {
            temperature: c.temperature_2m,
            precipitation: c.precipitation || 0,
            humidity: c.relative_humidity_2m,
            weatherCode: c.weather_code
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
  // classify existing analysis results into the three recommendation
  // types this page's layout needs. Every condition below matches a
  // condition PCData.Predictive.getRecommendations() already uses.
  // ------------------------------------------------------------------

  // Same medicine condition getRecommendations() uses: an item with
  // no usage history yet but currently low stock, OR an item with
  // enough history showing HIGH demand or low stock.
  function computeStockActions(medicine) {
    return (medicine.items || []).filter(function (i) {
      if (!i.hasEnoughData) return !!i.lowStock;
      return i.demand === 'HIGH' || i.lowStock;
    }).sort(function (a, b) {
      function score(i) {
        if (Number(i.currentStock) === 0) return 3;
        if (i.lowStock) return 2;
        return 1;
      }
      return score(b) - score(a);
    });
  }

  // Same disease condition getRecommendations() uses: HIGH risk
  // ("Review recent X cases") or an Increasing trend ("Monitor X
  // cases") — both are ongoing items to keep an eye on, so both fall
  // under Monitoring Actions on this page.
  function computeMonitoringActions(disease) {
    return (disease.categories || []).filter(function (c) {
      return c.hasEnoughData && (c.risk === 'HIGH' || c.trend === 'Increasing');
    });
  }

  // Categories the disease engine explicitly says don't have enough
  // records yet (below MIN_CASES_FOR_SIGNAL). If there are no medical
  // records at all yet, that's one systemic gap, not one per category.
  function computeDataCollection(disease) {
    if (!disease.hasAnyRecords) {
      return [{ key: 'none', label: 'Medical History', totalCount: 0 }];
    }
    return (disease.categories || []).filter(function (c) { return !c.hasEnoughData; });
  }

  function stockStatus(i) {
    if (Number(i.currentStock) === 0) return 'out';
    if (i.lowStock) return 'low';
    return 'in';
  }

  function stockAction(i) {
    if (Number(i.currentStock) === 0) return 'Restock';
    if (i.lowStock) return 'Order Soon';
    return 'Monitor';
  }

  function joinNames(names) {
    if (!names.length) return '';
    if (names.length === 1) return names[0];
    if (names.length === 2) return names[0] + ' and ' + names[1];
    return names.slice(0, -1).join(', ') + ', and ' + names[names.length - 1];
  }

  function stockRowTitle(items) {
    return items.some(function (i) { return i.lowStock; })
      ? 'Review low-stock medicine'
      : 'Monitor high-demand medicine';
  }

  function stockRowContext(items) {
    var lowNames = items.filter(function (i) { return i.lowStock; }).map(function (i) { return i.name; });
    var highOnly = items.filter(function (i) { return !i.lowStock; }).map(function (i) { return i.name; });
    var parts = [];
    if (lowNames.length) {
      parts.push(joinNames(lowNames) + (lowNames.length === 1 ? ' is' : ' are') + ' at low stock levels.');
    }
    if (highOnly.length) {
      parts.push(joinNames(highOnly) + (highOnly.length === 1 ? ' shows' : ' show') + ' high recent demand.');
    }
    parts.push('Based on recent usage patterns and current stock levels.');
    return parts.join(' ');
  }

  function monitorRowTitle(items) {
    return items.some(function (c) { return c.trend === 'Increasing'; })
      ? 'Monitor increasing disease patterns'
      : 'Review elevated disease risk';
  }

  function monitorRowDesc(items) {
    return 'Track the pattern in ' + joinNames(items.map(function (c) { return c.label; })) + '.';
  }

  function monitorRowContext(items) {
    if (items.length === 1) {
      var c = items[0];
      if (c.trend === 'Increasing') {
        return 'Recent cases increased from ' + c.baselineCount + ' to ' + c.recentCount +
          ' compared to the previous period. May require closer monitoring and follow-up.';
      }
      return c.label + ' risk is currently estimated as HIGH (' + c.recentCount +
        ' recent case' + (c.recentCount === 1 ? '' : 's') + '). May require closer monitoring and follow-up.';
    }
    return joinNames(items.map(function (c) { return c.label; })) +
      ' show rising or elevated case patterns. May require closer monitoring and follow-up.';
  }

  function dataRowContext(items) {
    var subject = (items.length === 1 && items[0].key !== 'none')
      ? items[0].label.toLowerCase() + ' cases'
      : 'some conditions';
    return 'Current data is limited for ' + subject + ', resulting in lower confidence levels.';
  }

  // ------------------------------------------------------------------
  // render
  // ------------------------------------------------------------------

  function renderAll() {
    var root = document.getElementById('rec-root');
    if (!root) return;

    var P = PCData.Predictive;
    var disease = P.getDiseaseRiskAnalysis();
    var medicine = P.getMedicineDemandAnalysis();
    var weatherFactors = state.weather.status === 'ok' ? P.getWeatherFactors(state.weather.data) : [];
    var adjustedDisease = P.applyWeatherAdjustments(disease, weatherFactors);

    var stockItems = computeStockActions(medicine);
    var monitorItems = computeMonitoringActions(adjustedDisease);
    var dataItems = computeDataCollection(adjustedDisease);

    root.innerHTML =
      renderPageHead() +
      renderCurrentRecommendations(stockItems, monitorItems, dataItems) +
      '<div class="pa-lower2-grid">' +
        renderStockPanel(stockItems) +
        '<div class="pa-lower2-right">' +
          renderMonitoringPanel(monitorItems) +
          renderDataPanel(dataItems) +
        '</div>' +
      '</div>' +
      renderAnalysisNote();

    bindCrTable(root);
  }

  // ------------------------------------------------------------------
  // Recommendation detail modal (Phase 3A)
  //
  // This does NOT run a second predictive engine. Each modal builder
  // below re-reads the SAME PCData.Predictive result objects renderAll()
  // already uses (getDiseaseRiskAnalysis / getWeatherFactors /
  // applyWeatherAdjustments) at the moment the modal is opened, so the
  // numbers shown always match what the current data actually produced
  // — never a value captured from a stale render or invented here.
  //
  // Recommendation rows are identified by a stable type key (e.g.
  // 'INCREASING_DISEASE_PATTERN') rather than by their display text, so
  // more types/modals can be added later just by adding another entry to
  // REC_MODAL_BUILDERS — see computeMonitorRowType() for how a row
  // currently gets that key.
  // ------------------------------------------------------------------

  // Same condition monitorRowTitle() already uses to decide between
  // 'Monitor increasing disease patterns' and 'Review elevated disease
  // risk' — a modal only exists for the former today, so a monitor row
  // that's only HIGH-risk (no Increasing category) stays non-clickable
  // until that modal is built.
  function computeMonitorRowType(items) {
    if (items.some(function (c) { return c.trend === 'Increasing'; })) return 'INCREASING_DISEASE_PATTERN';
    return null;
  }

  // The Data Collection row (Phase 3B) always represents the same
  // recommendation whenever it's shown at all — unlike the monitor row,
  // there's no alternate title/condition to distinguish between, so this
  // exists mainly so every row goes through the same "type" convention.
  function computeDataRowType(items) {
    return items.length ? 'INSUFFICIENT_MEDICAL_HISTORY' : null;
  }

  var REC_MODAL_BUILDERS = {
    INCREASING_DISEASE_PATTERN: buildIncreasingDiseasePatternModal,
    INSUFFICIENT_MEDICAL_HISTORY: buildInsufficientMedicalHistoryModal,
    LOW_STOCK_MEDICINE: buildLowStockMedicineModal
  };

  // Single delegated listener per render (the table markup is rebuilt
  // from scratch on every renderAll(), so this never stacks duplicate
  // listeners on a persistent element).
  function bindCrTable(root) {
    var wrap = root.querySelector('.pa-cr-table-wrap');
    if (!wrap) return;
    wrap.addEventListener('click', function (e) {
      var target = e.target.closest && e.target.closest('[data-rec-type]');
      if (!target || !wrap.contains(target)) return;
      openRecommendationModal(target.getAttribute('data-rec-type'));
    });
  }

  function openRecommendationModal(type) {
    var builder = REC_MODAL_BUILDERS[type];
    if (typeof builder !== 'function') return;
    var content = builder();
    if (!content) return; // e.g. the underlying condition no longer qualifies
    renderRecModal(content);
  }

  // Only one recommendation modal can be open at a time; this tracks its
  // closer so the single Escape/Tab listeners below (registered once,
  // outside of renderAll) know what to do.
  var recModalCloser = null;

  document.addEventListener('keydown', function (e) {
    if (!recModalCloser) return;
    if (e.key !== 'Escape' && e.key !== 'Esc') return;
    if (e.isComposing || e.keyCode === 229) return; // IME composition
    e.preventDefault();
    recModalCloser();
  });

  // Keeps Tab/Shift+Tab focus cycling inside the modal while it's open,
  // matching the same aria-modal="true" contract used elsewhere in the app.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab' || e.isComposing) return;
    if (!recModalCloser) return;
    var box = document.querySelector('#rec-modal-overlay .modal-box');
    if (!box) return;
    var all = box.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])');
    var items = [];
    for (var i = 0; i < all.length; i++) {
      if (!all[i].disabled && all[i].offsetParent !== null) items.push(all[i]);
    }
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1], active = document.activeElement;
    if (e.shiftKey && (active === first || !box.contains(active))) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && (active === last || !box.contains(active))) {
      e.preventDefault(); first.focus();
    }
  });

  function renderRecModal(content) {
    var overlay = document.createElement('div');
    overlay.id = 'rec-modal-overlay';
    overlay.className = 'modal-overlay open';

    var box = document.createElement('div');
    box.className = 'modal-box pa-rmodal-box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'rec-modal-title');
    box.setAttribute('aria-describedby', 'rec-modal-desc');

    var opener = document.activeElement;

    box.innerHTML =
      '<div class="modal-head pa-rmodal-head">' +
        '<div class="pa-rmodal-head-main">' +
          '<span class="pa-rmodal-icon"><i class="fa-solid ' + esc(content.icon) + '" aria-hidden="true"></i></span>' +
          '<div>' +
            '<h3 class="modal-title" id="rec-modal-title">' + esc(content.title) + '</h3>' +
            '<p class="pa-rmodal-desc" id="rec-modal-desc">' + esc(content.description) + '</p>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="modal-close" id="rec-modal-close" aria-label="Close">' +
          '<i class="fa-solid fa-xmark" aria-hidden="true"></i>' +
        '</button>' +
      '</div>' +
      '<div class="pa-rmodal-body">' + content.bodyHtml + '</div>' +
      '<div class="modal-footer">' +
        '<button type="button" class="btn" id="rec-modal-close-btn">Close</button>' +
        (content.viewHref
          ? '<button type="button" class="btn btn-primary" id="rec-modal-view-btn">' + esc(content.viewLabel || 'View Details') + ' <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></button>'
          : '') +
      '</div>';

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    recModalCloser = closeModal;

    document.getElementById('rec-modal-close').addEventListener('click', closeModal);
    document.getElementById('rec-modal-close-btn').addEventListener('click', closeModal);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeModal();
    });
    if (content.viewHref) {
      document.getElementById('rec-modal-view-btn').addEventListener('click', function () {
        window.location.href = content.viewHref;
      });
    }

    document.getElementById('rec-modal-close').focus();

    function closeModal() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (recModalCloser === closeModal) recModalCloser = null;
      if (opener && opener.isConnected) opener.focus();
    }
  }

  // ------------------------------------------------------------------
  // INCREASING_DISEASE_PATTERN modal content
  // ------------------------------------------------------------------

  function buildIncreasingDiseasePatternModal() {
    var P = PCData.Predictive;
    var disease = P.getDiseaseRiskAnalysis();
    var weatherFactors = state.weather.status === 'ok' ? P.getWeatherFactors(state.weather.data) : [];
    var adjusted = P.applyWeatherAdjustments(disease, weatherFactors);

    var increasing = (adjusted.categories || []).filter(function (c) {
      return c.hasEnoughData && c.trend === 'Increasing';
    });
    if (!increasing.length) return null; // data changed since the row was drawn; nothing to show

    var primary = increasing[0];
    var others = increasing.slice(1);
    var windowDays = adjusted.windowDays || disease.windowDays;
    var diff = (primary.recentCount || 0) - (primary.baselineCount || 0);

    var whyText = 'Recent medical-record patterns show an increase in ' + primary.label +
      ' compared with the previous period.' +
      (others.length
        ? ' ' + joinNames(others.map(function (c) { return c.label; })) +
          (others.length === 1 ? ' is' : ' are') + ' also showing a similar increasing pattern.'
        : '') +
      ' Additional follow-up and future records can help determine whether the increase continues.';

    var actionText = 'Continue monitoring ' + primary.label +
      ' cases and follow-up visits for changes in the observed pattern. Additional relevant records may improve confidence in future estimates.';

    var bodyHtml =
      rmodalSection('fa-circle-info', 'Why this was recommended', '<p class="pa-rmodal-text">' + esc(whyText) + '</p>') +
      rmodalSection('fa-clipboard-list', 'Condition details', renderConditionDetails(primary, windowDays)) +
      rmodalSection('fa-scale-balanced', 'Case comparison', renderCaseComparison(primary, diff)) +
      rmodalSection('fa-cloud-sun', 'Environmental context', renderEnvironmentalContext(primary)) +
      rmodalSection('fa-circle-check', 'Recommended action',
        '<div class="pa-rmodal-action"><i class="fa-solid fa-check" aria-hidden="true"></i><p class="pa-rmodal-text">' + esc(actionText) + '</p></div>') +
      rmodalSection('fa-file-lines', 'Data limitation', renderDataLimitation(primary));

    return {
      icon: 'fa-arrow-trend-up',
      title: 'Monitor increasing disease patterns',
      description: 'Review conditions showing an increasing pattern and continue monitoring new cases.',
      bodyHtml: bodyHtml,
      viewHref: 'disease-risk.html',
      viewLabel: 'View Disease Risk'
    };
  }

  function rmodalSection(icon, title, innerHtml) {
    return (
      '<section class="pa-rmodal-section">' +
        '<h4 class="pa-rmodal-section-title"><i class="fa-solid ' + icon + '" aria-hidden="true"></i>' + esc(title.toUpperCase()) + '</h4>' +
        innerHtml +
      '</section>'
    );
  }

  function rmodalMetric(label, valueHtml) {
    return '<div class="pa-rmodal-metric"><dt>' + esc(label) + '</dt><dd>' + valueHtml + '</dd></div>';
  }

  function renderConditionDetails(c, windowDays) {
    return (
      '<dl class="pa-rmodal-metrics">' +
        rmodalMetric('Condition', esc(c.label)) +
        rmodalMetric('Risk', '<span class="status-badge ' + riskBadgeClass(c.risk) + '">' + esc(c.risk) + '</span>') +
        rmodalMetric('Previous period', esc(String(c.baselineCount))) +
        rmodalMetric('Confidence', '<span class="status-badge ' + confidenceBadgeClass(c.confidence) + '">' + esc(confidenceLabel(c.confidence)) + '</span>') +
        rmodalMetric('Trend', '<span class="pa-rmodal-trend"><i class="fa-solid ' + trendIcon(c.trend) + '" aria-hidden="true"></i> ' + esc(c.trend) + '</span>') +
        rmodalMetric('Recent cases', esc(String(c.recentCount))) +
        rmodalMetric('Analysis period', 'Last ' + esc(String(windowDays)) + ' Days') +
      '</dl>'
    );
  }

  function renderCaseComparison(c, diff) {
    var diffText = diff > 0
      ? ('Cases increased by ' + diff + ' compared with the previous period.')
      : (diff < 0
        ? ('Cases decreased by ' + Math.abs(diff) + ' compared with the previous period.')
        : 'Case count is unchanged compared with the previous period.');
    return (
      '<div class="pa-rmodal-compare">' +
        '<div class="pa-rmodal-compare-col">' +
          '<span class="pa-rmodal-compare-label">Previous period</span>' +
          '<span class="pa-rmodal-compare-value">' + esc(String(c.baselineCount)) + '</span>' +
          '<span class="pa-rmodal-compare-unit">' + (c.baselineCount === 1 ? 'case' : 'cases') + '</span>' +
        '</div>' +
        '<span class="pa-rmodal-compare-arrow" aria-hidden="true"><i class="fa-solid fa-arrow-right"></i></span>' +
        '<div class="pa-rmodal-compare-col">' +
          '<span class="pa-rmodal-compare-label">Recent period</span>' +
          '<span class="pa-rmodal-compare-value">' + esc(String(c.recentCount)) + '</span>' +
          '<span class="pa-rmodal-compare-unit">' + (c.recentCount === 1 ? 'case' : 'cases') + '</span>' +
        '</div>' +
        '<div class="pa-rmodal-compare-note"><i class="fa-solid fa-arrow-trend-up" aria-hidden="true"></i><span>' + esc(diffText) + '</span></div>' +
      '</div>'
    );
  }

  function renderEnvironmentalContext(c) {
    var lead = 'Current environmental conditions may provide supporting context, but Medical Records remain the primary evidence for disease-risk analysis.';
    if (state.weather.status !== 'ok') {
      return (
        '<div class="pa-rmodal-env pa-rmodal-env-nodata">' +
          '<i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>' +
          '<p class="pa-rmodal-text">Environmental data is currently unavailable, so no supporting weather context can be shown for this condition.</p>' +
        '</div>'
      );
    }
    if (c.weatherNote) {
      return (
        '<div class="pa-rmodal-env">' +
          '<p class="pa-rmodal-text">' + esc(lead) + '</p>' +
          '<p class="pa-rmodal-text pa-rmodal-env-note">' + esc(c.weatherNote) + '</p>' +
        '</div>'
      );
    }
    return (
      '<div class="pa-rmodal-env">' +
        '<p class="pa-rmodal-text">' + esc(lead) + ' No current environmental factor is linked to this condition.</p>' +
      '</div>'
    );
  }

  function renderDataLimitation(c) {
    var isLow = /^low/i.test(c.confidence || '');
    var text = isLow
      ? ('This estimate is based on a small historical sample (' + c.totalCount + ' total record' + (c.totalCount === 1 ? '' : 's') + '). More complete and consistent Medical Records are needed for stronger confidence.')
      : ('Confidence for this estimate is moderate, based on ' + c.totalCount + ' total record' + (c.totalCount === 1 ? '' : 's') + '. Continued recordkeeping will further improve reliability.');
    return (
      '<div class="pa-rmodal-limitation' + (isLow ? ' pa-rmodal-limitation-low' : '') + '">' +
        '<i class="fa-solid ' + (isLow ? 'fa-triangle-exclamation' : 'fa-circle-info') + '" aria-hidden="true"></i>' +
        '<p class="pa-rmodal-text">' + esc(text) + '</p>' +
      '</div>'
    );
  }

  // Same convention predictive-analytics.js / disease-risk.js already use.
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

  function confidenceLabel(conf) {
    if (/^moderate/i.test(conf || '')) return 'Moderate';
    if (/^low/i.test(conf || '')) return 'Low';
    return conf || 'Not available';
  }

  function confidenceBadgeClass(conf) {
    return /^moderate/i.test(conf || '') ? 'status-confirmed' : 'status-pending';
  }

  // ------------------------------------------------------------------
  // INSUFFICIENT_MEDICAL_HISTORY modal content (Phase 3B)
  // ------------------------------------------------------------------

  function buildInsufficientMedicalHistoryModal() {
    var P = PCData.Predictive;
    var disease = P.getDiseaseRiskAnalysis();
    // Weather never changes hasEnoughData/confidence (see
    // applyWeatherAdjustments in predictive-analytics-data-store.js), but
    // it's applied here too so this modal is reading the exact same
    // adjusted result object the rest of the page/renderAll() uses.
    var weatherFactors = state.weather.status === 'ok' ? P.getWeatherFactors(state.weather.data) : [];
    var adjusted = P.applyWeatherAdjustments(disease, weatherFactors);
    var categories = adjusted.categories || [];
    if (!categories.length) return null;

    var insufficientCats = categories.filter(function (c) { return !c.hasEnoughData; });
    var sufficientCats = categories.filter(function (c) { return c.hasEnoughData; });
    if (!insufficientCats.length) return null; // data changed since the row was drawn — nothing left to collect

    var hasAnyRecords = !!disease.hasAnyRecords;

    // "Overall confidence" isn't a field the engine returns directly — it
    // only rates confidence per category (Moderate confidence / Low
    // confidence (small sample)) for categories with enough data. Rather
    // than invent a new scoring algorithm, this takes the worst
    // already-computed per-category confidence as the overall picture,
    // and falls back to a plain "no rated categories yet" state when
    // nothing has enough data to be rated at all.
    var overall;
    if (!sufficientCats.length) {
      overall = { label: 'Insufficient', badgeClass: 'status-cancelled' };
    } else {
      var hasLow = sufficientCats.some(function (c) { return /^low/i.test(c.confidence || ''); });
      overall = hasLow ? { label: 'Low', badgeClass: 'status-pending' } : { label: 'Moderate', badgeClass: 'status-confirmed' };
    }

    var whyText = hasAnyRecords
      ? ('Several monitored condition categories currently have limited historical data (' +
          joinNames(insufficientCats.map(function (c) { return c.label; })) +
          '), which can reduce confidence in disease-risk estimates. Additional relevant Medical Records can help the system identify stronger patterns over time.')
      : ('No medical records have been added yet, so there is not enough historical data for a reliable disease-risk estimate. Additional relevant Medical Records can help the system identify stronger patterns over time.');

    var bodyHtml =
      rmodalSection('fa-circle-info', 'Why this was recommended', '<p class="pa-rmodal-text">' + esc(whyText) + '</p>') +
      rmodalSection('fa-list-check', 'Data needed', renderDataNeeded()) +
      rmodalSection('fa-chart-simple', 'Current data limitation', renderCurrentDataLimitation(insufficientCats.length, sufficientCats.length, overall)) +
      rmodalSection('fa-arrow-up-right-dots', 'What improves with more data', renderDataImprovementFlow()) +
      rmodalSection('fa-circle-check', 'Recommended action',
        '<div class="pa-rmodal-action"><i class="fa-solid fa-check" aria-hidden="true"></i><p class="pa-rmodal-text">Continue recording complete diagnoses, symptoms, treatments, medication usage, and follow-up information for relevant visits. Consistent records can improve future disease-risk and medicine-demand analysis.</p></div>') +
      rmodalSection('fa-clipboard-list', 'Recording checklist', renderRecordingChecklist());

    return {
      icon: 'fa-database',
      title: 'Collect additional medical history data',
      description: 'Improve future analysis confidence by recording more complete and consistent medical information.',
      bodyHtml: bodyHtml,
      viewHref: 'medical-records.html',
      viewLabel: 'View Medical Records'
    };
  }

  function renderDataNeeded() {
    var items = [
      { icon: 'fa-stethoscope', title: 'Diagnosis', text: 'Record the confirmed or working diagnosis for each visit.' },
      { icon: 'fa-comment-medical', title: 'Symptoms / Chief Complaint', text: 'Capture the main symptoms and reason for the visit.' },
      { icon: 'fa-pills', title: 'Treatment / Medication', text: 'Record medicines and treatments given during the visit.' },
      { icon: 'fa-calendar-check', title: 'Follow-up', text: 'Record relevant follow-up information and outcomes.' }
    ];
    return (
      '<p class="pa-rmodal-text pa-rmodal-hint">Key information to consistently record for each relevant visit.</p>' +
      '<ul class="pa-rmodal-checklist">' +
        items.map(function (i) {
          return (
            '<li class="pa-rmodal-checklist-item">' +
              '<span class="pa-rmodal-checklist-icon"><i class="fa-solid ' + i.icon + '" aria-hidden="true"></i></span>' +
              '<div>' +
                '<div class="pa-rmodal-checklist-title">' + esc(i.title) + '</div>' +
                '<div class="pa-rmodal-checklist-desc">' + esc(i.text) + '</div>' +
              '</div>' +
            '</li>'
          );
        }).join('') +
      '</ul>'
    );
  }

  function renderCurrentDataLimitation(insufficientCount, sufficientCount, overall) {
    return (
      '<dl class="pa-rmodal-metrics">' +
        rmodalMetric('Conditions with insufficient data', esc(String(insufficientCount))) +
        rmodalMetric('Conditions with enough data', esc(String(sufficientCount))) +
        rmodalMetric('Overall data confidence', '<span class="status-badge ' + overall.badgeClass + '">' + esc(overall.label) + '</span>') +
      '</dl>'
    );
  }

  function renderDataImprovementFlow() {
    var steps = ['More complete Medical Records', 'Stronger historical patterns', 'Better trend detection', 'Higher prediction confidence'];
    return (
      '<div class="pa-rmodal-flow">' +
        steps.map(function (s, i) {
          return (i > 0 ? '<span class="pa-rmodal-flow-arrow" aria-hidden="true"><i class="fa-solid fa-arrow-right"></i></span>' : '') +
            '<span class="pa-rmodal-flow-step">' + esc(s) + '</span>';
        }).join('') +
      '</div>' +
      '<p class="pa-rmodal-text pa-rmodal-flow-note">More consistent records improve pattern detection and trend comparison over time \u2014 this does not guarantee a specific confidence level.</p>'
    );
  }

  function renderRecordingChecklist() {
    var items = ['Diagnosis recorded', 'Symptoms recorded', 'Treatment recorded', 'Medication usage recorded', 'Follow-up recorded'];
    return (
      '<p class="pa-rmodal-text pa-rmodal-hint">Key information to include in each medical record.</p>' +
      '<ul class="pa-rmodal-recheck">' +
        items.map(function (t) {
          return '<li class="pa-rmodal-recheck-item"><i class="fa-solid fa-circle" aria-hidden="true"></i><span>' + esc(t) + '</span></li>';
        }).join('') +
      '</ul>'
    );
  }

  // ------------------------------------------------------------------
  // LOW_STOCK_MEDICINE modal content (Phase 3C)
  //
  // Same rule as the other builders: no second recommendation engine.
  // This re-reads PCData.Predictive.getMedicineDemandAnalysis() at the
  // moment the modal is opened, reuses the exact computeStockActions()
  // condition already used for the Current Recommendations row and the
  // Stock Actions panel, and only adds a read-only Unit Price lookup by
  // item id from PCData.getInventory() (the demand engine's item
  // contract doesn't carry price, the same way it doesn't carry
  // category — see the Medicine Demand Forecast table's own category
  // lookup in predictive-analytics.js for the same pattern).
  // ------------------------------------------------------------------

  // Same condition stockRowTitle() already uses to decide between
  // 'Review low-stock medicine' and 'Monitor high-demand medicine' — a
  // modal only exists for the former today, so a stock row made up only
  // of high-demand (non-low-stock) items stays non-clickable, matching
  // computeMonitorRowType()/computeDataRowType() above.
  function computeStockRowType(items) {
    return items.some(function (i) { return i.lowStock; }) ? 'LOW_STOCK_MEDICINE' : null;
  }

  function buildLowStockMedicineModal() {
    var P = PCData.Predictive;
    var medicine = P.getMedicineDemandAnalysis();
    var allItems = medicine.items || [];

    // Narrowed to just the low-stock/out-of-stock subset of the same
    // computeStockActions() result — that's what this specific
    // recommendation ("Review low-stock medicine") is about; the
    // high-demand-only items in that array belong to the other title.
    var lowStockItems = computeStockActions(medicine)
      .filter(function (i) { return i.lowStock; })
      .sort(function (a, b) {
        function score(i) { return Number(i.currentStock) === 0 ? 2 : 1; }
        return score(b) - score(a);
      });
    if (!lowStockItems.length) return null; // data changed since the row was drawn

    var disease = P.getDiseaseRiskAnalysis();

    var whyText = joinNames(lowStockItems.map(function (i) { return i.name; })) +
      (lowStockItems.length === 1 ? ' is' : ' are') +
      ' currently at low stock levels based on the clinic\u2019s inventory thresholds and observed demand patterns.';

    // Same isLowStock rule (quantity <= lowStockThreshold, which already
    // counts an out-of-stock item as low) applied across the full
    // evaluated medicine/vaccine item set — not just the recommendation
    // subset above — so these counts match the same current inventory
    // picture the Medicine Demand Forecast page shows, rather than a
    // newly re-derived threshold.
    var lowOnlyCount = allItems.filter(function (i) { return i.lowStock && Number(i.currentStock) !== 0; }).length;
    var outCount = allItems.filter(function (i) { return Number(i.currentStock) === 0; }).length;
    var affectedCount = allItems.filter(function (i) { return i.lowStock; }).length;

    var bodyHtml =
      rmodalSection('fa-circle-info', 'Why this was recommended',
        '<p class="pa-rmodal-text">' + esc(whyText) + '</p>') +
      rmodalSection('fa-box', 'Related medicines', renderRelatedMedicinesTable(lowStockItems)) +
      rmodalSection('fa-chart-simple', 'Current inventory context', renderInventoryContextMetrics(lowOnlyCount, outCount, affectedCount)) +
      rmodalSection('fa-circle-check', 'Recommended action',
        '<div class="pa-rmodal-action"><i class="fa-solid fa-check" aria-hidden="true"></i><p class="pa-rmodal-text">Review current stock levels and replenishment needs before demand increases. Inventory status should be reviewed alongside the latest medicine-demand analysis. This does not automatically place an order or change any stock quantity.</p></div>') +
      rmodalSection('fa-file-lines', 'Data context', renderStockDataContext(disease));

    return {
      icon: 'fa-box',
      title: 'Review low-stock medicine',
      description: 'Review medicines with current stock pressure and prepare for potential replenishment.',
      bodyHtml: bodyHtml,
      viewHref: 'inventory.html',
      viewLabel: 'View Inventory'
    };
  }

  function renderRelatedMedicinesTable(items) {
    if (!items.length) {
      return '<div class="pa-panel-empty">' + emptyState('No related medicines currently match this recommendation.') + '</div>';
    }
    var rows = items.map(function (i) {
      var status = stockStatus(i);
      var statusLabel = status === 'out' ? 'Out of Stock' : (status === 'low' ? 'Low Stock' : 'In Stock');
      var statusClass = status === 'out' ? 'status-cancelled' : (status === 'low' ? 'status-pending' : 'status-confirmed');
      // Unit price isn't part of the demand-engine's item contract, so
      // it's read read-only from the Inventory record by item id — same
      // pattern predictive-analytics.js already uses to look up Category
      // for the Medicine Demand Forecast table.
      var invItem = PCData.getInventoryById(i.id);
      var priceCell = (invItem && typeof invItem.unitPrice === 'number')
        ? esc(formatPrice(invItem.unitPrice))
        : '<span class="pa-panel-muted">Insufficient data</span>';
      return (
        '<tr>' +
          '<td class="pa-panel-name">' + esc(i.name) + '</td>' +
          '<td>' + esc(String(i.currentStock)) + (i.unit ? ' ' + esc(i.unit) : '') + '</td>' +
          '<td><span class="status-badge ' + statusClass + '">' + statusLabel + '</span></td>' +
          '<td>' + priceCell + '</td>' +
        '</tr>'
      );
    }).join('');
    return (
      '<div class="pa-panel-table-wrap"><table class="pa-panel-table">' +
        '<caption class="pa-sr-only">Related medicines</caption>' +
        '<thead><tr><th scope="col">Medicine</th><th scope="col">Current Stock</th><th scope="col">Stock Status</th><th scope="col">Unit Price</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table></div>'
    );
  }

  function renderInventoryContextMetrics(lowCount, outCount, affectedCount) {
    return (
      '<dl class="pa-rmodal-metrics">' +
        rmodalMetric('Low-stock medicines', esc(String(lowCount))) +
        rmodalMetric('Out-of-stock medicines', esc(String(outCount))) +
        rmodalMetric('Affected items', esc(String(affectedCount))) +
      '</dl>'
    );
  }

  // Mirrors the same hasAnyRecords check the disease-side modals already
  // use for their own data-limitation text, so this doesn't claim
  // stronger or weaker confidence than the engine actually supports.
  function renderStockDataContext(disease) {
    var hasRecords = !!(disease && disease.hasAnyRecords);
    var text = 'This recommendation uses current Inventory status' +
      (hasRecords
        ? ' and observed medicine-demand patterns from Medical Records.'
        : ', based on the available data.') +
      (hasRecords
        ? ''
        : ' Medical Records history is currently limited, which may reduce confidence in future medicine-demand signals.');
    return '<p class="pa-rmodal-text">' + esc(text) + '</p>';
  }

  // Same thousands-separated currency display inventory.js already uses
  // for Unit Price (e.g. \u20B12,350.75) — kept local here since
  // inventory.js does not expose it on PCData.
  function formatPrice(n) {
    var num = Number(n) || 0;
    return '\u20B1' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function renderPageHead() {
    return (
      '<div class="page-toolbar">' +
        '<div>' +
          '<h1 class="pa-page-title">RECOMMENDATIONS</h1>' +
        '</div>' +
      '</div>'
    );
  }

  function renderCurrentRecommendations(stockItems, monitorItems, dataItems) {
    var rows = [];
    if (stockItems.length) {
      rows.push({
        icon: 'fa-box',
        title: stockRowTitle(stockItems),
        desc: 'Check current stock levels and prepare for upcoming demand.',
        context: stockRowContext(stockItems),
        priority: 'High',
        // Only set when a detail modal actually exists for this row's
        // current content (same convention computeMonitorRowType() /
        // computeDataRowType() already established). A stock row made up
        // only of high-demand-but-not-low-stock items ("Monitor
        // high-demand medicine") has no modal yet and stays non-clickable.
        type: computeStockRowType(stockItems)
      });
    }
    if (monitorItems.length) {
      rows.push({
        icon: 'fa-arrow-trend-up',
        title: monitorRowTitle(monitorItems),
        desc: monitorRowDesc(monitorItems),
        context: monitorRowContext(monitorItems),
        priority: 'Medium',
        // Only set when a detail modal actually exists for this row's
        // current content (see REC_MODAL_BUILDERS / computeMonitorRowType
        // below). Stock Actions has no modal yet, so it intentionally
        // stays non-clickable.
        type: computeMonitorRowType(monitorItems)
      });
    }
    if (dataItems.length) {
      rows.push({
        icon: 'fa-file-lines',
        title: 'Collect additional medical history data',
        desc: 'Gather more complete patient history for better predictions.',
        context: dataRowContext(dataItems),
        priority: 'Low',
        type: computeDataRowType(dataItems)
      });
    }

    var body = rows.length
      ? '<div class="pa-cr-table-wrap"><table class="pa-cr-table">' +
          '<caption class="pa-sr-only">Current recommendations</caption>' +
          '<thead><tr><th scope="col">Action</th><th scope="col">Context</th><th scope="col">Priority</th></tr></thead>' +
          '<tbody>' + rows.map(renderCrRow).join('') + '</tbody>' +
        '</table></div>'
      : '<div class="pa-cr-empty">' + emptyState('INSUFFICIENT DATA \u2014 not enough data yet for a reliable recommendation.') + '</div>';

    return (
      '<section class="pa-cr" aria-labelledby="rec-current-heading">' +
        '<h2 class="pa-cr-heading" id="rec-current-heading">CURRENT RECOMMENDATIONS</h2>' +
        body +
      '</section>'
    );
  }

  function renderCrRow(r) {
    var clickable = !!r.type;
    return (
      '<tr' + (clickable ? ' class="pa-cr-row-active" data-rec-type="' + esc(r.type) + '" tabindex="-1"' : '') + '>' +
        '<td>' +
          '<div class="pa-cr-action">' +
            '<span class="pa-cr-icon"><i class="fa-solid ' + r.icon + '" aria-hidden="true"></i></span>' +
            '<div>' +
              '<div class="pa-cr-title">' + esc(r.title) + '</div>' +
              '<div class="pa-cr-action-desc">' + esc(r.desc) + '</div>' +
            '</div>' +
          '</div>' +
        '</td>' +
        '<td class="pa-cr-context">' + esc(r.context) + '</td>' +
        '<td class="pa-cr-priority-cell"><span class="status-badge ' + priorityBadgeClass(r.priority) + '">' + esc(r.priority) + '</span></td>' +
      '</tr>'
    );
  }

  function priorityBadgeClass(p) {
    if (p === 'High') return 'status-cancelled';
    if (p === 'Medium') return 'status-pending';
    return 'status-confirmed';
  }

  function renderStockPanel(items) {
    var body;
    if (!items.length) {
      body = '<div class="pa-panel-empty">' + emptyState('No medicines currently need a stock action.') + '</div>';
    } else {
      var rows = items.map(function (i) {
        var status = stockStatus(i);
        var statusLabel = status === 'out' ? 'Out of Stock' : (status === 'low' ? 'Low Stock' : 'In Stock');
        var statusClass = status === 'out' ? 'status-cancelled' : (status === 'low' ? 'status-pending' : 'status-confirmed');
        return (
          '<tr>' +
            '<td class="pa-panel-name">' + esc(i.name) + '</td>' +
            '<td>' + esc(String(i.currentStock)) + (i.unit ? ' ' + esc(i.unit) : '') + '</td>' +
            '<td><span class="status-badge ' + statusClass + '">' + statusLabel + '</span></td>' +
            '<td><span class="status-badge status-completed">' + esc(stockAction(i)) + '</span></td>' +
          '</tr>'
        );
      }).join('');
      body =
        '<div class="pa-panel-table-wrap"><table class="pa-panel-table">' +
          '<caption class="pa-sr-only">Stock actions</caption>' +
          '<thead><tr><th scope="col">Medicine</th><th scope="col">Current Stock</th><th scope="col">Stock Status</th><th scope="col">Action</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table></div>';
    }

    return (
      '<section class="pa-panel" aria-labelledby="rec-stock-heading">' +
        '<h3 class="pa-panel-heading" id="rec-stock-heading">STOCK ACTIONS</h3>' +
        body +
      '</section>'
    );
  }

  function renderMonitoringPanel(items) {
    var body;
    if (!items.length) {
      body = '<div class="pa-panel-empty">' + emptyState('No conditions currently need monitoring.') + '</div>';
    } else {
      var rows = items.map(function (c) {
        var reason = c.trend === 'Increasing'
          ? 'Increasing pattern (' + c.recentCount + ' vs ' + c.baselineCount + ')'
          : 'Elevated risk (' + c.recentCount + ' recent case' + (c.recentCount === 1 ? '' : 's') + ')';
        return (
          '<tr>' +
            '<td class="pa-panel-name">' + esc(c.label) + '</td>' +
            '<td class="pa-panel-reason">' + esc(reason) + '</td>' +
            '<td><span class="pa-panel-muted">Not yet defined</span></td>' +
          '</tr>'
        );
      }).join('');
      body =
        '<div class="pa-panel-table-wrap"><table class="pa-panel-table">' +
          '<caption class="pa-sr-only">Monitoring actions</caption>' +
          '<thead><tr><th scope="col">Item</th><th scope="col">Reason</th><th scope="col">Next Check</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table></div>';
    }

    return (
      '<section class="pa-panel" aria-labelledby="rec-monitor-heading">' +
        '<h3 class="pa-panel-heading" id="rec-monitor-heading">MONITORING ACTIONS</h3>' +
        body +
      '</section>'
    );
  }

  function renderDataPanel(items) {
    var body;
    if (!items.length) {
      body = '<div class="pa-panel-empty">' + emptyState('No additional data currently needed.') + '</div>';
    } else {
      var rows = items.map(function (c) {
        var dataType = c.key === 'none' ? 'Complete medical history' : c.label + ' case history';
        var priority = (c.totalCount || 0) === 0 ? 'Medium' : 'Low';
        return (
          '<tr>' +
            '<td class="pa-panel-name">' + esc(dataType) + '</td>' +
            '<td><span class="status-badge ' + priorityBadgeClass(priority) + '">' + priority + '</span></td>' +
            '<td><span class="status-badge status-completed">Pending</span></td>' +
          '</tr>'
        );
      }).join('');
      body =
        '<div class="pa-panel-table-wrap"><table class="pa-panel-table">' +
          '<caption class="pa-sr-only">Data collection</caption>' +
          '<thead><tr><th scope="col">Data Type</th><th scope="col">Priority</th><th scope="col">Status</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table></div>';
    }

    return (
      '<section class="pa-panel" aria-labelledby="rec-data-heading">' +
        '<h3 class="pa-panel-heading" id="rec-data-heading">DATA COLLECTION</h3>' +
        body +
      '</section>'
    );
  }

  function renderAnalysisNote() {
    return (
      '<div class="pa-note">' +
        '<i class="fa-solid fa-circle-info" aria-hidden="true"></i>' +
        '<div>' +
          '<p class="pa-note-title">ANALYSIS NOTE</p>' +
          '<p class="pa-note-text">Recommendations are based on observed historical patterns from Medical Records and current Inventory status. Environmental (weather) information is supporting context only, not proof of cause. These recommendations are not a veterinary diagnosis.</p>' +
        '</div>' +
      '</div>'
    );
  }

  // ------------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------------

  function emptyState(msg) {
    return '<div class="pa-empty">' + esc(msg) + '</div>';
  }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
})();