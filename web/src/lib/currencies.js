/**
 * The currencies the app can display, and where each one's rate comes from.
 *
 * Plain ESM data with no imports, so the server reads this file directly the way
 * it reads the English catalogue — one table, not two that drift.
 *
 * Deliberately not a name table. `Intl.DisplayNames` already knows what a
 * Canadian dollar is called in all fourteen shipped languages, so putting
 * "Canadian Dollar" here would be inventing 45 × 14 strings that the platform
 * hands over for free and gets more right than we would. `localeName`'s sibling
 * `currencyName()` in lib/locale.js is the one caller.
 *
 * Nor is it a decimals table. How many minor units a currency has is also
 * something `Intl` knows — JPY and KRW print none, TND prints three — and a
 * hand-kept column is one more thing to be wrong about.
 *
 * `ecb: true` means the currency appears in the European Central Bank's daily
 * reference feed, which is one request for the whole set and is published by the
 * issuer of the pivot currency itself. Everything else is fetched per pair from
 * the same quote source the ETF prices use, and only when it is actually in use
 * — see server/ingestion/quotes/fx.js.
 *
 * EUR is the pivot and is not in the list: its rate against itself is 1, and
 * storing that invites someone to edit it.
 */

/** Everything the ECB publishes daily against the euro. */
const ECB = [
  'USD', 'JPY', 'BGN', 'CZK', 'DKK', 'GBP', 'HUF', 'PLN', 'RON', 'SEK',
  'CHF', 'ISK', 'NOK', 'TRY', 'AUD', 'BRL', 'CAD', 'CNY', 'HKD', 'IDR',
  'ILS', 'INR', 'KRW', 'MXN', 'MYR', 'NZD', 'PHP', 'SGD', 'THB', 'ZAR',
];

/**
 * Everything else worth being able to pick.
 *
 * The rouble is here rather than above because the ECB stopped publishing it in
 * March 2022 and has not resumed — a detail that would otherwise show up as a
 * currency that silently never updates.
 */
const OTHER = [
  'RUB', 'UAH', 'TWD', 'VND', 'ARS', 'CLP', 'COP', 'PEN',
  'AED', 'SAR', 'EGP', 'NGN', 'KES', 'MAD',
];

/** The pivot every stored rate is expressed against. */
export const PIVOT = 'EUR';

export const CURRENCIES = [
  { code: PIVOT, ecb: false },
  ...ECB.map((code) => ({ code, ecb: true })),
  ...OTHER.map((code) => ({ code, ecb: false })),
];

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

export function isKnownCurrency(code) {
  return BY_CODE.has(String(code || '').toUpperCase());
}

/** The codes the ECB feed covers, so the fetcher knows what it still has to ask
    for one at a time. */
export function ecbCodes() {
  return CURRENCIES.filter((c) => c.ecb).map((c) => c.code);
}

export function currencyCodes() {
  return CURRENCIES.map((c) => c.code);
}
