/**
 * Exchange-traded holdings bought through ActivoBank.
 *
 * Two documents describe one purchase and neither is complete on its own:
 *
 *   the trade receipt  → full name, market, quantity, quote, but no real cost
 *                        ("Preço 0,00" — it was a market order)
 *   the statement line → the exact euros that left the account, but the name
 *                        truncated to whatever fits: "COMPRA BOLSA..OP.390545877
 *                        DE ISH CORE MSCI W"
 *
 * This module reconciles the two and keeps the pairing as a `transaction_link`
 * event — the same link type the correlation engine already emits, so the 🔗
 * marker in the transactions table works without any further change.
 *
 * Matching is on the abbreviation, not on equality: "ISH CORE MSCI W" has to
 * recognise "iShares Core MSCI World ETF USD Acc", so statement tokens are
 * tested as prefixes of receipt tokens.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { createEvent, loadLedgerIndex, appendIfNewIndexed } from '../ledger/eventStore.js';
import { statePath } from '../lib/paths.js';
import { stripAccents } from '../lib/merchant.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULTS_FILE = join(__dirname, '..', 'config', 'defaults', 'securities.json');
const REGISTRY_FILE = 'securities.json';

// How the statement writes an exchange order.
const STATEMENT_ORDER = /^(COMPRA|VENDA)\s+BOLSA\.*\s*OP\.?\s*(\d+)?\s*DE\s+(.+)$/i;
// Brokerage fees ride alongside and belong to the securities view, not to
// everyday spending.
const BROKERAGE_FEE = /Comiss[ãa]o\s+de\s+Servi[çc]o\s+de\s+Bolsa/i;

// A receipt is dated when the order was placed; settlement lands a few days on.
const SETTLEMENT_WINDOW_DAYS = 7;
// Market orders execute away from the quoted price, and commission is added.
const AMOUNT_TOLERANCE = 0.15;
// Fraction of the abbreviated statement name that must be recognised.
const NAME_MATCH_THRESHOLD = 0.6;

// ---------- registry ----------

function registryFile() {
  return statePath(REGISTRY_FILE);
}

/**
 * The bank never prints a ticker or ISIN, so the mapping from a security's name
 * to something a quote provider understands has to live here. Seeded with the
 * ETFs found in the mailbox and editable, which is where a name that stops
 * matching gets repaired.
 */
export function loadSecurities() {
  const defaults = JSON.parse(readFileSync(DEFAULTS_FILE, 'utf-8'));
  if (!existsSync(registryFile())) {
    writeFileSync(registryFile(), JSON.stringify(defaults, null, 2), 'utf-8');
    return defaults;
  }
  try {
    const stored = JSON.parse(readFileSync(registryFile(), 'utf-8'));
    // Seed anything new without touching what the user has edited.
    let changed = false;
    for (const d of defaults) {
      if (!stored.some((s) => s.title === d.title || s.isin === d.isin)) {
        stored.push(d);
        changed = true;
      }
    }
    if (changed) writeFileSync(registryFile(), JSON.stringify(stored, null, 2), 'utf-8');
    return stored;
  } catch {
    return defaults;
  }
}

export function saveSecurities(list) {
  writeFileSync(registryFile(), JSON.stringify(list, null, 2), 'utf-8');
  return list;
}

export function upsertSecurity(entry) {
  const list = loadSecurities();
  const existing = list.find((s) => s.title === entry.title);
  if (existing) Object.assign(existing, entry);
  else list.push({ ...entry });
  return saveSecurities(list);
}

export function securityFor(title) {
  const wanted = normalizeName(title);
  return (
    loadSecurities().find((s) => normalizeName(s.title) === wanted) ||
    loadSecurities().find((s) => nameScore(title, s.title) >= NAME_MATCH_THRESHOLD) ||
    null
  );
}

// ---------- name matching ----------

function tokens(name) {
  return stripAccents(String(name || ''))
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);
}

function normalizeName(name) {
  return tokens(name).join(' ');
}

/**
 * How much of `abbreviated` is recognisable inside `full`, as a 0..1 score.
 * Every statement token must be a prefix of some receipt token — that is what
 * makes "VANG FT ALL WLD" resolve to "Vanguard FTSE All-World ETF USD Acc".
 */
