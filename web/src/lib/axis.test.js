import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fitDomain, fitAxis } from './axis.js';

/*
 * The case that motivated this: a cashflow chart whose data ran from −3,000 to
 * 5,300 was given an axis up to 9,000, because Recharts picks one step that
 * covers the span and then rounds the top up to a multiple of it.
 */
test('an axis fits the data rather than rounding up past it', () => {
  const { domain, ticks } = fitDomain([-3000, 1200, 980, 5300, 1400]);
  assert.ok(domain[1] < 9000, `top was ${domain[1]}`);
  assert.ok(domain[1] >= 5300, 'the tallest bar must still fit');
  assert.ok(domain[0] <= -3000, 'the deepest bar must still fit');
  assert.equal(ticks[0], domain[0]);
  assert.equal(ticks[ticks.length - 1], domain[1]);
});

test('every value stays inside the domain', () => {
  const cases = [
    [1, 2, 3],
    [0.02, 0.07, 0.11],
    [-12000, -300, 45000],
    [999999, 1000001],
    [-5, -5, -5],
  ];
  for (const values of cases) {
    const { domain } = fitDomain(values);
    assert.ok(domain[0] <= Math.min(...values), `${values} under ${domain[0]}`);
    assert.ok(domain[1] >= Math.max(...values), `${values} over ${domain[1]}`);
  }
});

test('a money axis keeps zero in frame even when nothing crosses it', () => {
  const { domain } = fitDomain([4000, 4200, 4600]);
  assert.equal(domain[0], 0);
});

test('the interesting band can be kept when zero is not wanted', () => {
  const { domain } = fitDomain([4000, 4200, 4600], { includeZero: false });
  assert.ok(domain[0] > 1000, `floor was ${domain[0]}`);
});

test('ticks are evenly spaced and never more than the cap', () => {
  const { ticks } = fitDomain([-3000, 5300], { maxTicks: 8 });
  assert.ok(ticks.length <= 9);
  const step = ticks[1] - ticks[0];
  for (let i = 1; i < ticks.length; i += 1) {
    assert.ok(Math.abs(ticks[i] - ticks[i - 1] - step) < step * 1e-6, 'uneven step');
  }
});

test('a flat series still gets a drawable axis', () => {
  const { domain } = fitDomain([7, 7, 7]);
  assert.ok(domain[1] > domain[0]);
});

test('nothing to draw spreads to nothing', () => {
  assert.equal(fitDomain([]), undefined);
  assert.equal(fitDomain([Number.NaN, null, undefined]), undefined);
  assert.deepEqual(fitAxis([]), {});
});

test('fitAxis hands back recharts props', () => {
  const props = fitAxis([0, 10]);
  assert.ok(Array.isArray(props.domain));
  assert.ok(Array.isArray(props.ticks));
});
