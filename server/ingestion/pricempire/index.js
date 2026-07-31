import { createHash } from 'crypto';
import { createEvent, appendIfNew } from '../../ledger/eventStore.js';
import { loadAssets, saveAssets } from '../../ledger/fileStore.js';
import { notify } from '../../lib/notify.js';
import { runRules } from '../../engines/rules.js';
import { ensureSession, loadPricempireState, savePricempireState } from './browser.js';
import { listPortfolios, scrapePortfolio } from './scrape.js';

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
      const { runCorrelations } = await import('../../engines/correlation.js');
      await runCorrelations();
    } catch {}
  }

  notify(
    'success',
    'Pricempire sync',
    `${result.items} items across ${result.portfolios} portfolio(s), ${result.new} new purchase transactions`,
    { module: 'pricempire', ...result }
  );

  return result;
}
