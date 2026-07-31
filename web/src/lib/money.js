/**
 * Currency formatting.
 *
 * CS2 markets quote in USD; the bank side is EUR. Rather than converting on
 * import — which would make the numbers stop matching what Pricempire and Steam
 * show — values are stored in their native currency and the EUR equivalent is
 * rendered alongside, using the hand-entered rate from Settings.
 */

let rate = 0.92;
let display = 'both';

export function configureMoney(settings) {
  if (settings?.currency?.usdToEur) rate = settings.currency.usdToEur;
  if (settings?.currency?.display) display = settings.currency.display;
}

export function usdToEur(usd) {
  return (usd || 0) * rate;
}

function fmt(value, currency) {
  return new Intl.NumberFormat('pt-PT', {
    style: 'currency',
    currency,
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
  }).format(value || 0);
}

export function eur(value) {
  return fmt(value, 'EUR');
}

/**
 * Renders a USD amount. In "both" mode the EUR equivalent follows in
 * parentheses; the approximation sign is deliberate — the rate is static.
 */
export function usd(value, { withEur = true } = {}) {
  const base = fmt(value, 'USD');
  if (!withEur || display !== 'both') return base;
  return `${base} (~${fmt(usdToEur(value), 'EUR')})`;
}

/** Signed variant for gains and losses. */
export function usdSigned(value) {
  const sign = (value || 0) > 0 ? '+' : '';
  return sign + usd(value);
}

export function pct(value) {
  if (value == null) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}
