/**
 * The pipeline every document-based institution needs.
 *
 * A bank module's genuinely bank-specific part is small: how to fetch the
 * documents, and how to read one. Everything around that — batching, keeping
 * the originals, not ingesting the same file twice, not counting the same
 * movement twice when a statement and an advice note both report it, appending,
 * running the rules over what is new, reconciling order receipts, filing the
 * batch away, and saying what happened — is identical for all of them, and was
 * three hundred lines living inside the ActivoBank importer.
 *
 * Those three hundred lines are here, moved rather than rewritten. Every
 * protection they encode was put there by a bug:
 *
 *  - the content-hash gate, because the bank sends the same template mail every
 *    month;
 *  - the cross-document-kind window, because a movement is reported once by its
 *    advice note on the day and again by the monthly statement, worded
 *    differently and dated up to a few days apart;
 *  - one ledger scan per batch rather than per transaction, because the latter
 *    made a full mailbox import quadratic;
 *  - the document reference in `linked_entities` rather than in the payload,
 *    because the same movement seen in two documents is one fact and must hash
 *    the same.
 *
 * A new bank inherits all of it by supplying `fetch` and `parse`.
 */
import { createHash } from 'crypto';
import { existsSync, mkdirSync, writeFileSync, renameSync, readdirSync } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { loadLedgerIndex, appendIfNewIndexed } from '../../ledger/eventStore.js';
import { runRules } from '../../engines/rules.js';
import { hooks } from '../registry.js';

/**
 * How far apart two reports of the same movement may be dated.
 *
 * The statement books on the settlement date, the advice note on the day it
 * happened. Four days covers a weekend plus a bank holiday.
 */
const CROSS_KIND_DAYS = 4;

function dayNumber(isoDate) {
  return Math.round(new Date(`${isoDate}T00:00:00Z`).getTime() / 86400000);
}

