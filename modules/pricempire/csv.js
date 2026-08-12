/**
 * Parses the CSV a Pricempire portfolio exports.
 *
 * Format notes taken from a real export:
 *  - Every price is an integer number of USD cents: 20660 is $206.60, 116 is $1.16.
 *  - `Total Price` is `Quantity x Unit Price`, also in cents.
 *  - `Fee Amount` is always 0; the fee that matters is `Fee Percentage`
 *    (15% on Steam sales, 2% on CSFloat), so sale proceeds are net of it.
 *  - `Type` is buy or sell.
 *  - Item names contain ★ and ™, which arrive mangled when the file was written
 *    as UTF-8 and read back as Latin-1 ("â StatTrakâ¢").
 *  - Rows can legitimately repeat (the same purchase entered twice on one day),
 *    so the row ordinal is part of each transaction's identity.
 */
import { parse } from 'csv-parse/sync';
import { createHash } from 'crypto';

const CENTS = 100;

function normalizeHeader(h) {
  return String(h).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Repairs text that was encoded UTF-8 and decoded as Latin-1. The tell is a
 * lone "Ã"/"â" before a high byte; re-encoding through latin1 restores the
 * original code points.
 */
export function repairMojibake(text) {
  if (!/[ÃÂâ][-¿]/.test(text)) return text;
  try {
    const repaired = Buffer.from(text, 'latin1').toString('utf-8');
    // Only accept the repair if it did not introduce replacement characters.
    return repaired.includes('�') ? text : repaired;
  } catch {
    return text;
  }
}

function toNumber(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s || s === 'N/A') return null;
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function toCents(value) {
  const n = toNumber(value);
  return n == null ? null : n / CENTS;
}

function toText(value) {
  const s = String(value ?? '').trim();
  return !s || s === 'N/A' ? null : s;
}

function toIsoDate(value) {
  const s = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{2})[-/.](\d{2})[-/.](\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/**
 * `occurrence` distinguishes rows that are byte-identical but genuinely
 * separate purchases (the export really does contain two "buy 3x Eternal Fire"
 * lines on the same day). It counts repeats of the same tuple rather than using
 * the row's position in the file, so re-exporting with new rows — or in a
 * different order — still produces the same ids and dedupes cleanly.
 */
export function makeInvestmentTransactionId(row, occurrence = 1) {
  const digest = createHash('sha1')
    .update(`${row.name}|${row.type}|${row.date}|${row.quantity}|${row.unitPrice}|${occurrence}`)
    .digest('hex')
    .slice(0, 10);
  return `pricempire-${row.date}-${digest}`;
}

const COLUMNS = {
  name: ['name'],
  type: ['type'],
  quantity: ['quantity'],
  unitPrice: ['unit price'],
  totalPrice: ['total price'],
  feeAmount: ['fee amount'],
  feePercentage: ['fee percentage'],
  marketplace: ['marketplace'],
  date: ['date'],
  note: ['note'],
  floatValue: ['float value'],
  paintSeed: ['paint seed'],
  steamAssetId: ['steam asset id'],
  currency: ['currency'],
  currentMarketPrice: ['current market price'],
};

/**
 * Returns { transactions, prices, unparsedLines }. `prices` carries one entry
 * per distinct item, taken from the Current Market Price column — the export
 * holds no price history, only today's value.
 */
export function parsePricempireCsv(input) {
  const raw = Buffer.isBuffer(input) ? input.toString('utf-8') : String(input);
  const content = repairMojibake(raw).replace(/^﻿/, '');

  let records;
  try {
    records = parse(content, { columns: false, skip_empty_lines: true, relax_column_count: true, trim: true });
  } catch (err) {
    return { transactions: [], prices: [], unparsedLines: [`CSV parse error: ${err.message}`] };
  }
  if (records.length === 0) return { transactions: [], prices: [], unparsedLines: [] };

  const headers = records[0].map(normalizeHeader);
  const col = {};
  for (const [key, candidates] of Object.entries(COLUMNS)) {
    col[key] = headers.findIndex((h) => candidates.includes(h));
  }

  if (col.name === -1 || col.type === -1 || col.quantity === -1 || col.date === -1) {
    return {
      transactions: [],
      prices: [],
      unparsedLines: [`Cabeçalho não reconhecido: ${records[0].join(',')}`],
    };
  }

  const at = (row, key) => (col[key] === -1 ? null : row[col[key]]);
  const transactions = [];
  const unparsedLines = [];
  const prices = new Map();
  const seen = new Map();

  records.slice(1).forEach((row) => {
    const name = toText(at(row, 'name'));
    const type = String(at(row, 'type') ?? '').trim().toLowerCase();
    const quantity = toNumber(at(row, 'quantity'));
    const date = toIsoDate(at(row, 'date'));

    if (!name || !date || !quantity || (type !== 'buy' && type !== 'sell')) {
      if (row.join('').trim()) unparsedLines.push(row.join(','));
      return;
    }

    const unitPrice = toCents(at(row, 'unitPrice')) ?? 0;
    const totalFromFile = toCents(at(row, 'totalPrice'));
    const currency = toText(at(row, 'currency')) || 'USD';

    const tx = {
      name,
      type,
      date,
      quantity,
      unitPrice,
      // The file's own total is authoritative; quantity x unit is the fallback
      // for rows where it is blank.
      totalPrice: totalFromFile != null ? totalFromFile : unitPrice * quantity,
      feeAmount: toCents(at(row, 'feeAmount')) ?? 0,
      feePercentage: toNumber(at(row, 'feePercentage')) ?? 0,
      marketplace: toText(at(row, 'marketplace')),
      note: toText(at(row, 'note')),
      floatValue: toNumber(at(row, 'floatValue')),
      paintSeed: toNumber(at(row, 'paintSeed')),
      steamAssetId: toText(at(row, 'steamAssetId')),
      currency,
    };

    const tuple = `${name}|${type}|${date}|${quantity}|${unitPrice}`;
    const occurrence = (seen.get(tuple) || 0) + 1;
    seen.set(tuple, occurrence);
    tx.occurrence = occurrence;
    tx.id = makeInvestmentTransactionId(tx, occurrence);
    transactions.push(tx);

    const marketPrice = toCents(at(row, 'currentMarketPrice'));
    if (marketPrice != null && !prices.has(name)) {
      prices.set(name, { name, price: marketPrice, currency });
    }
  });

  return { transactions, prices: [...prices.values()], unparsedLines };
}
