import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bucketKey,
  filterTransactions,
  computeMonthlyCashflow,
  computeCategoryTrend,
  computeTopMerchants,
  computeCumulativeBalance,
  computeSavingsRate,
  applyTransactionFilters,
} from './analytics.js';

const tx = (id, date, amount, category, merchant = '') => ({
  id,
  date,
  amount,
  category,
  merchant,
  description: merchant,
});

const sample = [
  tx('a', '2026-01-15', -100, 'food', 'CONTINENTE'),
  tx('b', '2026-01-20', 2000, 'income', 'VENCIMENTO'),
  tx('c', '2026-02-10', -250, 'food', 'CONTINENTE'),
  tx('d', '2026-02-11', -80, 'transport', 'GALP'),
  tx('e', '2026-05-01', -40, 'gaming', 'STEAM'),
];

test('bucketKey groups by month, quarter and year', () => {
  assert.equal(bucketKey('2026-03-14', 'month'), '2026-03');
  assert.equal(bucketKey('2026-03-14', 'quarter'), '2026-Q1');
  assert.equal(bucketKey('2026-11-02', 'quarter'), '2026-Q4');
  assert.equal(bucketKey('2026-03-14', 'year'), '2026');
  assert.equal(bucketKey('', 'month'), null);
});

test('filterTransactions honours the date range', () => {
  const list = filterTransactions(sample, { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(list.map((t) => t.id), ['c', 'd']);
});

test('filterTransactions honours the category filter', () => {
  const list = filterTransactions(sample, { categories: ['food'] });
  assert.deepEqual(list.map((t) => t.id), ['a', 'c']);
});

test('filterTransactions prefers the ledger category over the stored one', () => {
  // The projection's categoryMap is authoritative; tx.category is a snapshot.
  const list = filterTransactions(sample, { categories: ['shopping'], categoryMap: { a: 'shopping' } });
  assert.deepEqual(list.map((t) => t.id), ['a']);
});

test('cashflow separates income from expense per bucket', () => {
  const monthly = computeMonthlyCashflow(sample, 'month');
  const jan = monthly.find((m) => m.month === '2026-01');
  assert.equal(jan.income, 2000);
  assert.equal(jan.expense, 100);
  assert.equal(jan.net, 1900);
});

test('cashflow respects granularity', () => {
  const quarterly = computeMonthlyCashflow(sample, 'quarter');
  assert.deepEqual(quarterly.map((q) => q.month), ['2026-Q1', '2026-Q2']);
  assert.equal(quarterly[0].expense, 430);
});

test('category trend caps the series and folds the rest into one bucket', () => {
  const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((c, i) =>
    tx(c, '2026-01-0' + ((i % 9) + 1), -(10 + i), 'cat' + i)
  );
  const trend = computeCategoryTrend(many, {}, 'month', 3);
  assert.equal(trend.categories.length, 4);
  // A sentinel, not a word: the card that draws it names it in the reader's
  // language, so the engine must not ship a Portuguese label to a German screen.
  assert.equal(trend.categories[3], 'other');
});

test('category trend only counts expenses', () => {
  const trend = computeCategoryTrend(sample, {}, 'month');
  assert.ok(!trend.categories.includes('income'));
  assert.equal(trend.rows.find((r) => r.period === '2026-02').food, 250);
});

test('top merchants ranks by spend and ignores income', () => {
  const top = computeTopMerchants(sample);
  assert.equal(top[0].merchant, 'CONTINENTE');
  assert.equal(top[0].total, 350);
  assert.equal(top[0].count, 2);
  assert.ok(!top.some((m) => m.merchant === 'VENCIMENTO'));
});

test('cumulative balance carries the running total forward', () => {
  const cumulative = computeCumulativeBalance(computeMonthlyCashflow(sample, 'month'));
  assert.equal(cumulative[0].cumulative, 1900);
  assert.equal(cumulative[1].cumulative, 1570);
  assert.equal(cumulative[2].cumulative, 1530);
});

test('savings rate is null when a period has no income', () => {
  const rates = computeSavingsRate(computeMonthlyCashflow(sample, 'month'));
  assert.equal(rates[0].rate, 95);
  assert.equal(rates[1].rate, null, 'a month with no income has no rate, not a rate of 0');
});

test('a month with token income reports no rate rather than a spectacular one', () => {
  // €45 in, €379 out: mathematically -733%, but the denominator is noise.
  const rates = computeSavingsRate([{ month: '2021-07', income: 45, expense: 379, net: -334 }]);
  assert.equal(rates[0].rate, null);
  assert.equal(rates[0].trueRate, null);
});

test('an extreme but real month is drawn at the limit and reported truthfully', () => {
  const rates = computeSavingsRate([{ month: '2021-08', income: 300, expense: 1110, net: -810 }]);
  assert.equal(rates[0].rate, -100, 'the line is clamped so the chart stays legible');
  assert.equal(rates[0].trueRate, -270, 'the number itself is never altered');
  assert.equal(rates[0].clamped, true);
});

test('an ordinary month is left exactly alone', () => {
  const rates = computeSavingsRate([{ month: '2026-01', income: 2000, expense: 1500, net: 500 }]);
  assert.equal(rates[0].rate, 25);
  assert.equal(rates[0].trueRate, 25);
  assert.equal(rates[0].clamped, false);
});

test('income large in absolute terms is material even against heavy spending', () => {
  // 2623 in, 5361 out — a real month with a big purchase, not a data artifact.
  const rates = computeSavingsRate([{ month: '2025-10', income: 2623, expense: 5361, net: -2738 }]);
  assert.equal(rates[0].clamped, true);
  assert.ok(rates[0].trueRate < -100);
});

// --- transaction list filters ---

const listing = [
  { id: '1', date: '2026-05-20', description: 'CONTINENTE PORTO', merchant: 'CONTINENTE', amount: -12.4, category: 'food', status: 'categorized', tags: ['t1'], source: 'activobank' },
  { id: '2', date: '2026-06-02', description: 'CLAUDE.AI SUBSCRIPTION', merchant: 'CLAUDE', amount: -22.14, category: 'subscriptions', status: 'categorized', tags: [], source: 'activobank' },
  { id: '3', date: '2026-05-29', description: 'TRANSFERENCIA - VENCIMENTO', merchant: '', amount: 1566.16, category: 'income', status: 'categorized', tags: [], source: 'activobank' },
  { id: '4', date: '2026-07-01', description: 'COMISSAO BOLSA', merchant: '', amount: -3.69, category: 'uncategorized', status: 'pending', tags: [], source: 'activobank' },
];

test('applyTransactionFilters returns everything when nothing is set', () => {
  assert.equal(applyTransactionFilters(listing, {}).length, 4);
  assert.equal(applyTransactionFilters(listing, { status: 'all' }).length, 4);
});

test('applyTransactionFilters narrows by category', () => {
  const result = applyTransactionFilters(listing, { category: 'food' });
  assert.deepEqual(result.map((t) => t.id), ['1']);
});

// The combination that used to return an empty table with no explanation: a
// pending transaction has no category, so these two can never both hold.
test('applyTransactionFilters combines status and category faithfully', () => {
  assert.equal(applyTransactionFilters(listing, { status: 'pending', category: 'food' }).length, 0);
  assert.equal(applyTransactionFilters(listing, { status: 'all', category: 'food' }).length, 1);
});

test('applyTransactionFilters narrows by date range', () => {
  const result = applyTransactionFilters(listing, { startDate: '2026-05-25', endDate: '2026-06-30' });
  assert.deepEqual(result.map((t) => t.id).sort(), ['2', '3']);
});

test('applyTransactionFilters compares amounts by size, not sign', () => {
  const result = applyTransactionFilters(listing, { minAmount: '10', maxAmount: '30' });
  assert.deepEqual(result.map((t) => t.id).sort(), ['1', '2']);
});

test('applyTransactionFilters separates debits from credits', () => {
  assert.deepEqual(applyTransactionFilters(listing, { direction: 'credit' }).map((t) => t.id), ['3']);
  assert.equal(applyTransactionFilters(listing, { direction: 'debit' }).length, 3);
});

test('applyTransactionFilters narrows by tag and search', () => {
  assert.deepEqual(applyTransactionFilters(listing, { tag: 't1' }).map((t) => t.id), ['1']);
  assert.deepEqual(applyTransactionFilters(listing, { search: 'claude' }).map((t) => t.id), ['2']);
});

// ---------- recurring commitments ----------

import {
  computeCategoryShifts,
  detectRecurringSubscriptions,
  projectCurrentMonth,
} from './analytics.js';

const spend = (id, date, description, amount) => ({ id, date, description, amount, category: 'x' });

/**
 * The bug this guards: three washing machines run on one afternoon are three
 * charges of a similar amount, which the old rule read as a subscription.
 */
test('several charges on one day are not a subscription', () => {
  const launderette = [
    spend('a', '2025-10-14', 'COMPRA 0412 WASHTUR SAO DOMINGO DPT', -3),
    spend('b', '2025-10-14', 'COMPRA 0412 WASHTUR SAO DOMINGO DPT', -3),
    spend('c', '2025-10-14', 'COMPRA 0412 WASHTUR SAO DOMINGO DPT', -2),
    spend('d', '2025-10-09', 'COMPRA 0412 WASHTUR SAO DOMINGO DPT', -3),
  ];
  assert.deepEqual(detectRecurringSubscriptions(launderette), []);
});

test('a monthly charge across several months is a subscription', () => {
  const spotify = [
    spend('a', '2025-10-08', 'COMPRA 0412 Spotify Stockholm SE', -4.99),
    spend('b', '2025-11-08', 'COMPRA 0412 Spotify Stockholm SE', -4.99),
    spend('c', '2025-12-08', 'COMPRA 0412 Spotify Stockholm SE', -4.99),
  ];
  const [sub] = detectRecurringSubscriptions(spotify);
  assert.equal(sub.count, 3);
  assert.equal(sub.cadence, 'mensal');
  assert.equal(sub.avgAmount, 4.99);
});

test('a charge that stops for half a year is not a standing commitment', () => {
  const sporadic = [
    spend('a', '2025-01-08', 'COMPRA 0412 QUALQUER COISA', -10),
    spend('b', '2025-02-08', 'COMPRA 0412 QUALQUER COISA', -10),
    spend('c', '2025-11-08', 'COMPRA 0412 QUALQUER COISA', -10),
  ];
  assert.deepEqual(detectRecurringSubscriptions(sporadic), []);
});

test('category shifts report euros and name what drove them', () => {
  const [top] = computeCategoryShifts(
    [spend('a', '2025-10-17', 'PcComponentes', -1349.25)],
    [spend('b', '2025-09-17', 'Uma coisa pequena', -49.25)],
    {}
  );
  assert.equal(top.category, 'x');
  assert.equal(top.delta, 1300);
  assert.equal(top.driver.description, 'PcComponentes');
});

test('the running month is projected from the pace so far', () => {
  const projection = projectCurrentMonth(
    [{ month: '2026-08', income: 0, expense: 200, net: -200, count: 4 }],
    new Date('2026-08-10T12:00:00Z')
  );
  assert.equal(projection.dayOfMonth, 10);
  assert.equal(projection.daysInMonth, 31);
  assert.equal(projection.projectedExpense, 620);
});

test('a finished month is not projected', () => {
  assert.equal(
    projectCurrentMonth([{ month: '2026-07', expense: 200 }], new Date('2026-08-10T12:00:00Z')),
    null
  );
});
