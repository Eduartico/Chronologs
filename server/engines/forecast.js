/**
 * Where the accounts are heading over the next weeks.
 *
 * Three ingredients, each the most defensible version of itself:
 *
 *  1. **Today's cash** is the bank's own printed running balance per account
 *     (`lastBalance`, the number the bank would tell you), caught up with
 *     whatever that account moved after the statement line that carried it —
 *     per account, because the current account's last balance can be from
 *     yesterday and the savings account's from three weeks ago, and catching
 *     both up from the older date would count a transfer between them twice.
 *  2. **Scheduled money** is what `engines/recurring.js` expects: the salary on
 *     the 1st, the rent on the 2nd, the pass, the subscriptions, the monthly ETF
 *     purchase. Each on its own date, at its typical amount.
 *  3. **Everything else** — groceries, coffee, the occasional dinner — is spread
 *     evenly across the days at the rate it has run at recently. Measured as the
 *     *median week* of the last thirteen, not the mean: one €900 laptop in the
 *     window would otherwise be forecast to happen again every three months.
 *     Irregular income (a refund, a sale) is deliberately left out: a forecast
 *     that counts on money it cannot schedule is the optimistic kind.
 *
 * The last thirty days are reconstructed backwards from today's figure, so the
 * chart shows where the balance has been as well as where it is going, and the
 * join between the two is one number rather than two models.
 *
 * With no printed balance anywhere (a fork whose bank does not print one), the
 * forecast is of the *change* from today, starting at zero, and says so.
 */
import { buildAccountResolver } from './accounts.js';
import { normalizeMerchantKey } from '../lib/merchant.js';
import { occurrences } from './recurring.js';

const DAY = 86400000;
const dayMs = (iso) => Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const round2 = (n) => Math.round(n * 100) / 100;
const shift = (iso, days) => isoOf(dayMs(iso) + days * DAY);

const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Today's cash across every account that prints a balance, and how fresh it is. */
export function currentCash(accounts, transactions, today) {
  const withBalance = (accounts || []).filter((a) => a.lastBalance != null && a.lastBalanceDate);
  if (!withBalance.length) return null;
  const keyOf = buildAccountResolver(transactions);
  const since = new Map(withBalance.map((a) => [a.id, a.lastBalanceDate]));
  let total = withBalance.reduce((sum, a) => sum + Number(a.lastBalance), 0);
  for (const tx of transactions) {
    if (tx.position) continue;
    const key = keyOf(tx);
    const from = since.get(key);
    const date = String(tx.date || '').slice(0, 10);
    if (from && date > from && date <= today) total += Number(tx.amount) || 0;
  }
  const dates = withBalance.map((a) => a.lastBalanceDate).sort();
  return { balance: round2(total), oldest: dates[0], newest: dates[dates.length - 1], accounts: withBalance.length };
}

/**
 * The everyday spending rate per day: the median week of non-scheduled
 * consumption over the last `weeks` weeks, divided by seven.
 */
export function everydayRate(transactions, series, today, weeks = 13) {
  const scheduled = new Set(series.filter((s) => s.direction === 'out').map((s) => s.key.slice(4)));
  const start = shift(today, -weeks * 7);
  const totals = new Array(weeks).fill(0);
  for (const tx of transactions) {
    const amount = Number(tx.amount) || 0;
    if (amount >= 0 || tx.investment || tx.internal || tx.position) continue;
    const date = String(tx.date || '').slice(0, 10);
    if (date < start || date >= today) continue;
    if (scheduled.has(normalizeMerchantKey(tx).key)) continue;
    const week = Math.floor((dayMs(date) - dayMs(start)) / (7 * DAY));
    if (week >= 0 && week < weeks) totals[week] += Math.abs(amount);
  }
  return round2(median(totals) / 7);
}

/**
 * @param transactions every movement (internal included — they cancel inside the
 *   cash total, and the reconstruction needs both legs)
 * @param spending the spending set the recurring series were read from
 */
export function forecastCash({ accounts, transactions, spending, series, today, days = 60, history = 30 }) {
  const cash = currentCash(accounts, transactions, today);
  const start = cash ? cash.balance : 0;
  const daily = everydayRate(spending, series, today);

  // Backwards from today: the balance at the end of each earlier day is the next
  // day's balance less what moved on it.
  const movedOn = new Map();
  for (const tx of transactions) {
    if (tx.position) continue;
    const date = String(tx.date || '').slice(0, 10);
    if (date > shift(today, -history) && date <= today) {
      movedOn.set(date, (movedOn.get(date) || 0) + (Number(tx.amount) || 0));
    }
  }
  const past = [];
  let running = start;
  for (let d = 0; d < history; d++) {
    const date = shift(today, -d);
    past.push({ date, actual: round2(running) });
    running -= movedOn.get(date) || 0;
  }
  past.reverse();

  const horizon = shift(today, days);
  const scheduled = occurrences(series, shift(today, 1), horizon);
  const byDate = new Map();
  for (const event of scheduled) {
    const list = byDate.get(event.date) || [];
    list.push(event);
    byDate.set(event.date, list);
  }

  const ahead = [];
  let balance = start;
  let low = { date: today, balance: start };
  let scheduledIn = 0;
  let scheduledOut = 0;
  for (let d = 1; d <= days; d++) {
    const date = shift(today, d);
    const events = byDate.get(date) || [];
    for (const event of events) {
      balance += event.amount;
      if (event.amount > 0) scheduledIn += event.amount;
      else scheduledOut += -event.amount;
    }
    balance -= daily;
    if (balance < low.balance) low = { date, balance };
    ahead.push({
      date,
      projected: round2(balance),
      events: events.map((e) => ({ name: e.name, amount: e.amount, overdue: e.overdue })),
    });
  }

  // The two series meet at today, so the projected line starts where the actual
  // one ends instead of floating a day to the right of it.
  const rows = [
    ...past.slice(0, -1),
    { ...past[past.length - 1], projected: round2(start), events: [] },
    ...ahead,
  ];

  return {
    today,
    relative: !cash,
    balance: cash,
    start: round2(start),
    end: round2(balance),
    low: { date: low.date, balance: round2(low.balance) },
    everydayPerDay: daily,
    scheduledIn: round2(scheduledIn),
    scheduledOut: round2(scheduledOut),
    rows,
  };
}
