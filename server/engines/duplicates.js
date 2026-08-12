/**
 * Finds transactions that look like the same movement recorded twice, and
 * retires the extras.
 *
 * Why this is a review screen and not an automatic sweep: in real ActivoBank
 * data, identical rows on the same day are usually *real*. One statement holds
 * fifteen separate €0.01 "CUSTO DE SERVICO INTERNACIONAL" lines and thirteen
 * €0.14 Google/Niantic charges — genuine micro-purchases, not a parser hiccup.
 * Deleting by pattern would quietly destroy real spending, so the engine ranks
 * and explains, and the user decides.
 *
 * The strongest signal is not a heuristic at all: `verifyAgainstDocument`
 * re-reads the original PDF with the current parsers and reports how many times
 * the row legitimately appears. Since the statement parser now discards rows
 * repeated at an unchanged running balance, that count is authoritative.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createEvent, loadLedgerIndex, appendIfNewIndexed } from '../ledger/eventStore.js';
import { documentsPath, statePath } from '../lib/paths.js';
import { cleanDescription } from '../lib/merchant.js';

// How far apart two records of the same movement can sit. The statement books
// on a different day than the advice note, but rarely by more than a couple.
const DEFAULT_WINDOW_DAYS = 2;

const DISMISSED_FILE = 'duplicates-dismissed.json';

function dismissedFile() {
  return statePath(DISMISSED_FILE);
}

export function loadDismissed() {
  if (!existsSync(dismissedFile())) return [];
  try {
    return JSON.parse(readFileSync(dismissedFile(), 'utf-8'));
  } catch {
    return [];
  }
}

export function dismissGroup(groupKey) {
  const list = loadDismissed();
  if (!list.some((d) => d.groupKey === groupKey)) {
    list.push({ groupKey, at: new Date().toISOString() });
    writeFileSync(dismissedFile(), JSON.stringify(list, null, 2), 'utf-8');
  }
  return list;
}

export function undismissGroup(groupKey) {
  const list = loadDismissed().filter((d) => d.groupKey !== groupKey);
  writeFileSync(dismissedFile(), JSON.stringify(list, null, 2), 'utf-8');
  return list;
}

function dayNumber(isoDate) {
  const t = new Date(`${String(isoDate).slice(0, 10)}T00:00:00Z`).getTime();
  return Number.isFinite(t) ? Math.round(t / 86400000) : null;
}

function documentIdOf(tx) {
  const entity = (tx.raw?.linked_entities || []).find((e) => e.type === 'document');
  return entity?.id || null;
}

/** The filename at the end of a document id, whatever separators it used. */
export function documentFilename(documentId) {
  if (!documentId) return null;
  return String(documentId).split(/[\\/]/).pop() || null;
}

/**
 * Transactions whose ids end in -2, -3 … were given a repeat ordinal by the
 * normalizer, meaning the parser saw the same row more than once in a single
 * document. That is exactly the shape both a real repeat and a parsing artifact
 * take, which is why it is evidence rather than proof.
 */
function occurrenceOf(tx) {
  const m = String(tx.id || '').match(/-(\d+)$/);
  return m ? Number(m[1]) : 1;
}

/**
 * The full cleaned description, not the coarse three-word grouping key the
 * review queue uses. Two different shops that happen to charge the same amount
 * two days apart must not be offered as duplicates of each other.
 */
function descriptionKey(tx) {
  return cleanDescription(tx.description || tx.merchant || '');
}

function groupKeyFor(members) {
  const first = members[0];
  return [String(first.date).slice(0, 10), first.amount, descriptionKey(first)].join('|');
}

function describeEvidence(members) {
  const docs = new Set(members.map((m) => documentIdOf(m)));
  const dates = new Set(members.map((m) => String(m.date).slice(0, 10)));
  // Only kinds the parser actually named count. A row whose document predates
  // kind extraction contributes `null`, and letting that null sit in the set
  // made {extrato, null} look like two kinds — promoting an ordinary repeat to
  // the strongest evidence tier the screen has.
  const kinds = new Set(members.map((m) => m.raw?.payload?.document_kind).filter(Boolean));
  const sameDocument = docs.size === 1 && !docs.has(null);
  const hasOrdinals = members.some((m) => occurrenceOf(m) > 1);
  const crossKind = kinds.size > 1;

  const evidence = [];
  if (sameDocument) evidence.push({ key: 'same-document', strong: true });
  else if (docs.size > 1) evidence.push({ key: 'different-documents', strong: false });
  if (crossKind) evidence.push({ key: 'different-document-kinds', strong: true });
  if (dates.size === 1) evidence.push({ key: 'same-date', strong: false });
  else evidence.push({ key: 'dates-apart', strong: false });
  if (hasOrdinals) evidence.push({ key: 'repeat-ordinal', strong: false });

  return { evidence, sameDocument, crossKind, sameDate: dates.size === 1 };
}

