// ============================================================
// PAWSITIVE CARE — Predictive Analytics data store
//
// This file does NOT own a persisted collection the way
// patient-data-store.js / medical-records-data-store.js do — there is
// no new localStorage key here, and it never duplicates Patients,
// Medical Records, or Inventory data. It reads those through the
// existing PCData functions (PCData.getMedicalRecords(),
// PCData.getInventory(), PCData.isLowStock(), PCData.isExpired(),
// PCData.todayStr()/dateStr(), etc.) and contains ONLY:
//
//   - Predictive Analytics-specific configuration (keyword rules used
//     to bucket a medical record into a condition category, the
//     recent/baseline time windows, minimum-sample thresholds, and
//     the weather -> health-factor rules)
//   - Predictive Analytics-specific calculation helpers (rule-based
//     disease-risk, medicine-demand, weather-factor, and
//     recommendation logic)
//
// Every number produced here is a RULE-BASED ESTIMATE derived from
// whatever real records already exist — never a medical diagnosis,
// and never fabricated history. Categories/items without enough real
// records say so explicitly instead of guessing.
//
// LOAD ORDER: must load after data-store.js, patient-data-store.js,
// and medical-records-data-store.js (it reads PCData.getMedicalRecords
// and PCData.getInventory, both attached by those files), and before
// predictive-analytics.js. Attaches onto the SAME window.PCData object
// as PCData.Predictive, following the same "attach, don't replace"
// pattern already used across this codebase — guarded below so a
// misordered <script> tag can't throw.
// ============================================================

