const amountOf = (tx) => (typeof tx.amount === 'number' ? tx.amount : parseFloat(tx.amount) || 0);

const dateOf = (tx) => (tx.date || tx.timestamp || '').slice(0, 10);

/** Buckets a date into the requested granularity: 2026-03-14 -> "2026-Q1". */
export function bucketKey(dateStr, granularity = 'month') {
  const iso = String(dateStr || '');
  if (iso.length < 7) return null;
  if (granularity === 'year') return iso.slice(0, 4);
  if (granularity === 'quarter') {
    const q = Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1;
    return `${iso.slice(0, 4)}-Q${q}`;
  }
  return iso.slice(0, 7);
}

/** Applies the dashboard's date range and category filter to a transaction list. */
export function filterTransactions(transactions, { from, to, categories, categoryMap = {} } = {}) {
  let list = transactions;
  if (from) list = list.filter((t) => dateOf(t) >= from);
  if (to) list = list.filter((t) => dateOf(t) <= to);
  if (categories?.length) {
    const wanted = new Set(categories);
    list = list.filter((t) => wanted.has(categoryMap[t.id] || t.category || 'uncategorized'));
  }
  return list;
}

/**
 * Applies every filter the transactions list offers, from raw query-string
 * values. Anything absent or blank is simply not applied, so the same function
 * serves "everything" and a six-way narrowed search.
 */
export function applyTransactionFilters(transactions, query = {}) {
  const {
    status,
    search,
    startDate,
    endDate,
    category,
    tag,
    minAmount,
    maxAmount,
    source,
    direction,
  } = query;

  let list = transactions;

  if (status && status !== 'all') list = list.filter((t) => t.status === status);

  if (search) {
    const q = String(search).toLowerCase();
    list = list.filter(
      (t) =>
        (t.description || '').toLowerCase().includes(q) ||
        (t.merchant || '').toLowerCase().includes(q)
    );
  }

  list = filterTransactions(list, { from: startDate, to: endDate });

  if (category) list = list.filter((t) => (t.category || 'uncategorized') === category);
  if (tag) list = list.filter((t) => (t.tags || []).includes(tag));
  if (source) list = list.filter((t) => t.source === source);

  // Compared on the absolute value: "between 10 and 50" should mean the size of
  // the movement, not its sign — direction is a separate filter.
  const min = minAmount === '' || minAmount == null ? null : Number(minAmount);
  const max = maxAmount === '' || maxAmount == null ? null : Number(maxAmount);
  if (min != null && Number.isFinite(min)) list = list.filter((t) => Math.abs(amountOf(t)) >= min);
  if (max != null && Number.isFinite(max)) list = list.filter((t) => Math.abs(amountOf(t)) <= max);

  if (direction === 'debit') list = list.filter((t) => amountOf(t) < 0);
  else if (direction === 'credit') list = list.filter((t) => amountOf(t) >= 0);

  return list;
}

