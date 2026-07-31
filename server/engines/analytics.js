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

export function computeSavingsRate(cashflow) {
  return cashflow.map((m) => ({
    month: m.month,
    rate: m.income > 0 ? Math.round(((m.income - m.expense) / m.income) * 1000) / 10 : null,
  }));
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

export function detectRecurringSubscriptions(transactions) {
  const byDescription = {};
  for (const tx of transactions) {
    if (tx.amount >= 0) continue; // expenses only
    const desc = (tx.description || tx.merchant || '').toLowerCase().trim();
    if (!desc) continue;
    if (!byDescription[desc]) byDescription[desc] = [];
    byDescription[desc].push(tx);
  }
  const recurring = [];
  for (const [desc, txs] of Object.entries(byDescription)) {
    if (txs.length >= 2) {
      const amounts = txs.map((t) => Math.abs(typeof t.amount === 'number' ? t.amount : parseFloat(t.amount) || 0));
      const uniqAmounts = [...new Set(amounts)];
      if (uniqAmounts.length <= 2) {
        recurring.push({
          merchant: desc,
          count: txs.length,
          avgAmount: amounts.reduce((s, v) => s + v, 0) / amounts.length,
          lastDate: txs[txs.length - 1].date || txs[txs.length - 1].timestamp,
        });
      }
    }
  }
  return recurring.sort((a, b) => b.count - a.count);
}

export function computeInsights(transactions, categorizedMap, monthlyCashflow) {
  const breakdown = computeCategoryBreakdown(transactions, categorizedMap);
  const totalSpending = breakdown.reduce((s, c) => s + c.expense, 0);
  const topCategories = breakdown.slice(0, 5);
  const anomalies = detectSpendingAnomalies(monthlyCashflow);
  const recurring = detectRecurringSubscriptions(transactions);

  return {
    totalSpending,
    topCategories,
    breakdown,
    anomalies,
    recurring,
    summary: topCategories.map(
      (c) => `You spent ${((c.expense / totalSpending) * 100).toFixed(1)}% on ${c.category}`
    ),
  };
}