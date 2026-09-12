import { test } from 'node:test';
import assert from 'node:assert/strict';

import { configureMoney } from './money.js';
import { readNetWorth, componentLabel } from './netWorth.js';

const payload = {
  total: 5500,
  currency: 'EUR',
  components: [
    { id: 'cash', kind: 'cash', value: 5500, currency: 'EUR', count: 2, included: true },
    { id: 'cs2_skin', kind: 'asset', value: 3566, currency: 'USD', count: 75, included: true },
  ],
};

const withRates = (rates) =>
  configureMoney({ currency: { base: 'EUR', rates, manual: {} } });

test('holdings in another currency are converted and counted', () => {
  withRates({ USD: 0.865876 });
  const { total, components, unconvertible } = readNetWorth(payload);
  const skins = components.find((c) => c.id === 'cs2_skin');
  assert.equal(skins.convertible, true);
  assert.ok(Math.abs(skins.converted - 3088) < 1, `converted to ${skins.converted}`);
  assert.ok(Math.abs(total - 8588) < 1, `total was ${total}`);
  assert.deepEqual(unconvertible, []);
});

/*
 * The bug this exists to stop. `convert` returns an amount untouched when it has
 * no rate — correct for displaying one figure, which is then labelled in its own
 * currency, and catastrophic in a sum: 3,566 unrated dollars would land in a euro
 * total as 3,566 euros and the answer would be wrong in the one way a money
 * figure must never be, which is plausibly.
 */
test('a holding with no rate is left out of the total rather than counted as euros', () => {
  withRates({});
  const { total, components, unconvertible } = readNetWorth(payload);
  const skins = components.find((c) => c.id === 'cs2_skin');
  assert.equal(skins.convertible, false);
  assert.equal(skins.converted, null, 'there is no euro figure for it, so there is no euro figure');
  assert.equal(total, 5500, 'the dollars are not silently added');
  assert.deepEqual(unconvertible.map((c) => c.id), ['cs2_skin'], 'and the reader is told which');
});

test('an excluded holding is not reported as missing from the total', () => {
  withRates({});
  const excluded = {
    components: payload.components.map((c) =>
      c.id === 'cs2_skin' ? { ...c, included: false } : c,
    ),
  };
  const { unconvertible } = readNetWorth(excluded);
  assert.deepEqual(unconvertible, [], 'it was never going to be in the total anyway');
});

test('the total counts only what the reader has chosen to count', () => {
  withRates({ USD: 0.865876 });
  const off = {
    components: payload.components.map((c) => (c.id === 'cash' ? { ...c, included: false } : c)),
  };
  const { total } = readNetWorth(off);
  assert.ok(Math.abs(total - 3088) < 1, `total was ${total}`);
});

test('an empty response reads as zero, not as a crash', () => {
  withRates({ USD: 0.865876 });
  assert.equal(readNetWorth(undefined).total, 0);
  assert.deepEqual(readNetWorth(null).components, []);
});

test('a class the app does not ship a name for is shown under its own id', () => {
  const t = (key) => `translated:${key}`;
  assert.equal(componentLabel('cash', t), 'translated:networth.cash');
  // Never "networth.class.gold" on screen — a missing key is a bug the reader
  // should not have to look at.
  assert.equal(componentLabel('gold', t), 'gold');
});
