var Engine = (function () {
  'use strict';

  function now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  function clamp(x, lo, hi) {
    return x < lo ? lo : (x > hi ? hi : x);
  }

  function compareIds(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    var sa = String(a), sb = String(b);
    return sa < sb ? -1 : (sa > sb ? 1 : 0);
  }

  var TASHKEEL = /[\u064B-\u0652]/g;
  var TATWEEL = /\u0640/g;
  var ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
  var EXTENDED_ARABIC_INDIC_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

  function normalizeArabic(input) {
    if (input == null) return '';
    var s = String(input);
    s = s.replace(TASHKEEL, '');
    s = s.replace(TATWEEL, '');
    s = s.replace(/[أإآٱ]/g, 'ا');
    s = s.replace(/ة/g, 'ه');
    s = s.replace(/ى/g, 'ي');
    s = s.replace(/ؤ/g, 'و');
    s = s.replace(/ئ/g, 'ي');
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      var di = ARABIC_INDIC_DIGITS.indexOf(ch);
      if (di === -1) di = EXTENDED_ARABIC_INDIC_DIGITS.indexOf(ch);
      out += di === -1 ? ch : String(di);
    }
    s = out.toLowerCase();
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  function stripDefiniteArticleTokens(s) {
    return s.split(' ').map(function (tok) {
      return tok.indexOf('ال') === 0 && tok.length > 2 ? tok.slice(2) : tok;
    }).join(' ');
  }

  function normalizeForTierMatch(input) {
    return stripDefiniteArticleTokens(normalizeArabic(input));
  }

  function canonicalizeTierName(raw, tierNames) {
    var target = normalizeForTierMatch(raw);
    for (var i = 0; i < tierNames.length; i++) {
      if (normalizeForTierMatch(tierNames[i]) === target) return tierNames[i];
    }
    return null;
  }

  function toPiastres(egp) { return Math.round(egp * 100); }
  function fromPiastres(pi) { return pi / 100; }
  function hasOwn(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
  function normalizePinnedPool(value) { return (value == null || value === '') ? null : value; }

  function effectiveWeight(person, tiers, periodDays) {
    if (person.excluded) return 0;
    var base = person.overrideValue != null ? person.overrideValue : tiers[person.tier];
    if (base == null || !isFinite(base)) return null;
    var days = (person.daysWorked == null || !isFinite(person.daysWorked)) ? periodDays : person.daysWorked;
    var attendance = clamp(days / periodDays, 0, 1);
    var penalty = clamp(person.penaltyRate == null || !isFinite(person.penaltyRate) ? 0 : person.penaltyRate, 0, 1);
    var manual = (person.manualFactor == null || !isFinite(person.manualFactor)) ? 1 : Math.max(0, person.manualFactor);
    var w = base * attendance * (1 - penalty) * manual;
    return w < 0 ? 0 : w;
  }

  function effectiveGrossPiastres(gross, roundingStep) {
    var step = roundingStep && roundingStep > 0 ? roundingStep : 1;
    return Math.round(toPiastres(gross) / step) * step;
  }

  function computePoolBudgets(pools, roundingStep) {
    var budgets = {}, effective = {}, N = 0;
    var names = Object.keys(pools);
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      var p = pools[name];
      var effGross = fromPiastres(effectiveGrossPiastres(p.gross, roundingStep));
      var Np = effGross * (1 - p.taxRate);
      effective[name] = effGross;
      budgets[name] = Np;
      N += Np;
    }
    return { budgets: budgets, effectiveGross: effective, N: N, names: names };
  }

  function assignItemsToPools(items, targets, opts) {
    opts = opts || {};
    var timeBudgetMs = opts.timeBudgetMs != null ? opts.timeBudgetMs : 1500;
    var poolNames = Object.keys(targets);
    var eligiblePools = poolNames.filter(function (p) { return targets[p] > 0; });
    var assignment = {}, current = {};
    poolNames.forEach(function (p) { current[p] = 0; });

    var pinned = [], free = [];
    items.forEach(function (it) { if (it.pinnedPool != null) pinned.push(it); else free.push(it); });
    pinned.forEach(function (it) {
      assignment[it.id] = it.pinnedPool;
      current[it.pinnedPool] = (current[it.pinnedPool] || 0) + it.weight;
    });

    var sortedFree = free.slice().sort(function (a, b) {
      if (b.weight !== a.weight) return b.weight - a.weight;
      return compareIds(a.id, b.id);
    });

    if (eligiblePools.length === 0) {
      sortedFree.forEach(function (it) {
        var fallback = poolNames[0] || null;
        assignment[it.id] = fallback;
        if (fallback) current[fallback] = (current[fallback] || 0) + it.weight;
      });
      return { assignment: assignment, current: current, iterations: 0, converged: true };
    }

    sortedFree.forEach(function (it) {
      var bestPool = eligiblePools[0];
      var bestDeficit = targets[bestPool] - current[bestPool];
      for (var k = 1; k < eligiblePools.length; k++) {
        var p = eligiblePools[k];
        var deficit = targets[p] - current[p];
        if (deficit > bestDeficit) { bestDeficit = deficit; bestPool = p; }
      }
      assignment[it.id] = bestPool;
      current[bestPool] += it.weight;
    });

    var itemById = {};
    items.forEach(function (it) { itemById[it.id] = it; });

    var iterations = 0, timeUp = false, start = now();
    var swapWindow = opts.swapWindow != null ? opts.swapWindow : 24;
    var maxPasses = opts.maxPasses != null ? opts.maxPasses : 40;
    var freeIds = sortedFree.map(function (it) { return it.id; });
    var pass = 0, movedInLastPass = true;

    while (movedInLastPass && pass < maxPasses) {
      if ((now() - start) >= timeBudgetMs) { timeUp = true; break; }
      pass++;
      movedInLastPass = false;

      for (var fi = 0; fi < freeIds.length; fi++) {
        iterations++;
        var id = freeIds[fi];
        var it = itemById[id];
        var fromPool = assignment[id];
        var bestGain = 0, bestPool = null;
        for (var pi = 0; pi < eligiblePools.length; pi++) {
          var toPool = eligiblePools[pi];
          if (toPool === fromPool) continue;
          var newFrom = current[fromPool] - it.weight;
          var newTo = current[toPool] + it.weight;
          var delta = (Math.abs(newFrom - targets[fromPool]) - Math.abs(current[fromPool] - targets[fromPool])) +
            (Math.abs(newTo - targets[toPool]) - Math.abs(current[toPool] - targets[toPool]));
          if (delta < bestGain - 1e-9) { bestGain = delta; bestPool = toPool; }
        }
        if (bestPool) {
          current[fromPool] -= it.weight;
          current[bestPool] += it.weight;
          assignment[id] = bestPool;
          movedInLastPass = true;
        }
      }

      for (var a = 0; a < freeIds.length; a++) {
        var idA = freeIds[a];
        var itA = itemById[idA];
        var poolA = assignment[idA];
        var bLimit = Math.min(freeIds.length, a + 1 + swapWindow);
        for (var b = a + 1; b < bLimit; b++) {
          iterations++;
          var idB = freeIds[b];
          var itB = itemById[idB];
          var poolB = assignment[idB];
          if (poolA === poolB) continue;
          var newA = current[poolA] - itA.weight + itB.weight;
          var newB = current[poolB] - itB.weight + itA.weight;
          var oldTerms = Math.abs(current[poolA] - targets[poolA]) + Math.abs(current[poolB] - targets[poolB]);
          var newTerms = Math.abs(newA - targets[poolA]) + Math.abs(newB - targets[poolB]);
          if (newTerms < oldTerms - 1e-9) {
            current[poolA] = newA;
            current[poolB] = newB;
            assignment[idA] = poolB;
            assignment[idB] = poolA;
            movedInLastPass = true;
            poolA = poolB;
          }
        }
      }
    }

    return { assignment: assignment, current: current, iterations: iterations, converged: !movedInLastPass && !timeUp, timeUp: timeUp, passes: pass };
  }

  function distributePoolPiastres(grossPiastres, members) {
    var W = 0;
    for (var i = 0; i < members.length; i++) W += members[i].weight;
    if (grossPiastres === 0) return members.map(function () { return 0; });
    if (W <= 0) throw { code: 'ZERO_WEIGHT_NONZERO_GROSS', message: 'distributePoolPiastres called with zero total weight and nonzero gross' };
    var raw = members.map(function (m) { return (grossPiastres * m.weight) / W; });
    var floors = raw.map(Math.floor);
    var allocated = floors.reduce(function (a, b) { return a + b; }, 0);
    var remainder = grossPiastres - allocated;
    var order = members.map(function (m, i) { return { i: i, id: m.id, weight: m.weight, frac: raw[i] - floors[i] }; });
    order.sort(function (a, b) {
      if (Math.abs(b.frac - a.frac) > 1e-9) return b.frac - a.frac;
      if (b.weight !== a.weight) return b.weight - a.weight;
      return compareIds(a.id, b.id);
    });
    var grossc = floors.slice();
    for (var k = 0; k < remainder; k++) grossc[order[k].i] += 1;
    var sum = grossc.reduce(function (a, b) { return a + b; }, 0);
    if (sum !== grossPiastres) throw { code: 'CONSERVATION_FAILED', message: 'distributePoolPiastres: sum(grossc) !== grossPiastres', expected: grossPiastres, actual: sum };
    return grossc;
  }

  function validateState(state) {
    var errors = [];
    var pools = state.pools || {};
    Object.keys(pools).forEach(function (name) {
      var p = pools[name];
      if (!(p.taxRate >= 0 && p.taxRate < 1)) errors.push({ code: 'BAD_TAX_RATE', poolName: name, message: 'نسبة الخصم لمجمع "' + name + '" يجب أن تكون بين 0 و 1' });
      if (!(p.gross >= 0)) errors.push({ code: 'BAD_GROSS', poolName: name, message: 'إجمالي مجمع "' + name + '" لا يمكن أن يكون سالبًا' });
    });
    if (!(state.periodDays >= 1)) errors.push({ code: 'BAD_PERIOD_DAYS', message: 'عدد أيام الفترة يجب أن يكون 1 على الأقل' });
    (state.people || []).forEach(function (person) {
      var pinned = normalizePinnedPool(person.pinnedPool);
      if (pinned != null && !hasOwn(pools, pinned)) errors.push({ code: 'UNKNOWN_PINNED_POOL', personId: person.id, poolName: pinned, message: 'المجمع المقفول "' + pinned + '" غير موجود لـ "' + (person.name || person.id) + '"' });
      if (person.tier == null || (state.tiers && !hasOwn(state.tiers, person.tier) && person.overrideValue == null)) errors.push({ code: 'UNRESOLVED_TIER', personId: person.id, message: 'الفئة غير معروفة لـ "' + (person.name || person.id) + '"' });
    });
    return errors;
  }

  function collectRowWarnings(state) {
    var warnings = [];
    var periodDays = state.periodDays;
    (state.people || []).forEach(function (person) {
      var label = person.name || ('صف ' + person.id);
      if (!person.name || !String(person.name).trim()) warnings.push({ code: 'MISSING_NAME', personId: person.id, message: 'صف بدون اسم (رقم ' + person.id + ')' });
      if (person.penaltyRate != null && !(person.penaltyRate >= 0 && person.penaltyRate <= 1)) warnings.push({ code: 'BAD_PENALTY', personId: person.id, message: 'نسبة الجزاء خارج النطاق لـ "' + label + '" — تم تثبيتها داخل النطاق 0–1' });
      if (person.daysWorked != null && !(person.daysWorked >= 0 && person.daysWorked <= periodDays)) warnings.push({ code: 'BAD_DAYS', personId: person.id, message: 'أيام العمل خارج نطاق الفترة لـ "' + label + '" — تم تثبيتها داخل النطاق 0–' + periodDays });
      if (person.manualFactor != null && !(person.manualFactor >= 0)) warnings.push({ code: 'BAD_MANUAL_FACTOR', personId: person.id, message: 'المعامل اليدوي غير صالح لـ "' + label + '" — تم استخدام 1' });
    });
    return warnings;
  }

  function runPipeline(state) {
    var validationErrors = validateState(state);
    if (validationErrors.length > 0) return { ok: false, errors: validationErrors };

    try {
      var t0 = now();
      var tiers = state.tiers || {};
      var pools = state.pools || {};
      var periodDays = state.periodDays;
      var roundingStep = state.options && state.options.roundingStep ? state.options.roundingStep : 1;
      var warnings = collectRowWarnings(state);
      var budgetInfo = computePoolBudgets(pools, roundingStep);
      var N = budgetInfo.N;
      var poolNames = budgetInfo.names;
      var people = state.people || [];

      var weighted = [];
      for (var i = 0; i < people.length; i++) {
        var w = effectiveWeight(people[i], tiers, periodDays);
        if (w == null) return { ok: false, errors: [{ code: 'UNRESOLVED_TIER', personId: people[i].id, message: 'تعذر حساب الوزن لـ "' + people[i].name + '"' }] };
        weighted.push({ person: people[i], weight: w });
      }

      var participating = weighted.filter(function (x) { return x.weight > 0; });
      var W = participating.reduce(function (s, x) { return s + x.weight; }, 0);

      var anyBudget = poolNames.some(function (n) { return budgetInfo.effectiveGross[n] > 0; });
      if (W <= 0 && anyBudget) {
        return { ok: false, errors: [{ code: 'NO_ELIGIBLE', message: 'لا يوجد أي مستحق بوزن موجب — كل الموظفين مستبعدون أو أوزانهم صفر' }] };
      }

      var k = W > 0 ? N / W : 0;
      var targets = {};
      poolNames.forEach(function (name) { targets[name] = (W > 0 && N > 0) ? (W * budgetInfo.budgets[name] / N) : 0; });

      var assignItems = participating.map(function (x) {
        return { id: x.person.id, weight: x.weight, pinnedPool: normalizePinnedPool(x.person.pinnedPool) };
      });
      var assignment = assignItemsToPools(assignItems, targets, {}).assignment;

      var membersByPool = {};
      poolNames.forEach(function (name) { membersByPool[name] = []; });
      for (var ai = 0; ai < participating.length; ai++) {
        var px = participating[ai];
        var assignedPool = assignment[px.person.id];
        if (assignedPool == null) continue;
        if (!hasOwn(membersByPool, assignedPool)) return { ok: false, errors: [{ code: 'UNKNOWN_PINNED_POOL', personId: px.person.id, poolName: assignedPool, message: 'المجمع المقفول "' + assignedPool + '" غير موجود لـ "' + (px.person.name || px.person.id) + '"' }] };
        membersByPool[assignedPool].push({ id: px.person.id, weight: px.weight });
      }

      for (var pn = 0; pn < poolNames.length; pn++) {
        var nm = poolNames[pn];
        if (budgetInfo.effectiveGross[nm] > 0 && membersByPool[nm].length === 0) {
          return { ok: false, errors: [{ code: 'EMPTY_POOL_WITH_BUDGET', poolName: nm, message: 'مجمع "' + nm + '" لديه مبلغ ولكن لا يوجد أي مستحق فيه' }] };
        }
      }

      var stepUnit = roundingStep;
      var poolResults = {};
      var peopleResultsById = {};

      for (var pj = 0; pj < poolNames.length; pj++) {
        var poolName = poolNames[pj];
        var poolDef = pools[poolName];
        var members = membersByPool[poolName];
        var actualWeight = members.reduce(function (s, m) { return s + m.weight; }, 0);
        var effGrossPiastres = effectiveGrossPiastres(poolDef.gross, stepUnit);
        var grossStepTotal = Math.round(effGrossPiastres / stepUnit);
        var grossStepPerMember = members.length > 0 ? distributePoolPiastres(grossStepTotal, members) : [];
        var targetWeight = targets[poolName];
        var deviation = actualWeight > 0 ? (targetWeight / actualWeight - 1) : null;
        var zeroBudgetWithMembers = effGrossPiastres === 0 && members.length > 0;

        poolResults[poolName] = {
          gross: poolDef.gross,
          effectiveGross: budgetInfo.effectiveGross[poolName],
          effectiveGrossPiastres: effGrossPiastres,
          roundingAdjusted: effGrossPiastres !== toPiastres(poolDef.gross),
          taxRate: poolDef.taxRate,
          net: budgetInfo.budgets[poolName],
          targetWeight: targetWeight,
          actualWeight: actualWeight,
          deviation: deviation,
          zeroBudgetWithMembers: zeroBudgetWithMembers,
          memberCount: members.length
        };

        if (poolResults[poolName].roundingAdjusted) {
          warnings.push({ code: 'POOL_ROUNDED', poolName: poolName, message: 'تم تعديل إجمالي "' + poolName + '" من ' + fromPiastres(toPiastres(poolDef.gross)).toFixed(2) + ' إلى ' + fromPiastres(effGrossPiastres).toFixed(2) + ' ليناسب التقريب' });
        }
        if (zeroBudgetWithMembers) {
          warnings.push({ code: 'ZERO_BUDGET_POOL', poolName: poolName, message: 'مجمع "' + poolName + '" بلا مبلغ — الأعضاء المثبّتون لن يحصلوا على شيء' });
        }

        for (var mi = 0; mi < members.length; mi++) {
          var grossPiastres = grossStepPerMember[mi] * stepUnit;
          var taxPiastres = Math.round(grossPiastres * poolDef.taxRate);
          peopleResultsById[members[mi].id] = {
            id: members[mi].id,
            pool: poolName,
            weight: members[mi].weight,
            shareOfPoolWeight: actualWeight > 0 ? members[mi].weight / actualWeight : 0,
            grossPiastres: grossPiastres,
            taxPiastres: taxPiastres,
            netPiastres: grossPiastres - taxPiastres,
            idealNetEGP: k * members[mi].weight
          };
        }
      }

      var orderedPeople = people.map(function (person) {
        return peopleResultsById[person.id] || {
          id: person.id, pool: null, weight: 0, shareOfPoolWeight: 0,
          grossPiastres: 0, taxPiastres: 0, netPiastres: 0, idealNetEGP: 0
        };
      });

      return {
        ok: true, k: k, W: W, N: N,
        poolResults: poolResults,
        people: orderedPeople,
        assignment: assignment,
        warnings: warnings,
        meta: { timingMs: now() - t0 }
      };
    } catch (e) {
      return { ok: false, errors: [{ code: (e && e.code) || 'INTERNAL_ERROR', message: (e && e.message) || 'خطأ داخلي غير متوقع في محرك الحساب', detail: e }] };
    }
  }

  return {
    normalizeArabic: normalizeArabic,
    normalizeForTierMatch: normalizeForTierMatch,
    canonicalizeTierName: canonicalizeTierName,
    toPiastres: toPiastres,
    fromPiastres: fromPiastres,
    effectiveWeight: effectiveWeight,
    effectiveGrossPiastres: effectiveGrossPiastres,
    computePoolBudgets: computePoolBudgets,
    assignItemsToPools: assignItemsToPools,
    distributePoolPiastres: distributePoolPiastres,
    validateState: validateState,
    collectRowWarnings: collectRowWarnings,
    normalizePinnedPool: normalizePinnedPool,
    runPipeline: runPipeline,
    clamp: clamp,
    compareIds: compareIds,
    hasOwn: hasOwn
  };
})();

