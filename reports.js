// ============================================================
// PAWSITIVE CARE — Reports
// Phase 2: Report Library (catalog UI). The page renders a
// data-driven catalog from REPORT_DEFINITIONS (single source of
// truth for name / category / description / icon / supported filters,
// category counts, filtering and rendering), with category filters and
// search by report name.
// Phase 3: Generate Report. Every Generate button (and the top
// "+ Generate Report" button) opens a modal that offers only the
// filters the chosen report supports, builds the report from the live
// PCData stores, fills the dedicated #rpt-print-report container and
// calls window.print(). Reports with no underlying data (or no
// underlying feature yet, e.g. Queue Performance, Stock Movement)
// generate a valid "No results found" report.
// Phase 4B: Recent Reports. Every successful generation (after the
// report is prepared and window.print() has been called) is logged to
// localStorage under 'pawsitive_reports_history' and listed in
// #rpt-recent-list. Only the parameters used are stored — never the
// generated report content.
// Phase 4C: each Recent Reports row has a "Generate Again" action that
// reopens the existing Generate Report modal with that record's report,
// period, custom dates and filters restored (nothing is printed until the
// user submits the modal; a successful submit logs a NEW entry).
//
// PRESERVED from the earlier read-only dashboard (unused by the
// catalog, kept for Phase 3): period/range helpers, stat/bar
// helpers, the per-module compute*Stats + render*Report functions,
// the Clinic Overview, the period toolbar + print handlers, and the
// PCData.onChange listener. buildLegacyDashboardHtml() composes them
// exactly as the old page did but returns a string instead of
// replacing the page.
//
// Period filter (legacy): applied only to records with a real date
// field (Appointments.date, Medical Records.date, Invoices.date,
// Vaccinations.dateGiven). Patients and Inventory are current-state
// snapshots with no event date, so they always show current totals.
// ============================================================

