/**
 * Backfills account identity onto transactions that were ingested before the
 * parsers learned to read it.
 *
 * The ledger is append-only and deduplicates on a hash of the payload, so
 * re-running the importer over the stored documents would not update those
 * events — it would append two thousand near-identical copies of them. The
 * facts are instead added as their own event type and overlaid at projection
 * time, which is what the ledger is for: the original reading stays exactly as
 * it was recorded, and what was learned later sits beside it.
 *
 * Matching is by transaction id, which is derived from date, amount and
 * description and therefore identical between the old parse and the new one.
 */
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { createEvent, loadLedgerIndex, appendIfNewIndexed } from '../ledger/eventStore.js';
import { documentsPath } from '../lib/paths.js';
import { parsePdf } from '../ingestion/activobank/parsers/pdf.js';
import { normalizeTransactions } from '../ingestion/activobank/normalize.js';

const ENRICHED_FIELDS = ['account', 'account_id', 'account_holder', 'balance'];

function storedDocuments() {
  const files = [];
  for (const stage of ['processed', 'inbox']) {
    const root = documentsPath('activobank', stage);
    if (!existsSync(root)) continue;
    for (const batch of readdirSync(root, { withFileTypes: true })) {
      if (!batch.isDirectory()) continue;
      const batchDir = join(root, batch.name);
      for (const entry of readdirSync(batchDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
          files.push(join(batchDir, entry.name));
        }
      }
    }
  }
  return files;
}

/** The account facts a fresh parse of the stored documents can supply. */
export async function readAccountFacts() {
  const facts = new Map();
  const errors = [];

  for (const path of storedDocuments()) {
    try {
      const parsed = await parsePdf(readFileSync(path));
      for (const tx of normalizeTransactions(parsed.transactions || [])) {
        const fact = {};
        for (const field of ENRICHED_FIELDS) {
          if (tx[field] != null) fact[field] = tx[field];
        }
        if (!Object.keys(fact).length) continue;
        // A movement can appear in several documents; the first reading of each
        // fact wins, and later documents only fill in what was missing.
        const existing = facts.get(tx.transaction_id);
        facts.set(tx.transaction_id, existing ? { ...fact, ...existing } : fact);
      }
    } catch (err) {
      errors.push(`${path.split(/[\\/]/).pop()}: ${err.message}`);
    }
  }

  return { facts, errors };
}

/**
 * Appends what the ledger does not already know.
 *
 * Idempotent twice over: a transaction already carrying a fact is skipped, and
 * the ledger's own hash check drops any enrichment appended before.
 */
export async function enrichAccounts({ dryRun = false } = {}) {
  const { facts, errors } = await readAccountFacts();
  const ledger = await loadLedgerIndex();

  const known = new Map();
  const enrichedAlready = new Set();
  for (const ev of ledger.events) {
    if (ev.type === 'transaction') {
      const id = ev.payload?.transaction_id;
      if (id) known.set(id, ev.payload);
    }
    if (ev.type === 'transaction_enrichment') {
      const id = ev.payload?.transaction_id;
      if (id) enrichedAlready.add(id);
    }
  }

  const pending = [];
  for (const [transactionId, fact] of facts) {
    const payload = known.get(transactionId);
    if (!payload) continue;
    if (enrichedAlready.has(transactionId)) continue;
    const missing = {};
    for (const field of ENRICHED_FIELDS) {
      if (fact[field] != null && payload[field] == null) missing[field] = fact[field];
    }
    if (Object.keys(missing).length) pending.push({ transaction_id: transactionId, ...missing });
  }

  if (dryRun) {
    return { documents: facts.size, matched: pending.length, appended: 0, errors, pending };
  }

  let appended = 0;
  for (const payload of pending) {
    if (appendIfNewIndexed(createEvent('transaction_enrichment', 'migration', payload), ledger)) {
      appended++;
    }
  }

  return { documents: facts.size, matched: pending.length, appended, errors };
}
