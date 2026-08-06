/**
 * Market quotes for the ETFs held through ActivoBank.
 *
 * The bank prints no ticker, no ISIN and no current price — a statement is a
 * cash record, not a portfolio report. Without an outside quote the positions
 * screen can only ever show what was paid, so this fetches the last close from
 * Yahoo Finance's chart endpoint and records it as a normal `price_update`
 * event, the same shape Pricempire already writes.
 *
 * It is off unless `settings.quotes.enabled` is set: everything else in
 * Chronologs works with no network at all, and that stays the user's choice.
 * Failures are reported, never fatal — a stale price is better than a broken
 * page, and manual prices remain available.
 */
import { createEvent, loadLedgerIndex, appendIfNewIndexed } from '../../ledger/eventStore.js';
import { loadSettings } from '../../lib/settings.js';
import { notify } from '../../lib/notify.js';
import { loadSecurities } from '../../engines/securities.js';

const CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const TIMEOUT_MS = 12000;

export function quotesEnabled() {
  return loadSettings().quotes?.enabled === true;
}

/**
 * Last close for one symbol. Returns null rather than throwing: one delisted or
 * mistyped ticker must not abort the whole refresh.
 */
export async function fetchQuote(symbol) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${CHART_URL}/${encodeURIComponent(symbol)}?interval=1d&range=5d`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Chronologs)' },
    });
    if (!res.ok) return null;
    const body = await res.json();
    const result = body?.chart?.result?.[0];
    const meta = result?.meta;
    const price = meta?.regularMarketPrice;
    if (!Number.isFinite(price)) return null;
    return {
      symbol,
      price,
      currency: meta.currency || 'EUR',
      at: meta.regularMarketTime
        ? new Date(meta.regularMarketTime * 1000).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Refreshes every security in the registry that has a symbol.
 *
 * A price event is written once per symbol per day — the payload includes the
 * date, so the ledger's content hash makes a second run on the same day a
 * no-op rather than a duplicate.
 */
export async function refreshQuotes({ force = false } = {}) {
  if (!force && !quotesEnabled()) {
    throw new Error('Cotações online desligadas — activa-as em Definições');
  }

  const securities = loadSecurities().filter((s) => s.symbol);
  const result = { requested: securities.length, fetched: 0, written: 0, failed: [] };

  if (securities.length === 0) return result;

  const index = await loadLedgerIndex();

  for (const security of securities) {
    const quote = await fetchQuote(security.symbol);
    if (!quote) {
      result.failed.push(security.symbol);
      continue;
    }
    result.fetched++;

    // Recorded under the security's own name as well as its ticker, so the
    // positions view can look it up either way.
    for (const symbol of [security.symbol, security.title]) {
      const ev = createEvent('price_update', 'yahoo', {
        symbol,
        price: quote.price,
        currency: quote.currency,
        timestamp: quote.at,
      });
      if (appendIfNewIndexed(ev, index)) result.written++;
    }
  }

  notify(
    result.failed.length > 0 ? 'warning' : 'success',
    'Cotações actualizadas',
    `${result.fetched} de ${result.requested} títulos${result.failed.length ? ` · sem cotação: ${result.failed.join(', ')}` : ''}`,
    { module: 'quotes', ...result }
  );

  return result;
}
