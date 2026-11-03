/**
 * The tools the assistant may call.
 *
 * The chat is grounded the way the hosted assistants are: the model never sees
 * the ledger, it sees a catalogue of read-only functions and asks for the
 * figures it needs, one call at a time, and the answer is written from what came
 * back. Every tool here is a thin wrapper over an engine that already serves a
 * screen — the same `computeMonthlyCashflow`, `detectRecurring`, `forecastCash`
 * the dashboard draws — so a number the assistant quotes is a number a card
 * somewhere already shows. There is no second arithmetic to drift.
 *
 * Three rules, and `tools.test.js` holds them:
 *
 *  - **Read-only.** Nothing here writes an event, a setting or a file. The
 *    assistant can explain a categorisation; it cannot change one. A model that
 *    could act on the ledger would turn a hallucinated "I moved that to food"
 *    into a real one.
 *  - **Compact.** A local model has a small context window and every token of
 *    tool output displaces reasoning. Rows are capped, money is rounded to
 *    cents, and nothing the model did not ask for is returned.
 *  - **Honest about ranges.** Every result echoes the span it was computed over,
 *    so "you spent €812 on food" can always be qualified with "between the 1st
 *    and the 31st". A figure without its period is how a quarter gets quoted as
 *    a month.
 *
 * The parameter schemas are plain JSON Schema, which is what Ollama (and the
 * OpenAI-shaped function-calling it mirrors) expects verbatim.
 */
import {
  computeMonthlyCashflow,
  computeCategoryBreakdown,
  computeCategoryShifts,
  computeTopMerchants,
  computeSavingsRate,
  computePace,
  typicalMonth,
  filterTransactions,
  applyTransactionFilters,
  splitFlows,
  priorSpan,
  projectCurrentMonth,
} from '../analytics.js';
import { detectRecurring, occurrences, loadRecurringState } from '../recurring.js';
import { forecastCash } from '../forecast.js';
import { budgetReport, loadGoals } from '../budgets.js';
import { computeNetWorth } from '../netWorth.js';
import { tripSpending, travelOverlay, loadTravels } from '../travel.js';
import { getCategories } from '../categorization.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const dateOf = (tx) => String(tx.date || '').slice(0, 10);

/** Rows a tool may return at most. The model asked a question, not for a dump. */
const MAX_ROWS = 40;

function addDays(iso, days) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

