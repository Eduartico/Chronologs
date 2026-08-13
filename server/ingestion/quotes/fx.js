/**
 * Exchange rates.
 *
 * The CS2 side of the ledger is quoted in dollars and the bank side in euros,
 * and the app used to render both at once — "$1.406,20 (~€1.284,50)" in every
 * cell of every table, which is two numbers where the reader wanted one. Showing
 * a single currency means converting, and converting means a rate.
 *
 * It was one rate, typed into Settings by hand and never revisited, so it
 * silently drifted. Then it was one rate fetched from Yahoo. Now that the app
 * ships fourteen languages it is a table: someone reading in Polish has złoty on
 * their statement, and "the dollar rate" is not a currency system.
 *
 * The euro is the pivot. Everything is stored as *euros per one unit*, which is
 * the orientation the old scalar used and the reciprocal of what the ECB
 * publishes. Two sources, in order:
 *
 *   1. The ECB's own daily reference feed — one request, thirty currencies, no
 *      key, published by the issuer of the pivot currency. Nothing about a
 *      third-party aggregator improves on that.
 *   2. The same Yahoo endpoint the ETF quotes use, one pair at a time, for the
 *      currencies the ECB does not carry (the rouble since 2022, and most of
 *      Latin America, the Gulf and Africa) — and only for the ones actually in
 *      use, so a normal refresh is one request rather than forty-five.
 *
 * Same discipline as the quote fetcher throughout: opt-in, never fatal, and
 * every stored rate stays as the fallback for anyone who would rather not reach
 * the network at all.
 */
import { loadSettings, saveSettings } from '../../lib/settings.js';
import { httpError } from '../../lib/httpError.js';
import { PIVOT, ecbCodes, isKnownCurrency } from '../../../web/src/lib/currencies.js';

const ECB_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const TIMEOUT_MS = 12000;

/** A rate older than this is reported as stale rather than trusted silently. */
export const STALE_AFTER_DAYS = 7;

export function autoRateEnabled() {
  return loadSettings().currency?.autoRate === true;
}

async function getText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Chronologs)' },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads the ECB's daily XML into euros per unit.
 *
 * The payload is a flat list of `<Cube currency='USD' rate='1.0876'/>` inside one
 * dated cube, so a regex reads it and the app does not grow an XML dependency
 * for eight lines of parsing. Exported separately from the fetching so a test
 * can hand it a fixture instead of reaching the network.
 */
export function parseEcbXml(xml) {
  if (typeof xml !== 'string' || !xml.includes('Cube')) return null;
  const date = /time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1] || null;
  const rates = {};
  for (const m of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) {
    const perEuro = Number(m[2]);
    // The feed says how many of a currency one euro buys; everything here is
    // stored the other way round, so this is where the reciprocal is taken.
    if (perEuro > 0) rates[m[1]] = Math.round((1 / perEuro) * 1e6) / 1e6;
  }
  return Object.keys(rates).length ? { rates, date } : null;
}

/** The ECB table, or null. Returns rather than throws: a missing feed falls back
    on the stored rates, and a broken exchange feed must not break a page. */
export async function fetchEcbRates() {
  return parseEcbXml(await getText(ECB_URL));
}

/**
 * One pair from Yahoo, for a currency the ECB does not publish.
 *
 * `EURXXX=X` is how many of XXX one euro buys — the same orientation as the ECB
 * feed, so the same reciprocal applies.
 */
export async function fetchYahooPair(code) {
  const symbol = encodeURIComponent(`${PIVOT}${code}=X`);
  const body = await getText(`${CHART_URL}/${symbol}?interval=1d&range=5d`);
  if (!body) return null;
  try {
    const perEuro = JSON.parse(body)?.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (!Number.isFinite(perEuro) || perEuro <= 0) return null;
    return Math.round((1 / perEuro) * 1e6) / 1e6;
  } catch {
    return null;
  }
}

/** Backwards-compatible single-pair fetch. The dollar is just a row now. */
export async function fetchUsdToEur() {
  const usdToEur = (await fetchEcbRates())?.rates?.USD ?? (await fetchYahooPair('USD'));
  if (!usdToEur) return null;
  return { usdToEur, usdPerEur: 1 / usdToEur, at: new Date().toISOString() };
}