export function nameScore(abbreviated, full) {
  const shortTokens = tokens(abbreviated);
  const longTokens = tokens(full);
  if (shortTokens.length === 0 || longTokens.length === 0) return 0;
  const hits = shortTokens.filter((s) => longTokens.some((l) => l.startsWith(s))).length;
  return hits / shortTokens.length;
}

// ---------- statement side ----------

/** Reads an exchange purchase out of a statement descriptor. */
export function parseStatementOrder(description) {
  const m = String(description || '').match(STATEMENT_ORDER);
  if (!m) return null;
  return {
    side: /venda/i.test(m[1]) ? 'sell' : 'buy',
    orderRef: m[2] || null,
    security: m[3].trim(),
  };
}

export function isBrokerageFee(description) {
  return BROKERAGE_FEE.test(String(description || ''));
}

/** Every statement line that belongs to the securities account. */
export function securityTransactions(transactions) {
  return transactions.filter(
    (t) => parseStatementOrder(t.description) || isBrokerageFee(t.description)
  );
}

// ---------- reconciliation ----------

function dayNumber(dateStr) {
  const t = new Date(`${String(dateStr).slice(0, 10)}T00:00:00Z`).getTime();
  return Number.isFinite(t) ? Math.round(t / 86400000) : null;
}

/**
 * Pairs each order receipt with the bank debit that paid for it.
 *
 * A candidate has to clear three independent checks — name, settlement window
 * and expected amount — because a single one is not enough: two purchases of
 * the same ETF a week apart differ only in price.
 */
export function matchOrders(orders, transactions) {
  const statementRows = transactions
    .map((tx) => ({ tx, parsed: parseStatementOrder(tx.description) }))
    .filter((r) => r.parsed);

  const used = new Set();
  const matches = [];
  const unmatched = [];

  for (const order of orders) {
    const orderDay = dayNumber(order.date);
    const expected = order.quantity * (order.quote ?? order.price ?? 0);

    const candidates = statementRows
      .filter((row) => {
        if (used.has(row.tx.id)) return false;
        if (row.parsed.side !== order.side) return false;

        const day = dayNumber(row.tx.date);
        if (day == null || orderDay == null) return false;
        if (day < orderDay || day > orderDay + SETTLEMENT_WINDOW_DAYS) return false;

        if (nameScore(row.parsed.security, order.security) < NAME_MATCH_THRESHOLD) return false;

        if (expected > 0) {
          const drift = Math.abs(Math.abs(row.tx.amount) - expected) / expected;
          if (drift > AMOUNT_TOLERANCE) return false;
        }
        return true;
      })
      .sort((a, b) => {
        // Closest amount wins; date is the tiebreak.
        const da = expected > 0 ? Math.abs(Math.abs(a.tx.amount) - expected) : 0;
        const db = expected > 0 ? Math.abs(Math.abs(b.tx.amount) - expected) : 0;
        return da - db || dayNumber(a.tx.date) - dayNumber(b.tx.date);
      });

    if (candidates.length === 0) {
      unmatched.push(order);
      continue;
    }

    const best = candidates[0];
    used.add(best.tx.id);
    matches.push({
      order,
      transaction: best.tx,
      orderRef: best.parsed.orderRef,
      cost: Math.abs(best.tx.amount),
      expected,
      drift: expected > 0 ? Math.abs(Math.abs(best.tx.amount) - expected) / expected : null,
    });
  }

  // Statement rows nothing claimed: bought before receipts were being kept.
  const orphanRows = statementRows.filter((r) => !used.has(r.tx.id));

  return { matches, unmatchedOrders: unmatched, orphanTransactions: orphanRows };
}

/**
 * Writes the pairings to the ledger as transaction links. Idempotent: the link
 * payload is content-hashed, so re-running adds nothing.
 */
export async function linkSecurityOrders(orders, transactions) {
  const { matches } = matchOrders(orders, transactions);
  const index = await loadLedgerIndex();
  let linked = 0;

  for (const match of matches) {
    const ev = createEvent('transaction_link', 'securities', {
      link_id: `security-${match.order.security_order_id || match.order.date}-${match.transaction.id}`,
      transaction_ids: [match.transaction.id],
      security_order_id: match.order.security_order_id || null,
      rule_id: null,
      note: `${match.order.quantity}x ${match.order.security}`,
    });
    if (appendIfNewIndexed(ev, index)) linked++;
  }

  return { matched: matches.length, linked };
}

