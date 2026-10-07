import test from 'node:test';
import assert from 'node:assert/strict';

import { detectRecurring, occurrences } from './recurring.js';
import { currentCash, everydayRate, forecastCash } from './forecast.js';

let n = 0;
const tx = (date, description, amount, extra = {}) => ({ id: `t${++n}`, date, description, amount, ...extra });
const TODAY = '2026-10-07';

// A year of a monthly pass, bought on a card whose number rotates, skipped in August.
const PASS = ['2025-11-03', '2025-12-02', '2026-01-04', '2026-02-02', '2026-03-03', '2026-04-02', '2026-05-04',
  '2026-06-03', '2026-07-02', '2026-09-03', '2026-10-02'].map((d, i) =>
  tx(d, `COMPRA ${i % 2 ? '0412' : '3987'} METRO DO PORTO ANDANTE`, -40, { category: 'transport' }));

const RENT = ['2026-05-02', '2026-06-02', '2026-07-02', '2026-08-02', '2026-09-02', '2026-10-02'].map((d) =>
  tx(d, 'DD RENDA CASA', -650, { category: 'housing' }));

const SALARY = ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01'].map((d) =>
  tx(d, 'TRANSFERENCIA - VENCIMENTO', 1850, { category: 'income' }));

// Groceries every two to five days: a habit, not a bill.
const GROCERIES = [];
for (let d = 1, k = 0; d < 120; d += 2 + (k++ % 4)) {
  const date = new Date(Date.UTC(2026, 5, d)).toISOString().slice(0, 10);
  GROCERIES.push(tx(date, 'COMPRA 0412 CONTINENTE PORTO', -20 - (k % 5) * 9, { category: 'food' }));
}

// A gym cancelled in May.
const GYM = ['2026-01-20', '2026-02-20', '2026-03-20', '2026-04-20', '2026-05-20'].map((d) =>
  tx(d, 'DD FITNESS HUT', -29.9, { category: 'health' }));

const LEDGER = [...PASS, ...RENT, ...SALARY, ...GROCERIES, ...GYM];

test('a monthly pass on a rotating card, skipped once, is still a monthly bill', () => {
  const series = detectRecurring(LEDGER, { today: TODAY });
  const pass = series.find((s) => s.name.includes('METRO'));
  assert.ok(pass, 'the pass is found');
  assert.equal(pass.cadence, 'monthly');
  assert.equal(pass.amount, -40);
  assert.equal(pass.nextDate, '2026-11-03');
});

test('income recurs too, and a bill keeps its day of the month', () => {
  const series = detectRecurring(LEDGER, { today: TODAY });
  const salary = series.find((s) => s.direction === 'in');
  assert.equal(salary.nextDate, '2026-11-01');
  assert.equal(salary.amount, 1850);
  const rent = series.find((s) => s.name.includes('RENDA'));
  assert.equal(rent.nextDate, '2026-11-02');
  // Through February it stays on the 2nd rather than drifting by a day a month.
  const ahead = occurrences([rent], '2026-10-08', '2027-03-31').map((o) => o.date);
  assert.deepEqual(ahead, ['2026-11-02', '2026-12-02', '2027-01-02', '2027-02-02', '2027-03-02']);
});

test('a shopping habit is not a bill, and a cancelled subscription is not upcoming', () => {
  const names = detectRecurring(LEDGER, { today: TODAY }).map((s) => s.name);
  assert.equal(names.some((n) => n.includes('CONTINENTE')), false);
  assert.equal(names.some((n) => n.includes('FITNESS')), false);
});

test('an ignored series is left out', () => {
  const all = detectRecurring(LEDGER, { today: TODAY });
  const rent = all.find((s) => s.name.includes('RENDA'));
  const without = detectRecurring(LEDGER, { today: TODAY, ignored: [rent.id] });
  assert.equal(without.some((s) => s.id === rent.id), false);
  assert.equal(without.length, all.length - 1);
});

test('an overdue occurrence is still owed, and is placed on the first day', () => {
  const series = detectRecurring(LEDGER, { today: '2026-11-06' });
  const pass = series.find((s) => s.name.includes('METRO'));
  assert.equal(pass.overdue, true);
  const [first] = occurrences([pass], '2026-11-06', '2026-11-30');
  assert.equal(first.date, '2026-11-06');
  assert.equal(first.overdue, true);
});

/* ---- the forecast ---- */

const ACCOUNTS = [
  { id: 'PT1', lastBalance: 1000, lastBalanceDate: '2026-10-05' },
  { id: 'PT2', lastBalance: 500, lastBalanceDate: '2026-09-20' },
];

test('today’s cash catches each account up from its own last printed balance', () => {
  const moves = [
    // On PT1 after its balance: counted.
    tx('2026-10-06', 'COMPRA CAFE', -5, { accountId: 'PT1' }),
    // On PT1 before its balance: already inside it.
    tx('2026-10-01', 'COMPRA CAFE', -7, { accountId: 'PT1' }),
    // A transfer PT1 → PT2 on 1 October: inside PT1's balance, not yet in PT2's.
    tx('2026-10-01', 'TRF P/ POUPANCA', 100, { accountId: 'PT2' }),
  ];
  const cash = currentCash(ACCOUNTS, moves, TODAY);
  assert.equal(cash.balance, 1000 - 5 + 500 + 100);
  assert.equal(cash.oldest, '2026-09-20');
  assert.equal(currentCash([], moves, TODAY), null);
});

test('everyday spending is the median week, so one big purchase does not repeat', () => {
  const list = [];
  for (let w = 0; w < 13; w++) {
    const date = new Date(Date.parse('2026-07-08T00:00:00Z') + w * 7 * 86400000).toISOString().slice(0, 10);
    list.push(tx(date, 'COMPRA CONTINENTE', -70));
  }
  list.push(tx('2026-08-15', 'COMPRA WORTEN LAPTOP', -900));
  assert.equal(everydayRate(list, [], TODAY), 10);
});

test('the forecast applies scheduled money on its day and everyday spending daily', () => {
  const series = detectRecurring(LEDGER, { today: TODAY });
  const result = forecastCash({
    accounts: [{ id: 'PT1', lastBalance: 2000, lastBalanceDate: TODAY }],
    transactions: [],
    spending: [],
    series,
    today: TODAY,
    days: 30,
  });
  assert.equal(result.start, 2000);
  assert.equal(result.everydayPerDay, 0);
  const nov1 = result.rows.find((r) => r.date === '2026-11-01');
  const oct31 = result.rows.find((r) => r.date === '2026-10-31');
  assert.equal(Math.round(nov1.projected - oct31.projected), 1850);
  // The actual and projected lines meet at today.
  const today = result.rows.find((r) => r.date === TODAY);
  assert.equal(today.actual, 2000);
  assert.equal(today.projected, 2000);
  assert.equal(result.relative, false);
});