(function () {
  var state = { period: 'all', from: null, to: null, category: 'All', search: '' };

  // ------------------------------------------------------------------
  // period range helpers
  // ------------------------------------------------------------------

  function pad2(n) { return String(n).padStart(2, '0'); }
  function toIso(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

  // Resolves a period id (+ custom from/to) to {start, end}, or null for
  // All Time. currentRange() (legacy dashboard) reads the page state;
  // the Generate Report modal passes its own values.
  function rangeFor(period, from, to) {
    var today = PCData.parseDate(PCData.todayStr());
    if (period === 'today') {
      var t = PCData.todayStr();
      return { start: t, end: t };
    }
    if (period === 'week') {
      var dow = (today.getDay() + 6) % 7; // Monday = 0
      var start = new Date(today); start.setDate(start.getDate() - dow);
      var end = new Date(start); end.setDate(end.getDate() + 6);
      return { start: toIso(start), end: toIso(end) };
    }
    if (period === 'month') {
      var mStart = new Date(today.getFullYear(), today.getMonth(), 1);
      var mEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return { start: toIso(mStart), end: toIso(mEnd) };
    }
    if (period === 'custom' && from && to) {
      return { start: from, end: to };
    }
    return null; // all time
  }

  function currentRange() {
    return rangeFor(state.period, state.from, state.to);
  }

  function inRange(dateStr, range) {
    if (!range) return true;
    if (!dateStr) return false;
    return dateStr >= range.start && dateStr <= range.end;
  }

  // ------------------------------------------------------------------
  // small render helpers
  // ------------------------------------------------------------------

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function statCard(label, value, cls) {
    return (
      '<div class="rpt-stat-card ' + cls + '">' +
        '<div class="rpt-stat-value">' + esc(value) + '</div>' +
        '<div class="rpt-stat-label">' + esc(label) + '</div>' +
      '</div>'
    );
  }

  // Compact bar visualization replacing plain tables. `rows` is
  // [{label, value}]; pass sorted (desc by value, or chronological
  // for date trends) — this function does not re-sort.
  function barList(rows) {
    if (!rows.length) return '<p class="rpt-empty">No data recorded yet.</p>';
    var max = rows.reduce(function (m, r) { return Math.max(m, r.value); }, 1);
    var body = rows.map(function (r) {
      var pct = max ? Math.round((r.value / max) * 100) : 0;
      return (
        '<div class="rpt-bar-row">' +
          '<span class="rpt-bar-label" title="' + esc(r.label) + '">' + esc(r.label) + '</span>' +
          '<div class="rpt-bar-track"><div class="rpt-bar-fill" style="width:' + pct + '%"></div></div>' +
          '<span class="rpt-bar-value">' + esc(r.value) + '</span>' +
        '</div>'
      );
    }).join('');
    var scrollCls = rows.length > 6 ? ' rpt-barlist--scroll' : '';
    return '<div class="rpt-barlist' + scrollCls + '">' + body + '</div>';
  }

  function countsToRows(counts, sortDesc) {
    var rows = Object.keys(counts).map(function (k) { return { label: k, value: counts[k] }; });
    if (sortDesc) rows.sort(function (a, b) { return b.value - a.value; });
    return rows;
  }

  function trendRows(byDate) {
    return Object.keys(byDate).sort().map(function (d) {
      return { label: PCData.formatDateLabel(d), value: byDate[d] };
    });
  }

  function wrapReport(id, icon, title, statsHtml, bodyHtml) {
    return (
      '<details class="rpt-report" open data-report="' + id + '">' +
        '<summary class="rpt-report-summary">' +
          '<i class="fa-solid ' + icon + '"></i> ' + esc(title) +
          '<i class="fa-solid fa-chevron-down rpt-summary-caret"></i>' +
        '</summary>' +
        '<div class="rpt-report-body">' +
          '<div class="rpt-stat-grid">' + statsHtml + '</div>' +
          bodyHtml +
        '</div>' +
      '</details>'
    );
  }

  function subhead(text) { return '<h3 class="rpt-subheading">' + esc(text) + '</h3>'; }

  // ------------------------------------------------------------------
  // Appointment Report (calculations unchanged)
  // ------------------------------------------------------------------

  function computeAppointmentStats(range) {
    var appts = PCData.getAppointments().filter(function (a) { return inRange(a.date, range); });
    var counts = {};
    PCData.STATUSES.forEach(function (s) { counts[s] = 0; });
    var byDate = {};
    appts.forEach(function (a) {
      if (counts[a.status] !== undefined) counts[a.status]++;
      byDate[a.date] = (byDate[a.date] || 0) + 1;
    });
    return { total: appts.length, counts: counts, trend: trendRows(byDate) };
  }

  function renderAppointmentReport(range) {
    var data = computeAppointmentStats(range);
    var labels = PCData.STATUS_LABELS;
    var statsHtml =
      statCard('Total', data.total, 'rpt-total') +
      statCard(labels.pending, data.counts.pending, 'rpt-pending') +
      statCard(labels.confirmed, data.counts.confirmed, 'rpt-confirmed') +
      statCard(labels.arrived, data.counts.arrived, 'rpt-arrived') +
      statCard(labels.completed, data.counts.completed, 'rpt-completed') +
      statCard(labels.cancelled, data.counts.cancelled, 'rpt-cancelled');
    var body = subhead('Activity by Date') + barList(data.trend);
    return wrapReport('appointments', 'fa-calendar-days', 'Appointments', statsHtml, body);
  }

  // ------------------------------------------------------------------
  // Patient Report (calculations unchanged; not date-filtered)
  // ------------------------------------------------------------------

  function computePatientStats() {
    var patients = PCData.getPatients();
    var statusCounts = {};
    PCData.PATIENT_STATUSES.forEach(function (s) { statusCounts[s] = 0; });
    var speciesCounts = {};
    PCData.SPECIES.forEach(function (s) { speciesCounts[s] = 0; });
    patients.forEach(function (p) {
      if (statusCounts[p.status] !== undefined) statusCounts[p.status]++;
      if (speciesCounts[p.species] !== undefined) speciesCounts[p.species]++;
      else speciesCounts.Other = (speciesCounts.Other || 0) + 1;
    });
    var otherSpecies = 0;
    Object.keys(speciesCounts).forEach(function (s) { if (s !== 'Dog' && s !== 'Cat') otherSpecies += speciesCounts[s]; });
    return {
      total: patients.length,
      active: statusCounts.active || 0,
      inactive: statusCounts.inactive || 0,
      dogs: speciesCounts.Dog || 0,
      cats: speciesCounts.Cat || 0,
      other: otherSpecies,
      bySpecies: speciesCounts
    };
  }

  function renderPatientReport() {
    var data = computePatientStats();
    var statsHtml =
      statCard('Total', data.total, 'rpt-total') +
      statCard('Active', data.active, 'rpt-confirmed') +
      statCard('Inactive', data.inactive, 'rpt-cancelled') +
      statCard('Dogs', data.dogs, 'rpt-arrived') +
      statCard('Cats', data.cats, 'rpt-pending') +
      statCard('Other Species', data.other, 'rpt-completed');
    var body = subhead('Patients by Species') + barList(countsToRows(data.bySpecies, true));
    return wrapReport('patients', 'fa-paw', 'Patients', statsHtml, body);
  }

  // ------------------------------------------------------------------
  // Medical Records Report (calculations unchanged)
  // ------------------------------------------------------------------

  function computeMedicalRecordStats(range) {
    var records = PCData.getMedicalRecords().filter(function (r) { return inRange(r.date, range); });
    var statusCounts = {};
    PCData.MED_STATUSES.forEach(function (s) { statusCounts[s] = 0; });
    var visitTypeCounts = {};
    var diagnosisCounts = {};
    var byDate = {};
    records.forEach(function (r) {
      if (statusCounts[r.status] !== undefined) statusCounts[r.status]++;
      if (r.visitType) visitTypeCounts[r.visitType] = (visitTypeCounts[r.visitType] || 0) + 1;
      var dx = (r.diagnosis || '').trim();
      if (dx && dx.toLowerCase() !== 'none') diagnosisCounts[dx] = (diagnosisCounts[dx] || 0) + 1;
      if (r.date) byDate[r.date] = (byDate[r.date] || 0) + 1;
    });
    return { total: records.length, statusCounts: statusCounts, visitTypeCounts: visitTypeCounts, diagnosisCounts: diagnosisCounts, trend: trendRows(byDate) };
  }

  function renderMedicalRecordsReport(range) {
    var data = computeMedicalRecordStats(range);
    var labels = PCData.MED_STATUS_LABELS;
    var statsHtml =
      statCard('Total', data.total, 'rpt-total') +
      statCard(labels.completed, data.statusCounts.completed, 'rpt-completed') +
      statCard(labels.ongoing, data.statusCounts.ongoing, 'rpt-confirmed') +
      statCard(labels['follow-up'], data.statusCounts['follow-up'], 'rpt-pending') +
      statCard(labels.cancelled, data.statusCounts.cancelled, 'rpt-cancelled');
    var body =
      subhead('By Visit Type') + barList(countsToRows(data.visitTypeCounts, true)) +
      subhead('By Diagnosis') + barList(countsToRows(data.diagnosisCounts, true)) +
      subhead('Activity by Date') + barList(data.trend);
    return wrapReport('medical-records', 'fa-notes-medical', 'Medical Records', statsHtml, body);
  }

  // ------------------------------------------------------------------
  // Inventory Report (calculations unchanged; not date-filtered)
  // ------------------------------------------------------------------

  function computeInventoryStats() {
    var items = PCData.getInventory();
    var categoryCounts = {};
    PCData.INV_CATEGORIES.forEach(function (c) { categoryCounts[c] = 0; });
    var statusCounts = {};
    PCData.INV_STATUSES.forEach(function (s) { statusCounts[s] = 0; });
    var totalQuantity = 0, outOfStock = 0;
    items.forEach(function (i) {
      if (categoryCounts[i.category] !== undefined) categoryCounts[i.category]++;
      if (statusCounts[i.status] !== undefined) statusCounts[i.status]++;
      totalQuantity += i.quantity || 0;
      if ((i.quantity || 0) === 0) outOfStock++;
    });
    return {
      total: items.length, totalQuantity: totalQuantity,
      lowStock: PCData.getLowStockItems().length, outOfStock: outOfStock,
      expired: PCData.getExpiredItems().length,
      categoryCounts: categoryCounts, statusCounts: statusCounts
    };
  }

  function renderInventoryReport() {
    var data = computeInventoryStats();
    var statsHtml =
      statCard('Total Items', data.total, 'rpt-total') +
      statCard('Total Quantity', data.totalQuantity, 'rpt-confirmed') +
      statCard('Low Stock', data.lowStock, 'rpt-pending') +
      statCard('Out of Stock', data.outOfStock, 'rpt-cancelled') +
      statCard('Expired', data.expired, 'rpt-arrived');
    var body =
      subhead('By Category') + barList(countsToRows(data.categoryCounts, true)) +
      subhead('By Status') + barList(countsToRows(data.statusCounts, true));
    return wrapReport('inventory', 'fa-boxes-stacked', 'Inventory', statsHtml, body);
  }

  // ------------------------------------------------------------------
  // Billing Report (calculations unchanged)
  // ------------------------------------------------------------------

  function computeBillingStats(range) {
    var invoices = PCData.getInvoices().filter(function (inv) { return inRange(inv.date, range); });
    var payments = PCData.getPayments().filter(function (p) { return inRange(p.paymentDate, range); });

    var statusCounts = {};
    PCData.INVOICE_STATUSES.forEach(function (s) { statusCounts[s] = 0; });
    var totalBilled = 0, totalPaid = 0, byDate = {};
    invoices.forEach(function (inv) {
      if (statusCounts[inv.status] !== undefined) statusCounts[inv.status]++;
      totalBilled += inv.totalAmount || 0;
      if (inv.status === 'paid') totalPaid += inv.totalAmount || 0;
      if (inv.date) byDate[inv.date] = (byDate[inv.date] || 0) + 1;
    });

    var methodTotals = {};
    payments.forEach(function (p) {
      if (p.status !== 'verified') return;
      var label = PCData.PAYMENT_METHOD_LABELS[p.method] || p.method;
      methodTotals[label] = (methodTotals[label] || 0) + (p.amount || 0);
    });

    return {
      total: invoices.length, statusCounts: statusCounts,
      totalBilled: totalBilled, totalPaid: totalPaid,
      trend: trendRows(byDate), methodTotals: methodTotals
    };
  }

  function money(n) { return (n || 0).toFixed(2); }

  function renderBillingReport(range) {
    var data = computeBillingStats(range);
    var labels = PCData.INVOICE_STATUS_LABELS;
    var statsHtml =
      statCard('Total Invoices', data.total, 'rpt-total') +
      statCard(labels.paid, data.statusCounts.paid, 'rpt-completed') +
      statCard(labels.unpaid, data.statusCounts.unpaid, 'rpt-cancelled') +
      statCard(labels['pending-verification'], data.statusCounts['pending-verification'], 'rpt-pending') +
      statCard(labels.rejected, data.statusCounts.rejected, 'rpt-arrived') +
      statCard(labels.refunded, data.statusCounts.refunded, 'rpt-confirmed') +
      statCard('Total Billed', '₱' + money(data.totalBilled), 'rpt-total') +
      statCard('Total Paid', '₱' + money(data.totalPaid), 'rpt-completed');
    var methodRows = Object.keys(data.methodTotals).map(function (m) { return { label: m, value: Number(money(data.methodTotals[m])) }; })
      .sort(function (a, b) { return b.value - a.value; });
    var body =
      subhead('Verified Revenue by Payment Method') + barList(methodRows) +
      subhead('Invoice Activity by Date') + barList(data.trend);
    return wrapReport('billing', 'fa-credit-card', 'Billing', statsHtml, body);
  }

  // ------------------------------------------------------------------
  // Vaccination Report (calculations unchanged)
  // ------------------------------------------------------------------

  function computeVaccinationStats(range) {
    var records = PCData.getVaccinations().filter(function (v) { return inRange(v.dateGiven, range); });
    var statusCounts = {};
    PCData.VACCINATION_STATUSES.forEach(function (s) { statusCounts[s] = 0; });
    var vaccineCounts = {}, byDate = {};
    records.forEach(function (v) {
      var status = PCData.computeVaccinationStatus(v.nextDue);
      if (statusCounts[status] !== undefined) statusCounts[status]++;
      if (v.vaccineName) vaccineCounts[v.vaccineName] = (vaccineCounts[v.vaccineName] || 0) + 1;
      if (v.dateGiven) byDate[v.dateGiven] = (byDate[v.dateGiven] || 0) + 1;
    });
    return { total: records.length, statusCounts: statusCounts, vaccineCounts: vaccineCounts, trend: trendRows(byDate) };
  }

  function renderVaccinationReport(range) {
    var data = computeVaccinationStats(range);
    var statsHtml =
      statCard('Total', data.total, 'rpt-total') +
      statCard('Up to Date', data.statusCounts['Up to date'], 'rpt-completed') +
      statCard('Due Soon', data.statusCounts['Due soon'], 'rpt-pending') +
      statCard('Overdue', data.statusCounts.Overdue, 'rpt-cancelled') +
      statCard('N/A', data.statusCounts['N/A'], 'rpt-arrived') +
      statCard('Unknown', data.statusCounts.Unknown, 'rpt-confirmed');
    var body =
      subhead('By Vaccine Name') + barList(countsToRows(data.vaccineCounts, true)) +
      subhead('Activity by Date Given') + barList(data.trend);
    return wrapReport('vaccination', 'fa-syringe', 'Vaccination', statsHtml, body);
  }

  // ------------------------------------------------------------------
  // Clinic Overview
  // ------------------------------------------------------------------

  function renderOverview(range) {
    var totalPatients = PCData.getPatients().length; // snapshot, not date-filtered
    var apptCount = PCData.getAppointments().filter(function (a) { return inRange(a.date, range); }).length;
    var medRecCount = PCData.getMedicalRecords().filter(function (r) { return inRange(r.date, range); }).length;
    var invItems = PCData.getInventory().length; // snapshot, not date-filtered
    var lowStock = PCData.getLowStockItems().length; // snapshot, not date-filtered
    var paidRevenue = PCData.getInvoices()
      .filter(function (inv) { return inv.status === 'paid' && inRange(inv.date, range); })
      .reduce(function (sum, inv) { return sum + (inv.totalAmount || 0); }, 0);

    var statsHtml =
      statCard('Total Patients', totalPatients, 'rpt-total') +
      statCard('Appointments', apptCount, 'rpt-confirmed') +
      statCard('Medical Records', medRecCount, 'rpt-arrived') +
      statCard('Inventory Items', invItems, 'rpt-pending') +
      statCard('Low Stock Items', lowStock, 'rpt-cancelled') +
      statCard('Paid Revenue', '₱' + money(paidRevenue), 'rpt-completed');

    return (
      '<section class="rpt-overview">' +
        '<h2 class="rpt-heading">Clinic Overview</h2>' +
        '<div class="rpt-stat-grid rpt-stat-grid--overview">' + statsHtml + '</div>' +
      '</section>'
    );
  }

  // ------------------------------------------------------------------
  // toolbar (period filter + print)
  // ------------------------------------------------------------------

  var PERIODS = [
    { id: 'all', label: 'All Time' },
    { id: 'today', label: 'Today' },
    { id: 'week', label: 'This Week' },
    { id: 'month', label: 'This Month' },
    { id: 'custom', label: 'Custom' }
  ];

  function renderToolbar() {
    var buttons = PERIODS.map(function (p) {
      var active = state.period === p.id ? ' is-active' : '';
      return '<button type="button" class="rpt-filter-btn' + active + '" data-period="' + p.id + '">' + p.label + '</button>';
    }).join('');

    var fromVal = state.from || PCData.todayStr();
    var toVal = state.to || PCData.todayStr();
    var customDisplay = state.period === 'custom' ? '' : ' style="display:none"';

    return (
      '<div class="rpt-toolbar">' +
        '<div class="rpt-filter-group">' + buttons + '</div>' +
        '<div class="rpt-custom-range" id="rpt-custom-range"' + customDisplay + '>' +
          '<input type="date" id="rpt-from" value="' + fromVal + '">' +
          '<span>to</span>' +
          '<input type="date" id="rpt-to" value="' + toVal + '">' +
          '<button type="button" class="rpt-filter-btn" id="rpt-apply-custom">Apply</button>' +
        '</div>' +
        '<button type="button" class="rpt-print-btn" id="rpt-print-btn"><i class="fa-solid fa-print"></i> Print Report</button>' +
      '</div>'
    );
  }

  // ------------------------------------------------------------------
  // legacy dashboard composition (preserved, not rendered)
  // ------------------------------------------------------------------

  // Composes the original dashboard (toolbar + overview + six reports).
  // Not called by the Report Library; kept intact.
  function buildLegacyDashboardHtml() {
    var range = currentRange();

    return (
      renderToolbar() +
      renderOverview(range) +
      renderAppointmentReport(range) +
      renderPatientReport() +
      renderMedicalRecordsReport(range) +
      renderInventoryReport() +
      renderBillingReport(range) +
      renderVaccinationReport(range)
    );
  }

  // ------------------------------------------------------------------
  // REPORT LIBRARY (Phase 2) — single source of truth
  // Static catalog metadata only. Nothing here is report output.
  // ------------------------------------------------------------------

  var REPORT_CATEGORIES = [
    { name: 'Operations', icon: 'fa-calendar-days' },
    { name: 'Clinical',   icon: 'fa-notes-medical' },
    { name: 'Inventory',  icon: 'fa-boxes-stacked' },
    { name: 'Financial',  icon: 'fa-credit-card' },
    { name: 'Services',   icon: 'fa-hospital' }
  ];

  var REPORT_DEFINITIONS = [
    // Operations
    { id: 'appointment-summary', filters: ['date','apptStatus','vet','apptType'], name: 'Appointment Summary', category: 'Operations', icon: 'fa-calendar-check',
      description: 'Appointments by status, veterinarian, and date for a selected period.' },
    { id: 'daily-clinic-activity', filters: ['date'], name: 'Daily Clinic Activity', category: 'Operations', icon: 'fa-clipboard-list',
      description: 'Appointments, medical records, vaccinations, and invoices recorded on a single day.' },
    { id: 'queue-performance', filters: ['date'], name: 'Queue Performance', category: 'Operations', icon: 'fa-gauge-high',
      description: 'Patient waiting time and consultation flow through the clinic queue.' },

    // Clinical
    { id: 'patient-visits', filters: ['date','vet','visitType','visitStatus'], name: 'Patient Visits', category: 'Clinical', icon: 'fa-paw',
      description: 'Visits recorded in medical records by patient, veterinarian, visit type, and status.' },
    { id: 'diagnosis-frequency', filters: ['date'], name: 'Diagnosis Frequency', category: 'Clinical', icon: 'fa-stethoscope',
      description: 'How often each diagnosis appears in medical records for a selected period.' },
    { id: 'vaccination-summary', filters: ['date','vaccine','vaccinationStatus'], name: 'Vaccination Summary', category: 'Clinical', icon: 'fa-syringe',
      description: 'Vaccinations given by vaccine name, with up to date, due soon, and overdue status.' },
    { id: 'follow-up-report', filters: ['date','vet','recordStatus','followUpStatus'], name: 'Follow-Up Report', category: 'Clinical', icon: 'fa-calendar-plus', dateBasis: 'follow-up date',
      description: 'Medical records with a recorded follow-up date, split into upcoming and overdue. The date range applies to the follow-up date.' },

    // Inventory
    { id: 'stock-summary', filters: ['invCategory','itemState'], name: 'Stock Summary', category: 'Inventory', icon: 'fa-boxes-stacked',
      description: 'Current quantity, unit, unit price, and status of every inventory item.' },
    { id: 'stock-movement', filters: ['date'], name: 'Stock Movement', category: 'Inventory', icon: 'fa-arrow-right-arrow-left',
      description: 'Stock added and used over a selected period, by inventory item.' },
    { id: 'low-stock-report', filters: ['invCategory'], name: 'Low Stock Report', category: 'Inventory', icon: 'fa-triangle-exclamation',
      description: 'Items at or below their low-stock threshold.' },
    { id: 'expired-items', filters: ['invCategory','itemState'], name: 'Expired Items', category: 'Inventory', icon: 'fa-calendar-xmark',
      description: 'Items whose expiration date has passed, by category.' },

    // Financial
    { id: 'revenue-summary', filters: ['date','vet'], name: 'Revenue Summary', category: 'Financial', icon: 'fa-peso-sign',
      description: 'Revenue from paid invoices for a selected period.' },
    { id: 'invoice-report', filters: ['date','invoiceStatus','vet'], name: 'Invoice Report', category: 'Financial', icon: 'fa-file-invoice',
      description: 'Invoices with client, patient, veterinarian, totals, and status.' },
    { id: 'payment-report', filters: ['date','paymentMethod','paymentStatus'], name: 'Payment Report', category: 'Financial', icon: 'fa-credit-card',
      description: 'Payments by method, amount, reference number, and verification status.' },
    { id: 'outstanding-balances', filters: ['date','outstandingStatus','vet'], name: 'Outstanding Balances', category: 'Financial', icon: 'fa-scale-balanced',
      description: 'Unpaid, pending verification, and rejected invoices that still carry a balance.' },

    // Services
    { id: 'service-usage', filters: ['date','serviceCategory','service','invoiceStatus'], name: 'Service Usage', category: 'Services', icon: 'fa-list-check',
      description: 'How often each service was billed on invoices.' },
    { id: 'service-revenue', filters: ['date','serviceCategory','invoiceStatus'], name: 'Service Revenue', category: 'Services', icon: 'fa-coins',
      description: 'Revenue per service from billed invoice line items.' }
  ];

  function categoryMeta(name) {
    for (var i = 0; i < REPORT_CATEGORIES.length; i++) {
      if (REPORT_CATEGORIES[i].name === name) return REPORT_CATEGORIES[i];
    }
    return { name: name, icon: 'fa-file-lines' };
  }

  function countByCategory(name) {
    if (name === 'All') return REPORT_DEFINITIONS.length;
    return REPORT_DEFINITIONS.filter(function (r) { return r.category === name; }).length;
  }

  // Search text (already lower-cased/trimmed) against title, description and category name.
  function matchesSearch(name, description, category, q) {
    if (!q) return true;
    return [name, description, category].some(function (v) {
      return typeof v === 'string' && v.toLowerCase().indexOf(q) !== -1;
    });
  }

  // Category + search filter over the definitions (both must match).
  function getVisibleReports() {
    var q = state.search;
    return REPORT_DEFINITIONS.filter(function (r) {
      if (state.category !== 'All' && r.category !== state.category) return false;
      return matchesSearch(r.name, r.description, r.category, q);
    });
  }

  // openGenerateReport() is defined in the PHASE 3 section below.

  // ------------------------------------------------------------------
  // catalog rendering
  // ------------------------------------------------------------------

  function renderCategoryTabs() {
    var tabs = ['All'].concat(REPORT_CATEGORIES.map(function (c) { return c.name; }));
    return tabs.map(function (name) {
      var active = state.category === name;
      return (
        '<button type="button" class="sub-tab' + (active ? ' active' : '') + '" data-category="' + esc(name) + '" aria-pressed="' + active + '">' +
          esc(name) + ' <span class="count">' + countByCategory(name) + '</span>' +
        '</button>'
      );
    }).join('');
  }

  function renderReportItem(r) {
    var cat = categoryMeta(r.category);
    return (
      '<div class="rpt-item" data-report-id="' + esc(r.id) + '">' +
        '<div class="rpt-item-icon"><i class="fa-solid ' + esc(r.icon) + '" aria-hidden="true"></i></div>' +
        '<div class="rpt-item-body">' +
          '<div class="rpt-item-name">' + esc(r.name) + '</div>' +
          '<div class="rpt-item-desc">' + esc(r.description) + '</div>' +
          '<div class="rpt-item-meta"><i class="fa-solid ' + esc(cat.icon) + '" aria-hidden="true"></i> ' + esc(r.category) + '</div>' +
        '</div>' +
        '<div class="rpt-item-action">' +
          '<button type="button" class="btn btn-sm" data-generate="' + esc(r.id) + '" aria-label="Generate ' + esc(r.name) + '">' +
            'Generate <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>' +
          '</button>' +
        '</div>' +
      '</div>'
    );
  }

  function renderCatalog(reports) {
    if (!reports.length) {
      return '<div class="empty-state">No reports match your search.</div>';
    }
    return REPORT_CATEGORIES.map(function (cat) {
      var items = reports.filter(function (r) { return r.category === cat.name; });
      if (!items.length) return '';
      return (
        '<section class="rpt-group rpt-group--cat" aria-label="' + esc(cat.name) + ' reports">' +
          '<div class="rpt-group-head">' +
            '<i class="fa-solid ' + esc(cat.icon) + ' rpt-group-icon" aria-hidden="true"></i>' +
            '<h3 class="rpt-group-title">' + esc(cat.name) + '</h3>' +
            '<span class="rpt-group-count">' + items.length + (items.length === 1 ? ' report' : ' reports') + '</span>' +
          '</div>' +
          items.map(renderReportItem).join('') +
        '</section>'
      );
    }).join('');
  }

  // Re-renders only the tabs, count label and catalog. The search input
  // is static markup and is never replaced, so typing keeps its focus.
  function render() {
    var tabsEl = document.getElementById('rpt-category-tabs');
    var countEl = document.getElementById('rpt-count');
    var catalogEl = document.getElementById('rpt-catalog');
    if (!tabsEl || !catalogEl) return;

    var reports = getVisibleReports();
    tabsEl.innerHTML = renderCategoryTabs();
    if (countEl) countEl.textContent = reports.length + (reports.length === 1 ? ' report' : ' reports');
    catalogEl.innerHTML = renderCatalog(reports);
    renderRecentReports(); // Recent Reports follows the same category + search state
  }

  // ------------------------------------------------------------------
  // events (bound once, on static elements — no duplicate listeners
  // because render() only replaces their children)
  // ------------------------------------------------------------------

  function bindLibraryEvents() {
    var tabsEl = document.getElementById('rpt-category-tabs');
    var catalogEl = document.getElementById('rpt-catalog');
    var searchEl = document.getElementById('rpt-search');
    var topBtn = document.getElementById('btn-generate-report');

    if (tabsEl) {
      tabsEl.addEventListener('click', function (e) {
        var tab = e.target.closest('[data-category]');
        if (!tab) return;
        state.category = tab.getAttribute('data-category');
        render();
      });
    }

    if (catalogEl) {
      catalogEl.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-generate]');
        if (!btn) return;
        openGenerateReport(btn.getAttribute('data-generate'));
      });
    }

    if (searchEl) {
      var clearEl = document.getElementById('rpt-search-clear');
      // Keeps the x button in step with the input and re-renders with the current category.
      var applySearch = function () {
        state.search = searchEl.value.trim().toLowerCase();
        if (clearEl) clearEl.hidden = searchEl.value === '';
        render();
      };
      var clearSearch = function () {
        searchEl.value = '';
        applySearch();
        searchEl.focus();
      };
      searchEl.addEventListener('input', applySearch);
      searchEl.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && searchEl.value !== '') { e.preventDefault(); clearSearch(); }
      });
      if (clearEl) clearEl.addEventListener('click', clearSearch);
    }

    if (topBtn) {
      topBtn.addEventListener('click', function () { openGenerateReport(null); });
    }
  }

  // ==================================================================
  // PHASE 3 — GENERATE REPORT
  //
  // Flow: Generate (row button or top "+ Generate Report") -> Generate
  // Report modal (report + only the filters that report supports) ->
  // buildReportModel() reads the live PCData stores -> renderPrintHtml()
  // fills the dedicated #rpt-print-report container -> window.print().
  //
  // REPORT_DEFINITIONS stays the single source of truth: each entry's
  // `filters` array says which modal filters it supports, and
  // REPORT_BUILDERS (below) maps the same ids to their generator.
  // Nothing here writes to any PCData store. The only thing persisted is
  // the Recent Reports log (Phase 4B, below), which holds parameters only.
  // ==================================================================

  var REPORT_BUILDERS = {}; // filled below, keyed by REPORT_DEFINITIONS[].id

  var NO_RESULTS_PERIOD = 'No results found for the selected period.';
  var NO_RESULTS_FILTERS = 'No results found for the selected filters.';

  var PAYMENT_STATUS_LABELS = {
    'pending-verification': 'Pending Verification',
    'verified': 'Verified',
    'rejected': 'Rejected'
  };
  var OUTSTANDING_STATUSES = ['unpaid', 'pending-verification', 'rejected'];

  function getDef(id) {
    for (var i = 0; i < REPORT_DEFINITIONS.length; i++) {
      if (REPORT_DEFINITIONS[i].id === id) return REPORT_DEFINITIONS[i];
    }
    return null;
  }

  // A missing store is a REAL error (thrown, shown in the modal) — it is
  // never confused with a store that simply has no matching records.
  function data(fnName) {
    if (typeof PCData === 'undefined' || typeof PCData[fnName] !== 'function') {
      throw new Error('Required data store is not loaded (' + fnName + ').');
    }
    return PCData[fnName]() || [];
  }

  // ------------------------------------------------------------------
  // formatting + tiny data helpers
  // ------------------------------------------------------------------

  function fmtDate(iso) {
    if (!iso) return '\u2014';
    var d = PCData.parseDate(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function fmtTimeOfDay(ms) {
    return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function fmtMoney(n) {
    return '\u20B1' + (Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function trimmed(s) { return (s == null ? '' : String(s)).trim(); }
  function dash(s) { return trimmed(s) || '\u2014'; }
  function has(obj, k) { return Object.prototype.hasOwnProperty.call(obj, k); }

  // [[label, count], ...] in first-seen order.
  function tally(list, keyFn) {
    var counts = {}, order = [];
    list.forEach(function (x) {
      var k = keyFn(x);
      if (!has(counts, k)) { counts[k] = 0; order.push(k); }
      counts[k]++;
    });
    return order.map(function (k) { return [k, counts[k]]; });
  }

  function byCountDesc(a, b) { return b[1] - a[1] || String(a[0]).localeCompare(String(b[0])); }

  function apptLabel(a) { return PCData.STATUS_LABELS[a.status] || a.status || '\u2014'; }

  function vetOptions() {
    var seen = {}, out = [];
    function add(v) { v = trimmed(v); if (v && !has(seen, v)) { seen[v] = 1; out.push(v); } }
    (PCData.VETS || []).forEach(add);
    var extra = [];
    data('getAppointments').forEach(function (a) { extra.push(a.vet); });
    data('getMedicalRecords').forEach(function (r) { extra.push(r.vet); });
    data('getInvoices').forEach(function (i) { extra.push(i.vet); });
    extra.filter(Boolean).sort().forEach(add);
    return out;
  }

  // ------------------------------------------------------------------
  // print-document building blocks (all text is escaped via esc())
  // ------------------------------------------------------------------

  // Semantic status treatment for the printed report: a small muted pill
  // chosen by the status label (text and values are never changed). A label
  // with no mapping stays plain text.
  var STATUS_TONES = {
    'completed': 'green', 'paid': 'green', 'verified': 'green', 'up to date': 'green', 'active': 'green',
    'arrived': 'blue',
    'confirmed': 'teal', 'upcoming': 'teal',
    'in progress': 'strong', 'ongoing': 'strong', 'ongoing treatment': 'strong', 'consultation': 'strong',
    'scheduled': 'amber', 'pending': 'amber', 'follow-up required': 'amber', 'pending verification': 'amber', 'follow-up': 'amber', 'follow up': 'amber', 'due soon': 'amber',
    'cancelled': 'red', 'canceled': 'red', 'no-show': 'red', 'no show': 'red', 'overdue': 'red', 'rejected': 'red', 'unpaid': 'red', 'expired': 'red',
    'refunded': 'slate', 'inactive': 'slate', 'unknown': 'slate', 'n/a': 'slate'
  };

  function statusCell(label) {
    var text = trimmed(label);
    var key = text.toLowerCase();
    if (!text || !has(STATUS_TONES, key)) return label;
    return { html: '<span class="rpt-doc-status rpt-doc-status--' + STATUS_TONES[key] + '">' + esc(text) + '</span>' };
  }

  // Combined date + time value for a print table cell: the date on the first
  // line, the complete time (AM/PM included) on the second. Both parts are
  // non-wrapping (see .rpt-datetime in reports.html), so the browser can only
  // break between them. With no time the cell is date-only, as before.
  function dateTimeCell(iso, time) {
    if (!time) return fmtDate(iso);
    return { html: '<span class="rpt-datetime"><span class="rpt-datetime-date">' + esc(fmtDate(iso)) + '</span>' +
      '<span class="rpt-datetime-time">' + esc(PCData.formatTimeLabel(time)) + '</span></span>' };
  }

  function cellHtml(c) {
    return (c && typeof c === 'object' && c.html !== undefined) ? c.html : esc(c);
  }

  // headers: [label,...]; rows: [[cell,...],...]; opts.num = numeric column
  // indexes (right-aligned); opts.foot = a totals row.
  function docTable(headers, rows, opts) {
    opts = opts || {};
    var num = opts.num || [];
    // Columns whose header ends in "Status" (Status, Follow-Up Status, Record
    // Status) get the semantic pill in body rows; headers/totals stay as-is.
    var statusCols = headers.map(function (h) { return /status$/i.test(trimmed(h)); });
    function tds(cells, tag, pills) {
      return cells.map(function (c, i) {
        if (pills && statusCols[i] && typeof c === 'string') c = statusCell(c);
        return '<' + tag + (num.indexOf(i) !== -1 ? ' class="rpt-doc-num"' : '') + '>' + cellHtml(c) + '</' + tag + '>';
      }).join('');
    }
    var cols = opts.widths && opts.widths.length === headers.length
      ? '<colgroup>' + opts.widths.map(function (w) { return '<col style="width:' + w + '%">'; }).join('') + '</colgroup>' : '';
    return (
      '<table class="rpt-doc-table' + (opts.compact ? ' rpt-doc-table--compact' : '') + (cols ? ' rpt-doc-table--fixed' : '') + '">' +
        cols + '<thead><tr>' + tds(headers, 'th') + '</tr></thead>' +
        '<tbody>' + rows.map(function (r) { return '<tr>' + tds(r, 'td', true) + '</tr>'; }).join('') + '</tbody>' +
        (opts.foot ? '<tfoot><tr>' + tds(opts.foot, 'td') + '</tr></tfoot>' : '') +
      '</table>'
    );
  }

  // Print-only: a Font Awesome glyph that matches what the section shows.
  var SECTION_ICONS = {
    'By Status': 'list-check', 'By Follow-Up Status': 'list-check',
    'By Veterinarian': 'user-doctor', 'Revenue by Veterinarian': 'user-doctor',
    'By Visit Type': 'stethoscope', 'Diagnoses': 'stethoscope',
    'By Type': 'tag', 'By Category': 'tag',
    'Appointments': 'calendar-check', 'Activity by Date': 'calendar-days', 'Revenue by Invoice Date': 'calendar-days',
    'Visits': 'clipboard-list', 'Follow-Ups': 'calendar-plus',
    'By Vaccine': 'syringe', 'Vaccinations': 'syringe',
    'Items': 'boxes-stacked',
    'Invoices': 'file-invoice', 'By Method': 'credit-card', 'Payments': 'credit-card',
    'Usage by Service': 'list-check', 'Revenue by Service': 'coins'
  };
  function docSection(title, inner, cls) {
    var icon = has(SECTION_ICONS, title) ? SECTION_ICONS[title] : 'chart-simple';
    return '<section class="rpt-doc-sec' + (cls ? ' ' + cls : '') + '"><h2 class="rpt-doc-h2"><i class="fa-solid fa-' + icon + '" aria-hidden="true"></i>' + esc(title) + '</h2>' + inner + '</section>';
  }

  // Two-column label/count breakdown (optionally with an amount column).
  function breakdown(title, firstHeader, pairs, amountHeader) {
    var hasAmt = !!amountHeader;
    var headers = hasAmt ? [firstHeader, 'Count', amountHeader] : [firstHeader, 'Count'];
    var rows = pairs.map(function (p) { return hasAmt ? [p[0], p[1], fmtMoney(p[2])] : [p[0], p[1]]; });
    return docSection(title, docTable(headers, rows, { num: hasAmt ? [1, 2] : [1], compact: true }), 'rpt-doc-sec--panel');
  }

  // ------------------------------------------------------------------
  // report builders. Each returns
  //   { hasData, stats:[[label,value]], sections:[html], notes:[text],
  //     emptyText? }
  // `f` = { id, values, range, period }.
  // ------------------------------------------------------------------

  // ---- Operations -----------------------------------------------------

  REPORT_BUILDERS['appointment-summary'] = function (f) {
    var v = f.values;
    var list = data('getAppointments').filter(function (a) {
      if (!inRange(a.date, f.range)) return false;
      if (v.apptStatus && a.status !== v.apptStatus) return false;
      if (v.vet && a.vet !== v.vet) return false;
      if (v.apptType === '__unspecified' && a.appointmentType) return false;
      if (v.apptType && v.apptType !== '__unspecified' && a.appointmentType !== v.apptType) return false;
      return true;
    }).sort(function (a, b) { return (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')); });

    if (!list.length) return { hasData: false, stats: [], sections: [], notes: [] };

    var showService = list.some(function (a) { return a.serviceId; }) && typeof PCData.getServiceForAppointment === 'function';
    var headers = ['Date / Time', 'Patient', 'Owner', 'Veterinarian', 'Type'];
    if (showService) headers.push('Service');
    headers.push('Reason', 'Status');
    var rows = list.map(function (a) {
      var when = dateTimeCell(a.date, a.time);
      var row = [when, dash(a.pet) + (a.species ? ' (' + a.species + ')' : ''), dash(a.owner), dash(a.vet), dash(a.appointmentType)];
      if (showService) { var svc = PCData.getServiceForAppointment(a); row.push(svc ? svc.name : '\u2014'); }
      row.push(dash(a.reason), apptLabel(a));
      return row;
    });

    var apptWidths = showService ? [13, 11, 12, 11, 11, 13, 17, 12] : [14, 13, 14, 13, 13, 20, 13];
    var statusPairs = tally(list, function (a) { return apptLabel(a); }).sort(byCountDesc);
    var vetPairs = tally(list, function (a) { return dash(a.vet); }).sort(byCountDesc);
    var typePairs = tally(list, function (a) { return a.appointmentType || 'Unspecified'; }).sort(byCountDesc);

    return {
      hasData: true,
      stats: [['Total Appointments', list.length]],
      sections: [
        '<div class="rpt-doc-cols">' +
          breakdown('By Status', 'Status', statusPairs) +
          breakdown('By Veterinarian', 'Veterinarian', vetPairs) +
          breakdown('By Type', 'Type', typePairs) +
        '</div>',
        docSection('Appointments', docTable(headers, rows, { widths: apptWidths }))
      ],
      notes: []
    };
  };

  REPORT_BUILDERS['daily-clinic-activity'] = function (f) {
    var days = {};
    function bump(date, key) {
      if (!date || !inRange(date, f.range)) return;
      if (!has(days, date)) days[date] = { a: 0, m: 0, v: 0, i: 0 };
      days[date][key]++;
    }
    data('getAppointments').forEach(function (a) { bump(a.date, 'a'); });
    data('getMedicalRecords').forEach(function (r) { bump(r.date, 'm'); });
    data('getVaccinations').forEach(function (x) { bump(x.dateGiven, 'v'); });
    data('getInvoices').forEach(function (i) { bump(i.date, 'i'); });

    var dates = Object.keys(days).sort();
    if (!dates.length) return { hasData: false, stats: [], sections: [], notes: [] };

    var tot = { a: 0, m: 0, v: 0, i: 0 };
    var rows = dates.map(function (d) {
      var r = days[d];
      tot.a += r.a; tot.m += r.m; tot.v += r.v; tot.i += r.i;
      return [fmtDate(d), r.a, r.m, r.v, r.i];
    });
    return {
      hasData: true,
      stats: [['Days With Activity', dates.length], ['Appointments', tot.a], ['Medical Records', tot.m], ['Vaccinations', tot.v], ['Invoices', tot.i]],
      sections: [docSection('Activity by Date',
        docTable(['Date', 'Appointments', 'Medical Records', 'Vaccinations', 'Invoices'], rows,
          { num: [1, 2, 3, 4], foot: ['Total', tot.a, tot.m, tot.v, tot.i] }))],
      notes: ['Counts are records dated on that day: appointments by appointment date, medical records by visit date, vaccinations by date given, invoices by invoice date. Dates with no records are not listed.']
    };
  };

  // The queue stores no called / consultation-start / completion times,
  // so there is nothing to measure. Nothing is estimated. When timing
  // data exists, this same builder is where it will be read.
  REPORT_BUILDERS['queue-performance'] = function () {
    return { hasData: false, stats: [], sections: [], notes: ['Queue timing data is not available for this period.'] };
  };

  // ---- Clinical -------------------------------------------------------

  REPORT_BUILDERS['patient-visits'] = function (f) {
    var v = f.values;
    var list = data('getMedicalRecords').filter(function (r) {
      if (!inRange(r.date, f.range)) return false;
      if (v.vet && r.vet !== v.vet) return false;
      if (v.visitType && r.visitType !== v.visitType) return false;
      if (v.visitStatus && r.status !== v.visitStatus) return false;
      return true;
    }).sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });

    if (!list.length) return { hasData: false, stats: [], sections: [], notes: [] };

    var sl = PCData.MED_STATUS_LABELS || {};
    function statusText(r) { return sl[r.status] || r.status || '\u2014'; }
    function dx(r) { var t = trimmed(r.diagnosis); return (!t || t.toLowerCase() === 'none') ? '\u2014' : t; }

    var rows = list.map(function (r) {
      return [fmtDate(r.date), dash(r.pet), dash(r.owner), dash(r.vet), dash(r.visitType), dash(r.chiefComplaint), dx(r), statusText(r)];
    });
    return {
      hasData: true,
      stats: [['Total Visits', list.length]],
      sections: [
        '<div class="rpt-doc-cols">' +
          breakdown('By Status', 'Status', tally(list, statusText).sort(byCountDesc)) +
          breakdown('By Visit Type', 'Visit Type', tally(list, function (r) { return dash(r.visitType); }).sort(byCountDesc)) +
          breakdown('By Veterinarian', 'Veterinarian', tally(list, function (r) { return dash(r.vet); }).sort(byCountDesc)) +
        '</div>',
        docSection('Visits', docTable(['Date', 'Patient', 'Owner', 'Veterinarian', 'Visit Type', 'Chief Complaint', 'Diagnosis', 'Status'], rows, { widths: [11, 9, 10, 12, 14, 16, 16, 12] }))
      ],
      notes: []
    };
  };

  // Follow-Up Report. Uses only fields that exist on medical records.
  // The date range applies to followUpDate (NOT the visit date). Upcoming /
  // Overdue is derived purely from followUpDate vs today: the records hold
  // no "follow-up completed" information, so none is inferred.
  function followUpState(r) { return r.followUpDate >= PCData.todayStr() ? 'upcoming' : 'overdue'; }
  var FOLLOW_UP_LABELS = { upcoming: 'Upcoming', overdue: 'Overdue' };
  var FOLLOW_UP_NOTE = 'The date range filters by follow-up date, not visit date. Upcoming means the follow-up date is today or later; Overdue means it is before today. Medical records do not track whether a follow-up took place, so completion is not shown.';

  REPORT_BUILDERS['follow-up-report'] = function (f) {
    var v = f.values;
    var list = data('getMedicalRecords').filter(function (r) {
      if (!isIsoDate(r.followUpDate)) return false;          // no follow-up date -> not included
      if (!inRange(r.followUpDate, f.range)) return false;
      if (v.vet && r.vet !== v.vet) return false;
      if (v.recordStatus && r.status !== v.recordStatus) return false;
      if (v.followUpStatus && followUpState(r) !== v.followUpStatus) return false;
      return true;
    }).sort(function (a, b) { return a.followUpDate.localeCompare(b.followUpDate) || String(a.pet).localeCompare(String(b.pet)); });

    if (!list.length) return { hasData: false, stats: [], sections: [], notes: [FOLLOW_UP_NOTE] };

    var sl = PCData.MED_STATUS_LABELS || {};
    function recStatus(r) { return sl[r.status] || r.status || '\u2014'; }
    function dx(r) { var t = trimmed(r.diagnosis); return (!t || t.toLowerCase() === 'none') ? '\u2014' : t; }
    function fuLabel(r) { return FOLLOW_UP_LABELS[followUpState(r)]; }

    var rows = list.map(function (r) {
      return [fmtDate(r.followUpDate), fuLabel(r), dash(r.pet), dash(r.owner), fmtDate(r.date), dash(r.vet), dx(r), recStatus(r)];
    });
    var upcoming = list.filter(function (r) { return followUpState(r) === 'upcoming'; }).length;
    return {
      hasData: true,
      stats: [['Follow-Ups', list.length], ['Upcoming', upcoming], ['Overdue', list.length - upcoming]],
      sections: [
        '<div class="rpt-doc-cols rpt-doc-cols--2">' +
          breakdown('By Follow-Up Status', 'Status', tally(list, fuLabel).sort(byCountDesc)) +
          breakdown('By Veterinarian', 'Veterinarian', tally(list, function (r) { return dash(r.vet); }).sort(byCountDesc)) +
        '</div>',
        docSection('Follow-Ups', docTable(['Follow-Up Date', 'Follow-Up Status', 'Patient', 'Owner', 'Visit Date', 'Veterinarian', 'Diagnosis', 'Record Status'], rows, { widths: [11, 10, 9, 12, 11, 10, 19, 18] }))
      ],
      notes: [FOLLOW_UP_NOTE]
    };
  };

  REPORT_BUILDERS['diagnosis-frequency'] = function (f) {
    var records = data('getMedicalRecords').filter(function (r) { return inRange(r.date, f.range); });
    // Same rule the existing dashboard used: trimmed text, blank / "None" ignored,
    // no merging of spelling variants.
    var diagnosed = records.filter(function (r) {
      var t = trimmed(r.diagnosis);
      return t && t.toLowerCase() !== 'none';
    });
    if (!diagnosed.length) return { hasData: false, stats: [], sections: [], notes: [] };

    var pairs = tally(diagnosed, function (r) { return trimmed(r.diagnosis); }).sort(byCountDesc);
    var rows = pairs.map(function (p, i) {
      return [i + 1, p[0], p[1], (p[1] / diagnosed.length * 100).toFixed(1) + '%'];
    });
    return {
      hasData: true,
      stats: [['Medical Records in Period', records.length], ['With a Diagnosis', diagnosed.length], ['Distinct Diagnoses', pairs.length]],
      sections: [docSection('Diagnoses', docTable(['#', 'Diagnosis', 'Cases', '% of Diagnosed Visits'], rows, { num: [0, 2, 3] }))],
      notes: ['Diagnoses are grouped by their exact recorded text; records with a blank diagnosis or "None" are excluded.']
    };
  };

  REPORT_BUILDERS['vaccination-summary'] = function (f) {
    var v = f.values;
    var list = data('getVaccinations').map(function (x) {
      return { rec: x, status: PCData.computeVaccinationStatus(x.nextDue) };
    }).filter(function (x) {
      if (!inRange(x.rec.dateGiven, f.range)) return false;
      if (v.vaccine && x.rec.vaccineName !== v.vaccine) return false;
      if (v.vaccinationStatus && x.status !== v.vaccinationStatus) return false;
      return true;
    }).sort(function (a, b) { return (a.rec.dateGiven || '').localeCompare(b.rec.dateGiven || ''); });

    if (!list.length) return { hasData: false, stats: [], sections: [], notes: [] };

    function patientName(x) {
      var p = x.rec.patientId ? PCData.getPatientById(x.rec.patientId) : null;
      return p ? p.pet + (p.owner ? ' (' + p.owner + ')' : '') : 'Unknown patient';
    }
    var rows = list.map(function (x) {
      return [fmtDate(x.rec.dateGiven), patientName(x), dash(x.rec.vaccineName), fmtDate(x.rec.nextDue), x.status];
    });
    return {
      hasData: true,
      stats: [['Vaccinations Given', list.length]],
      sections: [
        '<div class="rpt-doc-cols">' +
          breakdown('By Vaccine', 'Vaccine', tally(list, function (x) { return dash(x.rec.vaccineName); }).sort(byCountDesc)) +
          breakdown('By Status', 'Status', tally(list, function (x) { return x.status; }).sort(byCountDesc)) +
        '</div>',
        docSection('Vaccinations', docTable(['Date Given', 'Patient', 'Vaccine', 'Next Due', 'Status'], rows, { widths: [17, 22, 27, 17, 17] }))
      ],
      notes: ['Status is derived from each record\u2019s Next Due date (Overdue if past, Due soon within ' + (PCData.VACCINATION_DUE_SOON_DAYS || 30) + ' days, otherwise Up to date; Unknown if no Next Due date).']
    };
  };

  // ---- Inventory (current snapshot — never date-filtered) --------------

  function inventoryItems(v) {
    return data('getInventory').filter(function (i) {
      if (v.invCategory && i.category !== v.invCategory) return false;
      if (v.itemState && i.status !== v.itemState) return false;
      return true;
    });
  }
  function itemValue(i) { return (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0); }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function byCategoryName(a, b) { return String(a.category).localeCompare(String(b.category)) || String(a.name).localeCompare(String(b.name)); }

  var SNAPSHOT_NOTE = 'Current inventory snapshot. The system does not keep historical stock levels.';

  REPORT_BUILDERS['stock-summary'] = function (f) {
    var items = inventoryItems(f.values).sort(byCategoryName);
    if (!items.length) return { hasData: false, stats: [], sections: [], notes: [SNAPSHOT_NOTE], emptyText: NO_RESULTS_FILTERS };

    var total = 0;
    var rows = items.map(function (i) {
      total += itemValue(i);
      return [dash(i.name), dash(i.category), Number(i.quantity) || 0, dash(i.unit), fmtMoney(i.unitPrice), fmtMoney(itemValue(i)), i.expirationDate ? fmtDate(i.expirationDate) : 'Not tracked', cap(i.status)];
    });
    var active = items.filter(function (i) { return i.status === 'active'; }).length;
    return {
      hasData: true,
      stats: [['Items', items.length], ['Active', active], ['Inactive', items.length - active], ['Total Stock Value', fmtMoney(total)]],
      sections: [
        breakdown('By Category', 'Category', tally(items, function (i) { return dash(i.category); }).sort(byCountDesc)),
        docSection('Items', docTable(['Item', 'Category', 'Qty', 'Unit', 'Unit Price', 'Stock Value', 'Expires', 'Status'], rows,
          { num: [2, 4, 5], foot: ['Total', '', '', '', '', fmtMoney(total), '', ''] }))
      ],
      notes: [SNAPSHOT_NOTE, 'Stock Value = quantity \u00D7 unit price.']
    };
  };

  // Stock movement history is not recorded anywhere, so nothing is
  // reported and nothing is invented.
  REPORT_BUILDERS['stock-movement'] = function () {
    return { hasData: false, stats: [], sections: [], notes: ['Stock movement history is not available for this period.'] };
  };

  // Same rule the Inventory page uses for its Low filter: active items
  // only, PCData.isLowStock (quantity <= threshold). Out-of-stock items
  // are included and labelled as such.
  REPORT_BUILDERS['low-stock-report'] = function (f) {
    var items = data('getInventory').filter(function (i) {
      if (i.status !== 'active') return false;
      if (f.values.invCategory && i.category !== f.values.invCategory) return false;
      return PCData.isLowStock(i);
    }).sort(function (a, b) { return (Number(a.quantity) || 0) - (Number(b.quantity) || 0) || String(a.name).localeCompare(String(b.name)); });

    var note = 'Active items at or below their low-stock threshold, as of today.';
    if (!items.length) return { hasData: false, stats: [], sections: [], notes: [note], emptyText: NO_RESULTS_FILTERS };

    function level(i) { return (Number(i.quantity) || 0) === 0 ? 'Out of stock' : 'Low stock'; }
    var rows = items.map(function (i) {
      return [dash(i.name), dash(i.category), Number(i.quantity) || 0, dash(i.unit), Number(i.lowStockThreshold) || 0, level(i)];
    });
    var out = items.filter(function (i) { return level(i) === 'Out of stock'; }).length;
    return {
      hasData: true,
      stats: [['Items Needing Restock', items.length], ['Low Stock', items.length - out], ['Out of Stock', out]],
      sections: [docSection('Items', docTable(['Item', 'Category', 'Qty', 'Unit', 'Low-Stock Threshold', 'Level'], rows, { num: [2, 4] }))],
      notes: [note]
    };
  };

  // Blank expirationDate = expiry not tracked, never expired
  // (PCData.isExpired already enforces that).
  REPORT_BUILDERS['expired-items'] = function (f) {
    var today = PCData.parseDate(PCData.todayStr());
    var items = inventoryItems(f.values).filter(function (i) { return PCData.isExpired(i); })
      .sort(function (a, b) { return String(a.expirationDate).localeCompare(String(b.expirationDate)); });

    var note = 'Items whose expiration date is before today. Items with no expiration date are not tracked and are not treated as expired.';
    if (!items.length) return { hasData: false, stats: [], sections: [], notes: [note], emptyText: 'No results found.' };

    var total = 0;
    var rows = items.map(function (i) {
      total += itemValue(i);
      var days = Math.round((today - PCData.parseDate(i.expirationDate)) / 86400000);
      return [dash(i.name), dash(i.category), Number(i.quantity) || 0, dash(i.unit), fmtDate(i.expirationDate), days, cap(i.status)];
    });
    return {
      hasData: true,
      stats: [['Expired Items', items.length], ['Stock Value (qty \u00D7 unit price)', fmtMoney(total)]],
      sections: [
        breakdown('By Category', 'Category', tally(items, function (i) { return dash(i.category); }).sort(byCountDesc)),
        docSection('Items', docTable(['Item', 'Category', 'Qty', 'Unit', 'Expired On', 'Days Expired', 'Status'], rows, { num: [2, 5] }))
      ],
      notes: [note]
    };
  };

  // ---- Financial ------------------------------------------------------

  // Invoice + its display info (client/patient/vet with the store's own
  // legacy fallbacks) so every invoice-based report reads it one way.
  function invoiceRows(filterFn) {
    return data('getInvoices').map(function (inv) {
      return { inv: inv, info: PCData.getInvoiceDisplayInfo(inv) };
    }).filter(filterFn).sort(function (a, b) {
      return (a.inv.date || '').localeCompare(b.inv.date || '') || String(a.inv.invoiceNumber).localeCompare(String(b.inv.invoiceNumber));
    });
  }
  function invStatusLabel(s) { return (PCData.INVOICE_STATUS_LABELS || {})[s] || s || '\u2014'; }
  function sumAmount(list) { return list.reduce(function (s, x) { return s + (Number(x.inv.totalAmount) || 0); }, 0); }

  // Pairs of [label, count, amount] per invoice status.
  function statusAmounts(list) {
    var order = [], m = {};
    list.forEach(function (x) {
      var k = invStatusLabel(x.inv.status);
      if (!has(m, k)) { m[k] = [k, 0, 0]; order.push(k); }
      m[k][1]++; m[k][2] += Number(x.inv.totalAmount) || 0;
    });
    return order.map(function (k) { return m[k]; });
  }

  // Revenue = PAID invoices only (status 'paid'). Refunded, unpaid,
  // pending and rejected invoices are not revenue. Dated by invoice date.
  REPORT_BUILDERS['revenue-summary'] = function (f) {
    var v = f.values;
    var list = invoiceRows(function (x) {
      return x.inv.status === 'paid' && inRange(x.inv.date, f.range) && (!v.vet || x.info.vet === v.vet);
    });
    if (!list.length) return { hasData: false, stats: [], sections: [], notes: [] };

    var total = sumAmount(list);
    var discounts = list.reduce(function (s, x) { return s + (Number(x.info.discount) || 0); }, 0);
    var dateOrder = [], byDate = {};
    list.forEach(function (x) {
      var d = x.inv.date || '';
      if (!has(byDate, d)) { byDate[d] = [d ? fmtDate(d) : '\u2014', 0, 0]; dateOrder.push(d); }
      byDate[d][1]++; byDate[d][2] += Number(x.inv.totalAmount) || 0;
    });
    var vetOrder = [], byVet = {};
    list.forEach(function (x) {
      var k = dash(x.info.vet);
      if (!has(byVet, k)) { byVet[k] = [k, 0, 0]; vetOrder.push(k); }
      byVet[k][1]++; byVet[k][2] += Number(x.inv.totalAmount) || 0;
    });
    var vetRows = vetOrder.map(function (k) { return byVet[k]; }).sort(function (a, b) { return b[2] - a[2]; });

    return {
      hasData: true,
      stats: [['Paid Invoices', list.length], ['Total Revenue', fmtMoney(total)], ['Discounts Applied', fmtMoney(discounts)]],
      sections: [
        '<div class="rpt-doc-cols rpt-doc-cols--2">' +
          breakdown('Revenue by Veterinarian', 'Veterinarian', vetRows, 'Revenue') +
          breakdown('Revenue by Invoice Date', 'Date', dateOrder.map(function (d) { return byDate[d]; }), 'Revenue') +
        '</div>'
      ],
      notes: ['Revenue is the total of invoices with status Paid, dated by invoice date. Unpaid, pending verification, rejected and refunded invoices are not counted. Totals are after invoice discounts.']
    };
  };

  REPORT_BUILDERS['invoice-report'] = function (f) {
    var v = f.values;
    var list = invoiceRows(function (x) {
      if (!inRange(x.inv.date, f.range)) return false;
      if (v.invoiceStatus && x.inv.status !== v.invoiceStatus) return false;
      if (v.vet && x.info.vet !== v.vet) return false;
      return true;
    });
    if (!list.length) return { hasData: false, stats: [], sections: [], notes: [] };

    var sub = 0, disc = 0, tot = 0;
    var rows = list.map(function (x) {
      sub += Number(x.info.subtotal) || 0; disc += Number(x.info.discount) || 0; tot += Number(x.inv.totalAmount) || 0;
      return [dash(x.inv.invoiceNumber), fmtDate(x.inv.date), dash(x.info.owner), dash(x.info.pet), dash(x.info.vet),
        fmtMoney(x.info.subtotal), fmtMoney(x.info.discount), fmtMoney(x.inv.totalAmount), invStatusLabel(x.inv.status)];
    });
    return {
      hasData: true,
      stats: [['Invoices', list.length], ['Total of Listed Invoices', fmtMoney(tot)]],
      sections: [
        breakdown('By Status', 'Status', statusAmounts(list), 'Amount'),
        docSection('Invoices', docTable(['Invoice #', 'Date', 'Client', 'Patient', 'Veterinarian', 'Subtotal', 'Discount', 'Total', 'Status'], rows,
          { num: [5, 6, 7], foot: ['Total', '', '', '', '', fmtMoney(sub), fmtMoney(disc), fmtMoney(tot), ''] }))
      ],
      notes: ['The total includes every listed invoice regardless of status; see the status breakdown for how much of it is paid.']
    };
  };

  REPORT_BUILDERS['payment-report'] = function (f) {
    var v = f.values;
    var invNumbers = {};
    data('getInvoices').forEach(function (i) { invNumbers[i.id] = i.invoiceNumber; });
    var list = data('getPayments').filter(function (p) {
      if (!inRange(p.paymentDate, f.range)) return false;
      if (v.paymentMethod && p.method !== v.paymentMethod) return false;
      if (v.paymentStatus && p.status !== v.paymentStatus) return false;
      return true;
    }).sort(function (a, b) { return (a.paymentDate || '').localeCompare(b.paymentDate || '') || (a.createdAt || 0) - (b.createdAt || 0); });

    if (!list.length) return { hasData: false, stats: [], sections: [], notes: [] };

    var ml = PCData.PAYMENT_METHOD_LABELS || {};
    function method(p) { return ml[p.method] || p.method || '\u2014'; }
    function status(p) { return PAYMENT_STATUS_LABELS[p.status] || p.status || '\u2014'; }
    function amounts(keyFn) {
      var order = [], m = {};
      list.forEach(function (p) {
        var k = keyFn(p);
        if (!has(m, k)) { m[k] = [k, 0, 0]; order.push(k); }
        m[k][1]++; m[k][2] += Number(p.amount) || 0;
      });
      return order.map(function (k) { return m[k]; });
    }
    var total = list.reduce(function (s, p) { return s + (Number(p.amount) || 0); }, 0);
    var verified = list.filter(function (p) { return p.status === 'verified'; }).reduce(function (s, p) { return s + (Number(p.amount) || 0); }, 0);
    var rows = list.map(function (p) {
      return [fmtDate(p.paymentDate), dash(invNumbers[p.invoiceId]), method(p), dash(p.referenceNumber), fmtMoney(p.amount), status(p),
        p.reviewedBy ? p.reviewedBy + (p.reviewedAt ? ' (' + fmtDate(toIso(new Date(p.reviewedAt))) + ')' : '') : '\u2014'];
    });
    return {
      hasData: true,
      stats: [['Payments', list.length], ['Total Submitted', fmtMoney(total)], ['Verified Total', fmtMoney(verified)]],
      sections: [
        '<div class="rpt-doc-cols rpt-doc-cols--2">' +
          breakdown('By Method', 'Method', amounts(method), 'Amount') +
          breakdown('By Status', 'Status', amounts(status), 'Amount') +
        '</div>',
        docSection('Payments', docTable(['Payment Date', 'Invoice #', 'Method', 'Reference #', 'Amount', 'Status', 'Reviewed By'], rows,
          { num: [4], foot: ['Total', '', '', '', fmtMoney(total), '', ''] }))
      ],
      notes: ['Total Submitted includes payments still pending verification and rejected payments; Verified Total counts only verified payments.']
    };
  };

  // No partial-payment model exists, so an outstanding invoice's whole
  // totalAmount is outstanding. Outstanding = unpaid, pending
  // verification or rejected (never paid or refunded).
  REPORT_BUILDERS['outstanding-balances'] = function (f) {
    var v = f.values;
    var list = invoiceRows(function (x) {
      if (OUTSTANDING_STATUSES.indexOf(x.inv.status) === -1) return false;
      if (!inRange(x.inv.date, f.range)) return false;
      if (v.outstandingStatus && x.inv.status !== v.outstandingStatus) return false;
      if (v.vet && x.info.vet !== v.vet) return false;
      return true;
    });
    if (!list.length) return { hasData: false, stats: [], sections: [], notes: [] };

    var total = sumAmount(list);
    var rows = list.map(function (x) {
      return [dash(x.inv.invoiceNumber), fmtDate(x.inv.date), dash(x.info.owner), dash(x.info.pet), dash(x.info.vet), invStatusLabel(x.inv.status), fmtMoney(x.inv.totalAmount)];
    });
    return {
      hasData: true,
      stats: [['Outstanding Invoices', list.length], ['Total Outstanding', fmtMoney(total)]],
      sections: [
        breakdown('By Status', 'Status', statusAmounts(list), 'Amount'),
        docSection('Invoices', docTable(['Invoice #', 'Date', 'Client', 'Patient', 'Veterinarian', 'Status', 'Outstanding'], rows,
          { num: [6], foot: ['Total', '', '', '', '', '', fmtMoney(total)] }))
      ],
      notes: ['The system has no partial-payment tracking, so each invoice\u2019s full total is shown as outstanding.']
    };
  };

  // ---- Services -------------------------------------------------------

  // Only invoice lines that carry a serviceId count as service usage.
  // Category/name come from the Services store; quantity and unit price
  // are the values recorded on the invoice line.
  function serviceLines(f) {
    if (typeof PCData.getServiceById !== 'function') throw new Error('Required data store is not loaded (getServiceById).');
    var v = f.values;
    var groups = {}, order = [], unlinked = 0, invoiceCount = 0;
    data('getInvoices').forEach(function (inv) {
      if (!inRange(inv.date, f.range)) return;
      if (v.invoiceStatus && inv.status !== v.invoiceStatus) return;
      invoiceCount++;
      (inv.items || []).forEach(function (it) {
        if (!it.serviceId) { if (it.type === 'service') unlinked++; return; }
        var svc = PCData.getServiceById(it.serviceId);
        var category = svc ? svc.category : '';
        if (v.serviceCategory && category !== v.serviceCategory) return;
        if (v.service && it.serviceId !== v.service) return;
        var qty = Number(it.qty) || 0;
        var amount = qty * (Number(it.unitPrice) || 0);
        if (!has(groups, it.serviceId)) {
          groups[it.serviceId] = { name: svc ? svc.name : (it.name || 'Unknown service'), category: category || '\u2014', lines: 0, qty: 0, amount: 0 };
          order.push(it.serviceId);
        }
        var g = groups[it.serviceId];
        g.lines++; g.qty += qty; g.amount += amount;
      });
    });
    var rows = order.map(function (id) { return groups[id]; });
    var noFilter = !v.serviceCategory && !v.service;
    return { rows: rows, unlinked: noFilter ? unlinked : 0 };
  }

  function unlinkedNote(n) {
    return n ? [n + (n === 1 ? ' service-type invoice line' : ' service-type invoice lines') + ' not linked to a Service in the catalog ' + (n === 1 ? 'was' : 'were') + ' not counted.'] : [];
  }

  REPORT_BUILDERS['service-usage'] = function (f) {
    var res = serviceLines(f);
    var rows = res.rows.sort(function (a, b) { return b.qty - a.qty || a.name.localeCompare(b.name); });
    if (!rows.length) return { hasData: false, stats: [], sections: [], notes: unlinkedNote(res.unlinked) };

    var lines = 0, qty = 0;
    var body = rows.map(function (g) { lines += g.lines; qty += g.qty; return [g.name, g.category, g.lines, g.qty]; });
    return {
      hasData: true,
      stats: [['Services Billed', rows.length], ['Invoice Lines', lines], ['Total Quantity', qty]],
      sections: [docSection('Usage by Service', docTable(['Service', 'Category', 'Invoice Lines', 'Quantity Billed'], body, { num: [2, 3], foot: ['Total', '', lines, qty] }))],
      notes: ['Counts invoice line items linked to a Service, from invoices dated in the period' + (f.values.invoiceStatus ? '' : ' (all invoice statuses)') + '.'].concat(unlinkedNote(res.unlinked))
    };
  };

  REPORT_BUILDERS['service-revenue'] = function (f) {
    var res = serviceLines(f);
    var rows = res.rows.sort(function (a, b) { return b.amount - a.amount || a.name.localeCompare(b.name); });
    if (!rows.length) return { hasData: false, stats: [], sections: [], notes: unlinkedNote(res.unlinked) };

    var qty = 0, total = 0;
    var body = rows.map(function (g) { qty += g.qty; total += g.amount; return [g.name, g.category, g.qty, fmtMoney(g.amount)]; });
    return {
      hasData: true,
      stats: [['Services Billed', rows.length], ['Total Service Revenue', fmtMoney(total)]],
      sections: [docSection('Revenue by Service', docTable(['Service', 'Category', 'Quantity', 'Revenue'], body, { num: [2, 3], foot: ['Total', '', qty, fmtMoney(total)] }))],
      notes: ['Revenue = quantity \u00D7 the unit price recorded on each service-linked invoice line. Invoice-level discounts are not allocated to individual services, so these figures are before discounts.'].concat(unlinkedNote(res.unlinked))
    };
  };

  // ------------------------------------------------------------------
  // filter fields (only those listed in a report's `filters` are shown)
  // ------------------------------------------------------------------

  function opt(value, label) { return { value: value, label: label }; }
  function optsFromLabels(keys, labels) {
    return keys.map(function (k) { return opt(k, (labels && labels[k]) || k); });
  }
  function unionSorted(known, fromData) {
    var seen = {}, out = [];
    known.forEach(function (k) { if (k && !has(seen, k)) { seen[k] = 1; out.push(k); } });
    fromData.filter(Boolean).map(trimmed).filter(Boolean).sort().forEach(function (k) { if (!has(seen, k)) { seen[k] = 1; out.push(k); } });
    return out;
  }

  var FILTER_FIELDS = {
    apptStatus: { label: 'Status', options: function () { return optsFromLabels(PCData.STATUSES, PCData.STATUS_LABELS); } },
    vet: { label: 'Veterinarian', options: function () { return vetOptions().map(function (v) { return opt(v, v); }); } },
    apptType: { label: 'Appointment Type', options: function () {
      var appts = data('getAppointments');
      var list = unionSorted(PCData.APPOINTMENT_TYPES || [], appts.map(function (a) { return a.appointmentType; })).map(function (t) { return opt(t, t); });
      if (appts.some(function (a) { return !a.appointmentType; })) list.push(opt('__unspecified', 'Unspecified'));
      return list;
    } },
    visitType: { label: 'Visit Type', options: function () {
      return unionSorted(PCData.MED_VISIT_TYPES || [], data('getMedicalRecords').map(function (r) { return r.visitType; })).map(function (t) { return opt(t, t); });
    } },
    visitStatus: { label: 'Status', options: function () { return optsFromLabels(PCData.MED_STATUSES || [], PCData.MED_STATUS_LABELS); } },
    recordStatus: { label: 'Record Status', options: function () { return optsFromLabels(PCData.MED_STATUSES || [], PCData.MED_STATUS_LABELS); } },
    followUpStatus: { label: 'Follow-Up Status', options: function () { return [opt('upcoming', 'Upcoming'), opt('overdue', 'Overdue')]; } },
    vaccine: { label: 'Vaccine', options: function () {
      return unionSorted([], data('getVaccinations').map(function (x) { return x.vaccineName; })).map(function (t) { return opt(t, t); });
    } },
    vaccinationStatus: { label: 'Vaccination Status', options: function () {
      // computeVaccinationStatus never yields 'N/A', so it isn't offered.
      return (PCData.VACCINATION_STATUSES || []).filter(function (s) { return s !== 'N/A'; }).map(function (s) { return opt(s, s); });
    } },
    invCategory: { label: 'Category', options: function () {
      return unionSorted(PCData.INV_CATEGORIES || [], data('getInventory').map(function (i) { return i.category; })).map(function (t) { return opt(t, t); });
    } },
    itemState: { label: 'Item State', options: function () { return [opt('active', 'Active'), opt('inactive', 'Inactive')]; } },
    invoiceStatus: { label: 'Invoice Status', options: function () { return optsFromLabels(PCData.INVOICE_STATUSES || [], PCData.INVOICE_STATUS_LABELS); } },
    outstandingStatus: { label: 'Status', options: function () { return optsFromLabels(OUTSTANDING_STATUSES, PCData.INVOICE_STATUS_LABELS); } },
    paymentMethod: { label: 'Payment Method', options: function () { return optsFromLabels(PCData.PAYMENT_METHODS || [], PCData.PAYMENT_METHOD_LABELS); } },
    paymentStatus: { label: 'Payment Status', options: function () { return optsFromLabels(['pending-verification', 'verified', 'rejected'], PAYMENT_STATUS_LABELS); } },
    service: { label: 'Service', options: function () {
      return data('getServices').slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (s) { return opt(s.id, s.name); });
    } },
    serviceCategory: { label: 'Service Category', options: function () {
      if (typeof PCData.getServiceCategories !== 'function') throw new Error('Required data store is not loaded (getServiceCategories).');
      return PCData.getServiceCategories().map(function (c) { return opt(c, c); });
    } }
  };

  // Service Revenue counts money, so it starts on Paid invoices (matching
  // Revenue Summary); Expired Items starts on Active items (matching the
  // Inventory page). Everything else starts on "All".
  function filterDefault(reportId, key) {
    if (reportId === 'service-revenue' && key === 'invoiceStatus') return 'paid';
    if (reportId === 'expired-items' && key === 'itemState') return 'active';
    return '';
  }

  function optionLabel(key, value) {
    var list = FILTER_FIELDS[key].options();
    for (var i = 0; i < list.length; i++) if (list[i].value === value) return list[i].label;
    return value;
  }

  // ------------------------------------------------------------------
  // build a report model / validate / render print HTML
  // ------------------------------------------------------------------

  function validateValues(def, values) {
    if (def.filters.indexOf('date') === -1) return;
    // Phase 4C.5: the Start/End Date fields ARE the date range, so both are
    // always required for a report that supports dates.
    var bad = null;
    if (!isIsoDate(values.from) || !isIsoDate(values.to)) bad = 'Choose both a start date and an end date';
    else if (values.from > values.to) bad = 'The start date must be on or before the end date';
    if (bad) { var ve = new Error(bad); ve.isValidation = true; throw ve; }
  }

  function isIsoDate(v) {
    return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  }

  // The old "All Time" period had no dates. To show explicit dates while
  // keeping that behavior, it is expressed as the span of the dated records
  // the date-filtered reports read (earliest record -> today, or the latest
  // record if that is later). Purely a default for the Start/End fields.
  var DATE_SOURCES = [
    ['getAppointments', 'date'], ['getMedicalRecords', 'date'], ['getInvoices', 'date'],
    ['getPayments', 'paymentDate'], ['getVaccinations', 'dateGiven']
  ];
  function allTimeRange() {
    var today = PCData.todayStr();
    var min = null, max = today;
    function note(d) {
      if (!isIsoDate(d)) return;
      if (min === null || d < min) min = d;
      if (d > max) max = d;
    }
    DATE_SOURCES.forEach(function (src) {
      try {
        var list = typeof PCData[src[0]] === 'function' ? PCData[src[0]]() : [];
        (list || []).forEach(function (r) { if (r) note(r[src[1]]); });
      } catch (err) { /* a missing store just contributes nothing */ }
    });
    try { // Queue Activity dates a check-in from the appointment's arrivedAt
      var appts = typeof PCData.getAppointments === 'function' ? PCData.getAppointments() : [];
      (appts || []).forEach(function (a) {
        if (a && typeof a.arrivedAt === 'number' && a.arrivedAt > 0) note(toIso(new Date(a.arrivedAt)));
      });
    } catch (err) { /* ignore */ }
    return { start: min || today, end: max };
  }

  function rangeLabel(period, range) {
    if (!range) return 'All Time';
    var text = range.start === range.end ? fmtDate(range.start) : fmtDate(range.start) + ' \u2013 ' + fmtDate(range.end);
    var names = { today: 'Today', week: 'This Week', month: 'This Month' };
    return names[period] ? names[period] + ' (' + text + ')' : text;
  }

  // Print-only Report Scope wording. `basis` = which record date the range
  // is applied to (matches what each builder filters on); `current` = the
  // scope of a report that has no date range and describes present state.
  var SCOPE_INFO = {
    'appointment-summary':  { basis: 'By appointment date' },
    'daily-clinic-activity': { basis: 'By record date' },
    'queue-performance':    { basis: 'By check-in date' },
    'patient-visits':       { basis: 'By visit date' },
    'diagnosis-frequency':  { basis: 'By visit date' },
    'vaccination-summary':  { basis: 'By date given' },
    'follow-up-report':     { basis: 'By follow-up date' },
    'revenue-summary':      { basis: 'By invoice date' },
    'invoice-report':       { basis: 'By invoice date' },
    'payment-report':       { basis: 'By payment date' },
    'outstanding-balances': { basis: 'By invoice date' },
    'service-usage':        { basis: 'By invoice date' },
    'service-revenue':      { basis: 'By invoice date' },
    'stock-summary':        { current: 'Current Inventory' },
    'low-stock-report':     { current: 'Current Low-Stock Items' },
    'expired-items':        { current: 'Current Expired Items' }
  };

  function buildReportModel(reportId, values) {
    var def = getDef(reportId);
    if (!def) throw new Error('Unknown report: ' + reportId);
    var builder = REPORT_BUILDERS[reportId];
    if (typeof builder !== 'function') throw new Error('No generator is registered for "' + def.name + '".');
    values = values || {};
    validateValues(def, values);

    var hasDate = def.filters.indexOf('date') !== -1;
    // Phase 4C.5: the range is exactly the Start/End Date the user chose
    // (inclusive, same inRange() semantics as before). "custom" is only the
    // label id for an explicit range; it no longer comes from a Period control.
    var period = 'custom';
    var range = hasDate ? { start: values.from, end: values.to } : null;

    var model = builder({ id: reportId, values: values, range: range, period: period });
    model.title = def.name;
    model.periodId = period;   // Phase 4B: read by the Recent Reports log
    model.dateRange = range;
    model.periodLabel = hasDate ? rangeLabel(period, range) + (def.dateBasis ? ' (by ' + def.dateBasis + ')' : '') : 'Not applicable \u2014 current snapshot as of ' + fmtDate(PCData.todayStr());
    model.category = def.category;
    var si = SCOPE_INFO[reportId] || {};                    // print only: Report Scope wording
    model.scopeBasis = hasDate ? (si.basis || '') : '';
    model.scopeCurrent = hasDate ? '' : (si.current || '');
    // Only the filters the user actually selected (label + display value).
    model.filterItems = def.filters.filter(function (k) { return k !== 'date' && values[k]; }).map(function (k) {
      return [FILTER_FIELDS[k].label, optionLabel(k, values[k])];
    });
    model.filterText = model.filterItems.map(function (p) { return p[0] + ': ' + p[1]; }).join(' \u00B7 ') || 'None';
    if (!model.emptyText) model.emptyText = NO_RESULTS_PERIOD;
    return model;
  }

  // Phase 4D — print document. Same document language as the Billing
  // print (header with logo + wordmark, teal rules, mint summary tiles,
  // soft-teal table headers, teal footer rule). Presentation only: the
  // model (stats / sections / notes / emptyText) comes from the builders
  // unchanged.
  function printIcon(name) {
    return '<i class="fa-solid fa-' + name + ' rpt-doc-ico" aria-hidden="true"></i>';
  }
  // ---- document details ---------------------------------------------
  // Generated By: the app has no signed-in user yet (Billing also defaults
  // to the Administrator), so this is the one place to change when it does.
  var CURRENT_USER_LABEL = 'Admin';

  // Report ID: RPT-YYYYMMDD-###. The ### counts reports printed that day.
  // It lives in its own small localStorage key, so the Recent Reports
  // history schema (and its rh_ ids) is untouched; the internal id is never
  // printed. If storage is unavailable a time-of-day number is used instead.
  var REPORT_SEQ_KEY = 'pc_report_seq';
  function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }
  function reportDateStamp(d) { return d.getFullYear() + pad(d.getMonth() + 1, 2) + pad(d.getDate(), 2); }
  function reportNoFrom(d, n) { return 'RPT-' + reportDateStamp(d) + '-' + pad(n, 3); }
  function timeOfDaySeq(d) { return ((d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) % 999) + 1; }
  function nextReportNo(d) {
    var stamp = reportDateStamp(d), n = 0;
    try {
      var cur = JSON.parse(window.localStorage.getItem(REPORT_SEQ_KEY) || 'null');
      n = (cur && cur.date === stamp && typeof cur.n === 'number' && cur.n > 0 ? Math.floor(cur.n) : 0) + 1;
      window.localStorage.setItem(REPORT_SEQ_KEY, JSON.stringify({ date: stamp, n: n }));
    } catch (err) { n = timeOfDaySeq(d); }
    return reportNoFrom(d, n);
  }

  function fmtGenerated(d) {
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) + ' \u2022 ' +
      d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function detailItem(label, value) {
    return '<div class="rpt-doc-detail"><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>';
  }

  function scopeItem(label, value, sub, wide) {
    return '<div class="rpt-doc-scope-item' + (wide ? ' rpt-doc-scope-item--wide' : '') + '"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong>' +
      (sub ? '<em>' + esc(sub) + '</em>' : '') + '</div>';
  }

  // Report Scope: one panel describing what THIS report covers. Date
  // reports show the chosen range (+ which date field it applies to);
  // reports without a range show a report-specific description. Nothing is
  // derived from today's date. Only filters the user selected are listed.
  function scopeDate(iso) {
    var d = PCData.parseDate(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  }
  function renderScope(m) {
    var filterItems = Array.isArray(m.filterItems) ? m.filterItems : [];
    var lead = '', grid = '';
    if (m.dateRange) {
      var r = m.dateRange;
      var rangeText = r.start === r.end ? scopeDate(r.start) : scopeDate(r.start) + ' \u2014 ' + scopeDate(r.end);
      grid += scopeItem('Date Range', rangeText, m.scopeBasis, true);
    } else if (m.scopeCurrent) {
      lead = '<p class="rpt-doc-scope-note">' + esc(m.scopeCurrent) + '</p>';
    }
    grid += filterItems.map(function (p) { return scopeItem(p[0], p[1]); }).join('');
    return '<section class="rpt-doc-scope"><div class="rpt-doc-label">Report Scope</div>' + lead +
      (grid ? '<div class="rpt-doc-scope-grid">' + grid + '</div>' : '') + '</section>';
  }

  function renderSummary(stats) {
    var cols = Math.min(stats.length, 5);
    return '<section class="rpt-doc-summary"><div class="rpt-doc-label">Summary</div>' +
      '<div class="rpt-doc-stats" style="grid-template-columns:repeat(' + cols + ',minmax(0,1fr))">' + stats.map(function (s) {
        return '<div class="rpt-doc-stat"><div class="rpt-doc-stat-value">' + esc(s[1]) + '</div><div class="rpt-doc-stat-label">' + esc(s[0]) + '</div></div>';
      }).join('') + '</div></section>';
  }

  // m.generatedAt / m.reportNo are set by onGenerateSubmit; the fallbacks
  // only matter when this is called directly (the inspection hook).
  function renderPrintHtml(m) {
    var now = new Date(typeof m.generatedAt === 'number' ? m.generatedAt : Date.now());
    var reportNo = m.reportNo || reportNoFrom(now, timeOfDaySeq(now));
    var hasDate = !!m.dateRange;

    var body;
    if (m.hasData) {
      body = (m.stats.length ? renderSummary(m.stats) : '') + m.sections.join('');
    } else {
      // Complete, factual empty document: no zero statistics, no invented data.
      var emptyMsg = (m.emptyText && m.emptyText !== NO_RESULTS_PERIOD) ? m.emptyText
        : (hasDate ? 'There is no data to report for the selected period.' : 'There is no data to report for the selected filters.');
      body =
        '<section class="rpt-doc-sec rpt-doc-emptybox">' +
          '<div class="rpt-doc-section-head">' + printIcon('circle-info') + '<div class="rpt-doc-label">No Results Found</div></div>' +
          '<p class="rpt-doc-empty">' + esc(emptyMsg) + '</p>' +
        '</section>';
    }
    var notes = m.notes.length
      ? '<div class="rpt-doc-notes"><div class="rpt-doc-label rpt-doc-label--sm">Notes</div>' + m.notes.map(function (n) { return '<p>' + esc(n) + '</p>'; }).join('') + '</div>'
      : '';

    // The footer (clinic name, "Internal Use Only", page number) is drawn by
    // the @page margin boxes in reports.html, so it repeats on every page
    // with the real page number. No generated time is printed there.
    return (
      '<div class="rpt-doc">' +
        '<div class="rpt-doc-header">' +
          '<div class="rpt-doc-logo-box"><img class="rpt-doc-logo" src="img/LOGO.png" alt="Pawsitive Care logo"></div>' +
          '<div class="rpt-doc-wordmark-box"><img class="rpt-doc-wordmark" src="img/WORDMARK.png" alt="Pawsitive Care Veterinary Clinic"></div>' +
        '</div>' +
        '<div class="rpt-doc-titleblock">' +
          (m.category ? '<div class="rpt-doc-kicker">' + esc(m.category) + ' Report</div>' : '') +
          '<h1 class="rpt-doc-title">' + esc(m.title.toUpperCase()) + '</h1>' +
        '</div>' +
        '<dl class="rpt-doc-details">' +
          detailItem('Report ID', reportNo) +
          detailItem('Generated', fmtGenerated(now)) +
          detailItem('Generated By', m.generatedBy || CURRENT_USER_LABEL) +
        '</dl>' +
        renderScope(m) +
        body +
        notes +
      '</div>'
    );
  }

  // ------------------------------------------------------------------
  // Generate Report modal
  // A fresh overlay is built on open and removed on close, so its
  // listeners can never pile up. The only document-level listener (Escape
  // + Tab focus trap) is registered once, in initGenerate().
  // ------------------------------------------------------------------

  var gen = { overlay: null, reportId: '', category: '', values: {}, opener: null };
  var genInitialised = false;

  function genDefaults(reportId) {
    var dflt = allTimeRange(); // the old "All Time" default, as explicit dates
    var v = { from: gen.values.from || dflt.start, to: gen.values.to || dflt.end };
    var def = getDef(reportId);
    if (def) def.filters.forEach(function (k) { if (k !== 'date') v[k] = filterDefault(reportId, k); });
    return v;
  }

  function genSetError(msg) {
    var el = document.getElementById('rpt-gen-error');
    if (el) el.textContent = msg || '';
  }

  function selectHtml(id, key, options, selected, allLabel) {
    var opts = (allLabel ? '<option value="">' + esc(allLabel) + '</option>' : '') + options.map(function (o) {
      return '<option value="' + esc(o.value) + '"' + (o.value === selected ? ' selected' : '') + '>' + esc(o.label) + '</option>';
    }).join('');
    return '<select id="' + id + '" data-filter="' + key + '">' + opts + '</select>';
  }

  // Same field structure as the Inventory modal: .form-field (label + control)
  // inside a .form-grid; `full` spans both columns.
  function fieldHtml(label, forId, control, full) {
    return '<div class="form-field' + (full ? ' full' : '') + '"><label for="' + forId + '">' + esc(label) + '</label>' + control + '</div>';
  }

  function dateFieldsHtml() {
    var v = gen.values;
    return (
      '<div class="form-field full rpt-gen-daterange">' +
        '<label for="rpt-gen-from">Date Range</label>' +
        '<div class="rpt-gen-daterow">' +
          '<input type="date" id="rpt-gen-from" data-filter="from" aria-label="Start date" value="' + esc(v.from) + '">' +
          '<span class="rpt-gen-dash" aria-hidden="true">\u2014</span>' +
          '<input type="date" id="rpt-gen-to" data-filter="to" aria-label="End date" value="' + esc(v.to) + '">' +
        '</div>' +
      '</div>'
    );
  }

  function renderGenFilters() {
    var box = document.getElementById('rpt-gen-filters');
    var descEl = document.getElementById('rpt-gen-desc');
    if (!box) return;
    var def = getDef(gen.reportId);
    if (descEl) descEl.textContent = def ? def.description : '';
    if (!def) { box.innerHTML = '<p class="rpt-gen-hint">Choose a report to see its filters.</p>'; return; }

    var hasDate = def.filters.indexOf('date') !== -1;
    var others = def.filters.filter(function (k) { return k !== 'date'; });
    var html = '';
    if (hasDate) html += dateFieldsHtml();
    if (hasDate && def.dateBasis) html += '<p class="rpt-gen-hint">The date range applies to the ' + esc(def.dateBasis) + '.</p>';
    else html += '<p class="rpt-gen-hint">This report shows the current inventory as of today and is not filtered by date.</p>';
    if (others.length) {
      html += '<div class="rpt-gen-subhead">Optional Filters</div>' + others.map(function (k) {
        var field = FILTER_FIELDS[k];
        return fieldHtml(field.label, 'rpt-gen-' + k, selectHtml('rpt-gen-' + k, k, field.options(), gen.values[k], 'All ' + pluralLabel(field.label)));
      }).join('');
    }
    box.innerHTML = html;
  }

  // "All Veterinarians", "All Services", "All Statuses" ... for the empty option.
  function pluralLabel(label) {
    if (/y$/.test(label)) return label.replace(/y$/, 'ies');
    if (/s$/.test(label)) return label + 'es';
    return label + 's';
  }

  // Report options for the chosen category ('' = every category, grouped).
  function reportOptionsHtml(category, selectedId) {
    function optionFor(r) {
      return '<option value="' + esc(r.id) + '"' + (r.id === selectedId ? ' selected' : '') + '>' + esc(r.name) + '</option>';
    }
    var head = '<option value="">Select a report\u2026</option>';
    if (category) {
      return head + REPORT_DEFINITIONS.filter(function (r) { return r.category === category; }).map(optionFor).join('');
    }
    return head + REPORT_CATEGORIES.map(function (c) {
      return '<optgroup label="' + esc(c.name) + '">' + REPORT_DEFINITIONS.filter(function (r) { return r.category === c.name; }).map(optionFor).join('') + '</optgroup>';
    }).join('');
  }

  // fromReport: a report was just chosen (or restored), so the category
  // follows it. When only the category changed, the category stays as picked.
  function syncGenSelects(fromReport) {
    var def = getDef(gen.reportId);
    if (fromReport && def) gen.category = def.category;
    var cat = document.getElementById('rpt-gen-category');
    if (cat) cat.value = gen.category;
    var sel = document.getElementById('rpt-gen-report');
    if (sel) sel.innerHTML = reportOptionsHtml(gen.category, gen.reportId);
  }

  // presetValues (Phase 4C, Generate Again) replaces the defaults with a
  // restored set of values; every other caller keeps the original behavior.
  function setGenReport(reportId, presetValues) {
    gen.reportId = reportId || '';
    gen.values = presetValues || genDefaults(gen.reportId); // default: keeps the chosen dates, resets every other filter
    syncGenSelects(true);
    genSetError('');
    try { renderGenFilters(); } catch (err) { console.error(err); genSetError('Could not load filters: ' + err.message); }
  }

  function openGenerateModal(reportId, presetValues) {
    var target = reportId && getDef(reportId) ? reportId : '';
    if (gen.overlay) { // already open: just retarget it
      if (target) setGenReport(target, presetValues);
      var s = document.getElementById('rpt-gen-report');
      if (s) s.focus();
      return;
    }

    gen.opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    var initial = allTimeRange();
    gen.values = { from: initial.start, to: initial.end };
    gen.category = '';

    var categoryOpts = '<option value="">All Categories</option>' + REPORT_CATEGORIES.map(function (c) {
      return '<option value="' + esc(c.name) + '">' + esc(c.name) + '</option>';
    }).join('');

    var overlay = document.createElement('div');
    overlay.id = 'rpt-gen-overlay';
    overlay.setAttribute('data-rpt-overlay', '1');
    var box = document.createElement('div');
    box.className = 'rpt-gen-modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'rpt-gen-title');
    box.innerHTML =
      '<div class="modal-head">' +
        '<h3 class="modal-title" id="rpt-gen-title">Generate Report</h3>' +
        '<button type="button" class="modal-close" id="rpt-gen-close" aria-label="Close"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>' +
      '</div>' +
      '<form id="rpt-gen-form" novalidate>' +
        '<div class="rpt-gen-body">' +
          '<div class="form-grid">' +
            fieldHtml('Report Category', 'rpt-gen-category', '<select id="rpt-gen-category">' + categoryOpts + '</select>') +
            fieldHtml('Report', 'rpt-gen-report', '<select id="rpt-gen-report">' + reportOptionsHtml('', '') + '</select>') +
          '</div>' +
          '<p class="rpt-gen-desc" id="rpt-gen-desc"></p>' +
          '<div id="rpt-gen-filters" class="form-grid"></div>' +
        '</div>' +
        '<div id="rpt-gen-error" class="rpt-gen-error" role="alert"></div>' +
        '<div class="modal-footer">' +
          '<button type="button" class="btn" id="rpt-gen-cancel">Cancel</button>' +
          '<button type="submit" class="btn btn-primary" id="rpt-gen-submit">Generate Report</button>' +
        '</div>' +
      '</form>';
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    gen.overlay = overlay;

    document.getElementById('rpt-gen-close').addEventListener('click', closeGenerateModal);
    document.getElementById('rpt-gen-cancel').addEventListener('click', closeGenerateModal);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeGenerateModal(); });
    document.getElementById('rpt-gen-form').addEventListener('submit', onGenerateSubmit);
    document.getElementById('rpt-gen-report').addEventListener('change', function (e) { setGenReport(e.target.value); });
    document.getElementById('rpt-gen-category').addEventListener('change', function (e) {
      gen.category = e.target.value;
      var cur = getDef(gen.reportId);
      // The Report list narrows to the category. A report from another
      // category is cleared (its filters reset, chosen dates are kept).
      if (cur && gen.category && cur.category !== gen.category) setGenReport('');
      else syncGenSelects();
    });
    document.getElementById('rpt-gen-filters').addEventListener('change', function (e) {
      var el = e.target.closest ? e.target.closest('[data-filter]') : null;
      if (!el) return;
      gen.values[el.getAttribute('data-filter')] = el.value;
      genSetError('');
    });

    setGenReport(target, presetValues);
    (target ? document.getElementById('rpt-gen-from') || document.getElementById('rpt-gen-submit') : document.getElementById('rpt-gen-category')).focus();
  }

  function closeGenerateModal() {
    if (!gen.overlay) return;
    if (gen.overlay.parentNode) gen.overlay.parentNode.removeChild(gen.overlay);
    gen.overlay = null;
    var opener = gen.opener;
    gen.opener = null;
    if (opener && document.body.contains(opener) && typeof opener.focus === 'function') opener.focus();
  }

  // ------------------------------------------------------------------
  // print branding images (logo + wordmark)
  // ------------------------------------------------------------------
  // The printed header uses two local images. They are requested once (at
  // page load, so they are already in the browser cache long before the
  // first print), kept referenced so the decoded copies stay reusable, and
  // printing waits for the images to actually be loaded + decoded - never
  // for a fixed delay. When they are already cached this resolves on the
  // next microtask, so there is no noticeable wait.
  var PRINT_IMAGE_SRCS = ['img/LOGO.png', 'img/WORDMARK.png'];
  var printImageRefs = [];
  var printImagesPromise = null;

  function loadPrintImage(src) {
    return new Promise(function (resolve) {
      var img = new Image();
      printImageRefs.push(img);
      function done(ok) { resolve(ok); }
      img.onload = function () {
        if (typeof img.decode === 'function') img.decode().then(function () { done(true); }, function () { done(true); });
        else done(true);
      };
      img.onerror = function () { done(false); }; // never block printing on a missing image
      img.src = src;
    });
  }

  function loadPrintImages() {
    if (!printImagesPromise) {
      printImagesPromise = Promise.all(PRINT_IMAGE_SRCS.map(loadPrintImage)).then(function (results) {
        if (results.indexOf(false) !== -1) { printImagesPromise = null; printImageRefs = []; } // retry next time
      });
    }
    return printImagesPromise;
  }

  // Resolves once the branding is preloaded AND the <img> elements inside
  // the print container (same URLs, so cache hits) are loaded/decoded.
  function printImagesReady(container) {
    return loadPrintImages().then(function () {
      var imgs = container ? container.querySelectorAll('img') : [];
      return Promise.all(Array.prototype.map.call(imgs, function (im) {
        if (im.complete) return typeof im.decode === 'function' ? im.decode().catch(function () {}) : null;
        return new Promise(function (r) { im.addEventListener('load', r); im.addEventListener('error', r); });
      }));
    });
  }

  function onGenerateSubmit(e) {
    e.preventDefault();
    genSetError('');
    var container = document.getElementById('rpt-print-report');
    var historyRecord = null;
    try {
      if (!gen.reportId) { genSetError('Select a report to generate.'); return; }
      if (!container) throw new Error('The print area is missing from this page.');
      container.innerHTML = '';

      // Read the live control values (not just cached ones) so nothing is stale.
      var values = {};
      Array.prototype.forEach.call(document.querySelectorAll('#rpt-gen-filters [data-filter]'), function (el) {
        values[el.getAttribute('data-filter')] = el.value;
      });

      var model = buildReportModel(gen.reportId, values);
      var generatedAt = Date.now();
      model.generatedAt = generatedAt;                          // print only
      model.reportNo = nextReportNo(new Date(generatedAt));     // print only (not the rh_ history id)
      container.innerHTML = renderPrintHtml(model);
      // Phase 4B: prepared here, but only SAVED after the report has actually
      // been handed to window.print(). Never throws (returns null on trouble).
      historyRecord = buildHistoryRecord(gen.reportId, values, model, generatedAt);
    } catch (err) {
      if (container) container.innerHTML = '';
      if (err && err.isValidation) { genSetError(err.message + '.'); return; } // user input problem, not a fault
      console.error('Report generation failed:', err);
      genSetError('Could not generate this report: ' + (err && err.message ? String(err.message).replace(/\.$/, '') : 'unexpected error') + '.');
      return;
    }
    closeGenerateModal();
    // Print as soon as the branding images are really ready (immediately
    // when already cached), then log the history entry as before.
    function printNow() {
      window.print();
      // Reaching this line means the report was built and printed without
      // error. A valid "No results found" report counts as a success.
      if (historyRecord) saveHistoryRecord(historyRecord);
    }
    printImagesReady(container).then(printNow, printNow);
  }

  function onGenKeydown(e) {
    if (!gen.overlay || e.isComposing) return;
    if (e.key === 'Escape' || e.key === 'Esc') {
      e.preventDefault();
      closeGenerateModal();
      return;
    }
    if (e.key === 'Tab') { // keep focus inside the modal (aria-modal)
      var box = gen.overlay.querySelector('.rpt-gen-modal');
      var all = box.querySelectorAll('button, input, select, textarea, a[href]');
      var items = [];
      for (var i = 0; i < all.length; i++) { if (!all[i].disabled && all[i].offsetParent !== null) items.push(all[i]); }
      if (!items.length) return;
      var first = items[0], last = items[items.length - 1], active = document.activeElement;
      if (e.shiftKey && (active === first || !box.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !box.contains(active))) { e.preventDefault(); first.focus(); }
    }
  }

  function initGenerate() {
    if (genInitialised) return;
    genInitialised = true;
    document.addEventListener('keydown', onGenKeydown);
  }

  // Entry point for both the top "+ Generate Report" button (null) and a
  // row's Generate button (that report's id). Still announces the request
  // on the Phase 2 'reports:generate' event for any external listener.
  function openGenerateReport(reportId, presetValues) {
    document.dispatchEvent(new CustomEvent('reports:generate', { detail: { reportId: reportId || null } }));
    try {
      openGenerateModal(reportId, presetValues);
    } catch (err) {
      console.error('Could not open the Generate Report modal:', err);
      window.alert('Could not open the Generate Report dialog: ' + err.message);
    }
  }

  // ==================================================================
  // PHASE 4B — RECENT REPORTS HISTORY
  //
  // One localStorage key holds an array (newest first, max 20) of small
  // records describing each successful generation. Nothing about the
  // report's content is stored — only what is needed to identify it and
  // the settings used:
  //   { id, reportId, title, category, generatedAt (ms),
  //     period ('all'|'today'|'week'|'month'|'custom', null when the report
  //     has no date filter), dateRange ({start,end} ISO dates | null),
  //     filters: [{ key, value, label, valueLabel }] }   // selected only
  // REPORT_DEFINITIONS remains the single source of truth: records only
  // reference its ids, and fall back to their stored title/category if a
  // definition ever disappears. Storage failures never affect generation.
  // ==================================================================

  var HISTORY_KEY = 'pawsitive_reports_history';
  var HISTORY_MAX = 20;
  var RECENT_DISPLAY_MAX = 4; // landing page shows only the newest 4; storage still keeps HISTORY_MAX
  var recentEmptyHtml = null; // the Phase 4A empty state, captured from reports.html

  function isHistoryRecord(r) {
    return !!r && typeof r === 'object' &&
      typeof r.id === 'string' && r.id !== '' &&
      typeof r.reportId === 'string' && r.reportId !== '' &&
      typeof r.generatedAt === 'number' && isFinite(r.generatedAt);
  }

  // Always returns a usable array. Unreadable storage -> []. Corrupt
  // value (bad JSON / not an array) -> reset to [] and return []. Bad
  // entries inside an otherwise valid array are simply skipped.
  function readHistory() {
    var raw;
    try { raw = window.localStorage.getItem(HISTORY_KEY); } catch (err) { return []; }
    if (raw === null) return [];
    var parsed = null;
    try { parsed = JSON.parse(raw); } catch (err) { parsed = null; }
    if (!Array.isArray(parsed)) {
      try { window.localStorage.setItem(HISTORY_KEY, '[]'); } catch (err) { /* ignore */ }
      return [];
    }
    return parsed.filter(isHistoryRecord)
      .sort(function (a, b) { return b.generatedAt - a.generatedAt; })
      .slice(0, HISTORY_MAX);
  }

  function historyUid() {
    return 'rh_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function buildHistoryRecord(reportId, values, model, generatedAt) {
    try {
      var def = getDef(reportId);
      if (!def) return null;
      var hasDate = def.filters.indexOf('date') !== -1;
      var filters = [];
      def.filters.forEach(function (k) {
        if (k === 'date' || !values[k]) return; // only filters that were actually selected
        filters.push({ key: k, value: values[k], label: FILTER_FIELDS[k].label, valueLabel: optionLabel(k, values[k]) });
      });
      return {
        id: historyUid(),
        reportId: def.id,
        title: def.name,
        category: def.category,
        generatedAt: generatedAt,
        // Phase 4C.5: dateRange is the source of truth; period is kept only
        // so older code paths / records stay shaped the same ('custom' = explicit dates).
        period: hasDate ? (model.periodId || 'custom') : null,
        dateRange: hasDate && model.dateRange ? { start: model.dateRange.start, end: model.dateRange.end } : null,
        filters: filters
      };
    } catch (err) {
      console.warn('Could not prepare the Recent Reports entry:', err);
      return null;
    }
  }

  function saveHistoryRecord(record) {
    try {
      var list = readHistory();
      list.unshift(record);
      list.sort(function (a, b) { return b.generatedAt - a.generatedAt; }); // stable: a same-millisecond newcomer stays first
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)));
    } catch (err) {
      console.warn('Could not save the Recent Reports entry:', err); // e.g. storage full / blocked
    }
    recentMessage('');
    renderRecentReports();
  }

  function historyPeriodText(r) {
    if (r.period === null || r.period === undefined) return 'Current snapshot';
    var range = r.dateRange && typeof r.dateRange.start === 'string' && typeof r.dateRange.end === 'string' ? r.dateRange : null;
    if (!range && r.period !== 'all') return 'Date range unavailable';
    return rangeLabel(r.period, range);
  }

  function historyFilterText(r) {
    if (!Array.isArray(r.filters)) return '';
    return r.filters.filter(function (f) { return f && typeof f.label === 'string' && typeof f.valueLabel === 'string' && f.valueLabel; })
      .map(function (f) { return f.label + ': ' + f.valueLabel; })
      .join(' \u00B7 ');
  }

  function historyTimeText(ms) {
    // Two lines: date on top, time (AM/PM attached) below. Returns safe HTML.
    try {
      return '<span class="rpt-item-when"><span>' + esc(fmtDate(toIso(new Date(ms)))) + '</span>' +
        '<span>' + esc(fmtTimeOfDay(ms)) + '</span></span>';
    } catch (err) { return esc(new Date(ms).toLocaleString()); }
  }

  function historyItemHtml(r) {
    var def = getDef(r.reportId); // null for a report that no longer exists
    var title = def ? def.name : (typeof r.title === 'string' && r.title ? r.title : r.reportId);
    var category = def ? def.category : (typeof r.category === 'string' && r.category ? r.category : 'Report');
    var icon = def ? def.icon : categoryMeta(category).icon;
    var period, when;
    try { period = historyPeriodText(r); } catch (err) { period = ''; }
    when = historyTimeText(r.generatedAt);
    var filterText = historyFilterText(r);
    var desc = [period, filterText].filter(Boolean).join(' \u00B7 ');
    var action = def
      ? '<button type="button" class="btn btn-sm" data-generate-again="' + esc(r.id) + '" aria-label="Generate ' + esc(title) + ' again">' +
          'Generate Again <i class="fa-solid fa-rotate-right" aria-hidden="true"></i></button>'
      : '<button type="button" class="btn btn-sm" data-generate-again="' + esc(r.id) + '" disabled title="This report is no longer available" aria-label="Generate ' + esc(title) + ' again (this report is no longer available)">Generate Again</button>';
    return (
      '<div class="rpt-item" role="listitem" data-history-id="' + esc(r.id) + '">' +
        '<div class="rpt-item-icon"><i class="fa-solid ' + esc(icon) + '" aria-hidden="true"></i></div>' +
        '<div class="rpt-item-body">' +
          '<div class="rpt-item-name">' + esc(title) + '</div>' +
          (desc ? '<div class="rpt-item-desc">' + esc(desc) + '</div>' : '') +
          '<div class="rpt-item-meta"><i class="fa-solid ' + esc(categoryMeta(category).icon) + '" aria-hidden="true"></i> ' + esc(category) +
            ' \u00B7 <i class="fa-regular fa-clock" aria-hidden="true"></i> ' + when +
            (def ? '' : ' \u00B7 No longer available') + '</div>' +
        '</div>' +
        '<div class="rpt-item-action">' + action + '</div>' +
      '</div>'
    );
  }

  function renderRecentReports() {
    var el = document.getElementById('rpt-recent-list');
    if (!el) return;
    if (recentEmptyHtml === null) recentEmptyHtml = el.innerHTML;
    var hadFocus = !!(document.activeElement && el.contains(document.activeElement));

    // Recent Reports only exists on the "All" view, and never when the
    // library has no matches. With a search active, only matching records show.
    var section = el.closest('.rpt-group--recent');
    var q = state.search;
    var records = readHistory();
    if (q) {
      records = records.filter(function (r) {
        var def = getDef(r.reportId);
        return matchesSearch(
          def ? def.name : r.title,
          def ? def.description : '',
          def ? def.category : r.category,
          q);
      });
    }
    var showRecent = state.category === 'All' && getVisibleReports().length > 0 && (!q || records.length > 0);
    if (section) section.hidden = !showRecent;
    if (!showRecent) return;

    var items = [];
    records.slice(0, RECENT_DISPLAY_MAX).forEach(function (r) {
      try { items.push(historyItemHtml(r)); }
      catch (err) { console.warn('Skipped an unreadable Recent Reports entry:', err); }
    });
    el.innerHTML = items.length
      ? '<div class="rpt-group" role="list" aria-label="Recent reports">' + items.join('') + '</div>'
      : recentEmptyHtml;
    if (hadFocus) { // the focused row button was just replaced; hand focus to the newest row's action
      var next = el.querySelector('[data-generate-again]:not([disabled])');
      if (next) next.focus();
    }
  }

  // ------------------------------------------------------------------
  // Phase 4C — Generate Again
  // Turns a stored record back into the modal's own value shape
  // ({ from, to, <filterKey>: value }) and opens the EXISTING
  // Generate Report modal with it. Driven entirely by the current
  // REPORT_DEFINITIONS / FILTER_FIELDS, so there is no per-report logic.
  // ------------------------------------------------------------------

  var ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

  function recentMessage(msg) {
    var el = document.getElementById('rpt-recent-msg');
    if (el) el.textContent = msg || '';
  }

  // Returns { values, skipped:[labels] }. Never mutates the record.
  function valuesFromHistory(rec, def) {
    var dflt = allTimeRange();
    var v = { from: dflt.start, to: dflt.end };
    var skipped = [];

    // Every non-date filter starts on "All": a record stores only the filters
    // that were selected, so a filter that is absent was set to All (this
    // matters for filters whose normal default is not All, e.g. Paid).
    def.filters.forEach(function (k) { if (k !== 'date') v[k] = ''; });

    if (def.filters.indexOf('date') !== -1) {
      var dr = rec.dateRange;
      var okRange = dr && ISO_DATE.test(dr.start || '') && ISO_DATE.test(dr.end || '');
      if (okRange) {
        // New records, and older ones that stored a range: restore the exact dates.
        v.from = dr.start;
        v.to = dr.end;
      } else if (rec.period === 'custom') {
        // Custom dates that cannot be read: leave the fields empty for the
        // user to fill in (never invent dates).
        v.from = '';
        v.to = '';
      } else if (rec.period === 'today' || rec.period === 'week' || rec.period === 'month') {
        // Older Period-only record: translate it with the existing period logic.
        var translated = rangeFor(rec.period);
        v.from = translated.start;
        v.to = translated.end;
      }
      // period 'all' / missing: keep the All Time default set above.
    }

    (Array.isArray(rec.filters) ? rec.filters : []).forEach(function (f) {
      if (!f || typeof f.key !== 'string' || f.key === 'date') return;
      var label = typeof f.label === 'string' && f.label ? f.label : f.key;
      if (def.filters.indexOf(f.key) === -1 || !has(FILTER_FIELDS, f.key)) { skipped.push(label); return; } // filter no longer exists
      var value = f.value == null ? '' : String(f.value);
      if (!value) return;
      var exists = FILTER_FIELDS[f.key].options().some(function (o) { return o.value === value; });
      if (!exists) { skipped.push(label); return; } // e.g. a vet/service/vaccine that is no longer in the data
      v[f.key] = value;
    });
    return { values: v, skipped: skipped };
  }

  function generateAgain(historyId) {
    recentMessage('');
    var rec = null, def = null, restored = null;
    try {
      rec = readHistory().filter(function (r) { return r.id === historyId; })[0] || null;
      if (!rec) { recentMessage('That history entry could not be found. Refresh the page and try again.'); return; }
      def = getDef(rec.reportId);
      if (!def) { recentMessage('\u201C' + (rec.title || rec.reportId) + '\u201D is no longer available, so it cannot be generated again.'); return; }
      restored = valuesFromHistory(rec, def);
    } catch (err) {
      console.error('Could not restore the report settings:', err);
      recentMessage('Could not restore the settings for this report. Your history is unchanged.');
      return;
    }
    openGenerateReport(def.id, restored.values);
    if (restored.skipped.length) {
      genSetError('Some saved filters are no longer available and were reset to All: ' + restored.skipped.join(', ') + '.');
    }
  }

  function bindRecentEvents() {
    var el = document.getElementById('rpt-recent-list');
    if (!el) return;
    el.addEventListener('click', function (e) { // bound once, on the static container
      var btn = e.target.closest ? e.target.closest('[data-generate-again]') : null;
      if (!btn || btn.disabled) return;
      generateAgain(btn.getAttribute('data-generate-again'));
    });
  }

  // Test/inspection hook: no UI depends on it.
  window.PawsitiveReports = {
    definitions: REPORT_DEFINITIONS,
    buildReportModel: buildReportModel,
    renderPrintHtml: renderPrintHtml
  };

  // ------------------------------------------------------------------
  // legacy toolbar + print handlers (preserved)
  // The period toolbar is not part of the Report Library, so this
  // handler is inert until Phase 3 renders it again.
  // ------------------------------------------------------------------

  function handleLegacyToolbarClick(e) {
    var periodBtn = e.target.closest('.rpt-filter-btn[data-period]');
    if (periodBtn) {
      state.period = periodBtn.dataset.period;
      if (state.period === 'custom' && !state.from) {
        state.from = PCData.todayStr();
        state.to = PCData.todayStr();
      }
      render();
      return;
    }
    if (e.target.closest('#rpt-apply-custom')) {
      var fromEl = document.getElementById('rpt-from');
      var toEl = document.getElementById('rpt-to');
      if (fromEl && toEl && fromEl.value && toEl.value) {
        state.from = fromEl.value;
        state.to = toEl.value;
        state.period = 'custom';
        render();
      }
      return;
    }
    if (e.target.closest('#rpt-print-btn')) {
      window.print();
    }
  }

  // Print should show every report expanded, regardless of what the
  // user has collapsed on screen — force-open <details> for the print,
  // then restore each one's prior open/closed state afterward.
  var collapsedBeforePrint = [];
  function beforePrint() {
    collapsedBeforePrint = [];
    document.querySelectorAll('#reports-root details.rpt-report').forEach(function (d) {
      if (!d.open) { collapsedBeforePrint.push(d); d.open = true; }
    });
  }
  function afterPrint() {
    collapsedBeforePrint.forEach(function (d) { d.open = false; });
    collapsedBeforePrint = [];
    // Phase 3: the generated report only exists for the print; empty the
    // container so the normal page is fully restored.
    var printEl = document.getElementById('rpt-print-report');
    if (printEl) printEl.innerHTML = '';
  }


  document.addEventListener('DOMContentLoaded', function () {
    // The catalog is static metadata, so it renders even if the data
    // stores failed to load. Only the live-sync listener needs PCData.
    loadPrintImages(); // warm the cache for the printed header (logo + wordmark)
    bindLibraryEvents();
    bindRecentEvents();
    initGenerate();
    render();
    renderRecentReports();
    if (typeof PCData !== 'undefined' && typeof PCData.onChange === 'function') {
      PCData.onChange(render); // preserved change listener (re-renders the catalog from current state)
    }
    document.addEventListener('click', handleLegacyToolbarClick);
    window.addEventListener('beforeprint', beforePrint);
    window.addEventListener('afterprint', afterPrint);
  });
})();