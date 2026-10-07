/**
 * What will be charged again, and when — inferred from what already was.
 *
 * There is no bills feed to read. The bank statement is the only record, so a
 * bill is recognised the way a person would recognise it scrolling back through
 * their own account: the same merchant, at a steady rhythm, for roughly the same
 * amount. The monthly transport pass bought around the 1st, the rent on the 2nd,
 * Spotify on the 5th, the salary on the 1st.
 *
 * This is broader than `detectRecurringSubscriptions` in analytics.js (which
 * feeds the Committed card and stays as it is, inside the snapshot baseline): it
 * reads income as well as spending, because a forecast needs the salary, it
 * groups by the cleaned merchant rather than the raw memo — the card number in
 * "COMPRA 0412 …" rotates, and the raw memo split one pass into three — and it
 * says *when* the next one is due, which a "monthly cost" never did.
 *
 * What it takes to count, and why:
 *
 *  - **A cadence it can name.** Weekly, fortnightly, monthly, every two months,
 *    quarterly, twice a year, yearly. A median gap that falls between those is a
 *    habit (groceries every three or four days), not a bill.
 *  - **Regularity, not perfection.** At least 70% of the gaps sit near the
 *    median. A pass skipped for the August holiday leaves one long gap; demanding
 *    every gap be regular would lose the pass for the whole year.
 *  - **A steady amount, for the fast cadences only.** A weekly charge has to be
 *    near-constant to be a commitment rather than a shopping habit; a monthly
 *    electricity bill swings with the season and is still a bill, so it is kept
 *    and marked `variable`.
 *  - **Still alive.** A series whose next date passed more than half a cycle ago
 *    has stopped — a cancelled gym is not an upcoming bill.
 */
import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { statePath } from '../lib/paths.js';
import { normalizeMerchantKey } from '../lib/merchant.js';

const DAY = 86400000;
const dayMs = (iso) => Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const round2 = (n) => Math.round(n * 100) / 100;
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * The rhythms a bill can have. `months` marks the calendar ones: those are
 * projected onto the same day of the month rather than by counting days, so a
 * rent paid on the 2nd stays on the 2nd through February.
 */
export const CADENCES = [
  { id: 'weekly', min: 5, max: 9, days: 7, steady: true },
  { id: 'biweekly', min: 12, max: 17, days: 14, steady: true },
  { id: 'monthly', min: 25, max: 36, days: 30.44, months: 1 },
  { id: 'bimonthly', min: 55, max: 66, days: 60.88, months: 2 },
  { id: 'quarterly', min: 80, max: 100, days: 91.31, months: 3 },
  { id: 'semiannual', min: 165, max: 200, days: 182.62, months: 6 },
  { id: 'yearly', min: 345, max: 385, days: 365.25, months: 12 },
];

const REGULAR_SHARE = 0.7;
// Spread of the recent amounts, as a share of the typical one, past which a
// weekly charge stops being a fixed commitment.
const STEADY_SPREAD = 0.2;
// Past this the amount is called variable (shown, still projected at its median).
const VARIABLE_SPREAD = 0.35;

// ---------- the owner's corrections ----------

function file() {
  return statePath('recurring.json');
}

export function loadRecurringState() {
  if (!existsSync(file())) return { ignored: [] };
  try {
    const state = JSON.parse(readFileSync(file(), 'utf-8'));
    return { ignored: Array.isArray(state.ignored) ? state.ignored : [] };
  } catch {
    return { ignored: [] };
  }
}

/** "This is not a bill": off the calendar and out of the forecast, reversibly. */
export function setIgnored(id, ignored) {
  const state = loadRecurringState();
  const set = new Set(state.ignored);
  if (ignored) set.add(id);
  else set.delete(id);
  state.ignored = [...set];
  writeFileSync(file(), JSON.stringify(state, null, 2), 'utf-8');
  return state;
}

// ---------- detection ----------

const seriesId = (key) => createHash('sha1').update(key).digest('hex').slice(0, 12);

/** The next date a calendar cadence lands on, keeping the usual day of month. */
function addMonthsOnDay(iso, months, day) {
  const d = new Date(dayMs(iso));
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return isoOf(target.getTime());
}

function step(series, iso) {
  return series.months
    ? addMonthsOnDay(iso, series.months, series.dayOfMonth)
    : isoOf(dayMs(iso) + series.intervalDays * DAY);
}

/**
 * Every recurring series in a list of movements.
 *
 * `transactions` should already exclude internal moves (`spendingTransactions`
 * does): money changing pocket is not a bill. Investing stays in — a monthly ETF
 * purchase leaves the account on schedule like any bill, and is marked as such.
 */
