import { createHash } from 'crypto';
import { existsSync, mkdirSync, writeFileSync, renameSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { createEvent, loadLedgerIndex, appendIfNewIndexed } from '../../ledger/eventStore.js';
import { documentsPath } from '../../lib/paths.js';
import { notify } from '../../lib/notify.js';
import { runRules } from '../../engines/rules.js';
import { fetchActivobankEmails, markProcessed } from './gmail.js';
import { parseBody } from './parsers/body.js';
import { parsePdf } from './parsers/pdf.js';
import { parseCsv } from './parsers/csv.js';
import { normalizeTransactions } from './normalize.js';

// A movement is reported twice: once by its advice note (Nota de Lançamento) on
// the day it happens, and again on the monthly statement. The two disagree on
// wording, and by up to a few days on the date, because the statement uses the
// booking date. Same amount within this window across the two document types is
// the same movement.
const CROSS_KIND_DAYS = 4;

function dayNumber(isoDate) {
  return Math.round(new Date(`${isoDate}T00:00:00Z`).getTime() / 86400000);
}

/**
 * Tracks which movements are already recorded so a statement and its advice
 * notes do not both land in the ledger as separate spending.
 */
function createTransactionIndex(events) {
  const byAmount = new Map();

  function add(tx) {
    const key = tx.amount.toFixed(2);
    if (!byAmount.has(key)) byAmount.set(key, []);
    byAmount.get(key).push({ day: dayNumber(tx.date), kind: tx.document_kind || null });
  }

  for (const ev of events) {
    if (ev.type !== 'transaction' || ev.source !== 'activobank') continue;
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
        (c) => c.kind && kind && c.kind !== kind && Math.abs(c.day - day) <= CROSS_KIND_DAYS
      );
    },
  };
}

async function parseDocument(filename, buffer, emailDate = null) {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'pdf') return parsePdf(buffer);
  if (ext === 'csv' || ext === 'tsv') return parseCsv(buffer);
  return parseBody(buffer.toString('utf-8'), emailDate);
}