var Icons = (function () {
  'use strict';
  var PATHS = {
    upload: '<path d="M10 13V3M10 3L6 7M10 3l4 4"/><path d="M3 13v2a2 2 0 002 2h10a2 2 0 002-2v-2"/>',
    sheet: '<rect x="3" y="3" width="14" height="14" rx="2.5"/><path d="M3 8h14M3 12.5h14M8 3v14"/>',
    sort: '<path d="M10 4v12M10 16l-4-4M10 16l4-4"/>',
    download: '<path d="M10 3v10M10 13l-4-4M10 13l4-4"/><path d="M3 15v1a2 2 0 002 2h10a2 2 0 002-2v-1"/>',
    settings: '<path d="M4 6h8M15 6h1M4 14h1M8 14h8"/><circle cx="13.5" cy="6" r="1.8"/><circle cx="6.5" cy="14" r="1.8"/>',
    alert: '<circle cx="10" cy="10" r="7.25"/><path d="M10 6.5v4"/><circle cx="10" cy="13.4" r=".6" fill="currentColor"/>',
    info: '<circle cx="10" cy="10" r="7.25"/><path d="M10 9.5v4"/><circle cx="10" cy="6.7" r=".6" fill="currentColor"/>',
    lock: '<rect x="4.5" y="9" width="11" height="8" rx="2"/><path d="M7 9V6.5a3 3 0 016 0V9"/>',
    search: '<circle cx="9" cy="9" r="5.5"/><path d="M16.5 16.5l-3.5-3.5"/>',
    close: '<path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/>',
    check: '<path d="M4.5 10.5l3.5 3.5 7.5-8"/>',
    chevronDown: '<path d="M6 8l4 4 4-4"/>',
    arrowNext: '<path d="M15.5 10h-11M8.5 6l-4 4 4 4"/>',
    arrowBack: '<path d="M4.5 10h11M11.5 6l4 4-4 4"/>',
    undo: '<path d="M14.5 8H7.5a3.5 3.5 0 000 7h5"/><path d="M11.5 5l3 3-3 3"/>',
    refresh: '<path d="M16 10a6 6 0 11-1.8-4.3"/><path d="M16 3.5v3h-3"/>',
    file: '<path d="M5 2.75h6.5L15 6.25V17.25H5z"/><path d="M11.5 2.75v3.5H15"/>',
    save: '<path d="M4 3.5h9.5L16.5 6.5v10H4z"/><path d="M7 3.5v4h6v-4M7 16.5v-5h6v5"/>',
    folder: '<path d="M3 5.5a1.5 1.5 0 011.5-1.5h3.2l1.8 2h6a1.5 1.5 0 011.5 1.5v7a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 013 14.5z"/>',
    sparkle: '<path d="M10 3l1.6 4.4L16 9l-4.4 1.6L10 15l-1.6-4.4L4 9l4.4-1.6z"/>',
    sun: '<circle cx="10" cy="10" r="3.25"/><path d="M10 2.75v1.5M10 15.75v1.5M2.75 10h1.5M15.75 10h1.5M4.9 4.9l1.05 1.05M14.05 14.05l1.05 1.05M4.9 15.1l1.05-1.05M14.05 5.95l1.05-1.05"/>',
    moon: '<path d="M16 12.3A6.5 6.5 0 117.7 4a5 5 0 008.3 8.3z"/>',
    monitor: '<rect x="3" y="4" width="14" height="9.5" rx="2"/><path d="M7.5 16.5h5"/>',
    trash: '<path d="M4 6h12M8 6V4.5h4V6M5.5 6l.7 10.5h7.6L14.5 6"/>'
  };
  function svg(name, extraAttrs) {
    return '<svg class="icon" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" ' + (extraAttrs || '') + '>' + (PATHS[name] || '') + '</svg>';
  }
  return { svg: svg, names: Object.keys(PATHS) };
})();

