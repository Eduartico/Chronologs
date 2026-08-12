/**
 * The shared bank pipeline, tested on its own.
 *
 * Until now every one of these protections was only exercised through the
 * ActivoBank importer, with ActivoBank's PDFs. They are about to be inherited by
 * every bank anyone adds, so they are tested here against a parser invented for
 * the purpose — which is also the shortest possible demonstration of what a new
 * bank module has to supply.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const DATA_DIR = mkdtempSync(join(tmpdir(), 'chronologs-kit-'));
mkdirSync(join(DATA_DIR, 'ledger'), { recursive: true });
mkdirSync(join(DATA_DIR, 'state'), { recursive: true });
process.env.CHRONOLOGS_DATA_DIR = DATA_DIR;

const { ingestDocuments, storedDocuments } = await import('./documentBank.js');
const { createContext } = await import('../context.js');
const { replayEvents } = await import('../../ledger/eventStore.js');

/**
 * Empties both the ledger and the stored documents.
 *
 * The documents matter as much as the ledger here: the content-hash gate reads
 * the ledger, but `storedDocuments` reads the disk, and a case that left files
 * behind would make the next one see documents it never ingested.
 */
function fresh() {
  writeFileSync(join(DATA_DIR, 'ledger', 'events.ndjson'), '', 'utf-8');
  rmSync(join(DATA_DIR, 'documents'), { recursive: true, force: true });
}

const ctxFor = (id) => createContext({ id, module: id, config: {} });

/** A parser for an invented one-line-per-movement format: `date|amount|text`. */
function lineParser(kind = 'statement') {
  return async ({ buffer }) => {
    const transactions = [];
    const unparsedLines = [];
    for (const line of buffer.toString('utf-8').split('\n')) {
      if (!line.trim()) continue;
      const [date, amount, description] = line.split('|');
      if (!date || !amount) {
        unparsedLines.push(line);
        continue;
      }
      transactions.push({
        date,
        amount: Number(amount),
        description: description ?? '',
        document_kind: kind,
      });
    }
    return { transactions, orders: [], unparsedLines, kind };
  };
}

/** Stable ids, the way a real module's normalize step supplies them. */
const normalize = (transactions) =>
  transactions.map((t) => ({
    ...t,
    transaction_id: `tx-${t.date}-${t.amount}-${t.description.slice(0, 6)}`,
  }));

const file = (name, body) => ({ filename: name, buffer: Buffer.from(body, 'utf-8') });

async function ingest(ctx, files, options = {}) {
  return ingestDocuments(ctx, {
    origin: 'upload',
    files,
    parse: lineParser(options.kind),
    normalize,
    ...options,
  });
}

test('a first import records every movement once', async () => {
  fresh();
  const result = await ingest(ctxFor('bank-a'), [
    file('mar.txt', '2025-03-01|-10.00|COFFEE\n2025-03-02|-20.00|LUNCH\n'),
  ]);
  assert.equal(result.new, 2);
  assert.equal(result.duplicates, 0);
  assert.equal(result.documents, 1);
});

test('the same file uploaded twice is recognised by its content, not its name', async () => {
  fresh();
  const body = '2025-03-01|-10.00|COFFEE\n';
  const ctx = ctxFor('bank-a');
  await ingest(ctx, [file('statement.txt', body)]);
  const second = await ingest(ctx, [file('statement-1.txt', body)]);

  assert.equal(second.skippedDocuments, 1);
  assert.equal(second.new, 0);
});

test('a movement reported by two document kinds is only counted once', async () => {
  fresh();
  const ctx = ctxFor('bank-a');
  // The advice note reports it on the day…
  await ingest(ctx, [file('nota.txt', '2025-03-01|-42.00|SUPERMARKET\n')], { kind: 'nota' });
  // …and the statement again three days later, worded differently.
  const second = await ingest(ctx, [file('extrato.txt', '2025-03-04|-42.00|SUPERMARKET LDA\n')], {
    kind: 'extrato',
  });

  assert.equal(second.new, 0);
  assert.equal(second.duplicates, 1);
});

test('the same amount outside the window is a different movement', async () => {
  fresh();
  const ctx = ctxFor('bank-a');
  await ingest(ctx, [file('nota.txt', '2025-03-01|-42.00|SUPERMARKET\n')], { kind: 'nota' });
  const second = await ingest(ctx, [file('extrato.txt', '2025-03-20|-42.00|SUPERMARKET\n')], {
    kind: 'extrato',
  });

  assert.equal(second.new, 1);
});

