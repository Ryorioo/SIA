// ============================================================
// PAWSITIVE CARE — Weather & Health Factors page (Phase 2C)
// Renders into the #wh-root placeholder in weather-health.html.
//
// This is a dedicated, read-only-of-logic sub-page of Predictive
// Analytics. It does NOT introduce a second weather-fetching system:
// it calls the SAME Open-Meteo endpoint, with the SAME request
// parameters and the SAME response normalization, that
// predictive-analytics.js already uses (that fetch is page-scoped
// inside predictive-analytics.js's own closure and isn't attached to
// PCData, so it can't be imported — this file mirrors it instead of
// modifying that read-only file). All disease-pattern / trend /
// weather-factor CALCULATIONS still come from the single existing
// engine, PCData.Predictive (predictive-analytics-data-store.js) —
// nothing here recomputes risk, trend or confidence on its own.
//
// Honesty rules this file follows throughout (see PHASE 2C spec):
//   - No fake weather values, ever. Fetch failure -> explicit
//     "unavailable" state, never a stale/placeholder number.
//   - No fabricated historical weather series. PCData.Predictive has
//     no historical weather store, so Weather Trend shows an
//     insufficient-data state instead of a manufactured chart.
//   - No invented trend for raw weather metrics (temperature/
//     humidity/rainfall) — the engine only trends disease-category
//     case counts, not weather readings, so Environmental Factors'
//     "Current Pattern" column is always Insufficient Data.
//   - No invented confidence scoring for environmental factors — the
//     engine has no such algorithm, so Data Confidence reports all
//     monitored factors as Insufficient Data rather than guessing.
//   - Weather is only ever shown as supporting context, never as a
//     direct cause of a condition.
// ============================================================

