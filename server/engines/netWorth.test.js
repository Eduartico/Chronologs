import test from 'node:test';
import assert from 'node:assert/strict';

import { computeNetWorth, includes } from './netWorth.js';

const projections = {
  accounts: [
    { id: '1', lastBalance: 4000 },
    { id: '2', lastBalance: 1500 },
    // No statement ever carried a balance for this one. It contributes nothing
    // rather than contributing zero, and it is not counted as an account either.
    { id: '3', lastBalance: null },
  ],
  securityOrders: [],
  transactions: [],
  priceMap: {},
  assets: [
    { name: 'Knife', class: 'cs2_skin', currency: 'USD', currentValue: 400 },
    { name: 'Gloves', class: 'cs2_skin', currency: 'USD', currentValue: 150 },
  ],
};

test('cash is the sum of the balances the bank itself printed', () => {
  const { components } = computeNetWorth(projections);
  const cash = components.find((c) => c.id === 'cash');
  assert.equal(cash.value, 5500);
  assert.equal(cash.count, 2, 'an account with no printed balance is not a balance');
});

test('assets are grouped by their own class and keep their own currency', () => {
  const { components } = computeNetWorth(projections);
  const skins = components.find((c) => c.id === 'cs2_skin');
  assert.equal(skins.value, 550);
  assert.equal(skins.currency, 'USD');
  assert.equal(skins.count, 2);
});

/*
 * The server holds no rates — `web/src/lib/money.js` is the only module allowed
 * to — so a component in another currency is reported and left alone. The client
 * converts it and re-totals. A server-side total that quietly added dollars to
 * euros would be the worst possible kind of wrong: plausible.
 */
test('the server total never mixes currencies', () => {
  const { total, currency } = computeNetWorth(projections);
  assert.equal(currency, 'EUR');
  assert.equal(total, 5500, 'the dollar-denominated skins are not in the euro total');
});

test('a class switched off is still reported, just not counted', () => {
  const settings = { netWorth: { include: { cs2_skin: false } } };
  const { components } = computeNetWorth(projections, settings);
  const skins = components.find((c) => c.id === 'cs2_skin');
  assert.equal(skins.included, false);
  assert.equal(skins.value, 550, 'the figure stays visible so the total is explainable');
});

test('switching off cash takes it out of the total', () => {
  const settings = { netWorth: { include: { cash: false } } };
  assert.equal(computeNetWorth(projections, settings).total, 0);
});

test('a holding nobody has ruled on is counted', () => {
  assert.equal(includes({}, 'cs2_skin'), true);
  assert.equal(includes({ netWorth: { include: {} } }, 'gold'), true);
  assert.equal(includes({ netWorth: { include: { gold: false } } }, 'gold'), false);
});

/*
 * The one arithmetic error a net-worth figure cannot survive. A PoupeUp vault is
 * a subdivision of an account, so the account's printed balance already contains
 * it; a component for vaults would count the same euro twice.
 */
test('vaults are not a component of their own', () => {
  const withVaults = { ...projections, vaults: [{ vault: 'Car', balance: 900 }], vaultTotal: 900 };
  const { components, total } = computeNetWorth(withVaults);
  assert.equal(components.find((c) => c.id === 'vaults'), undefined);
  assert.equal(total, 5500);
});

test('an empty ledger is an empty answer, not a crash', () => {
  const { total, components } = computeNetWorth({});
  assert.equal(total, 0);
  assert.equal(components.length, 1, 'cash is always reported, even at zero');
});