test('two instances never mistake each other\'s movements for duplicates', async () => {
  fresh();
  // The same amount on the same day at two different banks is two real
  // payments. Pairing across instances would silently drop one of them.
  await ingest(ctxFor('bank-a'), [file('a.txt', '2025-03-01|-42.00|RENT\n')], { kind: 'nota' });
  const b = await ingest(ctxFor('bank-b'), [file('b.txt', '2025-03-02|-42.00|RENT\n')], {
    kind: 'extrato',
  });

  assert.equal(b.new, 1);
  const events = await replayEvents();
  const sources = events.filter((e) => e.type === 'transaction').map((e) => e.source).sort();
  assert.deepEqual(sources, ['bank-a', 'bank-b']);
});

test('each instance keeps its documents in its own directory', async () => {
  fresh();
  await ingest(ctxFor('bank-a'), [file('a.txt', '2025-03-01|-1.00|X\n')]);
  await ingest(ctxFor('bank-b'), [file('b.txt', '2025-03-01|-2.00|Y\n')]);

  const a = storedDocuments(ctxFor('bank-a')).map((p) => p.split(/[\\/]/).pop());
  const b = storedDocuments(ctxFor('bank-b')).map((p) => p.split(/[\\/]/).pop());
  assert.deepEqual(a, ['a.txt']);
  assert.deepEqual(b, ['b.txt']);
});

test('a processed batch is filed out of the inbox', async () => {
  fresh();
  const ctx = ctxFor('bank-c');
  const result = await ingest(ctx, [file('x.txt', '2025-03-01|-5.00|X\n')]);

  assert.equal(existsSync(ctx.paths.documents('inbox', result.batchId)), false);
  assert.equal(existsSync(ctx.paths.documents('processed', result.batchId)), true);
});

test('lines the parser could not read are reported, not swallowed', async () => {
  fresh();
  const result = await ingest(ctxFor('bank-a'), [
    file('mixed.txt', '2025-03-01|-10.00|COFFEE\nthis line is not a movement\n'),
  ]);

  assert.equal(result.new, 1);
  assert.equal(result.unparsedLines.length, 1);
  assert.deepEqual(result.unparsedLines[0].lines, ['this line is not a movement']);
});

test('one broken document does not abandon the rest of the batch', async () => {
  fresh();
  const result = await ingestDocuments(ctxFor('bank-a'), {
    origin: 'upload',
    files: [file('bad.txt', 'x'), file('good.txt', '2025-03-01|-10.00|COFFEE\n')],
    parse: async ({ filename, buffer }) => {
      if (filename === 'bad.txt') throw new Error('unreadable');
      return lineParser()({ buffer });
    },
    normalize,
  });

  assert.equal(result.new, 1);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /bad\.txt: unreadable/);
});

test('reprocessing stored documents adds nothing and loses nothing', async () => {
  fresh();
  const ctx = ctxFor('bank-d');
  await ingest(ctx, [file('mar.txt', '2025-03-01|-10.00|COFFEE\n2025-03-02|-20.00|LUNCH\n')]);

  const before = (await replayEvents()).filter((e) => e.type === 'transaction').length;
  const again = await ingest(ctx, [file('mar.txt', '2025-03-01|-10.00|COFFEE\n2025-03-02|-20.00|LUNCH\n')], {
    origin: 'reprocess',
    skipDocumentGate: true,
  });
  const after = (await replayEvents()).filter((e) => e.type === 'transaction').length;

  assert.equal(again.new, 0);
  assert.equal(after, before);
});

test('a fetching module is asked for its documents and told when they are through', async () => {
  fresh();
  const seen = [];
  const result = await ingestDocuments(ctxFor('bank-e'), {
    origin: 'sync',
    fetch: async () => [file('remote.txt', '2025-03-01|-7.00|REMOTE\n')],
    acknowledge: async () => seen.push('acknowledged'),
    parse: lineParser(),
    normalize,
  });

  assert.equal(result.new, 1);
  // Acknowledged only after the documents are safely in the ledger — the whole
  // point of the ordering, since a mailbox that marks a message read before
  // parsing it loses that message on a crash.
  assert.deepEqual(seen, ['acknowledged']);
});