function documentSha(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Deterministic, so re-parsing the same receipt does not create a second order. */
function makeSecurityOrderId(order) {
  const digest = createHash('sha1')
    .update(`${order.date}|${order.security}|${order.side}|${order.quantity}`)
    .digest('hex')
    .slice(0, 10);
  return `order-${order.date}-${digest}`;
}

/**
 * Tracks which movements are already recorded so a statement and its advice
 * notes do not both land in the ledger as separate spending.
 */
function createTransactionIndex(events, instanceId, crossKindDays) {
  const byAmount = new Map();

  function add(tx) {
    const key = tx.amount.toFixed(2);
    if (!byAmount.has(key)) byAmount.set(key, []);
    byAmount.get(key).push({ day: dayNumber(tx.date), kind: tx.document_kind || null });
  }

  for (const ev of events) {
    // Only this instance's own movements: two banks can report the same amount
    // on the same day, and pairing across them would drop a real transaction.
    if (ev.type !== 'transaction' || ev.source !== instanceId) continue;
    const p = ev.payload || {};
    if (!p.date || !Number.isFinite(p.amount)) continue;
    add({ amount: p.amount, date: p.date, document_kind: p.document_kind });
  }

  return {
    add,
    /** True when another document type already reported this same movement. */
    isReportedElsewhere(tx) {
      const kind = tx.document_kind || null;
      const candidates = byAmount.get(tx.amount.toFixed(2));
      if (!candidates) return false;
      const day = dayNumber(tx.date);
      return candidates.some(
        (c) => c.kind && kind && c.kind !== kind && Math.abs(c.day - day) <= crossKindDays
      );
    },
  };
}

/**
 * Runs one ingestion batch for one instance.
 *
 * @param ctx      the instance context; decides `source` and every path
 * @param fetch    async () => [{ filename, buffer, date?, messageId? }]
 *                 called only when `origin` is not 'upload'; omit for a module
 *                 that has nothing to fetch from
 * @param parse    async ({ filename, buffer, date }) =>
 *                 { transactions, orders?, unparsedLines?, kind? }
 * @param normalize (transactions) => transactions carrying a stable
 *                 `transaction_id`; identity by default
 * @param acknowledge async (documents) => void, after a successful fetch — where
 *                 a mailbox marks its messages read
 * @param notifyKeys { sync, unparsed } translation keys, so each institution
 *                 keeps its own wording
 */
export async function ingestDocuments(
  ctx,
  {
    origin = 'sync',
    files = [],
    // Reprocessing reads documents that are already stored and already recorded
    // as ingested, so the content-hash gate and the disk write are both skipped.
    skipDocumentGate = false,
    fetch = null,
    parse,
    normalize = (transactions) => transactions,
    acknowledge = null,
    crossKindDays = CROSS_KIND_DAYS,
    notifyKeys = {},
  }
) {
  const batchId = `${origin}-${new Date().toISOString().slice(0, 10)}-${uuidv4().slice(0, 8)}`;
  const inboxDir = ctx.paths.documents('inbox', batchId);
  const result = {
    batchId,
    documents: 0,
    parsed: 0,
    new: 0,
    duplicates: 0,
    securityOrders: 0,
    skippedDocuments: 0,
    nonTransactional: 0,
    unparsedLines: [],
    errors: [],
    newTransactionIds: [],
  };

  const docs = fetch ? await fetch() : files.map((f) => ({ filename: f.filename, buffer: f.buffer }));

  if (docs.length > 0 && !skipDocumentGate) mkdirSync(inboxDir, { recursive: true });

  // One pass over the ledger for the whole batch. Re-reading it per document
  // (and again per transaction) made a full mailbox import quadratic.
  const ledger = await loadLedgerIndex();
  // This instance's own documents, not every instance's. Two accounts can
  // perfectly well be sent the same file — a joint statement, the same export
  // saved twice — and letting one instance's history suppress another's import
  // loses real movements with no error anywhere.
  const ingestedShas = new Set(
    ledger.events
      .filter((e) => e.type === 'document_ingested' && e.source === ctx.instanceId)
      .map((e) => e.payload?.sha256)
      .filter(Boolean)
  );
  const transactionIndex = createTransactionIndex(ledger.events, ctx.instanceId, crossKindDays);

  for (const doc of docs) {
    try {
      if (!skipDocumentGate) writeFileSync(join(inboxDir, doc.filename), doc.buffer);
      result.documents++;

      if (!skipDocumentGate) {
        const sha256 = documentSha(doc.buffer);
        if (ingestedShas.has(sha256)) {
          // Identical content already ingested — a bank sends the same template
          // mail every month, so this is routine, not a failure.
          result.skippedDocuments++;
          continue;
        }
        ingestedShas.add(sha256);

        // Dedupe by file content: batch/filename vary between identical
        // re-uploads, so they must stay out of the hashed payload.
        appendIfNewIndexed(
          ctx.ledger.createEvent('document_ingested', { sha256 }, [
            {
              type: 'document',
              id: `${batchId}/${doc.filename}`,
              filename: doc.filename,
              origin,
              message_id: doc.messageId || null,
            },
          ]),
          ledger
        );
      }

      const parsed = await parse({
        filename: doc.filename,
        buffer: doc.buffer,
        date: doc.date ?? doc.emailDate ?? null,
      });
      const { transactions, orders, unparsedLines = [], kind } = parsed;

      if (kind === 'other') result.nonTransactional++;
      else result.parsed++;

      const documentId = `${batchId}/${doc.filename}`;

      // Exchange order receipts describe a securities purchase, not a bank
      // movement — they are recorded as their own event type and reconciled
      // against the statement debit afterwards.
      for (const order of orders || []) {
        const ev = ctx.ledger.createEvent(
          'security_order',
          {
            security_order_id: makeSecurityOrderId(order),
            date: order.date,
            side: order.side,
            security: order.security,
            market: order.market,
            quantity: order.quantity,
            price: order.price,
            quote: order.quote,
            currency: order.currency,
            executed: order.executed,
          },
          [{ type: 'document', id: documentId }]
        );
        if (appendIfNewIndexed(ev, ledger)) result.securityOrders++;
      }

      for (const tx of normalize(transactions)) {
        if (transactionIndex.isReportedElsewhere(tx)) {
          result.duplicates++;
          continue;
        }
        // The document reference lives in linked_entities so it stays out of
        // the dedup hash — the same transaction seen in two documents is one
        // fact.
        const isNew = appendIfNewIndexed(
          ctx.ledger.createEvent('transaction', tx, [{ type: 'document', id: documentId }]),
          ledger
        );
        if (isNew) {
          result.new++;
          result.newTransactionIds.push(tx.transaction_id);
          transactionIndex.add(tx);
        } else {
          result.duplicates++;
        }
      }

      if (unparsedLines.length > 0) {
        result.unparsedLines.push({ document: doc.filename, lines: unparsedLines.slice(0, 20) });
      }
    } catch (err) {
      result.errors.push(`${doc.filename}: ${err.message}`);
    }
  }

  if (acknowledge && docs.length > 0) await acknowledge(docs);

  // The rules engine runs continuously, and is applied to everything new from
  // this batch. It stays inline rather than becoming a hook: it is the app, it
  // must run first, and everything after it wants to see its verdicts.
  if (result.newTransactionIds.length > 0) {
    try {
      await runRules({ transactionIds: result.newTransactionIds });
    } catch (err) {
      result.errors.push(`rules: ${err.message}`);
    }
  }

  // Whatever else wants a look at a finished batch — correlation detection,
  // reconciling order receipts against the debits that paid for them. Each
  // decides for itself whether this batch is relevant. This kit used to call
  // both of those engines by name, which meant a bank module dragged in the
  // whole of the rest of the app.
  //
  // A failing hook is recorded and the batch still succeeds: the movements are
  // already in the ledger, and reporting the import as a failure because a
  // downstream pass stumbled would send someone hunting for data that is
  // already safely there.
  for (const { id, hook } of await hooks('afterIngest')) {
    try {
      await hook(ctx, result);
    } catch (err) {
      result.errors.push(`${id}: ${err.message}`);
    }
  }

  // Move the batch out of the inbox once processed.
  //
  // The destination's parent is created first. It exists at boot for every
  // configured instance, but an instance added while the server is running has
  // no `processed/` yet, and the rename would then fail into the bare catch
  // below — leaving the batch in the inbox, where nothing ever clears it.
  if (docs.length > 0 && existsSync(inboxDir)) {
    const processedDir = ctx.paths.documents('processed', batchId);
    try {
      mkdirSync(ctx.paths.documents('processed'), { recursive: true });
      renameSync(inboxDir, processedDir);
    } catch {}
  }

  const details = [
    `${result.new} new transactions from ${result.parsed} statement/advice document(s)`,
    result.securityOrders ? `${result.securityOrders} ordem(ns) de bolsa` : null,
    result.duplicates ? `${result.duplicates} already recorded` : null,
    result.skippedDocuments ? `${result.skippedDocuments} repeated document(s)` : null,
    result.nonTransactional ? `${result.nonTransactional} non-transactional` : null,
    result.errors.length ? `${result.errors.length} error(s)` : null,
  ].filter(Boolean);

  ctx.notify(
    result.errors.length > 0 ? 'warning' : 'success',
    notifyKeys.sync ?? 'notify.sync.module',
    { imported: result.new, files: result.documents, detail: details.join(', '), module: ctx.instanceId },
    {
      origin,
      batchId,
      new: result.new,
      documents: result.documents,
      parsed: result.parsed,
      duplicates: result.duplicates,
      skippedDocuments: result.skippedDocuments,
      nonTransactional: result.nonTransactional,
      errors: result.errors,
    }
  );

  if (result.unparsedLines.length > 0) {
    ctx.notify(
      'warning',
      notifyKeys.unparsed ?? 'notify.module.unparsed',
      {
        count: result.unparsedLines.length,
        detail: result.unparsedLines.map((u) => `${u.document}: ${u.lines.length}`).join('; '),
        module: ctx.instanceId,
      },
      { batchId, unparsedLines: result.unparsedLines }
    );
  }

  return result;
}

/**
 * Every document this instance has ever stored, newest stage first.
 *
 * Gmail hands over each message once and each document's content hash is
 * recorded on first sight, so an improved parser would otherwise never see the
 * existing mailbox again. This is how it does.
 */
export function storedDocuments(ctx, { extensions = null } = {}) {
  const files = [];
  for (const stage of ['processed', 'inbox']) {
    const root = ctx.paths.documents(stage);
    if (!existsSync(root)) continue;
    for (const batch of readdirSync(root, { withFileTypes: true })) {
      if (!batch.isDirectory()) continue;
      const batchDir = join(root, batch.name);
      for (const entry of readdirSync(batchDir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        if (extensions && !extensions.some((e) => entry.name.toLowerCase().endsWith(e))) continue;
        files.push(join(batchDir, entry.name));
      }
    }
  }
  return files;
}
