/**
 * Currency formatting and conversion.
 *
 * Amounts are *stored* in whatever they were quoted in — a CS2 sale stays in
 * dollars so it keeps matching Pricempire and Steam, a bank line stays in euros
 * — and exactly one currency is ever displayed. Showing both at once was the old
 * behaviour and it made every screen a puzzle: "$1.406,20 (~€1.284,50)" in each
 * cell of each table, two numbers where the reader wanted one, and no way to add
 * a column up by eye. The display currency is a setting; the native amount lives
 * in the tooltip for the times it matters.
 *
 * Conversion used to be four lines that knew USD and EUR and nothing else, which
 * was honest while the app shipped two languages. It now ships fourteen, and a
 * reader in Warsaw has złoty on their statement. So the rate is a *table* keyed
 * by currency, expressed as euros per one unit — the euro being the pivot
 * because it is the ledger's own currency and the orientation the ECB publishes
 * in. Everything converts through it: `from → EUR → to`.
 */

import { nf } from './locale.js';
import { PIVOT, isKnownCurrency } from './currencies.js';
import { t } from '../i18n/index.js';

/** Euros per one unit of each currency. EUR itself is 1 and is never stored. */
let rates = { USD: 0.92 };
/** Hand-entered overrides. These beat anything fetched, and a refresh leaves
    them alone — someone who typed a rate meant it. */
let manual = {};
let base = PIVOT;

/**
 * Set the display currency and the rates.
 *
 * This used to be called from Investments.jsx alone, which meant the rate the
 * whole app formatted with depended on whether you had visited that page yet.
 * `SettingsProvider` is now the only caller, once, before the first paint.
 */
export function configureMoney(settings) {
  const currency = settings?.currency;
  if (!currency) return;
  if (currency.rates) rates = { ...currency.rates };
  // A settings file written before the table existed carries only the scalar.
  else if (currency.usdToEur) rates = { ...rates, USD: currency.usdToEur };
  if (currency.manual) manual = { ...currency.manual };
  if (currency.base) base = currency.base;
}

/** The currency everything is being rendered in. */
export function baseCurrency() {
  return base;
}

/**
 * Euros per one unit of `code`.
 *
 * Returns null rather than a guess for a currency with no rate. A missing rate
 * has to be visible: silently treating 1 THB as 1 EUR turns a 400-baht dinner
 * into a 400-euro one, and nothing downstream would ever question it.
 */
export function rateOf(code) {
  const currency = String(code || base).toUpperCase();
  if (currency === PIVOT) return 1;
  const value = manual[currency] ?? rates[currency];
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Whether this currency's rate was typed rather than fetched. */
export function isManualRate(code) {
  return Number.isFinite(manual[String(code || '').toUpperCase()]);
}

/** Every rate currently in use, fetched and overridden merged, for the settings
    table and for the few places that show one. */
export function allRates() {
  return { ...rates, ...manual };
}

/**
 * Converts between any two currencies in the table, through the pivot.
 *
 * An unknown or unrated currency returns the number untouched, which is what the
 * two-currency version did and remains the only safe answer: showing the raw
 * figure is wrong by a rate, while inventing one is wrong by an unknown amount.
 */
export function convert(value, from, to = base) {
  const n = Number(value) || 0;
  const src = String(from || base).toUpperCase();
  const dst = String(to || base).toUpperCase();
  if (src === dst) return n;
  const fromRate = rateOf(src);
  const toRate = rateOf(dst);
  if (fromRate == null || toRate == null) return n;
  return (n * fromRate) / toRate;
}

/** Kept because a hundred call sites say `usd(...)`; both are now one row of the
    table rather than the whole of what conversion means. */
export function usdToEur(value) {
  return convert(value, 'USD', PIVOT);
}

export function eurToUsd(value) {
  return convert(value, PIVOT, 'USD');
}

/**
 * How many decimals this currency actually has.
 *
 * Asked of `Intl` rather than declared, because "two decimals" is an assumption
 * that holds for the euro and breaks for the yen, the won and the Chilean peso —
 * ¥1.234,00 is not a number anybody in Tokyo writes. Above a thousand the
 * fraction is dropped entirely, as it always was, but only down to what the
 * currency has and never below zero.
 */
function fractionDigits(currency, value) {
  let digits = 2;
  try {
    digits = nf({ style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  } catch {
    /* an unknown code: two is the common case and the format call below will
       fall back to the plain number anyway */
  }
  return Math.abs(value) >= 1000 ? 0 : digits;
}

function fmt(value, currency) {
  const amount = value || 0;
  try {
    return nf({
      style: 'currency',
      currency,
      maximumFractionDigits: fractionDigits(currency, amount),
    }).format(amount);
  } catch {
    // A code Intl does not know still has to render as something readable.
    return `${nf({ maximumFractionDigits: 2 }).format(amount)} ${currency}`;
  }
}

/**
 * Which currency an amount can honestly be *labelled* as.
 *
 * The display currency, unless there is no rate to reach it — the picker offers
 * every currency in the table but only the ones the ledger holds are ever
 * fetched, so someone can select the Peruvian sol and have nothing to convert
 * with. `convert` already refuses to guess and returns the number untouched;
 * without this, `fmt` would then stamp "PEN" on a figure that is still euros,
 * which is the one failure the no-guessing rule exists to prevent. Wrong by a
 * rate is recoverable; wrong by a *label* is not, because nothing on screen
 * says it happened.
 *
 * `settings.currency.baseNoRate` tells the reader why the currency they picked
 * is not the one they are seeing.
 */
export function displayCurrency(from = base) {
  return rateOf(base) == null ? String(from || base).toUpperCase() : base;
}

/** Whether the chosen display currency currently has no rate to reach it. */
export function baseIsUnrated() {
  return rateOf(base) == null;
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
  const text = fmt(converted, displayCurrency(from));
  if (!signed) return text;
  return `${converted > 0 ? '+' : ''}${text}`;
}

/** The original amount as it was quoted, for a `title` attribute, with the rate
    that was used to move it. */
export function nativeOf(value, from) {
  if (!from || from === base) return undefined;
  const src = String(from).toUpperCase();
  const pair = rateOf(src) / (rateOf(base) || 1);
  if (!Number.isFinite(pair)) return undefined;
  return t('money.atRate', { amount: fmt(value, src), rate: pair.toFixed(4) });
}

/** The rate currently in use for a currency, for the few places that show one.
    Defaults to the dollar, which is what every existing caller meant. */
export function currentRate(code = 'USD') {
  return rateOf(code) ?? 0;
}

export function eur(value) {
  return money(value, { from: PIVOT });
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

export { PIVOT, isKnownCurrency };
