var APP_NAME = 'ميزان';
var APP_NAME_LATIN = 'Mizan';
var APP_VERSION = '1.1.0';
var BRAND_MARK_SVG = '<svg viewBox="0 0 100 100" role="img" aria-label="' + APP_NAME + '"><defs><linearGradient id="bm-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E58B66"/><stop offset="1" stop-color="#C75E3D"/></linearGradient></defs><rect width="100" height="100" rx="26" fill="url(#bm-grad)"/><g fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round"><path d="M50 28v46M37 76h26M22 36h56" stroke-width="6"/><path d="M26 37l-9 21M26 37l9 21M74 37l-9 21M74 37l9 21" stroke-width="3.5"/></g><g fill="#fff"><circle cx="50" cy="25" r="5"/><path d="M13 58h26a13 13 0 0 1-26 0zM61 58h26a13 13 0 0 1-26 0z"/></g></svg>';

var App = (function () {
  'use strict';

  var STATIONS = ['الملف', 'ربط الأعمدة', 'المبالغ', 'التوزيع', 'النتائج', 'التصدير'];
  var SESSION_KEY = 'mizan.session.v1';
  var PAGE_SIZE = 50;
  var FIELDS = [
    { key: 'name', label: 'الاسم', required: true },
    { key: 'tier', label: 'الفئة', required: true },
    { key: 'job', label: 'الوظيفة' },
    { key: 'dept', label: 'الإدارة' },
    { key: 'daysWorked', label: 'أيام العمل' },
    { key: 'penaltyRate', label: 'نسبة الجزاء' },
    { key: 'pinnedPool', label: 'القفل اليدوي' },
    { key: 'excluded', label: 'الاستبعاد' },
    { key: 'overrideValue', label: 'قيمة مخصصة' },
    { key: 'manualFactor', label: 'معامل يدوي' }
  ];
  var WARNING_LABELS = {
    MISSING_NAME: 'صفوف بلا اسم',
    BAD_PENALTY: 'نسب جزاء خارج النطاق',
    BAD_DAYS: 'أيام عمل خارج الفترة',
    BAD_MANUAL_FACTOR: 'معاملات يدوية غير صالحة',
    POOL_ROUNDED: 'مجمعات عُدّلت للتقريب',
    ZERO_BUDGET_POOL: 'مجمعات بلا مبلغ'
  };

  var state;
  var container;
  var toastContainer;
  var importing = false;
  var sortKey = null;
  var sortDir = 1;
  var themeMode = 'system';
  var viewPage = 0;
  var lastScreen = -1;
  var amountDrafts = {};
  var renderQueued = false;
  var quotaWarned = false;

  function emptyFilters() { return { search: '', dept: '', tier: '', pool: '', special: false, excluded: false }; }
  function emptyMapping() { return { name: '', job: '', dept: '', tier: '', daysWorked: '', penaltyRate: '', pinnedPool: '', excluded: '', overrideValue: '', manualFactor: '' }; }
  function isObj(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }

  function el(tag, className, children) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    (children || []).forEach(function (child) {
      if (child != null && child !== false) node.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
    });
    return node;
  }

  function num(text) {
    var s = el('span', 'num');
    s.setAttribute('dir', 'ltr');
    s.textContent = text;
    return s;
  }

  function debounce(fn, wait) {
    var timer;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(ctx, args); }, wait);
    };
  }

  function sanitizeFilename(name) {
    return String(name || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'ملف';
  }

  var fmtCache = {};
  function formatEGP(value, decimals) {
    var d = decimals == null ? 2 : decimals;
    if (!fmtCache[d]) fmtCache[d] = new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    return fmtCache[d].format(Number(value) || 0);
  }

  function formatPercent(value, decimals) {
    return formatEGP((Number(value) || 0) * 100, decimals == null ? 2 : decimals) + '%';
  }

  function trimNumber(value, maxDecimals) {
    if (value == null || !isFinite(value)) return '';
    var f = Math.pow(10, maxDecimals == null ? 4 : maxDecimals);
    return String(Math.round(value * f) / f);
  }

  function parseNumber(value) {
    if (value == null) return null;
    if (typeof value === 'number') return isFinite(value) ? value : null;
    var s = String(value).trim();
    if (!s) return null;
    s = s.replace(/[٠-٩]/g, function (c) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(c); })
      .replace(/[۰-۹]/g, function (c) { return '۰۱۲۳۴۵۶۷۸۹'.indexOf(c); })
      .replace(/٫/g, '.').replace(/[٬,\s]/g, '').replace(/٪/g, '%');
    var percent = s.indexOf('%') >= 0;
    var n = Number(s.replace(/%/g, ''));
    if (!isFinite(n)) return null;
    return percent ? n / 100 : n;
  }

  function iconEl(name, cls) {
    var span = document.createElement('span');
    span.innerHTML = Icons.svg(name);
    var node = span.firstChild;
    if (cls) node.classList.add(cls);
    return node;
  }

  function showToast(message) {
    if (!toastContainer || !toastContainer.isConnected) {
      toastContainer = el('div', 'toast-stack');
      toastContainer.setAttribute('role', 'status');
      toastContainer.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastContainer);
    }
    var toast = el('div', 'toast', [iconEl('check'), el('span', null, [message])]);
    toastContainer.appendChild(toast);
    while (toastContainer.children.length > 3) toastContainer.removeChild(toastContainer.firstChild);
    setTimeout(function () {
      toast.classList.add('leaving');
      setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 220);
    }, 3200);
  }

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function sanitizePools(pools) {
    var out = {};
    Object.keys(pools || {}).forEach(function (name) {
      var p = pools[name] || {};
      var gross = Number(p.gross), tax = Number(p.taxRate);
      out[name] = { gross: isFinite(gross) && gross >= 0 ? gross : 0, taxRate: isFinite(tax) && tax >= 0 && tax < 1 ? tax : 0 };
    });
    return out;
  }

  function sanitizeTiers(tiers) {
    var out = {};
    Object.keys(tiers || {}).forEach(function (name) {
      var v = Number(tiers[name]);
      out[name] = isFinite(v) && v >= 0 ? v : 0;
    });
    return out;
  }

  function defaultSettings() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem('incentiveSettings') || 'null'); } catch (e) { saved = null; }
    if (saved && isObj(saved.tiers) && isObj(saved.pools) && Object.keys(saved.tiers).length && Object.keys(saved.pools).length) {
      return { tiers: sanitizeTiers(saved.tiers), pools: sanitizePools(saved.pools), roundingStep: saved.roundingStep === 100 ? 100 : 1 };
    }
    return { tiers: clone(DemoData.TIERS), pools: clone(DemoData.POOLS), roundingStep: 1 };
  }

  function loadTierMappings() {
    try { var m = JSON.parse(localStorage.getItem('tierMappings') || '{}'); return isObj(m) ? m : {}; } catch (e) { return {}; }
  }

  function makeInitialState() {
    var settings = defaultSettings();
    return {
      screen: 0,
      title: 'توزيع الحوافز',
      period: 'أغسطس 2026',
      periodDays: 30,
      tiers: settings.tiers,
      pools: settings.pools,
      options: { roundingStep: settings.roundingStep },
      people: [],
      rawRows: [],
      headers: [],
      mapping: emptyMapping(),
      tierMappings: loadTierMappings(),
      fileName: '',
      result: null,
      filters: emptyFilters(),
      history: []
    };
  }

  function serializeState() {
    return {
      app: 'mizan', version: APP_VERSION,
      screen: state.screen, title: state.title, period: state.period, periodDays: state.periodDays,
      tiers: state.tiers, pools: state.pools, options: state.options,
      people: state.people, rawRows: state.rawRows, headers: state.headers,
      mapping: state.mapping, tierMappings: state.tierMappings, fileName: state.fileName
    };
  }

  function hydrate(saved) {
    var next = makeInitialState();
    if (!isObj(saved)) throw new Error('bad');
    if (typeof saved.title === 'string') next.title = saved.title;
    if (typeof saved.period === 'string') next.period = saved.period;
    if (Number(saved.periodDays) >= 1) next.periodDays = Math.floor(Number(saved.periodDays));
    if (isObj(saved.tiers) && Object.keys(saved.tiers).length) next.tiers = sanitizeTiers(saved.tiers);
    if (isObj(saved.pools) && Object.keys(saved.pools).length) next.pools = sanitizePools(saved.pools);
    if (isObj(saved.options)) next.options.roundingStep = saved.options.roundingStep === 100 ? 100 : 1;
    if (Array.isArray(saved.people)) {
      next.people = saved.people.filter(isObj).map(function (p, i) {
        return {
          id: p.id != null ? p.id : i + 1,
          name: String(p.name || ''), job: String(p.job || ''), dept: String(p.dept || 'غير محدد'),
          tier: p.tier == null ? '' : String(p.tier), rawTier: String(p.rawTier != null ? p.rawTier : (p.tier || '')),
          overrideValue: parseNumber(p.overrideValue), daysWorked: parseNumber(p.daysWorked), penaltyRate: parseNumber(p.penaltyRate),
          pinnedPool: p.pinnedPool && Engine.hasOwn(next.pools, p.pinnedPool) ? p.pinnedPool : null,
          excluded: !!p.excluded, manualFactor: parseNumber(p.manualFactor)
        };
      });
    }
    if (Array.isArray(saved.rawRows)) next.rawRows = saved.rawRows.filter(Array.isArray);
    if (Array.isArray(saved.headers)) next.headers = saved.headers.map(String);
    if (isObj(saved.mapping)) Object.keys(next.mapping).forEach(function (k) { if (typeof saved.mapping[k] === 'string' && next.headers.indexOf(saved.mapping[k]) >= 0) next.mapping[k] = saved.mapping[k]; });
    if (isObj(saved.tierMappings)) Object.keys(saved.tierMappings).forEach(function (k) { next.tierMappings[k] = saved.tierMappings[k]; });
    if (typeof saved.fileName === 'string') next.fileName = saved.fileName;
    next.screen = Math.max(0, Math.min(5, Math.floor(Number(saved.screen) || 0)));
    return next;
  }

  var saveSession = debounce(function () {
    if (!state) return;
    try {
      if (!state.people.length) { localStorage.removeItem(SESSION_KEY); return; }
      localStorage.setItem(SESSION_KEY, JSON.stringify(serializeState()));
    } catch (e) {
      if (!quotaWarned) { quotaWarned = true; showToast('الملف كبير على الحفظ التلقائي — استخدم «حفظ المشروع» للاحتفاظ بعملك'); }
    }
  }, 600);

  function normalizeHeader(header) {
    return Engine.normalizeArabic(header || '').replace(/[^\u0600-\u06FFa-z0-9]/g, '');
  }

  function autoMapping(headers) {
    var aliases = {
      name: ['الاسم', 'اسم', 'الاسم بالكامل', 'اسم الموظف', 'name'],
      job: ['الوظيفة', 'الوظيفه', 'المسمى الوظيفي', 'job', 'title'],
      dept: ['الإدارة', 'الادارة', 'القسم', 'الوحدة', 'department', 'dept'],
      tier: ['الفئة', 'الفئه', 'الدرجة', 'المستوى', 'tier', 'grade'],
      daysWorked: ['أيام العمل', 'ايام العمل', 'عدد الايام', 'الحضور', 'days'],
      penaltyRate: ['نسبة الجزاء', 'الجزاء', 'الخصم', 'penalty'],
      pinnedPool: ['القفل اليدوي', 'المجمع المقفول', 'قفل المجمع', 'المجمع', 'pool'],
      excluded: ['الاستبعاد', 'مستبعد', 'استبعاد', 'excluded'],
      overrideValue: ['قيمة مخصصة', 'القيمة المخصصة', 'قيمة يدوية', 'override'],
      manualFactor: ['معامل يدوي', 'المعامل اليدوي', 'معامل', 'factor']
    };
    var result = {};
    var taken = {};
    Object.keys(aliases).forEach(function (key) {
      var wanted = aliases[key].map(normalizeHeader);
      var found = headers.find(function (h) { return !taken[h] && wanted.indexOf(normalizeHeader(h)) >= 0; }) || '';
      if (found) taken[found] = true;
      result[key] = found;
    });
    return result;
  }

  var TRUTHY_CELLS = ['نعم', 'صح', 'صحيح', 'مستبعد', 'true', 'yes', 'y', '1', 'x', '✓', '✔'];
  function parseBooleanCell(value) {
    if (value === true) return true;
    var raw = String(value == null ? '' : value).trim();
    if (!raw) return false;
    var normalized = Engine.normalizeArabic(raw);
    return TRUTHY_CELLS.some(function (token) { return Engine.normalizeArabic(token) === normalized; });
  }

  function canonicalPool(value) {
    var raw = String(value == null ? '' : value).trim();
    if (!raw) return null;
    var names = Object.keys(state.pools);
    var target = Engine.normalizeForTierMatch(raw);
    for (var i = 0; i < names.length; i++) if (Engine.normalizeForTierMatch(names[i]) === target) return names[i];
    return null;
  }

  function headerIndex(header) { return header ? state.headers.indexOf(header) : -1; }
  function cell(row, idx) { return idx < 0 ? '' : (row[idx] == null ? '' : row[idx]); }

  function canonicalTier(raw) {
    var key = String(raw == null ? '' : raw).trim();
    if (Engine.hasOwn(state.tierMappings, key) && Engine.hasOwn(state.tiers, state.tierMappings[key])) return state.tierMappings[key];
    return Engine.canonicalizeTierName(key, Object.keys(state.tiers));
  }

  function rebuildPeopleFromRaw() {
    var m = state.mapping;
    var ix = {};
    Object.keys(m).forEach(function (k) { ix[k] = headerIndex(m[k]); });
    state.people = state.rawRows.map(function (row, index) {
      var rawTier = String(cell(row, ix.tier)).trim();
      var penalty = parseNumber(cell(row, ix.penaltyRate));
      if (penalty != null && penalty > 1) penalty /= 100;
      return {
        id: index + 1,
        name: String(cell(row, ix.name)).trim(),
        job: String(cell(row, ix.job)).trim(),
        dept: String(cell(row, ix.dept)).trim() || 'غير محدد',
        tier: canonicalTier(rawTier) || rawTier,
        rawTier: rawTier,
        overrideValue: ix.overrideValue >= 0 ? parseNumber(cell(row, ix.overrideValue)) : null,
        daysWorked: parseNumber(cell(row, ix.daysWorked)),
        penaltyRate: penalty,
        pinnedPool: ix.pinnedPool >= 0 ? canonicalPool(cell(row, ix.pinnedPool)) : null,
        excluded: ix.excluded >= 0 ? parseBooleanCell(cell(row, ix.excluded)) : false,
        manualFactor: ix.manualFactor >= 0 ? parseNumber(cell(row, ix.manualFactor)) : null
      };
    });
    state.history = [];
  }

  function resetView() {
    state.filters = emptyFilters();
    sortKey = null; sortDir = 1; viewPage = 0;
    amountDrafts = {};
  }

  function loadDemo() {
    state.people = clone(DemoData.buildDemoPeople());
    state.headers = ['الاسم', 'الوظيفة', 'الإدارة', 'الفئة', 'أيام العمل', 'نسبة الجزاء'];
    state.rawRows = state.people.map(function (p) { return [p.name, p.job, p.dept, p.tier, p.daysWorked == null ? '' : p.daysWorked, p.penaltyRate == null ? '' : p.penaltyRate]; });
    state.mapping = Object.assign(emptyMapping(), autoMapping(state.headers));
    state.people.forEach(function (p) { p.rawTier = p.tier; });
    state.fileName = 'بيانات نموذجية';
    state.history = [];
    resetView();
    state.screen = 2;
    recompute();
    render();
    showToast('تم تحميل 60 موظفًا ببيانات نموذجية');
  }

  function detectDelimiter(text) {
    var line = text.split(/\r?\n/)[0] || '';
    var counts = { ',': 0, ';': 0, '\t': 0 };
    var quoted = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') quoted = !quoted;
      else if (!quoted && counts.hasOwnProperty(ch)) counts[ch]++;
    }
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0] || ',';
  }

  function parseCsv(text) {
    text = String(text || '').replace(/^\uFEFF/, '');
    var delim = detectDelimiter(text);
    var rows = [], row = [], value = '', quoted = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (quoted) {
        if (ch === '"') { if (text[i + 1] === '"') { value += '"'; i++; } else quoted = false; }
        else value += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === delim) { row.push(value); value = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(value); rows.push(row); row = []; value = '';
      } else value += ch;
    }
    row.push(value);
    rows.push(row);
    return rows;
  }

  function importFile(file) {
    var extension = (file.name.split('.').pop() || '').toLowerCase();
    if (['csv', 'txt', 'xlsx', 'xls', 'xlsm'].indexOf(extension) < 0) { showToast('صيغة غير مدعومة — استخدم Excel أو CSV'); return; }
    if (extension === 'csv' || extension === 'txt') {
      var reader = new FileReader();
      reader.onload = function () { acceptRows(parseCsv(String(reader.result || '')), file.name); };
      reader.onerror = function () { showToast('تعذر قراءة الملف'); };
      reader.readAsText(file, 'UTF-8');
      return;
    }
    if (!window.XLSX) { showToast(window.__sheetJsLoadFailed ? 'محرك Excel غير متاح — احفظ الملف بصيغة CSV وارفعه' : 'محرك Excel ما زال يُحمَّل، حاول بعد لحظة'); return; }
    importing = true;
    render();
    file.arrayBuffer().then(function (buffer) {
      var workbook = window.XLSX.read(buffer, { type: 'array', dense: true, cellDates: true });
      var sheet = workbook.Sheets[workbook.SheetNames[0]];
      importing = false;
      acceptRows(window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }), file.name);
    }).catch(function () {
      importing = false;
      render();
      showToast('تعذر قراءة الملف — تأكد أنه ملف Excel أو CSV سليم');
    });
  }

  function acceptRows(rows, fileName) {
    rows = (rows || []).filter(function (r) { return Array.isArray(r) && r.some(function (v) { return String(v == null ? '' : v).trim() !== ''; }); });
    if (rows.length < 2) { render(); showToast('الملف لا يحتوي على صف عناوين وبيانات كافية'); return; }
    var width = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    var seen = {};
    var headers = [];
    for (var i = 0; i < width; i++) {
      var h = rows[0][i];
      var base = String(h == null || String(h).trim() === '' ? 'عمود ' + (i + 1) : h).trim();
      var name = base, n = 2;
      while (seen[name]) name = base + ' (' + (n++) + ')';
      seen[name] = true;
      headers.push(name);
    }
    state.headers = headers;
    state.rawRows = rows.slice(1).map(function (r) { var copy = r.slice(0, width); while (copy.length < width) copy.push(''); return copy; });
    state.mapping = Object.assign(emptyMapping(), autoMapping(headers));
    state.fileName = fileName || state.fileName;
    rebuildPeopleFromRaw();
    resetView();
    state.result = null;
    state.screen = 1;
    recompute();
    render();
    showToast('تمت قراءة ' + state.rawRows.length + ' صفًا — راجع ربط الأعمدة');
  }

  function downloadTemplate() {
    if (!window.XLSX) { showToast('قالب Excel يحتاج محرك Excel — تأكد من الاتصال بالإنترنت'); return; }
    var wb = window.XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    var staff = [
      ['الاسم', 'الوظيفة', 'الإدارة', 'الفئة', 'أيام العمل', 'نسبة الجزاء'],
      ['محمد أحمد', 'مدير عام الإدارة', 'الإدارة العامة', 'مدير إدارة', '', ''],
      ['أحمد محمد', 'مدير الإدارة', 'إدارة الحسابات', 'مدير', '', ''],
      ['محمود السيد', 'رئيس قسم', 'إدارة الشئون الطبية', 'رئيس قسم', '', ''],
      ['فاطمة حسن', 'أخصائي أول', 'إدارة الموارد البشرية', 'عضو مميز', '', ''],
      ['سارة محمد', 'أخصائي', 'الإدارة العامة', 'شهادة عليا', '', ''],
      ['خالد علي', 'فني أول', 'إدارة الحسابات', 'فوق متوسط', '', ''],
      ['مريم أحمد', 'فني', 'إدارة الشئون الطبية', 'متوسط', 15, ''],
      ['يوسف حسن', 'معاون خدمة', 'إدارة الموارد البشرية', 'معاون خدمة', '', 0.15]
    ];
    var tiers = [['الفئة', 'القيمة الأساسية']];
    Object.keys(state.tiers).forEach(function (t) { tiers.push([t, state.tiers[t]]); });
    var instructions = [['قالب استيراد توزيع الحوافز'], ['الحقول المطلوبة: الاسم والفئة'], ['الحقول الاختيارية: الوظيفة، الإدارة، أيام العمل، نسبة الجزاء'], ['حقول إضافية يمكن ربطها من شاشة «ربط الأعمدة»: القفل اليدوي، الاستبعاد، قيمة مخصصة، معامل يدوي'], ['نسبة الجزاء: اكتب 15% أو 0.15'], ['اترك أيام العمل فارغة لاستخدام كامل الفترة']];
    var s1 = window.XLSX.utils.aoa_to_sheet(staff); s1['!cols'] = [{ wch: 24 }, { wch: 24 }, { wch: 24 }, { wch: 18 }, { wch: 14 }, { wch: 16 }];
    var s2 = window.XLSX.utils.aoa_to_sheet(tiers); s2['!cols'] = [{ wch: 22 }, { wch: 18 }];
    var s3 = window.XLSX.utils.aoa_to_sheet(instructions); s3['!cols'] = [{ wch: 80 }];
    window.XLSX.utils.book_append_sheet(wb, s1, 'بيانات الموظفين');
    window.XLSX.utils.book_append_sheet(wb, s2, 'قائمة الفئات');
    window.XLSX.utils.book_append_sheet(wb, s3, 'تعليمات');
    window.XLSX.writeFile(wb, 'قالب-استيراد-توزيع-الحوافز.xlsx');
    showToast('تم تنزيل قالب Excel');
  }

  function computeValidation() {
    var missingName = 0, unknown = {}, unknownPins = {};
    state.people.forEach(function (p) {
      if (!p.name) missingName++;
      if (!Engine.hasOwn(state.tiers, p.tier) && p.overrideValue == null) {
        var key = p.rawTier || '';
        unknown[key] = (unknown[key] || 0) + 1;
      }
    });
    var pinIdx = headerIndex(state.mapping.pinnedPool);
    if (pinIdx >= 0) {
      state.rawRows.forEach(function (row) {
        var raw = String(cell(row, pinIdx)).trim();
        if (raw && !canonicalPool(raw)) unknownPins[raw] = (unknownPins[raw] || 0) + 1;
      });
    }
    var mappedOk = !!state.mapping.name && !!state.mapping.tier;
    return {
      mappedOk: mappedOk,
      missingName: missingName,
      unknown: unknown,
      unknownPins: unknownPins,
      ok: state.people.length > 0 && mappedOk && missingName === 0 && Object.keys(unknown).length === 0
    };
  }

  function canVisit(i, validation) {
    if (i === 0) return true;
    if (!state.people.length) return false;
    if (i === 1) return state.headers.length > 0;
    return (validation || computeValidation()).ok;
  }

  function recompute() {
    state.__recomputeCount = (state.__recomputeCount || 0) + 1;
    if (!state.people.length) { state.result = null; return; }
    state.result = Engine.runPipeline({ people: state.people, tiers: state.tiers, pools: state.pools, periodDays: state.periodDays, options: state.options });
  }

  function pushHistory() {
    state.history.push(state.people.map(function (p) { return Object.assign({}, p); }));
    if (state.history.length > 30) state.history.shift();
  }

  function undo() {
    var previous = state.history.pop();
    if (!previous) { showToast('لا توجد خطوة سابقة'); return; }
    state.people = previous;
    recompute();
    render();
    showToast('تم التراجع عن آخر تعديل');
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    setTimeout(function () { renderQueued = false; render(); }, 0);
  }

  function editPerson(id, patch) {
    var target = state.people.find(function (p) { return p.id === id; });
    if (!target) return;
    var changed = Object.keys(patch).some(function (k) { return target[k] !== patch[k]; });
    if (!changed) return;
    pushHistory();
    state.people = state.people.map(function (p) { return p.id === id ? Object.assign({}, p, patch) : p; });
    recompute();
    scheduleRender();
  }

  function goTo(i) {
    if (!canVisit(i)) return;
    state.screen = i;
    render();
  }

  var closeOpenDropdown = function () {};

  function customSelect(options, value, onChange, extra) {
    extra = extra || {};
    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger' + (extra.small ? ' small' : '') + (extra.className ? ' ' + extra.className : '');
    if (extra.id) trigger.id = extra.id;
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    if (extra.ariaLabel) trigger.setAttribute('aria-label', extra.ariaLabel);
    var labelSpan = el('span', 'cs-label');
    var chevron = iconEl('chevronDown', 'cs-chevron');
    function findLabel(v) { var f = options.filter(function (o) { return o.value === v; })[0]; return f ? f.label : ''; }
    function updateLabel() { var l = findLabel(value); labelSpan.textContent = l || extra.placeholder || ''; trigger.title = l; trigger.classList.toggle('placeholder', !l || value === ''); }
    updateLabel();
    if (extra.icon) trigger.appendChild(iconEl(extra.icon));
    trigger.appendChild(labelSpan);
    trigger.appendChild(chevron);

    function openPopup() {
      closeOpenDropdown();
      trigger.setAttribute('aria-expanded', 'true');
      trigger.classList.add('open');
      var popup = el('div', 'custom-select-popup' + (extra.small ? ' small' : ''));
      popup.setAttribute('role', 'listbox');
      document.body.appendChild(popup);
      var activeIndex = 0;
      options.forEach(function (o, i) { if (o.value === value) activeIndex = i; });
      var optionEls = options.map(function (o, i) {
        var row = el('div', 'custom-select-option' + (o.value === value ? ' selected' : ''), [el('span', null, [o.label])]);
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(o.value === value));
        if (o.value === value) row.appendChild(iconEl('check'));
        row.addEventListener('mousedown', function (e) { e.preventDefault(); });
        row.addEventListener('click', function () { choose(i); });
        row.addEventListener('mouseenter', function () { setActive(i, true); });
        popup.appendChild(row);
        return row;
      });
      function setActive(i, fromPointer) {
        if (i < 0 || i >= optionEls.length) return;
        activeIndex = i;
        optionEls.forEach(function (o, idx) { o.classList.toggle('active', idx === i); });
        if (!fromPointer && optionEls[i].scrollIntoView) optionEls[i].scrollIntoView({ block: 'nearest' });
      }
      function position() {
        var rect = trigger.getBoundingClientRect();
        if (rect.bottom < -4 || rect.top > window.innerHeight + 4) { close(); return; }
        var vw = window.innerWidth, vh = window.innerHeight;
        var minWidth = Math.max(rect.width, extra.small ? 150 : 190);
        var maxWidth = Math.min(360, vw - 24);
        popup.style.minWidth = Math.min(minWidth, maxWidth) + 'px';
        popup.style.maxWidth = maxWidth + 'px';
        var width = popup.getBoundingClientRect().width || minWidth;
        popup.style.right = Math.max(8, Math.min(vw - 8 - width, vw - rect.right)) + 'px';
        popup.style.left = 'auto';
        var below = vh - rect.bottom, above = rect.top;
        var maxH = extra.small ? 240 : 300;
        if (below < 180 && above > below) {
          popup.style.bottom = (vh - rect.top + 6) + 'px'; popup.style.top = 'auto';
          popup.style.maxHeight = Math.max(100, Math.min(maxH, above - 16)) + 'px';
        } else {
          popup.style.top = (rect.bottom + 6) + 'px'; popup.style.bottom = 'auto';
          popup.style.maxHeight = Math.max(100, Math.min(maxH, below - 16)) + 'px';
        }
      }
      position();
      setActive(activeIndex);
      function choose(i) { var prev = value; value = options[i].value; updateLabel(); close(); trigger.focus(); if (prev !== value) onChange(value); }
      function onKeydown(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); trigger.focus(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(optionEls.length - 1, activeIndex + 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(0, activeIndex - 1)); }
        else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
        else if (e.key === 'End') { e.preventDefault(); setActive(optionEls.length - 1); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(activeIndex); }
        else if (e.key === 'Tab') close();
      }
      function onPointerDown(e) { if (popup.contains(e.target) || trigger.contains(e.target)) return; close(); }
      function onScroll(e) { if (popup.contains(e.target)) return; position(); }
      document.addEventListener('keydown', onKeydown, true);
      document.addEventListener('mousedown', onPointerDown, true);
      document.addEventListener('touchstart', onPointerDown, true);
      document.addEventListener('scroll', onScroll, true);
      window.addEventListener('resize', position);
      function close() {
        trigger.setAttribute('aria-expanded', 'false');
        trigger.classList.remove('open');
        document.removeEventListener('keydown', onKeydown, true);
        document.removeEventListener('mousedown', onPointerDown, true);
        document.removeEventListener('touchstart', onPointerDown, true);
        document.removeEventListener('scroll', onScroll, true);
        window.removeEventListener('resize', position);
        if (popup.parentNode) popup.parentNode.removeChild(popup);
        if (closeOpenDropdown === close) closeOpenDropdown = function () {};
      }
      closeOpenDropdown = close;
    }

    trigger.addEventListener('click', function () {
      var wasOpen = trigger.classList.contains('open');
      closeOpenDropdown();
      if (!wasOpen) openPopup();
    });
    trigger.addEventListener('keydown', function (e) {
      if (!trigger.classList.contains('open') && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); openPopup(); }
    });
    return trigger;
  }

  function button(content, cls, fn, opts) {
    opts = opts || {};
    var children = [];
    if (opts.icon) children.push(iconEl(opts.icon));
    if (content) children.push(opts.labelClass ? el('span', opts.labelClass, [content]) : content);
    var b = el('button', 'btn ' + (cls || 'btn-ghost'), children);
    b.type = 'button';
    if (opts.disabled) b.disabled = true;
    if (opts.title) { b.title = opts.title; b.setAttribute('aria-label', opts.title); }
    if (opts.id) b.id = opts.id;
    if (fn) b.addEventListener('click', fn);
    return b;
  }

  function notice(tone, icon, children, action) {
    var n = el('div', 'notice' + (tone ? ' notice-' + tone : ''));
    n.setAttribute('role', tone === 'danger' ? 'alert' : 'status');
    if (icon) n.appendChild(iconEl(icon));
    n.appendChild(el('div', 'notice-body', children));
    if (action) { var wrap = el('div', 'notice-action', [action]); n.appendChild(wrap); }
    return n;
  }

  function screenHead(eyebrow, title, subtitle, aside) {
    var wrap = el('header', 'screen-head');
    var copy = el('div', null, [el('div', 'eyebrow', [eyebrow]), el('h1', null, [title]), subtitle ? el('p', null, [subtitle]) : null]);
    wrap.appendChild(copy);
    if (aside) wrap.appendChild(el('div', 'screen-head-aside', aside));
    return wrap;
  }

  function cardHead(title, sub, aside) {
    var head = el('div', 'card-head');
    head.appendChild(el('div', null, [el('h2', 'card-title', [title]), sub ? el('div', 'card-sub', [sub]) : null]));
    if (aside) head.appendChild(aside);
    return head;
  }

  function filterChip(label, checked, onChange, id) {
    var chip = el('label', 'chip' + (checked ? ' chip-active' : ''));
    var input = el('input');
    input.type = 'checkbox';
    input.checked = checked;
    if (id) input.id = id;
    input.addEventListener('change', function () { onChange(input.checked); });
    chip.appendChild(input);
    chip.appendChild(el('span', 'chip-check', [iconEl('check')]));
    chip.appendChild(document.createTextNode(label));
    return chip;
  }

  function openModal(opts) {
    closeOpenDropdown();
    var backdrop = el('div', 'modal-backdrop');
    var modal = el('div', 'modal' + (opts.wide ? ' modal-wide' : ''));
    modal.setAttribute('role', opts.alert ? 'alertdialog' : 'dialog');
    modal.setAttribute('aria-modal', 'true');
    var titleId = 'modal-title-' + Date.now();
    modal.setAttribute('aria-labelledby', titleId);
    var h2 = el('h2', null, [opts.title]); h2.id = titleId;
    var head = el('div', 'modal-head', [el('div', null, [h2, opts.sub ? el('div', 'field-help', [opts.sub]) : null])]);
    head.appendChild(button('', 'btn-quiet btn-icon btn-sm', function () { close(); }, { icon: 'close', title: 'إغلاق' }));
    modal.appendChild(head);
    var body = el('div', 'modal-body', opts.body || []);
    modal.appendChild(body);
    if (opts.foot) modal.appendChild(el('div', 'modal-foot', opts.foot(close)));
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    var previouslyFocused = document.activeElement;
    var previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function focusables() {
      return Array.prototype.slice.call(modal.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(function (n) { return !n.disabled && n.offsetParent !== null; });
    }
    function onKeydown(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'Tab') {
        var items = focusables();
        if (!items.length) return;
        var first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    function onBackdrop(e) { if (e.target === backdrop) close(); }
    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      closeOpenDropdown();
      document.removeEventListener('keydown', onKeydown, true);
      backdrop.removeEventListener('mousedown', onBackdrop);
      document.body.style.overflow = previousOverflow;
      backdrop.classList.add('leaving');
      setTimeout(function () { if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop); }, 150);
      if (opts.onClose) opts.onClose();
      if (previouslyFocused && previouslyFocused.isConnected && typeof previouslyFocused.focus === 'function') previouslyFocused.focus();
    }
    document.addEventListener('keydown', onKeydown, true);
    backdrop.addEventListener('mousedown', onBackdrop);
    var initial = opts.initialFocus ? modal.querySelector(opts.initialFocus) : null;
    (initial || focusables()[0] || modal).focus();
    return { close: close, modal: modal, body: body };
  }

  function confirmDialog(title, text, confirmLabel, onConfirm) {
    openModal({
      title: title,
      alert: true,
      body: [el('p', 'modal-text', [text])],
      initialFocus: '.btn-ghost',
      foot: function (close) {
        return [el('div', 'modal-foot-end', [
          button('إلغاء', 'btn-ghost', close),
          button(confirmLabel, 'btn-danger-solid', function () { close(); onConfirm(); })
        ])];
      }
    });
  }

  function buildTopbar(validation) {
    var bar = el('header', 'topbar');
    var inner = el('div', 'topbar-inner');
    var mark = el('div', 'brand-mark'); mark.innerHTML = BRAND_MARK_SVG;
    var sub = el('div', 'brand-subtitle', ['توزيع عادل قابل للمراجعة ']);
    var link = el('a', 'brand-link', ['· قسمة ↗']);
    link.href = 'https://shareholders-coral.vercel.app/'; link.target = '_blank'; link.rel = 'noopener noreferrer';
    sub.appendChild(link);
    inner.appendChild(el('div', 'brand', [mark, el('div', null, [el('div', 'brand-title', [APP_NAME]), sub])]));

    var steps = el('nav', 'steps');
    steps.setAttribute('aria-label', 'خطوات العمل');
    STATIONS.forEach(function (label, i) {
      var cls = i === state.screen ? 'is-current' : (i < state.screen ? 'is-done' : '');
      var numEl = el('span', 'step-num', [i < state.screen ? iconEl('check') : String(i + 1)]);
      var b = el('button', 'step ' + cls, [numEl, el('span', 'step-label', [label])]);
      b.type = 'button';
      b.id = 'step-' + i;
      b.disabled = !canVisit(i, validation);
      if (i === state.screen) b.setAttribute('aria-current', 'step');
      b.setAttribute('aria-label', (i + 1) + '. ' + label);
      b.addEventListener('click', function () { goTo(i); });
      steps.appendChild(b);
    });
    inner.appendChild(steps);

    var actions = el('div', 'top-actions');
    actions.appendChild(themeSwitch());
    actions.appendChild(button('الإعدادات', 'btn-quiet btn-sm', openSettings, { icon: 'settings', labelClass: 'btn-label', id: 'top-settings' }));
    actions.appendChild(button('', 'btn-quiet btn-sm btn-icon', saveProject, { icon: 'save', title: 'حفظ المشروع (Ctrl+S)', disabled: !state.people.length, id: 'top-save' }));
    inner.appendChild(actions);
    bar.appendChild(inner);
    return bar;
  }

  function themeSwitch() {
    var wrap = el('div', 'theme-switch');
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'وضع الألوان');
    [['light', 'sun', 'فاتح'], ['dark', 'moon', 'داكن'], ['system', 'monitor', 'حسب النظام']].forEach(function (opt) {
      var active = themeMode === opt[0];
      var b = el('button', 'theme-switch-btn' + (active ? ' active' : ''), [iconEl(opt[1])]);
      b.type = 'button';
      b.id = 'theme-' + opt[0];
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
      b.setAttribute('aria-label', opt[2]);
      b.title = opt[2];
      b.addEventListener('click', function () { applyTheme(opt[0]); render(); });
      wrap.appendChild(b);
    });
    return wrap;
  }

  function buildActionBar(spec) {
    var bar = el('div', 'action-bar');
    var inner = el('div', 'action-bar-inner');
    inner.appendChild(spec.back ? button(spec.back.label, 'btn-ghost', spec.back.fn, { icon: 'arrowBack', id: 'nav-back' }) : el('span'));
    inner.appendChild(el('div', 'action-bar-status', [spec.status || '']));
    if (spec.next) {
      var n = el('button', 'btn ' + (spec.next.cls || 'btn-accent'), [el('span', null, [spec.next.label]), spec.next.icon === false ? null : iconEl(spec.next.icon || 'arrowNext')]);
      n.type = 'button';
      n.id = 'nav-next';
      if (spec.next.disabled) n.disabled = true;
      if (spec.next.title) n.title = spec.next.title;
      n.addEventListener('click', spec.next.fn);
      inner.appendChild(n);
    } else inner.appendChild(el('span'));
    bar.appendChild(inner);
    return bar;
  }

  function sheetEngineNotice() {
    if (!window.__sheetJsLoadFailed) return null;
    return notice('warning', 'info', ['تعذر تحميل محرك Excel — يمكنك رفع CSV، وسيتم التصدير بصيغة CSV.']);
  }

  function buildUpload() {
    var nodes = [screenHead('الخطوة 1', 'ابدأ بملف الموظفين', 'ارفع جدول Excel أو CSV، أو جرّب البيانات النموذجية. لا يُحسب أي مبلغ قبل مراجعة الأعمدة.')];
    if (importing) {
      var loading = el('div', 'card');
      loading.appendChild(cardHead('جارٍ قراءة الملف…'));
      var sk = el('div', 'skeleton-stack');
      [100, 88, 94, 72, 84].forEach(function (w) { var b = el('div', 'skeleton'); b.style.inlineSize = w + '%'; sk.appendChild(b); });
      loading.appendChild(sk);
      nodes.push(loading);
      return { nodes: nodes, status: '' };
    }
    if (state.people.length) {
      nodes.push(notice('accent', 'sheet', [el('strong', null, [state.fileName || 'ملف حالي']), ' — ' + state.people.length + ' موظفًا جاهزون.'], button('متابعة', 'btn-ghost btn-sm', function () { goTo(canVisit(2) ? 2 : 1); })));
    }
    var input = el('input', 'sr-only');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.xlsm,.csv,.txt';
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');
    var zone = el('div', 'upload-zone', [
      el('div', 'upload-glyph', [iconEl('upload')]),
      el('div', 'upload-title', ['اسحب الملف هنا أو اضغط للاختيار']),
      el('div', 'upload-help', ['الحقول المطلوبة: الاسم والفئة. ويمكن ربط الوظيفة والإدارة وأيام العمل ونسبة الجزاء وغيرها في الخطوة التالية.']),
      el('div', 'upload-formats', [el('span', 'badge badge-neutral', ['XLSX']), el('span', 'badge badge-neutral', ['XLS']), el('span', 'badge badge-neutral', ['CSV'])])
    ]);
    zone.id = 'upload-zone';
    zone.setAttribute('role', 'button');
    zone.setAttribute('tabindex', '0');
    zone.setAttribute('aria-label', 'اختيار ملف الموظفين');
    zone.addEventListener('click', function () { input.click(); });
    zone.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    var depth = 0;
    zone.addEventListener('dragenter', function (e) { e.preventDefault(); depth++; zone.classList.add('dragging'); });
    zone.addEventListener('dragover', function (e) { e.preventDefault(); });
    zone.addEventListener('dragleave', function () { depth = Math.max(0, depth - 1); if (!depth) zone.classList.remove('dragging'); });
    zone.addEventListener('drop', function (e) { e.preventDefault(); depth = 0; zone.classList.remove('dragging'); if (e.dataTransfer.files[0]) importFile(e.dataTransfer.files[0]); });
    input.addEventListener('change', function () { if (input.files[0]) importFile(input.files[0]); input.value = ''; });
    nodes.push(zone);
    nodes.push(input);

    var restore = el('input', 'sr-only');
    restore.type = 'file'; restore.accept = '.json,application/json'; restore.tabIndex = -1;
    restore.setAttribute('aria-hidden', 'true');
    restore.addEventListener('change', function () { if (restore.files[0]) loadProject(restore.files[0]); restore.value = ''; });

    function startCard(icon, title, sub, fn, id) {
      var b = el('button', 'start-card', [el('span', 'start-card-icon', [iconEl(icon)]), el('span', null, [el('div', 'start-card-title', [title]), el('div', 'start-card-sub', [sub])])]);
      b.type = 'button'; b.id = id;
      b.addEventListener('click', fn);
      return b;
    }
    nodes.push(el('div', 'start-grid', [
      startCard('sparkle', 'تجربة ببيانات نموذجية', '60 موظفًا وثلاثة مجمعات', loadDemo, 'start-demo'),
      startCard('download', 'تنزيل قالب Excel', 'أعمدة جاهزة مع أمثلة وتعليمات', downloadTemplate, 'start-template'),
      startCard('folder', 'فتح مشروع محفوظ', 'ملف JSON من «حفظ المشروع»', function () { restore.click(); }, 'start-open')
    ]));
    nodes.push(restore);
    nodes.push(sheetEngineNotice());
    return {
      nodes: nodes,
      status: state.people.length ? '' : 'ابدأ برفع ملف',
      next: state.people.length ? { label: 'ربط الأعمدة', fn: function () { goTo(1); } } : null
    };
  }

  function buildMapping(validation) {
    var nodes = [screenHead('الخطوة 2', 'راجع ربط الأعمدة', 'اختر العمود المقابل لكل حقل. المعاينة والتحقق يتحدّثان فورًا.')];
    var mapCard = el('section', 'card');
    mapCard.appendChild(cardHead('الحقول', state.fileName ? (state.fileName + ' — ' + state.rawRows.length + ' صفًا، ' + state.headers.length + ' عمودًا') : null));
    var grid = el('div', 'mapping-grid');
    var mapOptions = [{ value: '', label: '— غير مربوط —' }].concat(state.headers.map(function (h) { return { value: h, label: h }; }));
    FIELDS.forEach(function (field) {
      var mapped = state.mapping[field.key];
      var idx = headerIndex(mapped);
      var sample = '';
      if (idx >= 0) for (var r = 0; r < state.rawRows.length && r < 200; r++) { var v = String(cell(state.rawRows[r], idx)).trim(); if (v) { sample = v; break; } }
      var box = el('div', 'map-field' + (mapped ? ' is-mapped' : '') + (field.required && !mapped ? ' is-missing' : ''));
      var badge = mapped ? el('span', 'badge badge-success', ['مربوط']) : el('span', 'badge ' + (field.required ? 'badge-danger' : 'badge-neutral'), [field.required ? 'مطلوب' : 'اختياري']);
      box.appendChild(el('div', 'map-field-top', [el('span', 'field-label', [field.label, field.required ? el('span', 'req', ['*']) : null]), badge]));
      box.appendChild(customSelect(mapOptions, mapped || '', function (v) {
        state.mapping[field.key] = v;
        rebuildPeopleFromRaw();
        recompute();
        render();
      }, { id: 'map-' + field.key, ariaLabel: 'عمود ' + field.label }));
      box.appendChild(el('div', 'map-sample', sample ? ['مثال: ', el('b', null, [sample])] : [mapped ? 'العمود فارغ' : '']));
      grid.appendChild(box);
    });
    mapCard.appendChild(grid);
    nodes.push(mapCard);

    var vCard = el('section', 'card');
    vCard.appendChild(cardHead('التحقق'));
    var unknownKeys = Object.keys(validation.unknown);
    if (validation.ok) {
      vCard.appendChild(notice('success', 'check', ['كل الحقول المطلوبة سليمة — ' + state.people.length + ' موظفًا جاهزون للحساب.']));
    } else {
      var list = el('div', 'check-list');
      if (!state.mapping.name) list.appendChild(el('div', 'check-item', [el('span', null, ['ربط حقل الاسم']), el('strong', null, ['مطلوب'])]));
      if (!state.mapping.tier) list.appendChild(el('div', 'check-item', [el('span', null, ['ربط حقل الفئة']), el('strong', null, ['مطلوب'])]));
      if (state.mapping.name && validation.missingName) list.appendChild(el('div', 'check-item', [el('span', null, ['صفوف بلا اسم — أكملها في الملف أو اختر عمودًا آخر']), el('strong', null, [num(String(validation.missingName))])]));
      if (state.mapping.tier && unknownKeys.length) list.appendChild(el('div', 'check-item', [el('span', null, ['قيم فئة غير معروفة — اربطها أدناه']), el('strong', null, [num(String(unknownKeys.length))])]));
      vCard.appendChild(list);
    }
    if (state.mapping.tier && unknownKeys.length) {
      vCard.appendChild(el('div', 'label', ['اربط كل قيمة مرة واحدة — يُحفظ الربط لهذا الجهاز']));
      vCard.lastChild.style.margin = '18px 0 10px';
      var ug = el('div', 'unknown-grid');
      var tierOptions = [{ value: '', label: 'اختر فئة' }].concat(Object.keys(state.tiers).map(function (t) { return { value: t, label: t }; }));
      unknownKeys.forEach(function (raw, i) {
        var row = el('div', 'unknown-row', [el('div', 'raw', [raw || '(فارغ)', el('span', null, ['× ' + validation.unknown[raw]])])]);
        row.appendChild(customSelect(tierOptions, state.tierMappings[raw] || '', function (v) {
          if (v) state.tierMappings[raw] = v; else delete state.tierMappings[raw];
          try { localStorage.setItem('tierMappings', JSON.stringify(state.tierMappings)); } catch (e) {}
          rebuildPeopleFromRaw();
          recompute();
          render();
        }, { small: true, id: 'unknown-tier-' + i, ariaLabel: 'فئة القيمة ' + (raw || 'الفارغة') }));
        ug.appendChild(row);
      });
      vCard.appendChild(ug);
    }
    var pinKeys = Object.keys(validation.unknownPins);
    if (pinKeys.length) {
      var pinNotice = notice('warning', 'info', ['قيم قفل لا تطابق أي مجمع وستُعامل كتلقائي: ' + pinKeys.slice(0, 6).join('، ') + (pinKeys.length > 6 ? '…' : '')]);
      pinNotice.style.marginTop = '12px';
      vCard.appendChild(pinNotice);
    }
    nodes.push(vCard);

    var preview = el('section', 'card card-flush');
    preview.appendChild(cardHead('معاينة', 'أول ' + Math.min(50, state.rawRows.length) + ' من ' + state.rawRows.length + ' صفًا — الأعمدة المربوطة مميّزة')); 
    var scroll = el('div', 'table-wrap preview-wrap');
    scroll.setAttribute('data-scroll-key', 'mapping-preview');
    var table = el('table', 'data-table preview-table');
    table.appendChild(el('caption', 'sr-only', ['معاينة بيانات الموظفين']));
    var mappedSet = {};
    Object.keys(state.mapping).forEach(function (k) { if (state.mapping[k]) mappedSet[state.mapping[k]] = true; });
    var tr = el('tr');
    state.headers.forEach(function (h) { tr.appendChild(el('th', mappedSet[h] ? 'mapped' : null, [h])); });
    var thead = el('thead', null, [tr]);
    table.appendChild(thead);
    var tbody = el('tbody');
    var nameIdx = headerIndex(state.mapping.name), tierIdx = headerIndex(state.mapping.tier);
    state.rawRows.slice(0, 50).forEach(function (row) {
      var r = el('tr');
      state.headers.forEach(function (h, i) {
        var td = el('td');
        td.textContent = row[i] == null ? '' : String(row[i]);
        if ((i === nameIdx && !String(row[i] || '').trim()) || (i === tierIdx && !canonicalTier(row[i]))) td.className = 'problem';
        r.appendChild(td);
      });
      tbody.appendChild(r);
    });
    table.appendChild(tbody);
    scroll.appendChild(table);
    preview.appendChild(scroll);
    nodes.push(preview);

    return {
      nodes: nodes,
      back: { label: 'الملف', fn: function () { goTo(0); } },
      status: validation.ok ? 'جاهز للمتابعة' : 'أكمل التحقق للمتابعة',
      next: { label: 'المبالغ والفترة', disabled: !validation.ok, fn: function () { recompute(); goTo(2); } }
    };
  }

  function engineErrorNotice() {
    if (!state.result || state.result.ok) return null;
    var e = state.result.errors && state.result.errors[0];
    var hint = '';
    if (e && e.code === 'EMPTY_POOL_WITH_BUDGET') hint = ' — ألغِ بعض التثبيتات أو اجعل مبلغ المجمع صفرًا.';
    if (e && e.code === 'NO_ELIGIBLE') hint = ' — ألغِ استبعاد بعض الموظفين.';
    return notice('danger', 'alert', [(e && e.message) || 'تعذر الحساب — راجع البيانات', hint]);
  }

  function kpiCard(label, value, unit, note, hero) {
    return el('div', 'card kpi' + (hero ? ' kpi-hero' : ''), [
      el('div', 'kpi-label', [label]),
      el('div', 'kpi-value tabular', [num(value), unit ? el('span', 'kpi-unit', [unit]) : null]),
      note ? el('div', 'kpi-note', [note]) : null
    ]);
  }

  var commitAmounts = debounce(function () { recompute(); render(); }, 260);

  function buildAmounts() {
    var nodes = [screenHead('الخطوة 3', 'المبالغ والفترة', 'أدخل الإجمالي قبل الخصم لكل مجمع. نصيب النقطة يتحدّث أثناء الكتابة.')];
    var grid = el('div', 'amount-grid');
    Object.keys(state.pools).forEach(function (name, i) {
      var pool = state.pools[name];
      var card = el('div', 'card amount-card');
      card.appendChild(el('div', 'amount-card-head', [el('div', 'pool-name', [name]), el('span', 'badge badge-neutral', ['خصم ', num(formatPercent(pool.taxRate, 2))])]));
      var wrap = el('div', 'amount-input-wrap');
      var input = el('input', 'field-input tabular');
      input.id = 'amount-' + i;
      input.type = 'text';
      input.inputMode = 'decimal';
      input.dir = 'ltr';
      input.autocomplete = 'off';
      input.setAttribute('aria-label', 'إجمالي مجمع ' + name);
      input.value = Engine.hasOwn(amountDrafts, name) ? amountDrafts[name] : (pool.gross ? formatEGP(pool.gross, pool.gross % 1 ? 2 : 0) : '');
      input.placeholder = '0';
      input.addEventListener('focus', function () { if (Engine.hasOwn(amountDrafts, name)) return; input.value = pool.gross ? String(pool.gross) : ''; amountDrafts[name] = input.value; input.select(); });
      input.addEventListener('input', function () {
        amountDrafts[name] = input.value;
        var v = parseNumber(input.value);
        state.pools[name].gross = v != null && v >= 0 ? Math.round(v * 100) / 100 : 0;
        commitAmounts();
      });
      input.addEventListener('blur', function () {
        var id = input.id;
        setTimeout(function () {
          if (document.activeElement && document.activeElement.id === id) return;
          delete amountDrafts[name];
          commitAmounts();
        }, 0);
      });
      wrap.appendChild(input);
      wrap.appendChild(el('span', 'amount-unit', ['ج.م']));
      card.appendChild(wrap);
      card.appendChild(el('div', 'amount-meta', [el('span', null, ['الصافي بعد الخصم']), el('strong', null, [num(formatEGP(pool.gross * (1 - pool.taxRate), 2))])]));
      grid.appendChild(card);
    });
    nodes.push(grid);

    var meta = el('div', 'card');
    meta.appendChild(cardHead('بيانات التقرير'));
    var mg = el('div', 'meta-grid');
    function textField(label, id, value, onInput, opts) {
      opts = opts || {};
      var f = el('div', 'field');
      var l = el('label', 'field-label', [label]); l.htmlFor = id;
      var inp = el('input', 'field-input');
      inp.id = id;
      inp.type = 'text';
      if (opts.numeric) { inp.inputMode = 'numeric'; inp.dir = 'ltr'; }
      inp.value = value;
      inp.addEventListener(opts.numeric ? 'change' : 'input', function () { onInput(inp.value, inp); });
      f.appendChild(l); f.appendChild(inp);
      if (opts.help) f.appendChild(el('div', 'field-help', [opts.help]));
      return f;
    }
    mg.appendChild(textField('عنوان التقرير', 'meta-title', state.title, function (v) { state.title = v; saveSession(); }));
    mg.appendChild(textField('الفترة', 'meta-period', state.period, function (v) { state.period = v; saveSession(); }));
    mg.appendChild(textField('عدد أيام الفترة', 'meta-days', String(state.periodDays), function (v, inp) {
      var d = Math.floor(parseNumber(v) || 0);
      if (d < 1) { d = state.periodDays; inp.value = String(d); showToast('عدد الأيام يجب أن يكون 1 على الأقل'); return; }
      state.periodDays = d;
      recompute();
      render();
    }, { numeric: true }));
    meta.appendChild(mg);
    nodes.push(meta);

    var totalWeight = 0, eligible = 0;
    state.people.forEach(function (p) { var w = Engine.effectiveWeight(p, state.tiers, state.periodDays) || 0; totalWeight += w; if (w > 0) eligible++; });
    var netTotal = Object.keys(state.pools).reduce(function (s, n) { return s + state.pools[n].gross * (1 - state.pools[n].taxRate); }, 0);
    var ok = state.result && state.result.ok;
    nodes.push(el('div', 'kpi-grid', [
      kpiCard('الموظفون', String(state.people.length), null, eligible + ' مستحق'),
      kpiCard('إجمالي النقاط', formatEGP(totalWeight, 0), 'نقطة'),
      kpiCard('صافي المجمعات', formatEGP(netTotal, 2), 'ج.م'),
      kpiCard('نصيب النقطة', ok ? formatEGP(state.result.k, 4) : '—', ok ? 'ج.م' : null, 'صافي لكل نقطة في جدول الفئات', true)
    ]));
    nodes.push(engineErrorNotice());

    return {
      nodes: nodes,
      back: { label: 'ربط الأعمدة', fn: function () { goTo(1); } },
      status: ok ? ('نصيب النقطة ' + formatEGP(state.result.k, 4) + ' ج.م') : '',
      next: { label: 'التوزيع', fn: function () { recompute(); goTo(3); } }
    };
  }

  function deviationBadge(pool) {
    if (pool.zeroBudgetWithMembers) { var b = el('span', 'badge badge-warning', ['بلا مبلغ']); b.title = 'الأعضاء المثبّتون لن يحصلوا على شيء'; return b; }
    if (pool.deviation == null) return el('span', 'badge badge-neutral', ['—']);
    var abs = Math.abs(pool.deviation);
    var tone = abs < 0.005 ? 'badge-success' : (abs < 0.02 ? 'badge-warning' : 'badge-danger');
    var badge = el('span', 'badge ' + tone, [num((pool.deviation > 0 ? '+' : '') + formatPercent(pool.deviation, 2))]);
    badge.title = 'انحراف الوزن المحقق عن الهدف';
    return badge;
  }

  function buildPoolCards(result) {
    var grid = el('div', 'pool-grid');
    Object.keys(result.poolResults).forEach(function (name) {
      var p = result.poolResults[name];
      var card = el('div', 'card pool-card');
      card.appendChild(el('div', 'pool-card-head', [el('div', 'pool-name', [name]), deviationBadge(p)]));
      card.appendChild(el('div', 'pool-net tabular', [num(formatEGP(p.net, 2)), el('span', 'kpi-unit', ['صافي'])]));
      card.appendChild(el('div', 'pool-stats', [
        el('div', 'pool-stat', [el('span', null, ['الإجمالي']), el('strong', null, [num(formatEGP(p.effectiveGross, 0))])]),
        el('div', 'pool-stat', [el('span', null, ['الخصم']), el('strong', null, [num(formatEGP(p.effectiveGross - p.net, 0))])]),
        el('div', 'pool-stat', [el('span', null, ['المستحقون']), el('strong', null, [num(String(p.memberCount))])])
      ]));
      if (p.roundingAdjusted) card.appendChild(el('div', 'field-help', ['عُدّل الإجمالي من ', num(formatEGP(p.gross, 2)), ' إلى ', num(formatEGP(p.effectiveGross, 2)), ' للتقريب']));
      if (p.zeroBudgetWithMembers) card.appendChild(el('div', 'field-help field-help-error', ['مجمع بلا مبلغ — الأعضاء المثبّتون لن يحصلوا على شيء']));
      var track = el('div', 'weight-bar-track');
      var max = Math.max(p.actualWeight, p.targetWeight, 1);
      var fill = el('div', 'weight-bar-fill'); fill.style.inlineSize = Math.min(100, p.actualWeight / max * 100) + '%';
      var target = el('div', 'weight-bar-target'); target.style.insetInlineStart = 'calc(' + Math.min(100, p.targetWeight / max * 100) + '% - 1px)';
      track.appendChild(fill); track.appendChild(target);
      card.appendChild(track);
      card.appendChild(el('div', 'pool-foot', [el('span', null, ['المحقق ', num(formatEGP(p.actualWeight, 0))]), el('span', null, ['الهدف ', num(formatEGP(p.targetWeight, 0))])]));
      grid.appendChild(card);
    });
    return grid;
  }

  function warningBanner() {
    var warnings = (state.result && state.result.warnings) || [];
    if (!warnings.length) return null;
    var counts = {};
    warnings.forEach(function (w) { counts[w.code] = (counts[w.code] || 0) + 1; });
    var parts = Object.keys(counts).map(function (code) { return (WARNING_LABELS[code] || code) + ' (' + counts[code] + ')'; });
    return notice('warning', 'info', ['تنبيهات صُحّحت تلقائيًا: ' + parts.join('، ')]);
  }

  function resultIndex() {
    if (!state.result || !state.result.ok) return new Map();
    if (state.__resultIndex && state.__resultIndexFor === state.result) return state.__resultIndex;
    var map = new Map();
    state.result.people.forEach(function (r) { map.set(r.id, r); });
    state.__resultIndex = map;
    state.__resultIndexFor = state.result;
    return map;
  }

  function isSpecial(person) {
    return !!(person.penaltyRate || person.daysWorked != null || person.pinnedPool || person.excluded || person.overrideValue != null || person.manualFactor != null);
  }

  function filteredPeople() {
    var f = state.filters;
    var byId = resultIndex();
    var needle = f.search ? Engine.normalizeArabic(f.search) : '';
    return state.people.filter(function (p) {
      if (needle && Engine.normalizeArabic(p.name + ' ' + (p.job || '')).indexOf(needle) < 0) return false;
      if (f.dept && p.dept !== f.dept) return false;
      if (f.tier && p.tier !== f.tier) return false;
      if (f.pool) { var r = byId.get(p.id); if (!r || r.pool !== f.pool) return false; }
      if (f.special && !isSpecial(p)) return false;
      if (f.excluded && !p.excluded) return false;
      return true;
    });
  }

  function activeFilterDescriptions() {
    var f = state.filters, out = [];
    if (f.search) out.push('بحث: ' + f.search);
    if (f.dept) out.push(f.dept);
    if (f.tier) out.push(f.tier);
    if (f.pool) out.push(f.pool);
    if (f.special) out.push('الحالات الخاصة');
    if (f.excluded) out.push('المستبعدون');
    return out;
  }

  var applySearch = debounce(function (value) { state.filters.search = value; viewPage = 0; render(); }, 140);

  function buildFilterCard(shownCount) {
    var card = el('div', 'card');
    var bar = el('div', 'filter-bar');
    var sf = el('div', 'field');
    var sl = el('label', 'field-label', ['بحث']); sl.htmlFor = 'filter-search';
    var sw = el('div', 'input-icon', [iconEl('search')]);
    var search = el('input', 'field-input');
    search.id = 'filter-search';
    search.type = 'search';
    search.value = state.filters.search;
    search.placeholder = 'اسم أو وظيفة…';
    search.autocomplete = 'off';
    search.addEventListener('input', function () { applySearch(search.value); });
    sw.appendChild(search);
    sf.appendChild(sl); sf.appendChild(sw);
    bar.appendChild(sf);
    var depts = Array.from(new Set(state.people.map(function (p) { return p.dept; }))).sort(function (a, b) { return a.localeCompare(b, 'ar'); });
    [['dept', 'الإدارة', depts], ['tier', 'الفئة', Object.keys(state.tiers)], ['pool', 'المجمع', Object.keys(state.pools)]].forEach(function (c) {
      var f = el('div', 'field', [el('span', 'field-label', [c[1]])]);
      var opts = [{ value: '', label: 'الكل' }].concat(c[2].map(function (v) { return { value: v, label: v }; }));
      f.appendChild(customSelect(opts, state.filters[c[0]] || '', function (v) { state.filters[c[0]] = v; viewPage = 0; render(); }, { id: 'filter-' + c[0], ariaLabel: 'تصفية حسب ' + c[1] }));
      bar.appendChild(f);
    });
    bar.appendChild(el('div', 'filter-chips', [
      filterChip('الحالات الخاصة', state.filters.special, function (v) { state.filters.special = v; viewPage = 0; render(); }, 'filter-special'),
      filterChip('المستبعدون', state.filters.excluded, function (v) { state.filters.excluded = v; viewPage = 0; render(); }, 'filter-excluded')
    ]));
    card.appendChild(bar);
    var desc = activeFilterDescriptions();
    if (desc.length) {
      var summary = el('div', 'filter-summary', [el('span', null, ['عرض ', num(String(shownCount)), ' من ', num(String(state.people.length))])]);
      desc.forEach(function (d) { summary.appendChild(el('span', 'badge badge-neutral', [d])); });
      summary.appendChild(button('مسح', 'btn-quiet btn-sm', function () { state.filters = emptyFilters(); viewPage = 0; render(); }, { icon: 'close', id: 'filter-clear' }));
      card.appendChild(summary);
    }
    return card;
  }

  function buildPager(total) {
    var pages = Math.ceil(total / PAGE_SIZE);
    if (pages <= 1) return null;
    if (viewPage >= pages) viewPage = pages - 1;
    var from = viewPage * PAGE_SIZE + 1, to = Math.min(total, from + PAGE_SIZE - 1);
    return el('div', 'pager', [
      el('span', null, [num(from + '–' + to), ' من ', num(String(total))]),
      el('div', 'pager-nav', [
        button('السابق', 'btn-ghost btn-sm', function () { viewPage = Math.max(0, viewPage - 1); render(); scrollTableTop(); }, { disabled: viewPage === 0, id: 'pager-prev' }),
        button('التالي', 'btn-ghost btn-sm', function () { viewPage = Math.min(pages - 1, viewPage + 1); render(); scrollTableTop(); }, { disabled: viewPage >= pages - 1, id: 'pager-next' })
      ])
    ]);
  }

  function scrollTableTop() {
    var wrap = document.querySelector('[data-scroll-key="main-table"]');
    if (wrap) wrap.scrollTop = 0;
  }

  function pageSlice(list) {
    var pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (viewPage >= pages) viewPage = pages - 1;
    return list.slice(viewPage * PAGE_SIZE, viewPage * PAGE_SIZE + PAGE_SIZE);
  }

  function emptyRows(filteredCount) {
    var box = el('div', 'empty-state', [iconEl('search'), el('div', null, [filteredCount === 0 && activeFilterDescriptions().length ? 'لا توجد نتائج مطابقة للفلاتر' : 'لا توجد بيانات'])]);
    if (activeFilterDescriptions().length) box.appendChild(button('مسح الفلاتر', 'btn-ghost btn-sm', function () { state.filters = emptyFilters(); viewPage = 0; render(); }));
    return box;
  }

  function cellInput(id, value, placeholder, label, onCommit) {
    var inp = el('input', 'cell-input tabular' + (value !== '' ? ' has-value' : ''));
    inp.id = id;
    inp.type = 'text';
    inp.inputMode = 'decimal';
    inp.dir = 'ltr';
    inp.autocomplete = 'off';
    inp.value = value;
    inp.placeholder = placeholder;
    inp.setAttribute('aria-label', label);
    inp.addEventListener('change', function () { onCommit(inp.value); });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Escape') { inp.value = value; inp.blur(); } });
    return inp;
  }

  function buildAllocation() {
    var nodes = [screenHead('الخطوة 4', 'التوزيع والحالات الخاصة', 'الحساب يتم على كامل العدد. ثبّت مجمعًا أو عدّل الأيام والجزاء، ويُعاد التوزيع فورًا. الفلاتر للعرض فقط.')];
    var ok = state.result && state.result.ok;
    var strip = el('div', 'k-strip');
    strip.appendChild(el('div', null, [el('div', 'k-strip-label', ['صافي النقطة — التوزيع الحالي']), el('div', 'k-strip-value tabular', [num(ok ? formatEGP(state.result.k, 4) : '—'), ok ? el('span', 'kpi-unit', ['ج.م']) : null])]));
    strip.appendChild(button(state.history.length ? 'تراجع (' + state.history.length + ')' : 'تراجع', 'btn-ghost btn-sm', undo, { icon: 'undo', disabled: !state.history.length, id: 'alloc-undo', title: null }));
    nodes.push(strip);
    nodes.push(engineErrorNotice());
    if (ok) {
      nodes.push(warningBanner());
      nodes.push(buildPoolCards(state.result));
    }
    var filtered = filteredPeople();
    nodes.push(buildFilterCard(filtered.length));

    var card = el('section', 'card card-flush');
    card.appendChild(cardHead('الموظفون', filtered.length + ' صفًا — الصفوف المعدّلة مميّزة بشريط جانبي'));
    if (!filtered.length) { card.appendChild(emptyRows(0)); nodes.push(card); }
    else {
      var scroll = el('div', 'table-wrap');
      scroll.setAttribute('data-scroll-key', 'main-table');
      var table = el('table', 'data-table allocation-table');
      table.appendChild(el('caption', 'sr-only', ['جدول تعديل حالات الموظفين']));
      var colgroup = el('colgroup');
      [210, 150, 110, 180, 82, 86, 104, 78, 120].forEach(function (w) { var c = el('col'); c.style.width = w + 'px'; colgroup.appendChild(c); });
      table.appendChild(colgroup);
      var head = el('tr');
      ['الاسم', 'الإدارة', 'الفئة', 'المجمع', 'أيام', 'جزاء %', 'قيمة مخصصة', 'استبعاد', 'الصافي'].forEach(function (h, i) { head.appendChild(el('th', i === 8 ? 'num-cell' : null, [h])); });
      table.appendChild(el('thead', null, [head]));
      var body = el('tbody');
      var byId = resultIndex();
      var poolOptions = [{ value: '', label: 'تلقائي' }].concat(Object.keys(state.pools).map(function (n) { return { value: n, label: n }; }));
      pageSlice(filtered).forEach(function (person) {
        var r = byId.get(person.id);
        var row = el('tr', (isSpecial(person) ? 'is-special' : '') + (person.excluded ? ' is-excluded' : ''));
        var nameTd = el('td', 'name-cell', [person.name || '—']); nameTd.title = person.name + (person.job ? ' — ' + person.job : '');
        row.appendChild(nameTd);
        row.appendChild(el('td', null, [person.dept || '—']));
        row.appendChild(el('td', Engine.hasOwn(state.tiers, person.tier) ? null : 'muted', [person.tier || '—']));
        var assigned = r && r.pool ? r.pool : '';
        var poolSel = customSelect(poolOptions, person.pinnedPool || '', function (v) { editPerson(person.id, { pinnedPool: Engine.normalizePinnedPool(v) }); }, {
          small: true, id: 'alloc-pool-' + person.id, icon: person.pinnedPool ? 'lock' : null,
          className: person.pinnedPool ? 'is-pinned' : '',
          ariaLabel: 'المجمع — ' + (person.name || ''),
          placeholder: assigned ? 'تلقائي · ' + assigned : 'تلقائي'
        });
        if (!person.pinnedPool && assigned) poolSel.querySelector('.cs-label').textContent = assigned;
        row.appendChild(el('td', null, [poolSel]));
        row.appendChild(el('td', null, [cellInput('alloc-days-' + person.id, person.daysWorked == null ? '' : trimNumber(person.daysWorked, 2), String(state.periodDays), 'أيام العمل — ' + person.name, function (v) {
          var d = parseNumber(v);
          editPerson(person.id, { daysWorked: d == null ? null : Engine.clamp(d, 0, state.periodDays) });
        })]));
        row.appendChild(el('td', null, [cellInput('alloc-penalty-' + person.id, person.penaltyRate ? trimNumber(person.penaltyRate * 100, 2) : '', '0', 'نسبة الجزاء % — ' + person.name, function (v) {
          var n = parseNumber(v);
          if (n != null && !/[%٪]/.test(v)) n = n / 100;
          editPerson(person.id, { penaltyRate: n == null || n === 0 ? null : Engine.clamp(n, 0, 1) });
        })]));
        var base = state.tiers[person.tier];
        row.appendChild(el('td', null, [cellInput('alloc-override-' + person.id, person.overrideValue == null ? '' : trimNumber(person.overrideValue, 2), base == null ? '' : String(base), 'قيمة مخصصة — ' + person.name, function (v) {
          var o = parseNumber(v);
          editPerson(person.id, { overrideValue: o == null ? null : Math.max(0, o) });
        })]));
        var sw = el('label', 'switch');
        var cb = el('input'); cb.type = 'checkbox'; cb.id = 'alloc-exclude-' + person.id; cb.checked = !!person.excluded;
        cb.setAttribute('aria-label', 'استبعاد — ' + person.name);
        cb.addEventListener('change', function () { editPerson(person.id, { excluded: cb.checked }); });
        sw.appendChild(cb); sw.appendChild(el('span', 'switch-track'));
        row.appendChild(el('td', null, [sw]));
        row.appendChild(el('td', 'num-cell strong', [num(ok && r ? formatEGP(r.netPiastres / 100, 2) : '—')]));
        body.appendChild(row);
      });
      table.appendChild(body);
      scroll.appendChild(table);
      card.appendChild(scroll);
      card.appendChild(buildPager(filtered.length));
      nodes.push(card);
    }
    return {
      nodes: nodes,
      back: { label: 'المبالغ', fn: function () { goTo(2); } },
      status: state.history.length ? state.history.length + ' تعديل — Ctrl+Z للتراجع' : '',
      next: { label: 'النتائج', disabled: !ok, fn: function () { goTo(4); } }
    };
  }

  function barList(entries, max, alt, formatter) {
    var list = el('div', 'bar-list');
    entries.forEach(function (e, i) {
      var fill = el('div', 'bar-fill' + (alt ? ' alt' : ''));
      fill.style.width = Math.max(2, e[1] / max * 100) + '%';
      fill.style.animationDelay = (i * 30) + 'ms';
      var label = el('div', 'bar-label', [e[0]]); label.title = e[0];
      list.appendChild(el('div', 'bar-row', [label, el('div', 'bar-track', [fill]), el('div', 'bar-value tabular', [num(formatter(e[1]))])]));
    });
    return list;
  }

  function buildCharts() {
    var byId = resultIndex();
    var sums = {}, groups = {};
    state.people.forEach(function (p) {
      var r = byId.get(p.id);
      var net = r ? r.netPiastres / 100 : 0;
      sums[p.dept] = (sums[p.dept] || 0) + net;
      groups[p.tier] = (groups[p.tier] || 0) + 1;
    });
    var deptEntries = Object.keys(sums).map(function (k) { return [k, sums[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
    var more = deptEntries.length > 8 ? deptEntries.length - 8 : 0;
    deptEntries = deptEntries.slice(0, 8);
    var tierEntries = Object.keys(state.tiers).filter(function (t) { return groups[t]; }).map(function (t) { return [t, groups[t]]; });
    var c1 = el('section', 'card', [cardHead('الصافي حسب الإدارة', more ? 'أعلى 8 إدارات من ' + (8 + more) : 'على كامل العدد')]);
    c1.appendChild(deptEntries.length ? barList(deptEntries, deptEntries.reduce(function (m, x) { return Math.max(m, x[1]); }, 1), false, function (v) { return formatEGP(v, 0); }) : emptyRows(1));
    var c2 = el('section', 'card', [cardHead('الموظفون حسب الفئة', 'على كامل العدد')]);
    c2.appendChild(tierEntries.length ? barList(tierEntries, tierEntries.reduce(function (m, x) { return Math.max(m, x[1]); }, 1), true, function (v) { return String(v); }) : emptyRows(1));
    return el('div', 'chart-grid', [c1, c2]);
  }

  function buildDashboard() {
    var nodes = [screenHead('الخطوة 5', 'النتائج', 'الأرقام محسوبة على كامل العدد. البحث والفلاتر تغيّر العرض فقط.')];
    if (!state.result || !state.result.ok) {
      nodes.push(engineErrorNotice() || notice('danger', 'alert', ['لا توجد نتائج بعد']));
      return { nodes: nodes, back: { label: 'التوزيع', fn: function () { goTo(3); } } };
    }
    var res = state.result;
    var gross = 0, tax = 0, net = 0, eligible = 0;
    res.people.forEach(function (p) { gross += p.grossPiastres; tax += p.taxPiastres; net += p.netPiastres; if (p.netPiastres > 0) eligible++; });
    nodes.push(el('div', 'kpi-grid', [
      kpiCard('إجمالي الموزع', formatEGP(gross / 100, 2), 'ج.م'),
      kpiCard('إجمالي الخصومات', formatEGP(tax / 100, 2), 'ج.م'),
      kpiCard('صافي المصروف', formatEGP(net / 100, 2), 'ج.م', eligible + ' مستحق من ' + state.people.length),
      kpiCard('نصيب النقطة', formatEGP(res.k, 4), 'ج.م', 'صافي لكل نقطة', true)
    ]));
    nodes.push(buildPoolCards(res));
    nodes.push(buildCharts());
    var filtered = filteredPeople();
    nodes.push(buildFilterCard(filtered.length));

    var card = el('section', 'card card-flush');
    card.appendChild(cardHead('التفصيل', filtered.length + ' صفًا — اضغط عنوان العمود للترتيب'));
    if (!filtered.length) { card.appendChild(emptyRows(0)); nodes.push(card); }
    else {
      var byId = resultIndex();
      var columns = [
        { label: 'الاسم', key: 'name', w: 180 }, { label: 'الوظيفة', key: 'job', w: 140 }, { label: 'الإدارة', key: 'dept', w: 140 }, { label: 'الفئة', key: 'tier', w: 100 }, { label: 'المجمع', key: 'pool', w: 150 },
        { label: 'الوزن', key: 'weight', num: true, w: 86 }, { label: 'الإجمالي', key: 'gross', num: true, w: 110 }, { label: 'الخصم', key: 'tax', num: true, w: 96 }, { label: 'الصافي', key: 'net', num: true, w: 116, strong: true }
      ];
      var rows = filtered.map(function (p) {
        var r = byId.get(p.id) || {};
        return { id: p.id, excluded: p.excluded, special: isSpecial(p), name: p.name || '', job: p.job || '', dept: p.dept || '', tier: p.tier || '', pool: r.pool || '—', weight: r.weight || 0, gross: (r.grossPiastres || 0) / 100, tax: (r.taxPiastres || 0) / 100, net: (r.netPiastres || 0) / 100 };
      });
      if (sortKey) {
        rows.sort(function (a, b) {
          var av = a[sortKey], bv = b[sortKey];
          var c = typeof av === 'string' ? String(av).localeCompare(String(bv), 'ar') : (av || 0) - (bv || 0);
          return sortDir * c || Engine.compareIds(a.id, b.id);
        });
      }
      var scroll = el('div', 'table-wrap');
      scroll.setAttribute('data-scroll-key', 'main-table');
      var table = el('table', 'data-table stack-table dashboard-table');
      table.appendChild(el('caption', 'sr-only', ['تفصيل صافي كل موظف']));
      var colgroup = el('colgroup');
      columns.forEach(function (c) { var col = el('col'); col.style.width = c.w + 'px'; colgroup.appendChild(col); });
      table.appendChild(colgroup);
      var head = el('tr');
      columns.forEach(function (col) {
        var th = el('th', col.num ? 'num-cell' : null);
        var b = el('button', 'table-sort-btn', [col.label, iconEl('sort')]);
        b.type = 'button';
        b.id = 'sort-' + col.key;
        if (sortKey === col.key) { b.setAttribute('data-dir', sortDir === 1 ? 'asc' : 'desc'); th.setAttribute('aria-sort', sortDir === 1 ? 'ascending' : 'descending'); }
        b.addEventListener('click', function () {
          if (sortKey === col.key) { if (sortDir === -1) { sortKey = null; sortDir = 1; } else sortDir = -1; }
          else { sortKey = col.key; sortDir = col.num ? -1 : 1; }
          viewPage = 0;
          render();
        });
        th.appendChild(b);
        head.appendChild(th);
      });
      table.appendChild(el('thead', null, [head]));
      var body = el('tbody');
      pageSlice(rows).forEach(function (row) {
        var tr = el('tr', (row.special ? 'is-special' : '') + (row.excluded ? ' is-excluded' : ''));
        columns.forEach(function (col, i) {
          var td = el('td', (col.num ? 'num-cell' : '') + (i === 0 ? ' name-cell' : '') + (col.strong ? ' strong' : ''));
          td.setAttribute('data-label', col.label);
          if (col.num) td.appendChild(num(formatEGP(row[col.key], 2)));
          else { td.textContent = row[col.key] || '—'; td.title = row[col.key] || ''; }
          tr.appendChild(td);
        });
        body.appendChild(tr);
      });
      table.appendChild(body);
      scroll.appendChild(table);
      card.appendChild(scroll);
      card.appendChild(buildPager(rows.length));
      nodes.push(card);
    }
    return {
      nodes: nodes,
      back: { label: 'التوزيع', fn: function () { goTo(3); } },
      status: 'صافي المصروف ' + formatEGP(net / 100, 2) + ' ج.م',
      next: { label: 'التصدير', fn: function () { goTo(5); } }
    };
  }

  var DETAIL_HEADER = ['الاسم', 'الوظيفة', 'الإدارة', 'الفئة', 'المجمع', 'الوزن الأساسي', 'معامل الأيام', 'نسبة الجزاء', 'الوزن الفعلي', 'الإجمالي', 'الخصم', 'الصافي', 'الصافي المستهدف', 'الفرق'];

  function detailRows(people) {
    var rows = [DETAIL_HEADER.slice()];
    var byId = resultIndex();
    people.forEach(function (p) {
      var r = byId.get(p.id);
      if (!r) return;
      var base = p.overrideValue != null ? p.overrideValue : state.tiers[p.tier];
      var daysFactor = p.daysWorked == null ? 1 : Engine.clamp(p.daysWorked / state.periodDays, 0, 1);
      rows.push([
        p.name, p.job, p.dept, p.tier, r.pool || (p.excluded ? 'مستبعد' : ''),
        base == null ? '' : base, daysFactor, p.penaltyRate || 0, r.weight,
        Engine.fromPiastres(r.grossPiastres), Engine.fromPiastres(r.taxPiastres), Engine.fromPiastres(r.netPiastres),
        r.idealNetEGP, Engine.fromPiastres(r.netPiastres) - r.idealNetEGP
      ]);
    });
    return rows;
  }

  function methodologyRows() {
    var rows = [
      ['المنهجية وطريقة الحساب'],
      ['التطبيق', APP_NAME + ' ' + APP_NAME_LATIN + ' — الإصدار ' + APP_VERSION],
      ['التقرير', state.title],
      ['الفترة', state.period],
      ['عدد أيام الفترة', state.periodDays],
      ['نصيب النقطة k', state.result.k],
      ['المعادلة', 'الوزن الفعلي = القيمة الأساسية × معامل الأيام × (1 − نسبة الجزاء) × المعامل اليدوي'],
      ['التوزيع', 'الإجمالي للشخص = إجمالي المجمع × وزن الشخص ÷ مجموع أوزان المجمع'],
      ['الخصم', 'الخصم = تقريب(الإجمالي × نسبة خصم المجمع) والصافي = الإجمالي − الخصم'],
      ['التقريب', 'أكبر باقٍ بأجزاء القروش مع أولوية الوزن الأكبر ثم رقم الصف'],
      ['وحدة التقريب', state.options.roundingStep === 100 ? 'جنيه واحد — يُعدّل إجمالي كل مجمع لأقرب جنيه قبل التوزيع' : 'قرش واحد — دقة كاملة'],
      []
    ];
    Object.keys(state.pools).forEach(function (name) {
      var p = state.result.poolResults[name];
      if (!p) return;
      rows.push(['المجمع', name, 'الإجمالي المدخل', p.gross, 'الإجمالي المستخدم', p.effectiveGross, 'الصافي', p.net, 'الهدف الوزني', p.targetWeight, 'المحقق', p.actualWeight, 'الانحراف', p.deviation]);
    });
    var byId = resultIndex();
    var example = state.people.find(function (p) { var r = byId.get(p.id); return r && r.netPiastres > 0; });
    var er = example ? byId.get(example.id) : null;
    if (example && er) {
      rows.push([]);
      rows.push(['مثال قابل للمراجعة']);
      rows.push(['الموظف', example.name, 'الفئة', example.tier, 'الوزن', er.weight, 'المجمع', er.pool, 'الإجمالي', Engine.fromPiastres(er.grossPiastres), 'الخصم', Engine.fromPiastres(er.taxPiastres), 'الصافي', Engine.fromPiastres(er.netPiastres), 'الصافي المستهدف', er.idealNetEGP]);
    }
    return rows;
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  var MONEY_FORMAT = '#,##0.00';
  var RATE_FORMAT = '0.00%';

  function sanitizeSheetName(name, used) {
    var cleaned = String(name == null ? '' : name).replace(/[\[\]:*?\/\\]/g, ' ').replace(/\s+/g, ' ').trim() || 'ورقة';
    if (cleaned.length > 31) cleaned = cleaned.slice(0, 31).trim();
    if (!used) return cleaned;
    var candidate = cleaned, counter = 2;
    while (used.indexOf(candidate) >= 0) {
      var suffix = ' (' + counter + ')';
      candidate = cleaned.slice(0, 31 - suffix.length).trim() + suffix;
      counter++;
    }
    used.push(candidate);
    return candidate;
  }

  var DETAIL_FORMATS = { 5: MONEY_FORMAT, 6: RATE_FORMAT, 7: RATE_FORMAT, 8: MONEY_FORMAT, 9: MONEY_FORMAT, 10: MONEY_FORMAT, 11: MONEY_FORMAT, 12: MONEY_FORMAT, 13: MONEY_FORMAT };
  var DETAIL_WIDTHS = [26, 24, 24, 16, 22, 14, 12, 12, 14, 14, 14, 14, 16, 14];

  function applyNumberFormats(ws, formats, headerRows) {
    if (!ws || !ws['!ref'] || !formats) return;
    var range = window.XLSX.utils.decode_range(ws['!ref']);
    var startRow = range.s.r + (headerRows == null ? 1 : headerRows);
    Object.keys(formats).forEach(function (colKey) {
      var col = Number(colKey);
      for (var r = startRow; r <= range.e.r; r++) {
        var c = ws[window.XLSX.utils.encode_cell({ r: r, c: col })];
        if (c && c.t === 'n') c.z = formats[colKey];
      }
    });
  }

  function sheetFromAoa(aoa, options) {
    var opts = options || {};
    var ws = window.XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = (opts.widths || (aoa[0] || []).map(function () { return 18; })).map(function (w) { return typeof w === 'number' ? { wch: w } : w; });
    if (opts.formats) applyNumberFormats(ws, opts.formats, opts.headerRows);
    if (opts.autofilter && ws['!ref']) {
      var range = window.XLSX.utils.decode_range(ws['!ref']);
      var headerRow = range.s.r + (opts.headerRows == null ? 0 : opts.headerRows - 1);
      ws['!autofilter'] = { ref: window.XLSX.utils.encode_range({ s: { r: headerRow, c: range.s.c }, e: { r: range.e.r, c: range.e.c } }) };
    }
    return ws;
  }

  function appendSheet(wb, used, name, aoa, options) {
    var ws = sheetFromAoa(aoa, options);
    window.XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(name, used));
    return ws;
  }

  function executiveRows() {
    var byId = resultIndex();
    var grossPi = 0, taxPi = 0, netPi = 0, eligible = 0;
    state.people.forEach(function (p) {
      var r = byId.get(p.id);
      if (!r) return;
      grossPi += r.grossPiastres; taxPi += r.taxPiastres; netPi += r.netPiastres;
      if (r.netPiastres > 0) eligible++;
    });
    return [
      ['الملخص التنفيذي'],
      ['التقرير', state.title],
      ['الفترة', state.period],
      ['عدد الموظفين', state.people.length],
      ['عدد المستحقين', eligible],
      ['إجمالي الموزع', Engine.fromPiastres(grossPi)],
      ['إجمالي الخصومات', Engine.fromPiastres(taxPi)],
      ['الصافي', Engine.fromPiastres(netPi)],
      ['نصيب النقطة', state.result.k],
      ['الأرقام محسوبة على كامل العدد ولا تتأثر بفلاتر العرض']
    ];
  }

  function specialCasePeople() { return state.people.filter(isSpecial); }

  function csvBlob(rows) {
    var csv = rows.map(function (r) { return r.map(function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(','); }).join('\r\n');
    return new Blob([String.fromCharCode(0xFEFF) + csv], { type: 'text/csv;charset=utf-8' });
  }

  function reportBaseName() { return sanitizeFilename((state.title || 'تقرير الحوافز') + (state.period ? ' - ' + state.period : '')); }

  function exportReport() {
    if (!state.result || !state.result.ok) { showToast('لا يمكن التصدير قبل نجاح الحساب'); return; }
    var fullRows = detailRows(state.people);
    if (!window.XLSX) {
      downloadBlob(csvBlob(fullRows), reportBaseName() + '.csv');
      showToast('تم تنزيل CSV لأن محرك Excel غير متاح');
      return;
    }
    var wb = window.XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    var used = [];
    var detailOpts = { widths: DETAIL_WIDTHS, formats: DETAIL_FORMATS, autofilter: true, headerRows: 1 };
    appendSheet(wb, used, 'الملخص التنفيذي', executiveRows(), { widths: [30, 26] });
    appendSheet(wb, used, 'المنهجية وطريقة الحساب', methodologyRows(), { widths: [24, 26, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16] });
    appendSheet(wb, used, 'التفصيل الكامل', fullRows, detailOpts);
    Object.keys(state.pools).forEach(function (name) {
      appendSheet(wb, used, name, fullRows.filter(function (r, i) { return i === 0 || r[4] === name; }), detailOpts);
    });
    appendSheet(wb, used, 'الحالات الخاصة', detailRows(specialCasePeople()), detailOpts);
    window.XLSX.writeFile(wb, reportBaseName() + '.xlsx');
    showToast('تم تنزيل ملف Excel');
  }

  function exportCsv() {
    if (!state.result || !state.result.ok) return;
    downloadBlob(csvBlob(detailRows(state.people)), reportBaseName() + '.csv');
    showToast('تم تنزيل CSV');
  }

  function saveProject() {
    if (!state.people.length) return;
    downloadBlob(new Blob([JSON.stringify(serializeState(), null, 2)], { type: 'application/json;charset=utf-8' }), sanitizeFilename(state.title || 'مشروع الحوافز') + '.json');
    showToast('تم حفظ المشروع كملف JSON');
  }

  function loadProject(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var next = hydrate(JSON.parse(String(reader.result)));
        if (!next.people.length) throw new Error('empty');
        state = next;
        resetView();
        recompute();
        var v = computeValidation();
        if (!canVisit(state.screen, v)) state.screen = v.ok ? 2 : 1;
        render();
        showToast('تم فتح المشروع — ' + state.people.length + ' موظفًا');
      } catch (e) { showToast('ملف المشروع غير صالح'); }
    };
    reader.readAsText(file, 'UTF-8');
  }

  function startNewProject() {
    confirmDialog('بدء مشروع جديد؟', 'سيتم مسح الملف الحالي وكل التعديلات من هذا الجهاز. احفظ المشروع أولًا إن أردت الرجوع إليه. الإعدادات وقيم الفئات تبقى كما هي.', 'مسح والبدء', function () {
      state = makeInitialState();
      resetView();
      try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
      render();
      showToast('مشروع جديد');
    });
  }

  function conservationCheck() {
    if (!state.result || !state.result.ok) return { ok: false, expected: 0, actual: 0 };
    var expected = 0;
    Object.keys(state.result.poolResults).forEach(function (n) { expected += state.result.poolResults[n].effectiveGrossPiastres; });
    var actual = state.result.people.reduce(function (s, r) { return s + r.grossPiastres; }, 0);
    return { ok: expected === actual, expected: expected, actual: actual };
  }

  function buildExport() {
    var nodes = [screenHead('الخطوة 6', 'التصدير', 'ملف Excel قابل للمراجعة بكامل العدد، أو احفظ المشروع لتكمله لاحقًا.')];
    var ok = state.result && state.result.ok;
    if (!ok) nodes.push(engineErrorNotice());
    var grid = el('div', 'export-grid');
    var hero = el('section', 'card export-hero');
    hero.appendChild(cardHead('تقرير Excel', 'يشمل ' + state.people.length + ' صفًا — الفلاتر لا تؤثر على الإجماليات'));
    hero.appendChild(el('div', 'file-chip', [el('span', 'file-chip-icon', [iconEl('sheet')]), el('div', null, [el('div', 'file-chip-name', [reportBaseName() + (window.XLSX || !window.__sheetJsLoadFailed ? '.xlsx' : '.csv')]), el('div', 'file-chip-sub', [(3 + Object.keys(state.pools).length + 1) + ' أوراق · اتجاه من اليمين لليسار'])])]));
    var sheets = el('div', 'sheet-list');
    ['الملخص التنفيذي', 'المنهجية', 'التفصيل الكامل'].concat(Object.keys(state.pools)).concat(['الحالات الخاصة']).forEach(function (s) { sheets.appendChild(el('span', 'badge badge-neutral', [s])); });
    hero.appendChild(sheets);
    var row = el('div', 'toolbar', [
      button('تنزيل تقرير Excel', 'btn-accent btn-lg', exportReport, { icon: 'download', disabled: !ok, id: 'export-xlsx' }),
      button('CSV', 'btn-ghost btn-lg', exportCsv, { icon: 'file', disabled: !ok, id: 'export-csv' })
    ]);
    hero.appendChild(row);
    grid.appendChild(hero);

    var restore = el('input', 'sr-only');
    restore.type = 'file'; restore.accept = '.json,application/json'; restore.tabIndex = -1;
    restore.setAttribute('aria-hidden', 'true');
    restore.addEventListener('change', function () { if (restore.files[0]) loadProject(restore.files[0]); restore.value = ''; });
    var proj = el('section', 'card');
    proj.appendChild(cardHead('المشروع', 'يُحفظ تلقائيًا على هذا الجهاز'));
    proj.appendChild(el('div', 'stack-actions', [
      button('حفظ المشروع كملف', 'btn-ghost', saveProject, { icon: 'save', id: 'export-save' }),
      button('فتح مشروع محفوظ', 'btn-ghost', function () { restore.click(); }, { icon: 'folder', id: 'export-open' }),
      button('بدء مشروع جديد', 'btn-danger', startNewProject, { icon: 'trash', id: 'export-new' }),
      restore
    ]));
    grid.appendChild(proj);
    nodes.push(grid);

    var checks = el('section', 'card');
    checks.appendChild(cardHead('قبل التسليم'));
    if (ok) {
      var check = conservationCheck();
      checks.appendChild(notice(check.ok ? 'success' : 'danger', check.ok ? 'check' : 'alert', [check.ok ? 'تحقق الحفظ: مجموع ما وُزّع يساوي مبالغ المجمعات بالقرش بالضبط.' : 'تحقق الحفظ: فرق ' + formatEGP(Engine.fromPiastres(check.actual - check.expected), 2) + ' ج.م — راجع النتائج قبل التصدير.']));
      var warnings = state.result.warnings || [];
      if (warnings.length) {
        var wl = el('div', 'warn-list');
        wl.style.marginTop = '12px';
        warnings.slice(0, 50).forEach(function (w) { wl.appendChild(el('div', 'warn-item', [w.message])); });
        if (warnings.length > 50) wl.appendChild(el('div', 'warn-item', ['و' + (warnings.length - 50) + ' تنبيهًا آخر']));
        checks.appendChild(wl);
      }
    }
    nodes.push(checks);
    nodes.push(sheetEngineNotice());
    return {
      nodes: nodes,
      back: { label: 'النتائج', fn: function () { goTo(4); } },
      status: ok ? 'جاهز للتنزيل' : '',
      next: { label: 'تنزيل', icon: 'download', disabled: !ok, fn: exportReport }
    };
  }

  function openSettings() {
    var dirty = false;
    function change() { dirty = true; persistSettings(); recompute(); }
    var seg = el('div', 'segmented');
    seg.setAttribute('role', 'tablist');
    var panels = {}, tabs = {};
    function activate(key) { Object.keys(panels).forEach(function (n) { panels[n].classList.toggle('active', n === key); tabs[n].classList.toggle('active', n === key); tabs[n].setAttribute('aria-selected', String(n === key)); }); }
    [['tiers', 'قيم الفئات'], ['pools', 'نسب الخصم'], ['general', 'الحساب']].forEach(function (t) {
      var b = el('button', null, [t[1]]); b.type = 'button'; b.setAttribute('role', 'tab');
      b.addEventListener('click', function () { activate(t[0]); });
      tabs[t[0]] = b; seg.appendChild(b);
    });

    function numInput(value, label, step, onChange) {
      var inp = el('input', 'field-input tabular');
      inp.type = 'text'; inp.inputMode = 'decimal'; inp.dir = 'ltr'; inp.value = value;
      inp.setAttribute('aria-label', label);
      inp.addEventListener('change', function () { onChange(inp); });
      return inp;
    }

    var tierPanel = el('section', 'settings-panel', [el('p', 'settings-intro', ['القيمة الأساسية تحدد نقاط كل فئة. تعديلها يعيد الحساب مباشرة.'])]);
    var tg = el('div', 'setting-grid');
    Object.keys(state.tiers).forEach(function (tier) {
      tg.appendChild(el('div', 'setting-row', [el('span', 'setting-name', [tier]), numInput(String(state.tiers[tier]), 'قيمة فئة ' + tier, 1, function (inp) {
        var v = parseNumber(inp.value);
        state.tiers[tier] = v != null && v >= 0 ? v : state.tiers[tier];
        inp.value = String(state.tiers[tier]);
        change();
      })]));
    });
    tierPanel.appendChild(tg);
    panels.tiers = tierPanel;

    var poolPanel = el('section', 'settings-panel', [el('p', 'settings-intro', ['اكتب النسبة كعدد عشري (0.11) أو مئوية (11%). تُحفظ حتى ست خانات عشرية.'])]);
    var pl = el('div', 'setting-list');
    Object.keys(state.pools).forEach(function (name) {
      pl.appendChild(el('div', 'setting-row', [el('span', 'setting-name', [name]), numInput(String(state.pools[name].taxRate), 'نسبة خصم ' + name, 0.000001, function (inp) {
        var v = parseNumber(inp.value);
        if (v != null && v >= 1 && !/[%٪]/.test(inp.value)) v = v / 100;
        if (v != null && v >= 0 && v < 1) state.pools[name].taxRate = Math.round(v * 1e6) / 1e6;
        inp.value = String(state.pools[name].taxRate);
        change();
      })]));
    });
    poolPanel.appendChild(pl);
    panels.pools = poolPanel;

    var generalPanel = el('section', 'settings-panel', [el('p', 'settings-intro', ['خيارات الحساب لا تغيّر بيانات الموظفين الأصلية.'])]);
    generalPanel.appendChild(el('div', 'setting-row wide', [el('div', null, [el('div', 'setting-name', ['وحدة التقريب']), el('div', 'field-help', ['الافتراضي قرش واحد للدقة الكاملة'])]), customSelect([{ value: '1', label: 'قرش واحد — دقة كاملة' }, { value: '100', label: 'جنيه واحد — تقريب' }], String(state.options.roundingStep), function (v) { state.options.roundingStep = Number(v); change(); }, { id: 'settings-rounding' })]));
    var tip = notice(null, 'info', ['فلاتر العرض لا تعيد تشغيل المحرك؛ المبالغ ثابتة لكامل العدد.']);
    tip.style.marginTop = '12px';
    generalPanel.appendChild(tip);
    panels.general = generalPanel;

    var body = [seg, tierPanel, poolPanel, generalPanel];
    activate('tiers');
    var m = openModal({
      title: 'الإعدادات',
      sub: 'تُحفظ محليًا على هذا الجهاز',
      wide: true,
      body: body,
      onClose: function () { if (dirty) render(); },
      foot: function (close) {
        return [
          button('استعادة الافتراضي', 'btn-danger btn-sm', function () {
            state.tiers = clone(DemoData.TIERS);
            var fresh = clone(DemoData.POOLS);
            Object.keys(fresh).forEach(function (n) { if (state.pools[n]) fresh[n].gross = state.pools[n].gross; });
            state.pools = fresh;
            state.options.roundingStep = 1;
            change();
            close();
            showToast('تمت استعادة القيم الافتراضية');
          }),
          el('div', 'modal-foot-end', [button('تم', 'btn-primary', function () { close(); })])
        ];
      }
    });
    return m;
  }

  function persistSettings() {
    try { localStorage.setItem('incentiveSettings', JSON.stringify({ tiers: state.tiers, pools: state.pools, roundingStep: state.options.roundingStep })); } catch (e) {}
  }

  function captureFocus() {
    var a = document.activeElement;
    if (!a || !a.id) return null;
    var snap = { id: a.id };
    try { if (typeof a.selectionStart === 'number') { snap.start = a.selectionStart; snap.end = a.selectionEnd; } } catch (e) {}
    return snap;
  }

  function restoreFocus(snap) {
    if (!snap) return;
    var n = document.getElementById(snap.id);
    if (!n) return;
    try { n.focus({ preventScroll: true }); } catch (e) { n.focus(); }
    if (snap.start != null && typeof n.setSelectionRange === 'function') { try { n.setSelectionRange(snap.start, snap.end); } catch (e) {} }
  }

  function capturePageState() {
    var snap = { focus: captureFocus(), scrollY: window.scrollY, tables: {} };
    document.querySelectorAll('[data-scroll-key]').forEach(function (n) { snap.tables[n.getAttribute('data-scroll-key')] = [n.scrollTop, n.scrollLeft]; });
    return snap;
  }

  function restorePageState(snap) {
    if (!snap) return;
    document.querySelectorAll('[data-scroll-key]').forEach(function (n) {
      var v = snap.tables[n.getAttribute('data-scroll-key')];
      if (v) { n.scrollTop = v[0]; n.scrollLeft = v[1]; }
    });
    window.scrollTo(0, snap.scrollY || 0);
    restoreFocus(snap.focus);
  }

  function render() {
    closeOpenDropdown();
    var validation = computeValidation();
    if (!canVisit(state.screen, validation)) state.screen = state.people.length && state.headers.length ? 1 : 0;
    var screenChanged = state.screen !== lastScreen;
    if (screenChanged) { viewPage = 0; }
    var snap = screenChanged ? null : capturePageState();
    var builders = [buildUpload, buildMapping, buildAmounts, buildAllocation, buildDashboard, buildExport];
    var spec = builders[state.screen](validation);
    var frag = document.createDocumentFragment();
    frag.appendChild(buildTopbar(validation));
    var main = el('main', 'page');
    main.id = 'main';
    var screen = el('div', 'screen' + (screenChanged ? ' screen-enter is-entering' : ''));
    spec.nodes.forEach(function (n) { if (n) screen.appendChild(n); });
    main.appendChild(screen);
    frag.appendChild(main);
    frag.appendChild(buildActionBar(spec));
    container.innerHTML = '';
    container.appendChild(frag);
    if (screenChanged) {
      window.scrollTo(0, 0);
      if (lastScreen !== -1) { var h = main.querySelector('h1'); if (h) { h.tabIndex = -1; try { h.focus({ preventScroll: true }); } catch (e) {} } }
      lastScreen = state.screen;
    } else restorePageState(snap);
    saveSession();
  }

  function initTheme() {
    try { var saved = localStorage.getItem('themePreference'); if (saved === 'light' || saved === 'dark' || saved === 'system') themeMode = saved; } catch (e) {}
  }

  function applyTheme(mode) {
    themeMode = mode;
    if (mode === 'light' || mode === 'dark') document.documentElement.setAttribute('data-theme', mode);
    else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('themePreference', mode); } catch (e) {}
  }

  function onGlobalKeydown(e) {
    if (document.querySelector('.modal-backdrop')) return;
    var mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    var key = e.key.toLowerCase();
    var tag = (e.target && e.target.tagName) || '';
    if (key === 's') { e.preventDefault(); saveProject(); return; }
    if (key === 'z' && !e.shiftKey && state.screen === 3 && tag !== 'INPUT' && tag !== 'TEXTAREA') { e.preventDefault(); undo(); }
  }

  function boot(target) {
    container = target;
    initTheme();
    state = makeInitialState();
    var restored = false;
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        var next = hydrate(JSON.parse(raw));
        if (next.people.length) { state = next; restored = true; }
      }
    } catch (e) { restored = false; }
    recompute();
    document.addEventListener('keydown', onGlobalKeydown);
    window.addEventListener('beforeunload', function () { try { if (state.people.length) localStorage.setItem(SESSION_KEY, JSON.stringify(serializeState())); } catch (e) {} });
    render();
    if (restored) showToast('تمت استعادة جلستك السابقة');
  }

  function refresh() { if (container && state) render(); }

  return {
    boot: boot,
    refresh: refresh,
    showToast: showToast,
    version: APP_VERSION,
    internals: {
      getState: function () { return state; },
      setState: function (next) { state = next; },
      recompute: recompute,
      filteredPeople: filteredPeople,
      detailRows: detailRows,
      executiveRows: executiveRows,
      specialCasePeople: specialCasePeople,
      exportReport: exportReport,
      conservationCheck: conservationCheck,
      resultIndex: resultIndex,
      isSpecial: isSpecial,
      parseCsv: parseCsv,
      parseNumber: parseNumber
    }
  };
})();

(function () {
  var params = new URLSearchParams(window.location.search);
  var app = document.getElementById('app');
  if (params.get('selftest') === '1') { SelfTest.renderInto(app); return; }
  App.boot(app);
})();