(function (global) {
  var PCData = global.PCData;
  if (!PCData) {
    // data-store.js must load before this file.
    return;
  }

  // ------------------------------------------------------------------
  // configuration
  // ------------------------------------------------------------------

  // How far back "recent" looks, and the length of the prior comparison
  // window used to call a trend Increasing / Decreasing / Stable.
  var RECENT_WINDOW_DAYS = 30;
  var BASELINE_WINDOW_DAYS = 30;

  // A category/item needs at least this many total records (recent +
  // baseline combined) before we're willing to say anything about it
  // at all — below this, real data exists but there simply isn't
  // enough of it yet for a trustworthy signal.
  var MIN_CASES_FOR_SIGNAL = 2;

  // Recent-case count at/above this is called HIGH risk / HIGH demand.
  var HIGH_RISK_CASE_COUNT = 3;
  var HIGH_DEMAND_MENTION_COUNT = 3;

  // Keyword rules used to bucket a medical record into a disease
  // category. Matched (case-insensitive, substring) against the
  // record's diagnosis + symptoms + chiefComplaint + visitType text.
  // Checked in this order; first match wins.
  var CONDITION_CATEGORIES = [
    {
      key: 'respiratory',
      label: 'Respiratory',
      keywords: ['respiratory', 'cough', 'wheeze', 'wheezing', 'breathing', 'nasal', 'sneeze', 'pneumonia', 'kennel cough', 'wing check']
    },
    {
      key: 'gastrointestinal',
      label: 'Gastrointestinal',
      keywords: ['vomit', 'diarrhea', 'gastritis', 'gastrointestinal', 'stomach', 'appetite', 'nausea', 'bland diet']
    },
    {
      key: 'skin',
      label: 'Skin & Allergy',
      keywords: ['skin', 'dermatitis', 'allerg', 'itch', 'rash', 'hair loss', 'shampoo']
    },
    {
      key: 'parasitic',
      label: 'Parasitic',
      keywords: ['flea', 'tick', 'worm', 'deworm', 'parasite', 'mite', 'mange']
    }
  ];
  // Catch-all bucket for records with a real, non-trivial diagnosis
  // that doesn't match any keyword rule above — kept separate from the
  // named categories so it never masks a specific pattern.
  var OTHER_CATEGORY = { key: 'other', label: 'Other Recurring Conditions' };

  // Rule-based weather -> health-factor mapping. Each rule only fires
  // when its `test` matches the fetched weather; `affects` lists which
  // disease-category keys it's allowed to nudge (see
  // applyWeatherAdjustments). These are stated as contributing factors,
  // never as a claimed cause.
  var WEATHER_RULES = [
    {
      id: 'heat',
      affects: [],
      test: function (w) { return w && typeof w.temperature === 'number' && w.temperature >= 33; },
      text: function (w) {
        return 'High temperature (' + w.temperature.toFixed(1) + '\u00B0C) raises the risk of heatstroke and dehydration, especially for brachycephalic, senior, or outdoor pets \u2014 consider advising clients to limit exercise during peak heat.';
      }
    },
    {
      id: 'humidity_rain',
      affects: ['skin', 'respiratory'],
      test: function (w) { return w && typeof w.humidity === 'number' && w.humidity >= 80 && (w.precipitation || 0) > 0; },
      text: function (w) {
        return 'High humidity (' + Math.round(w.humidity) + '%) combined with rain can favor skin irritation and lower general resistance \u2014 worth keeping an extra eye on skin and respiratory cases.';
      }
    },
    {
      id: 'rain',
      affects: ['parasitic'],
      test: function (w) { return w && (w.precipitation || 0) > 0; },
      text: function () {
        return 'Rainy conditions can increase flea/tick exposure and slip-related injuries \u2014 remind owners to dry paws and coats after walks.';
      }
    },
    {
      id: 'cold',
      affects: ['respiratory'],
      test: function (w) { return w && typeof w.temperature === 'number' && w.temperature <= 18; },
      text: function (w) {
        return 'Cooler temperatures (' + w.temperature.toFixed(1) + '\u00B0C) can be harder on very young, senior, or short-coated pets \u2014 monitor for respiratory symptoms.';
      }
    }
  ];

  // ------------------------------------------------------------------
  // date-window helpers (string-compare safe since PCData dates are
  // always 'YYYY-MM-DD')
  // ------------------------------------------------------------------

  function windows() {
    var today = PCData.todayStr();
    var recentStart = PCData.dateStr(-RECENT_WINDOW_DAYS);
    var baselineStart = PCData.dateStr(-(RECENT_WINDOW_DAYS + BASELINE_WINDOW_DAYS));
    var baselineEnd = PCData.dateStr(-RECENT_WINDOW_DAYS - 1);
    return { today: today, recentStart: recentStart, baselineStart: baselineStart, baselineEnd: baselineEnd };
  }

  function inRecentWindow(dateIso, w) {
    return !!dateIso && dateIso >= w.recentStart && dateIso <= w.today;
  }

  function inBaselineWindow(dateIso, w) {
    return !!dateIso && dateIso >= w.baselineStart && dateIso <= w.baselineEnd;
  }

  function computeTrend(recentCount, baselineCount) {
    if (recentCount === baselineCount) return 'Stable';
    if (baselineCount === 0 && recentCount > 0) return 'Increasing';
    return recentCount > baselineCount ? 'Increasing' : 'Decreasing';
  }

  // ------------------------------------------------------------------
  // 1) DISEASE RISK ANALYSIS — reads PCData.getMedicalRecords() only.
  // ------------------------------------------------------------------

  function classifyRecord(r) {
    var hay = [r.diagnosis, r.symptoms, r.chiefComplaint, r.visitType].join(' ').toLowerCase();
    for (var i = 0; i < CONDITION_CATEGORIES.length; i++) {
      var cat = CONDITION_CATEGORIES[i];
      for (var j = 0; j < cat.keywords.length; j++) {
        if (hay.indexOf(cat.keywords[j]) !== -1) return cat.key;
      }
    }
    var diag = (r.diagnosis || '').trim().toLowerCase();
    if (diag && diag !== 'none' && diag !== 'healthy') return OTHER_CATEGORY.key;
    return null;
  }

  function getDiseaseRiskAnalysis() {
    var records = PCData.getMedicalRecords();
    var w = windows();
    var allCats = CONDITION_CATEGORIES.concat([OTHER_CATEGORY]);

    var buckets = {};
    allCats.forEach(function (c) { buckets[c.key] = { recent: 0, baseline: 0, total: 0 }; });

    records.forEach(function (r) {
      var key = classifyRecord(r);
      if (!key || !buckets[key]) return;
      buckets[key].total++;
      if (inRecentWindow(r.date, w)) buckets[key].recent++;
      else if (inBaselineWindow(r.date, w)) buckets[key].baseline++;
    });

    var categories = allCats.map(function (c) {
      var b = buckets[c.key];

      if (b.total < MIN_CASES_FOR_SIGNAL) {
        return {
          key: c.key,
          label: c.label,
          hasEnoughData: false,
          recentCount: b.recent,
          totalCount: b.total,
          message: 'Not enough historical data yet.'
        };
      }

      var trend = computeTrend(b.recent, b.baseline);
      var risk = b.recent >= HIGH_RISK_CASE_COUNT ? 'HIGH' : (b.recent >= 1 ? 'MODERATE' : 'LOW');

      var reason = b.recent > 0
        ? 'Recent ' + c.label.toLowerCase() + ' cases: ' + b.recent + ' in the last ' + RECENT_WINDOW_DAYS + ' days, vs. ' + b.baseline + ' in the prior ' + BASELINE_WINDOW_DAYS + ' days (' + trend.toLowerCase() + ').'
        : 'No ' + c.label.toLowerCase() + ' cases in the last ' + RECENT_WINDOW_DAYS + ' days (' + b.total + ' recorded historically).';

      return {
        key: c.key,
        label: c.label,
        hasEnoughData: true,
        recentCount: b.recent,
        baselineCount: b.baseline,
        totalCount: b.total,
        trend: trend,
        risk: risk,
        reason: reason,
        confidence: b.total >= 8 ? 'Moderate confidence' : 'Low confidence (small sample)'
      };
    });

    return {
      generatedAt: Date.now(),
      windowDays: RECENT_WINDOW_DAYS,
      hasAnyRecords: records.length > 0,
      categories: categories
    };
  }

  // ------------------------------------------------------------------
  // 2) MEDICINE DEMAND ANALYSIS — reads PCData.getInventory() for
  // stock, and PCData.getMedicalRecords() for real mentions of that
  // item's name in prescription/vaccination/treatment text. No usage
  // numbers are invented: an item with zero mentions is reported as
  // having insufficient historical data, not a guessed demand level.
  // ------------------------------------------------------------------

  function coreName(name) {
    // Loosen an inventory name like "Amoxicillin 500mg" or
    // "Feline Vaccine (FVRCP)" toward the word a vet is more likely to
    // actually type in a free-text field, so real mentions aren't
    // missed over packaging/dosage details.
    return (name || '')
      .split('(')[0]
      .replace(/\d+\s?(mg|ml|g|kg)\b/gi, '')
      .trim()
      .toLowerCase();
  }

  function recordMentionsItem(record, item) {
    var hay = [record.prescription, record.vaccination, record.treatment].join(' ').toLowerCase();
    if (!hay.trim()) return false;
    var full = (item.name || '').toLowerCase();
    var core = coreName(item.name);
    return (!!full && hay.indexOf(full) !== -1) || (!!core && hay.indexOf(core) !== -1);
  }

  function getMedicineDemandAnalysis() {
    var inventory = PCData.getInventory().filter(function (i) {
      return i.status === 'active' && (i.category === 'Medicine' || i.category === 'Vaccine');
    });
    var records = PCData.getMedicalRecords();
    var w = windows();

    var items = inventory.map(function (item) {
      var recent = 0, baseline = 0, total = 0;
      records.forEach(function (r) {
        if (!recordMentionsItem(r, item)) return;
        total++;
        if (inRecentWindow(r.date, w)) recent++;
        else if (inBaselineWindow(r.date, w)) baseline++;
      });

      var lowStock = PCData.isLowStock(item);
      var expired = PCData.isExpired(item);

      if (total === 0) {
        return {
          id: item.id,
          name: item.name,
          currentStock: item.quantity,
          unit: item.unit,
          hasEnoughData: false,
          lowStock: lowStock,
          expired: expired,
          message: 'Insufficient historical data.',
          recommendation: lowStock
            ? 'No recorded usage history yet, but stock is at or below the low-stock threshold \u2014 consider restocking.'
            : 'Inventory stock appears sufficient.'
        };
      }

      var trend = computeTrend(recent, baseline);
      var demand = recent >= HIGH_DEMAND_MENTION_COUNT ? 'HIGH' : (recent >= 1 ? 'MODERATE' : 'LOW');

      var recommendation;
      if (demand === 'HIGH' && lowStock) {
        recommendation = 'Consider restocking soon \u2014 recent demand is high and stock is low.';
      } else if (demand === 'HIGH') {
        recommendation = 'Demand is high; monitor stock levels closely.';
      } else if (lowStock) {
        recommendation = 'Stock is at or below the low-stock threshold \u2014 consider restocking.';
      } else {
        recommendation = 'Inventory stock appears sufficient.';
      }
      if (expired) recommendation += ' Note: current stock includes an expired batch \u2014 review before use.';

      return {
        id: item.id,
        name: item.name,
        currentStock: item.quantity,
        unit: item.unit,
        hasEnoughData: true,
        recentMentions: recent,
        baselineMentions: baseline,
        totalMentions: total,
        trend: trend,
        demand: demand,
        lowStock: lowStock,
        expired: expired,
        reason: 'Referenced in ' + recent + ' medical record(s) in the last ' + RECENT_WINDOW_DAYS + ' days, vs. ' + baseline + ' in the prior ' + BASELINE_WINDOW_DAYS + ' days.',
        recommendation: recommendation
      };
    });

    return {
      generatedAt: Date.now(),
      windowDays: RECENT_WINDOW_DAYS,
      hasInventory: inventory.length > 0,
      items: items
    };
  }

  // ------------------------------------------------------------------
  // 3) WEATHER FACTORS — pure function of whatever weather payload
  // predictive-analytics.js fetched; this file has no network code of
  // its own so the calculation logic stays testable/offline.
  // ------------------------------------------------------------------

  function getWeatherFactors(weather) {
    if (!weather) return [];
    var out = [];
    WEATHER_RULES.forEach(function (rule) {
      if (rule.test(weather)) out.push({ id: rule.id, text: rule.text(weather), affects: rule.affects || [] });
    });
    return out;
  }

  // Non-destructive: returns a NEW disease analysis object with an
  // optional weatherNote (and, for a category already at MODERATE with
  // a matching active weather factor, a one-step bump to HIGH) — never
  // applied to a category that doesn't already have enough real data,
  // and never presented as weather causing the condition.
  function applyWeatherAdjustments(diseaseAnalysis, weatherFactors) {
    if (!diseaseAnalysis || !weatherFactors || !weatherFactors.length) return diseaseAnalysis;

    var notesByKey = {};
    weatherFactors.forEach(function (f) {
      (f.affects || []).forEach(function (key) {
        if (!notesByKey[key]) notesByKey[key] = [];
        notesByKey[key].push(f.text);
      });
    });

    var categories = diseaseAnalysis.categories.map(function (c) {
      if (!c.hasEnoughData || !notesByKey[c.key]) return c;
      var next = Object.assign({}, c);
      next.weatherNote = 'Possible contributing factor (not a direct cause): ' + notesByKey[c.key][0];
      if (next.risk === 'MODERATE') next.risk = 'HIGH';
      return next;
    });

    return Object.assign({}, diseaseAnalysis, { categories: categories });
  }

  // ------------------------------------------------------------------
  // 4) RECOMMENDATIONS — derived only from the calculated results
  // above; never a randomly-picked tip.
  // ------------------------------------------------------------------

  function getRecommendations(diseaseAnalysis, medicineAnalysis, weatherFactors) {
    var recs = [];

    (diseaseAnalysis && diseaseAnalysis.categories || []).forEach(function (c) {
      if (!c.hasEnoughData) return;
      if (c.risk === 'HIGH') {
        recs.push('Review recent ' + c.label.toLowerCase() + ' cases \u2014 risk is currently estimated as HIGH.');
      } else if (c.trend === 'Increasing') {
        recs.push('Monitor ' + c.label.toLowerCase() + ' cases \u2014 showing an increasing trend.');
      }
    });

    (medicineAnalysis && medicineAnalysis.items || []).forEach(function (i) {
      if (!i.hasEnoughData && i.lowStock) {
        recs.push(i.name + ': ' + i.recommendation);
        return;
      }
      if (i.hasEnoughData && (i.demand === 'HIGH' || i.lowStock)) {
        recs.push(i.name + ': ' + i.recommendation);
      }
    });

    (weatherFactors || []).forEach(function (f) {
      recs.push('Weather factor: ' + f.text);
    });

    if (!recs.length) {
      recs.push('Not enough historical data for a reliable prediction yet \u2014 check back as more records are added.');
    }

    return recs;
  }

  // ------------------------------------------------------------------
  // attach onto the shared PCData object, namespaced under
  // PCData.Predictive so it stays clearly separated from the
  // persisted-collection APIs (Patients/Medical Records/Inventory)
  // everything else on PCData represents.
  // ------------------------------------------------------------------

  PCData.Predictive = {
    RECENT_WINDOW_DAYS: RECENT_WINDOW_DAYS,
    BASELINE_WINDOW_DAYS: BASELINE_WINDOW_DAYS,
    MIN_CASES_FOR_SIGNAL: MIN_CASES_FOR_SIGNAL,
    CONDITION_CATEGORIES: CONDITION_CATEGORIES,
    OTHER_CATEGORY: OTHER_CATEGORY,
    getDiseaseRiskAnalysis: getDiseaseRiskAnalysis,
    getMedicineDemandAnalysis: getMedicineDemandAnalysis,
    getWeatherFactors: getWeatherFactors,
    applyWeatherAdjustments: applyWeatherAdjustments,
    getRecommendations: getRecommendations
  };
})(window);