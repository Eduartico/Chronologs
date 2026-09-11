/**
 * Reading a net-worth response on the client side.
 *
 * The server deliberately does not convert: components carry their own currency
 * and `money.js` is the only module allowed to hold a rate. So the total has to
 * be assembled here, which is also where the display currency lives.
 */

import { convert, baseCurrency } from './money.js';

/* The components the app ships with get a real name; anything the ledger grows
   later is shown under its own id rather than under a missing translation key.
   A class called "gold" reading "gold" is honest — reading
   "networth.class.gold" is a bug on screen. */
const LABELS = {
  cash: 'networth.cash',
  securities: 'networth.securities',
  cs2_skin: 'networth.cs2',
};

export function componentLabel(id, t) {
  const key = LABELS[id];
  return key ? t(key) : id;
}

/**
 * Each component in the display currency, plus the total of the included ones.
 *
 * A component whose currency has no rate converts to itself rather than to a
 * guess — the same rule the rest of the app follows, and the reason the total
 * can be understated rather than wrong.
 */
export function readNetWorth(data, { currency = baseCurrency() } = {}) {
  const components = (data?.components || []).map((component) => ({
    ...component,
    converted: convert(component.value, component.currency, currency),
  }));
  return {
    currency,
    components,
    total: components.filter((c) => c.included).reduce((sum, c) => sum + c.converted, 0),
  };
}