function documentSha(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Ingests ActivoBank documents either from Gmail ({origin: 'gmail'}) or from
 * manually uploaded files ({origin: 'upload', files: [{filename, buffer}]}).
 * Raw documents are preserved under documents/activobank/ for future re-parsing.
 */
export async function ingestActivobank({
  origin = 'gmail',
  files = [],
  // Reprocessing reads documents that are already stored and already recorded
  // as ingested, so the content-hash gate and the disk write are both skipped.
  skipDocumentGate = false,
} = {}) {
  const batchId = `${origin}-${new Date().toISOString().slice(0, 10)}-${uuidv4().slice(0, 8)}`;
  const inboxDir = documentsPath('activobank', 'inbox', batchId);
  const result = {
    batchId,
    documents: 0,
    parsed: 0,
    new: 0,
    duplicates: 0,
    skippedDocuments: 0,
    nonTransactional: 0,
    unparsedLines: [],
    errors: [],
    newTransactionIds: [],
  };

  let docs = [];
  let messageIds = [];

  if (origin === 'gmail') {
    const emails = await fetchActivobankEmails();
    messageIds = emails.map((e) => e.messageId);
    for (const email of emails) {
      if (email.body && email.body.trim()) {
        docs.push({
          filename: `${email.messageId}-body.txt`,
          buffer: Buffer.from(email.body, 'utf-8'),
          emailDate: email.date,
          messageId: email.messageId,
        });
      }
      for (const att of email.attachments) {
        docs.push({
          filename: `${email.messageId}-${att.filename}`,
          buffer: att.buffer,
          emailDate: email.date,
          messageId: email.messageId,
        });
      }
    }
  } else {
    docs = files.map((f) => ({ filename: f.filename, buffer: f.buffer }));
  }

  if (docs.length > 0 && !skipDocumentGate) mkdirSync(inboxDir, { recursive: true });

  // One pass over the ledger for the whole batch. Re-reading it per document
  // (and again per transaction) made a full mailbox import quadratic.
  const ledger = await loadLedgerIndex();
  const ingestedShas = new Set(
    ledger.events
      .filter((e) => e.type === 'document_ingested')
      .map((e) => e.payload?.sha256)
      .filter(Boolean)
  );
  const transactionIndex = createTransactionIndex(ledger.events);

  for (const doc of docs) {
    try {
      if (!skipDocumentGate) writeFileSync(join(inboxDir, doc.filename), doc.buffer);
      result.documents++;

      if (!skipDocumentGate) {
        const sha256 = documentSha(doc.buffer);
        if (ingestedShas.has(sha256)) {
          // Identical content already ingested — ActivoBank sends the same
          // template mail every month, so this is routine, not a failure.
          result.skippedDocuments++;
          continue;
        }
        ingestedShas.add(sha256);

        // Dedupe by file content: batch/filename vary between identical
        // re-uploads, so they must stay out of the hashed payload.
        appendIfNewIndexed(
          createEvent('document_ingested', 'activobank', { sha256 }, [
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

      const { transactions, unparsedLines, kind } = await parseDocument(
        doc.filename,
        doc.buffer,
        doc.emailDate || null
      );

      if (kind === 'other') result.nonTransactional++;
      else result.parsed++;

      const documentId = `${batchId}/${doc.filename}`;
      for (const tx of normalizeTransactions(transactions)) {
        if (transactionIndex.isReportedElsewhere(tx)) {
          result.duplicates++;
          continue;
        }
        // The document reference lives in linked_entities so it stays out of
        // the dedup hash — the same transaction seen in two documents is one
        // fact.
        const isNew = appendIfNewIndexed(
          createEvent('transaction', 'activobank', tx, [{ type: 'document', id: documentId }]),
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

  if (origin === 'gmail' && messageIds.length > 0) {
    markProcessed(messageIds);
  }

  // Rules engine runs continuously: apply it to everything new from this batch,
  // then look for cross-platform correlations.
  if (result.newTransactionIds.length > 0) {
    try {
      await runRules({ transactionIds: result.newTransactionIds });
    } catch (err) {
      result.errors.push(`rules: ${err.message}`);
    }
    try {
      const { runCorrelations } = await import('../../engines/correlation.js');
      await runCorrelations();
    } catch (err) {
      result.errors.push(`correlations: ${err.message}`);
    }
  }

  // Move the batch out of the inbox once processed.
  if (docs.length > 0 && existsSync(inboxDir)) {
    const processedDir = documentsPath('activobank', 'processed', batchId);
    try {
      renameSync(inboxDir, processedDir);
    } catch {}
  }

  const details = [
    `${result.new} new transactions from ${result.parsed} statement/advice document(s)`,
    result.duplicates ? `${result.duplicates} already recorded` : null,
    result.skippedDocuments ? `${result.skippedDocuments} repeated document(s)` : null,
    result.nonTransactional ? `${result.nonTransactional} non-transactional` : null,
    result.errors.length ? `${result.errors.length} error(s)` : null,
  ].filter(Boolean);

  notify(
    result.errors.length > 0 ? 'warning' : 'success',
    'ActivoBank sync',
    details.join(', '),
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
    notify(
      'warning',
      'ActivoBank: some lines could not be parsed',
      result.unparsedLines.map((u) => `${u.document}: ${u.lines.length} line(s)`).join('; '),
      { batchId, unparsedLines: result.unparsedLines }
    );
  }

  return result;
}

function listStoredDocuments() {
  const files = [];
  for (const stage of ['processed', 'inbox']) {
    const root = documentsPath('activobank', stage);
    if (!existsSync(root)) continue;
    for (const batch of readdirSync(root, { withFileTypes: true })) {
      if (!batch.isDirectory()) continue;
      const batchDir = join(root, batch.name);
      for (const entry of readdirSync(batchDir, { withFileTypes: true })) {
        if (entry.isFile()) files.push(join(batchDir, entry.name));
      }
    }
  }
  return files;
}

/**
 * Re-parses every document already downloaded under documents/activobank/.
 *
 * Gmail messages are only fetched once, and each document's content hash is
 * recorded on first sight, so an improved parser would otherwise never see the
 * existing mailbox again. This reads the stored originals straight back through
 * the current parsers; transaction-level deduplication keeps it idempotent, so
 * it is safe to run repeatedly.
 */
export async function reprocessStoredDocuments() {
  const paths = listStoredDocuments();
  const files = paths.map((p) => ({ filename: p.split(/[\/]/).pop(), buffer: readFileSync(p) }));
  const result = await ingestActivobank({ origin: 'reprocess', files, skipDocumentGate: true });
  return { ...result, filesFound: files.length };
}