var DemoData = (function () {
  'use strict';
  var TIERS = { 'مدير إدارة': 979, 'مدير': 750, 'رئيس قسم': 534, 'عضو مميز': 494, 'شهادة عليا': 445, 'فوق متوسط': 400, 'متوسط': 356, 'معاون خدمة': 303 };
  var TIER_ORDER = Object.keys(TIERS);
  var TIER_JOB_TITLE = { 'مدير إدارة': 'مدير عام الإدارة', 'مدير': 'مدير الإدارة', 'رئيس قسم': 'رئيس قسم', 'عضو مميز': 'أخصائي أول', 'شهادة عليا': 'أخصائي', 'فوق متوسط': 'فني أول', 'متوسط': 'فني', 'معاون خدمة': 'معاون خدمة' };
  var DEPARTMENTS = ['الإدارة العامة', 'إدارة الحسابات', 'إدارة الشئون الطبية', 'إدارة الموارد البشرية'];
  var POOLS = {
    'طوابع المواليد': { gross: 185000, taxRate: 0.11 },
    'طوابع اللجان الطبية': { gross: 142000, taxRate: 0.240938 },
    'نماذج استمارات 111': { gross: 97500, taxRate: 0.240938 }
  };
  var FIRST_NAMES = ['محمد', 'أحمد', 'محمود', 'مصطفى', 'عمر', 'إبراهيم', 'يوسف', 'خالد', 'طارق', 'هاني', 'سامي', 'وليد', 'فاطمة', 'مريم', 'سارة', 'نور', 'هبة', 'رانيا', 'داليا', 'ياسمين', 'إيمان', 'منى', 'سلمى', 'أمل'];
  var SECOND_NAMES = ['أحمد', 'محمد', 'السيد', 'عبدالله', 'حسن', 'حسين', 'عبدالرحمن', 'فتحي', 'رمضان', 'جمال', 'عادل', 'فؤاد', 'توفيق', 'رأفت', 'لطفي', 'سعيد'];

  function buildDemoPeople() {
    var people = [];
    var penalized = { 11: 0.15, 37: 0.25 };
    for (var i = 0; i < 60; i++) {
      var tier = TIER_ORDER[i % TIER_ORDER.length];
      people.push({
        id: i + 1,
        name: FIRST_NAMES[i % FIRST_NAMES.length] + ' ' + SECOND_NAMES[(i * 7 + 3) % SECOND_NAMES.length],
        job: TIER_JOB_TITLE[tier],
        dept: DEPARTMENTS[i % DEPARTMENTS.length],
        tier: tier,
        overrideValue: null,
        daysWorked: i === 24 ? 15 : null,
        penaltyRate: penalized.hasOwnProperty(i) ? penalized[i] : null,
        pinnedPool: null,
        excluded: false,
        manualFactor: null
      });
    }
    return people;
  }

  return { TIERS: TIERS, TIER_ORDER: TIER_ORDER, DEPARTMENTS: DEPARTMENTS, POOLS: POOLS, buildDemoPeople: buildDemoPeople };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