export function detectRecurring(transactions, { today, ignored = [] } = {}) {
  const now = today || isoOf(Date.now());
  const skip = new Set(ignored);

  // Grouped by direction and merchant; several charges on one day are one event.
  const groups = new Map();
  for (const tx of transactions) {
    const amount = Number(tx.amount) || 0;
    const date = String(tx.date || '').slice(0, 10);
    if (!amount || date.length !== 10 || date > now) continue;
    const { key, label } = normalizeMerchantKey(tx);
    const direction = amount < 0 ? 'out' : 'in';
    const groupKey = `${direction}:${key}`;
    const group = groups.get(groupKey) || { key: groupKey, label, direction, days: new Map(), categories: new Map(), investing: 0, rows: 0 };
    const day = group.days.get(date) || { date, amount: 0, description: tx.description };
    day.amount += amount;
    group.days.set(date, day);
    group.label = label;
    const category = tx.category || 'uncategorized';
    group.categories.set(category, (group.categories.get(category) || 0) + 1);
    if (tx.investment) group.investing += 1;
    group.rows += 1;
    groups.set(groupKey, group);
  }

  const series = [];
  for (const group of groups.values()) {
    const days = [...group.days.values()].sort((a, b) => a.date.localeCompare(b.date));
    if (days.length < 3) continue;

    const gaps = [];
    for (let i = 1; i < days.length; i++) gaps.push((dayMs(days[i].date) - dayMs(days[i - 1].date)) / DAY);
    const typicalGap = median(gaps);
    const cadence = CADENCES.find((c) => typicalGap >= c.min && typicalGap <= c.max);
    if (!cadence) continue;

    const tolerance = Math.max(3, cadence.days * 0.2);
    const regular = gaps.filter((g) => Math.abs(g - typicalGap) <= tolerance || isMultiple(g, typicalGap, tolerance)).length;
    if (regular / gaps.length < REGULAR_SHARE) continue;

    // The recent amounts are what the next one will look like; a price rise two
    // years ago is history.
    const recent = days.slice(-6).map((d) => Math.abs(d.amount));
    const typical = median(recent);
    const spread = typical ? (Math.max(...recent) - Math.min(...recent)) / typical : 0;
    if (cadence.steady && spread > STEADY_SPREAD) continue;

    const last = days[days.length - 1];
    const draft = {
      months: cadence.months || 0,
      intervalDays: Math.round(typicalGap),
      dayOfMonth: cadence.months ? Math.round(median(days.slice(-6).map((d) => Number(d.date.slice(8, 10))))) : null,
    };
    let next = step(draft, last.date);
    // Overdue by more than half a cycle means it has stopped.
    const lateBy = (dayMs(now) - dayMs(next)) / DAY;
    if (lateBy > cadence.days / 2 + 3) continue;

    const id = seriesId(group.key);
    if (skip.has(id)) continue;

    const category = [...group.categories.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const sign = group.direction === 'out' ? -1 : 1;
    series.push({
      id,
      key: group.key,
      name: group.label,
      description: last.description,
      direction: group.direction,
      category,
      investment: group.investing * 2 > group.rows,
      cadence: cadence.id,
      intervalDays: draft.intervalDays,
      months: draft.months,
      dayOfMonth: draft.dayOfMonth,
      amount: round2(sign * typical),
      lastAmount: round2(last.amount),
      variable: spread > VARIABLE_SPREAD,
      count: days.length,
      firstDate: days[0].date,
      lastDate: last.date,
      nextDate: next,
      // Expected already and not seen yet — still shown, on today.
      overdue: next < now,
      // What it costs or brings in per month, for totals across cadences.
      monthly: round2((sign * typical * 30.44) / cadence.days),
      regularity: round2(regular / gaps.length),
    });
  }

  return series.sort((a, b) => a.nextDate.localeCompare(b.nextDate) || a.amount - b.amount);
}

/** A long gap that is two or three cycles is a skipped month, not irregularity. */
function isMultiple(gap, typical, tolerance) {
  for (const k of [2, 3]) if (Math.abs(gap - typical * k) <= tolerance * k) return true;
  return false;
}

/**
 * Every date a series is expected to land on between `from` and `to`,
 * inclusive. An overdue occurrence is placed on `from` — it is still owed.
 */
export function occurrences(seriesList, from, to) {
  const out = [];
  for (const series of seriesList) {
    let date = series.nextDate;
    let guard = 0;
    while (date <= to && guard++ < 400) {
      const on = date < from ? from : date;
      out.push({
        date: on,
        expected: date,
        id: series.id,
        name: series.name,
        category: series.category,
        direction: series.direction,
        investment: series.investment,
        cadence: series.cadence,
        variable: series.variable,
        amount: series.amount,
        overdue: date < from,
      });
      date = step(series, date);
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount);
}