/**
 * Groups transactions that plausibly describe one movement.
 *
 * Clustering is by amount + normalized merchant first, then split by date
 * proximity, so "same shop, same price, two days apart" lands together while
 * unrelated months do not.
 */
export function findDuplicateCandidates(
  transactions,
  // Dismissals are injectable so this stays a pure function of its arguments:
  // read from disk in the app, passed in explicitly by tests, which must not
  // depend on which groups the user happens to have waved away.
  { windowDays = DEFAULT_WINDOW_DAYS, dismissedGroups = null } = {}
) {
  const buckets = new Map();

  for (const tx of transactions) {
    if (tx.voided) continue;
    const amount = Number(tx.amount);
    if (!Number.isFinite(amount)) continue;
    const day = dayNumber(tx.date);
    if (day == null) continue;
    const key = `${amount.toFixed(2)}|${descriptionKey(tx)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push({ tx, day });
  }

  const dismissed = new Set((dismissedGroups ?? loadDismissed()).map((d) => d.groupKey));
  const groups = [];

  for (const entries of buckets.values()) {
    if (entries.length < 2) continue;
    entries.sort((a, b) => a.day - b.day || String(a.tx.id).localeCompare(String(b.tx.id)));

    // Walk the sorted run and cut a new group whenever the gap opens up.
    let run = [entries[0]];
    const flush = () => {
      if (run.length < 2) return;
      const members = run.map((e) => e.tx);
      const key = groupKeyFor(members);
      if (dismissed.has(key)) return;
      const { evidence, sameDocument, crossKind, sameDate } = describeEvidence(members);
      groups.push({
        key,
        count: members.length,
        amount: members[0].amount,
        date: String(members[0].date).slice(0, 10),
        dateTo: String(members[members.length - 1].date).slice(0, 10),
        description: members[0].description,
        documentId: documentIdOf(members[0]),
        documentFilename: documentFilename(documentIdOf(members[0])),
        documentKind: members[0].raw?.payload?.document_kind || null,
        // Which instance ingested it, so the document can be re-read by the
        // module that knows how — a fork with two banks stores two files called
        // EXTRATO.pdf and the filename alone no longer identifies one.
        source: members[0].source ?? null,
        sameDocument,
        crossKind,
        sameDate,
        evidence,
        // Cross-kind survivors are the clearest artifacts: a statement and an
        // advice note describing one movement. Everything else needs the
        // document check before it can be called a duplicate.
        confidence: crossKind ? 'high' : sameDocument ? 'review' : 'low',
        transactions: members.map((m) => ({
          id: m.id,
          date: String(m.date).slice(0, 10),
          description: m.description,
          merchant: m.merchant,
          amount: m.amount,
          category: m.category,
          status: m.status,
          occurrence: occurrenceOf(m),
          // How many times this same movement was ingested. Above one means the
          // document was read twice and the copies were folded — worth saying,
          // because it explains a row the user may remember seeing duplicated.
          ingestions: (m.sourceEventIds || []).length || 1,
          documentId: documentIdOf(m),
          documentFilename: documentFilename(documentIdOf(m)),
        })),
      });
    };

    for (const entry of entries.slice(1)) {
      if (entry.day - run[run.length - 1].day <= windowDays) run.push(entry);
      else {
        flush();
        run = [entry];
      }
    }
    flush();
  }

  return groups.sort(
    (a, b) => b.count - a.count || Math.abs(b.amount) - Math.abs(a.amount)
  );
}

/**
 * Locates a stored document by the filename in its ledger id.
 *
 * `source` is the instance that ingested it, and is where the search starts —
 * two banks can perfectly well store a file called `EXTRATO.pdf`. Without one,
 * every instance's directories are searched, which is what happens for a group
 * assembled before the source was recorded on it.
 */
export function resolveDocumentPath(documentId, source = null) {
  const filename = documentFilename(documentId);
  if (!filename) return null;

  const root = documentsPath();
  if (!existsSync(root)) return null;
  const instances = source
    ? [source]
    : readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);

  for (const instance of instances) {
    for (const stage of ['processed', 'inbox']) {
      const stageDir = documentsPath(instance, stage);
      if (!existsSync(stageDir)) continue;
      for (const batch of readdirSync(stageDir, { withFileTypes: true })) {
        if (!batch.isDirectory()) continue;
        const candidate = join(stageDir, batch.name, filename);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

/**
 * Re-reads the group's source document with the current parsers and counts how
 * many times this exact movement really appears in it.
 *
 * `expected` below `count` means the ledger holds copies the document does not
 * justify — the safe, evidence-backed case for voiding.
 *
 * Which parser to use is decided by the module that ingested the document, not
 * by this file: the strongest signal the duplicate screen has is a re-read of
 * the original, and it has to keep working for whatever institution a fork adds.
 */
export async function verifyAgainstDocument(group) {
  if (!group.documentId) return { verified: false, reason: 'no-document' };

  const path = resolveDocumentPath(group.documentId, group.source ?? null);
  if (!path) return { verified: false, reason: 'document-not-found' };

  // The instance that owns the directory the document was found in.
  const owner = group.source ?? path.slice(documentsPath().length + 1).split(/[\\/]/)[0];

  const { invoke, supports } = await import('../framework/registry.js');
  if (!(await supports(owner, 'parseDocument'))) {
    return { verified: false, reason: `no-parser-for:${owner}` };
  }

  let parsed;
  try {
    parsed = await invoke(owner, 'parseDocument', {
      filename: documentFilename(path),
      buffer: readFileSync(path),
      date: null,
    });
  } catch (err) {
    return { verified: false, reason: `parse-failed: ${err.message}` };
  }

  const expected = (parsed.transactions || []).filter(
    (t) =>
      Number(t.amount).toFixed(2) === Number(group.amount).toFixed(2) &&
      String(t.date).slice(0, 10) === group.date
  ).length;

  return {
    verified: true,
    document: documentFilename(path),
    expected,
    found: group.count,
    surplus: Math.max(0, group.count - expected),
  };
}

/**
 * Retires transactions with a `transaction_void` event.
 *
 * Nothing is removed from the ledger — it stays append-only, and the void is
 * itself an auditable fact that can be read back. Projections drop voided
 * transactions from every total.
 */
export async function voidTransactions(transactionIds, { reason = 'duplicate', duplicateOf = null } = {}) {
  const index = await loadLedgerIndex();
  const already = await voidedIds();
  let voided = 0;

  for (const id of transactionIds) {
    if (already.has(id)) continue;
    const ev = createEvent('transaction_void', 'duplicate-review', {
      event_id: id,
      reason,
      duplicate_of: duplicateOf,
      // Deliberately part of the hashed payload. Voiding, restoring and voiding
      // again is a legitimate sequence, and without a distinguishing timestamp
      // the second void would collide with the first and be swallowed, leaving
      // the restore as the last word. The `already` check above is what keeps
      // the ledger from filling with no-op repeats.
      at: new Date().toISOString(),
    });
    if (appendIfNewIndexed(ev, index)) voided++;
  }

  return { voided };
}

/** Reverses a void, so a mistaken merge can be undone. */
export async function restoreTransactions(transactionIds) {
  const index = await loadLedgerIndex();
  const already = await voidedIds();
  let restored = 0;
  for (const id of transactionIds) {
    if (!already.has(id)) continue;
    const ev = createEvent('transaction_unvoid', 'duplicate-review', {
      event_id: id,
      at: new Date().toISOString(),
    });
    if (appendIfNewIndexed(ev, index)) restored++;
  }
  return { restored };
}

/** Which transactions are voided right now, per the replayed ledger. */
async function voidedIds() {
  const { getProjections } = await import('../projections/cache.js');
  const projections = await getProjections();
  return new Set(projections.voidedTransactions.map((t) => t.id));
}
