/**
 * Position and P&L maths for the CS2 investment ledger.
 *
 * Cost basis is a weighted average over all purchases, which is what the
 * Pricempire UI shows and what survives the export's quirks: the file contains
 * items sold in larger quantities than were ever bought (inventory that
 * predates the portfolio), so a strict FIFO lot-matching would either throw or
 * silently drop the excess. Those items are flagged instead.
 */

const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export function computePositions(transactions, prices = []) {
  const priceByName = new Map(prices.map((p) => [p.name, p.price]));
  const items = new Map();

  for (const tx of transactions) {
    let item = items.get(tx.name);
    if (!item) {
      item = {
        name: tx.name,
        boughtQty: 0,
        boughtCost: 0,
        soldQty: 0,
        soldGross: 0,
        soldNet: 0,
        fees: 0,
        transactions: 0,
        firstDate: tx.date,
        lastDate: tx.date,
        marketplaces: new Set(),
        currency: tx.currency || 'USD',
        floatValue: null,
        paintSeed: null,
      };
      items.set(tx.name, item);
    }

    item.transactions++;
    if (tx.date < item.firstDate) item.firstDate = tx.date;
    if (tx.date > item.lastDate) item.lastDate = tx.date;
    if (tx.marketplace) item.marketplaces.add(tx.marketplace);
    if (tx.floatValue != null) item.floatValue = tx.floatValue;
    if (tx.paintSeed != null) item.paintSeed = tx.paintSeed;

    if (tx.type === 'buy') {
      item.boughtQty += tx.quantity;
      // A purchase fee adds to what the item cost.
      const fee = tx.feeAmount || (tx.totalPrice * (tx.feePercentage || 0)) / 100;
      item.boughtCost += tx.totalPrice + fee;
      item.fees += fee;
    } else {
      item.soldQty += tx.quantity;
      const fee = tx.feeAmount || (tx.totalPrice * (tx.feePercentage || 0)) / 100;
      item.soldGross += tx.totalPrice;
      item.soldNet += tx.totalPrice - fee;
      item.fees += fee;
    }
  }

  return [...items.values()]
    .map((item) => {
      const avgCost = item.boughtQty > 0 ? item.boughtCost / item.boughtQty : 0;
      const heldQty = item.boughtQty - item.soldQty;
      const marketPrice = priceByName.get(item.name) ?? null;

      // Only the quantity actually covered by purchases has a cost to recover.
      const costOfSold = avgCost * Math.min(item.soldQty, item.boughtQty);
      const realizedPnl = item.soldNet - costOfSold;

      const investedRemaining = avgCost * Math.max(heldQty, 0);
      const marketValue = marketPrice != null ? marketPrice * Math.max(heldQty, 0) : null;
      const unrealizedPnl = marketValue != null ? marketValue - investedRemaining : null;

      return {
        name: item.name,
        currency: item.currency,
        boughtQty: item.boughtQty,
        soldQty: item.soldQty,
        heldQty,
        avgCost: round(avgCost),
        investedTotal: round(item.boughtCost),
        investedRemaining: round(investedRemaining),
        soldGross: round(item.soldGross),
        soldNet: round(item.soldNet),
        fees: round(item.fees),
        realizedPnl: round(realizedPnl),
        marketPrice,
        marketValue: marketValue == null ? null : round(marketValue),
        unrealizedPnl: unrealizedPnl == null ? null : round(unrealizedPnl),
        roi:
          investedRemaining > 0 && unrealizedPnl != null
            ? round((unrealizedPnl / investedRemaining) * 100)
            : null,
        transactions: item.transactions,
        firstDate: item.firstDate,
        lastDate: item.lastDate,
        marketplaces: [...item.marketplaces],
        floatValue: item.floatValue,
        paintSeed: item.paintSeed,
        // Sells exceeding buys means the export is missing the original
        // acquisition; the realized figure below understates the true cost.
        quantityMismatch: item.soldQty > item.boughtQty,
      };
    })
    .sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0));
}

export function computeSummary(positions) {
  const held = positions.filter((p) => p.heldQty > 0);
  const sum = (list, key) => list.reduce((s, p) => s + (p[key] || 0), 0);

  const marketValue = sum(held, 'marketValue');
  const investedRemaining = sum(held, 'investedRemaining');
  const unrealizedPnl = marketValue - investedRemaining;
  const realizedPnl = sum(positions, 'realizedPnl');

  return {
    currency: positions[0]?.currency || 'USD',
    items: positions.length,
    itemsHeld: held.length,
    unitsHeld: sum(held, 'heldQty'),
    marketValue: round(marketValue),
    investedRemaining: round(investedRemaining),
    investedTotal: round(sum(positions, 'investedTotal')),
    soldNet: round(sum(positions, 'soldNet')),
    fees: round(sum(positions, 'fees')),
    realizedPnl: round(realizedPnl),
    unrealizedPnl: round(unrealizedPnl),
    totalPnl: round(realizedPnl + unrealizedPnl),
    roi: investedRemaining > 0 ? round((unrealizedPnl / investedRemaining) * 100) : null,
    mismatches: positions.filter((p) => p.quantityMismatch).length,
  };
}

export function computeByMarketplace(transactions) {
  const map = new Map();
  for (const tx of transactions) {
    const key = tx.marketplace || 'desconhecido';
    const entry = map.get(key) || { marketplace: key, buys: 0, sells: 0, spent: 0, received: 0, fees: 0 };
    const fee = tx.feeAmount || (tx.totalPrice * (tx.feePercentage || 0)) / 100;
    if (tx.type === 'buy') {
      entry.buys++;
      entry.spent += tx.totalPrice + fee;
    } else {
      entry.sells++;
      entry.received += tx.totalPrice - fee;
    }
    entry.fees += fee;
    map.set(key, entry);
  }
  return [...map.values()]
    .map((e) => ({
      ...e,
      spent: round(e.spent),
      received: round(e.received),
      fees: round(e.fees),
      net: round(e.received - e.spent),
    }))
    .sort((a, b) => b.spent + b.received - (a.spent + a.received));
}

/**
 * Cumulative money in and out, month by month.
 *
 * This is the part of "value over time" that can honestly be reconstructed
 * from the export: it holds today's market price, not a price history. The
 * market-value curve has to be accumulated from snapshots taken at each import.
 */
export function computeCashTimeline(transactions) {
  const months = new Map();
  for (const tx of transactions) {
    const key = tx.date.slice(0, 7);
    const entry = months.get(key) || { month: key, spent: 0, received: 0 };
    const fee = tx.feeAmount || (tx.totalPrice * (tx.feePercentage || 0)) / 100;
    if (tx.type === 'buy') entry.spent += tx.totalPrice + fee;
    else entry.received += tx.totalPrice - fee;
    months.set(key, entry);
  }

  let cumulativeSpent = 0;
  let cumulativeReceived = 0;
  return [...months.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => {
      cumulativeSpent += m.spent;
      cumulativeReceived += m.received;
      return {
        month: m.month,
        spent: round(m.spent),
        received: round(m.received),
        cumulativeSpent: round(cumulativeSpent),
        cumulativeReceived: round(cumulativeReceived),
        netInvested: round(cumulativeSpent - cumulativeReceived),
      };
    });
}

/** Market value at each import, so the curve grows as snapshots accumulate. */
export function computeValueTimeline(snapshots) {
  return snapshots
    .filter((s) => s.provider === 'pricempire-csv' || s.items?.length)
    .map((s) => ({
      date: s.date,
      value: round((s.items || []).reduce((sum, i) => sum + (i.value || 0), 0)),
      items: (s.items || []).length,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
