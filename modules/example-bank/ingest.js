/**
 * The only part of a bank module that is really about the bank: reading its
 * statements.
 *
 * The format here is invented and deliberately simple — a semicolon-separated
 * export of the kind most banks offer:
 *
 *   Data;Descritivo;Montante;Saldo
 *   2025-03-04;COMPRA CONTINENTE PORTO;-45,20;1954,80
 *
 * A real module replaces `parseStatement` and nothing else. Everything around
 * it comes from the shared kit.
 */
import { basename } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { ingestDocuments, storedDocuments } from '../../server/framework/kits/documentBank.js';

const NOTIFY_KEYS = { sync: 'notify.exampleBank.import', unparsed: 'notify.module.unparsed' };

/**
 * Portuguese-style decimals: `1.954,80` is one thousand nine hundred and fifty
 * four euros and eighty cents, not a number with two decimal points. Getting
 * this wrong by a factor of a thousand is the classic first-day bug.
 */
function parseAmount(text) {
  const cleaned = String(text ?? '').trim().replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * Reads one statement.
 *
 * The contract: return `{ transactions, orders?, unparsedLines?, kind? }`. A
 * line that cannot be read goes into `unparsedLines` rather than being dropped
 * — silence is how a parser loses a month of somebody's spending without
 * anybody noticing.
 */
export function parseStatement(text) {
  const transactions = [];
  const unparsedLines = [];

  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^data\s*;/i.test(line)) continue; // header

    const [date, description, amount, balance] = line.split(';');
    const parsedAmount = parseAmount(amount);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || parsedAmount === null) {
      unparsedLines.push(line);
      continue;
    }

    transactions.push({
      date,
      description: (description ?? '').trim(),
      amount: parsedAmount,
      balance: parseAmount(balance),
      currency: 'EUR',
      // Which kind of document said so. The kit uses this to recognise the same
      // movement reported by a statement and by an advice note.
      document_kind: 'statement',
    });
  }

  return { transactions, orders: [], unparsedLines, kind: transactions.length ? 'statement' : 'other' };
}

/**
 * A stable id per movement — the single most important thing a module decides.
 *
 * It is the movement's identity for the rest of its life: categories, tags,
 * manual corrections and duplicate decisions are all keyed to it. It must be
 * derived only from what the document says, and must come out the same when the
 * same document is read again years later, or the ledger fills with copies.
 * Never a timestamp, never a random value, never a row number.
 */
export function makeTransactionId(instanceId, tx) {
  const digest = createHash('sha1')
    .update(`${tx.date}|${tx.amount.toFixed(2)}|${tx.description}`)
    .digest('hex')
    .slice(0, 10);
  return `${instanceId}-${tx.date}-${digest}`;
}

const normalizeFor = (ctx) => (transactions) =>
  transactions.map((tx) => ({ ...tx, transaction_id: makeTransactionId(ctx.instanceId, tx) }));

/** The same read, with ids on the rows — what `parseDocument` hands back. */
export async function parseAndNormalize({ filename, buffer }) {
  const parsed = parseStatement(buffer.toString('utf-8'));
  // `parseDocument` is called without an instance context in some places, so the
  // id is derived from the module name; a real module with one instance per
  // account should thread `ctx.instanceId` through as `ingestFiles` does.
  return { ...parsed, transactions: normalizeFor({ instanceId: 'example-bank' })(parsed.transactions) };
}

// ---------- small state file, purely to show how ----------

export function readState(ctx) {
  const file = ctx.paths.state('import');
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return {};
  }
}

function writeState(ctx, patch) {
  writeFileSync(ctx.paths.state('import'), JSON.stringify({ ...readState(ctx), ...patch }, null, 2), 'utf-8');
}

// ---------- the two capabilities ----------

export async function ingestFiles(ctx, files) {
  const result = await ingestDocuments(ctx, {
    origin: 'upload',
    files,
    parse: async ({ buffer }) => parseStatement(buffer.toString('utf-8')),
    normalize: normalizeFor(ctx),
    notifyKeys: NOTIFY_KEYS,
  });
  writeState(ctx, { lastImport: new Date().toISOString() });
  return result;
}

export async function reprocessStored(ctx) {
  const files = storedDocuments(ctx).map((path) => ({
    filename: basename(path),
    buffer: readFileSync(path),
  }));

  const result = await ingestDocuments(ctx, {
    origin: 'reprocess',
    files,
    // Already stored and already recorded as ingested, so the content-hash gate
    // and the disk write are both skipped. Transaction-level deduplication is
    // what keeps this idempotent.
    skipDocumentGate: true,
    parse: async ({ buffer }) => parseStatement(buffer.toString('utf-8')),
    normalize: normalizeFor(ctx),
    notifyKeys: NOTIFY_KEYS,
  });

  return { ...result, filesFound: files.length };
}