(function () {
  'use strict';

  // Same Open-Meteo request predictive-analytics.js uses (same
  // placeholder Metro Manila coordinates — see that file's NOTE).
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

  // Current Conditions illustrations. One entry per display condition. `file`
  // is the exact filename inside assets/ (spaces and capitalization included),
  // resolved relative to weather-health.html. `label` is shown next to the
  // illustration.
  var WEATHER_IMAGE_DIR = 'assets/';
  var CONDITION_ART = {
    'sunny':         { label: 'Sunny',         file: 'sunny weather.png', icon: 'fa-sun' },
    'partly-cloudy': { label: 'Partly Cloudy', file: 'partly cloudy.png', icon: 'fa-cloud-sun' },
    'cloudy':        { label: 'Cloudy',        file: 'cloudy.png',        icon: 'fa-cloud' },
    'showers':       { label: 'Showers',       file: 'showers.png',       icon: 'fa-cloud-sun-rain' },
    'rain':          { label: 'Rain',          file: 'rain.png',          icon: 'fa-cloud-rain' },
    'heavy-rain':    { label: 'Heavy Rain',    file: 'heavy rain.png',    icon: 'fa-cloud-showers-heavy' },
    'thunderstorm':  { label: 'Thunderstorm',  file: 'thunderstorm.png',  icon: 'fa-cloud-bolt' }
  };

  // Safety net while the exact filenames are being confirmed: if `file` 404s,
  // the same name is retried with other common extensions and an UPPERCASE
  // name before the icon fallback is shown. The first URL that loads is
  // remembered per condition. Once every `file` above is confirmed correct
  // this can be deleted (artCandidates / resolvedArt) with no other changes.
  var WEATHER_IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp'];
  var resolvedArt = {};

  // Every URL to try for a condition, exact filename first. Names are
  // URL-encoded so spaces ("heavy rain.png") work.
  function artCandidates(file) {
    var dot = file.lastIndexOf('.');
    var base = file.slice(0, dot);
    var list = [file];
    function add(name, ext) {
      var f = name + '.' + ext;
      if (list.indexOf(f) === -1) list.push(f);
    }
    WEATHER_IMAGE_EXTS.forEach(function (e) { add(base, e); });
    [base, base.toUpperCase()].forEach(function (name) {
      WEATHER_IMAGE_EXTS.forEach(function (e) { add(name, e); add(name, e.toUpperCase()); });
    });
    return list.map(function (f) { return WEATHER_IMAGE_DIR + encodeURI(f); });
  }

  // Maps the WMO weather_code the page already fetches to a display condition.
  var WMO_TO_CONDITION = {
    0: 'sunny', 1: 'sunny', 2: 'partly-cloudy', 3: 'cloudy', 45: 'cloudy', 48: 'cloudy',
    51: 'showers', 53: 'showers', 55: 'showers', 56: 'showers', 57: 'showers', 80: 'showers',
    61: 'rain', 63: 'rain', 66: 'rain', 67: 'rain', 81: 'rain',
    65: 'heavy-rain', 82: 'heavy-rain',
    95: 'thunderstorm', 96: 'thunderstorm', 99: 'thunderstorm'
  };

  // Shown while weather is loading or unavailable, so the section is never
  // empty without a backend. Preview any condition by adding
  // ?condition=rain (any key above) to the page URL.
  var DEMO_CONDITION_KEY = 'partly-cloudy';

  // Matches the coordinates the existing weather request uses above; change it
  // together with WEATHER_LAT / WEATHER_LON when the real clinic location is set.
  var WEATHER_LOCATION_LABEL = 'Metro Manila, Philippines';

  // The three environmental factors the existing engine actually
  // reads from the weather payload (temperature/humidity/precipitation
  // in predictive-analytics-data-store.js's WEATHER_RULES). No factor
  // is added here that the engine doesn't already support.
  var ENV_FACTORS = [
    { key: 'humidity', label: 'Humidity', icon: 'fa-droplet' },
    { key: 'rainfall', label: 'Rainfall', icon: 'fa-cloud-rain' },
    { key: 'temperature', label: 'Temperature', icon: 'fa-temperature-half' }
  ];

  // Which of PCData.Predictive's WEATHER_RULES ids are relevant to
  // each environmental factor above, so real active rules (returned
  // by P.getWeatherFactors()) can be matched back to a factor row.
  var FACTOR_RULE_IDS = {
    humidity: ['humidity_rain'],
    rainfall: ['humidity_rain', 'rain'],
    temperature: ['heat', 'cold']
  };

  // Condition categories shown in Related Health Patterns / Weather &
  // Health Context — a fixed subset of PCData.Predictive's real
  // CONDITION_CATEGORIES (excludes Gastrointestinal and the Other
  // catch-all, which the reference screenshot's structure doesn't
  // include for this page), plus the FA icon used for each.
  var RELATED_CATEGORY_KEYS = ['respiratory', 'skin', 'parasitic'];
  var CATEGORY_ICONS = {
    respiratory: 'fa-lungs',
    skin: 'fa-hand-sparkles',
    parasitic: 'fa-bug'
  };

  var state = {
    weather: { status: 'loading', data: null, error: null } // loading | ok | error
  };

  document.addEventListener('DOMContentLoaded', function () {
    if (!window.PCData || !PCData.getMedicalRecords) {
      console.error('weather-health.js: PCData not fully loaded — make sure data-store.js, patient-data-store.js and medical-records-data-store.js load before this file.');
      showFatal('Weather & Health could not load: required data modules are missing.');
      return;
    }
    if (!PCData.Predictive) {
      console.error('weather-health.js: PCData.Predictive not found — make sure predictive-analytics-data-store.js loads before this file.');
      showFatal('Weather & Health could not load: its calculation module is missing.');
      return;
    }

    renderAll();
    fetchWeather();
    PCData.onChange(renderAll);
  });

  function showFatal(msg) {
    var root = document.getElementById('wh-root');
    if (root) root.innerHTML = '<div class="wh-empty">' + esc(msg) + '</div>';
  }

  // ------------------------------------------------------------------
  // weather fetch — mirrors predictive-analytics.js's fetchWeather()
  // exactly (same URL, same normalized shape), isolated the same way:
  // a failure here only affects this page's weather-dependent
  // sections, never the rest of the page.
  // ------------------------------------------------------------------
  function fetchWeather() {
    state.weather = { status: 'loading', data: null, error: null };
    renderAll();

    if (!window.fetch) {
      state.weather = { status: 'error', data: null, error: 'Weather requires a browser fetch API that is not available.' };
      renderAll();
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
      })
      .catch(function (err) {
        state.weather = { status: 'error', data: null, error: (err && err.message) || 'Weather is currently unavailable.' };
        renderAll();
      });
  }

  // ------------------------------------------------------------------
  // render
  // ------------------------------------------------------------------
  function renderAll() {
    var root = document.getElementById('wh-root');
    if (!root) return;

    var P = PCData.Predictive;
    var disease = P.getDiseaseRiskAnalysis();
    var weatherFactors = state.weather.status === 'ok' ? P.getWeatherFactors(state.weather.data) : [];

    root.innerHTML =
      renderHeader() +
      renderCurrentConditions(state.weather) +
      renderEnvironmentalFactors(state.weather, weatherFactors) +
      renderRelatedHealthPatterns(disease, weatherFactors) +
      renderContext(disease, weatherFactors) +
      renderWeatherTrend() +
      renderDataConfidence() +
      renderAnalysisNote();

    var art = root.querySelector('.wh-cc-art');
    var artImg = art && art.querySelector('img');
    if (artImg) {
      var artKey = art.getAttribute('data-art-key');
      var onArtError = function () {
        var list = artCandidates(CONDITION_ART[artKey].file);
        var next = list.indexOf(artImg.getAttribute('src')) + 1;
        if (next > 0 && next < list.length) {
          artImg.setAttribute('src', list[next]);
        } else {
          delete resolvedArt[artKey];
          art.classList.add('wh-cc-art-missing');
        }
      };
      artImg.addEventListener('load', function () { resolvedArt[artKey] = artImg.getAttribute('src'); });
      artImg.addEventListener('error', onArtError);
      if (artImg.complete && artImg.naturalWidth === 0) onArtError();
    }
  }

  function renderHeader() {
    return (
      '<div class="wh-page-header">' +
        '<h1 class="wh-page-title">WEATHER &amp; HEALTH</h1>' +
      '</div>'
    );
  }

  // ------------------------------------------------------------------
  // CURRENT CONDITIONS — main weather area (illustration + temperature,
  // condition, feels-like, location) and three supporting tiles (Humidity,
  // Chance of Rain, UV Index). getConditionsView() is the single place that
  // turns the weather payload into display values; any value the payload
  // doesn't carry shows as an em dash. To wire in a real API later, add
  // feelsLike (°C), precipProbability (%) and uvIndex to the payload where
  // fetchWeather() normalizes it; this UI does not need to change.
  // ------------------------------------------------------------------
  function conditionKeyFromCode(code) {
    return typeof code === 'number' && WMO_TO_CONDITION[code] ? WMO_TO_CONDITION[code] : null;
  }

  function demoConditionOverride() {
    try {
      var q = new URLSearchParams(window.location.search).get('condition');
      return q && CONDITION_ART[q] ? q : null;
    } catch (e) { return null; }
  }

  function fmtMetric(value, unit) {
    return typeof value === 'number' && isFinite(value) ? Math.round(value) + unit : '\u2014';
  }

  function getConditionsView(d) {
    d = d || {};
    var key = demoConditionOverride() || conditionKeyFromCode(d.weatherCode) ||
      (typeof d.weatherCode === 'number' ? 'cloudy' : DEMO_CONDITION_KEY);
    var art = CONDITION_ART[key];
    return {
      key: key,
      image: resolvedArt[key] || artCandidates(art.file)[0],
      icon: art.icon,
      condition: art.label,
      location: WEATHER_LOCATION_LABEL,
      temperature: fmtMetric(d.temperature, '\u00B0C'),
      feelsLike: fmtMetric(d.feelsLike, '\u00B0C'),
      humidity: fmtMetric(d.humidity, '%'),
      chanceOfRain: fmtMetric(d.precipProbability, '%'),
      uvIndex: typeof d.uvIndex === 'number' && isFinite(d.uvIndex) ? String(Math.round(d.uvIndex * 10) / 10) : '\u2014'
    };
  }

  function renderCurrentConditions(weather) {
    var c = getConditionsView(weather.status === 'ok' ? weather.data : null);

    var body =
      '<div class="wh-cc">' +
        '<div class="wh-cc-main">' +
          '<div class="wh-cc-art" data-art-key="' + esc(c.key) + '">' +
            '<img src="' + esc(c.image) + '" alt="' + esc(c.condition) + ' weather illustration">' +
            '<div class="wh-cc-art-fallback" aria-hidden="true"><i class="fa-solid ' + esc(c.icon) + '"></i></div>' +
          '</div>' +
          '<div class="wh-cc-info">' +
            '<div class="wh-cc-location"><i class="fa-solid fa-location-dot" aria-hidden="true"></i><span>' + esc(c.location) + '</span></div>' +
            '<div class="wh-cc-temp">' + esc(c.temperature) + '</div>' +
            '<div class="wh-cc-condition">' + esc(c.condition) + '</div>' +
            '<div class="wh-cc-feels">Feels like <strong>' + esc(c.feelsLike) + '</strong></div>' +
          '</div>' +
        '</div>' +
        '<div class="wh-cc-tiles">' +
          metricTile('fa-droplet', 'Humidity', c.humidity) +
          metricTile('fa-umbrella', 'Chance of Rain', c.chanceOfRain) +
          metricTile('fa-sun', 'UV Index', c.uvIndex) +
        '</div>' +
      '</div>';

    return (
      '<section class="wh-section" aria-labelledby="wh-conditions-heading">' +
        '<h2 class="wh-h2" id="wh-conditions-heading">CURRENT CONDITIONS</h2>' +
        body +
      '</section>'
    );
  }

  function metricTile(icon, label, value) {
    return (
      '<div class="wh-cc-tile">' +
        '<div class="wh-cc-tile-icon"><i class="fa-solid ' + icon + '" aria-hidden="true"></i></div>' +
        '<div class="wh-cc-tile-body">' +
          '<div class="wh-cc-tile-label">' + esc(label) + '</div>' +
          '<div class="wh-cc-tile-value">' + esc(value) + '</div>' +
        '</div>' +
      '</div>'
    );
  }

  // ------------------------------------------------------------------
  // ENVIRONMENTAL FACTORS — table of the three factors the engine
  // actually reads. "Current Pattern" is always Insufficient Data: the
  // engine (predictive-analytics-data-store.js) has no trend
  // calculation for raw weather readings, only for disease-category
  // case counts, so a Increasing/Stable/Decreasing value here would be
  // invented. "Health Relevance" reflects whichever real WEATHER_RULES
  // are currently active for that factor (via P.getWeatherFactors()),
  // phrased cautiously, or an honest "no relevance detected" line when
  // none are active right now.
  // ------------------------------------------------------------------
  function renderEnvironmentalFactors(weather, weatherFactors) {
    var body;
    if (weather.status !== 'ok') {
      body = '<div class="wh-empty">Weather data unavailable, so environmental factors can\u2019t be assessed right now.</div>';
    } else {
      var rows = ENV_FACTORS.map(function (f) {
        return (
          '<tr>' +
            '<td><span class="wh-factor-name"><i class="fa-solid ' + esc(f.icon) + '" aria-hidden="true"></i>' + esc(f.label) + '</span></td>' +
            '<td><span class="status-badge wh-badge-nodata">Insufficient Data</span></td>' +
            '<td><span class="wh-relevance-text">' + esc(healthRelevanceFor(f.key, weatherFactors)) + '</span></td>' +
          '</tr>'
        );
      }).join('');

      body =
        '<div class="wh-table-wrap">' +
          '<table class="wh-table">' +
            '<caption class="wh-sr-only">Environmental factors and their potential health relevance</caption>' +
            '<thead><tr>' +
              '<th scope="col">Factor</th>' +
              '<th scope="col">Current Pattern</th>' +
              '<th scope="col">Health Relevance</th>' +
            '</tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>';
    }

    return (
      '<section class="wh-section wh-half" aria-labelledby="wh-ef-heading">' +
        '<h2 class="wh-h2" id="wh-ef-heading">ENVIRONMENTAL FACTORS</h2>' +
        body +
      '</section>'
    );
  }

  function healthRelevanceFor(factorKey, weatherFactors) {
    var ruleIds = FACTOR_RULE_IDS[factorKey] || [];
    var active = (weatherFactors || []).filter(function (f) { return ruleIds.indexOf(f.id) !== -1; });

    if (!active.length) {
      if (factorKey === 'temperature') return 'No strong temperature-related adjustment detected right now.';
      if (factorKey === 'humidity') return 'No significant humidity-related relevance detected right now.';
      return 'No significant rainfall-related relevance detected right now.';
    }

    var affectsSet = {};
    active.forEach(function (f) { (f.affects || []).forEach(function (a) { affectsSet[a] = true; }); });
    var affectsLabels = Object.keys(affectsSet).map(categoryLabel).filter(Boolean).map(function (s) { return s.toLowerCase(); });

    if (affectsLabels.length) {
      return 'May support conditions associated with ' + joinNatural(affectsLabels) + ' patterns.';
    }
    // A rule can be active with no `affects` categories (e.g. the heat
    // rule) — still real and current, just not tied to a specific
    // disease-category bucket, so it's surfaced without inventing one.
    return 'Potential environmental relevance to overall animal comfort and health under current conditions.';
  }

  function categoryLabel(key) {
    var cats = (PCData.Predictive.CONDITION_CATEGORIES || []);
    for (var i = 0; i < cats.length; i++) {
      if (cats[i].key === key) return cats[i].label;
    }
    return null;
  }

  function joinNatural(arr) {
    if (arr.length <= 1) return arr[0] || '';
    if (arr.length === 2) return arr[0] + ' or ' + arr[1];
    return arr.slice(0, -1).join(', ') + ', or ' + arr[arr.length - 1];
  }

  // ------------------------------------------------------------------
  // RELATED HEALTH PATTERNS — ties the real disease-risk analysis
  // (PCData.Predictive.getDiseaseRiskAnalysis, the SAME object the
  // Overview's Current Risk Snapshot uses) to whichever weather
  // factors are currently active for that category. Always phrased as
  // a possible relationship/supporting context, never a diagnosis.
  // ------------------------------------------------------------------
  function renderRelatedHealthPatterns(disease, weatherFactors) {
    var catsByKey = {};
    (disease.categories || []).forEach(function (c) { catsByKey[c.key] = c; });

    var rows = RELATED_CATEGORY_KEYS.map(function (key) {
      var cat = catsByKey[key];
      var label = categoryLabel(key) || key;
      var active = (weatherFactors || []).filter(function (f) { return (f.affects || []).indexOf(key) !== -1; });
      var factorLabel = active.length ? uniqueFactorLabels(active).join(' & ') : 'No active factor';

      var observed;
      if (!cat || !cat.hasEnoughData) {
        observed = '<span class="status-badge wh-badge-nodata">Insufficient Data</span>';
      } else {
        observed = esc(cat.trend + ' ' + label.toLowerCase() + ' cases');
      }

      var relationship = relationshipText(cat, active.length > 0);

      return (
        '<li class="wh-pattern-row">' +
          '<div class="wh-pattern-cat">' +
            '<div class="wh-pattern-icon"><i class="fa-solid ' + esc(CATEGORY_ICONS[key] || 'fa-notes-medical') + '" aria-hidden="true"></i></div>' +
            '<div>' +
              '<div class="wh-pattern-name">' + esc(label.toUpperCase()) + '</div>' +
              '<div class="wh-pattern-sublabel">Possible environmental relevance</div>' +
            '</div>' +
          '</div>' +
          '<dl class="wh-pattern-fields">' +
            '<div class="wh-pattern-field"><dt>Observed condition</dt><dd>' + observed + '</dd></div>' +
            '<div class="wh-pattern-field"><dt>Environmental factor</dt><dd>' + esc(factorLabel) + '</dd></div>' +
            '<div class="wh-pattern-field"><dt>Relationship</dt><dd>' + esc(relationship) + '</dd></div>' +
          '</dl>' +
        '</li>'
      );
    }).join('');

    return (
      '<section class="wh-section wh-half" aria-labelledby="wh-rhp-heading">' +
        '<h2 class="wh-h2" id="wh-rhp-heading">RELATED HEALTH PATTERNS</h2>' +
        '<ul class="wh-patterns-list">' + rows + '</ul>' +
      '</section>'
    );
  }

  function uniqueFactorLabels(activeFactors) {
    var FACTOR_LABEL_BY_RULE = { heat: 'Temperature', humidity_rain: 'Humidity & Rainfall', rain: 'Rainfall', cold: 'Temperature' };
    var seen = {};
    var out = [];
    activeFactors.forEach(function (f) {
      var lbl = FACTOR_LABEL_BY_RULE[f.id];
      if (lbl && !seen[lbl]) { seen[lbl] = true; out.push(lbl); }
    });
    return out;
  }

  function relationshipText(cat, hasActiveFactor) {
    if (!hasActiveFactor) return 'No active environmental factor currently linked to this pattern.';
    if (!cat || !cat.hasEnoughData) return 'Possible environmental relevance, but medical record history isn\u2019t sufficient yet to confirm an observed pattern.';
    if (cat.trend === 'Increasing') return 'May contribute to the observed increasing pattern. Medical history remains the primary evidence.';
    return 'Possible environmental relevance to this pattern. Medical history remains the primary evidence.';
  }

  // ------------------------------------------------------------------
  // WEATHER & HEALTH CONTEXT — Environmental Factor -> Observed Health
  // Pattern -> Prediction Context, one row per related category that
  // currently has an active weather factor. Prediction Context is
  // always labeled "Supporting Context" (never Diagnosis/Confirmed
  // Cause/Primary Evidence), per the critical weather rule.
  // ------------------------------------------------------------------
  function renderContext(disease, weatherFactors) {
    var catsByKey = {};
    (disease.categories || []).forEach(function (c) { catsByKey[c.key] = c; });

    var rows = [];
    RELATED_CATEGORY_KEYS.forEach(function (key) {
      var active = (weatherFactors || []).filter(function (f) { return (f.affects || []).indexOf(key) !== -1; });
      if (!active.length) return; // only real, currently-active relationships are shown
      var factorLabel = uniqueFactorLabels(active).join(' & ');
      var cat = catsByKey[key];
      var label = categoryLabel(key) || key;
      var patternText = (cat && cat.hasEnoughData) ? (cat.trend + ' ' + label) : 'Insufficient Data';

      rows.push(
        '<li class="wh-ctx-row">' +
          '<div class="wh-ctx-cell"><span class="wh-ctx-cell-label">Environmental Factor</span><span class="wh-ctx-cell-value">' + esc(factorLabel) + '</span></div>' +
          '<div class="wh-ctx-cell"><span class="wh-ctx-cell-label">Observed Health Pattern</span><span class="wh-ctx-cell-value">' + esc(patternText) + '</span></div>' +
          '<div class="wh-ctx-cell"><span class="wh-ctx-cell-label">Prediction Context</span><span class="wh-ctx-badge">Supporting Context</span></div>' +
        '</li>'
      );
    });

    var body;
    if (state.weather.status !== 'ok') {
      body = '<div class="wh-empty">Weather data unavailable, so no environmental relationships can be shown right now.</div>';
    } else if (!rows.length) {
      body = '<div class="wh-empty">No active environmental-to-health relationships detected under current conditions.</div>';
    } else {
      body = '<ul class="wh-ctx-list">' + rows.join('') + '</ul>';
    }

    return (
      '<section class="wh-section wh-half" aria-labelledby="wh-ctx-heading">' +
        '<h2 class="wh-h2" id="wh-ctx-heading">WEATHER &amp; HEALTH CONTEXT</h2>' +
        body +
      '</section>'
    );
  }

  // ------------------------------------------------------------------
  // WEATHER TREND — PCData.Predictive has no historical weather store
  // (only the current Open-Meteo reading is ever fetched), so this is
  // an honest insufficient-data state rather than a fabricated 7-day
  // series. See predictive-analytics-data-store.js.
  // ------------------------------------------------------------------
  function renderWeatherTrend() {
    return (
      '<section class="wh-section wh-half" aria-labelledby="wh-trend-heading">' +
        '<h2 class="wh-h2" id="wh-trend-heading">WEATHER TREND</h2>' +
        '<div class="wh-trend-empty">' +
          '<div class="wh-trend-empty-icon"><i class="fa-solid fa-chart-line" aria-hidden="true"></i></div>' +
          '<p class="wh-trend-empty-text">Historical weather data isn\u2019t currently stored, so a trend can\u2019t be shown yet. Only the current reading (see Current Conditions above) is available today.</p>' +
        '</div>' +
      '</section>'
    );
  }

  // ------------------------------------------------------------------
  // DATA CONFIDENCE — the engine has no confidence-scoring algorithm
  // for environmental factors (its confidence field only exists for
  // disease categories, based on total medical-record count), so
  // every monitored environmental factor is honestly reported as
  // Insufficient Data rather than a guessed High/Medium/Low score.
  // ------------------------------------------------------------------
  function renderDataConfidence() {
    var total = ENV_FACTORS.length;
    return (
      '<section class="wh-section" aria-labelledby="wh-conf-heading">' +
        '<h2 class="wh-h2" id="wh-conf-heading">DATA CONFIDENCE</h2>' +
        '<div class="wh-confidence-grid">' +
          confidenceCard('wh-dot-high', 'HIGH CONFIDENCE', 0) +
          confidenceCard('wh-dot-medium', 'MEDIUM CONFIDENCE', 0) +
          confidenceCard('wh-dot-low', 'LOW CONFIDENCE', 0) +
          confidenceCard('wh-dot-insufficient', 'INSUFFICIENT DATA', total) +
        '</div>' +
        '<p class="wh-confidence-note">A confidence-scoring model for environmental factors hasn\u2019t been implemented yet, so all monitored factors are reported as Insufficient Data rather than an estimated score.</p>' +
      '</section>'
    );
  }

  function confidenceCard(dotClass, label, count) {
    return (
      '<div class="wh-confidence-card">' +
        '<div class="wh-confidence-top"><span class="wh-confidence-dot ' + dotClass + '"></span><span class="wh-confidence-label">' + esc(label) + '</span></div>' +
        '<div class="wh-confidence-count">' + esc(String(count)) + '</div>' +
        '<div class="wh-confidence-unit">' + (count === 1 ? 'Factor' : 'Factors') + '</div>' +
      '</div>'
    );
  }

  function renderAnalysisNote() {
    return (
      '<div class="wh-note">' +
        '<div class="wh-note-icon"><i class="fa-solid fa-circle-info" aria-hidden="true"></i></div>' +
        '<div>' +
          '<div class="wh-note-title">Analysis Note</div>' +
          '<p class="wh-note-text">Environmental conditions may contribute to observed veterinary health patterns, but weather alone does not establish disease risk or diagnosis.</p>' +
        '</div>' +
      '</div>'
    );
  }

  // ------------------------------------------------------------------
  // shared small helpers
  // ------------------------------------------------------------------
  function weatherLabel(code) {
    return WMO_LABELS[code] || 'Unknown conditions';
  }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
})();