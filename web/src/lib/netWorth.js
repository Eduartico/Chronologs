/**
 * Reading a net-worth response on the client side.
 *
 * The server deliberately does not convert: components carry their own currency
 * and `money.js` is the only module allowed to hold a rate. So the total has to
 * be assembled here, which is also where the display currency lives.
 */

import { canConvert, convert, baseCurrency } from './money.js';

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
 * A component whose currency has no rate is **left out of the total and says
 * so**. `convert` returns such an amount untouched, which is correct when one
 * figure is being displayed — it gets labelled in its own currency — and
 * catastrophic in a sum, where 3,566 unrated dollars would land in a euro total
 * as 3,566 euros. An understated total the reader is told about beats a
 * plausible one that is wrong.
 */
export function readNetWorth(data, { currency = baseCurrency() } = {}) {
  const components = (data?.components || []).map((component) => {
    const convertible = canConvert(component.currency, currency);
    return {
      ...component,
      convertible,
      converted: convertible ? convert(component.value, component.currency, currency) : null,
    };
  });
  const counted = components.filter((c) => c.included && c.convertible);
  return {
    currency,
    components,
    total: counted.reduce((sum, c) => sum + c.converted, 0),
    /** Included, held, and not in the total because there is no rate for it. */
    unconvertible: components.filter((c) => c.included && !c.convertible),
  };
}
