/**
 * Monthly spending goals per category, and how each month is doing against them.
 *
 * A goal is the reader's own number — "food under €400 a month" — and the
 * question is not only "am I over" but "am I on course": €300 by the 10th is
 * fine for a month that is mostly rent and terrible for groceries. So each goal
 * reports three figures:
 *
 *   spent      what has gone out under the category this month, refunds netted
 *   expected   the goal scaled to how far into the month today is
 *   projected  this month's pace carried to its end
 *
 * and a status — `over` (already past the goal), `atRisk` (on pace to pass it),
 * or `ok` — which the card spells out in words beside the bar.
 *
 * Goals are keyed by category **id**, not name: renaming "food" to "Comida" must
 * not orphan the goal. Spending is read by the real category (what it bought),
 * never the dashboard's travel overlay — food eaten in Dublin is still food.
 * Investing is not spending (engines/investing.js) and never counts against a
 * goal.
 *
 * The suggested goal for a category is its median month over the last six
 * complete ones: the month it usually is, which a mean would not be after one
 * expensive December.
 *
 * The projection knows about bills. A straight-line pace reads a €40 transport
 * pass bought on the 2nd as €40 every two days and calls the month at risk by
 * the 7th; so recurring charges (engines/recurring.js) are counted as what they
 * are — already paid, or still due on their own date — and only the rest of the
 * month's spending is extrapolated.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { statePath } from '../lib/paths.js';
import { normalizeMerchantKey } from '../lib/merchant.js';
import { occurrences } from './recurring.js';

const round2 = (n) => Math.round(n * 100) / 100;
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthKey = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

function file() {
  return statePath('budgets.json');
}

export function loadGoals() {
  if (!existsSync(file())) return {};
  try {
    const stored = JSON.parse(readFileSync(file(), 'utf-8'));
    return stored.goals && typeof stored.goals === 'object' ? stored.goals : {};
  } catch {
    return {};
  }
}

/** Sets one category's monthly goal; null, zero or blank removes it. */
export function setGoal(categoryId, amount) {
  const goals = loadGoals();
  const value = Number(amount);
  if (amount == null || amount === '' || !Number.isFinite(value) || value <= 0) delete goals[categoryId];
  else goals[categoryId] = round2(value);
  writeFileSync(file(), JSON.stringify({ goals }, null, 2), 'utf-8');
  return goals;
}

/** Net spending per category per month: debits less refunds, never below zero. */
function monthlySpend(transactions) {
  const byMonth = new Map();
  for (const tx of transactions) {
    if (tx.investment) continue;
    const amount = Number(tx.amount) || 0;
    if (!amount) continue;
    const month = String(tx.date || '').slice(0, 7);
    const category = tx.category || 'uncategorized';
    const row = byMonth.get(month) || new Map();
    row.set(category, (row.get(category) || 0) - amount);
    byMonth.set(month, row);
  }
  return (month, category) => Math.max(0, byMonth.get(month)?.get(category) || 0);
}

/**
 * @param transactions the spending set (internal moves already out)
 * @param categories the registry, for id ↔ name
 * @param goals `{ [categoryId]: amount }`
 * @param month 'YYYY-MM' to report on
 * @param today 'YYYY-MM-DD'; the month is complete when today is past it
 */
export function budgetReport(transactions, categories, goals, { month, today, history = 6, series = [] } = {}) {
  const [year, mon] = String(month).split('-').map(Number);
  const length = daysIn(year, mon);
  const current = String(today).slice(0, 7) === month;
  const day = current ? Number(String(today).slice(8, 10)) : length;
  const elapsed = day / length;
  const spendOf = monthlySpend(transactions);

  const earlier = Array.from({ length: history }, (_, i) => {
    const total = year * 12 + (mon - 1) - (i + 1);
    return monthKey(Math.floor(total / 12), (total % 12) + 1);
  }).reverse();
  // A month the ledger does not reach is not a month of zero spending.
  const first = transactions.reduce((min, tx) => {
    const d = String(tx.date || '').slice(0, 7);
    return d && (!min || d < min) ? d : min;
  }, null);
  const covered = earlier.filter((m) => first && m >= first);

  // What of this month is scheduled: the bills already paid (by merchant key),
  // and those still due before it ends, per category.
  const scheduledKeys = new Set(series.filter((x) => x.direction === 'out').map((x) => x.key.slice(4)));
  const paidScheduled = new Map();
  if (current) {
    for (const tx of transactions) {
      const amount = Number(tx.amount) || 0;
      if (amount >= 0 || tx.investment || String(tx.date || '').slice(0, 7) !== month) continue;
      if (!scheduledKeys.has(normalizeMerchantKey(tx).key)) continue;
      const category = tx.category || 'uncategorized';
      paidScheduled.set(category, (paidScheduled.get(category) || 0) - amount);
    }
  }
  const dueScheduled = new Map();
  if (current && day < length) {
    const tomorrow = `${month}-${String(day + 1).padStart(2, '0')}`;
    const end = `${month}-${String(length).padStart(2, '0')}`;
    for (const o of occurrences(series.filter((x) => x.direction === 'out' && !x.investment), tomorrow, end)) {
      dueScheduled.set(o.category, (dueScheduled.get(o.category) || 0) - o.amount);
    }
  }

  const byId = new Map(categories.map((c) => [c.id, c]));
  const rows = [];
  for (const [id, goal] of Object.entries(goals)) {
    const category = byId.get(id);
    if (!category) continue;
    const spent = spendOf(month, category.name);
    const expected = goal * elapsed;
    const paid = paidScheduled.get(category.name) || 0;
    const due = dueScheduled.get(category.name) || 0;
    const everyday = Math.max(spent - paid, 0);
    const projected = current && elapsed > 0 ? paid + due + everyday / elapsed : spent;
    const past = covered.map((m) => ({ month: m, spent: round2(spendOf(m, category.name)) }));
    rows.push({
      id,
      category: category.name,
      icon: category.icon || null,
      goal,
      spent: round2(spent),
      expected: round2(expected),
      projected: round2(projected),
      remaining: round2(goal - spent),
      status: spent > goal ? 'over' : current && projected > goal * 1.02 ? 'atRisk' : 'ok',
      history: past,
      // Months in the window that stayed within the goal.
      hits: past.filter((p) => p.spent <= goal).length,
    });
  }
  rows.sort((a, b) => b.spent / b.goal - a.spent / a.goal);

  const suggestions = {};
  for (const category of categories) {
    if (category.derived) continue;
    const typical = median(covered.map((m) => spendOf(m, category.name)));
    if (typical > 0) suggestions[category.id] = Math.ceil(typical / 10) * 10;
  }

  const totalGoal = rows.reduce((s, r) => s + r.goal, 0);
  const totalSpent = rows.reduce((s, r) => s + r.spent, 0);
  return {
    month,
    day,
    daysInMonth: length,
    current,
    months: covered.length,
    rows,
    suggestions,
    totals: { goal: round2(totalGoal), spent: round2(totalSpent), expected: round2(totalGoal * elapsed) },
  };
}
