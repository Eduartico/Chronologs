/**
 * Which movements are investing rather than spending.
 *
 * A third kind of money, beside income and spending. Buying €500 of an ETF took
 * €500 out of the current account, and the dashboard used to count it exactly
 * like €500 of groceries — so the month it happened in read as a terrible month,
 * when in fact nothing was lost: the money changed form and is still the
 * owner's. Selling skins back was the mirror image, reading as income.
 *
 * This is a *flow* question, not a category question, in the same way a trip is
 * not a category: an ETF purchase can be categorised "investments" and a
 * CSFloat deposit "gaming", and both are still money moved into something that
 * holds its value. So the answer is computed beside the category, never in place
 * of it, and every positive answer says *why* — the reason is what a reader
 * needs to correct one that is wrong.
 *
 * In order of how certain each reason is:
 *
 *   link          the debit is paired with an exchange order receipt
 *                 (`engines/securities.js`) or with a marketplace trade
 *                 (`engines/correlation.js`). Two documents agree.
 *   order         the bank's own wording for an exchange order or its brokerage
 *                 fee — "COMPRA BOLSA … DE ISH CORE MSCI W". The statement says
 *                 what it is.
 *   category      the transaction's category is one marked as investing.
 *   counterparty  the other side is a broker, an exchange or a skin
 *                 marketplace (`settings.investing.counterparties`). Catches
 *                 the CSFloat deposit filed under "gaming" years ago without
 *                 asking anyone to recategorise it.
 */
import { stripAccents } from '../lib/merchant.js';
import { parseStatementOrder, isBrokerageFee } from './securities.js';

/**
 * Brokers, exchanges and skin marketplaces, as they appear in a bank memo.
 *
 * Steam itself is deliberately absent: Steam is where games are bought, and a
 * game is spending. The marketplaces listed here exist to trade items that
 * keep a resale price, which is what the Investments page already tracks them
 * as. `settings.investing.counterparties` replaces this list when set.
 */
export const DEFAULT_COUNTERPARTIES = [
  // CS2 item marketplaces
  'csfloat',
  'dmarket',
  'buff163',
  'skinport',
  'skinbaron',
  'haloskins',
  'bitskins',
  'csmoney',
  'cs.money',
  'waxpeer',
  // Brokers
  'degiro',
  'trading 212',
  'trading212',
  'interactive brokers',
  'etoro',
  'lightyear',
  'scalable capital',
  'freedom24',
  // Crypto exchanges
  'binance',
  'coinbase',
  'kraken',
  'bitpanda',
  'crypto.com',
];

const normalise = (text) => stripAccents(String(text || '')).toLowerCase();

/** One compiled matcher per projection, never one per transaction. */
export function compileCounterparties(list) {
  const patterns = (Array.isArray(list) ? list : DEFAULT_COUNTERPARTIES)
    .map((p) => normalise(p).trim())
    .filter(Boolean);
  return (tx) => {
    const haystack = normalise(`${tx.description || ''} ${tx.merchant || ''}`);
    return patterns.find((p) => haystack.includes(p)) || null;
  };
}

/**
 * Why this movement is investing, or null when it is not.
 *
 * `positionIds` are the rows a marketplace module wrote for its own trades
 * (Pricempire's "Buy 1x …"). Those are records of a position, not of money
 * leaving a bank account — the bank's debit is that — so they are kept out of
 * every flow total upstream, and a bank row linked to one of them is the cash
 * leg of an investment.
 */
export function investmentReason(tx, { investmentCategories, matchCounterparty, positionIds, category }) {
  for (const link of tx.links || []) {
    if (String(link.linkId || '').startsWith('security-')) return 'link';
    if ((link.transactionIds || []).some((id) => id !== tx.id && positionIds?.has(id))) return 'link';
  }
  if (parseStatementOrder(tx.description) || isBrokerageFee(tx.description)) return 'order';
  if (investmentCategories?.has(category ?? tx.category)) return 'category';
  if (matchCounterparty?.(tx)) return 'counterparty';
  return null;
}
