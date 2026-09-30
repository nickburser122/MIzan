var SelfTest = (function () {
  'use strict';

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function approxEqual(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 1e-6 : eps); }

  var DEFAULT_TIERS = { 'مدير إدارة': 979, 'مدير': 750, 'رئيس قسم': 534, 'عضو مميز': 494, 'شهادة عليا': 445, 'فوق متوسط': 400, 'متوسط': 356, 'معاون خدمة': 303 };
  var A = 'طوابع المواليد', B = 'طوابع اللجان الطبية', C = 'نماذج استمارات 111';

  function pools3(a, b, c) {
    var p = {};
    p[A] = { gross: a, taxRate: 0.11 };
    p[B] = { gross: b, taxRate: 0.240938 };
    p[C] = { gross: c, taxRate: 0.240938 };
    return p;
  }
  function defaultPools() { return pools3(100000, 80000, 60000); }

  function makePerson(id, name, tier, extra) {
    var p = { id: id, name: name, tier: tier, overrideValue: null, daysWorked: null, penaltyRate: null, pinnedPool: null, excluded: false, manualFactor: null };
    if (extra) for (var k in extra) p[k] = extra[k];
    return p;
  }

  function st(people, pools, options) {
    return { people: people, tiers: DEFAULT_TIERS, pools: pools, periodDays: 30, options: options || {} };
  }

  function byIdOf(res) { var m = {}; res.people.forEach(function (p) { m[p.id] = p; }); return m; }

  function run() {
    var results = [];
    function record(name, pass, detail) { results.push({ name: name, pass: !!pass, detail: detail || '' }); }

    (function () {
      var rng = mulberry32(42), allOk = true, errDetail = '', errorCount = 0, successCount = 0;
      for (var s = 0; s < 200; s++) {
        var n = 4 + Math.floor(rng() * 20), people = [];
        for (var i = 0; i < n; i++) people.push(makePerson(i, 'شخص ' + i, rng() < 0.5 ? 'مدير إدارة' : 'معاون خدمة'));
        var pools = pools3(Math.round((5000 + rng() * 95000) * 100) / 100 + 0.03, Math.round((5000 + rng() * 95000) * 100) / 100 + 0.07, Math.round((5000 + rng() * 95000) * 100) / 100 + 0.01);
        var res = Engine.runPipeline(st(people, pools, { roundingStep: 1 }));
        if (!res.ok) {
          errorCount++;
          if (!res.errors.every(function (e) { return e.code === 'EMPTY_POOL_WITH_BUDGET'; })) { allOk = false; errDetail = 'scenario ' + s + ': ' + JSON.stringify(res.errors); }
          continue;
        }
        successCount++;
        Object.keys(pools).forEach(function (pn) {
          var expected = Engine.toPiastres(pools[pn].gross);
          var actual = res.people.filter(function (p) { return p.pool === pn; }).reduce(function (x, p) { return x + p.grossPiastres; }, 0);
          if (actual !== expected) { allOk = false; errDetail = 'scenario ' + s + ' ' + pn + ': ' + expected + ' vs ' + actual; }
        });
      }
      record('T1 — الحفاظ على القيمة (200 سيناريو عشوائي)', allOk, allOk ? (successCount + ' نجح، ' + errorCount + ' رفض بشكل صحيح (مجمع فارغ)') : errDetail);
    })();

    (function () {
      var res = Engine.runPipeline(st([makePerson(1, 'أ', 'مدير إدارة'), makePerson(2, 'ب', 'مدير إدارة'), makePerson(3, 'ج', 'رئيس قسم'), makePerson(4, 'د', 'معاون خدمة')], pools3(50000, 0, 0)));
      var pass = res.ok, detail = JSON.stringify(res.errors || '');
      if (res.ok) {
        var m = byIdOf(res), expected = DEFAULT_TIERS['مدير إدارة'] / DEFAULT_TIERS['رئيس قسم'], actual = m[1].netPiastres / m[3].netPiastres;
        pass = approxEqual(expected, actual, 0.01);
        detail = 'النسبة المتوقعة ' + expected.toFixed(4) + ' الفعلية ' + actual.toFixed(4);
      }
      record('T2 — التناسب داخل مجمع واحد', pass, detail);
    })();

    (function () {
      var taxA = 0.11, taxB = 0.240938, Nt = 8900;
      var pools = pools3(Nt / (1 - taxA), Nt / (1 - taxB), 0);
      var res = Engine.runPipeline(st([
        makePerson(1, 'أ1', 'مدير إدارة', { pinnedPool: A }), makePerson(2, 'أ2', 'مدير إدارة', { pinnedPool: A }),
        makePerson(3, 'ب1', 'مدير إدارة', { pinnedPool: B }), makePerson(4, 'ب2', 'مدير إدارة', { pinnedPool: B })
      ], pools));
      var pass = res.ok, detail = JSON.stringify(res.errors || '');
      if (res.ok) {
        var nets = res.people.map(function (p) { return p.netPiastres; });
        var maxDiff = Math.max.apply(null, nets) - Math.min.apply(null, nets);
        pass = maxDiff <= 1;
        detail = 'صافي (قرش)=' + JSON.stringify(nets) + ' أقصى فرق=' + maxDiff;
      }
      record('T3 — العدالة بين المجمعات (تقسيم دقيق)', pass, detail);
    })();

    (function () {
      var res = Engine.runPipeline(st([makePerson(1, 'شخص1', 'مدير إدارة', { pinnedPool: A }), makePerson(2, 'شخص2', 'مدير إدارة', { pinnedPool: B })], pools3(2390, 2800, 0)));
      var pass = res.ok, detail = JSON.stringify(res.errors || '');
      if (res.ok) {
        var m = byIdOf(res), n1 = Engine.fromPiastres(m[1].netPiastres), n2 = Engine.fromPiastres(m[2].netPiastres);
        pass = approxEqual(n1, 2127.10, 0.005) && approxEqual(n2, 2125.37, 0.005);
        detail = 'net1=' + n1.toFixed(2) + ' (المتوقع 2127.10)  net2=' + n2.toFixed(2) + ' (المتوقع 2125.37)';
      }
      record('T4 — إعادة إنتاج مثال العميل الحقيقي', pass, detail);
    })();

    (function () {
      var res = Engine.runPipeline(st([makePerson(1, 'بدون جزاء', 'مدير', { pinnedPool: A }), makePerson(2, 'بجزاء 50%', 'مدير', { pinnedPool: A, penaltyRate: 0.5 })], pools3(10000, 0, 0)));
      var pass = res.ok, detail = JSON.stringify(res.errors || '');
      if (res.ok) {
        var m = byIdOf(res), full = m[1].netPiastres, half = m[2].netPiastres;
        var exact = (m[1].grossPiastres + m[2].grossPiastres) === Engine.toPiastres(10000);
        pass = Math.abs(half - full / 2) <= 1 && exact;
        detail = 'كامل=' + full + ' نصف=' + half + '، دقة المجمع=' + exact;
      }
      record('T5 — الجزاء يُنصّف الصافي، والمجمع يبقى دقيقًا', pass, detail);
    })();

    (function () {
      var w = Engine.effectiveWeight(makePerson(1, 'x', 'مدير', { daysWorked: 15 }), DEFAULT_TIERS, 30);
      var wf = Engine.effectiveWeight(makePerson(2, 'y', 'مدير', { daysWorked: 30 }), DEFAULT_TIERS, 30);
      record('T6 — 15/30 يوم تُنصّف الوزن', approxEqual(w, wf / 2, 1e-9), 'w=' + w + ' wFull/2=' + (wf / 2));
    })();

    (function () {
      var res = Engine.runPipeline(st([makePerson(1, 'مستبعد', 'مدير إدارة', { excluded: true }), makePerson(2, 'عادي', 'مدير إدارة')], pools3(10000, 0, 0)));
      var pass = res.ok, detail = JSON.stringify(res.errors || '');
      if (res.ok) {
        var m = byIdOf(res);
        pass = m[1].netPiastres === 0 && m[1].grossPiastres === 0 && m[2].grossPiastres === Engine.toPiastres(10000);
        detail = 'صافي المستبعد=' + m[1].netPiastres + ' إجمالي الآخر=' + m[2].grossPiastres;
      }
      record('T7 — المستبعد يحصل على صفر والمجمع يُستهلك بالكامل من الباقين', pass, detail);
    })();

    (function () {
      var res = Engine.runPipeline(st([makePerson(1, 'شخص', 'مدير إدارة', { pinnedPool: A })], pools3(10000, 5000, 0)));
      record('T8 — مجمع فارغ وله مبلغ ← خطأ منظم', res.ok === false && res.errors.some(function (e) { return e.code === 'EMPTY_POOL_WITH_BUDGET'; }), JSON.stringify(res.errors || ''));
    })();

    (function () {
      var res = Engine.runPipeline(st([makePerson(1, 'م1', 'مدير إدارة', { excluded: true }), makePerson(2, 'م2', 'مدير', { excluded: true })], pools3(10000, 0, 0)));
      record('T9 — إجمالي الوزن صفر ← خطأ منظم، بلا NaN', res.ok === false && res.errors.length > 0 && !JSON.stringify(res).match(/NaN/), JSON.stringify(res.errors || ''));
    })();

    (function () {
      var rng = mulberry32(7), people = [], names = Object.keys(DEFAULT_TIERS);
      for (var i = 0; i < 300; i++) people.push(makePerson(i, 'شخص ' + i, names[Math.floor(rng() * names.length)], { daysWorked: 20 + Math.floor(rng() * 10), penaltyRate: rng() < 0.1 ? 0.3 : 0 }));
      var s = st(people, defaultPools());
      var r1 = Engine.runPipeline(JSON.parse(JSON.stringify(s))), r2 = Engine.runPipeline(JSON.parse(JSON.stringify(s)));
      delete r1.meta; delete r2.meta;
      var same = JSON.stringify(r1) === JSON.stringify(r2);
      record('T10 — الحتمية (300 شخص، تشغيلتان متطابقتان)', same, same ? 'متطابق تمامًا' : 'اختلاف!');
    })();

    (function () {
      var rng = mulberry32(99), people = [], names = Object.keys(DEFAULT_TIERS);
      for (var i = 0; i < 100000; i++) people.push(makePerson(i, 'شخص ' + i, names[Math.floor(rng() * names.length)], { daysWorked: 20 + Math.floor(rng() * 10) }));
      var t = performance.now();
      var res = Engine.runPipeline(st(people, pools3(5000000, 4000000, 3000000)));
      var el = performance.now() - t;
      record('T11 — الأداء (100,000 صف)', res.ok && el < 3000, el.toFixed(0) + ' مللي ثانية (الحد 3000)، ok=' + res.ok);
    })();

    (function () {
      var names = Object.keys(DEFAULT_TIERS);
      var canon = ['مدير ادارة', 'مدير إدارة', 'مديــر إدارة  ', 'مدير الادارة'].map(function (v) { return Engine.canonicalizeTierName(v, names); });
      record('T12 — تطبيع الأسماء العربية (4 صيغ ← فئة واحدة)', canon.every(function (c) { return c === 'مدير إدارة'; }), JSON.stringify(canon));
    })();

    (function () {
      var g = Engine.distributePoolPiastres(10000, [{ id: 1, weight: 1 }, { id: 2, weight: 1 }, { id: 3, weight: 1 }]);
      var egp = g.map(Engine.fromPiastres);
      var sum = g.reduce(function (a, b) { return a + b; }, 0);
      record('T13 — حالة حرجة لطريقة أكبر باقٍ (تقسيم 100.00 على 3)', sum === 10000 && egp.filter(function (x) { return x === 33.34; }).length === 1 && egp.filter(function (x) { return x === 33.33; }).length === 2, JSON.stringify(egp));
    })();

    (function () {
      var people = [makePerson(1, 'أ', 'مدير إدارة', { dept: 'أ' }), makePerson(2, 'ب', 'معاون خدمة', { dept: 'ب' })];
      var pools = pools3(10000, 0, 0);
      var full = Engine.runPipeline(st(people, pools)), sub = Engine.runPipeline(st([people[0]], pools));
      var a = full.ok ? full.people[0].netPiastres : null, b = sub.ok ? sub.people[0].netPiastres : null;
      record('T14 — إثبات خطورة إعادة الحساب عند الفلترة', a !== b, 'الكامل=' + a + '  الفرعي=' + b + ' (الواجهة تحسب مرة واحدة وتُصفّي النتيجة)');
    })();

    (function () {
      var rng = mulberry32(123), people = [], names = Object.keys(DEFAULT_TIERS);
      for (var i = 0; i < 500; i++) people.push(makePerson(i, 'شخص ' + i, names[Math.floor(rng() * names.length)]));
      var res = Engine.runPipeline(st(people, defaultPools()));
      var pass = res.ok, maxDev = 0, detail = JSON.stringify(res.errors || '');
      if (res.ok) {
        Object.keys(res.poolResults).forEach(function (n) { var d = res.poolResults[n].deviation; if (d != null) maxDev = Math.max(maxDev, Math.abs(d)); });
        pass = maxDev < 0.01;
        detail = 'أقصى انحراف=' + (maxDev * 100).toFixed(3) + '% (الحد 1%)';
      }
      record('T15 — جودة التوزيع (500 شخص، انحراف أقل من 1%)', pass, detail);
    })();

    (function () {
      var rng = mulberry32(55), people = [], names = Object.keys(DEFAULT_TIERS);
      for (var i = 0; i < 100; i++) people.push(makePerson(i, 'شخص ' + i, names[Math.floor(rng() * names.length)], i < 10 ? { pinnedPool: C } : null));
      var res = Engine.runPipeline(st(people, defaultPools()));
      var pass = res.ok, detail = JSON.stringify(res.errors || '');
      if (res.ok) {
        var m = byIdOf(res);
        pass = true;
        for (var j = 0; j < 10; j++) if (m[j].pool !== C) pass = false;
        detail = pass ? 'كل الأشخاص العشرة المثبّتين بقوا في مجمعهم' : 'شخص مثبّت تحرك';
      }
      record('T16 — التثبيت اليدوي (الأشخاص المثبّتون لا يتحركون أبدًا)', pass, detail);
    })();

    (function () {
      var rng = mulberry32(2024), names = Object.keys(DEFAULT_TIERS), allOk = true, detail = '', checked = 0;
      [1, 100].forEach(function (step) {
        for (var s = 0; s < 100; s++) {
          var n = 4 + Math.floor(rng() * 20), people = [];
          for (var i = 0; i < n; i++) people.push(makePerson(i, 'شخص ' + i, names[Math.floor(rng() * names.length)]));
          var pools = pools3(Math.round((5000 + rng() * 95000) * 100) / 100 + 0.37, Math.round((5000 + rng() * 95000) * 100) / 100 + 0.55, Math.round((5000 + rng() * 95000) * 100) / 100 + 0.99);
          var res = Engine.runPipeline(st(people, pools, { roundingStep: step }));
          if (!res.ok) {
            if (!res.errors.every(function (e) { return e.code === 'EMPTY_POOL_WITH_BUDGET'; })) { allOk = false; detail = 'رفض غير متوقع: ' + JSON.stringify(res.errors); }
            continue;
          }
          checked++;
          Object.keys(pools).forEach(function (pn) {
            var expected = Engine.effectiveGrossPiastres(pools[pn].gross, step);
            var actual = res.people.filter(function (p) { return p.pool === pn; }).reduce(function (x, p) { return x + p.grossPiastres; }, 0);
            if (actual !== expected) { allOk = false; detail = 'وحدة=' + step + ' ' + pn + ': ' + expected + ' vs ' + actual; }
            if (step === 100 && actual % 100 !== 0) { allOk = false; detail = 'الإجمالي ليس مضاعفًا للجنيه: ' + actual; }
          });
        }
      });
      record('T17 — الحفاظ على القيمة مع التقريب (قرش وجنيه، 200 سيناريو)', allOk, allOk ? (checked + ' سيناريو تحقق بالضبط') : detail);
    })();

    (function () {
      var res = Engine.runPipeline(st([makePerson(1, 'مقفول على مجمع وهمي', 'مدير إدارة', { pinnedPool: 'تلقائي' }), makePerson(2, 'عادي', 'مدير')], defaultPools()));
      var named = res.ok === false && res.errors.some(function (e) { return e.code === 'UNKNOWN_PINNED_POOL'; });
      var noCrash = res.ok === false && !res.errors.some(function (e) { return e.code === 'INTERNAL_ERROR'; });
      var single = {}; single[A] = { gross: 1000, taxRate: 0.11 };
      var emptyAuto = Engine.runPipeline(st([makePerson(1, 'أ', 'مدير', { pinnedPool: '' })], single)).ok === true;
      record('T18 — مجمع مقفول غير معروف ← خطأ مُسمّى بلا انهيار', named && noCrash && emptyAuto, 'خطأ مُسمّى=' + named + '، بلا INTERNAL_ERROR=' + noCrash + '، الفارغ تلقائي=' + emptyAuto);
    })();

    (function () {
      if (typeof App === 'undefined' || !App.internals) { record('T19 — الإجماليات الرسمية لا تتأثر بالفلاتر', false, 'App.internals غير متاح'); return; }
      var api = App.internals;
      var src = String(api.exportReport) + String(api.detailRows) + String(api.executiveRows) + String(api.specialCasePeople);
      var grepClean = src.indexOf('filteredPeople') < 0;
      var names = Object.keys(DEFAULT_TIERS), depts = ['أ', 'ب', 'ج'], people = [];
      for (var i = 0; i < 40; i++) { var p = makePerson(i + 1, 'شخص ' + i, names[i % names.length]); p.dept = depts[i % 3]; p.job = 'وظيفة'; people.push(p); }
      var probe = { screen: 5, title: 'اختبار', period: 'فترة', periodDays: 30, tiers: DEFAULT_TIERS, pools: defaultPools(), options: { roundingStep: 1 }, people: people, rawRows: [], headers: [], mapping: {}, tierMappings: {}, fileName: '', result: null, filters: { search: '', dept: '', tier: '', pool: '', special: false, excluded: false }, history: [] };
      var saved = api.getState();
      api.setState(probe);
      api.recompute();
      var snap = function () { return JSON.stringify(api.detailRows(probe.people)) + '|' + JSON.stringify(api.executiveRows()) + '|' + JSON.stringify(api.detailRows(api.specialCasePeople())); };
      var before = snap(), viewBefore = api.filteredPeople().length;
      probe.filters.dept = 'ب'; probe.filters.tier = names[1];
      var viewAfter = api.filteredPeople().length, after = snap(), count = probe.__recomputeCount;
      api.setState(saved);
      var identical = before === after, narrowed = viewAfter < viewBefore;
      record('T19 — الإجماليات الرسمية لا تتأثر بالفلاتر', identical && grepClean && narrowed, 'التصدير متطابق=' + identical + '، مسار التصدير نظيف=' + grepClean + '، العرض (' + viewBefore + ' ← ' + viewAfter + ')، إعادة الحساب=' + count);
    })();

    return results;
  }

  function renderInto(container) {
    var results = run();
    var passCount = results.filter(function (r) { return r.pass; }).length;
    var wrap = document.createElement('div');
    wrap.className = 'selftest-wrap';
    var h = document.createElement('h1'); h.className = 'selftest-heading'; h.textContent = 'اختبارات محرك الحساب الذاتية'; wrap.appendChild(h);
    var s = document.createElement('div'); s.className = 'selftest-summary ' + (passCount === results.length ? 'selftest-summary-ok' : 'selftest-summary-bad'); s.textContent = passCount + ' / ' + results.length + ' اختبارًا ناجحًا'; wrap.appendChild(s);
    var b = document.createElement('div'); b.className = 'selftest-detail'; b.style.marginBottom = '20px'; b.textContent = (typeof APP_NAME === 'string' ? APP_NAME + ' ' + APP_NAME_LATIN : 'ميزان Mizan') + ' — ' + (typeof APP_VERSION === 'string' ? APP_VERSION : 'dev'); wrap.appendChild(b);
    var table = document.createElement('div'); table.className = 'selftest-table';
    results.forEach(function (r) {
      var row = document.createElement('div'); row.className = 'selftest-row ' + (r.pass ? 'selftest-row-pass' : 'selftest-row-fail');
      var badge = document.createElement('div'); badge.className = 'selftest-badge'; badge.textContent = r.pass ? 'نجاح' : 'فشل'; row.appendChild(badge);
      var body = document.createElement('div'); body.className = 'selftest-body';
      var n = document.createElement('div'); n.className = 'selftest-name'; n.textContent = r.name; body.appendChild(n);
      var d = document.createElement('div'); d.className = 'selftest-detail'; d.textContent = r.detail; body.appendChild(d);
      row.appendChild(body); table.appendChild(row);
    });
    wrap.appendChild(table);
    container.innerHTML = '';
    container.appendChild(wrap);
  }

  return { run: run, renderInto: renderInto };
})();
