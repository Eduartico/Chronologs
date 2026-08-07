/**
 * Currency formatting.
 *
 * CS2 markets quote in USD; the bank side is EUR. Values are still *stored* in
 * whatever the market quoted, so they keep matching what Pricempire and Steam
 * show — but only one currency is ever displayed.
 *
 * Showing both at once was the old behaviour and it made every screen a puzzle:
 * "$1.406,20 (~€1.284,50)" in each cell of each table, two numbers where the
 * reader wanted one, and no way to add a column up by eye. The display currency
 * is a setting, the euro by default, and the native amount lives in the tooltip
 * for the times it matters.
 */

import { nf } from './locale.js';
import { t } from '../i18n/index.js';

let rate = 0.92;
let base = 'EUR';

/**
 * Set the display currency and the rate.
 *
 * This used to be called from Investments.jsx alone, which meant the rate the
 * whole app formatted with depended on whether you had visited that page yet.
 * `SettingsProvider` is now the only caller, once, before the first paint.
 */
export function configureMoney(settings) {
  if (settings?.currency?.usdToEur) rate = settings.currency.usdToEur;
  if (settings?.currency?.base) base = settings.currency.base;
}

/** The currency everything is being rendered in. */
export function baseCurrency() {
  return base;
}

export function usdToEur(usd) {
  return (usd || 0) * rate;
}

export function eurToUsd(eur) {
  return rate ? (eur || 0) / rate : 0;
}

/** Converts between the two currencies the app knows about. */
export function convert(value, from, to = base) {
  const n = Number(value) || 0;
  if (from === to) return n;
  if (from === 'USD' && to === 'EUR') return usdToEur(n);
  if (from === 'EUR' && to === 'USD') return eurToUsd(n);
  return n;
}

function fmt(value, currency) {
  return nf({
    style: 'currency',
    currency,
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
  }).format(value || 0);
}

/**
 * An amount, in the display currency.
 *
 * `from` says what the stored number is denominated in. When that differs from
 * what is on screen, the conversion is approximate — the rate moves — so
 * `nativeOf()` gives the untouched original for the tooltip.
 */
export function money(value, { from = base, signed = false } = {}) {
  const converted = convert(value, from);
  const text = fmt(converted, base);
  if (!signed) return text;
  return `${converted > 0 ? '+' : ''}${text}`;
}

/** The original amount as the market quoted it, for a `title` attribute. */
export function nativeOf(value, from) {
  if (!from || from === base) return undefined;
  return t('money.atRate', { amount: fmt(value, from), rate: rate.toFixed(4) });
}

/** The rate currently in use, for the few places that show it. */
export function currentRate() {
  return rate;
}

export function eur(value) {
  return money(value, { from: 'EUR' });
}

/** A dollar-denominated amount, rendered in whatever the display currency is. */
export function usd(value) {
  return money(value, { from: 'USD' });
}

/** Signed variant for gains and losses. */
export function usdSigned(value) {
  return money(value, { from: 'USD', signed: true });
}

export function pct(value) {
  if (value == null) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}
