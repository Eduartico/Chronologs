import test from 'node:test';
import assert from 'node:assert/strict';

import { rangeFor, shiftRange, presetOf, addMonths, isoLocal } from './dateRanges.js';

// 7 October 2026, mid-afternoon local time.
const NOW = new Date(2026, 9, 7, 15, 0, 0);

test('last month is the whole previous calendar month', () => {
  assert.deepEqual(rangeFor('lastMonth', NOW), { from: '2026-09-01', to: '2026-09-30' });
  // January looks back into the previous year.
  assert.deepEqual(rangeFor('lastMonth', new Date(2026, 0, 15)), { from: '2025-12-01', to: '2025-12-31' });
});

test('this month runs from the first to today, and every rolling preset has an end', () => {
  assert.deepEqual(rangeFor('thisMonth', NOW), { from: '2026-10-01', to: '2026-10-07' });
  assert.deepEqual(rangeFor('12m', NOW), { from: '2025-10-08', to: '2026-10-07' });
  assert.deepEqual(rangeFor('3m', NOW), { from: '2026-07-08', to: '2026-10-07' });
  assert.deepEqual(rangeFor('ytd', NOW), { from: '2026-01-01', to: '2026-10-07' });
  assert.deepEqual(rangeFor('lastYear', NOW), { from: '2025-01-01', to: '2025-12-31' });
  assert.deepEqual(rangeFor('all', NOW), { from: '', to: '' });
});

test('the local day is used, not the UTC one', () => {
  // Half past midnight on the 1st is the 1st, whatever UTC says.
  assert.equal(isoLocal(new Date(2026, 10, 1, 0, 30)), '2026-11-01');
});

test('adding months clamps to the end of a shorter month', () => {
  assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
  assert.equal(addMonths('2024-03-31', -1), '2024-02-29');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-01-15', -13), '2024-12-15');
});

test('a whole month steps to the whole neighbouring month', () => {
  assert.deepEqual(shiftRange({ from: '2026-09-01', to: '2026-09-30' }, -1), { from: '2026-08-01', to: '2026-08-31' });
  assert.deepEqual(shiftRange({ from: '2026-03-01', to: '2026-03-31' }, -1), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(shiftRange({ from: '2026-02-01', to: '2026-02-28' }, 1), { from: '2026-03-01', to: '2026-03-31' });
  // A year steps by a year.
  assert.deepEqual(shiftRange({ from: '2025-01-01', to: '2025-12-31' }, -1), { from: '2024-01-01', to: '2024-12-31' });
});

test('a month so far steps to the same days of the neighbouring month', () => {
  assert.deepEqual(shiftRange({ from: '2026-10-01', to: '2026-10-07' }, -1), { from: '2026-09-01', to: '2026-09-07' });
});

test('an arbitrary range steps by its own length', () => {
  assert.deepEqual(shiftRange({ from: '2026-07-08', to: '2026-10-07' }, -1), { from: '2026-04-07', to: '2026-07-07' });
  assert.equal(shiftRange({ from: '', to: '' }, -1), null);
});

test('stepping back onto a preset is recognised as that preset', () => {
  const back = shiftRange(rangeFor('thisMonth', NOW), -1);
  assert.equal(presetOf(back, NOW), 'custom'); // 1–7 September is not a preset
  const forward = shiftRange({ from: '2026-08-01', to: '2026-08-31' }, 1);
  assert.equal(presetOf(forward, NOW), 'lastMonth');
});
