import { createEvent, appendIfNew } from '../ledger/eventStore.js';
import { saveAssets, loadAssets } from '../ledger/fileStore.js';

/**
 * Manual input module for custom transactions and assets.
 */

export async function ingestManualTransaction({
  description,
  merchant,
  amount,
  currency = 'EUR',
  date,
  amortize = null,
}) {
  const txDate = date || new Date().toISOString().slice(0, 10);
  const transactionId = `manual-${txDate}-${Date.now()}`;

  const payload = {
    transaction_id: transactionId,
    date: txDate,
    description: description || merchant || 'Manual entry',
    merchant: merchant || '',
    amount: parseFloat(amount),
    currency,
    source: 'manual',
    amortize: amortize || null,
  };

  const event = createEvent('transaction', 'manual', payload);
  const isNew = await appendIfNew(event);
  return { event, isNew };
}

export async function ingestManualAsset({
  name,
  type = 'manual',
  value,
  currency = 'EUR',
  quantity = 1,
  notes = '',
}) {
  const timestamp = new Date().toISOString();
  const payload = {
    name,
    type,
    source: 'manual',
    value: parseFloat(value) * quantity,
    currency,
    quantity,
    notes,
    timestamp,
  };

  const event = createEvent('asset_snapshot', 'manual', {
    items: [
      {
        name,
        type,
        source: 'manual',
        quantity,
        price: parseFloat(value),
        value: parseFloat(value) * quantity,
        currency,
      },
    ],
    provider: 'manual',
  });
  const isNew = await appendIfNew(event);

  // Update assets.json
  const assets = loadAssets();
  const idx = assets.findIndex((a) => a.name === name && a.type === type);
  const entry = {
    name,
    symbol: name,
    type,
    class: type,
    source: 'manual',
    quantity,
    purchaseValue: parseFloat(value) * quantity,
    costBasis: parseFloat(value) * quantity,
    currentValue: parseFloat(value) * quantity,
    lastPrice: parseFloat(value),
    lastPriceDate: timestamp,
    currency,
    notes,
  };
  if (idx >= 0) {
    assets[idx] = { ...assets[idx], ...entry };
  } else {
    assets.push(entry);
  }
  saveAssets(assets);

  return { event, isNew };
}