export function computeMonthlyCashflow(transactions, granularity = 'month') {
  const buckets = {};
  for (const tx of transactions) {
    const key = bucketKey(dateOf(tx), granularity);
    if (!key) continue;
    if (!buckets[key]) buckets[key] = { income: 0, expense: 0, net: 0, count: 0 };
    const amt = amountOf(tx);
    if (amt > 0) buckets[key].income += amt;
    else buckets[key].expense += Math.abs(amt);
    buckets[key].net = buckets[key].income - buckets[key].expense;
    buckets[key].count++;
  }
  return Object.entries(buckets)
    .map(([month, data]) => ({ month, ...data }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Spending per category per period, shaped for a stacked area chart: one row
 * per period with a column per category. Categories are capped so the chart
 * never needs more colours than the palette has slots.
 */
export function computeCategoryTrend(transactions, categoryMap = {}, granularity = 'month', maxSeries = 8) {
  const totals = {};
  for (const tx of transactions) {
    const amt = amountOf(tx);
    if (amt >= 0) continue;
    const cat = categoryMap[tx.id] || tx.category || 'uncategorized';
    totals[cat] = (totals[cat] || 0) + Math.abs(amt);
  }

  const ranked = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, maxSeries).map(([c]) => c);
  const topSet = new Set(top);
  const hasOther = ranked.length > maxSeries;

  const buckets = new Map();
  for (const tx of transactions) {
    const amt = amountOf(tx);
    if (amt >= 0) continue;
    const key = bucketKey(dateOf(tx), granularity);
    if (!key) continue;
    const cat = categoryMap[tx.id] || tx.category || 'uncategorized';
    const slot = topSet.has(cat) ? cat : 'Outros';
    const row = buckets.get(key) || { period: key };
    row[slot] = (row[slot] || 0) + Math.abs(amt);
    buckets.set(key, row);
  }

  return {
    categories: hasOther ? [...top, 'Outros'] : top,
    rows: [...buckets.values()].sort((a, b) => a.period.localeCompare(b.period)),
  };
}

export function computeTopMerchants(transactions, limit = 10) {
  const totals = new Map();
  for (const tx of transactions) {
    const amt = amountOf(tx);
    if (amt >= 0) continue;
    const name = (tx.merchant || tx.description || '').trim() || 'Desconhecido';
    const entry = totals.get(name) || { merchant: name, total: 0, count: 0 };
    entry.total += Math.abs(amt);
    entry.count++;
    totals.set(name, entry);
  }
  return [...totals.values()].sort((a, b) => b.total - a.total).slice(0, limit);
}

/** Running balance across periods — answers "am I ahead or behind overall?". */
export function computeCumulativeBalance(cashflow) {
  let running = 0;
  return cashflow.map((m) => {
    running += m.net;
    return { month: m.month, net: m.net, cumulative: Math.round(running * 100) / 100 };
  });
}

// A period with barely any income cannot have a meaningful savings *rate*: the
// denominator is noise, so the percentage is noise multiplied. Below both of
// these — a token amount, and a token amount relative to what was spent — the
// period reports no rate rather than a spectacular fictional one.
const MATERIAL_INCOME = 50;
const MATERIAL_INCOME_RATIO = 0.25;
// Rates are clamped for drawing at ±100%. Spending twice your income is already
// the strongest thing the chart needs to say; -733% only says it louder while
// flattening every other month into a straight line.
const RATE_LIMIT = 100;

/**
 * Savings rate per period, clamped for legibility but never silently altered.
 *
 * `rate` is what the chart plots; `trueRate` is what actually happened, and is
 * what the tooltip must show whenever `clamped` is set. The real ledger has
 * twelve months outside ±100%, the worst being July 2021 — €45 of income
 * against €379 of spending, which is a student year, not a data error.
 */
export function computeSavingsRate(cashflow) {
  return cashflow.map((m) => {
    const material = m.income > 0 && (m.income >= MATERIAL_INCOME || m.income >= MATERIAL_INCOME_RATIO * m.expense);
    if (!material) return { month: m.month, rate: null, trueRate: null, clamped: false };

    const trueRate = Math.round(((m.income - m.expense) / m.income) * 1000) / 10;
    const rate = Math.max(-RATE_LIMIT, Math.min(RATE_LIMIT, trueRate));
    return { month: m.month, rate, trueRate, clamped: rate !== trueRate };
  });
}

export function computeCategoryBreakdown(transactions, categorizedMap) {
  const categories = {};
  for (const tx of transactions) {
    const category = categorizedMap[tx.id] || tx.category || 'uncategorized';
    const amt = typeof tx.amount === 'number' ? tx.amount : parseFloat(tx.amount) || 0;
    const absAmount = Math.abs(amt);
    if (!categories[category]) categories[category] = { total: 0, count: 0, income: 0, expense: 0 };
    categories[category].total += absAmount;
    categories[category].count++;
    if (amt > 0) categories[category].income += amt;
    else categories[category].expense += absAmount;
  }
  return Object.entries(categories)
    .map(([category, data]) => ({ category, ...data }))
    .sort((a, b) => b.total - a.total);
}

export function computeNetWorthEvolution(assetsSnapshots) {
  return assetsSnapshots
    .map((s) => ({
      date: s.date,
      total: s.items.reduce((sum, item) => sum + (item.value || 0), 0),
      breakdown: s.items.map((i) => ({ name: i.name, value: i.value, type: i.type })),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function computeAssetAllocation(assets) {
  const allocation = {};
  let total = 0;
  for (const asset of assets) {
    const val = asset.currentValue || asset.value || 0;
    total += val;
  }
  for (const asset of assets) {
    const val = asset.currentValue || asset.value || 0;
    const type = asset.type || asset.class || 'other';
    if (!allocation[type]) allocation[type] = { value: 0, percentage: 0, items: [] };
    allocation[type].value += val;
    allocation[type].items.push({ name: asset.name, value: val });
  }
  for (const key of Object.keys(allocation)) {
    allocation[key].percentage = total > 0 ? (allocation[key].value / total) * 100 : 0;
  }
  return { allocation, total };
}

export function computeROI(assets) {
  return assets.map((a) => {
    const current = a.currentValue || a.value || 0;
    const cost = a.costBasis || a.purchaseValue || 0;
    const roi = cost > 0 ? ((current - cost) / cost) * 100 : 0;
    return {
      name: a.name,
      type: a.type || a.class || 'other',
      currentValue: current,
      costBasis: cost,
      roi,
    };
  });
}

export function detectSpendingAnomalies(monthlyCashflow) {
  if (monthlyCashflow.length < 3) return [];
  const expenses = monthlyCashflow.map((m) => m.expense);
  const mean = expenses.reduce((s, v) => s + v, 0) / expenses.length;
  const std = Math.sqrt(expenses.reduce((s, v) => s + (v - mean) ** 2, 0) / expenses.length);
  const anomalies = [];
  for (const m of monthlyCashflow) {
    const zScore = std > 0 ? (m.expense - mean) / std : 0;
    if (Math.abs(zScore) > 2) {
      anomalies.push({ month: m.month, expense: m.expense, zScore, mean });
    }
  }
  return anomalies;
}

/**
 * Standing commitments: the things that will be charged again whether or not
 * anything is done about them.
 *
 * What makes a subscription is not repetition, it is *rhythm*. Counting
 * repeated charges of a similar amount labelled the launderette a subscription,
 * because three washing machines run on the same afternoon are three charges of
 * €2 and €3. Three charges in one day is a busy Tuesday, not a commitment.
 *
 * So a candidate has to recur across at least three separate months, at a
 * roughly constant interval. Spotify at €4.99 every month qualifies; the
 * launderette does not, however often it is used.
 */
export function detectRecurringSubscriptions(transactions, { minOccurrences = 3, tolerance = 0.25 } = {}) {
  const byDescription = new Map();
  for (const tx of transactions) {
    if (amountOf(tx) >= 0) continue; // expenses only
    const key = (tx.description || tx.merchant || '').toLowerCase().trim();
    if (!key) continue;
    if (!byDescription.has(key)) byDescription.set(key, []);
    byDescription.get(key).push(tx);
  }

  const recurring = [];
  for (const [merchant, all] of byDescription) {
    // Several charges on one day are one event as far as rhythm is concerned.
    const byDay = new Map();
    for (const tx of all) {
      const day = dateOf(tx);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(tx);
    }
    const days = [...byDay.keys()].sort();
    if (days.length < minOccurrences) continue;

    // Spanning three distinct months rules out a burst inside a single one.
    const months = new Set(days.map((d) => d.slice(0, 7)));
    if (months.size < minOccurrences) continue;

    const gaps = [];
    for (let i = 1; i < days.length; i++) {
      gaps.push((Date.parse(days[i]) - Date.parse(days[i - 1])) / 86400000);
    }
    const meanGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    if (!(meanGap > 0)) continue;

    // Every interval has to sit near the average one. A charge that lands
    // monthly and then not for half a year is not a standing commitment.
    const regular = gaps.every((g) => Math.abs(g - meanGap) <= meanGap * tolerance + 3);
    if (!regular) continue;

    const perDay = days.map((d) => byDay.get(d).reduce((s, tx) => s + Math.abs(amountOf(tx)), 0));
    const avgAmount = perDay.reduce((s, v) => s + v, 0) / perDay.length;
    // A price that swings wildly is metered usage, not a subscription.
    if (perDay.some((v) => Math.abs(v - avgAmount) > avgAmount * 0.5)) continue;

    recurring.push({
      merchant,
      count: days.length,
      avgAmount: Math.round(avgAmount * 100) / 100,
      cadence: cadenceLabel(meanGap),
      intervalDays: Math.round(meanGap),
      monthlyCost: Math.round((avgAmount * (30.44 / meanGap)) * 100) / 100,
      lastDate: days[days.length - 1],
    });
  }

  return recurring.sort((a, b) => b.monthlyCost - a.monthlyCost);
}

function cadenceLabel(days) {
  if (days <= 9) return 'semanal';
  if (days <= 18) return 'quinzenal';
  if (days <= 45) return 'mensal';
  if (days <= 120) return 'trimestral';
  if (days <= 250) return 'semestral';
  return 'anual';
}

/**
 * What changed, per category, against the period before this one.
 *
 * Reported in euros rather than percentages on purpose: a category that went
 * from €2 to €6 is up 200% and means nothing, while one that went from €400 to
 * €520 is up 30% and is the reason the month feels tight.
 */
export function computeCategoryShifts(transactions, previous, categoryMap = {}, limit = 6) {
  const now = new Map();
  const before = new Map();

  const tally = (list, target) => {
    for (const tx of list) {
      const amount = amountOf(tx);
      if (amount >= 0) continue;
      const category = categoryMap[tx.id] || tx.category || 'uncategorized';
      const entry = target.get(category) || { total: 0, biggest: null };
      entry.total += Math.abs(amount);
      if (!entry.biggest || Math.abs(amount) > Math.abs(amountOf(entry.biggest))) entry.biggest = tx;
      target.set(category, entry);
    }
  };
  tally(transactions, now);
  tally(previous, before);

  const shifts = [];
  for (const category of new Set([...now.keys(), ...before.keys()])) {
    const current = now.get(category)?.total || 0;
    const past = before.get(category)?.total || 0;
    const delta = current - past;
    if (Math.abs(delta) < 1) continue;
    const driver = now.get(category)?.biggest;
    shifts.push({
      category,
      current: Math.round(current * 100) / 100,
      previous: Math.round(past * 100) / 100,
      delta: Math.round(delta * 100) / 100,
      driver: driver
        ? { description: driver.description, amount: amountOf(driver), date: dateOf(driver) }
        : null,
    });
  }

  return shifts.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, limit);
}

/**
 * The current period projected to its end from the pace so far.
 *
 * A month seen on the 8th always looks cheap. Comparing eight days against a
 * full month is the single most misleading thing a spending screen can do.
 */
export function projectCurrentMonth(monthlyCashflow, today = new Date()) {
  if (!monthlyCashflow.length) return null;
  const current = monthlyCashflow[monthlyCashflow.length - 1];
  const iso = today.toISOString().slice(0, 10);
  if (current.month !== iso.slice(0, 7)) return null;

  const dayOfMonth = Number(iso.slice(8, 10));
  const daysInMonth = new Date(
    Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0)
  ).getUTCDate();
  if (dayOfMonth >= daysInMonth) return null;

  const factor = daysInMonth / dayOfMonth;
  return {
    month: current.month,
    dayOfMonth,
    daysInMonth,
    expenseSoFar: Math.round(current.expense * 100) / 100,
    projectedExpense: Math.round(current.expense * factor * 100) / 100,
  };
}

export function computeInsights(transactions, categorizedMap, monthlyCashflow) {
  const breakdown = computeCategoryBreakdown(transactions, categorizedMap);
  const totalSpending = breakdown.reduce((s, c) => s + c.expense, 0);
  // Ranked by what was actually spent, not by how much moved. `breakdown` sorts
  // on the absolute total, which floats income to the top of a list headed
  // "where your money went" — a category you were paid from is not one you
  // spent in, and a category with no spending at all belongs nowhere near it.
  const topCategories = breakdown
    .filter((c) => c.expense > 0)
    .sort((a, b) => b.expense - a.expense)
    .slice(0, 5);
  const anomalies = detectSpendingAnomalies(monthlyCashflow);
  const recurring = detectRecurringSubscriptions(transactions);

  const months = monthlyCashflow.filter((m) => m.expense > 0);
  const averageMonth = months.length
    ? months.reduce((s, m) => s + m.expense, 0) / months.length
    : 0;

  return {
    totalSpending,
    topCategories,
    breakdown,
    anomalies,
    recurring,
    averageMonth: Math.round(averageMonth * 100) / 100,
    committedMonthly: Math.round(recurring.reduce((s, r) => s + r.monthlyCost, 0) * 100) / 100,
    // Written out only where there is something to say. The old version emitted
    // "You spent 0.0% on income" — a sentence that is both meaningless and
    // English, on a screen that is otherwise Portuguese.
    summary: totalSpending
      ? topCategories
          .filter((c) => c.expense / totalSpending >= 0.03)
          .map(
            (c) =>
              `${((c.expense / totalSpending) * 100).toFixed(0)}% do que gastaste foi em ${c.category}`
          )
      : [],
  };
}