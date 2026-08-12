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
 *
 * Nothing calls this. It was run by hand once, against the ledger it was written
 * for, and its output is already in there — the `transaction_enrichment` events
 * the projection overlays. It is kept because the same situation recurs every
 * time a parser learns to read a field it used to miss, and rebuilding it from
 * memory then would be worse than keeping it working now. `dryRun: true` reports
 * what it would append without appending anything.
 */
import { basename } from 'path';
import { readFileSync } from 'fs';
import { createEvent, loadLedgerIndex, appendIfNewIndexed } from '../ledger/eventStore.js';
import { createContext } from '../framework/context.js';
import { storedDocuments } from '../framework/kits/documentBank.js';
import { sourceInstances, invoke, supports } from '../framework/registry.js';

const ENRICHED_FIELDS = ['account', 'account_id', 'account_holder', 'balance'];

/**
 * The account facts a fresh parse of the stored documents can supply.
 *
 * Every instance that can re-read a document is asked to, rather than one bank
 * being named here: on a fork with two banks, the second one's statements carry
 * exactly the same kind of fact and would otherwise never be backfilled.
 *
 * Only PDFs: the account header the statement prints is what carries the number
 * and the holder, and the CSV and mail-body formats have no such header.
 */
export async function readAccountFacts() {
  const facts = new Map();
  const errors = [];

  for (const instance of await sourceInstances({ includeDisabled: true })) {
    if (!(await supports(instance.id, 'parseDocument'))) continue;
    const ctx = createContext(instance);

    for (const path of storedDocuments(ctx, { extensions: ['.pdf'] })) {
      try {
        const parsed = await invoke(instance.id, 'parseDocument', {
          filename: basename(path),
          buffer: readFileSync(path),
          date: null,
        });
        for (const tx of parsed.transactions || []) {
          const fact = {};
          for (const field of ENRICHED_FIELDS) {
            if (tx[field] != null) fact[field] = tx[field];
          }
          if (!Object.keys(fact).length) continue;
          // A movement can appear in several documents; the first reading of
          // each fact wins, and later documents only fill in what was missing.
          const existing = facts.get(tx.transaction_id);
          facts.set(tx.transaction_id, existing ? { ...fact, ...existing } : fact);
        }
      } catch (err) {
        errors.push(`${basename(path)}: ${err.message}`);
      }
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