function monthBounds(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;

/**
 * The span a tool works over.
 *
 * A `month` wins over `from`/`to`; a missing bound defaults to the last ninety
 * days ending today, which is the range the dashboard opens on. The resolved
 * span is returned alongside every result so the model can cite it.
 */
export function resolveRange(args = {}, today) {
  if (ISO_MONTH.test(String(args.month || ''))) return { ...monthBounds(args.month), label: args.month };
  const to = ISO_DATE.test(String(args.to || '')) ? args.to : today;
  const from = ISO_DATE.test(String(args.from || '')) ? args.from : addDays(to, -89);
  return from <= to ? { from, to, label: `${from}..${to}` } : { from: to, to: from, label: `${to}..${from}` };
}

const RANGE_PARAMS = {
  from: { type: 'string', description: 'Start date, YYYY-MM-DD (inclusive).' },
  to: { type: 'string', description: 'End date, YYYY-MM-DD (inclusive).' },
  month: { type: 'string', description: 'A whole calendar month, YYYY-MM. Overrides from/to.' },
};

/** Spending rows inside a span, with the trip overlay folded in like the dashboard. */
function spendingIn(ctx, range) {
  const rows = filterTransactions(ctx.projections.spendingTransactions, {
    from: range.from,
    to: range.to,
    categoryMap: ctx.categoryMap,
  });
  return { rows, consumption: splitFlows(rows).consumption };
}

function categoryOf(ctx, tx) {
  return ctx.categoryMap[tx.id] || tx.category || 'uncategorized';
}

function compactTx(ctx, tx) {
  return {
    date: dateOf(tx),
    description: (tx.merchant || tx.description || '').slice(0, 60),
    amount: round2(tx.amount),
    currency: tx.currency || 'EUR',
    category: categoryOf(ctx, tx),
    ...(tx.investment ? { investment: true } : {}),
    ...(tx.account ? { account: tx.account } : {}),
  };
}

export const TOOLS = [
  {
    name: 'period_overview',
    description:
      'Income, spending, investing and what was kept over a period, compared with the period just before it, with the biggest category movements and the current month projected to its end. Start here for "how am I doing" and "why is this month expensive".',
    parameters: { type: 'object', properties: RANGE_PARAMS },
    run(args, ctx) {
      const range = resolveRange(args, ctx.today);
      const { rows, consumption } = spendingIn(ctx, range);
      const cashflow = computeMonthlyCashflow(rows, 'month');
      const totals = cashflow.reduce(
        (acc, m) => ({
          income: acc.income + m.income,
          expense: acc.expense + m.expense,
          invested: acc.invested + m.invested,
        }),
        { income: 0, expense: 0, invested: 0 },
      );
      const { priorFrom, priorTo } = priorSpan(range.from, range.to);
      const prior = spendingIn(ctx, { from: priorFrom, to: priorTo });
      const priorTotals = computeMonthlyCashflow(prior.rows, 'month').reduce(
        (acc, m) => ({ income: acc.income + m.income, expense: acc.expense + m.expense }),
        { income: 0, expense: 0 },
      );
      const breakdown = computeCategoryBreakdown(consumption, ctx.categoryMap)
        .filter((c) => c.expense > 0)
        .sort((a, b) => b.expense - a.expense)
        .slice(0, 8)
        .map((c) => ({
          category: c.category,
          spent: round2(c.expense),
          share: totals.expense ? round2((c.expense / totals.expense) * 100) : 0,
          transactions: c.count,
        }));
      const shifts = computeCategoryShifts(consumption, prior.consumption, ctx.categoryMap, 5);
      const projection = projectCurrentMonth(cashflow, new Date(`${ctx.today}T12:00:00Z`));
      return {
        period: range,
        currency: ctx.currency,
        income: round2(totals.income),
        spent: round2(totals.expense),
        invested: round2(totals.invested),
        kept: round2(totals.income - totals.expense - totals.invested),
        savingsRate: totals.income > 0 ? round2(((totals.income - totals.expense) / totals.income) * 100) : null,
        previousPeriod: {
          from: priorFrom,
          to: priorTo,
          income: round2(priorTotals.income),
          spent: round2(priorTotals.expense),
        },
        topCategories: breakdown,
        biggestChanges: shifts.map((s) => ({
          category: s.category,
          now: s.current,
          before: s.previous,
          change: s.delta,
          biggestItem: s.driver ? { ...s.driver, amount: round2(s.driver.amount) } : null,
        })),
        currentMonthProjection: projection,
        note: 'Transfers between your own accounts are excluded. Investing is kept apart from spending.',
      };
    },
  },
  {
    name: 'spending_by_category',
    description:
      'What was spent in each category over a period, with share of the total and the change against the period before. Optionally only one category, with its biggest items.',
    parameters: {
      type: 'object',
      properties: {
        ...RANGE_PARAMS,
        category: { type: 'string', description: 'Only this category id (as listed in the system prompt).' },
      },
    },
    run(args, ctx) {
      const range = resolveRange(args, ctx.today);
      const { consumption } = spendingIn(ctx, range);
      const { priorFrom, priorTo } = priorSpan(range.from, range.to);
      const prior = spendingIn(ctx, { from: priorFrom, to: priorTo }).consumption;
      const before = new Map();
      for (const tx of prior) {
        if (tx.amount >= 0) continue;
        const c = categoryOf(ctx, tx);
        before.set(c, (before.get(c) || 0) + Math.abs(tx.amount));
      }
      const breakdown = computeCategoryBreakdown(consumption, ctx.categoryMap).filter((c) => c.expense > 0);
      const total = breakdown.reduce((s, c) => s + c.expense, 0);
      let rows = breakdown
        .sort((a, b) => b.expense - a.expense)
        .map((c) => ({
          category: c.category,
          spent: round2(c.expense),
          share: total ? round2((c.expense / total) * 100) : 0,
          transactions: c.count,
          previousPeriod: round2(before.get(c.category) || 0),
          refunds: round2(c.income),
        }));
      const result = { period: range, currency: ctx.currency, totalSpent: round2(total), categories: rows };
      if (args.category) {
        rows = rows.filter((r) => r.category === args.category);
        result.categories = rows;
        result.biggestItems = consumption
          .filter((tx) => tx.amount < 0 && categoryOf(ctx, tx) === args.category)
          .sort((a, b) => a.amount - b.amount)
          .slice(0, 10)
          .map((tx) => compactTx(ctx, tx));
        if (!rows.length) result.note = `No spending in "${args.category}" over this period.`;
      }
      return result;
    },
  },
  {
    name: 'monthly_trend',
    description:
      'Income, spending, investing, net and savings rate per month, for the last N months. Use for trends, "is my spending going up", and comparing months.',
    parameters: {
      type: 'object',
      properties: {
        months: { type: 'integer', description: 'How many months back from today (default 12, max 36).' },
        category: { type: 'string', description: 'Only count spending in this category id.' },
      },
    },
    run(args, ctx) {
      const months = Math.min(Math.max(Number(args.months) || 12, 1), 36);
      const [y, m] = ctx.today.slice(0, 7).split('-').map(Number);
      const start = y * 12 + (m - 1) - (months - 1);
      const from = `${Math.floor(start / 12)}-${String((start % 12) + 1).padStart(2, '0')}-01`;
      let { rows } = spendingIn(ctx, { from, to: ctx.today });
      if (args.category) rows = rows.filter((tx) => categoryOf(ctx, tx) === args.category);
      const cashflow = computeMonthlyCashflow(rows, 'month', { from, to: ctx.today });
      const rates = computeSavingsRate(cashflow);
      return {
        currency: ctx.currency,
        category: args.category || null,
        months: cashflow.map((row, i) => ({
          month: row.month,
          income: round2(row.income),
          spent: round2(row.expense),
          invested: round2(row.invested),
          net: round2(row.net),
          savingsRate: rates[i]?.trueRate ?? null,
          ...(row.month === ctx.today.slice(0, 7) ? { partial: true } : {}),
        })),
      };
    },
  },
  {
    name: 'top_merchants',
    description: 'Where the money went, by merchant, over a period. Optionally restricted to one category.',
    parameters: {
      type: 'object',
      properties: {
        ...RANGE_PARAMS,
        category: { type: 'string', description: 'Only this category id.' },
        limit: { type: 'integer', description: 'How many merchants (default 10, max 25).' },
      },
    },
    run(args, ctx) {
      const range = resolveRange(args, ctx.today);
      let { consumption } = spendingIn(ctx, range);
      if (args.category) consumption = consumption.filter((tx) => categoryOf(ctx, tx) === args.category);
      const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 25);
      return {
        period: range,
        currency: ctx.currency,
        merchants: computeTopMerchants(consumption, limit).map((m) => ({
          merchant: m.merchant,
          spent: round2(m.total),
          transactions: m.count,
          average: round2(m.total / m.count),
        })),
      };
    },
  },
  {
    name: 'search_transactions',
    description:
      'Find individual movements: by text in the description, category, amount range, direction and dates. Returns the matches, newest first, capped. Use when asked about a specific purchase, merchant or "what was that charge".',
    parameters: {
      type: 'object',
      properties: {
        ...RANGE_PARAMS,
        text: { type: 'string', description: 'Text to look for in the description or merchant (case-insensitive).' },
        category: { type: 'string', description: 'Category id.' },
        minAmount: { type: 'number', description: 'Minimum absolute amount.' },
        maxAmount: { type: 'number', description: 'Maximum absolute amount.' },
        direction: { type: 'string', enum: ['debit', 'credit'], description: 'Money out or money in.' },
        limit: { type: 'integer', description: 'Max rows (default 20, max 40).' },
      },
    },
    run(args, ctx) {
      const range = resolveRange(args, ctx.today);
      const limit = Math.min(Math.max(Number(args.limit) || 20, 1), MAX_ROWS);
      const list = applyTransactionFilters(ctx.projections.transactions, {
        search: args.text,
        startDate: range.from,
        endDate: range.to,
        minAmount: args.minAmount,
        maxAmount: args.maxAmount,
        direction: args.direction,
      })
        .filter((tx) => !args.category || categoryOf(ctx, tx) === args.category)
        .sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
      const sum = list.reduce((s, tx) => s + (Number(tx.amount) || 0), 0);
      return {
        period: range,
        currency: ctx.currency,
        matches: list.length,
        sumOfMatches: round2(sum),
        shown: Math.min(limit, list.length),
        transactions: list.slice(0, limit).map((tx) => compactTx(ctx, tx)),
      };
    },
  },
  {
    name: 'recurring_bills',
    description:
      'The subscriptions, bills and regular income inferred from the history: cadence, typical amount, next expected date, monthly cost; plus what is due in the next weeks.',
    parameters: {
      type: 'object',
      properties: { days: { type: 'integer', description: 'Horizon for upcoming items in days (default 35).' } },
    },
    run(args, ctx) {
      const days = Math.min(Math.max(Number(args.days) || 35, 1), 366);
      const series = ctx.recurring();
      const horizon = addDays(ctx.today, days);
      return {
        currency: ctx.currency,
        monthlyOut: round2(-series.filter((s) => s.amount < 0).reduce((s, r) => s + r.monthly, 0)),
        monthlyIn: round2(series.filter((s) => s.amount > 0).reduce((s, r) => s + r.monthly, 0)),
        series: series.slice(0, MAX_ROWS).map((s) => ({
          name: s.name,
          category: s.category,
          cadence: s.cadence,
          amount: s.amount,
          monthly: s.monthly,
          nextDate: s.nextDate,
          lastDate: s.lastDate,
          occurrences: s.count,
          ...(s.overdue ? { overdue: true } : {}),
          ...(s.variable ? { variable: true } : {}),
        })),
        upcoming: occurrences(series, ctx.today, horizon)
          .slice(0, MAX_ROWS)
          .map((o) => ({ date: o.date, name: o.name, amount: o.amount })),
      };
    },
  },
  {
    name: 'cash_forecast',
    description:
      'Projected cash balance over the next days: starts from the accounts\' latest printed balances, adds the recurring bills and income on their dates and the usual everyday spending. Reports the lowest point.',
    parameters: {
      type: 'object',
      properties: { days: { type: 'integer', description: 'Days ahead (default 60, max 365).' } },
    },
    run(args, ctx) {
      const days = Math.min(Math.max(Number(args.days) || 60, 7), 365);
      const f = forecastCash({
        accounts: ctx.projections.accounts,
        transactions: ctx.projections.transactions,
        spending: ctx.projections.spendingTransactions,
        series: ctx.recurring(),
        today: ctx.today,
        days,
      });
      // Weekly samples rather than every day: the shape, not the noise.
      const samples = (f.rows || []).filter((_, i, arr) => i % 7 === 0 || i === arr.length - 1);
      return {
        currency: ctx.currency,
        today: f.today,
        balanceToday: f.balance,
        relativeOnly: !!f.relative,
        endBalance: f.end,
        lowestPoint: f.low,
        everydaySpendingPerDay: f.everydayPerDay,
        scheduledIn: f.scheduledIn,
        scheduledOut: f.scheduledOut,
        samples: samples.map((r) => ({ date: r.date, balance: round2(r.projected ?? r.actual) })),
      };
    },
  },
  {
    name: 'budget_goals',
    description:
      'Monthly goals per category and how the month stands against each: spent, expected by today, projected, status (ok / atRisk / over). Also the suggested goal per category from its usual month.',
    parameters: {
      type: 'object',
      properties: { month: { type: 'string', description: 'YYYY-MM (default: the current month).' } },
    },
    run(args, ctx) {
      const month = ISO_MONTH.test(String(args.month || '')) ? args.month : ctx.today.slice(0, 7);
      const report = budgetReport(ctx.projections.spendingTransactions, getCategories(), loadGoals(), {
        month,
        today: ctx.today,
        series: ctx.recurring(),
      });
      return {
        currency: ctx.currency,
        month: report.month,
        dayOfMonth: report.day,
        daysInMonth: report.daysInMonth,
        totals: report.totals,
        goals: report.rows.map((r) => ({
          category: r.category,
          goal: r.goal,
          spent: r.spent,
          expectedByToday: r.expected,
          projected: r.projected,
          status: r.status,
          monthsWithinGoal: `${r.hits}/${r.history.length}`,
        })),
        suggestedGoals: report.suggestions,
        note: report.rows.length ? undefined : 'No goals set yet; suggestedGoals are the median month per category.',
      };
    },
  },
  {
    name: 'net_worth',
    description:
      'What there is, as opposed to what moved: every account with its latest balance, the savings vaults, and the holdings by class. Components carry their own currency; do not add different currencies together.',
    parameters: { type: 'object', properties: {} },
    run(args, ctx) {
      const nw = computeNetWorth(ctx.projections, ctx.settings, ctx.currency);
      return {
        baseCurrency: ctx.currency,
        components: nw.components.map((c) => ({
          id: c.id,
          kind: c.kind,
          value: c.value,
          currency: c.currency,
          ...(c.included === false ? { excludedFromTotal: true } : {}),
        })),
        accounts: (ctx.projections.accounts || []).map((a) => ({
          name: a.name,
          kind: a.kind,
          balance: a.lastBalance,
          asOf: a.lastBalanceDate,
        })),
        vaults: (ctx.projections.vaults || []).slice(0, 20).map((v) => ({
          name: v.name,
          balance: round2(v.balance),
        })),
        vaultTotal: round2(ctx.projections.vaultTotal),
      };
    },
  },
  {
    name: 'trips',
    description: 'Each trip with what it cost, how many days, and its spending by category.',
    parameters: { type: 'object', properties: RANGE_PARAMS },
    run(args, ctx) {
      const hasRange = args.from || args.to || args.month;
      const range = hasRange ? resolveRange(args, ctx.today) : null;
      const rows = range
        ? filterTransactions(ctx.projections.spendingTransactions, { from: range.from, to: range.to })
        : ctx.projections.spendingTransactions;
      const trips = tripSpending(rows, ctx.projections.categoryMap, ctx.travels);
      return {
        period: range || 'all',
        currency: ctx.currency,
        trips: trips.slice(0, MAX_ROWS).map((t) => ({
          name: t.name,
          country: t.country,
          from: t.startDate,
          to: t.endDate,
          days: t.days,
          total: t.total,
          perDay: t.days ? round2(t.total / t.days) : null,
          categories: t.categories.slice(0, 6),
        })),
      };
    },
  },
  {
    name: 'month_pace',
    description:
      'How the current (or a given) month is running day by day against the previous month and the typical month at the same day. The honest way to compare an unfinished month.',
    parameters: {
      type: 'object',
      properties: { month: { type: 'string', description: 'YYYY-MM (default: the current month).' } },
    },
    run(args, ctx) {
      const month = ISO_MONTH.test(String(args.month || '')) ? args.month : ctx.today.slice(0, 7);
      const dates = ctx.projections.spendingTransactions.map(dateOf).filter(Boolean).sort();
      const pace = computePace(splitFlows(ctx.projections.spendingTransactions).consumption, month, {
        today: ctx.today,
        earliest: dates[0] || null,
      });
      if (!pace) return { error: 'Invalid month.' };
      return {
        currency: ctx.currency,
        month: pace.month,
        previousMonth: pace.previousMonth,
        dayOfMonth: pace.day,
        monthsInTypical: pace.monthsInTypical,
        atSameDay: pace.atDay,
        endOfMonth: pace.rows[pace.rows.length - 1],
      };
    },
  },
  {
    name: 'typical_month',
    description:
      'The typical month over the last twelve complete ones (mean and median spending, mean income and investing), plus the planning assumptions used for runway and independence figures.',
    parameters: { type: 'object', properties: {} },
    run(args, ctx) {
      return {
        currency: ctx.currency,
        ...typicalMonth(ctx.projections.spendingTransactions, { today: ctx.today }),
        planning: ctx.settings.planning || null,
      };
    },
  },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** The catalogue in the wire shape Ollama's `tools` field takes. */
export function toolDefinitions() {
  return TOOLS.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/**
 * Everything a tool needs, built once per chat turn.
 *
 * Recurring detection is the one expensive engine three tools share, so it is
 * memoised here rather than re-run per call.
 */
export function buildToolContext({ projections, settings, today = new Date().toISOString().slice(0, 10) }) {
  const travels = loadTravels();
  const overlay = settings.analytics?.travelOverlay !== false;
  let recurringCache = null;
  return {
    projections,
    settings,
    today,
    travels,
    currency: settings.currency?.base || 'EUR',
    categoryMap: overlay ? travelOverlay(projections.transactions, projections.categoryMap, travels) : projections.categoryMap,
    categories: getCategories(),
    recurring() {
      if (!recurringCache) {
        const { ignored } = loadRecurringState();
        recurringCache = detectRecurring(projections.spendingTransactions, { today, ignored });
      }
      return recurringCache;
    },
  };
}

/**
 * Run one tool call. Never throws: a model that invents a tool name or passes
 * a string where a number goes gets an `error` field back and can try again,
 * which is what the hosted assistants do too.
 */
export function runTool(name, args, ctx) {
  const tool = BY_NAME.get(name);
  if (!tool) return { error: `Unknown tool "${name}". Available: ${TOOLS.map((t) => t.name).join(', ')}.` };
  let parsed = args;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = {};
    }
  }
  try {
    return tool.run(parsed && typeof parsed === 'object' ? parsed : {}, ctx);
  } catch (err) {
    return { error: `Tool "${name}" failed: ${err.message}` };
  }
}
