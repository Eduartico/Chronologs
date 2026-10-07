import test from 'node:test';
import assert from 'node:assert/strict';

import { investmentReason, compileCounterparties, DEFAULT_COUNTERPARTIES } from './investing.js';
import {
  computeMonthlyCashflow,
  computeFlow,
  computeDailySpend,
  computeSavingsRate,
  splitFlows,
} from './analytics.js';

const tx = (id, date, amount, extra = {}) => ({ id, date, amount, ...extra });

const ctx = (overrides = {}) => ({
  investmentCategories: new Set(['investments']),
  matchCounterparty: compileCounterparties(null),
  positionIds: new Set(),
  ...overrides,
});

test('each reason is reported, most certain first', () => {
  const linked = tx('a', '2026-09-03', -500, {
    description: 'COMPRA BOLSA OP.390545877 DE ISH CORE MSCI W',
    links: [{ linkId: 'security-order-1-a', transactionIds: ['a'] }],
  });
  assert.equal(investmentReason(linked, ctx()), 'link');

  const order = tx('b', '2026-09-03', -500, { description: 'COMPRA BOLSA OP.390545877 DE ISH CORE MSCI W' });
  assert.equal(investmentReason(order, ctx()), 'order');

  const fee = tx('c', '2026-09-03', -2.5, { description: 'Comissão de Serviço de Bolsa' });
  assert.equal(investmentReason(fee, ctx()), 'order');

  const filed = tx('d', '2026-09-03', -100, { description: 'TRF P/ CORRETORA', category: 'investments' });
  assert.equal(investmentReason(filed, ctx()), 'category');

  // Filed under gaming years ago; the counterparty still gives it away.
  const deposit = tx('e', '2026-09-03', -120, { description: 'COMPRA 3987 CSFLOAT.COM WILMINGTON US', category: 'gaming' });
  assert.equal(investmentReason(deposit, ctx()), 'counterparty');

  const groceries = tx('f', '2026-09-03', -40, { description: 'COMPRA 3987 CONTINENTE PORTO', category: 'food' });
  assert.equal(investmentReason(groceries, ctx()), null);
});

test('a game bought on Steam is spending, not investing', () => {
  const game = tx('g', '2026-09-03', -59.99, { description: 'COMPRA 3987 STEAMGAMES.COM 4259522 WA', category: 'gaming' });
  assert.equal(investmentReason(game, ctx()), null);
  assert.equal(DEFAULT_COUNTERPARTIES.some((p) => p.includes('steam')), false);
});

test('a bank debit paired with a marketplace trade is the cash leg of an investment', () => {
  const debit = tx('bank', '2026-09-03', -84.3, {
    links: [{ linkId: 'link-1', transactionIds: ['bank', 'trade-1'] }],
  });
  assert.equal(investmentReason(debit, ctx({ positionIds: new Set(['trade-1']) })), 'link');
  // The same link to an ordinary bank row says nothing about investing.
  assert.equal(investmentReason(debit, ctx()), null);
});

test('the counterparty list can be replaced', () => {
  const match = compileCounterparties(['my broker']);
  assert.equal(match({ description: 'TRF P/ MY BROKER LDA' }), 'my broker');
  assert.equal(match({ description: 'COMPRA CSFLOAT' }), null);
});

/* ---- the aggregates ---- */

const SEPTEMBER = [
  tx('salary', '2026-09-01', 2000),
  tx('rent', '2026-09-02', -700, { category: 'housing' }),
  tx('etf', '2026-09-03', -500, { category: 'investments', investment: 'order' }),
  tx('skins', '2026-09-10', -120, { category: 'gaming', investment: 'counterparty' }),
  tx('sold', '2026-09-20', 200, { category: 'investments', investment: 'counterparty' }),
  tx('food', '2026-09-21', -80, { category: 'food' }),
];

test('investing is its own column, neither income nor spending', () => {
  const [row] = computeMonthlyCashflow(SEPTEMBER);
  assert.equal(row.income, 2000);
  assert.equal(row.expense, 780);
  // Bought 620, sold 200: 420 went into investments, net.
  assert.equal(row.invested, 420);
  // The cash the month added to the accounts is unchanged by the split.
  assert.equal(row.net, 2000 + 200 - 700 - 500 - 120 - 80);
});

test('the savings rate counts investing as saving', () => {
  const [rate] = computeSavingsRate(computeMonthlyCashflow(SEPTEMBER));
  // (2000 - 780) / 2000
  assert.equal(rate.rate, 61);
});

test('the calendar and the spending split leave investing out', () => {
  const days = computeDailySpend(SEPTEMBER);
  assert.deepEqual(days.map((d) => d.date), ['2026-09-02', '2026-09-21']);
  const { consumption, investing } = splitFlows(SEPTEMBER);
  assert.equal(consumption.length, 3);
  assert.equal(investing.length, 3);
});

test('the money flow sends investing to its own node and still balances', () => {
  const flow = computeFlow(SEPTEMBER.map((t) => ({ ...t, account: 'Current' })));
  const names = flow.nodes.map((n) => `${n.kind}:${n.name}`);
  assert.ok(names.includes('residual:invested'));
  assert.ok(names.includes('residual:divested'));
  // Neither investing category became a spending category node.
  assert.equal(names.includes('category:investments'), false);
  assert.equal(flow.totals.income, 2000);
  assert.equal(flow.totals.expense, 780);
  assert.equal(flow.totals.invested, 420);

  const account = flow.nodes.findIndex((n) => n.kind === 'account');
  const into = flow.links.filter((l) => l.target === account).reduce((s, l) => s + l.value, 0);
  const out = flow.links.filter((l) => l.source === account).reduce((s, l) => s + l.value, 0);
  assert.ok(Math.abs(into - out) < 0.01, `${into} in, ${out} out`);
});