/**
 * Which currencies are worth asking about.
 *
 * The display currency and the dollar always; plus whatever the ledger actually
 * holds. Fetching all forty-five would be forty-five requests for rates nobody
 * is going to see, most of them for currencies this ledger has never contained.
 */
async function currenciesInUse() {
  const wanted = new Set([PIVOT, 'USD', loadSettings().currency?.base || PIVOT]);
  try {
    const { getProjections } = await import('../../projections/cache.js');
    const projections = await getProjections();
    for (const tx of projections.transactions || []) {
      if (tx.currency && isKnownCurrency(tx.currency)) wanted.add(String(tx.currency).toUpperCase());
    }
    for (const order of projections.securityOrders || []) {
      if (order.currency && isKnownCurrency(order.currency)) wanted.add(String(order.currency).toUpperCase());
    }
  } catch {
    // No ledger yet, or a projection that will not build. The base currency and
    // the dollar are still worth having, and a refresh is not the place to
    // discover a broken projection.
  }
  wanted.delete(PIVOT);
  return [...wanted];
}

/**
 * Fetches and stores the table.
 *
 * Unlike a price, a rate is not ledger history — it is a display setting, so it
 * lives in settings rather than as an event.
 *
 * Written once at the end rather than per currency: a refresh that dies halfway
 * through must leave yesterday's complete table behind, not a mix of two days.
 */
export async function refreshRates({ force = false } = {}) {
  if (!force && !autoRateEnabled()) throw httpError(400, 'api.error.autoRateOff');

  const settings = loadSettings();
  const fetched = {};

  const ecb = await fetchEcbRates();
  if (ecb) Object.assign(fetched, ecb.rates);

  const covered = new Set(ecbCodes());
  const gaps = (await currenciesInUse()).filter((code) => !covered.has(code) || fetched[code] == null);
  for (const code of gaps) {
    const rate = await fetchYahooPair(code);
    if (rate) fetched[code] = rate;
  }

  if (!Object.keys(fetched).length) return { fetched: false, ...currentRates() };

  const at = new Date().toISOString();
  const rates = { ...settings.currency.rates, ...fetched };
  delete rates[PIVOT];
  saveSettings({
    currency: {
      ...settings.currency,
      rates,
      // The scalar stays a mirror of the table's dollar row.
      usdToEur: rates.USD ?? settings.currency.usdToEur,
      rateFetchedAt: at,
    },
  });

  return { fetched: true, rates, count: Object.keys(fetched).length, at, stale: false };
}

/** The whole table as the app is using it, and whether it is old enough to
    distrust. Manual entries win, and are never called stale: nobody promised a
    hand-typed rate was live. */
export function currentRates() {
  const { rates = {}, manual = {}, rateFetchedAt, autoRate } = loadSettings().currency || {};
  const ageDays = rateFetchedAt ? (Date.now() - Date.parse(rateFetchedAt)) / 86400000 : null;
  return {
    rates: { ...rates, ...manual },
    fetched: { ...rates },
    manual: { ...manual },
    at: rateFetchedAt ?? null,
    stale: Boolean(autoRate && ageDays != null && ageDays > STALE_AFTER_DAYS),
  };
}

/**
 * The dollar row, in the shape the original single-rate route returned.
 *
 * Kept exactly as it was on purpose: `GET /api/currency/rate` is in the snapshot
 * baseline, and a refactor that quietly changes a recorded response is the thing
 * the baseline exists to catch.
 */
export function currentRate() {
  const { usdToEur, manual = {}, rateFetchedAt, autoRate } = loadSettings().currency || {};
  const value = manual.USD ?? usdToEur ?? 0.92;
  const ageDays = rateFetchedAt ? (Date.now() - Date.parse(rateFetchedAt)) / 86400000 : null;
  return {
    usdToEur: value,
    at: rateFetchedAt ?? null,
    manual: manual.USD != null || !rateFetchedAt,
    stale: Boolean(autoRate && ageDays != null && ageDays > STALE_AFTER_DAYS),
  };
}

/** Backwards-compatible single-rate refresh, for the original route. */
export async function refreshRate({ force = false } = {}) {
  const result = await refreshRates({ force });
  if (!result.fetched) return { fetched: false, ...currentRate() };
  return { fetched: true, usdToEur: currentRate().usdToEur, at: result.at, stale: false };
}
