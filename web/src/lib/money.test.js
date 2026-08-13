import test from 'node:test';
import assert from 'node:assert/strict';

import {
  configureMoney, convert, rateOf, money, allRates, baseCurrency, usdToEur,
  displayCurrency, baseIsUnrated,
} from './money.js';
import { PIVOT, isKnownCurrency, ecbCodes, currencyCodes } from './currencies.js';
import { setLocale } from './locale.js';

/*
 * Conversion used to be four lines that knew two currencies. These are the cases
 * that only exist once it is a table — the pivot, a currency with no rate, a
 * currency Intl prints without decimals — plus the migration path, because the
 * one thing that must not happen is an existing ledger reading differently.
 */

const RATES = {
  USD: 0.9,      // 1 USD = 0.90 EUR
  JPY: 0.006,    // 1 JPY = 0.006 EUR
  PLN: 0.23,
  CAD: 0.68,
};

function configure(patch = {}) {
  configureMoney({ currency: { base: PIVOT, rates: { ...RATES }, manual: {}, ...patch } });
}

test('the pivot converts to itself and is never a stored rate', () => {
  configure();
  assert.equal(rateOf(PIVOT), 1);
  assert.equal(convert(100, PIVOT, PIVOT), 100);
  assert.equal(allRates()[PIVOT], undefined, 'EUR must not appear in the table');
});

test('a conversion goes through the pivot, both ways', () => {
  configure();
  assert.equal(convert(100, 'USD', PIVOT), 90);
  assert.equal(convert(90, PIVOT, 'USD'), 100);
  // The case the old two-currency version could not express at all.
  assert.equal(Math.round(convert(1000, 'JPY', 'PLN')), Math.round((1000 * 0.006) / 0.23));
});

test('a round trip through a third currency comes back to itself', () => {
  configure();
  const there = convert(1234.56, 'CAD', 'JPY');
  assert.ok(Math.abs(convert(there, 'JPY', 'CAD') - 1234.56) < 0.01);
});

test('a hand-typed rate beats the fetched one', () => {
  configure({ manual: { USD: 1 } });
  assert.equal(rateOf('USD'), 1);
  assert.equal(convert(100, 'USD', PIVOT), 100);
  // …and does not disturb the currencies it was not typed for.
  assert.equal(rateOf('CAD'), 0.68);
});

test('a currency with no rate returns the number untouched rather than a guess', () => {
  configure();
  assert.equal(rateOf('THB'), null);
  // Wrong by a rate is recoverable; wrong by an invented rate is not, and 400
  // baht silently read as 400 euros is the failure this protects against.
  assert.equal(convert(400, 'THB', PIVOT), 400);
  assert.equal(convert(400, 'ZZZ', PIVOT), 400);
});

test('a settings file written before the table migrates its scalar', () => {
  configureMoney({ currency: { base: PIVOT, usdToEur: 0.87 } });
  assert.equal(rateOf('USD'), 0.87, 'the old single rate is the table’s dollar row');
  assert.equal(usdToEur(100), 87);
});

test('a zero-decimal currency prints without decimals', () => {
  setLocale('en');
  configure({ base: 'JPY' });
  assert.equal(baseCurrency(), 'JPY');
  const yen = money(1234.5, { from: 'JPY' });
  assert.ok(!/[.,]\d\d\b/.test(yen), `yen should carry no minor units, got ${yen}`);

  configure({ base: PIVOT });
  const euro = money(12.5, { from: PIVOT });
  assert.match(euro, /12[.,]50/, `the euro keeps two, got ${euro}`);
});

test('formatting follows the interface language', () => {
  configure({ base: PIVOT });
  setLocale('de');
  const german = money(1234.5, { from: PIVOT });
  setLocale('en');
  const english = money(1234.5, { from: PIVOT });
  assert.notEqual(german, english, 'a German reader and an English one group digits differently');
});

test('the currency table is coherent', () => {
  assert.ok(isKnownCurrency('CAD'), 'the secondary currencies are in the table');
  assert.ok(isKnownCurrency('pln'), 'the lookup is case-insensitive');
  assert.ok(!isKnownCurrency('ZZZ'));
  assert.ok(currencyCodes().includes(PIVOT), 'the pivot is selectable as a display currency');
  assert.ok(!ecbCodes().includes(PIVOT), 'the pivot is never fetched against itself');
  assert.ok(!ecbCodes().includes('RUB'), 'the ECB stopped publishing the rouble in 2022');
  assert.equal(new Set(currencyCodes()).size, currencyCodes().length, 'no duplicates');
});

/* ---- the display currency itself having no rate ---------------------------
   The picker offers all 45 currencies but only the ones the ledger holds are
   ever fetched, so choosing one the ECB does not publish is an ordinary thing
   to do. `convert` already refuses to guess — this is about the *label*. */

test('a display currency with no rate does not put its name on someone else’s money', () => {
  configureMoney({ currency: { base: 'PEN', rates: { ...RATES }, manual: {} } });
  assert.equal(rateOf('PEN'), null);
  assert.ok(baseIsUnrated(), 'the app has to know it cannot reach the chosen currency');

  // The amount is euros and stays euros. Stamping "PEN" on it would be a lie
  // that nothing on screen corrects — worse than being wrong by a rate, which
  // at least a reader can suspect.
  const shown = money(100, { from: PIVOT });
  assert.ok(!/PEN/.test(shown), `100 euros must not be labelled PEN, got ${shown}`);
  assert.equal(displayCurrency(PIVOT), PIVOT);

  // A dollar amount likewise keeps its own name rather than borrowing the base's.
  assert.equal(displayCurrency('USD'), 'USD');
  assert.ok(/US\$|\$|USD/.test(money(50, { from: 'USD' })));
});

test('typing a rate for the chosen currency makes it usable immediately', () => {
  configureMoney({ currency: { base: 'PEN', rates: { ...RATES }, manual: { PEN: 0.25 } } });
  assert.ok(!baseIsUnrated());
  assert.equal(displayCurrency(PIVOT), 'PEN');
  assert.equal(convert(100, PIVOT), 400, '100 EUR at 0.25 EUR per sol is 400 soles');
});
