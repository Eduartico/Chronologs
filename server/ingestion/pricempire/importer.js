/**
 * Turns a Pricempire CSV export into ledger events.
 *
 * Purchases and sales are written as `investment_transaction`, a new event type
 * kept deliberately separate from the bank's `transaction` events: skins would
 * otherwise flood the pending-review queue with a few hundred rows that need no
 * categorizing. The holdings still reach net worth through assets.json.
 */
import { createEvent, loadLedgerIndex, appendIfNewIndexed } from '../../ledger/eventStore.js';
import { loadAssets, saveAssets } from '../../ledger/fileStore.js';
import { notify } from '../../lib/notify.js';
import { parsePricempireCsv } from './csv.js';
import { computePositions, computeSummary } from '../../engines/portfolio.js';

export async function importPricempireCsv(buffer, { filename = 'export.csv' } = {}) {
  const { transactions, prices, unparsedLines } = parsePricempireCsv(buffer);

  if (transactions.length === 0) {
    throw new Error(
      unparsedLines[0] || 'Nenhuma transacção reconhecida no CSV — confirma que é o export do Pricempire'
    );
  }

  const index = await loadLedgerIndex();
  const result = {
    filename,
    parsed: transactions.length,
    new: 0,
    duplicates: 0,
    prices: 0,
    unparsedLines: unparsedLines.length,
  };

  for (const tx of transactions) {
    const event = createEvent('investment_transaction', 'pricempire-csv', {
      investment_transaction_id: tx.id,
      date: tx.date,
      name: tx.name,
      type: tx.type,
      quantity: tx.quantity,
      unit_price: tx.unitPrice,
      total_price: tx.totalPrice,
      fee_amount: tx.feeAmount,
      fee_percentage: tx.feePercentage,
      marketplace: tx.marketplace,
      note: tx.note,
      float_value: tx.floatValue,
      paint_seed: tx.paintSeed,
      steam_asset_id: tx.steamAssetId,
      currency: tx.currency,
    });
    if (appendIfNewIndexed(event, index)) result.new++;
    else result.duplicates++;
  }

  const asOf = new Date().toISOString().slice(0, 10);
  for (const p of prices) {
    const event = createEvent('price_update', 'pricempire-csv', {
      symbol: p.name,
      price: p.price,
      currency: p.currency,
      timestamp: asOf,
    });
    if (appendIfNewIndexed(event, index)) result.prices++;
  }

  const positions = computePositions(transactions, prices);
  const held = positions.filter((p) => p.heldQty > 0);

  // One snapshot per import is what builds the market-value curve over time —
  // the export itself carries no price history.
  const snapshot = createEvent('asset_snapshot', 'pricempire-csv', {
    provider: 'pricempire-csv',
    date: asOf,
    items: held.map((p) => ({
      name: p.name,
      type: 'cs2_skin',
      source: 'pricempire-csv',
      quantity: p.heldQty,
      price: p.marketPrice,
      value: p.marketValue || 0,
      currency: p.currency,
    })),
  });
  appendIfNewIndexed(snapshot, index);

  // Replace this source's rows in the asset registry so net worth reflects the
  // latest import without duplicating holdings.
  const others = loadAssets().filter((a) => a.source !== 'pricempire-csv');
  saveAssets([
    ...others,
    ...held.map((p) => ({
      name: p.name,
      symbol: p.name,
      type: 'cs2_skin',
      class: 'cs2_skin',
      source: 'pricempire-csv',
      quantity: p.heldQty,
      costBasis: p.investedRemaining,
      purchaseValue: p.investedRemaining,
      currentValue: p.marketValue || 0,
      lastPrice: p.marketPrice,
      lastPriceDate: asOf,
      currency: p.currency,
    })),
  ]);

  result.summary = computeSummary(positions);

  notify(
    'success',
    'Import Pricempire',
    `${result.new} novas transacções de ${result.parsed} linhas · ${held.length} itens em carteira`,
    { module: 'pricempire-csv', ...result }
  );

  return result;
}
