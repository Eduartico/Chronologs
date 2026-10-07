import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const DATA_DIR = mkdtempSync(join(tmpdir(), 'chronologs-budgets-'));
mkdirSync(join(DATA_DIR, 'state'), { recursive: true });
process.env.CHRONOLOGS_DATA_DIR = DATA_DIR;

const { budgetReport, setGoal, loadGoals } = await import('./budgets.js');
const { detectRecurring } = await import('./recurring.js');

let n = 0;
const tx = (date, amount, category, extra = {}) => ({ id: `t${++n}`, date, amount, category, ...extra });
const CATEGORIES = [
  { id: 'food', name: 'food' },
  { id: 'transport', name: 'transport' },
  { id: 'travel', name: 'travel', derived: true },
];

// Six months of food around €400, and October so far.
const LEDGER = [];
for (const [month, total] of [['2026-04', 380], ['2026-05', 420], ['2026-06', 390], ['2026-07', 900], ['2026-08', 410], ['2026-09', 400]]) {
  LEDGER.push(tx(`${month}-10`, -total, 'food'));
}
LEDGER.push(tx('2026-10-03', -150, 'food'));
LEDGER.push(tx('2026-10-05', -20, 'food'));
// A refund comes off the month.
LEDGER.push(tx('2026-10-06', 10, 'food'));
// Investing never counts against a goal.
LEDGER.push(tx('2026-10-06', -300, 'food', { investment: 'counterparty' }));
LEDGER.push(tx('2026-10-02', -60, 'transport'));

test('a goal reports spent, the pace it should be at, and where the month is heading', () => {
  const report = budgetReport(LEDGER, CATEGORIES, { food: 400 }, { month: '2026-10', today: '2026-10-07' });
  const food = report.rows[0];
  assert.equal(food.spent, 160);
  assert.equal(food.expected, Math.round(400 * (7 / 31) * 100) / 100);
  // 160 in 7 days runs to ~708 over 31, past 400: at risk, not yet over.
  assert.equal(food.status, 'atRisk');
  assert.equal(food.remaining, 240);
  // Six earlier months: April, June and September within €400; May and August
  // just past it, July far past it.
  assert.equal(food.history.length, 6);
  assert.equal(food.hits, 3);
});

test('a finished month is judged on its total', () => {
  const report = budgetReport(LEDGER, CATEGORIES, { food: 400 }, { month: '2026-07', today: '2026-10-07' });
  assert.equal(report.rows[0].status, 'over');
  assert.equal(report.current, false);
});

test('the suggested goal is the usual month, never a computed category', () => {
  const report = budgetReport(LEDGER, CATEGORIES, {}, { month: '2026-10', today: '2026-10-07' });
  // Median of 380, 390, 400, 410, 420, 900 is 405, rounded up to the next ten.
  assert.equal(report.suggestions.food, 410);
  assert.equal('travel' in report.suggestions, false);
});

test('goals are kept by category id, and zero or blank removes one', () => {
  setGoal('food', 400);
  setGoal('transport', '45.5');
  assert.deepEqual(loadGoals(), { food: 400, transport: 45.5 });
  setGoal('transport', '');
  setGoal('food', 0);
  assert.deepEqual(loadGoals(), {});
});

test('a bill paid early in the month is not extrapolated as if it repeated', () => {
  const pass = ['2026-06-02', '2026-07-02', '2026-08-03', '2026-09-02', '2026-10-02'].map((d) =>
    tx(d, -40, 'transport', { description: 'COMPRA 0412 METRO DO PORTO ANDANTE' }),
  );
  const ledger = [...pass, tx('2026-10-04', -6, 'transport', { description: 'COMPRA 0412 BOLT' })];
  const series = detectRecurring(ledger, { today: '2026-10-07' });
  const plain = budgetReport(ledger, CATEGORIES, { transport: 70 }, { month: '2026-10', today: '2026-10-07' });
  const aware = budgetReport(ledger, CATEGORIES, { transport: 70 }, { month: '2026-10', today: '2026-10-07', series });
  // Without the schedule, €46 by the 7th reads as ~€204 for the month.
  assert.equal(plain.rows[0].status, 'atRisk');
  // With it: the €40 pass once, plus €6 of rides at that pace — ~€67, under €70.
  assert.equal(aware.rows[0].status, 'ok');
  assert.ok(Math.abs(aware.rows[0].projected - (40 + 6 / (7 / 31))) < 0.01);
});
