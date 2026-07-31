import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findAggregate } from './correlation.js';

const c = (id, amount, days) => ({ id, amount, days });

test('single-equivalent subset within tolerance', () => {
  const best = findAggregate(100, 5, [c('a', 98, 1)], 4);
  assert.ok(best);
  assert.equal(best.partial, false);
  assert.deepEqual(best.items.map((i) => i.id), ['a']);
});

test('aggregate of 3 transactions sums to target', () => {
  const best = findAggregate(100, 5, [c('a', 40, 0), c('b', 35, 1), c('c', 23.5, 2), c('d', 400, 1)], 4);
  assert.ok(best);
  assert.equal(best.partial, false);
  assert.deepEqual(best.items.map((i) => i.id).sort(), ['a', 'b', 'c']);
});

test('candidates above target+tolerance are pruned', () => {
  const best = findAggregate(100, 5, [c('big', 200, 0)], 4);
  assert.equal(best, null);
});

test('partial match accepted when ≥50% of target (site balance case)', () => {
  const best = findAggregate(100, 2, [c('a', 60, 1)], 4);
  assert.ok(best);
  assert.equal(best.partial, true);
  assert.equal(best.sum, 60);
});

test('partial below 50% of target is rejected', () => {
  const best = findAggregate(100, 2, [c('a', 30, 1)], 4);
  assert.equal(best, null);
});

test('exact-tolerance match preferred over larger partial pool', () => {
  const best = findAggregate(100, 5, [c('exact', 97, 3), c('p1', 55, 0)], 4);
  assert.equal(best.partial, false);
  assert.deepEqual(best.items.map((i) => i.id), ['exact']);
});

test('maxSize caps the subset', () => {
  const best = findAggregate(100, 1, [c('a', 25, 0), c('b', 25, 0), c('c', 25, 0), c('d', 25, 0)], 2);
  // Only 2 allowed → 50 = partial
  assert.ok(best);
  assert.equal(best.partial, true);
  assert.equal(best.sum, 50);
});
