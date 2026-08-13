import test from 'node:test';
import assert from 'node:assert/strict';

import { computeFlow, computeDailySpend } from './analytics.js';

/*
 * The invariant worth testing on a Sankey is conservation: every account node's
 * inflow equals its outflow once the residual is counted. A diagram whose bands
 * do not add up is not a rendering nit — it is a claim about where money went
 * that is false, on a screen whose whole job is answering that question.
 */
const tx = (id, date, amount, extra = {}) => ({ id, date, amount, ...extra });

const LEDGER = [
  tx('1', '2026-01-05', 2000, { merchant: 'Employer', account: 'Current' }),
  tx('2', '2026-01-06', -800, { merchant: 'Landlord', account: 'Current', category: 'housing' }),
  tx('3', '2026-01-07', -250, { merchant: 'Continente', account: 'Current', category: 'groceries' }),
  tx('4', '2026-01-08', -60, { merchant: 'EDP', account: 'Current', category: 'utilities' }),
  tx('5', '2026-01-09', 300, { merchant: 'Refund', account: 'Savings' }),
  tx('6', '2026-01-10', -500, { merchant: 'Garage', account: 'Savings', category: 'transport' }),
];

function balanceOf(flow, accountName) {
  const node = flow.nodes.findIndex((n) => n.name === accountName && n.kind === 'account');
  const into = flow.links.filter((l) => l.target === node).reduce((s, l) => s + l.value, 0);
  const out = flow.links.filter((l) => l.source === node).reduce((s, l) => s + l.value, 0);
  return { into, out };
}

test('every account node balances once the residual is counted', () => {
  const flow = computeFlow(LEDGER);
  for (const name of ['Current', 'Savings']) {
    const { into, out } = balanceOf(flow, name);
    assert.ok(Math.abs(into - out) < 0.01, `${name}: ${into} in, ${out} out`);
  }
});

test('a surplus terminates in its own node and a shortfall opens in one', () => {
  const flow = computeFlow(LEDGER);
  // Current takes 2000 and spends 1110, so 890 was not spent.
  const saved = flow.nodes.findIndex((n) => n.kind === 'residual' && n.name === 'saved');
  assert.ok(saved >= 0, 'a surplus needs somewhere to go');
  assert.equal(flow.links.find((l) => l.target === saved).value, 890);

  // Savings takes 300 and spends 500, so 200 came from somewhere earlier.
  const drawn = flow.nodes.findIndex((n) => n.kind === 'residual' && n.name === 'drawn');
  assert.ok(drawn >= 0, 'a shortfall needs somewhere to come from');
  assert.equal(flow.links.find((l) => l.source === drawn).value, 200);
});

test('the totals match what the dashboard would say', () => {
  const flow = computeFlow(LEDGER);
  assert.equal(flow.totals.income, 2300);
  assert.equal(flow.totals.expense, 1610);
});

test('a row with no account gets a named node rather than being dropped', () => {
  const flow = computeFlow([
    tx('a', '2026-02-01', 100, { merchant: 'Someone' }),
    tx('b', '2026-02-02', -40, { merchant: 'Shop', category: 'food' }),
  ]);
  // Dropping these would make the Sankey disagree with every other number on
  // the page, which is worse than an honest unlabelled band.
  assert.ok(flow.nodes.some((n) => n.kind === 'account' && n.name === 'unknown'));
  assert.equal(flow.totals.income, 100);
  assert.equal(flow.totals.expense, 40);
});

test('the tails fold into one bucket rather than a hairline each', () => {
  const many = [];
  for (let i = 0; i < 20; i += 1) {
    many.push(tx(`in${i}`, '2026-03-01', 1000 - i * 10, { merchant: `Payer ${i}`, account: 'Current' }));
    many.push(tx(`out${i}`, '2026-03-02', -(500 - i * 10), { merchant: 'x', account: 'Current', category: `cat${i}` }));
  }
  const flow = computeFlow(many, {}, { maxSources: 5, maxCategories: 4 });
  assert.equal(flow.nodes.filter((n) => n.kind === 'source').length, 5);
  assert.equal(flow.nodes.filter((n) => n.kind === 'category').length, 4);
  assert.ok(flow.nodes.some((n) => n.kind === 'source' && n.name === 'other'));
  // Folding must not lose money.
  assert.equal(flow.totals.income, many.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0));
});

test('an empty range is a valid empty diagram, not a crash', () => {
  const flow = computeFlow([]);
  assert.deepEqual(flow.nodes, []);
  assert.deepEqual(flow.links, []);
  assert.equal(flow.totals.income, 0);
});

test('the category overlay wins over the transaction’s own category', () => {
  const flow = computeFlow(
    [tx('1', '2026-01-01', -100, { account: 'Current', category: 'uncategorized' })],
    { 1: 'groceries' },
  );
  assert.ok(flow.nodes.some((n) => n.kind === 'category' && n.name === 'groceries'));
  assert.ok(!flow.nodes.some((n) => n.name === 'uncategorized'));
});

/* ---- daily spend ---------------------------------------------------------- */

test('daily spend buckets by day and ignores income', () => {
  const days = computeDailySpend(LEDGER);
  assert.deepEqual(days.map((d) => d.date), ['2026-01-06', '2026-01-07', '2026-01-08', '2026-01-10']);
  assert.equal(days[0].total, 800);
  assert.equal(days[0].count, 1);
  // A day with nothing spent is absent rather than a zero row: a year is mostly
  // empty days and the chart draws its own grid from the range.
  assert.ok(!days.some((d) => d.date === '2026-01-05'));
});

test('a day names its largest single line', () => {
  const days = computeDailySpend([
    tx('a', '2026-04-01', -12, { category: 'coffee' }),
    tx('b', '2026-04-01', -400, { category: 'rent' }),
    tx('c', '2026-04-01', -30, { category: 'food' }),
  ]);
  assert.equal(days[0].total, 442);
  assert.equal(days[0].count, 3);
  assert.equal(days[0].top, 'rent', 'so a hovered cell can say what made it dark');
});