// ---------- positions ----------

const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Current holdings, one row per security.
 *
 * Cost comes from the bank debit whenever a link exists — that is the only
 * figure that is actually true, since the receipt's price is zero on a market
 * order. Where no debit could be found, the quoted value is used and the row
 * says so.
 */
export function computeSecurityPositions(orders, transactions, priceMap = {}) {
  const { matches, unmatchedOrders } = matchOrders(orders, transactions);
  const costByOrder = new Map(
    matches.map((m) => [m.order.security_order_id || `${m.order.date}|${m.order.security}`, m])
  );

  const positions = new Map();

  for (const order of orders) {
    const key = order.security;
    if (!positions.has(key)) {
      const registry = securityFor(key);
      positions.set(key, {
        name: key,
        isin: registry?.isin || null,
        symbol: registry?.symbol || null,
        market: order.market || registry?.market || null,
        currency: order.currency || registry?.currency || 'EUR',
        quantity: 0,
        invested: 0,
        orders: [],
        estimatedCost: false,
      });
    }
    const position = positions.get(key);
    const orderKey = order.security_order_id || `${order.date}|${order.security}`;
    const match = costByOrder.get(orderKey);
    const cost = match ? match.cost : order.quantity * (order.quote ?? order.price ?? 0);
    if (!match) position.estimatedCost = true;

    const signed = order.side === 'sell' ? -1 : 1;
    position.quantity += signed * order.quantity;
    position.invested += signed * cost;
    position.orders.push({
      date: order.date,
      side: order.side,
      quantity: order.quantity,
      quote: order.quote,
      cost: round(cost),
      transactionId: match?.transaction.id || null,
      linked: !!match,
    });
  }

  return [...positions.values()]
    .map((p) => {
      const price = priceMap[p.symbol] || priceMap[p.name] || null;
      const marketPrice = price?.price ?? null;
      const marketValue = marketPrice != null ? marketPrice * p.quantity : null;
      const pnl = marketValue != null ? marketValue - p.invested : null;
      return {
        ...p,
        quantity: round(p.quantity),
        invested: round(p.invested),
        avgCost: p.quantity > 0 ? round(p.invested / p.quantity) : null,
        marketPrice,
        priceDate: price?.timestamp || null,
        marketValue: marketValue != null ? round(marketValue) : null,
        pnl: pnl != null ? round(pnl) : null,
        roi: pnl != null && p.invested > 0 ? round((pnl / p.invested) * 100) : null,
        orders: p.orders.sort((a, b) => String(b.date).localeCompare(String(a.date))),
      };
    })
    .sort((a, b) => (b.marketValue ?? b.invested) - (a.marketValue ?? a.invested));
}

export function computeSecuritySummary(positions, transactions = []) {
  const fees = transactions
    .filter((t) => isBrokerageFee(t.description))
    .reduce((sum, t) => sum + Math.abs(Number(t.amount) || 0), 0);

  const invested = positions.reduce((s, p) => s + p.invested, 0);
  const priced = positions.filter((p) => p.marketValue != null);
  const marketValue = priced.reduce((s, p) => s + p.marketValue, 0);

  return {
    positions: positions.length,
    invested: round(invested),
    marketValue: priced.length ? round(marketValue) : null,
    pnl: priced.length ? round(marketValue - priced.reduce((s, p) => s + p.invested, 0)) : null,
    fees: round(fees),
    // Anything unpriced would silently understate the total, so say how many.
    unpriced: positions.length - priced.length,
  };
}

/** A manual price, for when the quote fetcher is off or a symbol is unknown. */
export async function recordManualPrice(symbol, price, currency = 'EUR') {
  const index = await loadLedgerIndex();
  const ev = createEvent('price_update', 'manual', {
    symbol,
    price: Number(price),
    currency,
    timestamp: new Date().toISOString().slice(0, 10),
    ref: uuidv4().slice(0, 8),
  });
  appendIfNewIndexed(ev, index);
  return ev;
}
