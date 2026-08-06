/**
 * The dollar-to-euro rate.
 *
 * The CS2 side of the ledger is quoted in dollars and the bank side in euros,
 * and the app used to render both at once — "$1.406,20 (~€1.284,50)" in every
 * cell of every table, which is two numbers where the reader wanted one. Showing
 * a single currency means converting, and converting means a rate.
 *
 * The rate was typed into Settings by hand and never revisited, so it silently
 * drifted. This fetches it from the same Yahoo endpoint the ETF quotes already
 * use — same discipline: opt-in, never fatal, and the hand-entered value stays
 * as the fallback for anyone who would rather not reach the network at all.
 *
 * `EURUSD=X` is dollars per euro; the app stores euros per dollar, which is its
 * reciprocal.
 */
import { loadSettings, saveSettings } from '../../lib/settings.js';

const CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/EURUSD%3DX';
const TIMEOUT_MS = 12000;

/** A rate older than this is reported as stale rather than trusted silently. */
export const STALE_AFTER_DAYS = 7;

export function autoRateEnabled() {
  return loadSettings().currency?.autoRate === true;
}

/**
 * The live rate, or null. Returns rather than throws: a missing rate falls back
 * on the stored one, and a broken exchange feed must not break the page.
 */
export async function fetchUsdToEur() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${CHART_URL}?interval=1d&range=5d`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Chronologs)' },
    });
    if (!res.ok) return null;
    const body = await res.json();
    const usdPerEur = body?.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (!Number.isFinite(usdPerEur) || usdPerEur <= 0) return null;
    return {
      usdToEur: Math.round((1 / usdPerEur) * 1e6) / 1e6,
      usdPerEur,
      at: new Date().toISOString(),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches and stores the rate. Unlike a price, a rate is not ledger history —
 * it is a display setting, so it lives in settings rather than as an event.
 */
export async function refreshRate({ force = false } = {}) {
  if (!force && !autoRateEnabled()) {
    throw new Error('Câmbio automático desligado — activa-o em Definições');
  }

  const quote = await fetchUsdToEur();
  if (!quote) return { fetched: false, ...currentRate() };

  const settings = loadSettings();
  saveSettings({
    currency: { ...settings.currency, usdToEur: quote.usdToEur, rateFetchedAt: quote.at },
  });

  return { fetched: true, usdToEur: quote.usdToEur, at: quote.at, stale: false };
}

/** What the app is using right now, and whether it is old enough to distrust. */
export function currentRate() {
  const { usdToEur, rateFetchedAt, autoRate } = loadSettings().currency || {};
  const ageDays = rateFetchedAt
    ? (Date.now() - Date.parse(rateFetchedAt)) / 86400000
    : null;
  return {
    usdToEur: usdToEur ?? 0.92,
    at: rateFetchedAt ?? null,
    manual: !rateFetchedAt,
    // A hand-entered rate is never called stale: nobody promised it was live.
    stale: Boolean(autoRate && ageDays != null && ageDays > STALE_AFTER_DAYS),
  };
}
