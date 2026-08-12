/**
 * ActivoBank ingestion: what is actually specific to this bank.
 *
 * Everything this file used to do around the parsing — batching, the
 * content-hash gate, the cross-document-kind window, appending, running the
 * rules, reconciling order receipts, filing the batch away — now lives in
 * framework/kits/documentBank.js and is shared by every document-based
 * institution. What is left here is the three things only ActivoBank can
 * answer: where its documents come from, how to read one, and what its
 * notifications say.
 */
import { readFileSync } from 'fs';
import { basename } from 'path';
import { createContext } from '../../server/framework/context.js';
import { ingestDocuments, storedDocuments } from '../../server/framework/kits/documentBank.js';
import { fetchActivobankEmails, markProcessed } from './gmail.js';
import { parseBody } from './parsers/body.js';
import { parsePdf } from './parsers/pdf.js';
import { parseCsv } from './parsers/csv.js';
import { normalizeTransactions } from './normalize.js';

/**
 * The instance this ingestion belongs to.
 *
 * Every caller should hand one over — it is what decides the `source` on each
 * event and which directory the documents land in. The fallback exists for the
 * routes that still call this function by name; they move to the registry in
 * `routes/modules.js`, and when the last of them has, this can go.
 */
function contextOf(ctx) {
  return ctx ?? createContext({ id: 'activobank', module: 'activobank', config: {} });
}

const NOTIFY_KEYS = {
  sync: 'notify.sync.activobank',
  unparsed: 'notify.activobank.unparsed',
};

/** Reads whichever of the three document shapes this file happens to be. */
export async function parseActivobankDocument({ filename, buffer, date = null }) {
  const ext = String(filename).toLowerCase().split('.').pop();
  if (ext === 'pdf') return parsePdf(buffer);
  if (ext === 'csv' || ext === 'tsv') return parseCsv(buffer);
  return parseBody(buffer.toString('utf-8'), date);
}

/**
 * The same read, with stable transaction ids already on the rows.
 *
 * This is what the `parseDocument` capability hands back, because every caller
 * of it — the duplicate checker counting how many times a movement really
 * appears in its document, the account backfill matching learned facts onto
 * existing rows — needs to compare against the ledger, and the ledger is keyed
 * by that id. A parser that returned raw rows would leave each of them to
 * re-derive the id, which is exactly the kind of duplicated derivation that
 * drifts.
 */
export async function parseAndNormalize(document) {
  const parsed = await parseActivobankDocument(document);
  return { ...parsed, transactions: normalizeTransactions(parsed.transactions || []) };
}

/**
 * A Gmail fetch and the acknowledgement that goes with it.
 *
 * The two share a closure because they disagree on purpose: one mail becomes
 * zero or more documents (its body when that carries the movements, plus every
 * attachment), but *every* fetched mail must be marked read, including one that
 * yielded no documents at all. Deriving the ids from the documents instead
 * would leave those mails to be fetched again on every single sync, forever.
 */
function gmailSource() {
  let messageIds = [];

  return {
    async fetch() {
      const emails = await fetchActivobankEmails();
      messageIds = emails.map((e) => e.messageId);
      const docs = [];
      for (const email of emails) {
        if (email.body && email.body.trim()) {
          docs.push({
            filename: `${email.messageId}-body.txt`,
            buffer: Buffer.from(email.body, 'utf-8'),
            date: email.date,
            messageId: email.messageId,
          });
        }
        for (const att of email.attachments) {
          docs.push({
            filename: `${email.messageId}-${att.filename}`,
            buffer: att.buffer,
            date: email.date,
            messageId: email.messageId,
          });
        }
      }
      return docs;
    },
    async acknowledge() {
      if (messageIds.length > 0) markProcessed(messageIds);
    },
  };
}

/**
 * Ingests ActivoBank documents either from Gmail ({origin: 'gmail'}) or from
 * manually uploaded files ({origin: 'upload', files: [{filename, buffer}]}).
 * Raw documents are preserved under documents/<instance>/ for future re-parsing.
 */
export async function ingestActivobank({
  ctx: given = null,
  origin = 'gmail',
  files = [],
  skipDocumentGate = false,
} = {}) {
  const ctx = contextOf(given);
  const gmail = origin === 'gmail' ? gmailSource() : null;

  return ingestDocuments(ctx, {
    origin,
    files,
    skipDocumentGate,
    fetch: gmail?.fetch ?? null,
    parse: parseActivobankDocument,
    normalize: normalizeTransactions,
    // Marked read only once the batch is through, so a crash halfway does not
    // lose the mail that caused it.
    acknowledge: gmail?.acknowledge ?? null,
    notifyKeys: NOTIFY_KEYS,
  });
}

/**
 * Re-parses every document already downloaded for this instance.
 *
 * Gmail messages are only fetched once, and each document's content hash is
 * recorded on first sight, so an improved parser would otherwise never see the
 * existing mailbox again. This reads the stored originals straight back through
 * the current parsers; transaction-level deduplication keeps it idempotent, so
 * it is safe to run repeatedly.
 */
export async function reprocessStoredDocuments({ ctx: given = null } = {}) {
  const ctx = contextOf(given);
  const paths = storedDocuments(ctx);
  // `basename`, not a split on "/": the old split left the whole path as the
  // filename on Windows, which put an absolute path inside every reprocessed
  // document's linked_entities and made the duplicate checker unable to find
  // the document it was asked to re-read.
  const files = paths.map((p) => ({ filename: basename(p), buffer: readFileSync(p) }));
  const result = await ingestActivobank({ ctx, origin: 'reprocess', files, skipDocumentGate: true });
  return { ...result, filesFound: files.length };
}
