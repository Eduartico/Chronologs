import { createHash } from 'crypto';
import { createEvent, appendIfNew } from '../../server/ledger/eventStore.js';
import { loadAssets, saveAssets } from '../../server/ledger/fileStore.js';
import { notify } from '../../server/lib/notify.js';
import { runRules } from '../../server/engines/rules.js';
import { ensureSession, loadPricempireState, savePricempireState } from './browser.js';
import { listPortfolios, scrapePortfolio } from './scrape.js';
import { downloadPortfolioCsv } from './export.js';
import { importPricempireCsv } from './importer.js';

function makeTransactionId(portfolioId, name, buyDate, buyPrice) {
  const digest = createHash('sha1')
    .update(`${portfolioId}|${name}|${buyDate}|${buyPrice}`)
    .digest('hex')
    .slice(0, 8);
  return `pricempire-${buyDate}-${digest}`;
}

export async function fetchPortfolioList() {
  const page = await ensureSession({ interactive: false });
  return listPortfolios(page);
}

/**
 * Resyncs by downloading each portfolio's CSV export and running it through the
 * importer used for manual uploads.
 *
 * This is the path the "Ressincronizar" button takes. The export is the site's
 * own view of the portfolio — buys, sells, fees, marketplaces and current
 * prices — whereas the scraper below can only see what a page happened to fetch
 * while it was open. When the export button cannot be found, the scraper runs
 * as a fallback and the notification says so, because a silent downgrade to
 * worse data is the failure that would be hardest to notice.
 */
export async function syncPricempire({ allowScrapeFallback = true } = {}) {
  const state = loadPricempireState();
  if (!state.selectedPortfolios || state.selectedPortfolios.length === 0) {
    throw new Error('Nenhum portefólio seleccionado — escolhe-os em Ligações');
  }

  const page = await ensureSession({ interactive: false });
  const result = {
    method: 'csv-export',
    portfolios: 0,
    parsed: 0,
    new: 0,
    duplicates: 0,
    prices: 0,
    items: 0,
    files: [],
    errors: [],
  };

  const failures = [];

  for (const portfolioId of state.selectedPortfolios) {
    try {
      const { buffer, filename, path } = await downloadPortfolioCsv(page, portfolioId);
      const imported = await importPricempireCsv(buffer, { filename });
      result.portfolios++;
      result.parsed += imported.parsed;
      result.new += imported.new;
      result.duplicates += imported.duplicates;
      result.prices += imported.prices;
      result.items += imported.summary?.positions ?? 0;
      result.files.push(path);
    } catch (err) {
      failures.push(`${portfolioId}: ${err.message}`);
    }
  }

  // Nothing came through at all — fall back rather than leave the user with an
  // empty portfolio and no explanation.
  if (result.portfolios === 0 && allowScrapeFallback) {
    notify(
      'warning',
      'notify.pricempire.exportUnavailable',
      { detail: failures.join('; ') },
      { module: 'pricempire', failures }
    );
    const scraped = await ingestPricempire();
    return { ...scraped, method: 'scrape-fallback', errors: failures };
  }

  result.errors = failures;
  savePricempireState({ lastSync: new Date().toISOString(), sessionOk: true });

  notify(
    failures.length > 0 ? 'warning' : 'success',
    'notify.pricempire.resynced',
    {
      imported: result.new,
      rows: result.parsed,
      portfolios: result.portfolios,
      duplicates: result.duplicates || 0,
      failures: failures.length,
    },
    { module: 'pricempire', ...result }
  );

  return result;
}

/**
 * Scrapes every selected portfolio: emits purchase `transaction` events (when
 * the item carries a buy date+price), one `asset_snapshot` for the holdings
 * and `price_update` events per item. Updates assets.json.
 */
export async function ingestPricempire() {
  const state = loadPricempireState();
  if (!state.selectedPortfolios || state.selectedPortfolios.length === 0) {
    throw new Error('No Pricempire portfolios selected — choose them in Connections');
  }

  const page = await ensureSession({ interactive: false });
  const result = { portfolios: 0, items: 0, new: 0, duplicates: 0, newTransactionIds: [] };
  const allItems = [];

  for (const portfolioId of state.selectedPortfolios) {
    const { holdings } = await scrapePortfolio(page, portfolioId);
    result.portfolios++;
    result.items += holdings.length;

    for (const h of holdings) {
      allItems.push({ ...h, portfolioId });

      if (h.buyDate && h.buyPrice != null) {
        const txId = makeTransactionId(portfolioId, h.name, h.buyDate, h.buyPrice);
        const event = createEvent('transaction', 'pricempire', {
          transaction_id: txId,
          date: h.buyDate,
          description: `Buy ${h.quantity}x ${h.name}`,
          merchant: 'pricempire',
          amount: -Math.abs(h.buyPrice * h.quantity),
          currency: 'EUR',
          source: 'pricempire',
          portfolio_id: portfolioId,
        });
        const isNew = await appendIfNew(event);
        if (isNew) {
          result.new++;
          result.newTransactionIds.push(txId);
        } else {
          result.duplicates++;
        }
      }

      if (h.currentPrice != null) {
        const priceEvent = createEvent('price_update', 'pricempire', {
          symbol: h.name,
          price: h.currentPrice,
          currency: 'EUR',
          timestamp: new Date().toISOString().slice(0, 10),
        });
        await appendIfNew(priceEvent);
      }
    }
  }

  const snapshot = createEvent('asset_snapshot', 'pricempire', {
    provider: 'pricempire',
    items: allItems.map((h) => ({
      name: h.name,
      type: 'cs2_skin',
      source: 'pricempire',
      quantity: h.quantity,
      price: h.currentPrice,
      value: (h.currentPrice || 0) * h.quantity,
      currency: 'EUR',
    })),
    date: new Date().toISOString().slice(0, 10),
  });
  await appendIfNew(snapshot);

  // Replace pricempire assets in the registry with the fresh holdings
  const otherAssets = loadAssets().filter((a) => a.source !== 'pricempire');
  const pricempireAssets = allItems.map((h) => ({
    name: h.name,
    symbol: h.name,
    type: 'cs2_skin',
    class: 'cs2_skin',
    source: 'pricempire',
    quantity: h.quantity,
    costBasis: h.buyPrice != null ? h.buyPrice * h.quantity : null,
    purchaseValue: h.buyPrice != null ? h.buyPrice * h.quantity : null,
    currentValue: (h.currentPrice || 0) * h.quantity,
    lastPrice: h.currentPrice,
    lastPriceDate: new Date().toISOString(),
    currency: 'EUR',
    portfolioId: h.portfolioId,
  }));
  saveAssets([...otherAssets, ...pricempireAssets]);

  savePricempireState({ lastSync: new Date().toISOString(), sessionOk: true });

  if (result.newTransactionIds.length > 0) {
    try {
      await runRules({ transactionIds: result.newTransactionIds });
    } catch {}
    try {
      const { runCorrelations } = await import('../../server/engines/correlation.js');
      await runCorrelations();
    } catch {}
  }

  notify(
    'success',
    'notify.sync.pricempire',
    { imported: result.new, holdings: result.items },
    { module: 'pricempire', ...result }
  );

  return result;
}
