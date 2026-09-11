/**
 * What there is, as opposed to what moved.
 *
 * Every figure this assembles already existed and none of them had ever been
 * added up. The Accounts tab showed bank balances, the Investments page showed
 * an ETF total and a CS2 total side by side and never summed, and the reader was
 * left doing the arithmetic by eye across two screens — and getting "I have
 * €5,000" when a third of their money was in an index fund and another third in
 * a Steam inventory.
 *
 * Three rules the shape follows:
 *
 *  - **Vaults are not a component.** A PoupeUp vault is a subdivision of an
 *    account, not a thing beside it, so the account's own printed balance
 *    already contains it. Adding the vault total would count the same euro
 *    twice, which is the one arithmetic error a net-worth figure cannot survive.
 *  - **Nothing is converted here.** Components carry their own currency and the
 *    client converts through `money.js`, which is the only module allowed to
 *    hold a rate. A skin priced in dollars stays priced in dollars until it is
 *    displayed.
 *  - **Market value, no haircut.** No fee model, no liquidity discount, no
 *    "what you would actually get". Those are guesses about a future sale, and a
 *    guess dressed as a balance is worse than a number that is merely optimistic
 *    in a way the reader already knows about.
 *
 * Which classes count is a setting, per class, because the answer is personal:
 * an index fund is a week from being cash and a pension is not.
 */

import { computeSecurityPositions, computeSecuritySummary } from './securities.js';

/** Counted unless the reader has said otherwise. A holding nobody has ruled on
    is still money they have. */
export function includes(settings, id) {
  return settings?.netWorth?.include?.[id] !== false;
}

/**
 * @returns `{ total, currency, components }` where each component is
 *   `{ id, kind, value, currency, count, included }`. `total` is only the
 *   included components, and only the ones already in the base currency — the
 *   client converts the rest and re-totals, because it is the side that holds
 *   the rates.
 */
export function computeNetWorth(projections, settings = {}, base = 'EUR') {
  const components = [];

  /* Cash: the bank's own printed running balance, per account. Not a sum of
     transactions — `deriveAccounts` takes it from the latest statement row that
     carried one, which is the number the bank itself would tell you. */
  const cashAccounts = (projections.accounts || []).filter((a) => a.lastBalance != null);
  components.push({
    id: 'cash',
    kind: 'cash',
    value: round2(cashAccounts.reduce((sum, a) => sum + a.lastBalance, 0)),
    currency: base,
    count: cashAccounts.length,
    included: includes(settings, 'cash'),
  });

  const positions = computeSecurityPositions(
    projections.securityOrders || [],
    projections.transactions || [],
    projections.priceMap || {},
  );
  const securities = computeSecuritySummary(positions, projections.transactions || []);
  // `marketValue` is null when nothing is priced. A position whose price nobody
  // knows contributes nothing rather than contributing its cost — net worth is
  // what it is worth now, and "what I paid" is a different question.
  if (positions.length) {
    components.push({
      id: 'securities',
      kind: 'securities',
      value: round2(securities.marketValue || 0),
      currency: positions[0]?.currency || base,
      count: positions.length,
      unpriced: securities.unpriced || 0,
      included: includes(settings, 'securities'),
    });
  }

  /* Everything else the ledger knows it holds, grouped by its own class. One
     component per class rather than one for "assets": the setting is per class
     because CS2 skins and an index fund are not the same decision. */
  const byClass = new Map();
  for (const asset of projections.assets || []) {
    const id = asset.class || asset.type || 'other';
    const entry = byClass.get(id) || { value: 0, count: 0, currency: asset.currency || base };
    entry.value += Number(asset.currentValue) || 0;
    entry.count += 1;
    byClass.set(id, entry);
  }
  for (const [id, entry] of byClass) {
    components.push({
      id,
      kind: 'asset',
      value: round2(entry.value),
      currency: entry.currency,
      count: entry.count,
      included: includes(settings, id),
    });
  }

  const total = components
    .filter((c) => c.included && c.currency === base)
    .reduce((sum, c) => sum + c.value, 0);

  return { total: round2(total), currency: base, components };
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}
