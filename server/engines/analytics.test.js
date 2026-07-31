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

test('category trend caps the series and folds the rest into Outros', () => {
  const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((c, i) =>
    tx(c, '2026-01-0' + ((i % 9) + 1), -(10 + i), 'cat' + i)
  );
  const trend = computeCategoryTrend(many, {}, 'month', 3);
  assert.equal(trend.categories.length, 4);
  assert.equal(trend.categories[3], 'Outros');
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
