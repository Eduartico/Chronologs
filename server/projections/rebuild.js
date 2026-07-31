import { replayEvents } from '../ledger/eventStore.js';
import { loadAssets, loadCategories, loadRules } from '../ledger/fileStore.js';

export async function buildProjections() {
  const events = await replayEvents();

  // Transaction projections: only 'transaction' events
  const rawTransactions = events.filter((e) => e.type === 'transaction');

  // Build transactions list with category assignments overlaid
  const categoryMap = {};
  const overrides = {};
  const ruleApplications = {};

  const tagsByTransaction = {};
  const removedTagsByTransaction = {};
  const linksByTransaction = {};

  for (const ev of events) {
    if (ev.type === 'category_assignment') {
      const key = ev.payload.event_id;
      // Manual overrides always win, even against assignments that were
      // appended to the ledger after the override.
      if (!(key in overrides)) {
        categoryMap[key] = ev.payload.category;
      }
      if (ev.payload.rule_id) {
        ruleApplications[key] = ev.payload.rule_id;
      }
    }
    if (ev.type === 'manual_override') {
      overrides[ev.payload.event_id] = {
        original: ev.payload.original_category,
        new: ev.payload.new_category,
      };
      categoryMap[ev.payload.event_id] = ev.payload.new_category;
    }
    if (ev.type === 'tag_assignment') {
      const txId = ev.payload.transaction_id;
      const set = (tagsByTransaction[txId] ||= new Set());
      set.add(ev.payload.tag_id);
      removedTagsByTransaction[txId]?.delete(ev.payload.tag_id);
    }
    if (ev.type === 'tag_removal') {
      const txId = ev.payload.transaction_id;
      tagsByTransaction[txId]?.delete(ev.payload.tag_id);
      if (ev.source === 'manual') {
        // Manually removed tags are blocked from rule re-application.
        (removedTagsByTransaction[txId] ||= new Set()).add(ev.payload.tag_id);
      }
    }
    if (ev.type === 'transaction_link') {
      for (const txId of ev.payload.transaction_ids || []) {
        (linksByTransaction[txId] ||= []).push({
          linkId: ev.payload.link_id,
          ruleId: ev.payload.rule_id || null,
          transactionIds: ev.payload.transaction_ids,
          note: ev.payload.note || null,
        });
      }
    }
  }

  const transactions = rawTransactions.map((ev) => {
    const stableId = ev.payload.transaction_id || ev.id;
    // Older ledger events keyed assignments by the event uuid instead of the
    // stable transaction id — honor both.
    const category = categoryMap[stableId] ?? categoryMap[ev.id];
    const override = overrides[stableId] ?? overrides[ev.id];
    return {
      id: stableId,
      eventId: ev.id,
      date: ev.payload.date || ev.timestamp,
      description: ev.payload.description || '',
      merchant: ev.payload.merchant || '',
      amount: ev.payload.amount,
      currency: ev.payload.currency || 'EUR',
      category: category || 'uncategorized',
      source: ev.source,
      status: override ? 'overridden' : category ? 'categorized' : 'pending',
      overridden: !!override,
      originalCategory: override?.original || null,
      amortize: ev.payload.amortize || null,
      tags: [...(tagsByTransaction[stableId] || [])],
      removedTags: [...(removedTagsByTransaction[stableId] || [])],
      links: linksByTransaction[stableId] || [],
      raw: ev,
    };
  });

  // Investment transactions are projected separately from bank transactions on
  // purpose: they need no categorizing, and mixing them in would bury the
  // pending-review queue under a few hundred skin trades.
  const investments = events
    .filter((e) => e.type === 'investment_transaction')
    .map((ev) => ({
      id: ev.payload.investment_transaction_id || ev.id,
      date: ev.payload.date,
      name: ev.payload.name,
      type: ev.payload.type,
      quantity: ev.payload.quantity,
      unitPrice: ev.payload.unit_price,
      totalPrice: ev.payload.total_price,
      feeAmount: ev.payload.fee_amount || 0,
      feePercentage: ev.payload.fee_percentage || 0,
      marketplace: ev.payload.marketplace,
      note: ev.payload.note,
      floatValue: ev.payload.float_value,
      paintSeed: ev.payload.paint_seed,
      steamAssetId: ev.payload.steam_asset_id,
      currency: ev.payload.currency || 'USD',
      source: ev.source,
    }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  // Asset snapshots from events
  const snapshotEvents = events.filter((e) => e.type === 'asset_snapshot');
  const assetSnapshots = snapshotEvents.map((ev) => ({
    date: ev.payload.date || ev.timestamp.slice(0, 10),
    provider: ev.payload.provider || ev.source,
    items: ev.payload.items || ev.payload.assets || [],
    raw: ev,
  }));

  // Price updates
  const priceEvents = events.filter((e) => e.type === 'price_update');
  const priceMap = {};
  for (const ev of priceEvents) {
    const symbol = ev.payload.symbol || ev.payload.ticker || ev.payload.name;
    if (symbol) priceMap[symbol] = ev.payload;
  }

  // Assets from assets.json plus price updates
  const storedAssets = loadAssets();
  const assets = storedAssets.map((a) => {
    const price = priceMap[a.symbol || a.name];
    const currentValue = price ? price.price * (a.quantity || 1) : a.currentValue || a.value || 0;
    return {
      ...a,
      currentValue,
      lastPrice: price?.price || a.lastPrice,
      lastPriceDate: price?.timestamp || a.lastPriceDate,
    };
  });

  return {
    events,
    transactions,
    investments,
    categoryMap,
    overrides,
    assetSnapshots,
    assets,
    priceEvents,
    priceMap,
    tagsByTransaction,
    linksByTransaction,
  };
}